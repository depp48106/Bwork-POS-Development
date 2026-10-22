import React, { useState, useRef } from 'react';
import {
  Upload, Image, FileText, CheckCircle2, AlertCircle, X,
  Building, User, Mail, Phone, MapPin, ChevronDown, ChevronUp, Sparkles
} from 'lucide-react';

/**
 * Validates file signature (magic bytes) for images on the client side.
 */
function validateClientFileSignature(file) {
  return new Promise((resolve) => {
    if (!file) return resolve({ valid: false, error: 'ไม่พบไฟล์' });
    if (file.size > 10 * 1024 * 1024) {
      return resolve({ valid: false, error: 'ขนาดไฟล์เกิน 10MB กรุณาเลือกไฟล์ที่มีขนาดเล็กลง' });
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = new Uint8Array(e.target.result);
      if (buffer.length < 4) {
        return resolve({ valid: false, error: 'ไฟล์ไม่สมบูรณ์' });
      }

      // Check PNG (0x89 0x50 0x4E 0x47)
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return resolve({ valid: true, ext: 'png', mime: 'image/png' });
      }
      // Check JPEG (0xFF 0xD8 0xFF)
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return resolve({ valid: true, ext: 'jpg', mime: 'image/jpeg' });
      }
      // Check WEBP (RIFF....WEBP)
      if (buffer.length >= 12 &&
          buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
          buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return resolve({ valid: true, ext: 'webp', mime: 'image/webp' });
      }

      return resolve({ valid: false, error: 'ชนิดไฟล์ไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ JPG, PNG หรือ WEBP' });
    };
    reader.onerror = () => resolve({ valid: false, error: 'ไม่สามารถอ่านไฟล์ได้' });
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

/**
 * Reusable POS Checkout Payment Slip & Tax Invoice Component.
 */
export default function POSTaxAndSlipSection({
  // Payment Method to determine if slip attachment should be highlighted
  paymentMethod,
  // Slip State
  slipImage,
  setSlipImage,
  slipFileName,
  setSlipFileName,
  // Tax Invoice State
  taxInvoiceRequired,
  setTaxInvoiceRequired,
  taxPayerType,
  setTaxPayerType,
  taxName,
  setTaxName,
  taxId,
  setTaxId,
  taxBranchType,
  setTaxBranchType,
  taxBranchNumber,
  setTaxBranchNumber,
  taxAddress,
  setTaxAddress,
  taxEmail,
  setTaxEmail,
  taxPhone,
  setTaxPhone,
  taxDeliveryMethod,
  setTaxDeliveryMethod,
  taxPostalAddress,
  setTaxPostalAddress,
  // Context customer (for CRM autofill)
  customer = null,
  sysAlert = null,
  isCompact = false
}) {
  const [slipError, setSlipError] = useState(null);
  const [isTaxExpanded, setIsTaxExpanded] = useState(taxInvoiceRequired);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const cleanTaxId = (taxId || '').replace(/[-\s]/g, '');
  const isTaxIdValid = cleanTaxId.length === 13 && /^\d+$/.test(cleanTaxId);

  // Handle Slip Upload
  const handleSlipFile = async (file) => {
    if (!file) return;
    setSlipError(null);

    const validation = await validateClientFileSignature(file);
    if (!validation.valid) {
      setSlipError(validation.error);
      if (sysAlert) sysAlert(validation.error);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      setSlipImage(uploadEvent.target.result);
      setSlipFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleSlipChange = (e) => {
    const file = e.target.files?.[0];
    handleSlipFile(file);
  };

  const handleClearSlip = () => {
    setSlipImage(null);
    setSlipFileName('');
    setSlipError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Autofill from selected CRM customer
  const handleAutofillFromCustomer = () => {
    if (!customer) return;
    if (customer.name && !taxName) setTaxName(customer.name);
    else if (customer.name) setTaxName(customer.name);

    if (customer.tax_id) setTaxId(customer.tax_id);
    if (customer.address) setTaxAddress(customer.address);
    if (customer.email) setTaxEmail(customer.email);
    if (customer.phone) setTaxPhone(customer.phone);

    if (customer.customer_type === 'basecamp' || customer.customer_type === 'shop') {
      setTaxPayerType('corporate');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
      {/* 1. PAYMENT SLIP EVIDENCE SECTION */}
      <div style={{
        borderRadius: '10px',
        backgroundColor: 'var(--bg-main, #f8fafc)',
        border: slipImage ? '1.5px solid #2563eb' : '1px dashed var(--border-color, #cbd5e1)',
        padding: isCompact ? '8px 10px' : '10px 12px',
        transition: 'all 0.2s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: slipImage ? '8px' : '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={14} style={{ color: paymentMethod === 'transfer' ? '#2563eb' : 'var(--text-muted)' }} />
            <span style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: 'var(--text-main)'
            }}>
              แนบหลักฐานสลิปการชำระเงิน {paymentMethod === 'transfer' ? '(โอนเงิน / PromptPay)' : '(ไม่บังคับ)'}
            </span>
          </div>

          {!slipImage ? (
            <button
              type="button"
              id="pos-btn-select-slip"
              onClick={() => fileInputRef.current?.click()}
              style={{
                height: '26px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card, #ffffff)',
                color: 'var(--primary-color, #2563eb)',
                fontSize: '0.72rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
            >
              <Image size={12} />
              <span>แนบสลิป</span>
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                id="pos-btn-replace-slip"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  height: '24px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: '#2563eb',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                เปลี่ยนรูป
              </button>
              <button
                type="button"
                id="pos-btn-clear-slip"
                onClick={handleClearSlip}
                style={{
                  height: '24px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: '1px solid #ef4444',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  color: '#ef4444',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  cursor: 'pointer'
                }}
              >
                <X size={11} />
                <span>ลบสลิป</span>
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            id="pos-file-input-slip"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            style={{ display: 'none' }}
            onChange={handleSlipChange}
          />
        </div>

        {/* Drop Zone / Upload Area when no slip attached */}
        {!slipImage && (
          <div
            id="pos-slip-dropzone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleSlipFile(file);
            }}
            style={{
              marginTop: '6px',
              padding: isCompact ? '8px 10px' : '10px 12px',
              borderRadius: '8px',
              border: isDragging ? '1.5px dashed #2563eb' : (paymentMethod === 'transfer' ? '1.5px dashed rgba(37, 99, 235, 0.45)' : '1px dashed var(--border-color)'),
              backgroundColor: isDragging ? 'rgba(37, 99, 235, 0.08)' : (paymentMethod === 'transfer' ? 'rgba(37, 99, 235, 0.04)' : 'transparent'),
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
          >
            <Upload size={14} style={{ color: paymentMethod === 'transfer' ? '#2563eb' : 'var(--text-muted)' }} />
            <span style={{ fontSize: '0.72rem', color: paymentMethod === 'transfer' ? '#2563eb' : 'var(--text-muted)', fontWeight: 650 }}>
              {paymentMethod === 'transfer' ? 'ลูกค้าสแกน QR แล้ว คลิกหรือลากไฟล์สลิปมาวางที่นี่' : 'คลิกหรือลากไฟล์สลิปมาวางที่นี่ (ถ้ามี)'}
            </span>
          </div>
        )}

        {slipError && (
          <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <AlertCircle size={12} />
            <span>{slipError}</span>
          </div>
        )}

        {slipImage && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '6px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '6px',
              overflow: 'hidden',
              flexShrink: 0,
              backgroundColor: '#000',
              border: '1px solid var(--border-color)'
            }}>
              <img
                src={slipImage}
                alt="สลิปที่แนบ"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: 'var(--text-main)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {slipFileName || 'สลิปโอนเงิน'}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                <CheckCircle2 size={11} />
                <span>แนบหลักฐานเรียบร้อย (พร้อมบันทึกธุรกรรม)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. TAX INVOICE MANAGEMENT SECTION */}
      <div style={{
        borderRadius: '10px',
        backgroundColor: 'var(--bg-main, #f8fafc)',
        border: taxInvoiceRequired ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
        overflow: 'hidden',
        transition: 'all 0.2s ease'
      }}>
        {/* Toggle Header */}
        <div
          style={{
            padding: isCompact ? '8px 10px' : '10px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            backgroundColor: taxInvoiceRequired ? 'rgba(37, 99, 235, 0.05)' : 'transparent'
          }}
          onClick={() => {
            const next = !taxInvoiceRequired;
            setTaxInvoiceRequired(next);
            setIsTaxExpanded(next);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="pos-tax-invoice-req"
              checked={taxInvoiceRequired}
              onChange={(e) => {
                e.stopPropagation();
                setTaxInvoiceRequired(e.target.checked);
                setIsTaxExpanded(e.target.checked);
              }}
              style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: '#2563eb' }}
            />
            <label
              htmlFor="pos-tax-invoice-req"
              style={{
                fontSize: '0.74rem',
                fontWeight: 750,
                color: 'var(--text-main)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <FileText size={14} style={{ color: taxInvoiceRequired ? '#2563eb' : 'var(--text-muted)' }} />
              <span>ลูกค้าต้องการใบกำกับภาษี</span>
              {taxInvoiceRequired && (
                <span style={{
                  fontSize: '0.65rem',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  fontWeight: 800
                }}>
                  ระบุข้อมูล
                </span>
              )}
            </label>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsTaxExpanded(!isTaxExpanded);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px',
              cursor: 'pointer',
              color: 'var(--text-muted)'
            }}
          >
            {isTaxExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>

        {/* Collapsible Form Body */}
        {taxInvoiceRequired && isTaxExpanded && (
          <div style={{
            padding: isCompact ? '10px' : '12px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            backgroundColor: 'var(--bg-card, #ffffff)'
          }}>
            {/* Type selector & CRM Autofill button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setTaxPayerType('corporate')}
                  style={{
                    height: '26px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    fontSize: '0.7rem',
                    fontWeight: taxPayerType === 'corporate' ? 800 : 600,
                    border: taxPayerType === 'corporate' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                    backgroundColor: taxPayerType === 'corporate' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                    color: taxPayerType === 'corporate' ? '#2563eb' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Building size={12} />
                  <span>นิติบุคคล</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTaxPayerType('individual')}
                  style={{
                    height: '26px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    fontSize: '0.7rem',
                    fontWeight: taxPayerType === 'individual' ? 800 : 600,
                    border: taxPayerType === 'individual' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                    backgroundColor: taxPayerType === 'individual' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                    color: taxPayerType === 'individual' ? '#2563eb' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <User size={12} />
                  <span>บุคคลธรรมดา</span>
                </button>
              </div>

              {customer && (customer.name || customer.tax_id) && (
                <button
                  type="button"
                  onClick={handleAutofillFromCustomer}
                  title="คัดลอกข้อมูลจากโปรไฟล์ลูกค้า"
                  style={{
                    height: '26px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    color: '#059669',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Sparkles size={11} />
                  <span>ดึงจากโปรไฟล์ลูกค้า</span>
                </button>
              )}
            </div>

            {/* Tax Name */}
            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                ชื่อผู้เสียภาษี (ตาม ภ.พ.20 หรือ บัตรประชาชน) *
              </label>
              <input
                type="text"
                value={taxName}
                onChange={(e) => setTaxName(e.target.value)}
                placeholder="เช่น บริษัท บีเวิร์ค จำกัด หรือ นายสมชาย ใจดี"
                style={{
                  width: '100%',
                  height: '30px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-main)',
                  padding: '0 8px',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Tax ID & Branch */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '6px' }}>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>เลขประจำตัวผู้เสียภาษี (13 หลัก)</span>
                  {cleanTaxId && (
                    <span style={{ fontSize: '0.65rem', color: isTaxIdValid ? '#10b981' : '#f59e0b', fontWeight: 800 }}>
                      {cleanTaxId.length}/13
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  maxLength={17}
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="0105556012345"
                  style={{
                    width: '100%',
                    height: '30px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    padding: '0 8px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                    color: 'var(--text-main)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                  สำนักงานใหญ่ / สาขา
                </label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setTaxBranchType('head')}
                    style={{
                      flex: 1,
                      height: '30px',
                      borderRadius: '6px',
                      fontSize: '0.68rem',
                      fontWeight: taxBranchType === 'head' ? 800 : 600,
                      border: taxBranchType === 'head' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                      backgroundColor: taxBranchType === 'head' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                      color: taxBranchType === 'head' ? '#2563eb' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    สำนักงานใหญ่
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaxBranchType('branch')}
                    style={{
                      flex: 1,
                      height: '30px',
                      borderRadius: '6px',
                      fontSize: '0.68rem',
                      fontWeight: taxBranchType === 'branch' ? 800 : 600,
                      border: taxBranchType === 'branch' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                      backgroundColor: taxBranchType === 'branch' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                      color: taxBranchType === 'branch' ? '#2563eb' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    สาขา
                  </button>
                </div>
              </div>
            </div>

            {taxBranchType === 'branch' && (
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                  รหัสสาขา 5 หลัก *
                </label>
                <input
                  type="text"
                  maxLength={5}
                  value={taxBranchNumber}
                  onChange={(e) => setTaxBranchNumber(e.target.value)}
                  placeholder="เช่น 00001"
                  style={{
                    width: '100%',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    padding: '0 8px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    color: 'var(--text-main)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}

            {/* Address */}
            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                ที่อยู่ออกใบกำกับภาษี
              </label>
              <textarea
                rows={2}
                value={taxAddress}
                onChange={(e) => setTaxAddress(e.target.value)}
                placeholder="เลขที่ อาคาร ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                style={{
                  width: '100%',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-main)',
                  padding: '6px 8px',
                  fontSize: '0.72rem',
                  lineHeight: 1.4,
                  fontWeight: 500,
                  color: 'var(--text-main)',
                  resize: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Email & Phone */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '6px' }}>
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Mail size={11} />
                  <span>อีเมลรับเอกสาร (e-Tax)</span>
                </label>
                <input
                  type="email"
                  value={taxEmail}
                  onChange={(e) => setTaxEmail(e.target.value)}
                  placeholder="accounting@company.com"
                  style={{
                    width: '100%',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    padding: '0 8px',
                    fontSize: '0.72rem',
                    color: 'var(--text-main)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Phone size={11} />
                  <span>เบอร์ติดต่อ</span>
                </label>
                <input
                  type="text"
                  value={taxPhone}
                  onChange={(e) => setTaxPhone(e.target.value)}
                  placeholder="081-234-5678"
                  style={{
                    width: '100%',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    padding: '0 8px',
                    fontSize: '0.72rem',
                    color: 'var(--text-main)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            {/* Delivery Method */}
            <div>
              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                ช่องทางรับเอกสาร
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                {[
                  { key: 'email', label: 'อีเมล (e-Tax)' },
                  { key: 'pickup', label: 'รับที่สาขา' },
                  { key: 'postal', label: 'ส่งไปรษณีย์' }
                ].map((d) => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setTaxDeliveryMethod(d.key)}
                    style={{
                      height: '26px',
                      borderRadius: '6px',
                      fontSize: '0.68rem',
                      fontWeight: taxDeliveryMethod === d.key ? 800 : 600,
                      border: taxDeliveryMethod === d.key ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                      backgroundColor: taxDeliveryMethod === d.key ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                      color: taxDeliveryMethod === d.key ? '#2563eb' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {taxDeliveryMethod === 'postal' && (
              <div>
                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                  ที่อยู่จัดส่งเอกสารทางไปรษณีย์
                </label>
                <input
                  type="text"
                  value={taxPostalAddress}
                  onChange={(e) => setTaxPostalAddress(e.target.value)}
                  placeholder="ระบุที่อยู่จัดส่งทางไปรษณีย์ (หากต่างจากที่อยู่ออกใบกำกับภาษี)"
                  style={{
                    width: '100%',
                    height: '28px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    padding: '0 8px',
                    fontSize: '0.72rem',
                    color: 'var(--text-main)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
