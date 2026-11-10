import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  User, Users, Phone, Mail, Building, FileText, CheckCircle2,
  ArrowLeft, ChevronRight, ChevronDown, AlertCircle, ShieldCheck, CheckSquare, Square, MessageSquare, Send, Truck, Sparkles
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';
import { getRoomImageUrl, handleRoomImageError } from '../utils/roomImageHelper';

export default function BookingFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isSubmittingRef = useRef(false);
  const [bookingData, setBookingData] = useState(null);

  // Customer Form State
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [attendees, setAttendees] = useState('');

  // LINE Profile State
  const [lineUserId, setLineUserId] = useState('');
  const [lineUserName, setLineUserName] = useState('');
  const [lineUserPic, setLineUserPic] = useState('');

  // Tax Invoice State
  const [needTaxInvoice, setNeedTaxInvoice] = useState(false);
  const [taxPayerType, setTaxPayerType] = useState(''); // '' | 'individual' | 'corporate' (no default value)
  const [taxBranchType, setTaxBranchType] = useState('head'); // 'head' | 'branch'
  const [taxBranchNumber, setTaxBranchNumber] = useState('');
  const [taxName, setTaxName] = useState('');
  const [taxAddress, setTaxAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [taxPhone, setTaxPhone] = useState('');
  const [taxDeliveryMethod, setTaxDeliveryMethod] = useState('online'); // 'online' | 'postal'
  const [taxOnlineSubChannel, setTaxOnlineSubChannel] = useState('line'); // 'line' | 'email'
  const [taxEmail, setTaxEmail] = useState('');
  const [taxPostalAddress, setTaxPostalAddress] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load payload and LIFF profile from location.state or sessionStorage / localStorage
  useEffect(() => {
    let parsed = null;
    let savedLineId = '';

    // 1. Prefer React Router in-memory state (immune to storage quota or restrictions)
    if (location.state && location.state.room_id) {
      setBookingData(location.state);
      if (location.state.guests) {
        setAttendees(String(location.state.guests));
      }
    } else {
      try {
        const raw = typeof window !== 'undefined' ? sessionStorage.getItem('current_booking_payload') : null;
        if (raw) parsed = JSON.parse(raw);
      } catch (e) {
        console.warn('[Storage] Could not read current_booking_payload:', e);
      }
      if (parsed) {
        setBookingData(parsed);
        if (parsed.guests) {
          setAttendees(String(parsed.guests));
        }
      } else {
        navigate('/');
        return;
      }
    }

    // Check LINE LIFF Profile
    try {
      savedLineId = (typeof window !== 'undefined' ? (sessionStorage.getItem('line_user_id') || localStorage.getItem('line_user_id')) : '') || '';
      const savedLineName = (typeof window !== 'undefined' ? (sessionStorage.getItem('line_user_name') || localStorage.getItem('line_user_name')) : '') || '';
      const savedLinePic = (typeof window !== 'undefined' ? (sessionStorage.getItem('line_user_pic') || localStorage.getItem('line_user_pic')) : '') || '';

      if (savedLineId) {
        setLineUserId(savedLineId);
        setLineUserName(savedLineName);
        setLineUserPic(savedLinePic);
        if (savedLineName && !name) {
          setName(savedLineName);
        }
      }
    } catch (e) {}

    // Restore scoped form draft (bound to user and room item, prevent cross-account leak)
    try {
      if (typeof window !== 'undefined') {
        const activeUserId = savedLineId || 'guest';
        const activeRoomId = (location.state && location.state.room_id) ? location.state.room_id : (parsed ? parsed.room_id : 'any');
        const scopedKey = `bwork_draft_${activeUserId}_${activeRoomId}`;

        let draftRaw = sessionStorage.getItem(scopedKey);
        if (!draftRaw) {
          draftRaw = sessionStorage.getItem('bwork_booking_form_draft');
        }

        if (draftRaw) {
          const draft = JSON.parse(draftRaw);
          // STRICT SECURITY GATE: If draft belongs to a different LINE user, NEVER restore!
          if (draft._owner_id && draft._owner_id !== activeUserId && activeUserId !== 'guest') {
            console.warn('[Security] Draft belongs to a different user, discarding.');
            sessionStorage.removeItem(scopedKey);
            sessionStorage.removeItem('bwork_booking_form_draft');
          } else {
            if (draft.name) setName(draft.name);
            if (draft.contact) setContact(draft.contact);
            if (draft.email) setEmail(draft.email);
            if (draft.company) setCompany(draft.company);
            if (draft.notes) setNotes(draft.notes);
            if (draft.attendees) setAttendees(draft.attendees);

            if (draft.needTaxInvoice !== undefined) setNeedTaxInvoice(draft.needTaxInvoice);
            if (draft.taxPayerType) setTaxPayerType(draft.taxPayerType);
            if (draft.taxBranchType) setTaxBranchType(draft.taxBranchType);
            if (draft.taxBranchNumber) setTaxBranchNumber(draft.taxBranchNumber);
            if (draft.taxName) setTaxName(draft.taxName);
            if (draft.taxAddress) setTaxAddress(draft.taxAddress);
            if (draft.taxId) setTaxId(draft.taxId);
            if (draft.taxPhone) setTaxPhone(draft.taxPhone);
            if (draft.taxDeliveryMethod) setTaxDeliveryMethod(draft.taxDeliveryMethod);
            if (draft.taxOnlineSubChannel) setTaxOnlineSubChannel(draft.taxOnlineSubChannel);
            if (draft.taxEmail) setTaxEmail(draft.taxEmail);
            if (draft.taxPostalAddress) setTaxPostalAddress(draft.taxPostalAddress);
          }
        }
      }
    } catch (e) {
      console.warn('[Storage] Could not restore form draft:', e);
    }
  }, []);

  // Auto-save form draft scoped to user and room item (no tokens or slip files stored)
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const activeUserId = lineUserId || (sessionStorage.getItem('line_user_id') || localStorage.getItem('line_user_id')) || 'guest';
        const activeRoomId = bookingData?.room_id || bookingData?.room?.id || 'any';
        const scopedKey = `bwork_draft_${activeUserId}_${activeRoomId}`;

        const draft = {
          _owner_id: activeUserId,
          _room_id: activeRoomId,
          _saved_at: Date.now(),
          name,
          contact,
          email,
          company,
          notes,
          attendees,
          needTaxInvoice,
          taxPayerType,
          taxBranchType,
          taxBranchNumber,
          taxName,
          taxAddress,
          taxId,
          taxPhone,
          taxDeliveryMethod,
          taxOnlineSubChannel,
          taxEmail,
          taxPostalAddress
        };
        sessionStorage.setItem(scopedKey, JSON.stringify(draft));
        sessionStorage.setItem('bwork_booking_form_draft', JSON.stringify(draft));
      }
    } catch (e) {}
  }, [
    lineUserId, bookingData?.room_id,
    name, contact, email, company, notes, attendees,
    needTaxInvoice, taxPayerType, taxBranchType, taxBranchNumber,
    taxName, taxAddress, taxId, taxPhone, taxDeliveryMethod, taxOnlineSubChannel, taxEmail, taxPostalAddress
  ]);

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

  const effectiveCapacity = bookingData?.effective_capacity
    || (bookingData?.layout === 'classroom' && bookingData?.classroom_capacity ? bookingData.classroom_capacity : bookingData?.room_capacity)
    || (bookingData?.room && bookingData.room.capacity)
    || 100;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || isSubmittingRef.current) return;
    setError('');

    if (!name.trim()) {
      setError('กรุณาระบุชื่อ-นามสกุล ผู้จอง');
      return;
    }
    if (!contact.trim()) {
      setError('กรุณาระบุเบอร์โทรศัพท์สำหรับติดต่อและรับรหัสผ่าน');
      return;
    }

    const parsedAttendees = parseInt(attendees, 10);
    if (!attendees || isNaN(parsedAttendees) || parsedAttendees < 1) {
      setError('กรุณาระบุจำนวนผู้เข้าใช้ห้องอย่างน้อย 1 ท่าน');
      return;
    }
    if (parsedAttendees > effectiveCapacity) {
      setError(`จำนวนผู้เข้าใช้งาน (${parsedAttendees} ท่าน) เกินความจุของห้องที่เลือก (รองรับสูงสุด ${effectiveCapacity} ท่าน)`);
      return;
    }

    if (needTaxInvoice) {
      if (taxPayerType !== 'individual' && taxPayerType !== 'corporate') {
        setError('กรุณาเลือกประเภทผู้เสียภาษี (บุคคลธรรมดา หรือ นิติบุคคล)');
        if (typeof document !== 'undefined') {
          const el = document.getElementById('tax-payer-type-container');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          const btn = document.getElementById('btn-tax-individual');
          if (btn) {
            btn.focus();
          }
        }
        return;
      }
      if (!taxName.trim()) {
        setError(taxPayerType === 'individual' ? 'กรุณาระบุชื่อ–นามสกุล' : 'กรุณาระบุชื่อนิติบุคคล');
        return;
      }
      const cleanTaxId = taxId.replace(/[-\s]/g, '').trim();
      if (!cleanTaxId || cleanTaxId.length !== 13 || !/^\d{13}$/.test(cleanTaxId)) {
        setError('กรุณาระบุเลขประจำตัวผู้เสียภาษี 13 หลัก');
        return;
      }
      if (taxPayerType === 'corporate' && taxBranchType === 'branch' && !taxBranchNumber.trim()) {
        setError('กรุณาระบุเลขที่สาขา');
        return;
      }
      if (!taxAddress.trim()) {
        setError(taxPayerType === 'individual' ? 'กรุณาระบุที่อยู่สำหรับออกใบกำกับภาษี' : 'กรุณาระบุที่อยู่จดทะเบียน');
        return;
      }
      if (!taxPhone.trim() && !contact.trim()) {
        setError('กรุณาระบุเบอร์โทรศัพท์สำหรับใบกำกับภาษี');
        return;
      }
      if (taxDeliveryMethod === 'postal' && !taxPostalAddress.trim()) {
        setError('กรุณาระบุที่อยู่สำหรับจัดส่งเอกสารทางจดหมาย');
        const el = document.getElementById('input-tax-postal-address');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
        }
        return;
      }
      if (taxDeliveryMethod === 'online' && taxOnlineSubChannel === 'email') {
        const cleanTaxEmail = (taxEmail || '').trim();
        if (!cleanTaxEmail) {
          setError('กรุณาระบุอีเมลสำหรับรับใบกำกับภาษี');
          const el = document.getElementById('input-tax-email');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
          }
          return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanTaxEmail)) {
          setError('รูปแบบอีเมลสำหรับรับใบกำกับภาษีไม่ถูกต้อง');
          const el = document.getElementById('input-tax-email');
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
          }
          return;
        }
      }
    }

    isSubmittingRef.current = true;
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
        guest_count: parsedAttendees,
        guests: parsedAttendees,
        total_amount: bookingData.total_amount || 0,
        note: notes.trim(),
        line_user_id: lineUserId,
        booking_channel: 'line_oa',
        customer_type: 'general',
        tax_invoice_required: needTaxInvoice ? 1 : 0,
        tax_payer_type: needTaxInvoice ? taxPayerType : null,
        tax_name: needTaxInvoice ? taxName.trim() : null,
        tax_id: needTaxInvoice ? taxId.replace(/[-\s]/g, '').trim() : null,
        tax_branch_type: needTaxInvoice && taxPayerType === 'corporate' ? taxBranchType : null,
        tax_branch_number: needTaxInvoice && taxPayerType === 'corporate' && taxBranchType === 'branch' ? taxBranchNumber.trim() : null,
        tax_address: needTaxInvoice ? taxAddress.trim() : null,
        tax_phone: needTaxInvoice ? (taxPhone.trim() || contact.trim()) : null,
        tax_delivery_method: needTaxInvoice ? taxDeliveryMethod : null,
        tax_online_subchannel: needTaxInvoice && taxDeliveryMethod === 'online' ? taxOnlineSubChannel : null,
        tax_email: needTaxInvoice && taxDeliveryMethod === 'online' && taxOnlineSubChannel === 'email' ? taxEmail.trim() : null,
        tax_postal_address: needTaxInvoice && taxDeliveryMethod === 'postal' ? taxPostalAddress.trim() : null
      };

      let idToken = '';
      if (typeof window !== 'undefined' && window.liff && window.liff.isLoggedIn()) {
        try { idToken = window.liff.getIDToken() || ''; } catch (e) {}
      }
      if (idToken) {
        payload.line_id_token = idToken;
      }

      const reqHeaders = { 'Content-Type': 'application/json' };
      if (idToken) reqHeaders['X-Line-ID-Token'] = idToken;

      const res = await fetch(`${API_BASE}/api/public/bookings`, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const finalBookingId = data.booking_id || data.bookingId || data.id;
        const finalBookingCode = data.receipt_number || data.receiptNumber || data.booking_code || data.bookingCode || (finalBookingId ? `BK-${String(finalBookingId).padStart(6, '0')}` : '');

        // Save current booking confirmation
        const deadline = data.paymentDeadline || (data.payment_window_minutes ? new Date(Date.now() + (parseInt(data.payment_window_minutes, 10) || 15) * 60 * 1000).toISOString() : null);
        const windowMins = parseInt(data.payment_window_minutes, 10) || 15;

        // CRITICAL ROOT-CAUSE FIX FOR QuotaExceededError ON IPHONE / IN-APP BROWSERS:
        // Strip heavy Base64 image data (which in Production can exceed 1.4 MB) before storage serialization.
        // This reduces storage footprint from ~1.4 MB down to ~350 bytes (>99.9% reduction), well within iOS Safari 5 MB limit.
        const sanitizedBookingData = { ...bookingData, guests: parsedAttendees, guest_count: parsedAttendees };
        if (typeof sanitizedBookingData.image_url === 'string' && sanitizedBookingData.image_url.startsWith('data:')) {
          sanitizedBookingData.image_url = '';
        }
        if (sanitizedBookingData.room && typeof sanitizedBookingData.room.image_url === 'string' && sanitizedBookingData.room.image_url.startsWith('data:')) {
          sanitizedBookingData.room = { ...sanitizedBookingData.room, image_url: '' };
        }

        const completedResult = {
          ...sanitizedBookingData,
          guests: parsedAttendees,
          guest_count: parsedAttendees,
          booking_id: finalBookingId,
          booking_code: finalBookingCode,
          receipt_number: data.receipt_number || data.receiptNumber,
          total_amount: data.totalAmount ?? data.total_amount ?? bookingData?.total_amount ?? 0,
          subtotal_amount: data.subtotalAmount ?? bookingData?.subtotal_amount,
          discount_amount: data.discountAmount ?? bookingData?.discount_amount ?? 0,
          paymentDeadline: deadline,
          payment_window_minutes: windowMins,
          customer_name: name.trim(),
          customer_contact: contact.trim(),
          contact: contact.trim(),
          line_user_id: lineUserId
        };

        const pendingBooking = {
          id: finalBookingId,
          code: finalBookingCode,
          roomName: bookingData?.room?.name || bookingData?.room_name || 'ห้องประชุม',
          totalAmount: data.totalAmount ?? data.total_amount ?? bookingData?.totalPrice ?? bookingData?.total_amount ?? 0,
          paymentDeadline: deadline,
          paymentWindowMinutes: windowMins,
          createdAt: Date.now(),
          status: 'pending',
          contact: contact.trim()
        };

        // Storage operations MUST NEVER throw uncaught exceptions or block navigation to payment.
        try {
          sessionStorage.setItem('completed_booking_result', JSON.stringify(completedResult));
          sessionStorage.removeItem('bwork_booking_form_draft');
          const activeUserId = lineUserId || 'guest';
          const activeRoomId = bookingData?.room_id || 'any';
          sessionStorage.removeItem(`bwork_draft_${activeUserId}_${activeRoomId}`);
        } catch (storageErr) {
          console.warn('[Storage] sessionStorage completed_booking_result failed (non-blocking):', storageErr);
        }

        try {
          localStorage.setItem('bwork_pending_booking', JSON.stringify(pendingBooking));
        } catch (storageErr) {
          console.warn('[Storage] localStorage bwork_pending_booking failed (non-blocking):', storageErr);
        }

        // Always navigate immediately to confirmation & payment with React Router memory state
        navigate(`/confirm?id=${finalBookingId}&code=${encodeURIComponent(finalBookingCode)}`, {
          state: {
            booking: completedResult,
            contact: contact.trim()
          }
        });
        return;
      } else {
        setError(data.error || 'ไม่สามารถทำรายการจองได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      setError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + err.message);
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  if (!bookingData) return null;

  return (
    <div className="main-content">
      <StepProgress currentStep={3} />

      <div className="booking-form-grid">
        {/* LEFT COLUMN: STICKY BOOKING SUMMARY CARD */}
        <div className="booking-card booking-summary-card" style={{ position: 'sticky', top: '80px' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', marginBottom: '8px' }}>
            สรุปรายการจอง
          </div>

          {bookingData.image_url && (
            <div style={{ borderRadius: '12px', overflow: 'hidden', height: '140px', marginBottom: '12px' }}>
              <img src={getRoomImageUrl(bookingData.image_url)} alt={bookingData.room_name} onError={(e) => handleRoomImageError(e, bookingData.image_url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
              <strong style={{ color: attendees ? 'var(--text-main)' : 'var(--warning)' }}>
                {attendees ? `${attendees} ท่าน` : 'ยังไม่ได้ระบุ'}
              </strong>
            </div>
            {bookingData.layout && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>รูปแบบจัดโต๊ะ:</span>
                <strong style={{ color: 'var(--text-main)', textTransform: 'capitalize' }}>{bookingData.layout}</strong>
              </div>
            )}
          </div>

          {/* Total Amount Box / Price Breakdown */}
          <div style={{
            marginTop: '16px',
            padding: '14px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-page)',
            border: '1.5px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {bookingData.discount_amount > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  <span>ค่าบริการห้องประชุม</span>
                  <span>฿{Number(bookingData.subtotal_amount || bookingData.total_amount).toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={14} /> ส่วนลดจองออนไลน์ {bookingData.discount_value || 5}%
                  </span>
                  <span>-฿{Number(bookingData.discount_amount).toLocaleString()}</span>
                </div>
                <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0' }} />
              </>
            )}
            <div style={{
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

          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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

            {/* Attendees Count */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Users size={16} style={{ color: 'var(--primary)' }} />
                  <span>จำนวนผู้เข้าใช้งาน (Attendees)</span>
                  <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  ห้องนี้รองรับสูงสุด {effectiveCapacity} ท่าน
                </span>
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Users size={18} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  type="number"
                  min="1"
                  max={effectiveCapacity}
                  required
                  placeholder={`ระบุจำนวนผู้เข้าใช้ห้อง (1 - ${effectiveCapacity} ท่าน)`}
                  value={attendees}
                  onChange={e => {
                    setAttendees(e.target.value);
                    setError('');
                  }}
                  className="form-input"
                  style={{
                    paddingLeft: '44px',
                    paddingRight: '60px',
                    fontWeight: 700
                  }}
                />
                <span style={{
                  position: 'absolute',
                  right: '16px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  pointerEvents: 'none'
                }}>
                  ท่าน
                </span>
              </div>
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
                  onChange={e => setCompany(e.target.value)}
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
                id="tax-invoice-accordion-toggle"
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                  {/* Entity Type Selector (บุคคลธรรมดา / นิติบุคคล) */}
                  <div
                    id="tax-payer-type-container"
                    tabIndex="-1"
                    style={{
                      borderRadius: '12px',
                      padding: (error && (!taxPayerType || (taxPayerType !== 'individual' && taxPayerType !== 'corporate'))) ? '10px' : '0px',
                      border: (error && (!taxPayerType || (taxPayerType !== 'individual' && taxPayerType !== 'corporate'))) ? '2px solid var(--danger)' : '2px solid transparent',
                      backgroundColor: (error && (!taxPayerType || (taxPayerType !== 'individual' && taxPayerType !== 'corporate'))) ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                      transition: 'all 0.2s ease',
                      outline: 'none'
                    }}
                  >
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '6px', display: 'block' }}>
                      ประเภทผู้เสียภาษี <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '8px',
                      backgroundColor: '#f1f5f9',
                      padding: '4px',
                      borderRadius: '12px'
                    }}>
                      <button
                        type="button"
                        id="btn-tax-individual"
                        onClick={() => {
                          setTaxPayerType('individual');
                          if (error && error.includes('ประเภทผู้เสียภาษี')) setError('');
                        }}
                        style={{
                          padding: '10px 8px',
                          minHeight: '44px',
                          borderRadius: '9px',
                          border: taxPayerType === 'individual' ? '1.5px solid var(--primary)' : '1px solid transparent',
                          backgroundColor: taxPayerType === 'individual' ? '#ffffff' : 'transparent',
                          color: taxPayerType === 'individual' ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: taxPayerType === 'individual' ? 800 : 600,
                          fontSize: '0.84rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: taxPayerType === 'individual' ? '0 2px 8px rgba(37,99,235,0.12)' : 'none',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <User size={16} />
                        <span>บุคคลธรรมดา</span>
                      </button>
                      <button
                        type="button"
                        id="btn-tax-corporate"
                        onClick={() => {
                          setTaxPayerType('corporate');
                          if (error && error.includes('ประเภทผู้เสียภาษี')) setError('');
                        }}
                        style={{
                          padding: '10px 8px',
                          minHeight: '44px',
                          borderRadius: '9px',
                          border: taxPayerType === 'corporate' ? '1.5px solid var(--primary)' : '1px solid transparent',
                          backgroundColor: taxPayerType === 'corporate' ? '#ffffff' : 'transparent',
                          color: taxPayerType === 'corporate' ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: taxPayerType === 'corporate' ? 800 : 600,
                          fontSize: '0.84rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: taxPayerType === 'corporate' ? '0 2px 8px rgba(37,99,235,0.12)' : 'none',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Building size={16} />
                        <span>นิติบุคคล</span>
                      </button>
                    </div>
                    {error && (!taxPayerType || (taxPayerType !== 'individual' && taxPayerType !== 'corporate')) && (
                      <div style={{ color: 'var(--danger)', fontSize: '0.78rem', marginTop: '6px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={14} />
                        <span>กรุณาเลือกประเภทผู้เสียภาษี (บุคคลธรรมดา หรือ นิติบุคคล)</span>
                      </div>
                    )}
                  </div>

                  {/* 1. Tax Name (บุคคลธรรมดา: ชื่อ–นามสกุล / นิติบุคคล: ชื่อนิติบุคคล) */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      {taxPayerType === 'individual' ? 'ชื่อ–นามสกุล' : taxPayerType === 'corporate' ? 'ชื่อนิติบุคคล' : 'ชื่อผู้เสียภาษี / ชื่อนิติบุคคล'} <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      id="input-tax-name"
                      required={needTaxInvoice}
                      placeholder={taxPayerType === 'individual' ? 'เช่น นายสมชาย ใจดี' : taxPayerType === 'corporate' ? 'เช่น บริษัท ตัวอย่าง จำกัด' : 'เช่น บริษัท ตัวอย่าง จำกัด หรือ นายสมชาย ใจดี'}
                      value={taxName}
                      onChange={e => setTaxName(e.target.value)}
                      className="form-input"
                      style={{ height: '44px' }}
                    />
                  </div>

                  {/* 2. Tax ID (เลขประจำตัวผู้เสียภาษี) */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      เลขประจำตัวผู้เสียภาษี <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      id="input-tax-id"
                      required={needTaxInvoice}
                      maxLength="13"
                      placeholder={taxPayerType === 'individual' ? 'เลขประจำตัวผู้เสียภาษี 13 หลัก' : '01055xxxxxxxx'}
                      value={taxId}
                      onChange={e => setTaxId(e.target.value)}
                      className="form-input"
                      style={{ height: '44px', letterSpacing: '0.5px' }}
                    />
                  </div>

                  {/* 3. Corporate Branch Options (สำนักงานใหญ่ / สาขา) */}
                  {taxPayerType === 'corporate' && (
                    <div style={{
                      backgroundColor: 'rgba(37, 99, 235, 0.03)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}>
                      <label className="form-label" style={{ fontSize: '0.8rem', margin: 0, fontWeight: 750 }}>
                        สำนักงานใหญ่ / สาขา <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                        <button
                          type="button"
                          id="btn-tax-branch-head"
                          onClick={() => setTaxBranchType('head')}
                          style={{
                            padding: '9px 10px',
                            minHeight: '42px',
                            borderRadius: '9px',
                            border: taxBranchType === 'head' ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                            backgroundColor: taxBranchType === 'head' ? 'rgba(37,99,235,0.09)' : '#ffffff',
                            color: taxBranchType === 'head' ? 'var(--primary)' : 'var(--text-main)',
                            fontWeight: taxBranchType === 'head' ? 800 : 600,
                            fontSize: '0.82rem',
                            cursor: 'pointer'
                          }}
                        >
                          สำนักงานใหญ่
                        </button>
                        <button
                          type="button"
                          id="btn-tax-branch-sub"
                          onClick={() => setTaxBranchType('branch')}
                          style={{
                            padding: '9px 10px',
                            minHeight: '42px',
                            borderRadius: '9px',
                            border: taxBranchType === 'branch' ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                            backgroundColor: taxBranchType === 'branch' ? 'rgba(37,99,235,0.09)' : '#ffffff',
                            color: taxBranchType === 'branch' ? 'var(--primary)' : 'var(--text-main)',
                            fontWeight: taxBranchType === 'branch' ? 800 : 600,
                            fontSize: '0.82rem',
                            cursor: 'pointer'
                          }}
                        >
                          สาขา
                        </button>
                      </div>

                      {taxBranchType === 'branch' && (
                        <div style={{ marginTop: '4px' }}>
                          <label className="form-label" style={{ fontSize: '0.76rem', marginBottom: '4px' }}>
                            เลขที่สาขา <span style={{ color: 'var(--danger)' }}>*</span>
                          </label>
                          <input
                            type="text"
                            id="input-tax-branch-number"
                            required={needTaxInvoice && taxPayerType === 'corporate' && taxBranchType === 'branch'}
                            placeholder="ระบุเลขที่สาขา เช่น 00001 หรือ 01"
                            value={taxBranchNumber}
                            onChange={e => setTaxBranchNumber(e.target.value)}
                            className="form-input"
                            style={{ height: '42px' }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4. Address (บุคคลธรรมดา: ที่อยู่สำหรับออกใบกำกับภาษี / นิติบุคคล: ที่อยู่จดทะเบียน) */}
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                      {taxPayerType === 'individual' ? 'ที่อยู่สำหรับออกใบกำกับภาษี' : taxPayerType === 'corporate' ? 'ที่อยู่จดทะเบียน' : 'ที่อยู่สำหรับออกใบกำกับภาษี / ที่อยู่จดทะเบียน'} <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <textarea
                      rows="2"
                      id="input-tax-address"
                      required={needTaxInvoice}
                      placeholder={taxPayerType === 'individual' ? 'ระบุที่อยู่ เลขที่ อาคาร ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์' : taxPayerType === 'corporate' ? 'ระบุที่อยู่จดทะเบียนภาษีมูลค่าเพิ่ม เลขที่ อาคาร ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์' : 'ระบุที่อยู่สำหรับออกใบกำกับภาษี / ที่อยู่จดทะเบียน'}
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
                      id="input-tax-phone"
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
                        id="select-tax-delivery-method"
                        value={taxDeliveryMethod}
                        onChange={e => {
                          setTaxDeliveryMethod(e.target.value);
                          if (error && (error.includes('จดหมาย') || error.includes('อีเมล'))) setError('');
                        }}
                        className="form-input custom-select-input"
                        style={{
                          height: '46px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          paddingRight: '36px',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                          MozAppearance: 'none'
                        }}
                      >
                        <option value="online">จัดส่งออนไลน์ (LINE หรืออีเมล)</option>
                        <option value="postal">จัดส่งทางจดหมาย (ไปรษณีย์ / เอกสารตัวจริง)</option>
                      </select>
                      <ChevronDown size={15} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                    </div>
                  </div>

                  {/* 5.1 Online Sub-Channels (Appears ONLY if 'online' is selected) */}
                  {taxDeliveryMethod === 'online' && (
                    <div style={{
                      backgroundColor: 'rgba(37, 99, 235, 0.03)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      <label className="form-label" style={{ fontSize: '0.8rem', margin: 0, fontWeight: 750 }}>
                        ช่องทางรับเอกสารออนไลน์ <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                        <button
                          type="button"
                          id="btn-tax-subchannel-line"
                          onClick={() => {
                            setTaxOnlineSubChannel('line');
                            if (error && error.includes('อีเมลสำหรับรับใบกำกับภาษี')) setError('');
                          }}
                          style={{
                            padding: '9px 10px',
                            minHeight: '42px',
                            borderRadius: '9px',
                            border: taxOnlineSubChannel === 'line' ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                            backgroundColor: taxOnlineSubChannel === 'line' ? 'rgba(37,99,235,0.09)' : '#ffffff',
                            color: taxOnlineSubChannel === 'line' ? 'var(--primary)' : 'var(--text-main)',
                            fontWeight: taxOnlineSubChannel === 'line' ? 800 : 600,
                            fontSize: '0.82rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <MessageSquare size={15} />
                          <span>LINE</span>
                        </button>
                        <button
                          type="button"
                          id="btn-tax-subchannel-email"
                          onClick={() => {
                            setTaxOnlineSubChannel('email');
                          }}
                          style={{
                            padding: '9px 10px',
                            minHeight: '42px',
                            borderRadius: '9px',
                            border: taxOnlineSubChannel === 'email' ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                            backgroundColor: taxOnlineSubChannel === 'email' ? 'rgba(37,99,235,0.09)' : '#ffffff',
                            color: taxOnlineSubChannel === 'email' ? 'var(--primary)' : 'var(--text-main)',
                            fontWeight: taxOnlineSubChannel === 'email' ? 800 : 600,
                            fontSize: '0.82rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <Mail size={15} />
                          <span>อีเมล</span>
                        </button>
                      </div>

                      {taxOnlineSubChannel === 'line' && (
                        <div style={{
                          fontSize: '0.76rem',
                          color: 'var(--text-muted)',
                          lineHeight: 1.4,
                          padding: '6px 8px',
                          backgroundColor: '#ffffff',
                          borderRadius: '8px',
                          border: '1px solid #f1f5f9'
                        }}>
                          ระบบจะจัดส่งใบกำกับภาษีให้ท่านผ่านทาง LINE Official Account เมื่อการให้บริการเสร็จสิ้น
                        </div>
                      )}

                      {taxOnlineSubChannel === 'email' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                            <label className="form-label" style={{ fontSize: '0.78rem', margin: 0, fontWeight: 750 }}>
                              อีเมลสำหรับรับใบกำกับภาษี <span style={{ color: 'var(--danger)' }}>*</span>
                            </label>
                            {email && email.trim() && (
                              <button
                                type="button"
                                id="btn-use-booking-email"
                                onClick={() => {
                                  setTaxEmail(email.trim());
                                  if (error && error.includes('อีเมล')) setError('');
                                }}
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
                                ใช้อีเมลเดียวกับผู้จอง
                              </button>
                            )}
                          </div>
                          <input
                            type="email"
                            id="input-tax-email"
                            required={needTaxInvoice && taxDeliveryMethod === 'online' && taxOnlineSubChannel === 'email'}
                            placeholder="เช่น billing@company.com"
                            value={taxEmail}
                            onChange={e => {
                              setTaxEmail(e.target.value);
                              if (error && error.includes('อีเมล')) setError('');
                            }}
                            className="form-input"
                            style={{ height: '44px' }}
                          />
                        </div>
                      )}
                    </div>
                  )}

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
                        id="input-tax-postal-address"
                        required={needTaxInvoice && taxDeliveryMethod === 'postal'}
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
