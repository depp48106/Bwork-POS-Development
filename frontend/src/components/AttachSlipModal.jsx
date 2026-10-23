import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Upload,
  Image as ImageIcon,
  Check,
  AlertCircle,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldCheck
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
      if (
        buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
      ) {
        return resolve({ valid: true, ext: 'webp', mime: 'image/webp' });
      }

      return resolve({ valid: false, error: 'ชนิดไฟล์ไม่ถูกต้อง กรุณาอัปโหลดรูปภาพ JPG, PNG หรือ WEBP เท่านั้น' });
    };
    reader.onerror = () => resolve({ valid: false, error: 'ไม่สามารถอ่านไฟล์ได้' });
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getTxTypeLabel(type) {
  switch (type) {
    case 'deposit': return 'เงินมัดจำ';
    case 'balance': return 'ยอดคงเหลือ';
    case 'full': return 'ชำระเต็มจำนวน';
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
  'แนบสลิปผิดรายการ',
  'ลูกค้าส่งสลิปใหม่',
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

  // ESC key handler & body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isUploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, isUploading, onClose]);

  if (!isOpen || !booking) return null;

  const bookingId = booking.id || booking.booking_id;
  const displayCode = booking.receipt_number || (bookingId ? `BK-${String(bookingId).padStart(6, '0')}` : '-');

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

  const targetAmount = targetTransaction?.amount || booking.paid_amount || booking.total_amount || 0;
  const targetType = targetTransaction
    ? getTxTypeLabel(targetTransaction.transaction_type)
    : (booking.payment_status === 'paid' ? 'ชำระเต็มจำนวน' : (booking.payment_status === 'deposit' ? 'เงินมัดจำ' : 'ยอดการจอง'));
  const targetMethod = targetTransaction
    ? getMethodLabel(targetTransaction.payment_method)
    : getMethodLabel(booking.payment_method);
  const statusLabel = isReplacement
    ? 'มีสลิปแล้ว'
    : (booking.payment_status === 'unpaid' ? 'ยังไม่ชำระ' : 'รอตรวจสอบ');

  const modalNode = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUploading) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="attach-slip-modal-title"
    >
      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '92vh',
          backgroundColor: 'var(--bg-card, #ffffff)',
          color: 'var(--text-main, #0f172a)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: '1px solid var(--border-color, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeIn 0.15s ease-out'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Clean & Corporate */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-card, #ffffff)'
          }}
        >
          <div>
            <h3
              id="attach-slip-modal-title"
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 800,
                color: 'var(--text-main, #0f172a)'
              }}
            >
              {isReplacement ? 'เปลี่ยนสลิปการชำระเงิน' : 'แนบสลิปการชำระเงิน'}
            </h3>
            <div
              style={{
                fontSize: '0.74rem',
                color: 'var(--text-muted, #64748b)',
                marginTop: '3px',
                fontWeight: 600
              }}
            >
              {displayCode} • {targetTransaction ? `รายการธุรกรรม #${targetTransaction.id}` : (booking.customer_name || 'การจองทั่วไป')}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            id="btn-close-attach-slip-modal"
            aria-label="ปิดหน้าต่าง"
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
              justifyContent: 'center',
              transition: 'background-color 0.15s'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: '16px 20px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          {/* Compact Transaction Summary */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              backgroundColor: 'var(--bg-hover, #f8fafc)',
              border: '1px solid var(--border-color, #e2e8f0)',
              fontSize: '0.78rem'
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                alignItems: 'center'
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.7rem' }}>ประเภท: </span>
                <strong style={{ color: 'var(--text-main, #0f172a)' }}>{targetType}</strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.7rem' }}>ช่องทาง: </span>
                <strong style={{ color: 'var(--text-main, #0f172a)' }}>{targetMethod}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.7rem' }}>ยอดเงิน: </span>
                <strong style={{ color: 'var(--primary-color, #2563eb)', fontSize: '0.88rem' }}>
                  ฿{Number(targetAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </strong>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    backgroundColor: isReplacement ? 'rgba(37, 99, 235, 0.1)' : 'rgba(245, 158, 11, 0.12)',
                    color: isReplacement ? '#2563eb' : '#d97706',
                    border: '1px solid ' + (isReplacement ? 'rgba(37, 99, 235, 0.25)' : 'rgba(245, 158, 11, 0.3)')
                  }}
                >
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* Concise 1-line Notice */}
            <div
              style={{
                marginTop: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-color, #e2e8f0)',
                fontSize: '0.7rem',
                color: isReplacement ? '#1e40af' : 'var(--text-muted, #64748b)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px'
              }}
            >
              <span>
                {isReplacement
                  ? 'การเปลี่ยนสลิปจะถูกบันทึกในประวัติการตรวจสอบ (Audit Trail)'
                  : (booking.payment_status === 'unpaid'
                      ? 'การแนบหลักฐานเอกสารไม่เปลี่ยนแปลงยอดค้างชำระ'
                      : 'แนบหลักฐานการชำระเงินเพื่อยืนยันรายการ')}
              </span>
              {isReplacement && existingSlipUrl && (
                <a
                  href={existingSlipUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#2563eb',
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    flexShrink: 0
                  }}
                >
                  <span>ดูสลิปเดิม</span>
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>

          {/* Replacement Mode: Concise Reason Selector */}
          {isReplacement && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
                  ระบุเหตุผลในการเปลี่ยนสลิป <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted, #64748b)' }}>
                  บันทึกลงระบบตรวจสอบ
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {REASON_OPTIONS.map((opt) => {
                  const isSelected = selectedReasonOption === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setSelectedReasonOption(opt)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: isSelected ? '1.5px solid #2563eb' : '1px solid var(--border-color, #cbd5e1)',
                        backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'var(--bg-card, #ffffff)',
                        color: isSelected ? '#2563eb' : 'var(--text-main, #334155)',
                        fontSize: '0.72rem',
                        fontWeight: isSelected ? 750 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                id="input-slip-replacement-reason"
                placeholder={selectedReasonOption === 'อื่นๆ (ระบุเอง)' ? 'ระบุเหตุผลในการเปลี่ยนสลิป...' : 'ระบุรายละเอียดเพิ่มเติม (ถ้ามี)...'}
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

          {/* Upload Area / Dropzone */}
          {!previewUrl ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '1.5px dashed ' + (isDragging ? '#2563eb' : 'var(--border-color, #cbd5e1)'),
                backgroundColor: isDragging ? 'rgba(37, 99, 235, 0.04)' : 'var(--bg-hover, #f8fafc)',
                borderRadius: '12px',
                padding: '28px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(37, 99, 235, 0.08)',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 8px auto'
                }}
              >
                <Upload size={20} />
              </div>
              <div style={{ fontSize: '0.82rem', fontWeight: 750, color: 'var(--text-main, #0f172a)' }}>
                คลิกเพื่อเลือกไฟล์ หรือวางไฟล์ที่นี่
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #64748b)', marginTop: '3px' }}>
                รองรับ JPG, PNG, WEBP ไม่เกิน 10MB
              </div>
            </div>
          ) : (
            /* Uploaded File State */
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Thumbnail Preview */}
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '8px',
                    backgroundColor: '#0f172a',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="ตัวอย่างสลิป"
                    id="img-attach-slip-preview"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain'
                    }}
                  />
                </div>

                {/* File Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 750,
                      color: 'var(--text-main, #0f172a)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={fileDetails?.name || 'ไฟล์สลิป'}
                  >
                    {fileDetails?.name || 'ไฟล์สลิป'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #64748b)', marginTop: '2px' }}>
                    {fileDetails?.size || '-'} • รูปภาพพร้อมแนบ
                  </div>
                  <div
                    style={{
                      marginTop: '4px',
                      fontSize: '0.68rem',
                      color: '#16a34a',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Check size={11} />
                    <span>ตรวจสอบชนิดไฟล์เรียบร้อย</span>
                  </div>
                </div>

                {/* Actions: Change / Delete */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color, #cbd5e1)',
                      backgroundColor: 'var(--bg-card, #ffffff)',
                      color: 'var(--text-main, #334155)',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      cursor: isUploading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <RefreshCw size={11} />
                    <span>เปลี่ยนไฟล์</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    disabled={isUploading}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      backgroundColor: 'rgba(239, 68, 68, 0.06)',
                      color: '#dc2626',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      cursor: isUploading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Trash2 size={11} />
                    <span>ลบ</span>
                  </button>
                </div>
              </div>
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
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#dc2626',
                fontSize: '0.74rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{uploadError}</span>
            </div>
          )}
        </div>

        {/* Single Footer: Cancel (Left) | Save (Right) */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: 'var(--bg-card, #ffffff)'
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
              border: '1px solid var(--border-color, #cbd5e1)',
              backgroundColor: 'var(--bg-card, #ffffff)',
              color: 'var(--text-main, #334155)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: isUploading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.15s'
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
              gap: '6px',
              boxShadow: !previewUrl || isUploading ? 'none' : '0 2px 8px rgba(37, 99, 235, 0.25)'
            }}
          >
            {isUploading ? (
              <>
                <RefreshCw size={13} className="spin" />
                <span>กำลังบันทึก...</span>
              </>
            ) : isReplacement ? (
              <>
                <RefreshCw size={13} />
                <span>ยืนยันการเปลี่ยนสลิป</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>บันทึกสลิป</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
}
