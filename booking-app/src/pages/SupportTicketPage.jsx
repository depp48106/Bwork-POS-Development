import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  ArrowLeft,
  LifeBuoy,
  Send,
  AlertCircle,
  CheckCircle2,
  Clock,
  Camera,
  X,
  Copy,
  Check,
  Search,
  MessageSquare,
  ShieldAlert,
  CreditCard,
  Building2,
  Calendar,
  ChevronRight,
  ChevronDown,
  RefreshCw
} from 'lucide-react';
import { API_BASE } from '../apiConfig';

const CATEGORIES = [
  {
    id: 'booking',
    name: 'ปัญหาการจองห้อง',
    description: 'เลือกห้องไม่ได้ เลื่อนเวลาจอง ยกเลิก หรือข้อมูลการจองไม่ถูกต้อง',
    icon: Calendar,
    color: '#0284c7',
    bgColor: '#e0f2fe'
  },
  {
    id: 'payment',
    name: 'ปัญหาการชำระเงิน / สลิป',
    description: 'แนบสลิปไม่ผ่าน สลิปถูกปฏิเสธ โอนเงินผิด หรือยอดเงินไม่ตรง',
    icon: CreditCard,
    color: '#d97706',
    bgColor: '#fef3c7'
  },
  {
    id: 'facility',
    name: 'ปัญหาห้องประชุมและสถานที่',
    description: 'แอร์ไม่เย็น โปรเจคเตอร์ ไฟ ดิจิทัลดอร์ล็อค ปลั๊กไฟ หรือ Wi-Fi',
    icon: Building2,
    color: '#059669',
    bgColor: '#d1fae5'
  },
  {
    id: 'other',
    name: 'อื่น ๆ',
    description: 'ปัญหาหรือข้อสอบถามอื่น ๆ เพิ่มเติม',
    icon: LifeBuoy,
    color: '#64748b',
    bgColor: '#f1f5f9'
  }
];

const STATUS_CONFIG = {
  NEW: { label: 'รอเจ้าหน้าที่รับเรื่อง', color: '#f59e0b', bg: '#fef3c7', text: '#b45309' },
  ACKNOWLEDGED: { label: 'เจ้าหน้าที่รับเรื่องแล้ว', color: '#0284c7', bg: '#e0f2fe', text: '#0369a1' },
  IN_PROGRESS: { label: 'กำลังดำเนินการแก้ไข', color: '#8b5cf6', bg: '#ede9fe', text: '#6d28d9' },
  RESOLVED: { label: 'แก้ไขเรียบร้อยแล้ว', color: '#10b981', bg: '#d1fae5', text: '#047857' },
  CLOSED: { label: 'ปิดงาน', color: '#64748b', bg: '#f1f5f9', text: '#475569' },
  REOPENED: { label: 'เปิดใหม่อีกครั้ง', color: '#f97316', bg: '#ffedd5', text: '#c2410c' }
};

