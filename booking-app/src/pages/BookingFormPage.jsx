import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User, Phone, Mail, Building, FileText, CheckCircle2, 
  ArrowLeft, ChevronRight, ChevronDown, AlertCircle, ShieldCheck, CheckSquare, Square, MessageSquare, Send, Truck 
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

export default function BookingFormPage() {
  const navigate = useNavigate();
  const [bookingData, setBookingData] = useState(null);

  // Customer Form State
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');

  // LINE Profile State
  const [lineUserId, setLineUserId] = useState('');
  const [lineUserName, setLineUserName] = useState('');
  const [lineUserPic, setLineUserPic] = useState('');

  // Tax Invoice State
  const [needTaxInvoice, setNeedTaxInvoice] = useState(false);
  const [taxName, setTaxName] = useState('');
  const [taxAddress, setTaxAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [taxPhone, setTaxPhone] = useState('');
  const [taxDeliveryMethod, setTaxDeliveryMethod] = useState('online'); // 'online' | 'postal'
  const [taxPostalAddress, setTaxPostalAddress] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load payload and LIFF profile from sessionStorage / localStorage
  useEffect(() => {
    const raw = sessionStorage.getItem('current_booking_payload');
    if (!raw) {
      navigate('/');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setBookingData(parsed);
    } catch (e) {
      navigate('/');
      return;
    }

    // Check LINE LIFF Profile
    const savedLineId = sessionStorage.getItem('line_user_id') || localStorage.getItem('line_user_id') || '';
    const savedLineName = sessionStorage.getItem('line_user_name') || localStorage.getItem('line_user_name') || '';
    const savedLinePic = sessionStorage.getItem('line_user_pic') || localStorage.getItem('line_user_pic') || '';

    if (savedLineId) {
      setLineUserId(savedLineId);
      setLineUserName(savedLineName);
      setLineUserPic(savedLinePic);
      if (savedLineName && !name) {
        setName(savedLineName);
      }
    }
  }, []);

  const handleLineLogin = () => {
    try {
      if (window.liff) {
        if (!window.liff.isLoggedIn()) {
          window.liff.login();
        } else {
          window.liff.getProfile().then(p => {
            if (p) {
              setLineUserId(p.userId);
              setLineUserName(p.displayName);
              setLineUserPic(p.pictureUrl);
              setName(p.displayName);
            }
          });
        }
      }
    } catch (err) {
      console.warn('LINE login error:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('กรุณาระบุชื่อ-นามสกุล ผู้จอง');
      return;
    }
    if (!contact.trim()) {
      setError('กรุณาระบุเบอร์โทรศัพท์สำหรับติดต่อและรับรหัสผ่าน');
      return;
    }

    if (needTaxInvoice) {
      if (!taxName.trim()) {
        setError('กรุณาระบุชื่อผู้เสียภาษี / ชื่อบริษัท');
        return;
      }
      if (!taxAddress.trim()) {
        setError('กรุณาระบุที่อยู่ตาม ภ.พ.20');
        return;
      }
      if (!taxId.trim()) {
        setError('กรุณาระบุเลขประจำตัวผู้เสียภาษี 13 หลัก');
        return;
      }
      if (!taxPhone.trim() && !contact.trim()) {
        setError('กรุณาระบุเบอร์โทรศัพท์สำหรับใบกำกับภาษี');
        return;
      }
      if (taxDeliveryMethod === 'postal' && !taxPostalAddress.trim()) {
        setError('กรุณาระบุที่อยู่สำหรับจัดส่งเอกสารทางจดหมาย');
        return;
      }
    }

    setLoading(true);

    try {
      const payload = {
        room_id: bookingData.room_id,
        customer_name: name.trim(),
        contact: contact.trim(),
        email: email.trim(),
        department: company.trim(),
        booking_date: bookingData.date,
        start_time: bookingData.start_time,
        end_time: bookingData.end_time,
        booking_type: bookingData.booking_type || (bookingData.duration >= 8 ? 'daily' : (bookingData.duration === 4 && bookingData.half_day_rate > 0 ? 'halfday' : 'hourly')),
        layout: bookingData.layout || 'standard',
        guest_count: bookingData.guests || 1,
        total_amount: bookingData.total_amount || 0,
        note: notes.trim(),
        line_user_id: lineUserId,
        booking_channel: 'line_oa',
        customer_type: 'general',
        tax_invoice_required: needTaxInvoice ? 1 : 0,
        tax_name: needTaxInvoice ? taxName.trim() : null,
        tax_address: needTaxInvoice ? taxAddress.trim() : null,
        tax_id: needTaxInvoice ? taxId.trim() : null,
        tax_phone: needTaxInvoice ? (taxPhone.trim() || contact.trim()) : null,
        tax_delivery_method: needTaxInvoice ? taxDeliveryMethod : null,
        tax_postal_address: needTaxInvoice && taxDeliveryMethod === 'postal' ? taxPostalAddress.trim() : null
      };

      const res = await fetch(`${API_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const finalBookingId = data.booking_id || data.bookingId || data.id;
        const finalBookingCode = data.receipt_number || data.receiptNumber || data.booking_code || data.bookingCode || (finalBookingId ? `BK-${String(finalBookingId).padStart(6, '0')}` : '');

        // Save current booking confirmation
        const deadline = data.paymentDeadline || (data.payment_window_minutes ? new Date(Date.now() + (parseInt(data.payment_window_minutes, 10) || 15) * 60 * 1000).toISOString() : null);
        const windowMins = parseInt(data.payment_window_minutes, 10) || 15;

        sessionStorage.setItem('completed_booking_result', JSON.stringify({
          ...bookingData,
          booking_id: finalBookingId,
          booking_code: finalBookingCode,
          receipt_number: data.receipt_number || data.receiptNumber,
          paymentDeadline: deadline,
          payment_window_minutes: windowMins,
          customer_name: name.trim(),
          customer_contact: contact.trim(),
          line_user_id: lineUserId
        }));
        localStorage.setItem('bwork_pending_booking', JSON.stringify({
          id: finalBookingId,
          code: finalBookingCode,
          roomName: bookingData?.room?.name || 'ห้องประชุม',
          totalAmount: bookingData?.totalPrice || bookingData?.total_amount || 0,
          paymentDeadline: deadline,
          paymentWindowMinutes: windowMins,
          createdAt: Date.now(),
          status: 'pending'
        }));
        navigate(`/confirm?id=${finalBookingId}&code=${encodeURIComponent(finalBookingCode)}`);
      } else {
        setError(data.error || 'ไม่สามารถทำรายการจองได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!bookingData) return null;

  return (
    <div className="main-content">
      <StepProgress currentStep={3} />

      <div className="booking-form-grid">
        {/* LEFT COLUMN: STICKY BOOKING SUMMARY CARD */}
        <div className="booking-card" style={{ position: 'sticky', top: '80px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', marginBottom: '8px' }}>
            สรุปรายการจอง
          </div>

          {bookingData.image_url && (
            <div style={{ borderRadius: '12px', overflow: 'hidden', height: '140px', marginBottom: '12px' }}>
              <img src={bookingData.image_url} alt={bookingData.room_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}

          <h3 style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-main)', margin: '0 0 6px 0' }}>
            {bookingData.room_name}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.84rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>วันที่:</span>
              <strong style={{ color: 'var(--text-main)' }}>
                {bookingData.date ? bookingData.date.split('-').reverse().join('/') : '-'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ช่วงเวลา:</span>
              <strong style={{ color: 'var(--text-main)' }}>{bookingData.start_time} - {bookingData.end_time} น.</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ระยะเวลา:</span>
              <strong style={{ color: 'var(--primary)' }}>
                {bookingData.duration} ชั่วโมง {bookingData.booking_type === 'hourly' && bookingData.duration % 1 !== 0 ? `(คิดราคา ${Math.ceil(bookingData.duration)} ชม.)` : ''} ({bookingData.rate_label || 'รายชั่วโมง'})
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>จำนวนผู้เข้าใช้:</span>
              <strong style={{ color: 'var(--text-main)' }}>{bookingData.guests} ท่าน</strong>
            </div>
            {bookingData.layout && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>รูปแบบจัดโต๊ะ:</span>
                <strong style={{ color: 'var(--text-main)', textTransform: 'capitalize' }}>{bookingData.layout}</strong>
              </div>
            )}
          </div>

          {/* Total Amount Box */}
          <div style={{
            marginTop: '16px',
            padding: '12px 14px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-page)',
            border: '1.5px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดชำระสุทธิ</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--primary)' }}>
                ฿{Number(bookingData.total_amount).toLocaleString()}
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, backgroundColor: 'rgba(37,99,235,0.1)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '6px' }}>
              รวมภาษีแล้ว
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: CUSTOMER DETAILS FORM */}
        <div className="booking-card">
          <div style={{ marginBottom: '18px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
              3. ข้อมูลผู้จองและช่องทางติดต่อ
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              กรุณากรอกข้อมูลสำหรับยืนยันและรับรหัสผ่านเข้าห้องประชุม
            </p>
          </div>

          {/* LINE 1-CLICK AUTOFILL BANNER */}
          <div style={{
            padding: '14px',
            borderRadius: '14px',
            backgroundColor: 'rgba(6, 199, 85, 0.08)',
            border: '1.5px solid rgba(6, 199, 85, 0.3)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {lineUserPic ? (
                <img src={lineUserPic} alt="LINE" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#06c755', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
                  <MessageSquare size={20} />
                </div>
              )}
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#047857' }}>
                  {lineUserName ? `ซิงค์กับ LINE: ${lineUserName}` : 'เชื่อมต่อด้วย LINE Official Account'}
                </div>
                <div style={{ fontSize: '0.74rem', color: '#065f46' }}>
                  {lineUserName ? 'ระบบจะส่งรหัสผ่านเปิดประตูเข้า LINE OA นี้อัตโนมัติ' : 'เพื่อรับรหัสผ่านเปิดประตูเข้าห้องประชุมอัตโนมัติ'}
                </div>
              </div>
            </div>

            {!lineUserName && (
              <button
                type="button"
                onClick={handleLineLogin}
                style={{
                  padding: '8px 14px',
                  borderRadius: '10px',
                  backgroundColor: '#06c755',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(6,199,85,0.3)'
                }}
              >
                + ล็อกอินด้วย LINE
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Full Name */}
            <div>
              <label className="form-label">
                ชื่อ - นามสกุล ผู้จอง <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  required
                  placeholder="เช่น คุณสมชาย ใจดี"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* Phone Number */}
            <div>
              <label className="form-label">
                เบอร์โทรศัพท์ (สำหรับติดต่อ & ส่ง SMS รหัสผ่าน) <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="tel"
                required
                placeholder="08x-xxx-xxxx"
                value={contact}
                onChange={e => {
                  setContact(e.target.value);
                  if (!taxPhone) setTaxPhone(e.target.value);
                }}
                className="form-input"
              />
            </div>

            {/* Email & Company (2 columns on desktop, 1 on mobile) */}
            <div className="form-grid-2col">
              <div>
                <label className="form-label">อีเมล (Email) - ไม่บังคับ</label>
                <input
                  type="email"
                  placeholder="example@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label">บริษัท / องค์กร - ไม่บังคับ</label>
                <input
                  type="text"
                  placeholder="ชื่อหน่วยงาน / บริษัท"
                  value={company}
                  onChange={e => {
                    setCompany(e.target.value);
                    if (!taxName) setTaxName(e.target.value);
                  }}
                  className="form-input"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="form-label">หมายเหตุเพิ่มเติม / ข้อความถึงเจ้าหน้าที่</label>
              <textarea
                rows="2"
                placeholder="เช่น ขอสาย HDMI เพิ่มเติม, เตรียมปลั๊กพ่วง ฯลฯ"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="form-input"
                style={{ height: 'auto', padding: '10px 14px', resize: 'vertical' }}
              />
            </div>

            {/* TAX INVOICE ACCORDION */}
            <div style={{
              border: '1.5px solid var(--border)',
              borderRadius: '14px',
              padding: '14px',
              backgroundColor: needTaxInvoice ? '#ffffff' : 'var(--bg-page)',
              boxShadow: needTaxInvoice ? 'var(--shadow-sm)' : 'none',
              transition: 'all 0.2s ease'
            }}>
              <div 
                onClick={() => setNeedTaxInvoice(!needTaxInvoice)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}
              >
                {needTaxInvoice ? (
                  <CheckSquare size={20} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                ) : (
                  <Square size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                )}
                <div>
                  <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)' }}>
                    ต้องการขอใบกำกับภาษี / ใบเสร็จรับเงินเต็มรูปแบบ
                  </span>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    (ออกในนามนิติบุคคล บริษัท หรือบุคคลธรรมดา)
                  </div>
                </div>
              </div>

              {needTaxInvoice && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  {/* 1. Tax Name / Company */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      ชื่อผู้เสียภาษี / ชื่อบริษัท <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required={needTaxInvoice}
                      placeholder="เช่น บริษัท ตัวอย่าง จำกัด หรือ นายสมชาย ใจดี"
                      value={taxName}
                      onChange={e => setTaxName(e.target.value)}
                      className="form-input"
                      style={{ height: '44px' }}
                    />
                  </div>

                  {/* 2. Tax ID */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      เลขประจำตัวผู้เสียภาษี (13 หลัก) <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required={needTaxInvoice}
                      maxLength="13"
                      placeholder="01055xxxxxxxx"
                      value={taxId}
                      onChange={e => setTaxId(e.target.value)}
                      className="form-input"
                      style={{ height: '44px', letterSpacing: '0.5px' }}
                    />
                  </div>

                  {/* 3. Address according to PP.20 */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      ที่อยู่ตาม ภ.พ.20 / ทะเบียนภาษี <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <textarea
                      rows="2"
                      required={needTaxInvoice}
                      placeholder="ระบุที่อยู่จดทะเบียนภาษีมูลค่าเพิ่ม เลขที่ อาคาร ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
                      value={taxAddress}
                      onChange={e => setTaxAddress(e.target.value)}
                      className="form-input"
                      style={{ height: 'auto', padding: '8px 12px', resize: 'vertical' }}
                    />
                  </div>

                  {/* 4. Phone Number for Tax Invoice */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '4px' }}>
                      <label className="form-label" style={{ fontSize: '0.8rem', margin: 0 }}>
                        เบอร์โทรศัพท์สำหรับใบกำกับภาษี <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      {contact && (
                        <button
                          type="button"
                          onClick={() => setTaxPhone(contact)}
                          style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            border: '1px solid var(--primary)',
                            backgroundColor: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                        >
                          ใช้เบอร์เดียวกับผู้จอง
                        </button>
                      )}
                    </div>
                    <input
                      type="tel"
                      required={needTaxInvoice}
                      placeholder="เช่น 081-234-5678"
                      value={taxPhone}
                      onChange={e => setTaxPhone(e.target.value)}
                      className="form-input"
                      style={{ height: '46px' }}
                    />
                  </div>

                  {/* 5. Delivery Method Dropdown */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      รูปแบบการจัดส่งใบกำกับภาษี <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <select
                        value={taxDeliveryMethod}
                        onChange={e => setTaxDeliveryMethod(e.target.value)}
                        className="form-input"
                        style={{ height: '46px', fontWeight: 700, cursor: 'pointer', paddingRight: '28px' }}
                      >
                        <option value="online">จัดส่งออนไลน์ (E-Tax / อีเมล / LINE)</option>
                        <option value="postal">จัดส่งทางจดหมาย (ไปรษณีย์ / เอกสารตัวจริง)</option>
                      </select>
                      <ChevronDown size={15} style={{ position: 'absolute', right: '12px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                    </div>
                  </div>

                  {/* 6. Postal Delivery Address (Appears ONLY if 'postal' is selected) */}
                  {taxDeliveryMethod === 'postal' && (
                    <div style={{
                      backgroundColor: 'rgba(37, 99, 235, 0.04)',
                      border: '1.5px dashed var(--primary)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <label className="form-label" style={{ fontSize: '0.82rem', margin: 0, color: 'var(--primary)', fontWeight: 800 }}>
                          ที่อยู่สำหรับจัดส่งทางไปรษณีย์ <span style={{ color: 'var(--danger)' }}>*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (taxAddress && taxAddress.trim()) {
                              setTaxPostalAddress(taxAddress.trim());
                            }
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '8px',
                            border: '1.5px solid var(--primary)',
                            backgroundColor: '#ffffff',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            color: 'var(--primary)',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            boxShadow: '0 2px 6px rgba(37, 99, 235, 0.08)'
                          }}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}
                        >
                          ใช้ที่อยู่เดียวกับที่อยู่บริษัท
                        </button>
                      </div>
                      <textarea
                        rows="3"
                        required={taxDeliveryMethod === 'postal'}
                        placeholder="ระบุชื่อผู้รับ แผนก/ฝ่าย อาคาร เลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์ ให้ชัดเจน"
                        value={taxPostalAddress}
                        onChange={e => setTaxPostalAddress(e.target.value)}
                        className="form-input"
                        style={{ height: 'auto', padding: '10px 12px', backgroundColor: '#ffffff', resize: 'vertical' }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ERROR ALERT */}
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

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ marginTop: '8px' }}
            >
              <span>{loading ? 'กำลังบันทึกข้อมูล...' : 'ถัดไป: ไปยังหน้าชำระเงิน (Next to Payment)'}</span>
              {!loading && <ChevronRight size={20} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
