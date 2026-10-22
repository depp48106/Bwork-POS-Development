import React, { useState, useEffect, useRef } from 'react';
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
      // Check PNG
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return resolve({ valid: true, ext: 'png', mime: 'image/png' });
      }
      // Check JPEG
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return resolve({ valid: true, ext: 'jpg', mime: 'image/jpeg' });
      }
      // Check WEBP
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
  const fileInputRef = useRef(null);

  const bookingId = booking?.id;

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

  // Handle File Selection for Attachment
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);

    const check = await validateTaxDocumentSignature(file);
    if (!check.valid) {
      setUploadError(check.error);
      if (sysAlert) sysAlert(check.error);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadFile(file);
    if (!uploadInvoiceNumber) {
      const suggestedInv = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(bookingId).padStart(4, '0')}`;
      setUploadInvoiceNumber(suggestedInv);
    }
  };

  // Upload Attached Invoice Document
  const handleUploadAttachment = async () => {
    if (!uploadFile) {
      if (sysAlert) sysAlert('กรุณาเลือกไฟล์เอกสารที่ต้องการแนบ');
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
            invoice_number: uploadInvoiceNumber.trim() || null,
            notes: uploadNotes.trim() || null
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (sysAlert) sysAlert('แนบไฟล์ใบกำกับภาษีเรียบร้อยแล้ว');
          setUploadFile(null);
          setUploadInvoiceNumber('');
          setUploadNotes('');
          if (fileInputRef.current) fileInputRef.current.value = '';
          fetchTaxInvoiceData();
          if (onUpdated) onUpdated();
        } else {
          setUploadError(data.error || 'ไม่สามารถแนบเอกสารได้');
          if (sysAlert) sysAlert(data.error || 'ไม่สามารถแนบเอกสารได้');
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

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '700px',
        maxHeight: '92vh',
        backgroundColor: 'var(--bg-card, #ffffff)',
        borderRadius: '18px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--bg-main, #f8fafc)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  จัดการใบกำกับภาษี
                </h3>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: isIssued ? '#10b981' : '#f59e0b',
                  color: '#ffffff',
                  fontWeight: 800
                }}>
                  {isIssued ? 'ออกเอกสารแล้ว' : 'รอออกเอกสาร'}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                ใบจอง <strong>{booking?.receipt_number || `#BK-${String(bookingId).padStart(6, '0')}`}</strong> · ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{booking?.customer_name || '-'}</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px',
              borderRadius: '8px',
              cursor: 'pointer',
              color: 'var(--text-muted)'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              กำลังโหลดข้อมูลใบกำกับภาษี...
            </div>
          ) : (
            <>
              {/* SECTION A: TAX PAYER INFORMATION */}
              <div style={{
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card, #ffffff)',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-main, #f8fafc)',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Building size={16} style={{ color: '#2563eb' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      ข้อมูลผู้เสียภาษี (ภ.พ.20)
                    </span>
                  </div>

                  {!isEditingTaxInfo ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={handleCopyTaxDetails}
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          border: taxCopied ? '1px solid #10b981' : '1px solid var(--border-color)',
                          backgroundColor: taxCopied ? '#10b981' : 'var(--bg-card)',
                          color: taxCopied ? '#fff' : 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {taxCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                        <span>{taxCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsEditingTaxInfo(true)}
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
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
                        <Edit2 size={12} />
                        <span>แก้ไขข้อมูล</span>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setIsEditingTaxInfo(false)}
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          color: 'var(--text-muted)',
                          cursor: 'pointer'
                        }}
                      >
                        ยกเลิก
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveTaxInfo}
                        disabled={isSavingTaxInfo}
                        style={{
                          height: '28px',
                          padding: '0 12px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          border: 'none',
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: isSavingTaxInfo ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <Save size={12} />
                        <span>{isSavingTaxInfo ? 'กำลังบันทึก...' : 'บันทึก'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* View / Edit Body */}
                <div style={{ padding: '16px' }}>
                  {!isEditingTaxInfo ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', fontSize: '0.82rem' }}>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>ชื่อผู้เสียภาษี:</span>
                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
                          {taxData?.tax_name || '-'}
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>เลขประจำตัวผู้เสียภาษี (13 หลัก):</span>
                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#2563eb', letterSpacing: '0.8px', marginTop: '2px' }}>
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
                        <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.45 }}>
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

                      <div style={{ gridColumn: 'span 2', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>ช่องทางจัดส่งเอกสาร:</span>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                          {taxData?.tax_delivery_method === 'postal'
                            ? `จัดส่งทางไปรษณีย์ (${taxData.tax_postal_address || taxData.tax_address || '-'})`
                            : (taxData?.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'จัดส่งทางอีเมล (e-Tax)')}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Edit Form */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setEditPayerType('corporate')}
                          style={{
                            height: '28px',
                            padding: '0 10px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: editPayerType === 'corporate' ? 800 : 600,
                            border: editPayerType === 'corporate' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                            backgroundColor: editPayerType === 'corporate' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                            color: editPayerType === 'corporate' ? '#2563eb' : 'var(--text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          นิติบุคคล
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditPayerType('individual')}
                          style={{
                            height: '28px',
                            padding: '0 10px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: editPayerType === 'individual' ? 800 : 600,
                            border: editPayerType === 'individual' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                            backgroundColor: editPayerType === 'individual' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                            color: editPayerType === 'individual' ? '#2563eb' : 'var(--text-muted)',
                            cursor: 'pointer'
                          }}
                        >
                          บุคคลธรรมดา
                        </button>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                          ชื่อผู้เสียภาษี *
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="ชื่อบริษัท หรือ ชื่อบุคคล"
                          style={{
                            width: '100%',
                            height: '32px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            padding: '0 10px',
                            fontSize: '0.8rem',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            เลขประจำตัวผู้เสียภาษี (13 หลัก)
                          </label>
                          <input
                            type="text"
                            maxLength={17}
                            value={editTaxId}
                            onChange={(e) => setEditTaxId(e.target.value)}
                            placeholder="0105556012345"
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            สาขา
                          </label>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => setEditBranchType('head')}
                              style={{
                                flex: 1,
                                height: '32px',
                                borderRadius: '6px',
                                fontSize: '0.7rem',
                                fontWeight: editBranchType === 'head' ? 800 : 600,
                                border: editBranchType === 'head' ? '1.5px solid #2563eb' : '1px solid var(--border-color)',
                                backgroundColor: editBranchType === 'head' ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-main)',
                                color: editBranchType === 'head' ? '#2563eb' : 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              สำนักงานใหญ่
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditBranchType('branch')}
                              style={{
                                flex: 1,
                                height: '32px',
                                borderRadius: '6px',
                                fontSize: '0.7rem',
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

                      {editBranchType === 'branch' && (
                        <div>
                          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
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
                              height: '30px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              padding: '0 10px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}

                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                          ที่อยู่ออกใบกำกับภาษี
                        </label>
                        <textarea
                          rows={2}
                          value={editAddress}
                          onChange={(e) => setEditAddress(e.target.value)}
                          placeholder="เลขที่ อาคาร ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
                          style={{
                            width: '100%',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            padding: '6px 10px',
                            fontSize: '0.78rem',
                            resize: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8px' }}>
                        <div>
                          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            อีเมลรับเอกสาร (e-Tax)
                          </label>
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            placeholder="accounting@company.com"
                            style={{
                              width: '100%',
                              height: '30px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              padding: '0 10px',
                              fontSize: '0.78rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
                            เบอร์ติดต่อ
                          </label>
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            placeholder="02-123-4567"
                            style={{
                              width: '100%',
                              height: '30px',
                              borderRadius: '6px',
                              border: '1px solid var(--border-color)',
                              padding: '0 10px',
                              fontSize: '0.78rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '3px', display: 'block' }}>
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
                                height: '28px',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
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
                    </div>
                  )}
                </div>
              </div>

              {/* SECTION B: ATTACHED TAX INVOICE DOCUMENTS */}
              <div style={{
                borderRadius: '14px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card, #ffffff)',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-main, #f8fafc)',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FileCheck size={16} style={{ color: '#16a34a' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      เอกสารใบกำกับภาษีที่แนบ ({invoices.length})
                    </span>
                  </div>
                </div>

                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* List of Attached Documents */}
                  {invoices.length === 0 ? (
                    <div style={{
                      padding: '20px',
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
                              <span>เปิดดู</span>
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
                  <div style={{
                    padding: '12px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(37, 99, 235, 0.04)',
                    border: '1.5px dashed rgba(37, 99, 235, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#2563eb' }}>
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
                          value={uploadInvoiceNumber}
                          onChange={(e) => setUploadInvoiceNumber(e.target.value)}
                          placeholder="เช่น INV-202610-001"
                          style={{
                            width: '100%',
                            height: '30px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            padding: '0 8px',
                            fontSize: '0.76rem',
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
                          value={uploadNotes}
                          onChange={(e) => setUploadNotes(e.target.value)}
                          placeholder="ส่งอีเมลลูกค้าแล้ว"
                          style={{
                            width: '100%',
                            height: '30px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            padding: '0 8px',
                            fontSize: '0.74rem',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            height: '30px',
                            padding: '0 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-card)',
                            color: '#2563eb',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          <Upload size={12} />
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
                          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                          </span>
                        )}
                      </div>

                      {uploadFile && (
                        <button
                          type="button"
                          onClick={handleUploadAttachment}
                          disabled={isUploadingDoc}
                          style={{
                            height: '30px',
                            padding: '0 14px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            fontSize: '0.74rem',
                            fontWeight: 750,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: isUploadingDoc ? 'not-allowed' : 'pointer',
                            flexShrink: 0
                          }}
                        >
                          <Save size={12} />
                          <span>{isUploadingDoc ? 'กำลังอัปโหลด...' : 'บันทึกแนบเอกสาร'}</span>
                        </button>
                      )}
                    </div>

                    {uploadError && (
                      <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600 }}>
                        {uploadError}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'flex-end',
          backgroundColor: 'var(--bg-main, #f8fafc)'
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: '34px',
              padding: '0 16px',
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
  );
}
