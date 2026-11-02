import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Clock,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Upload,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  Banknote,
  QrCode
} from 'lucide-react';
import './RoomExtensionModal.css';
import { API_BASE } from '../apiConfig.js';
import { authManager } from '../authManager';

/**
 * Validates file signature (magic bytes) for uploaded payment slip files.
 */
function validateSlipFileSignature(file) {
  return new Promise((resolve) => {
    if (!file) return resolve({ valid: false, error: 'ไม่พบไฟล์' });
    if (file.size > 10 * 1024 * 1024) {
      return resolve({ valid: false, error: 'ขนาดไฟล์เกิน 10MB กรุณาเลือกรูปภาพที่มีขนาดเล็กลง' });
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = new Uint8Array(e.target.result);
      if (buffer.length < 4) {
        return resolve({ valid: false, error: 'ไฟล์ไม่สมบูรณ์' });
      }

      // Check PNG (0x89 0x50 0x4E 0x47)
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return resolve({ valid: true, ext: 'png', mime: 'image/png' });
      }
      // Check JPEG (0xFF 0xD8 0xFF)
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return resolve({ valid: true, ext: 'jpg', mime: 'image/jpeg' });
      }
      // Check WEBP (RIFF....WEBP)
      if (
        buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
      ) {
        return resolve({ valid: true, ext: 'webp', mime: 'image/webp' });
      }

      return resolve({ valid: false, error: 'ชนิดไฟล์ไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ JPG, PNG หรือ WEBP เท่านั้น' });
    };
    reader.onerror = () => resolve({ valid: false, error: 'ไม่สามารถอ่านไฟล์ได้' });
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

const DURATION_PRESETS = [
  { label: '+30 นาที', sub: '0.5 ชั่วโมง', minutes: 30 },
  { label: '+1 ชั่วโมง', sub: '60 นาที', minutes: 60 },
  { label: '+1.5 ชั่วโมง', sub: '90 นาที', minutes: 90 },
  { label: '+2 ชั่วโมง', sub: '120 นาที', minutes: 120 }
];

export default function RoomExtensionModal({
  isOpen,
  booking,
  initialItem = null,
  onClose,
  onSuccess,
  sysAlert = null
}) {
  const activeBookingId = booking ? (booking.booking_id || booking.id) : null;

  const [loadedBooking, setLoadedBooking] = useState(null);
  const [loadingBooking, setLoadingBooking] = useState(false);

  const [selectedDuration, setSelectedDuration] = useState(60);
  const [customMinutes, setCustomMinutes] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);

  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  // Generation sequence refs & abort controller refs
  const bookingSeqRef = useRef(0);
  const bookingAbortRef = useRef(null);
  const previewSeqRef = useRef(0);
  const previewAbortRef = useRef(null);

  const [useQuota, setUseQuota] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash'); // 'cash' | 'promptpay' | 'transfer' | 'unpaid'
  const [notes, setNotes] = useState('');

  // Slip Upload State
  const [selectedSlipFile, setSelectedSlipFile] = useState(null);
  const [slipBase64, setSlipBase64] = useState(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState(null);
  const [slipError, setSlipError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const activeDurationMinutes = isCustom ? (parseInt(customMinutes, 10) || 60) : selectedDuration;

  // Strict binding: loadedBooking is only valid if its ID exactly matches activeBookingId
  const isLoadedBookingValid = Boolean(
    loadedBooking &&
    activeBookingId &&
    (loadedBooking.id === activeBookingId || loadedBooking.booking_id === activeBookingId)
  );
  const currentBooking = isLoadedBookingValid ? loadedBooking : booking;

  // Cleanup & Invalidation on modal close or booking change
  useEffect(() => {
    if (!isOpen || !activeBookingId) {
      if (bookingAbortRef.current) {
        bookingAbortRef.current.abort();
        bookingAbortRef.current = null;
      }
      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
        previewAbortRef.current = null;
      }
      bookingSeqRef.current++;
      previewSeqRef.current++;

      setLoadedBooking(null);
      setLoadingBooking(false);
      setSelectedItemId(null);
      setPreview(null);
      setLoadingPreview(false);
      setPreviewError(null);
      setSubmitError(null);
    }
  }, [isOpen, activeBookingId]);

  // Load full booking details if items array is missing or empty
  useEffect(() => {
    if (!isOpen || !activeBookingId) return;

    const hasItems = Array.isArray(booking?.items) && booking.items.length > 0;
    if (hasItems) {
      if (bookingAbortRef.current) {
        bookingAbortRef.current.abort();
        bookingAbortRef.current = null;
      }
      setLoadedBooking(null);
      setLoadingBooking(false);
      return;
    }

    if (bookingAbortRef.current) {
      bookingAbortRef.current.abort();
    }
    const abortCtrl = new AbortController();
    bookingAbortRef.current = abortCtrl;
    const seq = ++bookingSeqRef.current;

    setLoadingBooking(true);
    setLoadedBooking(null);

    const token = (authManager && authManager.getToken)
      ? authManager.getToken()
      : (localStorage.getItem('pos_token') || localStorage.getItem('token') || sessionStorage.getItem('token') || '');
    const base = API_BASE ? API_BASE.replace(/\/+$/, '') : '';

    fetch(`${base}/api/bookings/${encodeURIComponent(activeBookingId)}`, {
      signal: abortCtrl.signal,
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'Content-Type': 'application/json'
      }
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (seq !== bookingSeqRef.current) return;
        if (!data) return;

        const returnedId = data.id || data.booking_id;
        if (returnedId === activeBookingId) {
          setLoadedBooking(data);
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (seq !== bookingSeqRef.current) return;
        console.error('Failed to load full booking details for extension:', err);
      })
      .finally(() => {
        if (seq === bookingSeqRef.current) {
          setLoadingBooking(false);
        }
      });

    return () => {
      abortCtrl.abort();
    };
  }, [isOpen, activeBookingId, booking?.items?.length]);

  // Extract eligible room items
  const roomItems = useMemo(() => {
    if (!currentBooking) return [];
    if (Array.isArray(currentBooking.items) && currentBooking.items.length > 0) {
      return currentBooking.items.filter(it => it && it.room_id && it.checkin_status !== 'cancelled');
    }
    if (currentBooking.room_id) {
      return [{
        id: currentBooking.booking_item_id || currentBooking.item_id || null,
        booking_id: currentBooking.booking_id || currentBooking.id,
        room_id: currentBooking.room_id,
        room_name: currentBooking.room_name,
        start_time: currentBooking.start_time,
        end_time: currentBooking.end_time,
        layout: currentBooking.layout || 'standard'
      }];
    }
    return [];
  }, [currentBooking]);

  // Active item strictly derived from selectedItemId
  const activeItem = useMemo(() => {
    if (!selectedItemId) return null;
    return roomItems.find(it => it.id === selectedItemId) || null;
  }, [selectedItemId, roomItems]);

  // Initialize selected item on modal open or roomItems update
  useEffect(() => {
    if (!isOpen || !activeBookingId) return;

    let targetItemId = null;

    // Rule 1: If initialItem is specified and matches an eligible item, select it
    if (initialItem && initialItem.room_id) {
      const initId = initialItem.id || initialItem.booking_item_id;
      const matched = roomItems.find(it => it.id === initId || (it.room_id === initialItem.room_id && it.start_time === initialItem.start_time));
      if (matched && matched.id) {
        targetItemId = matched.id;
      }
    }

    // Rule 2: If no initial target, only auto-select if there is EXACTLY 1 eligible room
    // NEVER auto-select if there are multiple rooms! Force the user to choose.
    if (!targetItemId && roomItems.length === 1 && roomItems[0].id) {
      targetItemId = roomItems[0].id;
    }

    setSelectedItemId(targetItemId);

    // Reset form state
    setSelectedDuration(60);
    setIsCustom(false);
    setCustomMinutes('');
    setUseQuota(false);
    setPaymentMethod('cash');
    setSelectedSlipFile(null);
    setSlipBase64(null);
    setSlipPreviewUrl(null);
    setSlipError(null);
    setSubmitError(null);
    setPreview(null);
    setPreviewError(null);
  }, [isOpen, activeBookingId, initialItem, roomItems]);

  // Fetch extension preview with AbortController & generation guard
  useEffect(() => {
    if (!isOpen || !activeBookingId) return;

    // If no room is selected yet or duration missing or loading booking, clear preview and cancel pending fetch
    if (!selectedItemId || !activeDurationMinutes || loadingBooking) {
      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
        previewAbortRef.current = null;
      }
      previewSeqRef.current++;
      setPreview(null);
      setLoadingPreview(false);
      setPreviewError(null);
      return;
    }

    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const abortCtrl = new AbortController();
    previewAbortRef.current = abortCtrl;
    const seq = ++previewSeqRef.current;

    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null); // Clear stale preview immediately

    const token = (authManager && authManager.getToken)
      ? authManager.getToken()
      : (localStorage.getItem('pos_token') || localStorage.getItem('token') || sessionStorage.getItem('token') || '');
    const base = API_BASE ? API_BASE.replace(/\/+$/, '') : '';

    const previewUrl = `${base}/api/bookings/${encodeURIComponent(activeBookingId)}/extension-preview?duration_minutes=${encodeURIComponent(activeDurationMinutes)}&booking_item_id=${encodeURIComponent(selectedItemId)}`;

    fetch(previewUrl, {
      signal: abortCtrl.signal,
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'Content-Type': 'application/json'
      }
    })
      .then(async (res) => {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('ไม่สามารถเชื่อมต่อระบบ API ได้ (ได้รับข้อมูลตอบกลับไม่ถูกต้อง)');
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'ไม่สามารถตรวจสอบการต่อเวลาได้');
        }
        return data;
      })
      .then((data) => {
        if (seq !== previewSeqRef.current) return;
        if (!data) return;

        // Discard response if returned booking, item, or duration does not match current state
        if (
          data.booking_id !== activeBookingId ||
          data.booking_item_id !== selectedItemId ||
          Number(data.duration_minutes) !== Number(activeDurationMinutes)
        ) {
          return;
        }

        setPreview(data);
        if (data.quota && data.quota.contract_eligible && data.quota.remaining_quota > 0) {
          setUseQuota(true);
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (seq !== previewSeqRef.current) return;
        setPreviewError(err.message);
        setPreview(null);
      })
      .finally(() => {
        if (seq === previewSeqRef.current) {
          setLoadingPreview(false);
        }
      });

    return () => {
      abortCtrl.abort();
    };
  }, [isOpen, activeBookingId, selectedItemId, activeDurationMinutes, loadingBooking]);

  // Strict Preview Freshness Invariant
  const isPreviewFresh = Boolean(
    preview &&
    !loadingPreview &&
    !loadingBooking &&
    selectedItemId &&
    preview.booking_id === activeBookingId &&
    preview.booking_item_id === selectedItemId &&
    Number(preview.duration_minutes) === Number(activeDurationMinutes) &&
    activeItem &&
    preview.current_end_time === activeItem.end_time
  );

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Handle file selection
  const handleFileChange = async (file) => {
    if (!file) return;
    setSlipError(null);

    const validation = await validateSlipFileSignature(file);
    if (!validation.valid) {
      setSlipError(validation.error);
      setSelectedSlipFile(null);
      setSlipBase64(null);
      setSlipPreviewUrl(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setSlipBase64(e.target.result);
      setSlipPreviewUrl(URL.createObjectURL(file));
      setSelectedSlipFile(file);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Submit Extension
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (loadingBooking) {
      setSubmitError('กำลังโหลดข้อมูลการจอง กรุณารอสักครู่');
      return;
    }
    if (!selectedItemId) {
      setSubmitError('กรุณาเลือกห้องประชุมที่ต้องการต่อเวลา');
      return;
    }
    if (!activeItem || !activeItem.end_time) {
      setSubmitError('ไม่พบข้อมูลเวลาเดิมของห้องที่เลือก (ห้ามส่งข้อมูลโดยไม่มีเวลาสิ้นสุด)');
      return;
    }
    if (!preview || !isPreviewFresh) {
      setSubmitError('ข้อมูลพรีวิวไม่ตรงกับห้องหรือระยะเวลาที่เลือก กรุณารอสักครู่');
      return;
    }
    if (preview.booking_id !== activeBookingId) {
      setSubmitError('ข้อมูลพรีวิวไม่ตรงกับการจองปัจจุบัน');
      return;
    }
    if (!preview.available) {
      setSubmitError(preview.conflict?.message || 'ห้องไม่ว่างในช่วงเวลาดังกล่าว');
      return;
    }
    if (!preview.new_end_time) {
      setSubmitError('ไม่สามารถต่อเวลาได้เนื่องจากไม่พบการคำนวณเวลาสิ้นสุดใหม่');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const token = (authManager && authManager.getToken)
        ? authManager.getToken()
        : (localStorage.getItem('pos_token') || localStorage.getItem('token') || sessionStorage.getItem('token') || '');
      const base = API_BASE ? API_BASE.replace(/\/+$/, '') : '';

      // Calculate net fee with quota toggle
      const hourlyRate = preview.hourly_rate || 0;
      const additionalHours = activeDurationMinutes / 60;
      let effectiveQuotaDeducted = 0;
      let fee = preview.gross_extension_fee || 0;

      if (preview.is_internal_free) {
        fee = 0;
      } else if (useQuota && preview.quota && preview.quota.contract_eligible) {
        effectiveQuotaDeducted = Math.min(additionalHours, preview.quota.remaining_quota || 0);
        fee = Math.round(Math.max(0, additionalHours - effectiveQuotaDeducted) * hourlyRate * 100) / 100;
      }

      let amountPaid = fee;
      if (paymentMethod === 'unpaid') {
        amountPaid = 0;
      }

      const payload = {
        booking_item_id: selectedItemId,
        current_end_time: activeItem.end_time, // Guaranteed to match preview.current_end_time
        duration_minutes: activeDurationMinutes,
        payment_method: fee === 0 ? 'quota' : paymentMethod,
        use_quota: useQuota,
        amount_paid: amountPaid,
        slip_image: slipBase64 || null,
        notes: notes || null
      };

      const extendUrl = `${base}/api/bookings/${encodeURIComponent(activeBookingId)}/extend`;
      const res = await fetch(extendUrl, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('ไม่สามารถเชื่อมต่อระบบ API ได้ (ได้รับข้อมูลตอบกลับไม่ถูกต้อง)');
      }

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'เกิดข้อผิดพลาดในการต่อเวลาห้อง');
      }

      if (sysAlert) {
        sysAlert(resData.message || 'ต่อเวลาห้องประชุมเรียบร้อยแล้ว', 'success');
      }

      if (onSuccess) {
        onSuccess(resData.booking || resData);
      }
      onClose();
    } catch (err) {
      console.error('Extension submission error:', err);
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !booking) return null;

  const roomName = activeItem?.room_name || (selectedItemId ? `ห้อง #${selectedItemId}` : 'ห้องประชุม');

  // Format times for display
  const formatTimeOnly = (isoStr) => {
    if (!isoStr) return '--:--';
    if (isoStr.includes('T')) return isoStr.split('T')[1].substring(0, 5);
    return isoStr.substring(0, 5);
  };

  const currentStart = formatTimeOnly(activeItem?.start_time);
  const currentEnd = formatTimeOnly(activeItem?.end_time);
  const newEnd = isPreviewFresh && preview?.new_end_time ? formatTimeOnly(preview.new_end_time) : '--:--';

  // Calculate net fee for display
  const additionalHours = activeDurationMinutes / 60;
  const hourlyRate = isPreviewFresh ? (preview?.hourly_rate || 0) : 0;
  const grossFee = isPreviewFresh ? (preview?.gross_extension_fee || 0) : 0;
  const isInternalFree = isPreviewFresh ? (preview?.is_internal_free || false) : false;

  let quotaDeductedHours = 0;
  let netFee = grossFee;

  if (isInternalFree) {
    netFee = 0;
  } else if (useQuota && preview?.quota?.contract_eligible && isPreviewFresh) {
    quotaDeductedHours = Math.min(additionalHours, preview.quota.remaining_quota || 0);
    netFee = Math.round(Math.max(0, additionalHours - quotaDeductedHours) * hourlyRate * 100) / 100;
  }

  const modalContent = (
    <div className="rx-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onClose(); }}>
      <div className="rx-modal-card" role="dialog" aria-modal="true" aria-labelledby="rx-modal-title">
        {/* HEADER */}
        <div className="rx-modal-header">
          <div className="rx-modal-header-info">
            <div className="rx-modal-title-row">
              <div className="rx-modal-icon-badge">
                <Clock size={18} />
              </div>
              <h2 id="rx-modal-title" className="rx-modal-title">ต่อเวลาการใช้งานห้องประชุม</h2>
            </div>
            <div className="rx-modal-subtitle">
              <span>รหัสการจอง: <strong>{currentBooking.booking_code || `#${currentBooking.id}`}</strong></span>
              <span>•</span>
              <span>ผู้จอง: <strong>{currentBooking.customer_name}</strong></span>
            </div>
          </div>
          <button
            type="button"
            className="rx-modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="ปิดหน้าต่าง"
          >
            <X size={18} />
          </button>
        </div>

        {/* BODY */}
        <div className="rx-modal-body">
          {/* Room Selection (if multiple rooms) or Single Room Bar */}
          {roomItems.length > 1 ? (
            <div>
              <label className="rx-section-label">
                เลือกห้องที่ต้องการต่อเวลา <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {roomItems.map(it => {
                  const isSelected = selectedItemId === it.id;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`rx-duration-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        if (selectedItemId !== it.id) {
                          setSelectedItemId(it.id);
                        }
                      }}
                      style={{
                        flex: 1,
                        minWidth: '140px',
                        borderColor: isSelected ? 'var(--primary-color, #2563eb)' : 'var(--border-color, #e2e8f0)',
                        backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                        fontWeight: isSelected ? 700 : 500
                      }}
                    >
                      <span>{it.room_name || `ห้อง #${it.room_id}`}</span>
                      <span className="rx-duration-sub">{formatTimeOnly(it.start_time)} - {formatTimeOnly(it.end_time)}</span>
                    </button>
                  );
                })}
              </div>
              {!selectedItemId && (
                <div style={{ fontSize: '0.78rem', color: '#dc2626', marginTop: '6px', fontWeight: 600 }}>
                  การจองนี้มีหลายห้อง กรุณาคลิกเลือกห้องที่ต้องการต่อเวลา
                </div>
              )}
            </div>
          ) : roomItems.length === 1 ? (
            <div className="rx-room-bar">
              <div className="rx-room-name-box">
                <span className="rx-room-pill">{roomName}</span>
                <span className="rx-room-type-tag">
                  {activeItem?.layout === 'classroom' ? 'Classroom (อบรม)' : 'Standard'}
                </span>
              </div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                อัตราปกติ: ฿{hourlyRate.toLocaleString()} / ชม.
              </span>
            </div>
          ) : loadingBooking ? (
            <div className="rx-avail-status loading">
              <RotateCcw size={16} className="rx-spin" />
              <span>กำลังโหลดรายละเอียดรายการห้อง...</span>
            </div>
          ) : (
            <div className="rx-avail-status conflict">
              <AlertCircle size={18} />
              <span>ไม่พบรายการห้องที่สามารถต่อเวลาได้ในการจองนี้</span>
            </div>
          )}

          {/* Time Comparison Strip */}
          <div className="rx-time-strip">
            <div className="rx-time-box">
              <span className="rx-time-label">เวลาเดิม</span>
              <span className="rx-time-value">{currentStart} – {currentEnd} น.</span>
            </div>
            <div className="rx-time-arrow">
              <ArrowRight size={20} />
            </div>
            <div className="rx-time-box rx-time-new-box">
              <span className="rx-time-label">เวลาใหม่หลังต่อเวลา (+{additionalHours} ชม.)</span>
              <span className="rx-time-value rx-time-new-value">
                {currentStart} – {newEnd} น.
              </span>
            </div>
          </div>

          {/* Duration Selector */}
          <div>
            <div className="rx-section-label">
              <span>เลือกระยะเวลาที่ต้องการต่อเวลา</span>
              <button
                type="button"
                onClick={() => { setIsCustom(!isCustom); setCustomMinutes(String(selectedDuration)); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '0.76rem',
                  fontWeight: 650,
                  cursor: 'pointer'
                }}
              >
                {isCustom ? 'เลือกเวลามาตรฐาน' : 'กำหนดนาทีเอง'}
              </button>
            </div>

            {!isCustom ? (
              <div className="rx-duration-grid">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.minutes}
                    type="button"
                    className={`rx-duration-chip ${selectedDuration === preset.minutes ? 'active' : ''}`}
                    onClick={() => setSelectedDuration(preset.minutes)}
                  >
                    <span>{preset.label}</span>
                    <span className="rx-duration-sub">{preset.sub}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="15"
                  max="480"
                  step="15"
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  placeholder="ระบุจำนวนนาที (เช่น 45)"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid var(--border-color)',
                    fontSize: '0.85rem'
                  }}
                />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>นาที</span>
              </div>
            )}
          </div>

          {/* Availability Status */}
          {!selectedItemId && roomItems.length > 1 ? (
            <div className="rx-avail-status" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}>
              <AlertCircle size={18} />
              <span>กรุณาคลิกเลือกห้องประชุมด้านบนเพื่อคำนวณเวลาและตรวจสอบคิวว่าง</span>
            </div>
          ) : loadingPreview ? (
            <div className="rx-avail-status loading">
              <RotateCcw size={16} className="rx-spin" />
              <span>กำลังตรวจสอบคิวและการเว้นระยะเวลาทำความสะอาด (Cleaning Buffer 30 นาที)...</span>
            </div>
          ) : previewError ? (
            <div className="rx-avail-status conflict">
              <AlertCircle size={18} />
              <span>{previewError}</span>
            </div>
          ) : isPreviewFresh && preview?.available ? (
            <div className="rx-avail-status available">
              <CheckCircle2 size={18} />
              <div>
                <div>ห้องว่าง สามารถต่อเวลาได้จนถึง <strong>{newEnd} น.</strong></div>
                <div style={{ fontSize: '0.78rem', color: '#166534', marginTop: '2px' }}>
                  ระบบรักษา Cleaning Buffer 30 นาที สำหรับลูกค้ารายถัดไปเรียบร้อยแล้ว
                </div>
              </div>
            </div>
          ) : isPreviewFresh && preview && !preview.available ? (
            <div className="rx-avail-status conflict">
              <AlertCircle size={18} />
              <div>
                <div>{preview.conflict?.message || 'ห้องไม่ว่างในช่วงเวลาดังกล่าว'}</div>
                {preview.conflict?.is_cleaning_buffer && (
                  <div style={{ fontSize: '0.78rem', color: '#991b1b', marginTop: '2px' }}>
                    ชนระยะเวลาทำความสะอาด 30 นาทีของการจองถัดไป
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Quota Section (Basecamp / CRM) */}
          {isPreviewFresh && preview?.quota?.contract_eligible && (
            <div className="rx-quota-box">
              <div className="rx-quota-left">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <ShieldCheck size={18} style={{ color: '#2563eb' }} />
                  <span className="rx-quota-title">สิทธิ์ใช้งานห้องตามสัญญา (Quota)</span>
                </div>
                <div className="rx-quota-desc">
                  คงเหลือ: <strong>{preview.quota.remaining_quota || 0} ชม.</strong>
                  {preview.quota.contract?.contract_type && ` (${preview.quota.contract.contract_type})`}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useQuota}
                  onChange={(e) => setUseQuota(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: '#2563eb' }}
                />
                <span style={{ fontSize: '0.82rem', fontWeight: 650, color: 'var(--text-color)' }}>
                  ใช้โควต้า
                </span>
              </label>
            </div>
          )}

          {/* Payment Method Selector */}
          {isPreviewFresh && netFee > 0 && (
            <div>
              <label className="rx-section-label">วิธีการชำระเงินค่าต่อเวลา</label>
              <div className="rx-payment-grid">
                {[
                  { id: 'cash', label: 'เงินสด', icon: Banknote },
                  { id: 'promptpay', label: 'พร้อมเพย์', icon: QrCode },
                  { id: 'transfer', label: 'โอนเงิน', icon: CreditCard },
                  { id: 'unpaid', label: 'ค้างชำระ', icon: RotateCcw }
                ].map((m) => {
                  const Icon = m.icon;
                  const isActive = paymentMethod === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`rx-payment-chip ${isActive ? 'active' : ''}`}
                      onClick={() => setPaymentMethod(m.id)}
                    >
                      <Icon size={16} />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Slip Upload for PromptPay / Transfer */}
              {(paymentMethod === 'promptpay' || paymentMethod === 'transfer') && (
                <div style={{ marginTop: '12px' }}>
                  <label className="rx-section-label" style={{ marginBottom: '6px' }}>
                    แนบสลิปการชำระเงิน (ถ้ามี)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
                  />
                  {!slipPreviewUrl ? (
                    <div
                      className={`rx-dropzone ${isDragging ? 'dragging' : ''}`}
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                    >
                      <Upload size={20} style={{ color: 'var(--text-muted)' }} />
                      <div className="rx-dropzone-text">
                        คลิกเพื่อเลือกรูปภาพ หรือลากไฟล์สลิปมาวางที่นี่
                      </div>
                      <div className="rx-dropzone-hint">
                        รองรับไฟล์ JPG, PNG, WEBP (ไม่เกิน 10MB)
                      </div>
                    </div>
                  ) : (
                    <div className="rx-slip-preview-box">
                      <img src={slipPreviewUrl} alt="Slip Preview" className="rx-slip-preview-img" />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSlipFile(null);
                          setSlipBase64(null);
                          setSlipPreviewUrl(null);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#dc2626',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: 650
                        }}
                      >
                        ลบสลิป
                      </button>
                    </div>
                  )}
                  {slipError && (
                    <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '4px' }}>
                      {slipError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Financial Summary */}
          <div className="rx-summary-strip">
            <div>
              <span className="rx-summary-fee-label">
                {isInternalFree
                  ? 'สิทธิ์ใช้งานภายใน Builtland'
                  : useQuota && quotaDeductedHours > 0
                  ? `หักโควต้า ${quotaDeductedHours} ชม. (คงเหลือที่ต้องชำระ)`
                  : 'ค่าบริการต่อเวลาทั้งหมด'}
              </span>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {!selectedItemId
                  ? 'รอการเลือกห้อง'
                  : paymentMethod === 'unpaid'
                  ? 'บันทึกเข้ายอดค้างชำระของรายการจอง'
                  : 'ชำระทันที'}
              </div>
            </div>
            <span className="rx-summary-fee-amount">
              ฿{netFee.toLocaleString()}
            </span>
          </div>

          {submitError && (
            <div className="rx-avail-status conflict">
              <AlertCircle size={16} />
              <span>{submitError}</span>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="rx-modal-footer">
          <button
            type="button"
            className="rx-btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            className="rx-btn-primary"
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              loadingBooking ||
              loadingPreview ||
              !selectedItemId ||
              !isPreviewFresh ||
              !preview?.available ||
              !preview?.new_end_time
            }
          >
            {isSubmitting ? (
              <>
                <RotateCcw size={15} className="rx-spin" />
                <span>กำลังบันทึก...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>ยืนยันต่อเวลาห้อง</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
