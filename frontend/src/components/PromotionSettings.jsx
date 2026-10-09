import React, { useState, useEffect, useRef } from 'react';
import { Tag, FileText, Percent, CalendarDays, Power, AlertCircle, ArrowRight, RefreshCw } from 'lucide-react';
import { authManager } from '../authManager';

function parseBangkokParts(isoStr) {
  if (!isoStr) return { date: '', time: '' };
  try {
    const d = new Date(isoStr);
    const bkkMs = d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60 * 1000;
    const bkk = new Date(bkkMs);
    const y = bkk.getFullYear();
    const m = String(bkk.getMonth() + 1).padStart(2, '0');
    const day = String(bkk.getDate()).padStart(2, '0');
    const h = String(bkk.getHours()).padStart(2, '0');
    const min = String(bkk.getMinutes()).padStart(2, '0');
    return { date: `${day}/${m}/${y}`, time: `${h}:${min}` };
  } catch (e) {
    return { date: '', time: '' };
  }
}

function formatBangkokDisplay(isoStr) {
  if (!isoStr) return 'ยังไม่กำหนด';
  try {
    const d = new Date(isoStr);
    const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const bkkMs = d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60 * 1000;
    const bkk = new Date(bkkMs);
    const day = bkk.getDate();
    const month = thMonths[bkk.getMonth()];
    const year = bkk.getFullYear();
    const h = String(bkk.getHours()).padStart(2, '0');
    const m = String(bkk.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} เวลา ${h}:${m} น.`;
  } catch (e) {
    return isoStr;
  }
}

function buildBangkokISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  let year, month, day;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      day = parts[0].padStart(2, '0');
      month = parts[1].padStart(2, '0');
      year = parts[2];
    }
  } else if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      year = parts[0];
      month = parts[1].padStart(2, '0');
      day = parts[2].padStart(2, '0');
    }
  }
  if (!year || !month || !day || year.length !== 4) return null;
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return `${year}-${month}-${day}T${cleanTime}+07:00`;
}

function PromotionSettings({ sysAlert, sysConfirm }) {
  const [promoData, setPromoData] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoActionLoading, setPromoActionLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  // Form state with DD/MM/YYYY date and 24-hour HH:mm time
  const [formData, setFormData] = useState({
    promotion_name: 'โปรโมชั่นจองออนไลน์',
    discount_value: '5',
    startDate: '13/10/2026',
    startTime: '08:00',
    hasEndDate: false,
    endDate: '',
    endTime: ''
  });
  const [initialFormData, setInitialFormData] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  // Unsaved changes confirmation modal state for Refresh
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);

  // Native picker refs
  const startDatePickerRef = useRef(null);
  const endDatePickerRef = useRef(null);

  const syncFormFromPromoData = (data) => {
    if (!data) return;
    const startParts = parseBangkokParts(data.start_at || '2026-10-13T08:00:00+07:00');
    const endParts = data.end_at ? parseBangkokParts(data.end_at) : { date: '', time: '' };
    const initial = {
      promotion_name: data.promotion_name || 'โปรโมชั่นจองออนไลน์',
      discount_value: String(data.discount_value !== undefined && data.discount_value !== null ? data.discount_value : 5),
      startDate: startParts.date || '13/10/2026',
      startTime: startParts.time || '08:00',
      hasEndDate: Boolean(data.end_at),
      endDate: endParts.date || '',
      endTime: endParts.time || ''
    };
    setFormData(initial);
    setInitialFormData(initial);
    setFormError(null);
  };

  useEffect(() => {
    executeRefresh(false);
  }, []);

  // Shared canonical refresh & load helper
  const executeRefresh = async (isManual = true) => {
    setPromoLoading(true);
    setFormError(null);
    if (isManual) {
      setFormSuccess(null);
    }
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/admin/promotion', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        const canonical = data.promotion || data;
        setPromoData(canonical);
        syncFormFromPromoData(canonical);
        if (isManual) {
          const successMsg = 'อัปเดตข้อมูลโปรโมชั่นล่าสุดแล้ว';
          setFormSuccess(successMsg);
          if (sysAlert) sysAlert(successMsg);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || 'ไม่สามารถรีเฟรชข้อมูลโปรโมชั่นได้';
        setFormError(errMsg);
        if (sysAlert) sysAlert(errMsg);
      }
    } catch (err) {
      const errMsg = 'ไม่สามารถรีเฟรชข้อมูลโปรโมชั่นได้';
      setFormError(errMsg);
      if (sysAlert) sysAlert(errMsg);
    } finally {
      setPromoLoading(false);
    }
  };

  // Safe refresh trigger with unsaved changes confirmation
  const handleRefreshClick = async () => {
    if (promoLoading) return;
    if (isDirty) {
      if (sysConfirm) {
        const confirmed = await sysConfirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก\nหากรีเฟรช ข้อมูลที่แก้ไขจะถูกยกเลิกและโหลดค่าล่าสุดจากระบบ');
        if (confirmed) {
          await executeRefresh(true);
        }
      } else {
        setShowRefreshConfirm(true);
      }
    } else {
      await executeRefresh(true);
    }
  };

  const handleDateChange = (val, field) => {
    let cleaned = val.replace(/[^0-9/]/g, '').slice(0, 10);
    setFormData(prev => ({ ...prev, [field]: cleaned }));
  };

  const handleTimeChange = (val, field) => {
    let cleaned = val.replace(/[^0-9:]/g, '').slice(0, 5);
    setFormData(prev => ({ ...prev, [field]: cleaned }));
  };

  const handleNativeDatePick = (isoVal, field) => {
    if (!isoVal) return;
    const parts = isoVal.split('-');
    if (parts.length === 3) {
      const formatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
      setFormData(prev => ({ ...prev, [field]: formatted }));
    }
  };

  const handleActivatePromotion = async () => {
    setPromoActionLoading(true);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/admin/promotion/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (sysAlert) sysAlert(data.message || 'เปิดใช้งานโปรโมชั่นสำเร็จ');
        const canonical = data.promotion || data;
        setPromoData(canonical);
        syncFormFromPromoData(canonical);
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถเปิดใช้งานโปรโมชั่นได้');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setPromoActionLoading(false);
    }
  };

  const handleDeactivatePromotion = async () => {
    setPromoActionLoading(true);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/admin/promotion/deactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (sysAlert) sysAlert(data.message || 'หยุดการใช้งานโปรโมชั่นสำเร็จ');
        const canonical = data.promotion || data;
        setPromoData(canonical);
        syncFormFromPromoData(canonical);
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถหยุดการใช้งานโปรโมชั่นได้');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setPromoActionLoading(false);
    }
  };

  const validateClientForm = () => {
    const dVal = Number(formData.discount_value);
    if (!formData.discount_value || isNaN(dVal) || dVal < 0.01 || dVal > 100) {
      return 'ส่วนลดต้องอยู่ระหว่าง 0.01% ถึง 100%';
    }
    if (!formData.startDate || !formData.startTime) {
      return 'กรุณาระบุวันและเวลาเริ่มต้นโปรโมชั่น';
    }
    const startIso = buildBangkokISO(formData.startDate, formData.startTime);
    if (!startIso || isNaN(Date.parse(startIso))) {
      return 'กรุณาระบุวันและเวลาเริ่มต้นโปรโมชั่นให้ถูกต้อง';
    }
    if (formData.hasEndDate) {
      if (!formData.endDate || !formData.endTime) {
        return 'กรุณาระบุวันและเวลาสิ้นสุดโปรโมชั่น';
      }
      const endIso = buildBangkokISO(formData.endDate, formData.endTime);
      if (!endIso || isNaN(Date.parse(endIso))) {
        return 'กรุณาระบุวันและเวลาสิ้นสุดโปรโมชั่นให้ถูกต้อง';
      }
      if (Date.parse(endIso) <= Date.parse(startIso)) {
        return 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้นโปรโมชั่น';
      }
    }
    return null;
  };

  const isDirty = initialFormData ? (
    formData.promotion_name.trim() !== initialFormData.promotion_name.trim() ||
    String(formData.discount_value).trim() !== String(initialFormData.discount_value).trim() ||
    formData.startDate !== initialFormData.startDate ||
    formData.startTime !== initialFormData.startTime ||
    formData.hasEndDate !== initialFormData.hasEndDate ||
    (formData.hasEndDate && (formData.endDate !== initialFormData.endDate || formData.endTime !== initialFormData.endTime))
  ) : false;

  const handleCancel = () => {
    if (initialFormData) {
      setFormData(initialFormData);
      setFormError(null);
      setFormSuccess(null);
    }
  };

  const handleSavePromotion = async (e) => {
    if (e) e.preventDefault();
    const validationError = validateClientForm();
    if (validationError) {
      setFormError(validationError);
      if (sysAlert) sysAlert(validationError);
      return;
    }

    if (currentStatus === 'active') {
      const activeErr = 'กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า';
      setFormError(activeErr);
      if (sysAlert) sysAlert(activeErr);
      return;
    }

    setSaveLoading(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const startIso = buildBangkokISO(formData.startDate, formData.startTime);
      const endIso = formData.hasEndDate ? buildBangkokISO(formData.endDate, formData.endTime) : null;

      const payload = {
        promotion_name: formData.promotion_name.trim() || 'โปรโมชั่นจองออนไลน์',
        discount_value: Math.round((Number(formData.discount_value) + Number.EPSILON) * 100) / 100,
        start_at: startIso,
        end_at: endIso
      };

      const res = await fetch('/api/admin/promotion', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const canonical = data.promotion || data;
        setPromoData(canonical);
        syncFormFromPromoData(canonical);
        const msg = data.message || 'บันทึกการตั้งค่าโปรโมชั่นเรียบร้อยแล้ว';
        setFormSuccess(msg);
        if (sysAlert) sysAlert(msg);
      } else {
        const errMsg = data.error || 'ไม่สามารถบันทึกการตั้งค่าโปรโมชั่นได้';
        setFormError(errMsg);
        if (sysAlert) sysAlert(errMsg);
      }
    } catch (err) {
      const errMsg = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
      setFormError(errMsg);
      if (sysAlert) sysAlert(errMsg);
    } finally {
      setSaveLoading(false);
    }
  };

  // Canonical status resolution
  const currentStatus = promoData?.status || 'upcoming';

  const statusLabelMap = {
    upcoming: 'รอเปิดใช้งาน',
    ready: 'พร้อมเปิดใช้งาน',
    active: 'กำลังใช้งาน',
    ended: 'สิ้นสุดแล้ว'
  };

  // Dynamic preview calculation (UI-only, ฿1,000 base)
  const previewBasePrice = 1000;
  const numDiscount = parseFloat(formData.discount_value) || 0;
  const discountAmount = (previewBasePrice * numDiscount) / 100;
  const previewNetPrice = Math.max(0, Math.round((previewBasePrice - discountAmount) * 100) / 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px', width: '100%', margin: '0 auto' }}>
      
      {/* 1. Page Header */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '16px',
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
          }}>
            <Tag size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-main, #0f172a)' }}>
              ตั้งค่าโปรโมชั่น
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #64748b)', margin: '2px 0 0 0' }}>
              จัดการโปรโมชั่นสำหรับการจองออนไลน์
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefreshClick}
          disabled={promoLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 14px',
            borderRadius: '8px',
            border: '1px solid var(--border-color, #cbd5e1)',
            backgroundColor: 'transparent',
            color: 'var(--text-muted, #475569)',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: promoLoading ? 'not-allowed' : 'pointer'
          }}
          title="รีเฟรชข้อมูลโปรโมชั่น"
          aria-label="รีเฟรชข้อมูลโปรโมชั่น"
        >
          <RefreshCw size={14} className={promoLoading ? 'spin' : ''} />
          <span>{promoLoading ? 'กำลังรีเฟรช...' : 'รีเฟรช'}</span>
        </button>
      </div>

      {/* Active Promotion Edit Lock Banner */}
      {currentStatus === 'active' && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          border: '1.5px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#dc2626'
        }}>
          <AlertCircle size={22} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.875rem', lineHeight: 1.45 }}>
            <strong>กรุณาหยุดโปรโมชั่นก่อนแก้ไขการตั้งค่า:</strong> โปรโมชั่นกำลังเปิดใช้งานอยู่ กรุณากดปุ่ม <strong>"หยุดใช้งานโปรโมชั่น"</strong> ด้านล่างก่อนแก้ไขการตั้งค่า เพื่อป้องกันผลกระทบต่อราคาการจองของลูกค้า
          </div>
        </div>
      )}

      {/* 2. CARD 1 — ข้อมูลโปรโมชั่น (Full-width) */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2563eb'
          }}>
            <FileText size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main, #0f172a)' }}>
              ข้อมูลโปรโมชั่น
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', margin: '2px 0 0 0' }}>
              ตั้งชื่อและกำหนดช่องทางการใช้โปรโมชั่น
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {/* LEFT: ชื่อโปรโมชั่น * */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
              ชื่อโปรโมชั่น <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={formData.promotion_name}
              onChange={(e) => setFormData(prev => ({ ...prev, promotion_name: e.target.value }))}
              disabled={currentStatus === 'active' || saveLoading}
              placeholder="โปรโมชั่นจองออนไลน์"
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                backgroundColor: currentStatus === 'active' ? 'rgba(0, 0, 0, 0.04)' : 'var(--bg-card-solid, #ffffff)',
                color: 'var(--text-main, #0f172a)',
                fontSize: '0.9rem',
                cursor: currentStatus === 'active' ? 'not-allowed' : 'text'
              }}
            />
          </div>

          {/* RIGHT: ช่องทาง (Read-only visual field with green treatment) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
              ช่องทาง
            </label>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              color: '#059669',
              fontSize: '0.875rem',
              fontWeight: 600
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
              <span>LINE OA / Online Booking (อ่านอย่างเดียว)</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', margin: '4px 0 0 0' }}>
              ใช้ได้เฉพาะการจองผ่าน LINE OA และระบบออนไลน์ (การจองหน้าร้านและ POS คิดราคาเต็ม)
            </p>
          </div>
        </div>
      </div>

      {/* 3. CARD 2 — ตั้งค่าส่วนลด (Full-width) */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2563eb'
          }}>
            <Percent size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main, #0f172a)' }}>
              ตั้งค่าส่วนลด
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', margin: '2px 0 0 0' }}>
              กำหนดเปอร์เซ็นต์ส่วนลดสำหรับการจองออนไลน์เท่านั้น
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', alignItems: 'center' }}>
          {/* LEFT: ส่วนลด (%) * */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
              ส่วนลด (%) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '220px' }}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                value={formData.discount_value}
                onChange={(e) => setFormData(prev => ({ ...prev, discount_value: e.target.value }))}
                disabled={currentStatus === 'active' || saveLoading}
                placeholder="5"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: currentStatus === 'active' ? 'rgba(0, 0, 0, 0.04)' : 'var(--bg-card-solid, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: currentStatus === 'active' ? 'not-allowed' : 'text'
                }}
              />
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-muted, #64748b)' }}>%</span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', margin: '8px 0 0 0', lineHeight: 1.4 }}>
              ส่วนลดนี้จะใช้เฉพาะการจองผ่านช่องทางออนไลน์ (LINE OA / Online Booking) เท่านั้น
            </p>
          </div>

          {/* RIGHT: Dynamic Price Preview Panel */}
          <div style={{
            backgroundColor: 'rgba(248, 250, 252, 0.9)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '12px',
            padding: '16px 20px'
          }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted, #64748b)', marginBottom: '12px' }}>
              ตัวอย่างราคาเมื่อใช้โปรโมชั่น
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginBottom: '2px' }}>ราคาปกติ</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', textDecoration: 'line-through' }}>
                  ฿1,000
                </div>
              </div>

              <div style={{ color: 'var(--text-muted, #94a3b8)', display: 'flex', alignItems: 'center' }}>
                <ArrowRight size={20} />
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, marginBottom: '2px' }}>ราคาหลังโปรโมชั่น</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981' }}>
                  ฿{previewNetPrice.toLocaleString('th-TH')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Lower Layout: CARD 3 (Left) & CARD 4 (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        
        {/* 4. CARD 3 — ระยะเวลาโปรโมชั่น (Lower Left) */}
        <div style={{
          background: 'var(--bg-card, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'rgba(37, 99, 235, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#2563eb'
            }}>
              <CalendarDays size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main, #0f172a)' }}>
                ระยะเวลาโปรโมชั่น
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', margin: '2px 0 0 0' }}>
                กำหนดช่วงเวลาที่โปรโมชั่นเริ่มต้นและสิ้นสุด
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Start Date & Time: DD/MM/YYYY and 24-hr HH:mm */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
                วันเริ่มต้นโปรโมชั่น <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Visible DD/MM/YYYY text input with calendar picker helper */}
                <div style={{ position: 'relative', flex: '1 1 150px' }}>
                  <input
                    type="text"
                    value={formData.startDate}
                    onChange={(e) => handleDateChange(e.target.value, 'startDate')}
                    disabled={currentStatus === 'active' || saveLoading}
                    placeholder="13/10/2026"
                    maxLength={10}
                    style={{
                      width: '100%',
                      padding: '8px 36px 8px 12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: currentStatus === 'active' ? 'rgba(0, 0, 0, 0.04)' : 'var(--bg-card-solid, #ffffff)',
                      color: 'var(--text-main, #0f172a)',
                      fontSize: '0.88rem',
                      cursor: currentStatus === 'active' ? 'not-allowed' : 'text'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (currentStatus === 'active' || saveLoading) return;
                      startDatePickerRef.current?.showPicker ? startDatePickerRef.current.showPicker() : startDatePickerRef.current?.focus();
                    }}
                    disabled={currentStatus === 'active' || saveLoading}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: currentStatus === 'active' ? 'not-allowed' : 'pointer',
                      color: 'var(--text-muted, #64748b)',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="เลือกวันที่จากปฏิทิน"
                  >
                    <CalendarDays size={16} />
                  </button>
                  <input
                    ref={startDatePickerRef}
                    type="date"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      pointerEvents: 'none',
                      width: '1px',
                      height: '1px',
                      bottom: 0,
                      right: 0
                    }}
                    onChange={(e) => handleNativeDatePick(e.target.value, 'startDate')}
                  />
                </div>

                {/* 24-hour time input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap' }}>
                    เวลาเริ่มต้น <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ width: '85px' }}>
                    <input
                      type="text"
                      value={formData.startTime}
                      onChange={(e) => handleTimeChange(e.target.value, 'startTime')}
                      disabled={currentStatus === 'active' || saveLoading}
                      placeholder="08:00"
                      maxLength={5}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color, #cbd5e1)',
                        backgroundColor: currentStatus === 'active' ? 'rgba(0, 0, 0, 0.04)' : 'var(--bg-card-solid, #ffffff)',
                        color: 'var(--text-main, #0f172a)',
                        fontSize: '0.88rem',
                        textAlign: 'center',
                        cursor: currentStatus === 'active' ? 'not-allowed' : 'text'
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>น.</span>
                </div>
              </div>
            </div>

            {/* End Date & Time Section */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main, #0f172a)', marginBottom: '8px' }}>
                วันสิ้นสุดโปรโมชั่น <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: currentStatus === 'active' ? 'not-allowed' : 'pointer', fontSize: '0.88rem' }}>
                    <input
                      type="radio"
                      name="endDateMode"
                      checked={!formData.hasEndDate}
                      onChange={() => setFormData(prev => ({ ...prev, hasEndDate: false }))}
                      disabled={currentStatus === 'active' || saveLoading}
                    />
                    <span style={{ fontWeight: 500 }}>ไม่กำหนด</span>
                  </label>
                  {!formData.hasEndDate && (
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted, #64748b)', marginLeft: '24px', marginTop: '2px' }}>
                      โปรโมชั่นจะไม่มีวันสิ้นสุด จนกว่าจะมีการเปลี่ยนแปลง
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: currentStatus === 'active' ? 'not-allowed' : 'pointer', fontSize: '0.88rem' }}>
                    <input
                      type="radio"
                      name="endDateMode"
                      checked={formData.hasEndDate}
                      onChange={() => setFormData(prev => ({ ...prev, hasEndDate: true }))}
                      disabled={currentStatus === 'active' || saveLoading}
                    />
                    <span style={{ fontWeight: 500 }}>กำหนดวันสิ้นสุด</span>
                  </label>
                  {formData.hasEndDate && (
                    <div style={{ marginLeft: '24px', marginTop: '6px' }}>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {/* Visible DD/MM/YYYY end date input */}
                        <div style={{ position: 'relative', flex: '1 1 140px' }}>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginBottom: '3px' }}>วันที่สิ้นสุด</label>
                          <input
                            type="text"
                            value={formData.endDate}
                            onChange={(e) => handleDateChange(e.target.value, 'endDate')}
                            disabled={currentStatus === 'active' || saveLoading}
                            placeholder="20/10/2026"
                            maxLength={10}
                            style={{
                              width: '100%',
                              padding: '8px 36px 8px 10px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color, #cbd5e1)',
                              backgroundColor: currentStatus === 'active' ? 'rgba(0, 0, 0, 0.04)' : 'var(--bg-card-solid, #ffffff)',
                              color: 'var(--text-main, #0f172a)',
                              fontSize: '0.86rem',
                              cursor: currentStatus === 'active' ? 'not-allowed' : 'text'
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (currentStatus === 'active' || saveLoading) return;
                              endDatePickerRef.current?.showPicker ? endDatePickerRef.current.showPicker() : endDatePickerRef.current?.focus();
                            }}
                            disabled={currentStatus === 'active' || saveLoading}
                            style={{
                              position: 'absolute',
                              right: '8px',
                              top: '28px',
                              background: 'none',
                              border: 'none',
                              cursor: currentStatus === 'active' ? 'not-allowed' : 'pointer',
                              color: 'var(--text-muted, #64748b)',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                            title="เลือกวันที่จากปฏิทิน"
                          >
                            <CalendarDays size={16} />
                          </button>
                          <input
                            ref={endDatePickerRef}
                            type="date"
                            tabIndex={-1}
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              opacity: 0,
                              pointerEvents: 'none',
                              width: '1px',
                              height: '1px',
                              bottom: 0,
                              right: 0
                            }}
                            onChange={(e) => handleNativeDatePick(e.target.value, 'endDate')}
                          />
                        </div>

                        {/* 24-hour time input */}
                        <div style={{ width: '90px' }}>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', marginBottom: '3px' }}>เวลาสิ้นสุด</label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input
                              type="text"
                              value={formData.endTime}
                              onChange={(e) => handleTimeChange(e.target.value, 'endTime')}
                              disabled={currentStatus === 'active' || saveLoading}
                              placeholder="23:59"
                              maxLength={5}
                              style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                border: '1px solid var(--border-color, #cbd5e1)',
                                backgroundColor: currentStatus === 'active' ? 'rgba(0, 0, 0, 0.04)' : 'var(--bg-card-solid, #ffffff)',
                                color: 'var(--text-main, #0f172a)',
                                fontSize: '0.86rem',
                                textAlign: 'center',
                                cursor: currentStatus === 'active' ? 'not-allowed' : 'text'
                              }}
                            />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>น.</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted, #64748b)', marginTop: '4px' }}>
                        ระบุวันที่สิ้นสุดของโปรโมชั่น (รูปแบบ DD/MM/YYYY และ HH:mm)
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 5. CARD 4 — สถานะปัจจุบัน (Lower Right) */}
        <div style={{
          background: 'var(--bg-card, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '20px'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563eb'
              }}>
                <Power size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-main, #0f172a)' }}>
                  สถานะปัจจุบัน
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', margin: '2px 0 0 0' }}>
                  สถานะของโปรโมชั่นในขณะนี้
                </p>
              </div>
            </div>

            {/* Status Box */}
            <div style={{
              padding: '18px 20px',
              borderRadius: '12px',
              backgroundColor:
                currentStatus === 'upcoming' ? 'rgba(245, 158, 11, 0.08)' :
                currentStatus === 'ready' ? 'rgba(37, 99, 235, 0.08)' :
                currentStatus === 'active' ? 'rgba(16, 185, 129, 0.08)' :
                'rgba(107, 114, 128, 0.08)',
              border: `1px solid ${
                currentStatus === 'upcoming' ? 'rgba(245, 158, 11, 0.25)' :
                currentStatus === 'ready' ? 'rgba(37, 99, 235, 0.25)' :
                currentStatus === 'active' ? 'rgba(16, 185, 129, 0.25)' :
                'rgba(107, 114, 128, 0.25)'
              }`,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor:
                    currentStatus === 'upcoming' ? '#f59e0b' :
                    currentStatus === 'ready' ? '#3b82f6' :
                    currentStatus === 'active' ? '#10b981' :
                    '#6b7280'
                }}></span>
                <span style={{
                  fontSize: '1.05rem',
                  fontWeight: 800,
                  color:
                    currentStatus === 'upcoming' ? '#d97706' :
                    currentStatus === 'ready' ? '#2563eb' :
                    currentStatus === 'active' ? '#059669' :
                    '#4b5563'
                }}>
                  {statusLabelMap[currentStatus]}
                </span>
              </div>

              <div style={{
                fontSize: '0.84rem',
                color:
                  currentStatus === 'upcoming' ? '#b45309' :
                  currentStatus === 'ready' ? '#1d4ed8' :
                  currentStatus === 'active' ? '#047857' :
                  '#4b5563',
                lineHeight: 1.5
              }}>
                {currentStatus === 'upcoming' && (
                  <span>
                    {promoData?.start_at && promoData.start_at !== '2026-10-13T08:00:00+07:00'
                      ? `โปรโมชั่นนี้สามารถเปิดใช้งานได้ตั้งแต่ ${formatBangkokDisplay(promoData.start_at)} เป็นต้นไป`
                      : 'โปรโมชั่นนี้สามารถเปิดใช้งานได้ตั้งแต่ 13 ต.ค. 2026 เวลา 08:00 น. เป็นต้นไป'}
                  </span>
                )}
                {currentStatus === 'ready' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span>โปรโมชั่นถึงกำหนดเวลาเริ่มต้นแล้ว สามารถเปิดใช้งานได้ทันที</span>
                    {promoData?.end_at && (
                      <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                        สิ้นสุด {formatBangkokDisplay(promoData.end_at)}
                      </span>
                    )}
                  </div>
                )}
                {currentStatus === 'active' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span>โปรโมชั่นกำลังเปิดใช้งานและมอบส่วนลดสำหรับการจองออนไลน์</span>
                    {promoData?.end_at && (
                      <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                        สิ้นสุด {formatBangkokDisplay(promoData.end_at)}
                      </span>
                    )}
                  </div>
                )}
                {currentStatus === 'ended' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span>โปรโมชั่นสิ้นสุดระยะเวลาแล้ว (แก้ไขวันสิ้นสุดเพื่อเปิดใช้งานใหม่)</span>
                    {promoData?.end_at && (
                      <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                        สิ้นสุด {formatBangkokDisplay(promoData.end_at)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Audit Trail Info (Compact) */}
          {(promoData?.activated_at || promoData?.deactivated_at || promoData?.updated_at) && (
            <div style={{
              paddingTop: '12px',
              borderTop: '1px solid var(--border-color, #f1f5f9)',
              fontSize: '0.75rem',
              color: 'var(--text-muted, #64748b)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              {promoData?.updated_at && (
                <div>แก้ไขล่าสุด: {promoData.updated_at} โดย {promoData.updated_by || '-'}</div>
              )}
              {promoData?.activated_at && (
                <div>เปิดใช้งานล่าสุด: {promoData.activated_at} โดย {promoData.activated_by || '-'}</div>
              )}
              {promoData?.deactivated_at && (
                <div>หยุดใช้งานล่าสุด: {promoData.deactivated_at} โดย {promoData.deactivated_by || '-'}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 6. BOTTOM ACTION BAR */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-color, #e2e8f0)',
        borderRadius: '16px',
        padding: '16px 24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Left: Unsaved Changes / Messages */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {isDirty && (
            <span style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#d97706',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid rgba(245, 158, 11, 0.25)'
            }}>
              มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
            </span>
          )}
          {formError && (
            <span style={{ fontSize: '0.82rem', color: '#dc2626', fontWeight: 600 }}>
              {formError}
            </span>
          )}
          {formSuccess && (
            <span style={{ fontSize: '0.82rem', color: '#16a34a', fontWeight: 600 }}>
              {formSuccess}
            </span>
          )}
        </div>

        {/* Right: Actions: [ ยกเลิก ] [ บันทึกการตั้งค่า ] [ เปิดใช้งานโปรโมชั่น / หยุดใช้งานโปรโมชั่น ] */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {/* Cancel button: Resets unsaved form changes back to last canonical backend values */}
          <button
            type="button"
            onClick={handleCancel}
            disabled={!isDirty || currentStatus === 'active' || saveLoading}
            style={{
              height: '40px',
              padding: '0 18px',
              borderRadius: '10px',
              border: '1px solid var(--border-color, #cbd5e1)',
              backgroundColor: 'transparent',
              color: 'var(--text-main, #334155)',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: (!isDirty || currentStatus === 'active' || saveLoading) ? 'not-allowed' : 'pointer',
              opacity: (!isDirty || currentStatus === 'active' || saveLoading) ? 0.5 : 1
            }}
          >
            ยกเลิก
          </button>

          {/* Save button: ALWAYS visible, calls handleSavePromotion */}
          <button
            type="button"
            onClick={handleSavePromotion}
            disabled={currentStatus === 'active' || !isDirty || Boolean(validateClientForm()) || saveLoading}
            style={{
              height: '40px',
              padding: '0 20px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: (currentStatus === 'active' || !isDirty || Boolean(validateClientForm()) || saveLoading) ? 'not-allowed' : 'pointer',
              opacity: (currentStatus === 'active' || !isDirty || Boolean(validateClientForm()) || saveLoading) ? 0.5 : 1,
              boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)'
            }}
          >
            {saveLoading ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </button>

          {/* Activation / Deactivation button */}
          {currentStatus === 'active' ? (
            <button
              type="button"
              onClick={handleDeactivatePromotion}
              disabled={promoActionLoading}
              style={{
                height: '40px',
                padding: '0 20px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#ef4444',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: promoActionLoading ? 'not-allowed' : 'pointer',
                opacity: promoActionLoading ? 0.6 : 1,
                boxShadow: '0 1px 2px rgba(239, 68, 68, 0.2)'
              }}
            >
              {promoActionLoading ? 'กำลังดำเนินการ...' : 'หยุดใช้งานโปรโมชั่น'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleActivatePromotion}
              disabled={promoActionLoading || currentStatus === 'upcoming' || currentStatus === 'ended'}
              style={{
                height: '40px',
                padding: '0 20px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: (currentStatus === 'upcoming' || currentStatus === 'ended') ? '#94a3b8' : '#10b981',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: (promoActionLoading || currentStatus === 'upcoming' || currentStatus === 'ended') ? 'not-allowed' : 'pointer',
                opacity: (currentStatus === 'upcoming' || currentStatus === 'ended') ? 0.6 : 1,
                boxShadow: (currentStatus === 'ready') ? '0 1px 2px rgba(16, 185, 129, 0.2)' : 'none'
              }}
            >
              {promoActionLoading ? 'กำลังดำเนินการ...' : 'เปิดใช้งานโปรโมชั่น'}
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Dialog for Unsaved Changes on Refresh */}
      {showRefreshConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            padding: '28px',
            borderRadius: '20px',
            backgroundColor: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            boxShadow: '0 24px 70px rgba(0, 0, 0, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px'
          }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main, #0f172a)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={20} color="#d97706" />
              <span>ยืนยันการรีเฟรชข้อมูล</span>
            </h3>

            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-main, #334155)', margin: 0, whiteSpace: 'pre-line' }}>
              มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก{'\n'}หากรีเฟรช ข้อมูลที่แก้ไขจะถูกยกเลิกและโหลดค่าล่าสุดจากระบบ
            </p>

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowRefreshConfirm(false)}
                style={{
                  minWidth: '90px',
                  padding: '9px 16px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-main, #334155)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer'
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowRefreshConfirm(false);
                  await executeRefresh(true);
                }}
                style={{
                  minWidth: '110px',
                  padding: '9px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)'
                }}
              >
                รีเฟรชข้อมูล
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default PromotionSettings;
