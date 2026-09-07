import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
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
  User
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';
import { formatTransactionDateTime } from '../dateUtils';

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
  { key: 'cancelled', label: 'ยกเลิก' },
  { key: 'tax_invoice', label: 'ขอใบกำกับภาษี' }
];

function HistoryLog({ settings, sysAlert, sysConfirm }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

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
  const [selectedTaxBooking, setSelectedTaxBooking] = useState(null);
  const [viewingSlipBooking, setViewingSlipBooking] = useState(null);
  const [taxCopied, setTaxCopied] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

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

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings');
      if (res.ok) {
        const data = await res.json();
        setBookings(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    } finally {
      setLoading(false);
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

  const triggerPrint = () => {
    window.print();
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
  const paidCount = baseBookings.filter(b => b.payment_status === 'paid' || b.payment_status === 'internal_free').length;
  const cancelledCount = baseBookings.filter(b => b.payment_status === 'cancelled').length;
  const taxInvoiceCount = baseBookings.filter(b => b.tax_invoice_required === 1).length;
  const totalAmountPaid = baseBookings.reduce((sum, b) => sum + (b.payment_status === 'cancelled' ? 0 : Number(b.total_amount || 0)), 0);

  // 2. Final Filter with Status Quick Filter Tabs
  const filteredBookings = useMemo(() => {
    if (statusFilter === 'all') return baseBookings;
    if (statusFilter === 'paid') return baseBookings.filter(b => b.payment_status === 'paid' || b.payment_status === 'internal_free');
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

  // Export to genuine Excel (.xlsx) file
  const exportToExcel = () => {
    if (sortedBookings.length === 0) {
      if (sysAlert) sysAlert('ไม่มีข้อมูลสำหรับการส่งออก Excel');
      return;
    }

    const data = sortedBookings.map((b, idx) => {
      const usage = formatUsageDate(b);
      const usageDateStr = usage && usage.dateStr !== '-' ? usage.dateStr : '-';
      const usageTimeStr = usage && usage.timeStr ? usage.timeStr : '-';
      const roomName = (b.items?.[0]?.room_name || b.room_name || '-');
      const cType = b.customer_type || (b.booking_source === 'online' ? 'general' : 'walkin');
      const bChannel = b.booking_channel || (b.booking_source === 'online' ? 'line_oa' : 'pos_web');
      let source = 'POS (Walk-in)';
      if (cType === 'builtland') source = `Builtland (${b.internal_department || 'พนักงาน'})`;
      else if (cType === 'basecamp') source = `Basecamp (${b.basecamp_sub_type === 'hotdesk' ? 'Hotdesk ' : 'Office '}${b.basecamp_unit || ''})`;
      else if (cType === 'general' || bChannel === 'line_oa' || b.booking_source === 'online') source = 'LINE OA (ลูกค้าทั่วไป)';
      const status = b.payment_status === 'paid' ? 'สำเร็จ' : (b.payment_status === 'cancelled' ? 'ยกเลิก' : (b.payment_status || 'รอชำระ'));
      const method = b.payment_method === 'cash' ? 'เงินสด' : (b.payment_method === 'transfer' ? 'โอนเงิน' : (b.payment_method || '-'));
      const taxReq = b.tax_invoice_required === 1 ? 'ขอใบกำกับภาษี' : 'ไม่ขอ';

      return {
        'ลำดับ': idx + 1,
        'เลขที่ใบเสร็จ': b.receipt_number || `#${String(b.id).padStart(6, '0')}`,
        'วันที่ทำรายการ': formatDate(b.created_at),
        'วันที่ใช้งาน': usageDateStr,
        'เวลาที่ใช้งาน': usageTimeStr,
        'ห้อง/บริการ': roomName,
        'ช่องทางการจอง': source,
        'ชื่อผู้จอง': b.customer_name || '-',
        'เบอร์ติดต่อ': b.contact || '-',
        'หน่วยงาน/บริษัท': b.department || '-',
        'ยอดชำระสุทธิ (บาท)': Number(b.total_amount || 0),
        'สถานะการชำระ': status,
        'ช่องทางชำระเงิน': method,
        'ขอใบกำกับภาษี': taxReq,
        'ชื่อผู้เสียภาษี': b.tax_name || '-',
        'เลขประจำตัวผู้เสียภาษี': b.tax_id || '-',
        'ที่อยู่ใบกำกับภาษี': b.tax_address || '-',
        'ที่อยู่จัดส่งจดหมาย': b.tax_postal_address || '-'
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);

    worksheet['!cols'] = [
      { wch: 6 },  // ลำดับ
      { wch: 16 }, // เลขที่ใบเสร็จ
      { wch: 20 }, // วันที่ทำรายการ
      { wch: 16 }, // วันที่ใช้งาน
      { wch: 20 }, // เวลาที่ใช้งาน
      { wch: 24 }, // ห้อง/บริการ
      { wch: 14 }, // ช่องทาง
      { wch: 22 }, // ชื่อผู้จอง
      { wch: 14 }, // เบอร์ติดต่อ
      { wch: 22 }, // หน่วยงาน/บริษัท
      { wch: 16 }, // ยอดชำระสุทธิ
      { wch: 12 }, // สถานะ
      { wch: 14 }, // ช่องทางชำระ
      { wch: 14 }, // ขอใบกำกับภาษี
      { wch: 26 }, // ชื่อผู้เสียภาษี
      { wch: 18 }, // เลขผู้เสียภาษี
      { wch: 35 }, // ที่อยู่ภาษี
      { wch: 35 }  // ที่อยู่จัดส่ง
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ประวัติการใช้งาน');

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    XLSX.writeFile(workbook, `bwork_history_${dateStr}.xlsx`);
  };

  // Export to PDF Report (A4 Landscape)
  const exportToPDF = async () => {
    if (sortedBookings.length === 0) {
      if (sysAlert) sysAlert('ไม่มีข้อมูลสำหรับการส่งออก PDF');
      return;
    }

    if (!window.html2pdf) {
      if (sysAlert) sysAlert('ระบบพิมพ์ PDF ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง');
      return;
    }

    setIsExportingPdf(true);

    try {
      const element = document.getElementById('history-pdf-report-container');
      if (!element) {
        if (sysAlert) sysAlert('ไม่พบโครงสร้างรายงาน PDF');
        return;
      }

      element.style.display = 'block';

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

      const opt = {
        margin: [8, 8, 8, 8],
        filename: `bwork_history_report_${dateStr}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: false,
          scrollY: 0,
          logging: false
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };

      await window.html2pdf().from(element).set(opt).save();
    } catch (err) {
      console.error('PDF export error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการส่งออก PDF: ' + err.message);
    } finally {
      const element = document.getElementById('history-pdf-report-container');
      if (element) element.style.display = 'none';
      setIsExportingPdf(false);
    }
  };

  // Pagination Calculations
  const totalRows = sortedBookings.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;
  const indexOfLastRow = currentPage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
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
          {/* Export XLSX */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={exportToExcel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              padding: '7px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)'
            }}
            title="ส่งออกรายการทั้งหมดเป็นไฟล์ Excel (.xlsx)"
          >
            <FileSpreadsheet size={14} style={{ color: '#10b981' }} />
            <span>ส่งออก XLSX</span>
          </button>

          {/* Export PDF Report */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={exportToPDF}
            disabled={isExportingPdf}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              padding: '7px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)'
            }}
            title="พิมพ์รายงานสรุปรายรับลงแบบฟอร์ม A4 แนวนอน"
          >
            <FileText size={14} style={{ color: '#2563eb' }} />
            <span>{isExportingPdf ? 'กำลังส่งออก...' : 'รายงาน PDF'}</span>
          </button>

          {/* Refresh */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fetchBookings()}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              fontWeight: 600,
              padding: '7px 12px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)'
            }}
            title="โหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์"
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            <span>{loading ? 'กำลังโหลด...' : 'รีเฟรช'}</span>
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

        {/* Total Ledger Revenue Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '4px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรับรวม:</span>
          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--success-color)' }}>
            ฿{totalAmountPaid.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
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
      {loading ? (
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
                                  {isLine ? '📱 LINE OA' : '🏪 POS'}
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
                          return (
                            <td key={key} style={{ textAlign: 'right', padding: '6px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle', boxSizing: 'border-box' }}>
                              <div style={{ fontWeight: 800, color: 'var(--primary-color)', fontSize: '0.90rem' }}>
                                ฿{Number(b.total_amount || 0).toLocaleString()}
                              </div>
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
                                  {b.payment_method === 'cash' ? '💵 เงินสด' : b.payment_method === 'transfer' ? '📱 โอนเงิน' : (b.payment_method || '-')}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        // 5. สถานะ
                        if (key === 'payment_status') {
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
                                  <span>สำเร็จ</span>
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
                      ) : (
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#10b981', fontWeight: 800 }}>
                          สำเร็จ
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
                      <span>📅 {usage.dateStr}</span>
                      {usage.timeStr ? <span>⏰ {usage.timeStr}</span> : null}
                    </div>
                  </div>

                  {/* Row 4: Amount & Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px', borderTop: '1px dashed var(--border-color)' }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {b.payment_method === 'cash' ? '💵 เงินสด' : b.payment_method === 'transfer' ? '📱 โอนเงิน' : (b.payment_method || '-')}
                      </div>
                      <div style={{ fontWeight: 850, color: 'var(--primary-color)', fontSize: '1rem' }}>
                        ฿{Number(b.total_amount || 0).toLocaleString()}
                      </div>
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
                      ช่องทางชำระ: {selectedBooking.payment_method === 'cash' ? 'เงินสด (Cash)' : 'โอนเงินเข้าบัญชี (Transfer)'}
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
                    <strong style={{ color: selectedBooking.customer_type === 'builtland' ? '#fb923c' : selectedBooking.customer_type === 'basecamp' ? '#c084fc' : '#60a5fa' }}>
                      {selectedBooking.customer_type === 'builtland' ? 'พนักงาน Builtland' :
                       selectedBooking.customer_type === 'basecamp' ? `ผู้เช่า Basecamp (${selectedBooking.basecamp_sub_type === 'hotdesk' ? 'Hotdesk ' : 'Office '}${selectedBooking.basecamp_unit || ''})` :
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>ยอดรวมสุทธิ:</span>
                  <strong style={{ color: 'var(--primary-color)', fontSize: '1rem', fontWeight: 800 }}>
                    {Number(selectedBooking.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                  </strong>
                </div>

                {selectedBooking.slip_image_url && selectedBooking.slip_image_url !== 'uploaded' && (
                  <div style={{ marginTop: '4px', padding: '10px 12px', backgroundColor: 'rgba(14, 165, 233, 0.08)', borderRadius: '12px', border: '1px solid rgba(14, 165, 233, 0.25)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#0284c7', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Eye size={13} /> สลิปโอนเงินที่แนบมา:
                      </span>
                      {selectedBooking.slip_trans_ref && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          Ref: {selectedBooking.slip_trans_ref}
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <a href={selectedBooking.slip_image_url} target="_blank" rel="noreferrer" title="คลิกเพื่อดูรูปสลิปขนาดเต็ม">
                        <img
                          src={selectedBooking.slip_image_url}
                          alt="สลิปการชำระเงิน"
                          style={{ maxHeight: '130px', maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--border-color)', objectFit: 'contain', cursor: 'zoom-in', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                      </a>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <a
                        href={selectedBooking.slip_image_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: '0.76rem', color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <ExternalLink size={12} />
                        <span>เปิดดูรูปภาพสลิปขนาดเต็ม (Full Size)</span>
                      </a>
                    </div>
                  </div>
                )}
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
                    ⚠️ รายการนี้ถูกยกเลิกแล้ว จึงไม่มีการพิมพ์หรือส่งออกใบเสร็จรับเงิน
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

      {/* TAX INVOICE DETAILS & PRINT MODAL */}
      {selectedTaxBooking && (() => {
        const handleCopyAllTaxFields = () => {
          let lines = [];
          if (selectedTaxBooking.tax_name) lines.push(`ชื่อผู้เสียภาษี: ${selectedTaxBooking.tax_name}`);
          if (selectedTaxBooking.tax_id) lines.push(`เลขประจำตัวผู้เสียภาษี: ${selectedTaxBooking.tax_id}`);
          if (selectedTaxBooking.tax_address) lines.push(`ที่อยู่: ${selectedTaxBooking.tax_address}`);
          if (selectedTaxBooking.tax_phone || selectedTaxBooking.contact) lines.push(`เบอร์โทรศัพท์: ${selectedTaxBooking.tax_phone || selectedTaxBooking.contact}`);

          const deliveryText = selectedTaxBooking.tax_delivery_method === 'postal'
            ? `จัดส่งทางไปรษณีย์ / จดหมาย (ที่อยู่จัดส่ง: ${selectedTaxBooking.tax_postal_address || selectedTaxBooking.tax_address || '-'})`
            : (selectedTaxBooking.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'จัดส่งทางอีเมล (e-Tax)');
          lines.push(`ช่องทางการจัดส่ง: ${deliveryText}`);

          const fullText = lines.join('\n');
          navigator.clipboard.writeText(fullText);
          setTaxCopied(true);
          setTimeout(() => setTaxCopied(false), 2500);
          if (sysAlert) {
            sysAlert('คัดลอกข้อมูลใบกำกับภาษีเรียบร้อยแล้ว');
          }
        };

        return (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}>
            <div className="card" style={{
              width: '100%',
              maxWidth: '560px',
              padding: '24px',
              borderRadius: '20px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative',
              maxHeight: '92vh',
              overflowY: 'auto'
            }}>
              <button
                style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                onClick={() => { setSelectedTaxBooking(null); setTaxCopied(false); }}
              >
                <X size={20} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '46px', height: '46px', borderRadius: '14px', backgroundColor: 'rgba(37, 99, 235, 0.15)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FileText size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 850, margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>ข้อมูลใบกำกับภาษี</span>
                    <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#2563eb', fontWeight: 800 }}>Tax Invoice</span>
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ใบจอง <strong>{selectedTaxBooking.receipt_number || ('#' + selectedTaxBooking.id)}</strong> · ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{selectedTaxBooking.customer_name || '-'}</strong>
                  </span>
                </div>
              </div>

              {/* Tax Payer Info Box */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                <div style={{ padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>ชื่อบุคคล / นิติบุคคล (ตาม ภ.พ.20):</span>
                    <div style={{ fontWeight: 850, color: 'var(--text-main)', fontSize: '1rem', marginTop: '2px' }}>
                      {selectedTaxBooking.tax_name || '-'}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '10px' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>เลขประจำตัวผู้เสียภาษี (13 หลัก):</span>
                      <div style={{ fontWeight: 900, color: 'var(--primary-color)', letterSpacing: '1.2px', marginTop: '2px', fontSize: '0.95rem' }}>
                        {selectedTaxBooking.tax_id || '-'}
                      </div>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>เบอร์โทรศัพท์:</span>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                        {selectedTaxBooking.tax_phone || selectedTaxBooking.contact || '-'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>ที่อยู่สำหรับออกใบกำกับภาษี:</span>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.45 }}>
                      {selectedTaxBooking.tax_address || '-'}
                    </div>
                  </div>
                </div>

                {/* Delivery details box */}
                <div style={{ padding: '12px 16px', borderRadius: '14px', backgroundColor: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.25)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#2563eb', fontWeight: 800 }}>ช่องทางการจัดส่งเอกสาร:</span>
                    <span style={{ fontWeight: 800, color: 'var(--text-main)', backgroundColor: 'rgba(255,255,255,0.8)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                      {selectedTaxBooking.tax_delivery_method === 'postal' ? '📮 จัดส่งทางไปรษณีย์ / จดหมาย' : (selectedTaxBooking.tax_delivery_method === 'pickup' ? '🏢 รับด้วยตนเองที่หน้าร้าน' : '✉️ อีเมล / e-Tax')}
                    </span>
                  </div>

                  {selectedTaxBooking.tax_delivery_method === 'postal' && (
                    <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px dashed rgba(59, 130, 246, 0.25)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>ที่อยู่จัดส่งเอกสารทางไปรษณีย์:</span>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.4 }}>
                        {selectedTaxBooking.tax_postal_address || selectedTaxBooking.tax_address || '-'}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1.1,
                    height: '44px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    backgroundColor: taxCopied ? '#10b981' : 'var(--bg-hover)',
                    color: taxCopied ? '#ffffff' : 'var(--text-main)',
                    border: taxCopied ? '1.5px solid #10b981' : '1px solid var(--border-color)',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'pointer'
                  }}
                  onClick={handleCopyAllTaxFields}
                >
                  {taxCopied ? (
                    <>
                      <CheckCircle2 size={16} />
                      <span>คัดลอกเรียบร้อยแล้ว!</span>
                    </>
                  ) : (
                    <>
                      <FileText size={16} />
                      <span>คัดลอกข้อมูลใบกำกับ</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '44px', padding: '0 24px', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem' }}
                  onClick={() => { setSelectedTaxBooking(null); setTaxCopied(false); }}
                >
                  ปิด
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* HIDDEN PRINTABLE PDF REPORT CONTAINER (Rendered during exportToPDF) */}
      <div
        id="history-pdf-report-container"
        style={{
          display: 'none',
          backgroundColor: '#ffffff',
          color: '#0f172a',
          padding: '24px 28px',
          fontFamily: "'Sarabun', 'Noto Sans Thai', 'Prompt', sans-serif",
          width: '1020px',
          boxSizing: 'border-box',
          lineHeight: '1.4'
        }}
      >
        {/* Report Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2.5px solid #1e293b', paddingBottom: '14px', marginBottom: '14px' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', margin: 0 }}>
              {settings?.company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)'}
            </h1>
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '2px' }}>
              {settings?.company_address || settings?.quotation_company_address || '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต 602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120'}
              {(settings?.company_tax_id || settings?.quotation_company_tax_id) && (
                <span> • เลขประจำตัวผู้เสียภาษี: {settings?.company_tax_id || settings?.quotation_company_tax_id}</span>
              )}
            </div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#2563eb', margin: '8px 0 0 0' }}>
              รายงานประวัติการใช้บริการและรายรับ (Service & Revenue History Report)
            </h2>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '3px' }}>
              {startDate || endDate ? (
                <span>ช่วงวันที่ค้นหา: <strong>{startDate || 'ทั้งหมด'}</strong> ถึง <strong>{endDate || 'ปัจจุบัน'}</strong></span>
              ) : (
                <span>ช่วงวันที่ค้นหา: <strong>ข้อมูลทั้งหมดในระบบ</strong></span>
              )}
              {statusFilter && statusFilter !== 'all' && (
                <span style={{ marginLeft: '12px' }}>
                  สถานะ: <strong>{statusFilter === 'paid' ? 'สำเร็จ (Paid)' : statusFilter === 'cancelled' ? 'ยกเลิก (Cancelled)' : 'ขอใบกำกับภาษี'}</strong>
                </span>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right', fontSize: '0.78rem', color: '#64748b', flexShrink: 0 }}>
            <div>วันที่ออกรายงาน: <strong>{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} น.</strong></div>
            <div style={{ marginTop: '2px' }}>จำนวนรายการ: <strong>{sortedBookings.length} รายการ</strong></div>
            <div style={{ marginTop: '3px', fontSize: '1.05rem', fontWeight: 900, color: '#059669' }}>
              ยอดรวมสุทธิ: ฿{sortedBookings.reduce((sum, b) => sum + (b.payment_status === 'cancelled' ? 0 : Number(b.total_amount || 0)), 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Report Table with Fixed Columns */}
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '0.76rem', border: '1px solid #cbd5e1' }}>
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '5%' }} />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: '#1e293b', color: '#ffffff' }}>
              <th style={{ padding: '7px 4px', textAlign: 'center', fontWeight: 800, border: '1px solid #334155' }}>#</th>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontWeight: 800, border: '1px solid #334155' }}>เลขที่ใบเสร็จ</th>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontWeight: 800, border: '1px solid #334155' }}>วันที่ทำรายการ</th>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontWeight: 800, border: '1px solid #334155' }}>วันที่ใช้งาน</th>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontWeight: 800, border: '1px solid #334155' }}>เวลาใช้งาน</th>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontWeight: 800, border: '1px solid #334155' }}>ห้อง / บริการ</th>
              <th style={{ padding: '7px 4px', textAlign: 'center', fontWeight: 800, border: '1px solid #334155' }}>ช่องทาง</th>
              <th style={{ padding: '7px 6px', textAlign: 'left', fontWeight: 800, border: '1px solid #334155' }}>ชื่อผู้จอง / บริษัท</th>
              <th style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 800, border: '1px solid #334155' }}>ยอดเงิน (฿)</th>
              <th style={{ padding: '7px 4px', textAlign: 'center', fontWeight: 800, border: '1px solid #334155' }}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {sortedBookings.map((b, idx) => {
              const usage = formatUsageDate(b);
              const roomName = (b.items?.[0]?.room_name || b.room_name || '-');
              const isCancelled = b.payment_status === 'cancelled';

              return (
                <tr key={b.id} style={{ backgroundColor: idx % 2 === 1 ? '#f8fafc' : '#ffffff' }}>
                  <td style={{ padding: '5px 4px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0', verticalAlign: 'middle' }}>{idx + 1}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 800, color: '#2563eb', border: '1px solid #e2e8f0', verticalAlign: 'middle', wordBreak: 'break-all' }}>{b.receipt_number || `#${String(b.id).padStart(6, '0')}`}</td>
                  <td style={{ padding: '5px 6px', color: '#475569', border: '1px solid #e2e8f0', verticalAlign: 'middle', fontSize: '0.73rem' }}>{formatDate(b.created_at)}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 700, color: '#0f172a', border: '1px solid #e2e8f0', verticalAlign: 'middle', fontSize: '0.73rem' }}>{usage.dateStr !== '-' ? usage.dateStr : '-'}</td>
                  <td style={{ padding: '5px 6px', color: '#64748b', border: '1px solid #e2e8f0', verticalAlign: 'middle', fontSize: '0.72rem' }}>{usage.timeStr || '-'}</td>
                  <td style={{ padding: '5px 6px', fontWeight: 600, color: '#0f172a', border: '1px solid #e2e8f0', verticalAlign: 'middle', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{roomName}</td>
                  <td style={{ padding: '5px 4px', textAlign: 'center', border: '1px solid #e2e8f0', verticalAlign: 'middle' }}>
                    <span style={{ fontSize: '0.68rem', padding: '2px 4px', borderRadius: '4px', backgroundColor: (b.booking_channel === 'line_oa' || b.booking_source === 'online') ? '#e0f2fe' : '#dcfce7', color: (b.booking_channel === 'line_oa' || b.booking_source === 'online') ? '#0369a1' : '#15803d', fontWeight: 700 }}>
                      {(b.booking_channel === 'line_oa' || b.booking_source === 'online') ? 'ออนไลน์' : 'Walk-in'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 6px', color: '#0f172a', border: '1px solid #e2e8f0', verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.customer_name || '-'}</div>
                  </td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 800, color: isCancelled ? '#94a3b8' : '#0f172a', border: '1px solid #e2e8f0', verticalAlign: 'middle', fontSize: '0.76rem' }}>
                    {Number(b.total_amount || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: '5px 4px', textAlign: 'center', border: '1px solid #e2e8f0', verticalAlign: 'middle' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: isCancelled ? '#dc2626' : '#16a34a' }}>
                      {isCancelled ? 'ยกเลิก' : 'สำเร็จ'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#f1f5f9', borderTop: '2px solid #1e293b', fontWeight: 900 }}>
              <td colSpan={8} style={{ padding: '8px 8px', textAlign: 'right', fontSize: '0.82rem', border: '1px solid #cbd5e1' }}>
                ยอดรวมสุทธิทั้งสิ้น ({sortedBookings.filter(b => b.payment_status !== 'cancelled').length} รายการ):
              </td>
              <td style={{ padding: '8px 6px', textAlign: 'right', fontSize: '0.88rem', color: '#059669', border: '1px solid #cbd5e1' }}>
                ฿{sortedBookings.reduce((sum, b) => sum + (b.payment_status === 'cancelled' ? 0 : Number(b.total_amount || 0)), 0).toLocaleString()}
              </td>
              <td style={{ border: '1px solid #cbd5e1' }}></td>
            </tr>
          </tfoot>
        </table>

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: '#94a3b8', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
          <div>{settings?.company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)'} • B-WORK Management POS System</div>
          <div>พิมพ์รายงานเมื่อ: {new Date().toLocaleString('th-TH')}</div>
        </div>
      </div>
    </div>
  );
}

export default HistoryLog;
