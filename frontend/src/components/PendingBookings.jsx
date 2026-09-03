import React, { useState, useEffect, useMemo } from 'react';
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
  Plus
} from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';
import { API_BASE } from '../apiConfig';
import { analyzeSlipInBrowser } from '../utils/browserSlipVerifier';

const DATE_TYPE_OPTIONS = [
  { value: 'usage_date', label: 'วันที่ใช้งาน' },
  { value: 'created_at', label: 'วันที่ทำรายการ' }
];

const TIME_SLOT_OPTIONS = [
  '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00'
];

function PendingBookings({ settings, sysAlert, sysConfirm, onNavigateToBook }) {
  const [bookings, setBookings] = useState([]);
  const [roomsList, setRoomsList] = useState([]);
  const [loading, setLoading] = useState(false);
  // 1. Search & Filter Input State (Form controls before clicking Search)
  const [searchQueryInput, setSearchQueryInput] = useState('');
  const [dateFilterTypeInput, setDateFilterTypeInput] = useState('usage_date'); // 'usage_date' (วันที่จอง/ใช้งาน) or 'created_at' (วันที่ทำรายการ)
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');

  // 2. Applied Search & Filter State (Active filters after clicking Search)
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');
  const [appliedDateFilterType, setAppliedDateFilterType] = useState('usage_date');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
  const [isDateTypeDropdownOpen, setIsDateTypeDropdownOpen] = useState(false);
  
  // Selection and payment states
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [selectedTaxBooking, setSelectedTaxBooking] = useState(null);
  const [taxCopied, setTaxCopied] = useState(false);
  const [viewingSlipBooking, setViewingSlipBooking] = useState(null);
  const [ocrResult, setOcrResult] = useState(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState('transfer');
  const [isPayMethodOpen, setIsPayMethodOpen] = useState(false);

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

  // Active Tab Filter: 'all' | 'pending' | 'paid' | 'cancelled'
  const [activeTabFilter, setActiveTabFilter] = useState('all');
  // Customer Type / Channel Tab Filter: 'all' | 'walkin' | 'builtland' | 'basecamp' | 'line_oa'
  const [activeChannelTab, setActiveChannelTab] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Static Column Definitions (9 columns, with recommended mock proportions)
  const columns = [
    { key: 'id', label: 'เลขที่ใบจอง', width: '10%', minWidth: '110px' },
    { key: 'customer_name', label: 'ผู้จอง / เบอร์โทร', width: '18%', minWidth: '170px' },
    { key: 'customer_type', label: 'ประเภทลูกค้า', width: '10%', minWidth: '105px' },
    { key: 'booking_source', label: 'ช่องทาง', width: '8%', minWidth: '85px' },
    { key: 'room_info', label: 'ห้องประชุม', width: '14%', minWidth: '145px' },
    { key: 'usage_date', label: 'วันที่ / เวลาใช้งาน', width: '16%', minWidth: '155px' },
    { key: 'total_amount', label: 'ยอดชำระ', width: '8%', minWidth: '95px' },
    { key: 'pin_code', label: 'รหัสเข้าห้อง', width: '10%', minWidth: '110px' },
    { key: 'actions', label: 'การดำเนินการ', width: '16%', minWidth: '200px' }
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

  // Reset page to 1 when tab filter or applied search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [appliedSearchQuery, activeTabFilter, activeChannelTab, appliedStartDate, appliedEndDate, appliedDateFilterType]);

  // Filter input change handlers with debug logging
  const handleDateTypeChange = (val) => {
    console.log('[PendingBookings] DateType selected:', val);
    setDateFilterTypeInput(val);
  };

  const handleStartDateChange = (val) => {
    console.log('[PendingBookings] StartDate selected:', val);
    setStartDateInput(val);
  };

  const handleEndDateChange = (val) => {
    console.log('[PendingBookings] EndDate selected:', val);
    setEndDateInput(val);
  };

  // Explicit Search Trigger
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    console.log('[PendingBookings] handleSearchSubmit executing with:', {
      searchQueryInput,
      dateFilterTypeInput,
      startDateInput,
      endDateInput
    });
    setAppliedSearchQuery(searchQueryInput);
    setAppliedDateFilterType(dateFilterTypeInput);
    setAppliedStartDate(startDateInput);
    setAppliedEndDate(endDateInput);
    setCurrentPage(1);
    fetchBookings();
  };

  // Explicit Reset All Filters
  const handleResetFilters = () => {
    console.log('[PendingBookings] handleResetFilters clicked - resetting all filters to defaults');
    setSearchQueryInput('');
    setDateFilterTypeInput('usage_date');
    setStartDateInput('');
    setEndDateInput('');

    setAppliedSearchQuery('');
    setAppliedDateFilterType('usage_date');
    setAppliedStartDate('');
    setAppliedEndDate('');
    setActiveChannelTab('all');
    setActiveTabFilter('all');
    setCurrentPage(1);
  };

  const handleClearFilters = handleResetFilters;

  // Quick Today Button
  const handleQuickToday = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    setStartDateInput(todayStr);
    setEndDateInput(todayStr);
    setAppliedStartDate(todayStr);
    setAppliedEndDate(todayStr);
    setCurrentPage(1);
  };

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
    return () => {
      isMounted = false;
    };
  }, [viewingSlipBooking?.id, viewingSlipBooking?.slip_image_url]);

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

  const handleOpenReceipt = async (booking) => {
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

  // 1. Base Filter (Date range & Search query using APPLIED filters)
  const baseFilteredList = useMemo(() => {
    return bookings.filter(b => {
      // Date Filtering (Start Date & End Date Range)
      if (appliedStartDate || appliedEndDate) {
        if (appliedDateFilterType === 'created_at') {
          const createdDateStr = getLocalDateString(b.created_at);
          if (!createdDateStr) return false;
          if (appliedStartDate && createdDateStr < appliedStartDate) return false;
          if (appliedEndDate && createdDateStr > appliedEndDate) return false;
        } else {
          // usage_date
          let matches = false;
          if (b.items && b.items.length) {
            matches = b.items.some(it => {
              const dStr = it.start_time ? it.start_time.split('T')[0].split(' ')[0] : '';
              if (!dStr) return false;
              if (appliedStartDate && dStr < appliedStartDate) return false;
              if (appliedEndDate && dStr > appliedEndDate) return false;
              return true;
            });
          }
          if (!matches) {
            const usageDateStr = getBookingUsageDateStr(b);
            if (usageDateStr) {
              if (appliedStartDate && usageDateStr < appliedStartDate) matches = false;
              else if (appliedEndDate && usageDateStr > appliedEndDate) matches = false;
              else matches = true;
            }
          }
          if (!matches) return false;
        }
      }

      if (!appliedSearchQuery) return true;

      const searchLower = appliedSearchQuery.toLowerCase().trim();
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
  }, [bookings, appliedStartDate, appliedEndDate, appliedDateFilterType, appliedSearchQuery]);

  const matchesChannel = (b, channel) => {
    if (channel === 'all') return true;
    const isPos = b.booking_channel === 'pos_web' || !b.booking_channel || b.booking_source === 'pos';
    const isLineOA = b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'general' || b.customer_type === 'online';

    if (channel === 'walkin') {
      return (b.customer_type === 'walkin' || (!b.customer_type && !isLineOA)) && isPos;
    }
    if (channel === 'builtland') {
      return b.customer_type === 'builtland' && isPos;
    }
    if (channel === 'basecamp') {
      return b.customer_type === 'basecamp' && isPos;
    }
    if (channel === 'line_oa') {
      return isLineOA;
    }
    return true;
  };

  // 2. Channel counts derived from baseFilteredList (so counts reflect current date / search filters)
  const channelCounts = useMemo(() => {
    let all = 0, walkin = 0, builtland = 0, basecamp = 0, line_oa = 0;
    for (const b of baseFilteredList) {
      all++;
      if (matchesChannel(b, 'walkin')) {
        walkin++;
      } else if (matchesChannel(b, 'builtland')) {
        builtland++;
      } else if (matchesChannel(b, 'basecamp')) {
        basecamp++;
      } else if (matchesChannel(b, 'line_oa')) {
        line_oa++;
      }
    }
    return { all, walkin, builtland, basecamp, line_oa };
  }, [baseFilteredList]);

  // 3. Channel-filtered bookings list
  const channelFilteredList = useMemo(() => {
    if (activeChannelTab === 'all') return baseFilteredList;
    return baseFilteredList.filter(b => matchesChannel(b, activeChannelTab));
  }, [baseFilteredList, activeChannelTab]);

  // 4. Status counts derived from channelFilteredList
  const pendingBookingsList = useMemo(() => channelFilteredList.filter(b => b.payment_status !== 'paid' && b.payment_status !== 'cancelled' && b.payment_status !== 'internal_free'), [channelFilteredList]);
  const paidBookingsList = useMemo(() => channelFilteredList.filter(b => b.payment_status === 'paid' || b.payment_status === 'internal_free'), [channelFilteredList]);
  const cancelledBookingsList = useMemo(() => channelFilteredList.filter(b => b.payment_status === 'cancelled'), [channelFilteredList]);
  
  const reviewingCount = pendingBookingsList.filter(b => b.payment_status === 'reviewing' || !!b.slip_image_url).length;
  const pendingCount = pendingBookingsList.length;
  const paidCount = paidBookingsList.length;
  const cancelledCount = cancelledBookingsList.length;
  const totalCount = channelFilteredList.length;

  const taxInvoiceList = useMemo(() => channelFilteredList.filter(b => b.tax_invoice_required === 1), [channelFilteredList]);
  const taxInvoiceCount = taxInvoiceList.length;
  const taxInvoicePaidCount = taxInvoiceList.filter(b => b.payment_status === 'paid').length;
  const taxInvoicePendingCount = taxInvoiceList.filter(b => b.payment_status !== 'paid' && b.payment_status !== 'cancelled').length;

  const totalAmountPending = pendingBookingsList.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);
  const totalAmountPaid = paidBookingsList.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);

  // 5. Final tab-filtered list for table display
  const filteredBookings = useMemo(() => {
    if (activeTabFilter === 'pending') return pendingBookingsList;
    if (activeTabFilter === 'paid') return paidBookingsList;
    if (activeTabFilter === 'cancelled') return cancelledBookingsList;
    if (activeTabFilter === 'tax_invoice') return taxInvoiceList;
    return channelFilteredList;
  }, [activeTabFilter, pendingBookingsList, paidBookingsList, cancelledBookingsList, taxInvoiceList, channelFilteredList]);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. Header Panel */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>รายการจองห้อง</span>
            {reviewingCount > 0 && (
              <span style={{ 
                fontSize: '0.75rem', 
                backgroundColor: 'rgba(239, 68, 68, 0.12)', 
                color: '#ef4444', 
                border: '1px solid rgba(239, 68, 68, 0.25)',
                padding: '3px 10px', 
                borderRadius: '999px', 
                fontWeight: 800 
              }}>
                รอตรวจสลิป {reviewingCount} รายการ
              </span>
            )}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', margin: '4px 0 0 0' }}>
            จัดการรายการจองห้องประชุม ตรวจสอบการชำระเงิน และส่งรหัสผ่านเปิดห้อง (Door PIN)
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            type="button"
            className="btn btn-secondary" 
            onClick={() => fetchBookings(false)} 
            disabled={loading || isRefreshing}
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '6px', 
              fontSize: '0.84rem',
              fontWeight: 600,
              padding: '8px 14px',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)'
            }}
          >
            <RefreshCw size={14} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            <span>{isRefreshing ? 'กำลังโหลด...' : 'รีเฟรช'}</span>
          </button>

          {onNavigateToBook && (
            <button 
              type="button"
              className="btn btn-primary" 
              onClick={onNavigateToBook}
              style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '6px', 
                fontSize: '0.84rem',
                fontWeight: 700,
                padding: '8px 16px',
                borderRadius: '12px',
                backgroundColor: '#2563eb',
                borderColor: '#2563eb',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
              }}
            >
              <Plus size={16} />
              <span>สร้างการจอง</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Customer Type / Channel Navigation Tabs (Segmented Control) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '14px',
        border: '1px solid var(--border-color)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}>
        {[
          { key: 'walkin', label: 'Walk-in', count: channelCounts.walkin, color: '#10b981' },
          { key: 'builtland', label: 'Builtland', count: channelCounts.builtland, color: '#ea580c' },
          { key: 'basecamp', label: 'Basecamp', count: channelCounts.basecamp, color: '#8b5cf6' },
          { key: 'line_oa', label: 'LINE OA / Online', count: channelCounts.line_oa, color: '#0ea5e9' }
        ].map(tab => {
          const isActive = activeChannelTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveChannelTab(activeChannelTab === tab.key ? 'all' : tab.key);
                setCurrentPage(1);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                borderRadius: '10px',
                border: isActive ? `1.5px solid ${tab.color}` : '1px solid transparent',
                backgroundColor: isActive ? `${tab.color}15` : 'transparent',
                color: isActive ? tab.color : 'var(--text-muted)',
                fontWeight: isActive ? 800 : 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{tab.label}</span>
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                padding: '1px 8px',
                borderRadius: '999px',
                backgroundColor: isActive ? tab.color : 'var(--bg-hover)',
                color: isActive ? '#ffffff' : 'var(--text-muted)',
                border: isActive ? 'none' : '1px solid var(--border-color)'
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Summary Stat Cards (3 Compact Modern Cards) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
        
        {/* Card 1: ตรวจชำระเงิน */}
        <div 
          onClick={() => { 
            setActiveTabFilter(activeTabFilter === 'pending' ? 'all' : 'pending'); 
            setCurrentPage(1); 
          }}
          style={{ 
            padding: '12px 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            borderRadius: '14px',
            border: activeTabFilter === 'pending' ? '1.5px solid #f59e0b' : '1px solid var(--border-color)', 
            backgroundColor: activeTabFilter === 'pending' ? 'rgba(245, 158, 11, 0.08)' : 'var(--bg-card)',
            cursor: 'pointer',
            boxShadow: activeTabFilter === 'pending' ? '0 4px 12px rgba(245, 158, 11, 0.12)' : 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <div style={{ 
            backgroundColor: 'rgba(245, 158, 11, 0.12)', 
            color: '#f59e0b', 
            width: '38px', 
            height: '38px', 
            borderRadius: '10px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            flexShrink: 0 
          }}>
            <AlertCircle size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>ตรวจชำระเงิน</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '1px 0' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f59e0b' }}>{pendingCount}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ยอดค้าง <strong style={{ color: '#f59e0b' }}>฿{totalAmountPending.toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* Card 2: ชำระเงินสำเร็จ */}
        <div 
          onClick={() => { 
            setActiveTabFilter(activeTabFilter === 'paid' ? 'all' : 'paid'); 
            setCurrentPage(1); 
          }}
          style={{ 
            padding: '12px 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            borderRadius: '14px',
            border: activeTabFilter === 'paid' ? '1.5px solid #10b981' : '1px solid var(--border-color)', 
            backgroundColor: activeTabFilter === 'paid' ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-card)',
            cursor: 'pointer',
            boxShadow: activeTabFilter === 'paid' ? '0 4px 12px rgba(16, 185, 129, 0.12)' : 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <div style={{ 
            backgroundColor: 'rgba(16, 185, 129, 0.12)', 
            color: '#10b981', 
            width: '38px', 
            height: '38px', 
            borderRadius: '10px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            flexShrink: 0 
          }}>
            <CheckCircle2 size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>ชำระเงินสำเร็จ</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '1px 0' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#10b981' }}>{paidCount}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ยอดรับ <strong style={{ color: '#10b981' }}>฿{totalAmountPaid.toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* Card 3: รายการยกเลิก */}
        <div 
          onClick={() => { 
            setActiveTabFilter(activeTabFilter === 'cancelled' ? 'all' : 'cancelled'); 
            setCurrentPage(1); 
          }}
          style={{ 
            padding: '12px 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px', 
            borderRadius: '14px',
            border: activeTabFilter === 'cancelled' ? '1.5px solid #ef4444' : '1px solid var(--border-color)', 
            backgroundColor: activeTabFilter === 'cancelled' ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-card)',
            cursor: 'pointer',
            boxShadow: activeTabFilter === 'cancelled' ? '0 4px 12px rgba(239, 68, 68, 0.12)' : 'none',
            transition: 'all 0.15s ease'
          }}
        >
          <div style={{ 
            backgroundColor: 'rgba(239, 68, 68, 0.12)', 
            color: '#ef4444', 
            width: '38px', 
            height: '38px', 
            borderRadius: '10px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            flexShrink: 0 
          }}>
            <Ban size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>รายการยกเลิก</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '1px 0' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#ef4444' }}>{cancelledCount}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>รายการ</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ยกเลิกการจอง</div>
          </div>
        </div>

      </div>

      {/* 4. Main Filter Bar */}
      <div className="card" style={{ 
        padding: '12px 16px', 
        borderRadius: '16px', 
        backgroundColor: 'var(--bg-card)', 
        border: '1px solid var(--border-color)', 
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
        position: 'relative',
        zIndex: 30
      }}>
        <form 
          onSubmit={handleSearchSubmit} 
          className="flex items-center gap-3 flex-nowrap w-full overflow-x-auto"
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px', 
            flexWrap: 'nowrap', 
            width: '100%', 
            overflowX: 'auto',
            paddingBottom: '2px',
            scrollbarWidth: 'thin'
          }}
        >
          
          {/* 1. Search Input (flex: 1, min-width: 360px) */}
          <div 
            className="relative flex-1" 
            style={{ 
              position: 'relative', 
              flex: '1 1 360px', 
              minWidth: '360px', 
              display: 'inline-flex', 
              alignItems: 'center' 
            }}
          >
            <Search size={16} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input 
              type="text" 
              className="form-control"
              style={{
                width: '100%',
                paddingLeft: '40px',
                paddingRight: searchQueryInput ? '36px' : '14px',
                height: '40px',
                borderRadius: '10px',
                fontSize: '0.84rem',
                lineHeight: 1,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-hover)',
                color: 'var(--text-main)',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap'
              }}
              placeholder="ค้นหาชื่อผู้จอง, เบอร์โทร, เลขใบจอง, PIN..."
              value={searchQueryInput}
              onChange={e => setSearchQueryInput(e.target.value)}
            />
            {searchQueryInput && (
              <button 
                type="button"
                onClick={() => setSearchQueryInput('')}
                style={{ 
                  position: 'absolute', 
                  right: '10px', 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-muted)', 
                  cursor: 'pointer', 
                  padding: '4px', 
                  display: 'inline-flex', 
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px'
                }}
                title="ล้างคำค้นหา"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 2. วันที่ใช้งาน (CustomSelect, min-width: 150px) */}
          <div className="shrink-0" style={{ flexShrink: 0, minWidth: '150px' }}>
            <CustomSelect
              value={dateFilterTypeInput}
              onChange={handleDateTypeChange}
              options={DATE_TYPE_OPTIONS}
              usePortal={true}
              noTruncate={true}
              triggerStyle={{ 
                height: '40px', 
                borderRadius: '10px', 
                fontSize: '0.84rem', 
                fontWeight: 600,
                backgroundColor: 'var(--bg-hover)',
                border: '1px solid var(--border-color)',
                padding: '0 12px',
                minWidth: '150px',
                whiteSpace: 'nowrap'
              }}
              menuStyle={{
                minWidth: '150px'
              }}
            />
          </div>

          {/* 3. วันเริ่มต้น (CustomDatePicker, min-width: 140px) */}
          <div className="shrink-0" style={{ flexShrink: 0, minWidth: '140px' }}>
            <CustomDatePicker 
              value={startDateInput}
              onChange={handleStartDateChange}
              placeholder="วันเริ่มต้น"
              className="form-control"
              style={{ 
                height: '40px', 
                borderRadius: '10px', 
                fontSize: '0.84rem', 
                lineHeight: 1,
                border: '1px solid var(--border-color)', 
                background: 'var(--bg-hover)', 
                padding: '0 12px', 
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                minWidth: '140px',
                whiteSpace: 'nowrap'
              }}
            />
          </div>

          {/* 4. วันสิ้นสุด (CustomDatePicker, min-width: 140px) */}
          <div className="shrink-0" style={{ flexShrink: 0, minWidth: '140px' }}>
            <CustomDatePicker 
              value={endDateInput}
              onChange={handleEndDateChange}
              placeholder="วันสิ้นสุด"
              className="form-control"
              style={{ 
                height: '40px', 
                borderRadius: '10px', 
                fontSize: '0.84rem', 
                lineHeight: 1,
                border: '1px solid var(--border-color)', 
                background: 'var(--bg-hover)', 
                padding: '0 12px', 
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                minWidth: '140px',
                whiteSpace: 'nowrap'
              }}
            />
          </div>

          {/* 5. วันนี้ (Quick Today Button, width ตาม content) */}
          <div className="shrink-0" style={{ flexShrink: 0 }}>
            <button 
              type="button" 
              onClick={handleQuickToday}
              className="btn btn-secondary"
              style={{ 
                padding: '0 14px', 
                borderRadius: '10px', 
                fontSize: '0.84rem', 
                lineHeight: 1,
                fontWeight: 700, 
                height: '40px', 
                border: '1px solid var(--border-color)', 
                background: 'var(--bg-hover)',
                color: 'var(--text-main)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box'
              }}
              title="เลือกดูรายการของวันนี้"
            >
              วันนี้
            </button>
          </div>

          {/* 6 & 7. Action Buttons: [ค้นหา] and [ล้างตัวกรอง] */}
          <div className="shrink-0 flex items-center gap-2" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ 
                padding: '0 18px', 
                borderRadius: '10px', 
                fontSize: '0.84rem', 
                lineHeight: 1,
                fontWeight: 700, 
                height: '40px', 
                gap: '6px', 
                display: 'inline-flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer', 
                backgroundColor: '#2563eb', 
                borderColor: '#2563eb',
                color: '#ffffff',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box'
              }}
            >
              <Search size={15} />
              <span>ค้นหา</span>
            </button>

            <button 
              type="button" 
              onClick={handleResetFilters}
              className="btn btn-secondary" 
              style={{ 
                padding: '0 14px', 
                borderRadius: '10px', 
                fontSize: '0.84rem', 
                lineHeight: 1,
                fontWeight: 600, 
                height: '40px', 
                display: 'inline-flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '6px', 
                border: '1px solid var(--border-color)', 
                background: 'transparent', 
                color: 'var(--text-muted)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxSizing: 'border-box'
              }}
              title="ล้างตัวกรองทั้งหมด"
            >
              <RotateCcw size={14} />
              <span>ล้างตัวกรอง</span>
            </button>
          </div>

        </form>
      </div>

      {/* 5. Bookings Table View */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '16px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', position: 'relative', zIndex: 1 }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="table" style={{ width: '100%', minWidth: '1150px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border-color)' }}>
                {columns.map(col => {
                  const isSortable = col.key !== 'actions' && col.key !== 'room_info' && col.key !== 'customer_type';
                  let align = 'left';
                  if (col.key === 'total_amount') align = 'right';
                  if (col.key === 'actions' || col.key === 'pin_code' || col.key === 'booking_source' || col.key === 'customer_type') align = 'center';

                  return (
                    <th 
                      key={col.key} 
                      onClick={() => isSortable && handleSort(col.key)}
                      style={{ 
                        padding: '12px 14px', 
                        cursor: isSortable ? 'pointer' : 'default', 
                        userSelect: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        textAlign: align,
                        whiteSpace: 'nowrap',
                        width: col.width || 'auto',
                        minWidth: col.minWidth || 'auto'
                      }}
                    >
                      <div style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        justifyContent: align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start'),
                        width: '100%'
                      }}>
                        <span>{col.label}</span>
                        {isSortable && (
                          <span style={{ display: 'inline-flex', opacity: sortKey === col.key ? 1 : 0.3 }}>
                            {sortKey === col.key ? (
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
                  <td colSpan={columns.length} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      {appliedSearchQuery || appliedStartDate || appliedEndDate ? 'ไม่พบรายการจองที่ตรงกับคำค้นหา' : activeTabFilter === 'pending' ? 'ไม่มีรายการรอตรวจสอบการชำระเงินในขณะนี้' : activeTabFilter === 'paid' ? 'ไม่มีรายการชำระเงินสำเร็จ' : activeTabFilter === 'cancelled' ? 'ไม่มีรายการยกเลิก' : 'ไม่มีประวัติรายการจองห้องในระบบ'}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedBookings.map((b) => {
                  const isPaid = b.payment_status === 'paid' || b.payment_status === 'internal_free';
                  const isReviewing = (b.payment_status === 'reviewing' || !!b.slip_image_url) && b.payment_status !== 'internal_free';
                  const firstItem = b.items?.[0] || {};
                  const roomObj = roomsList.find(r => r.id === (firstItem.room_id || b.room_id));
                  const roomName = firstItem.room_name || b.room_name || roomObj?.name || 'ห้องประชุม';
                  const usageDateStr = formatUsageDate(b);
                  const timeDisplay = formatUsageTime(b);
                  const layoutLabel = firstItem.layout === 'classroom' ? 'Classroom' : 'Standard';
                  const typeLabel = firstItem.booking_type === 'daily' ? 'เหมาวัน' : firstItem.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง';

                  // 1. Booking code / receipt_number
                  const bookingCode = b.receipt_number || b.booking_code || (b.id ? `BK-${String(b.id).padStart(6, '0')}` : '-');

                  // 3. Customer type badge styling
                  let custBadge = { label: 'Walk-in', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };
                  if (b.customer_type === 'builtland') {
                    custBadge = { label: 'Builtland', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.12)' };
                  } else if (b.customer_type === 'basecamp') {
                    custBadge = { label: 'Basecamp', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' };
                  } else if (b.customer_type === 'general' || b.customer_type === 'line_oa' || b.customer_type === 'online' || b.booking_channel === 'line_oa' || b.booking_source === 'online') {
                    custBadge = { label: 'LINE OA', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.12)' };
                  }

                  // 4. Booking channel badge styling (pos_web = POS, line_oa = Online / LINE OA)
                  const isOnlineChannel = b.booking_channel === 'line_oa' || b.booking_source === 'online' || b.customer_type === 'general' || b.customer_type === 'online';
                  const channelBadge = isOnlineChannel
                    ? { label: b.booking_channel === 'line_oa' ? 'LINE OA' : 'Online', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.12)' }
                    : { label: 'POS', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' };

                  // 8. Room PIN code resolution & styling
                  let pinDisplay = b.pin_code || firstItem.pin_code || '';
                  if (!pinDisplay && roomObj) {
                    pinDisplay = (b.customer_type === 'builtland' && roomObj.builtland_pin_code) ? roomObj.builtland_pin_code : (roomObj.pin_code || '');
                  }
                  const isBuiltland = b.customer_type === 'builtland';

                  return (
                    <tr 
                      key={b.id} 
                      style={{ 
                        borderBottom: '1px solid var(--border-color)',
                        backgroundColor: isReviewing && !isPaid && b.payment_status !== 'cancelled' ? 'rgba(14, 165, 233, 0.04)' : 'transparent',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isReviewing && !isPaid && b.payment_status !== 'cancelled' ? 'rgba(14, 165, 233, 0.04)' : 'transparent'}
                    >
                      {/* Column 1: เลขที่ใบจอง */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'left' }}>
                        <div style={{ fontWeight: 800, color: 'var(--primary-color)', fontSize: '0.85rem' }}>
                          {bookingCode}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {formatDate(b.created_at)}
                        </div>
                      </td>

                      {/* Column 2: ผู้จอง / เบอร์โทร */}
                      <td style={{ padding: '10px 14px', verticalAlign: 'middle', textAlign: 'left' }}>
                        <div 
                          style={{ 
                            fontWeight: 700, 
                            color: 'var(--text-main)', 
                            fontSize: '0.85rem',
                            maxWidth: '220px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                          title={b.customer_name || '-'}
                        >
                          {b.customer_name || '-'}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          {b.contact ? (
                            <>
                              <Phone size={11} />
                              <span>{b.contact}</span>
                            </>
                          ) : (
                            <span>-</span>
                          )}
                        </div>
                        {b.tax_invoice_required === 1 && (
                          <div style={{ marginTop: '3px' }}>
                            <span 
                              onClick={(e) => { e.stopPropagation(); setSelectedTaxBooking(b); }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                padding: '2px 7px',
                                borderRadius: '6px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                color: '#2563eb',
                                border: '1px solid rgba(59, 130, 246, 0.25)',
                                cursor: 'pointer'
                              }}
                              title="คลิกดูข้อมูลใบกำกับภาษี"
                            >
                              <FileText size={11} />
                              <span>ขอใบกำกับภาษี</span>
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Column 3: ประเภทลูกค้า */}
                      <td style={{ textAlign: 'center', padding: '10px 14px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 10px',
                          height: '24px',
                          borderRadius: '999px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          minWidth: '80px',
                          backgroundColor: custBadge.bg,
                          color: custBadge.color,
                          border: `1px solid ${custBadge.color}40`,
                          boxSizing: 'border-box'
                        }}>
                          {custBadge.label}
                        </span>
                      </td>

                      {/* Column 4: ช่องทาง */}
                      <td style={{ textAlign: 'center', padding: '10px 14px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 8px',
                          height: '24px',
                          borderRadius: '999px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          minWidth: '65px',
                          backgroundColor: channelBadge.bg,
                          color: channelBadge.color,
                          border: `1px solid ${channelBadge.color}35`,
                          boxSizing: 'border-box'
                        }}>
                          {channelBadge.label}
                        </span>
                      </td>

                      {/* Column 5: ห้องประชุม */}
                      <td style={{ padding: '10px 14px', verticalAlign: 'middle', textAlign: 'left' }}>
                        <div 
                          style={{ 
                            fontWeight: 700, 
                            color: 'var(--text-main)', 
                            fontSize: '0.85rem',
                            maxWidth: '180px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                          title={roomName}
                        >
                          {roomName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500, marginTop: '2px' }}>
                          {`${layoutLabel} • ${typeLabel}`}
                        </div>
                      </td>

                      {/* Column 6: วันที่ / เวลาใช้งาน */}
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'left' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.85rem' }}>
                          {usageDateStr}
                        </div>
                        {timeDisplay && (
                          <div style={{ fontSize: '0.74rem', color: '#0ea5e9', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <Clock size={11} />
                            <span>{timeDisplay}</span>
                          </div>
                        )}
                      </td>

                      {/* Column 7: ยอดชำระ */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, fontSize: '0.92rem', color: isPaid ? '#10b981' : (b.payment_status === 'cancelled' ? 'var(--text-muted)' : '#f59e0b'), whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        ฿{Number(b.total_amount || 0).toLocaleString()}
                      </td>

                      {/* Column 8: รหัสเข้าห้อง */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        {pinDisplay ? (
                          <span style={{ 
                            padding: '0 10px', 
                            height: '24px',
                            borderRadius: '999px', 
                            fontSize: '0.8rem', 
                            fontWeight: 800, 
                            fontFamily: 'monospace',
                            letterSpacing: '0.5px',
                            backgroundColor: isBuiltland ? 'rgba(234, 88, 12, 0.12)' : 'rgba(99, 102, 241, 0.12)', 
                            color: isBuiltland ? '#ea580c' : '#6366f1',
                            border: isBuiltland ? '1px solid rgba(234, 88, 12, 0.3)' : '1px solid rgba(99, 102, 241, 0.3)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            boxSizing: 'border-box'
                          }}>
                            <Key size={12} />
                            <span>{pinDisplay}</span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                        )}
                      </td>

                      {/* Column 9: การดำเนินการ */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          
                          {/* 1. ดูสลิป (เมื่อมีสลิปแนบ) */}
                          {b.slip_image_url && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setViewingSlipBooking(b); }}
                              className="btn btn-secondary"
                              style={{ 
                                padding: '4px 8px', 
                                fontSize: '0.74rem', 
                                borderRadius: '8px', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '4px', 
                                fontWeight: 700,
                                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                                color: '#0284c7',
                                border: '1px solid rgba(14, 165, 233, 0.3)'
                              }}
                              title="ดูสลิปโอนเงิน"
                            >
                              <Eye size={12} />
                              <span>ดูสลิป</span>
                            </button>
                          )}

                          {/* 2. ส่ง PIN (เมื่อชำระแล้ว หรือ Builtland) */}
                          {isPaid && b.payment_status !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleSendPin(b.id); }}
                              className="btn btn-secondary"
                              style={{ 
                                padding: '4px 8px', 
                                fontSize: '0.74rem', 
                                borderRadius: '8px', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '4px', 
                                fontWeight: 700,
                                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                color: '#2563eb',
                                border: '1px solid rgba(37, 99, 235, 0.3)'
                              }}
                              title="ส่งรหัสผ่านเปิดห้องทาง LINE OA"
                            >
                              <Send size={12} />
                              <span>ส่ง PIN</span>
                            </button>
                          )}

                          {/* 3. ตรวจสอบชำระเงิน (เมื่อยังไม่ชำระ) */}
                          {!isPaid && b.payment_status !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleOpenPayModal(b); }}
                              className="btn btn-primary"
                              style={{ 
                                padding: '4px 8px', 
                                fontSize: '0.74rem', 
                                borderRadius: '8px', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '4px', 
                                fontWeight: 700,
                                backgroundColor: '#f59e0b',
                                borderColor: '#f59e0b',
                                color: '#ffffff'
                              }}
                              title="ตรวจสอบและยืนยันการชำระเงิน"
                            >
                              <ShieldCheck size={12} />
                              <span>ตรวจสอบ</span>
                            </button>
                          )}

                          {/* 4. ใบเสร็จรับเงิน */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleOpenReceipt(b); }}
                            className="btn btn-secondary"
                            style={{ 
                              padding: '4px 8px', 
                              fontSize: '0.74rem', 
                              borderRadius: '8px', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '4px', 
                              fontWeight: 600,
                              backgroundColor: 'var(--bg-hover)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-main)'
                            }}
                            title="พิมพ์ใบเสร็จรับเงิน"
                          >
                            <Printer size={12} />
                            <span>ใบเสร็จ</span>
                          </button>

                          {/* 5. เมนูเพิ่มเติม (⋯) */}
                          <button
                            type="button"
                            onClick={(e) => handleToggleActionMenu(e, b)}
                            className="btn btn-secondary"
                            style={{ 
                              padding: '4px 6px', 
                              fontSize: '0.74rem', 
                              borderRadius: '8px', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              justifyContent: 'center',
                              backgroundColor: activeActionMenuBooking?.id === b.id ? 'var(--primary-color)' : 'var(--bg-hover)',
                              color: activeActionMenuBooking?.id === b.id ? '#ffffff' : 'var(--text-muted)',
                              border: '1px solid var(--border-color)'
                            }}
                            title="เมนูเพิ่มเติม"
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

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '12px 18px', 
            borderTop: '1px solid var(--border-color)', 
            backgroundColor: 'rgba(255, 255, 255, 0.01)',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              แสดงหน้า <strong>{currentPage}</strong> จาก <strong>{totalPages}</strong> (ทั้งหมด <strong>{totalRows}</strong> รายการ)
            </div>
            
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                style={{ padding: '4px 10px', fontSize: '0.8rem', borderRadius: '8px' }}
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
                      padding: '4px 10px',
                      fontSize: '0.8rem',
                      borderRadius: '8px',
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
                style={{ padding: '4px 10px', fontSize: '0.8rem', borderRadius: '8px' }}
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
            borderRadius: '14px',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            textAlign: 'left',
            boxShadow: '0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px var(--border-color)',
            animation: 'fadeIn 0.12s ease-out'
          }}>
            <div 
              onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenReschedule(b); }}
              style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', transition: 'all 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Edit3 size={14} style={{ color: '#6366f1' }} />
              <span>แก้ไขวัน/เวลาการจอง</span>
            </div>

            {activeActionMenuBooking.tax_invoice_required === 1 && (
              <div 
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); setSelectedTaxBooking(b); }}
                style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#2563eb', fontWeight: 700, transition: 'all 0.15s' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <FileText size={14} style={{ color: '#2563eb' }} />
                <span>ดูข้อมูลใบกำกับภาษี</span>
              </div>
            )}

            {activeActionMenuBooking.slip_image_url && (
              <div 
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); setViewingSlipBooking(b); }}
                style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', transition: 'all 0.15s' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <Eye size={14} style={{ color: '#0ea5e9' }} />
                <span>ดูรูปภาพสลิปโอนเงิน</span>
              </div>
            )}

            {activeActionMenuBooking.payment_status === 'paid' && (
              <div 
                onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); revertPayment(b); }}
                style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b', transition: 'all 0.15s' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <RotateCcw size={14} />
                <span>ยกเลิกการยืนยันชำระ (คืนสถานะ)</span>
              </div>
            )}

            <div 
              onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenReceipt(b); }}
              style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', transition: 'all 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Printer size={14} style={{ color: 'var(--text-muted)' }} />
              <span>ดูรายละเอียดใบจอง</span>
            </div>

            <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }} />

            <div 
              onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handleOpenCancelModal(b); }}
              style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', transition: 'all 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Ban size={14} />
              <span>ยกเลิกการจอง</span>
            </div>

            <div 
              onClick={() => { const b = activeActionMenuBooking; setActiveActionMenuBooking(null); setActionMenuPos(null); handlePermanentDelete(b); }}
              style={{ padding: '9px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', transition: 'all 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(220, 38, 38, 0.12)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Trash2 size={14} />
              <span>ลบรายการออกจากระบบ</span>
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
      {/*  SLIP VIEWER MODAL (ดูสลิปย้อนหลังได้ทุกสถานะ)             */}
      {/* ========================================================= */}
      {viewingSlipBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '520px',
            padding: '24px',
            borderRadius: '20px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative',
            maxHeight: '92vh',
            overflowY: 'auto'
          }}>
            <button 
              style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setViewingSlipBooking(null)}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: 'rgba(14, 165, 233, 0.15)', color: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Eye size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  ตรวจสอบสลิปการโอนเงิน
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  ใบจอง #{viewingSlipBooking.id} · ผู้จอง: {viewingSlipBooking.customer_name || '-'}
                </span>
              </div>
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
                <strong style={{ color: viewingSlipBooking.payment_status === 'paid' ? '#10b981' : '#f59e0b' }}>
                  ฿{Number(viewingSlipBooking.total_amount || 0).toLocaleString()}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>สถานะ:</span>{' '}
                <strong style={{ color: viewingSlipBooking.payment_status === 'paid' ? '#10b981' : '#0ea5e9' }}>
                  {viewingSlipBooking.payment_status === 'paid' ? 'ชำระแล้ว' : 'รอตรวจสลิป'}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>เบอร์ติดต่อ:</span>{' '}
                <span>{viewingSlipBooking.contact || '-'}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>ช่องทาง:</span>{' '}
                <span>{viewingSlipBooking.booking_source === 'online' ? 'จองออนไลน์' : 'Walk-in'}</span>
              </div>
            </div>

            {/* ========================================================= */}
            {/*  DECISION SUPPORT: ผลตรวจสอบอัตโนมัติ (ช่วยพนักงานตรวจสลิป) */}
            {/* ========================================================= */}
            {viewingSlipBooking.slip_image_url && viewingSlipBooking.slip_image_url !== 'uploaded' && (
              <div style={{
                padding: '14px 16px',
                borderRadius: '14px',
                backgroundColor: 'rgba(30, 41, 59, 0.4)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {/* Section Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sparkles size={16} style={{ color: '#0ea5e9' }} />
                    <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>
                      ผลตรวจสอบอัตโนมัติ (Decision Support)
                    </strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isOcrRunning ? (
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: 'rgba(14, 165, 233, 0.15)',
                        color: '#38bdf8',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}>
                        <RefreshCw size={11} className="spin" />
                        <span>กำลังตรวจสอบ {ocrProgress > 0 ? `(${ocrProgress}%)` : '...'}</span>
                      </span>
                    ) : (
                      <span style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: ocrResult?.status === 'completed'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : (ocrResult?.status === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'),
                        color: ocrResult?.status === 'completed'
                          ? '#10b981'
                          : (ocrResult?.status === 'error' ? '#ef4444' : '#f59e0b')
                      }}>
                        {ocrResult?.status === 'completed'
                          ? 'ตรวจสอบเสร็จ'
                          : (ocrResult?.status === 'error' ? 'เกิดข้อผิดพลาด' : (ocrResult?.status === 'incomplete' ? 'อ่านข้อมูลไม่ครบ' : 'พร้อมตรวจสอบ'))}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={handleRerunOcr}
                      disabled={isOcrRunning}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: isOcrRunning ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontSize: '0.72rem',
                        padding: '2px 6px',
                        borderRadius: '6px'
                      }}
                      title="ตรวจซ้ำอีกครั้ง"
                    >
                      <RefreshCw size={11} className={isOcrRunning ? 'spin' : ''} />
                      <span>ตรวจซ้ำ</span>
                    </button>
                  </div>
                </div>

                {/* 4-Box Grid Comparison */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '10px',
                  fontSize: '0.78rem'
                }}>
                  {/* Item 1: ยอดเงิน */}
                  <div style={{
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>ยอดเงิน:</span>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '6px',
                        backgroundColor: ocrResult?.amount?.matched === true
                          ? 'rgba(16, 185, 129, 0.18)'
                          : (ocrResult?.amount?.matched === false ? 'rgba(239, 68, 68, 0.18)' : 'rgba(148, 163, 184, 0.15)'),
                        color: ocrResult?.amount?.matched === true
                          ? '#10b981'
                          : (ocrResult?.amount?.matched === false ? '#ef4444' : 'var(--text-muted)')
                      }}>
                        {ocrResult ? (ocrResult.amount.statusText || 'ตรวจไม่ได้') : '-'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>ที่ต้องชำระ: </span>
                      <strong>฿{Number(viewingSlipBooking.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>อ่านได้จากสลิป: </span>
                      <strong style={{
                        color: ocrResult?.amount?.matched === true
                          ? '#10b981'
                          : (ocrResult?.amount?.matched === false ? '#ef4444' : 'var(--text-main)')
                      }}>
                        {ocrResult?.amount?.detected !== null && ocrResult?.amount?.detected !== undefined
                          ? `฿${Number(ocrResult.amount.detected).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : (isOcrRunning ? 'กำลังอ่าน...' : 'อ่านไม่ได้')}
                      </strong>
                    </div>
                  </div>

                  {/* Item 2: ผู้รับเงิน */}
                  <div style={{
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>ผู้รับเงิน:</span>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '6px',
                        backgroundColor: ocrResult?.receiver?.matched === true
                          ? 'rgba(16, 185, 129, 0.18)'
                          : (ocrResult?.receiver?.matched === false ? 'rgba(245, 158, 11, 0.18)' : 'rgba(148, 163, 184, 0.15)'),
                        color: ocrResult?.receiver?.matched === true
                          ? '#10b981'
                          : (ocrResult?.receiver?.matched === false ? '#f59e0b' : 'var(--text-muted)')
                      }}>
                        {ocrResult ? (ocrResult.receiver.statusText || 'ตรวจไม่ได้') : '-'}
                      </span>
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ocrResult?.receiver?.detectedName || '-'}>
                      <span style={{ color: 'var(--text-muted)' }}>ชื่อ: </span>
                      <strong>{ocrResult?.receiver?.detectedNameMasked || (isOcrRunning ? 'กำลังอ่าน...' : '-')}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>บัญชีปลายทาง: </span>
                      <strong>{ocrResult?.receiver?.detectedAccountMasked || '-'}</strong>
                    </div>
                  </div>

                  {/* Item 3: Mini QR ธนาคาร */}
                  <div style={{
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-hover)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Mini QR:</span>
                      <span style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '6px',
                        backgroundColor: ocrResult?.qr?.isValidSlipQR
                          ? 'rgba(16, 185, 129, 0.18)'
                          : (ocrResult?.qr?.isPaymentQR ? 'rgba(239, 68, 68, 0.18)' : 'rgba(148, 163, 184, 0.15)'),
                        color: ocrResult?.qr?.isValidSlipQR
                          ? '#10b981'
                          : (ocrResult?.qr?.isPaymentQR ? '#ef4444' : 'var(--text-muted)')
                      }}>
                        {ocrResult?.qr?.isValidSlipQR ? 'ผ่าน' : (ocrResult?.qr?.isPaymentQR ? 'ไม่ใช่สลิป' : 'ไม่ผ่าน')}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>ธนาคาร: </span>
                      <span>{ocrResult?.qr?.bankName || (isOcrRunning ? 'กำลังตรวจ...' : '-')}</span>
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Ref: </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.74rem' }}>
                        {ocrResult?.qr?.transRefMasked || (viewingSlipBooking.slip_trans_ref ? `${viewingSlipBooking.slip_trans_ref.slice(0, 6)}...` : '-')}
                      </span>
                    </div>
                  </div>

                  {/* Item 4: ตรวจสอบสลิปซ้ำ (Duplicate) */}
                  {(() => {
                    const isDuplicate = Boolean(
                      viewingSlipBooking.slip_verify_status === 'duplicate' ||
                      bookings.some(b =>
                        b.id !== viewingSlipBooking.id &&
                        b.slip_trans_ref &&
                        (b.slip_trans_ref === viewingSlipBooking.slip_trans_ref || (ocrResult?.qr?.transRef && b.slip_trans_ref === ocrResult.qr.transRef))
                      )
                    );
                    return (
                      <div style={{
                        padding: '10px',
                        borderRadius: '10px',
                        backgroundColor: isDuplicate ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-hover)',
                        border: isDuplicate ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-muted)' }}>สลิปซ้ำ:</span>
                          <span style={{
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: '6px',
                            backgroundColor: isDuplicate ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.18)',
                            color: isDuplicate ? '#ef4444' : '#10b981'
                          }}>
                            {isDuplicate ? 'พบสลิปซ้ำ' : 'ไม่พบ'}
                          </span>
                        </div>
                        <div style={{ color: isDuplicate ? '#ef4444' : 'var(--text-muted)', fontSize: '0.74rem' }}>
                          {isDuplicate ? '⚠️ สลิปนี้มีประวัติใช้งานแล้วในระบบ' : 'ไม่มีประวัติสลิปซ้ำในระบบ'}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Contextual Suggestion Message Banner */}
                {ocrResult?.decisionSupportMessage && (
                  <div style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: ocrResult.messageType === 'success'
                      ? 'rgba(16, 185, 129, 0.12)'
                      : (ocrResult.messageType === 'warning'
                          ? 'rgba(245, 158, 11, 0.12)'
                          : (ocrResult.messageType === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(14, 165, 233, 0.1)')),
                    border: `1px solid ${ocrResult.messageType === 'success'
                      ? 'rgba(16, 185, 129, 0.3)'
                      : (ocrResult.messageType === 'warning'
                          ? 'rgba(245, 158, 11, 0.3)'
                          : (ocrResult.messageType === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(14, 165, 233, 0.3)'))}`,
                    color: ocrResult.messageType === 'success'
                      ? '#10b981'
                      : (ocrResult.messageType === 'warning'
                          ? '#f59e0b'
                          : (ocrResult.messageType === 'error' ? '#ef4444' : '#0ea5e9'))
                  }}>
                    {ocrResult.messageType === 'success' && <CheckCircle2 size={15} style={{ flexShrink: 0 }} />}
                    {ocrResult.messageType === 'warning' && <AlertTriangle size={15} style={{ flexShrink: 0 }} />}
                    {ocrResult.messageType === 'error' && <AlertCircle size={15} style={{ flexShrink: 0 }} />}
                    {ocrResult.messageType === 'info' && <AlertCircle size={15} style={{ flexShrink: 0 }} />}
                    <span style={{ fontWeight: 600 }}>{ocrResult.decisionSupportMessage}</span>
                  </div>
                )}

                {/* Disclaimer / Fail-safe Notice */}
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  * ผลการวิเคราะห์เป็นข้อมูลช่วยตัดสินใจสำหรับเจ้าหน้าที่เท่านั้น การอนุมัติหรือปฏิเสธขึ้นอยู่กับดุลยพินิจของเจ้าหน้าที่
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              {viewingSlipBooking.payment_status === 'paid' ? (
                <>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1.2, borderRadius: '12px', color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.4)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                    onClick={() => revertPayment(viewingSlipBooking)}
                  >
                    <RotateCcw size={15} />
                    <span>ยกเลิกการยืนยันชำระเงิน</span>
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 0.8, borderRadius: '12px', fontWeight: 600 }} 
                    onClick={() => setViewingSlipBooking(null)}
                  >
                    ปิดหน้าต่าง
                  </button>
                </>
              ) : (
                <>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 0.8, borderRadius: '12px' }} 
                    onClick={() => setViewingSlipBooking(null)}
                  >
                    ปิด
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1.1, borderRadius: '12px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                    onClick={() => {
                      const b = viewingSlipBooking;
                      setViewingSlipBooking(null);
                      handleOpenCancelModal(b);
                    }}
                  >
                    <Ban size={15} />
                    <span>ปฏิเสธสลิป</span>
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    style={{ flex: 1.5, borderRadius: '12px', backgroundColor: '#10b981', borderColor: '#10b981', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} 
                    onClick={() => {
                      const b = viewingSlipBooking;
                      setViewingSlipBooking(null);
                      handleOpenPayment(b);
                    }}
                  >
                    <CheckCircle2 size={16} />
                    <span>อนุมัติรับชำระเงิน</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
