import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Phone, Search, ArrowLeft, CheckCircle2, Clock, 
  AlertCircle, Key, Calendar, Building, ChevronRight, Upload 
} from 'lucide-react';
import { API_BASE } from '../apiConfig';

export default function StatusPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPhone = searchParams.get('phone') || searchParams.get('contact') || '';

  const [phone, setPhone] = useState(initialPhone);
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');

  // Auto-search if phone number is provided
  useEffect(() => {
    if (initialPhone) {
      fetchBookingsByPhone(initialPhone);
    }
  }, [initialPhone]);

  const fetchBookingsByPhone = async (phoneToQuery) => {
    const cleanNumber = (phoneToQuery || phone || '').trim();
    if (!cleanNumber) {
      setError('กรุณากรอกเบอร์โทรศัพท์มือถือ');
      return;
    }

    setLoading(true);
    setError('');
    setHasSearched(true);

    try {
      const res = await fetch(`${API_BASE}/api/public/bookings/by-phone?phone=${encodeURIComponent(cleanNumber)}`);
      const data = await res.json();

      if (res.ok && data.success && data.bookings?.length) {
        setBookings(data.bookings);
      } else {
        setError(data.error || 'ไม่พบประวัติการจองสำหรับเบอร์โทรศัพท์นี้');
        setBookings([]);
      }
    } catch (err) {
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = (e) => {
    e.preventDefault();
    fetchBookingsByPhone(phone);
  };

  const getStatusBadge = (status, hasSlip) => {
    if (status === 'paid') {
      return (
        <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', padding: '4px 10px', borderRadius: '20px', fontSize: '0.74rem', fontWeight: 800, border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          ✅ อนุมัติ & ชำระแล้ว
        </span>
      );
    }
    if (status === 'reviewing' || hasSlip) {
      return (
        <span style={{ backgroundColor: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', padding: '4px 10px', borderRadius: '20px', fontSize: '0.74rem', fontWeight: 800, border: '1px solid rgba(14, 165, 233, 0.3)' }}>
          ⏳ รอตรวจสอบสลิป
        </span>
      );
    }
    if (status === 'cancelled') {
      return (
        <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', padding: '4px 10px', borderRadius: '20px', fontSize: '0.74rem', fontWeight: 800, border: '1px solid rgba(239, 68, 68, 0.3)' }}>
          ❌ ยกเลิกการจอง
        </span>
      );
    }
    return (
      <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#d97706', padding: '4px 10px', borderRadius: '20px', fontSize: '0.74rem', fontWeight: 800, border: '1px solid rgba(245, 158, 11, 0.3)' }}>
        ⚠️ รอชำระเงิน
      </span>
    );
  };

  return (
    <div className="main-content" style={{ maxWidth: '680px' }}>
      {/* Top Back Navigation */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className="btn-secondary"
        style={{ width: 'auto', marginBottom: '16px', height: '40px', fontSize: '0.84rem' }}
      >
        <ArrowLeft size={16} />
        <span>กลับหน้าหลักจองห้องประชุม</span>
      </button>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-main)', margin: 0 }}>
          🔍 ตรวจสอบสถานะการจองห้องประชุม
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
          กรอกเบอร์โทรศัพท์ที่ใช้ทำการจอง เพื่อตรวจสอบสถานะและดูรหัสผ่านเปิดห้อง
        </p>
      </div>

      {/* Search Input Card */}
      <div className="booking-card" style={{ padding: '20px' }}>
        <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="form-label">
              📱 เบอร์โทรศัพท์มือถือที่ใช้ทำการจอง
            </label>
            <input
              type="tel"
              inputMode="numeric"
              required
              placeholder="เช่น 0812345678"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="form-input"
            />
          </div>

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

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
          >
            <Search size={18} />
            <span>{loading ? 'กำลังตรวจสอบข้อมูล...' : 'ตรวจสอบสถานะ'}</span>
          </button>
        </form>
      </div>

      {/* Results List */}
      {hasSearched && bookings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-muted)' }}>
            พบรายการจองทั้งหมด {bookings.length} รายการ:
          </div>

          {bookings.map(item => {
            const bookingCode = item.bookingCode || `BK-${String(item.id).padStart(6, '0')}`;
            const isPaid = item.payment_status === 'paid';
            const isPending = item.payment_status === 'pending' || item.payment_status === 'unpaid';

            return (
              <div 
                key={item.id} 
                className="booking-card"
                style={{
                  padding: '20px',
                  borderLeft: `5px solid ${isPaid ? '#10b981' : isPending ? '#f59e0b' : '#0284c7'}`
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '12px' }}>
                  <div>
                    <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--primary)' }}>
                      #{bookingCode}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      ({item.room_name})
                    </span>
                  </div>
                  {getStatusBadge(item.payment_status, !!item.slip_image_url)}
                </div>

                {/* Details */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  <div>
                    วันที่: <strong style={{ color: 'var(--text-main)' }}>{item.start_time?.split('T')[0] || item.start_time?.split(' ')[0]}</strong>
                  </div>
                  <div>
                    เวลา: <strong style={{ color: 'var(--text-main)' }}>
                      {new Date(item.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(item.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                    </strong>
                  </div>
                  <div>
                    ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{item.customer_name}</strong> ({item.customer_contact})
                  </div>
                  <div>
                    ยอดเงิน: <strong style={{ color: 'var(--primary)' }}>฿{Number(item.total_amount || 0).toLocaleString()}</strong>
                  </div>
                </div>

                {/* PIN Code Box (if paid) */}
                {isPaid && item.door_pin && (
                  <div style={{
                    marginTop: '14px',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Key size={18} style={{ color: '#10b981' }} />
                      <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#047857' }}>
                        รหัสผ่านเปิดประตูห้อง (Door PIN):
                      </span>
                    </div>
                    <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#047857', letterSpacing: '2px', fontFamily: 'monospace' }}>
                      {item.door_pin}
                    </span>
                  </div>
                )}

                {/* Action to go to payment if pending */}
                {isPending && !item.slip_image_url && (
                  <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => navigate(`/confirm?id=${item.id}`)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--primary)',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      <Upload size={14} />
                      <span>แนบสลิปชำระเงิน</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