const formatThaiDateTime = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = d.getDate();
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const month = months[d.getMonth()];
    const year = d.getFullYear() + 543;
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} ${hours}:${mins} น.`;
  } catch (e) {
    return dateStr;
  }
};

export default function SupportTicketPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // URL search params
  const queryParams = new URLSearchParams(location.search);
  const initialCategory = queryParams.get('category') || 'booking';
  const initialBookingCode = queryParams.get('booking_code') || '';
  const initialPhone = queryParams.get('phone') || '';
  const initialTicketNumber = queryParams.get('ticket') || '';

  const [activeTab, setActiveTab] = useState(initialTicketNumber ? 'track' : 'create');

  // Create Form State
  const [category, setCategory] = useState(initialCategory);
  const [otherCategory, setOtherCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState(initialPhone);
  const [bookingCode, setBookingCode] = useState(initialBookingCode);
  const [attachments, setAttachments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [formError, setFormError] = useState('');

  // Track State
  const [searchQuery, setSearchQuery] = useState(initialTicketNumber || initialPhone);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [customerTickets, setCustomerTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketMessages, setTicketMessages] = useState([]);
  const [replyMessage, setReplyMessage] = useState('');
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [copiedTicket, setCopiedTicket] = useState(false);

  // Auto-populate from LIFF / localStorage
  useEffect(() => {
    try {
      const lineName = localStorage.getItem('line_user_name') || sessionStorage.getItem('line_user_name');
      if (lineName && !customerName) {
        setCustomerName(lineName);
      }
      const pendingStored = localStorage.getItem('bwork_pending_booking');
      if (pendingStored && !bookingCode) {
        const parsed = JSON.parse(pendingStored);
        if (parsed.code) setBookingCode(parsed.code);
        if (parsed.customerName && !customerName) setCustomerName(parsed.customerName);
        if (parsed.contact && !customerPhone) setCustomerPhone(parsed.contact);
      }
    } catch (e) {}
  }, []);

  // Auto-search if initialTicketNumber provided
  useEffect(() => {
    if (initialTicketNumber) {
      loadTicketDetail(initialTicketNumber);
    }
  }, [initialTicketNumber]);

  // Handle Image Upload Selection (Max 3, convert to base64)
  const handleImageSelect = (e, isReply = false) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const currentList = isReply ? replyAttachments : attachments;
    if (currentList.length + files.length > 3) {
      alert('สามารถแนบรูปภาพได้สูงสุด 3 รูป');
      return;
    }

    files.forEach(file => {
      if (!file.type.startsWith('image/')) {
        alert('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('ขนาดรูปภาพต้องไม่เกิน 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const base64Data = uploadEvent.target.result;
        const newAtt = {
          file_name: file.name,
          content_type: file.type,
          file_size: file.size,
          base64Data
        };
        if (isReply) {
          setReplyAttachments(prev => [...prev, newAtt].slice(0, 3));
        } else {
          setAttachments(prev => [...prev, newAtt].slice(0, 3));
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeAttachment = (index, isReply = false) => {
    if (isReply) {
      setReplyAttachments(prev => prev.filter((_, i) => i !== index));
    } else {
      setAttachments(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Submit Ticket
  const handleSubmitTicket = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!category) {
      setFormError('กรุณาเลือกหมวดหมู่ปัญหา');
      return;
    }
    if (category === 'other') {
      if (!otherCategory.trim()) {
        setFormError('กรุณาระบุประเภทปัญหาอื่น ๆ');
        return;
      }
      if (otherCategory.trim().length > 100) {
        setFormError('ประเภทปัญหาอื่น ๆ ต้องไม่เกิน 100 ตัวอักษร');
        return;
      }
    }
    if (!subject.trim()) {
      setFormError('กรุณาระบุหัวข้อปัญหา');
      return;
    }
    if (!description.trim()) {
      setFormError('กรุณาระบุรายละเอียดปัญหา');
      return;
    }
    if (!customerName.trim()) {
      setFormError('กรุณาระบุชื่อผู้ติดต่อ');
      return;
    }
    const cleanPhone = customerPhone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 9) {
      setFormError('กรุณาระบุเบอร์โทรศัพท์ที่ถูกต้อง (อย่างน้อย 9-10 หลัก)');
      return;
    }

    setIsSubmitting(true);
    try {
      const lineUserId = localStorage.getItem('line_user_id') || sessionStorage.getItem('line_user_id') || null;
      const payload = {
        category,
        other_category: category === 'other' ? otherCategory.trim() : null,
        subject: subject.trim(),
        description: description.trim(),
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        line_user_id: lineUserId,
        booking_code: bookingCode.trim() ? bookingCode.trim().toUpperCase() : null,
        attachments: attachments.map(a => ({
          file_name: a.file_name,
          content_type: a.content_type,
          file_size: a.file_size,
          base64Data: a.base64Data
        }))
      };

      const res = await fetch(`${API_BASE}/api/public/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSubmitSuccess(data);
        // Clear form
        setOtherCategory('');
        setSubject('');
        setDescription('');
        setAttachments([]);
      } else {
        setFormError(data.error || 'เกิดข้อผิดพลาดในการส่งข้อมูล กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      setFormError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load Ticket Detail by Ticket Number
  const loadTicketDetail = async (ticketNumber) => {
    setIsSearching(true);
    setSearchError('');
    try {
      const res = await fetch(`${API_BASE}/api/public/support/tickets/${encodeURIComponent(ticketNumber)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setSelectedTicket(data.ticket);
        setTicketMessages(data.messages || []);
      } else {
        setSearchError(data.error || 'ไม่พบข้อมูล Ticket นี้');
      }
    } catch (err) {
      setSearchError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
    } finally {
      setIsSearching(false);
    }
  };

  // Search Tickets by Phone or Ticket Number
  const handleSearchTickets = async (e) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchError('กรุณากรอกรหัส Ticket หรือเบอร์โทรศัพท์');
      return;
    }

    setIsSearching(true);
    setSearchError('');
    setSelectedTicket(null);

    // If looks like Ticket Number: TKT-...
    if (query.toUpperCase().startsWith('TKT-')) {
      await loadTicketDetail(query.toUpperCase());
      return;
    }

    // Otherwise search by phone
    try {
      const cleanPhone = query.replace(/\D/g, '');
      const res = await fetch(`${API_BASE}/api/public/support/tickets?phone=${encodeURIComponent(cleanPhone)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setCustomerTickets(data.tickets || []);
        if (!data.tickets || data.tickets.length === 0) {
          setSearchError('ไม่พบรายการแจ้งปัญหาสำหรับเบอร์นี้');
        }
      } else {
        setSearchError(data.error || 'ไม่พบรายการแจ้งปัญหา');
        setCustomerTickets([]);
      }
    } catch (err) {
      setSearchError('เกิดข้อผิดพลาดในการค้นหา');
      setCustomerTickets([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Customer Send Reply Message
  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyMessage.trim()) return;
    if (!selectedTicket) return;

    setIsSendingReply(true);
    try {
      const lineUserId = localStorage.getItem('line_user_id') || sessionStorage.getItem('line_user_id') || null;
      const payload = {
        message: replyMessage.trim(),
        sender_name: customerName || selectedTicket.customer_name,
        sender_phone: customerPhone || selectedTicket.customer_phone,
        line_user_id: lineUserId,
        attachments: replyAttachments.map(a => ({
          file_name: a.file_name,
          content_type: a.content_type,
          file_size: a.file_size,
          base64Data: a.base64Data
        }))
      };

      const res = await fetch(`${API_BASE}/api/public/support/tickets/${selectedTicket.ticket_number}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setReplyMessage('');
        setReplyAttachments([]);
        // Reload ticket detail
        await loadTicketDetail(selectedTicket.ticket_number);
      } else {
        alert(data.error || 'ไม่สามารถส่งข้อความได้');
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการส่งข้อความ');
    } finally {
      setIsSendingReply(false);
    }
  };

  const copyTicketNumber = (num) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(num);
      setCopiedTicket(true);
      setTimeout(() => setCopiedTicket(false), 2000);
    }
  };

  return (
    <div style={{
      maxWidth: '640px',
      margin: '0 auto',
      padding: '16px 12px 60px 12px',
      minHeight: '85vh'
    }}>
      {/* Top Header Card */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b, #0f172a)',
        borderRadius: '16px',
        padding: '20px 16px',
        color: '#ffffff',
        marginBottom: '16px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        border: '1px solid #334155'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#ffffff',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} />
            <span>ย้อนกลับ</span>
          </button>

          <span style={{
            fontSize: '0.72rem',
            background: 'rgba(56, 189, 248, 0.2)',
            color: '#38bdf8',
            padding: '4px 10px',
            borderRadius: '20px',
            fontWeight: 800
          }}>
            B-WORK Support Center
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #0284c7, #0369a1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 10px rgba(2, 132, 199, 0.4)'
          }}>
            <LifeBuoy size={22} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 900, margin: 0, lineHeight: 1.2 }}>
              ศูนย์ช่วยเหลือ & แจ้งปัญหา
            </h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
              แจ้งปัญหาการจอง การชำระเงิน หรือสถานที่ พร้อมติดตามสถานะได้ทันที
            </p>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginTop: '18px',
          background: 'rgba(15, 23, 42, 0.6)',
          padding: '4px',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <button
            onClick={() => { setActiveTab('create'); setSubmitSuccess(null); }}
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              border: 'none',
              background: activeTab === 'create' ? '#0284c7' : 'transparent',
              color: activeTab === 'create' ? '#ffffff' : '#94a3b8',
              fontWeight: 800,
              fontSize: '0.86rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <AlertCircle size={16} />
            <span>แจ้งปัญหาใหม่</span>
          </button>

          <button
            onClick={() => setActiveTab('track')}
            style={{
              padding: '10px 12px',
              borderRadius: '10px',
              border: 'none',
              background: activeTab === 'track' ? '#0284c7' : 'transparent',
              color: activeTab === 'track' ? '#ffffff' : '#94a3b8',
              fontWeight: 800,
              fontSize: '0.86rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <Search size={16} />
            <span>ติดตามสถานะ</span>
          </button>
        </div>
      </div>

      {/* TAB 1: CREATE TICKET */}
      {activeTab === 'create' && (
        <>
          {submitSuccess ? (
            /* Submission Success Screen */
            <div style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '24px 18px',
              textAlign: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              border: '1px solid #e2e8f0'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: '#d1fae5',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <CheckCircle2 size={36} />
              </div>

              <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: '0 0 6px 0' }}>
                ส่งข้อมูลแจ้งปัญหาเรียบร้อยแล้ว
              </h2>
              <p style={{ fontSize: '0.86rem', color: '#64748b', margin: '0 0 20px 0' }}>
                เจ้าหน้าที่ได้รับเรื่องแล้ว และจะตรวจสอบให้โดยเร็วที่สุด
              </p>

              {/* Ticket Card Box */}
              <div style={{
                background: '#f8fafc',
                border: '2px dashed #0284c7',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px'
              }}>
                <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>
                  รหัส Ticket สำหรับติดตามปัญหา
                </div>
                <div style={{
                  fontSize: '1.4rem',
                  fontWeight: 900,
                  color: '#0284c7',
                  letterSpacing: '0.5px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}>
                  <span>{submitSuccess.ticket_number}</span>
                  <button
                    onClick={() => copyTicketNumber(submitSuccess.ticket_number)}
                    title="คัดลอกรหัส"
                    style={{
                      background: copiedTicket ? '#10b981' : '#e0f2fe',
                      color: copiedTicket ? '#ffffff' : '#0284c7',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 800
                    }}
                  >
                    {copiedTicket ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedTicket ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                  </button>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '6px' }}>
                  โปรดบันทึกหรือแคปรหัสนี้ไว้ เพื่อใช้ติดตามความคืบหน้า
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => {
                    setActiveTab('track');
                    setSearchQuery(submitSuccess.ticket_number);
                    loadTicketDetail(submitSuccess.ticket_number);
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #0284c7, #0369a1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px',
                    borderRadius: '10px',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)'
                  }}
                >
                  <Search size={16} />
                  <span>ติดตามสถานะ Ticket นี้</span>
                </button>

                <button
                  onClick={() => setSubmitSuccess(null)}
                  style={{
                    background: '#f1f5f9',
                    color: '#475569',
                    border: 'none',
                    padding: '10px',
                    borderRadius: '10px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer'
                  }}
                >
                  แจ้งปัญหาอื่นเพิ่มเติม
                </button>
              </div>
            </div>
          ) : (
            /* Creation Form */
            <form onSubmit={handleSubmitTicket} style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '18px 16px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px'
            }}>
              {formError && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontSize: '0.84rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <AlertCircle size={16} flexShrink={0} />
                  <span>{formError}</span>
                </div>
              )}

              {/* 1. Category Selection Dropdown */}
              <div>
                <label htmlFor="support-category-select" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                  1. เลือกหมวดหมู่ปัญหา <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    id="support-category-select"
                    value={category}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setCategory(nextVal);
                      if (nextVal !== 'other') {
                        setOtherCategory('');
                      }
                    }}
                    required
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      padding: '10px 36px 10px 12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.88rem',
                      color: '#0f172a',
                      backgroundColor: '#ffffff',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                      cursor: 'pointer',
                      boxSizing: 'border-box'
                    }}
                  >
                    <option value="" disabled>-- เลือกหมวดหมู่ปัญหา --</option>
                    {CATEGORIES.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <div style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    <ChevronDown size={18} />
                  </div>
                </div>

                {/* Subtext description of selected category if not other */}
                {category && category !== 'other' && (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                    {CATEGORIES.find(c => c.id === category)?.description}
                  </div>
                )}

                {/* Dynamic input for "อื่น ๆ" (other) */}
                {category === 'other' && (
                  <div style={{ marginTop: '10px' }}>
                    <label htmlFor="support-other-category-input" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                      ระบุประเภทปัญหาอื่น ๆ <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      id="support-other-category-input"
                      type="text"
                      placeholder="เช่น ปัญหาที่จอดรถ, สอบถามโปรโมชั่น"
                      value={otherCategory}
                      onChange={(e) => setOtherCategory(e.target.value)}
                      maxLength={100}
                      required
                      style={{
                        width: '100%',
                        minHeight: '44px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.88rem',
                        boxSizing: 'border-box'
                      }}
                    />
                    <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block', marginTop: '4px' }}>
                      กรุณาระบุประเภทปัญหาหรือหัวข้อเรื่องสั้น ๆ (ไม่เกิน 100 ตัวอักษร)
                    </span>
                  </div>
                )}
              </div>

              {/* 2. Linked Booking Code (Optional) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                  2. รหัสการจองห้อง (ถ้ามี)
                </label>
                <input
                  type="text"
                  placeholder="เช่น BK-202610-001"
                  value={bookingCode}
                  onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'block', marginTop: '4px' }}>
                  ใส่รหัสการจองจะช่วยให้เจ้าหน้าที่ตรวจสอบข้อมูลห้องและสถานะได้รวดเร็วยิ่งขึ้น
                </span>
              </div>

              {/* 3. Subject */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                  3. หัวข้อปัญหา <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น ไม่สามารถอัปโหลดสลิปได้, แอร์ไม่เย็น"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* 4. Description */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                  4. รายละเอียดปัญหา <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  rows={4}
                  placeholder="อธิบายปัญหาที่พบอย่างละเอียด เช่น เวลาที่เกิดปัญหา หรือข้อความแจ้งเตือนที่แสดง..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={3000}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              </div>

              {/* 5. Contact Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '4px' }}>
                    ชื่อผู้ติดต่อ <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ชื่อของคุณ"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 800, color: '#1e293b', marginBottom: '4px' }}>
                    เบอร์โทรศัพท์ <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="tel"
                    placeholder="08X-XXX-XXXX"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.85rem',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              {/* 6. Photo Attachments */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginBottom: '6px' }}>
                  รูปภาพประกอบ (สูงสุด 3 รูป)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  {attachments.map((att, idx) => (
                    <div key={idx} style={{
                      position: 'relative',
                      width: '74px',
                      height: '74px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: '1px solid #cbd5e1',
                      background: '#f1f5f9'
                    }}>
                      <img
                        src={att.base64Data}
                        alt="preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeAttachment(idx)}
                        style={{
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          background: 'rgba(0,0,0,0.6)',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: '50%',
                          width: '20px',
                          height: '20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer'
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  {attachments.length < 3 && (
                    <label style={{
                      width: '74px',
                      height: '74px',
                      borderRadius: '10px',
                      border: '2px dashed #94a3b8',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px',
                      color: '#64748b',
                      fontSize: '0.68rem',
                      cursor: 'pointer',
                      background: '#f8fafc'
                    }}>
                      <Camera size={18} />
                      <span>เพิ่มรูป</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => handleImageSelect(e, false)}
                        style={{ display: 'none' }}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  marginTop: '8px',
                  background: isSubmitting ? '#94a3b8' : 'linear-gradient(135deg, #0284c7, #0369a1)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '13px',
                  borderRadius: '12px',
                  fontWeight: 900,
                  fontSize: '0.94rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 12px rgba(2, 132, 199, 0.3)'
                }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    <span>กำลังส่งข้อมูล...</span>
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    <span>ส่งข้อมูลแจ้งปัญหา</span>
                  </>
                )}
              </button>
            </form>
          )}
        </>
      )}

      {/* TAB 2: TRACK TICKETS */}
      {activeTab === 'track' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Search Box */}
          <form onSubmit={handleSearchTickets} style={{
            background: '#ffffff',
            borderRadius: '14px',
            padding: '14px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
            border: '1px solid #e2e8f0',
            display: 'flex',
            gap: '8px'
          }}>
            <input
              type="text"
              placeholder="กรอกรหัส TKT-... หรือเบอร์โทรศัพท์"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem'
              }}
            />
            <button
              type="submit"
              disabled={isSearching}
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                padding: '10px 16px',
                borderRadius: '10px',
                fontWeight: 800,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Search size={16} />
              <span>ค้นหา</span>
            </button>
          </form>

          {searchError && (
            <div style={{
              background: '#fef2f2',
              color: '#b91c1c',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid #fecaca',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={16} />
              <span>{searchError}</span>
            </div>
          )}

          {/* Ticket Detail View */}
          {selectedTicket ? (
            <div style={{
              background: '#ffffff',
              borderRadius: '16px',
              padding: '18px 16px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
              border: '1px solid #e2e8f0'
            }}>
              {/* Back to list button if multiple tickets exist */}
              {customerTickets.length > 1 && (
                <button
                  onClick={() => setSelectedTicket(null)}
                  style={{
                    background: '#f1f5f9',
                    border: 'none',
                    color: '#475569',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginBottom: '12px'
                  }}
                >
                  <ArrowLeft size={14} />
                  <span>กลับไปยังรายการ Ticket ทั้งหมด</span>
                </button>
              )}

              {/* Status Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 800 }}>TICKET ID</span>
                  <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#0284c7' }}>
                    {selectedTicket.ticket_number}
                  </div>
                </div>

                {(() => {
                  const conf = STATUS_CONFIG[selectedTicket.status] || STATUS_CONFIG.NEW;
                  return (
                    <span style={{
                      background: conf.bg,
                      color: conf.text,
                      padding: '6px 12px',
                      borderRadius: '20px',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      border: `1px solid ${conf.color}40`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <Clock size={13} />
                      <span>{conf.label}</span>
                    </span>
                  );
                })()}
              </div>

              {/* Subject & Info Box */}
              <div style={{
                background: '#f8fafc',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '16px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{ fontSize: '0.94rem', fontWeight: 900, color: '#0f172a', marginBottom: '4px' }}>
                  {selectedTicket.subject}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <span>แจ้งเมื่อ: {formatThaiDateTime(selectedTicket.created_at)}</span>
                  <span>หมวดหมู่: {selectedTicket.category === 'other' ? (selectedTicket.other_category ? `อื่น ๆ (${selectedTicket.other_category})` : 'อื่น ๆ') : (CATEGORIES.find(c => c.id === selectedTicket.category)?.name || selectedTicket.category)}</span>
                  {selectedTicket.booking_code && (
                    <span style={{ color: '#0284c7', fontWeight: 800 }}>
                      การจอง: #{selectedTicket.booking_code}
                    </span>
                  )}
                  {selectedTicket.room_name && (
                    <span>ห้อง: {selectedTicket.room_name}</span>
                  )}
                </div>
              </div>

              {/* Messages / Timeline */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#334155', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MessageSquare size={16} />
                  <span>ประวัติการสนทนา & ตอบกลับ</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {ticketMessages.map((msg) => {
                    const isStaff = msg.sender_type === 'staff';
                    return (
                      <div
                        key={msg.id}
                        style={{
                          alignSelf: isStaff ? 'flex-start' : 'flex-end',
                          maxWidth: '90%',
                          background: isStaff ? '#f1f5f9' : '#e0f2fe',
                          border: isStaff ? '1px solid #e2e8f0' : '1px solid #bae6fd',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <span style={{
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            color: isStaff ? '#0284c7' : '#0369a1'
                          }}>
                            {isStaff ? 'เจ้าหน้าที่ B-WORK' : (msg.sender_name || 'ลูกค้า')}
                          </span>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                            {formatThaiDateTime(msg.created_at)}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.86rem', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                          {msg.message}
                        </div>

                        {/* Attachments if any */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                            {msg.attachments.map((att, aIdx) => (
                              <a
                                key={aIdx}
                                href={att.file_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: 'block',
                                  width: '80px',
                                  height: '80px',
                                  borderRadius: '8px',
                                  overflow: 'hidden',
                                  border: '1px solid #cbd5e1'
                                }}
                              >
                                <img
                                  src={att.file_url}
                                  alt="attachment"
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Reply Form */}
              <form onSubmit={handleSendReply} style={{
                borderTop: '1px solid #e2e8f0',
                paddingTop: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>
                  ส่งข้อความตอบกลับเจ้าหน้าที่
                </div>
                <textarea
                  rows={3}
                  placeholder="พิมพ์ข้อความตอบกลับ..."
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.86rem',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit'
                  }}
                />

                {/* Reply Attachments Preview */}
                {replyAttachments.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {replyAttachments.map((att, idx) => (
                      <div key={idx} style={{ position: 'relative', width: '50px', height: '50px', borderRadius: '8px', overflow: 'hidden' }}>
                        <img src={att.base64Data} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx, true)}
                          style={{
                            position: 'absolute',
                            top: '1px',
                            right: '1px',
                            background: 'rgba(0,0,0,0.6)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '50%',
                            width: '16px',
                            height: '16px',
                            cursor: 'pointer'
                          }}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: '#64748b',
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    background: '#f1f5f9'
                  }}>
                    <Camera size={14} />
                    <span>แนบรูป</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleImageSelect(e, true)}
                      style={{ display: 'none' }}
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={isSendingReply || !replyMessage.trim()}
                    style={{
                      background: isSendingReply || !replyMessage.trim() ? '#94a3b8' : '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '10px',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: isSendingReply || !replyMessage.trim() ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <Send size={14} />
                    <span>{isSendingReply ? 'กำลังส่ง...' : 'ส่งข้อความ'}</span>
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* Ticket List if multiple found */
            <div>
              {customerTickets.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#64748b' }}>
                    พบ {customerTickets.length} รายการแจ้งปัญหา
                  </div>
                  {customerTickets.map((t) => {
                    const conf = STATUS_CONFIG[t.status] || STATUS_CONFIG.NEW;
                    return (
                      <div
                        key={t.id}
                        onClick={() => loadTicketDetail(t.ticket_number)}
                        style={{
                          background: '#ffffff',
                          borderRadius: '14px',
                          padding: '14px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                          border: '1px solid #e2e8f0',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 900, color: '#0284c7' }}>
                              #{t.ticket_number}
                            </span>
                            <span style={{
                              background: conf.bg,
                              color: conf.text,
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '12px'
                            }}>
                              {conf.label}
                            </span>
                          </div>

                          <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#0f172a', marginBottom: '2px' }}>
                            {t.subject}
                          </div>

                          <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                            <span>หมวดหมู่: {t.category === 'other' ? (t.other_category ? `อื่น ๆ (${t.other_category})` : 'อื่น ๆ') : (CATEGORIES.find(c => c.id === t.category)?.name || t.category)}</span> · {formatThaiDateTime(t.created_at)} · {t.message_count || 1} ข้อความ
                          </div>
                        </div>

                        <ChevronRight size={18} color="#94a3b8" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
