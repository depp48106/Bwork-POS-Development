import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import {
  RefreshCw,
  Clock,
  DollarSign,
  User,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Printer,
  X,
  Search,
  Eye,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Filter,
  Key,
  ShieldCheck,
  Send,
  Sparkles,
  Phone,
  RotateCcw,
  ExternalLink,
  Edit3,
  Ban,
  AlertTriangle,
  MoreHorizontal,
  FileText,
  Plus,
  ZoomIn,
  ZoomOut,
  EyeOff,
  Copy,
  Check
} from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';
import { API_BASE } from '../apiConfig';
import { analyzeSlipInBrowser } from '../utils/browserSlipVerifier';
import './PendingBookings.css';

const DATE_TYPE_OPTIONS = [
  { value: 'usage_date', label: 'วันที่ใช้งาน' },
  { value: 'created_at', label: 'วันที่ทำรายการ' }
];

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'all', label: 'ทุกประเภท' },
  { value: 'general', label: 'ทั่วไป' },
  { value: 'builtland', label: 'Builtland' },
  { value: 'basecamp', label: 'Basecamp' }
];

const TIME_SLOT_OPTIONS = [
  '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00'
];

function PendingBookings({ settings, sysAlert, sysConfirm, onNavigateToBook, targetBooking, clearTargetBooking }) {
  const [highlightedBookingId, setHighlightedBookingId] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [roomsList, setRoomsList] = useState([]);
  const [loading, setLoading] = useState(false);
  // Helper to get local YYYY-MM-DD string
  const getTodayStr = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Search & Filter State (Auto-applied reactive filters)
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [dateFilterType, setDateFilterType] = useState('usage_date'); // 'usage_date' | 'created_at'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Status Tab Filter: 'all' | 'reviewing' | 'pending' | 'paid' | 'cancelled' | 'tax_invoice'
  const [activeStatusTab, setActiveStatusTab] = useState('all');
  // Customer Type Filter: 'all' | 'general' | 'builtland' | 'basecamp'
  const [customerTypeFilter, setCustomerTypeFilter] = useState('all');
  // Booking Channel Filter: 'all' | 'pos' | 'line_oa'
  const [bookingChannelFilter, setBookingChannelFilter] = useState('all');

  // Selection and payment states
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [selectedTaxBooking, setSelectedTaxBooking] = useState(null);
  const [taxCopied, setTaxCopied] = useState(false);
  const [viewingSlipBooking, setViewingSlipBooking] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [slipZoom, setSlipZoom] = useState(1);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState('transfer');
  const [isPayMethodOpen, setIsPayMethodOpen] = useState(false);

  // Reject Slip Modal states
  const [showRejectSlipModal, setShowRejectSlipModal] = useState(false);
  const [rejectTargetBooking, setRejectTargetBooking] = useState(null);
  const [rejectReasonCode, setRejectReasonCode] = useState('AMOUNT_MISMATCH');
  const [rejectCustomNote, setRejectCustomNote] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  // Active Dropdown Action Menu in table row
  const [activeActionMenuBooking, setActiveActionMenuBooking] = useState(null);
  const [actionMenuPos, setActionMenuPos] = useState(null);

  const handleToggleActionMenu = (e, booking) => {
    e.stopPropagation();
    if (activeActionMenuBooking?.id === booking.id) {
      setActiveActionMenuBooking(null);
      setActionMenuPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 280;
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

  // Cancellation Modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTargetBooking, setCancelTargetBooking] = useState(null);
  const [cancelReason, setCancelReason] = useState('ลูกค้าแจ้งยกเลิกการจอง');
  const [cancelLoading, setCancelLoading] = useState(false);

  // Reschedule Modal state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleRoomId, setRescheduleRoomId] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleStartHour, setRescheduleStartHour] = useState('09');
  const [rescheduleStartMinute, setRescheduleStartMinute] = useState('00');
  const [rescheduleEndHour, setRescheduleEndHour] = useState('10');
  const [rescheduleEndMinute, setRescheduleEndMinute] = useState('00');
  const [rescheduleBookingType, setRescheduleBookingType] = useState('hourly');
  const [rescheduleLayout, setRescheduleLayout] = useState('standard');
  const [rescheduleDailySlot, setRescheduleDailySlot] = useState('08-17');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleSendLine, setRescheduleSendLine] = useState(true);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [isReschedRoomOpen, setIsReschedRoomOpen] = useState(false);
  const [isReschedStartOpen, setIsReschedStartOpen] = useState(false);
  const [isReschedEndOpen, setIsReschedEndOpen] = useState(false);
  const [isReschedDailyOpen, setIsReschedDailyOpen] = useState(false);
  const [isReschedHalfdayOpen, setIsReschedHalfdayOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 15;

  // Sorting state
  const [sortKey, setSortKey] = useState('id');
  const [sortOrder, setSortOrder] = useState('desc'); // default: newest first

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Door PIN reveal and copy states for table display
  const [revealedPins, setRevealedPins] = useState({}); // { [bookingId]: boolean }
  const [copiedPin, setCopiedPin] = useState(null); // bookingId of currently copied pin

  const handleToggleRevealPin = (bookingId) => {
    setRevealedPins(prev => ({
      ...prev,
      [bookingId]: !prev[bookingId]
    }));
  };

  const handleCopyPin = (bookingId, pinValue) => {
    if (!pinValue || pinValue === '-') return;
    navigator.clipboard.writeText(String(pinValue));
    setCopiedPin(bookingId);
    setTimeout(() => {
      setCopiedPin(prev => prev === bookingId ? null : prev);
    }, 2000);
    if (sysAlert) {
      sysAlert(`คัดลอกรหัสเข้าห้อง (${pinValue}) เรียบร้อยแล้ว`);
    }
  };

  // 6-column operational table definitions
  const columns = [
    { key: 'id', label: 'การจอง', width: '16%' },
    { key: 'customer_name', label: 'ผู้จอง', width: '18%' },
    { key: 'room_info', label: 'ห้อง & เวลาใช้งาน', width: '26%' },
    { key: 'total_amount', label: 'ยอดชำระ', width: '12%' },
    { key: 'status', label: 'สถานะ & รหัสเข้าห้อง', width: '15%' },
    { key: 'actions', label: 'การดำเนินการ', width: '13%' }
  ];

  useEffect(() => {
    fetchBookings();
    fetchRooms();
    // Auto-refresh every 10 seconds to catch new online bookings & slips
    const interval = setInterval(() => {
      fetchBookings(true);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchRooms = async () => {
    try {
      const res = await fetch('/api/rooms');
      if (res.ok) {
        const data = await res.json();
        setRoomsList(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    }
  };

  // Reset page to 1 when any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearchQuery, activeStatusTab, customerTypeFilter, bookingChannelFilter, startDate, endDate, dateFilterType]);

  // Determine whether any non-default filter is currently active
  const isAnyFilterActive =
    searchQuery !== '' ||
    customerTypeFilter !== 'all' ||
    bookingChannelFilter !== 'all' ||
    activeStatusTab !== 'all' ||
    dateFilterType !== 'usage_date' ||
    startDate !== '' ||
    endDate !== '';

  // Header quick filter for reviewing slips across all dates
  const handleQuickFilterReviewing = () => {
    setActiveStatusTab('reviewing');
    setStartDate('');
    setEndDate('');
    setCustomerTypeFilter('all');
    setBookingChannelFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Header quick filter for pending payments across all dates
  const handleQuickFilterPending = () => {
    setActiveStatusTab('pending');
    setStartDate('');
    setEndDate('');
    setCustomerTypeFilter('all');
    setBookingChannelFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Explicit Reset All Filters to default All-Bookings view (Only one bulk reset action)
  const handleResetFilters = () => {
    setSearchQuery('');
    setDateFilterType('usage_date');
    setStartDate('');
    setEndDate('');
    setCustomerTypeFilter('all');
    setBookingChannelFilter('all');
    setActiveStatusTab('all');
    setCurrentPage(1);
  };

  const handleClearFilters = handleResetFilters;

  const fetchBookings = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setIsRefreshing(true);
    try {
      // Fetch all bookings so user can switch between Pending, Paid, Cancelled tabs instantly
      const res = await fetch('/api/bookings');
      if (res.ok) {
        const data = await res.json();
        setBookings(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    } finally {
      if (!isBackground) setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleOpenPayment = (booking) => {
    setSelectedBooking(booking);
    setPayMethod(booking.payment_method || 'transfer');
    setShowPayModal(true);
  };

  const handleOpenPayModal = (booking) => {
    if (booking?.slip_image_url) {
      setViewingSlipBooking(booking);
    } else {
      handleOpenPayment(booking);
    }
  };

  // Run Browser OCR Assistant when Staff opens Slip Modal (Decision Support Only)
  useEffect(() => {
    let isMounted = true;
    if (viewingSlipBooking?.slip_image_url && viewingSlipBooking.slip_image_url !== 'uploaded') {
      setIsOcrRunning(true);
      setOcrResult(null);
      setOcrProgress(0);

      analyzeSlipInBrowser(
        viewingSlipBooking.slip_image_url,
        viewingSlipBooking,
        settings,
        (prog) => {
          if (isMounted) setOcrProgress(prog);
        }
      ).then((res) => {
        if (isMounted) {
          setOcrResult(res);
          setIsOcrRunning(false);
        }
      }).catch((err) => {
        if (isMounted) {
          setOcrResult({
            status: 'error',
            error: err.message,
            decisionSupportMessage: 'ไม่สามารถตรวจอัตโนมัติ กรุณาตรวจสอบด้วยตนเอง',
            messageType: 'error'
          });
          setIsOcrRunning(false);
        }
      });
    } else {
      setOcrResult(null);
      setIsOcrRunning(false);
      setOcrProgress(0);
    }
    setSlipZoom(1);
    return () => {
      isMounted = false;
    };
  }, [viewingSlipBooking?.id, viewingSlipBooking?.slip_image_url]);

  const handleZoomIn = () => {
    setSlipZoom(prev => Math.min(2.0, Number((prev + 0.25).toFixed(2))));
  };
  const handleZoomOut = () => {
    setSlipZoom(prev => Math.max(0.75, Number((prev - 0.25).toFixed(2))));
  };
  const handleZoomReset = () => {
    setSlipZoom(1.0);
  };

  const handleRerunOcr = () => {
    if (!viewingSlipBooking?.slip_image_url || viewingSlipBooking.slip_image_url === 'uploaded') return;
    setIsOcrRunning(true);
    setOcrProgress(0);
    analyzeSlipInBrowser(
      viewingSlipBooking.slip_image_url,
      viewingSlipBooking,
      settings,
      (prog) => setOcrProgress(prog)
    ).then((res) => {
      setOcrResult(res);
      setIsOcrRunning(false);
    }).catch((err) => {
      setOcrResult({
        status: 'error',
        error: err.message,
        decisionSupportMessage: 'ไม่สามารถตรวจอัตโนมัติ กรุณาตรวจสอบด้วยตนเอง',
        messageType: 'error'
      });
      setIsOcrRunning(false);
    });
  };

  const handleOpenBookingDetail = async (booking) => {
    if (!booking) return;
    try {
      const res = await fetch(`/api/bookings/${booking.id}`);
      if (res.ok) {
        const detailData = await res.json();
        setSelectedBooking(detailData);
      } else {
        setSelectedBooking(booking);
      }
    } catch (err) {
      setSelectedBooking(booking);
    }
    setShowDetailModal(true);
  };

  const handleOpenReceiptPrint = async (booking) => {
    if (!booking) return;
    try {
      const res = await fetch(`/api/bookings/${booking.id}`);
      if (res.ok) {
        const detailData = await res.json();
        setSelectedBooking(detailData);
      } else {
        setSelectedBooking(booking);
      }
    } catch (err) {
      setSelectedBooking(booking);
    }
    setShowReceiptModal(true);
  };

  // Backwards-compatible alias: opens the operational booking detail view
  const handleOpenReceipt = handleOpenBookingDetail;

  // Handle transient one-time handoff from Home / Dashboard
  useEffect(() => {
    if (!targetBooking || !targetBooking.id) return;
    const targetId = targetBooking.id;
    const action = targetBooking.action || 'view';

    const handleHandoff = async () => {
      let found = (bookings || []).find(b => String(b.id) === String(targetId) || String(b.booking_id) === String(targetId));
      if (!found) {
        try {
          const res = await fetch(`/api/bookings/${targetId}`);
          if (res.ok) {
            found = await res.json();
            setBookings(prev => [found, ...prev]);
          }
        } catch (e) {
          console.warn('[PendingBookings] Handoff fetch error:', e);
        }
      }

      if (found) {
        if (found.payment_status === 'reviewing' || found.slip_image_url) {
          setActiveStatusTab('reviewing');
        } else if (found.payment_status === 'pending') {
          setActiveStatusTab('pending');
        } else if (found.payment_status === 'paid') {
          setActiveStatusTab('paid');
        } else {
          setActiveStatusTab('all');
        }

        setSearchQuery('');
        setStartDate('');
        setEndDate('');
        setCustomerTypeFilter('all');
        setBookingChannelFilter('all');
        setCurrentPage(1);

        if (action === 'review') {
          if (found.slip_image_url) {
            setViewingSlipBooking(found);
          } else {
            handleOpenPayment(found);
          }
        } else {
          handleOpenBookingDetail(found);
        }

        setHighlightedBookingId(found.id);
        setTimeout(() => {
          const el = document.getElementById(`booking-row-${found.id}`) || document.getElementById(`booking-card-${found.id}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 200);

        setTimeout(() => {
          setHighlightedBookingId(null);
        }, 4500);
      } else {
        if (sysAlert) {
          sysAlert(`ไม่พบข้อมูลการจอง #${targetId} ในระบบ`);
        }
      }

      if (clearTargetBooking) {
        clearTargetBooking();
      }
    };

    handleHandoff();
  }, [targetBooking, bookings]);

  // Dispatch PIN to customer's LINE OA or show PIN (Manual Staff Action)
  const sendDoorPin = async (bookingId) => {
    try {
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const url = `${API_BASE}/api/bookings/${bookingId}/send-pin`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.line_sent) {
          await sysAlert(`ส่งรหัสผ่านเข้าห้อง (PIN: ${data.pin_code}) เข้า LINE OA ของลูกค้าเรียบร้อยแล้ว!`);
        } else {
          await sysAlert(`ลูกค้ารายนี้ไม่ได้เชื่อมต่อ LINE OA (จองผ่านหน้าเว็บทั่วไป)\n\nรหัสผ่านเข้าห้อง: ${data.pin_code}\n\nเจ้าหน้าที่สามารถแจ้งรหัส PIN นี้ให้ลูกค้าที่หน้าเคาน์เตอร์ได้โดยตรงครับ`);
        }
      } else {
        await sysAlert('' + (data.error || 'ไม่สามารถส่งรหัสผ่านได้ กรุณาตรวจสอบสถานะการเชื่อมต่อ'));
      }
    } catch (e) {
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleSendPin = (bookingId) => {
    sendDoorPin(bookingId);
  };

  // Staff confirms payment
  const submitPayment = async () => {
    if (!selectedBooking) return;
    try {
      const res = await fetch(`/api/bookings/${selectedBooking.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'paid', payment_method: payMethod })
      });

      if (res.ok) {
        const payData = await res.json();
        const detailRes = await fetch(`/api/bookings/${selectedBooking.id}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setSelectedBooking(detailData);
          setShowPayModal(false);
          setShowReceiptModal(true);
          fetchBookings();
          await sysAlert('ยืนยันการรับชำระเงินสำเร็จแล้ว!\nส่งข้อความยืนยันการจองเข้า LINE ลูกค้าเรียบร้อย');
        }
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการทำรายการชำระเงิน');
    }
  };

  // Staff reverts payment status back to pending / reviewing
  const revertPayment = async (booking) => {
    if (!booking) return;
    const isSlip = !!booking.slip_image_url;
    const targetStatus = isSlip ? 'reviewing' : 'pending';
    const targetStatusText = isSlip ? 'รอตรวจสลิป' : 'รอชำระเงิน';

    if (!await sysConfirm(`คุณต้องการยกเลิกการยืนยันชำระเงินของใบจอง #${booking.id} (${booking.customer_name}) ใช่หรือไม่?\n\n(ระบบจะเปลี่ยนสถานะกลับเป็น '${targetStatusText}' เพื่อให้ตรวจสอบหรือทำรายการใหม่อีกครั้ง)`)) {
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${booking.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: targetStatus })
      });

      if (res.ok) {
        if (viewingSlipBooking && viewingSlipBooking.id === booking.id) {
          setViewingSlipBooking(null);
        }
        await sysAlert(`ยกเลิกการยืนยันชำระเงินเรียบร้อยแล้ว!\nสถานะของใบจอง #${booking.id} เปลี่ยนกลับเป็น '${targetStatusText}'`);
        fetchBookings();
      } else {
        const d = await res.json();
        await sysAlert('' + (d.error || 'ไม่สามารถยกเลิกสถานะการชำระเงินได้'));
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  // 1. Hard Permanent Delete (ลบออกจากระบบถาวร)
  const handlePermanentDelete = async (booking) => {
    if (!booking) return;
    const confirmMsg = `คุณต้องการลบรายการจอง #${booking.id} (${booking.customer_name || 'ลูกค้า'}) ออกจากระบบอย่างถาวรใช่หรือไม่?\n\nคำเตือน: ข้อมูลการจองและประวัติจะถูกลบออกจากฐานข้อมูลทันที ไม่สามารถกู้คืนได้`;
    if (!await sysConfirm(confirmMsg)) {
      return;
    }
    try {
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await sysAlert('ลบรายการจองออกจากระบบอย่างถาวรเรียบร้อยแล้ว');
        fetchBookings();
      } else {
        const errData = await res.json().catch(() => ({}));
        sysAlert('' + (errData.error || 'เกิดข้อผิดพลาดในการลบรายการ'));
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการลบรายการ');
    }
  };

  // 2. Soft Cancel Booking (ยกเลิกการจอง -> ย้ายไปแท็บยกเลิก & ส่งแจ้งเตือน LINE OA)
  const handleOpenCancelModal = (booking) => {
    setCancelTargetBooking(booking);
    setCancelReason('ลูกค้าแจ้งขอยกเลิกการจอง');
    setShowCancelModal(true);
  };

  const submitCancelBooking = async () => {
    if (!cancelTargetBooking) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/bookings/${cancelTargetBooking.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowCancelModal(false);
        setCancelTargetBooking(null);
        await sysAlert(data.message || 'ยกเลิกการจองสำเร็จแล้ว');
        fetchBookings();
      } else {
        await sysAlert('' + (data.error || 'ไม่สามารถยกเลิกการจองได้'));
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setCancelLoading(false);
    }
  };

  // 2.1 Reject Slip (ปฏิเสธสลิปการโอนเงิน -> สถานะเป็น rejected, ห้องยังคงถูกล็อค, รอลูกค้าแนบใหม่)
  const handleOpenRejectSlipModal = (booking) => {
    setRejectTargetBooking(booking);
    setRejectReasonCode('AMOUNT_MISMATCH');
    setRejectCustomNote('');
    setShowRejectSlipModal(true);
  };

  const submitRejectSlip = async () => {
    if (!rejectTargetBooking) return;
    if (rejectReasonCode === 'OTHER' && !rejectCustomNote.trim()) {
      await sysAlert('กรณีเลือกอื่นๆ กรุณาระบุรายละเอียดเหตุผลเพิ่มเติม');
      return;
    }
    setRejectLoading(true);
    try {
      const res = await fetch(`/api/bookings/${rejectTargetBooking.id}/reject-slip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason_code: rejectReasonCode,
          custom_note: rejectCustomNote.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowRejectSlipModal(false);
        setRejectTargetBooking(null);
        await sysAlert(data.message || 'ปฏิเสธสลิปการโอนเงินเรียบร้อยแล้ว (การจองยังคงอยู่)');
        fetchBookings();
      } else {
        await sysAlert('' + (data.error || 'ไม่สามารถปฏิเสธสลิปได้'));
      }
    } catch (err) {
      console.error(err);
      await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setRejectLoading(false);
    }
  };

  // 3. Reschedule Booking (แก้ไขวัน/เวลาการจอง)
  const handleOpenReschedule = async (booking) => {
    if (!booking) return;
    try {
      // Fetch full details to ensure item structure
      const res = await fetch(`/api/bookings/${booking.id}`);
      const fullBooking = res.ok ? await res.json() : booking;
      setRescheduleTarget(fullBooking);

      const item = fullBooking.items?.[0] || fullBooking;
      let initDate = new Date().toISOString().split('T')[0];
      let initSHour = '09';
      let initSMin = '00';
      let initEHour = '10';
      let initEMin = '00';
      let bType = item.booking_type || 'hourly';
      let bLayout = item.layout || 'standard';
      let dailySlot = '08-17';

      if (item.start_time) {
        const sStr = String(item.start_time).replace(' ', 'T');
        if (sStr.includes('T')) {
          const [d, t] = sStr.split('T');
          initDate = d;
          const [h, m] = t.substring(0, 5).split(':');
          initSHour = h || '09';
          initSMin = m || '00';
        }
      }
      if (item.end_time) {
        const eStr = String(item.end_time).replace(' ', 'T');
        if (eStr.includes('T')) {
          const [, t] = eStr.split('T');
          const [h, m] = t.substring(0, 5).split(':');
          initEHour = h || '10';
          initEMin = m || '00';
        }
      }

      if (bType === 'halfday') {
        dailySlot = initSHour === '13' ? '13-17' : '08-12';
      } else if (bType === 'daily') {
        dailySlot = initSHour === '09' ? '09-18' : '08-17';
      }

      const initRoomId = item.room_id || fullBooking.room_id || (roomsList[0]?.id ? String(roomsList[0].id) : '');
      setRescheduleRoomId(String(initRoomId));
      setRescheduleDate(initDate);
      setRescheduleStartHour(initSHour);
      setRescheduleStartMinute(initSMin);
      setRescheduleEndHour(initEHour);
      setRescheduleEndMinute(initEMin);
      setRescheduleBookingType(bType);
      setRescheduleLayout(bLayout);
      setRescheduleDailySlot(dailySlot);
      setRescheduleReason('');
      setRescheduleSendLine(!!fullBooking.line_user_id);
      setShowRescheduleModal(true);
    } catch (err) {
      console.error('Error opening reschedule modal:', err);
      sysAlert('ไม่สามารถโหลดข้อมูลการจองได้');
    }
  };

  // Real-time Price Recalculation for Reschedule
  const reschedulePriceCalc = useMemo(() => {
    if (!rescheduleTarget) return { newTotal: 0, oldTotal: 0, diff: 0, isValid: true };
    const oldTotal = Number(rescheduleTarget.total_amount) || 0;
    const roomId = rescheduleRoomId || rescheduleTarget.items?.[0]?.room_id || rescheduleTarget.room_id;
    const room = roomsList.find(r => String(r.id) === String(roomId)) || {};

    let newTotal = oldTotal;
    let isValid = true;

    if (rescheduleBookingType === 'daily') {
      newTotal = rescheduleLayout === 'classroom'
        ? (room.classroom_daily_rate || room.daily_rate || 0)
        : (room.daily_rate || 0);
    } else if (rescheduleBookingType === 'halfday') {
      newTotal = room.half_day_rate || 0;
    } else {
      const sh = parseInt(rescheduleStartHour, 10);
      const sm = parseInt(rescheduleStartMinute, 10);
      const eh = parseInt(rescheduleEndHour, 10);
      const em = parseInt(rescheduleEndMinute, 10);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em) || eh * 60 + em <= sh * 60 + sm) {
        isValid = false;
      } else {
        const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
        const totalHours = Math.ceil(totalMinutes / 60);
        const hourlyRate = rescheduleLayout === 'classroom'
          ? (room.classroom_hourly_rate || room.hourly_rate || 0)
          : (room.hourly_rate || 0);
        newTotal = totalHours * (hourlyRate || (oldTotal / (totalHours || 1)));
      }
    }

    const diff = newTotal - oldTotal;
    return { newTotal, oldTotal, diff, isValid };
  }, [rescheduleTarget, rescheduleRoomId, rescheduleBookingType, rescheduleLayout, rescheduleDailySlot, rescheduleStartHour, rescheduleStartMinute, rescheduleEndHour, rescheduleEndMinute, roomsList]);

  // Real-time Overlap Checker for Reschedule
  const rescheduleOverlapInfo = useMemo(() => {
    if (!showRescheduleModal || !rescheduleTarget || !rescheduleDate) {
      return { isValid: true, isOverlap: false, booking: null };
    }
    const roomId = rescheduleRoomId || rescheduleTarget.items?.[0]?.room_id || rescheduleTarget.room_id;
    if (!roomId) return { isValid: true, isOverlap: false, booking: null };

    let sTime = null;
    let eTime = null;
    let isValid = true;

    if (rescheduleBookingType === 'daily') {
      const [sh, eh] = rescheduleDailySlot === '09-18' ? ['09', '18'] : ['08', '17'];
      sTime = new Date(`${rescheduleDate}T${sh}:00:00`);
      eTime = new Date(`${rescheduleDate}T${eh}:00:00`);
    } else if (rescheduleBookingType === 'halfday') {
      const [sh, eh] = rescheduleDailySlot === '13-17' ? ['13', '17'] : ['08', '12'];
      sTime = new Date(`${rescheduleDate}T${sh}:00:00`);
      eTime = new Date(`${rescheduleDate}T${eh}:00:00`);
    } else {
      const sh = parseInt(rescheduleStartHour, 10);
      const sm = parseInt(rescheduleStartMinute, 10);
      const eh = parseInt(rescheduleEndHour, 10);
      const em = parseInt(rescheduleEndMinute, 10);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em) || eh * 60 + em <= sh * 60 + sm) {
        isValid = false;
      } else {
        sTime = new Date(`${rescheduleDate}T${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00`);
        eTime = new Date(`${rescheduleDate}T${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`);
      }
    }

    if (!isValid || !sTime || !eTime) {
      return { isValid: false, isOverlap: false, booking: null };
    }

    // Check overlap with other active bookings for the same room
    const foundOverlap = bookings.find(b => {
      if (String(b.id) === String(rescheduleTarget.id)) return false;
      if (b.payment_status === 'cancelled') return false;
      const bItems = b.items && b.items.length > 0 ? b.items : [b];
      return bItems.some(it => {
        if (Number(it.room_id) !== Number(roomId)) return false;
        if (!it.start_time || !it.end_time) return false;
        const sStr = String(it.start_time).replace(' ', 'T').replace('Z', '');
        const eStr = String(it.end_time).replace(' ', 'T').replace('Z', '');
        const bStart = new Date(sStr);
        const bEnd = new Date(eStr);
        return sTime < bEnd && eTime > bStart;
      });
    });

    if (foundOverlap) {
      return { isValid: true, isOverlap: true, booking: foundOverlap };
    }
    return { isValid: true, isOverlap: false, booking: null };
  }, [showRescheduleModal, rescheduleTarget, rescheduleRoomId, rescheduleDate, rescheduleStartHour, rescheduleStartMinute, rescheduleEndHour, rescheduleEndMinute, rescheduleBookingType, rescheduleDailySlot, bookings]);

  // Submit Reschedule
  const submitRescheduleBooking = async () => {
    if (!rescheduleTarget || !reschedulePriceCalc.isValid || rescheduleOverlapInfo.isOverlap) return;
    setRescheduleLoading(true);

    let start_time = `${String(rescheduleStartHour).padStart(2, '0')}:${String(rescheduleStartMinute).padStart(2, '0')}`;
    let end_time = `${String(rescheduleEndHour).padStart(2, '0')}:${String(rescheduleEndMinute).padStart(2, '0')}`;

    if (rescheduleBookingType === 'daily') {
      [start_time, end_time] = rescheduleDailySlot === '09-18' ? ['09:00', '18:00'] : ['08:00', '17:00'];
    } else if (rescheduleBookingType === 'halfday') {
      [start_time, end_time] = rescheduleDailySlot === '13-17' ? ['13:00', '17:00'] : ['08:00', '12:00'];
    }

    try {
      const res = await fetch(`/api/bookings/${rescheduleTarget.id}/reschedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: Number(rescheduleRoomId),
          date: rescheduleDate,
          start_time,
          end_time,
          booking_type: rescheduleBookingType,
          layout: rescheduleLayout,
          total_amount: reschedulePriceCalc.newTotal,
          reason: rescheduleReason,
          send_line: rescheduleSendLine
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setShowRescheduleModal(false);
        setRescheduleTarget(null);
        await sysAlert(data.message || 'เปลี่ยนแปลงวันและเวลาการจองสำเร็จแล้ว');
        fetchBookings();
      } else {
        await sysAlert('' + (data.error || 'ไม่สามารถแก้ไขวัน/เวลาการจองได้'));
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setRescheduleLoading(false);
    }
  };

  const monthNamesThai = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  const formatUsageDate = (b) => {
    const firstItem = b.items?.[0] || {};
    const startTimeStr = firstItem.start_time || b.start_time || b.booking_date;
    if (!startTimeStr) return '-';
    try {
      let str = String(startTimeStr).trim();
      if (str.includes('T')) {
        const [dPart] = str.split('T');
        const [y, m, day] = dPart.split('-').map(Number);
        const thaiYear = y + 543;
        return `${day} ${monthNamesThai[m - 1]} ${thaiYear}`;
      } else if (str.includes('-')) {
        const [y, m, day] = str.split(' ')[0].split('-').map(Number);
        const thaiYear = y + 543;
        return `${day} ${monthNamesThai[m - 1]} ${thaiYear}`;
      } else {
        const d = new Date(str);
        if (isNaN(d.getTime())) return str;
        const year = d.getFullYear() + 543;
        return `${d.getDate()} ${monthNamesThai[d.getMonth()]} ${year}`;
      }
    } catch (e) {
      return String(startTimeStr);
    }
  };

  const formatUsageTime = (b) => {
    const firstItem = b.items?.[0] || {};
    const sRaw = firstItem.start_time || b.start_time || b.startTime || '';
    const eRaw = firstItem.end_time || b.end_time || b.endTime || '';

    const extractHHMM = (val) => {
      if (!val) return '';
      const str = String(val).trim();
      if (str.includes('T')) {
        const timePart = str.split('T')[1];
        return timePart.substring(0, 5);
      }
      if (str.includes(' ')) {
        const parts = str.split(' ');
        const timePart = parts[1] || parts[0];
        if (timePart.includes(':')) return timePart.substring(0, 5);
      }
      if (str.includes(':')) {
        return str.substring(0, 5);
      }
      return str;
    };

    const sTime = extractHHMM(sRaw);
    const eTime = extractHHMM(eRaw);
    if (sTime && eTime) return `${sTime} - ${eTime} น.`;
    if (sTime) return `${sTime} น.`;
    return '-';
  };

  const formatCreatedDateTime = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = d.getDate();
      const month = monthNamesThai[d.getMonth()];
      const thaiYear = d.getFullYear() + 543;
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${thaiYear} ${hours}:${mins} น.`;
    } catch (e) {
      return String(dateStr);
    }
  };

  const getLocalDateString = (dateStr) => {
    if (!dateStr) return '';
    try {
      let str = String(dateStr).trim();
      if (!str.includes('T') && str.includes(' ')) {
        str = str.replace(' ', 'T');
      }
      if (!str.endsWith('Z') && !/\+\d{2}:?\d{2}$/.test(str)) {
        str = str + 'Z';
      }
      const d = new Date(str);
      if (isNaN(d.getTime())) return String(dateStr).split('T')[0].split(' ')[0];
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return String(dateStr).split('T')[0].split(' ')[0];
    }
  };

  const getBookingUsageDateStr = (b) => {
    const firstItem = b.items?.[0] || {};
    const s = firstItem.start_time || b.start_time || b.booking_date;
    if (!s) return '';
    if (typeof s === 'string') {
      return s.split('T')[0].split(' ')[0];
    }
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch (e) {
      return '';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      let str = String(dateStr).trim();
      if (!str.includes('T') && str.includes(' ')) {
        str = str.replace(' ', 'T');
      }
      if (!str.endsWith('Z') && !/\+\d{2}:?\d{2}$/.test(str)) {
        str = str + 'Z';
      }
      const d = new Date(str);
      if (isNaN(d.getTime())) return dateStr;
      const year = d.getFullYear() + 543;
      const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      const month = monthNames[d.getMonth()];
      const day = d.getDate();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${year} ${hours}:${minutes} น.`;
    } catch (e) {
      return dateStr;
    }
  };

  const handleSort = (key) => {
    if (key === 'actions') return;
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  // 1. Base Filter (Date range & Search query using auto-applied reactive filters)
  const baseFilteredList = useMemo(() => {
    return bookings.filter(b => {
      // Date Filtering (Start Date & End Date Range)
      if (startDate || endDate) {
        if (dateFilterType === 'created_at') {
          const createdDateStr = getLocalDateString(b.created_at);
          if (!createdDateStr) return false;
          if (startDate && createdDateStr < startDate) return false;
          if (endDate && createdDateStr > endDate) return false;
        } else {
          // usage_date
          let matches = false;
          if (b.items && b.items.length) {
            matches = b.items.some(it => {
              const dStr = it.start_time ? it.start_time.split('T')[0].split(' ')[0] : '';
              if (!dStr) return false;
              if (startDate && dStr < startDate) return false;
              if (endDate && dStr > endDate) return false;
              return true;
            });
          }
          if (!matches) {
            const usageDateStr = getBookingUsageDateStr(b);
            if (usageDateStr) {
              if (startDate && usageDateStr < startDate) matches = false;
              else if (endDate && usageDateStr > endDate) matches = false;
              else matches = true;
            }
          }
          if (!matches) return false;
        }
      }

      if (!deferredSearchQuery) return true;

      const searchLower = deferredSearchQuery.toLowerCase().trim();
      const customer = (b.customer_name || '').toLowerCase();
      const contact = (b.contact || '');
      const receipt = (b.receipt_number || '').toLowerCase();
      const idStr = String(b.id);
      const pin = (b.pin_code || '');
      const roomName = (b.items?.[0]?.room_name || b.room_name || '').toLowerCase();

      return (
        idStr.includes(searchLower) ||
        receipt.includes(searchLower) ||
        customer.includes(searchLower) ||
        contact.includes(searchLower) ||
        pin.includes(searchLower) ||
        roomName.includes(searchLower)
      );
    });
  }, [bookings, startDate, endDate, dateFilterType, deferredSearchQuery]);

  // Customer Type matcher: 'all' | 'general' | 'builtland' | 'basecamp'
  // Note: Walk-in is handled as Booking Channel (POS). 'general' covers all standard/retail customers.
  const matchesCustomerType = (b, type) => {
    if (type === 'all') return true;
    if (type === 'builtland') return b.customer_type === 'builtland';
    if (type === 'basecamp') return b.customer_type === 'basecamp';
    if (type === 'general') {
      return b.customer_type !== 'builtland' && b.customer_type !== 'basecamp';
    }
    return true;
  };

  // Booking Channel matcher: 'all' | 'pos' | 'line_oa'
  const matchesBookingChannel = (b, channel) => {
    if (channel === 'all') return true;
    const isPos = b.booking_channel === 'pos_web' || b.booking_source === 'walk-in' || b.booking_source === 'pos' || (!b.booking_channel && b.booking_source !== 'online');
    const isLineOA = b.booking_channel === 'line_oa' || b.booking_source === 'online';
    if (channel === 'pos') return isPos;
    if (channel === 'line_oa') return isLineOA;
    return true;
  };

  // 2. Customer Type counts derived from baseFilteredList (scoped to current channel filter)
  const customerTypeCounts = useMemo(() => {
    const list = baseFilteredList.filter(b => matchesBookingChannel(b, bookingChannelFilter));
    let all = 0, general = 0, builtland = 0, basecamp = 0;
    for (const b of list) {
      all++;
      if (matchesCustomerType(b, 'general')) general++;
      if (matchesCustomerType(b, 'builtland')) builtland++;
      if (matchesCustomerType(b, 'basecamp')) basecamp++;
    }
    return { all, general, builtland, basecamp };
  }, [baseFilteredList, bookingChannelFilter]);

  // 3. Channel counts derived from baseFilteredList (scoped to current customer type filter)
  const channelCounts = useMemo(() => {
    const list = baseFilteredList.filter(b => matchesCustomerType(b, customerTypeFilter));
    let all = 0, pos = 0, line_oa = 0;
    for (const b of list) {
      all++;
      if (matchesBookingChannel(b, 'pos')) pos++;
      if (matchesBookingChannel(b, 'line_oa')) line_oa++;
    }
    return { all, pos, line_oa };
  }, [baseFilteredList, customerTypeFilter]);

  // 4. Dimensional-filtered bookings list (Customer Type AND Booking Channel)
  const dimFilteredList = useMemo(() => {
    return baseFilteredList.filter(b => matchesCustomerType(b, customerTypeFilter) && matchesBookingChannel(b, bookingChannelFilter));
  }, [baseFilteredList, customerTypeFilter, bookingChannelFilter]);

  // 5. Status lists & counts derived from dimFilteredList
  const reviewingBookingsList = useMemo(() => {
    return dimFilteredList.filter(b => {
      const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
      const isCancelled = b.payment_status === 'cancelled';
      const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
      return !isPaid && !isCancelled && !isRejected && (b.payment_status === 'reviewing' || !!b.slip_image_url);
    });
  }, [dimFilteredList]);

  const pendingBookingsList = useMemo(() => {
    return dimFilteredList.filter(b => {
      const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
      const isCancelled = b.payment_status === 'cancelled';
      const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
      const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url);
      return !isPaid && !isCancelled && (!isReviewing || isRejected);
    });
  }, [dimFilteredList]);

  const paidBookingsList = useMemo(() => {
    return dimFilteredList.filter(b => b.payment_status === 'paid' || b.payment_status === 'internal_free');
  }, [dimFilteredList]);

  const cancelledBookingsList = useMemo(() => {
    return dimFilteredList.filter(b => b.payment_status === 'cancelled');
  }, [dimFilteredList]);

  const taxInvoiceList = useMemo(() => {
    return dimFilteredList.filter(b => b.tax_invoice_required === 1);
  }, [dimFilteredList]);

  const totalCount = dimFilteredList.length;
  const reviewingCount = reviewingBookingsList.length;
  const pendingCount = pendingBookingsList.length;
  const paidCount = paidBookingsList.length;
  const cancelledCount = cancelledBookingsList.length;
  const taxInvoiceCount = taxInvoiceList.length;

  const totalAmountPaid = paidBookingsList.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);
  const totalAmountPending = pendingBookingsList.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0) + reviewingBookingsList.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);

  // Global reviewing count across all bookings in database for header alert pill
  const globalReviewingCount = useMemo(() => {
    return bookings.filter(b => {
      const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
      const isCancelled = b.payment_status === 'cancelled';
      const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
      return !isPaid && !isCancelled && !isRejected && (b.payment_status === 'reviewing' || !!b.slip_image_url);
    }).length;
  }, [bookings]);

  // Global pending count across all bookings in database for header quick indicator
  const globalPendingCount = useMemo(() => {
    return bookings.filter(b => {
      const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
      const isCancelled = b.payment_status === 'cancelled';
      const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
      const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url);
      return !isPaid && !isCancelled && !isReviewing && !isRejected;
    }).length;
  }, [bookings]);

  // 6. Final status-filtered list for table display
  const filteredBookings = useMemo(() => {
    if (activeStatusTab === 'reviewing') return reviewingBookingsList;
    if (activeStatusTab === 'pending') return pendingBookingsList;
    if (activeStatusTab === 'paid') return paidBookingsList;
    if (activeStatusTab === 'cancelled') return cancelledBookingsList;
    if (activeStatusTab === 'tax_invoice') return taxInvoiceList;
    return dimFilteredList;
  }, [activeStatusTab, reviewingBookingsList, pendingBookingsList, paidBookingsList, cancelledBookingsList, taxInvoiceList, dimFilteredList]);

  // 7. Exactly One Primary Action Helper by Status
  const getPrimaryAction = (b) => {
    const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
    const isCancelled = b.payment_status === 'cancelled';
    const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
    const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url) && !isPaid && !isCancelled && !isRejected;

    // 1. reviewing -> ตรวจสลิป
    if (isReviewing) {
      return {
        type: 'review_slip',
        label: 'ตรวจสลิป',
        icon: Eye,
        className: 'pb-primary-action-btn pb-btn-review',
        style: {
          backgroundColor: '#2563eb',
          borderColor: '#2563eb',
          color: '#ffffff',
          boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
          padding: '5px 11px',
          fontSize: '0.76rem',
          borderRadius: '8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          border: 'none',
          cursor: 'pointer'
        },
        onClick: (e) => { e.stopPropagation(); setViewingSlipBooking(b); }
      };
    }

    // 2. pending -> รับชำระเงิน
    if (!isPaid && !isCancelled && !isRejected) {
      return {
        type: 'pay',
        label: 'รับชำระเงิน',
        icon: DollarSign,
        className: 'pb-primary-action-btn pb-btn-pay',
        style: {
          backgroundColor: '#f59e0b',
          borderColor: '#f59e0b',
          color: '#ffffff',
          boxShadow: '0 2px 8px rgba(245, 158, 11, 0.25)',
          padding: '5px 11px',
          fontSize: '0.76rem',
          borderRadius: '8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          border: 'none',
          cursor: 'pointer'
        },
        onClick: (e) => { e.stopPropagation(); handleOpenPayModal(b); }
      };
    }

    // 3. paid / internal_free -> ดูการจอง
    if (isPaid && !isCancelled) {
      return {
        type: 'receipt',
        label: 'ดูการจอง',
        icon: FileText,
        className: 'pb-primary-action-btn pb-btn-view',
        style: {
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderColor: 'rgba(16, 185, 129, 0.3)',
          color: '#10b981',
          padding: '5px 11px',
          fontSize: '0.76rem',
          borderRadius: '8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          cursor: 'pointer'
        },
        onClick: (e) => { e.stopPropagation(); handleOpenReceipt(b); }
      };
    }

    // 4. rejected -> ดูรายละเอียด
    if (isRejected) {
      return {
        type: 'details',
        label: 'ดูรายละเอียด',
        icon: FileText,
        className: 'pb-primary-action-btn pb-btn-details',
        style: {
          backgroundColor: 'rgba(239, 68, 68, 0.08)',
          borderColor: 'rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          padding: '5px 11px',
          fontSize: '0.76rem',
          borderRadius: '8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          cursor: 'pointer'
        },
        onClick: (e) => { e.stopPropagation(); handleOpenReceipt(b); }
      };
    }

    // 5. cancelled -> ดูรายละเอียด
    return {
      type: 'details',
      label: 'ดูรายละเอียด',
      icon: FileText,
      className: 'pb-primary-action-btn pb-btn-details',
      style: {
        backgroundColor: 'var(--bg-hover)',
        borderColor: 'var(--border-color)',
        color: 'var(--text-muted)',
        padding: '5px 11px',
        fontSize: '0.76rem',
        borderRadius: '8px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        border: '1px solid var(--border-color)',
        cursor: 'pointer'
      },
      onClick: (e) => { e.stopPropagation(); handleOpenReceipt(b); }
    };
  };

  // Sorting
  const getSortedBookings = () => {
    const sorted = [...filteredBookings];
    sorted.sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];

      if (sortKey === 'id') {
        valA = Number(a.id);
} else if (sortKey === 'usage_date') {
        const getTs = (item) => {
          const s = item.items?.[0]?.start_time || item.start_time || item.booking_date;
          if (!s) return 0;
          const t = new Date(s).getTime();
          return isNaN(t) ? 0 : t;
        };
        valA = getTs(a);
        valB = getTs(b);
      } else if (sortKey === 'total_amount') {
        valA = Number(a.total_amount);
        valB = Number(b.total_amount);
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

  // Pagination Calculations
  const totalRows = sortedBookings.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage) || 1;
  const indexOfLastRow = currentPage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const paginatedBookings = sortedBookings.slice(indexOfFirstRow, indexOfLastRow);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
      {/* Embedded CSS for responsive table vs cards */}
      <style>{`
        @media (min-width: 901px) {
          .pos-booking-table-wrapper { display: block !important; }
          .pos-booking-cards-wrapper { display: none !important; }
        }
        @media (max-width: 900px) {
          .pos-booking-table-wrapper { display: none !important; }
          .pos-booking-cards-wrapper { display: flex !important; flex-direction: column !important; gap: 10px !important; }
        }
        .filter-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 0.78rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
          user-select: none;
          white-space: nowrap;
          border: 1px solid var(--border-color);
          background: var(--bg-hover);
          color: var(--text-muted);
        }
        .filter-chip:hover {
          color: var(--text-main);
          border-color: var(--primary-color);
        }
        .filter-chip.active {
          background: var(--primary-color);
          color: #ffffff;
          border-color: var(--primary-color);
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
        }
        .action-menu-item {
          padding: 9px 12px;
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

      {/* 1. Header Panel (Typography-first, flat, minimal) */}
      <div className="pb-console-header">
        <div className="pb-header-left">
          <h1 className="pb-header-title">Booking Management</h1>
          <p className="pb-header-subtitle">
            จัดการรายการจอง การชำระเงิน และการใช้งานห้องประชุม
          </p>
        </div>

        <div className="pb-header-right">
          <button
            type="button"
            className="pb-btn-action"
            onClick={() => fetchBookings(false)}
            disabled={loading || isRefreshing}
            title="รีเฟรชข้อมูลการจอง"
          >
            <RefreshCw size={13} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            <span>{isRefreshing ? 'กำลังโหลด...' : 'รีเฟรช'}</span>
          </button>

          {onNavigateToBook && (
            <button
              type="button"
              className="pb-btn-create"
              onClick={onNavigateToBook}
              title="สร้างรายการจองห้องประชุมใหม่"
            >
              <Plus size={15} />
              <span>สร้างการจอง</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Status Segmented Tabs Strip (Flat, touch target >= 44px, no glowing badges) */}
      <div className="pb-status-tabs-strip">
        {[
          { key: 'all', label: 'ทั้งหมด', count: totalCount },
          { key: 'reviewing', label: 'รอตรวจสลิป', count: reviewingCount, isAlert: reviewingCount > 0 },
          { key: 'pending', label: 'รอชำระเงิน', count: pendingCount },
          { key: 'paid', label: 'ชำระแล้ว', count: paidCount },
          { key: 'cancelled', label: 'ยกเลิก', count: cancelledCount },
          ...(taxInvoiceCount > 0 ? [{ key: 'tax_invoice', label: 'ขอใบกำกับภาษี', count: taxInvoiceCount }] : [])
        ].map(tab => {
          const isActive = activeStatusTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveStatusTab(tab.key);
                setCurrentPage(1);
              }}
              className={`pb-status-tab ${isActive ? 'active' : ''} ${tab.isAlert ? 'is-alert' : ''}`}
            >
              <span>{tab.label}</span>
              <span className="pb-status-tab-count">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Filter Console Toolbar (One cohesive toolbar: Search, Date Type, Dates, Customer Type, Channel, Meta/Reset) */}
      <div className="pb-filter-toolbar">
        <div className="pb-filter-row">
          {/* Search Input (Single search field across the page) */}
          <div className="pb-search-container">
            <Search size={14} className="pb-search-icon" />
            <input
              type="text"
              className="pb-search-input"
              placeholder="ค้นหาชื่อ / เบอร์ / เลขที่จอง"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="pb-search-clear"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                title="ล้างคำค้นหา"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Date Type Select */}
          <div style={{ flexShrink: 0 }}>
            <CustomSelect
              value={dateFilterType}
              onChange={val => {
                setDateFilterType(val);
                setCurrentPage(1);
              }}
              options={DATE_TYPE_OPTIONS}
              usePortal={true}
              noTruncate={true}
              triggerStyle={{
                height: '38px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 600,
                backgroundColor: 'var(--bg-hover)',
                border: dateFilterType !== 'usage_date' ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                color: dateFilterType !== 'usage_date' ? 'var(--primary-color)' : 'var(--text-main)',
                padding: '0 8px',
                width: '112px',
                whiteSpace: 'nowrap'
              }}
              menuStyle={{ minWidth: '120px' }}
            />
          </div>

          {/* Start Date & End Date */}
          <div className="pb-date-range-group">
            <CustomDatePicker
              value={startDate}
              onChange={val => {
                setStartDate(val);
                setCurrentPage(1);
              }}
              placeholder="วันเริ่มต้น"
              style={{
                height: '38px',
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
              onChange={val => {
                setEndDate(val);
                setCurrentPage(1);
              }}
              placeholder="วันสิ้นสุด"
              style={{
                height: '38px',
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

          {/* Customer Type Select */}
          <div style={{ flexShrink: 0 }}>
            <CustomSelect
              value={customerTypeFilter}
              onChange={val => {
                setCustomerTypeFilter(val);
                setCurrentPage(1);
              }}
              options={CUSTOMER_TYPE_OPTIONS}
              usePortal={true}
              noTruncate={true}
              triggerStyle={{
                height: '38px',
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

          {/* Booking Channel Toggle */}
          <div className="pb-channel-toggle">
            {[
              { key: 'all', label: 'ทั้งหมด' },
              { key: 'pos', label: 'POS' },
              { key: 'line_oa', label: 'LINE OA' }
            ].map(ch => {
              const isActive = bookingChannelFilter === ch.key;
              return (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => {
                    setBookingChannelFilter(ch.key);
                    setCurrentPage(1);
                  }}
                  className={`pb-channel-btn ${isActive ? 'active' : ''}`}
                >
                  {ch.label}
                </button>
              );
            })}
          </div>

          {/* Result Count & Reset Filters Action */}
          <div className="pb-filter-meta">
            <span className="pb-filter-count">
              พบ <strong>{totalRows}</strong> รายการ
            </span>

            <button
              type="button"
              onClick={handleResetFilters}
              disabled={!isAnyFilterActive}
              className={`pb-reset-btn ${isAnyFilterActive ? 'active' : ''}`}
              title="ล้างตัวกรองทั้งหมด"
            >
              <RotateCcw size={13} />
              <span>ล้างตัวกรอง</span>
            </button>
          </div>
        </div>

        {/* Active Filter Chips Strip (Shown ONLY when isAnyFilterActive is true) */}
        {isAnyFilterActive && (
          <div className="pb-active-chips-strip">
            <span className="pb-active-label">ตัวกรอง:</span>
            {/* Date Tag */}
            {(startDate || endDate) && (
              <span className="pb-filter-chip">
                <span>{startDate === endDate ? startDate : `${startDate || '...'} ถึง ${endDate || '...'}`}</span>
                <X
                  size={12}
                  className="pb-chip-remove"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setCurrentPage(1);
                  }}
                />
              </span>
            )}

            {/* Customer Type Tag */}
            {customerTypeFilter !== 'all' && (
              <span className="pb-filter-chip">
                <span>ประเภท: {customerTypeFilter === 'general' ? 'ทั่วไป' : customerTypeFilter === 'builtland' ? 'Builtland' : 'Basecamp'}</span>
                <X
                  size={12}
                  className="pb-chip-remove"
                  onClick={() => {
                    setCustomerTypeFilter('all');
                    setCurrentPage(1);
                  }}
                />
              </span>
            )}

            {/* Booking Channel Tag */}
            {bookingChannelFilter !== 'all' && (
              <span className="pb-filter-chip">
                <span>ช่องทาง: {bookingChannelFilter === 'pos' ? 'POS' : 'LINE OA'}</span>
                <X
                  size={12}
                  className="pb-chip-remove"
                  onClick={() => {
                    setBookingChannelFilter('all');
                    setCurrentPage(1);
                  }}
                />
              </span>
            )}


            {/* Date Type Tag (if not default) */}
            {dateFilterType !== 'usage_date' && (
              <span className="pb-filter-chip">
                <span>วันที่ทำรายการ</span>
                <X
                  size={12}
                  className="pb-chip-remove"
                  onClick={() => {
                    setDateFilterType('usage_date');
                    setCurrentPage(1);
                  }}
                />
              </span>
            )}

            {/* Search Query Tag */}
            {searchQuery && (
              <span className="pb-filter-chip">
                <span>"{searchQuery}"</span>
                <X
                  size={12}
                  className="pb-chip-remove"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                />
              </span>
            )}
          </div>
        )}
      </div>

      {/* 4. Bookings Display: Table (Desktop) & Cards (Mobile/Tablet) */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '14px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', position: 'relative', zIndex: 1 }}>

        {/* Desktop View: 6-Column Operational Table */}
        <div className="pos-booking-table-wrapper pb-table-wrapper">
          <table className="table pb-table">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead className="pb-table-head">
              <tr>
                {columns.map(col => {
                  const isSortable = col.key === 'id' || col.key === 'customer_name' || col.key === 'room_info' || col.key === 'total_amount';
                  const isCurrentSort = (col.key === 'room_info' && sortKey === 'usage_date') || sortKey === col.key;
                  let align = 'left';
                  if (col.key === 'total_amount') align = 'right';
                  if (col.key === 'actions' || col.key === 'status') align = 'center';

                  return (
                    <th
                      key={col.key}
                      onClick={() => isSortable && handleSort(col.key === 'room_info' ? 'usage_date' : col.key)}
                      className={`pb-th ${isSortable ? 'sortable' : ''}`}
                      style={{
                        textAlign: align,
                        width: col.width || 'auto'
                      }}
                    >
                      <div className={`pb-th-content align-${align}`}>
                        <span>{col.label}</span>
                        {isSortable && (
                          <span className={`pb-sort-indicator ${isCurrentSort ? 'active' : ''}`}>
                            {isCurrentSort ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={12} />
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
              {loading && !bookings.length ? (
                <tr>
                  <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <Clock size={16} />
                      <span>กำลังโหลดรายการจองห้อง...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedBookings.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                      <FileText size={32} style={{ opacity: 0.35 }} />
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                        {searchQuery || customerTypeFilter !== 'all' || bookingChannelFilter !== 'all' || activeStatusTab !== 'all'
                          ? 'ไม่พบรายการจองที่ตรงกับเงื่อนไขตัวกรอง'
                          : 'ไม่มีรายการจองห้องสำหรับช่วงเวลานี้'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {startDate && endDate && (startDate === endDate)
                          ? `(วันที่ ${startDate})`
                          : (startDate || endDate)
                          ? `(${startDate || '...'} ถึง ${endDate || '...'})`
                          : ''}
                      </div>
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="btn btn-secondary"
                        style={{ marginTop: '8px', fontSize: '0.78rem', padding: '6px 14px', borderRadius: '8px' }}
                      >
                        ล้างตัวกรองทั้งหมด
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedBookings.map((b) => {
                  const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
                  const isCancelled = b.payment_status === 'cancelled';
                  const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
                  const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url) && !isPaid && !isCancelled && !isRejected;

                  const firstItem = b.items?.[0] || {};
                  const roomObj = roomsList.find(r => r.id === (firstItem.room_id || b.room_id));
                  const roomName = firstItem.room_name || b.room_name || roomObj?.name || 'ห้องประชุม';
                  const usageDateStr = formatUsageDate(b);
                  const timeDisplay = formatUsageTime(b);
                  const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom' : 'Standard';
                  const typeLabel = firstItem.booking_type === 'daily' ? 'เหมาวัน' : firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง';
                  const rawBookingCode = b.receipt_number || b.booking_code || (b.id ? `BK-${String(b.id).padStart(6, '0')}` : '-');
                  const displayCode = rawBookingCode.startsWith('#') ? rawBookingCode : `#${rawBookingCode}`;

                  const custLabel = b.customer_type === 'builtland' ? 'Builtland' : (b.customer_type === 'basecamp' ? 'Basecamp' : 'ทั่วไป');
                  const channelLabel = (b.booking_channel === 'line_oa' || b.booking_source === 'online') ? 'LINE OA' : 'POS';

                  let pinRaw = b.pin_code || firstItem.pin_code || '';
                  if (!pinRaw && roomObj) {
                    pinRaw = (b.customer_type === 'builtland' && roomObj.builtland_pin_code) ? roomObj.builtland_pin_code : (roomObj.pin_code || '');
                  }
                  const hasPin = Boolean(pinRaw && pinRaw !== '-');
                  const isBuiltland = b.customer_type === 'builtland';

                  let rowBg = 'transparent';
                  let rowBorderLeft = '3px solid transparent';
                  if (isReviewing) {
                    rowBg = 'rgba(14, 165, 233, 0.04)';
                    rowBorderLeft = '3px solid #0284c7';
                  } else if (isRejected) {
                    rowBg = 'rgba(239, 68, 68, 0.035)';
                    rowBorderLeft = '3px solid #dc2626';
                  } else if (!isPaid && !isCancelled) {
                    rowBg = 'rgba(245, 158, 11, 0.03)';
                    rowBorderLeft = '3px solid #f59e0b';
                  } else if (isCancelled) {
                    rowBg = 'transparent';
                    rowBorderLeft = '3px solid transparent';
                  }

                  const primaryAction = getPrimaryAction(b);

                  return (
                    <tr
                      key={b.id}
                      id={`booking-row-${b.id}`}
                      className="pb-table-row"
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        borderLeft: highlightedBookingId === b.id ? '3px solid var(--primary-color)' : rowBorderLeft,
                        backgroundColor: highlightedBookingId === b.id
                          ? 'rgba(37, 99, 235, 0.15)'
                          : rowBg,
                        boxShadow: highlightedBookingId === b.id ? 'inset 0 0 0 2px var(--primary-color)' : 'none',
                        opacity: isCancelled ? 0.65 : 1,
                        transition: 'background-color 0.3s ease, box-shadow 0.3s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (highlightedBookingId !== b.id) {
                          e.currentTarget.style.backgroundColor = isReviewing ? 'rgba(14, 165, 233, 0.08)' : (isRejected ? 'rgba(239, 68, 68, 0.07)' : (!isPaid && !isCancelled ? 'rgba(245, 158, 11, 0.06)' : 'rgba(255, 255, 255, 0.03)'));
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (highlightedBookingId !== b.id) {
                          e.currentTarget.style.backgroundColor = rowBg;
                        }
                      }}
                    >
                      {/* Column 1: Booking */}
                      <td className="pb-td">
                        <div className="pb-cell-booking">
                          <span className="pb-booking-code" title={displayCode}>{displayCode}</span>
                          <span className="pb-sub-text">{formatDate(b.created_at)}</span>
                          <span className="pb-tertiary-text">
                            {channelLabel} • {custLabel}
                          </span>
                        </div>
                      </td>

                      {/* Column 2: Customer */}
                      <td className="pb-td">
                        <div className="pb-cell-customer">
                          <span className="pb-primary-text" title={b.customer_name || '-'}>{b.customer_name || '-'}</span>
                          {b.contact ? (
                            <span className="pb-sub-text pb-contact-line">
                              <Phone size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                              <span>{b.contact}</span>
                            </span>
                          ) : null}
                          {b.tax_invoice_required === 1 && (
                            <button
                              type="button"
                              className="pb-tax-pill"
                              onClick={(e) => { e.stopPropagation(); setSelectedTaxBooking(b); }}
                              title="คลิกดูข้อมูลใบกำกับภาษี"
                            >
                              <FileText size={10} />
                              <span>ใบกำกับภาษี</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Column 3: Room & Schedule */}
                      <td className="pb-td">
                        <div className="pb-cell-schedule">
                          <span className="pb-primary-text pb-room-name" title={roomName}>{roomName}</span>
                          <span className="pb-schedule-time">
                            {usageDateStr} {timeDisplay && timeDisplay !== '-' ? `• ${timeDisplay}` : ''}
                          </span>
                          <span className="pb-tertiary-text">
                            {layoutLabel} • {typeLabel}
                          </span>
                        </div>
                      </td>

                      {/* Column 4: Payment */}
                      <td className="pb-td" style={{ textAlign: 'right' }}>
                        <div className="pb-cell-payment" style={{ alignItems: 'flex-end' }}>
                          <span className="pb-payment-amount" style={{ color: isPaid ? '#10b981' : (isCancelled ? 'var(--text-muted)' : '#f59e0b') }}>
                            ฿{Number(b.total_amount || 0).toLocaleString()}
                          </span>
                          <span className="pb-sub-text">
                            {b.payment_method === 'hour_credit' ? 'เครดิตชั่วโมง' : b.payment_method === 'cash' ? 'เงินสด' : (b.payment_method === 'transfer' ? 'โอนเงิน' : (b.payment_method || '-'))}
                          </span>
                          {b.slip_image_url && (
                            <span className="pb-slip-indicator">
                              มีสลิปแนบ
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Column 5: Status & Access (Combined Status + Door PIN) */}
                      <td className="pb-td" style={{ textAlign: 'center' }}>
                        <div className="pb-cell-status-access">
                          {/* Status Badge */}
                          {isReviewing ? (
                            <span className="pb-status-badge pb-status-reviewing">
                              <Eye size={11} />
                              <span>รอตรวจสลิป</span>
                            </span>
                          ) : isRejected ? (
                            <span className="pb-status-badge pb-status-rejected">
                              <AlertCircle size={11} />
                              <span>สลิปไม่ผ่าน</span>
                            </span>
                          ) : !isPaid && !isCancelled ? (
                            <span className="pb-status-badge pb-status-pending">
                              <Clock size={11} />
                              <span>รอชำระเงิน</span>
                            </span>
                          ) : isPaid ? (
                            <span className="pb-status-badge pb-status-paid">
                              <CheckCircle2 size={11} />
                              <span>ชำระแล้ว</span>
                            </span>
                          ) : (
                            <span className="pb-status-badge pb-status-cancelled">
                              <Ban size={11} />
                              <span>ยกเลิก</span>
                            </span>
                          )}

                          {/* Door PIN (only when available) */}
                          {hasPin && (
                            <div className="pb-pin-strip">
                              {isBuiltland && (
                                <span className="pb-pin-company-tag">
                                  <Key size={9} />
                                  <span>PIN บริษัท</span>
                                </span>
                              )}
                              <span
                                className="pb-pin-code"
                                title={revealedPins[b.id] ? `รหัสเข้าห้อง: ${pinRaw}` : 'รหัสถูกซ่อนอยู่ คลิกเพื่อเปิดเผย'}
                              >
                                {revealedPins[b.id] ? pinRaw : '••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleToggleRevealPin(b.id); }}
                                className="pb-pin-btn"
                                title={revealedPins[b.id] ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                                aria-label={revealedPins[b.id] ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                              >
                                {revealedPins[b.id] ? <EyeOff size={11} /> : <Eye size={11} />}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleCopyPin(b.id, pinRaw); }}
                                className={`pb-pin-btn ${copiedPin === b.id ? 'copied' : ''}`}
                                title={copiedPin === b.id ? 'คัดลอกเรียบร้อย' : 'คัดลอกรหัส'}
                                aria-label="คัดลอกรหัส"
                              >
                                {copiedPin === b.id ? <Check size={11} /> : <Copy size={11} />}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Column 6: Actions (1 Primary Action + More ...) */}
                      <td className="pb-td" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <div className="pb-actions-group">
                          <button
                            type="button"
                            onClick={primaryAction.onClick}
                            className={primaryAction.className}
                            style={primaryAction.style}
                            title={primaryAction.label}
                          >
                            <primaryAction.icon size={13} />
                            <span>{primaryAction.label}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleToggleActionMenu(e, b)}
                            className={`pb-more-btn ${activeActionMenuBooking?.id === b.id ? 'active' : ''}`}
                            title="เมนูเพิ่มเติม"
                            aria-label="เมนูเพิ่มเติม"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View: Compact Responsive Cards (<= 900px) */}
        <div className="pos-booking-cards-wrapper pb-mobile-cards-container">
          {loading && !bookings.length ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              กำลังโหลดรายการจองห้อง...
            </div>
          ) : paginatedBookings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)' }}>
              <FileText size={28} style={{ opacity: 0.35, marginBottom: '6px' }} />
              <div style={{ fontWeight: 700 }}>ไม่พบรายการจองที่ตรงกับเงื่อนไข</div>
              <button
                type="button"
                onClick={handleResetFilters}
                className="btn btn-secondary"
                style={{ marginTop: '8px', fontSize: '0.78rem', padding: '6px 14px', borderRadius: '8px' }}
              >
                ล้างตัวกรองทั้งหมด
              </button>
            </div>
          ) : (
            paginatedBookings.map((b) => {
              const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
              const isCancelled = b.payment_status === 'cancelled';
              const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
              const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url) && !isPaid && !isCancelled && !isRejected;

              const firstItem = b.items?.[0] || {};
              const roomObj = roomsList.find(r => r.id === (firstItem.room_id || b.room_id));
              const roomName = firstItem.room_name || b.room_name || roomObj?.name || 'ห้องประชุม';
              const usageDateStr = formatUsageDate(b);
              const timeDisplay = formatUsageTime(b);
              const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom' : 'Standard';
              const typeLabel = firstItem.booking_type === 'daily' ? 'เหมาวัน' : firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง';
              const rawBookingCode = b.receipt_number || b.booking_code || (b.id ? `BK-${String(b.id).padStart(6, '0')}` : '-');
              const displayCode = rawBookingCode.startsWith('#') ? rawBookingCode : `#${rawBookingCode}`;

              const custLabel = b.customer_type === 'builtland' ? 'Builtland' : (b.customer_type === 'basecamp' ? 'Basecamp' : 'ทั่วไป');
              const channelLabel = (b.booking_channel === 'line_oa' || b.booking_source === 'online') ? 'LINE OA' : 'POS';

              let pinRaw = b.pin_code || firstItem.pin_code || '';
              if (!pinRaw && roomObj) {
                pinRaw = (b.customer_type === 'builtland' && roomObj.builtland_pin_code) ? roomObj.builtland_pin_code : (roomObj.pin_code || '');
              }
              const hasPin = Boolean(pinRaw && pinRaw !== '-');
              const isBuiltland = b.customer_type === 'builtland';

              const primaryAction = getPrimaryAction(b);

              return (
                <div
                  key={b.id}
                  id={`booking-card-${b.id}`}
                  className={`pb-mobile-card ${isReviewing ? 'is-reviewing' : ''} ${isCancelled ? 'is-cancelled' : ''} ${highlightedBookingId === b.id ? 'is-highlighted' : ''}`}
                >
                  {/* 1. Top Row: Booking ID + Status Badge */}
                  <div className="pb-mobile-card-header">
                    <div className="pb-mobile-header-left">
                      <span className="pb-mobile-booking-code">{displayCode}</span>
                      <span className="pb-mobile-meta-subline">
                        {channelLabel} • {custLabel}
                      </span>
                    </div>

                    <div>
                      {isReviewing ? (
                        <span className="pb-status-badge pb-status-reviewing">
                          <Eye size={11} />
                          <span>รอตรวจสลิป</span>
                        </span>
                      ) : isRejected ? (
                        <span className="pb-status-badge pb-status-rejected">
                          <AlertCircle size={11} />
                          <span>สลิปไม่ผ่าน</span>
                        </span>
                      ) : !isPaid && !isCancelled ? (
                        <span className="pb-status-badge pb-status-pending">
                          <Clock size={11} />
                          <span>รอชำระเงิน</span>
                        </span>
                      ) : isPaid ? (
                        <span className="pb-status-badge pb-status-paid">
                          <CheckCircle2 size={11} />
                          <span>ชำระแล้ว</span>
                        </span>
                      ) : (
                        <span className="pb-status-badge pb-status-cancelled">
                          <Ban size={11} />
                          <span>ยกเลิก</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 2. Room & Schedule (Visually Prominent) */}
                  <div className="pb-mobile-card-schedule">
                    <div className="pb-mobile-room-name">{roomName}</div>
                    <div className="pb-mobile-usage-time">
                      {usageDateStr} {timeDisplay && timeDisplay !== '-' ? `• ${timeDisplay}` : ''}
                    </div>
                    <div className="pb-mobile-layout-type">
                      {layoutLabel} • {typeLabel}
                    </div>
                  </div>

                  {/* 3. Customer Info */}
                  <div className="pb-mobile-card-customer">
                    <div className="pb-mobile-cust-info">
                      <span className="pb-mobile-cust-name">{b.customer_name || '-'}</span>
                      {b.contact ? (
                        <span className="pb-mobile-cust-phone">
                          <Phone size={10} style={{ opacity: 0.7 }} />
                          <span>{b.contact}</span>
                        </span>
                      ) : null}
                    </div>

                    {b.tax_invoice_required === 1 && (
                      <button
                        type="button"
                        className="pb-tax-pill"
                        onClick={(e) => { e.stopPropagation(); setSelectedTaxBooking(b); }}
                        title="คลิกดูข้อมูลใบกำกับภาษี"
                      >
                        <FileText size={10} />
                        <span>ใบกำกับภาษี</span>
                      </button>
                    )}
                  </div>

                  {/* 4. Payment & Access (Amount, Method, Slip, and Door PIN) */}
                  <div className="pb-mobile-card-payment-access">
                    <div className="pb-mobile-payment-block">
                      <span
                        className="pb-mobile-amount"
                        style={{ color: isPaid ? '#10b981' : (isCancelled ? 'var(--text-muted)' : '#f59e0b') }}
                      >
                        ฿{Number(b.total_amount || 0).toLocaleString()}
                      </span>
                      <span className="pb-mobile-method">
                        {b.payment_method === 'hour_credit' ? 'เครดิตชั่วโมง' : b.payment_method === 'cash' ? 'เงินสด' : (b.payment_method === 'transfer' ? 'โอนเงิน' : (b.payment_method || '-'))}
                      </span>
                      {b.slip_image_url && (
                        <span className="pb-slip-indicator">มีสลิปแนบ</span>
                      )}
                    </div>

                    {/* Door PIN (only when available) */}
                    {hasPin && (
                      <div className="pb-mobile-pin-block">
                        <span className="pb-mobile-pin-label">PIN</span>
                        {isBuiltland && (
                          <span className="pb-pin-company-tag">
                            <Key size={9} />
                            <span>บริษัท</span>
                          </span>
                        )}
                        <span
                          className="pb-pin-code"
                          title={revealedPins[b.id] ? `รหัสเข้าห้อง: ${pinRaw}` : 'รหัสถูกซ่อนอยู่ คลิกเพื่อเปิดเผย'}
                        >
                          {revealedPins[b.id] ? pinRaw : '••••••'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleToggleRevealPin(b.id); }}
                          className="pb-pin-btn pb-pin-btn-mobile"
                          title={revealedPins[b.id] ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                          aria-label={revealedPins[b.id] ? 'ซ่อนรหัส' : 'แสดงรหัส'}
                        >
                          {revealedPins[b.id] ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCopyPin(b.id, pinRaw); }}
                          className={`pb-pin-btn pb-pin-btn-mobile ${copiedPin === b.id ? 'copied' : ''}`}
                          title={copiedPin === b.id ? 'คัดลอกเรียบร้อย' : 'คัดลอกรหัส'}
                          aria-label="คัดลอกรหัส"
                        >
                          {copiedPin === b.id ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 5. Bottom Action Bar: [ Primary Action ] [ More ... ] */}
                  <div className="pb-mobile-action-bar">
                    <button
                      type="button"
                      onClick={primaryAction.onClick}
                      className={`pb-primary-action-btn pb-mobile-action-primary ${primaryAction.className || ''}`}
                      style={primaryAction.style}
                      title={primaryAction.label}
                    >
                      <primaryAction.icon size={15} />
                      <span>{primaryAction.label}</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleToggleActionMenu(e, b)}
                      className={`pb-more-btn pb-mobile-action-more ${activeActionMenuBooking?.id === b.id ? 'active' : ''}`}
                      title="เมนูเพิ่มเติม"
                      aria-label="เมนูเพิ่มเติม"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
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
          }}>
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

      {/* ========================================================= */}
      {/*  GLOBAL FIXED ACTION DROPDOWN MENU                        */}
      {/* ========================================================= */}
      {activeActionMenuBooking && actionMenuPos && (
        <>
          <div
            onClick={(e) => { e.stopPropagation(); setActiveActionMenuBooking(null); setActionMenuPos(null); }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }}
          />
          <div className="action-dropdown-menu" style={{
            position: 'fixed',
            ...(actionMenuPos.top !== undefined ? { top: `${actionMenuPos.top}px` } : { bottom: `${actionMenuPos.bottom}px` }),
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
          }}>
            <div style={{ padding: '6px 12px 4px 12px', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              การดำเนินการ (#{activeActionMenuBooking.id})
            </div>

            {/* 1. Reschedule (active bookings only) */}
            {activeActionMenuBooking.payment_status !== 'cancelled' && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenReschedule(b); }}
                className="action-menu-item"
              >
                <Edit3 size={14} style={{ color: '#6366f1' }} />
                <span>แก้ไขวัน/เวลาการจอง</span>
              </div>
            )}

            {/* 2. View Operational Booking Detail (when not already primary action) */}
            {activeActionMenuBooking.payment_status !== 'paid' &&
             activeActionMenuBooking.payment_status !== 'internal_free' &&
             activeActionMenuBooking.payment_status !== 'rejected' &&
             activeActionMenuBooking.payment_status !== 'cancelled' &&
             activeActionMenuBooking.slip_verify_status !== 'rejected' && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenBookingDetail(b); }}
                className="action-menu-item"
              >
                <FileText size={14} style={{ color: 'var(--primary-color)' }} />
                <span>ดูรายละเอียดการจอง</span>
              </div>
            )}

            {/* 2.1 Direct Print Receipt Action */}
            <div
              onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenReceiptPrint(b); }}
              className="action-menu-item"
            >
              <Printer size={14} style={{ color: 'var(--text-muted)' }} />
              <span>พิมพ์ใบเสร็จ</span>
            </div>

            {/* 3. View Slip Image (Show if slip exists AND primary is NOT already reviewing/ตรวจสลิป) */}
            {activeActionMenuBooking.slip_image_url &&
             activeActionMenuBooking.payment_status !== 'reviewing' && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); setViewingSlipBooking(b); }}
                className="action-menu-item"
              >
                <Eye size={14} style={{ color: '#0ea5e9' }} />
                <span>ดูรูปภาพสลิปโอนเงิน</span>
              </div>
            )}

            {/* 4. Send Door PIN via LINE (active bookings) */}
            {activeActionMenuBooking.payment_status !== 'cancelled' && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleSendPin(b.id); }}
                className="action-menu-item"
              >
                <Send size={14} style={{ color: '#2563eb' }} />
                <span>ส่งรหัส PIN เข้า LINE OA</span>
              </div>
            )}

            {/* 5. Tax Invoice Info */}
            {activeActionMenuBooking.tax_invoice_required === 1 && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); setSelectedTaxBooking(b); }}
                className="action-menu-item"
                style={{ color: '#2563eb', fontWeight: 700 }}
              >
                <FileText size={14} style={{ color: '#2563eb' }} />
                <span>ดูข้อมูลใบกำกับภาษี</span>
              </div>
            )}

            {/* 6. Revert Payment (only if paid) */}
            {activeActionMenuBooking.payment_status === 'paid' && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); revertPayment(b); }}
                className="action-menu-item"
                style={{ color: '#f59e0b' }}
              >
                <RotateCcw size={14} />
                <span>ยกเลิกการยืนยันชำระ (คืนสถานะ)</span>
              </div>
            )}

            {/* Separator for Destructive Zone */}
            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />
            <div style={{ padding: '4px 12px 2px 12px', fontSize: '0.68rem', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              การจัดการขั้นสูง (อันตราย)
            </div>

            {/* 7. Soft Cancel Booking (not if already cancelled) */}
            {activeActionMenuBooking.payment_status !== 'cancelled' && (
              <div
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenCancelModal(b); }}
                className="action-menu-item action-menu-danger"
                style={{ color: '#ef4444' }}
              >
                <Ban size={14} />
                <span>ยกเลิกการจอง</span>
              </div>
            )}

            {/* 8. Hard Permanent Delete */}
            <div
              onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handlePermanentDelete(b); }}
              className="action-menu-item action-menu-danger"
              style={{ color: '#dc2626', fontWeight: 700 }}
            >
              <Trash2 size={14} />
              <span>ลบรายการออกจากระบบถาวร</span>
            </div>
          </div>
        </>
      )}

      {/* ========================================================= */}
      {/*  PAYMENT / SLIP VERIFICATION MODAL                        */}
      {/* ========================================================= */}
      {showPayModal && selectedBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '460px',
            padding: '24px',
            borderRadius: '20px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <button
              style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setShowPayModal(false)}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
              <CheckCircle2 size={22} style={{ color: '#10b981' }} />
              <span>พนักงานยืนยันการรับชำระเงิน</span>
            </h3>

            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              ใบจอง <strong>{selectedBooking?.receipt_number || `#${selectedBooking?.id}`}</strong> ({selectedBooking?.booking_source === 'online' ? 'จองออนไลน์' : 'Walk-in'})<br />
              ลูกค้า: <strong>{selectedBooking?.customer_name || '-'}</strong> | ยอดสุทธิ <strong style={{ color: '#10b981', fontSize: '1.05rem' }}>฿{Number(selectedBooking?.total_amount || 0).toLocaleString()}</strong>
            </p>

            {/* Tax Invoice Request Info */}
            {selectedBooking?.tax_invoice_required === 1 && (
              <div style={{ padding: '10px 12px', borderRadius: '10px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)', fontSize: '0.8rem' }}>
                <div style={{ color: '#3b82f6', fontWeight: 800, marginBottom: '4px' }}>📄 ลูกค้าขอใบกำกับภาษี (Tax Invoice):</div>
                <div style={{ color: 'var(--text-main)' }}><strong>ชื่อ:</strong> {selectedBooking.tax_name} | <strong>เลข 13 หลัก:</strong> {selectedBooking.tax_id}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}><strong>ที่อยู่:</strong> {selectedBooking.tax_address}</div>
                <div style={{ color: '#3b82f6', fontSize: '0.75rem', marginTop: '2px' }}>
                  <strong>จัดส่ง:</strong> {selectedBooking.tax_delivery_method === 'postal' ? `ไปรษณีย์ (${selectedBooking.tax_postal_address || selectedBooking.tax_address})` : (selectedBooking.tax_delivery_method === 'pickup' ? 'รับหน้าร้าน' : 'อีเมล')}
                </div>
              </div>
            )}

            {/* Slip Image View if attached */}
            {selectedBooking?.slip_image_url && selectedBooking?.slip_image_url !== 'uploaded' && (
              <div style={{ textAlign: 'center', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0ea5e9', display: 'block', marginBottom: '8px' }}>รูปภาพสลิปโอนเงินจากลูกค้า:</span>
                <a href={selectedBooking.slip_image_url} target="_blank" rel="noreferrer" title="คลิกเพื่อดูรูปสลิปขนาดเต็ม">
                  <img src={selectedBooking.slip_image_url} alt="สลิปการชำระเงิน" style={{ maxHeight: '200px', maxWidth: '100%', borderRadius: '10px', border: '1px solid var(--border-color)', objectFit: 'contain', cursor: 'zoom-in' }} />
                </a>
                <div style={{ marginTop: '6px' }}>
                  <a href={selectedBooking.slip_image_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem', color: 'var(--primary-color)', textDecoration: 'underline' }}>
                    คลิกดูสลิปขนาดเต็ม (Full Size)
                  </a>
                </div>
              </div>
            )}

            {/* Payment Method Selector */}
            <div className="form-group" style={{ marginTop: '4px', position: 'relative' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                เลือกช่องทางการรับชำระเงิน
              </label>
              <div
                className="form-control"
                onClick={() => setIsPayMethodOpen(!isPayMethodOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: '42px',
                  fontSize: '0.9rem',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                  padding: '0 14px',
                  fontWeight: 600
                }}
              >
                <span style={{ color: 'var(--text-main)' }}>
                  {payMethod === 'cash' ? 'เงินสด (Cash)' : payMethod === 'transfer' ? 'โอนเงินเข้าบัญชี (Transfer)' : payMethod}
                </span>
                <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
              </div>

              {isPayMethodOpen && (
                <>
                  <div onClick={() => setIsPayMethodOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                  <div className="liquidglass-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000, borderRadius: '12px', padding: '6px' }}>
                    <div
                      onClick={() => { setPayMethod('cash'); setIsPayMethodOpen(false); }}
                      style={{ padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', color: payMethod === 'cash' ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: payMethod === 'cash' ? 'bold' : 'normal', background: payMethod === 'cash' ? 'rgba(37, 99, 235, 0.15)' : 'transparent', transition: 'all 0.2s', marginBottom: '2px' }}
                    >
                      เงินสด (Cash)
                    </div>
                    <div
                      onClick={() => { setPayMethod('transfer'); setIsPayMethodOpen(false); }}
                      style={{ padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', color: payMethod === 'transfer' ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: payMethod === 'transfer' ? 'bold' : 'normal', background: payMethod === 'transfer' ? 'rgba(37, 99, 235, 0.15)' : 'transparent', transition: 'all 0.2s', marginBottom: '2px' }}
                    >
                      โอนเงินเข้าบัญชี (Transfer)
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button className="btn btn-secondary" style={{ flex: 1, borderRadius: '12px' }} onClick={() => setShowPayModal(false)}>
                ยกเลิก
              </button>
              <button className="btn btn-primary" style={{ flex: 2, borderRadius: '12px', backgroundColor: '#10b981', borderColor: '#10b981', fontWeight: 'bold' }} onClick={submitPayment}>
                <CheckCircle2 size={16} style={{ marginRight: '6px' }} />
                <span>ยืนยันการรับชำระเงิน</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/*  OPERATIONAL BOOKING DETAIL MODAL (Phase E)               */}
      {/* ========================================================= */}
      {showDetailModal && selectedBooking && (() => {
        const b = selectedBooking;
        const firstItem = b.items?.[0] || {};
        const roomObj = roomsList?.find(r => r.id === (firstItem.room_id || b.room_id));
        const roomName = firstItem.room_name || b.room_name || roomObj?.name || 'ห้องประชุม';
        const usageDateStr = formatUsageDate(b);
        const usageTimeStr = formatUsageTime(b);
        const rawBookingCode = b.receipt_number || b.booking_code || (b.id ? `BK-${String(b.id).padStart(6, '0')}` : '-');
        const displayCode = rawBookingCode.startsWith('#') ? rawBookingCode : `#${rawBookingCode}`;
        const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
        const isCancelled = b.payment_status === 'cancelled';
        const isRejected = b.payment_status === 'rejected' || b.slip_verify_status === 'rejected';
        const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url) && !isPaid && !isCancelled && !isRejected;
        const isPending = !isPaid && !isCancelled && !isRejected && !isReviewing;

        const customerName = b.customer_name || b.contact_name || '-';
        const contactPhone = b.contact || b.phone || '-';
        const custTypeLabel = b.customer_type === 'builtland' ? 'Builtland' : (b.customer_type === 'basecamp' ? 'Basecamp' : 'ทั่วไป');
        const channelLabel = (b.booking_channel === 'line_oa' || b.booking_source === 'online') ? 'LINE OA' : (b.booking_source === 'pos' ? 'POS' : (b.booking_source || 'Walk-in'));
        const paymentMethodLabel = b.payment_method === 'transfer' ? 'โอนเงินผ่านธนาคาร' : (b.payment_method === 'promptpay' ? 'พร้อมเพย์' : (b.payment_method || '-'));

        const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom (จัดโต๊ะเรียน)' : 'Standard (ห้องประชุมมาตรฐาน)';
        const typeLabel = firstItem.booking_type === 'daily' ? 'เหมาทั้งวัน' : (firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง');

        let pinRaw = b.pin_code || firstItem.pin_code || '';
        if (!pinRaw && roomObj) {
          pinRaw = (b.customer_type === 'builtland' && roomObj.builtland_pin_code) ? roomObj.builtland_pin_code : (roomObj.pin_code || '');
        }
        const hasPin = Boolean(pinRaw && pinRaw !== '-');
        const isPinRevealed = revealedPins[b.id];
        const isPinCopied = copiedPin === b.id;
        const hasSlip = Boolean(b.slip_image_url && b.slip_image_url !== 'uploaded');

        let statusText = 'รอชำระเงิน';
        let statusBadgeClass = 'pb-status-badge--pending';
        if (isPaid) {
          statusText = b.payment_status === 'internal_free' ? 'ใช้งานภายใน (ฟรี)' : 'ชำระเงินแล้ว';
          statusBadgeClass = 'pb-status-badge--paid';
        } else if (isCancelled) {
          statusText = 'ยกเลิกการจอง';
          statusBadgeClass = 'pb-status-badge--cancelled';
        } else if (isRejected) {
          statusText = 'สลิปถูกปฏิเสธ';
          statusBadgeClass = 'pb-status-badge--rejected';
        } else if (isReviewing) {
          statusText = 'รอตรวจสลิป';
          statusBadgeClass = 'pb-status-badge--reviewing';
        }

        return (
          <div className="pb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pb-detail-modal-title">
            <div className="pb-detail-modal">
              {/* HEADER */}
              <div className="pb-detail-modal-header">
                <div className="pb-detail-header-left">
                  <div className="pb-detail-title-row">
                    <h3 id="pb-detail-modal-title" className="pb-detail-modal-title">
                      {displayCode}
                    </h3>
                    <span className={`pb-status-badge ${statusBadgeClass}`}>
                      {statusText}
                    </span>
                  </div>
                  <div className="pb-detail-subtitle">
                    <span>ช่องทาง: <strong style={{ color: 'var(--text-main)' }}>{channelLabel}</strong></span>
                    <span className="pb-detail-sep">·</span>
                    <span>สร้างเมื่อ: {formatCreatedDateTime(b.created_at)}</span>
                  </div>
                </div>

                <div className="pb-detail-header-right">
                  <button
                    type="button"
                    className="pb-slip-modal-close"
                    onClick={() => setShowDetailModal(false)}
                    aria-label="ปิดหน้าต่าง"
                    title="ปิดหน้าต่าง"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* BODY: 2-COLUMN GRID */}
              <div className="pb-detail-modal-body">
                <div className="pb-detail-grid">
                  {/* LEFT COLUMN */}
                  <div className="pb-detail-col">
                    {/* 1. ROOM & SERVICE (Strongest Section) */}
                    <div className="pb-detail-card">
                      <div className="pb-detail-card-header">
                        <span className="pb-detail-card-title">ห้องและการใช้งาน</span>
                      </div>
                      <div className="pb-detail-content">
                        <div className="pb-detail-field-group">
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">ห้องประชุม</span>
                            <span className="pb-detail-val pb-detail-val--strong">{roomName}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">วันที่ใช้งาน</span>
                            <span className="pb-detail-val pb-detail-val--strong">{usageDateStr}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">เวลาใช้งาน</span>
                            <span className="pb-detail-val">{usageTimeStr}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">รูปแบบการจัดโต๊ะ</span>
                            <span className="pb-detail-val">{layoutLabel}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">ประเภทแพ็กเกจ</span>
                            <span className="pb-detail-val">{typeLabel}</span>
                          </div>
                        </div>

                        {/* Additional items if multi-room/service */}
                        {b.items && b.items.length > 1 && (
                          <div className="pb-detail-sub-items">
                            <span className="pb-detail-sub-items-title">รายการห้อง/บริการทั้งหมด ({b.items.length} รายการ):</span>
                            {b.items.map((it, idx) => (
                              <div key={idx} className="pb-detail-sub-item-row">
                                <span>{it.room_name || it.service_name || `ห้อง #${it.room_id}`}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{formatUsageTime({ items: [it] })}</span>
                                <span style={{ fontWeight: 600 }}>฿{Number(it.price || 0).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 2. CUSTOMER SECTION */}
                    <div className="pb-detail-card">
                      <div className="pb-detail-card-header">
                        <span className="pb-detail-card-title">ข้อมูลผู้จอง</span>
                      </div>
                      <div className="pb-detail-content">
                        <div className="pb-detail-field-group">
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">ชื่อผู้จอง / บริษัท</span>
                            <span className="pb-detail-val pb-detail-val--strong">{customerName}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">เบอร์โทรติดต่อ</span>
                            <span className="pb-detail-val">{contactPhone}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">ประเภทลูกค้า</span>
                            <span className="pb-detail-val">{custTypeLabel}</span>
                          </div>
                          {(b.email || b.customer_email || b.tax_invoice_email) && (
                            <div className="pb-detail-field">
                              <span className="pb-detail-label">อีเมล</span>
                              <span className="pb-detail-val">{b.email || b.customer_email || b.tax_invoice_email}</span>
                            </div>
                          )}
                          {(b.notes || b.cancellation_reason) && (
                            <div className="pb-detail-field" style={{ gridColumn: '1 / -1' }}>
                              <span className="pb-detail-label">{isCancelled ? 'เหตุผลการยกเลิก' : 'หมายเหตุเพิ่มเติม'}</span>
                              <span className="pb-detail-val" style={{ color: isCancelled ? '#dc2626' : 'var(--text-main)' }}>
                                {b.cancellation_reason || b.notes}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 3. ACCESS / PIN SECTION */}
                    <div className="pb-detail-card">
                      <div className="pb-detail-card-header">
                        <span className="pb-detail-card-title">การเข้าใช้งานห้อง (Door Access)</span>
                      </div>
                      <div className="pb-detail-content">
                        {hasPin ? (
                          <div className="pb-detail-pin-box">
                            <div className="pb-detail-pin-row">
                              <div>
                                <span className="pb-detail-label">รหัส PIN ปลดล็อคประตู</span>
                                <div className="pb-detail-pin-value">
                                  {isPinRevealed ? pinRaw : '••••••'}
                                </div>
                              </div>
                              <div className="pb-detail-pin-actions">
                                <button
                                  type="button"
                                  className="pb-pin-btn"
                                  onClick={() => handleToggleRevealPin(b.id)}
                                  aria-label={isPinRevealed ? 'ซ่อนรหัส PIN' : 'แสดงรหัส PIN'}
                                  title={isPinRevealed ? 'ซ่อนรหัส PIN' : 'แสดงรหัส PIN'}
                                >
                                  {isPinRevealed ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                                <button
                                  type="button"
                                  className={`pb-pin-btn ${isPinCopied ? 'copied' : ''}`}
                                  onClick={() => handleCopyPin(b.id, pinRaw)}
                                  aria-label="คัดลอกรหัส PIN"
                                  title={isPinCopied ? 'คัดลอกแล้ว!' : 'คัดลอกรหัส PIN'}
                                >
                                  {isPinCopied ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                              </div>
                            </div>
                            {!isCancelled && (
                              <button
                                type="button"
                                className="pb-detail-btn-send-pin"
                                onClick={() => handleSendPin(b.id)}
                                aria-label="ส่งรหัส PIN ให้ลูกค้าผ่าน LINE OA"
                              >
                                <Send size={14} />
                                <span>ส่งรหัส PIN ให้ลูกค้าผ่าน LINE OA</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="pb-detail-empty-note">
                            ไม่มีการกำหนดรหัส PIN สำหรับรายการนี้
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN */}
                  <div className="pb-detail-col">
                    {/* 4. PAYMENT SECTION */}
                    <div className="pb-detail-card">
                      <div className="pb-detail-card-header">
                        <span className="pb-detail-card-title">ข้อมูลการชำระเงิน</span>
                      </div>
                      <div className="pb-detail-content">
                        <div className="pb-detail-amount-hero">
                          <span className="pb-detail-label">ยอดที่ต้องชำระตามบิล</span>
                          <span className="pb-detail-amount-val" style={{ color: isPaid ? '#16a34a' : 'var(--text-main)' }}>
                            ฿{Number(b.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>

                        <div className="pb-detail-field-group" style={{ marginTop: '12px' }}>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">วิธีชำระเงิน</span>
                            <span className="pb-detail-val">{paymentMethodLabel}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">สถานะการชำระ</span>
                            <span className="pb-detail-val">{statusText}</span>
                          </div>
                          {b.paid_at && (
                            <div className="pb-detail-field">
                              <span className="pb-detail-label">เวลาที่ชำระ</span>
                              <span className="pb-detail-val">{formatCreatedDateTime(b.paid_at)}</span>
                            </div>
                          )}
                          {b.hour_credit_used && (
                            <div className="pb-detail-field">
                              <span className="pb-detail-label">เครดิตชั่วโมงที่ใช้</span>
                              <span className="pb-detail-val">{b.hour_credit_used} ชม.</span>
                            </div>
                          )}
                        </div>

                        {/* Slip Review Action */}
                        {hasSlip ? (
                          <div className="pb-detail-slip-box">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <FileText size={16} style={{ color: 'var(--primary-color)' }} />
                              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>มีสลิปโอนเงินแนบมา</span>
                            </div>
                            <button
                              type="button"
                              className="pb-detail-btn-view-slip"
                              onClick={() => {
                                setShowDetailModal(false);
                                setViewingSlipBooking(b);
                              }}
                              aria-label="ดูสลิปโอนเงินและผลตรวจ OCR"
                            >
                              <Eye size={13} />
                              <span>ตรวจสลิป / ดูผล OCR</span>
                            </button>
                          </div>
                        ) : (
                          <div className="pb-detail-empty-note" style={{ marginTop: '8px' }}>
                            ไม่มีการแนบสลิปโอนเงิน
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 5. BOOKING & INTERNAL METADATA */}
                    <div className="pb-detail-card">
                      <div className="pb-detail-card-header">
                        <span className="pb-detail-card-title">ข้อมูลการจองและระบบ</span>
                      </div>
                      <div className="pb-detail-content">
                        <div className="pb-detail-field-group">
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">รหัสการจอง</span>
                            <span className="pb-detail-val" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{displayCode}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">ช่องทางการทำรายการ</span>
                            <span className="pb-detail-val">{channelLabel}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">วันที่ทำรายการ</span>
                            <span className="pb-detail-val">{formatCreatedDateTime(b.created_at)}</span>
                          </div>
                          <div className="pb-detail-field">
                            <span className="pb-detail-label">ต้นทาง</span>
                            <span className="pb-detail-val">{b.booking_source === 'online' ? 'ระบบจองออนไลน์' : 'POS หน้าร้าน'}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 6. TAX INVOICE SECTION (Conditional) */}
                    {b.tax_invoice_required === 1 && (
                      <div className="pb-detail-card">
                        <div className="pb-detail-card-header">
                          <span className="pb-detail-card-title">ข้อมูลใบกำกับภาษี</span>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: '5px', backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#2563eb' }}>
                            ขอกำกับภาษี
                          </span>
                        </div>
                        <div className="pb-detail-content">
                          <div className="pb-detail-field-group">
                            <div className="pb-detail-field" style={{ gridColumn: '1 / -1' }}>
                              <span className="pb-detail-label">ชื่อ / บริษัท</span>
                              <span className="pb-detail-val pb-detail-val--strong">{b.tax_name || b.tax_invoice_name || '-'}</span>
                            </div>
                            <div className="pb-detail-field">
                              <span className="pb-detail-label">เลขประจำตัวผู้เสียภาษี 13 หลัก</span>
                              <span className="pb-detail-val" style={{ fontFamily: 'monospace' }}>{b.tax_id || b.tax_invoice_id || '-'}</span>
                            </div>
                            <div className="pb-detail-field">
                              <span className="pb-detail-label">สาขา</span>
                              <span className="pb-detail-val">{b.tax_branch || b.tax_invoice_branch || 'สำนักงานใหญ่'}</span>
                            </div>
                            <div className="pb-detail-field" style={{ gridColumn: '1 / -1' }}>
                              <span className="pb-detail-label">ที่อยู่ออกใบกำกับภาษี</span>
                              <span className="pb-detail-val">{b.tax_address || b.tax_invoice_address || '-'}</span>
                            </div>
                            <div className="pb-detail-field" style={{ gridColumn: '1 / -1' }}>
                              <span className="pb-detail-label">ช่องทางจัดส่งเอกสาร</span>
                              <span className="pb-detail-val">
                                {b.tax_delivery_method === 'postal'
                                  ? `จัดส่งทางไปรษณีย์ (${b.tax_postal_address || b.tax_address || '-'})`
                                  : (b.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'อีเมล / e-Tax')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* FOOTER ACTIONS */}
              <div className="pb-detail-modal-footer">
                <div className="pb-detail-footer-left">
                  {!isCancelled && (
                    <button
                      type="button"
                      className="pb-detail-btn-danger"
                      onClick={() => {
                        setShowDetailModal(false);
                        handleOpenCancelModal(b);
                      }}
                      aria-label="ยกเลิกการจอง"
                    >
                      <Ban size={14} />
                      <span>ยกเลิกการจอง</span>
                    </button>
                  )}
                </div>

                <div className="pb-detail-footer-right">
                  <button
                    type="button"
                    className="pb-detail-btn-secondary"
                    onClick={() => setShowDetailModal(false)}
                    aria-label="ปิดหน้าต่าง"
                  >
                    ปิดหน้าต่าง
                  </button>

                  {/* Operational contextual actions */}
                  {!isCancelled && (
                    <button
                      type="button"
                      className="pb-detail-btn-secondary"
                      onClick={() => {
                        setShowDetailModal(false);
                        handleOpenReschedule(b);
                      }}
                      aria-label="แก้ไขวันหรือเวลาการจอง"
                    >
                      <Edit3 size={14} />
                      <span>แก้ไขวัน/เวลา</span>
                    </button>
                  )}

                  {isReviewing && hasSlip && (
                    <button
                      type="button"
                      className="pb-detail-btn-primary"
                      style={{ backgroundColor: '#0284c7', borderColor: '#0284c7' }}
                      onClick={() => {
                        setShowDetailModal(false);
                        setViewingSlipBooking(b);
                      }}
                      aria-label="ตรวจสลิปโอนเงิน"
                    >
                      <Eye size={14} />
                      <span>ตรวจสลิป</span>
                    </button>
                  )}

                  {isPending && (
                    <button
                      type="button"
                      className="pb-detail-btn-primary"
                      style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
                      onClick={() => {
                        setShowDetailModal(false);
                        handleOpenPayment(b);
                      }}
                      aria-label="รับชำระเงิน"
                    >
                      <DollarSign size={14} />
                      <span>รับชำระเงิน</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="pb-detail-btn-primary"
                    onClick={() => {
                      setShowDetailModal(false);
                      setShowReceiptModal(true);
                    }}
                    aria-label="พิมพ์ใบเสร็จ"
                  >
                    <Printer size={15} />
                    <span>พิมพ์ใบเสร็จ</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/*  PRINTABLE RECEIPT MODAL OVERLAY                        */}
      {/* ========================================================= */}
      {showReceiptModal && selectedBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          overflowY: 'auto',
          padding: '20px'
        }} className="print-modal-overlay">
          <div style={{ backgroundColor: 'var(--bg-card)', padding: '16px', borderRadius: 'var(--border-radius)', marginBottom: '16px', display: 'flex', gap: '8px', width: '100%', maxWidth: '380px', flexWrap: 'wrap' }} className="no-print">
            <button className="btn btn-secondary" style={{ flex: '1 1 100px', fontSize: '0.85rem', padding: '10px 12px' }} onClick={() => setShowReceiptModal(false)}>ปิดหน้าต่าง</button>
            <button className="btn btn-primary" style={{ flex: '2 1 140px', fontSize: '0.85rem', padding: '10px 12px', gap: '6px' }} onClick={() => window.print()}>
              <Printer size={16} /> พิมพ์ใบเสร็จ
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: '1 1 100%', fontSize: '0.85rem', padding: '10px 12px', backgroundColor: '#1e3a8a', borderColor: '#1e3a8a', gap: '6px' }}
              onClick={() => sendDoorPin(selectedBooking.id)}
            >
              <Send size={15} /> <span>ส่ง PIN ให้ลูกค้าผ่าน LINE</span>
            </button>
          </div>
          <ReceiptPrint booking={selectedBooking} settings={settings} />
        </div>
      )}

      {/* ========================================================= */}
      {/*  WIDE SLIP MODAL: ตรวจสอบสลิป (Enterprise Review Layout)  */}
      {/* ========================================================= */}
      {/* ========================================================= */}
      {/*  WIDE SLIP MODAL: ตรวจสอบสลิป (Phase D Review Modal)      */}
      {/* ========================================================= */}
      {viewingSlipBooking && (() => {
        const firstItem = viewingSlipBooking.items?.[0] || {};
        const roomObj = roomsList?.find(r => r.id === (firstItem.room_id || viewingSlipBooking.room_id));
        const roomName = firstItem.room_name || viewingSlipBooking.room_name || roomObj?.name || 'ห้องประชุม';
        const usageDateStr = formatUsageDate(viewingSlipBooking);
        const usageTimeStr = formatUsageTime(viewingSlipBooking);
        const rawBookingCode = viewingSlipBooking.receipt_number || viewingSlipBooking.booking_code || (viewingSlipBooking.id ? `BK-${String(viewingSlipBooking.id).padStart(6, '0')}` : '-');
        const displayCode = rawBookingCode.startsWith('#') ? rawBookingCode : `#${rawBookingCode}`;
        const isPaid = viewingSlipBooking.payment_status === 'paid';
        const channelLabel = (viewingSlipBooking.booking_channel === 'line_oa' || viewingSlipBooking.booking_source === 'online') ? 'LINE OA' : (viewingSlipBooking.booking_source === 'pos' ? 'POS' : (viewingSlipBooking.booking_source || 'Walk-in'));
        const paymentMethodLabel = viewingSlipBooking.payment_method === 'transfer' ? 'โอนเงินผ่านธนาคาร' : (viewingSlipBooking.payment_method === 'promptpay' ? 'พร้อมเพย์' : (viewingSlipBooking.payment_method || 'โอนเงิน / สแกน QR'));
        const customerName = viewingSlipBooking.customer_name || viewingSlipBooking.contact_name || '-';
        const hasSlipImg = Boolean(viewingSlipBooking.slip_image_url && viewingSlipBooking.slip_image_url !== 'uploaded');

        const isDuplicate = Boolean(
          viewingSlipBooking.slip_verify_status === 'duplicate' ||
          bookings.some(b =>
            b.id !== viewingSlipBooking.id &&
            b.slip_trans_ref &&
            (b.slip_trans_ref === viewingSlipBooking.slip_trans_ref || (ocrResult?.qr?.transRef && b.slip_trans_ref === ocrResult.qr.transRef))
          )
        );

        // Decision Summary Headline & Subtitle
        let decisionTitle = '';
        let decisionSubtitle = '';
        let decisionType = 'info';

        if (isDuplicate) {
          decisionTitle = 'พบสลิปซ้ำในระบบ';
          decisionSubtitle = 'สลิปนี้หรือรหัสอ้างอิงเคยถูกใช้งานแล้วในระบบ ควรปฏิเสธหรือสอบทานเพิ่มเติม';
          decisionType = 'error';
        } else if (isOcrRunning) {
          decisionTitle = 'กำลังวิเคราะห์สลิป...';
          decisionSubtitle = `ระบบกำลังประมวลผลข้อมูลและ QR code (${ocrProgress}%)`;
          decisionType = 'info';
        } else if (ocrResult?.messageType === 'success') {
          decisionTitle = 'ผ่านเงื่อนไขหลัก';
          decisionSubtitle = ocrResult.decisionSupportMessage || 'ข้อมูลที่ระบบอ่านสอดคล้องกับรายการจอง พร้อมสำหรับการอนุมัติ';
          decisionType = 'success';
        } else if (ocrResult?.messageType === 'error') {
          decisionTitle = 'ข้อมูลไม่ตรงกัน';
          decisionSubtitle = ocrResult.decisionSupportMessage || 'ระบบพบข้อผิดพลาดหรือไม่สามารถอ่านข้อมูลได้ ควรปฏิเสธหรือสอบทานเพิ่มเติม';
          decisionType = 'error';
        } else if (ocrResult?.messageType === 'warning') {
          decisionTitle = 'พบข้อมูลที่ต้องตรวจสอบ';
          decisionSubtitle = ocrResult.decisionSupportMessage || 'กรุณาตรวจสอบรายละเอียดก่อนอนุมัติ';
          decisionType = 'warning';
        } else if (ocrResult) {
          decisionTitle = 'รอเจ้าหน้าที่ตรวจสอบ';
          decisionSubtitle = ocrResult.decisionSupportMessage || 'กรุณาตรวจสอบรายละเอียดในสลิปด้วยตนเองก่อนดำเนินการ';
          decisionType = 'info';
        } else {
          decisionTitle = 'รอตรวจสอบสลิป';
          decisionSubtitle = 'กรุณาตรวจสอบรายละเอียดภาพสลิปด้วยตนเองก่อนดำเนินการ';
          decisionType = 'info';
        }

        return (
          <div className="pb-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pb-slip-modal-title">
            <div className="pb-slip-modal">
              {/* 1. Header */}
              <div className="pb-slip-modal-header">
                <div className="pb-slip-modal-header-left">
                  <div className="pb-slip-modal-title-row">
                    <h3 id="pb-slip-modal-title" className="pb-slip-modal-title">
                      ตรวจสอบการชำระเงิน
                    </h3>
                  </div>
                  <div className="pb-slip-modal-sub">
                    <span className="pb-slip-modal-code">{displayCode}</span>
                    <span className="pb-slip-modal-sep">·</span>
                    <span>ผู้จอง: <strong style={{ color: 'var(--text-main)', fontWeight: 600 }}>{customerName}</strong></span>
                    <span className="pb-slip-modal-sep">·</span>
                    <span>ห้อง: {roomName}</span>
                  </div>
                </div>

                <div className="pb-slip-modal-header-right">
                  <span className={`pb-slip-status-badge ${isPaid ? 'pb-slip-status-paid' : 'pb-slip-status-reviewing'}`}>
                    {isPaid ? 'ชำระเงินแล้ว' : 'รอตรวจสลิป'}
                  </span>
                  <button
                    type="button"
                    className="pb-slip-modal-close"
                    onClick={() => setViewingSlipBooking(null)}
                    aria-label="ปิดหน้าต่าง"
                    title="ปิดหน้าต่าง"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* 2. Body: Split Grid */}
              <div className="pb-slip-modal-body">
                <div className="pb-slip-split-grid">
                  {/* Left Column: Slip Viewer */}
                  <div className="pb-slip-viewer-col">
                    <div className="pb-slip-toolbar">
                      <div className="pb-slip-toolbar-title">
                        <FileText size={15} style={{ color: 'var(--primary-color)' }} />
                        <span>รูปภาพสลิป</span>
                      </div>

                      {hasSlipImg && (
                        <div className="pb-slip-zoom-controls">
                          <button
                            type="button"
                            className="pb-slip-zoom-btn"
                            onClick={handleZoomOut}
                            disabled={slipZoom <= 0.75}
                            aria-label="ย่อขนาดภาพ"
                            title="ย่อขนาดภาพ"
                          >
                            <ZoomOut size={13} />
                          </button>
                          <button
                            type="button"
                            className={`pb-slip-zoom-btn ${slipZoom === 1 ? 'active' : ''}`}
                            onClick={handleZoomReset}
                            aria-label="รีเซ็ตขนาด 100%"
                            title="รีเซ็ตขนาด 100%"
                          >
                            {Math.round(slipZoom * 100)}%
                          </button>
                          <button
                            type="button"
                            className="pb-slip-zoom-btn"
                            onClick={handleZoomIn}
                            disabled={slipZoom >= 2.0}
                            aria-label="ขยายขนาดภาพ"
                            title="ขยายขนาดภาพ"
                          >
                            <ZoomIn size={13} />
                          </button>
                          <a
                            href={viewingSlipBooking.slip_image_url}
                            target="_blank"
                            rel="noreferrer"
                            className="pb-slip-fullres-link"
                            aria-label="เปิดภาพขนาดเต็มในแท็บใหม่"
                            title="เปิดภาพขนาดเต็มในแท็บใหม่"
                          >
                            <ExternalLink size={12} />
                            <span>Full Res</span>
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Viewport */}
                    <div
                      className="pb-slip-viewport"
                      style={{
                        alignItems: slipZoom > 1 ? 'flex-start' : 'center',
                        justifyContent: slipZoom > 1 ? 'flex-start' : 'center'
                      }}
                    >
                      {hasSlipImg ? (
                        <div className="pb-slip-img-container">
                          <div className="pb-slip-img-frame">
                            <img
                              src={viewingSlipBooking.slip_image_url}
                              alt="สลิปการชำระเงิน"
                              className="pb-slip-img"
                              style={{
                                width: slipZoom === 1 ? 'auto' : `${Math.round(slipZoom * 100)}%`,
                                maxWidth: slipZoom <= 1 ? '100%' : 'none',
                                maxHeight: slipZoom <= 1 ? '480px' : 'none'
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="pb-slip-empty">
                          <FileText size={36} style={{ opacity: 0.4 }} />
                          <span>ไม่มีรูปภาพสลิปที่แนบมาในรายการนี้</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Review Details */}
                  <div className="pb-slip-info-col">
                    {/* 1. Booking Summary */}
                    <div className="pb-slip-section-card">
                      <div className="pb-slip-card-header">
                        <span className="pb-slip-card-title">ข้อมูลการจอง</span>
                      </div>
                      <div className="pb-slip-summary-grid">
                        <div className="pb-slip-summary-item">
                          <span className="pb-slip-summary-label">ผู้จอง</span>
                          <span className="pb-slip-summary-val" title={customerName}>{customerName}</span>
                        </div>
                        <div className="pb-slip-summary-item">
                          <span className="pb-slip-summary-label">ห้องประชุม</span>
                          <span className="pb-slip-summary-val" title={roomName}>{roomName}</span>
                        </div>
                        <div className="pb-slip-summary-item">
                          <span className="pb-slip-summary-label">วันที่ใช้งาน</span>
                          <span className="pb-slip-summary-val">{usageDateStr}</span>
                        </div>
                        <div className="pb-slip-summary-item">
                          <span className="pb-slip-summary-label">เวลาใช้งาน</span>
                          <span className="pb-slip-summary-val">{usageTimeStr}</span>
                        </div>
                        <div className="pb-slip-summary-item">
                          <span className="pb-slip-summary-label">เบอร์ติดต่อ</span>
                          <span className="pb-slip-summary-val">{viewingSlipBooking.contact || '-'}</span>
                        </div>
                        <div className="pb-slip-summary-item">
                          <span className="pb-slip-summary-label">ช่องทาง / วิธีชำระ</span>
                          <span className="pb-slip-summary-val">{channelLabel} · {paymentMethodLabel}</span>
                        </div>
                        <div className="pb-slip-summary-amount-box">
                          <span className="pb-slip-summary-label" style={{ fontWeight: 600 }}>ยอดที่ต้องชำระตามบิล</span>
                          <span className="pb-slip-amount-val" style={{ color: isPaid ? '#16a34a' : 'var(--text-main)' }}>
                            ฿{Number(viewingSlipBooking.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 2. Verification Results */}
                    {hasSlipImg && (
                      <div className="pb-slip-section-card">
                        <div className="pb-slip-card-header">
                          <span className="pb-slip-card-title">ผลตรวจสอบสลิป</span>
                          {isOcrRunning && (
                            <span style={{ fontSize: '0.74rem', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                              <RefreshCw size={11} className="spin" /> กำลังตรวจสอบ ({ocrProgress}%)
                            </span>
                          )}
                        </div>

                        <div className="pb-ocr-grid">
                          {/* Box 1: Amount */}
                          <div className="pb-ocr-box">
                            <div className="pb-ocr-box-header">
                              <span className="pb-ocr-box-title">1. ยอดเงิน</span>
                              <span className={`pb-ocr-status-badge ${
                                ocrResult?.amount?.matched === true
                                  ? 'pb-ocr-status--pass'
                                  : (ocrResult?.amount?.matched === false ? 'pb-ocr-status--fail' : 'pb-ocr-status--neutral')
                              }`}>
                                {ocrResult ? (ocrResult.amount.statusText || 'ตรวจไม่ได้') : '-'}
                              </span>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">ยอดที่ต้องชำระ</div>
                              <div className="pb-ocr-data-val">
                                ฿{Number(viewingSlipBooking.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">ยอดในสลิป</div>
                              <div
                                className="pb-ocr-data-val pb-ocr-data-val-amt"
                                style={{
                                  color: ocrResult?.amount?.matched === true
                                    ? '#16a34a'
                                    : (ocrResult?.amount?.matched === false ? '#dc2626' : 'var(--text-main)')
                                }}
                              >
                                {ocrResult?.amount?.detected !== null && ocrResult?.amount?.detected !== undefined
                                  ? `฿${Number(ocrResult.amount.detected).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : (isOcrRunning ? 'กำลังอ่าน...' : 'อ่านไม่ได้')}
                              </div>
                            </div>
                          </div>

                          {/* Box 2: Receiver */}
                          <div className="pb-ocr-box">
                            <div className="pb-ocr-box-header">
                              <span className="pb-ocr-box-title">2. ผู้รับเงิน</span>
                              <span className={`pb-ocr-status-badge ${
                                ocrResult?.receiver?.matched === true
                                  ? 'pb-ocr-status--pass'
                                  : (ocrResult?.receiver?.matched === false ? 'pb-ocr-status--warning' : 'pb-ocr-status--neutral')
                              }`}>
                                {ocrResult ? (ocrResult.receiver.statusText || 'ตรวจไม่ได้') : '-'}
                              </span>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">ชื่อผู้รับ</div>
                              <div className="pb-ocr-data-val" title={ocrResult?.receiver?.detectedName || '-'}>
                                {ocrResult?.receiver?.detectedNameMasked || (isOcrRunning ? 'กำลังอ่าน...' : '-')}
                              </div>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">บัญชีปลายทาง</div>
                              <div className="pb-ocr-data-val">
                                {ocrResult?.receiver?.detectedAccountMasked || '-'}
                              </div>
                            </div>
                          </div>

                          {/* Box 3: Mini QR */}
                          <div className="pb-ocr-box">
                            <div className="pb-ocr-box-header">
                              <span className="pb-ocr-box-title">3. QR / ธนาคาร</span>
                              <span className={`pb-ocr-status-badge ${
                                ocrResult?.qr?.isValidSlipQR
                                  ? 'pb-ocr-status--pass'
                                  : (ocrResult?.qr?.isPaymentQR ? 'pb-ocr-status--fail' : 'pb-ocr-status--neutral')
                              }`}>
                                {ocrResult?.qr?.isValidSlipQR ? 'ผ่าน' : (ocrResult?.qr?.isPaymentQR ? 'ไม่ใช่สลิป' : (ocrResult ? 'ไม่ผ่าน' : '-'))}
                              </span>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">ธนาคาร</div>
                              <div className="pb-ocr-data-val">
                                {ocrResult?.qr?.bankName || (isOcrRunning ? 'กำลังตรวจ...' : '-')}
                              </div>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">Ref อ้างอิง</div>
                              <div className="pb-ocr-data-val" style={{ fontFamily: 'monospace' }}>
                                {ocrResult?.qr?.transRefMasked || (viewingSlipBooking.slip_trans_ref ? `${viewingSlipBooking.slip_trans_ref.slice(0, 6)}...` : '-')}
                              </div>
                            </div>
                          </div>

                          {/* Box 4: Duplicate */}
                          <div className="pb-ocr-box" style={{
                            backgroundColor: isDuplicate ? 'rgba(220, 38, 38, 0.05)' : undefined,
                            borderColor: isDuplicate ? 'rgba(220, 38, 38, 0.3)' : undefined
                          }}>
                            <div className="pb-ocr-box-header">
                              <span className="pb-ocr-box-title">4. สลิปซ้ำ</span>
                              <span className={`pb-ocr-status-badge ${isDuplicate ? 'pb-ocr-status--fail' : 'pb-ocr-status--pass'}`}>
                                {isDuplicate ? 'พบสลิปซ้ำ' : 'ไม่พบ'}
                              </span>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">ประวัติการใช้งาน</div>
                              <div
                                className="pb-ocr-data-val"
                                style={{
                                  color: isDuplicate ? '#dc2626' : '#16a34a',
                                  whiteSpace: 'normal',
                                  lineHeight: 1.3
                                }}
                              >
                                {isDuplicate ? 'พบสลิปนี้มีประวัติใช้งานแล้วในระบบ' : 'ไม่พบประวัติการใช้งานซ้ำในระบบ'}
                              </div>
                            </div>
                            <div>
                              <div className="pb-ocr-data-label">รหัสอ้างอิงสลิป</div>
                              <div className="pb-ocr-data-val" style={{ fontFamily: 'monospace' }}>
                                {ocrResult?.qr?.transRef || viewingSlipBooking.slip_trans_ref || '-'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Decision Summary */}
                        <div className={`pb-decision-banner pb-decision-banner--${decisionType}`}>
                          <div style={{ marginTop: '2px', flexShrink: 0 }}>
                            {decisionType === 'success' && <CheckCircle2 size={16} />}
                            {decisionType === 'warning' && <AlertTriangle size={16} />}
                            {decisionType === 'error' && <AlertCircle size={16} />}
                            {decisionType === 'info' && <AlertCircle size={16} />}
                          </div>
                          <div className="pb-decision-content">
                            <span className="pb-decision-headline">{decisionTitle}</span>
                            <span className="pb-decision-subtext">{decisionSubtitle}</span>
                          </div>
                        </div>

                        {/* Staff Disclaimer */}
                        <div className="pb-decision-disclaimer">
                          * ข้อมูลช่วยตัดสินใจสำหรับเจ้าหน้าที่เท่านั้น การอนุมัติหรือปฏิเสธขึ้นอยู่กับดุลยพินิจของเจ้าหน้าที่
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. Action Footer */}
              <div className="pb-slip-modal-footer">
                <div className="pb-slip-footer-left">
                  <button
                    type="button"
                    className="pb-slip-btn-close"
                    onClick={() => setViewingSlipBooking(null)}
                    aria-label="ปิดหน้าต่าง"
                  >
                    ปิดหน้าต่าง
                  </button>

                  {hasSlipImg && (
                    <button
                      type="button"
                      onClick={handleRerunOcr}
                      disabled={isOcrRunning}
                      className="pb-slip-btn-rerun"
                      aria-label="ตรวจวิเคราะห์สลิปใหม่อีกครั้ง"
                      title="ตรวจวิเคราะห์สลิปใหม่อีกครั้ง"
                    >
                      <RefreshCw size={13} className={isOcrRunning ? 'spin' : ''} />
                      <span>{isOcrRunning ? 'กำลังตรวจ...' : 'ตรวจอีกครั้ง'}</span>
                    </button>
                  )}
                </div>

                <div className="pb-slip-footer-right">
                  {isPaid ? (
                    <button
                      type="button"
                      className="pb-slip-btn-revert"
                      onClick={() => revertPayment(viewingSlipBooking)}
                      aria-label="ยกเลิกการยืนยันชำระเงิน"
                    >
                      <RotateCcw size={14} />
                      <span>ยกเลิกการยืนยันชำระเงิน</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="pb-slip-btn-danger"
                        onClick={() => {
                          const b = viewingSlipBooking;
                          setViewingSlipBooking(null);
                          handleOpenRejectSlipModal(b);
                        }}
                        aria-label="ปฏิเสธสลิป"
                      >
                        <Ban size={14} />
                        <span>ปฏิเสธสลิป</span>
                      </button>
                      <button
                        type="button"
                        className="pb-slip-btn-primary"
                        onClick={() => {
                          const b = viewingSlipBooking;
                          setViewingSlipBooking(null);
                          handleOpenPayment(b);
                        }}
                        aria-label="อนุมัติรับชำระเงิน"
                      >
                        <CheckCircle2 size={16} />
                        <span>อนุมัติรับชำระเงิน</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* ========================================================= */}
      {/*  REJECT SLIP MODAL (ปฏิเสธสลิป & รอลูกค้าแนบใหม่)          */}
      {/* ========================================================= */}
      {showRejectSlipModal && rejectTargetBooking && (() => {
        const targetFirstItem = rejectTargetBooking.items?.[0] || {};
        const targetRoomObj = roomsList?.find(r => r.id === (targetFirstItem.room_id || rejectTargetBooking.room_id));
        const targetRoomName = targetFirstItem.room_name || rejectTargetBooking.room_name || targetRoomObj?.name || 'ห้องประชุม';
        const targetIsMultiple = (rejectTargetBooking.items?.length || 0) > 1;
        const bookingCode = rejectTargetBooking.receipt_number || rejectTargetBooking.booking_code || (rejectTargetBooking.id ? `BK-${String(rejectTargetBooking.id).padStart(6, '0')}` : '-');

        const rejectReasons = [
          { code: 'AMOUNT_MISMATCH', label: 'ยอดเงินไม่ตรงกับยอดที่ต้องชำระ' },
          { code: 'WRONG_RECEIVER', label: 'บัญชีผู้รับเงินไม่ถูกต้อง' },
          { code: 'UNREADABLE_SLIP', label: 'รูปภาพสลิปไม่ชัดเจนหรือข้อมูลไม่ครบถ้วน' },
          { code: 'DUPLICATE_SLIP', label: 'สลิปซ้ำหรือเคยใช้งานแล้วในระบบ' },
          { code: 'INVALID_DATETIME', label: 'วันที่หรือเวลาในการโอนไม่ถูกต้อง' },
          { code: 'NOT_BANK_SLIP', label: 'ไม่ใช่สลิปการโอนเงินของธนาคาร' },
          { code: 'OTHER', label: 'อื่น ๆ (ระบุเหตุผลเอง)' }
        ];

        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.7)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: '16px'
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !rejectLoading) {
                setShowRejectSlipModal(false);
                setViewingSlipBooking(rejectTargetBooking);
              }
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '520px',
                maxHeight: 'min(90vh, 720px)',
                backgroundColor: '#ffffff',
                borderRadius: '18px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.06)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 1. Modal Header */}
              <div style={{
                padding: '16px 20px 14px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    backgroundColor: '#fef3c7',
                    color: '#d97706',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Ban size={20} />
                  </div>
                  <div>
                    <h3 style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      margin: 0,
                      color: '#0f172a',
                      lineHeight: 1.3
                    }}>
                      ปฏิเสธสลิปการโอนเงิน
                    </h3>
                    <div style={{
                      fontSize: '13px',
                      color: '#64748b',
                      marginTop: '2px',
                      fontWeight: 500
                    }}>
                      ใบจอง #{rejectTargetBooking.id} · {bookingCode}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!rejectLoading) {
                      setShowRejectSlipModal(false);
                      setViewingSlipBooking(rejectTargetBooking);
                    }
                  }}
                  disabled={rejectLoading}
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#f1f5f9',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: rejectLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!rejectLoading) {
                      e.currentTarget.style.backgroundColor = '#e2e8f0';
                      e.currentTarget.style.color = '#0f172a';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!rejectLoading) {
                      e.currentTarget.style.backgroundColor = '#f1f5f9';
                      e.currentTarget.style.color = '#64748b';
                    }
                  }}
                  title="ปิดหน้าต่าง"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 2. Modal Body (Scrollable if viewport is small) */}
              <div
                className="reject-modal-body"
                style={{
                  padding: '16px 20px',
                  overflowY: 'auto',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                {/* 2.1 Safety Notice */}
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderLeft: '4px solid #f59e0b',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px'
                }}>
                  <AlertCircle size={18} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ fontSize: '13.5px', lineHeight: 1.55, color: '#92400e' }}>
                    <div style={{ fontWeight: 700 }}>
                      การปฏิเสธสลิปจะไม่ยกเลิกการจอง
                    </div>
                    <div style={{ fontWeight: 500 }}>
                      ห้องประชุมยังคงถูกจองไว้เพื่อรอลูกค้าแนบสลิปใหม่
                    </div>
                  </div>
                </div>

                {/* 2.2 Booking Summary Card */}
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: '8px 14px'
                }}>
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', marginBottom: '1px' }}>
                      ผู้จอง
                    </div>
                    <div
                      style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={rejectTargetBooking.customer_name || '-'}
                    >
                      {rejectTargetBooking.customer_name || '-'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', marginBottom: '1px' }}>
                      เบอร์
                    </div>
                    <div
                      style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={rejectTargetBooking.contact || '-'}
                    >
                      {rejectTargetBooking.contact || '-'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', marginBottom: '1px' }}>
                      ห้อง
                    </div>
                    <div
                      style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={targetRoomName}
                    >
                      {targetRoomName}
                      {targetIsMultiple && (
                        <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 700, marginLeft: '4px' }}>
                          (+{rejectTargetBooking.items.length - 1} รายการ)
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#475569', marginBottom: '1px' }}>
                      ยอดเงิน
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: '#b45309' }}>
                      ฿{Number(rejectTargetBooking.total_amount || 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* 2.3 Rejection Reasons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                    เลือกเหตุผลที่ปฏิเสธสลิป:
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {rejectReasons.map((r) => {
                      const isSelected = rejectReasonCode === r.code;
                      return (
                        <div key={r.code} style={{ display: 'flex', flexDirection: 'column' }}>
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              minHeight: '44px',
                              padding: '8px 12px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              backgroundColor: isSelected ? '#fffbeb' : '#ffffff',
                              border: isSelected ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
                              boxShadow: isSelected ? '0 1px 3px rgba(245, 158, 11, 0.12)' : 'none',
                              transition: 'all 0.15s ease',
                              userSelect: 'none'
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = '#f8fafc';
                                e.currentTarget.style.borderColor = '#cbd5e1';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = '#ffffff';
                                e.currentTarget.style.borderColor = '#e2e8f0';
                              }
                            }}
                          >
                            <div style={{
                              width: '18px',
                              height: '18px',
                              borderRadius: '50%',
                              border: `2px solid ${isSelected ? '#d97706' : '#cbd5e1'}`,
                              backgroundColor: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              boxSizing: 'border-box',
                              transition: 'all 0.15s ease'
                            }}>
                              {isSelected && (
                                <div style={{
                                  width: '10px',
                                  height: '10px',
                                  borderRadius: '50%',
                                  backgroundColor: '#d97706'
                                }} />
                              )}
                            </div>
                            <input
                              type="radio"
                              name="rejectReasonCode"
                              value={r.code}
                              checked={isSelected}
                              onChange={() => setRejectReasonCode(r.code)}
                              style={{ display: 'none' }}
                            />
                            <span style={{
                              fontSize: '14px',
                              lineHeight: 1.5,
                              color: isSelected ? '#92400e' : '#1e293b',
                              fontWeight: isSelected ? 700 : 500,
                              flex: 1
                            }}>
                              {r.label}
                            </span>
                          </label>

                          {/* 2.4 OTHER Reason textarea */}
                          {r.code === 'OTHER' && isSelected && (
                            <div style={{
                              marginTop: '6px',
                              padding: '10px 12px',
                              borderRadius: '8px',
                              backgroundColor: '#fffbeb',
                              border: '1px solid #fde68a',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px'
                            }}>
                              <label style={{ fontSize: '13px', fontWeight: 600, color: '#92400e' }}>
                                ระบุเหตุผลเพิ่มเติม (จำเป็น):
                              </label>
                              <textarea
                                value={rejectCustomNote}
                                onChange={(e) => setRejectCustomNote(e.target.value.substring(0, 150))}
                                placeholder="เช่น กรุณาโอนเงินเข้าบัญชีตามที่ระบุในหน้าระบบ..."
                                rows={3}
                                maxLength={150}
                                style={{
                                  width: '100%',
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  border: '1.5px solid #f59e0b',
                                  backgroundColor: '#ffffff',
                                  color: '#0f172a',
                                  fontSize: '16px',
                                  lineHeight: 1.5,
                                  resize: 'none',
                                  boxSizing: 'border-box',
                                  outline: 'none'
                                }}
                              />
                              <div style={{
                                fontSize: '12px',
                                color: rejectCustomNote.length >= 140 ? '#dc2626' : '#92400e',
                                fontWeight: 600,
                                textAlign: 'right'
                              }}>
                                {rejectCustomNote.length} / 150 ตัวอักษร
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 3. Modal Footer Actions */}
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid #f1f5f9',
                backgroundColor: '#f8fafc',
                display: 'flex',
                gap: '12px',
                flexShrink: 0
              }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!rejectLoading) {
                      setShowRejectSlipModal(false);
                      setViewingSlipBooking(rejectTargetBooking);
                    }
                  }}
                  disabled={rejectLoading}
                  style={{
                    flex: 1,
                    height: '44px',
                    padding: '0 16px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    fontSize: '14.5px',
                    fontWeight: 600,
                    cursor: rejectLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onMouseEnter={(e) => {
                    if (!rejectLoading) {
                      e.currentTarget.style.backgroundColor = '#f1f5f9';
                      e.currentTarget.style.borderColor = '#94a3b8';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!rejectLoading) {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }
                  }}
                >
                  กลับไปตรวจสลิป
                </button>

                <button
                  type="button"
                  onClick={submitRejectSlip}
                  disabled={rejectLoading}
                  style={{
                    flex: 1,
                    height: '44px',
                    padding: '0 16px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#d97706',
                    color: '#ffffff',
                    fontSize: '14.5px',
                    fontWeight: 700,
                    cursor: rejectLoading ? 'not-allowed' : 'pointer',
                    opacity: rejectLoading ? 0.6 : 1,
                    boxShadow: '0 2px 6px rgba(217, 119, 6, 0.35)',
                    transition: 'all 0.15s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                  onMouseEnter={(e) => {
                    if (!rejectLoading) {
                      e.currentTarget.style.backgroundColor = '#b45309';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!rejectLoading) {
                      e.currentTarget.style.backgroundColor = '#d97706';
                    }
                  }}
                >
                  {rejectLoading ? (
                    <>
                      <RefreshCw size={16} className="spin" />
                      <span>กำลังบันทึก...</span>
                    </>
                  ) : (
                    <>
                      <Ban size={16} />
                      <span>ยืนยันปฏิเสธสลิป</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/*  CANCEL BOOKING MODAL (ยกเลิกการจอง & แจ้งเตือน LINE OA)  */}
      {/* ========================================================= */}
      {showCancelModal && cancelTargetBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '480px',
            padding: '24px',
            borderRadius: '20px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <button
              style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => { if (!cancelLoading) setShowCancelModal(false); }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '12px', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Ban size={22} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  ยืนยันการยกเลิกการจอง
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  ใบจอง #{cancelTargetBooking.id} · {cancelTargetBooking.receipt_number || ''}
                </span>
              </div>
            </div>

            {/* Booking Summary Box */}
            <div style={{
              padding: '14px 16px',
              borderRadius: '12px',
              backgroundColor: 'rgba(0,0,0,0.2)',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ผู้จอง:</span>{' '}
                <strong style={{ color: 'var(--text-main)' }}>{cancelTargetBooking.customer_name || '-'}</strong>
                {cancelTargetBooking.contact && ` (${cancelTargetBooking.contact})`}
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ห้องประชุม:</span>{' '}
                <strong>{cancelTargetBooking.items?.[0]?.room_name || cancelTargetBooking.room_name || '-'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ยอดเงิน:</span>{' '}
                <strong style={{ color: '#ef4444' }}>฿{Number(cancelTargetBooking.total_amount || 0).toLocaleString()}</strong>
              </div>
            </div>

            {/* Notification Notice */}
            <div style={{
              padding: '10px 14px',
              borderRadius: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              fontSize: '0.78rem',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              lineHeight: 1.4
            }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                รายการนี้จะถูกเปลี่ยนสถานะเป็น <strong>"ยกเลิกแล้ว"</strong> และย้ายไปที่ <strong>แท็บรายการยกเลิก</strong>
                {cancelTargetBooking.line_user_id && ' พร้อมส่งข้อความแจ้งเตือนเข้า LINE OA ของลูกค้าโดยอัตโนมัติ'}
              </div>
            </div>

            {/* Reason Input */}
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                เหตุผลการยกเลิก (ส่งแจ้งลูกค้าทาง LINE)
              </label>
              <input
                type="text"
                className="form-control"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="ระบุเหตุผล เช่น ลูกค้าแจ้งขอยกเลิก, เกินกำหนดชำระ..."
                style={{ borderRadius: '10px', fontSize: '0.85rem', height: '40px' }}
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {['ลูกค้าแจ้งขอยกเลิก', 'เกินกำหนดเวลาชำระเงิน', 'ขอเปลี่ยนห้อง/เปลี่ยนวัน'].map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setCancelReason(tag)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.72rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, borderRadius: '12px' }}
                onClick={() => setShowCancelModal(false)}
                disabled={cancelLoading}
              >
                ปิด
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1.5, borderRadius: '12px', backgroundColor: '#dc2626', borderColor: '#dc2626', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={submitCancelBooking}
                disabled={cancelLoading}
              >
                <Ban size={16} />
                <span>{cancelLoading ? 'กำลังยกเลิก...' : 'ยืนยันการยกเลิก'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/*  RESCHEDULE BOOKING MODAL (แก้ไขวัน/เวลาการจอง)             */}
      {/* ========================================================= */}
      {showRescheduleModal && rescheduleTarget && (() => {
        const origRoomId = rescheduleTarget.items?.[0]?.room_id || rescheduleTarget.room_id;
        const origRoomObj = roomsList.find(r => String(r.id) === String(origRoomId));
        const origRoomFullName = origRoomObj?.name || rescheduleTarget.items?.[0]?.room_name || rescheduleTarget.room_name || (origRoomId ? ('ห้อง ' + origRoomId) : '-');

        const origItem = rescheduleTarget.items?.[0] || rescheduleTarget;
        let origTimeFormatted = formatDate(origItem.start_time);
        if (origItem.end_time) {
          const eStr = String(origItem.end_time);
          const endTimeOnly = eStr.includes('T') ? eStr.split('T')[1].substring(0, 5) : eStr.includes(' ') ? eStr.split(' ')[1].substring(0, 5) : '';
          if (endTimeOnly) {
            origTimeFormatted += ' - ' + endTimeOnly + ' น.';
          }
        }

        const selectedRoomObj = roomsList.find(r => String(r.id) === String(rescheduleRoomId)) || roomsList[0];

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
              maxWidth: '580px',
              padding: '24px',
              borderRadius: '20px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative',
              maxHeight: '94vh',
              overflowY: 'auto'
            }}>
              {/* Close Button */}
              <button
                style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                onClick={() => { if (!rescheduleLoading) setShowRescheduleModal(false); }}
              >
                <X size={20} />
              </button>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: 'rgba(37, 99, 235, 0.15)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Edit3 size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                    แก้ไขวันและเวลาการจอง
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ใบจอง #{rescheduleTarget.id} · ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{rescheduleTarget.customer_name || '-'}</strong>
                  </span>
                </div>
              </div>

              {/* Current Booking Info Card */}
              <div style={{
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: 'var(--bg-hover)',
                border: '1px solid var(--border-color)',
                fontSize: '0.82rem',
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr',
                gap: '8px'
              }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>ห้องประชุมเดิม:</span>{' '}
                  <strong style={{ color: 'var(--text-main)' }}>{origRoomFullName}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>ยอดเดิม:</span>{' '}
                  <strong style={{ color: '#10b981' }}>฿{Number(rescheduleTarget.total_amount || 0).toLocaleString()}</strong>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--text-muted)' }}>วัน/เวลาเดิม:</span>{' '}
                  <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>
                    {origTimeFormatted}
                  </span>
                </div>
              </div>

              {/* Selection Row 1: Room & Date (Side by Side) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

                {/* Field 1: เลือกห้องประชุม (Custom Dropdown - No Clipping) */}
                <div style={{ position: 'relative' }}>
                  <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                    ห้องประชุม
                  </label>
                  <div
                    className="form-control"
                    onClick={() => {
                      setIsReschedRoomOpen(!isReschedRoomOpen);
                      setIsReschedStartOpen(false);
                      setIsReschedEndOpen(false);
                    }}
                    style={{
                      height: '40px',
                      borderRadius: '10px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-main)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 12px',
                      width: '100%',
                      userSelect: 'none'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedRoomObj ? (selectedRoomObj.name + ' (฿' + Number(selectedRoomObj.hourly_rate || 0).toLocaleString() + '/ชม.)') : 'เลือกห้องประชุม'}
                    </span>
                    <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  </div>

                  {isReschedRoomOpen && (
                    <>
                      <div onClick={() => setIsReschedRoomOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                      <div className="action-dropdown-menu" style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        zIndex: 2000,
                        maxHeight: '220px',
                        overflowY: 'auto',
                        borderRadius: '12px',
                        padding: '4px'
                      }}>
                        {roomsList.map(r => {
                          const isSel = String(r.id) === String(rescheduleRoomId);
                          return (
                            <div
                              key={r.id}
                              onClick={() => {
                                setRescheduleRoomId(String(r.id));
                                setIsReschedRoomOpen(false);
                              }}
                              style={{
                                padding: '8px 12px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                                color: isSel ? 'var(--primary-color)' : 'var(--text-main)',
                                fontWeight: isSel ? 800 : 600,
                                backgroundColor: isSel ? 'var(--bg-hover)' : 'transparent',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isSel ? 'var(--bg-hover)' : 'transparent'}
                            >
                              <span>{r.name}</span>
                              <span style={{ fontSize: '0.78rem', color: isSel ? 'var(--primary-color)' : 'var(--text-muted)', fontWeight: 700, flexShrink: 0 }}>
                                ฿{Number(r.hourly_rate || 0).toLocaleString()}/ชม.
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Field 2: เลือกวันที่ใหม่ */}
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                    วันที่ต้องการเปลี่ยน
                  </label>
                  <CustomDatePicker
                    value={rescheduleDate}
                    onChange={setRescheduleDate}
                    placeholder="เลือกวันที่"
                    align="right"
                    className="form-control"
                    style={{
                      height: '40px',
                      borderRadius: '10px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      padding: '0 12px',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      width: '100%'
                    }}
                  />
                </div>

              </div>

              {/* Selection Row 2: Booking Type Selector */}
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  รูปแบบการจอง
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {[
                    { id: 'hourly', label: 'รายชั่วโมง' },
                    { id: 'halfday', label: 'รายครึ่งวัน' },
                    { id: 'daily', label: 'รายวัน' }
                  ].map(type => {
                    const isSel = rescheduleBookingType === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => {
                          setRescheduleBookingType(type.id);
                          if (type.id === 'halfday') setRescheduleDailySlot('08-12');
                          if (type.id === 'daily') setRescheduleDailySlot('08-17');
                        }}
                        style={{
                          padding: '9px 8px',
                          borderRadius: '10px',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          border: isSel ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
                          backgroundColor: isSel ? 'var(--primary-color)' : 'var(--bg-hover)',
                          color: isSel ? '#ffffff' : 'var(--text-muted)',
                          boxShadow: isSel ? '0 2px 8px rgba(37, 99, 235, 0.3)' : 'none',
                          transition: 'all 0.15s'
                        }}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Slot Selectors */}
              {rescheduleBookingType === 'hourly' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {/* Start Time Dropdown */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                      เวลาเริ่มต้น
                    </label>
                    <div
                      className="form-control"
                      onClick={() => { setIsReschedStartOpen(!isReschedStartOpen); setIsReschedEndOpen(false); setIsReschedRoomOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        height: '40px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        padding: '0 12px',
                        fontWeight: 700,
                        color: 'var(--text-main)'
                      }}
                    >
                      <span>{rescheduleStartHour}:{rescheduleStartMinute} น.</span>
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    {isReschedStartOpen && (
                      <>
                        <div onClick={() => setIsReschedStartOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                        <div className="action-dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000, maxHeight: '200px', overflowY: 'auto', borderRadius: '12px', padding: '4px' }}>
                          {TIME_SLOT_OPTIONS.filter(t => t < '18:00').map(t => {
                            const [h, m] = t.split(':');
                            const isSel = rescheduleStartHour === h && rescheduleStartMinute === m;
                            return (
                              <div
                                key={t}
                                onClick={() => {
                                  setRescheduleStartHour(h);
                                  setRescheduleStartMinute(m);
                                  setIsReschedStartOpen(false);
                                  const startMin = parseInt(h, 10) * 60 + parseInt(m, 10);
                                  const endMin = parseInt(rescheduleEndHour, 10) * 60 + parseInt(rescheduleEndMinute, 10);
                                  if (endMin <= startMin) {
                                    const targetEnd = startMin + 60;
                                    const eh = String(Math.min(18, Math.floor(targetEnd / 60))).padStart(2, '0');
                                    const em = String(targetEnd % 60).padStart(2, '0');
                                    setRescheduleEndHour(eh);
                                    setRescheduleEndMinute(em);
                                  }
                                }}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                  cursor: 'pointer',
                                  fontSize: '0.85rem',
                                  color: isSel ? 'var(--primary-color)' : 'var(--text-main)',
                                  fontWeight: isSel ? 800 : 500,
                                  backgroundColor: isSel ? 'var(--bg-hover)' : 'transparent'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isSel ? 'var(--bg-hover)' : 'transparent'}
                              >
                                {t} น.
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* End Time Dropdown */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                      เวลาสิ้นสุด
                    </label>
                    <div
                      className="form-control"
                      onClick={() => { setIsReschedEndOpen(!isReschedEndOpen); setIsReschedStartOpen(false); setIsReschedRoomOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        height: '40px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        padding: '0 12px',
                        fontWeight: 700,
                        color: 'var(--text-main)'
                      }}
                    >
                      <span>{rescheduleEndHour}:{rescheduleEndMinute} น.</span>
                      <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    {isReschedEndOpen && (
                      <>
                        <div onClick={() => setIsReschedEndOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                        <div className="action-dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000, maxHeight: '200px', overflowY: 'auto', borderRadius: '12px', padding: '4px' }}>
                          {TIME_SLOT_OPTIONS.map(t => {
                            const [h, m] = t.split(':');
                            const curMin = parseInt(h, 10) * 60 + parseInt(m, 10);
                            const startMin = parseInt(rescheduleStartHour, 10) * 60 + parseInt(rescheduleStartMinute, 10);
                            const isDisabled = curMin <= startMin;
                            const isSel = rescheduleEndHour === h && rescheduleEndMinute === m;
                            return (
                              <div
                                key={t}
                                onClick={() => {
                                  if (isDisabled) return;
                                  setRescheduleEndHour(h);
                                  setRescheduleEndMinute(m);
                                  setIsReschedEndOpen(false);
                                }}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                                  opacity: isDisabled ? 0.35 : 1,
                                  fontSize: '0.85rem',
                                  color: isSel ? 'var(--primary-color)' : 'var(--text-main)',
                                  fontWeight: isSel ? 800 : 500,
                                  backgroundColor: isSel ? 'var(--bg-hover)' : 'transparent'
                                }}
                                onMouseEnter={(e) => { if (!isDisabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                                onMouseLeave={(e) => { if (!isDisabled) e.currentTarget.style.backgroundColor = isSel ? 'var(--bg-hover)' : 'transparent'; }}
                              >
                                {t} น.
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Half-Day Slot Selector */}
              {rescheduleBookingType === 'halfday' && (
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                    ช่วงเวลาครึ่งวัน
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[
                      { id: '08-12', label: '08:00 - 12:00 น. (ช่วงเช้า)' },
                      { id: '13-17', label: '13:00 - 17:00 น. (ช่วงบ่าย)' }
                    ].map(slot => {
                      const isSel = rescheduleDailySlot === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setRescheduleDailySlot(slot.id)}
                          style={{
                            padding: '10px 8px',
                            borderRadius: '10px',
                            fontSize: '0.82rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            border: isSel ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
                            backgroundColor: isSel ? 'var(--primary-light)' : 'var(--bg-hover)',
                            color: isSel ? 'var(--primary-color)' : 'var(--text-muted)'
                          }}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Daily Slot Selector */}
              {rescheduleBookingType === 'daily' && (
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                    ช่วงเวลารายวัน
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[
                      { id: '08-17', label: '08:00 - 17:00 น.' },
                      { id: '09-18', label: '09:00 - 18:00 น.' }
                    ].map(slot => {
                      const isSel = rescheduleDailySlot === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setRescheduleDailySlot(slot.id)}
                          style={{
                            padding: '10px 8px',
                            borderRadius: '10px',
                            fontSize: '0.82rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            border: isSel ? '1.5px solid var(--primary-color)' : '1px solid var(--border-color)',
                            backgroundColor: isSel ? 'var(--primary-light)' : 'var(--bg-hover)',
                            color: isSel ? 'var(--primary-color)' : 'var(--text-muted)'
                          }}
                        >
                          {slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Overlap / Status Banner */}
              {rescheduleOverlapInfo.isOverlap ? (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1.5px solid #ef4444',
                  color: '#ef4444',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 700
                }}>
                  <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                  <span>ห้องและช่วงเวลาที่เลือกใหม่นี้มีผู้ใช้งานแล้ว ({rescheduleOverlapInfo.booking?.customer_name || 'ลูกค้าท่านอื่น'} จองไว้)</span>
                </div>
              ) : !reschedulePriceCalc.isValid ? (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1.5px solid #f59e0b',
                  color: '#f59e0b',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 700
                }}>
                  <AlertCircle size={18} style={{ flexShrink: 0 }} />
                  <span>เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น</span>
                </div>
              ) : (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid #10b981',
                  color: '#10b981',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontWeight: 700
                }}>
                  <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
                  <span>ห้องและช่วงเวลาใหม่นี้ว่าง พร้อมบันทึกการเปลี่ยนแปลง</span>
                </div>
              )}

              {/* Price Recalculation Summary */}
              <div style={{
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: 'var(--bg-hover)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>ยอดเงินเดิม: ฿{reschedulePriceCalc.oldTotal.toLocaleString()}</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '2px' }}>
                    ยอดคำนวณใหม่: <strong style={{ color: 'var(--primary-color)' }}>฿{reschedulePriceCalc.newTotal.toLocaleString()}</strong>
                  </div>
                </div>
                <div>
                  {reschedulePriceCalc.diff > 0 ? (
                    <span style={{ padding: '4px 10px', borderRadius: '8px', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontWeight: 800, fontSize: '0.82rem' }}>
                      +฿{reschedulePriceCalc.diff.toLocaleString()} (ชำระเพิ่ม)
                    </span>
                  ) : reschedulePriceCalc.diff < 0 ? (
                    <span style={{ padding: '4px 10px', borderRadius: '8px', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: '#0ea5e9', fontWeight: 800, fontSize: '0.82rem' }}>
                      -฿{Math.abs(reschedulePriceCalc.diff).toLocaleString()} (คืนเงินส่วนต่าง)
                    </span>
                  ) : (
                    <span style={{ padding: '4px 10px', borderRadius: '8px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 800, fontSize: '0.82rem' }}>
                      ยอดเท่าเดิม
                    </span>
                  )}
                </div>
              </div>

              {/* Reason */}
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  หมายเหตุการเปลี่ยนวัน/เวลา (บันทึกลงระบบ)
                </label>
                <input
                  type="text"
                  className="form-control"
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  placeholder="เช่น ลูกค้าขอเปลี่ยนห้อง/เลื่อนเวลา..."
                  style={{ borderRadius: '10px', fontSize: '0.85rem', height: '38px', background: 'var(--bg-card)' }}
                />
              </div>

              {/* LINE OA Send Checkbox */}
              {rescheduleTarget.line_user_id && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--primary-color)', fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={rescheduleSendLine}
                    onChange={(e) => setRescheduleSendLine(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--primary-color)' }}
                  />
                  <span>ส่งข้อความแจ้งเตือนวัน/เวลาและห้องใหม่เข้า LINE OA ของลูกค้าอัตโนมัติ</span>
                </label>
              )}

              {/* Footer Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    borderRadius: '10px',
                    height: '42px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    backgroundColor: 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)'
                  }}
                  onClick={() => setShowRescheduleModal(false)}
                  disabled={rescheduleLoading}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    flex: 1.8,
                    borderRadius: '10px',
                    height: '42px',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    opacity: (rescheduleOverlapInfo.isOverlap || !reschedulePriceCalc.isValid || rescheduleLoading) ? 0.5 : 1,
                    cursor: (rescheduleOverlapInfo.isOverlap || !reschedulePriceCalc.isValid || rescheduleLoading) ? 'not-allowed' : 'pointer'
                  }}
                  onClick={submitRescheduleBooking}
                  disabled={rescheduleOverlapInfo.isOverlap || !reschedulePriceCalc.isValid || rescheduleLoading}
                >
                  <CheckCircle2 size={16} />
                  <span>{rescheduleLoading ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAX INVOICE DETAILS & PRINT MODAL */}
      {selectedTaxBooking && (() => {
        const total = Number(selectedTaxBooking.total_amount || 0);
        const subtotalBeforeVat = (total / 1.07);
        const vatAmount = total - subtotalBeforeVat;
        const firstItem = selectedTaxBooking.items?.[0] || {};
        const roomName = firstItem.room_name || selectedTaxBooking.room_name || 'ห้องประชุม';

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
                  className="btn btn-primary"
                  style={{ flex: 1.2, height: '44px', borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  onClick={() => {
                    handleOpenReceipt(selectedTaxBooking);
                    setSelectedTaxBooking(null);
                    setTaxCopied(false);
                  }}
                >
                  <Printer size={16} />
                  <span>ดูใบเสร็จ / พิมพ์</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  onClick={() => { setSelectedTaxBooking(null); setTaxCopied(false); }}
                  title="ปิดหน้าต่าง"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default PendingBookings;
