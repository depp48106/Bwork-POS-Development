import React, { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

export default function BookingFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  
  if (!location.state || !location.state.room) {
    return <Navigate to="/" />;
  }

  const { room, date, startTime, endTime, guests, hours, bookingType, layoutType } = location.state;
  const isHalfDay = bookingType === 'halfday';
  const isDaily = bookingType === 'daily';

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const calcHours = () => {
    if (hours) return hours;
    const [h1, m1] = startTime.split(':').map(Number);
    const [h2, m2] = endTime.split(':').map(Number);
    return Math.max(1, Math.ceil(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60));
  };
  
  const duration = calcHours();
  const totalPrice = location.state.totalPrice || (isHalfDay
    ? (room.half_day_rate > 0 ? room.half_day_rate : (room.hourly_rate * 4))
    : isDaily
      ? (room.daily_rate > 0 ? room.daily_rate : (room.hourly_rate * 9))
      : (duration * room.hourly_rate));

  const getBookingTypeLabel = () => {
    if (isHalfDay) return `เหมาครึ่งวัน (${startTime} - ${endTime} น.)`;
    if (isDaily) return `เหมาเต็มวัน (${startTime} - ${endTime} น.)`;
    return `รายชั่วโมง (${startTime} - ${endTime} น.) (${duration} ชม.)`;
  };

  const formatDateDisplay = (dStr) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayStr = String(d).padStart(2, '0');
    const monthStr = String(m).padStart(2, '0');
    const thaiYear = y + 543;
    const fullText = dateObj.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${dayStr}/${monthStr}/${thaiYear} (${fullText})`;
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleBackToRooms = () => {
    navigate(`/rooms?date=${date}&guests=${guests}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    
    // Re-check availability before submitting
    try {
      const schedRes = await fetch(`${API_BASE}/api/public/rooms/schedule?date=${date}`);
      if (schedRes.ok) {
        const schedData = await schedRes.json();
        const roomBookings = (schedData.rooms || []).find(r => r.id === room.id);
        if (roomBookings && roomBookings.bookings) {
          const reqStartMs = new Date(`${date}T${startTime}:00`).getTime();
          const reqEndMs = new Date(`${date}T${endTime}:00`).getTime();
          const hasOverlap = roomBookings.bookings.some(b => {
            const bStartMs = new Date(b.start_time).getTime();
            const bEndMs = new Date(b.end_time).getTime();
            return bStartMs < reqEndMs && bEndMs > reqStartMs;
          });
          if (hasOverlap) {
            setSubmitError('ขออภัย ห้องนี้ถูกจองไปแล้วในช่วงเวลาดังกล่าว กรุณากลับไปเลือกห้องและเวลาใหม่');
            setSubmitting(false);
            return;
          }
        }
      }
    } catch (checkErr) {
      // If re-check fails, proceed with submission (server will catch overlap)
      console.warn('Re-check availability failed, proceeding:', checkErr);
    }

    try {
      const payload = {
        customer_name: formData.name,
        contact: formData.phone,
        email: formData.email,
        department: formData.company,
        note: formData.notes,
        room_id: room.id,
        booking_date: date,
        start_time: startTime,
        end_time: endTime,
        booking_type: bookingType || 'hourly',
        layout: layoutType || 'standard',
        total_amount: totalPrice
      };

      const res = await fetch(`${API_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      
      if (res.ok && data.success) {
        navigate(`/confirm/${data.bookingId}`, { 
          state: { 
            booking: { 
              ...payload, 
              room, 
              id: data.bookingId,
              bookingCode: data.bookingCode,
              receiptNumber: data.receiptNumber,
              totalAmount: data.totalAmount,
              paymentDeadline: data.paymentDeadline
            } 
          } 
        });
      } else {
        setSubmitError(data.error || 'เกิดข้อผิดพลาดในการจอง กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      setSubmitError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่อ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-transition" style={{ maxWidth: '800px', margin: '0 auto' }}>
      
      {/* Top Back Navigation Bar */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button 
          onClick={handleBackToRooms} 
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
          &larr; ย้อนกลับไปเลือกห้องประชุม
        </button>
      </div>

      {/* Hero Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ color: 'var(--primary)', fontSize: '2.2rem', margin: '0 0 0.25rem 0', fontWeight: 'bold' }}>B-WORK</h1>
        <h2 style={{ margin: '0 0 0.4rem 0', fontSize: '1.25rem' }}>กรอกข้อมูลผู้จอง / Customer Information</h2>
      </div>

      {/* Progress Step Indicator (Step 3 Active) */}
      <StepProgress currentStep={3} />

      {/* Form Error Banner */}
      {submitError && (
        <div className="glass-card" style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', marginBottom: '1.5rem', borderRadius: '10px' }}>
          <strong>เกิดข้อผิดพลาด:</strong> {submitError}
        </div>
      )}

      <div className="booking-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.5rem' }}>
        
        {/* Left Column: Summary Card */}
        <div>
          <div className="glass-card" style={{ padding: '1.5rem', position: 'sticky', top: '20px' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: 'var(--primary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              สรุปรายการจอง / Summary
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.9rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ห้องประชุม:</span>
                <div style={{ fontWeight: 'bold', fontSize: '1.05rem', color: 'var(--text-dark)' }}>{room.name}</div>
              </div>

              {layoutType && room.has_classroom === 1 && (
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>รูปแบบจัดห้อง:</span>
                  <div style={{ fontWeight: 600, color: layoutType === 'classroom' ? '#ec4899' : 'var(--primary)' }}>
                    {layoutType === 'classroom' ? 'Classroom (แบบห้องเรียน)' : 'Standard (แบบมาตรฐาน)'}
                  </div>
                </div>
              )}

              <div>
                <span style={{ color: 'var(--text-muted)' }}>วันที่ใช้งาน:</span>
                <div style={{ fontWeight: 600 }}>{formatDateDisplay(date)}</div>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)' }}>รูปแบบ &amp; เวลา:</span>
                <div style={{ fontWeight: 600 }}>
                  {getBookingTypeLabel()}
                </div>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)' }}>จำนวนผู้เข้าประชุม:</span>
                <div style={{ fontWeight: 600 }}>{guests} ท่าน</div>
              </div>

              <div style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1.5px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>ยอดชำระสุทธิ:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                  ฿{totalPrice.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Customer Details Form */}
        <div>
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1.25rem 0', fontSize: '1.1rem', color: 'var(--text-dark)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              ข้อมูลผู้ติดต่อ / Customer Details
            </h3>

            <form onSubmit={handleSubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">ชื่อ-นามสกุล / Full Name <span style={{ color: 'red' }}>*</span></label>
                <input 
                  type="text" 
                  name="name" 
                  className="form-control" 
                  required 
                  value={formData.name} 
                  onChange={handleChange}
                  placeholder="เช่น สมชาย ใจดี"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">เบอร์โทรศัพท์ / Phone Number <span style={{ color: 'red' }}>*</span></label>
                <input 
                  type="tel" 
                  name="phone" 
                  className="form-control" 
                  required 
                  value={formData.phone} 
                  onChange={handleChange}
                  placeholder="เช่น 0812345678"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">อีเมล / Email (ถ้ามี)</label>
                <input 
                  type="email" 
                  name="email" 
                  className="form-control" 
                  value={formData.email} 
                  onChange={handleChange}
                  placeholder="name@company.com"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">บริษัท/แผนก / Company (ถ้ามี)</label>
                <input 
                  type="text" 
                  name="company" 
                  className="form-control" 
                  value={formData.company} 
                  onChange={handleChange}
                  placeholder="เช่น บริษัท บิลท์ ฮาร์ท จำกัด"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">หมายเหตุเพิ่มเติม / Notes (ถ้ามี)</label>
                <textarea 
                  name="notes" 
                  className="form-control" 
                  rows="2" 
                  value={formData.notes} 
                  onChange={handleChange}
                  placeholder="เช่น ต้องการเก้าอี้เพิ่ม หรือจัดห้องพิเศษ"
                ></textarea>
              </div>
              
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={submitting}
                style={{ width: '100%', padding: '0.9rem', fontSize: '1rem', fontWeight: 'bold' }}
              >
                {submitting ? 'กำลังบันทึกข้อมูล...' : 'ยืนยันการจอง & ไปชำระเงิน'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
