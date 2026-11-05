import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { openAuthenticatedImageInNewTab } from '../utils/authenticatedFile';
import {
  X, FileText, CheckCircle2, AlertCircle, Building, User, Mail, Phone,
  MapPin, Copy, Edit2, Save, Trash2, ExternalLink, Download, Upload,
  Plus, Clock, RefreshCw, FileCheck, Eye, Send, ChevronDown, ChevronUp,
  AlertTriangle, ShieldCheck
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
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
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
  const [showUploadSection, setShowUploadSection] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadInvoiceNumber, setUploadInvoiceNumber] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const [isDraggingDoc, setIsDraggingDoc] = useState(false);

  // Email Dispatch & Preview State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState('html'); // 'html' | 'text'
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState(null);
  const [liveDispatchEnabled, setLiveDispatchEnabled] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [showDryRunOptions, setShowDryRunOptions] = useState(false);

  const fileInputRef = useRef(null);
  const scrollBodyRef = useRef(null);
  const initialTaxFormRef = useRef(null);

  const bookingId = booking?.id || booking?.booking_id;

  // Populate or revert form state helper
  const syncFormWithData = (data) => {
    const payerType = data?.tax_payer_type || 'corporate';
    const name = data?.tax_name || booking?.customer_name || '';
    const taxId = data?.tax_id || '';
    const branchType = data?.tax_branch_type || 'head';
    const branchNumber = data?.tax_branch_number || '';
    const address = data?.tax_address || '';
    const email = data?.tax_email || '';
    const phone = data?.tax_phone || booking?.contact || '';
    const deliveryMethod = data?.tax_delivery_method || 'email';
    const postalAddress = data?.tax_postal_address || '';

    setEditPayerType(payerType);
    setEditName(name);
    setEditTaxId(taxId);
    setEditBranchType(branchType);
    setEditBranchNumber(branchNumber);
    setEditAddress(address);
    setEditEmail(email);
    setEditPhone(phone);
    setEditDeliveryMethod(deliveryMethod);
    setEditPostalAddress(postalAddress);

    initialTaxFormRef.current = {
      payerType,
      name,
      taxId,
      branchType,
      branchNumber,
      address,
      email,
      phone,
      deliveryMethod,
      postalAddress
    };
  };

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
        const invList = data.invoices || [];
        setInvoices(invList);
        if (data.live_dispatch_enabled !== undefined) {
          setLiveDispatchEnabled(Boolean(data.live_dispatch_enabled));
        }

        // Set default selected invoice (prefer latest PDF)
        const pdfInv = invList.find(inv =>
          inv.content_type?.toLowerCase().includes('pdf') ||
          inv.file_name?.toLowerCase().endsWith('.pdf') ||
          inv.file_url?.toLowerCase().endsWith('.pdf')
        );
        setSelectedInvoiceId(prev => {
          if (prev && invList.some(inv => inv.id === prev)) return prev;
          return pdfInv?.id || invList[0]?.id || null;
        });

        syncFormWithData(data.tax_data);
      }
    } catch (err) {
      console.error('Error fetching tax invoice details:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reset when booking changes
  useEffect(() => {
    setIsEditingTaxInfo(false);
    setEmailFeedback(null);
    setPreviewData(null);
    setIsConfirmModalOpen(false);
    setSelectedInvoiceId(null);
    fetchTaxInvoiceData();
  }, [bookingId]);

  // Start editing tax information
  const handleStartEditing = () => {
    syncFormWithData(taxData);
    setIsEditingTaxInfo(true);
  };

  // Cancel editing and revert to last saved state
  const handleCancelEditing = () => {
    syncFormWithData(taxData);
    setIsEditingTaxInfo(false);
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
    const payerLabel = taxData.tax_payer_type === 'individual' ? 'บุคคลธรรมดา' : (taxData.tax_payer_type === 'corporate' ? 'นิติบุคคล' : 'ไม่ระบุประเภท');
    lines.push(`ประเภท: ${payerLabel}`);
    if (taxData.tax_name) lines.push(`ชื่อผู้เสียภาษี: ${taxData.tax_name}`);
    if (taxData.tax_id) lines.push(`เลขประจำตัวผู้เสียภาษี: ${taxData.tax_id}`);
    if (taxData.tax_payer_type !== 'individual') {
      lines.push(`สาขา: ${taxData.tax_branch_type === 'branch' ? `สาขา ${taxData.tax_branch_number || '-'}` : 'สำนักงานใหญ่'}`);
    }
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
        if (data.invoices) {
          setInvoices(data.invoices);
        }
        // Invalidate stale preview data
        setPreviewData(null);
        syncFormWithData(data.tax_data);
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

  // Active / Selected Invoice Document
  const activePdfInvoice = invoices.find(inv => inv.id === selectedInvoiceId) ||
    invoices.find(inv =>
      inv.content_type?.toLowerCase().includes('pdf') ||
      inv.file_name?.toLowerCase().endsWith('.pdf') ||
      inv.file_url?.toLowerCase().endsWith('.pdf')
    ) || (invoices.length > 0 ? invoices[0] : null);

  const isPdfAttached = Boolean(
    activePdfInvoice && (
      activePdfInvoice.content_type?.toLowerCase().includes('pdf') ||
      activePdfInvoice.file_name?.toLowerCase().endsWith('.pdf') ||
      activePdfInvoice.file_url?.toLowerCase().endsWith('.pdf')
    )
  );

  // Authoritative recipient email: strictly from saved taxData
  const recipientEmail = (taxData?.tax_email || '').trim();
  const isEmailValid = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(recipientEmail);

  // Close confirmation modal automatically if recipient or active file changes
  useEffect(() => {
    if (isConfirmModalOpen) {
      setIsConfirmModalOpen(false);
    }
  }, [recipientEmail, activePdfInvoice?.id]);

  // Open Email Preview Modal
  const handleOpenEmailPreview = async () => {
    if (!bookingId || !activePdfInvoice) return;
    try {
      setPreviewLoading(true);
      setPreviewError(null);
      setIsPreviewOpen(true);
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const invoiceParam = activePdfInvoice?.id ? `?invoice_id=${activePdfInvoice.id}` : '';
      const res = await fetch(`/api/bookings/${bookingId}/tax-invoice/email-preview${invoiceParam}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPreviewData(data.email_preview);
      } else {
        setPreviewError(data.error || 'ไม่สามารถโหลดตัวอย่างอีเมลได้');
      }
    } catch (err) {
      setPreviewError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setPreviewLoading(false);
    }
  };

  // User Permission Check for tax invoice emailing
  const currentUser = (() => {
    try {
      const raw = localStorage.getItem('pos_user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  })();
  const hasSendPermission = !currentUser ||
    currentUser.role === 'admin' ||
    currentUser.role === 'manage' ||
    currentUser.role === 'pos' ||
    (currentUser.permissions && (currentUser.permissions.includes('pos') || currentUser.permissions.includes('manage') || currentUser.permissions.includes('admin')));

  // Check live dispatch status on mount or when active invoice changes
  useEffect(() => {
    let isMounted = true;
    const checkDispatchConfig = async () => {
      if (!bookingId) return;
      try {
        const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
        const invParam = activePdfInvoice?.id ? `?invoice_id=${activePdfInvoice.id}` : '';
        const res = await fetch(`/api/bookings/${bookingId}/tax-invoice/email-preview${invParam}`, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data.email_preview?.live_dispatch_enabled !== undefined) {
            setLiveDispatchEnabled(Boolean(data.email_preview.live_dispatch_enabled));
          }
        }
      } catch (_) {}
    };
    checkDispatchConfig();
    return () => { isMounted = false; };
  }, [bookingId, activePdfInvoice?.id]);

  // Send Tax Invoice Email (Dry-run default or live Gmail)
  const handleSendTaxEmail = async (isDryRun = true) => {
    if (!bookingId || !activePdfInvoice || isSendingEmail) return;
    try {
      setIsSendingEmail(true);
      setEmailFeedback(null);
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const res = await fetch(`/api/bookings/${bookingId}/tax-invoice/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          invoice_id: activePdfInvoice.id,
          recipient_email: recipientEmail,
          dry_run: isDryRun
        })
      });
      const data = await res.json();
      setIsConfirmModalOpen(false);
      if (res.ok && data.success) {
        const msg = data.message || (isDryRun ? 'จำลองการส่งอีเมลใบกำกับภาษีเรียบร้อยแล้ว (Dry-run)' : 'Gmail รับคำขอส่งอีเมลเรียบร้อยแล้ว (รอคิวส่งของ Gmail)');
        setEmailFeedback({
          type: 'success',
          status: data.status || (isDryRun ? 'dry_run' : 'gmail_accepted'),
          message: msg,
          details: data.data
        });
        if (sysAlert) sysAlert(msg);
        await fetchTaxInvoiceData();
        if (onUpdated) onUpdated();
      } else {
        const errMsg = data.error || (isDryRun ? 'เกิดข้อผิดพลาดในการจำลองส่งอีเมล' : 'เกิดข้อผิดพลาดในการส่งอีเมลผ่าน Gmail API');
        setEmailFeedback({
          type: 'error',
          status: data.status,
          message: errMsg
        });
        if (sysAlert) sysAlert(errMsg);
        await fetchTaxInvoiceData();
      }
    } catch (err) {
      setIsConfirmModalOpen(false);
      setEmailFeedback({
        type: 'error',
        message: 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + err.message
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSimulateSendEmail = () => handleSendTaxEmail(true);
  const handleOpenLiveSendConfirm = () => {
    if (!isPdfAttached || !isEmailValid || !hasSendPermission || !liveDispatchEnabled || isSendingEmail) return;
    if (activePdfInvoice?.email_status === 'gmail_accepted') {
      if (sysAlert) sysAlert('เอกสารนี้ส่งเข้าคิวระบบ Gmail เรียบร้อยแล้ว (gmail_accepted) ไม่สามารถส่งซ้ำได้');
      return;
    }
    if (activePdfInvoice?.email_status === 'uncertain') {
      if (sysAlert) sysAlert('สถานะการส่งก่อนหน้าไม่แน่นอน (uncertain) เพื่อความปลอดภัย กรุณาตรวจสอบประวัติการส่งก่อนดำเนินการใหม่');
      return;
    }
    setIsConfirmModalOpen(true);
  };
  const handleLiveSendEmailConfirmed = () => handleSendTaxEmail(false);

  const renderEmailStatusBadge = (status) => {
    switch (status) {
      case 'gmail_accepted':
        return (
          <span
            id="badge-tax-email-status"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: '#ecfdf5',
              color: '#059669',
              border: '1px solid #a7f3d0',
              padding: '2px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Gmail API รับคำขอส่งอีเมลเข้าคิวระบบแล้ว"
          >
            <CheckCircle2 size={12} />
            <span>Gmail รับคำขอแล้ว</span>
          </span>
        );
      case 'uncertain':
        return (
          <span
            id="badge-tax-email-status"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: '#fffbeb',
              color: '#d97706',
              border: '1px solid #fde68a',
              padding: '2px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="ผลส่งไม่แน่นอน ระบบไม่ส่งซ้ำอัตโนมัติเพื่อความปลอดภัย"
          >
            <AlertCircle size={12} />
            <span>ผลส่งไม่แน่นอน</span>
          </span>
        );
      case 'failed':
        return (
          <span
            id="badge-tax-email-status"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              border: '1px solid #fecaca',
              padding: '2px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <AlertCircle size={12} />
            <span>ส่งไม่สำเร็จ</span>
          </span>
        );
      case 'claiming':
        return (
          <span
            id="badge-tax-email-status"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: '#eef2ff',
              color: '#4f46e5',
              border: '1px solid #c7d2fe',
              padding: '2px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RefreshCw size={12} className="spin" />
            <span>กำลังส่งเข้าคิว...</span>
          </span>
        );
      case 'dry_run':
        return (
          <span
            id="badge-tax-email-status"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              backgroundColor: '#f0f9ff',
              color: '#0284c7',
              border: '1px solid #bae6fd',
              padding: '2px 8px',
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <CheckCircle2 size={12} />
            <span>จำลองส่งแล้ว (Dry-run)</span>
          </span>
        );
      default:
        return (
          <span
            id="badge-tax-email-status"
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              backgroundColor: '#f1f5f9',
              color: '#64748b',
              border: '1px solid #e2e8f0',
              padding: '2px 8px',
              borderRadius: '999px'
            }}
          >
            ยังไม่ได้ส่ง
          </span>
        );
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
          setShowUploadSection(false);
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

  // Form dirty or in-progress editing check for disabling send buttons
  const formDirty = isEditingTaxInfo || isTaxFormDirty();

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
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20000,
        padding: '16px'
      }}
    >
      {/* Main Modal Container */}
      <div style={{
        width: '100%',
        maxWidth: 'min(1080px, 94vw)',
        maxHeight: '90dvh',
        height: 'min(88vh, 850px)',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        color: '#0f172a'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#ffffff',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: '#eff6ff',
              color: '#2563eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <FileText size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.2px' }}>
                  จัดการใบกำกับภาษี
                </h3>
                <span style={{
                  fontSize: '0.72rem',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  backgroundColor: isIssued ? '#ecfdf5' : (hasTaxInfo ? '#fffbeb' : '#f1f5f9'),
                  color: isIssued ? '#059669' : (hasTaxInfo ? '#d97706' : '#64748b'),
                  border: isIssued ? '1px solid #a7f3d0' : (hasTaxInfo ? '1px solid #fde68a' : '1px solid #e2e8f0'),
                  fontWeight: 600
                }}>
                  {isIssued ? 'ออกเอกสารแล้ว' : (hasTaxInfo ? 'รอออกเอกสาร' : 'ยังไม่ระบุข้อมูล')}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                รหัสการจอง <strong style={{ color: '#0f172a' }}>{booking?.receipt_number || `#BK-${String(bookingId).padStart(6, '0')}`}</strong>
                <span style={{ margin: '0 6px', color: '#cbd5e1' }}>•</span>
                ผู้จอง: <span style={{ color: '#0f172a', fontWeight: 600 }}>{booking?.customer_name || '-'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleSafeClose(onClose)}
            aria-label="ปิดหน้าต่าง"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '6px',
              borderRadius: '8px',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div
          ref={scrollBodyRef}
          id="tax-modal-scroll-body"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '16px 20px',
            backgroundColor: '#f8fafc',
            boxSizing: 'border-box',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#64748b', fontSize: '0.88rem' }}>
              กำลังโหลดข้อมูลใบกำกับภาษี...
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
              gap: '20px',
              alignItems: 'start',
              width: '100%',
              boxSizing: 'border-box'
            }}>
              {/* ========================================================= */}
              {/* COLUMN 1: TAXPAYER INFORMATION & DELIVERY METHOD          */}
              {/* ========================================================= */}
              <div style={{
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}>
                {/* Card Header */}
                <div style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#ffffff'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building size={16} color="#2563eb" />
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
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
                            fontWeight: 600,
                            border: taxCopied ? '1px solid #10b981' : '1px solid #e2e8f0',
                            backgroundColor: taxCopied ? '#ecfdf5' : '#ffffff',
                            color: taxCopied ? '#059669' : '#475569',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer'
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
                          fontWeight: 600,
                          border: '1px solid #2563eb',
                          backgroundColor: '#2563eb',
                          color: '#ffffff',
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
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        padding: '2px 8px',
                        borderRadius: '999px'
                      }}>
                        กำลังแก้ไข
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelEditing}
                        style={{
                          height: '28px',
                          padding: '0 10px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          border: '1px solid #e2e8f0',
                          backgroundColor: '#ffffff',
                          color: '#64748b',
                          cursor: 'pointer'
                        }}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div style={{ padding: '18px' }}>
                  {!isEditingTaxInfo ? (
                    !hasTaxInfo ? (
                      /* Empty Tax Info State */
                      <div style={{
                        padding: '28px 16px',
                        textAlign: 'center',
                        borderRadius: '8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <FileText size={32} color="#94a3b8" />
                        <div>
                          <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#0f172a' }}>
                            ยังไม่มีข้อมูลผู้เสียภาษี
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>
                            กดปุ่มด้านล่างเพื่อกรอกข้อมูลผู้เสียภาษีสำหรับออกใบกำกับภาษี
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
                            fontWeight: 600,
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
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '14px', fontSize: '0.82rem' }}>
                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>ประเภทผู้เสียภาษี:</span>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                            {taxData?.tax_payer_type === 'individual' ? 'บุคคลธรรมดา' : (taxData?.tax_payer_type === 'corporate' ? 'นิติบุคคล' : 'ไม่ระบุประเภท')}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                            {taxData?.tax_payer_type === 'individual' ? 'ชื่อ–นามสกุล:' : 'ชื่อผู้เสียภาษี / บริษัท:'}
                          </span>
                          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>
                            {taxData?.tax_name || '-'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>เลขประจำตัวผู้เสียภาษี:</span>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#2563eb', letterSpacing: '0.5px', marginTop: '2px' }}>
                            {taxData?.tax_id || '-'}
                          </div>
                        </div>

                        {taxData?.tax_payer_type !== 'individual' && (
                          <div>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>สาขา:</span>
                            <div style={{ fontWeight: 600, color: '#0f172a', marginTop: '2px' }}>
                              {taxData?.tax_branch_type === 'branch'
                                ? `สาขา (เลขที่: ${taxData.tax_branch_number || '-'})`
                                : 'สำนักงานใหญ่'}
                            </div>
                          </div>
                        )}

                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>ที่อยู่ออกใบกำกับภาษี:</span>
                          <div style={{ fontWeight: 500, color: '#0f172a', marginTop: '2px', lineHeight: 1.5 }}>
                            {taxData?.tax_address || '-'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>อีเมลรับเอกสาร (e-Tax):</span>
                          <div style={{ fontWeight: 600, color: recipientEmail ? '#0f172a' : '#ef4444', marginTop: '2px' }}>
                            {recipientEmail || 'ยังไม่ได้ระบุอีเมล'}
                          </div>
                        </div>

                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>เบอร์ติดต่อ:</span>
                          <div style={{ fontWeight: 600, color: '#0f172a', marginTop: '2px' }}>
                            {taxData?.tax_phone || booking?.contact || '-'}
                          </div>
                        </div>

                        <div style={{ gridColumn: 'span 2', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>ช่องทางจัดส่งเอกสาร:</span>
                          <div style={{ fontWeight: 600, color: '#0f172a', marginTop: '2px' }}>
                            {taxData?.tax_delivery_method === 'postal'
                              ? `จัดส่งทางไปรษณีย์ (${taxData.tax_postal_address || taxData.tax_address || '-'})`
                              : (taxData?.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'จัดส่งทางอีเมล (e-Tax)')}
                          </div>
                        </div>
                      </div>
                    )
                  ) : (
                    /* Edit Form */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* Payer Type Toggle */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }}>
                          ประเภทผู้เสียภาษี
                        </label>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setEditPayerType('corporate')}
                            style={{
                              flex: 1,
                              height: '32px',
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: editPayerType === 'corporate' ? 700 : 500,
                              border: editPayerType === 'corporate' ? '1px solid #2563eb' : '1px solid #e2e8f0',
                              backgroundColor: editPayerType === 'corporate' ? '#eff6ff' : '#ffffff',
                              color: editPayerType === 'corporate' ? '#2563eb' : '#64748b',
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
                              borderRadius: '6px',
                              fontSize: '0.76rem',
                              fontWeight: editPayerType === 'individual' ? 700 : 500,
                              border: editPayerType === 'individual' ? '1px solid #2563eb' : '1px solid #e2e8f0',
                              backgroundColor: editPayerType === 'individual' ? '#eff6ff' : '#ffffff',
                              color: editPayerType === 'individual' ? '#2563eb' : '#64748b',
                              cursor: 'pointer'
                            }}
                          >
                            บุคคลธรรมดา (Individual)
                          </button>
                        </div>
                      </div>

                      {/* Name */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#0f172a', marginBottom: '3px', display: 'block' }}>
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
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            padding: '0 10px',
                            fontSize: '0.82rem',
                            color: '#0f172a',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      {/* Tax ID & Branch */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '10px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                            <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b' }}>
                              เลขประจำตัวผู้เสียภาษี (13 หลัก)
                            </label>
                            {cleanEditTaxId.length > 0 && (
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: isEditTaxIdValid ? '#059669' : '#dc2626' }}>
                                {isEditTaxIdValid ? '✓ 13 หลัก' : `${cleanEditTaxId.length}/13`}
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
                              borderRadius: '6px',
                              border: isEditTaxIdValid ? '1px solid #10b981' : '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              padding: '0 10px',
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              color: '#0f172a',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
                            สาขา
                          </label>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => setEditBranchType('head')}
                              style={{
                                flex: 1,
                                height: '34px',
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: editBranchType === 'head' ? 700 : 500,
                                border: editBranchType === 'head' ? '1px solid #2563eb' : '1px solid #e2e8f0',
                                backgroundColor: editBranchType === 'head' ? '#eff6ff' : '#ffffff',
                                color: editBranchType === 'head' ? '#2563eb' : '#64748b',
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
                                borderRadius: '6px',
                                fontSize: '0.72rem',
                                fontWeight: editBranchType === 'branch' ? 700 : 500,
                                border: editBranchType === 'branch' ? '1px solid #2563eb' : '1px solid #e2e8f0',
                                backgroundColor: editBranchType === 'branch' ? '#eff6ff' : '#ffffff',
                                color: editBranchType === 'branch' ? '#2563eb' : '#64748b',
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
                          <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
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
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}

                      {/* Address */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
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
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            padding: '6px 10px',
                            fontSize: '0.8rem',
                            color: '#0f172a',
                            resize: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>

                      {/* Email & Phone */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
                            อีเมลรับเอกสาร (e-Tax)
                          </label>
                          <input
                            type="email"
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            placeholder="billing@company.com"
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
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
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      </div>

                      {/* Delivery Method */}
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
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
                                borderRadius: '6px',
                                fontSize: '0.74rem',
                                fontWeight: editDeliveryMethod === d.key ? 700 : 500,
                                border: editDeliveryMethod === d.key ? '1px solid #2563eb' : '1px solid #e2e8f0',
                                backgroundColor: editDeliveryMethod === d.key ? '#eff6ff' : '#ffffff',
                                color: editDeliveryMethod === d.key ? '#2563eb' : '#64748b',
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
                          <label style={{ fontSize: '0.74rem', fontWeight: 600, color: '#64748b', marginBottom: '3px', display: 'block' }}>
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
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              backgroundColor: '#ffffff',
                              padding: '0 10px',
                              fontSize: '0.8rem',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                      )}

                      {/* Save & Cancel Buttons inline in form */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '8px',
                        paddingTop: '10px',
                        borderTop: '1px solid #f1f5f9'
                      }}>
                        <button
                          type="button"
                          onClick={handleCancelEditing}
                          style={{
                            height: '32px',
                            padding: '0 14px',
                            borderRadius: '6px',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#ffffff',
                            color: '#64748b',
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
                            height: '32px',
                            padding: '0 16px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: '#2563eb',
                            color: '#ffffff',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            cursor: isSavingTaxInfo ? 'not-allowed' : 'pointer'
                          }}
                        >
                          <Save size={13} />
                          <span>{isSavingTaxInfo ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ========================================================= */}
              {/* COLUMN 2: ATTACHED DOCUMENTS & E-TAX EMAIL DELIVERY        */}
              {/* ========================================================= */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* 1. ATTACHED INVOICES CARD */}
                <div style={{
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#ffffff',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}>
                  <div style={{
                    padding: '14px 18px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#ffffff'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileCheck size={16} color="#059669" />
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                        เอกสารใบกำกับภาษี ({invoices.length})
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowUploadSection(prev => !prev)}
                      style={{
                        height: '28px',
                        padding: '0 10px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        border: '1px solid #e2e8f0',
                        backgroundColor: showUploadSection ? '#eff6ff' : '#ffffff',
                        color: showUploadSection ? '#2563eb' : '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      <Upload size={12} />
                      <span>{showUploadSection ? 'ซ่อนการแนบไฟล์' : '+ แนบเอกสาร'}</span>
                    </button>
                  </div>

                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Invoice List */}
                    {invoices.length === 0 ? (
                      <div style={{
                        padding: '24px 16px',
                        borderRadius: '8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        textAlign: 'center',
                        color: '#64748b',
                        fontSize: '0.78rem'
                      }}>
                        ยังไม่มีเอกสารใบกำกับภาษีแนบในระบบ
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {invoices.map((inv) => {
                          const isPdf = inv.content_type?.includes('pdf') || inv.file_name?.toLowerCase().endsWith('.pdf');
                          const isSelected = inv.id === activePdfInvoice?.id;
                          return (
                            <div
                              key={inv.id}
                              onClick={() => setSelectedInvoiceId(inv.id)}
                              style={{
                                padding: '10px 14px',
                                borderRadius: '8px',
                                backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                                border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '12px',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                                <div style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '6px',
                                  backgroundColor: isPdf ? 'rgba(37, 99, 235, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                  color: isPdf ? '#2563eb' : '#059669',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}>
                                  <FileText size={16} />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a' }}>
                                      {inv.invoice_number ? `เลขที่ ${inv.invoice_number}` : 'ใบกำกับภาษี'}
                                    </span>
                                    <span style={{
                                      fontSize: '0.65rem',
                                      padding: '1px 5px',
                                      borderRadius: '4px',
                                      backgroundColor: isPdf ? '#dbeafe' : '#dcfce7',
                                      color: isPdf ? '#1d4ed8' : '#15803d',
                                      fontWeight: 700
                                    }}>
                                      {isPdf ? 'PDF' : 'IMAGE'}
                                    </span>
                                    {isSelected && (
                                      <span style={{
                                        fontSize: '0.65rem',
                                        padding: '1px 6px',
                                        borderRadius: '999px',
                                        backgroundColor: '#2563eb',
                                        color: '#ffffff',
                                        fontWeight: 600
                                      }}>
                                        เลือกส่ง
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                                    {inv.file_name} · แนบโดย {inv.uploaded_by || 'staff'}
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => openAuthenticatedImageInNewTab(inv.file_url, `ใบกำกับภาษี ${inv.invoice_number || ''}`)}
                                  style={{
                                    height: '26px',
                                    padding: '0 8px',
                                    borderRadius: '5px',
                                    border: '1px solid #e2e8f0',
                                    backgroundColor: '#ffffff',
                                    color: '#2563eb',
                                    fontSize: '0.72rem',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    cursor: 'pointer'
                                  }}
                                  title="เปิดดูเอกสาร"
                                >
                                  <ExternalLink size={11} />
                                  <span>ดู</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteInvoice(inv.id)}
                                  style={{
                                    height: '26px',
                                    padding: '0 6px',
                                    borderRadius: '5px',
                                    border: '1px solid #fee2e2',
                                    backgroundColor: '#fef2f2',
                                    color: '#dc2626',
                                    fontSize: '0.72rem',
                                    cursor: 'pointer'
                                  }}
                                  title="ลบเอกสาร"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Upload Drawer (Collapsible) */}
                    {showUploadSection && (
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
                          padding: '12px',
                          borderRadius: '8px',
                          backgroundColor: isDraggingDoc ? '#eff6ff' : '#f8fafc',
                          border: isDraggingDoc ? '1.5px dashed #2563eb' : '1px dashed #cbd5e1',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', marginBottom: '2px', display: 'block' }}>
                              เลขที่ใบกำกับภาษี
                            </label>
                            <input
                              type="text"
                              id="tax-upload-inv-num"
                              value={uploadInvoiceNumber}
                              onChange={(e) => setUploadInvoiceNumber(e.target.value)}
                              placeholder="เช่น INV-202611-001"
                              style={{
                                width: '100%',
                                height: '30px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#ffffff',
                                padding: '0 8px',
                                fontSize: '0.76rem',
                                fontWeight: 600,
                                boxSizing: 'border-box'
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', marginBottom: '2px', display: 'block' }}>
                              หมายเหตุเพิ่มเติม
                            </label>
                            <input
                              type="text"
                              id="tax-upload-notes"
                              value={uploadNotes}
                              onChange={(e) => setUploadNotes(e.target.value)}
                              placeholder="เช่น ส่งลูกค้าแล้ว"
                              style={{
                                width: '100%',
                                height: '30px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#ffffff',
                                padding: '0 8px',
                                fontSize: '0.76rem',
                                boxSizing: 'border-box'
                              }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <button
                              type="button"
                              id="btn-choose-tax-doc"
                              onClick={() => fileInputRef.current?.click()}
                              style={{
                                height: '30px',
                                padding: '0 10px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: '#ffffff',
                                color: '#2563eb',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer'
                              }}
                            >
                              <Upload size={12} />
                              <span>เลือกไฟล์</span>
                            </button>

                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp"
                              style={{ display: 'none' }}
                              onChange={handleFileChange}
                            />

                            {uploadFile && (
                              <span style={{ fontSize: '0.74rem', color: '#0f172a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                                height: '30px',
                                padding: '0 12px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: '#2563eb',
                                color: '#ffffff',
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: isUploadingDoc ? 'not-allowed' : 'pointer',
                                flexShrink: 0
                              }}
                            >
                              <Save size={12} />
                              <span>{isUploadingDoc ? 'กำลังอัปโหลด...' : 'อัปโหลด'}</span>
                            </button>
                          )}
                        </div>

                        {uploadError && (
                          <div style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <AlertCircle size={12} />
                            <span>{uploadError}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. E-TAX EMAIL DELIVERY CARD */}
                <div
                  id="tax-email-dispatch-card"
                  style={{
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                >
                  <div style={{
                    padding: '14px 18px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#ffffff'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Mail size={16} color="#2563eb" />
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                        การจัดส่งเอกสารทางอีเมล (e-Tax)
                      </span>
                    </div>
                    <div>
                      {renderEmailStatusBadge(activePdfInvoice?.email_status)}
                    </div>
                  </div>

                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Key Details: Recipient and Active PDF */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                      gap: '8px'
                    }}>
                      <div style={{
                        padding: '10px 12px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>อีเมลผู้รับเอกสาร:</div>
                        <div style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: recipientEmail ? '#0f172a' : '#dc2626',
                          marginTop: '2px',
                          wordBreak: 'break-all'
                        }}>
                          {recipientEmail || 'ยังไม่ได้ระบุอีเมลผู้รับ'}
                        </div>
                      </div>

                      <div style={{
                        padding: '10px 12px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px'
                      }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>ไฟล์ที่จะจัดส่ง:</div>
                        <div style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: isPdfAttached ? '#059669' : '#d97706',
                          marginTop: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          {isPdfAttached ? (
                            <>
                              <CheckCircle2 size={13} color="#059669" />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {activePdfInvoice.invoice_number ? `เลขที่ ${activePdfInvoice.invoice_number}` : activePdfInvoice.file_name}
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertCircle size={13} color="#d97706" />
                              <span>ยังไม่มีไฟล์ PDF แนบ</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Unsaved modifications warning */}
                    {formDirty && (
                      <div style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        backgroundColor: '#fffbeb',
                        color: '#b45309',
                        border: '1px solid #fde68a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <AlertTriangle size={14} color="#d97706" style={{ flexShrink: 0 }} />
                        <span>กรุณาบันทึกข้อมูลก่อนส่งอีเมล</span>
                      </div>
                    )}

                    {/* Live or Uncertain Status Notice */}
                    {activePdfInvoice?.email_status === 'gmail_accepted' && (
                      <div style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        backgroundColor: '#ecfdf5',
                        color: '#047857',
                        border: '1px solid #a7f3d0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <CheckCircle2 size={14} />
                        <span>ส่งเข้าคิว Gmail เรียบร้อยแล้ว (Message ID: {activePdfInvoice.email_message_id || '-'})</span>
                      </div>
                    )}

                    {activePdfInvoice?.email_status === 'uncertain' && (
                      <div style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        backgroundColor: '#fffbeb',
                        color: '#b45309',
                        border: '1px solid #fde68a',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <AlertCircle size={14} />
                        <span>ผลส่งไม่แน่นอน ระบบบันทึกเพื่อความปลอดภัยและจะไม่ส่งซ้ำอัตโนมัติ</span>
                      </div>
                    )}

                    {/* Dispatch feedback alert */}
                    {emailFeedback && (
                      <div style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        backgroundColor: emailFeedback.type === 'success' ? '#f0f9ff' : '#fef2f2',
                        color: emailFeedback.type === 'success' ? '#0369a1' : '#b91c1c',
                        border: emailFeedback.type === 'success' ? '1px solid #bae6fd' : '1px solid #fecaca',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        {emailFeedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        <span>{emailFeedback.message}</span>
                      </div>
                    )}

                    {/* Action reason notice when live dispatch is disabled */}
                    {!liveDispatchEnabled && (
                      <div
                        id="notice-live-dispatch-disabled"
                        style={{
                          fontSize: '0.72rem',
                          color: '#64748b',
                          backgroundColor: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <AlertCircle size={13} color="#64748b" style={{ flexShrink: 0 }} />
                        <span>ระบบยังไม่เปิดให้ส่งอีเมลจริง กรุณาติดต่อผู้ดูแลระบบ</span>
                      </div>
                    )}

                    {/* Main Action Buttons */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '8px',
                      paddingTop: '4px'
                    }}>
                      {/* Secondary: Preview Email */}
                      <button
                        type="button"
                        id="btn-tax-email-preview"
                        onClick={handleOpenEmailPreview}
                        disabled={!isPdfAttached || !isEmailValid || previewLoading || isSendingEmail || formDirty}
                        style={{
                          height: '34px',
                          padding: '0 12px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#ffffff',
                          color: '#334155',
                          fontSize: '0.76rem',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: (!isPdfAttached || !isEmailValid || previewLoading || isSendingEmail || formDirty) ? 'not-allowed' : 'pointer',
                          opacity: (!isPdfAttached || !isEmailValid || formDirty) ? 0.6 : 1
                        }}
                        title={
                          formDirty ? 'กรุณาบันทึกข้อมูลก่อนส่งอีเมล' :
                          !isPdfAttached ? 'กรุณาแนบไฟล์ PDF ก่อนดูตัวอย่าง' :
                          !isEmailValid ? 'กรุณาระบุอีเมลที่ถูกต้อง' : 'เปิดดูตัวอย่างอีเมล'
                        }
                      >
                        <Eye size={13} />
                        <span>{previewLoading ? 'กำลังโหลด...' : 'ดูตัวอย่างอีเมล'}</span>
                      </button>

                      {/* Right Action: Send Live Email */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                          type="button"
                          id="btn-tax-live-send-email"
                          onClick={handleOpenLiveSendConfirm}
                          disabled={!isPdfAttached || !isEmailValid || !hasSendPermission || !liveDispatchEnabled || isSendingEmail || formDirty || activePdfInvoice?.email_status === 'gmail_accepted' || activePdfInvoice?.email_status === 'uncertain'}
                          style={{
                            height: '34px',
                            padding: '0 16px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: (isPdfAttached && isEmailValid && hasSendPermission && liveDispatchEnabled && !isSendingEmail && !formDirty && activePdfInvoice?.email_status !== 'gmail_accepted' && activePdfInvoice?.email_status !== 'uncertain')
                              ? '#2563eb'
                              : '#94a3b8',
                            color: '#ffffff',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: (isPdfAttached && isEmailValid && hasSendPermission && liveDispatchEnabled && !isSendingEmail && !formDirty && activePdfInvoice?.email_status !== 'gmail_accepted' && activePdfInvoice?.email_status !== 'uncertain') ? 'pointer' : 'not-allowed',
                            opacity: (isPdfAttached && isEmailValid && hasSendPermission && liveDispatchEnabled && !isSendingEmail && !formDirty && activePdfInvoice?.email_status !== 'gmail_accepted' && activePdfInvoice?.email_status !== 'uncertain') ? 1 : 0.65
                          }}
                          title={
                            formDirty ? 'กรุณาบันทึกข้อมูลก่อนส่งอีเมล' :
                            !isPdfAttached ? 'กรุณาแนบไฟล์ PDF ก่อนส่งอีเมล' :
                            !isEmailValid ? 'กรุณาระบุอีเมลที่ถูกต้อง' :
                            !hasSendPermission ? 'สงวนสิทธิ์เฉพาะผู้มีสิทธิ์ส่งอีเมล' :
                            activePdfInvoice?.email_status === 'gmail_accepted' ? 'ส่งเข้าคิวระบบ Gmail เรียบร้อยแล้ว' :
                            activePdfInvoice?.email_status === 'uncertain' ? 'สถานะการส่งก่อนหน้าไม่แน่นอน' :
                            !liveDispatchEnabled ? 'ระบบยังไม่เปิดให้ส่งอีเมลจริง' :
                            isSendingEmail ? 'กำลังดำเนินการ...' : 'ส่งอีเมลใบกำกับภาษีจริง'
                          }
                        >
                          <Send size={13} />
                          <span>{isSendingEmail ? 'กำลังส่ง...' : 'ส่งอีเมล'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Subtle Collapsible Dry-Run Option */}
                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setShowDryRunOptions(prev => !prev)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          fontSize: '0.7rem',
                          color: '#64748b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        {showDryRunOptions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        <span>ตัวเลือกการทดสอบระบบ (Dry-run Simulation)</span>
                      </button>

                      {showDryRunOptions && (
                        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f8fafc', padding: '8px 10px', borderRadius: '6px' }}>
                          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            จำลองขั้นตอนการส่งโดยไม่เรียกใช้ Gmail API จริง
                          </span>
                          <button
                            type="button"
                            id="btn-tax-simulate-send-email"
                            onClick={handleSimulateSendEmail}
                            disabled={!isPdfAttached || !isEmailValid || isSendingEmail || formDirty}
                            style={{
                              height: '28px',
                              padding: '0 10px',
                              borderRadius: '5px',
                              border: '1px solid #0284c7',
                              backgroundColor: '#f0f9ff',
                              color: '#0284c7',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: (!isPdfAttached || !isEmailValid || isSendingEmail || formDirty) ? 'not-allowed' : 'pointer',
                              opacity: (!isPdfAttached || !isEmailValid || formDirty) ? 0.6 : 1
                            }}
                          >
                            <Send size={11} />
                            <span>{isSendingEmail ? 'กำลังจำลองส่ง...' : 'จำลองส่ง (Dry-run)'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Sticky Footer */}
        <div style={{
          padding: '12px 22px',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          flexShrink: 0
        }}>
          <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
            {isEditingTaxInfo ? 'กำลังแก้ไขข้อมูลผู้เสียภาษี — ตรวจสอบเลข 13 หลักและชื่อก่อนบันทึก' : 'เอกสารใบกำกับภาษีจะถูกจัดเก็บในระบบเพื่อการตรวจสอบย้อนหลัง'}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {isEditingTaxInfo && (
              <>
                <button
                  type="button"
                  onClick={handleCancelEditing}
                  style={{
                    height: '34px',
                    padding: '0 14px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    color: '#64748b',
                    fontSize: '0.78rem',
                    fontWeight: 600,
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
                    height: '34px',
                    padding: '0 16px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    cursor: isSavingTaxInfo ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Save size={13} />
                  <span>{isSavingTaxInfo ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              id="btn-close-tax-modal"
              onClick={() => handleSafeClose(onClose)}
              style={{
                height: '34px',
                padding: '0 16px',
                borderRadius: '6px',
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#0f172a',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* EMAIL PREVIEW DRAWER / MODAL                              */}
        {/* ========================================================= */}
        {isPreviewOpen && (
          <div
            id="tax-email-preview-modal"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 30000,
              padding: '16px'
            }}
            onClick={() => setIsPreviewOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: '#ffffff',
                width: '100%',
                maxWidth: '640px',
                maxHeight: '90vh',
                borderRadius: '14px',
                boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                border: '1px solid #e2e8f0'
              }}
            >
              {/* Header */}
              <div style={{
                padding: '14px 18px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#ffffff'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Mail size={16} color="#2563eb" />
                  <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                    ตัวอย่างอีเมลใบกำกับภาษี (Email Preview)
                  </h3>
                </div>
                <button
                  type="button"
                  id="btn-close-email-preview-x"
                  onClick={() => setIsPreviewOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px'
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {previewLoading ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                    กำลังโหลดตัวอย่างอีเมล...
                  </div>
                ) : previewError ? (
                  <div style={{ padding: '14px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.78rem' }}>
                    <AlertCircle size={15} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    {previewError}
                  </div>
                ) : previewData ? (
                  <>
                    <div style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      fontSize: '0.76rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      <div><span style={{ color: '#64748b' }}>จาก:</span> {previewData.from}</div>
                      {previewData.reply_to && (
                        <div><span style={{ color: '#64748b' }}>ตอบกลับ:</span> {previewData.reply_to}</div>
                      )}
                      <div><span style={{ color: '#64748b' }}>ถึง:</span> <strong style={{ color: '#2563eb' }}>{previewData.to}</strong></div>
                      <div><span style={{ color: '#64748b' }}>หัวข้อ:</span> <strong>{previewData.subject}</strong></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                        <span style={{ color: '#64748b' }}>ไฟล์แนบ:</span>
                        <span style={{
                          backgroundColor: '#eff6ff',
                          color: '#1d4ed8',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          fontSize: '0.7rem'
                        }}>
                          📄 {previewData.file_name} ({((previewData.file_size || 0) / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        id="btn-preview-tab-html"
                        onClick={() => setPreviewTab('html')}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '5px',
                          border: previewTab === 'html' ? '1px solid #2563eb' : '1px solid #e2e8f0',
                          backgroundColor: previewTab === 'html' ? '#eff6ff' : '#ffffff',
                          color: previewTab === 'html' ? '#2563eb' : '#64748b',
                          fontSize: '0.74rem',
                          fontWeight: previewTab === 'html' ? 700 : 500,
                          cursor: 'pointer'
                        }}
                      >
                        รูปแบบ HTML
                      </button>
                      <button
                        type="button"
                        id="btn-preview-tab-text"
                        onClick={() => setPreviewTab('text')}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '5px',
                          border: previewTab === 'text' ? '1px solid #2563eb' : '1px solid #e2e8f0',
                          backgroundColor: previewTab === 'text' ? '#eff6ff' : '#ffffff',
                          color: previewTab === 'text' ? '#2563eb' : '#64748b',
                          fontSize: '0.74rem',
                          fontWeight: previewTab === 'text' ? 700 : 500,
                          cursor: 'pointer'
                        }}
                      >
                        ข้อความธรรมดา
                      </button>
                    </div>

                    {previewTab === 'html' ? (
                      <div style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        backgroundColor: '#ffffff'
                      }}>
                        <iframe
                          title="HTML Email Preview"
                          srcDoc={previewData.html}
                          style={{
                            width: '100%',
                            height: '340px',
                            border: 'none',
                            display: 'block'
                          }}
                          sandbox="allow-same-origin"
                        />
                      </div>
                    ) : (
                      <pre style={{
                        margin: 0,
                        padding: '12px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        fontSize: '0.74rem',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: '340px',
                        overflowY: 'auto'
                      }}>
                        {previewData.text}
                      </pre>
                    )}
                  </>
                ) : null}
              </div>

              {/* Footer */}
              <div style={{
                padding: '10px 18px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
                backgroundColor: '#ffffff'
              }}>
                <button
                  type="button"
                  id="btn-close-email-preview-footer"
                  onClick={() => setIsPreviewOpen(false)}
                  style={{
                    height: '30px',
                    padding: '0 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  ปิดตัวอย่าง
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* CONFIRMATION MODAL FOR LIVE SEND                          */}
        {/* ========================================================= */}
        {isConfirmModalOpen && (
          <div
            id="modal-tax-confirm-send"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 35000,
              padding: '16px'
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSendingEmail) {
                setIsConfirmModalOpen(false);
              }
            }}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: '14px',
                maxWidth: '460px',
                width: '100%',
                boxShadow: '0 20px 30px -10px rgba(0, 0, 0, 0.2)',
                border: '1px solid #e2e8f0',
                overflow: 'hidden'
              }}
            >
              {/* Header */}
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#ffffff'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    backgroundColor: '#eff6ff',
                    color: '#2563eb',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Send size={16} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                      ยืนยันการส่งใบกำกับภาษีทางอีเมล
                    </h3>
                    <p style={{ margin: '1px 0 0', fontSize: '0.72rem', color: '#64748b' }}>
                      ส่งอีเมลพร้อมแนบเอกสาร PDF ให้ลูกค้าผ่าน Gmail
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  id="btn-tax-confirm-close-x"
                  onClick={() => !isSendingEmail && setIsConfirmModalOpen(false)}
                  disabled={isSendingEmail}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: isSendingEmail ? 'not-allowed' : 'pointer',
                    padding: '4px'
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  fontSize: '0.76rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                    <span style={{ color: '#64748b' }}>อีเมลผู้รับ (To):</span>
                    <span id="confirm-recipient-email" style={{ color: '#2563eb', fontWeight: 700, wordBreak: 'break-all', textAlign: 'right' }}>
                      {recipientEmail}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                    <span style={{ color: '#64748b' }}>เลขที่ใบกำกับภาษี:</span>
                    <span id="confirm-invoice-number" style={{ color: '#0f172a', fontWeight: 700 }}>
                      {activePdfInvoice?.invoice_number || ('INV-' + bookingId)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                    <span style={{ color: '#64748b' }}>ไฟล์แนบ PDF:</span>
                    <span id="confirm-file-name" style={{ color: '#059669', fontWeight: 700, wordBreak: 'break-all', textAlign: 'right' }}>
                      📄 {activePdfInvoice?.file_name || 'Tax_Invoice.pdf'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b' }}>ชื่อผู้เสียภาษี / ลูกค้า:</span>
                    <span style={{ color: '#0f172a', fontWeight: 600, textAlign: 'right' }}>
                      {taxData?.tax_name || booking?.customer_name || '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                backgroundColor: '#ffffff'
              }}>
                <button
                  type="button"
                  id="btn-tax-confirm-cancel"
                  onClick={() => setIsConfirmModalOpen(false)}
                  disabled={isSendingEmail}
                  style={{
                    height: '34px',
                    padding: '0 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: isSendingEmail ? 'not-allowed' : 'pointer'
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  id="btn-tax-confirm-send"
                  onClick={handleLiveSendEmailConfirmed}
                  disabled={isSendingEmail}
                  style={{
                    height: '34px',
                    padding: '0 18px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: isSendingEmail ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSendingEmail ? (
                    <>
                      <RefreshCw size={13} className="spin" />
                      <span>กำลังส่งเข้าคิว...</span>
                    </>
                  ) : (
                    <>
                      <Send size={13} />
                      <span>ยืนยันส่งอีเมล</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode;
}
