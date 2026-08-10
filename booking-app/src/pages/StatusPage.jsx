import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { API_BASE } from '../apiConfig';

export default function StatusPage() {
  const navigate = useNavigate();
  const [bookingId, setBookingId] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleCheck = async (e) => {
    e.preventDefault();
    if (!bookingId || !phone) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const res = await fetch(`${API_BASE}/api/public/bookings/${bookingId}?contact=${phone}`);
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'ไม่พบข้อมูลการจอง หรือเบอร์โทรศัพท์ไม่ถูกต้อง');
        setResult(null);
      }
    } catch (err) {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch(status) {
      case 'pending': 
      case 'unpaid':
        return <span style={{ background: '#fef3c7', color: '#b45309', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600 }}>รอชำระเงิน</span>;
      case 'reviewing': 
      case 'paid':
        return <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600 }}>รอตรวจสอบสลิป</span>;
      case 'confirmed': 
        return <span style={{ background: '#d1fae5', color: '#065f46', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600 }}>ยืนยันอนุมัติแล้ว</span>;
      case 'cancelled': 
        return <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600 }}>ยกเลิก</span>;
      default: 
        return <span style={{ background: '#f1f5f9', color: '#475569', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.875rem', fontWeight: 600 }}>{status}</span>;
    }
  };

  return (
    <div className="page-transition" style={{ maxWidth: '540px', margin: '0 auto' }}>
      
      {/* Top Back Navigation Bar */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button 
          onClick={() => navigate('/')} 
          className="btn btn-outline"
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: '0.4rem', 
            fontSize: '0.875rem', 
            padding: '0.5rem 0.9rem',
            borderRadius: '8px'
          }}
        >
          &larr; กลับหน้าหลักจองห้องประชุม
        </button>
      </div>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
        <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.6rem', color: 'var(--text-dark)' }}>
          ตรวจสอบสถานะการจอง
        </h2>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.875rem' }}>
          Check Booking Status & Payment Details
        </p>
      </div>

      {/* Check Form Card */}
      <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '14px' }}>
        <form onSubmit={handleCheck}>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
              หมายเลขการจอง / Booking Code
            </label>
            <input 
              type="text" 
              className="form-control" 
              value={bookingId} 
              onChange={(e) => setBookingId(e.target.value.toUpperCase())}
              placeholder="เช่น BK-000001"
              style={{ fontSize: '0.95rem', padding: '0.7rem' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
              เบอร์โทรศัพท์ที่ใช้จอง / Phone Number
            </label>
            <input 
              type="tel" 
              className="form-control" 
              value={phone} 
              onChange={(e) => setPhone(e.target.value)}
              placeholder="กรอกเบอร์โทรศัพท์ เช่น 0812345678"
              style={{ fontSize: '0.95rem', padding: '0.7rem' }}
            />
          </div>
          
          {error && (
            <div style={{ color: '#ef4444', marginBottom: '1.25rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 500, backgroundColor: '#fef2f2', padding: '0.65rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}
          
          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={loading}
            style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 'bold', borderRadius: '8px' }}
          >
            {loading ? 'กำลังตรวจสอบ...' : 'ตรวจสอบสถานะ'}
          </button>
        </form>
      </div>

      {/* Result Card */}
      {result && (
        <div className="glass-card page-transition" style={{ marginTop: '1.5rem', padding: '1.5rem', borderRadius: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.85rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--primary)' }}>{result.bookingCode || `BK-${String(result.id).padStart(6, '0')}`}</h3>
            {getStatusBadge(result.payment_status || result.status)}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
            <p style={{ margin: 0 }}><strong>ชื่อผู้จอง:</strong> {result.customer_name}</p>
            <p style={{ margin: 0 }}><strong>ห้องประชุม:</strong> {result.room?.name || result.room_name || '-'}</p>
            <p style={{ margin: 0 }}><strong>วันที่จอง:</strong> {result.booking_date}</p>
            <p style={{ margin: 0 }}><strong>เวลา:</strong> {result.start_time} - {result.end_time} น.</p>
            <p style={{ margin: 0 }}><strong>ยอดชำระ:</strong> <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.1rem' }}>฿{Number(result.total_amount || result.totalAmount || 0).toLocaleString()}</span></p>
          </div>

          {/* LINE OA Notice Card */}
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '1.5px solid #16a34a',
            borderRadius: '12px',
            padding: '1rem 1.15rem',
            marginBottom: '1.25rem',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#15803d', marginBottom: '0.25rem' }}>
              📲 รับรหัสผ่านเข้าห้องประชุมทาง LINE OA
            </div>
            <div style={{ fontSize: '0.8rem', color: '#166534', lineHeight: 1.5 }}>
              รหัสผ่านปลดล็อกประตูหน้าห้อง จะถูกจัดส่งผ่าน <strong>LINE Official Account</strong><br />
              (กดรับรหัสผ่านล่วงหน้าได้ 15 นาที ก่อนถึงเวลาใช้งาน)
            </div>
          </div>
          
          {(result.payment_status === 'pending' || result.payment_status === 'unpaid') && (
            <Link 
              to={`/confirm/${result.id}`} 
              state={{ booking: result }} 
              className="btn btn-primary" 
              style={{ display: 'block', textAlign: 'center', padding: '0.75rem', fontWeight: 'bold', borderRadius: '8px' }}
            >
              ไปหน้าชำระเงิน & แนบสลิป &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
