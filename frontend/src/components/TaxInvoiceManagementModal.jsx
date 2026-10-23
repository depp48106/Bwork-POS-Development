import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, FileText, CheckCircle2, AlertCircle, Building, User, Mail, Phone,
  MapPin, Copy, Edit2, Save, Trash2, ExternalLink, Download, Upload,
  Plus, Clock, RefreshCw, FileCheck
} from 'lucide-react';

/**
 * Validates file signature (magic bytes) for tax invoice documents.
 */
function validateTaxDocumentSignature(file) {
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

      // Check PDF (%PDF- / 0x25 0x50 0x44 0x46)
      if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return resolve({ valid: true, ext: 'pdf', mime: 'application/pdf' });
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

      return resolve({ valid: false, error: 'ชนิดไฟล์ไม่ถูกต้อง กรุณาอัปโหลดไฟล์ PDF, JPG, PNG หรือ WEBP' });
    };
    reader.onerror = () => resolve({ valid: false, error: 'ไม่สามารถอ่านไฟล์ได้' });
    reader.readAsArrayBuffer(file.slice(0, 16));
  });
}

export default function TaxInvoiceManagementModal({
  booking,
  onClose,
  onUpdated,
  sysAlert = null
}) {
  const [loading, setLoading] = useState(true);
  const [taxData, setTaxData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [isEditingTaxInfo, setIsEditingTaxInfo] = useState(false);
  const [isSavingTaxInfo, setIsSavingTaxInfo] = useState(false);
  const [taxCopied, setTaxCopied] = useState(false);

  // Edit Tax Form State
  const [editPayerType, setEditPayerType] = useState('corporate');
  const [editName, setEditName] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editBranchType, setEditBranchType] = useState('head');
  const [editBranchNumber, setEditBranchNumber] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDeliveryMethod, setEditDeliveryMethod] = useState('email');
  const [editPostalAddress, setEditPostalAddress] = useState('');

  // Attachment Upload State
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadInvoiceNumber, setUploadInvoiceNumber] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const [isDraggingDoc, setIsDraggingDoc] = useState(false);
  const fileInputRef = useRef(null);
  const scrollBodyRef = useRef(null);
  const initialTaxFormRef = useRef(null);

  const bookingId = booking?.id || booking?.booking_id;

  const fetchTaxInvoiceData = async () => {
    if (!bookingId) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const res = await fetch(`/api/bookings/${bookingId}/tax-invoice`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (res.ok) {
        const data = await res.json();
        setTaxData(data.tax_data);
        setInvoices(data.invoices || []);

        // Pre-fill edit state
        if (data.tax_data) {
          setEditPayerType(data.tax_data.tax_payer_type || 'corporate');
          setEditName(data.tax_data.tax_name || '');
          setEditTaxId(data.tax_data.tax_id || '');
          setEditBranchType(data.tax_data.tax_branch_type || 'head');
          setEditBranchNumber(data.tax_data.tax_branch_number || '');
          setEditAddress(data.tax_data.tax_address || '');
          setEditEmail(data.tax_data.tax_email || '');
          setEditPhone(data.tax_data.tax_phone || '');
          setEditDeliveryMethod(data.tax_data.tax_delivery_method || 'email');
          setEditPostalAddress(data.tax_data.tax_postal_address || '');

          initialTaxFormRef.current = {
            payerType: data.tax_data.tax_payer_type || 'corporate',
            name: data.tax_data.tax_name || '',
            taxId: data.tax_data.tax_id || '',
            branchType: data.tax_data.tax_branch_type || 'head',
            branchNumber: data.tax_data.tax_branch_number || '',
            address: data.tax_data.tax_address || '',
            email: data.tax_data.tax_email || '',
            phone: data.tax_data.tax_phone || '',
            deliveryMethod: data.tax_data.tax_delivery_method || 'email',
            postalAddress: data.tax_data.tax_postal_address || ''
          };
        } else if (booking?.customer_name) {
          setEditName(booking.customer_name);
          initialTaxFormRef.current = {
            payerType: 'corporate',
            name: booking.customer_name,
            taxId: '',
            branchType: 'head',
            branchNumber: '',
            address: '',
            email: '',
            phone: '',
            deliveryMethod: 'email',
            postalAddress: ''
          };
        }
      }
    } catch (err) {
      console.error('Error fetching tax invoice details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTaxInvoiceData();
  }, [bookingId]);

  // Start editing tax information
  const handleStartEditing = () => {
    initialTaxFormRef.current = {
      payerType: editPayerType,
      name: editName,
      taxId: editTaxId,
      branchType: editBranchType,
      branchNumber: editBranchNumber,
      address: editAddress,
      email: editEmail,
      phone: editPhone,
      deliveryMethod: editDeliveryMethod,
      postalAddress: editPostalAddress
    };
    setIsEditingTaxInfo(true);
  };

  // Check if tax form has unsaved modifications
  const isTaxFormDirty = () => {
    if (!isEditingTaxInfo || !initialTaxFormRef.current) return false;
    const init = initialTaxFormRef.current;
    return (
      (editPayerType || '') !== (init.payerType || '') ||
      (editName || '').trim() !== (init.name || '').trim() ||
      (editTaxId || '').trim() !== (init.taxId || '').trim() ||
      (editBranchType || '') !== (init.branchType || '') ||
      (editBranchNumber || '').trim() !== (init.branchNumber || '').trim() ||
      (editAddress || '').trim() !== (init.address || '').trim() ||
      (editEmail || '').trim() !== (init.email || '').trim() ||
      (editPhone || '').trim() !== (init.phone || '').trim() ||
      (editDeliveryMethod || '') !== (init.deliveryMethod || '') ||
      (editPostalAddress || '').trim() !== (init.postalAddress || '').trim()
    );
  };

  // Safe close guard with unsaved changes confirmation
  const handleSafeClose = (action) => {
    if (isTaxFormDirty()) {
      const confirmLeave = window.confirm('คุณมีข้อมูลใบกำกับภาษีที่ยังไม่ได้บันทึก ต้องการปิดโดยไม่บันทึกหรือไม่?');
      if (!confirmLeave) return;
    }
    if (typeof action === 'function') {
      action();
    }
  };

  // Copy Tax Fields to Clipboard
  const handleCopyTaxDetails = () => {
    if (!taxData) return;
    const lines = [];
    lines.push(`ประเภท: ${taxData.tax_payer_type === 'individual' ? 'บุคคลธรรมดา' : 'นิติบุคคล'}`);
    if (taxData.tax_name) lines.push(`ชื่อผู้เสียภาษี: ${taxData.tax_name}`);
    if (taxData.tax_id) lines.push(`เลขประจำตัวผู้เสียภาษี: ${taxData.tax_id}`);
    lines.push(`สาขา: ${taxData.tax_branch_type === 'branch' ? `สาขา ${taxData.tax_branch_number || '-'}` : 'สำนักงานใหญ่'}`);
    if (taxData.tax_address) lines.push(`ที่อยู่: ${taxData.tax_address}`);
    if (taxData.tax_email) lines.push(`อีเมล: ${taxData.tax_email}`);
    if (taxData.tax_phone) lines.push(`เบอร์โทรศัพท์: ${taxData.tax_phone}`);

    const delMethodLabel = taxData.tax_delivery_method === 'postal'
      ? `ไปรษณีย์ (${taxData.tax_postal_address || taxData.tax_address || '-'})`
      : (taxData.tax_delivery_method === 'pickup' ? 'รับที่หน้าร้าน' : 'อีเมล (e-Tax)');
    lines.push(`จัดส่ง: ${delMethodLabel}`);

    navigator.clipboard.writeText(lines.join('\n'));
    setTaxCopied(true);
    setTimeout(() => setTaxCopied(false), 2500);
    if (sysAlert) sysAlert('คัดลอกข้อมูลใบกำกับภาษีเรียบร้อยแล้ว');
  };

  // Save Tax Information
  const handleSaveTaxInfo = async () => {
    if (!editName.trim()) {
      if (sysAlert) sysAlert('กรุณากรอกชื่อสำหรับออกใบกำกับภาษี');
      return;
    }
    const cleanId = editTaxId.replace(/[-\s]/g, '');
    if (cleanId && cleanId.length !== 13) {
      if (sysAlert) sysAlert('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก');
      return;
    }
    if (editBranchType === 'branch' && !editBranchNumber.trim()) {
      if (sysAlert) sysAlert('กรุณาระบุเลขที่สาขา');
      return;
    }

    try {
      setIsSavingTaxInfo(true);
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const res = await fetch(`/api/bookings/${bookingId}/tax-invoice`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          tax_invoice_required: 1,
          tax_payer_type: editPayerType,
          tax_name: editName.trim(),
          tax_id: cleanId,
          tax_branch_type: editBranchType,
          tax_branch_number: editBranchType === 'branch' ? editBranchNumber.trim() : '',
          tax_address: editAddress.trim(),
          tax_email: editEmail.trim(),
          tax_phone: editPhone.trim(),
          tax_delivery_method: editDeliveryMethod,
          tax_postal_address: editPostalAddress.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTaxData(data.tax_data);
        initialTaxFormRef.current = {
          payerType: editPayerType,
          name: editName.trim(),
          taxId: cleanId,
          branchType: editBranchType,
          branchNumber: editBranchType === 'branch' ? editBranchNumber.trim() : '',
          address: editAddress.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim(),
          deliveryMethod: editDeliveryMethod,
          postalAddress: editPostalAddress.trim()
        };
        setIsEditingTaxInfo(false);
        if (sysAlert) sysAlert('บันทึกข้อมูลใบกำกับภาษีเรียบร้อยแล้ว');
        if (onUpdated) onUpdated();
      } else {
        if (sysAlert) sysAlert(data.error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      }
    } catch (err) {
      console.error('Error saving tax info:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setIsSavingTaxInfo(false);
    }
  };

  // Process Document Selection
  const processDocumentFile = async (file) => {
    if (!file) return;
    setUploadError(null);
    const validation = await validateTaxDocumentSignature(file);
    if (!validation.valid) {
      setUploadError(validation.error);
      if (sysAlert) sysAlert(validation.error);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploadFile(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    processDocumentFile(file);
  };

  // Upload Attached Document
  const handleUploadAttachment = async () => {
    if (!uploadFile) {
      setUploadError('กรุณาเลือกไฟล์เอกสารใบกำกับภาษี');
      return;
    }

    try {
      setIsUploadingDoc(true);
      setUploadError(null);

      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target.result;
        const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';

        const res = await fetch(`/api/bookings/${bookingId}/tax-invoice/attachment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            file_data: base64Data,
            file_name: uploadFile.name,
            invoice_number: uploadInvoiceNumber.trim(),
            notes: uploadNotes.trim()
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (sysAlert) sysAlert('แนบเอกสารใบกำกับภาษีเรียบร้อยแล้ว');
          setUploadFile(null);
          setUploadInvoiceNumber('');
          setUploadNotes('');
          if (fileInputRef.current) fileInputRef.current.value = '';
          fetchTaxInvoiceData();
          if (onUpdated) onUpdated();
        } else {
          setUploadError(data.error || 'เกิดข้อผิดพลาดในการอัปโหลดเอกสาร');
          if (sysAlert) sysAlert(data.error || 'เกิดข้อผิดพลาดในการอัปโหลด');
        }
        setIsUploadingDoc(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch (err) {
      console.error('Error uploading tax invoice doc:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      setIsUploadingDoc(false);
    }
  };

  // Delete Attached Invoice Document
  const handleDeleteInvoice = async (invoiceId) => {
    if (!window.confirm('คุณต้องการลบเอกสารใบกำกับภาษีนี้ใช่หรือไม่?')) return;
    try {
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const res = await fetch(`/api/bookings/${bookingId}/tax-invoice/attachment/${invoiceId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (sysAlert) sysAlert('ลบเอกสารใบกำกับภาษีเรียบร้อยแล้ว');
        fetchTaxInvoiceData();
        if (onUpdated) onUpdated();
      } else {
        if (sysAlert) sysAlert(data.error || 'เกิดข้อผิดพลาดในการลบเอกสาร');
      }
    } catch (err) {
      console.error('Error deleting tax invoice doc:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const isIssued = taxData?.tax_invoice_status === 'issued' || invoices.length > 0;
  const hasTaxInfo = Boolean(taxData?.tax_name || taxData?.tax_id);

  const cleanEditTaxId = (editTaxId || '').replace(/[-\s]/g, '');
  const isEditTaxIdValid = cleanEditTaxId.length === 13 && /^\d+$/.test(cleanEditTaxId);

  const modalNode = (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleSafeClose(onClose);
        }
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20000,
        padding: '16px'
      }}
    >
      {/* 1080px Wide Modal Dialog Container */}
      <div style={{
        width: '100%',
        maxWidth: 'min(1080px, 94vw)',
        maxHeight: '90dvh',
        height: 'min(88vh, 850px)',
        backgroundColor: 'var(--bg-card, #ffffff)',
        borderRadius: '16px',
        border: '1px solid var(--border-color, #e2e8f0)',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {/* Sticky Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-main, #f8fafc)',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              backgroundColor: 'rgba(37, 99, 235, 0.12)',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <FileText size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  จัดการข้อมูลและเอกสารใบกำกับภาษี
                </h3>
                <span style={{
                  fontSize: '0.72rem',
                  padding: '3px 10px',
                  borderRadius: '999px',
                  backgroundColor: isIssued ? '#10b981' : (hasTaxInfo ? '#f59e0b' : '#64748b'),
                  color: '#ffffff',
                  fontWeight: 800
                }}>
                  {isIssued ? 'ออกเอกสารแล้ว' : (hasTaxInfo ? 'รอออกเอกสาร' : 'ยังไม่ขอ')}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                ใบจอง <strong>{booking?.receipt_number || `#BK-${String(bookingId).padStart(6, '0')}`}</strong> · ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{booking?.customer_name || '-'}</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleSafeClose(onClose)}
            aria-label="ปิดหน้าต่าง"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '8px',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Scrollable Modal Content Body (flex: 1 1 auto, minHeight: 0 to guarantee smooth scrolling) */}
        <div
          ref={scrollBodyRef}
          id="tax-modal-scroll-body"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            padding: '24px',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              กำลังโหลดข้อมูลใบกำกับภาษี...
            </div>
          ) : (
            /* Responsive 2-Column Grid on Wide Viewport */
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
              gap: '24px',
              alignItems: 'start'
            }}>
              {/* ========================================================= */}
              {/* SECTION A: TAX PAYER INFORMATION                          */}
              {/* ========================================================= */}
              <div style={{
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card, #ffffff)',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
              }}>
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-main, #f8fafc)',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building size={16} style={{ color: '#2563eb' }} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      ข้อมูลผู้เสียภาษี (ภ.พ.20)
                    </span>
                  </div>

                  {!isEditingTaxInfo ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {hasTaxInfo && (
                        <button
                          type="button"
                          onClick={handleCopyTaxDetails}
                          style={{
                            height: '30px',
                            padding: '0 10px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            border: taxCopied ? '1px solid #10b981' : '1px solid var(--border-color)',
                            backgroundColor: taxCopied ? '#10b981' : 'var(--bg-card)',
                            color: taxCopied ? '#fff' : 'var(--text-main)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {taxCopied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                          <span>{taxCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        id="btn-edit-tax-info"
                        onClick={handleStartEditing}
                        style={{
                          height: '30px',
                          padding: '0 12px',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          border: '1px solid #2563eb',
                          backgroundColor: 'rgba(37, 99, 235, 0.08)',
                          color: '#2563eb',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        <Edit2 size={13} />
                        <span>{hasTaxInfo ? 'แก้ไขข้อมูล' : 'กรอกข้อมูลภาษี'}</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontSize: '0.72rem',
                        color: '#2563eb',
                        fontWeight: 800,
                        backgroundColor: 'rgba(37, 99, 235, 0.1)',
                        padding: '2px 8px',
                        borderRadius: '999px'
                      }}>
                        กำลังแก้ไขข้อมูล
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSafeClose(() => setIsEditingTaxInfo(false))}
                        style={{
                          height: '30px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--text-muted)',
                          cursor: 'pointer'
                        }}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  )}
                </div>

                {/* Section A Body */}
                <div style={{ padding: '16px' }}>
                  {!isEditingTaxInfo ? (
                    !hasTaxInfo ? (
                      /* Prompt to enter tax info if empty */
                      <div style={{
                        padding: '24px 16px',
                        textAlign: 'center',
                        borderRadius: '10px',
                        backgroundColor: 'var(--bg-main)',
                        border: '1px dashed var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '10px'
                      }}>
                        <FileText size={32} style={{ color: 'var(--text-muted)' }} />
                        <div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-main)' }}>
                            ยังไม่มีข้อมูลผู้เสียภาษีสำหรับการจองนี้
                          </div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            หากลูกค้า Walk-in ต้องการขอใบกำกับภาษี สามารถกรอกข้อมูลได้ทันที
                          </div>
                        </div>
                        <button
                          type="button"
                          id="btn-empty-tax-info"
                          onClick={handleStartEditing}
                          style={{
                            height: '34px',
                            padding: '0 16px',
                            borderRadius: '8px',
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            fontSize: '0.78rem',
                            fontWeight: 750,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer',
                            marginTop: '4px'
                          }}
                        >
                          <Plus size={14} />
                          <span>กรอกข้อมูลขอใบกำกับภาษี</span>
                        </button>
                      </div>
                    ) : (
                      /* Read-Only Display */
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px', fontSize: '0.84rem' }}>
                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>ชื่อผู้เสียภาษี:</span>
                          <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
                            {taxData?.tax_name || '-'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>เลขประจำตัวผู้เสียภาษี (13 หลัก):</span>
                          <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#2563eb', letterSpacing: '0.8px', marginTop: '2px' }}>
                            {taxData?.tax_id || '-'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>สำนักงานใหญ่ / สาขา:</span>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                            {taxData?.tax_branch_type === 'branch'
                              ? `สาขา (เลขที่สาขา: ${taxData.tax_branch_number || '-'})`
                              : 'สำนักงานใหญ่ (Head Office)'}
                          </div>
                        </div>

                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>ที่อยู่ออกใบกำกับภาษี:</span>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.5 }}>
                            {taxData?.tax_address || '-'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>อีเมลรับเอกสาร (e-Tax):</span>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                            {taxData?.tax_email || '-'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>เบอร์ติดต่อ:</span>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                            {taxData?.tax_phone || booking?.contact || '-'}
                          </div>
                        </div>

                        <div style={{ gridColumn: 'span 2', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>ช่องทางจัดส่งเอกสาร:</span>
                          <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                            {taxData?.tax_delivery_method === 'postal'
                              ? `จัดส่งทางไปรษณีย์ (${taxData.tax_postal_address || taxData.tax_address || '-'})`
                              : (taxData?.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'จัดส่งทางอีเมล (e-Tax)')}
                          </div>
                        </div>
                      </div>
                    )
                  ) : (
                    /* Edit Mode Form */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* Payer Type Switch */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>
                          ประเภทผู้เสียภาษี
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setEditPayerType('corporate')}
                            style={{
                              flex: 1,
                              height: '32px',
                              borderRadius: '8px',
                              fontSize: '0.76rem',
                              fontWeight: editPayerType === 'corporate' ? 800 : 600,
                              border: editPayerType === 'corporate' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                              backgroundColor: editPayerType === 'corporate' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                              color: editPayerType === 'corporate' ? '#2563eb' : 'var(--text-muted)',
                              cursor: 'pointer'
                            }}
                          >
                            นิติบุคคล (Corporate)
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditPayerType('individual')}
                            style={{
                              flex: 1,
                              height: '32px',
                              borderRadius: '8px',
                              fontSize: '0.76rem',
                              fontWeight: editPayerType === 'individual' ? 800 : 600,
                              border: editPayerType === 'individual' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                              backgroundColor: editPayerType === 'individual' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                              color: editPayerType === 'individual' ? '#2563eb' : 'var(--text-muted)',
                              cursor: 'pointer'
                            }}
                          >
                            บุคคลธรรมดา (Individual)
                          </button>
                        </div>
                      </div>

                      {/* Name */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '3px', display: 'block' }}>
                          ชื่อผู้เสียภาษี / บริษัท *
                        </label>
                        <input
                          type="text"
                          id="tax-edit-name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="ชื่อบริษัท จำกัด หรือ ชื่อบุคคลผู้เสียภาษี"
                          style={{
                            width: '100%',
                            height: '34px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-main)',
                            padding: '0 10px',
                            fontSize: '0.82rem',
                            color: 'var(--text-main)',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      {/* Tax ID & Branch */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                              เลขประจำตัวผู้เสียภาษี (13 หลัก)
                            </label>
                            {cleanEditTaxId.length > 0 && (
                              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: isEditTaxIdValid ? '#10b981' : '#ef4444' }}>
                                {isEditTaxIdValid ? '✓ 13 หลักถูกต้อง' : `${cleanEditTaxId.length}/13`}
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            id="tax-edit-id"
                            maxLength={17}
                            value={editTaxId}
                            onChange={(e) => setEditTaxId(e.target.value)}
                            placeholder="0105556012345"
                            style={{
                              width: '100%',
                              height: '34px',
                              borderRadius: '8px',
                              border: isEditTaxIdValid ? '1px solid #10b981' : '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-main)',
                              padding: '0 10px',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                              color: 'var(--text-main)',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            สาขา
                          </label>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => setEditBranchType('head')}
                              style={{
                                flex: 1,
                                height: '34px',
                                borderRadius: '8px',
                                fontSize: '0.72rem',
                                fontWeight: editBranchType === 'head' ? 800 : 600,
                                border: editBranchType === 'head' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                                backgroundColor: editBranchType === 'head' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                                color: editBranchType === 'head' ? '#2563eb' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              สนง.ใหญ่
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditBranchType('branch')}
                              style={{
                                flex: 1,
                                height: '34px',
                                borderRadius: '8px',
                                fontSize: '0.72rem',
                                fontWeight: editBranchType === 'branch' ? 800 : 600,
                                border: editBranchType === 'branch' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                                backgroundColor: editBranchType === 'branch' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                                color: editBranchType === 'branch' ? '#2563eb' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              สาขา
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Branch Number Input if Branch */}
                      {editBranchType === 'branch' && (
                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            เลขที่สาขา 5 หลัก *
                          </label>
                          <input
                            type="text"
                            maxLength={5}
                            value={editBranchNumber}
                            onChange={(e) => setEditBranchNumber(e.target.value)}
                            placeholder="เช่น 00001"
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-main)',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}

                      {/* Address */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                          ที่อยู่ออกใบกำกับภาษี
                        </label>
                        <textarea
                          rows={2}
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                          placeholder="เลขที่ อาคาร ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                          style={{
                            width: '100%',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-main)',
                            padding: '8px 10px',
                            fontSize: '0.8rem',
                            color: 'var(--text-main)',
                            resize: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      {/* Email & Phone */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            อีเมลรับเอกสาร (e-Tax)
                          </label>
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            placeholder="accounting@company.com"
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-main)',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            เบอร์ติดต่อ
                          </label>
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            placeholder="02-123-4567"
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-main)',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      </div>

                      {/* Delivery Method */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                          ช่องทางจัดส่งเอกสาร
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                          {[
                            { key: 'email', label: 'อีเมล (e-Tax)' },
                            { key: 'pickup', label: 'รับที่สาขา' },
                            { key: 'postal', label: 'ส่งไปรษณีย์' }
                          ].map(d => (
                            <button
                              key={d.key}
                              type="button"
                              onClick={() => setEditDeliveryMethod(d.key)}
                              style={{
                                height: '30px',
                                borderRadius: '8px',
                                fontSize: '0.74rem',
                                fontWeight: editDeliveryMethod === d.key ? 800 : 600,
                                border: editDeliveryMethod === d.key ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                                backgroundColor: editDeliveryMethod === d.key ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                                color: editDeliveryMethod === d.key ? '#2563eb' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Postal Address if Postal */}
                      {editDeliveryMethod === 'postal' && (
                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            ที่อยู่จัดส่งทางไปรษณีย์
                          </label>
                          <input
                            type="text"
                            value={editPostalAddress}
                            onChange={(e) => setEditPostalAddress(e.target.value)}
                            placeholder="ระบุที่อยู่จัดส่งทางไปรษณีย์ (หากต่างจากที่อยู่ภาษี)"
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-main)',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}

                      {/* Form Actions Footer inside Section A */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '10px',
                        borderTop: '1px solid var(--border-color)',
                        fontSize: '0.74rem',
                        color: 'var(--text-muted)'
                      }}>
                        <span>กรุณาตรวจสอบข้อมูล แล้วกด <strong>"บันทึกข้อมูล"</strong> ที่แถบด้านล่าง</span>
                        <button
                          type="button"
                          onClick={() => handleSafeClose(() => setIsEditingTaxInfo(false))}
                          style={{
                            height: '32px',
                            padding: '0 12px',
                            borderRadius: '8px',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================= */}
              {/* SECTION B: ATTACHED TAX INVOICE DOCUMENTS                 */}
              {/* ========================================================= */}
              <div style={{
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card, #ffffff)',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
              }}>
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-main, #f8fafc)',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileCheck size={16} style={{ color: '#16a34a' }} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      เอกสารใบกำกับภาษีที่แนบ ({invoices.length})
                    </span>
                  </div>
                  {invoices.length > 0 && (
                    <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 800, backgroundColor: 'rgba(22, 163, 74, 0.1)', padding: '2px 8px', borderRadius: '999px' }}>
                      ออกเอกสารแล้ว
                    </span>
                  )}
                </div>

                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* List of Attached Documents */}
                  {invoices.length === 0 ? (
                    <div style={{
                      padding: '24px 16px',
                      borderRadius: '10px',
                      backgroundColor: 'var(--bg-main)',
                      border: '1px dashed var(--border-color)',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '0.8rem'
                    }}>
                      ยังไม่มีไฟล์ใบกำกับภาษีแนบในระบบ สามารถแนบเอกสาร (PDF หรือรูปภาพ) ได้ที่ช่องด้านล่าง
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {invoices.map((inv) => (
                        <div
                          key={inv.id}
                          style={{
                            padding: '10px 14px',
                            borderRadius: '10px',
                            backgroundColor: 'var(--bg-main)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                            <div style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '8px',
                              backgroundColor: 'rgba(37, 99, 235, 0.1)',
                              color: '#2563eb',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              <FileText size={18} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)' }}>
                                  {inv.invoice_number ? `เลขที่: ${inv.invoice_number}` : 'ใบกำกับภาษี'}
                                </span>
                                <span style={{
                                  fontSize: '0.65rem',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                                  color: '#059669',
                                  fontWeight: 800
                                }}>
                                  {inv.content_type?.includes('pdf') ? 'PDF' : 'IMAGE'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                แนบโดย: {inv.uploaded_by || 'staff'} · {inv.created_at?.slice(0, 16) || ''}
                              </div>
                              {inv.notes && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '2px' }}>
                                  หมายเหตุ: {inv.notes}
                                </div>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                            <a
                              href={inv.file_url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                height: '28px',
                                padding: '0 10px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)',
                                color: '#2563eb',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                textDecoration: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <ExternalLink size={12} />
                              <span>ดูเอกสาร</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => handleDeleteInvoice(inv.id)}
                              style={{
                                height: '28px',
                                padding: '0 8px',
                                borderRadius: '6px',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                color: '#ef4444',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                cursor: 'pointer'
                              }}
                            >
                              <Trash2 size={12} />
                              <span>ลบ</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload Box for New Attachment */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingDoc(true); }}
                    onDragLeave={() => setIsDraggingDoc(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingDoc(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) processDocumentFile(file);
                    }}
                    style={{
                      padding: '14px',
                      borderRadius: '12px',
                      backgroundColor: isDraggingDoc ? 'rgba(37, 99, 235, 0.08)' : 'rgba(37, 99, 235, 0.03)',
                      border: isDraggingDoc ? '1.5px dashed #2563eb' : '1.5px dashed rgba(37, 99, 235, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#2563eb' }}>
                        แนบไฟล์ใบกำกับภาษีที่ออกแล้ว (PDF, JPG, PNG, WEBP)
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        ขนาดไม่เกิน 10MB
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px' }}>
                      <div>
                        <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                          เลขที่ใบกำกับภาษี (Invoice Number)
                        </label>
                        <input
                          type="text"
                          id="tax-upload-inv-num"
                          value={uploadInvoiceNumber}
                          onChange={(e) => setUploadInvoiceNumber(e.target.value)}
                          placeholder="เช่น INV-202610-001"
                          style={{
                            width: '100%',
                            height: '32px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            padding: '0 8px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '2px', display: 'block' }}>
                          หมายเหตุเพิ่มเติม (ถ้ามี)
                        </label>
                        <input
                          type="text"
                          id="tax-upload-notes"
                          value={uploadNotes}
                          onChange={(e) => setUploadNotes(e.target.value)}
                          placeholder="ส่งอีเมลลูกค้าแล้ว"
                          style={{
                            width: '100%',
                            height: '32px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            padding: '0 8px',
                            fontSize: '0.76rem',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <button
                          type="button"
                          id="btn-choose-tax-doc"
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            height: '32px',
                            padding: '0 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            color: '#2563eb',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          <Upload size={13} />
                          <span>เลือกไฟล์เอกสาร</span>
                        </button>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                          style={{ display: 'none' }}
                          onChange={handleFileChange}
                        />

                        {uploadFile && (
                          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                          </span>
                        )}
                      </div>

                      {uploadFile && (
                        <button
                          type="button"
                          id="btn-submit-upload-tax-doc"
                          onClick={handleUploadAttachment}
                          disabled={isUploadingDoc}
                          style={{
                            height: '32px',
                            padding: '0 14px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            fontSize: '0.76rem',
                            fontWeight: 750,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: isUploadingDoc ? 'not-allowed' : 'pointer',
                            flexShrink: 0
                          }}
                        >
                          <Save size={13} />
                          <span>{isUploadingDoc ? 'กำลังอัปโหลด...' : 'แนบใบกำกับภาษีที่ออกแล้ว'}</span>
                        </button>
                      )}
                    </div>

                    {uploadError && (
                      <div style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={13} />
                        <span>{uploadError}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Sticky Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-main, #f8fafc)',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
            {isEditingTaxInfo ? 'กำลังแก้ไขข้อมูลผู้เสียภาษี — ตรวจสอบเลข 13 หลักและชื่อก่อนบันทึก' : 'เอกสารใบกำกับภาษีจะถูกจัดเก็บในระบบเพื่อการตรวจสอบย้อนหลัง'}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {isEditingTaxInfo && (
              <>
                <button
                  type="button"
                  onClick={() => handleSafeClose(() => setIsEditingTaxInfo(false))}
                  style={{
                    height: '36px',
                    padding: '0 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  id="btn-save-tax-info-footer"
                  onClick={handleSaveTaxInfo}
                  disabled={isSavingTaxInfo}
                  style={{
                    height: '36px',
                    padding: '0 18px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.8rem',
                    fontWeight: 750,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: isSavingTaxInfo ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Save size={14} />
                  <span>{isSavingTaxInfo ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              id="btn-close-tax-modal"
              onClick={() => handleSafeClose(onClose)}
              style={{
                height: '36px',
                padding: '0 18px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-main)',
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
}
