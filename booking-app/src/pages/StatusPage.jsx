import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, AlertCircle, ArrowLeft, Upload, CheckCircle2, Clock, XCircle, Calendar, Download, Check, CreditCard } from 'lucide-react';
import { API_BASE } from '../apiConfig';
import { generateGoogleCalendarUrl, downloadIcsFile } from '../utils/calendarUtils';
import { calcPaymentTimeLeft } from '../utils/paymentCountdown';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const formatThaiDate = (dateStr) => {
  if (!dateStr) return '-';
  const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.split(' ')[0];
  const [y, m, d] = clean.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
};

const formatThaiDateTime = (dateTimeStr) => {
  if (!dateTimeStr) return '-';
  const clean = dateTimeStr.replace('T', ' ');
  const parts = clean.split(' ');
  const datePart = formatThaiDate(parts[0]);
  const timePart = parts[1] ? parts[1].substring(0, 5) + ' น.' : '';
  return `${datePart} ${timePart}`.trim();
};

export default function StatusPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const fetchBookingsByPhone = async (phoneNumber) => {
    const clean = phoneNumber.replace(/\D/g, '');
    if (!clean || clean.length < 9) {
      setError('กรุณากรอกเบอร์โทรศัพท์มือถือให้ถูกต้อง (อย่างน้อย 9-10 หลัก)');
      return;
    }

    setLoading(true);
    setError('');
    setHasSearched(true);

    try {
      const res = await fetch(`${API_BASE}/api/public/bookings/by-phone?phone=${encodeURIComponent(clean)}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setBookings(data.bookings || []);
        if (!data.bookings || data.bookings.length === 0) {
          setError('ไม่พบรายการจองสำหรับเบอร์โทรศัพท์นี้');
        }
      } else {
        setError(data.error || 'ไม่พบรายการจองสำหรับเบอร์โทรศัพท์นี้');
        setBookings([]);
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = (e) => {
    e.preventDefault();
    fetchBookingsByPhone(phone);
  };

  const getStatusBadge = (status, hasSlip, isExpired) => {
    const s = String(status || '').toLowerCase();
    if (s === 'rejected') {
      return (
        <span style={{
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          color: '#d97706',
          padding: '5px 12px',
          borderRadius: '20px',
          fontSize: '0.76rem',
          fontWeight: 800,
          border: '1px solid rgba(245, 158, 11, 0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <AlertCircle size={13} />
          <span>สลิปไม่ผ่าน (กรุณาแนบใหม่)</span>
        </span>
      );
    }
    if (s === 'paid') {
      return (
        <span style={{
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          color: '#059669',
          padding: '5px 12px',
          borderRadius: '20px',
          fontSize: '0.76rem',
          fontWeight: 800,
          border: '1px solid rgba(16, 185, 129, 0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <CheckCircle2 size={13} />
          <span>อนุมัติ & ชำระแล้ว</span>
        </span>
      );
    }
    if (s === 'reviewing' || (hasSlip && s !== 'paid' && s !== 'cancelled')) {
      return (
        <span style={{
          backgroundColor: 'rgba(14, 165, 233, 0.12)',
          color: '#0284c7',
          padding: '5px 12px',
          borderRadius: '20px',
          fontSize: '0.76rem',
          fontWeight: 800,
          border: '1px solid rgba(14, 165, 233, 0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <Clock size={13} />
          <span>กำลังตรวจสอบการชำระเงิน</span>
        </span>
      );
    }
    if (s === 'cancelled' || isExpired) {
      return (
        <span style={{
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          color: '#ef4444',
          padding: '5px 12px',
          borderRadius: '20px',
          fontSize: '0.76rem',
          fontWeight: 800,
          border: '1px solid rgba(239, 68, 68, 0.3)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          <XCircle size={13} />
          <span>{s === 'cancelled' ? 'ยกเลิกการจอง' : 'หมดเวลาชำระเงิน'}</span>
        </span>
      );
    }
    return (
      <span style={{
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
        color: '#d97706',
        padding: '5px 12px',
        borderRadius: '20px',
        fontSize: '0.76rem',
        fontWeight: 800,
        border: '1px solid rgba(245, 158, 11, 0.3)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px'
      }}>
        <AlertCircle size={13} />
        <span>รอชำระเงิน</span>
      </span>
    );
  };

  return (
    <div className="main-content" style={{ maxWidth: '680px' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-container">
          <Check size={18} style={{ color: '#10b981' }} />
          <span>{toastMessage}</span>
        </div>
      )}

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
          ตรวจสอบสถานะการจองห้องประชุม
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
          กรอกเบอร์โทรศัพท์ที่ใช้ทำการจอง เพื่อตรวจสอบสถานะและรายละเอียดการจอง
        </p>
      </div>

      {/* Search Input Card */}
      <div className="booking-card" style={{ padding: '20px' }}>
        <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="form-label">
              เบอร์โทรศัพท์มือถือที่ใช้ทำการจอง
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
            const bookingCode = item.receipt_number || item.bookingCode || `BK-${String(item.id).padStart(6, '0')}`;
            const isPaid = item.payment_status === 'paid';
            const isCancelled = item.payment_status === 'cancelled';
            const isRejected = item.payment_status === 'rejected';
            const isPending = !isPaid && !isCancelled && !isRejected && (item.payment_status === 'pending' || item.payment_status === 'unpaid' || !item.payment_status);
            const timeLeft = isPending ? calcPaymentTimeLeft(item, 15, Date.now()) : null;
            const isExpiredLocally = isPending && Boolean(timeLeft?.isExpired);

            const usageDateStr = item.usage_date || (item.items && item.items[0]?.start_time?.split('T')[0]) || item.created_at?.split(' ')[0];
            const startTimeStr = item.start_time || (item.items && item.items[0]?.start_time?.includes('T') ? item.items[0].start_time.split('T')[1].substring(0, 5) : '08:00');
            const endTimeStr = item.end_time || (item.items && item.items[0]?.end_time?.includes('T') ? item.items[0].end_time.split('T')[1].substring(0, 5) : '17:00');
            const createdDateStr = item.created_date || item.created_at;
            const roomName = item.room_name || (item.items && item.items[0]?.room_name) || 'ห้องประชุม';

            const bookingForCalendar = isPaid ? {
              ...item,
              id: item.id,
              booking_code: bookingCode,
              room_name: roomName,
              date: usageDateStr,
              start_time: startTimeStr,
              end_time: endTimeStr
            } : null;
            const googleCalendarUrl = isPaid && bookingForCalendar ? generateGoogleCalendarUrl(bookingForCalendar) : null;

            return (
              <div
                key={item.id}
                className="booking-card"
                style={{
                  padding: '20px',
                  borderLeft: `5px solid ${isPaid ? '#10b981' : (isCancelled || isExpiredLocally) ? '#ef4444' : isRejected ? '#d97706' : isPending ? '#f59e0b' : '#0284c7'}`
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '12px' }}>
                  <div style={{ wordBreak: 'break-word', flex: '1 1 180px' }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.5px' }}>
                      {bookingCode.startsWith('BK-') ? bookingCode : `#${bookingCode}`}
                    </span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      ({roomName})
                    </span>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {getStatusBadge(item.payment_status, Boolean(item.has_slip), isExpiredLocally)}
                  </div>
                </div>

                {/* Details Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.84rem', color: 'var(--text-muted)' }}>

                  {/* วันที่เข้าใช้งาน */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ minWidth: '90px', color: '#64748b' }}>วันที่เข้าใช้งาน:</span>
                    <strong style={{ color: '#0f172a', fontSize: '0.88rem', wordBreak: 'break-word' }}>
                      {formatThaiDate(usageDateStr)}
                    </strong>
                  </div>

                  {/* เวลาที่ใช้บริการ */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ minWidth: '90px', color: '#64748b' }}>เวลาที่ใช้บริการ:</span>
                    <strong style={{ color: '#0284c7', fontSize: '0.88rem', wordBreak: 'break-word' }}>
                      {startTimeStr} - {endTimeStr} น.
                    </strong>
                  </div>

                  {/* วันที่ทำรายการจอง */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ minWidth: '90px', color: '#64748b' }}>วันที่จอง:</span>
                    <span style={{ color: '#334155', wordBreak: 'break-word' }}>
                      {formatThaiDateTime(createdDateStr)}
                    </span>
                  </div>

                  {/* ผู้จอง */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ minWidth: '90px', color: '#64748b' }}>ชื่อผู้จอง:</span>
                    <span style={{ color: '#334155', wordBreak: 'break-word' }}>
                      {item.customer_name} ({item.contact || item.customer_contact})
                    </span>
                  </div>

                  {/* ยอดเงิน */}
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '4px', paddingTop: '6px', borderTop: '1px dashed var(--border)' }}>
                    <span style={{ minWidth: '90px', color: '#64748b' }}>ยอดชำระ:</span>
                    <strong style={{ color: 'var(--primary)', fontSize: '1rem' }}>
                      ฿{Number(item.total_amount || 0).toLocaleString()}
                    </strong>
                  </div>
                </div>

                {/* Reception Contact Box (if paid) */}
                {isPaid && (
                  <div style={{
                    marginTop: '14px',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(14, 165, 233, 0.08)',
                    border: '1px solid rgba(14, 165, 233, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ fontSize: '1.2rem' }}>🔑</span>
                    <div style={{ fontSize: '0.8rem', color: '#0369a1' }}>
                      <strong>การรับรหัสเข้าห้อง:</strong> กรุณาติดต่อเคาน์เตอร์ประชาสัมพันธ์ (ชั้น 3) เมื่อถึงเวลาใช้งาน เจ้าหน้าที่จะทำการส่งรหัส PIN ปลดล็อกประตูให้ท่านครับ
                    </div>
                  </div>
                )}

                {/* Calendar Actions (if paid) */}
                {isPaid && googleCalendarUrl && (
                  <div style={{
                    marginTop: '12px',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    backgroundColor: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b', fontSize: '0.82rem', fontWeight: 800 }}>
                      <Calendar size={16} style={{ color: 'var(--primary)' }} />
                      <span>บันทึกการจองลงในปฏิทินของคุณ</span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <a
                        href={googleCalendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          flex: '1 1 150px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          backgroundColor: '#ffffff',
                          color: '#1e40af',
                          border: '1.5px solid #bfdbfe',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          textDecoration: 'none',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Calendar size={14} />
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
                          flex: '1 1 140px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          backgroundColor: '#f8fafc',
                          color: '#334155',
                          border: '1.5px solid #cbd5e1',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Download size={14} />
                        <span>ดาวน์โหลดปฏิทิน (.ics)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Action to resume payment if pending and not expired */}
                {isPending && !item.has_slip && !isExpiredLocally && (
                  <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.setItem(`bwork_booking_access_${item.id}`, JSON.stringify({ contact: phone }));
                        navigate(`/confirm?id=${item.id}&code=${encodeURIComponent(bookingCode)}`);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '9px 18px',
                        borderRadius: '10px',
                        backgroundColor: '#0284c7',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: '0.84rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <CreditCard size={15} />
                      <span>ดำเนินการชำระเงินต่อ</span>
                    </button>
                  </div>
                )}

                {/* Notice if pending but expired locally */}
                {isPending && !item.has_slip && isExpiredLocally && (
                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 700 }}>
                      หมดเวลาชำระเงินแล้ว (กรุณาทำรายการจองใหม่)
                    </span>
                  </div>
                )}

                {/* Action to re-upload if rejected */}
                {isRejected && (
                  <div style={{ marginTop: '14px' }}>
                    <div style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      fontSize: '0.82rem',
                      color: '#b45309',
                      marginBottom: '10px'
                    }}>
                      <strong>สลิปการโอนเงินไม่ผ่านการตรวจสอบ:</strong>
                      <div style={{ marginTop: '2px', color: '#92400e' }}>
                        {item.rejection_reason || 'กรุณาแนบสลิปใหม่ที่มีการโอนเงินถูกต้อง'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.setItem(`bwork_booking_access_${item.id}`, JSON.stringify({ contact: phone }));
                          navigate(`/confirm?id=${item.id}&code=${encodeURIComponent(bookingCode)}`);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '9px 18px',
                          borderRadius: '10px',
                          backgroundColor: '#d97706',
                          color: '#ffffff',
                          border: 'none',
                          fontSize: '0.84rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          boxShadow: '0 2px 6px rgba(217, 119, 6, 0.3)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Upload size={15} />
                        <span>อัปโหลดสลิปใหม่</span>
                      </button>
                    </div>
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
