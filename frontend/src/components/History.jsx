import TaxInvoiceManagementModal from './TaxInvoiceManagementModal';
import AttachSlipModal from './AttachSlipModal';
import React, { useState, useEffect, useMemo, useDeferredValue, useRef } from 'react';
import {
  Search,
  ChevronDown,
  RotateCcw,
  Ban,
  Clock,
  Calendar,
  Eye,
  DollarSign,
  Printer,
  X,
  Filter,
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Trash2,
  Download,
  FileSpreadsheet,
  ExternalLink,
  RefreshCw,
  MoreHorizontal,
  Phone,
  User,
  Copy,
  Check,
  AlertCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ReceiptPrint from './ReceiptPrint';
import { printReceipt } from '../utils/printReceiptHelper';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';
import { formatTransactionDateTime } from '../dateUtils';
import {
  getTodayBangkokDate,
  formatExportDate,
  filterBookingsForExport,
  buildDashboardExportRows,
  generateDashboardCsv,
  generateDashboardTsv,
  downloadDashboardCsvFile,
  downloadDashboardXlsxFile,
  EXPORT_CUSTOMER_TYPE_OPTIONS,
  getDateOffsetBangkok,
  getStartOfMonthBangkok
} from '../utils/dashboardExport';
import {
  normalizeBookingFinancials,
  formatMoney,
  getPaymentMethodLabel,
  getTransactionTypeLabel
} from '../utils/financialUtils';
import { API_BASE } from '../apiConfig';

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'all', label: 'ทุกประเภท' },
  { value: 'general', label: 'ทั่วไป' },
  { value: 'builtland', label: 'Builtland' },
  { value: 'basecamp', label: 'Basecamp' }
];

const CHANNEL_OPTIONS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'pos', label: 'POS' },
  { key: 'line_oa', label: 'LINE OA' }
];

const STATUS_TABS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'paid', label: 'ชำระแล้ว' },
  { key: 'deposit', label: 'มัดจำ' },
  { key: 'cancelled', label: 'ยกเลิก' },
  { key: 'tax_invoice', label: 'ขอใบกำกับภาษี' }
];

