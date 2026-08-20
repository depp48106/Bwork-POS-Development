import React, { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

export default function BookingFormPage() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Safe state retrieval from location or persistent sessionStorage
  const savedState = (() => {
    try {
      return JSON.parse(sessionStorage.getItem('current_booking_selection') || 'null');
    } catch (e) {
      return null;
    }
  })();

  const bookingState = location.state || savedState;

  if (!bookingState || !bookingState.room) {
    return <Navigate to="/" />;
  }

  const { room, date, startTime, endTime, guests, hours, bookingType, layoutType } = bookingState;
  const isHalfDay = bookingType === 'halfday';
  const isDaily = bookingType === 'daily';

  const [formData, setFormData] = useState({
    name: localStorage.getItem('line_user_name') || sessionStorage.getItem('line_user_name') || '',
    phone: '',
    email: '',
    company: '',
    notes: ''
  });
  const [lineUserId, setLineUserId] = useState(
    localStorage.getItem('line_user_id') || sessionStorage.getItem('line_user_id') || ''
  );
  const [lineUserName, setLineUserName] = useState(
    localStorage.getItem('line_user_name') || sessionStorage.getItem('line_user_name') || ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Tax Invoice State
  const [requireTaxInvoice, setRequireTaxInvoice] = useState(false);
  const [taxData, setTaxData] = useState({
    taxName: '',
    taxAddress: '',
    taxId: '',
    taxPhone: '',
    taxDeliveryMethod: 'email', // 'email' | 'postal' | 'pickup'
    taxPostalAddress: '',
    sameAsBillingAddress: false
  });

  const handleTaxChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === 'checkbox' && name === 'sameAsBillingAddress') {
      setTaxData(prev => ({
        ...prev,
        sameAsBillingAddress: checked,
        taxPostalAddress: checked ? prev.taxAddress : ''
      }));
    } else {
      setTaxData(prev => {
        const next = { ...prev, [name]: value };
        if (name === 'taxAddress' && prev.sameAsBillingAddress) {
          next.taxPostalAddress = value;
        }
        return next;
      });
    }
  };

  // Sync LIFF profile on mount or when LIFF becomes ready
  React.useEffect(() => {
    const syncProfile = async () => {
      try {
        const storedId = localStorage.getItem('line_user_id') || sessionStorage.getItem('line_user_id');
        const storedName = localStorage.getItem('line_user_name') || sessionStorage.getItem('line_user_name');
        if (storedId) setLineUserId(storedId);
        if (storedName) {
          setLineUserName(storedName);
          setFormData(prev => ({ ...prev, name: prev.name || storedName }));
        }

        if (window.liff) {
          if (!window.liff.isLoggedIn()) {
            // If inside LINE client, trigger login automatically
            if (window.liff.isInClient && window.liff.isInClient()) {
              window.liff.login();
            }
          } else {
            const profile = await window.liff.getProfile();
            if (profile && profile.userId) {
              setLineUserId(profile.userId);
              localStorage.setItem('line_user_id', profile.userId);
              sessionStorage.setItem('line_user_id', profile.userId);
              if (profile.displayName) {
                setLineUserName(profile.displayName);
                localStorage.setItem('line_user_name', profile.displayName);
                sessionStorage.setItem('line_user_name', profile.displayName);
                setFormData(prev => ({ ...prev, name: prev.name || profile.displayName }));
              }
            }
          }
        }
      } catch (e) {
        console.warn('LIFF sync error:', e);
      }
    };
    syncProfile();
  }, []);

  const handleLineLogin = () => {
    if (window.liff) {
      window.liff.login();
    } else {
      window.location.href = 'https://liff.line.me/2011136579-c1TeSWNs';
    }
  };

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

  const handleToggleTax = (e) => {
    const isChecked = e.target.checked;
    setRequireTaxInvoice(isChecked);
    if (isChecked) {
      setTaxData(prev => ({
        ...prev,
        taxName: prev.taxName || formData.company || formData.name || '',
        taxPhone: prev.taxPhone || formData.phone || ''
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    
    // Validate past time before submitting
    const now = new Date();
    const [by, bm, bd] = date.split('-').map(Number);
    const [bsh, bsm] = startTime.split(':').map(Number);
    const bookingStart = new Date(by, bm - 1, bd, bsh, bsm);
    if (bookingStart.getTime() < now.getTime() - 2 * 60 * 1000) {
      setSubmitError('ขออภัย ช่วงเวลาที่คุณเลือกได้ผ่านไปแล้ว กรุณากลับไปเลือกช่วงเวลาใหม่');
      setSubmitting(false);
      return;
    }

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
            const bStartMs = new Date(String(b.start_time).replace(' ', 'T')).getTime();
            const bEndMs = new Date(String(b.end_time).replace(' ', 'T')).getTime();
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
      let effectiveLineUserId = lineUserId || localStorage.getItem('line_user_id') || sessionStorage.getItem('line_user_id') || '';
      if (!effectiveLineUserId && window.liff) {
        try {
          if (window.liff.isLoggedIn()) {
            const profile = await window.liff.getProfile();
            if (profile && profile.userId) {
              effectiveLineUserId = profile.userId;
              localStorage.setItem('line_user_id', profile.userId);
            }
          }
        } catch (liffErr) {
          console.warn('Direct LIFF fetch in submit:', liffErr);
        }
      }

      // Validate Tax Invoice if requested
      if (requireTaxInvoice) {
        if (!taxData.taxName.trim()) {
          setSubmitError('กรุณาระบุ ชื่อ-นามสกุล หรือชื่อบริษัท สำหรับออกใบกำกับภาษี');
          setSubmitting(false);
          return;
        }
        if (!taxData.taxAddress.trim()) {
          setSubmitError('กรุณาระบุ ที่อยู่สำหรับออกใบกำกับภาษี');
          setSubmitting(false);
          return;
        }
        if (!taxData.taxId.trim()) {
          setSubmitError('กรุณาระบุ เลขประจำตัวผู้เสียภาษี 13 หลัก');
          setSubmitting(false);
          return;
        }
        if (!taxData.taxPhone.trim()) {
          setSubmitError('กรุณาระบุ เบอร์โทรศัพท์สำหรับใบกำกับภาษี');
          setSubmitting(false);
          return;
        }
        if (taxData.taxDeliveryMethod === 'postal' && !taxData.taxPostalAddress.trim()) {
          setSubmitError('กรุณาระบุ ที่อยู่สำหรับจัดส่งเอกสารทางไปรษณีย์/จดหมาย');
          setSubmitting(false);
          return;
        }
      }

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
        total_amount: totalPrice,
        line_user_id: effectiveLineUserId || null,
        tax_invoice_required: requireTaxInvoice ? 1 : 0,
        tax_name: requireTaxInvoice ? taxData.taxName.trim() : null,
        tax_address: requireTaxInvoice ? taxData.taxAddress.trim() : null,
        tax_id: requireTaxInvoice ? taxData.taxId.trim() : null,
        tax_phone: requireTaxInvoice ? taxData.taxPhone.trim() : null,
        tax_delivery_method: requireTaxInvoice ? taxData.taxDeliveryMethod : null,
        tax_postal_address: (requireTaxInvoice && taxData.taxDeliveryMethod === 'postal') ? (taxData.taxPostalAddress.trim() || taxData.taxAddress.trim()) : null
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

            {/* LINE OA Connection Status Banner */}
            {lineUserId ? (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '10px', padding: '0.8rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: '#06C755', color: '#fff', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.8rem', flexShrink: 0 }}>
                  L
                </div>
                <div>
                  <div style={{ color: '#166534', fontWeight: 'bold', fontSize: '0.88rem' }}>
                    🟢 เชื่อมต่อ LINE สำเร็จ {lineUserName ? `(${lineUserName})` : ''}
                  </div>
                  <div style={{ color: '#15803d', fontSize: '0.75rem', marginTop: '2px' }}>
                    คุณจะได้รับข้อความยืนยันการจอง และรหัสผ่านเข้าห้องทาง LINE OA อัตโนมัติ
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.8rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#1e40af', fontWeight: 'bold', fontSize: '0.85rem' }}>
                    📲 ต้องการรับรหัสผ่านทาง LINE หรือไม่?
                  </div>
                  <div style={{ color: '#3b82f6', fontSize: '0.72rem', marginTop: '2px' }}>
                    เข้าสู่ระบบเพื่อรับการแจ้งเตือนยืนยันและรหัส PIN ผ่านแชท LINE OA
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLineLogin}
                  style={{
                    background: '#06C755',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: '0 2px 4px rgba(6,199,85,0.2)'
                  }}
                >
                  เข้าสู่ระบบด้วย LINE
                </button>
              </div>
            )}

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

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
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

              {/* Tax Invoice Request Card */}
              <div style={{
                marginBottom: '1.5rem',
                border: '1.5px solid ' + (requireTaxInvoice ? 'var(--primary)' : 'var(--border)'),
                borderRadius: '12px',
                padding: '1rem',
                backgroundColor: requireTaxInvoice ? 'rgba(37, 99, 235, 0.03)' : '#f8fafc',
                transition: 'all 0.2s'
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', cursor: 'pointer', userSelect: 'none', margin: 0 }}>
                  <input 
                    type="checkbox"
                    checked={requireTaxInvoice}
                    onChange={handleToggleTax}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--primary)', cursor: 'pointer' }}
                  />
                  <div>
                    <strong style={{ fontSize: '0.95rem', color: requireTaxInvoice ? 'var(--primary)' : 'var(--text-dark)' }}>
                      📄 ต้องการขอใบกำกับภาษี (Tax Invoice)
                    </strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      เลือกเมื่อต้องการใบกำกับภาษีเต็มรูปแบบในนามบุคคลหรือนิติบุคคล
                    </div>
                  </div>
                </label>

                {requireTaxInvoice && (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    
                    {/* Tax Name */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.825rem' }}>
                        ชื่อ-นามสกุล / ชื่อบริษัท (ตาม ภ.พ.20) <span style={{ color: 'red' }}>*</span>
                      </label>
                      <input 
                        type="text"
                        name="taxName"
                        className="form-control"
                        required={requireTaxInvoice}
                        value={taxData.taxName}
                        onChange={handleTaxChange}
                        placeholder="เช่น บริษัท ตัวอย่าง จำกัด หรือ นายสมชาย ใจดี"
                      />
                    </div>

                    {/* Tax ID & Phone (Side by Side) */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.825rem' }}>
                          เลขประจำตัวผู้เสียภาษี (13 หลัก) <span style={{ color: 'red' }}>*</span>
                        </label>
                        <input 
                          type="text"
                          name="taxId"
                          maxLength="13"
                          className="form-control"
                          required={requireTaxInvoice}
                          value={taxData.taxId}
                          onChange={handleTaxChange}
                          placeholder="เลข 13 หลัก"
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.825rem' }}>
                          เบอร์โทรศัพท์ <span style={{ color: 'red' }}>*</span>
                        </label>
                        <input 
                          type="tel"
                          name="taxPhone"
                          className="form-control"
                          required={requireTaxInvoice}
                          value={taxData.taxPhone}
                          onChange={handleTaxChange}
                          placeholder="เช่น 0812345678"
                        />
                      </div>
                    </div>

                    {/* Tax Address */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.825rem' }}>
                        ที่อยู่สำหรับออกใบกำกับภาษี (ที่อยู่ตาม ภ.พ.20) <span style={{ color: 'red' }}>*</span>
                      </label>
                      <textarea 
                        name="taxAddress"
                        className="form-control"
                        rows="2"
                        required={requireTaxInvoice}
                        value={taxData.taxAddress}
                        onChange={handleTaxChange}
                        placeholder="เลขที่, อาคาร/หมู่บ้าน, ถนน, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์"
                      ></textarea>
                    </div>

                    {/* Delivery Method Dropdown */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.825rem' }}>
                        ช่องทางการจัดส่งใบกำกับภาษี <span style={{ color: 'red' }}>*</span>
                      </label>
                      <select
                        name="taxDeliveryMethod"
                        className="form-control"
                        value={taxData.taxDeliveryMethod}
                        onChange={handleTaxChange}
                        style={{ fontWeight: 600, color: 'var(--primary)' }}
                      >
                        <option value="email">✉️ อีเมล / e-Tax Invoice (จัดส่งทางอีเมล)</option>
                        <option value="postal">📮 จัดส่งทางไปรษณีย์ / จดหมาย</option>
                        <option value="pickup">🏢 รับด้วยตนเองที่หน้าร้าน / สาขา</option>
                      </select>
                    </div>

                    {/* Conditional Postal Address */}
                    {taxData.taxDeliveryMethod === 'postal' && (
                      <div style={{
                        padding: '0.75rem',
                        borderRadius: '8px',
                        backgroundColor: '#ffffff',
                        border: '1px dashed #3b82f6',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label className="form-label" style={{ margin: 0, fontSize: '0.8rem', color: '#1e40af', fontWeight: 'bold' }}>
                            ที่อยู่จัดส่งเอกสารทางไปรษณีย์ / จดหมาย <span style={{ color: 'red' }}>*</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--primary)', cursor: 'pointer', margin: 0 }}>
                            <input 
                              type="checkbox"
                              name="sameAsBillingAddress"
                              checked={taxData.sameAsBillingAddress}
                              onChange={handleTaxChange}
                              style={{ width: '14px', height: '14px', accentColor: 'var(--primary)' }}
                            />
                            <span>ใช้ที่อยู่เดียวกับใบกำกับภาษี</span>
                          </label>
                        </div>
                        <textarea 
                          name="taxPostalAddress"
                          className="form-control"
                          rows="2"
                          required={taxData.taxDeliveryMethod === 'postal'}
                          value={taxData.taxPostalAddress}
                          onChange={handleTaxChange}
                          placeholder="ระบุชื่อผู้รับ และที่อยู่จัดส่งไปรษณีย์อย่างละเอียด..."
                        ></textarea>
                      </div>
                    )}

                  </div>
                )}
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
