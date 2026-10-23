import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LifeBuoy,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  MessageSquare,
  Lock,
  Globe,
  Send,
  User,
  Phone,
  Calendar,
  Building2,
  CreditCard,
  X,
  ExternalLink,
  ChevronRight,
  Camera,
  Check,
  Copy,
  Tag
} from 'lucide-react';
import './SupportTicketsManagement.css';

const CATEGORIES = {
  booking: { label: 'ปัญหาการจองห้อง', color: '#0284c7', bg: '#e0f2fe', icon: Calendar },
  payment: { label: 'การชำระเงิน/สลิป', color: '#d97706', bg: '#fef3c7', icon: CreditCard },
  facility: { label: 'ห้อง/สถานที่/Wi-Fi', color: '#059669', bg: '#d1fae5', icon: Building2 },
  other: { label: 'อื่น ๆ', color: '#64748b', bg: '#f1f5f9', icon: LifeBuoy },
  general: { label: 'ทั่วไป', color: '#64748b', bg: '#f1f5f9', icon: LifeBuoy }
};

const STATUSES = {
  NEW: { label: 'รอรับเรื่อง', color: '#f59e0b', bg: '#fef3c7', text: '#b45309' },
  ACKNOWLEDGED: { label: 'รับเรื่องแล้ว', color: '#0284c7', bg: '#e0f2fe', text: '#0369a1' },
  IN_PROGRESS: { label: 'กำลังดำเนินการ', color: '#8b5cf6', bg: '#ede9fe', text: '#6d28d9' },
  RESOLVED: { label: 'แก้ไขแล้ว', color: '#10b981', bg: '#d1fae5', text: '#047857' },
  CLOSED: { label: 'ปิดงาน', color: '#64748b', bg: '#f1f5f9', text: '#475569' },
  REOPENED: { label: 'เปิดใหม่อีกครั้ง', color: '#f97316', bg: '#ffedd5', text: '#c2410c' }
};

