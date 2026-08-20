import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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

  // Auto-search if phone number is provided in URL
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
        <span style={{ background: '#dcfce7', color: '#15803d', padding: '0.35rem 0.85rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, border: '1px solid #86efac' }}>
          ✅ ยืนยันการจองแล้ว
        </span>
      );
    }
    if (status === 'reviewing' || hasSlip) {
      return (
        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.35rem 0.85rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, border: '1px solid #bae6fd' }}>
          ⏳ รอพนักงานตรวจสอบสลิป
        </span>
      );
    }
    if (status === 'cancelled') {
      return (
        <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.35rem 0.85rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, border: '1px solid #fecaca' }}>
          ❌ ยกเลิกการจอง
        </span>
      );
    }
    return (
      <span style={{ background: '#fef3c7', color: '#b45309', padding: '0.35rem 0.85rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, border: '1px solid #fde68a' }}>
        ⚠️ รอชำระเงิน / แนบสลิป
      </span>
    );
  };

  const formatThaiDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const clean = dateStr.replace(' ', 'T').split('T')[0];
      const [y, m, d] = clean.split('-').map(Number);
      const months = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
      ];
      return `${d} ${months[m - 1]} ${y + 543}`;
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="page-transition" style={{ maxWidth: '580px', margin: '0 auto' }}>
      
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
        <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.6rem', color: 'var(--text-dark)', fontWeight: 800 }}>
          ตรวจสอบสถานะการจอง
        </h2>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
          กรอกเบอร์โทรศัพท์ที่ใช้จอง เพื่อเช็คข้อมูลและสถานะใบจองของคุณ
        </p>
      </div>

      {/* Check Form Card - Only Phone Input */}
      <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '16px' }}>
        <form onSubmit={handleCheck}>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#0f172a' }}>
              📱 เบอร์โทรศัพท์มือถือที่ใช้ทำการจอง
            </label>
            <input 
              type="tel" 
              inputMode="numeric"
              className="form-control" 
              value={phone} 
              onChange={(e) => {
                setPhone(e.target.value);
                setError('');
              }}
              placeholder="กรอกเบอร์โทรศัพท์ เช่น 0812345678"
              style={{ fontSize: '1.05rem', padding: '0.75rem 0.9rem', borderRadius: '10px' }}
              autoFocus
            />
          </div>
          
          {error && (
            <div style={{ color: '#ef4444', marginBottom: '1.25rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 600, backgroundColor: '#fef2f2', padding: '0.75rem', borderRadius: '10px', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}
          
          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={loading}
            style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 'bold', borderRadius: '10px' }}
          >
            {loading ? 'กำลังตรวจสอบข้อมูล...' : '🔍 ตรวจสอบสถานะการจอง'}
          </button>
        </form>
      </div>

      {/* Bookings Results List */}
      {hasSearched && bookings.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#475569', marginBottom: '0.75rem' }}>
            พบรายการจองทั้งหมด {bookings.length} รายการ:
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {bookings.map((booking) => {
              const bookingCode = booking.bookingCode || `BK-${String(booking.id).padStart(6, '0')}`;
              const isPaid = booking.payment_status === 'paid';
              const isPending = booking.payment_status === 'pending' || booking.payment_status === 'unpaid';
              const isReviewing = booking.payment_status === 'reviewing' || !!booking.slip_image_url;

              return (
                <div key={booking.id} className="glass-card page-transition" style={{ padding: '1.35rem', borderRadius: '16px', border: isPaid ? '1.5px solid #86efac' : '1.5px solid #cbd5e1' }}>
                  
                  {/* Top Header of Card */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem', flexWrap: 'wrap', gap: '6px' }}>
                    <div>
                      <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--primary)' }}>{bookingCode}</span>
                      {booking.receipt_number && booking.receipt_number !== bookingCode && (
                        <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '6px' }}>({booking.receipt_number})</span>
                      )}
                    </div>
                    {getStatusBadge(booking.payment_status, !!booking.slip_image_url)}
                  </div>
                  
                  {/* Details Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem', marginBottom: '1.1rem', fontSize: '0.9rem' }}>
                    <div><strong>ผู้จอง:</strong> <span style={{ color: '#0f172a' }}>{booking.customer_name || '-'}</span></div>
                    <div><strong>ห้องประชุม:</strong> <span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{booking.room_name || booking.items?.[0]?.room_name || '-'}</span></div>
                    <div><strong>วันที่ใช้งาน:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{formatThaiDate(booking.booking_date || booking.items?.[0]?.start_time)}</span></div>
                    <div><strong>ช่วงเวลา:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{booking.start_time || booking.items?.[0]?.start_time?.split('T')?.[1]?.substring(0,5) || '-'} - {booking.end_time || booking.items?.[0]?.end_time?.split('T')?.[1]?.substring(0,5) || '-'} น.</span></div>
                    <div><strong>ยอดสุทธิ:</strong> <span style={{ color: 'var(--primary)', fontWeight: 'bold', fontSize: '1.05rem' }}>฿{Number(booking.total_amount || 0).toLocaleString()}</span></div>
                  </div>

                  {/* Tax Invoice Info Badge */}
                  {booking.tax_invoice_required === 1 && (
                    <div style={{ padding: '0.65rem 0.85rem', backgroundColor: '#eff6ff', borderRadius: '10px', border: '1px solid #bfdbfe', fontSize: '0.8rem', color: '#1e40af', marginBottom: '1rem' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>📄 ขอใบกำกับภาษี:</div>
                      <div><strong>ชื่อผู้เสียภาษี:</strong> {booking.tax_name} (เลขผู้เสียภาษี: {booking.tax_id})</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '2px', color: '#3b82f6' }}>
                        <strong>ช่องทางจัดส่ง:</strong> {booking.tax_delivery_method === 'postal' ? `ส่งไปรษณีย์/จดหมาย (${booking.tax_postal_address || booking.tax_address})` : (booking.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'จัดส่งทางอีเมล')}
                      </div>
                    </div>
                  )}

                  {/* Notice Box */}
                  <div style={{
                    backgroundColor: isPaid ? '#f0fdf4' : '#f8fafc',
                    border: isPaid ? '1px solid #86efac' : '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                    marginBottom: isPending ? '1rem' : '0',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: isPaid ? '#15803d' : '#0f172a', marginBottom: '0.2rem' }}>
                      {isPaid ? '✅ การจองได้รับการยืนยันเรียบร้อยแล้ว' : isReviewing ? '⏳ พนักงานกำลังตรวจสอบสลิปโอนเงิน' : '⚠️ ยังไม่ได้ชำระเงินหรือยังไม่ได้แนบสลิป'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>
                      {isPaid 
                        ? 'เมื่อเดินทางมาถึงสถานที่ กรุณาติดต่อเคาน์เตอร์ประชาสัมพันธ์ เจ้าหน้าที่จะกดส่งรหัสผ่านเปิดประตูห้อง (Door PIN) เข้า LINE OA ของท่านทันทีค่ะ'
                        : isReviewing 
                          ? 'ระบบได้รับข้อมูลแล้ว เมื่อพนักงานตรวจสอบยอดเงินสำเร็จ ระบบจะส่งข้อความยืนยันการจองเข้า LINE OA ค่ะ'
                          : 'กรุณากดปุ่มด้านล่างเพื่อชำระเงินและอัปโหลดสลิปโอนเงิน เพื่อให้พนักงานทำการตรวจสอบค่ะ'}
                    </div>
                  </div>

                  {/* Button to Upload Slip if Pending */}
                  {isPending && !booking.slip_image_url && (
                    <Link 
                      to={`/confirm/${booking.id}`} 
                      state={{ booking }} 
                      className="btn btn-primary" 
                      style={{ display: 'block', textAlign: 'center', padding: '0.75rem', fontWeight: 'bold', borderRadius: '10px', marginTop: '0.85rem' }}
                    >
                      ไปหน้าชำระเงิน & แนบสลิป &rarr;
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
