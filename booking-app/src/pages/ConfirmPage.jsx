import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import generatePayload from 'promptpay-qr';
import { 
  CheckCircle2, Copy, Upload, Image as ImageIcon, Check, 
  ExternalLink, MessageSquare, ShieldCheck, AlertCircle, Clock, FileText 
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

export default function ConfirmPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const bookingId = query.get('id');

  const [booking, setBooking] = useState(null);
  const [paymentSettings, setPaymentSettings] = useState({
    promptpay_number: '0812345678',
    bank_name: 'ธนาคารกรุงศรีอยุธยา (Krungsri)',
    account_number: '329-1-38429-0',
    account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด'
  });

  const [slipFile, setSlipFile] = useState(null);
  const [slipPreview, setSlipPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [error, setError] = useState('');

  // Load completed booking info
  useEffect(() => {
    const raw = sessionStorage.getItem('completed_booking_result');
    if (raw) {
      try {
        setBooking(JSON.parse(raw));
      } catch (e) {}
    }

    // Fetch live payment settings from backend
    fetch(`${API_BASE}/api/public/settings/payment`)
      .then(res => res.json())
      .then(data => {
        if (data && data.account_number) {
          setPaymentSettings(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, [bookingId]);

  // Copy Account Number with Toast Feedback
  const handleCopyAccount = () => {
    const cleanNum = paymentSettings.account_number.replace(/-/g, '');
    navigator.clipboard.writeText(cleanNum);
    setToastMessage('📋 คัดลอกเลขบัญชีเรียบร้อยแล้ว!');
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Handle File Selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSlipFile(file);
      const reader = new FileReader();
      reader.onload = () => setSlipPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // Handle Slip Upload
  const handleUploadSlip = async (e) => {
    e.preventDefault();
    if (!slipFile) {
      setError('กรุณาเลือกไฟล์รูปภาพสลิปก่อนกดยืนยัน');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('slip', slipFile);
      if (booking?.customer_contact) {
        formData.append('contact', booking.customer_contact);
      }

      const res = await fetch(`${API_BASE}/api/public/bookings/${bookingId}/upload-slip`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setUploadSuccess(true);
      } else {
        setError(data.error || 'ไม่สามารถอัปโหลดสลิปได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  // Generate PromptPay QR Code payload
  const totalAmt = booking ? parseFloat(booking.total_amount || 0) : 0;
  const promptpayTarget = paymentSettings.promptpay_number || '3291384290';
  let qrCodeValue = '';
  try {
    qrCodeValue = generatePayload(promptpayTarget, { amount: totalAmt });
  } catch (e) {
    qrCodeValue = `PROMPTPAY:${promptpayTarget}:${totalAmt}`;
  }

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
        <div className="booking-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
            <CheckCircle2 size={36} />
          </div>

          <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 8px 0' }}>
            ส่งหลักฐานชำระเงินเรียบร้อยแล้ว!
          </h2>
          <p style={{ fontSize: '0.92rem', color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 20px auto' }}>
            เจ้าหน้าที่กำลังตรวจสอบรายการโอนเงิน เมื่อตรวจสอบเสร็จสิ้น ระบบจะส่ง <strong>รหัสผ่านเปิดประตูเข้าห้อง (PIN Code)</strong> ให้ท่านทาง LINE Official Account ทันที
          </p>

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
              <strong style={{ color: 'var(--primary)' }}>#{bookingId}</strong>
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

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', maxWidth: '400px', margin: '0 auto' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle2 size={24} style={{ color: '#10b981', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-main)' }}>
                  บันทึกการจองสำเร็จ! รหัสการจอง: <span style={{ color: 'var(--primary)' }}>#{bookingId}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {booking?.room_name} · {booking?.date ? booking.date.split('-').reverse().join('/') : '-'} ({booking?.start_time} - {booking?.end_time} น.)
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>ยอดชำระทั้งสิ้น</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)' }}>
                ฿{Number(totalAmt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* NOTICE BOX */}
          <div style={{
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            border: '1px solid rgba(37, 99, 235, 0.25)',
            borderRadius: '14px',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.84rem',
            color: 'var(--text-main)'
          }}>
            <ShieldCheck size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <div>
              <strong>คำแนะนำ:</strong> กรุณาสแกน QR Code พร้อมเพย์ด้านล่าง และแนบสลิปเพื่อรับรหัสเปิดประตูเข้าใช้งานห้อง
            </div>
          </div>

          {/* PAYMENT DETAILS CARD (PROMPTPAY QR CODE) */}
          <div className="booking-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              border: '2px solid #e2e8f0',
              borderRadius: '20px',
              padding: '24px 20px',
              boxShadow: 'var(--shadow-sm)',
              maxWidth: '340px',
              width: '100%'
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 900, color: '#1e3a8a', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                สแกนจ่ายผ่านพร้อมเพย์ (PromptPay)
              </div>

              <div style={{ backgroundColor: '#ffffff', padding: '12px', borderRadius: '14px', border: '1px solid #cbd5e1', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <QRCodeSVG 
                  value={qrCodeValue} 
                  size={190} 
                  level="M" 
                />
              </div>

              <div style={{ marginTop: '14px', fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)' }}>
                ฿{Number(totalAmt).toLocaleString()}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                ยอดชำระตรงตามบิล
              </div>
            </div>
          </div>

          {/* SLIP UPLOAD CARD */}
          <div className="booking-card">
            <div style={{ marginBottom: '14px' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                📤 แนบสลิปหลักฐานการโอนเงิน
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
                <span>{uploading ? 'กำลังส่งข้อมูลสลิป...' : 'ส่งสลิปยืนยันการชำระเงิน'}</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