const PRIORITIES = {
  urgent: { label: 'เร่งด่วนมาก', color: '#ef4444', bg: '#fee2e2' },
  high: { label: 'สูง', color: '#f97316', bg: '#ffedd5' },
  normal: { label: 'ปกติ', color: '#3b82f6', bg: '#eff6ff' },
  low: { label: 'ต่ำ', color: '#64748b', bg: '#f1f5f9' }
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

export default function SupportTicketsManagement({ user, sysAlert, sysConfirm, onRefreshBadge }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState({ newTicketsCount: 0, openTicketsCount: 0, unreadCount: 0 });

  // Filters
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Detail Modal
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Detail Modal Actions
  const [replyText, setReplyText] = useState('');
  const [replyVisibility, setReplyVisibility] = useState('public'); // 'public' | 'internal'
  const [sendingReply, setSendingReply] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [copiedId, setCopiedId] = useState(false);

  const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';

  // 1. Fetch Notification Counts
  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/pos/support/notifications/count', {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const data = await res.json();
        setCounts({
          newTicketsCount: data.newTicketsCount || 0,
          openTicketsCount: data.openTicketsCount || 0,
          unreadCount: data.unreadCount || 0
        });
        if (onRefreshBadge) onRefreshBadge();
      }
    } catch (err) {
      console.warn('Failed to fetch ticket counts:', err);
    }
  }, [token, onRefreshBadge]);

  // 2. Fetch Tickets List
  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'ALL') params.set('status', filterStatus);
      if (filterCategory !== 'ALL') params.set('category', filterCategory);
      if (filterPriority !== 'ALL') params.set('priority', filterPriority);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const res = await fetch(`/api/pos/support/tickets?${params.toString()}`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus, filterCategory, filterPriority, searchQuery]);

  useEffect(() => {
    fetchCounts();
    fetchTickets();
  }, [fetchCounts, fetchTickets]);

  // 3. Fetch Ticket Detail
  const fetchTicketDetail = async (ticketId) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/pos/support/tickets/${ticketId}`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
        setSelectedTicketId(ticketId);
        // Mark read updates counts & badge
        fetchCounts();
        // Update ticket in list as read
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, is_unread_for_staff: false } : t));
      }
    } catch (err) {
      console.error('Error fetching ticket detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // 4. Update Ticket Status / Priority / Assignee
  const handleUpdateStatus = async (newStatus) => {
    if (!detailData || !detailData.ticket) return;
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/pos/support/tickets/${detailData.ticket.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        await fetchTicketDetail(detailData.ticket.id);
        fetchTickets();
        fetchCounts();
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการเปลี่ยนสถานะ');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleUpdatePriority = async (newPriority) => {
    if (!detailData || !detailData.ticket) return;
    try {
      const res = await fetch(`/api/pos/support/tickets/${detailData.ticket.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ priority: newPriority })
      });
      if (res.ok) {
        await fetchTicketDetail(detailData.ticket.id);
        fetchTickets();
      }
    } catch (err) {}
  };

  const handleUpdateAssignee = async (newAssignee) => {
    if (!detailData || !detailData.ticket) return;
    try {
      const res = await fetch(`/api/pos/support/tickets/${detailData.ticket.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ assigned_to: newAssignee })
      });
      if (res.ok) {
        await fetchTicketDetail(detailData.ticket.id);
        fetchTickets();
      }
    } catch (err) {}
  };

  // 5. Send Staff Reply or Internal Note
  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !detailData) return;

    setSendingReply(true);
    try {
      const res = await fetch(`/api/pos/support/tickets/${detailData.ticket.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          message: replyText.trim(),
          visibility: replyVisibility
        })
      });
      if (res.ok) {
        setReplyText('');
        await fetchTicketDetail(detailData.ticket.id);
        fetchTickets();
        fetchCounts();
      } else {
        const err = await res.json();
        alert(err.error || 'ไม่สามารถส่งข้อความได้');
      }
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการส่งข้อความ');
    } finally {
      setSendingReply(false);
    }
  };

  const copyToClipboard = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  return (
    <div className="tkt-container">
      {/* 1. Header */}
      <div className="tkt-header">
        <div className="tkt-title-group">
          <h2>
            <LifeBuoy size={24} color="#0284c7" />
            <span>ระบบจัดการ Ticket และแจ้งปัญหา</span>
          </h2>
          <div className="tkt-subtitle">
            รับเรื่อง ติดตามปัญหาการจอง การชำระเงิน และประสานงานแก้ไขแบบเรียลไทม์
          </div>
        </div>

        <button
          type="button"
          onClick={() => { fetchCounts(); fetchTickets(); }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #cbd5e1)',
            padding: '8px 14px',
            borderRadius: '10px',
            fontSize: '0.82rem',
            fontWeight: 800,
            cursor: 'pointer',
            color: 'var(--text-main, #0f172a)'
          }}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          <span>รีเฟรชข้อมูล</span>
        </button>
      </div>

      {/* 2. Stat Cards Grid */}
      <div className="tkt-stat-grid">
        <div className="tkt-stat-card" style={{ borderLeft: '4px solid #ef4444' }}>
          <div className="tkt-stat-icon" style={{ background: '#fee2e2', color: '#ef4444' }}>
            <AlertCircle size={22} />
          </div>
          <div>
            <div className="tkt-stat-val" style={{ color: counts.newTicketsCount > 0 ? '#ef4444' : 'inherit' }}>
              {counts.newTicketsCount}
            </div>
            <div className="tkt-stat-lbl">รอรับเรื่อง (NEW)</div>
          </div>
        </div>

        <div className="tkt-stat-card" style={{ borderLeft: '4px solid #8b5cf6' }}>
          <div className="tkt-stat-icon" style={{ background: '#ede9fe', color: '#8b5cf6' }}>
            <Clock size={22} />
          </div>
          <div>
            <div className="tkt-stat-val" style={{ color: '#8b5cf6' }}>
              {counts.openTicketsCount}
            </div>
            <div className="tkt-stat-lbl">กำลังดำเนินการ (OPEN)</div>
          </div>
        </div>

        <div className="tkt-stat-card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="tkt-stat-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}>
            <MessageSquare size={22} />
          </div>
          <div>
            <div className="tkt-stat-val" style={{ color: '#d97706' }}>
              {counts.unreadCount}
            </div>
            <div className="tkt-stat-lbl">ข้อความใหม่ที่ยังไม่อ่าน</div>
          </div>
        </div>

        <div className="tkt-stat-card" style={{ borderLeft: '4px solid #10b981' }}>
          <div className="tkt-stat-icon" style={{ background: '#d1fae5', color: '#10b981' }}>
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div className="tkt-stat-val" style={{ color: '#059669' }}>
              {tickets.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length}
            </div>
            <div className="tkt-stat-lbl">แก้ไขแล้ว / ปิดงานในรายการ</div>
          </div>
        </div>
      </div>

      {/* 3. Filters & Search */}
      <div className="tkt-filter-bar">
        {/* Status Pills */}
        <div className="tkt-filter-row">
          <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted, #64748b)' }}>สถานะ:</span>
          <button
            type="button"
            className={`tkt-pill ${filterStatus === 'ALL' ? 'active' : ''}`}
            onClick={() => setFilterStatus('ALL')}
          >
            ทั้งหมด
          </button>
          {Object.entries(STATUSES).map(([k, conf]) => (
            <button
              key={k}
              type="button"
              className={`tkt-pill ${filterStatus === k ? 'active' : ''}`}
              onClick={() => setFilterStatus(k)}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: conf.color }} />
              <span>{conf.label}</span>
            </button>
          ))}
        </div>

        {/* Category & Priority & Search Row */}
        <div className="tkt-filter-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted, #64748b)' }}>หมวดหมู่:</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '0.82rem',
                background: 'var(--bg-card, #ffffff)'
              }}
            >
              <option value="ALL">ทั้งหมด</option>
              <option value="booking">ปัญหาการจองห้อง</option>
              <option value="payment">การชำระเงิน/สลิป</option>
              <option value="facility">ห้อง/สถานที่/Wi-Fi</option>
              <option value="other">อื่น ๆ</option>
              <option value="general">ทั่วไป</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-muted, #64748b)' }}>ความสำคัญ:</span>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '0.82rem',
                background: 'var(--bg-card, #ffffff)'
              }}
            >
              <option value="ALL">ทั้งหมด</option>
              <option value="urgent">เร่งด่วนมาก</option>
              <option value="high">สูง</option>
              <option value="normal">ปกติ</option>
              <option value="low">ต่ำ</option>
            </select>
          </div>

          {/* Search Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '220px' }}>
            <input
              type="text"
              placeholder="ค้นหารหัส Ticket, ชื่อ, เบอร์โทร, รหัสจอง หรือหัวข้อ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="tkt-search-input"
            />
          </div>
        </div>
      </div>

      {/* 4. Tickets Table */}
      <div className="tkt-table-wrapper">
        <table className="tkt-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>รหัส Ticket</th>
              <th>หมวดหมู่</th>
              <th>หัวข้อปัญหา</th>
              <th>ผู้แจ้ง / เบอร์โทร</th>
              <th>การจอง / ห้อง</th>
              <th>ความสำคัญ</th>
              <th>สถานะ</th>
              <th>ผู้รับผิดชอบ</th>
              <th>แจ้งเมื่อ</th>
              <th style={{ textAlign: 'center' }}>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 8px auto' }} />
                  <div>กำลังโหลดข้อมูล Ticket...</div>
                </td>
              </tr>
            ) : tickets.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                  <LifeBuoy size={32} color="#cbd5e1" style={{ margin: '0 auto 8px auto' }} />
                  <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>ไม่พบรายการ Ticket ที่ตรงกับเงื่อนไข</div>
                  <div style={{ fontSize: '0.78rem', marginTop: '4px' }}>ลองเปลี่ยนตัวกรอง หรือค้นหาด้วยคำใหม่อีกครั้ง</div>
                </td>
              </tr>
            ) : (
              tickets.map((t) => {
                const catConf = CATEGORIES[t.category] || CATEGORIES.general;
                const statusConf = STATUSES[t.status] || STATUSES.NEW;
                const prioConf = PRIORITIES[t.priority] || PRIORITIES.normal;
                const CatIcon = catConf.icon;

                return (
                  <tr
                    key={t.id}
                    className={t.is_unread_for_staff ? 'tkt-row-unread' : ''}
                    onClick={() => fetchTicketDetail(t.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      {t.is_unread_for_staff && (
                        <span style={{
                          display: 'block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: '#0284c7'
                        }} title="มีข้อความใหม่ยังไม่ได้อ่าน" />
                      )}
                    </td>

                    <td style={{ fontWeight: 900, color: '#0284c7', whiteSpace: 'nowrap' }}>
                      #{t.ticket_number}
                    </td>

                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: catConf.bg,
                        color: catConf.color,
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 800
                      }}>
                        <CatIcon size={12} />
                        <span>{catConf.label}</span>
                      </span>
                      {t.other_category && (
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', fontWeight: 600 }}>
                          {t.other_category}
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ fontWeight: 800, color: '#0f172a', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.subject}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{t.customer_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{t.customer_phone}</div>
                    </td>

                    <td>
                      {t.booking_code ? (
                        <div>
                          <span style={{ fontWeight: 800, color: '#0284c7' }}>#{t.booking_code}</span>
                          {t.room_name && <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{t.room_name}</div>}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.76rem' }}>-</span>
                      )}
                    </td>

                    <td>
                      <span style={{
                        display: 'inline-block',
                        background: prioConf.bg,
                        color: prioConf.color,
                        padding: '2px 8px',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 800
                      }}>
                        {prioConf.label}
                      </span>
                    </td>

                    <td>
                      <span className="tkt-badge" style={{
                        background: statusConf.bg,
                        color: statusConf.text,
                        border: `1px solid ${statusConf.color}40`
                      }}>
                        {statusConf.label}
                      </span>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.78rem', color: t.assigned_to ? '#1e293b' : '#94a3b8', fontWeight: t.assigned_to ? 700 : 400 }}>
                        {t.assigned_to || 'ยังไม่กำหนด'}
                      </span>
                    </td>

                    <td style={{ fontSize: '0.76rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {formatThaiDateTime(t.created_at)}
                    </td>

                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); fetchTicketDetail(t.id); }}
                        style={{
                          background: '#0284c7',
                          color: '#ffffff',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        เปิดดู
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 5. Detail Modal / Inspector */}
      {detailData && detailData.ticket && (
        <div className="tkt-modal-backdrop" onClick={() => setDetailData(null)}>
          <div className="tkt-modal" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="tkt-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0284c7' }}>
                  #{detailData.ticket.ticket_number}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(detailData.ticket.ticket_number)}
                  style={{
                    background: copiedId ? '#10b981' : '#e0f2fe',
                    color: copiedId ? '#ffffff' : '#0284c7',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '3px 6px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  {copiedId ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedId ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setDetailData(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="tkt-modal-body">
              {/* Top Summary Card */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem', fontWeight: 900, color: '#0f172a' }}>
                      {detailData.ticket.subject}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>ผู้แจ้ง: <strong>{detailData.ticket.customer_name}</strong></span>
                      <span>โทร: <a href={`tel:${detailData.ticket.customer_phone}`} style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 700 }}>{detailData.ticket.customer_phone}</a></span>
                      <span>หมวดหมู่: <strong>{detailData.ticket.category === 'other' ? (detailData.ticket.other_category ? `อื่น ๆ (${detailData.ticket.other_category})` : 'อื่น ๆ') : (CATEGORIES[detailData.ticket.category]?.label || detailData.ticket.category)}</strong></span>
                      {detailData.ticket.booking_code && (
                        <span>รหัสการจอง: <strong>#{detailData.ticket.booking_code}</strong></span>
                      )}
                      {detailData.ticket.room_name && (
                        <span>ห้อง: <strong>{detailData.ticket.room_name}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Status & Priority Badge */}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {(() => {
                      const prio = PRIORITIES[detailData.ticket.priority] || PRIORITIES.normal;
                      return (
                        <span style={{
                          background: prio.bg,
                          color: prio.color,
                          padding: '4px 10px',
                          borderRadius: '999px',
                          fontSize: '0.74rem',
                          fontWeight: 800
                        }}>
                          {prio.label}
                        </span>
                      );
                    })()}

                    {(() => {
                      const st = STATUSES[detailData.ticket.status] || STATUSES.NEW;
                      return (
                        <span className="tkt-badge" style={{
                          background: st.bg,
                          color: st.text,
                          border: `1px solid ${st.color}40`
                        }}>
                          {st.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Quick Management Bar */}
                <div style={{
                  borderTop: '1px solid #e2e8f0',
                  paddingTop: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px'
                }}>
                  {/* Status Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#475569' }}>เปลี่ยนสถานะ:</span>
                    {detailData.ticket.status !== 'ACKNOWLEDGED' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus('ACKNOWLEDGED')}
                        disabled={statusUpdating}
                        style={{
                          background: '#e0f2fe',
                          color: '#0369a1',
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        รับเรื่อง
                      </button>
                    )}
                    {detailData.ticket.status !== 'IN_PROGRESS' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus('IN_PROGRESS')}
                        disabled={statusUpdating}
                        style={{
                          background: '#ede9fe',
                          color: '#6d28d9',
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        กำลังดำเนินการ
                      </button>
                    )}
                    {detailData.ticket.status !== 'RESOLVED' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus('RESOLVED')}
                        disabled={statusUpdating}
                        style={{
                          background: '#d1fae5',
                          color: '#047857',
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        แก้ไขแล้ว
                      </button>
                    )}
                    {detailData.ticket.status !== 'CLOSED' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus('CLOSED')}
                        disabled={statusUpdating}
                        style={{
                          background: '#f1f5f9',
                          color: '#475569',
                          border: 'none',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        ปิดงาน
                      </button>
                    )}
                  </div>

                  {/* Priority & Assignee selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select
                      value={detailData.ticket.priority}
                      onChange={(e) => handleUpdatePriority(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem'
                      }}
                    >
                      <option value="urgent">เร่งด่วนมาก</option>
                      <option value="high">สูง</option>
                      <option value="normal">ปกติ</option>
                      <option value="low">ต่ำ</option>
                    </select>

                    <input
                      type="text"
                      placeholder="ผู้รับผิดชอบ"
                      defaultValue={detailData.ticket.assigned_to || ''}
                      onBlur={(e) => handleUpdateAssignee(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem',
                        width: '100px'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Conversation / Messages Timeline */}
              <div className="tkt-timeline">
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MessageSquare size={16} />
                  <span>ไทม์ไลน์การสนทนา & ประวัติการดำเนินการ ({detailData.messages?.length || 0})</span>
                </div>

                {(detailData.messages || []).map((msg) => {
                  const isCustomer = msg.sender_type === 'customer';
                  const isInternal = msg.visibility === 'internal';

                  return (
                    <div
                      key={msg.id}
                      className={`tkt-msg-card ${isCustomer ? 'tkt-msg-customer' : isInternal ? 'tkt-msg-internal' : 'tkt-msg-public'}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 800, color: isCustomer ? '#0f172a' : isInternal ? '#92400e' : '#0369a1' }}>
                            {msg.sender_name || (isCustomer ? 'ลูกค้า' : 'เจ้าหน้าที่')}
                          </span>
                          {isInternal ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              background: '#fef3c7',
                              color: '#b45309',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.68rem',
                              fontWeight: 800
                            }}>
                              <Lock size={10} />
                              <span>บันทึกภายใน (ลูกค้าไม่เห็น)</span>
                            </span>
                          ) : !isCustomer ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              background: '#e0f2fe',
                              color: '#0284c7',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '0.68rem',
                              fontWeight: 800
                            }}>
                              <Globe size={10} />
                              <span>ส่งถึงลูกค้า (Public)</span>
                            </span>
                          ) : null}
                        </div>

                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                          {formatThaiDateTime(msg.created_at)}
                        </span>
                      </div>

                      <div style={{ whiteSpace: 'pre-wrap', color: '#1e293b' }}>
                        {msg.message}
                      </div>

                      {/* Attachments if any */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                          {msg.attachments.map((att, aIdx) => (
                            <div
                              key={aIdx}
                              onClick={() => setPreviewImage(att.file_url)}
                              style={{
                                width: '70px',
                                height: '70px',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                border: '1px solid #cbd5e1',
                                cursor: 'pointer'
                              }}
                            >
                              <img src={att.file_url} alt="att" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Reply Box */}
              <form onSubmit={handleSendReply} style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setReplyVisibility('public')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: replyVisibility === 'public' ? '#0284c7' : '#e2e8f0',
                        color: replyVisibility === 'public' ? '#ffffff' : '#475569',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Globe size={13} />
                      <span>ตอบกลับลูกค้า (Public)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setReplyVisibility('internal')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: replyVisibility === 'internal' ? '#d97706' : '#e2e8f0',
                        color: replyVisibility === 'internal' ? '#ffffff' : '#475569',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Lock size={13} />
                      <span>บันทึกภายใน (เฉพาะพนักงาน)</span>
                    </button>
                  </div>
                </div>

                <textarea
                  rows={3}
                  placeholder={replyVisibility === 'public' ? 'พิมพ์ข้อความเพื่อตอบกลับลูกค้าในระบบ...' : 'พิมพ์บันทึกภายใน (Internal Note) เพื่อให้พนักงานคนอื่นทราบ...'}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit'
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={sendingReply || !replyText.trim()}
                    style={{
                      background: replyVisibility === 'public' ? '#0284c7' : '#d97706',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 18px',
                      borderRadius: '8px',
                      fontSize: '0.84rem',
                      fontWeight: 800,
                      cursor: sendingReply || !replyText.trim() ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Send size={14} />
                    <span>{sendingReply ? 'กำลังบันทึก...' : replyVisibility === 'public' ? 'ส่งข้อความถึงลูกค้า' : 'บันทึก Note ภายใน'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <img
            src={previewImage}
            alt="full preview"
            style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: '8px', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
}
