import jsQR from 'jsqr';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  CheckCircle2, Copy, Upload, Check,
  ShieldCheck, AlertCircle, Download, CreditCard, QrCode, Clock, Calendar,
  BookOpen, X, ZoomIn, ZoomOut, RotateCcw
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';
import { calcPaymentTimeLeft } from '../utils/paymentCountdown';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../utils/calendarUtils';
import { getBookingRoomGuidelines } from '../utils/roomGuidelines';

/**
 * Helper to determine room guidelines flyer and summary points.
 * Single Source of Truth from shared policy.
 */
export function getRoomGuidelines(booking) {
  const g = getBookingRoomGuidelines(booking);
  if (!g || !g.required) return null;
  return {
    ...g,
    src: g.local_image_src || g.image_url
  };
}

export default function ConfirmPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const bookingId = query.get('id');
  const queryCode = query.get('code');

  // Staging / Localhost-only visual preview mode (?preview=krungsri) — NEVER active on Production
  const isStagingOrLocalHost = typeof window !== 'undefined' && (
    window.location.hostname.includes('staging') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
  const isKrungsriPreview = isStagingOrLocalHost && query.get('preview') === 'krungsri';

  const [booking, setBooking] = useState(() => {
    if (isKrungsriPreview) {
      const now = new Date();
      return {
        id: 'preview',
        booking_id: 'preview',
        booking_code: 'BK-PREVIEW-001',
        receipt_number: 'BK-PREVIEW-001',
        room_name: 'Mars (301)',
        date: '2026-11-27',
        start_time: '10:00',
        end_time: '12:00',
        total_amount: 700,
        payment_status: 'pending',
        payment_window_minutes: 15,
        created_at: now.toISOString(),
        paymentDeadline: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
        guidelines_enforced: false,
        guidelines_required: false
      };
    }
    try {
      if (location.state?.booking) {
        const parsed = location.state.booking;
        if (!bookingId || String(parsed?.id) === String(bookingId) || String(parsed?.booking_id) === String(bookingId) || String(parsed?.bookingId) === String(bookingId)) {
          return parsed;
        }
      }
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (!bookingId || String(parsed?.id) === String(bookingId) || String(parsed?.booking_id) === String(bookingId) || String(parsed?.bookingId) === String(bookingId)) {
          return parsed;
        }
      }
      const pendingRaw = typeof window !== 'undefined' ? localStorage.getItem('bwork_pending_booking') : null;
      if (pendingRaw) {
        const parsed = JSON.parse(pendingRaw);
        if (!bookingId || String(parsed?.id) === String(bookingId) || String(parsed?.booking_id) === String(bookingId) || String(parsed?.bookingId) === String(bookingId)) {
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  });
  const [loadingBooking, setLoadingBooking] = useState(() => Boolean(bookingId) && !isKrungsriPreview);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verifyPhoneInput, setVerifyPhoneInput] = useState('');
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [bookingCodeMismatch, setBookingCodeMismatch] = useState(false);

  const [paymentSettings, setPaymentSettings] = useState(() => (
    isKrungsriPreview
      ? {
          promptpay_number: '',
          bank_name: 'ธนาคารกรุงศรีอยุธยา',
          account_number: '329-1-38429-0',
          account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
          qr_image: '/bwork_payment_qr.png'
        }
      : {
          promptpay_number: '',
          bank_name: '',
          account_number: '',
          account_name: '',
          qr_image: '/bwork_payment_qr.png'
        }
  ));
  const [paymentSettingsLoaded, setPaymentSettingsLoaded] = useState(() => isKrungsriPreview);

  const [slipFile, setSlipFile] = useState(null);
  const [slipPreview, setSlipPreview] = useState(null);
  const [slipQrData, setSlipQrData] = useState(null);
  const [qrScanning, setQrScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadResultData, setUploadResultData] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [error, setError] = useState('');
  const [paymentWindowMinutes, setPaymentWindowMinutes] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.payment_window_minutes) return parseInt(parsed.payment_window_minutes, 10) || 15;
    } catch (e) {}
    return 15;
  });
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) {
        const win = parsed.payment_window_minutes || 15;
        const { remainingSeconds } = calcPaymentTimeLeft(parsed, win, Date.now());
        return remainingSeconds;
      }
    } catch (e) {}
    return 15 * 60;
  });
  const [showGuidelinesModal, setShowGuidelinesModal] = useState(false);
  const [guidelinesZoom, setGuidelinesZoom] = useState(1);
  const activeBookingIdRef = useRef(bookingId);

  const [guidelinesAcknowledged, setGuidelinesAcknowledged] = useState(() => {
    try {
      if (location.state?.booking) {
        const b = location.state.booking;
        if (String(b.id) === String(bookingId) || String(b.booking_id) === String(bookingId) || String(b.receipt_number) === String(bookingId)) {
          if (b.guidelines_acknowledged || b.guidelines_acknowledged_at) return true;
        }
      }
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && (String(parsed.id) === String(bookingId) || String(parsed.booking_id) === String(bookingId) || String(parsed.receipt_number) === String(bookingId))) {
        if (parsed.guidelines_acknowledged || parsed.guidelines_acknowledged_at) return true;
      }
    } catch (e) {}
    return false;
  });
  const [guidelinesCheckboxTicked, setGuidelinesCheckboxTicked] = useState(false);
  const [isAcknowledgingGuidelines, setIsAcknowledgingGuidelines] = useState(false);
  const [guidelinesAcknowledgeError, setGuidelinesAcknowledgeError] = useState(null);

  // When switching bookings: reset previous state immediately and discard stale in-flight results
  useEffect(() => {
    activeBookingIdRef.current = bookingId;
    setGuidelinesAcknowledged(false);
    setGuidelinesCheckboxTicked(false);
    setGuidelinesAcknowledgeError(null);
  }, [bookingId]);

  // Lock body scroll and listen for Escape key when guidelines modal is open
  useEffect(() => {
    if (!showGuidelinesModal) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowGuidelinesModal(false);
    };
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = origOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showGuidelinesModal]);

  const [isExpired, setIsExpired] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) {
        if (parsed.payment_status === 'cancelled') return true;
        const win = parsed.payment_window_minutes || 15;
        const { isExpired: exp } = calcPaymentTimeLeft(parsed, win, Date.now());
        return exp;
      }
    } catch (e) {}
    return false;
  });

  // Determine standard readable booking code
  const displayBookingCode = queryCode || booking?.booking_code || booking?.receipt_number || (bookingId && bookingId !== 'undefined' ? `BK-${String(bookingId).padStart(6, '0')}` : '-');

  // Check if booking slip is in rejected status
  const isRejected = Boolean(booking?.payment_status === 'rejected' || booking?.slip_verify_status === 'rejected');

  // Sync guidelines acknowledgement status whenever fresh booking data arrives
  useEffect(() => {
    if (!booking) return;
    if (booking.guidelines_acknowledged === false) {
      // If server explicitly reports unacknowledged, immediately lock!
      setGuidelinesAcknowledged(false);
    } else if (booking.guidelines_acknowledged || booking.guidelines_acknowledged_at) {
      setGuidelinesAcknowledged(true);
    }
  }, [booking?.guidelines_acknowledged, booking?.guidelines_acknowledged_at]);

  // Handler to acknowledge room guidelines via API
  const handleAcknowledgeRules = async () => {
    if (!guidelinesCheckboxTicked || isAcknowledgingGuidelines) return;
    setIsAcknowledgingGuidelines(true);
    setGuidelinesAcknowledgeError(null);

    try {
      const rawAccessToken = query.get('access_token') || booking?.qr_token || '';
      const rawContact = query.get('contact') || booking?.contact || '';
      let idToken = '';
      if (typeof window !== 'undefined' && window.liff && window.liff.isLoggedIn()) {
        try { idToken = window.liff.getIDToken() || ''; } catch (e) {}
      }
      const headers = { 'Content-Type': 'application/json' };
      if (rawAccessToken) headers['X-Booking-Token'] = rawAccessToken;
      if (rawContact) headers['X-Booking-Contact'] = rawContact;
      if (idToken) headers['X-Line-ID-Token'] = idToken;

      const targetId = bookingId || booking?.id;
      const currentGuidelines = getRoomGuidelines(booking);

      const res = await fetch(`${API_BASE}/api/public/bookings/${targetId}/acknowledge-rules`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rule_set: currentGuidelines?.rule_set,
          rule_version: currentGuidelines?.rule_version,
          access_token: rawAccessToken || undefined,
          contact: rawContact || undefined,
          line_id_token: idToken || undefined
        })
      });

      const data = await res.json();

      // Discard stale in-flight response if user switched bookings while request was pending
      if (String(activeBookingIdRef.current) !== String(targetId)) {
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถบันทึกการรับทราบข้อปฏิบัติได้');
      }

      setGuidelinesAcknowledged(true);
      setBooking(prev => prev ? {
        ...prev,
        guidelines_acknowledged: true,
        guidelines_acknowledged_at: data.acknowledged_at || new Date().toISOString(),
        guidelines_rule_set: data.rule_set,
        guidelines_rule_version: data.rule_version
      } : prev);

      try {
        const raw = sessionStorage.getItem('completed_booking_result');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (String(parsed.id) === String(targetId) || String(parsed.booking_id) === String(targetId)) {
            parsed.guidelines_acknowledged = true;
            parsed.guidelines_acknowledged_at = data.acknowledged_at || new Date().toISOString();
            sessionStorage.setItem('completed_booking_result', JSON.stringify(parsed));
          }
        }
      } catch (e) {}
    } catch (err) {
      const targetId = bookingId || booking?.id;
      // Discard error if user has already switched to another booking
      if (String(activeBookingIdRef.current) !== String(targetId)) {
        return;
      }
      console.error('Error acknowledging room guidelines:', err);
      setGuidelinesAcknowledgeError(err.message || 'เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsAcknowledgingGuidelines(false);
    }
  };

  // Dynamic Countdown Timer based on paymentDeadline as Source of Truth
  useEffect(() => {
    if (!booking || uploadSuccess || booking.payment_status === 'paid' || isDeposit) return;

    if (booking.payment_status === 'cancelled') {
      setIsExpired(true);
      setTimeLeftSeconds(0);
      try {
        localStorage.removeItem('bwork_pending_booking');
      } catch (e) {}
      return;
    }

    const updateTimer = () => {
      const { remainingSeconds, isExpired: expired } = calcPaymentTimeLeft(
        booking,
        paymentWindowMinutes,
        Date.now()
      );

      setTimeLeftSeconds(remainingSeconds);

      if (expired) {
        setIsExpired(true);
        try {
          localStorage.removeItem('bwork_pending_booking');
        } catch (e) {}
        return false;
      }
      return true;
    };

    const hasTime = updateTimer();
    if (!hasTime) return;

    const interval = setInterval(() => {
      const active = updateTimer();
      if (!active) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [booking, uploadSuccess, paymentWindowMinutes, isRejected]);

  // Fetch fresh booking info from backend
  const fetchFreshBooking = useCallback(async (overrideContact = null) => {
    if (!bookingId || bookingId === 'undefined') {
      setLoadingBooking(false);
      return null;
    }

    let storedBooking = null;
    if (location.state?.booking) {
      const parsed = location.state.booking;
      if (String(parsed?.id) === String(bookingId) || String(parsed?.booking_id) === String(bookingId) || String(parsed?.bookingId) === String(bookingId)) {
        storedBooking = parsed;
      }
    }
    if (!storedBooking) {
      try {
        const raw = sessionStorage.getItem('completed_booking_result');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (String(parsed?.id) === String(bookingId) || String(parsed?.booking_id) === String(bookingId) || String(parsed?.bookingId) === String(bookingId)) {
            storedBooking = parsed;
          }
        }
      } catch (e) {}
    }

    let pendingBooking = null;
    try {
      const pendingRaw = localStorage.getItem('bwork_pending_booking');
      if (pendingRaw) {
        const parsed = JSON.parse(pendingRaw);
        if (String(parsed?.id) === String(bookingId) || String(parsed?.booking_id) === String(bookingId) || String(parsed?.bookingId) === String(bookingId)) {
          pendingBooking = parsed;
        }
      }
    } catch (e) {}

    let statusAccess = null;
    try {
      const statusRaw = sessionStorage.getItem(`bwork_booking_access_${bookingId}`);
      if (statusRaw) statusAccess = JSON.parse(statusRaw);
    } catch (e) {}

    const accessToken = storedBooking?.access_token || storedBooking?.accessToken || pendingBooking?.accessToken || statusAccess?.accessToken;
    const accessContact = overrideContact || statusAccess?.contact || storedBooking?.customer_contact || storedBooking?.contact || pendingBooking?.contact;

    const accessHeaders = {
      ...(accessToken ? { 'X-Booking-Token': accessToken } : {}),
      ...(accessContact ? { 'X-Booking-Contact': accessContact } : {})
    };

    try {
      const res = await fetch(`${API_BASE}/api/public/bookings/${bookingId}`, { headers: accessHeaders });

      if (res.status === 403 || res.status === 401) {
        setNeedsVerification(true);
        setLoadingBooking(false);
        return null;
      }

      const data = await res.json();
      if (res.ok && data && !data.error) {
        // Discard stale responses from prior booking if user switched
        if (activeBookingIdRef.current !== bookingId && String(activeBookingIdRef.current) !== String(bookingId)) {
          return null;
        }

        // Canonical booking code verification
        if (queryCode) {
          const validCodes = [
            data.receipt_number,
            data.booking_code,
            data.bookingCode,
            data.id ? `BK-${String(data.id).padStart(6, '0')}` : null
          ].filter(Boolean).map(c => String(c).trim().toUpperCase());

          if (!validCodes.includes(String(queryCode).trim().toUpperCase())) {
            setBookingCodeMismatch(true);
            setBooking(null);
            setLoadingBooking(false);
            return null;
          }
        }

        setNeedsVerification(false);
        setBookingCodeMismatch(false);
        setVerificationError('');

        if (accessContact) {
          try {
            sessionStorage.setItem(`bwork_booking_access_${bookingId}`, JSON.stringify({
              contact: accessContact,
              accessToken: accessToken || data.access_token || undefined
            }));
          } catch (e) {}
        }

        const winMins = data.payment_window_minutes ? parseInt(data.payment_window_minutes, 10) || 15 : 15;
        setPaymentWindowMinutes(winMins);

        const { remainingSeconds, isExpired: exp } = calcPaymentTimeLeft(data, winMins, Date.now());
        if (data.payment_status === 'cancelled') {
          setIsExpired(true);
          setTimeLeftSeconds(0);
          try {
            localStorage.removeItem('bwork_pending_booking');
          } catch (e) {}
        } else {
          setIsExpired(exp);
          setTimeLeftSeconds(remainingSeconds);
        }

        setBooking(prev => ({
          ...prev,
          ...data,
          paymentDeadline: data.paymentDeadline || prev?.paymentDeadline,
          payment_window_minutes: winMins,
          room_name: data.room?.name || prev?.room_name,
          booking_code: data.receipt_number || data.bookingCode || prev?.booking_code,
          total_amount: data.total_amount || prev?.total_amount,
          customer_contact: data.customer_contact || data.contact || accessContact || prev?.customer_contact
        }));
        setLoadingBooking(false);
        return data;
      } else if (data?.error && (res.status === 403 || data.error.includes('สิทธิ์เข้าถึง') || data.error.includes('เบอร์โทรศัพท์'))) {
        setNeedsVerification(true);
        setLoadingBooking(false);
        return null;
      } else {
        setError(data?.error || 'ไม่สามารถโหลดข้อมูลการจองได้');
        setLoadingBooking(false);
        return null;
      }
    } catch (e) {
      setLoadingBooking(false);
    }
    return null;
  }, [bookingId, queryCode]);

  // Handle phone verification submit for cold visitors
  const handlePhoneVerifySubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanInput = verifyPhoneInput.replace(/\D/g, '');
    if (cleanInput.length < 9 || cleanInput.length > 15) {
      setVerificationError('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9-10 หลัก)');
      return;
    }

    setVerifyingPhone(true);
    setVerificationError('');
    try {
      const result = await fetchFreshBooking(cleanInput);
      if (!result) {
        setVerificationError('ไม่สามารถยืนยันข้อมูลการจองได้ กรุณาตรวจสอบข้อมูลอีกครั้ง');
      }
    } catch (err) {
      setVerificationError('เกิดข้อผิดพลาดในการตรวจสอบ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setVerifyingPhone(false);
    }
  };

  // When timer expires, fetch status immediately, and bounded short retry (every 5s, max 4 times) to confirm cancellation
  useEffect(() => {
    if (!isExpired || !bookingId || booking?.payment_status === 'cancelled' || booking?.payment_status === 'paid' || uploadSuccess) {
      return;
    }

    fetchFreshBooking();

    let retryCount = 0;
    const pollInterval = setInterval(async () => {
      retryCount++;
      const data = await fetchFreshBooking();
      if (data?.payment_status === 'cancelled' || data?.payment_status === 'paid' || retryCount >= 4) {
        clearInterval(pollInterval);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [isExpired, bookingId, booking?.payment_status, uploadSuccess, fetchFreshBooking]);

  // Load completed booking info on mount
  useEffect(() => {
    if (isKrungsriPreview) return;

    // Auto-fetch fresh booking info from backend if id is provided
    fetchFreshBooking();

    // Fetch live payment settings from backend
    fetch(`${API_BASE}/api/public/settings/payment`)
      .then(res => res.json())
      .then(data => {
        if (data) {
          if (data.payment_window_minutes) {
            setPaymentWindowMinutes(parseInt(data.payment_window_minutes, 10) || 15);
          }
          setPaymentSettings(prev => ({
            ...prev,
            bank_name: data.payment_bank_name || data.bank_name || prev.bank_name,
            account_number: data.payment_bank_account || data.bank_account || data.account_number || prev.account_number,
            account_name: data.payment_bank_account_name || data.bank_account_name || data.account_name || prev.account_name,
            promptpay_number: data.promptpay_id || prev.promptpay_number,
            qr_image: data.qr_image || '/bwork_payment_qr.png'
          }));
        }
      })
      .catch(() => {})
      .finally(() => {
        setPaymentSettingsLoaded(true);
      });
  }, [bookingId]);

  const rawBankName = (paymentSettings.bank_name || '').trim();
  const isKrungsriBank = /กรุงศรี|krungsri|\bbay\b/i.test(rawBankName);
  const displayedBankName = isKrungsriBank ? 'ธนาคารกรุงศรีอยุธยา' : rawBankName;
  const displayedAccountNumber = (paymentSettings.account_number || '').trim();

  // Copy Account Number with Async Clipboard Verification & Fallback
  const handleCopyAccount = async () => {
    setCopyError('');
    setCopied(false);
    const cleanNum = displayedAccountNumber.replace(/\D/g, '');
    if (!cleanNum) {
      setCopyError('ไม่พบเลขบัญชีสำหรับคัดลอก');
      return;
    }
    let success = false;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(cleanNum);
        success = true;
      }
    } catch (_) {
      success = false;
    }

    if (!success && typeof document !== 'undefined') {
      let textarea = null;
      try {
        textarea = document.createElement('textarea');
        textarea.value = cleanNum;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, cleanNum.length);
        success = document.execCommand('copy');
      } catch (_) {
        success = false;
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
      }
    }

    if (success) {
      setCopied(true);
      setToastMessage('คัดลอกเลขบัญชีเรียบร้อยแล้ว!');
      setTimeout(() => {
        setCopied(false);
        setToastMessage('');
      }, 3000);
    } else {
      setCopyError('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาแตะค้างที่เลขบัญชีเพื่อคัดลอกด้วยตนเอง');
      setToastMessage('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาคัดลอกเลขบัญชีด้วยตนเอง');
      setTimeout(() => {
        setToastMessage('');
      }, 3500);
    }
  };

  // Scan Mini QR Code & Compress Slip Image
  const processSlipFile = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let detectedQR = null;

          // 1. Scan for QR code on full resolution canvas
          try {
            const scanCanvas = document.createElement('canvas');
            scanCanvas.width = img.width;
            scanCanvas.height = img.height;
            const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
            scanCtx.drawImage(img, 0, 0);
            const scanImgData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
            const code = jsQR(scanImgData.data, scanCanvas.width, scanCanvas.height, {
              inversionAttempts: 'attemptBoth'
            });
            if (code && code.data) {
              detectedQR = code.data;
            }
          } catch (qrErr) {
            console.warn('[Slip QR Scanner] Scan error:', qrErr);
          }

          // 2. Compress image for lightweight storage (~80KB)
          let width = img.width;
          let height = img.height;
          const maxWidth = 900;
          const maxHeight = 900;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.75);

          resolve({
            dataUrl: compressedDataUrl,
            qrData: detectedQR
          });
        };
        img.onerror = () => resolve({ dataUrl: e.target.result, qrData: null });
        img.src = e.target.result;
      };
      reader.onerror = () => resolve({ dataUrl: null, qrData: null });
      reader.readAsDataURL(file);
    });
  };

  // Handle File Selection with Auto QR Detection & Compression
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      setSlipFile(file);
      setQrScanning(true);
      setError('');
      try {
        const result = await processSlipFile(file);
        setSlipPreview(result.dataUrl);
        setSlipQrData(result.qrData);
      } catch (err) {
        const reader = new FileReader();
        reader.onload = () => setSlipPreview(reader.result);
        reader.readAsDataURL(file);
      } finally {
        setQrScanning(false);
      }
    }
  };

  // Handle Slip Upload
  const handleUploadSlip = async (e) => {
    e.preventDefault();
    if (!slipFile && !slipPreview) {
      setError('กรุณาเลือกไฟล์รูปภาพสลิปก่อนกดยืนยัน');
      return;
    }

    const targetId = bookingId && bookingId !== 'undefined' ? bookingId : (booking?.booking_id || booking?.id);
    if (!targetId) {
      setError('ไม่พบรหัสการจองสำหรับการแนบสลิป');
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Ensure image is compressed before upload
      let finalPayload = slipPreview;
      if (slipFile && (!finalPayload || finalPayload.length > 500000)) {
        finalPayload = await compressImage(slipFile, 800, 800, 0.70);
      }

      let statusAccess = null;
      try {
        const statusRaw = sessionStorage.getItem(`bwork_booking_access_${targetId}`);
        if (statusRaw) statusAccess = JSON.parse(statusRaw);
      } catch (e) {}

      const currentContact = booking?.customer_contact || booking?.contact || statusAccess?.contact;
      const currentToken = booking?.access_token || statusAccess?.accessToken;

      // Send Base64 payload + QR data (Enables 100% Automated Instant Verification)
      let idToken = '';
      if (typeof window !== 'undefined' && window.liff && window.liff.isLoggedIn()) {
        try { idToken = window.liff.getIDToken() || ''; } catch (e) {}
      }

      const res = await fetch(`${API_BASE}/api/public/bookings/${targetId}/upload-slip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(currentToken ? { 'X-Booking-Token': currentToken } : {}),
          ...(currentContact ? { 'X-Booking-Contact': currentContact } : {}),
          ...(idToken ? { 'X-Line-ID-Token': idToken } : {})
        },
        body: JSON.stringify({
          slip_image: finalPayload,
          qr_data: slipQrData,
          contact: currentContact,
          access_token: currentToken,
          line_id_token: idToken || undefined
        })
      });

      // OCR may take a while and the server can occasionally return an empty or
      // non-JSON response (for example while the local dev server is restarting).
      // Do not expose the browser's JSON parsing error to the customer.
      const responseText = await res.text();
      let data = {};
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch (_) {
          data = {};
        }
      }

      if (res.ok && data.success) {
        try {
          localStorage.removeItem('bwork_pending_booking');
        } catch (e) {}
        setUploadResultData({ ...data, is_resubmission: isRejected });
        setBooking(prev => ({
          ...prev,
          payment_status: 'reviewing',
          slip_verify_status: 'pending_manual',
          rejection_reason: null
        }));
        setUploadSuccess(true);
      } else {
        setError(data.error || (
          res.status >= 500
            ? 'ระบบตรวจสอบสลิปขัดข้องชั่วคราว กรุณาลองส่งสลิปอีกครั้ง'
            : 'ไม่สามารถส่งหลักฐานการชำระเงินได้ กรุณาลองใหม่อีกครั้ง'
        ));
      }
    } catch (err) {
      setError('ไม่สามารถติดต่อระบบส่งหลักฐานได้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
    } finally {
      setUploading(false);
    }
  };

  const totalAmt = booking ? parseFloat(booking.total_amount || 0) : 0;
  const isDeposit = Boolean((booking?.payment_status === 'deposit' || Number(booking?.paid_amount || 0) > 0) && Number(booking?.balance_amount || 0) > 0);
  const payableAmt = isDeposit ? parseFloat(booking.balance_amount || 0) : totalAmt;
  const qrImageSrc = paymentSettings.qr_image || '/bwork_payment_qr.png';
  const roomGuidelines = getRoomGuidelines(booking);
  const isEnforced = booking?.guidelines_enforced !== undefined
    ? Boolean(booking.guidelines_enforced)
    : (booking?.guidelines_enforcement_enabled !== undefined
        ? Boolean(booking.guidelines_enforcement_enabled)
        : false);
  const isGuidelinesGated = Boolean(roomGuidelines && isEnforced && !guidelinesAcknowledged);

  const isPaidOrAutoApproved = Boolean(booking?.payment_status === 'paid');
  const bookingForCalendar = booking ? {
    ...booking,
    booking_code: displayBookingCode,
    room_name: booking?.room_name || booking?.room?.name,
    date: booking?.date || booking?.booking_date,
    start_time: booking?.start_time,
    end_time: booking?.end_time
  } : null;
  const googleCalendarUrl = isPaidOrAutoApproved ? generateGoogleCalendarUrl(bookingForCalendar) : null;

  return (
    <div className="main-content">
      <StepProgress currentStep={3} />

      {/* TOAST ALERT */}
      {toastMessage && (
        <div className="toast-container">
          <Check size={18} style={{ color: '#10b981' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {bookingCodeMismatch ? (
        /* BOOKING CODE MISMATCH FAIL-CLOSED VIEW */
        <div className="booking-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
            <AlertCircle size={36} />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 8px 0' }}>
            ข้อมูลรหัสการจองไม่ถูกต้อง
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '460px', margin: '0 auto 20px auto' }}>
            รหัสการจองในลิงก์ไม่ตรงกับข้อมูลในระบบ กรุณาตรวจสอบลิงก์อีกครั้ง หรือค้นหารายการจองผ่านเบอร์โทรศัพท์ที่หน้าสถานะ
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', maxWidth: '360px', margin: '0 auto' }}>
            <button type="button" onClick={() => navigate('/status')} className="btn-secondary" style={{ flex: 1 }}>
              ดูสถานะการจอง
            </button>
            <button type="button" onClick={() => navigate('/')} className="btn-primary" style={{ flex: 1 }}>
              กลับหน้าหลัก
            </button>
          </div>
        </div>
      ) : needsVerification && !booking ? (
        /* COLD-VISIT PHONE VERIFICATION FORM */
        <div className="booking-card" style={{ maxWidth: '440px', margin: '20px auto', padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.12)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
            <ShieldCheck size={32} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 8px 0' }}>
            ยืนยันเบอร์โทรศัพท์ที่ใช้จอง
          </h2>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '0 0 20px 0' }}>
            เพื่อความปลอดภัยและความเป็นส่วนตัว กรุณากรอกเบอร์โทรศัพท์ที่ใช้ในการจองเพื่อดำเนินการชำระเงินต่อ
            {displayBookingCode && displayBookingCode !== '-' ? ` (รหัส: ${displayBookingCode})` : ''}
          </p>
          <form onSubmit={handlePhoneVerifySubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="tel"
              className="form-input"
              placeholder="กรอกเบอร์โทรศัพท์ 10 หลัก (เช่น 0812345678)"
              value={verifyPhoneInput}
              onChange={e => setVerifyPhoneInput(e.target.value)}
              autoFocus
              style={{ textAlign: 'center', fontSize: '1.05rem', letterSpacing: '1px' }}
            />
            {verificationError && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--danger-light)',
                color: 'var(--danger)',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}>
                <AlertCircle size={15} />
                <span>{verificationError}</span>
              </div>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={verifyingPhone || !verifyPhoneInput.trim()}
              style={{ padding: '12px', fontWeight: 700 }}
            >
              {verifyingPhone ? 'กำลังตรวจสอบ...' : 'ยืนยันเพื่อชำระเงินต่อ'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/status')}
              className="btn-secondary"
              style={{ padding: '10px', fontSize: '0.84rem' }}
            >
              ค้นหาการจองทั้งหมดที่หน้าสถานะ
            </button>
          </form>
        </div>
      ) : loadingBooking && !booking ? (
        /* LOADING VIEW */
        <div className="booking-card" style={{ textAlign: 'center', padding: '48px 20px' }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted)' }}>
            กำลังโหลดข้อมูลการจอง...
          </div>
        </div>
      ) : uploadSuccess || booking?.payment_status === 'paid' ? (
        /* AFTER SUBMISSION SUCCESS VIEW */
        <div className="booking-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
          {isPaidOrAutoApproved ? (
            <>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                <CheckCircle2 size={36} />
              </div>

              <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 8px 0' }}>
                การจองห้องประชุมได้รับการยืนยันแล้ว
              </h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 16px auto' }}>
                รายการจองของท่านได้รับการชำระเงินและยืนยันเรียบร้อยแล้ว
              </p>

              {/* Reception Contact Box */}
              <div style={{
                maxWidth: '400px',
                margin: '0 auto 20px auto',
                backgroundColor: 'rgba(14, 165, 233, 0.08)',
                border: '1px solid rgba(14, 165, 233, 0.3)',
                borderRadius: '14px',
                padding: '16px',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>

                </div>
                <div style={{ fontSize: '0.82rem', color: '#0369a1' }}>
                  <strong>การรับรหัสผ่านเข้าห้องประชุม:</strong>
                  <div style={{ marginTop: '2px', color: 'var(--text-muted)' }}>
                    เมื่อถึงวันและเวลาเข้าใช้งาน กรุณาติดต่อที่ <strong>เคาน์เตอร์ประชาสัมพันธ์ (ชั้น L)</strong> เจ้าหน้าที่จะทำการส่งรหัส PIN สำหรับเปิดประตูให้ท่านครับ
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                <Clock size={36} />
              </div>

              <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 8px 0' }}>
                ส่งหลักฐานการชำระเงินเรียบร้อยแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบ
              </h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 16px auto' }}>
                ระบบได้รับหลักฐานการชำระเงินแล้ว เจ้าหน้าที่จะตรวจสอบยอดเงินและยืนยันการจองผ่าน POS โดยเร็วที่สุด
              </p>

              <div style={{
                maxWidth: '440px',
                margin: '0 auto 16px auto',
                backgroundColor: 'rgba(14, 165, 233, 0.08)',
                border: '1px solid rgba(14, 165, 233, 0.3)',
                borderRadius: '12px',
                padding: '12px 16px',
                textAlign: 'left',
                fontSize: '0.82rem',
                color: '#0369a1',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <strong>สถานะ: กำลังรอเจ้าหน้าที่ตรวจสอบ</strong>
                <span>{uploadResultData?.message || 'เจ้าหน้าที่จะตรวจสอบยอดเงินและยืนยันการจองให้ท่านโดยเร็วที่สุดครับ'}</span>
              </div>
            </>
          )}

          <div style={{
            maxWidth: '400px',
            margin: '0 auto 24px auto',
            backgroundColor: 'var(--bg-page)',
            border: '1px solid var(--border)',
            borderRadius: '14px',
            padding: '16px',
            textAlign: 'left',
            fontSize: '0.86rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>รหัสการจอง:</span>
              <strong style={{ color: 'var(--primary)', letterSpacing: '0.5px' }}>{displayBookingCode}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>ห้องประชุม:</span>
              <strong style={{ color: 'var(--text-main)' }}>{booking?.room_name}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>ช่วงเวลา:</span>
              <strong>{booking?.date ? booking.date.split('-').reverse().join('/') : '-'} ({booking?.start_time} - {booking?.end_time} น.)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>ยอดเงิน:</span>
              <strong style={{ color: '#10b981' }}>฿{Number(totalAmt).toLocaleString()}</strong>
            </div>
          </div>

          {/* CALENDAR INTEGRATION (Confirmed / Paid Only) */}
          {isPaidOrAutoApproved && googleCalendarUrl && (
            <div style={{
              maxWidth: '400px',
              margin: '0 auto 20px auto',
              backgroundColor: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: '14px',
              padding: '16px',
              textAlign: 'left',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b', fontSize: '0.88rem', fontWeight: 800 }}>
                  <Calendar size={18} style={{ color: 'var(--primary)' }} />
                  <span>เพิ่มการจองลงในปฏิทิน</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px', marginLeft: '26px' }}>
                  บันทึกวันและเวลาไว้ เพื่อไม่พลาดการใช้งานห้อง
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <a
                  href={googleCalendarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: '1 1 170px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    backgroundColor: '#ffffff',
                    color: '#1e40af',
                    border: '1.5px solid #bfdbfe',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    textDecoration: 'none',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Calendar size={15} />
                  <span>เพิ่มลง Google Calendar</span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    const res = downloadIcsFile(bookingForCalendar);
                    if (!res.success && res.error) {
                      setToastMessage(res.error);
                      setTimeout(() => setToastMessage(''), 4000);
                    }
                  }}
                  style={{
                    flex: '1 1 150px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    backgroundColor: '#f8fafc',
                    color: '#334155',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Download size={15} />
                  <span>ดาวน์โหลดปฏิทิน (.ics)</span>
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', maxWidth: '420px', margin: '0 auto', flexWrap: 'wrap' }}>
            {!isPaidOrAutoApproved && (
              <button
                type="button"
                onClick={() => {
                  setUploadSuccess(false);
                  setSlipFile(null);
                  setSlipPreview(null);
                }}
                className="btn-secondary"
                style={{ flex: '1 1 100%', marginBottom: '4px', borderColor: '#f59e0b', color: '#b45309', fontWeight: 700 }}
              >
                อัปโหลดสลิปใหม่อีกครั้ง
              </button>
            )}

            <button
              type="button"
              onClick={() => navigate(`/status?phone=${booking?.customer_contact || ''}`)}
              className="btn-secondary"
              style={{ flex: 1 }}
            >
              ดูสถานะการจอง
            </button>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-primary"
              style={{ flex: 1 }}
            >
              กลับหน้าหลัก
            </button>
          </div>
        </div>
      ) : (
        /* PAYMENT & SLIP UPLOAD VIEW */
        <div style={{ maxWidth: '520px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
          {isKrungsriPreview && (
            <div
              id="staging-krungsri-preview-banner"
              style={{
                backgroundColor: '#fffbeb',
                border: '1.5px solid #f59e0b',
                borderRadius: '14px',
                padding: '12px 14px',
                color: '#92400e',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertCircle size={18} style={{ color: '#d97706', flexShrink: 0 }} />
              <span>ตัวอย่างสำหรับตรวจหน้าตา (Staging Preview) — ข้อมูลจำลองสำหรับตรวจโลโก้และเลขบัญชีกรุงศรี ไม่ใช่รายการจองจริง</span>
            </div>
          )}
          {/* 1. TOP BOOKING CONTEXT SUMMARY */}
          <div style={{
            backgroundColor: '#ffffff',
            border: '1.5px solid var(--border)',
            borderRadius: '16px',
            padding: '14px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '50%', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <CheckCircle2 size={22} />
              </div>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--navy)' }}>
                  บันทึกการจองสำเร็จ! <span style={{ color: 'var(--primary)' }}>รหัส: {displayBookingCode}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {booking?.room_name} · {booking?.date ? booking.date.split('-').reverse().join('/') : '-'} ({booking?.start_time} - {booking?.end_time} น.)
                </div>
              </div>
            </div>
          </div>

          {/* REJECTED ALERT OR EXPIRED STATE */}
          {isRejected && isExpired ? (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1.5px solid #ef4444',
              borderRadius: '16px',
              padding: '16px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={28} color="#ef4444" />
              <div style={{ fontWeight: 900, fontSize: '1rem', color: '#dc2626' }}>
                {booking?.payment_status === 'cancelled'
                  ? 'รายการจองนี้ถูกยกเลิกแล้ว (เนื่องจากเกินกำหนดเวลาชำระเงิน)'
                  : `หมดเวลาชำระเงิน (${paymentWindowMinutes || 15} นาที)`}
              </div>
              {booking?.rejection_reason && (
                <div style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.05)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: '8px',
                  padding: '6px 14px',
                  fontSize: '0.84rem',
                  color: '#b91c1c',
                  fontWeight: 700
                }}>
                  สลิปเดิมไม่ผ่าน: {booking.rejection_reason}
                </div>
              )}
              <div style={{ fontSize: '0.82rem', color: '#64748b', maxWidth: '420px' }}>
                รายการจองหมดเวลาชำระเงินแล้ว ระบบไม่สามารถรับการแนบสลิปใหม่ได้ กรุณาทำรายการจองใหม่อีกครั้งครับ
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => navigate('/status')}
                  className="btn-secondary"
                  style={{ padding: '8px 18px', width: 'auto', fontSize: '0.86rem' }}
                >
                  ดูสถานะการจอง
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="btn-primary"
                  style={{ padding: '8px 20px', width: 'auto', fontSize: '0.86rem' }}
                >
                  ทำรายการจองใหม่
                </button>
              </div>
            </div>
          ) : isExpired ? (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1.5px solid #ef4444',
              borderRadius: '16px',
              padding: '16px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={28} color="#ef4444" />
              <div style={{ fontWeight: 900, fontSize: '1rem', color: '#dc2626' }}>
                {booking?.payment_status === 'cancelled'
                  ? 'รายการจองนี้ถูกยกเลิกแล้ว (เนื่องจากเกินกำหนดเวลาชำระเงิน)'
                  : `หมดเวลาชำระเงิน (${paymentWindowMinutes || 15} นาที)`}
              </div>
              <div style={{ fontSize: '0.82rem', color: '#64748b', maxWidth: '420px' }}>
                {booking?.payment_status === 'cancelled'
                  ? 'ระบบได้เปิดสิทธิ์การจองให้ผู้อื่นแล้ว หากต้องการใช้งาน กรุณาทำรายการจองใหม่อีกครั้งครับ'
                  : 'เกินกำหนดเวลาชำระเงินแล้ว ระบบกำลังดำเนินการตรวจสอบสถานะรายการจอง กรุณาทำรายการจองใหม่หากต้องการจองอีกครั้งครับ'}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => navigate('/status')}
                  className="btn-secondary"
                  style={{ padding: '8px 18px', width: 'auto', fontSize: '0.86rem' }}
                >
                  ดูสถานะการจอง
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="btn-primary"
                  style={{ padding: '8px 20px', width: 'auto', fontSize: '0.86rem' }}
                >
                  ทำรายการจองใหม่
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 2. HERO PAYABLE AMOUNT & COUNTDOWN (ยอดชำระเด่นที่สุด ตามด้วยเวลาที่เหลือ) */}
              <div style={{
                backgroundColor: '#ffffff',
                border: '1.5px solid var(--border)',
                borderRadius: '20px',
                padding: '24px 20px',
                textAlign: 'center',
                boxShadow: '0 4px 16px rgba(15, 118, 110, 0.08)'
              }}>
                <div style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {isDeposit ? 'ยอดคงเหลือที่ต้องชำระ' : 'ยอดชำระสุทธิ'}
                </div>
                <div style={{ fontSize: '2.4rem', fontWeight: 900, color: 'var(--primary)', lineHeight: 1.15, margin: '6px 0' }}>
                  ฿{Number(payableAmt).toLocaleString()}
                </div>
                {isDeposit && (
                  <div style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600, marginBottom: '6px' }}>
                    (ชำระมัดจำแล้ว ฿{Number(booking.paid_amount || 0).toLocaleString()} / ยอดรวม ฿{Number(totalAmt).toLocaleString()})
                  </div>
                )}

                {/* COUNTDOWN TIMER BADGE */}
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 16px',
                  borderRadius: '999px',
                  backgroundColor: timeLeftSeconds < 5 * 60 ? '#fee2e2' : 'var(--primary-light)',
                  color: timeLeftSeconds < 5 * 60 ? '#dc2626' : 'var(--primary)',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  marginTop: '8px'
                }}>
                  <Clock size={16} />
                  <span>กำหนดเวลาชำระเงิน:</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '1.05rem', letterSpacing: '0.5px' }}>
                    {`${Math.floor(timeLeftSeconds / 60).toString().padStart(2, '0')}:${(timeLeftSeconds % 60).toString().padStart(2, '0')}`} นาที
                  </span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  กรุณาชำระเงินและแนบสลิปก่อนหมดเวลา
                </div>
              </div>

              {/* REJECTION REASON BANNER (IF ACTIVE BUT RESUBMITTING) */}
              {isRejected && (
                <div style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.08)',
                  border: '1.5px solid #f59e0b',
                  borderRadius: '14px',
                  padding: '14px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={20} style={{ color: '#d97706', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#b45309' }}>
                      สลิปเดิมไม่ผ่านการอนุมัติ: {booking?.rejection_reason || 'ข้อมูลไม่ตรง'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#78350f', paddingLeft: '28px' }}>
                    กรุณาแนบรูปภาพสลิปที่ถูกต้องเพื่อดำเนินการต่อ
                  </div>
                </div>
              )}

              {/* ROOM GUIDELINES ACKNOWLEDGEMENT CARD (IF ENFORCED) */}
              {roomGuidelines && isEnforced && !guidelinesAcknowledged && (
                <div
                  id="guidelines-gate-card"
                  style={{
                    width: '100%',
                    padding: '18px 16px',
                    backgroundColor: '#ffffff',
                    border: '1.5px solid #bfdbfe',
                    borderRadius: '18px',
                    boxSizing: 'border-box'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <ShieldCheck size={20} color="var(--primary)" style={{ flexShrink: 0 }} />
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--navy)' }}>
                      {roomGuidelines.title}
                    </h3>
                  </div>

                  <div style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    marginBottom: '12px',
                    fontSize: '0.84rem',
                    lineHeight: 1.5,
                    color: '#334155'
                  }}>
                    <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {(roomGuidelines.summary_points || []).map((point, idx) => (
                        <li key={idx} style={{ paddingLeft: '2px' }}>{point}</li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    id="btn-view-full-guidelines"
                    onClick={() => {
                      setGuidelinesZoom(1);
                      setShowGuidelinesModal(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      backgroundColor: 'var(--primary-light)',
                      color: 'var(--primary)',
                      border: '1px solid rgba(15, 118, 110, 0.25)',
                      borderRadius: '10px',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      marginBottom: '12px'
                    }}
                  >
                    <BookOpen size={16} />
                    <span>อ่านข้อปฏิบัติฉบับเต็ม</span>
                  </button>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      id="checkbox-acknowledge-guidelines"
                      checked={guidelinesAcknowledged}
                      onChange={(e) => setGuidelinesAcknowledged(e.target.checked)}
                      style={{ marginTop: '3px', width: '18px', height: '18px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '0.82rem', color: '#1e293b', fontWeight: 600, lineHeight: 1.4 }}>
                      ข้าพเจ้ารับทราบและยินดีปฏิบัติตามข้อกำหนดการใช้งานห้องประชุม
                    </span>
                  </label>
                </div>
              )}

              {/* 3. QR PROMPTPAY SECTION */}
              {isGuidelinesGated ? (
                <div
                  id="gated-qr-placeholder"
                  style={{
                    padding: '28px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    backgroundColor: '#ffffff',
                    border: '1.5px dashed var(--border)',
                    borderRadius: '20px',
                    boxSizing: 'border-box'
                  }}
                >
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                    <QrCode size={24} color="#64748b" />
                  </div>
                  <div style={{ fontSize: '0.94rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '6px' }}>
                    QR Code สำหรับชำระเงินถูกล็อกไว้
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, maxWidth: '280px' }}>
                    กรุณาอ่านและกดยืนยันรับทราบข้อปฏิบัติด้านบน เพื่อแสดง QR Code สำหรับสแกนชำระเงิน
                  </div>
                </div>
              ) : (
                <div style={{
                  backgroundColor: '#ffffff',
                  border: '1.5px solid var(--border)',
                  borderRadius: '20px',
                  padding: '20px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.92rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '14px' }}>
                    <QrCode size={18} color="var(--primary)" />
                    <span>สแกนจ่ายผ่าน QR Code (B-WORK)</span>
                  </div>

                  {/* Official QR Code Standee Image (With Intact Margins) */}
                  <div style={{
                    backgroundColor: '#ffffff',
                    padding: '6px',
                    borderRadius: '14px',
                    border: '1px solid var(--border)',
                    maxWidth: '300px',
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center'
                  }}>
                    <img
                      src={qrImageSrc}
                      alt="B WORK Payment QR Code"
                      style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '8px', objectFit: 'contain' }}
                    />
                  </div>

                  {/* Download QR Button */}
                  <a
                    href={qrImageSrc}
                    download="BWORK_Payment_QR.png"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      marginTop: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      color: 'var(--primary)',
                      backgroundColor: 'var(--primary-light)',
                      padding: '8px 16px',
                      borderRadius: '10px',
                      textDecoration: 'none',
                      border: '1px solid rgba(15, 118, 110, 0.2)'
                    }}
                  >
                    <Download size={15} />
                    <span>บันทึกรูป QR Code ลงเครื่อง</span>
                  </a>

                  {/* Alternative Bank Transfer Box */}
                  <div style={{
                    marginTop: '16px',
                    width: '100%',
                    backgroundColor: 'var(--bg-page)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    fontSize: '0.8rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 800, color: 'var(--navy)', marginBottom: '8px' }}>
                      <CreditCard size={15} color="var(--primary)" />
                      <span>หรือโอนผ่านบัญชีธนาคาร</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        {isKrungsriBank && (
                          <img
                            src="/krungsri-logo.svg"
                            alt="ธนาคารกรุงศรีอยุธยา"
                            id="bank-logo-krungsri"
                            style={{
                              width: '28px',
                              height: '28px',
                              borderRadius: '6px',
                              objectFit: 'contain',
                              flexShrink: 0,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.12)'
                            }}
                          />
                        )}
                        <span id="bank-name-display" style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.86rem' }}>
                          {displayedBankName || (paymentSettingsLoaded ? '-' : 'กำลังโหลดข้อมูลบัญชี...')}
                        </span>
                      </div>
                      <button
                        type="button"
                        id="btn-copy-bank-account"
                        disabled={!displayedAccountNumber}
                        onClick={handleCopyAccount}
                        style={{
                          background: copied ? '#ecfdf5' : '#ffffff',
                          border: copied ? '1px solid #10b981' : '1px solid rgba(15, 118, 110, 0.35)',
                          borderRadius: '8px',
                          padding: '5px 10px',
                          minHeight: '32px',
                          color: copied ? '#047857' : 'var(--primary)',
                          fontWeight: 800,
                          fontSize: '0.76rem',
                          cursor: displayedAccountNumber ? 'pointer' : 'not-allowed',
                          opacity: displayedAccountNumber ? 1 : 0.55,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexShrink: 0,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอกเลขบัญชี'}</span>
                      </button>
                    </div>
                    <div
                      id="bank-account-number-display"
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 900,
                        fontSize: '1.12rem',
                        color: 'var(--navy)',
                        margin: '8px 0 4px 0',
                        userSelect: 'all',
                        WebkitUserSelect: 'all',
                        cursor: 'text',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {displayedAccountNumber || (paymentSettingsLoaded ? '-' : '...')}
                    </div>
                    {copyError && (
                      <div id="bank-account-copy-error" style={{ fontSize: '0.74rem', color: 'var(--danger)', fontWeight: 700, marginBottom: '4px' }}>
                        {copyError}
                      </div>
                    )}
                    {paymentSettings.account_name && (
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        ชื่อบัญชี: {paymentSettings.account_name}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 4. SLIP UPLOAD & SUBMIT BUTTON (PLACED RIGHT TOGETHER) */}
              <div style={{
                backgroundColor: '#ffffff',
                border: '1.5px solid var(--border)',
                borderRadius: '20px',
                padding: '20px'
              }}>
                <div style={{ marginBottom: '14px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--navy)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Upload size={18} color="var(--primary)" />
                    <span>แนบสลิปหลักฐานการโอนเงิน</span>
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                    เมื่อชำระเงินเรียบร้อยแล้ว กรุณาแนบรูปภาพสลิปเพื่อยืนยันรายการ
                  </p>
                </div>

                <form onSubmit={handleUploadSlip} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Dropzone label */}
                  <label style={{
                    border: '2px dashed var(--border)',
                    borderRadius: '14px',
                    padding: slipPreview ? '14px' : '22px 16px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    backgroundColor: 'var(--bg-page)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.15s ease'
                  }}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                      id="input-slip-file"
                    />

                    {slipPreview ? (
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <img
                          src={slipPreview}
                          alt="Slip Preview"
                          style={{ maxHeight: '180px', maxWidth: '100%', borderRadius: '10px', boxShadow: 'var(--shadow-sm)', objectFit: 'contain' }}
                        />
                        <div style={{ marginTop: '8px', fontSize: '0.84rem', fontWeight: 800, color: 'var(--navy)' }}>
                          {slipFile?.name || 'สลิปโอนเงิน'}
                        </div>
                        {slipFile?.size && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            ({Math.round(slipFile.size / 1024)} KB)
                          </div>
                        )}
                        <div style={{ marginTop: '6px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)' }}>
                          แตะเพื่อเปลี่ยนรูปภาพสลิป
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Upload size={22} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--navy)' }}>
                            แตะที่นี่เพื่อเลือกรูปสลิป
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            รองรับรูปถ่ายหรือแคปหน้าจอ (JPG, PNG, WEBP)
                          </div>
                        </div>
                      </>
                    )}
                  </label>

                  {/* Error Alert */}
                  {error && (
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--danger-light)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      color: 'var(--danger)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <AlertCircle size={16} />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* SUBMIT BUTTON ATTACHED RIGHT BELOW */}
                  <button
                    type="submit"
                    disabled={!slipFile || uploading || qrScanning}
                    className="btn-primary"
                    id="btn-submit-slip"
                    style={{
                      width: '100%',
                      height: '50px',
                      fontSize: '1rem',
                      fontWeight: 800,
                      backgroundColor: (!slipFile || uploading || qrScanning) ? '#cbd5e1' : undefined
                    }}
                  >
                    {uploading ? (
                      <>
                        <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2.5px' }} />
                        <span>กำลังส่งสลิปและตรวจสอบ...</span>
                      </>
                    ) : qrScanning ? (
                      <>
                        <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2.5px' }} />
                        <span>กำลังอ่านสลิป...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={20} />
                        <span>ยืนยันการชำระเงิน</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      )}
      {/* ROOM GUIDELINES MODAL (In-web popup, scrollable, zoomable, closeable on mobile) */}
      {showGuidelinesModal && roomGuidelines && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={roomGuidelines.title}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowGuidelinesModal(false);
            }
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.82)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '12px',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '18px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid #e2e8f0'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                gap: '8px',
                flexShrink: 0
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <BookOpen size={18} style={{ color: '#2563eb', flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: '0.88rem',
                    fontWeight: 800,
                    color: '#0f172a',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={roomGuidelines.title}
                >
                  {roomGuidelines.title}
                </span>
              </div>

              {/* Controls: Zoom & Close */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {/* Zoom Controls */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    backgroundColor: '#f1f5f9',
                    borderRadius: '8px',
                    padding: '2px',
                    gap: '2px'
                  }}
                >
                  <button
                    type="button"
                    title="ย่อรูป"
                    aria-label="ย่อรูป"
                    disabled={guidelinesZoom <= 1}
                    onClick={() => setGuidelinesZoom(z => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                    style={{
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: guidelinesZoom <= 1 ? '#94a3b8' : '#334155',
                      cursor: guidelinesZoom <= 1 ? 'not-allowed' : 'pointer',
                      borderRadius: '6px'
                    }}
                  >
                    <ZoomOut size={15} />
                  </button>

                  <button
                    type="button"
                    title="รีเซ็ตขนาด"
                    aria-label="รีเซ็ตขนาด"
                    onClick={() => setGuidelinesZoom(1)}
                    style={{
                      padding: '0 6px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: '#475569',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      borderRadius: '6px'
                    }}
                  >
                    {Math.round(guidelinesZoom * 100)}%
                  </button>

                  <button
                    type="button"
                    title="ขยายรูป"
                    aria-label="ขยายรูป"
                    disabled={guidelinesZoom >= 2.5}
                    onClick={() => setGuidelinesZoom(z => Math.min(2.5, Math.round((z + 0.25) * 100) / 100))}
                    style={{
                      width: '28px',
                      height: '28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: 'none',
                      backgroundColor: 'transparent',
                      color: guidelinesZoom >= 2.5 ? '#94a3b8' : '#334155',
                      cursor: guidelinesZoom >= 2.5 ? 'not-allowed' : 'pointer',
                      borderRadius: '6px'
                    }}
                  >
                    <ZoomIn size={15} />
                  </button>
                </div>

                {/* Close Button */}
                <button
                  type="button"
                  id="btn-close-guidelines-modal"
                  aria-label="ปิดหน้าต่างข้อปฏิบัติ"
                  onClick={() => setShowGuidelinesModal(false)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body - Scrollable & Zoomable Image */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                WebkitOverflowScrolling: 'touch',
                touchAction: 'pan-x pan-y pinch-zoom',
                padding: '12px',
                backgroundColor: '#f8fafc',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start'
              }}
            >
              <img
                src={roomGuidelines.src}
                alt={roomGuidelines.title}
                onDoubleClick={() => setGuidelinesZoom(z => (z > 1 ? 1 : 1.75))}
                style={{
                  width: `${guidelinesZoom * 100}%`,
                  maxWidth: 'none',
                  height: 'auto',
                  display: 'block',
                  borderRadius: '10px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                  transition: 'width 0.18s ease-out',
                  cursor: guidelinesZoom > 1 ? 'zoom-out' : 'zoom-in',
                  margin: '0 auto'
                }}
              />
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '10px 16px',
                borderTop: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexShrink: 0
              }}
            >
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                แตะ 2 ครั้งหรือใช้ปุ่ม +/- เพื่อขยาย
              </div>
              <button
                type="button"
                id="btn-footer-close-guidelines"
                onClick={() => setShowGuidelinesModal(false)}
                className="btn-secondary"
                style={{
                  padding: '8px 18px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  width: 'auto',
                  minWidth: '90px'
                }}
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
