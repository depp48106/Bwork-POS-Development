import React, { useState, useEffect, useRef } from 'react';
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

function addMinutesToLocalISO(isoString, minutes) {
  if (!isoString) return '';
  const norm = isoString.includes('T') ? isoString.replace(' ', 'T') : `${isoString}T00:00:00`;
  const [datePart, timePart] = norm.split('T');
  const [h, m, s] = (timePart || '00:00:00').split(':').map(Number);
  const totalM = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m) + Number(minutes);
  const newDate = new Date(datePart + 'T00:00:00');
  const dayOffset = Math.floor(totalM / (24 * 60));
  if (dayOffset > 0) newDate.setDate(newDate.getDate() + dayOffset);
  const remM = ((totalM % (24 * 60)) + (24 * 60)) % (24 * 60);
  const newH = String(Math.floor(remM / 60)).padStart(2, '0');
  const newM = String(remM % 60).padStart(2, '0');
  const newS = String(s || 0).padStart(2, '0');
  const y = newDate.getFullYear();
  const mo = String(newDate.getMonth() + 1).padStart(2, '0');
  const d = String(newDate.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}T${newH}:${newM}:${newS}`;
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
  const [selectedDuration, setSelectedDuration] = useState(60);
  const [customMinutes, setCustomMinutes] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(null);

  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);

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

  // Initialize selected item
  useEffect(() => {
    if (!isOpen || !booking) return;

    const items = (booking.items && booking.items.length > 0)
      ? booking.items.filter(it => it && it.room_id)
      : (booking.room_id ? [{
          id: booking.booking_item_id || booking.id || 1,
          booking_id: booking.booking_id || booking.id,
          room_id: booking.room_id,
          room_name: booking.room_name,
          start_time: booking.start_time,
          end_time: booking.end_time,
          layout: booking.layout || 'standard'
        }] : []);

    if (initialItem && initialItem.room_id) {
      setSelectedItemId(initialItem.id || initialItem.booking_item_id || items[0]?.id || 1);
    } else if (items.length > 0) {
      setSelectedItemId(items[0].id || items[0].booking_item_id || 1);
    } else {
      setSelectedItemId(1);
    }

    // Reset defaults
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
  }, [isOpen, booking, initialItem]);

  // Fetch preview whenever item or duration changes
  useEffect(() => {
    if (!isOpen || !booking || !selectedItemId || !activeDurationMinutes) return;

    let isMounted = true;
    setLoadingPreview(true);
    setPreviewError(null);

    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const bId = booking.booking_id || booking.id;

    fetch(`/api/bookings/${bId}/extension-preview?booking_item_id=${selectedItemId}&duration_minutes=${activeDurationMinutes}`, {
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json'
      }
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'ไม่สามารถตรวจสอบการต่อเวลาได้');
        }
        return data;
      })
      .then((data) => {
        if (!isMounted) return;
        setPreview(data);
        // If quota is available, default to checked if appropriate
        if (data.quota && data.quota.contract_eligible && data.quota.remaining_quota > 0) {
          setUseQuota(true);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setPreviewError(err.message);
        setPreview(null);
      })
      .finally(() => {
        if (isMounted) setLoadingPreview(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, booking?.id, booking?.booking_id, selectedItemId, activeDurationMinutes]);

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
    if (!preview || !preview.available) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      const bId = booking.booking_id || booking.id;

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

      // Check slip requirement for transfer/promptpay if fee > 0 and paid
      if ((paymentMethod === 'transfer' || paymentMethod === 'promptpay') && amountPaid > 0 && !slipBase64) {
        // Optional warning or allow submit without slip
      }

      const payload = {
        booking_item_id: selectedItemId,
        duration_minutes: activeDurationMinutes,
        payment_method: fee === 0 ? 'quota' : paymentMethod,
        use_quota: useQuota,
        amount_paid: amountPaid,
        slip_image: slipBase64 || null,
        notes: notes || null
      };

      const res = await fetch(`/api/bookings/${bId}/extend`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

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

  const roomItems = (booking?.items && booking.items.length > 0)
    ? booking.items.filter(it => it && it.room_id)
    : (booking?.room_id ? [{
        id: booking.booking_item_id || booking.id || 1,
        booking_id: booking.booking_id || booking.id,
        room_id: booking.room_id,
        room_name: booking.room_name,
        start_time: booking.start_time,
        end_time: booking.end_time,
        layout: booking.layout || 'standard'
      }] : []);
  const activeItem = (selectedItemId ? roomItems.find(it => it.id === selectedItemId) : null) || roomItems[0] || null;
  const roomName = activeItem?.room_name || preview?.room_name || (booking?.room_id ? `ห้อง #${booking.room_id}` : 'ห้องประชุม');

  // Format times for display
  const formatTimeOnly = (isoStr) => {
    if (!isoStr) return '--:--';
    if (isoStr.includes('T')) return isoStr.split('T')[1].substring(0, 5);
    return isoStr.substring(0, 5);
  };

  const currentStart = formatTimeOnly(activeItem?.start_time || preview?.start_time);
  const currentEnd = formatTimeOnly(activeItem?.end_time || preview?.current_end_time);
  const newEnd = preview?.new_end_time ? formatTimeOnly(preview.new_end_time) : '--:--';

  // Calculate net fee for display
  const additionalHours = activeDurationMinutes / 60;
  const hourlyRate = preview?.hourly_rate || 0;
  const grossFee = preview?.gross_extension_fee || 0;
  const isInternalFree = preview?.is_internal_free || false;

  let quotaDeductedHours = 0;
  let netFee = grossFee;

  if (isInternalFree) {
    netFee = 0;
  } else if (useQuota && preview?.quota?.contract_eligible) {
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
              <span>รหัสการจอง: <strong>{booking.booking_code || `#${booking.id}`}</strong></span>
              <span>•</span>
              <span>ผู้จอง: <strong>{booking.customer_name}</strong></span>
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
          {/* Room Selection (if multiple) or Room Bar */}
          {roomItems.length > 1 ? (
            <div>
              <label className="rx-section-label">เลือกห้องที่ต้องการต่อเวลา</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {roomItems.map(it => (
                  <button
                    key={it.id}
                    type="button"
                    className={`rx-duration-chip ${selectedItemId === it.id ? 'active' : ''}`}
                    onClick={() => setSelectedItemId(it.id)}
                    style={{ flex: 1, minWidth: '120px' }}
                  >
                    <span>{it.room_name || `ห้อง #${it.room_id}`}</span>
                    <span className="rx-duration-sub">{formatTimeOnly(it.start_time)} - {formatTimeOnly(it.end_time)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
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
          {loadingPreview ? (
            <div className="rx-avail-status loading">
              <RotateCcw size={16} className="rx-spin" />
              <span>กำลังตรวจสอบคิวและการเว้นระยะเวลาทำความสะอาด (Cleaning Buffer 30 นาที)...</span>
            </div>
          ) : previewError ? (
            <div className="rx-avail-status conflict">
              <AlertCircle size={18} />
              <span>{previewError}</span>
            </div>
          ) : preview?.available ? (
            <div className="rx-avail-status available">
              <CheckCircle2 size={18} />
              <div>
                <div>ห้องว่าง สามารถต่อเวลาได้จนถึง <strong>{newEnd} น.</strong></div>
                <div style={{ fontSize: '0.74rem', opacity: 0.85, marginTop: '2px' }}>
                  ระบบเว้น Cleaning Buffer 30 นาทีอัตโนมัติก่อนคิวถัดไป (คิวถัดไปจองได้ตั้งแต่ {preview?.new_end_time ? addMinutesToLocalISO(preview.new_end_time, 30).split('T')[1]?.substring(0, 5) : '--:--'} น.)
                </div>
              </div>
            </div>
          ) : (
            <div className="rx-avail-status conflict">
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <div>
                <div><strong>ไม่สามารถต่อเวลาได้:</strong> {preview?.conflict?.message || 'ห้องไม่ว่างในช่วงเวลาดังกล่าว'}</div>
                {preview?.conflict?.is_cleaning_buffer && (
                  <div style={{ fontSize: '0.74rem', marginTop: '2px' }}>
                    ชนกับระยะเวลาทำความสะอาดห้อง 30 นาที ก่อนรายการจองถัดไปของ {preview?.conflict?.booking?.customer_name || 'ลูกค้าท่านอื่น'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quota Section (if eligible) */}
          {preview?.quota && preview.quota.contract_eligible && (
            <div className="rx-quota-box">
              <div className="rx-quota-info">
                <Sparkles size={18} style={{ color: '#059669', flexShrink: 0 }} />
                <div className="rx-quota-text">
                  ลูกค้ามีสิทธิ์โควต้าสัญญาคงเหลือ <strong>{preview.quota.remaining_quota} ชั่วโมง</strong>
                </div>
              </div>
              <label className="rx-quota-toggle">
                <input
                  type="checkbox"
                  checked={useQuota}
                  onChange={(e) => setUseQuota(e.target.checked)}
                />
                <span>หักโควต้า (-{Math.min(additionalHours, preview.quota.remaining_quota)} ชม.)</span>
              </label>
            </div>
          )}

          {/* Payment Method & Slip (if fee > 0) */}
          {netFee > 0 && (
            <div>
              <div className="rx-section-label">
                <span>วิธีชำระค่าบริการต่อเวลา (฿{netFee.toLocaleString()})</span>
              </div>
              <div className="rx-pay-methods-grid">
                <button
                  type="button"
                  className={`rx-pay-method-chip ${paymentMethod === 'cash' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('cash')}
                >
                  <Banknote size={14} />
                  <span>เงินสด</span>
                </button>
                <button
                  type="button"
                  className={`rx-pay-method-chip ${paymentMethod === 'promptpay' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('promptpay')}
                >
                  <QrCode size={14} />
                  <span>PromptPay</span>
                </button>
                <button
                  type="button"
                  className={`rx-pay-method-chip ${paymentMethod === 'transfer' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('transfer')}
                >
                  <CreditCard size={14} />
                  <span>โอนเงิน</span>
                </button>
                <button
                  type="button"
                  className={`rx-pay-method-chip ${paymentMethod === 'unpaid' ? 'active' : ''}`}
                  onClick={() => setPaymentMethod('unpaid')}
                  title="ชำระรวมตอนเช็คเอาท์"
                >
                  <Clock size={14} />
                  <span>ชำระภายหลัง</span>
                </button>
              </div>

              {/* Slip Attachment for Transfer / PromptPay */}
              {(paymentMethod === 'promptpay' || paymentMethod === 'transfer') && (
                <div style={{ marginTop: '12px' }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileChange(e.target.files[0]);
                      }
                    }}
                  />
                  {!slipPreviewUrl ? (
                    <div
                      className={`rx-slip-dropzone ${isDragging ? 'dragging' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                    >
                      <Upload size={22} style={{ margin: '0 auto 6px auto', color: '#2563eb' }} />
                      <div style={{ fontSize: '0.82rem', fontWeight: 650 }}>แนบสลิปการโอนเงิน (PNG, JPG, WEBP)</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่ (ไม่เกิน 10MB)
                      </div>
                    </div>
                  ) : (
                    <div className="rx-slip-preview-box">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <img src={slipPreviewUrl} alt="Slip Preview" className="rx-slip-preview-thumb" />
                        <div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>
                            {selectedSlipFile ? selectedSlipFile.name : 'สลิปการต่อเวลา'}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <ShieldCheck size={12} /> ตรวจสอบไฟล์ถูกต้อง
                          </div>
                        </div>
                      </div>
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
                          color: '#ef4444',
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
                {paymentMethod === 'unpaid' ? 'บันทึกเข้ายอดค้างชำระของรายการจอง' : 'ชำระทันที'}
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
            disabled={isSubmitting || loadingPreview || !preview || !preview.available}
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
