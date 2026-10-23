import React, { useState, useRef } from 'react';
import {
  X, Upload, Image, FileText, CheckCircle2, AlertCircle, RefreshCw, ZoomIn, ExternalLink, ShieldCheck, History as HistoryIcon
} from 'lucide-react';

/**
 * Validates file signature (magic bytes) for uploaded payment slip files.
 */
function validateSlipFileSignature(file) {
  return new Promise((resolve) => {
    if (!file) return resolve({ valid: false, error: 'ไม่พบไฟล์' });
    if (file.size > 10 * 1024 * 1024) {
      return resolve({ valid: false, error: 'ขนาดไฟล์เกิน 10MB กรุณาเลือกรูปภาพที่มีขนาดเล็กลง' });
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

      return resolve({ valid: false, error: 'ชนิดไฟล์ไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ JPG, PNG หรือ WEBP เท่านั้น' });
    };
    reader.onerror = () => resolve({ valid: false, error: 'ไม่สามารถอ่านไฟล์ได้' });
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getTxTypeLabel(type) {
  switch (type) {
    case 'deposit': return 'เงินมัดจำ (Deposit)';
    case 'balance': return 'ยอดคงเหลือ (Balance)';
    case 'full': return 'ชำระเต็มจำนวน (Full Payment)';
    default: return type || 'ชำระเงิน';
  }
}

function getMethodLabel(method) {
  switch (method) {
    case 'transfer': return 'โอนเงินธนาคาร';
    case 'promptpay': return 'PromptPay';
    case 'cash': return 'เงินสด';
    default: return method || '-';
  }
}

const REASON_OPTIONS = [
  'สลิปเดิมรูปไม่ชัดเจน',
  'แนบสลิปผิดรายการ/ผิดธุรกรรม',
  'ลูกค้าส่งสลิปฉบับแก้ไขมาใหม่',
  'ยอดเงินหรือเวลาไม่ตรง',
  'อื่นๆ (ระบุเอง)'
];

export default function AttachSlipModal({
  isOpen,
  booking,
  targetTransaction = null,
  onClose,
  onSuccess,
  sysAlert = null
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fileDetails, setFileDetails] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  const existingSlipUrl = targetTransaction ? targetTransaction.slip_url : booking?.slip_image_url;
  const isReplacement = Boolean(existingSlipUrl && existingSlipUrl !== 'uploaded');
  const [selectedReasonOption, setSelectedReasonOption] = useState(REASON_OPTIONS[0]);
  const [customReasonText, setCustomReasonText] = useState('');

  if (!isOpen || !booking) return null;

  const bookingId = booking.id || booking.booking_id;
  const displayCode = booking.receipt_number || `BK-${String(bookingId).padStart(6, '0')}`;
  const isLegacy = !targetTransaction;

  const handleFile = async (file) => {
    if (!file) return;
    setUploadError(null);

    const validation = await validateSlipFileSignature(file);
    if (!validation.valid) {
      setUploadError(validation.error);
      if (sysAlert) sysAlert(validation.error);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedFile(file);
      setPreviewUrl(e.target.result);
      setFileDetails({
        name: file.name,
        size: formatFileSize(file.size),
        type: validation.mime
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setFileDetails(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!previewUrl) {
      setUploadError('กรุณาเลือกไฟล์รูปภาพสลิปก่อนบันทึก');
      return;
    }

    let finalReason = '';
    if (isReplacement) {
      if (selectedReasonOption === 'อื่นๆ (ระบุเอง)') {
        finalReason = customReasonText.trim();
        if (!finalReason) {
          setUploadError('กรุณาระบุเหตุผลในการเปลี่ยนสลิป');
          return;
        }
      } else {
        finalReason = customReasonText.trim()
          ? `${selectedReasonOption} (${customReasonText.trim()})`
          : selectedReasonOption;
      }
    } else {
      finalReason = 'แนบหลักฐานสลิปการชำระเงิน';
    }

    try {
      setIsUploading(true);
      setUploadError(null);

      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const endpoint = targetTransaction?.id
        ? `/api/bookings/${bookingId}/payments/${targetTransaction.id}/slip`
        : `/api/bookings/${bookingId}/attach-slip`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          slip_image: previewUrl,
          payment_id: targetTransaction?.id || null,
          replacement_reason: finalReason,
          reason: finalReason
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'เกิดข้อผิดพลาดในการบันทึกสลิป');
      }

      if (sysAlert) {
        await sysAlert(isReplacement ? 'เปลี่ยนสลิปหลักฐานการชำระเงินและบันทึกประวัติเรียบร้อยแล้ว' : 'แนบหลักฐานสลิปการชำระเงินเรียบร้อยแล้ว');
      }

      if (onSuccess) {
        onSuccess(data);
      }
      onClose();
    } catch (err) {
      console.error('[AttachSlipModal] submit error:', err);
      setUploadError(err.message || 'ไม่สามารถบันทึกสลิปได้');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUploading) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '580px',
          maxHeight: '94vh',
          backgroundColor: 'var(--bg-card, #ffffff)',
          color: 'var(--text-main, #0f172a)',
          borderRadius: '16px',
          boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-hover, #f8fafc)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: isReplacement ? 'rgba(217, 119, 6, 0.12)' : 'rgba(37, 99, 235, 0.12)',
                color: isReplacement ? '#d97706' : '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {isReplacement ? <RefreshCw size={20} /> : <FileText size={20} />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800 }}>
                {isReplacement ? 'เปลี่ยนสลิปหลักฐานการชำระเงิน' : 'แนบหลักฐานสลิปการชำระเงิน'}
              </h3>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted, #64748b)', marginTop: '2px' }}>
                การจอง <strong style={{ color: 'var(--text-main)' }}>{displayCode}</strong> · {booking.customer_name || '-'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            id="btn-close-attach-slip-modal"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #e2e8f0)',
              backgroundColor: 'transparent',
              color: 'var(--text-muted, #64748b)',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Target Details Card */}
        <div style={{ padding: '14px 20px 0 20px' }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              backgroundColor: isLegacy ? 'rgba(245, 158, 11, 0.08)' : 'rgba(37, 99, 235, 0.06)',
              border: '1px solid ' + (isLegacy ? 'rgba(245, 158, 11, 0.25)' : 'rgba(37, 99, 235, 0.2)'),
              fontSize: '0.8rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, color: isLegacy ? '#b45309' : '#1d4ed8', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <ShieldCheck size={14} />
                {targetTransaction ? `เป้าหมาย: รายการธุรกรรม #${targetTransaction.id}` : 'เป้าหมาย: หลักฐานการจองเดิม (Legacy Booking)'}
              </span>
              {targetTransaction && (
                <span style={{ fontWeight: 800, fontSize: '0.86rem', color: '#16a34a' }}>
                  +฿{Number(targetTransaction.amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>

            <div style={{ marginTop: '4px', fontSize: '0.74rem', color: 'var(--text-muted, #64748b)', lineHeight: '1.4' }}>
              {targetTransaction ? (
                <span>
                  ประเภท: <strong>{getTxTypeLabel(targetTransaction.transaction_type)}</strong> · ช่องทาง: <strong>{getMethodLabel(targetTransaction.payment_method)}</strong>
                </span>
              ) : (
                <span>
                  สถานะเดิม: <strong>{booking.payment_status === 'paid' ? 'ชำระแล้ว (Paid)' : (booking.payment_status === 'unpaid' ? 'ยังไม่ชำระ (Unpaid)' : booking.payment_status)}</strong>
                  {Number(booking.paid_amount) > 0 && ` · ยอดชำระตามบันทึกเดิม ฿${Number(booking.paid_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`}
                </span>
              )}
            </div>

            <div style={{ marginTop: '6px', fontSize: '0.7rem', color: isLegacy ? '#92400e' : '#475569', fontStyle: 'italic' }}>
              * การแนบหรือเปลี่ยนสลิปเป็นการบันทึกเอกสารหลักฐาน จะไม่เปลี่ยนแปลงยอดรับชำระแล้ว ยอดคงเหลือ หรือสถานะทางการเงินของการจอง
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Replacement Notice & History Preservation Banner */}
          {isReplacement && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                fontSize: '0.74rem',
                color: '#1e40af'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 750 }}>
                <HistoryIcon size={14} />
                <span>การรักษาประวัติหลักฐานเดิม (Audit Trail Guaranteed)</span>
              </div>
              <div style={{ marginTop: '4px', fontSize: '0.7rem', color: '#3b82f6', lineHeight: '1.4' }}>
                ไฟล์สลิปเดิมจะไม่ถูกลบหรือเขียนทับ ระบบจะบันทึกประวัติการเปลี่ยนสลิป ผู้ดำเนินการ วันเวลา และเหตุผลลงใน Audit Trail เพื่อความโปร่งใส
              </div>
              {existingSlipUrl && (
                <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.68rem', color: '#64748b' }}>สลิปปัจจุบัน:</span>
                  <a
                    href={existingSlipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      color: '#2563eb',
                      textDecoration: 'underline',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                  >
                    <span>คลิกเพื่อดูสลิปเดิม</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Replacement Reason Selector */}
          {isReplacement && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)' }}>
                ระบุเหตุผลในการเปลี่ยนสลิป <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {REASON_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSelectedReasonOption(opt)}
                    style={{
                      padding: '4px 9px',
                      borderRadius: '6px',
                      border: selectedReasonOption === opt ? '1.5px solid #2563eb' : '1px solid var(--border-color, #e2e8f0)',
                      backgroundColor: selectedReasonOption === opt ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-card, #ffffff)',
                      color: selectedReasonOption === opt ? '#2563eb' : 'var(--text-muted, #64748b)',
                      fontSize: '0.72rem',
                      fontWeight: selectedReasonOption === opt ? 750 : 500,
                      cursor: 'pointer'
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <input
                type="text"
                id="input-slip-replacement-reason"
                placeholder={selectedReasonOption === 'อื่นๆ (ระบุเอง)' ? 'กรุณาระบุเหตุผลในการเปลี่ยนสลิป...' : 'ระบุรายละเอียดเพิ่มเติม (ถ้ามี)...'}
                value={customReasonText}
                onChange={(e) => setCustomReasonText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  backgroundColor: 'var(--bg-card, #ffffff)',
                  color: 'var(--text-main, #0f172a)',
                  fontSize: '0.76rem',
                  marginTop: '2px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          )}

          {/* Dropzone / Upload Container */}
          {!previewUrl ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed ' + (isDragging ? '#2563eb' : 'var(--border-color, #cbd5e1)'),
                backgroundColor: isDragging ? 'rgba(37, 99, 235, 0.05)' : 'var(--bg-hover, #f8fafc)',
                borderRadius: '12px',
                padding: '30px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px auto'
                }}
              >
                <Upload size={22} />
              </div>
              <div style={{ fontSize: '0.84rem', fontWeight: 750, color: 'var(--text-main)' }}>
                {isReplacement ? 'คลิกเพื่อเลือกไฟล์สลิปใหม่ หรือ ลากรูปภาพมาวางที่นี่' : 'คลิกเพื่อเลือกไฟล์ หรือ ลากรูปภาพมาวางที่นี่'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                รองรับไฟล์ JPG, PNG, WEBP (ขนาดไม่เกิน 10MB)
              </div>
            </div>
          ) : (
            /* Preview Container */
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid var(--border-color, #e2e8f0)',
                backgroundColor: 'var(--bg-hover, #f8fafc)',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Image size={14} style={{ color: '#2563eb' }} />
                  {isReplacement ? 'ตัวอย่างรูปภาพสลิปใหม่ที่เลือก' : 'ตัวอย่างรูปภาพสลิปที่เลือก'}
                </span>
                <button
                  type="button"
                  onClick={handleClearFile}
                  disabled={isUploading}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    backgroundColor: 'var(--bg-card, #ffffff)',
                    color: 'var(--text-muted)',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: isUploading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <RefreshCw size={11} />
                  <span>เปลี่ยนรูปภาพ</span>
                </button>
              </div>

              <div
                style={{
                  textAlign: 'center',
                  backgroundColor: '#000000',
                  borderRadius: '10px',
                  padding: '8px',
                  maxHeight: '240px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}
              >
                <img
                  src={previewUrl}
                  alt="ตัวอย่างสลิป"
                  id="img-attach-slip-preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '224px',
                    objectFit: 'contain',
                    borderRadius: '6px'
                  }}
                />
              </div>

              {fileDetails && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    padding: '0 4px'
                  }}
                >
                  <span style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ไฟล์: <strong>{fileDetails.name}</strong>
                  </span>
                  <span>ขนาด: <strong>{fileDetails.size}</strong></span>
                </div>
              )}
            </div>
          )}

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            id="input-attach-slip-file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              handleFile(file);
            }}
          />

          {/* Error Banner */}
          {uploadError && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#dc2626',
                fontSize: '0.76rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{uploadError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            backgroundColor: 'var(--bg-hover, #f8fafc)'
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            id="btn-cancel-attach-slip"
            style={{
              padding: '0 16px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid var(--border-color, #e2e8f0)',
              backgroundColor: 'var(--bg-card, #ffffff)',
              color: 'var(--text-main)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: isUploading ? 'not-allowed' : 'pointer'
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!previewUrl || isUploading}
            id="btn-confirm-attach-slip"
            style={{
              padding: '0 20px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: !previewUrl || isUploading ? '#94a3b8' : (isReplacement ? '#d97706' : '#2563eb'),
              color: '#ffffff',
              fontSize: '0.8rem',
              fontWeight: 750,
              cursor: !previewUrl || isUploading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isUploading ? (
              <>
                <RefreshCw size={14} className="spin" />
                <span>กำลังบันทึกสลิป...</span>
              </>
            ) : isReplacement ? (
              <>
                <RefreshCw size={14} />
                <span>ยืนยันการเปลี่ยนสลิป</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                <span>ยืนยันการแนบสลิป</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
