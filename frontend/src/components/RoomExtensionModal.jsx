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
  QrCode,
  Copy,
  Check,
  Trash2,
  Eye,
  RefreshCw
} from 'lucide-react';
import './RoomExtensionModal.css';
import { API_BASE } from '../apiConfig.js';
import { authManager } from '../authManager';

/**
 * Validates file signature (magic bytes) for uploaded payment slip files.
 * Explicitly rejects HEIC/HEIF files with clear user feedback.
 */
function validateSlipFileSignature(file) {
  return new Promise((resolve) => {
    if (!file) return resolve({ valid: false, error: 'ไม่พบไฟล์' });

    // Explicit HEIC/HEIF check by extension and mime type
    const fileName = (file.name || '').toLowerCase();
    const fileType = (file.type || '').toLowerCase();
    if (
      fileName.endsWith('.heic') ||
      fileName.endsWith('.heif') ||
      fileType.includes('heic') ||
      fileType.includes('heif')
    ) {
      return resolve({
        valid: false,
        error: 'ระบบไม่รองรับไฟล์รูปภาพรูปแบบ HEIC/HEIF กรุณาแปลงเป็น JPG หรือ PNG ก่อนแนบรูปภาพ'
      });
    }

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

      // Explicit check for HEIC/HEIF ISO container (ftypheic, ftypmif1, ftypmsf1)
      if (
        buffer.length >= 12 &&
        buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70
      ) {
        return resolve({
          valid: false,
          error: 'ระบบไม่รองรับไฟล์รูปภาพรูปแบบ HEIC/HEIF กรุณาแปลงเป็น JPG หรือ PNG ก่อนแนบรูปภาพ'
        });
      }

      return resolve({ valid: false, error: 'ชนิดไฟล์ไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ JPG, PNG หรือ WEBP เท่านั้น' });
    };
    reader.onerror = () => resolve({ valid: false, error: 'ไม่สามารถอ่านไฟล์ได้' });
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fallbackCopyTextToClipboard(text) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch (err) {
    console.error('Fallback clipboard copy failed:', err);
  }
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
  settings = null,
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

  // Payment settings state from system settings & API
  const [apiPaymentSettings, setApiPaymentSettings] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(''); // 'account' | 'promptpay' | ''
  const copyTimeoutRef = useRef(null);

  // Dynamic payment info strictly derived from settings / API (no hardcoded credentials)
  const paymentInfo = useMemo(() => {
    const s = settings || {};
    const api = apiPaymentSettings || {};

    const bankName = s.payment_bank_name || s.quotation_bank_name || api.bank_name || '';
    const bankAccount = s.payment_bank_account || s.quotation_bank_account_no || api.bank_account || '';
    const bankAccountName = s.payment_bank_account_name || s.quotation_bank_account_name || s.quotation_company_name || api.bank_account_name || '';
    const promptPayId = s.promptpay_id || api.promptpay_id || '';
    const qrImage = s.payment_qr_image || api.qr_image || '/bwork_payment_qr.png';

    return {
      bank_name: bankName,
      bank_account: bankAccount,
      bank_account_name: bankAccountName,
      promptpay_id: promptPayId,
      qr_image: qrImage
    };
  }, [settings, apiPaymentSettings]);

  // Slip Upload State
  const [selectedSlipFile, setSelectedSlipFile] = useState(null);
  const [slipBase64, setSlipBase64] = useState(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState(null);
  const [slipError, setSlipError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const fileInputRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Tracking refs to preserve slip across duration/preview changes but isolate across bookings/rooms
  const prevBookingIdRef = useRef(activeBookingId);
  const prevItemIdRef = useRef(selectedItemId);

  const activeDurationMinutes = isCustom ? (parseInt(customMinutes, 10) || 60) : selectedDuration;

  // Strict binding: loadedBooking is only valid if its ID exactly matches activeBookingId
  const isLoadedBookingValid = Boolean(
    loadedBooking &&
    activeBookingId &&
    (loadedBooking.id === activeBookingId || loadedBooking.booking_id === activeBookingId)
  );
  const currentBooking = isLoadedBookingValid ? loadedBooking : booking;

  // Body Scroll Locking: lock body scroll when modal is open and restore on close/unmount
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [isOpen]);

  // Load public payment settings on modal open
  useEffect(() => {
    if (!isOpen) return;
    let isSubscribed = true;
    const base = API_BASE ? API_BASE.replace(/\/+$/, '') : '';
    fetch(`${base}/api/public/settings/payment`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!isSubscribed || !data) return;
        setApiPaymentSettings(data);
      })
      .catch(() => {});
    return () => { isSubscribed = false; };
  }, [isOpen]);

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

      // Clean up slip when modal closes
      setSelectedSlipFile(null);
      setSlipBase64(null);
      if (slipPreviewUrl && slipPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(slipPreviewUrl);
      }
      setSlipPreviewUrl(null);
      setSlipError(null);
      setIsLightboxOpen(false);
    }
  }, [isOpen, activeBookingId]);

  // Reset slip when switching to a completely different booking
  useEffect(() => {
    if (prevBookingIdRef.current !== activeBookingId) {
      setSelectedSlipFile(null);
      setSlipBase64(null);
      if (slipPreviewUrl && slipPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(slipPreviewUrl);
      }
      setSlipPreviewUrl(null);
      setSlipError(null);
      prevBookingIdRef.current = activeBookingId;
    }
  }, [activeBookingId]);

  // Reset slip when changing room item in multi-room bookings
  useEffect(() => {
    if (prevItemIdRef.current !== null && selectedItemId !== null && prevItemIdRef.current !== selectedItemId) {
      setSelectedSlipFile(null);
      setSlipBase64(null);
      if (slipPreviewUrl && slipPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(slipPreviewUrl);
      }
      setSlipPreviewUrl(null);
      setSlipError(null);
    }
    prevItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

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

    // Reset duration and errors on room change, but do NOT wipe slip state unless booking changed
    setSelectedDuration(60);
    setIsCustom(false);
    setCustomMinutes('');
    setUseQuota(false);
    setPaymentMethod('cash');
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
      if (e.key === 'Escape') {
        if (isLightboxOpen) {
          setIsLightboxOpen(false);
        } else if (!isSubmitting) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, isLightboxOpen, onClose]);

  // Handle file selection
  const handleFileChange = async (file) => {
    if (!file) return;
    setSlipError(null);

    const validation = await validateSlipFileSignature(file);
    if (!validation.valid) {
      setSlipError(validation.error);
      setSelectedSlipFile(null);
      setSlipBase64(null);
      if (slipPreviewUrl && slipPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(slipPreviewUrl);
      }
      setSlipPreviewUrl(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setSlipBase64(e.target.result);
      if (slipPreviewUrl && slipPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(slipPreviewUrl);
      }
      setSlipPreviewUrl(URL.createObjectURL(file));
      setSelectedSlipFile(file);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveSlip = () => {
    setSelectedSlipFile(null);
    setSlipBase64(null);
    if (slipPreviewUrl && slipPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(slipPreviewUrl);
    }
    setSlipPreviewUrl(null);
    setSlipError(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleCopy = (text, type) => {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        fallbackCopyTextToClipboard(text);
      });
    } else {
      fallbackCopyTextToClipboard(text);
    }

    setCopyFeedback(type);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopyFeedback('');
    }, 2500);
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
            <X size={20} />
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
              <div className="rx-room-chips-grid">
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
                        borderColor: isSelected ? 'var(--primary-color, #2563eb)' : 'var(--border-color, #e2e8f0)',
                        backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                        fontWeight: isSelected ? 700 : 500
                      }}
                    >
                      <span className="rx-chip-title">{it.room_name || `ห้อง #${it.room_id}`}</span>
                      <span className="rx-duration-sub">{formatTimeOnly(it.start_time)} - {formatTimeOnly(it.end_time)}</span>
                    </button>
                  );
                })}
              </div>
              {!selectedItemId && (
                <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '6px', fontWeight: 600 }}>
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
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
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
                className="rx-btn-link"
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
              <div className="rx-custom-duration-row">
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="15"
                  max="480"
                  step="15"
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  onFocus={(e) => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  placeholder="ระบุจำนวนนาที (เช่น 45)"
                  className="rx-custom-minutes-input"
                />
                <span className="rx-custom-minutes-unit">นาที</span>
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
                <div style={{ fontSize: '0.8rem', color: '#166534', marginTop: '2px' }}>
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
                  <div style={{ fontSize: '0.8rem', color: '#991b1b', marginTop: '2px' }}>
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
              <label className="rx-quota-toggle">
                <input
                  type="checkbox"
                  checked={useQuota}
                  onChange={(e) => setUseQuota(e.target.checked)}
                />
                <span>ใช้โควต้า</span>
              </label>
            </div>
          )}

          {/* Payment Method Selector */}
          {isPreviewFresh && netFee > 0 && (
            <div className="rx-payment-section">
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

              {/* Payment Details Card for Transfer / PromptPay */}
              {(paymentMethod === 'promptpay' || paymentMethod === 'transfer') && (
                <div className="rx-payment-card">
                  <div className="rx-payment-card-header">
                    <div className="rx-payment-card-brand">
                      {paymentMethod === 'promptpay' ? (
                        <>
                          <div className="rx-payment-brand-badge promptpay">
                            <QrCode size={18} />
                          </div>
                          <div>
                            <div className="rx-payment-card-title">ชำระผ่าน พร้อมเพย์ (PromptPay)</div>
                            <div className="rx-payment-card-sub">สแกน QR ผ่าน Mobile Banking ได้ทุกธนาคาร</div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rx-payment-brand-badge transfer">
                            <CreditCard size={18} />
                          </div>
                          <div>
                            <div className="rx-payment-card-title">ชำระผ่าน การโอนเงินธนาคาร</div>
                            <div className="rx-payment-card-sub">{paymentInfo.bank_name}</div>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="rx-payment-amount-box">
                      <span className="rx-payment-amount-label">ยอดที่ต้องชำระ</span>
                      <span className="rx-payment-amount-value">฿{netFee.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="rx-payment-card-body">
                    {paymentMethod === 'promptpay' ? (
                      <div className="rx-promptpay-details">
                        <div className="rx-promptpay-qr-wrapper">
                          <img
                            src={paymentInfo.qr_image || '/bwork_payment_qr.png'}
                            alt="PromptPay QR Code"
                            className="rx-promptpay-qr-img"
                          />
                          <span className="rx-promptpay-qr-hint">สแกน QR เพื่อชำระเงิน</span>
                        </div>
                        <div className="rx-payment-info-fields">
                          <div className="rx-payment-info-row">
                            <span className="rx-payment-field-label">หมายเลขพร้อมเพย์:</span>
                            <div className="rx-payment-field-content">
                              <span className="rx-payment-field-value mono">{paymentInfo.promptpay_id}</span>
                              <button
                                type="button"
                                className={`rx-btn-copy ${copyFeedback === 'promptpay' ? 'copied' : ''}`}
                                onClick={() => handleCopy(paymentInfo.promptpay_id, 'promptpay')}
                                aria-label="คัดลอกหมายเลขพร้อมเพย์"
                              >
                                {copyFeedback === 'promptpay' ? (
                                  <>
                                    <Check size={14} />
                                    <span>คัดลอกแล้ว!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={14} />
                                    <span>คัดลอก</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="rx-payment-info-row">
                            <span className="rx-payment-field-label">ชื่อบัญชี:</span>
                            <span className="rx-payment-field-value bold">{paymentInfo.bank_account_name}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rx-transfer-details">
                        <div className="rx-payment-info-fields">
                          <div className="rx-payment-info-row">
                            <span className="rx-payment-field-label">ธนาคาร:</span>
                            <span className="rx-payment-field-value bold">{paymentInfo.bank_name}</span>
                          </div>
                          <div className="rx-payment-info-row">
                            <span className="rx-payment-field-label">เลขที่บัญชี:</span>
                            <div className="rx-payment-field-content">
                              <span className="rx-payment-field-value mono bold">{paymentInfo.bank_account}</span>
                              <button
                                type="button"
                                className={`rx-btn-copy ${copyFeedback === 'account' ? 'copied' : ''}`}
                                onClick={() => handleCopy(paymentInfo.bank_account, 'account')}
                                aria-label="คัดลอกเลขที่บัญชี"
                              >
                                {copyFeedback === 'account' ? (
                                  <>
                                    <Check size={14} />
                                    <span>คัดลอกเลขบัญชีแล้ว!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={14} />
                                    <span>คัดลอกเลขบัญชี</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="rx-payment-info-row">
                            <span className="rx-payment-field-label">ชื่อบัญชี:</span>
                            <span className="rx-payment-field-value bold">{paymentInfo.bank_account_name}</span>
                          </div>
                        </div>

                        <div className="rx-transfer-qr-mini">
                          <img
                            src={paymentInfo.qr_image || '/bwork_payment_qr.png'}
                            alt="PromptPay QR Mini"
                            className="rx-qr-mini-img"
                          />
                          <span className="rx-qr-mini-text">หรือสแกน QR PromptPay</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Slip Upload for PromptPay / Transfer */}
              {(paymentMethod === 'promptpay' || paymentMethod === 'transfer') && (
                <div className="rx-slip-section">
                  <div className="rx-section-label">
                    <span>แนบหลักฐานสลิปการชำระเงิน</span>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                      (ไม่บังคับ แนะนำให้แนบเพื่อตรวจสอบ)
                    </span>
                  </div>

                  {/* Hidden Device File Picker: Gallery & Camera without forcing capture */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,.jpg,.jpeg,.png,.webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileChange(e.target.files[0]);
                      }
                      e.target.value = '';
                    }}
                  />

                  {!selectedSlipFile ? (
                    <div
                      className={`rx-slip-dropzone-prominent ${isDragging ? 'dragging' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                    >
                      <div className="rx-slip-dropzone-icon-box">
                        <Upload size={28} />
                      </div>
                      <div className="rx-slip-dropzone-main">
                        <span className="rx-slip-dropzone-heading">ลากไฟล์สลิปมาวางที่นี่ หรือ</span>
                        <button
                          type="button"
                          className="rx-btn-select-slip"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                        >
                          <ImageIcon size={16} />
                          <span>เลือกรูปสลิป</span>
                        </button>
                      </div>
                      <div className="rx-slip-dropzone-formats">
                        รองรับรูปภาพ JPG, PNG, WEBP (ขนาดไม่เกิน 10MB)
                      </div>
                    </div>
                  ) : (
                    <div className="rx-slip-attached-card">
                      <div
                        className="rx-slip-thumbnail-box"
                        onClick={() => setIsLightboxOpen(true)}
                        title="คลิกเพื่อดูรูปขยาย"
                        role="button"
                        tabIndex={0}
                      >
                        <img src={slipPreviewUrl} alt="Slip Thumbnail" className="rx-slip-thumbnail-img" />
                        <div className="rx-slip-zoom-overlay">
                          <Eye size={16} />
                        </div>
                      </div>

                      <div className="rx-slip-attached-info">
                        <div className="rx-slip-attached-name" title={selectedSlipFile.name}>
                          {selectedSlipFile.name}
                        </div>
                        <div className="rx-slip-attached-meta">
                          <span className="rx-slip-attached-size">{formatFileSize(selectedSlipFile.size)}</span>
                          <span className="rx-slip-badge-success">
                            <CheckCircle2 size={12} />
                            <span>แนบสลิปแล้ว</span>
                          </span>
                        </div>
                      </div>

                      <div className="rx-slip-attached-actions">
                        <button
                          type="button"
                          className="rx-btn-slip-action view"
                          onClick={() => setIsLightboxOpen(true)}
                          title="ดูรูปขยาย"
                        >
                          <Eye size={15} />
                          <span className="rx-action-text">ดูรูป</span>
                        </button>
                        <button
                          type="button"
                          className="rx-btn-slip-action change"
                          onClick={() => fileInputRef.current?.click()}
                          title="เปลี่ยนรูปสลิป"
                        >
                          <RefreshCw size={15} />
                          <span className="rx-action-text">เปลี่ยนรูป</span>
                        </button>
                        <button
                          type="button"
                          className="rx-btn-slip-action remove"
                          onClick={handleRemoveSlip}
                          title="นำออก"
                        >
                          <Trash2 size={15} />
                          <span className="rx-action-text">นำออก</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* File validation / HEIC error message */}
                  {slipError && (
                    <div className="rx-slip-error-banner">
                      <AlertCircle size={16} className="rx-slip-error-icon" />
                      <span className="rx-slip-error-text">{slipError}</span>
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
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
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
                <RotateCcw size={16} className="rx-spin" />
                <span>กำลังบันทึก...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={17} />
                <span>ยืนยันต่อเวลาห้อง</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Lightbox / Fullscreen Image Preview */}
      {isLightboxOpen && slipPreviewUrl && (
        <div
          className="rx-lightbox-overlay"
          onClick={() => setIsLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="รูปภาพสลิปขนาดเต็ม"
        >
          <div className="rx-lightbox-container" onClick={(e) => e.stopPropagation()}>
            <div className="rx-lightbox-header">
              <div className="rx-lightbox-title-box">
                <ImageIcon size={18} />
                <span className="rx-lightbox-filename">{selectedSlipFile?.name || 'สลิปการโอนเงิน'}</span>
              </div>
              <button
                type="button"
                className="rx-lightbox-close-btn"
                onClick={() => setIsLightboxOpen(false)}
                aria-label="ปิดพรีวิวรูปภาพ"
              >
                <X size={20} />
              </button>
            </div>
            <div className="rx-lightbox-body">
              <img
                src={slipPreviewUrl}
                alt="รูปสลิปขนาดเต็ม"
                className="rx-lightbox-image"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
