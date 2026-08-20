import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import generatePayload from 'promptpay-qr';
import { QRCodeSVG } from 'qrcode.react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

export default function ConfirmPage() {
  const { bookingId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(location.state?.booking || null);
  const [paymentSettings, setPaymentSettings] = useState(null);
  const [loading, setLoading] = useState(!location.state?.booking);
  const [error, setError] = useState('');
  
  // Slip upload state
  const [slipFile, setSlipFile] = useState(null);
  const [slipPreview, setSlipPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Fetch booking details & payment settings
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bRes, pRes] = await Promise.all([
          fetch(`${API_BASE}/api/public/bookings/${bookingId}`),
          fetch(`${API_BASE}/api/public/settings/payment`)
        ]);

        if (bRes.ok) {
          const bData = await bRes.json();
          setBooking(bData);
        } else if (!location.state?.booking) {
          setError('ไม่พบข้อมูลการจอง');
        }

        if (pRes.ok) {
          const pData = await pRes.json();
          setPaymentSettings(pData);
        }
      } catch (err) {
        console.error('Fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [bookingId]);

// Helper to compress/scale large camera images & screenshots before upload to Cloudflare D1
const compressImage = (file, maxWidth = 1000, maxHeight = 1000, quality = 0.75) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

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

        // Convert to high-clarity lightweight JPEG (typically 60KB - 120KB)
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

  // Handle file selection for slip with automatic compression
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      setUploadError('ขนาดรูปภาพเกิน 20MB กรุณาเลือกรูปอื่น');
      return;
    }

    setSlipFile(file);
    setUploadError('');

    try {
      // Compress automatically on mobile/desktop
      const compressedData = await compressImage(file, 1000, 1000, 0.75);
      setSlipPreview(compressedData);
    } catch (err) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSlipPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle slip upload submit
  const handleUploadSlip = async (e) => {
    e.preventDefault();
    if (!slipPreview) return;

    setUploading(true);
    setUploadError('');

    try {
      const res = await fetch(`${API_BASE}/api/public/bookings/${bookingId}/upload-slip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slip_image: slipPreview })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setUploadSuccess(true);
        if (booking) {
          setBooking({ ...booking, payment_status: 'reviewing', slip_image_url: data.slipUrl });
        }
      } else {
        setUploadError(data.error || 'อัปโหลดสลิปไม่สำเร็จ กรุณาลองใหม่');
      }
    } catch (err) {
      setUploadError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
        กำลังโหลดข้อมูลการชำระเงิน...
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="glass-card" style={{ textAlign: 'center', padding: '3rem', maxWidth: '500px', margin: '0 auto' }}>
        <h3>{error || 'ไม่พบข้อมูลการจอง'}</h3>
        <button className="btn btn-primary" onClick={() => navigate('/')} style={{ marginTop: '1rem' }}>
          กลับสู่หน้าหลัก
        </button>
      </div>
    );
  }

  // Format code
  const bookingCode = booking.bookingCode || `BK-${String(booking.id || '').padStart(6, '0')}`;
  const totalAmount = Number(booking.totalAmount || booking.total_amount || 0);

  // Generate PromptPay QR payload
  const promptPayId = paymentSettings?.promptpay_id || '0125554000401';
  let qrPayload = '';
  try {
    qrPayload = generatePayload(promptPayId, { amount: totalAmount });
  } catch (e) {
    qrPayload = promptPayId;
  }

  return (
    <div className="page-transition" style={{ maxWidth: '700px', margin: '0 auto' }}>
      {/* Hero Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ color: 'var(--primary)', fontSize: '2.2rem', margin: '0 0 0.25rem 0', fontWeight: 'bold' }}>B-WORK</h1>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1.25rem' }}>ยืนยันการจอง & ชำระเงิน / Payment</h2>
      </div>

      {/* Progress Step Indicator (Step 4 Active) */}
      <StepProgress currentStep={4} />

      {/* Booking Success Banner */}
      <div className="glass-card" style={{ textAlign: 'center', padding: '1.5rem', marginBottom: '1.5rem', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#166534', marginBottom: '0.25rem' }}>
          บันทึกรายการจองสำเร็จ!
        </div>
        <div style={{ fontSize: '0.9rem', color: '#15803d' }}>
          หมายเลขการจองของคุณคือ:
        </div>
        <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)', margin: '0.25rem 0' }}>
          {bookingCode}
        </div>
        <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>
          (กรุณาชำระเงินและอัปโหลดสลิปภายใน 24 ชั่วโมง)
        </div>
      </div>

      {/* LINE OA Passcode Notice Card */}
      <div className="glass-card" style={{ 
        textAlign: 'center', 
        padding: '1.25rem', 
        marginBottom: '1.5rem', 
        backgroundColor: '#f0fdf4', 
        border: '1.5px solid #16a34a',
        borderRadius: '16px'
      }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.3rem' }}>
          📲 รับรหัสผ่านเข้าห้องประชุมทาง LINE OA
        </div>
        <div style={{ fontSize: '0.85rem', color: '#166534', lineHeight: 1.6 }}>
          หลังชำระเงินและสลิปผ่านการตรวจสอบแล้ว รหัสผ่านประตูจะถูกส่งไปยัง <strong>LINE Official Account</strong> ของคุณ<br />
          หรือกดปุ่ม <strong>"รับรหัสเข้าห้อง"</strong> ใน LINE OA เมื่อถึงเวลาใช้งานเพื่อรับรหัสผ่านปลดล็อกประตูหน้าห้อง
        </div>
      </div>

      {/* Payment Instructions Card */}
      <div className="glass-card" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1.25rem 0', fontSize: '1.1rem', textAlign: 'center' }}>ช่องทางการชำระเงิน (PromptPay & โอนเงิน)</h3>

        <div className="payment-methods-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', alignItems: 'center' }}>
          {/* PromptPay QR Code */}
          <div style={{ textAlign: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '0.75rem', color: 'var(--text-dark)' }}>
              สแกน QR Code เพื่อชำระเงิน
            </div>
            {qrPayload ? (
              <div style={{ background: 'white', padding: '12px', display: 'inline-block', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <QRCodeSVG value={qrPayload} size={180} />
              </div>
            ) : null}
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--primary)', marginTop: '0.75rem' }}>
              ฿{totalAmount.toLocaleString()}
            </div>
          </div>

          {/* Bank Transfer Detail */}
          <div style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 'bold', color: 'var(--text-dark)', marginBottom: '0.5rem' }}>
              หรือโอนเงินผ่านบัญชีธนาคาร:
            </div>
            <div style={{ background: '#f8fafc', padding: '0.875rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div><strong>ธนาคาร:</strong> {paymentSettings?.bank_name || 'ธนาคารกรุงศรีอยุธยา (Krungsri)'}</div>
              <div><strong>เลขที่บัญชี:</strong> <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--primary)' }}>{paymentSettings?.bank_account || '329-1-38429-0'}</span></div>
              <div><strong>ชื่อบัญชี:</strong> {paymentSettings?.bank_account_name || 'บริษัท บิลท์ ฮาร์ท จำกัด'}</div>
              <div><strong>ยอดชำระ:</strong> <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>฿{totalAmount.toLocaleString()} บาท</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Status & Slip / PIN Code Section */}
      {booking.payment_status === 'paid' ? (
        <div className="glass-card" style={{ padding: '1.75rem', marginBottom: '2rem', background: '#f0fdf4', border: '1.5px solid #86efac' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#166534', marginBottom: '0.25rem' }}>
              ✅ ได้รับการยืนยันและชำระเงินเรียบร้อยแล้ว!
            </div>
            <div style={{ fontSize: '0.875rem', color: '#15803d' }}>
              เจ้าหน้าที่ได้ตรวจสอบสลิปและยืนยันการจองของคุณในระบบแล้ว
            </div>
          </div>

          {/* Door Access PIN Code Display */}
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '1.25rem',
            border: '2px dashed #10b981',
            textAlign: 'center',
            marginBottom: '1.25rem',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.12)'
          }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#15803d', marginBottom: '0.25rem' }}>
              🔑 รหัสผ่านปลดล็อกประตูหน้าห้อง (Door PIN Code)
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: '#166534', letterSpacing: '4px', margin: '4px 0' }}>
              {booking.pin_code || '------'}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              กดรหัส PIN 6 หลักนี้ที่หน้าจอแท็บเล็ตหน้าห้องประชุมเพื่อปลดล็อกประตูเข้าใช้งาน<br />
              (สามารถกดรหัสเข้าใช้งานได้ล่วงหน้า 15 นาทีก่อนเริ่มเวลา)
            </div>
          </div>

          {/* LINE OA Confirmation Simulated Card */}
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #cbd5e1',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
          }}>
            <div style={{ background: '#10b981', color: 'white', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>📲</span>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>B-WORK LINE OFFICIAL ACCOUNT</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>การ์ดแจ้งเตือนยืนยันการจองใน LINE OA</div>
              </div>
            </div>
            <div style={{ padding: '16px', fontSize: '0.875rem', lineHeight: 1.6, color: '#334155' }}>
              <div>👤 <strong>ชื่อผู้จอง:</strong> {booking.customer_name}</div>
              <div>🚪 <strong>ห้องประชุม:</strong> {booking.room?.name || 'ห้องประชุม B-WORK'}</div>
              <div>📅 <strong>วันที่ใช้งาน:</strong> {booking.booking_date || booking.created_at?.split('T')[0]}</div>
              <div>⏰ <strong>เวลา:</strong> {booking.start_time} - {booking.end_time} น.</div>
              <div>🧾 <strong>เลขที่ใบเสร็จ:</strong> {booking.receipt_number || bookingCode}</div>
              <div style={{ marginTop: '10px', padding: '8px 12px', background: '#f0fdf4', borderRadius: '8px', color: '#166534', fontWeight: 700, textAlign: 'center' }}>
                🔑 รหัสผ่านเข้าห้อง: <span style={{ fontSize: '1.1rem', letterSpacing: '2px' }}>{booking.pin_code || '------'}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: '1.75rem', marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>แนบสลิปการโอนเงิน (Upload Payment Slip)</h3>

          {uploadSuccess || booking.slip_image_url || booking.payment_status === 'reviewing' ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#166534', marginBottom: '0.5rem' }}>
                &check; ส่งสลิปการชำระเงินเรียบร้อยแล้ว
              </div>
              <p style={{ fontSize: '0.85rem', color: '#15803d', margin: 0, marginBottom: '1rem' }}>
                สถานะปัจจุบัน: <strong>📑 รอเจ้าหน้าที่ Bwork-POS ตรวจสอบสลิปและยืนยันการจอง</strong><br />
                เมื่อเจ้าหน้าที่ยืนยันแล้ว รหัสผ่านประตูและข้อมูลยืนยันจะส่งเข้า LINE OA ของคุณ
              </p>
              <button 
                type="button" 
                className="btn btn-outline"
                style={{ fontSize: '0.825rem', padding: '0.45rem 0.9rem' }}
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/api/public/bookings/${bookingId}`);
                    if (res.ok) {
                      const updated = await res.json();
                      setBooking(updated);
                    }
                  } catch (e) {}
                }}
              >
                🔄 รีเฟรชตรวจสอบสถานะการอนุมัติ
              </button>
            </div>
          ) : (
            <form onSubmit={handleUploadSlip}>
              {uploadError && (
                <div style={{ background: '#fee2e2', color: '#991b1b', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  {uploadError}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label" style={{ fontSize: '0.85rem' }}>เลือกไฟล์สลิปการโอนเงิน (PNG, JPG)</label>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="form-control" 
                  onChange={handleFileChange} 
                  style={{ padding: '0.5rem' }}
                />
              </div>

              {slipPreview && (
                <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                  <img src={slipPreview} alt="Slip Preview" style={{ maxHeight: '200px', borderRadius: '8px', border: '1px solid var(--border)' }} />
                </div>
              )}

              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={!slipPreview || uploading}
                style={{ width: '100%', padding: '0.85rem', fontSize: '0.95rem', fontWeight: 'bold' }}
              >
                {uploading ? 'กำลังส่งสลิป...' : 'ส่งสลิปยืนยันการชำระเงิน'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Done Button */}
      <div style={{ textAlign: 'center' }}>
        <button className="btn btn-outline" onClick={() => navigate('/')}>
          เสร็จสิ้น / กลับสู่หน้าหลัก
        </button>
      </div>
    </div>
  );
}
