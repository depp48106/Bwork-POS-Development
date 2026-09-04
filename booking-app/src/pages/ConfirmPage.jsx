import jsQR from 'jsqr';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  CheckCircle2, Copy, Upload, Check,
  ShieldCheck, AlertCircle, Download, CreditCard, QrCode, Clock
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';
import { calcPaymentTimeLeft } from '../utils/paymentCountdown';

export default function ConfirmPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const bookingId = query.get('id');
  const queryCode = query.get('code');

  const [booking, setBooking] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      if (raw) return JSON.parse(raw);
      const pendingRaw = typeof window !== 'undefined' ? localStorage.getItem('bwork_pending_booking') : null;
      if (pendingRaw) return JSON.parse(pendingRaw);
    } catch (e) {}
    return null;
  });
  const [paymentSettings, setPaymentSettings] = useState({
    promptpay_number: '0125554000401',
    bank_name: 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
    account_number: '329-1-38429-0',
    account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด',
    qr_image: '/bwork_payment_qr.png'
  });

  const [slipFile, setSlipFile] = useState(null);
  const [slipPreview, setSlipPreview] = useState(null);
  const [slipQrData, setSlipQrData] = useState(null);
  const [qrScanning, setQrScanning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadResultData, setUploadResultData] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
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
  const [isExpired, setIsExpired] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('completed_booking_result') : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed) {
        if (parsed.payment_status === 'rejected' || parsed.slip_verify_status === 'rejected') return false;
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

  // Dynamic Countdown Timer based on paymentDeadline as Source of Truth
  useEffect(() => {
    if (!booking || uploadSuccess || booking.payment_status === 'paid' || isRejected) return;

    if (booking.payment_status === 'cancelled') {
      setIsExpired(true);
      setTimeLeftSeconds(0);
      localStorage.removeItem('bwork_pending_booking');
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
        localStorage.removeItem('bwork_pending_booking');
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
  const fetchFreshBooking = useCallback(async () => {
    if (!bookingId || bookingId === 'undefined') return null;

    let storedBooking = null;
    try {
      const raw = sessionStorage.getItem('completed_booking_result');
      if (raw) storedBooking = JSON.parse(raw);
    } catch (e) {}

    let pendingBooking = null;
    try {
      const pendingRaw = localStorage.getItem('bwork_pending_booking');
      if (pendingRaw) pendingBooking = JSON.parse(pendingRaw);
    } catch (e) {}

    let statusAccess = null;
    try {
      const statusRaw = sessionStorage.getItem(`bwork_booking_access_${bookingId}`);
      if (statusRaw) statusAccess = JSON.parse(statusRaw);
    } catch (e) {}

    const accessToken = storedBooking?.access_token || pendingBooking?.accessToken || statusAccess?.accessToken;
    const accessContact = storedBooking?.customer_contact || storedBooking?.contact || pendingBooking?.contact || statusAccess?.contact;
    const accessHeaders = {
      ...(accessToken ? { 'X-Booking-Token': accessToken } : {}),
      ...(accessContact ? { 'X-Booking-Contact': accessContact } : {})
    };

    try {
      const res = await fetch(`${API_BASE}/api/public/bookings/${bookingId}`, { headers: accessHeaders });
      const data = await res.json();
      if (data && !data.error) {
        if (data.payment_window_minutes) {
          setPaymentWindowMinutes(parseInt(data.payment_window_minutes, 10) || 15);
        }
        if (data.payment_status === 'rejected' || data.slip_verify_status === 'rejected') {
          setIsExpired(false);
        } else if (data.payment_status === 'cancelled') {
          setIsExpired(true);
          setTimeLeftSeconds(0);
          localStorage.removeItem('bwork_pending_booking');
        }
        setBooking(prev => ({
          ...prev,
          ...data,
          paymentDeadline: data.paymentDeadline || prev?.paymentDeadline,
          payment_window_minutes: data.payment_window_minutes || prev?.payment_window_minutes,
          room_name: data.room?.name || prev?.room_name,
          booking_code: data.receipt_number || data.bookingCode || prev?.booking_code,
          total_amount: data.total_amount || prev?.total_amount
        }));
        return data;
      }
    } catch (e) {}
    return null;
  }, [bookingId]);

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
    const raw = sessionStorage.getItem('completed_booking_result');
    if (raw) {
      try {
        const storedBooking = JSON.parse(raw);
        setBooking(storedBooking);
      } catch (e) {}
    }

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
            account_number: data.payment_bank_account || data.bank_account || prev.account_number,
            account_name: data.payment_bank_account_name || data.bank_account_name || prev.account_name,
            promptpay_number: data.promptpay_id || prev.promptpay_number,
            qr_image: data.qr_image || '/bwork_payment_qr.png'
          }));
        }
      })
      .catch(() => {});
  }, [bookingId]);

  // Copy Account Number with Toast Feedback
  const handleCopyAccount = () => {
    const cleanNum = (paymentSettings.account_number || '3291384290').replace(/-/g, '');
    navigator.clipboard.writeText(cleanNum);
    setToastMessage('คัดลอกเลขบัญชีเรียบร้อยแล้ว!');
    setTimeout(() => setToastMessage(''), 3000);
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
        if (result.qrData) {
          setToastMessage('✅ ตรวจพบ QR Code สลิปธนาคาร (พร้อมระบบอนุมัติอัตโนมัติ)');
          setTimeout(() => setToastMessage(''), 4000);
        }
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

      // Send Base64 payload + QR data (Enables 100% Automated Instant Verification)
      const res = await fetch(`${API_BASE}/api/public/bookings/${targetId}/upload-slip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slip_image: finalPayload,
          qr_data: slipQrData,
          contact: booking?.customer_contact || booking?.contact,
          access_token: booking?.access_token
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
        localStorage.removeItem('bwork_pending_booking');
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
            : 'ไม่สามารถตรวจสอบ QR Code จากสลิปได้ กรุณาอัปโหลดสลิปโอนเงินที่ถูกต้อง'
        ));
      }
    } catch (err) {
      setError('ไม่สามารถติดต่อระบบตรวจสอบสลิปได้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
    } finally {
      setUploading(false);
    }
  };

  const totalAmt = booking ? parseFloat(booking.total_amount || 0) : 0;
  const qrImageSrc = paymentSettings.qr_image || '/bwork_payment_qr.png';

  return (
    <div className="main-content">
      <StepProgress currentStep={4} />

      {/* TOAST ALERT */}
      {toastMessage && (
        <div className="toast-container">
          <Check size={18} style={{ color: '#10b981' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {uploadSuccess ? (
        /* AFTER SUBMISSION SUCCESS VIEW */
        <div className="booking-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
          {uploadResultData?.auto_approved ? (
            <>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                <CheckCircle2 size={36} />
              </div>

              <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 8px 0' }}>
                ชำระเงินสำเร็จ! (ระบบตรวจสอบสลิปอัตโนมัติ)
              </h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 16px auto' }}>
                ระบบได้ตรวจสอบสลิปโอนเงินของท่านถูกต้องเรียบร้อยแล้ว การจองห้องประชุมได้รับการยืนยันทันที
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
                    เมื่อถึงวันและเวลาเข้าใช้งาน กรุณาติดต่อที่ <strong>เคาน์เตอร์ประชาสัมพันธ์ (ชั้น 3)</strong> เจ้าหน้าที่จะทำการส่งรหัส PIN สำหรับเปิดประตูให้ท่านครับ
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
                {uploadResultData?.is_resubmission ? 'ส่งสลิปใหม่เรียบร้อยแล้ว' : 'ระบบได้รับหลักฐานการโอนเงินแล้ว'}
              </h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 16px auto' }}>
                {uploadResultData?.is_resubmission
                  ? 'ระบบกำลังรอเจ้าหน้าที่ตรวจสอบอีกครั้ง'
                  : 'ระบบได้รับหลักฐานการโอนเงินแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบยอดเงินก่อนยืนยันการจอง'}
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
                <strong>สถานะ: กำลังรอเจ้าหน้าที่ตรวจสอบยอดเงิน</strong>
                <span>{uploadResultData?.message || 'เจ้าหน้าที่จะตรวจสอบยอดโอนและยืนยันการจองให้ท่านโดยเร็วที่สุดครับ'}</span>
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

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', maxWidth: '420px', margin: '0 auto', flexWrap: 'wrap' }}>
            {!uploadResultData?.auto_approved && (
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* TOP SUCCESS BANNER */}
          <div style={{
            backgroundColor: '#ffffff',
            border: '1.5px solid #10b981',
            borderRadius: 'var(--radius-lg)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 200px' }}>
              <CheckCircle2 size={24} style={{ color: '#10b981', flexShrink: 0 }} />
              <div style={{ wordBreak: 'break-word' }}>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-main)' }}>
                  บันทึกการจองสำเร็จ! รหัสการจอง: <span style={{ color: 'var(--primary)', letterSpacing: '0.5px' }}>{displayBookingCode}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {booking?.room_name} · {booking?.date ? booking.date.split('-').reverse().join('/') : '-'} ({booking?.start_time} - {booking?.end_time} น.)
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>ยอดชำระทั้งสิ้น</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)' }}>
                ฿{Number(totalAmt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* REJECTED ALERT OR 15-MINUTE COUNTDOWN TIMER BOX */}
          {isRejected ? (
            <div style={{
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1.5px solid #f59e0b',
              borderRadius: '14px',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertCircle size={24} style={{ color: '#d97706', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 900, fontSize: '1.05rem', color: '#b45309' }}>
                    สลิปการโอนเงินไม่ผ่านการตรวจสอบ กรุณาแนบสลิปใหม่
                  </div>
                  {booking?.rejection_reason && (
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#92400e', marginTop: '3px' }}>
                      เหตุผล: {booking.rejection_reason}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '0.82rem', color: '#78350f', marginTop: '2px' }}>
                การจองของท่านยังคงอยู่ กรุณาตรวจสอบและอัปโหลดสลิปที่ถูกต้องอีกครั้ง
              </div>
            </div>
          ) : isExpired ? (
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1.5px solid #ef4444',
              borderRadius: '14px',
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
              <button
                type="button"
                onClick={() => navigate('/')}
                className="btn-primary"
                style={{ marginTop: '8px', padding: '8px 20px', width: 'auto', fontSize: '0.86rem' }}
              >
                ทำรายการจองใหม่
              </button>
            </div>
          ) : (
            <div style={{
              backgroundColor: timeLeftSeconds < 5 * 60 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(37, 99, 235, 0.08)',
              border: `1.5px solid ${timeLeftSeconds < 5 * 60 ? '#ef4444' : 'rgba(37, 99, 235, 0.3)'}`,
              borderRadius: '14px',
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Clock size={20} color={timeLeftSeconds < 5 * 60 ? '#ef4444' : 'var(--primary)'} />
                <div style={{ fontSize: '0.84rem', color: 'var(--text-main)' }}>
                  <strong>{timeLeftSeconds < 5 * 60 ? 'ใกล้หมดเวลาชำระเงิน:' : 'กำหนดเวลาชำระเงิน:'}</strong> กรุณาชำระและแนบสลิปก่อนหมดเวลา
                </div>
              </div>

              <div style={{
                fontFamily: 'monospace',
                fontSize: '1.25rem',
                fontWeight: 900,
                color: timeLeftSeconds < 5 * 60 ? '#dc2626' : 'var(--primary)',
                backgroundColor: '#ffffff',
                padding: '4px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                letterSpacing: '1px'
              }}>
                {`${Math.floor(timeLeftSeconds / 60).toString().padStart(2, '0')}:${(timeLeftSeconds % 60).toString().padStart(2, '0')}`}
              </div>
            </div>
          )}

          {/* PAYMENT DETAILS CARD (OFFICIAL MERCHANT QR CODE) */}
          <div className="booking-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              border: '2px solid #e2e8f0',
              borderRadius: '20px',
              padding: '20px 14px',
              boxShadow: 'var(--shadow-sm)',
              maxWidth: '360px',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.86rem', fontWeight: 900, color: '#1e3a8a', marginBottom: '14px', letterSpacing: '0.5px' }}>
                <QrCode size={18} />
                <span>สแกนจ่ายผ่าน QR Code (B-WORK)</span>
              </div>

              {/* Official QR Code Standee Image */}
              <div style={{
                backgroundColor: '#ffffff',
                padding: '8px',
                borderRadius: '16px',
                border: '1.5px solid #cbd5e1',
                boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
                maxWidth: '290px',
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                overflow: 'hidden'
              }}>
                <img
                  src={qrImageSrc}
                  alt="B WORK Payment QR Code"
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '10px' }}
                />
              </div>

              {/* Amount to pay */}
              <div style={{ marginTop: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>ยอดเงินที่ต้องชำระ</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--primary)', lineHeight: 1.2 }}>
                  ฿{Number(totalAmt).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
                  รองรับ PromptPay ทุกธนาคาร / บัตรเครดิต (VISA, Mastercard)
                </div>
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
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: 'var(--primary)',
                  backgroundColor: 'rgba(37, 99, 235, 0.08)',
                  padding: '6px 14px',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  border: '1px solid rgba(37, 99, 235, 0.2)'
                }}
              >
                <Download size={14} />
                <span>บันทึกรูป QR Code ลงเครื่อง</span>
              </a>

              {/* Bank Transfer Alternative Box */}
              <div style={{
                marginTop: '18px',
                width: '100%',
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '12px 14px',
                fontSize: '0.78rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  <CreditCard size={14} />
                  <span>หรือโอนผ่านบัญชีธนาคาร</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#475569' }}>
                  <span>{paymentSettings.bank_name || 'ธ.กรุงศรีอยุธยา'}</span>
                  <button
                    type="button"
                    onClick={handleCopyAccount}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--primary)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: 0,
                      fontSize: '0.76rem'
                    }}
                  >
                    <Copy size={12} />
                    <span>คัดลอกเลขบัญชี</span>
                  </button>
                </div>
                <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.92rem', color: '#0f172a', margin: '2px 0' }}>
                  {paymentSettings.account_number || '329-1-38429-0'}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  ชื่อบัญชี: {paymentSettings.account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด'}
                </div>
              </div>

            </div>
          </div>

          {/* SLIP UPLOAD CARD */}
          <div className="booking-card">
            <div style={{ marginBottom: '14px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                แนบสลิปหลักฐานการโอนเงิน
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                เมื่อโอนเงินเรียบร้อยแล้ว กรุณาอัปโหลดรูปภาพสลิปเพื่อยืนยันรายการ
              </p>
            </div>

            <form onSubmit={handleUploadSlip} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Dropzone / Upload area */}
              <label style={{
                border: '2px dashed var(--border-card)',
                borderRadius: '16px',
                padding: '24px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                backgroundColor: 'var(--bg-page)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                transition: 'all 0.2s ease'
              }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />

                {slipPreview ? (
                  <div>
                    <img
                      src={slipPreview}
                      alt="Slip Preview"
                      style={{ maxHeight: '200px', borderRadius: '10px', boxShadow: 'var(--shadow-md)', marginBottom: '8px' }}
                    />
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>
                      แตะเพื่อเปลี่ยนรูปภาพสลิป
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Upload size={24} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-main)' }}>
                        แตะที่นี่เพื่อเลือกรูปภาพสลิป
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        รองรับไฟล์ JPG, PNG (ภาพถ่ายจากมือถือ)
                      </div>
                    </div>
                  </>
                )}
              </label>

              {/* Error Alert */}
              {error && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--danger-light)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--danger)',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              {/* Upload Button */}
              <button
                type="submit"
                disabled={uploading || !slipFile}
                className="btn-primary"
                style={{
                  backgroundColor: !slipFile ? '#cbd5e1' : undefined
                }}
              >
                <Upload size={18} />
                <span>{uploading ? 'กำลังอ่านและตรวจสอบสลิป...' : 'ส่งสลิปยืนยันการชำระเงิน'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