function HistoryLog({ settings, sysAlert, sysConfirm }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const isFetchingRef = useRef(false);
  // Manual refresh visual feedback states: 'idle' | 'loading' | 'success'
  const [manualRefreshState, setManualRefreshState] = useState('idle');
  const successTimerRef = useRef(null);

  // Cleanup feedback timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Search & Filter State (Instant reactive filtering)
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customerTypeFilter, setCustomerTypeFilter] = useState('all');
  const [bookingChannelFilter, setBookingChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'paid' | 'cancelled' | 'tax_invoice'

  // Modals state
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [attachingTxId, setAttachingTxId] = useState(null);
  const attachTxFileInputRef = useRef(null);

  const handleAttachSlipToTransaction = async (bookingId, paymentId, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (sysAlert) await sysAlert('ไฟล์สลิปมีขนาดใหญ่เกินไป (จำกัดไม่เกิน 10MB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target.result;
      try {
        const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
        const res = await fetch(`/api/bookings/${bookingId}/payments/${paymentId}/slip`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ slip_image: base64Data })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (sysAlert) await sysAlert('แนบสลิปหลักฐานเรียบร้อยแล้ว');
          fetchPaymentTransactions(bookingId);
          fetchHistoryBookings(true);
        } else {
          if (sysAlert) await sysAlert(data.error || 'เกิดข้อผิดพลาดในการแนบสลิป');
        }
      } catch (err) {
        console.error('Error attaching slip in history:', err);
        if (sysAlert) await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      }
    };
    reader.readAsDataURL(file);
  };
  const [selectedTaxBooking, setSelectedTaxBooking] = useState(null);
  const [viewingSlipBooking, setViewingSlipBooking] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [basecampQuota, setBasecampQuota] = useState(null);
  const [basecampQuotaLoading, setBasecampQuotaLoading] = useState(false);
  const [basecampQuotaError, setBasecampQuotaError] = useState(null);
  const [paymentTransactions, setPaymentTransactions] = useState([]);
  const [attachSlipModalData, setAttachSlipModalData] = useState(null);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const activePaymentFetchIdRef = useRef(null);

  // Dashboard Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(getTodayBangkokDate());
  const [exportEndDate, setExportEndDate] = useState(getTodayBangkokDate());
  const [exportCustomerType, setExportCustomerType] = useState('all');
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Active Dropdown Action Menu in table row
  const [activeActionMenuBooking, setActiveActionMenuBooking] = useState(null);
  const [actionMenuPos, setActionMenuPos] = useState(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  // Sorting state (default: newest transaction first)
  const [sortKey, setSortKey] = useState('id');
  const [sortOrder, setSortOrder] = useState('desc');

  // Static Column Definitions (7 Clear Columns matching Booking List layout proportions)
  const columns = [
    { key: 'id', label: 'เลขที่ / วันที่', width: '14%' },
    { key: 'customer_name', label: 'ผู้จอง', width: '18%' },
    { key: 'usage_date', label: 'ห้อง / เวลาใช้งาน', width: '25%' },
    { key: 'total_amount', label: 'ยอดชำระ', width: '10%' },
    { key: 'payment_status', label: 'สถานะ', width: '11%' },
    { key: 'documents', label: 'เอกสาร', width: '10%' },
    { key: 'actions', label: 'การดำเนินการ', width: '12%' }
  ];

  // Action Menu Toggle & Close Handlers
  const handleToggleActionMenu = (e, booking) => {
    e.stopPropagation();
    if (activeActionMenuBooking?.id === booking.id) {
      setActiveActionMenuBooking(null);
      setActionMenuPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 90;
    const spaceBelow = window.innerHeight - rect.bottom;
    const isUpward = spaceBelow < menuHeight && rect.top > menuHeight;

    setActionMenuPos({
      top: isUpward ? undefined : rect.bottom + 6,
      bottom: isUpward ? (window.innerHeight - rect.top) + 6 : undefined,
      right: Math.max(12, window.innerWidth - rect.right),
      isUpward
    });
    setActiveActionMenuBooking(booking);
  };

  useEffect(() => {
    const handleCloseOnScrollOrResize = () => {
      if (activeActionMenuBooking) {
        setActiveActionMenuBooking(null);
        setActionMenuPos(null);
      }
    };
    window.addEventListener('scroll', handleCloseOnScrollOrResize, true);
    window.addEventListener('resize', handleCloseOnScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleCloseOnScrollOrResize, true);
      window.removeEventListener('resize', handleCloseOnScrollOrResize);
    };
  }, [activeActionMenuBooking]);

  // Initial fetch on mount
  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async (isManual = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (bookings.length === 0) setLoading(true);
    if (isManual) {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      setManualRefreshState('loading');
    }
    const startedAt = isManual ? performance.now() : 0;
    try {
      const res = await fetch('/api/bookings');
      if (res.ok) {
        const data = await res.json();
        setBookings(data || []);
      }
      if (isManual) {
        const elapsed = performance.now() - startedAt;
        const remaining = Math.max(0, 350 - elapsed);
        if (remaining > 0) {
          await new Promise(r => setTimeout(r, remaining));
        }
        setManualRefreshState('success');
        successTimerRef.current = setTimeout(() => {
          setManualRefreshState('idle');
        }, 1000);
      }
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      if (isManual) {
        setManualRefreshState('idle');
      }
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  // Explicit Clear All Filters
  const handleClearFilters = () => {
    setSearchQuery('');
    setStartDate('');
    setEndDate('');
    setCustomerTypeFilter('all');
    setBookingChannelFilter('all');
    setStatusFilter('all');
    setCurrentPage(1);
  };

  const isAnyFilterActive = Boolean(
    searchQuery ||
    startDate ||
    endDate ||
    customerTypeFilter !== 'all' ||
    bookingChannelFilter !== 'all' ||
    statusFilter !== 'all'
  );

  // Open details modal
  const openBookingDetails = async (id) => {
    try {
      const res = await fetch(`/api/bookings/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBooking(data);
        setShowDetailsModal(true);
      }
    } catch (err) {
      sysAlert('ไม่สามารถโหลดรายละเอียดใบจองนี้ได้');
    }
  };

  useEffect(() => {
    if (showDetailsModal && selectedBooking?.customer_type === 'basecamp') {
      const b = selectedBooking;
      const subType = b.basecamp_sub_type || 'office';
      const unit = b.basecamp_unit;
      if (!unit) {
        setBasecampQuota(null);
        setBasecampQuotaLoading(false);
        setBasecampQuotaError('missing_unit');
        return;
      }
      setBasecampQuotaLoading(true);
      setBasecampQuotaError(null);

      const firstItem = b.items?.[0] || {};
      const serviceTimeStr = firstItem.start_time || b.start_time || b.booking_date || b.created_at;
      let month, year;
      if (serviceTimeStr) {
        const cleanStr = String(serviceTimeStr).replace(' ', 'T');
        const [dPart] = cleanStr.split('T');
        if (dPart && dPart.includes('-')) {
          const parts = dPart.split('-');
          if (parts.length >= 2) {
            year = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10);
          }
        }
      }
      if (!month || !year || isNaN(month) || isNaN(year)) {
        const now = new Date();
        month = now.getMonth() + 1;
        year = now.getFullYear();
      }

      const token = localStorage.getItem('token') || sessionStorage.getItem('token');
      fetch(`${API_BASE}/api/basecamp/quota?sub_type=${encodeURIComponent(subType)}&unit=${encodeURIComponent(unit)}&month=${month}&year=${year}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(data => {
          setBasecampQuota(data);
        })
        .catch(err => {
          console.error('Failed to load Basecamp quota:', err);
          setBasecampQuota(null);
          setBasecampQuotaError(err.message || 'load_failed');
        })
        .finally(() => {
          setBasecampQuotaLoading(false);
        });
    } else if (!showDetailsModal) {
      setBasecampQuota(null);
      setBasecampQuotaLoading(false);
      setBasecampQuotaError(null);
    }
  }, [showDetailsModal, selectedBooking?.id, selectedBooking?.customer_type, selectedBooking?.basecamp_unit, selectedBooking?.basecamp_sub_type]);

  // Payment transactions synchronization for History Detail Modal (P3)
  const fetchPaymentTransactions = async (bookingId) => {
    if (!bookingId) {
      setPaymentTransactions([]);
      return;
    }
    activePaymentFetchIdRef.current = bookingId;
    setIsLoadingPayments(true);
    try {
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const res = await fetch(`/api/bookings/${bookingId}/payments`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (activePaymentFetchIdRef.current === bookingId) {
          setPaymentTransactions(data.payments || []);
        }
      } else {
        if (activePaymentFetchIdRef.current === bookingId) {
          setPaymentTransactions([]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch payment transactions in History:', err);
      if (activePaymentFetchIdRef.current === bookingId) {
        setPaymentTransactions([]);
      }
    } finally {
      if (activePaymentFetchIdRef.current === bookingId) {
        setIsLoadingPayments(false);
      }
    }
  };

  useEffect(() => {
    const targetId = (showDetailsModal && selectedBooking?.id) || viewingSlipBooking?.id;
    if (targetId) {
      fetchPaymentTransactions(targetId);
    } else {
      activePaymentFetchIdRef.current = null;
      setPaymentTransactions([]);
    }
  }, [showDetailsModal, selectedBooking?.id, viewingSlipBooking?.id]);

  const triggerPrint = () => {
    printReceipt('print-receipt-area');
  };

  const handleDownloadPDF = () => {
    if (!selectedBooking) return;
    const element = document.getElementById('print-receipt-area');
    if (!element) return;

    if (!window.html2pdf) {
      sysAlert('ระบบพิมพ์ PDF ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง');
      return;
    }

    element.classList.add('pdf-export-mode');

    const opt = {
      margin:       [0, 0, 0, 0],
      filename:     `receipt-${selectedBooking.receipt_number || String(selectedBooking.id).padStart(6, '0')}.pdf`,
      image:        { type: 'png' },
      html2canvas:  { scale: 4, useCORS: true },
      jsPDF:        { unit: 'mm', format: [72, 200], orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    window.html2pdf().from(element).set(opt).save().then(() => {
      element.classList.remove('pdf-export-mode');
    }).catch(err => {
      element.classList.remove('pdf-export-mode');
      console.error(err);
    });
  };

  const handleDeleteBooking = async (id, customerName, receiptNo, e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    const confirmMessage = `คุณต้องการลบ/ยกเลิกรายการจองของ ${customerName || ''} (${receiptNo || '#' + id}) ใช่หรือไม่?\n\n* ข้อมูลการจองและรายการในบิลนี้จะถูกลบออกจากระบบถาวร`;

    let ok = false;
    if (sysConfirm) {
      ok = await sysConfirm(confirmMessage);
    } else {
      ok = window.confirm(confirmMessage);
    }
    if (!ok) return;

    try {
      let res = null;
      if (id) {
        res = await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      }

      if ((!res || !res.ok) && receiptNo) {
        res = await fetch(`/api/bookings/${encodeURIComponent(receiptNo)}`, { method: 'DELETE' });
      }

      if (res && res.ok) {
        if (sysAlert) sysAlert('ลบรายการจองเรียบร้อยแล้ว');
        setBookings(prev => prev.filter(b => String(b.id) !== String(id) && String(b.receipt_number) !== String(receiptNo)));
        if (selectedBooking && (String(selectedBooking.id) === String(id) || selectedBooking.receipt_number === receiptNo)) {
          setShowDetailsModal(false);
          setSelectedBooking(null);
        }
        fetchBookings();
      } else {
        let errMessage = 'เกิดข้อผิดพลาดในการลบรายการจอง';
        if (res) {
          try {
            const errData = await res.json();
            errMessage = errData.error || errMessage;
          } catch(errJson) {}
        }
        if (sysAlert) sysAlert(errMessage);
      }
    } catch (err) {
      console.error('Delete booking error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  // Safe Local Date Parser
  const parseLocalDate = (dateStr) => {
    if (!dateStr) return null;
    const str = String(dateStr).trim().replace(' ', 'T');
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const hour = match[4] !== undefined ? parseInt(match[4], 10) : 0;
      const minute = match[5] !== undefined ? parseInt(match[5], 10) : 0;
      const second = match[6] !== undefined ? parseInt(match[6], 10) : 0;
      return new Date(year, month, day, hour, minute, second);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDate = (dateStr) => formatTransactionDateTime(dateStr);

  const monthNamesThai = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  // Format Usage Date & Time
  const formatUsageDate = (booking) => {
    if (!booking) return { dateStr: '-', timeStr: '', roomName: '' };
    const firstItem = booking.items?.[0] || {};
    const startStr = firstItem.start_time || booking.start_time || booking.booking_date;
    const endStr = firstItem.end_time || booking.end_time;
    const roomName = firstItem.room_name || booking.room_name || '';

    if (!startStr) return { dateStr: '-', timeStr: '', roomName };

    try {
      let dateStr = '-';
      const str = String(startStr).trim();
      if (str.includes('T')) {
        const [dPart] = str.split('T');
        const [y, m, day] = dPart.split('-').map(Number);
        if (y && m && day) {
          const thaiYear = y + 543;
          dateStr = `${day} ${monthNamesThai[m - 1]} ${thaiYear}`;
        }
      } else if (str.includes('-')) {
        const datePart = str.split(' ')[0];
        const dateParts = datePart.split('-').map(Number);
        if (dateParts.length === 3 && dateParts[0] && dateParts[1] && dateParts[2]) {
          const [y, m, day] = dateParts;
          const thaiYear = y + 543;
          dateStr = `${day} ${monthNamesThai[m - 1]} ${thaiYear}`;
        }
      }

      if (dateStr === '-') {
        const d = parseLocalDate(startStr) || new Date(str);
        if (d && !isNaN(d.getTime())) {
          dateStr = `${d.getDate()} ${monthNamesThai[d.getMonth()]} ${d.getFullYear() + 543}`;
        }
      }

      const extractHHMM = (val) => {
        if (!val) return '';
        const s = String(val).trim();
        if (s.includes('T')) {
          const timePart = s.split('T')[1];
          return timePart ? timePart.substring(0, 5) : '';
        }
        if (s.includes(' ')) {
          const parts = s.split(' ');
          const timePart = parts[1] || parts[0];
          if (timePart.includes(':')) return timePart.substring(0, 5);
        }
        if (s.includes(':')) {
          return s.substring(0, 5);
        }
        return '';
      };

      const sTime = extractHHMM(startStr);
      const eTime = extractHHMM(endStr);
      let timeStr = '';
      if (sTime && eTime) {
        timeStr = `${sTime} - ${eTime} น.`;
      } else if (sTime) {
        timeStr = `${sTime} น.`;
      }

      return {
        dateStr,
        timeStr,
        roomName
      };
    } catch (e) {
      return { dateStr: '-', timeStr: '', roomName };
    }
  };

  const handleSort = (key) => {
    if (key === 'actions' || key === 'documents') return;
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  // 1. Base Filter (Search, Date range, Customer type, Channel)
  const baseBookings = useMemo(() => {
    return bookings.filter(b => {
      // 1. Date Filter (Either created_at or usage_date in range)
      if (startDate || endDate) {
        const createdDateStr = b.created_at ? b.created_at.split('T')[0].split(' ')[0] : '';
        const startTimeStr = (b.items?.[0]?.start_time || b.start_time || b.booking_date || '') ? (b.items?.[0]?.start_time || b.start_time || b.booking_date).split('T')[0].split(' ')[0] : '';

        const createdInRange = (!startDate || (createdDateStr && createdDateStr >= startDate)) && (!endDate || (createdDateStr && createdDateStr <= endDate));
        const usageInRange = (!startDate || (startTimeStr && startTimeStr >= startDate)) && (!endDate || (startTimeStr && startTimeStr <= endDate));

        if (!createdInRange && !usageInRange) return false;
      }

      // 2. Customer Type Filter
      if (customerTypeFilter !== 'all') {
        const isLine = (b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'online');
        const cType = b.customer_type || (isLine ? 'general' : 'walkin');
        if (customerTypeFilter === 'general') {
          if (cType !== 'general' && cType !== 'walkin' && cType !== 'online') return false;
        } else if (cType !== customerTypeFilter) {
          return false;
        }
      }

      // 3. Booking Channel Filter
      if (bookingChannelFilter !== 'all') {
        const isLine = (b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'online');
        const channel = isLine ? 'line_oa' : 'pos';
        if (channel !== bookingChannelFilter) return false;
      }

      // 4. Unified Search Query (Receipt, ID, Customer, Phone, Room, Tax ID, Tax Name)
      if (deferredSearchQuery) {
        const q = deferredSearchQuery.toLowerCase().trim();
        const receipt = (b.receipt_number || '#' + b.id).toLowerCase();
        const idStr = String(b.id);
        const customer = (b.customer_name || '').toLowerCase();
        const contact = (b.contact || '').toLowerCase();
        const room = (b.items?.[0]?.room_name || b.room_name || '').toLowerCase();
        const taxId = (b.tax_id || '').toLowerCase();
        const taxName = (b.tax_name || '').toLowerCase();
        const dept = (b.department || b.internal_department || '').toLowerCase();

        const match = receipt.includes(q) ||
          idStr.includes(q) ||
          customer.includes(q) ||
          contact.includes(q) ||
          room.includes(q) ||
          taxId.includes(q) ||
          taxName.includes(q) ||
          dept.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [bookings, startDate, endDate, customerTypeFilter, bookingChannelFilter, deferredSearchQuery]);

  // Summary Counts (from baseBookings)
  const totalBaseCount = baseBookings.length;
  const paidCount = baseBookings.filter(b => {
    const fin = normalizeBookingFinancials(b);
    return fin ? (fin.is_paid || b.payment_status === 'internal_free') : (b.payment_status === 'paid' || b.payment_status === 'internal_free');
  }).length;
  const depositCount = baseBookings.filter(b => {
    const fin = normalizeBookingFinancials(b);
    return fin ? fin.is_deposit : b.payment_status === 'deposit';
  }).length;
  const cancelledCount = baseBookings.filter(b => b.payment_status === 'cancelled').length;
  const taxInvoiceCount = baseBookings.filter(b => b.tax_invoice_required === 1).length;

  // Realized money received = sum(paid_amount)
  const realizedRevenue = baseBookings.reduce((sum, b) => {
    if (b.payment_status === 'cancelled' || b.payment_status === 'failed') return sum;
    const fin = normalizeBookingFinancials(b);
    return sum + (fin ? Number(fin.paid_amount || 0) : (b.payment_status === 'paid' ? Number(b.total_amount || 0) : 0));
  }, 0);

  // Outstanding balance = sum(balance_amount) only for active collectible bookings
  const totalOutstanding = baseBookings.reduce((sum, b) => {
    const fin = normalizeBookingFinancials(b);
    return sum + (fin && fin.is_collectible ? Number(fin.balance_amount || 0) : 0);
  }, 0);

  // Backward compatibility alias
  const totalAmountPaid = realizedRevenue;

  // 2. Final Filter with Status Quick Filter Tabs
  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return baseBookings;
    if (statusFilter === 'paid') return baseBookings.filter(b => {
      const fin = normalizeBookingFinancials(b);
      return fin ? (fin.is_paid || b.payment_status === 'internal_free') : (b.payment_status === 'paid' || b.payment_status === 'internal_free');
    });
    if (statusFilter === 'deposit') return baseBookings.filter(b => {
      const fin = normalizeBookingFinancials(b);
      return fin ? fin.is_deposit : b.payment_status === 'deposit';
    });
    if (statusFilter === 'cancelled') return baseBookings.filter(b => b.payment_status === 'cancelled');
    if (statusFilter === 'tax_invoice') return baseBookings.filter(b => b.tax_invoice_required === 1);
    return baseBookings;
  }, [baseBookings, statusFilter]);

  // Sorting
  const getSortedBookings = () => {
    const sorted = [...filteredBookings];
    sorted.sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];

      if (sortKey === 'id') {
        valA = Number(a.id);
        valB = Number(b.id);
      } else if (sortKey === 'created_at') {
        valA = a.created_at ? new Date(a.created_at).getTime() : 0;
        valB = b.created_at ? new Date(b.created_at).getTime() : 0;
      } else if (sortKey === 'usage_date') {
        const getTs = (item) => {
          const s = item.items?.[0]?.start_time || item.start_time || item.booking_date;
          if (!s) return 0;
          const t = new Date(s).getTime();
          return isNaN(t) ? 0 : t;
        };
        valA = getTs(a);
        valB = getTs(b);
      } else if (sortKey === 'customer_name') {
        valA = (a.customer_name || '').toLowerCase();
        valB = (b.customer_name || '').toLowerCase();
      } else if (sortKey === 'total_amount') {
        valA = Number(a.total_amount || 0);
        valB = Number(b.total_amount || 0);
      } else if (sortKey === 'payment_status') {
        valA = (a.payment_status || '').toLowerCase();
        valB = (b.payment_status || '').toLowerCase();
      } else {
        valA = valA ? String(valA).toLowerCase() : '';
        valB = valB ? String(valB).toLowerCase() : '';
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  };

  const sortedBookings = getSortedBookings();

  // Dashboard Export Handlers & Matching Logic
  const isInvalidDateRange = Boolean(exportStartDate && exportEndDate && exportEndDate < exportStartDate);
  const exportMatchingPairs = useMemo(() => {
    if (isInvalidDateRange) return [];
    return filterBookingsForExport(bookings, {
      startDate: exportStartDate,
      endDate: exportEndDate,
      customerType: exportCustomerType
    });
  }, [bookings, exportStartDate, exportEndDate, exportCustomerType, isInvalidDateRange]);

  const handleExportDashboardCsv = () => {
    try {
      if (isInvalidDateRange) {
        if (sysAlert) sysAlert('ช่วงวันที่ไม่ถูกต้อง: วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
        return;
      }
      if (exportMatchingPairs.length === 0) {
        if (sysAlert) sysAlert('ไม่พบรายการในช่วงวันที่และประเภทลูกค้าที่เลือก');
        return;
      }
      const rows = buildDashboardExportRows(exportMatchingPairs);
      const csv = generateDashboardCsv(rows);
      const filename = exportStartDate === exportEndDate
        ? `BWORK-Dashboard-Export-${exportStartDate}.csv`
        : `BWORK-Dashboard-Export-${exportStartDate}_to_${exportEndDate}.csv`;
      downloadDashboardCsvFile(csv, filename);
    } catch (err) {
      console.error('CSV Export error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการสร้างไฟล์ CSV: ' + err.message);
    }
  };

  const handleExportDashboardXlsx = () => {
    try {
      if (isInvalidDateRange) {
        if (sysAlert) sysAlert('ช่วงวันที่ไม่ถูกต้อง: วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
        return;
      }
      if (exportMatchingPairs.length === 0) {
        if (sysAlert) sysAlert('ไม่พบรายการในช่วงวันที่และประเภทลูกค้าที่เลือก');
        return;
      }
      const rows = buildDashboardExportRows(exportMatchingPairs);
      const filename = exportStartDate === exportEndDate
        ? `BWORK-Dashboard-Export-${exportStartDate}.xlsx`
        : `BWORK-Dashboard-Export-${exportStartDate}_to_${exportEndDate}.xlsx`;
      downloadDashboardXlsxFile(rows, filename, XLSX);
    } catch (err) {
      console.error('XLSX Export error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการสร้างไฟล์ XLSX: ' + err.message);
    }
  };

  const handleCopyDashboardTsv = async () => {
    try {
      if (isInvalidDateRange) {
        if (sysAlert) sysAlert('ช่วงวันที่ไม่ถูกต้อง: วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น');
        return;
      }
      if (exportMatchingPairs.length === 0) {
        if (sysAlert) sysAlert('ไม่พบรายการในช่วงวันที่และประเภทลูกค้าที่เลือก');
        return;
      }
      const rows = buildDashboardExportRows(exportMatchingPairs);
      const tsv = generateDashboardTsv(rows);
      await navigator.clipboard.writeText(tsv);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2500);
    } catch (err) {
      console.error('Clipboard copy error:', err);
      if (sysAlert) sysAlert('ไม่สามารถคัดลอกข้อมูลได้: ' + err.message);
    }
  };

  // Pagination Calculations
  const totalRows = sortedBookings.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;

  // Clamp pagination safely if totalPages changes
  useEffect(() => {
    if (totalPages >= 1 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    } else if (totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const safeCurrentPage = totalPages >= 1 ? Math.min(currentPage, totalPages) : 1;
  const indexOfLastRow = safeCurrentPage * rowsPerPage;
  const indexOfFirstRow = Math.max(0, indexOfLastRow - rowsPerPage);
  const paginatedBookings = sortedBookings.slice(indexOfFirstRow, indexOfLastRow);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{`
        @media (min-width: 901px) {
          .history-desktop-table {
            display: block !important;
          }
          .history-mobile-cards {
            display: none !important;
          }
        }
        @media (max-width: 900px) {
          .history-desktop-table {
            display: none !important;
          }
          .history-mobile-cards {
            display: flex !important;
            flex-direction: column !important;
            gap: 10px !important;
          }
        }
        .action-menu-item {
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.82rem;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-main);
          transition: all 0.15s ease;
        }
        .action-menu-item:hover {
          background-color: var(--bg-hover);
        }
        .action-menu-danger:hover {
          background-color: rgba(239, 68, 68, 0.12) !important;
        }
      `}</style>

      {/* 1. Header Panel */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
            ประวัติการใช้บริการ
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '3px 0 0 0' }}>
            ค้นหาประวัติธุรกรรมย้อนหลัง ตรวจสอบบันทึกการใช้งาน และพิมพ์ใบเสร็จ/เอกสารภาษี
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Export สำหรับ Dashboard */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const today = getTodayBangkokDate();
              setExportStartDate(today);
              setExportEndDate(today);
              setExportCustomerType('all');
              setShowExportModal(true);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              fontWeight: 700,
              padding: '7px 14px',
              borderRadius: '10px'
            }}
            title="ส่งออกข้อมูลสำหรับลงระบบ Dashboard ภายนอก"
          >
            <FileSpreadsheet size={15} />
            <span>Export สำหรับ Dashboard</span>
          </button>

          {/* Refresh */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fetchBookings(true)}
            disabled={loading || manualRefreshState === 'loading'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              padding: '7px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: manualRefreshState === 'success' ? 'rgba(16, 185, 129, 0.06)' : 'var(--bg-card)',
              borderColor: manualRefreshState === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)',
              color: manualRefreshState === 'success' ? '#10b981' : undefined
            }}
            title="โหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์"
          >
            {manualRefreshState === 'success' ? (
              <>
                <Check size={13} style={{ color: '#10b981' }} />
                <span>อัปเดตแล้ว</span>
              </>
            ) : (
              <>
                <RefreshCw size={13} className={manualRefreshState === 'loading' ? 'spin' : ''} />
                <span>{manualRefreshState === 'loading' ? 'กำลังรีเฟรช...' : 'รีเฟรช'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Compact Summary & Quick Status Filter Strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        {/* Status Quick Filter Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {STATUS_TABS.map(tab => {
            const isActive = statusFilter === tab.key;
            let count = totalBaseCount;
            if (tab.key === 'paid') count = paidCount;
            if (tab.key === 'deposit') count = depositCount;
            if (tab.key === 'cancelled') count = cancelledCount;
            if (tab.key === 'tax_invoice') count = taxInvoiceCount;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.key);
                  setCurrentPage(1);
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  border: isActive ? '1px solid var(--primary-color)' : '1px solid transparent',
                  backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
                  color: isActive ? 'var(--primary-color)' : 'var(--text-muted)',
                  fontWeight: isActive ? 800 : 600,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>{tab.label}</span>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '1px 7px',
                  borderRadius: '999px',
                  backgroundColor: isActive ? 'var(--primary-color)' : 'var(--bg-hover)',
                  color: isActive ? '#ffffff' : 'var(--text-muted)',
                  border: isActive ? 'none' : '1px solid var(--border-color)'
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Revenue and Outstanding Balance Summary Metrics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.78rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรับเงินจริง:</span>
            <span style={{ color: '#16a34a', fontWeight: 850 }}>฿{realizedRevenue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          {totalOutstanding > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>ยอดคงค้าง:</span>
              <span style={{ color: '#f59e0b', fontWeight: 850 }}>฿{totalOutstanding.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Unified Filter Toolbar (Single unified row) */}
      <div className="card" style={{
        padding: '12px 14px',
        borderRadius: '14px',
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          width: '100%'
        }}>
          {/* 1. Unified Search Input */}
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: '180px', maxWidth: '280px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              type="text"
              className="form-control"
              style={{
                width: '100%',
                paddingLeft: '32px',
                paddingRight: searchQuery ? '28px' : '10px',
                height: '36px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-hover)',
                color: 'var(--text-main)',
                boxSizing: 'border-box'
              }}
              placeholder="ค้นหาเลขที่, ชื่อ, เบอร์, ห้อง, เลขภาษี..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="ล้างคำค้นหา"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 2. Date Range: Start Date & End Date */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <CustomDatePicker
              value={startDate}
              onChange={val => { setStartDate(val); setCurrentPage(1); }}
              placeholder="วันเริ่มต้น"
              className="form-control"
              style={{
                height: '36px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                border: startDate ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                background: 'var(--bg-hover)',
                color: startDate ? 'var(--primary-color)' : 'var(--text-main)',
                padding: '0 8px',
                width: '115px',
                whiteSpace: 'nowrap'
              }}
            />
            <CustomDatePicker
              value={endDate}
              onChange={val => { setEndDate(val); setCurrentPage(1); }}
              placeholder="วันสิ้นสุด"
              className="form-control"
              style={{
                height: '36px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                border: endDate ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                background: 'var(--bg-hover)',
                color: endDate ? 'var(--primary-color)' : 'var(--text-main)',
                padding: '0 8px',
                width: '115px',
                whiteSpace: 'nowrap'
              }}
            />
          </div>

          {/* 3. Customer Type Dropdown */}
          <div style={{ flexShrink: 0 }}>
            <CustomSelect
              value={customerTypeFilter}
              onChange={val => { setCustomerTypeFilter(val); setCurrentPage(1); }}
              options={CUSTOMER_TYPE_OPTIONS}
              usePortal={true}
              noTruncate={true}
              triggerStyle={{
                height: '36px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                backgroundColor: 'var(--bg-hover)',
                border: customerTypeFilter !== 'all' ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                color: customerTypeFilter !== 'all' ? 'var(--primary-color)' : 'var(--text-main)',
                padding: '0 8px',
                width: '118px',
                whiteSpace: 'nowrap'
              }}
              menuStyle={{ minWidth: '125px' }}
            />
          </div>

          {/* 4. Booking Channel Segmented Control */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-hover)',
            padding: '2px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            height: '36px',
            boxSizing: 'border-box',
            flexShrink: 0
          }}>
            {CHANNEL_OPTIONS.map(ch => {
              const isActive = bookingChannelFilter === ch.key;
              return (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => { setBookingChannelFilter(ch.key); setCurrentPage(1); }}
                  style={{
                    padding: '0 10px',
                    height: '100%',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: isActive ? 'var(--primary-color)' : 'transparent',
                    color: isActive ? '#ffffff' : 'var(--text-muted)',
                    fontSize: '0.78rem',
                    fontWeight: isActive ? 800 : 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center'
                  }}
                >
                  {ch.label}
                </button>
              );
            })}
          </div>

          {/* 5. Grouped Result Count & Clear Action (Right side) */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginLeft: 'auto',
            flexShrink: 0
          }}>
            <span style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}>
              พบ <strong style={{ color: 'var(--primary-color)' }}>{totalRows}</strong> รายการ
            </span>

            <button
              type="button"
              onClick={handleClearFilters}
              disabled={!isAnyFilterActive}
              style={{
                padding: '0 12px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: 600,
                height: '36px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                border: isAnyFilterActive ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                background: isAnyFilterActive ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                color: isAnyFilterActive ? 'var(--primary-color)' : 'var(--text-muted)',
                cursor: isAnyFilterActive ? 'pointer' : 'default',
                opacity: isAnyFilterActive ? 1 : 0.45,
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
              title="ล้างตัวกรองทั้งหมด"
            >
              <RotateCcw size={13} />
              <span>ล้างตัวกรอง</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4. Bookings List Display */}
      {loading && bookings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังโหลดประวัติ...</span>
        </div>
      ) : totalRows === 0 ? (
        <div className="card" style={{ padding: '40px 20px', textAlign: 'center', border: '1px solid var(--border-color)', borderRadius: '14px', backgroundColor: 'var(--bg-card)' }}>
          <FileText size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>ไม่พบบันทึกประวัติ</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '6px' }}>กรุณาลองปรับการเลือกช่วงวันที่หรือคำค้นหา</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '14px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', position: 'relative', zIndex: 1 }}>

          {/* Desktop & Tablet Table (7 Columns) */}
          <div className="history-desktop-table" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="table" style={{ width: '100%', minWidth: '980px', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
              <colgroup>
                {columns.map(col => (
                  <col key={col.key} style={{ width: col.width }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border-color)' }}>
                  {columns.map(col => {
                    const isSortable = col.key !== 'actions' && col.key !== 'documents';
                    let align = 'left';
                    if (col.key === 'total_amount') align = 'right';
                    else if (col.key === 'payment_status' || col.key === 'documents' || col.key === 'actions') align = 'center';

                    return (
                      <th
                        key={col.key}
                        onClick={() => isSortable && handleSort(col.key)}
                        style={{
                          textAlign: align,
                          cursor: isSortable ? 'pointer' : 'default',
                          padding: '8px 10px',
                          userSelect: 'none',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                          verticalAlign: 'middle',
                          whiteSpace: 'nowrap',
                          width: col.width || 'auto',
                          boxSizing: 'border-box'
                        }}
                        className={isSortable ? 'sortable-header' : ''}
                      >
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          justifyContent: align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start'),
                          width: '100%'
                        }}>
                          <span>{col.label}</span>
                          {isSortable && (
                            <span style={{ display: 'inline-flex', opacity: sortKey === col.key ? 1 : 0.35 }}>
                              {sortKey === col.key ? (
                                sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                              ) : (
                                <ArrowUpDown size={11} />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paginatedBookings.map((b) => {
                  const usage = formatUsageDate(b);
                  const firstItem = b.items?.[0] || {};
                  const roomName = firstItem.room_name || b.room_name || 'ห้องประชุม';
                  const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom' : 'Standard';
                  const typeLabel = firstItem.booking_type === 'daily' ? 'เหมาวัน' : firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง';
                  const isMultiple = (b.items?.length || 0) > 1;
                  const isCancelled = b.payment_status === 'cancelled';
                  const isLine = (b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'online');

                  return (
                    <tr
                      key={b.id}
                      style={{
                        backgroundColor: 'transparent',
                        borderBottom: '1px solid var(--border-color)',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      {columns.map(col => {
                        const key = col.key;

                        // 1. เลขที่ / วันที่
                        if (key === 'id') {
                          return (
                            <td key={key} style={{ padding: '6px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle', boxSizing: 'border-box' }}>
                              <div style={{ fontWeight: 800, color: 'var(--primary-color)', fontSize: '0.88rem' }}>
                                {b.receipt_number || ('#' + String(b.id).padStart(6, '0'))}
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Clock size={11} />
                                <span>{formatDate(b.created_at)}</span>
                              </div>
                              <div style={{ marginTop: '3px' }}>
                                <span style={{
                                  fontSize: '0.68rem',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  backgroundColor: isLine ? 'rgba(16, 185, 129, 0.1)' : 'rgba(37, 99, 235, 0.1)',
                                  color: isLine ? '#059669' : 'var(--primary-color)',
                                  fontWeight: 700
                                }}>
                                  {isLine ? 'LINE OA' : 'POS'}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        // 2. ผู้จอง
                        if (key === 'customer_name') {
                          const cType = b.customer_type || (isLine ? 'general' : 'walkin');
                          return (
                            <td key={key} style={{ padding: '6px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle', boxSizing: 'border-box' }}>
                              <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.88rem' }}>
                                {b.customer_name || '-'}
                              </div>
                              {b.contact && (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Phone size={11} />
                                  <span>{b.contact}</span>
                                </div>
                              )}
                              <div style={{ marginTop: '3px' }}>
                                {cType === 'builtland' ? (
                                  <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#d97706', fontWeight: 700 }}>
                                    Builtland ({b.internal_department || 'พนักงาน'})
                                  </span>
                                ) : cType === 'basecamp' ? (
                                  <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(147, 51, 234, 0.12)', color: '#9333ea', fontWeight: 700 }}>
                                    Basecamp ({b.basecamp_unit ? (b.basecamp_sub_type === 'hotdesk' ? `Hotdesk ${b.basecamp_unit}` : `Office ${b.basecamp_unit}`) : 'ชั้น 4'})
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(100, 116, 139, 0.1)', color: '#64748b', fontWeight: 600 }}>
                                    ทั่วไป
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // 3. ห้อง / เวลาใช้งาน
                        if (key === 'usage_date') {
                          return (
                            <td key={key} style={{ padding: '6px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle', boxSizing: 'border-box' }}>
                              <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.86rem', lineHeight: 1.25 }}>
                                {roomName}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-main)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                <Calendar size={11} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                                <span>{usage && usage.dateStr !== '-' ? usage.dateStr : '-'}</span>
                              </div>
                              {usage && usage.timeStr ? (
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Clock size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                  <span>{usage.timeStr}</span>
                                </div>
                              ) : null}
                              <div style={{ display: 'flex', gap: '4px', marginTop: '3px', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(37, 99, 235, 0.1)', color: 'var(--primary-color)', fontWeight: 600 }}>
                                  {typeLabel}
                                </span>
                                <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {layoutLabel}
                                </span>
                                {isMultiple && (
                                  <span style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700 }}>
                                    +{b.items.length - 1} รายการ
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // 4. ยอดชำระ
                        if (key === 'total_amount') {
                          const fin = normalizeBookingFinancials(b);
                          const netTotal = fin ? fin.total_amount : Number(b.total_amount || 0);
                          const paidVal = fin ? fin.paid_amount : (b.payment_status === 'paid' ? netTotal : 0);
                          const balVal = fin ? fin.balance_amount : (b.payment_status === 'paid' ? 0 : netTotal);
                          const isDep = fin ? fin.is_deposit : (b.payment_status === 'deposit');

                          return (
                            <td key={key} style={{ textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle', boxSizing: 'border-box' }}>
                              <div style={{ fontWeight: 800, color: 'var(--primary-color)', fontSize: '0.90rem' }}>
                                ฿{netTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                              {isDep ? (
                                <div style={{ fontSize: '0.68rem', lineHeight: 1.25, marginTop: '2px' }}>
                                  <span style={{ color: '#10b981', fontWeight: 700 }}>ชำระ: ฿{paidVal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>·</span>
                                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>ค้าง: ฿{balVal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                              ) : fin && fin.is_collectible && balVal > 0 ? (
                                <div style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600, marginTop: '2px' }}>
                                  ค้างชำระ: ฿{balVal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              ) : null}
                              <div style={{ marginTop: '2px' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.68rem',
                                  fontWeight: 600,
                                  backgroundColor: 'var(--bg-hover)',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-muted)'
                                }}>
                                  {b.payment_method === 'hour_credit' ? 'เครดิตชั่วโมง' : b.payment_method === 'cash' ? '💵 เงินสด' : b.payment_method === 'transfer' ? '📱 โอนเงิน' : (b.payment_method || '-')}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        // 5. สถานะ
                        if (key === 'payment_status') {
                          const fin = normalizeBookingFinancials(b);
                          const isDep = fin ? fin.is_deposit : (b.payment_status === 'deposit');
                          const isRejected = fin ? fin.is_rejected : (b.payment_status === 'rejected' || b.slip_verify_status === 'rejected');
                          const isUnpaid = fin ? fin.is_pending : (b.payment_status === 'pending' || b.payment_status === 'unpaid');
                          const isRev = fin ? fin.is_reviewing : (b.payment_status === 'reviewing');

                          return (
                            <td key={key} style={{ textAlign: 'center', padding: '6px 8px', whiteSpace: 'nowrap', verticalAlign: 'middle', boxSizing: 'border-box' }}>
                              {isCancelled ? (
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                  color: '#ef4444',
                                  border: '1px solid rgba(239, 68, 68, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <Ban size={11} />
                                  <span>ยกเลิก</span>
                                </span>
                              ) : b.payment_status === 'internal_free' ? (
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor: 'rgba(249, 115, 22, 0.12)',
                                  color: '#ea580c',
                                  border: '1px solid rgba(249, 115, 22, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <CheckCircle2 size={11} />
                                  <span>สิทธิ์ภายใน</span>
                                </span>
                              ) : isRejected ? (
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                  color: '#dc2626',
                                  border: '1px solid rgba(239, 68, 68, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <AlertCircle size={11} />
                                  <span>สลิปถูกปฏิเสธ — รอหลักฐานใหม่</span>
                                </span>
                              ) : isDep ? (
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                  color: '#d97706',
                                  border: '1px solid rgba(245, 158, 11, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <Clock size={11} />
                                  <span>มัดจำ</span>
                                </span>
                              ) : isRev ? (
                                (b.payment_status === 'unpaid' && b.slip_image_url) ? (
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                    color: '#d97706',
                                    border: '1px solid rgba(245, 158, 11, 0.35)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <Clock size={11} />
                                    <span>หลักฐานรอตรวจสอบ</span>
                                  </span>
                                ) : (
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    backgroundColor: 'rgba(14, 165, 233, 0.12)',
                                    color: '#0284c7',
                                    border: '1px solid rgba(14, 165, 233, 0.25)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <Clock size={11} />
                                    <span>รอตรวจสลิป</span>
                                  </span>
                                )
                              ) : isUnpaid ? (
                                b.slip_image_url ? (
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                    color: '#d97706',
                                    border: '1px solid rgba(245, 158, 11, 0.35)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <Clock size={11} />
                                    <span>หลักฐานรอตรวจสอบ</span>
                                  </span>
                                ) : (
                                  <span style={{
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    backgroundColor: 'rgba(225, 29, 72, 0.12)',
                                    color: '#e11d48',
                                    border: '1px solid rgba(225, 29, 72, 0.25)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <Clock size={11} />
                                    <span>รอชำระ</span>
                                  </span>
                                )
                              ) : (
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                                  color: '#10b981',
                                  border: '1px solid rgba(16, 185, 129, 0.25)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <CheckCircle2 size={11} />
                                  <span>ชำระแล้ว</span>
                                </span>
                              )}
                            </td>
                          );
                        }

                        // 6. เอกสาร (Documents)
                        if (key === 'documents') {
                          const hasSlip = b.slip_image_url && b.slip_image_url !== 'uploaded';
                          const hasTax = b.tax_invoice_required === 1;

                          return (
                            <td key={key} style={{ textAlign: 'center', padding: '6px 8px', verticalAlign: 'middle', whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
                              <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '3px', alignItems: 'center', justifyContent: 'center' }}>
                                {hasSlip && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setViewingSlipBooking(b); }}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '2px 7px',
                                      borderRadius: '6px',
                                      fontSize: '0.70rem',
                                      fontWeight: 700,
                                      backgroundColor: 'rgba(14, 165, 233, 0.12)',
                                      color: '#0284c7',
                                      border: '1px solid rgba(14, 165, 233, 0.3)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    title="คลิกเพื่อดูรูปภาพสลิปโอนเงินย้อนหลัง"
                                  >
                                    <Eye size={11} />
                                    <span>ดูสลิป</span>
                                  </button>
                                )}

                                {hasTax && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSelectedTaxBooking(b); }}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '2px 7px',
                                      borderRadius: '6px',
                                      fontSize: '0.70rem',
                                      fontWeight: 700,
                                      backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                      color: '#2563eb',
                                      border: '1px solid rgba(59, 130, 246, 0.3)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    title="คลิกดู/คัดลอกข้อมูลใบกำกับภาษี"
                                  >
                                    <FileText size={11} />
                                    <span>ใบกำกับภาษี</span>
                                  </button>
                                )}

                                {!hasSlip && !hasTax && (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>-</span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // 7. การดำเนินการ (Actions)
                        if (key === 'actions') {
                          return (
                            <td key={key} style={{ textAlign: 'center', padding: '6px 8px', verticalAlign: 'middle', whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
                              <div style={{ display: 'inline-flex', gap: '4px', alignItems: 'center', justifyContent: 'center' }}>
                                {isCancelled || b.payment_status === 'internal_free' ? (
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{
                                      backgroundColor: 'var(--bg-hover)',
                                      borderColor: 'var(--border-color)',
                                      color: 'var(--text-muted)',
                                      padding: '5px 11px',
                                      fontSize: '0.76rem',
                                      borderRadius: '8px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      whiteSpace: 'nowrap',
                                      border: '1px solid var(--border-color)'
                                    }}
                                    onClick={() => openBookingDetails(b.id)}
                                    title={isCancelled ? "ดูบันทึกและรายละเอียดการยกเลิก" : "ดูรายละเอียดการใช้สิทธิ์ภายใน"}
                                  >
                                    <FileText size={13} />
                                    <span>ดูรายละเอียด</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    style={{
                                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                      borderColor: 'rgba(16, 185, 129, 0.3)',
                                      color: '#10b981',
                                      padding: '5px 11px',
                                      fontSize: '0.76rem',
                                      borderRadius: '8px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      cursor: 'pointer',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                      border: '1px solid rgba(16, 185, 129, 0.3)'
                                    }}
                                    onClick={() => openBookingDetails(b.id)}
                                    title="ดูตัวอย่าง / พิมพ์ใบเสร็จรับเงิน"
                                  >
                                    <Printer size={13} />
                                    <span>ใบเสร็จ</span>
                                  </button>
                                )}

                                {/* More Actions Dropdown Toggle Button */}
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleActionMenu(e, b)}
                                  className="btn btn-secondary"
                                  style={{
                                    padding: '5px 7px',
                                    fontSize: '0.76rem',
                                    borderRadius: '8px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: activeActionMenuBooking?.id === b.id ? 'var(--primary-color)' : 'var(--bg-hover)',
                                    color: activeActionMenuBooking?.id === b.id ? '#ffffff' : 'var(--text-muted)',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer'
                                  }}
                                  title="เมนูเพิ่มเติม"
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                              </div>
                            </td>
                          );
                        }

                        return null;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (< 768px) */}
          <div className="history-mobile-cards" style={{ padding: '12px' }}>
            {paginatedBookings.map((b) => {
              const fin = normalizeBookingFinancials(b);
              const usage = formatUsageDate(b);
              const firstItem = b.items?.[0] || {};
              const roomName = firstItem.room_name || b.room_name || 'ห้องประชุม';
              const isCancelled = b.payment_status === 'cancelled';
              const isLine = (b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'online');
              const cType = b.customer_type || (isLine ? 'general' : 'walkin');

              return (
                <div
                  key={b.id}
                  className="card"
                  style={{
                    padding: '14px 16px',
                    borderRadius: '16px',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    background: 'var(--bg-card)'
                  }}
                >
                  {/* Row 1: Code + Channel + Status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, color: 'var(--primary-color)', fontSize: '0.9rem' }}>
                      {b.receipt_number || ('#' + String(b.id).padStart(6, '0'))}
                    </span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{
                        fontSize: '0.68rem',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: isLine ? 'rgba(16, 185, 129, 0.1)' : 'rgba(37, 99, 235, 0.1)',
                        color: isLine ? '#059669' : 'var(--primary-color)',
                        fontWeight: 700
                      }}>
                        {isLine ? 'LINE OA' : 'POS'}
                      </span>
                      {isCancelled ? (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', fontWeight: 800 }}>
                          ยกเลิก
                        </span>
                      ) : b.payment_status === 'internal_free' ? (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(249, 115, 22, 0.12)', color: '#ea580c', fontWeight: 800 }}>
                          สิทธิ์ภายใน
                        </span>
                      ) : (fin ? fin.is_rejected : (b.payment_status === 'rejected' || b.slip_verify_status === 'rejected')) ? (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#dc2626', fontWeight: 800 }}>
                          สลิปถูกปฏิเสธ — รอหลักฐานใหม่
                        </span>
                      ) : fin?.is_deposit ? (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#d97706', fontWeight: 800 }}>
                          มัดจำ
                        </span>
                      ) : fin?.is_reviewing ? (
                        (b.payment_status === 'unpaid' && b.slip_image_url) ? (
                          <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#d97706', border: '1px solid rgba(245, 158, 11, 0.35)', fontWeight: 800 }}>
                            หลักฐานรอตรวจสอบ
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', fontWeight: 800 }}>
                            รอตรวจสลิป
                          </span>
                        )
                      ) : fin?.is_pending ? (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(225, 29, 72, 0.12)', color: '#e11d48', fontWeight: 800 }}>
                          รอชำระ
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', fontWeight: 800 }}>
                          ชำระแล้ว
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Customer & Type */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.85rem' }}>
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{b.customer_name || '-'}</span>
                      {b.contact && <span style={{ color: 'var(--text-muted)', marginLeft: '8px', fontSize: '0.78rem' }}>{b.contact}</span>}
                    </div>
                    {cType === 'builtland' ? (
                      <span style={{ fontSize: '0.68rem', color: '#d97706', fontWeight: 700 }}>Builtland</span>
                    ) : cType === 'basecamp' ? (
                      <span style={{ fontSize: '0.68rem', color: '#9333ea', fontWeight: 700 }}>Basecamp</span>
                    ) : (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>ทั่วไป</span>
                    )}
                  </div>

                  {/* Row 3: Room & Usage */}
                  <div style={{ padding: '8px 10px', borderRadius: '10px', backgroundColor: 'var(--bg-hover)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{roomName}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      <span>{usage.dateStr}</span>
                      {usage.timeStr ? <span>{usage.timeStr}</span> : null}
                    </div>
                  </div>

                  {/* Row 4: Amount & Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px dashed var(--border-color)' }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {b.payment_method === 'hour_credit' ? 'เครดิตชั่วโมง' : b.payment_method === 'cash' ? '💵 เงินสด' : b.payment_method === 'transfer' ? '📱 โอนเงิน' : (b.payment_method || '-')}
                      </div>
                      <div style={{ fontWeight: 850, color: 'var(--primary-color)', fontSize: '1rem' }}>
                        ฿{Number(fin ? fin.total_amount : (b.total_amount || 0)).toLocaleString()}
                      </div>
                      {fin?.is_deposit ? (
                        <div style={{ fontSize: '0.68rem', lineHeight: 1.25, marginTop: '2px' }}>
                          <span style={{ color: '#10b981', fontWeight: 700 }}>ชำระ: ฿{fin.paid_amount.toLocaleString()}</span>
                          <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>·</span>
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>ค้าง: ฿{fin.balance_amount.toLocaleString()}</span>
                        </div>
                      ) : fin && fin.is_collectible && fin.balance_amount > 0 ? (
                        <div style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 600, marginTop: '2px' }}>
                          ค้างชำระ: ฿{fin.balance_amount.toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {b.slip_image_url && b.slip_image_url !== 'uploaded' && (
                        <button
                          type="button"
                          onClick={() => setViewingSlipBooking(b)}
                          style={{ padding: '5px 8px', borderRadius: '8px', border: '1px solid rgba(14, 165, 233, 0.3)', background: 'rgba(14, 165, 233, 0.1)', color: '#0284c7', fontSize: '0.75rem', fontWeight: 700 }}
                        >
                          สลิป
                        </button>
                      )}
                      {b.tax_invoice_required === 1 && (
                        <button
                          type="button"
                          onClick={() => setSelectedTaxBooking(b)}
                          style={{ padding: '5px 8px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)', background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb', fontSize: '0.75rem', fontWeight: 700 }}
                        >
                          ภาษี
                        </button>
                      )}
                      {isCancelled || b.payment_status === 'internal_free' ? (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            backgroundColor: 'var(--bg-hover)',
                            borderColor: 'var(--border-color)',
                            color: 'var(--text-muted)',
                            padding: '5px 11px',
                            fontSize: '0.76rem',
                            borderRadius: '8px',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            border: '1px solid var(--border-color)'
                          }}
                          onClick={() => openBookingDetails(b.id)}
                        >
                          ดูรายละเอียด
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            borderColor: 'rgba(16, 185, 129, 0.3)',
                            color: '#10b981',
                            padding: '5px 11px',
                            fontSize: '0.76rem',
                            borderRadius: '8px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            cursor: 'pointer'
                          }}
                          onClick={() => openBookingDetails(b.id)}
                        >
                          ใบเสร็จ
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          padding: '5px 7px',
                          fontSize: '0.76rem',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: activeActionMenuBooking?.id === b.id ? 'var(--primary-color)' : 'var(--bg-hover)',
                          color: activeActionMenuBooking?.id === b.id ? '#ffffff' : 'var(--text-muted)',
                          cursor: 'pointer'
                        }}
                        onClick={(e) => handleToggleActionMenu(e, b)}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Bar */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              borderTop: '1px solid var(--border-color)',
              backgroundColor: 'rgba(255, 255, 255, 0.01)',
              flexWrap: 'wrap',
              gap: '8px'
            }} className="no-print">
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                หน้า <strong>{currentPage}</strong> จาก <strong>{totalPages}</strong> (ทั้งหมด {totalRows} รายการ)
              </div>

              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  style={{ padding: '3px 8px', fontSize: '0.76rem', borderRadius: '6px' }}
                >
                  ก่อนหน้า
                </button>

                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let p = i + 1;
                  if (totalPages > 5) {
                    if (currentPage > 3) p = currentPage - 3 + i;
                    if (p > totalPages) p = totalPages - 4 + i;
                  }
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCurrentPage(p)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.76rem',
                        borderRadius: '6px',
                        border: currentPage === p ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                        backgroundColor: currentPage === p ? 'var(--primary-color)' : 'var(--bg-card)',
                        color: currentPage === p ? '#ffffff' : 'var(--text-main)',
                        fontWeight: currentPage === p ? 800 : 600,
                        cursor: 'pointer'
                      }}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  style={{ padding: '3px 8px', fontSize: '0.76rem', borderRadius: '6px' }}
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Action Menu for Table Row */}
      {activeActionMenuBooking && actionMenuPos && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }}
            onClick={() => { setActiveActionMenuBooking(null); setActionMenuPos(null); }}
          />
          <div
            style={{
              position: 'fixed',
              top: actionMenuPos.top !== undefined ? `${actionMenuPos.top}px` : undefined,
              bottom: actionMenuPos.bottom !== undefined ? `${actionMenuPos.bottom}px` : undefined,
              right: `${actionMenuPos.right}px`,
              minWidth: '220px',
              zIndex: 9999,
              borderRadius: '12px',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              textAlign: 'left',
              boxShadow: '0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px var(--border-color)',
              animation: 'fadeIn 0.12s ease-out',
              backgroundColor: 'var(--bg-card)'
            }}
          >
            <div style={{ padding: '6px 12px 4px 12px', fontSize: '0.68rem', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              การจัดการขั้นสูง ({activeActionMenuBooking.receipt_number || ('#' + activeActionMenuBooking.id)})
            </div>

            {/* Hard Delete (stays only in More (...) danger zone) */}
            <div
              onClick={(e) => {
                const b = activeActionMenuBooking;
                setActiveActionMenuBooking(null);
                setActionMenuPos(null);
                handleDeleteBooking(b.id, b.customer_name, b.receipt_number, e);
              }}
              className="action-menu-item action-menu-danger"
              style={{ color: '#dc2626', fontWeight: 700 }}
            >
              <Trash2 size={14} />
              <span>ลบรายการออกจากระบบถาวร</span>
            </div>
          </div>
        </>
      )}

      {/* Booking Details and Print Modal Overlay (Split Studio Preview) */}
      {showDetailsModal && selectedBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(24px) saturate(200%)',
          WebkitBackdropFilter: 'blur(24px) saturate(200%)',
          display: 'flex',
          zIndex: 9999,
          overflowY: 'auto',
          padding: '24px'
        }} className="print-modal-overlay">
          <div className="history-modal-container" style={{
            display: 'flex',
            maxWidth: '920px',
            width: '100%',
            backgroundColor: 'var(--bg-card)',
            margin: 'auto',
            borderRadius: '28px',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            animation: 'fadeIn 0.25s ease-out'
          }}>
            {/* Left side detail control and updates */}
            <div style={{ flex: 1.1, padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }} className="no-print">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {selectedBooking.payment_status === 'cancelled'
                      ? 'ประวัติการทำรายการ (ยกเลิก)'
                      : selectedBooking.payment_status === 'internal_free'
                      ? 'ประวัติการทำรายการ (สิทธิ์ภายใน)'
                      : 'ประวัติการทำรายการ'}
                  </div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 850, margin: 0, color: 'var(--text-main)' }}>
                    {selectedBooking.payment_status === 'cancelled'
                      ? `รายละเอียดการจอง (ยกเลิกแล้ว) #${selectedBooking.id}`
                      : selectedBooking.payment_status === 'internal_free'
                      ? `บันทึกการใช้บริการ ${selectedBooking.receipt_number || `#${String(selectedBooking.id).padStart(6, '0')}`}`
                      : `ใบเสร็จรับเงิน ${selectedBooking.receipt_number || `#${String(selectedBooking.id).padStart(6, '0')}`}`}
                  </h2>
                </div>
                <button
                  type="button"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setShowDetailsModal(false)}
                  title="ปิดหน้าต่าง"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Status Display */}
              {selectedBooking.payment_status === 'cancelled' ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  color: '#ef4444',
                  fontWeight: '700',
                  fontSize: '0.875rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  padding: '14px 18px',
                  borderRadius: '16px',
                  border: '1px solid rgba(239, 68, 68, 0.25)'
                }}>
                  <Ban size={20} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>รายการนี้ถูกยกเลิกแล้ว (Cancelled)</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      การจองนี้ถูกยกเลิกแล้ว ไม่มียอดค้างชำระและไม่มีการออกใบเสร็จรับเงิน
                    </span>
                  </div>
                </div>
              ) : (selectedBooking.payment_status === 'rejected' || selectedBooking.slip_verify_status === 'rejected') ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  color: '#dc2626',
                  fontWeight: '700',
                  fontSize: '0.875rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  padding: '14px 18px',
                  borderRadius: '16px',
                  border: '1px solid rgba(239, 68, 68, 0.25)'
                }}>
                  <AlertCircle size={20} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span>สลิปถูกปฏิเสธ — รอหลักฐานใหม่</span>
                    {selectedBooking.rejection_reason && (
                      <span style={{ fontSize: '0.8rem', color: '#991b1b', fontWeight: 600 }}>
                        <strong>เหตุผล:</strong> {selectedBooking.rejection_reason}
                      </span>
                    )}
                    {selectedBooking.rejection_time && (
                      <span style={{ fontSize: '0.72rem', color: '#7f1d1d' }}>
                        เวลาที่ปฏิเสธ: {formatTransactionDateTime(selectedBooking.rejection_time)}
                      </span>
                    )}
                  </div>
                </div>
              ) : selectedBooking.payment_status === 'internal_free' ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  color: '#ea580c',
                  fontWeight: '700',
                  fontSize: '0.875rem',
                  backgroundColor: 'rgba(249, 115, 22, 0.12)',
                  padding: '14px 18px',
                  borderRadius: '16px',
                  border: '1px solid rgba(249, 115, 22, 0.25)'
                }}>
                  <CheckCircle2 size={20} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>บันทึกการใช้บริการสิทธิ์ภายใน (ฟรี / โควต้า)</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      {Number(selectedBooking.quota_hours_used) > 0 ? `หักโควต้า ${selectedBooking.quota_hours_used} ชั่วโมง` : 'สิทธิ์พนักงาน / สมาชิกองค์กร'}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  color: 'var(--success-color)',
                  fontWeight: '700',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--success-bg)',
                  padding: '14px 18px',
                  borderRadius: '16px',
                  border: '1px solid rgba(34, 197, 94, 0.2)'
                }}>
                  <CheckCircle2 size={20} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span>ชำระเงินเสร็จสิ้นแล้ว</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                      ช่องทางชำระ: {selectedBooking.payment_method === 'hour_credit' ? 'เครดิตชั่วโมง' : selectedBooking.payment_method === 'cash' ? 'เงินสด (Cash)' : 'โอนเงินเข้าบัญชี (Transfer)'}
                    </span>
                  </div>
                </div>
              )}

              {/* Summary breakdown card */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'var(--bg-hover)', padding: '16px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>ลูกค้า:</span>
                  <strong style={{ color: 'var(--text-main)' }}>{selectedBooking.customer_name}</strong>
                </div>
                {selectedBooking.customer_type && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>ประเภทลูกค้า:</span>
                    <strong style={{ color: selectedBooking.customer_type === 'builtland' ? '#fb923c' : selectedBooking.customer_type === 'basecamp' ? '#c084fc' : selectedBooking.customer_type === 'shop' ? '#10b981' : '#60a5fa' }}>
                      {selectedBooking.customer_type === 'builtland' ? 'พนักงาน Builtland' :
                       selectedBooking.customer_type === 'basecamp' ? `ผู้เช่า Basecamp (${selectedBooking.basecamp_sub_type === 'hotdesk' ? 'Hotdesk ' : 'Office '}${selectedBooking.basecamp_unit || ''})` :
                       selectedBooking.customer_type === 'shop' ? 'ร้านค้าพันธมิตร (Shop)' :
                       selectedBooking.customer_type === 'online' ? 'จองออนไลน์' : 'ลูกค้า Walk-in'}
                    </strong>
                  </div>
                )}
                {Number(selectedBooking.quota_hours_used) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>โควต้าฟรีที่ใช้:</span>
                    <strong style={{ color: '#10b981' }}>{selectedBooking.quota_hours_used} ชั่วโมง (ฟรี)</strong>
                  </div>
                )}
                {selectedBooking.customer_type === 'basecamp' && (
                  <div style={{
                    marginTop: '4px',
                    padding: '12px 14px',
                    backgroundColor: 'rgba(168, 85, 247, 0.05)',
                    borderRadius: '14px',
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.80rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        โควตาการใช้งานห้องประชุม
                      </span>
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: '#9333ea',
                        background: 'rgba(168, 85, 247, 0.12)',
                        padding: '2px 6px',
                        borderRadius: '999px',
                        border: '1px solid rgba(168, 85, 247, 0.25)'
                      }}>
                        Basecamp Quota
                      </span>
                    </div>

                    {basecampQuotaLoading && !basecampQuota && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '6px' }}>
                        กำลังโหลดข้อมูลโควตา...
                      </div>
                    )}

                    {!basecampQuotaLoading && basecampQuotaError && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger-color)' }}>
                        {basecampQuotaError === 'missing_unit'
                          ? 'ไม่พบข้อมูลยูนิต Basecamp ในรายการจองนี้'
                          : 'ไม่สามารถโหลดข้อมูลโควตาได้'}
                      </div>
                    )}

                    {basecampQuota && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', textAlign: 'center' }}>
                        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>ทั้งหมด</div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>{basecampQuota.max_quota} ชม.</div>
                        </div>
                        <div style={{ backgroundColor: 'var(--bg-card)', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>ใช้ไปแล้ว</div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>{basecampQuota.used_quota} ชม.</div>
                        </div>
                        <div style={{
                          backgroundColor: basecampQuota.remaining_quota === 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: `1px solid ${basecampQuota.remaining_quota === 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`
                        }}>
                          <div style={{ fontSize: '0.68rem', color: basecampQuota.remaining_quota === 0 ? '#ef4444' : '#16a34a', fontWeight: 600 }}>คงเหลือ</div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 800, color: basecampQuota.remaining_quota === 0 ? '#dc2626' : '#15803d' }}>{basecampQuota.remaining_quota} ชม.</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {selectedBooking.customer_type === 'shop' && (
                  <div style={{
                    marginTop: '4px',
                    padding: '12px 14px',
                    backgroundColor: 'rgba(5, 150, 105, 0.05)',
                    borderRadius: '14px',
                    border: '1px solid rgba(5, 150, 105, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.80rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        สิทธิ์โควตาร้านค้าพันธมิตร (Shop)
                      </span>
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: '#059669',
                        background: 'rgba(5, 150, 105, 0.12)',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: '1px solid rgba(5, 150, 105, 0.25)'
                      }}>
                        4 ชม./เดือน
                      </span>
                    </div>
                    {Number(selectedBooking.quota_hours_used) > 0 && (
                      <div style={{ fontSize: '0.78rem', color: '#059669', fontWeight: 600 }}>
                        การจองนี้ตัดโควตา: {selectedBooking.quota_hours_used} ชั่วโมง
                      </div>
                    )}
                  </div>
                )}
                {selectedBooking.contact && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>เบอร์ติดต่อ:</span>
                    <strong style={{ color: 'var(--text-main)' }}>{selectedBooking.contact}</strong>
                  </div>
                )}
                {selectedBooking.guest_count && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>จำนวนผู้เข้าใช้:</span>
                    <strong style={{ color: 'var(--text-main)' }}>{selectedBooking.guest_count} ท่าน</strong>
                  </div>
                )}
                {(() => {
                  const fin = normalizeBookingFinancials(selectedBooking);
                  return (
                    <>
                      {fin && fin.discount_amount > 0 && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--text-muted)' }}>ยอดรวมก่อนส่วนลด:</span>
                            <strong style={{ color: 'var(--text-main)' }}>
                              ฿{fin.subtotal_amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--text-muted)' }}>ส่วนลด{fin.discount_type === 'percent' && fin.discount_value > 0 ? ` (${fin.discount_value}%)` : ''}:</span>
                            <strong style={{ color: '#ef4444' }}>
                              -฿{fin.discount_amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </strong>
                          </div>
                        </>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>ยอดสุทธิ:</span>
                        <strong style={{ color: 'var(--primary-color)', fontSize: '1rem', fontWeight: 800 }}>
                          ฿{(fin ? fin.total_amount : Number(selectedBooking.total_amount || 0)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{fin?.is_deposit ? 'มัดจำ/ชำระแล้ว:' : 'ชำระแล้ว:'}</span>
                        <strong style={{ color: '#16a34a', fontWeight: 800 }}>
                          ฿{(fin ? fin.paid_amount : (selectedBooking.payment_status === 'paid' ? Number(selectedBooking.total_amount || 0) : 0)).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>ยอดคงเหลือ:</span>
                        <strong style={{ color: fin && fin.balance_amount > 0 ? '#f59e0b' : 'var(--text-muted)', fontWeight: 800 }}>
                          ฿{(fin ? fin.balance_amount : 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                      </div>
                    </>
                  );
                })()}

                {/* Payment Transactions & Historical Evidence (P3) */}
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <FileText size={13} style={{ color: 'var(--primary-color)' }} /> รายการธุรกรรมและหลักฐานสลิป:
                    </span>
                    {isLoadingPayments && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>กำลังโหลด...</span>
                    )}
                  </div>

                  {paymentTransactions && paymentTransactions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {paymentTransactions.map((tx) => (
                        <div
                          key={tx.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: 'var(--bg-hover)',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.78rem'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{getTransactionTypeLabel ? getTransactionTypeLabel(tx.transaction_type) : tx.transaction_type}</span>
                              <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(37, 99, 235, 0.12)', color: 'var(--primary-color)', fontWeight: 600 }}>
                                {getPaymentMethodLabel ? getPaymentMethodLabel(tx.payment_method) : tx.payment_method}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {formatTransactionDateTime(tx.payment_time || tx.created_at)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                            <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '0.86rem' }}>
                              +฿{formatMoney(tx.amount)}
                            </div>
                            {tx.receipt_number && (
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                #{tx.receipt_number}
                              </div>
                            )}
                            {tx.slip_url ? (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                  type="button"
                                  id={`history-btn-view-slip-tx-${tx.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewingSlipBooking({
                                      ...selectedBooking,
                                      slip_image_url: tx.slip_url,
                                      receipt_number: tx.receipt_number || selectedBooking.receipt_number,
                                      active_transaction_id: tx.id
                                    });
                                  }}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                    color: 'var(--primary-color)',
                                    border: '1px solid rgba(37, 99, 235, 0.25)',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <Eye size={10} />
                                  <span>ดูสลิป #{tx.id}</span>
                                </button>
                                <button
                                  type="button"
                                  id={`history-btn-reupload-slip-tx-${tx.id}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAttachSlipModalData({ booking: selectedBooking, transaction: tx });
                                  }}
                                  title="เปลี่ยนรูปสลิป"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '2px 7px',
                                    borderRadius: '6px',
                                    backgroundColor: 'var(--bg-card)',
                                    color: 'var(--text-muted)',
                                    border: '1px solid var(--border-color)',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                >
                                  <RefreshCw size={9} />
                                  <span>เปลี่ยน</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                id={`history-btn-attach-slip-tx-${tx.id}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAttachSlipModalData({ booking: selectedBooking, transaction: tx });
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                  color: '#2563eb',
                                  border: '1px solid rgba(37, 99, 235, 0.3)',
                                  fontSize: '0.7rem',
                                  fontWeight: 750,
                                  cursor: 'pointer'
                                }}
                              >
                                <Plus size={10} />
                                <span>แนบสลิป</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--bg-hover)',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.78rem'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <div>
                          <div style={{ fontWeight: 750, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <FileText size={13} style={{ color: 'var(--text-muted)' }} />
                            <span>ไม่พบรายการธุรกรรมการชำระเงินแยกสำหรับการจองนี้</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px', lineHeight: '1.4' }}>
                            {selectedBooking.payment_status === 'paid' || Number(selectedBooking.paid_amount) > 0 ? (
                              <span>
                                ยอดชำระตามบันทึกเดิม: <strong>฿{formatMoney(selectedBooking.paid_amount)}</strong> ({getPaymentMethodLabel ? getPaymentMethodLabel(selectedBooking.payment_method) : selectedBooking.payment_method}) — สามารถแนบหลักฐานสลิปย้อนหลังเพื่อบันทึกประวัติได้
                              </span>
                            ) : selectedBooking.payment_status === 'unpaid' ? (
                              <span>
                                สถานะการจองเดิม: <strong>ยังไม่ชำระเงิน (Unpaid)</strong> — การแนบสลิปย้อนหลังเป็นการบันทึกเอกสารหลักฐาน จะไม่เปลี่ยนแปลงยอดรับชำระหรือสถานะการเงิน
                              </span>
                            ) : (
                              <span>
                                สถานะการจอง: <strong>{selectedBooking.payment_status}</strong> — สามารถแนบหรือดูหลักฐานสลิปเดิมได้เพื่อการตรวจสอบย้อนหลัง
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0 }}>
                          {selectedBooking.slip_image_url && selectedBooking.slip_image_url !== 'uploaded' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              {selectedBooking.payment_status === 'unpaid' && (
                                <span
                                  id="history-badge-legacy-slip-unpaid"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                    color: '#d97706',
                                    border: '1px solid rgba(245, 158, 11, 0.35)',
                                    fontSize: '0.72rem',
                                    fontWeight: 750
                                  }}
                                >
                                  <Clock size={11} />
                                  <span>หลักฐานรอตรวจสอบ</span>
                                </span>
                              )}
                              <button
                                type="button"
                                id="history-btn-view-legacy-slip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingSlipBooking(selectedBooking);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                  color: 'var(--primary-color)',
                                  border: '1px solid rgba(37, 99, 235, 0.25)',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                <Eye size={11} />
                                <span>ดูสลิป</span>
                              </button>
                              <button
                                type="button"
                                id="history-btn-reupload-legacy-slip"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAttachSlipModalData({ booking: selectedBooking, transaction: null });
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  backgroundColor: 'var(--bg-card)',
                                  color: 'var(--text-muted)',
                                  border: '1px solid var(--border-color)',
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                <RefreshCw size={10} />
                                <span>เปลี่ยนสลิป</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              id="history-btn-attach-legacy-slip"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttachSlipModalData({ booking: selectedBooking, transaction: null });
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 10px',
                                borderRadius: '6px',
                                backgroundColor: '#2563eb',
                                color: '#ffffff',
                                border: 'none',
                                fontSize: '0.72rem',
                                fontWeight: 750,
                                cursor: 'pointer'
                              }}
                            >
                              <Plus size={11} />
                              <span>แนบสลิปย้อนหลัง</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {selectedBooking.slip_image_url && selectedBooking.slip_image_url !== 'uploaded' && (
                        <div style={{ marginTop: '8px', textAlign: 'center', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                          <a href={selectedBooking.slip_image_url} target="_blank" rel="noreferrer" title="คลิกเพื่อดูรูปสลิปขนาดเต็ม">
                            <img
                              src={selectedBooking.slip_image_url}
                              alt="สลิปการชำระเงิน"
                              style={{ maxHeight: '120px', maxWidth: '100%', borderRadius: '6px', border: '1px solid var(--border-color)', objectFit: 'contain' }}
                            />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Dedicated Tax Invoice Card */}
              <div style={{
                borderRadius: '16px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={18} style={{ color: '#2563eb' }} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      ข้อมูลและเอกสารใบกำกับภาษี
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    backgroundColor: selectedBooking.tax_invoice_status === 'issued' ? 'rgba(16, 185, 129, 0.12)' : (selectedBooking.tax_invoice_required === 1 ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-hover)'),
                    color: selectedBooking.tax_invoice_status === 'issued' ? '#10b981' : (selectedBooking.tax_invoice_required === 1 ? '#2563eb' : 'var(--text-muted)')
                  }}>
                    {selectedBooking.tax_invoice_status === 'issued' ? 'ออกเอกสารแล้ว' : (selectedBooking.tax_invoice_required === 1 ? 'ขอใบกำกับภาษี' : 'ยังไม่ขอ')}
                  </span>
                </div>

                {selectedBooking.tax_invoice_required === 1 || selectedBooking.tax_name ? (
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-main)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    backgroundColor: 'var(--bg-main)',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div><strong>ชื่อผู้เสียภาษี:</strong> {selectedBooking.tax_name || '-'}</div>
                    <div><strong>เลขประจำตัวผู้เสียภาษี:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{selectedBooking.tax_id || '-'}</span> ({selectedBooking.tax_branch === 'branch' ? `สาขา ${selectedBooking.tax_branch_number || ''}` : 'สำนักงานใหญ่'})</div>
                    {selectedBooking.tax_address && (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>
                        <strong>ที่อยู่:</strong> {selectedBooking.tax_address}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    backgroundColor: 'var(--bg-main)',
                    padding: '12px',
                    borderRadius: '10px',
                    border: '1px dashed var(--border-color)',
                    textAlign: 'center'
                  }}>
                    ยังไม่ได้ขอใบกำกับภาษีสำหรับรายการนี้ สามารถกดจัดการเพื่อบันทึกข้อมูลภาษีได้
                  </div>
                )}

                <button
                  type="button"
                  id="history-btn-manage-tax-invoice"
                  onClick={() => setSelectedTaxBooking(selectedBooking)}
                  style={{
                    width: '100%',
                    height: '38px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(37, 99, 235, 0.08)',
                    border: '1px solid rgba(37, 99, 235, 0.3)',
                    color: '#2563eb',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                >
                  <FileText size={16} />
                  <span>จัดการใบกำกับภาษี</span>
                </button>
              </div>

              {/* Booking Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
                {selectedBooking.payment_status === 'cancelled' ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '12px',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    backgroundColor: 'var(--bg-hover)',
                    borderRadius: '14px',
                    border: '1px dashed var(--border-color)'
                  }}>
                    รายการนี้ถูกยกเลิกแล้ว จึงไม่มีการพิมพ์หรือส่งออกใบเสร็จรับเงิน
                  </div>
                ) : (
                  <>
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%', padding: '12px', gap: '8px', borderRadius: '14px', backgroundColor: '#e2e8f0', color: '#1e293b', fontWeight: 'bold' }}
                      onClick={handleDownloadPDF}
                    >
                      <FileText size={18} /> บันทึกสลิปเป็นไฟล์ PDF
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '12px', gap: '8px', borderRadius: '14px', fontWeight: 800 }}
                      onClick={triggerPrint}
                    >
                      <Printer size={18} /> พิมพ์ใบเสร็จออกเครื่องพิมพ์
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Right side live print preview receipt layout */}
            <div className="history-receipt-column" style={{
              width: '420px',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              padding: '32px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderLeft: '1px solid var(--border-color)',
              position: 'relative'
            }}>
              <div className="no-print" style={{
                fontSize: '0.75rem',
                color: 'rgba(255, 255, 255, 0.65)',
                fontWeight: 700,
                marginBottom: '14px',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Eye size={14} /> ตัวอย่างสลิปใบเสร็จรับเงิน (Thermal Slip Preview)
              </div>
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '18px',
                padding: '18px',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15)',
                width: '100%',
                maxWidth: '375px',
                display: 'flex',
                justifyContent: 'center',
                position: 'relative',
                opacity: selectedBooking.payment_status === 'cancelled' ? 0.7 : 1
              }}>
                {selectedBooking.payment_status === 'cancelled' && (
                  <div style={{
                    position: 'absolute',
                    top: '40%',
                    left: '50%',
                    transform: 'translate(-50%, -50%) rotate(-20deg)',
                    padding: '10px 20px',
                    border: '3px solid #ef4444',
                    borderRadius: '10px',
                    color: '#ef4444',
                    fontSize: '1.2rem',
                    fontWeight: 900,
                    letterSpacing: '2px',
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                    pointerEvents: 'none',
                    zIndex: 10,
                    whiteSpace: 'nowrap'
                  }}>
                    ยกเลิกแล้ว / CANCELLED
                  </div>
                )}
                <ReceiptPrint booking={selectedBooking} settings={settings} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ATTACH SLIP MODAL (HISTORICAL / LEGACY SLIP ATTACHMENT) */}
      {attachSlipModalData && (
        <AttachSlipModal
          isOpen={!!attachSlipModalData}
          booking={attachSlipModalData.booking}
          targetTransaction={attachSlipModalData.transaction}
          onClose={() => setAttachSlipModalData(null)}
          onSuccess={(resData) => {
            const bId = attachSlipModalData.booking?.id;
            if (bId) {
              fetchPaymentTransactions(bId);
              setSelectedBooking(prev => prev ? ({ ...prev, slip_image_url: resData.slip_url }) : prev);
              fetchHistoryBookings(true);
            }
          }}
          sysAlert={sysAlert}
        />
      )}

      {/* TAX INVOICE MANAGEMENT MODAL (PHASE 3 & 4) */}
      {selectedTaxBooking && (
        <TaxInvoiceManagementModal
          booking={selectedTaxBooking}
          onClose={() => { setSelectedTaxBooking(null); setTaxCopied(false); }}
          onUpdated={() => fetchHistoryBookings(true)}
          sysAlert={sysAlert}
        />
      )}

      {/* SLIP VIEWER MODAL (ดูสลิปย้อนหลัง) */}
      {viewingSlipBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '16px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '520px',
            padding: '24px',
            borderRadius: '24px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            animation: 'scaleUp 0.2s ease-out'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(14, 165, 233, 0.15)',
                  color: '#0ea5e9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Eye size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                    สลิปการโอนเงินย้อนหลัง
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    ใบเสร็จ #{viewingSlipBooking.receipt_number || viewingSlipBooking.id} · ผู้จอง: {viewingSlipBooking.customer_name || '-'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onClick={() => setViewingSlipBooking(null)}
                title="ปิดหน้าต่าง"
              >
                <X size={18} />
              </button>
            </div>

            {/* Multiple Transaction Slips Selector (P3) */}
            {paymentTransactions && paymentTransactions.filter(t => t.slip_url).length > 1 && (
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                {paymentTransactions.filter(t => t.slip_url).map((tx, idx) => {
                  const isActive = viewingSlipBooking.slip_image_url === tx.slip_url;
                  return (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => setViewingSlipBooking(prev => ({
                        ...prev,
                        slip_image_url: tx.slip_url,
                        receipt_number: tx.receipt_number || prev.receipt_number,
                        active_transaction_id: tx.id
                      }))}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '8px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        backgroundColor: isActive ? 'var(--primary-color)' : 'var(--bg-hover)',
                        color: isActive ? '#ffffff' : 'var(--text-main)',
                        border: '1px solid ' + (isActive ? 'var(--primary-color)' : 'var(--border-color)'),
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      สลิป #{idx + 1} (+฿{formatMoney(tx.amount)})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Slip Image Container */}
            <div style={{
              textAlign: 'center',
              padding: '12px',
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              borderRadius: '14px',
              border: '1px solid var(--border-color)'
            }}>
              {viewingSlipBooking.slip_image_url && viewingSlipBooking.slip_image_url !== 'uploaded' ? (
                <>
                  <a href={viewingSlipBooking.slip_image_url} target="_blank" rel="noreferrer" title="คลิกเพื่อเปิดดูรูปสลิปขนาดเต็มในแท็บใหม่">
                    <img
                      src={viewingSlipBooking.slip_image_url}
                      alt="สลิปการชำระเงิน"
                      style={{
                        maxHeight: '380px',
                        maxWidth: '100%',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        objectFit: 'contain',
                        cursor: 'zoom-in',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
                      }}
                    />
                  </a>
                  <div style={{ marginTop: '10px' }}>
                    <a
                      href={viewingSlipBooking.slip_image_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        color: 'var(--primary-color)',
                        textDecoration: 'none',
                        padding: '4px 12px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(14, 165, 233, 0.1)'
                      }}
                    >
                      <ExternalLink size={14} />
                      <span>เปิดดูรูปภาพสลิปขนาดเต็ม (Full Resolution)</span>
                    </a>
                  </div>
                </>
              ) : (
                <div style={{ padding: '30px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  ไม่มีรูปภาพสลิปที่แนบมา
                </div>
              )}
            </div>

            {/* Summary Details */}
            <div style={{
              padding: '12px 16px',
              borderRadius: '12px',
              backgroundColor: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              fontSize: '0.82rem'
            }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ยอดชำระ:</span>{' '}
                <strong style={{ color: '#10b981' }}>
                  ฿{Number(viewingSlipBooking.total_amount || 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Ref โอนเงิน:</span>{' '}
                <strong style={{ color: 'var(--text-main)', fontFamily: 'monospace' }}>
                  {viewingSlipBooking.slip_trans_ref || '-'}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>เบอร์ติดต่อ:</span>{' '}
                <span>{viewingSlipBooking.contact || '-'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ช่องทาง:</span>{' '}
                <span>{viewingSlipBooking.customer_type === 'online' || viewingSlipBooking.booking_source === 'online' ? 'LINE OA' : 'Walk-in'}</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', padding: '10px', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem' }}
                onClick={() => setViewingSlipBooking(null)}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DASHBOARD EXPORT MODAL */}
      {showExportModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 12000,
            padding: '16px'
          }}
          onClick={() => setShowExportModal(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-card)',
              borderRadius: '20px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: '24px',
              border: '1px solid var(--border-color)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileSpreadsheet size={22} style={{ color: 'var(--primary-color)' }} />
                  Export สำหรับ Dashboard
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  เลือกช่วงวันที่และประเภทลูกค้า เพื่อส่งออกข้อมูลสำหรับบันทึกในระบบ Dashboard
                </p>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setShowExportModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '4px',
                  borderRadius: '8px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Section A: Date Range */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={15} style={{ color: 'var(--primary-color)' }} />
                    ช่วงวันที่เข้าใช้บริการ (Service Date) <span style={{ color: 'var(--danger-color)' }}>*</span>
                  </label>
                  {/* Quick Preset Buttons */}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const today = getTodayBangkokDate();
                        setExportStartDate(today);
                        setExportEndDate(today);
                      }}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.74rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: exportStartDate === getTodayBangkokDate() && exportEndDate === getTodayBangkokDate() ? 'var(--primary-light)' : 'transparent',
                        color: exportStartDate === getTodayBangkokDate() && exportEndDate === getTodayBangkokDate() ? 'var(--primary-color)' : 'var(--text-muted)',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      วันนี้
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const today = getTodayBangkokDate();
                        const past7 = getDateOffsetBangkok(-6);
                        setExportStartDate(past7);
                        setExportEndDate(today);
                      }}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.74rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: exportStartDate === getDateOffsetBangkok(-6) && exportEndDate === getTodayBangkokDate() ? 'var(--primary-light)' : 'transparent',
                        color: exportStartDate === getDateOffsetBangkok(-6) && exportEndDate === getTodayBangkokDate() ? 'var(--primary-color)' : 'var(--text-muted)',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      7 วันล่าสุด
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const today = getTodayBangkokDate();
                        const startMonth = getStartOfMonthBangkok();
                        setExportStartDate(startMonth);
                        setExportEndDate(today);
                      }}
                      style={{
                        padding: '3px 8px',
                        fontSize: '0.74rem',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        background: exportStartDate === getStartOfMonthBangkok() && exportEndDate === getTodayBangkokDate() ? 'var(--primary-light)' : 'transparent',
                        color: exportStartDate === getStartOfMonthBangkok() && exportEndDate === getTodayBangkokDate() ? 'var(--primary-color)' : 'var(--text-muted)',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      เดือนนี้
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      วันที่เริ่มต้น
                    </span>
                    <input
                      type="date"
                      className="form-control"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', fontSize: '0.88rem', borderRadius: '10px' }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                      วันที่สิ้นสุด
                    </span>
                    <input
                      type="date"
                      className="form-control"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: '0.88rem',
                        borderRadius: '10px',
                        borderColor: isInvalidDateRange ? 'var(--danger-color)' : undefined
                      }}
                    />
                  </div>
                </div>

                {isInvalidDateRange ? (
                  <div style={{
                    marginTop: '6px',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    color: '#dc2626',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <Ban size={14} />
                    <span>วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น</span>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    * กรองตามวันที่ลูกค้าเข้าใช้ห้องจริง (ไม่ใช่วันที่ทำรายการจอง)
                  </div>
                )}
              </div>

              {/* Section B: Customer Type */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>
                  ประเภทลูกค้า (Customer Type)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '6px' }}>
                  {EXPORT_CUSTOMER_TYPE_OPTIONS.map(opt => {
                    const isSelected = exportCustomerType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setExportCustomerType(opt.value)}
                        style={{
                          padding: '8px 6px',
                          borderRadius: '10px',
                          fontSize: '0.8rem',
                          fontWeight: isSelected ? 800 : 500,
                          border: isSelected ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
                          background: isSelected ? 'var(--primary-light)' : 'transparent',
                          color: isSelected ? 'var(--primary-color)' : 'var(--text-main)',
                          cursor: 'pointer',
                          textAlign: 'center',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                  * ลูกค้าทั่วไปจะรวมทั้งจองผ่าน LINE OA และ Walk-in แต่ไม่รวม บิลท์ แลนด์ และ ผู้เช่ารายเดือน
                </div>
              </div>
            </div>

            {/* Section C: Record Count Preview Card / Summary */}
            {(() => {
              const currentTypeLabel = EXPORT_CUSTOMER_TYPE_OPTIONS.find(o => o.value === exportCustomerType)?.label || 'ทั้งหมด';
              const dateRangeText = exportStartDate === exportEndDate
                ? formatExportDate(exportStartDate)
                : `${formatExportDate(exportStartDate)} - ${formatExportDate(exportEndDate)}`;

              if (isInvalidDateRange) {
                return (
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    color: '#dc2626',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <Ban size={16} />
                    <span>ช่วงวันที่ไม่ถูกต้อง: วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น</span>
                  </div>
                );
              }

              if (exportMatchingPairs.length === 0) {
                return (
                  <div style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    backgroundColor: 'var(--bg-hover)',
                    border: '1px dashed var(--border-color)',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      ไม่พบรายการในช่วงวันที่และประเภทลูกค้าที่เลือก
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ช่วงวันที่ {dateRangeText} • {currentTypeLabel}
                    </div>
                  </div>
                );
              }

              return (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  backgroundColor: 'var(--bg-hover)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      จำนวนรายการที่จะส่งออก:
                    </span>
                    <span style={{
                      fontSize: '0.95rem',
                      fontWeight: 800,
                      color: 'var(--primary-color)'
                    }}>
                      {exportMatchingPairs.length} รายการ (แยกรายห้อง)
                    </span>
                  </div>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    fontSize: '0.76rem',
                    color: 'var(--text-main)',
                    padding: '4px 0',
                    borderTop: '1px dashed var(--border-color)',
                    borderBottom: '1px dashed var(--border-color)'
                  }}>
                    <span><strong>ช่วงวันที่:</strong> {dateRangeText}</span>
                    <span>•</span>
                    <span><strong>ประเภทลูกค้า:</strong> {currentTypeLabel}</span>
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    • รูปแบบมาตรฐาน 19 คอลัมน์ (ตรงตาม Dashboard ภายนอก)<br />
                    • การใช้สิทธิ์เครดิตชั่วโมง (Hour Credit) จะระบุยอดรับจริงเป็น 0 บาท และวิธีชำระเป็น "เครดิตชั่วโมง"
                  </div>
                </div>
              );
            })()}

            {/* Copy Feedback Alert */}
            {copyFeedback && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: '#dcfce7',
                color: '#15803d',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <CheckCircle2 size={16} />
                <span>คัดลอกข้อมูลตาราง (TSV) เรียบร้อยแล้ว สามารถกด Paste (Ctrl+V) ลงสเปรดชีตได้ทันที</span>
              </div>
            )}

            {/* Action Buttons */}
            {(() => {
              const isExportDisabled = isInvalidDateRange || exportMatchingPairs.length === 0;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={isExportDisabled}
                      onClick={handleExportDashboardCsv}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        opacity: isExportDisabled ? 0.45 : 1,
                        cursor: isExportDisabled ? 'not-allowed' : 'pointer'
                      }}
                      title={isExportDisabled ? 'ไม่มีข้อมูลสำหรับส่งออก' : 'ดาวน์โหลดไฟล์ CSV พร้อม UTF-8 BOM สำหรับเปิดใน Excel'}
                    >
                      <Download size={16} />
                      <span>ดาวน์โหลด CSV</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={isExportDisabled}
                      onClick={handleExportDashboardXlsx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--bg-card)',
                        opacity: isExportDisabled ? 0.45 : 1,
                        cursor: isExportDisabled ? 'not-allowed' : 'pointer'
                      }}
                      title={isExportDisabled ? 'ไม่มีข้อมูลสำหรับส่งออก' : 'ดาวน์โหลดไฟล์ Microsoft Excel (.xlsx)'}
                    >
                      <FileSpreadsheet size={16} style={{ color: isExportDisabled ? 'var(--text-muted)' : '#10b981' }} />
                      <span>ดาวน์โหลด XLSX</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isExportDisabled}
                    onClick={handleCopyDashboardTsv}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '9px 14px',
                      borderRadius: '12px',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      border: '1px dashed var(--border-color)',
                      backgroundColor: 'transparent',
                      opacity: isExportDisabled ? 0.45 : 1,
                      cursor: isExportDisabled ? 'not-allowed' : 'pointer'
                    }}
                    title={isExportDisabled ? 'ไม่มีข้อมูลสำหรับส่งออก' : 'คัดลอกข้อมูลลงคลิปบอร์ดแบบ Tab-Separated สำหรับแปะลง Google Sheets หรือ Excel โดยตรง'}
                  >
                    <Copy size={15} />
                    <span>คัดลอกข้อมูล (สำหรับ Paste ลงตาราง)</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowExportModal(false)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '10px',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      marginTop: '4px',
                      border: 'none',
                      color: 'var(--text-muted)'
                    }}
                  >
                    ปิด
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryLog;
