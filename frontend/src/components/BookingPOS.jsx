import BasecampQuotaModal from './BasecampQuotaModal';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Minus, Trash2, Calendar, ShoppingCart, Printer, X, CreditCard,
  User, Users, Building, Building2, Phone, FileText, Check, ChevronLeft, ChevronRight,
  Clock, Search, ChevronUp, ChevronDown, Image, CheckCircle2, Key, Send,
  AlertTriangle, LayoutGrid, Columns, Sparkles, Layers, Presentation, Laptop, Coffee, Car, BookmarkPlus, Zap,
  Banknote, Smartphone, ExternalLink, Eye, EyeOff, Copy
} from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import { printReceipt } from '../utils/printReceiptHelper';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';
import { roomUsesDoorPin } from '../utils/doorPinHelper';
import { resolveRoomPin, resolveRoomPinInfo, isInternalBooking, getRoomPinLabel, NO_PIN_ROOM_IDS } from '../utils/doorPinHelper';
import { calculatePaymentPreview, formatMoney, roundMoney } from '../utils/financialUtils';

const TIMELINE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const TIMELINE_START = 8;
const TIMELINE_END = 18;
const TIMELINE_TOTAL_HOURS = 10;

const TIME_OPTIONS_POS = [];
for (let h = 8; h <= 18; h++) {
  const hh = String(h).padStart(2, '0');
  TIME_OPTIONS_POS.push(`${hh}:00`);
  if (h < 18) {
    TIME_OPTIONS_POS.push(`${hh}:30`);
  }
}

// Robust Date Helpers (No UTC Timezone Offset Bugs)
const formatDateToYYYYMMDD = (d) => {
  if (!d) return '';
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDaysToDateStr = (dateStr, days) => {
  if (!dateStr) return formatDateToYYYYMMDD(new Date());
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + days);
  return formatDateToYYYYMMDD(d);
};

// Unified Payment Status Language Helper (POS Phase B)
const getUnifiedPaymentStatus = (ev) => {
  const pStatus = ev?.payment_status || 'pending';
  const hasSlip = !!ev?.slip_image_url;

  if (pStatus === 'paid') {
    return {
      key: 'paid',
      label: 'ชำระแล้ว',
      color: '#10b981',
      bgLight: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.35)',
      dotColor: '#10b981'
    };
  }
  if (pStatus === 'reviewing' || (hasSlip && pStatus !== 'paid' && pStatus !== 'cancelled' && pStatus !== 'rejected')) {
    return {
      key: 'reviewing',
      label: 'รอตรวจสลิป',
      color: '#2563eb',
      bgLight: 'rgba(37, 99, 235, 0.12)',
      border: 'rgba(37, 99, 235, 0.35)',
      dotColor: '#2563eb'
    };
  }
  if (pStatus === 'internal_free' || ev?.customer_type === 'builtland') {
    return {
      key: 'internal_free',
      label: 'ใช้งานภายใน',
      color: '#8b5cf6',
      bgLight: 'rgba(139, 92, 246, 0.12)',
      border: 'rgba(139, 92, 246, 0.35)',
      dotColor: '#8b5cf6'
    };
  }
  if (pStatus === 'rejected') {
    return {
      key: 'rejected',
      label: 'สลิปถูกปฏิเสธ — รอหลักฐานใหม่',
      color: '#ef4444',
      bgLight: 'rgba(239, 68, 68, 0.12)',
      border: 'rgba(239, 68, 68, 0.35)',
      dotColor: '#ef4444'
    };
  }
  if (pStatus === 'cancelled' || ev?.status === 'cancelled') {
    return {
      key: 'cancelled',
      label: 'ยกเลิก',
      color: '#94a3b8',
      bgLight: 'rgba(148, 163, 184, 0.12)',
      border: 'rgba(148, 163, 184, 0.35)',
      dotColor: '#94a3b8'
    };
  }
  return {
    key: 'pending',
    label: 'รอชำระ',
    color: '#f59e0b',
    bgLight: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
    dotColor: '#f59e0b'
  };
};

function BookingPOS({ user, settings, sysAlert, preselectedRoom, clearPreselectedRoom, posTargetView, clearPosTargetView, onNavigate, onExportToQuotation, showCartSidebar, setShowCartSidebar, onCartCountChange }) {
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredBooking, setHoveredBooking] = useState(null);

  // View Modes: 'matrix' (Unified Timeline Matrix & Rich Room Cards) | 'calendar' (Monthly Calendar Overview)
  const [mainViewMode, setMainViewMode] = useState('matrix');

  // Handle transient view target handoff from Today Overview shortcuts
  useEffect(() => {
    if (posTargetView) {
      if (posTargetView === 'calendar' || posTargetView === 'matrix') {
        setMainViewMode(posTargetView);
      }
      if (typeof clearPosTargetView === 'function') {
        clearPosTargetView();
      }
    }
  }, [posTargetView, clearPosTargetView]);

  const [showBasecampQuotaModal, setShowBasecampQuotaModal] = useState(false);
  const [timelineCategory, setTimelineCategory] = useState('all');
  const [timelineDate, setTimelineDate] = useState(formatDateToYYYYMMDD(new Date()));

  // Customer details (Walk-in / Builtland / Basecamp)
  const [customer, setCustomer] = useState({
    name: '',
    department: '',
    contact: '',
    customer_type: 'walkin', // 'walkin', 'builtland', 'basecamp', 'shop'
    customer_id: null,
    contract_id: null,
    basecamp_sub_type: 'office', // 'office', 'hotdesk'
    basecamp_unit: '401', // Office 401-414, Hotdesk 419-422, 427-430
    internal_department: 'ฝ่ายการเงินและบัญชี',
    billing_option: 'paid' // 'paid', 'tenant_bill', 'quota'
  });

  const [bookingDetails, setBookingDetails] = useState('');

  const [basecampQuota, setBasecampQuota] = useState({ max_quota: 4, used_quota: 0, remaining_quota: 4 });
  const [shopQuota, setShopQuota] = useState({ max_quota: 4, used_quota: 0, remaining_quota: 4, contract_eligible: true });
  const [registeredShops, setRegisteredShops] = useState([]);
  const [registeredBasecamps, setRegisteredBasecamps] = useState([]);

  const BASECAMP_OFFICE_UNITS = ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411', '412', '413', '414'];
  const BASECAMP_HOTDESK_UNITS = ['419', '420', '421', '422', '427', '428', '429', '430'];
  const BUILTLAND_DEPARTMENTS = [
    'ฝ่ายการเงินและบัญชี',
    'ฝ่ายขายและการตลาด',
    'ฝ่ายทรัพยากรบุคคลและธุรการ (HR)',
    'ฝ่ายเทคโนโลยีสารสนเทศ (IT)',
    'ฝ่ายบริหารโครงการและก่อสร้าง',
    'สำนักกรรมการผู้จัดการ / ผู้บริหาร'
  ];

  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cartPaymentMethod, setCartPaymentMethod] = useState('cash');

  // Financial Checkout States (Phase 3)
  const [quickDiscountType, setQuickDiscountType] = useState('none'); // 'none' | 'percent' | 'amount'
  const [quickDiscountValue, setQuickDiscountValue] = useState('');
  const [quickPaymentMode, setQuickPaymentMode] = useState('full'); // 'full' | 'deposit' | 'unpaid'
  const [quickDepositAmount, setQuickDepositAmount] = useState('');
  const [isSubmittingQuickBooking, setIsSubmittingQuickBooking] = useState(false);

  const [cartDiscountType, setCartDiscountType] = useState('none'); // 'none' | 'percent' | 'amount'
  const [cartDiscountValue, setCartDiscountValue] = useState('');
  const [cartPaymentMode, setCartPaymentMode] = useState('full'); // 'full' | 'deposit' | 'unpaid'
  const [cartDepositAmount, setCartDepositAmount] = useState('');
  const [isSubmittingCartBooking, setIsSubmittingCartBooking] = useState(false);

  // Main interactive calendar navigation (Large Calendar)
  const today = new Date();
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth()); // 0-indexed
  const [calendarEvents, setCalendarEvents] = useState([]);

  // Day Modal & Selected Day states
  const [selectedDay, setSelectedDay] = useState({
    day: today.getDate(),
    month: today.getMonth(),
    year: today.getFullYear(),
    isOtherMonth: false
  });

  const [sidebarSelectedDay, setSidebarSelectedDay] = useState({
    day: today.getDate(),
    month: today.getMonth(),
    year: today.getFullYear(),
    isOtherMonth: false
  });

  // Room scheduling Slide-over Drawer / Modal
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [viewedEvent, setViewedEvent] = useState(null);
  const [bookingType, setBookingType] = useState('hourly'); // 'hourly' | 'halfday' | 'daily'
  const [dailyTimeSlot, setDailyTimeSlot] = useState('08-17'); // '08-17' | '09-18' | '08-12' | '13-17'
  const [layoutType, setLayoutType] = useState('standard'); // 'standard' | 'classroom'
  const [selectedRoomsFilter, setSelectedRoomsFilter] = useState({});

  const [roomSchedule, setRoomSchedule] = useState({
    date: formatDateToYYYYMMDD(new Date()),
    startHour: '09',
    startMinute: '00',
    endHour: '10',
    endMinute: '00',
    guestCount: ''
  });

  // Room Access PIN viewing & popover state (BWORK-CALENDAR-PIN-V1)
  const [activePinPopover, setActivePinPopover] = useState(null);
  const [revealedAgendaPins, setRevealedAgendaPins] = useState({});
  const [copiedPinKey, setCopiedPinKey] = useState(null);
  const pinPopoverTimeoutRef = useRef(null);

  // Clear popovers and reveals on date/month navigation
  useEffect(() => {
    setActivePinPopover(null);
    setRevealedAgendaPins({});
  }, [calendarYear, calendarMonth, timelineDate, sidebarSelectedDay]);

  // Dismiss PIN popover on outside click, scroll, or resize
  useEffect(() => {
    if (!activePinPopover) return;

    const handleOutsideClick = (e) => {
      if (!e.target.closest('.room-pin-popover-portal') &&
          !e.target.closest('.room-pin-trigger-btn') &&
          !e.target.closest('.calendar-pin-trigger-btn') &&
          !e.target.closest('.floorplan-pin-trigger-btn')) {
        setActivePinPopover(null);
      }
    };

    const handleScrollOrResize = (e) => {
      if (e.target && e.target.closest && e.target.closest('.room-pin-popover-portal')) {
        return;
      }
      setActivePinPopover(null);
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('touchstart', handleOutsideClick);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('touchstart', handleOutsideClick);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [activePinPopover]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (pinPopoverTimeoutRef.current) {
        clearTimeout(pinPopoverTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyPin = async (pinText, key) => {
    if (!pinText) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(pinText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = pinText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedPinKey(key);
      setTimeout(() => {
        setCopiedPinKey(prev => (prev === key ? null : prev));
      }, 2000);
    } catch (err) {
      // Do not log raw PIN
    }
  };

  const handleTogglePinPopover = (key, roomsData, anchorEl) => {
    if (pinPopoverTimeoutRef.current) {
      clearTimeout(pinPopoverTimeoutRef.current);
      pinPopoverTimeoutRef.current = null;
    }
    if (activePinPopover && activePinPopover.key === key) {
      setActivePinPopover(null);
    } else {
      const rect = anchorEl.getBoundingClientRect();
      const isInternal = roomsData.some(rm => rm.pinType === 'internal');
      setActivePinPopover({
        key,
        rect,
        rooms: roomsData,
        isInternal
      });
    }
  };

  const handleHoverPinPopover = (key, roomsData, anchorEl) => {
    if (pinPopoverTimeoutRef.current) {
      clearTimeout(pinPopoverTimeoutRef.current);
      pinPopoverTimeoutRef.current = null;
    }
    const rect = anchorEl.getBoundingClientRect();
    const isInternal = roomsData.some(rm => rm.pinType === 'internal');
    setActivePinPopover({
      key,
      rect,
      rooms: roomsData,
      isInternal
    });
  };

  const handleLeavePinPopover = () => {
    if (pinPopoverTimeoutRef.current) {
      clearTimeout(pinPopoverTimeoutRef.current);
    }
    pinPopoverTimeoutRef.current = setTimeout(() => {
      setActivePinPopover(null);
    }, 250);
  };

  const toggleAgendaPinReveal = (key) => {
    setRevealedAgendaPins(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getCalendarEventRoomsData = (ev) => {
    if (!ev) return [];
    const bId = ev.booking_id || ev.id;
    const related = (Array.isArray(calendarEvents) ? calendarEvents : []).filter(it => (it.booking_id || it.id) === bId);
    const items = related.length > 0 ? related : [ev];

    const seenRooms = new Set();
    const uniqueItems = items.filter(it => {
      const rId = it.room_id || ev.room_id;
      if (!rId) return true;
      if (seenRooms.has(rId)) return false;
      seenRooms.add(rId);
      return true;
    });

    return uniqueItems.map(item => {
      const rId = item.room_id || ev.room_id;
      const rObj = (Array.isArray(rooms) ? rooms : []).find(r => r.id === rId);
      const usesPin = roomUsesDoorPin(rObj || rId);
      const pinBooking = {
        ...ev,
        ...item,
        customer_type: item.customer_type || ev.customer_type,
        billing_option: item.billing_option || ev.billing_option,
        payment_status: item.payment_status || ev.payment_status,
        items: [item]
      };
      const pinInfo = usesPin ? resolveRoomPinInfo(pinBooking, rId, rObj) : { pin: '', pinType: 'none' };
      return {
        roomId: rId || 0,
        roomName: item.room_name || rObj?.name || (rId ? `ห้อง #${rId}` : 'ห้อง'),
        pin: pinInfo.pin || '',
        pinType: pinInfo.pinType,
        hasDoorPin: usesPin && !!pinInfo.pin
      };
    });
  };

  const getFloorPlanRoomData = (ev, room) => {
    const rId = room?.id || ev?.room_id;
    const usesPin = roomUsesDoorPin(room || rId);
    const pinBooking = ev ? { ...ev, items: [ev] } : null;
    const pinInfo = usesPin ? resolveRoomPinInfo(pinBooking, rId, room) : { pin: '', pinType: 'none' };
    return [{
      roomId: rId || 0,
      roomName: room?.name || ev?.room_name || (rId ? `ห้อง #${rId}` : 'ห้อง'),
      pin: pinInfo.pin || '',
      pinType: pinInfo.pinType,
      hasDoorPin: usesPin && !!pinInfo.pin
    }];
  };


  // Fetch registered customers (Shop and Basecamp) on mount
  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
    fetch('/api/customers?status=active', { headers: authHeader })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.customers) {
          setRegisteredShops(data.customers.filter(c => c.customer_type === 'shop'));
          setRegisteredBasecamps(data.customers.filter(c => c.customer_type === 'basecamp'));
        }
      })
      .catch(err => console.error('Failed to load registered customers in POS:', err));
  }, []);

  // Fetch Basecamp or Shop Quota when unit/customer changes
  useEffect(() => {
    const curMonth = roomSchedule.date ? roomSchedule.date.substring(5, 7) : String(new Date().getMonth() + 1).padStart(2, '0');
    const curYear = roomSchedule.date ? roomSchedule.date.substring(0, 4) : String(new Date().getFullYear());
    const targetDate = roomSchedule.date || '';

    if (customer.customer_type === 'basecamp') {
      const subType = customer.basecamp_sub_type || 'office';
      const unit = customer.basecamp_unit || (subType === 'office' ? '401' : '419');

      const url = customer.customer_id
        ? `/api/customers/${customer.customer_id}/quota?month=${curMonth}&year=${curYear}&date=${targetDate}`
        : `/api/basecamp/quota?sub_type=${subType}&unit=${unit}&month=${curMonth}&year=${curYear}`;

      fetch(url)
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            setBasecampQuota(data);
          }
        })
        .catch(err => console.error('Failed to fetch quota:', err));
    } else if (customer.customer_type === 'shop') {
      if (customer.customer_id) {
        fetch(`/api/customers/${customer.customer_id}/quota?month=${curMonth}&year=${curYear}&date=${targetDate}`)
          .then(res => res.json())
          .then(data => {
            if (data && !data.error) {
              setShopQuota(data);
            }
          })
          .catch(err => console.error('Failed to fetch shop quota:', err));
      } else {
        setShopQuota({ max_quota: 4, used_quota: 0, remaining_quota: 0, contract_eligible: false });
      }
    }
  }, [customer.customer_type, customer.customer_id, customer.basecamp_sub_type, customer.basecamp_unit, roomSchedule.date]);

  // Service selection modal
  const [showServicePicker, setShowServicePicker] = useState(false);

  // Printing State
  const [printBooking, setPrintBooking] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Cart count notification
  useEffect(() => {
    if (onCartCountChange) {
      onCartCountChange(cart.length);
    }
  }, [cart, onCartCountChange]);

  // =========================================================
  // DATA FETCHING
  // =========================================================
  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    fetchCalendarEvents();
    // Auto-refresh calendar events every 8 seconds to show newly approved/created bookings live
    const interval = setInterval(() => {
      fetchCalendarEvents();
    }, 8000);

    const onFocus = () => fetchCalendarEvents();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [calendarYear, calendarMonth]);

  // Handle Escape key to close open modals/drawers safely without navigating away
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showReceiptModal) {
          setShowReceiptModal(false);
          setPrintBooking(null);
        } else if (viewedEvent) {
          setViewedEvent(null);
        } else if (showServicePicker) {
          setShowServicePicker(false);
        } else if (selectedRoom) {
          setSelectedRoom(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showReceiptModal, viewedEvent, showServicePicker, selectedRoom]);

  const fetchItems = async () => {
    try {
      const roomsRes = await fetch('/api/rooms?status=active');
      const servicesRes = await fetch('/api/services?status=active');
      if (roomsRes.ok && servicesRes.ok) {
        const roomsData = await roomsRes.json();
        setRooms(roomsData);
        setServices(await servicesRes.json());
      }
    } catch (err) {
      console.error('Failed to load POS catalog:', err);
    }
  };

  const fetchCalendarEvents = async () => {
    try {
      const res = await fetch(`/api/bookings/calendar?month=${calendarMonth + 1}&year=${calendarYear}`);
      if (res.ok) {
        const data = await res.json();
        setCalendarEvents(data);
      }
    } catch (err) {
      console.error('Failed to fetch calendar events:', err);
    }
  };

  // Sync calendar when timeline date changes (without overriding manual month navigation)
  useEffect(() => {
    if (timelineDate) {
      const parts = timelineDate.split('-');
      if (parts.length === 3) {
        const yr = parseInt(parts[0], 10);
        const mo = parseInt(parts[1], 10) - 1;
        const dy = parseInt(parts[2], 10);
        if (mainViewMode === 'matrix') {
          setCalendarYear(yr);
          setCalendarMonth(mo);
        }
        setSelectedDay({ day: dy, month: mo, year: yr, isOtherMonth: false });
        setSidebarSelectedDay({ day: dy, month: mo, year: yr, isOtherMonth: false });
      }
    }
  }, [timelineDate, mainViewMode]);

  // =========================================================
  // DATE & THAI HELPERS
  // =========================================================
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const monthNamesEng = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const weekdays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

  const getLocalDateStr = (timeVal) => {
    if (!timeVal) return '';
    if (typeof timeVal === 'string') {
      if (timeVal.includes('T')) return timeVal.split('T')[0];
      if (timeVal.includes(' ')) return timeVal.split(' ')[0];
    }
    const d = new Date(timeVal);
    if (isNaN(d.getTime())) return '';
    return formatDateToYYYYMMDD(d);
  };

  const formatLocalISO = (d) => {
    if (!d) return '';
    const dateObj = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dateObj.getTime())) return String(d);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  };

  const getThaiDateFull = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    if (isNaN(d.getTime())) return dateStr;
    return `วัน${weekdays[d.getDay()]}ที่ ${day} ${monthNames[month]} ${year + 543}`;
  };

  const getDateKey = (day, month, year) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Timeline Date Navigators
  const handlePrevTimelineDay = () => {
    setTimelineDate(prev => addDaysToDateStr(prev, -1));
  };

  const handleNextTimelineDay = () => {
    setTimelineDate(prev => addDaysToDateStr(prev, 1));
  };

  const handleTodayTimeline = () => {
    setTimelineDate(formatDateToYYYYMMDD(new Date()));
  };

  // Calendar Month Navigators & Day Selector (POS Phase C)
  const handlePrevMonth = () => {
    const newMonth = calendarMonth === 0 ? 11 : calendarMonth - 1;
    const newYear = calendarMonth === 0 ? calendarYear - 1 : calendarYear;
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);

    const now = new Date();
    if (now.getFullYear() === newYear && now.getMonth() === newMonth) {
      const todayObj = { day: now.getDate(), month: newMonth, year: newYear, isOtherMonth: false };
      setSelectedDay(todayObj);
      setSidebarSelectedDay(todayObj);
      setTimelineDate(formatDateToYYYYMMDD(now));
    } else {
      const maxDays = new Date(newYear, newMonth + 1, 0).getDate();
      const targetDay = Math.min(sidebarSelectedDay?.day || 1, maxDays);
      const dayObj = { day: targetDay, month: newMonth, year: newYear, isOtherMonth: false };
      setSelectedDay(dayObj);
      setSidebarSelectedDay(dayObj);
      setTimelineDate(getDateKey(targetDay, newMonth, newYear));
    }
  };

  const handleNextMonth = () => {
    const newMonth = calendarMonth === 11 ? 0 : calendarMonth + 1;
    const newYear = calendarMonth === 11 ? calendarYear + 1 : calendarYear;
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);

    const now = new Date();
    if (now.getFullYear() === newYear && now.getMonth() === newMonth) {
      const todayObj = { day: now.getDate(), month: newMonth, year: newYear, isOtherMonth: false };
      setSelectedDay(todayObj);
      setSidebarSelectedDay(todayObj);
      setTimelineDate(formatDateToYYYYMMDD(now));
    } else {
      const maxDays = new Date(newYear, newMonth + 1, 0).getDate();
      const targetDay = Math.min(sidebarSelectedDay?.day || 1, maxDays);
      const dayObj = { day: targetDay, month: newMonth, year: newYear, isOtherMonth: false };
      setSelectedDay(dayObj);
      setSidebarSelectedDay(dayObj);
      setTimelineDate(getDateKey(targetDay, newMonth, newYear));
    }
  };

  const handleTodayMonth = () => {
    const now = new Date();
    setCalendarMonth(now.getMonth());
    setCalendarYear(now.getFullYear());
    const todayObj = {
      day: now.getDate(),
      month: now.getMonth(),
      year: now.getFullYear(),
      isOtherMonth: false
    };
    setSelectedDay(todayObj);
    setSidebarSelectedDay(todayObj);
    setTimelineDate(formatDateToYYYYMMDD(now));
  };

  const handleSelectCalendarDay = (dayObj) => {
    if (dayObj.isOtherMonth) {
      setCalendarMonth(dayObj.month);
      setCalendarYear(dayObj.year);
    }
    setSelectedDay(dayObj);
    setSidebarSelectedDay(dayObj);
    const dateKey = getDateKey(dayObj.day, dayObj.month, dayObj.year);
    setTimelineDate(dateKey);
  };

  // =========================================================
  // FILTERED ROOMS & EVENTS
  // =========================================================
  const filteredTimelineRooms = useMemo(() => {
    const list = rooms.filter(r => {
      const cat = (r.category || '').toLowerCase();
      const name = (r.name || '').toLowerCase();

      // Category filter based on inventory / database data (อิงข้อมูลจากคลังสินค้า)
      if (timelineCategory !== 'all') {
        if (timelineCategory === 'meeting') {
          // ห้องประชุม: match category containing meeting or ห้องประชุม, or standard meeting rooms (including Uranus)
          const isMeetingCat = cat.includes('meeting') || cat.includes('ห้องประชุม') || cat.includes('สัมมนา');
          const isMeetingName = name.includes('mars') || name.includes('mercury') || name.includes('saturn') ||
                                name.includes('venus') || name.includes('uranus') || name.includes('neptune') ||
                                name.includes('jupiter') || name.includes('pluto');
          if (!isMeetingCat && !isMeetingName) return false;
        } else if (timelineCategory === 'coworking') {
          // Co-Working: match if category contains coworking, or name explicitly specifies co-working
          const isCoworkCat = cat.includes('coworking') || cat.includes('co-working');
          const isCoworkName = (name.includes('co-working') || name.includes('coworking') || name.includes('โซน')) && !name.includes('uranus');
          if (!isCoworkCat && !isCoworkName) return false;
        } else if (timelineCategory === 'cafe') {
          const isCafe = cat.includes('cafe') || cat.includes('koocafe') || name.includes('cafe') || name.includes('koocafe');
          if (!isCafe) return false;
        } else if (timelineCategory === 'parking') {
          const isParking = cat.includes('parking') || cat.includes('ที่จอดรถ') || name.includes('ที่จอดรถ') || name.includes('parking');
          if (!isParking) return false;
        } else {
          if (!cat.includes(timelineCategory.toLowerCase())) return false;
        }
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = name.includes(q);
        const matchCat = cat.includes(q);
        if (!matchName && !matchCat) return false;
      }
      return true;
    });

    // Sort rooms by room number extracted from name (e.g. "(201)" -> 201), then alphabetically by name
    return list.sort((a, b) => {
      const getRoomNum = (name) => {
        const m = (name || '').match(/\((\d+)\)/);
        return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
      };
      const numA = getRoomNum(a.name);
      const numB = getRoomNum(b.name);
      if (numA !== numB) {
        return numA - numB;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [rooms, timelineCategory, searchQuery]);

  // Calendar monthly calculations
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay(); // 0=Sun
    const daysInMonth = lastDay.getDate();

    const prevMonthLast = new Date(calendarYear, calendarMonth, 0);
    const prevMonthDays = prevMonthLast.getDate();
    const days = [];

    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const prevMonth = calendarMonth === 0 ? 11 : calendarMonth - 1;
      const prevYear = calendarMonth === 0 ? calendarYear - 1 : calendarYear;
      days.push({ day, month: prevMonth, year: prevYear, isOtherMonth: true });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: calendarMonth, year: calendarYear, isOtherMonth: false });
    }

    const totalCells = days.length <= 35 ? 35 : 42;
    const remaining = totalCells - days.length;
    for (let i = 1; i <= remaining; i++) {
      const nextMonth = calendarMonth === 11 ? 0 : calendarMonth + 1;
      const nextYear = calendarMonth === 11 ? calendarYear + 1 : calendarYear;
      days.push({ day: i, month: nextMonth, year: nextYear, isOtherMonth: true });
    }

    return days;
  }, [calendarYear, calendarMonth]);

  const eventsByDay = useMemo(() => {
    const map = {};
    calendarEvents.forEach(ev => {
      const dateStr = getLocalDateStr(ev.start_time);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(ev);
    });
    return map;
  }, [calendarEvents]);

  const filteredEventsByDay = useMemo(() => {
    const map = {};
    calendarEvents.forEach(ev => {
      const isFiltered = Object.keys(selectedRoomsFilter).length > 0 && selectedRoomsFilter[ev.room_id] === false;
      if (isFiltered) return;
      const dateStr = getLocalDateStr(ev.start_time);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(ev);
    });
    return map;
  }, [calendarEvents, selectedRoomsFilter]);

  const selectedDayBookings = useMemo(() => {
    if (!sidebarSelectedDay) return [];
    const dateKey = getDateKey(sidebarSelectedDay.day, sidebarSelectedDay.month, sidebarSelectedDay.year);
    const list = filteredEventsByDay[dateKey] || eventsByDay[dateKey] || [];
    return [...list].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [sidebarSelectedDay, filteredEventsByDay, eventsByDay]);

  // Timeline events for specific room on timelineDate
  const getTimelineRoomEvents = (roomId) => {
    return calendarEvents.filter(ev => {
      if (ev.room_id !== roomId) return false;
      if (ev.status === 'cancelled') return false;
      const dStr = getLocalDateStr(ev.start_time);
      return dStr === timelineDate;
    }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  };

  // Strict Real-Time Time Protection for POS: For today, filter out past time slots
  const posAvailableStartOptions = useMemo(() => {
    const isToday = roomSchedule.date === formatDateToYYYYMMDD(new Date());
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    if (!isToday) {
      return TIME_OPTIONS_POS.filter(t => t < '18:00');
    }
    const unpassed = TIME_OPTIONS_POS.filter(t => {
      if (t >= '18:00') return false;
      const [h, m] = t.split(':').map(Number);
      return (h * 60 + m) >= currentMins;
    });
    return unpassed.length > 0 ? unpassed : TIME_OPTIONS_POS.filter(t => t < '18:00');
  }, [roomSchedule.date]);

  // Realtime Overlap & Cleaning Buffer Checker
  const currentSlotOverlap = useMemo(() => {
    if (!selectedRoom || !roomSchedule.date) return { isValid: true, isOverlap: false, booking: null };

    let sTime = null;
    let eTime = null;
    let isValid = true;

    if (bookingType === 'daily') {
      const [startH, endH] = dailyTimeSlot === '08-17' ? ['08', '17'] : ['09', '18'];
      sTime = new Date(`${roomSchedule.date}T${startH}:00`);
      eTime = new Date(`${roomSchedule.date}T${endH}:00`);
    } else if (bookingType === 'halfday') {
      const [startH, endH] = dailyTimeSlot === '08-12' ? ['08', '12'] : ['13', '17'];
      sTime = new Date(`${roomSchedule.date}T${startH}:00`);
      eTime = new Date(`${roomSchedule.date}T${endH}:00`);
    } else {
      const sh = parseInt(roomSchedule.startHour, 10);
      const sm = parseInt(roomSchedule.startMinute, 10);
      const eh = parseInt(roomSchedule.endHour, 10);
      const em = parseInt(roomSchedule.endMinute, 10);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em) ||
          sh < 0 || sh > 23 || sm < 0 || sm > 59 ||
          eh < 0 || eh > 23 || em < 0 || em > 59) {
        isValid = false;
      } else {
        const startHPad = String(sh).padStart(2, '0');
        const startMPad = String(sm).padStart(2, '0');
        const endHPad = String(eh).padStart(2, '0');
        const endMPad = String(em).padStart(2, '0');
        sTime = new Date(`${roomSchedule.date}T${startHPad}:${startMPad}`);
        eTime = new Date(`${roomSchedule.date}T${endHPad}:${endMPad}`);
        if (eTime <= sTime) isValid = false;
      }
    }

    if (!isValid || !sTime || !eTime) {
      return { isValid: false, isOverlap: false, booking: null };
    }

    const bufferMins = Number(settings?.cleaning_buffer_minutes !== undefined ? settings.cleaning_buffer_minutes : 30);
    const bufferMs = bufferMins * 60 * 1000;
    const reqStartMs = sTime.getTime();
    const reqEndMs = eTime.getTime();
    const reqEndBufferedMs = reqEndMs + bufferMs;

    // Check overlap with calendarEvents taking cleaning buffer into account
    for (const ev of calendarEvents) {
      if (ev.room_id !== selectedRoom.id) continue;
      if (ev.status === 'cancelled' || ev.payment_status === 'cancelled') continue;
      const evStartMs = new Date(ev.start_time).getTime();
      const evEndMs = new Date(ev.end_time).getTime();
      const evEndBufferedMs = evEndMs + bufferMs;

      if (reqStartMs < evEndBufferedMs && reqEndBufferedMs > evStartMs) {
        const isDirectUsage = (reqStartMs < evEndMs && reqEndMs > evStartMs);
        return {
          isValid: true,
          isOverlap: true,
          isCleaningBuffer: !isDirectUsage,
          bufferMinutes: bufferMins,
          booking: ev,
          source: 'database'
        };
      }
    }

    // Check overlap with cart items taking cleaning buffer into account
    for (const item of cart) {
      if (item.room_id !== selectedRoom.id) continue;
      const cStartMs = new Date(item.start_time).getTime();
      const cEndMs = new Date(item.end_time).getTime();
      const cEndBufferedMs = cEndMs + bufferMs;

      if (reqStartMs < cEndBufferedMs && reqEndBufferedMs > cStartMs) {
        const isDirectUsage = (reqStartMs < cEndMs && reqEndMs > cStartMs);
        return {
          isValid: true,
          isOverlap: true,
          isCleaningBuffer: !isDirectUsage,
          bufferMinutes: bufferMins,
          booking: {
            customer_name: customer.name || 'ในตะกร้าสินค้า',
            start_time: item.start_time,
            end_time: item.end_time
          },
          source: 'cart'
        };
      }
    }

    return { isValid: true, isOverlap: false, booking: null };
  }, [selectedRoom, roomSchedule, bookingType, dailyTimeSlot, calendarEvents, cart, customer.name, settings]);

  // =========================================================
  // ACTIONS: OPEN DRAWER & BOOKING
  // =========================================================
  const openDrawerForSlot = (room, hour = 9, explicitDate = null) => {
    setSelectedRoom(room);
    const hasHourly = (room.has_hourly === 1 || room.has_hourly === true || (Number(room.hourly_rate) > 0));
    const hasHalfday = (room.has_halfday === 1 || room.has_halfday === true || (Number(room.half_day_rate) > 0));
    const hasDaily = (room.has_daily === 1 || room.has_daily === true || (Number(room.daily_rate) > 0));

    if (hasHourly) {
      setBookingType('hourly');
      setDailyTimeSlot('08-17');
    } else if (hasHalfday) {
      setBookingType('halfday');
      setDailyTimeSlot('08-12');
    } else if (hasDaily) {
      setBookingType('daily');
      setDailyTimeSlot('08-17');
    } else {
      setBookingType('daily');
      setDailyTimeSlot('08-17');
    }
    setLayoutType('standard');
    let startH = 9;
    let startM = 0;
    if (typeof hour === 'string' && hour.includes(':')) {
      const [h, m] = hour.split(':').map(Number);
      startH = h || 9;
      startM = m || 0;
    } else if (typeof hour === 'number') {
      startH = Math.floor(hour);
      startM = (hour % 1 >= 0.5) ? 30 : 0;
    }

    const targetDate = explicitDate || timelineDate;
    const isToday = targetDate === formatDateToYYYYMMDD(new Date());
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    if (isToday && (startH * 60 + startM) < currentMins) {
      const firstValid = TIME_OPTIONS_POS.find(t => {
        if (t >= '18:00') return false;
        const [h, m] = t.split(':').map(Number);
        return (h * 60 + m) >= currentMins;
      });
      if (firstValid) {
        const [fh, fm] = firstValid.split(':').map(Number);
        startH = fh;
        startM = fm;
      }
    }

    let endMins = startH * 60 + startM + 60;
    if (endMins > 18 * 60) endMins = 18 * 60;
    const endH = Math.floor(endMins / 60);
    const endM = endMins % 60;

    setRoomSchedule({
      date: targetDate,
      startHour: String(startH).padStart(2, '0'),
      startMinute: String(startM).padStart(2, '0'),
      endHour: String(endH).padStart(2, '0'),
      endMinute: String(endM).padStart(2, '0'),
      guestCount: ''
    });
    setPaymentStatus('paid');
    setPaymentMethod('cash');
    resetQuickFinancials();
  };

  const resetQuickFinancials = () => {
    setQuickDiscountType('none');
    setQuickDiscountValue('');
    setQuickPaymentMode('full');
    setQuickDepositAmount('');
    setPaymentMethod('cash');
  };

  const resetCartFinancials = () => {
    setCartDiscountType('none');
    setCartDiscountValue('');
    setCartPaymentMode('full');
    setCartDepositAmount('');
    setCartPaymentMethod('cash');
  };

  const handleCustomerTypeChange = (newType) => {
    let newCustomerId = null;
    let newContractId = null;
    let newName = '';
    let newContact = '';
    let newSubType = 'office';
    let newUnit = '401';

    if (newType === 'shop') {
      const firstShop = registeredShops[0];
      if (firstShop) {
        newCustomerId = firstShop.id;
        newContractId = firstShop.active_contract?.id || null;
        newName = firstShop.name;
        newContact = firstShop.phone || firstShop.contact_name || '';
      }
    } else if (newType === 'basecamp') {
      const matched = registeredBasecamps.find(b => b.basecamp_unit === '401');
      if (matched) {
        newCustomerId = matched.id;
        newContractId = matched.active_contract?.id || null;
        newName = matched.name;
        newContact = matched.phone || matched.contact_name || '';
      }
    }

    setCustomer(prev => ({
      ...prev,
      customer_type: newType,
      customer_id: newCustomerId,
      contract_id: newContractId,
      name: newName,
      contact: newContact,
      basecamp_sub_type: newSubType,
      basecamp_unit: newUnit,
      billing_option: newType === 'builtland' ? 'internal_free' : 'paid'
    }));
    resetQuickFinancials();
    resetCartFinancials();
    if (newType === 'builtland' || newType === 'basecamp' || newType === 'shop') {
      setPaymentMethod('cash');
      setCartPaymentMethod('cash');
    } else {
      setPaymentMethod('cash');
      setCartPaymentMethod('cash');
    }
  };

  const closeRoomModal = () => {
    setSelectedRoom(null);
    setBookingDetails('');
    resetQuickFinancials();
  };

  // Handle transient preselectedRoom handoff from RoomLayout
  useEffect(() => {
    if (preselectedRoom) {
      const foundRoom = (rooms || []).find(r => String(r.id) === String(preselectedRoom.id)) || preselectedRoom;
      if (foundRoom && foundRoom.id) {
        const todayStr = formatDateToYYYYMMDD(new Date());
        setTimelineDate(todayStr);
        setMainViewMode('matrix');
        openDrawerForSlot(foundRoom, 9, todayStr);
        if (typeof clearPreselectedRoom === 'function') {
          clearPreselectedRoom();
        }
      }
    }
  }, [preselectedRoom, rooms, clearPreselectedRoom]);

  // Quick Duration Setter inside Drawer (+1 ชม., +2 ชม., +3 ชม., +4 ชม.)
  const setQuickDuration = (hoursCount) => {
    setBookingType('hourly');
    const sh = parseInt(roomSchedule.startHour, 10) || 9;
    const sm = parseInt(roomSchedule.startMinute, 10) || 0;
    let endMins = sh * 60 + sm + hoursCount * 60;
    if (endMins > 18 * 60) endMins = 18 * 60;
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    setRoomSchedule({
      ...roomSchedule,
      endHour: String(eh).padStart(2, '0'),
      endMinute: String(em).padStart(2, '0')
    });
  };

  // Add Room to cart with schedule details
  const buildCartItem = () => {
    if (!selectedRoom) return null;

    let startTimeStr = '';
    let endTimeStr = '';
    let startDateTime = null;
    let endDateTime = null;
    let price = 0;
    let quantity = 0;
    let subtotal = 0;
    let hours = 0;

    if (bookingType === 'daily') {
      const [startH, endH] = dailyTimeSlot === '08-17' ? ['08', '17'] : ['09', '18'];
      startTimeStr = `${startH}:00`;
      endTimeStr = `${endH}:00`;
      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);
      price = layoutType === 'classroom' ? (selectedRoom.classroom_daily_rate || 0) : (selectedRoom.daily_rate || 0);
      quantity = 1;
      subtotal = price;

      if (price <= 0) {
        sysAlert('ราคารายวันของรูปแบบที่เลือกยังไม่ได้ถูกตั้งค่า');
        return null;
      }
    } else if (bookingType === 'halfday') {
      const [startH, endH] = dailyTimeSlot === '08-12' ? ['08', '12'] : ['13', '17'];
      startTimeStr = `${startH}:00`;
      endTimeStr = `${endH}:00`;
      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);
      price = selectedRoom.half_day_rate || 0;
      quantity = 1;
      subtotal = price;

      if (price <= 0) {
        sysAlert('ราคารายครึ่งวันของห้องประชุมนี้ยังไม่ได้ถูกตั้งค่า');
        return null;
      }
    } else {
      const startHourPad = String(roomSchedule.startHour || '0').padStart(2, '0');
      const startMinPad = String(roomSchedule.startMinute || '0').padStart(2, '0');
      const endHourPad = String(roomSchedule.endHour || '0').padStart(2, '0');
      const endMinPad = String(roomSchedule.endMinute || '0').padStart(2, '0');

      startTimeStr = `${startHourPad}:${startMinPad}`;
      endTimeStr = `${endHourPad}:${endMinPad}`;

      const sHourVal = parseInt(startHourPad, 10);
      const sMinVal = parseInt(startMinPad, 10);
      const eHourVal = parseInt(endHourPad, 10);
      const eMinVal = parseInt(endMinPad, 10);

      if (isNaN(sHourVal) || isNaN(sMinVal) || isNaN(eHourVal) || isNaN(eMinVal)) {
        sysAlert('กรุณาระบุเวลาให้ถูกต้อง');
        return null;
      }

      startDateTime = new Date(`${roomSchedule.date}T${startTimeStr}`);
      endDateTime = new Date(`${roomSchedule.date}T${endTimeStr}`);

      if (endDateTime <= startDateTime) {
        sysAlert('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้นจอง');
        return null;
      }

      const diffMs = endDateTime - startDateTime;
      hours = Math.ceil(diffMs / (1000 * 60 * 60));
      price = layoutType === 'classroom' ? (selectedRoom.classroom_hourly_rate || 0) : (selectedRoom.hourly_rate || 0);
      quantity = hours;
      subtotal = Math.round(hours * price * 100) / 100;

      if (price <= 0) {
        sysAlert('ราคารายชั่วโมงของรูปแบบที่เลือกยังไม่ได้ถูกตั้งค่า');
        return null;
      }
    }

    const layoutLabel = layoutType === 'classroom' ? ' (Classroom)' : ' (Standard)';
    const typeLabel = bookingType === 'daily' ? ' [รายวัน]' : bookingType === 'halfday' ? ' [ครึ่งวัน]' : ' [รายชม.]';
    const guestLabel = roomSchedule.guestCount ? ` (${roomSchedule.guestCount} ท่าน)` : '';

    return {
      type: 'room',
      room_id: selectedRoom.id,
      name: `${selectedRoom.name}${layoutLabel}${typeLabel}${guestLabel}`,
      price: price,
      quantity: quantity,
      subtotal: subtotal,
      date: roomSchedule.date,
      start_time: formatLocalISO(startDateTime),
      end_time: formatLocalISO(endDateTime),
      time_display: `${startTimeStr} - ${endTimeStr}`,
      booking_type: bookingType,
      layout: layoutType,
      guest_count: roomSchedule.guestCount ? parseInt(roomSchedule.guestCount, 10) : null
    };
  };

  const addRoomToCart = async () => {
    if (currentSlotOverlap.isOverlap) {
      if (currentSlotOverlap.isCleaningBuffer) {
        sysAlert(`ห้องนี้อยู่ในช่วงเวลาทำความสะอาด / เคลียร์ห้อง (${currentSlotOverlap.bufferMinutes || 30} นาที) กรุณาเลือกเวลาอื่น`);
      } else {
        sysAlert('ช่วงเวลานี้มีผู้จองแล้ว (ห้องไม่ว่าง) กรุณาเลือกเวลาอื่น');
      }
      return;
    }
    if (!customer.name.trim()) {
      sysAlert('กรุณากรอกชื่อผู้จองเพื่อทำรายการจองห้อง');
      return;
    }
    const cartItem = buildCartItem();
    if (!cartItem) return;

    setCart([...cart, cartItem]);
    closeRoomModal();
    if (setShowCartSidebar) {
      setShowCartSidebar(true);
    }
  };

  // Gross Subtotal and Financial Previews (Phase 3)
  const quickGrossSubtotal = useMemo(() => {
    if (!selectedRoom) return 0;
    if (customer.customer_type === 'builtland') return 0;
    let ratePrice = 0;
    if (bookingType === 'daily') {
      ratePrice = layoutType === 'classroom' ? (selectedRoom.classroom_daily_rate || 0) : (selectedRoom.daily_rate || 0);
      return ratePrice;
    } else if (bookingType === 'halfday') {
      ratePrice = selectedRoom.half_day_rate || 0;
      return ratePrice;
    } else {
      const sH = parseInt(roomSchedule.startHour, 10) || 9;
      const sM = parseInt(roomSchedule.startMinute, 10) || 0;
      const eH = parseInt(roomSchedule.endHour, 10) || 10;
      const eM = parseInt(roomSchedule.endMinute, 10) || 0;
      const diffMinutes = (eH * 60 + eM) - (sH * 60 + sM);
      const exactHours = diffMinutes > 0 ? diffMinutes / 60 : 1;
      const billedHours = Math.max(1, Math.ceil(exactHours));
      ratePrice = layoutType === 'classroom' ? (selectedRoom.classroom_hourly_rate || 0) : (selectedRoom.hourly_rate || 0);
      return Math.round(billedHours * ratePrice * 100) / 100;
    }
  }, [selectedRoom, bookingType, layoutType, dailyTimeSlot, roomSchedule, customer.customer_type]);

  const quickFinancialPreview = useMemo(() => {
    return calculatePaymentPreview({
      subtotal: quickGrossSubtotal,
      discountType: quickDiscountType,
      discountValue: quickDiscountValue,
      paymentMode: quickPaymentMode,
      depositAmount: quickDepositAmount,
      customerType: customer.customer_type,
      billingOption: customer.billing_option,
      paymentMethod: paymentMethod
    });
  }, [quickGrossSubtotal, quickDiscountType, quickDiscountValue, quickPaymentMode, quickDepositAmount, customer.customer_type, customer.billing_option, paymentMethod]);

  const cartGrossSubtotal = useMemo(() => {
    if (customer.customer_type === 'builtland') return 0;
    return cart.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
  }, [cart, customer.customer_type]);

  const cartFinancialPreview = useMemo(() => {
    return calculatePaymentPreview({
      subtotal: cartGrossSubtotal,
      discountType: cartDiscountType,
      discountValue: cartDiscountValue,
      paymentMode: cartPaymentMode,
      depositAmount: cartDepositAmount,
      customerType: customer.customer_type,
      billingOption: customer.billing_option,
      paymentMethod: cartPaymentMethod
    });
  }, [cartGrossSubtotal, cartDiscountType, cartDiscountValue, cartPaymentMode, cartDepositAmount, customer.customer_type, customer.billing_option, cartPaymentMethod]);

  // ⚡ Quick Direct Booking (Checkout directly from Drawer without Cart)
  const quickDirectBooking = async () => {
    if (isSubmittingQuickBooking) return;
    if (currentSlotOverlap.isOverlap) {
      if (currentSlotOverlap.isCleaningBuffer) {
        sysAlert(`ห้องนี้อยู่ในช่วงเวลาทำความสะอาด / เคลียร์ห้อง (${currentSlotOverlap.bufferMinutes || 30} นาที) กรุณาเลือกเวลาอื่น`);
      } else {
        sysAlert('ช่วงเวลานี้มีผู้จองแล้ว (ห้องไม่ว่าง) กรุณาเลือกเวลาอื่น');
      }
      return;
    }
    if (!customer.name.trim()) {
      sysAlert('กรุณากรอกชื่อผู้จองเพื่อทำรายการจองห้อง');
      return;
    }

    const isBuiltland = customer.customer_type === 'builtland';
    const isBasecamp = customer.customer_type === 'basecamp';
    const isShop = customer.customer_type === 'shop';

    if (!isBuiltland && !isBasecamp && !isShop) {
      if (quickFinancialPreview.discount_error) {
        sysAlert(quickFinancialPreview.discount_error);
        return;
      }
      if (quickFinancialPreview.deposit_error) {
        sysAlert(quickFinancialPreview.deposit_error);
        return;
      }
      if (quickFinancialPreview.requires_payment_method && !paymentMethod) {
        sysAlert('กรุณาเลือกช่องทางการชำระเงิน');
        return;
      }
    }

    const singleItem = buildCartItem();
    if (!singleItem) return;

    setIsSubmittingQuickBooking(true);
    try {
      const effectivePaymentMode = isBuiltland ? 'full' : (isBasecamp ? 'full' : quickFinancialPreview.payment_mode);
      const effectiveDiscountType = isBuiltland ? 'none' : quickFinancialPreview.discount_type;
      const effectiveDiscountValue = isBuiltland ? 0 : quickFinancialPreview.discount_value;
      const effectiveDepositAmount = (isBuiltland || quickPaymentMode !== 'deposit') ? 0 : (Number(quickDepositAmount) || 0);

      const effectivePaymentMethod = (isBuiltland || isBasecamp || isShop || effectivePaymentMode === 'unpaid' || quickFinancialPreview.total_amount === 0)
        ? (paymentMethod || 'cash')
        : paymentMethod;

      const payload = {
        customer_name: customer.name,
        customer_id: customer.customer_id || null,
        contract_id: customer.contract_id || null,
        department: customer.department || '',
        contact: customer.contact || '',
        booking_details: bookingDetails.trim() || null,
        customer_type: customer.customer_type || 'walkin',
        basecamp_sub_type: isBasecamp ? (customer.basecamp_sub_type || 'office') : null,
        basecamp_unit: isBasecamp ? (customer.basecamp_unit || (customer.basecamp_sub_type === 'office' ? '401' : '419')) : null,
        internal_department: isBuiltland ? (customer.internal_department || null) : null,
        payment_status: quickFinancialPreview.payment_status,
        payment_method: effectivePaymentMethod,
        total_amount: isBuiltland ? 0 : quickFinancialPreview.total_amount,
        guest_count: singleItem.guest_count || null,
        items: [singleItem],
        discount_type: effectiveDiscountType,
        discount_value: effectiveDiscountValue,
        payment_mode: effectivePaymentMode,
        deposit_amount: effectiveDepositAmount
      };

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const result = await res.json();
        let fullBooking = result;
        const bId = result.bookingId || result.id || result.booking_id;
        if (bId) {
          try {
            const detailRes = await fetch(`/api/bookings/${bId}`);
            if (detailRes.ok) {
              fullBooking = await detailRes.json();
            }
          } catch (e) {
            console.error('Failed to fetch full booking details:', e);
          }
        }
        setPrintBooking(fullBooking);
        setShowReceiptModal(true);
        closeRoomModal();
        resetQuickFinancials();
        setBookingDetails('');
        setCustomer({
          name: '',
          department: '',
          contact: '',
          customer_type: 'walkin',
          basecamp_sub_type: 'office',
          basecamp_unit: '401',
          internal_department: ''
        });
        fetchCalendarEvents();
      } else {
        const errData = await res.json().catch(() => ({}));
        sysAlert(errData.error || 'เกิดข้อผิดพลาดในการสร้างรายการจอง');
      }
    } catch (err) {
      console.error('Direct booking failed:', err);
      sysAlert(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setIsSubmittingQuickBooking(false);
    }
  };

  const removeFromCart = (index) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  const addServiceToCart = (service) => {
    const existingIndex = cart.findIndex(item => item.type === 'service' && item.service_id === service.id);
    if (existingIndex >= 0) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      newCart[existingIndex].subtotal = newCart[existingIndex].quantity * newCart[existingIndex].price;
      setCart(newCart);
    } else {
      setCart([...cart, {
        type: 'service',
        service_id: service.id,
        name: service.name,
        price: service.price,
        quantity: 1,
        subtotal: service.price
      }]);
    }
    setShowServicePicker(false);
  };

  const totalAmount = useMemo(() => {
    return cart.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
  }, [cart]);

  // Checkout function for multi-item Cart
  const checkout = async () => {
    if (isSubmittingCartBooking) return;
    if (cart.length === 0) {
      sysAlert('กรุณาเพิ่มรายการห้องหรือบริการลงในตะกร้าก่อนทำรายการ');
      return;
    }
    if (!customer.name.trim()) {
      sysAlert('กรุณาระบุชื่อผู้จอง');
      return;
    }

    const isBuiltland = customer.customer_type === 'builtland';
    const isBasecamp = customer.customer_type === 'basecamp';
    const isShop = customer.customer_type === 'shop';

    if (!isBuiltland && !isBasecamp && !isShop) {
      if (cartFinancialPreview.discount_error) {
        sysAlert(cartFinancialPreview.discount_error);
        return;
      }
      if (cartFinancialPreview.deposit_error) {
        sysAlert(cartFinancialPreview.deposit_error);
        return;
      }
      if (cartFinancialPreview.requires_payment_method && !cartPaymentMethod) {
        sysAlert('กรุณาเลือกช่องทางการชำระเงินสำหรับตะกร้า');
        return;
      }
    }

    setIsSubmittingCartBooking(true);
    try {
      const effectivePaymentMode = isBuiltland ? 'full' : (isBasecamp ? 'full' : cartFinancialPreview.payment_mode);
      const effectiveDiscountType = isBuiltland ? 'none' : cartFinancialPreview.discount_type;
      const effectiveDiscountValue = isBuiltland ? 0 : cartFinancialPreview.discount_value;
      const effectiveDepositAmount = (isBuiltland || cartPaymentMode !== 'deposit') ? 0 : (Number(cartDepositAmount) || 0);

      const effectivePaymentMethod = (isBuiltland || isBasecamp || isShop || effectivePaymentMode === 'unpaid' || cartFinancialPreview.total_amount === 0)
        ? (cartPaymentMethod || 'cash')
        : (cartPaymentMethod || 'cash');

      const payload = {
        customer_name: customer.name,
        customer_id: customer.customer_id || null,
        contract_id: customer.contract_id || null,
        department: customer.department || '',
        contact: customer.contact || '',
        booking_details: bookingDetails.trim() || null,
        customer_type: customer.customer_type || 'walkin',
        basecamp_sub_type: isBasecamp ? (customer.basecamp_sub_type || 'office') : null,
        basecamp_unit: isBasecamp ? (customer.basecamp_unit || (customer.basecamp_sub_type === 'office' ? '401' : '419')) : null,
        internal_department: isBuiltland ? (customer.internal_department || null) : null,
        payment_status: cartFinancialPreview.payment_status,
        payment_method: effectivePaymentMethod,
        total_amount: isBuiltland ? 0 : cartFinancialPreview.total_amount,
        guest_count: cart.find(c => c.guest_count)?.guest_count || null,
        items: cart,
        discount_type: effectiveDiscountType,
        discount_value: effectiveDiscountValue,
        payment_mode: effectivePaymentMode,
        deposit_amount: effectiveDepositAmount
      };

      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const result = await res.json();
        let fullBooking = result;
        const bId = result.bookingId || result.id || result.booking_id;
        if (bId) {
          try {
            const detailRes = await fetch(`/api/bookings/${bId}`);
            if (detailRes.ok) {
              fullBooking = await detailRes.json();
            }
          } catch (e) {
            console.error('Failed to fetch full booking details:', e);
          }
        }
        setPrintBooking(fullBooking);
        setShowReceiptModal(true);
        setCart([]);
        resetCartFinancials();
        setBookingDetails('');
        setCustomer({
          name: '',
          department: '',
          contact: '',
          customer_type: 'walkin',
          basecamp_sub_type: 'office',
          basecamp_unit: '401',
          internal_department: ''
        });
        fetchCalendarEvents();
      } else {
        const errData = await res.json().catch(() => ({}));
        sysAlert(errData.error || 'เกิดข้อผิดพลาดในการสร้างรายการจอง');
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      sysAlert(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setIsSubmittingCartBooking(false);
    }
  };

  const handleDownloadReceiptPDF = () => {
    if (!printBooking) return;
    const element = document.getElementById('print-receipt-area');
    if (!element) return;
    if (!window.html2pdf) {
      sysAlert('ระบบพิมพ์ PDF ยังไม่พร้อมใช้งาน');
      return;
    }
    element.classList.add('pdf-export-mode');
    const opt = {
      margin: [2, 2, 2, 2],
      filename: `Receipt-${printBooking.id || 'POS'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: [80, 180], orientation: 'portrait' }
    };
    window.html2pdf().from(element).set(opt).save().then(() => {
      element.classList.remove('pdf-export-mode');
    }).catch(err => {
      element.classList.remove('pdf-export-mode');
      console.error(err);
    });
  };

  const handleCloseReceiptModal = () => {
    setShowReceiptModal(false);
    setPrintBooking(null);
  };

  // Real-time Current Hour indicator for Timeline
  const isTodayTimeline = timelineDate === formatDateToYYYYMMDD(new Date());
  const now = new Date();
  const currentHourFloat = now.getHours() + now.getMinutes() / 60;
  const showNowLine = isTodayTimeline && currentHourFloat >= TIMELINE_START && currentHourFloat <= TIMELINE_END;
  const nowLineLeftPercent = showNowLine ? ((currentHourFloat - TIMELINE_START) / TIMELINE_TOTAL_HOURS) * 100 : 0;

  // =========================================================
  // RENDER MAIN COMPONENT
  // =========================================================
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1, gap: '8px', overflow: 'hidden' }}>

      {/* 1. TOP CONTROL BAR (OPERATIONAL 2-ROW DESIGN) */}
      <div style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '14px',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        flexShrink: 0
      }}>
        {/* ROW 1: Page Title, Operational Date, and View Mode Switcher */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>

          {/* Left: Title & Operational Date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
                POS / Booking
              </h2>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                จุดขายและผังการจอง
              </span>
            </div>
            <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color)' }} />
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-color)',
              padding: '3px 9px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: 'var(--text-main)'
            }}>
              <Calendar size={13} style={{ color: 'var(--primary-color)' }} />
              <span>{getThaiDateFull(timelineDate)}</span>
            </div>
          </div>

          {/* Right: View Mode Segmented Tabs & Basecamp Quota Hub */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '2px', backgroundColor: 'var(--bg-color)', padding: '2px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                onClick={() => setMainViewMode('matrix')}
                className={`pos-view-btn ${mainViewMode === 'matrix' ? 'active' : ''}`}
                title="ตารางผังเวลาและการ์ดห้อง (Timeline Matrix)"
              >
                <LayoutGrid size={14} />
                <span className="pos-btn-text-full">ผังจองห้องประจำวัน</span>
                <span className="pos-btn-text-short">ผังห้อง</span>
              </button>

              <button
                type="button"
                onClick={() => setMainViewMode('calendar')}
                className={`pos-view-btn ${mainViewMode === 'calendar' ? 'active' : ''}`}
                title="ปฏิทินรายเดือน (Monthly Calendar)"
              >
                <Calendar size={14} />
                <span className="pos-btn-text-full">ปฏิทินเดือน</span>
                <span className="pos-btn-text-short">ปฏิทิน</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowBasecampQuotaModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                minHeight: '36px',
                borderRadius: '9px',
                fontSize: '0.78rem',
                fontWeight: 700,
                border: '1px solid rgba(147, 51, 234, 0.3)',
                cursor: 'pointer',
                backgroundColor: 'rgba(147, 51, 234, 0.06)',
                color: '#9333ea',
                transition: 'all 0.15s ease'
              }}
              title="ตรวจสอบโควต้าห้องประชุมผู้เช่าชั้น 4 (Basecamp Quota Hub)"
            >
              <Building2 size={14} />
              <span className="pos-btn-text-full">โควต้าชั้น 4 (Basecamp)</span>
              <span className="pos-btn-text-short">โควต้า Basecamp</span>
            </button>
          </div>
        </div>

        {/* ROW 2: Date Navigation Controls, Category Filters, Search & Status Legend */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '8px', flexWrap: 'wrap', gap: '8px' }}>

          {/* Left: Day Navigator, Date Picker, and Category Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Day Nav Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-color)', borderRadius: '10px', padding: '2px', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                onClick={handlePrevTimelineDay}
                className="pos-day-nav-btn"
                title="วันก่อนหน้า"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={handleTodayTimeline}
                className="pos-day-today-btn"
              >
                วันนี้
              </button>
              <button
                type="button"
                onClick={handleNextTimelineDay}
                className="pos-day-nav-btn"
                title="วันถัดไป"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Date Picker Popover */}
            <CustomDatePicker
              value={timelineDate}
              onChange={val => setTimelineDate(val)}
              className="form-control"
              style={{
                height: '32px',
                fontSize: '0.76rem',
                padding: '0 8px',
                borderRadius: '9px',
                cursor: 'pointer',
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center'
              }}
            />

            <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)' }} />

            {/* Category Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto' }} className="scrollbar-none">
              {[
                { id: 'all', name: 'ทั้งหมด', icon: Layers },
                { id: 'meeting', name: 'ห้องประชุม', icon: Presentation },
                { id: 'coworking', name: 'Co-Working', icon: Laptop },
                { id: 'cafe', name: 'Koocafe', icon: Coffee },
                { id: 'parking', name: 'ที่จอดรถ', icon: Car },
              ].map(cat => {
                const Icon = cat.icon;
                const isSel = timelineCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setTimelineCategory(cat.id)}
                    className={`pos-cat-pill ${isSel ? 'active' : ''}`}
                  >
                    <Icon size={12} />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Search Input & Clean Status Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '9px', padding: '0 8px', height: '32px' }}>
              <Search size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="ค้นหาห้อง..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.78rem', color: 'var(--text-main)', width: '105px' }}
              />
            </div>

            {/* Status Legend (Group 1: Payment Status, Group 2: Operational Lifecycle) */}
            <div className="pos-legend-container scrollbar-none" style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.72rem' }}>
              {/* Group 1: Payment Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 600 }}>สถานะชำระ:</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>ชำระแล้ว</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#2563eb' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>รอตรวจสลิป</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>รอชำระ</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#8b5cf6' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>ใช้งานภายใน</span>
                </span>
              </div>

              {/* Separator */}
              <span style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-color)' }} />

              {/* Group 2: Lifecycle / Buffer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', border: '1.5px solid #ea580c', backgroundColor: 'transparent' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>กำลังใช้งาน</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '7px', borderRadius: '2px', backgroundColor: 'rgba(245, 158, 11, 0.3)', border: '1px dashed #f59e0b' }} />
                  <span style={{ color: 'var(--text-muted)' }}>ทำความสะอาด ({Number(settings?.cleaning_buffer_minutes !== undefined ? settings.cleaning_buffer_minutes : 30)}m)</span>
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* 2. MAIN WORKSPACE CONTENT */}
      <div
        className={`pos-workspace-grid ${showCartSidebar ? 'cart-open' : ''}`}
      >

        {/* CENTER VIEW AREA */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>

          {/* ======================================================= */}
          {/* VIEW 1: UNIFIED TIMELINE MATRIX & RICH ROOM CARDS       */}
          {/* ======================================================= */}
          {mainViewMode === 'matrix' && (
            <div style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
              boxShadow: 'var(--glass-shadow)'
            }}>
              {/* Matrix Scrollable Grid */}
              <div style={{ flex: 1, minHeight: 0, overflowX: 'auto', overflowY: 'auto' }} className="scrollbar-thin">
                <div style={{ minWidth: '1150px' }}>

                  {/* Timeline Header Row (08:00 - 18:00) - Sticky Top */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'var(--matrix-room-col-width, 260px) repeat(10, minmax(88px, 1fr))',
                    borderBottom: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-card-solid, var(--bg-card))',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    color: 'var(--text-muted)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 20
                  }}>
                    {/* Top-Left Intersection Cell - Sticky Top & Left */}
                    <div style={{
                      padding: '10px 12px',
                      borderRight: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      position: 'sticky',
                      left: 0,
                      zIndex: 30,
                      backgroundColor: 'var(--bg-card-solid, var(--bg-card))',
                      boxShadow: '2px 0 5px -2px rgba(0, 0, 0, 0.08)'
                    }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>การ์ดห้อง / รายละเอียด</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--primary-color)' }}>{filteredTimelineRooms.length} ห้อง</span>
                    </div>
                    {TIMELINE_HOURS.map(h => (
                      <div key={h} style={{ padding: '10px 2px', textAlign: 'center', borderRight: '1px solid var(--border-color)', fontFamily: 'monospace', backgroundColor: 'var(--bg-card-solid, var(--bg-card))' }}>
                        {String(h).padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>

                  {/* Room Rows (Rich Room Card on Left + 10 Hours on Right) */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {filteredTimelineRooms.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        ไม่พบห้องที่ตรงกับเงื่อนไขการค้นหา
                      </div>
                    ) : (
                      filteredTimelineRooms.map(room => {
                        const dayEvents = getTimelineRoomEvents(room.id);

                        // Real-time live status for this room today (Subdued operational indicator, zero emoji)
                        const currentNow = new Date();
                        const activeEvent = dayEvents.find(ev => currentNow >= new Date(ev.start_time) && currentNow <= new Date(ev.end_time));
                        const upcomingEvents = dayEvents.filter(ev => currentNow < new Date(ev.start_time));
                        const allExpired = dayEvents.length > 0 && dayEvents.every(ev => currentNow > new Date(ev.end_time));

                        let liveStatusBadge = null;
                        if (activeEvent) {
                          const endTStr = new Date(activeEvent.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.66rem', fontWeight: 700, color: '#ea580c', backgroundColor: 'rgba(234, 88, 12, 0.1)', padding: '1px 6px', borderRadius: '5px', border: '1px solid rgba(234, 88, 12, 0.25)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                              <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#ea580c' }} />
                              กำลังใช้งาน (ถึง {endTStr} น.)
                            </span>
                          );
                        } else if (allExpired) {
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', backgroundColor: 'var(--bg-color)', padding: '1px 6px', borderRadius: '5px', border: '1px solid var(--border-color)' }}>
                              เสร็จสิ้นทุกคิว
                            </span>
                          );
                        } else if (upcomingEvents.length > 0) {
                          const nextTStr = new Date(upcomingEvents[0].start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', backgroundColor: 'var(--bg-color)', padding: '1px 6px', borderRadius: '5px', border: '1px solid var(--border-color)' }}>
                              ว่าง (มีคิวถัดไป {nextTStr} น.)
                            </span>
                          );
                        } else {
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-muted)', backgroundColor: 'var(--bg-color)', padding: '1px 6px', borderRadius: '5px', border: '1px solid var(--border-color)' }}>
                              ว่างตลอดวัน
                            </span>
                          );
                        }

                        const usesDoorPin = roomUsesDoorPin(room);
                        const roomPinText = usesDoorPin
                          ? (room.pin_code && String(room.pin_code).trim() ? `รหัสห้อง: ${String(room.pin_code).trim()}` : 'รหัสห้อง: ไม่ได้ตั้งค่า')
                          : 'รหัสห้อง: ไม่ใช้รหัส';

                        return (
                          <div
                            key={room.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'var(--matrix-room-col-width, 260px) repeat(10, minmax(88px, 1fr))',
                              borderBottom: '1px solid var(--border-color)',
                              minHeight: '74px',
                              alignItems: 'stretch',
                              position: 'relative'
                            }}
                          >
                            {/* Rich Room Card Cell (Left Column - Sticky Left) */}
                            <div
                              onClick={() => openDrawerForSlot(room, 9)}
                              style={{
                                padding: '8px 12px',
                                borderRight: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card-solid, var(--bg-card))',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease',
                                position: 'sticky',
                                left: 0,
                                zIndex: 10,
                                boxShadow: '2px 0 5px -2px rgba(0, 0, 0, 0.08)'
                              }}
                              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover, rgba(37, 99, 235, 0.04))'}
                              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--bg-card-solid, var(--bg-card))'}
                              title={`${room.name} (${room.capacity} ที่นั่ง) · ${roomPinText} · คลิกเพื่อเปิดฟอร์มจองห้องนี้`}
                            >
                              {room.image_url ? (
                                <img src={room.image_url} alt={room.name} style={{ width: '40px', height: '40px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border-color)' }} />
                              ) : (
                                <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <Building size={20} />
                                </div>
                              )}

                              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {room.name}
                                  </span>
                                  <span style={{ color: 'var(--primary-color)', fontWeight: 800, fontSize: '0.78rem' }}>
                                    {Number(room.hourly_rate) > 0 ? (
                                      <>฿{Number(room.hourly_rate).toLocaleString()}<span style={{ fontSize: '0.65rem', fontWeight: 500 }}>/ชม.</span></>
                                    ) : Number(room.half_day_rate) > 0 ? (
                                      <>฿{Number(room.half_day_rate).toLocaleString()}<span style={{ fontSize: '0.65rem', fontWeight: 500 }}>/ครึ่งวัน</span></>
                                    ) : Number(room.daily_rate) > 0 ? (
                                      <>฿{Number(room.daily_rate).toLocaleString()}<span style={{ fontSize: '0.65rem', fontWeight: 500 }}>/วัน</span></>
                                    ) : (
                                      <span>-</span>
                                    )}
                                  </span>
                                </div>

                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Users size={11} />
                                  <span>{room.capacity} ที่นั่ง</span>
                                  <span>·</span>
                                  <span>{room.category || 'ห้องประชุม'}</span>
                                </div>

                                <div style={{ fontSize: '0.68rem', color: usesDoorPin && room.pin_code ? 'var(--text-main)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '1px' }}>
                                  <Key size={10} style={{ flexShrink: 0, opacity: 0.7 }} />
                                  <span style={{ fontWeight: 600 }}>{roomPinText}</span>
                                </div>

                                <div style={{ marginTop: '1px' }}>
                                  {liveStatusBadge}
                                </div>
                              </div>
                            </div>

                            {/* 10 Hourly Cells Container (Right Gantt Area) */}
                            <div style={{ gridColumn: 'span 10', position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', backgroundColor: 'var(--bg-card)' }}>

                              {/* Real-time Red "NOW" Line indicator (Restrained, no neon glow, zIndex 4 below booking pills) */}
                              {showNowLine && (
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: `${nowLineLeftPercent}%`,
                                  width: '2px',
                                  backgroundColor: '#ef4444',
                                  zIndex: 4,
                                  pointerEvents: 'none',
                                  boxShadow: 'none'
                                }} />
                              )}

                              {/* Background Slot Cells */}
                              {TIMELINE_HOURS.map(h => (
                                <div
                                  key={h}
                                  onClick={() => openDrawerForSlot(room, h)}
                                  style={{
                                    borderRight: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    transition: 'background-color 0.15s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'relative'
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
                                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                  title={`คลิกเพื่อจอง ${room.name} เวลา ${h}:00 น.`}
                                />
                              ))}

                              {/* Render Booked Pills on Top */}
                              {dayEvents.map((ev, evIdx) => {
                                const s = new Date(ev.start_time);
                                const e = new Date(ev.end_time);
                                const currentNowTime = new Date();
                                const isExpired = currentNowTime > e;
                                const isActive = currentNowTime >= s && currentNowTime <= e;
                                const isUpcoming = currentNowTime < s;

                                const sHour = s.getHours() + s.getMinutes() / 60;
                                const eHour = e.getHours() + e.getMinutes() / 60;
                                const duration = Math.max(0.5, eHour - sHour);
                                const startOffset = Math.max(0, sHour - TIMELINE_START);
                                const leftPercent = (startOffset / TIMELINE_TOTAL_HOURS) * 100;
                                const widthPercent = Math.min(100 - leftPercent, (duration / TIMELINE_TOTAL_HOURS) * 100);

                                const statusInfo = getUnifiedPaymentStatus(ev);
                                const isShortBooking = duration <= 0.5;

                                const sT = s.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                                const eT = e.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

                                return (
                                  <React.Fragment key={evIdx}>
                                    {/* Booking Pill: Neutral card surface, unified payment border & rail, neutral lifecycle */}
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setViewedEvent(ev);
                                      }}
                                      onMouseEnter={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setHoveredBooking({ event: ev, roomName: room.name, rect });
                                      }}
                                      onMouseLeave={() => setHoveredBooking(null)}
                                      style={{
                                        position: 'absolute',
                                        top: '6px',
                                        bottom: '6px',
                                        left: `${leftPercent}%`,
                                        width: `calc(${widthPercent}% - 3px)`,
                                        backgroundColor: 'var(--bg-card-solid, #ffffff)',
                                        border: `1px solid ${statusInfo.border}`,
                                        borderLeft: `3.5px solid ${statusInfo.color}`,
                                        color: 'var(--text-main)',
                                        borderRadius: '7px',
                                        padding: isShortBooking ? '3px 6px' : '4px 8px',
                                        fontSize: '0.72rem',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        boxShadow: isActive
                                          ? '0 0 0 1.5px rgba(37, 99, 235, 0.3), 0 2px 5px rgba(0,0,0,0.08)'
                                          : '0 1px 3px rgba(0,0,0,0.06)',
                                        cursor: 'pointer',
                                        zIndex: 5,
                                        overflow: 'hidden',
                                        opacity: isExpired ? 0.62 : 1,
                                        transition: 'transform 0.12s ease, box-shadow 0.12s ease'
                                      }}
                                      title={`${ev.customer_name || 'ลูกค้า'} (${sT} - ${eT} น.) [${statusInfo.label}]`}
                                      onMouseEnterCapture={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                                      onMouseLeaveCapture={e => e.currentTarget.style.transform = 'none'}
                                    >
                                      {!isShortBooking ? (
                                        <>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
                                            <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)' }}>
                                              {ev.customer_name || 'ลูกค้า'}
                                            </span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                              <button
                                                type="button"
                                                className="floorplan-pin-trigger-btn"
                                                aria-label="ดูรหัสผ่านห้อง"
                                                title="ดูรหัสผ่านห้อง"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const floorKey = `floor-${ev.booking_id || ev.id}-${room.id}-${ev.start_time}`;
                                                  const roomsData = getFloorPlanRoomData(ev, room);
                                                  handleTogglePinPopover(floorKey, roomsData, e.currentTarget);
                                                }}
                                                style={{
                                                  display: 'inline-flex',
                                                  alignItems: 'center',
                                                  gap: '2px',
                                                  fontSize: '0.58rem',
                                                  fontWeight: 700,
                                                  padding: '1px 4px',
                                                  borderRadius: '3px',
                                                  border: '1px solid var(--border-color)',
                                                  backgroundColor: 'var(--bg-card, #ffffff)',
                                                  color: 'var(--primary-color)',
                                                  cursor: 'pointer',
                                                  lineHeight: 1.1,
                                                  flexShrink: 0
                                                }}
                                              >
                                                <Eye size={10} />
                                                <span>ดูรหัส</span>
                                              </button>
                                              <span style={{
                                                fontSize: '0.62rem',
                                                fontWeight: 700,
                                                color: statusInfo.color,
                                                backgroundColor: statusInfo.bgLight,
                                                border: `1px solid ${statusInfo.border}`,
                                                padding: '1px 5px',
                                                borderRadius: '4px',
                                                whiteSpace: 'nowrap'
                                              }}>
                                                {statusInfo.label}
                                              </span>
                                            </div>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                              <Clock size={10} style={{ opacity: 0.7 }} />
                                              <span>{sT} - {eT} น.</span>
                                            </div>
                                            {isActive && (
                                              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#ea580c', fontWeight: 700, fontSize: '0.60rem' }}>
                                                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#ea580c' }} />
                                                กำลังใช้
                                              </span>
                                            )}
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2px' }}>
                                            <div style={{ fontWeight: 700, fontSize: '0.69rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-main)', lineHeight: 1.2 }}>
                                              {ev.customer_name || 'ลูกค้า'}
                                            </div>
                                            <button
                                              type="button"
                                              className="floorplan-pin-trigger-btn"
                                              aria-label="ดูรหัสผ่านห้อง"
                                              title="ดูรหัสผ่านห้อง"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const floorKey = `floor-${ev.booking_id || ev.id}-${room.id}-${ev.start_time}`;
                                                const roomsData = getFloorPlanRoomData(ev, room);
                                                handleTogglePinPopover(floorKey, roomsData, e.currentTarget);
                                              }}
                                              style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                padding: '1px 2px',
                                                borderRadius: '3px',
                                                border: '1px solid var(--border-color)',
                                                backgroundColor: 'var(--bg-card, #ffffff)',
                                                color: 'var(--primary-color)',
                                                cursor: 'pointer',
                                                lineHeight: 1,
                                                flexShrink: 0
                                              }}
                                            >
                                              <Eye size={9} />
                                            </button>
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '2px', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: statusInfo.color, flexShrink: 0 }} />
                                            <span style={{ whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>{sT}-{eT}</span>
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    {/* Real configured Cleaning Buffer Strip (Restrained, no emoji) */}
                                    {(() => {
                                      const bufferMins = Number(settings?.cleaning_buffer_minutes !== undefined ? settings.cleaning_buffer_minutes : 30);
                                      if (bufferMins <= 0) return null;
                                      const bufferDurationHours = bufferMins / 60;
                                      const bufferLeft = ((eHour - TIMELINE_START) / TIMELINE_TOTAL_HOURS) * 100;
                                      const bufferWidth = (bufferDurationHours / TIMELINE_TOTAL_HOURS) * 100;
                                      if (bufferLeft >= 100) return null;

                                      return (
                                        <div
                                          className="timeline-buffer-stripe"
                                          style={{
                                            position: 'absolute',
                                            top: '8px',
                                            bottom: '8px',
                                            left: `${bufferLeft}%`,
                                            width: `${Math.min(bufferWidth, 100 - bufferLeft)}%`,
                                            borderRadius: '5px',
                                            zIndex: 3,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            pointerEvents: 'none',
                                            overflow: 'hidden'
                                          }}
                                          title={`ระยะเวลาพักทำความสะอาด ${bufferMins} นาที`}
                                        >
                                          <span style={{ fontSize: '0.60rem', fontWeight: 700, color: '#d97706', opacity: 0.9, whiteSpace: 'nowrap', padding: '0 2px' }}>
                                            {bufferWidth >= 3.5 ? `พัก ${bufferMins}m` : `${bufferMins}m`}
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* ======================================================= */}
          {/* VIEW 2: MONTHLY CALENDAR + SELECTED-DAY AGENDA (PHASE C) */}
          {/* ======================================================= */}
          {mainViewMode === 'calendar' && (
            <div className={`pos-calendar-layout ${showCartSidebar ? 'cart-open' : ''}`}>
              {/* 1. DOMINANT MONTHLY CALENDAR GRID (Left / Main) */}
              <div className="calendar-container" style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
                boxShadow: 'var(--glass-shadow)'
              }}>
                {/* Main Month Navigation Toolbar */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  flexShrink: 0,
                  gap: '12px',
                  flexWrap: 'wrap'
                }}>
                  {/* Month & Year Title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(37, 99, 235, 0.12)',
                      border: '1px solid rgba(37, 99, 235, 0.25)',
                      color: 'var(--primary-color)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <Calendar size={18} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                        {monthNames[calendarMonth]} {calendarYear + 543}
                      </h3>
                      <span style={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--bg-color)',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)'
                      }}>
                        {monthNamesEng[calendarMonth]} {calendarYear}
                      </span>
                    </div>
                  </div>

                  {/* Modern Segmented Capsule Toolbar (No Gradients) */}
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    backgroundColor: 'var(--bg-color)',
                    borderRadius: '12px',
                    padding: '3px',
                    border: '1px solid var(--border-color)',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    gap: '2px'
                  }}>
                    {/* Previous Month */}
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      style={{
                        height: '32px',
                        padding: '0 12px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '9px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      title="เดือนก่อนหน้า"
                    >
                      <ChevronLeft size={15} style={{ color: 'var(--primary-color)' }} />
                      <span>เดือนก่อนหน้า</span>
                    </button>

                    {/* Current Month / Today */}
                    {(() => {
                      const isCurrentMonth = calendarMonth === (new Date()).getMonth() && calendarYear === (new Date()).getFullYear();
                      return (
                        <button
                          type="button"
                          onClick={handleTodayMonth}
                          style={{
                            height: '32px',
                            padding: '0 14px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: '9px',
                            border: isCurrentMonth ? 'none' : '1px solid rgba(37, 99, 235, 0.25)',
                            backgroundColor: isCurrentMonth ? 'var(--primary-color, #2563eb)' : 'rgba(37, 99, 235, 0.1)',
                            color: isCurrentMonth ? '#ffffff' : 'var(--primary-color)',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease'
                          }}
                          title="กลับมาเดือนปัจจุบัน (วันนี้)"
                        >
                          <Calendar size={13} />
                          <span>เดือนปัจจุบัน</span>
                        </button>
                      );
                    })()}

                    {/* Next Month */}
                    <button
                      type="button"
                      onClick={handleNextMonth}
                      style={{
                        height: '32px',
                        padding: '0 12px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        borderRadius: '9px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      title="เดือนถัดไป"
                    >
                      <span>เดือนถัดไป</span>
                      <ChevronRight size={15} style={{ color: 'var(--primary-color)' }} />
                    </button>
                  </div>
                </div>

                {/* 7-Column Calendar Grid */}
                <div className="calendar-grid-wrapper" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <div className="calendar-weekday-row">
                    {weekdays.map(wd => (
                      <div key={wd} className="calendar-weekday-cell">{wd}</div>
                    ))}
                  </div>

                  <div className="calendar-body">
                    {calendarDays.map((dayObj, idx) => {
                      const dateKey = getDateKey(dayObj.day, dayObj.month, dayObj.year);
                      const dayEvents = filteredEventsByDay[dateKey] || [];
                      const now = new Date();
                      const isToday = !dayObj.isOtherMonth &&
                        dayObj.day === now.getDate() &&
                        dayObj.month === now.getMonth() &&
                        dayObj.year === now.getFullYear();
                      const isSelected = (sidebarSelectedDay &&
                        sidebarSelectedDay.day === dayObj.day &&
                        sidebarSelectedDay.month === dayObj.month &&
                        sidebarSelectedDay.year === dayObj.year) || (timelineDate === dateKey);

                      return (
                        <div
                          key={idx}
                          className={`calendar-cell ${dayObj.isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectCalendarDay(dayObj)}
                        >
                          <div className="calendar-day-header">
                            <div className="calendar-day-number">
                              {dayObj.day}
                            </div>
                            {dayEvents.length > 0 && (
                              <span className="calendar-day-count-badge">{dayEvents.length} คิว</span>
                            )}
                          </div>

                          {/* Event Chips List (Unified Payment Status) */}
                          <div className="calendar-events-list">
                            {dayEvents.slice(0, 3).map((ev, i) => {
                              const statusInfo = getUnifiedPaymentStatus(ev);
                              const startTime = new Date(ev.start_time);
                              const endTime = new Date(ev.end_time);
                              const sT = !isNaN(startTime.getTime()) ? startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                              const eT = !isNaN(endTime.getTime()) ? endTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                              const popoverKey = `cal-${ev.booking_id || ev.id}-${ev.room_id}-${dateKey}`;
                              const isPopoverOpen = activePinPopover?.key === popoverKey;

                              return (
                                <div
                                  key={i}
                                  className={`calendar-event-chip ${statusInfo.key}`}
                                  onClick={(e) => { e.stopPropagation(); setViewedEvent(ev); }}
                                  title={`${ev.room_name} | ${sT} - ${eT} น. | สถานะ: ${statusInfo.label} | ผู้จอง: ${ev.customer_name || 'ลูกค้า'}`}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                                    <span className="event-chip-room" style={{ fontWeight: 800 }}>{ev.room_name}</span>
                                    <span className="event-chip-time" style={{ fontWeight: 600 }}>{sT}-{eT}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                                    <button
                                      type="button"
                                      className="calendar-pin-trigger-btn"
                                      aria-label={isPopoverOpen ? "ซ่อนรหัสผ่านห้อง" : "ดูรหัสผ่านห้อง"}
                                      title="ดูรหัสผ่านห้อง"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const roomsData = getCalendarEventRoomsData(ev);
                                        handleTogglePinPopover(popoverKey, roomsData, e.currentTarget);
                                      }}
                                      onMouseEnter={(e) => {
                                        const roomsData = getCalendarEventRoomsData(ev);
                                        handleHoverPinPopover(popoverKey, roomsData, e.currentTarget);
                                      }}
                                      onMouseLeave={handleLeavePinPopover}
                                      style={{
                                        background: isPopoverOpen ? 'rgba(37, 99, 235, 0.2)' : 'rgba(0, 0, 0, 0.06)',
                                        border: 'none',
                                        borderRadius: '3px',
                                        padding: '1px 3px',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '2px',
                                        color: isPopoverOpen ? 'var(--primary-color)' : 'inherit',
                                        lineHeight: 1
                                      }}
                                    >
                                      {isPopoverOpen ? <EyeOff size={10} /> : <Eye size={10} />}
                                      <span style={{ fontSize: '0.58rem', fontWeight: 700 }} className="cal-pin-label-text">ดูรหัส</span>
                                    </button>
                                    <span style={{
                                      fontSize: '0.6rem',
                                      fontWeight: 700,
                                      flexShrink: 0,
                                      backgroundColor: statusInfo.bgLight,
                                      color: statusInfo.color,
                                      padding: '0 4px',
                                      borderRadius: '3px'
                                    }}>
                                      {statusInfo.label}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}

                            {/* High-Density Actionable Button */}
                            {dayEvents.length > 3 && (
                              <button
                                type="button"
                                className="calendar-more-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectCalendarDay(dayObj);
                                }}
                                title={`ดูการจองทั้งหมด ${dayEvents.length} รายการของวันนี้ในแถบวาระงาน`}
                              >
                                +{dayEvents.length - 3} รายการ (ดูทั้งหมด)
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 2. SELECTED-DAY AGENDA PANE (Single-Pane Companion) */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                boxShadow: 'var(--glass-shadow)',
                height: '100%',
                minHeight: 0,
                overflow: 'hidden'
              }}>
                {/* Agenda Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                  paddingBottom: '10px',
                  borderBottom: '1px solid var(--border-color)',
                  flexShrink: 0
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Clock size={16} style={{ color: 'var(--primary-color)' }} />
                    <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      รายการจองประจำวัน
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    backgroundColor: selectedDayBookings.length > 0 ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-color)',
                    color: selectedDayBookings.length > 0 ? 'var(--primary-color)' : 'var(--text-muted)',
                    padding: '2px 9px',
                    borderRadius: '999px',
                    border: '1px solid ' + (selectedDayBookings.length > 0 ? 'rgba(37, 99, 235, 0.25)' : 'var(--border-color)')
                  }}>
                    {selectedDayBookings.length} คิว
                  </span>
                </div>

                {/* Selected Date Badge & Matrix Switch Action */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: 'var(--bg-color)',
                  padding: '8px 10px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  marginBottom: '10px',
                  flexShrink: 0,
                  gap: '6px'
                }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {sidebarSelectedDay ? `${sidebarSelectedDay.day} ${monthNames[sidebarSelectedDay.month]} ${sidebarSelectedDay.year + 543}` : 'เลือกวันที่'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (sidebarSelectedDay) {
                        const dk = getDateKey(sidebarSelectedDay.day, sidebarSelectedDay.month, sidebarSelectedDay.year);
                        setTimelineDate(dk);
                      }
                      setMainViewMode('matrix');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid rgba(37, 99, 235, 0.3)',
                      backgroundColor: 'rgba(37, 99, 235, 0.08)',
                      color: 'var(--primary-color)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.16)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
                    title="สลับไปดูตารางเวลา Matrix ของวันนี้"
                  >
                    <LayoutGrid size={11} />
                    <span>ดูตาราง Matrix</span>
                  </button>
                </div>

                {/* Agenda Booking Cards List */}
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    minHeight: 0,
                    paddingRight: '2px'
                  }}
                  className="scrollbar-thin"
                >
                  {selectedDayBookings.length === 0 ? (
                    <div style={{
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '0.78rem',
                      padding: '36px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <Calendar size={28} style={{ opacity: 0.35, color: 'var(--text-muted)' }} />
                      <span>ไม่มีรายการจองห้องในวันนี้</span>
                    </div>
                  ) : (
                    selectedDayBookings.map((ev, i) => {
                      const statusInfo = getUnifiedPaymentStatus(ev);
                      const startTime = new Date(ev.start_time);
                      const endTime = new Date(ev.end_time);
                      const sT = !isNaN(startTime.getTime()) ? startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                      const eT = !isNaN(endTime.getTime()) ? endTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '--:--';

                      return (
                        <div
                          key={i}
                          onClick={() => setViewedEvent(ev)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '12px',
                            backgroundColor: 'var(--bg-color)',
                            border: `1px solid ${statusInfo.border || 'var(--border-color)'}`,
                            borderLeft: `4px solid ${statusInfo.color}`,
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                            transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = 'translateY(-1px)';
                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.06)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                          title={`คลิกเพื่อดูรายละเอียดการจอง: ${ev.room_name}`}
                        >
                          {/* Room Name & Payment Status Pill */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                            <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ev.room_name}
                            </strong>
                            <span style={{
                              fontSize: '0.64rem',
                              fontWeight: 800,
                              color: statusInfo.color,
                              backgroundColor: statusInfo.bgLight,
                              border: `1px solid ${statusInfo.border}`,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              flexShrink: 0
                            }}>
                              {statusInfo.label}
                            </span>
                          </div>

                          {/* Time & Reference */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: 'var(--primary-color)', fontWeight: 700 }}>
                            <Clock size={12} style={{ flexShrink: 0 }} />
                            <span>{sT} - {eT} น.</span>
                            {ev.booking_ref && (
                              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: 'auto' }}>
                                #{ev.booking_ref}
                              </span>
                            )}
                          </div>

                          {/* Customer Name & Guests */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <User size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {ev.customer_name || 'ลูกค้าทั่วไป'} {ev.guest_count ? `(${ev.guest_count} คน)` : ''}
                            </span>
                          </div>

                          {/* Internal Room Access PIN Section (BWORK-CALENDAR-PIN-V1) */}
                          {(() => {
                            const cardRoom = rooms.find(r => r.id === ev.room_id);
                            const usesDoorPin = roomUsesDoorPin(cardRoom || ev.room_id);
                            const pinInfo = usesDoorPin ? resolveRoomPinInfo({ ...ev, items: [ev] }, ev.room_id, cardRoom) : { pin: '', pinType: 'none' };
                            const cardPin = pinInfo.pin;
                            const isInternal = pinInfo.pinType === 'internal' || isInternalBooking(ev);
                            const pinLabel = isInternal ? 'รหัสผ่านห้อง (ภายใน):' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป):';
                            const agendaKey = `agenda-${ev.booking_id || ev.id}-${ev.room_id}`;
                            const isAgendaRevealed = !!revealedAgendaPins[agendaKey];

                            return (
                              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <button
                                    type="button"
                                    className="room-pin-trigger-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleAgendaPinReveal(agendaKey);
                                    }}
                                    aria-label={isAgendaRevealed ? "ซ่อนรหัสผ่านห้อง" : "ดูรหัสผ่านห้อง"}
                                    title={isAgendaRevealed ? "ซ่อนรหัสผ่านห้อง" : "ดูรหัสผ่านห้อง"}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 700,
                                      padding: '3px 8px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)',
                                      backgroundColor: isAgendaRevealed ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-card)',
                                      color: isAgendaRevealed ? 'var(--primary-color)' : 'var(--text-main)',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                  >
                                    {isAgendaRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                                    <span>{isAgendaRevealed ? 'ซ่อนรหัสผ่านห้อง' : 'ดูรหัสผ่านห้อง'}</span>
                                  </button>
                                </div>

                                {isAgendaRevealed && (
                                  <div style={{
                                    marginTop: '4px',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    backgroundColor: 'var(--bg-card)',
                                    border: '1px solid var(--border-color)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{pinLabel || 'รหัสผ่านห้อง:'}</span>
                                      {usesDoorPin && cardPin ? (
                                        <span style={{ fontFamily: 'monospace', fontSize: '0.84rem', fontWeight: 800, color: 'var(--primary-color)', letterSpacing: '0.5px' }}>
                                          {cardPin || 'ไม่มีรหัสเข้าห้อง'}
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                          ไม่มีรหัสเข้าห้อง
                                        </span>
                                      )}
                                    </div>
                                    {usesDoorPin && cardPin ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCopyPin(cardPin, agendaKey);
                                        }}
                                        aria-label="คัดลอก"
                                        title="คัดลอก"
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          fontSize: '0.68rem',
                                          fontWeight: 700,
                                          padding: '3px 7px',
                                          borderRadius: '5px',
                                          border: '1px solid rgba(37, 99, 235, 0.3)',
                                          backgroundColor: 'rgba(37, 99, 235, 0.08)',
                                          color: 'var(--primary-color)',
                                          cursor: 'pointer'
                                        }}
                                      >
                                        {copiedPinKey === agendaKey ? <Check size={11} /> : <Copy size={11} />}
                                        <span>{copiedPinKey === agendaKey ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                                      </button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* 3. CART SIDEBAR (WHEN OPEN) */}
        {showCartSidebar && (
          <>
            <div
              className="pos-cart-mobile-backdrop"
              onClick={() => setShowCartSidebar(false)}
            />
            <div
              className="pos-cart-sidebar-panel"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                height: '100%',
                minHeight: 0,
                overflowY: 'auto',
                boxShadow: 'var(--glass-shadow)'
              }}
            >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShoppingCart size={18} style={{ color: 'var(--primary-color)' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>ตะกร้าการจอง ({cart.length})</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCartSidebar(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Cart Items List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '30px 0' }}>
                  ยังไม่มีรายการในตะกร้า
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div key={idx} style={{ padding: '10px', borderRadius: '12px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.82rem', color: 'var(--text-main)' }}>{item.name}</div>
                        {item.type === 'room' && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {item.date} · {item.time_display}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(idx)}
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.quantity} {item.type === 'room' ? 'ชั่วโมง' : 'รายการ'}</span>
                      <strong style={{ fontSize: '0.85rem', color: 'var(--primary-color)' }}>฿{Number(item.subtotal).toLocaleString()}</strong>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer: Financial Controls & Checkout (Phase 3) */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {customer.customer_type === 'builtland' ? (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(234, 88, 12, 0.08)',
                  border: '1px solid rgba(234, 88, 12, 0.25)',
                  color: '#ea580c',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
                  <span>สิทธิ์ Builtland: ฟรี ไม่คิดค่าบริการ</span>
                </div>
              ) : (
                <>
                  {/* 1. ยอดรวมก่อนส่วนลด */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรวมก่อนส่วนลด:</span>
                    <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)', fontWeight: 800 }}>฿{formatMoney(cartFinancialPreview.subtotal_amount)}</strong>
                  </div>

                  {/* 2. ส่วนลด Segmented Controls: [ ไม่มี ] [ % ] [ บาท ] */}
                  <div style={{
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)' }}>ส่วนลด</span>
                      {cartFinancialPreview.discount_amount > 0 && !cartFinancialPreview.discount_error && (
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#10b981' }}>
                          -฿{formatMoney(cartFinancialPreview.discount_amount)}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                      {[
                        { key: 'none', label: 'ไม่มี' },
                        { key: 'percent', label: '%' },
                        { key: 'amount', label: 'บาท' }
                      ].map(t => {
                        const isSel = cartDiscountType === t.key;
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => {
                              setCartDiscountType(t.key);
                              if (t.key === 'none') setCartDiscountValue('');
                            }}
                            style={{
                              padding: '5px 0',
                              border: 'none',
                              borderRadius: '7px',
                              fontSize: '0.72rem',
                              fontWeight: isSel ? 800 : 600,
                              cursor: 'pointer',
                              backgroundColor: isSel ? 'var(--primary-color)' : 'var(--bg-card)',
                              color: isSel ? '#ffffff' : 'var(--text-muted)',
                              boxShadow: isSel ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>

                    {cartDiscountType !== 'none' && (
                      <div>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            max={cartDiscountType === 'percent' ? 100 : cartFinancialPreview.subtotal_amount}
                            step={cartDiscountType === 'percent' ? '1' : '10'}
                            placeholder={cartDiscountType === 'percent' ? 'ระบุ % ส่วนลด' : 'ระบุจำนวนเงินส่วนลด'}
                            value={cartDiscountValue}
                            onChange={e => setCartDiscountValue(e.target.value)}
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '8px',
                              border: cartFinancialPreview.discount_error ? '1px solid #ef4444' : '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-card)',
                              padding: '0 32px 0 8px',
                              fontSize: '0.8rem',
                              color: 'var(--text-main)',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <span style={{
                            position: 'absolute',
                            right: '8px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: 'var(--text-muted)',
                            pointerEvents: 'none'
                          }}>
                            {cartDiscountType === 'percent' ? '%' : 'บาท'}
                          </span>
                        </div>
                        {cartFinancialPreview.discount_error && (
                          <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600, marginTop: '3px' }}>
                            {cartFinancialPreview.discount_error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 3. ยอดรวมสุทธิ */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 700 }}>ยอดสุทธิ:</span>
                    <strong style={{ fontSize: '1.2rem', color: 'var(--text-main)', fontWeight: 900 }}>
                      ฿{formatMoney(cartFinancialPreview.total_amount)}
                    </strong>
                  </div>

                  {/* 4. การชำระเงิน Mode Selector */}
                  <div style={{
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-main)' }}>การชำระเงิน *</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                      {[
                        { key: 'full', label: 'เต็มจำนวน' },
                        { key: 'deposit', label: 'มัดจำ' },
                        { key: 'unpaid', label: 'ยังไม่ชำระ' }
                      ].map(m => {
                        const isSel = cartPaymentMode === m.key;
                        return (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => {
                              setCartPaymentMode(m.key);
                              if (m.key === 'unpaid') setCartPaymentMethod('');
                              else if (!cartPaymentMethod) setCartPaymentMethod('cash');
                            }}
                            style={{
                              padding: '5px 0',
                              border: 'none',
                              borderRadius: '7px',
                              fontSize: '0.7rem',
                              fontWeight: isSel ? 800 : 600,
                              cursor: 'pointer',
                              backgroundColor: isSel ? 'var(--primary-color)' : 'var(--bg-card)',
                              color: isSel ? '#ffffff' : 'var(--text-muted)',
                              boxShadow: isSel ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Deposit Input */}
                    {cartPaymentMode === 'deposit' && (
                      <div>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <input
                            type="number"
                            min="1"
                            max={Math.max(0, cartFinancialPreview.total_amount - 1)}
                            step="50"
                            placeholder="ระบุยอดมัดจำ (บาท)"
                            value={cartDepositAmount}
                            onChange={e => setCartDepositAmount(e.target.value)}
                            style={{
                              width: '100%',
                              height: '32px',
                              borderRadius: '8px',
                              border: cartFinancialPreview.deposit_error ? '1px solid #ef4444' : '1px solid var(--border-color)',
                              backgroundColor: 'var(--bg-card)',
                              padding: '0 32px 0 8px',
                              fontSize: '0.8rem',
                              color: 'var(--text-main)',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <span style={{
                            position: 'absolute',
                            right: '8px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: 'var(--text-muted)',
                            pointerEvents: 'none'
                          }}>
                            บาท
                          </span>
                        </div>
                        {cartFinancialPreview.deposit_error && (
                          <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 600, marginTop: '3px' }}>
                            {cartFinancialPreview.deposit_error}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Payment Method Selector */}
                    {(cartPaymentMode === 'full' || cartPaymentMode === 'deposit') && cartFinancialPreview.total_amount > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginTop: '2px' }}>
                        {[
                          { key: 'cash', label: 'เงินสด', icon: Banknote, color: '#10b981' },
                          { key: 'transfer', label: 'โอนเงิน', icon: Smartphone, color: '#3b82f6' },
                          { key: 'card', label: 'บัตร', icon: CreditCard, color: '#8b5cf6' }
                        ].map(m => {
                          const isSel = cartPaymentMethod === m.key;
                          const Icon = m.icon;
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => setCartPaymentMethod(m.key)}
                              style={{
                                height: '28px',
                                borderRadius: '7px',
                                border: isSel ? `1.5px solid ${m.color}` : '1px solid var(--border-color)',
                                backgroundColor: isSel ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-card)',
                                color: isSel ? 'var(--text-main)' : 'var(--text-muted)',
                                fontSize: '0.7rem',
                                fontWeight: isSel ? 800 : 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '3px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <Icon size={11} style={{ color: m.color }} />
                              <span>{m.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Unpaid / Zero-Net Notice */}
                    {cartPaymentMode === 'unpaid' && (
                      <div style={{ fontSize: '0.7rem', color: '#d97706', fontWeight: 600 }}>
                        ค้างชำระ: ยังไม่ต้องเลือกช่องทางชำระเงิน
                      </div>
                    )}

                    {cartFinancialPreview.total_amount === 0 && (
                      <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>
                        ยอดสุทธิ ฿0.00: บันทึกชำระแล้วโดยไม่ต้องชำระเงิน
                      </div>
                    )}

                    {/* Live Snapshot Breakdown */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.72rem',
                      borderTop: '1px dashed var(--border-color)',
                      paddingTop: '6px',
                      marginTop: '2px'
                    }}>
                      <span>ชำระวันนี้: <strong style={{ color: '#10b981' }}>฿{formatMoney(cartFinancialPreview.paid_amount)}</strong></span>
                      <span>คงเหลือ: <strong style={{ color: cartFinancialPreview.balance_amount > 0 ? '#f59e0b' : 'var(--text-main)' }}>฿{formatMoney(cartFinancialPreview.balance_amount)}</strong></span>
                    </div>
                  </div>
                </>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowServicePicker(true)}
                  className="btn btn-secondary"
                  style={{ flex: 1, borderRadius: '12px', fontSize: '0.78rem', padding: '8px' }}
                >
                  + เพิ่มบริการ
                </button>
                <button
                  type="button"
                  onClick={checkout}
                  disabled={cart.length === 0 || !cartFinancialPreview.is_valid || isSubmittingCartBooking}
                  className="btn btn-primary"
                  style={{
                    flex: 2,
                    borderRadius: '12px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                    padding: '10px',
                    backgroundColor: (cart.length === 0 || !cartFinancialPreview.is_valid || isSubmittingCartBooking) ? '#94a3b8' : undefined,
                    cursor: (cart.length === 0 || !cartFinancialPreview.is_valid || isSubmittingCartBooking) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSubmittingCartBooking ? 'กำลังบันทึก...' : 'ชำระเงิน / ยืนยันการจอง'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      </div>

      {/* ========================================================= */}
      {/* 4. BOOKING CONFIGURATION DRAWER                          */}
      {/* ========================================================= */}
      {selectedRoom && (
        <div
          onClick={closeRoomModal}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 2000,
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="pos-drawer-content"
            style={{
              width: '100%',
              maxWidth: '500px',
              height: '100%',
              backgroundColor: 'var(--bg-card)',
              boxShadow: '-12px 0 45px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border-color)',
              animation: 'slideInRight 0.25s ease-out'
            }}
          >

            {/* 1. Drawer Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg-card)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(37, 99, 235, 0.12)',
                  color: 'var(--primary-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(37, 99, 235, 0.25)'
                }}>
                  <BookmarkPlus size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, lineHeight: 1.2 }}>
                    จองพื้นที่: {selectedRoom.name}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginTop: '3px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    <span>{selectedRoom.category || 'ห้องประชุม'}</span>
                    <span>•</span>
                    <span>ความจุ {layoutType === 'classroom' ? (selectedRoom.classroom_capacity || selectedRoom.capacity) : selectedRoom.capacity} ที่นั่ง</span>
                    <span>•</span>
                    <strong style={{ color: 'var(--primary-color)' }}>฿{selectedRoom.hourly_rate}/ชม.</strong>
                    <span>•</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 600, color: 'var(--text-main)' }}>
                      <Key size={12} style={{ opacity: 0.8 }} />
                      {roomUsesDoorPin(selectedRoom) ? (selectedRoom.pin_code && String(selectedRoom.pin_code).trim() ? `รหัสห้อง: ${String(selectedRoom.pin_code).trim()}` : 'รหัสห้อง: ไม่ได้ตั้งค่า') : 'รหัสห้อง: ไม่ใช้รหัส'}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeRoomModal}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-color)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <X size={18} />
              </button>
            </div>

            {/* 2. Drawer Scrollable Body (5 Operational Sections) */}
            <div className="pos-drawer-body scrollbar-thin" style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Section 1: ห้องและเวลา (Schedule & Capacity) */}
              <div style={{
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  1. ห้องและเวลา (Schedule & Capacity)
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                      วันที่ทำการจอง *
                    </label>
                    <CustomDatePicker
                      value={roomSchedule.date}
                      onChange={val => setRoomSchedule({ ...roomSchedule, date: val })}
                      className="form-control"
                      style={{ height: '40px', borderRadius: '12px', fontSize: '0.82rem', padding: '0 10px', cursor: 'pointer', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                      {bookingType === 'daily' ? 'ช่วงเวลาเต็มวัน' : bookingType === 'halfday' ? 'รอบครึ่งวัน' : 'ช่วงเวลาเริ่ม - สิ้นสุด'} *
                    </label>

                    {bookingType === 'daily' ? (
                      <CustomSelect
                        value={dailyTimeSlot}
                        onChange={val => setDailyTimeSlot(val)}
                        options={[
                          { value: '08-17', label: '08:00 - 17:00 น. (เต็มวัน 9 ชม.)', icon: Clock },
                          { value: '09-18', label: '09:00 - 18:00 น. (เต็มวัน 9 ชม.)', icon: Clock }
                        ]}
                      />
                    ) : bookingType === 'halfday' ? (
                      <CustomSelect
                        value={dailyTimeSlot}
                        onChange={val => setDailyTimeSlot(val)}
                        options={[
                          { value: '08-12', label: '08:00 - 12:00 น. (รอบเช้า 4 ชม.)', icon: Clock },
                          { value: '13-17', label: '13:00 - 17:00 น. (รอบบ่าย 4 ชม.)', icon: Clock }
                        ]}
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CustomSelect
                          value={`${String(roomSchedule.startHour || '09').padStart(2, '0')}:${String(roomSchedule.startMinute || '00').padStart(2, '0')}`}
                          onChange={val => {
                            const [sh, sm] = val.split(':').map(Number);
                            const startMins = sh * 60 + sm;
                            const curEndMins = (parseInt(roomSchedule.endHour || '10', 10) * 60) + parseInt(roomSchedule.endMinute || '00', 10);
                            let newEndMins = curEndMins <= startMins ? startMins + 60 : curEndMins;
                            if (newEndMins > 18 * 60) newEndMins = 18 * 60;
                            const eh = Math.floor(newEndMins / 60);
                            const em = newEndMins % 60;
                            setRoomSchedule({
                              ...roomSchedule,
                              startHour: String(sh).padStart(2, '0'),
                              startMinute: String(sm).padStart(2, '0'),
                              endHour: String(eh).padStart(2, '0'),
                              endMinute: String(em).padStart(2, '0')
                            });
                          }}
                          options={posAvailableStartOptions.map(t => ({
                            value: t,
                            label: `${t} น.`
                          }))}
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 700 }}>-</span>
                        <CustomSelect
                          value={`${String(roomSchedule.endHour || '10').padStart(2, '0')}:${String(roomSchedule.endMinute || '00').padStart(2, '0')}`}
                          onChange={val => {
                            const [eh, em] = val.split(':').map(Number);
                            setRoomSchedule({
                              ...roomSchedule,
                              endHour: String(eh).padStart(2, '0'),
                              endMinute: String(em).padStart(2, '0')
                            });
                          }}
                          options={TIME_OPTIONS_POS.filter(t => {
                            const [sh, sm] = (roomSchedule.startHour && roomSchedule.startMinute)
                              ? [Number(roomSchedule.startHour), Number(roomSchedule.startMinute)]
                              : [9, 0];
                            const [eh, em] = t.split(':').map(Number);
                            return (eh * 60 + em) > (sh * 60 + sm) && (eh * 60 + em) <= 18 * 60;
                          }).map(t => ({
                            value: t,
                            label: `${t} น.`
                          }))}
                          align="right"
                          style={{ flex: 1 }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Duration Shortcuts */}
                {bookingType === 'hourly' && (
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Zap size={13} style={{ color: 'var(--primary-color)' }} />
                      <span>ปุ่มลัดขยายเวลา:</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {[1, 2, 3, 4].map(h => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setQuickDuration(h)}
                          style={{
                            flex: 1,
                            padding: '6px 0',
                            borderRadius: '8px',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-color)',
                            color: 'var(--text-main)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.borderColor = 'var(--primary-color)';
                            e.currentTarget.style.color = 'var(--primary-color)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.borderColor = 'var(--border-color)';
                            e.currentTarget.style.color = 'var(--text-main)';
                          }}
                        >
                          +{h} ชม.
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Guest Count */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Users size={14} style={{ color: 'var(--primary-color)' }} />
                      <span>จำนวนผู้เข้าใช้งาน (คน/ท่าน)</span>
                    </label>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>ไม่จำเป็นต้องระบุ</span>
                  </div>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type="number"
                      min="1"
                      max={layoutType === 'classroom' ? (selectedRoom.classroom_capacity || 100) : (selectedRoom.capacity || 100)}
                      placeholder="ระบุจำนวนผู้เข้าใช้ห้อง..."
                      value={roomSchedule.guestCount || ''}
                      onChange={e => setRoomSchedule({ ...roomSchedule, guestCount: e.target.value })}
                      className="form-control"
                      style={{ height: '40px', borderRadius: '12px', fontSize: '0.82rem', padding: '0 90px 0 12px', width: '100%', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
                    />
                    <span style={{ position: 'absolute', right: '12px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, pointerEvents: 'none' }}>
                      สูงสุด {layoutType === 'classroom' ? (selectedRoom.classroom_capacity || selectedRoom.capacity) : selectedRoom.capacity} ท่าน
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: รูปแบบการจองและราคา (Booking Type & Pricing) */}
              <div style={{
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  2. รูปแบบการจองและราคา (Booking Type & Pricing)
                </div>

                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px' }}>
                    รูปแบบระยะเวลาการจอง
                  </div>
                  {(() => {
                    const hasHourly = (selectedRoom.has_hourly === 1 || selectedRoom.has_hourly === true || (Number(selectedRoom.hourly_rate) > 0));
                    const hasHalfday = (selectedRoom.has_halfday === 1 || selectedRoom.has_halfday === true || (Number(selectedRoom.half_day_rate) > 0));
                    const hasDaily = (selectedRoom.has_daily === 1 || selectedRoom.has_daily === true || (Number(selectedRoom.daily_rate) > 0));

                    const availableTypes = [
                      { key: 'hourly', label: 'รายชั่วโมง', icon: Clock, color: 'var(--primary-color)', available: hasHourly },
                      { key: 'halfday', label: 'ครึ่งวัน (4 ชม.)', icon: Clock, color: '#10b981', available: hasHalfday },
                      { key: 'daily', label: 'รายวัน (เต็มวัน)', icon: Calendar, color: '#f59e0b', available: hasDaily }
                    ].filter(t => t.available);

                    if (availableTypes.length === 0) {
                      return (
                        <div style={{ padding: '8px 12px', borderRadius: '10px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          รายวัน (เต็มวัน)
                        </div>
                      );
                    }

                    if (availableTypes.length === 1) {
                      const t = availableTypes[0];
                      const Icon = t.icon;
                      return (
                        <div style={{
                          padding: '8px 12px',
                          borderRadius: '12px',
                          backgroundColor: 'rgba(37, 99, 235, 0.08)',
                          border: '1px solid rgba(37, 99, 235, 0.25)',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          color: 'var(--primary-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon size={14} />
                            <span>{t.label}</span>
                          </div>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                            (เฉพาะรูปแบบนี้ตามคลังสินค้า)
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-color)', padding: '3px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        {availableTypes.map(t => {
                          const Icon = t.icon;
                          const isSel = bookingType === t.key;
                          return (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => {
                                setBookingType(t.key);
                                if (t.key === 'halfday') setDailyTimeSlot('08-12');
                                else if (t.key === 'daily') setDailyTimeSlot('08-17');
                              }}
                              style={{
                                flex: 1,
                                padding: '7px 4px',
                                border: 'none',
                                borderRadius: '9px',
                                fontSize: '0.76rem',
                                fontWeight: isSel ? 800 : 600,
                                cursor: 'pointer',
                                backgroundColor: isSel ? t.color : 'transparent',
                                color: isSel ? '#ffffff' : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                                boxShadow: isSel ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <Icon size={13} />
                              <span>{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Layout Switch (if classroom supported) */}
                {selectedRoom.has_classroom === 1 && (
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                    <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px' }}>
                      รูปแบบการจัดโต๊ะเก้าอี้ (Layout)
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setLayoutType('standard')}
                        style={{
                          flex: 1,
                          padding: '7px 8px',
                          borderRadius: '10px',
                          border: layoutType === 'standard' ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                          backgroundColor: layoutType === 'standard' ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-color)',
                          color: layoutType === 'standard' ? 'var(--primary-color)' : 'var(--text-muted)',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Standard ({selectedRoom.capacity} ที่นั่ง)
                      </button>
                      <button
                        type="button"
                        onClick={() => setLayoutType('classroom')}
                        style={{
                          flex: 1,
                          padding: '7px 8px',
                          borderRadius: '10px',
                          border: layoutType === 'classroom' ? '1px solid #ec4899' : '1px solid var(--border-color)',
                          backgroundColor: layoutType === 'classroom' ? 'rgba(236, 72, 153, 0.12)' : 'var(--bg-color)',
                          color: layoutType === 'classroom' ? '#ec4899' : 'var(--text-muted)',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Classroom ({selectedRoom.classroom_capacity} ที่นั่ง)
                      </button>
                    </div>
                  </div>
                )}

                {/* Live Price & Duration Preview Box */}
                {(() => {
                  let durationText = '';
                  let totalHrs = 0;
                  let ratePrice = 0;

                  if (bookingType === 'daily') {
                    durationText = '9 ชั่วโมง (เต็มวัน)';
                    totalHrs = 9;
                    ratePrice = layoutType === 'classroom' ? (selectedRoom.classroom_daily_rate || 0) : (selectedRoom.daily_rate || 0);
                  } else if (bookingType === 'halfday') {
                    durationText = '4 ชั่วโมง (ครึ่งวัน)';
                    totalHrs = 4;
                    ratePrice = selectedRoom.half_day_rate || 0;
                  } else {
                    const sH = parseInt(roomSchedule.startHour, 10) || 9;
                    const sM = parseInt(roomSchedule.startMinute, 10) || 0;
                    const eH = parseInt(roomSchedule.endHour, 10) || 10;
                    const eM = parseInt(roomSchedule.endMinute, 10) || 0;
                    const diffMinutes = (eH * 60 + eM) - (sH * 60 + sM);
                    const exactHours = diffMinutes > 0 ? diffMinutes / 60 : 1;
                    const billedHours = Math.max(1, Math.ceil(exactHours));
                    totalHrs = billedHours;
                    durationText = exactHours === Math.floor(exactHours)
                      ? `${exactHours} ชั่วโมง`
                      : `${exactHours} ชั่วโมง (${diffMinutes} นาที)`;
                    ratePrice = layoutType === 'classroom' ? (selectedRoom.classroom_hourly_rate || 0) : (selectedRoom.hourly_rate || 0);
                  }

                  const estSubtotal = (bookingType === 'daily' || bookingType === 'halfday') ? ratePrice : (ratePrice * totalHrs);

                  return (
                    <div style={{
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>ระยะเวลาที่เลือกใช้งาน</div>
                        <div style={{ color: 'var(--primary-color)', fontSize: '0.92rem', fontWeight: 800, marginTop: '2px' }}>
                          {durationText}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรวมเบื้องต้น</div>
                        <div style={{ color: 'var(--text-main)', fontSize: '1.15rem', fontWeight: 900, marginTop: '1px' }}>
                          {customer.customer_type === 'builtland' ? (
                            <span style={{ color: '#ea580c', fontSize: '0.88rem' }}>฿0 (สิทธิ์ Builtland)</span>
                          ) : customer.customer_type === 'basecamp' ? (
                            <span style={{ color: '#9333ea', fontSize: '0.88rem' }}>โควต้า Basecamp</span>
                          ) : customer.customer_type === 'shop' ? (
                            <span style={{ color: '#059669', fontSize: '0.88rem' }}>โควต้า Shop</span>
                          ) : (
                            `฿${Number(estSubtotal).toLocaleString()}`
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Section 3: ข้อมูลผู้จอง (Customer Information) */}
              <div style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  3. ข้อมูลผู้จอง (Customer Information)
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '8px', display: 'block' }}>
                    ประเภทลูกค้า (Customer Type) <span style={{ color: 'var(--danger-color)' }}>*</span>
                  </label>

                  {/* 4-Way Segmented Switcher */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr 1fr',
                    gap: '6px',
                    backgroundColor: 'var(--bg-main)',
                    padding: '4px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)'
                  }}>
                    {/* 1. Walk-in */}
                    <button
                      type="button"
                      onClick={() => handleCustomerTypeChange('walkin')}
                      style={{
                        padding: '10px 4px',
                        borderRadius: '9px',
                        border: customer.customer_type === 'walkin' ? '1px solid var(--primary-color)' : '1px solid transparent',
                        backgroundColor: customer.customer_type === 'walkin' ? 'var(--primary-color)' : 'transparent',
                        color: customer.customer_type === 'walkin' ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: customer.customer_type === 'walkin' ? 800 : 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'all 0.15s ease',
                        boxShadow: customer.customer_type === 'walkin' ? '0 2px 8px rgba(37,99,235,0.3)' : 'none'
                      }}
                    >
                      <span>Walk-in</span>
                      <span style={{ fontSize: '0.66rem', opacity: customer.customer_type === 'walkin' ? 0.95 : 0.7 }}>ลูกค้านอก</span>
                    </button>

                    {/* 2. Builtland */}
                    <button
                      type="button"
                      onClick={() => handleCustomerTypeChange('builtland')}
                      style={{
                        padding: '10px 4px',
                        borderRadius: '9px',
                        border: customer.customer_type === 'builtland' ? '1px solid #ea580c' : '1px solid transparent',
                        backgroundColor: customer.customer_type === 'builtland' ? '#ea580c' : 'transparent',
                        color: customer.customer_type === 'builtland' ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: customer.customer_type === 'builtland' ? 800 : 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'all 0.15s ease',
                        boxShadow: customer.customer_type === 'builtland' ? '0 2px 8px rgba(234,88,12,0.3)' : 'none'
                      }}
                    >
                      <span>Builtland</span>
                      <span style={{ fontSize: '0.66rem', opacity: customer.customer_type === 'builtland' ? 0.95 : 0.7 }}>พนักงาน</span>
                    </button>

                    {/* 3. Basecamp */}
                    <button
                      type="button"
                      onClick={() => handleCustomerTypeChange('basecamp')}
                      style={{
                        padding: '10px 4px',
                        borderRadius: '9px',
                        border: customer.customer_type === 'basecamp' ? '1px solid #9333ea' : '1px solid transparent',
                        backgroundColor: customer.customer_type === 'basecamp' ? '#9333ea' : 'transparent',
                        color: customer.customer_type === 'basecamp' ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: customer.customer_type === 'basecamp' ? 800 : 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'all 0.15s ease',
                        boxShadow: customer.customer_type === 'basecamp' ? '0 2px 8px rgba(147,51,234,0.3)' : 'none'
                      }}
                    >
                      <span>Basecamp</span>
                      <span style={{ fontSize: '0.66rem', opacity: customer.customer_type === 'basecamp' ? 0.95 : 0.7 }}>ผู้เช่าชั้น 4</span>
                    </button>

                    {/* 4. Shop */}
                    <button
                      type="button"
                      onClick={() => handleCustomerTypeChange('shop')}
                      style={{
                        padding: '10px 4px',
                        borderRadius: '9px',
                        border: customer.customer_type === 'shop' ? '1px solid #059669' : '1px solid transparent',
                        backgroundColor: customer.customer_type === 'shop' ? '#059669' : 'transparent',
                        color: customer.customer_type === 'shop' ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: customer.customer_type === 'shop' ? 800 : 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        transition: 'all 0.15s ease',
                        boxShadow: customer.customer_type === 'shop' ? '0 2px 8px rgba(5,150,105,0.3)' : 'none'
                      }}
                    >
                      <span>Shop</span>
                      <span style={{ fontSize: '0.66rem', opacity: customer.customer_type === 'shop' ? 0.95 : 0.7 }}>ร้านค้า</span>
                    </button>
                  </div>
                </div>

                {/* --- CASE A: BASECAMP (Office / Hotdesk) --- */}
                {customer.customer_type === 'basecamp' && (
                  <div style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '14px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    {/* Sub-Type Selector: Office vs Hotdesk */}
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        ประเภทยูนิต Basecamp ชั้น 4 <span style={{ color: 'var(--danger-color)' }}>*</span>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setCustomer({ ...customer, basecamp_sub_type: 'office', basecamp_unit: '401' })}
                          style={{
                            padding: '8px 10px',
                            borderRadius: '9px',
                            border: customer.basecamp_sub_type === 'office' ? '1.5px solid #9333ea' : '1px solid var(--border-color)',
                            backgroundColor: customer.basecamp_sub_type === 'office' ? 'rgba(147, 51, 234, 0.12)' : 'var(--bg-card)',
                            color: customer.basecamp_sub_type === 'office' ? '#9333ea' : 'var(--text-main)',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          Office (401–414)
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomer({ ...customer, basecamp_sub_type: 'hotdesk', basecamp_unit: '419' })}
                          style={{
                            padding: '8px 10px',
                            borderRadius: '9px',
                            border: customer.basecamp_sub_type === 'hotdesk' ? '1.5px solid #3b82f6' : '1px solid var(--border-color)',
                            backgroundColor: customer.basecamp_sub_type === 'hotdesk' ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-card)',
                            color: customer.basecamp_sub_type === 'hotdesk' ? '#3b82f6' : 'var(--text-main)',
                            fontSize: '0.8rem',
                            fontWeight: 800,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          Hotdesk (419–430)
                        </button>
                      </div>
                    </div>

                    {/* Room/Seat Dropdown with WebApp CustomSelect */}
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        {customer.basecamp_sub_type === 'office' ? 'เลือกห้อง Office ชั้น 4 *' : 'เลือกที่นั่ง Hotdesk ชั้น 4 *'}
                      </label>
                      <CustomSelect
                        value={customer.basecamp_unit || (customer.basecamp_sub_type === 'office' ? '401' : '419')}
                        onChange={val => {
                          const matched = registeredBasecamps.find(b => b.basecamp_unit === val);
                          setCustomer(prev => ({
                            ...prev,
                            basecamp_unit: val,
                            customer_id: matched ? matched.id : null,
                            contract_id: matched?.active_contract?.id || null,
                            name: matched ? matched.name : prev.name
                          }));
                        }}
                        options={customer.basecamp_sub_type === 'office' ? (
                          BASECAMP_OFFICE_UNITS.map(u => ({
                            value: u,
                            label: `Office ${u} (ห้องเช่าประจำชั้น 4)`
                          }))
                        ) : (
                          BASECAMP_HOTDESK_UNITS.map(u => ({
                            value: u,
                            label: `Hotdesk ${u} (ที่นั่งประจำชั้น 4)`
                          }))
                        )}
                      />
                    </div>

                    {/* Monthly Quota Status Info Card */}
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      fontSize: '0.78rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 800, color: 'var(--text-main)' }}>
                          สิทธิ์โควต้าประจำเดือน: {customer.basecamp_sub_type === 'office' ? '4' : '2'} ชม./เดือน
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          ใช้ไปแล้ว {basecampQuota.used_quota || 0} ชม. | คงเหลือ {basecampQuota.remaining_quota !== undefined ? basecampQuota.remaining_quota : (customer.basecamp_sub_type === 'office' ? 4 : 2)} ชม.
                        </div>
                      </div>
                      <span style={{
                        fontWeight: 800,
                        fontSize: '0.76rem',
                        color: (basecampQuota.remaining_quota || 0) > 0 ? '#10b981' : '#ef4444',
                        backgroundColor: (basecampQuota.remaining_quota || 0) > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                        border: (basecampQuota.remaining_quota || 0) > 0 ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
                        padding: '4px 10px',
                        borderRadius: '6px'
                      }}>
                        {(basecampQuota.remaining_quota || 0) > 0 ? `เหลือ ${basecampQuota.remaining_quota} ชม.` : 'โควต้าหมดแล้ว'}
                      </span>
                    </div>

                    {/* Tenant Company / Name */}
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        ชื่อผู้จอง / บริษัท <span style={{ color: 'var(--danger-color)' }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder={customer.basecamp_sub_type === 'office' ? `เช่น บจก. ผู้เช่าห้อง ${customer.basecamp_unit}` : `ชื่อผู้เช่า Hotdesk ${customer.basecamp_unit}`}
                        value={customer.name}
                        onChange={e => setCustomer({ ...customer, name: e.target.value })}
                        style={{
                          width: '100%',
                          height: '40px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          padding: '0 12px',
                          fontSize: '0.84rem',
                          color: 'var(--text-main)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    {/* Auto-Deduct Quota Notice */}
                    <div style={{
                      backgroundColor: 'rgba(147, 51, 234, 0.08)',
                      border: '1px solid rgba(147, 51, 234, 0.25)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '0.74rem',
                      color: '#9333ea',
                      fontWeight: 700
                    }}>
                      ระบบจะทำการตัดชั่วโมงโควต้าให้อัตโนมัติเมื่อกดยืนยันการจอง
                    </div>
                  </div>
                )}

                {/* --- CASE D: SHOP (Partner / Merchant) --- */}
                {customer.customer_type === 'shop' && (
                  <div style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '14px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    {/* Shop Selection Dropdown */}
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        เลือกร้านค้าพันธมิตร (Shop) <span style={{ color: 'var(--danger-color)' }}>*</span>
                      </label>
                      <CustomSelect
                        value={customer.customer_id ? String(customer.customer_id) : (registeredShops[0]?.id ? String(registeredShops[0].id) : '')}
                        onChange={val => {
                          const s = registeredShops.find(item => String(item.id) === String(val));
                          if (s) {
                            setCustomer(prev => ({
                              ...prev,
                              customer_id: s.id,
                              contract_id: s.active_contract?.id || null,
                              name: s.name,
                              contact: s.phone || s.contact_name || ''
                            }));
                          }
                        }}
                        options={registeredShops.map(s => ({
                          value: String(s.id),
                          label: `${s.name}${s.category ? ` (${s.category})` : ''}`
                        }))}
                        placeholder="-- เลือกร้านค้าพันธมิตร --"
                      />
                    </div>

                    {/* Monthly Quota & Contract Status Info Card */}
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      fontSize: '0.78rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>สิทธิ์โควต้าประจำเดือน: 4 ชม./เดือน</span>
                          {shopQuota.contract_eligible === false && (
                            <span style={{ fontSize: '0.7rem', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                              (สัญญาสิ้นสุดก่อนวันใช้งาน)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          ใช้ไปแล้ว {shopQuota.used_quota || 0} ชม. | คงเหลือ {shopQuota.remaining_quota || 0} ชม.
                        </div>
                      </div>
                      <span style={{
                        fontWeight: 800,
                        fontSize: '0.76rem',
                        color: (shopQuota.contract_eligible && (shopQuota.remaining_quota || 0) > 0) ? '#10b981' : '#ef4444',
                        backgroundColor: (shopQuota.contract_eligible && (shopQuota.remaining_quota || 0) > 0) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                        border: (shopQuota.contract_eligible && (shopQuota.remaining_quota || 0) > 0) ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
                        padding: '4px 10px',
                        borderRadius: '6px'
                      }}>
                        {!shopQuota.contract_eligible
                          ? 'หมดสัญญา (คิดราคาเต็ม)'
                          : ((shopQuota.remaining_quota || 0) > 0 ? `เหลือ ${shopQuota.remaining_quota} ชม.` : 'โควต้าหมดแล้ว')}
                      </span>
                    </div>

                    {/* Shop Contact / Rep Name */}
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        ชื่อผู้ติดต่อ / ตัวแทนร้านค้า
                      </label>
                      <input
                        type="text"
                        placeholder="ชื่อตัวแทนผู้มาใช้งานหรือติดต่อ"
                        value={customer.contact}
                        onChange={e => setCustomer({ ...customer, contact: e.target.value })}
                        style={{
                          width: '100%',
                          height: '40px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          padding: '0 12px',
                          fontSize: '0.84rem',
                          color: 'var(--text-main)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    {/* Auto-Deduct Quota Notice */}
                    <div style={{
                      backgroundColor: 'rgba(5, 150, 105, 0.08)',
                      border: '1px solid rgba(5, 150, 105, 0.25)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '0.74rem',
                      color: '#059669',
                      fontWeight: 700
                    }}>
                      ระบบจะทำการตัดชั่วโมงโควต้าของร้านค้าให้อัตโนมัติ (หากวันใช้งานอยู่ในอายุสัญญา)
                    </div>
                  </div>
                )}

                {/* --- CASE B: BUILTLAND STAFF --- */}
                {customer.customer_type === 'builtland' && (
                  <div style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '14px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        ชื่อพนักงานผู้จอง <span style={{ color: 'var(--danger-color)' }}>*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="ชื่อ-นามสกุล พนักงาน"
                        value={customer.name}
                        onChange={e => setCustomer({ ...customer, name: e.target.value })}
                        style={{
                          width: '100%',
                          height: '40px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          padding: '0 12px',
                          fontSize: '0.84rem',
                          color: 'var(--text-main)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{
                      backgroundColor: 'rgba(234, 88, 12, 0.08)',
                      border: '1px solid rgba(234, 88, 12, 0.25)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      color: '#ea580c',
                      fontSize: '0.78rem',
                      fontWeight: 800
                    }}>
                      สิทธิ์การใช้งานภายในบริษัท Builtland
                    </div>
                  </div>
                )}

                {/* --- CASE C: WALK-IN CUSTOMER --- */}
                {customer.customer_type === 'walkin' && (
                  <div style={{
                    backgroundColor: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '14px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                          ชื่อผู้จอง <span style={{ color: 'var(--danger-color)' }}>*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setCustomer({ ...customer, name: 'ลูกค้า Walk-in' })}
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: 'var(--primary-color)',
                            background: 'rgba(37,99,235,0.1)',
                            border: '1px solid rgba(37,99,235,0.25)',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            cursor: 'pointer'
                          }}
                        >
                          + ใส่ชื่อ Walk-in
                        </button>
                      </div>

                      <input
                        type="text"
                        placeholder="กรอกชื่อผู้จอง / องค์กร"
                        value={customer.name}
                        onChange={e => setCustomer({ ...customer, name: e.target.value })}
                        style={{
                          width: '100%',
                          height: '40px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          padding: '0 12px',
                          fontSize: '0.84rem',
                          color: 'var(--text-main)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                        เบอร์ติดต่อ
                      </label>
                      <input
                        type="text"
                        placeholder="08x-xxx-xxxx"
                        value={customer.contact}
                        onChange={e => setCustomer({ ...customer, contact: e.target.value })}
                        style={{
                          width: '100%',
                          height: '40px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-card)',
                          padding: '0 12px',
                          fontSize: '0.84rem',
                          color: 'var(--text-main)',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* รายละเอียดเพิ่มเติม (Optional Booking Details) */}
                <div style={{
                  backgroundColor: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '14px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                      รายละเอียดเพิ่มเติม
                    </label>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                      {bookingDetails.length}/1000
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    placeholder="เช่น รายละเอียดบริการเพิ่มเติม, ความต้องการของลูกค้า, หมายเหตุการจอง"
                    value={bookingDetails}
                    onChange={e => setBookingDetails(e.target.value)}
                    style={{
                      width: '100%',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-card)',
                      padding: '8px 12px',
                      fontSize: '0.84rem',
                      color: 'var(--text-main)',
                      outline: 'none',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                      lineHeight: 1.4
                    }}
                  />
                </div>
              </div>

              {/* Section 4: ค่าบริการและส่วนลด & การชำระเงิน (Pricing, Discount & Payment) */}
              <div style={{
                backgroundColor: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  4. ค่าบริการและการชำระเงิน (Pricing & Payment)
                </div>

                {customer.customer_type === 'walkin' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                    {/* A. ค่าบริการและส่วนลด (Subtotal & Discount) */}
                    <div style={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรวมก่อนส่วนลด</span>
                        <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)', fontWeight: 800 }}>฿{formatMoney(quickFinancialPreview.subtotal_amount)}</strong>
                      </div>

                      {/* ส่วนลด Segmented Controls: [ ไม่มี ] [ % ] [ บาท ] */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                            ส่วนลด (Discount)
                          </label>
                          {quickFinancialPreview.discount_amount > 0 && !quickFinancialPreview.discount_error && (
                            <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#10b981' }}>
                              -฿{formatMoney(quickFinancialPreview.discount_amount)}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', backgroundColor: 'var(--bg-main)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                          {[
                            { key: 'none', label: 'ไม่มี' },
                            { key: 'percent', label: '%' },
                            { key: 'amount', label: 'บาท' }
                          ].map(t => {
                            const isSel = quickDiscountType === t.key;
                            return (
                              <button
                                key={t.key}
                                type="button"
                                onClick={() => {
                                  setQuickDiscountType(t.key);
                                  if (t.key === 'none') setQuickDiscountValue('');
                                }}
                                style={{
                                  padding: '6px 0',
                                  border: 'none',
                                  borderRadius: '7px',
                                  fontSize: '0.75rem',
                                  fontWeight: isSel ? 800 : 600,
                                  cursor: 'pointer',
                                  backgroundColor: isSel ? 'var(--primary-color)' : 'transparent',
                                  color: isSel ? '#ffffff' : 'var(--text-muted)',
                                  boxShadow: isSel ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {t.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Discount Input Field */}
                        {quickDiscountType !== 'none' && (
                          <div style={{ marginTop: '8px' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <input
                                type="number"
                                min="0"
                                max={quickDiscountType === 'percent' ? 100 : quickFinancialPreview.subtotal_amount}
                                step={quickDiscountType === 'percent' ? '1' : '10'}
                                placeholder={quickDiscountType === 'percent' ? 'ระบุเปอร์เซ็นต์ส่วนลด (0-100)' : 'ระบุจำนวนเงินส่วนลด (บาท)'}
                                value={quickDiscountValue}
                                onChange={e => setQuickDiscountValue(e.target.value)}
                                style={{
                                  width: '100%',
                                  height: '36px',
                                  borderRadius: '8px',
                                  border: quickFinancialPreview.discount_error ? '1px solid #ef4444' : '1px solid var(--border-color)',
                                  backgroundColor: 'var(--bg-main)',
                                  padding: '0 36px 0 10px',
                                  fontSize: '0.84rem',
                                  color: 'var(--text-main)',
                                  outline: 'none',
                                  boxSizing: 'border-box'
                                }}
                              />
                              <span style={{
                                position: 'absolute',
                                right: '10px',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                color: 'var(--text-muted)',
                                pointerEvents: 'none'
                              }}>
                                {quickDiscountType === 'percent' ? '%' : 'บาท'}
                              </span>
                            </div>
                            {quickFinancialPreview.discount_error && (
                              <div style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600, marginTop: '4px' }}>
                                {quickFinancialPreview.discount_error}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ยอดสุทธิ (Net Total) */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderTop: '1px dashed var(--border-color)',
                        paddingTop: '8px',
                        marginTop: '2px'
                      }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)' }}>ยอดสุทธิ</span>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--primary-color)', fontWeight: 900 }}>
                          ฿{formatMoney(quickFinancialPreview.total_amount)}
                        </strong>
                      </div>
                    </div>

                    {/* B. การชำระเงิน (Payment Mode & Method) */}
                    <div style={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      <div>
                        <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                          รูปแบบการชำระเงิน (Payment Mode) *
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', backgroundColor: 'var(--bg-main)', padding: '3px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                          {[
                            { key: 'full', label: 'ชำระเต็ม' },
                            { key: 'deposit', label: 'มัดจำ' },
                            { key: 'unpaid', label: 'ยังไม่ชำระ' }
                          ].map(m => {
                            const isSel = quickPaymentMode === m.key;
                            return (
                              <button
                                key={m.key}
                                type="button"
                                onClick={() => {
                                  setQuickPaymentMode(m.key);
                                  if (m.key === 'unpaid') setPaymentMethod('');
                                  else if (!paymentMethod) setPaymentMethod('cash');
                                }}
                                style={{
                                  padding: '6px 0',
                                  border: 'none',
                                  borderRadius: '7px',
                                  fontSize: '0.74rem',
                                  fontWeight: isSel ? 800 : 600,
                                  cursor: 'pointer',
                                  backgroundColor: isSel ? 'var(--primary-color)' : 'transparent',
                                  color: isSel ? '#ffffff' : 'var(--text-muted)',
                                  boxShadow: isSel ? '0 2px 6px rgba(37,99,235,0.25)' : 'none',
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Deposit Input */}
                      {quickPaymentMode === 'deposit' && (
                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                            ยอดเงินมัดจำ (Deposit Amount) *
                          </label>
                          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <input
                              type="number"
                              min="1"
                              max={Math.max(0, quickFinancialPreview.total_amount - 1)}
                              step="50"
                              placeholder="ระบุจำนวนเงินมัดจำ (บาท)"
                              value={quickDepositAmount}
                              onChange={e => setQuickDepositAmount(e.target.value)}
                              style={{
                                width: '100%',
                                height: '36px',
                                borderRadius: '8px',
                                border: quickFinancialPreview.deposit_error ? '1px solid #ef4444' : '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-main)',
                                padding: '0 36px 0 10px',
                                fontSize: '0.84rem',
                                color: 'var(--text-main)',
                                outline: 'none',
                                boxSizing: 'border-box'
                              }}
                            />
                            <span style={{
                              position: 'absolute',
                              right: '10px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              color: 'var(--text-muted)',
                              pointerEvents: 'none'
                            }}>
                              บาท
                            </span>
                          </div>
                          {quickFinancialPreview.deposit_error && (
                            <div style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 600, marginTop: '4px' }}>
                              {quickFinancialPreview.deposit_error}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Payment Method Selector (for full and deposit when net > 0) */}
                      {(quickPaymentMode === 'full' || quickPaymentMode === 'deposit') && quickFinancialPreview.total_amount > 0 && (
                        <div>
                          <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                            ช่องทางชำระเงิน *
                          </label>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                            {[
                              { key: 'cash', label: 'เงินสด', icon: Banknote, color: '#10b981' },
                              { key: 'transfer', label: 'โอนเงิน', icon: Smartphone, color: '#3b82f6' },
                              { key: 'card', label: 'บัตรเครดิต', icon: CreditCard, color: '#8b5cf6' }
                            ].map(m => {
                              const isSel = paymentMethod === m.key;
                              const Icon = m.icon;
                              return (
                                <button
                                  key={m.key}
                                  type="button"
                                  onClick={() => setPaymentMethod(m.key)}
                                  style={{
                                    height: '32px',
                                    borderRadius: '8px',
                                    border: isSel ? `1.5px solid ${m.color}` : '1px solid var(--border-color)',
                                    backgroundColor: isSel ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-main)',
                                    color: isSel ? 'var(--text-main)' : 'var(--text-muted)',
                                    fontSize: '0.72rem',
                                    fontWeight: isSel ? 800 : 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  <Icon size={12} style={{ color: m.color }} />
                                  <span>{m.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Unpaid / Zero-Net Notice */}
                      {quickPaymentMode === 'unpaid' && (
                        <div style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(245, 158, 11, 0.08)',
                          border: '1px solid rgba(245, 158, 11, 0.25)',
                          fontSize: '0.72rem',
                          color: '#d97706',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <Clock size={13} style={{ flexShrink: 0 }} />
                          <span>ค้างชำระ (Pending): ยังไม่ต้องเลือกช่องทางชำระเงิน</span>
                        </div>
                      )}

                      {quickFinancialPreview.total_amount === 0 && (
                        <div style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          fontSize: '0.72rem',
                          color: '#10b981',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                          <span>ยอดสุทธิ ฿0.00: บันทึกสถานะชำระแล้วโดยไม่ต้องชำระเงิน</span>
                        </div>
                      )}

                      {/* Live Snapshot Breakdown */}
                      <div style={{
                        backgroundColor: 'var(--bg-main)',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.75rem',
                        border: '1px solid var(--border-color)'
                      }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>ชำระวันนี้: </span>
                          <strong style={{ color: '#10b981', fontWeight: 800 }}>฿{formatMoney(quickFinancialPreview.paid_amount)}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>คงเหลือ: </span>
                          <strong style={{ color: quickFinancialPreview.balance_amount > 0 ? '#f59e0b' : 'var(--text-main)', fontWeight: 800 }}>
                            ฿{formatMoney(quickFinancialPreview.balance_amount)}
                          </strong>
                        </div>
                      </div>
                    </div>

                  </div>
                ) : customer.customer_type === 'builtland' ? (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(234, 88, 12, 0.08)',
                    border: '1px solid rgba(234, 88, 12, 0.25)',
                    color: '#ea580c',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <CheckCircle2 size={16} style={{ color: '#ea580c', flexShrink: 0 }} />
                    <span>สิทธิ์การใช้งานภายใน Builtland: ฟรี ไม่คิดค่าบริการ (บันทึกเป็นการใช้งานภายใน)</span>
                  </div>
                ) : customer.customer_type === 'shop' ? (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(5, 150, 105, 0.08)',
                    border: '1px solid rgba(5, 150, 105, 0.25)',
                    color: '#059669',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <CheckCircle2 size={16} style={{ color: '#059669', flexShrink: 0 }} />
                    <span>สิทธิ์ร้านค้าพันธมิตร (Shop): ตัดชั่วโมงโควต้าประจำเดือนอัตโนมัติ (4 ชม./เดือน)</span>
                  </div>
                ) : (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(147, 51, 234, 0.08)',
                    border: '1px solid rgba(147, 51, 234, 0.25)',
                    color: '#9333ea',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <CheckCircle2 size={16} style={{ color: '#9333ea', flexShrink: 0 }} />
                    <span>สิทธิ์สมาชิก Basecamp: ตัดชั่วโมงโควต้าประจำเดือนอัตโนมัติ</span>
                  </div>
                )}
              </div>

              {/* Section 5: ตรวจสอบความพร้อมการจอง (Availability Check) */}
              {currentSlotOverlap.isOverlap ? (
                currentSlotOverlap.isCleaningBuffer ? (
                  <div style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px'
                  }}>
                    <Clock size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: '0.78rem' }}>
                      <div style={{ fontWeight: 800, color: '#d97706' }}>ช่วงเวลานี้ติดทำความสะอาด / เคลียร์ห้อง ({currentSlotOverlap.bufferMinutes || 30} นาที)</div>
                      <div style={{ color: 'var(--text-main)', marginTop: '3px', lineHeight: 1.4 }}>
                        คิวก่อนหน้าใช้งานถึง <strong>{new Date(currentSlotOverlap.booking.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</strong>
                        {currentSlotOverlap.booking.customer_name && ` (คุณ ${currentSlotOverlap.booking.customer_name})`}
                        <br />
                        <span style={{ color: '#b45309', fontWeight: 700 }}>
                          สามารถจองได้ตั้งแต่เวลา {new Date(new Date(currentSlotOverlap.booking.end_time).getTime() + (currentSlotOverlap.bufferMinutes || 30) * 60000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. เป็นต้นไป
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: '14px',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px'
                  }}>
                    <AlertTriangle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: '0.78rem' }}>
                      <div style={{ fontWeight: 800, color: '#ef4444' }}>ช่วงเวลานี้มีผู้จองแล้ว (ห้องไม่ว่าง)</div>
                      <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>
                        ผู้เข้าใช้: <strong>คุณ {currentSlotOverlap.booking.customer_name || 'ลูกค้า'}</strong> ({new Date(currentSlotOverlap.booking.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(currentSlotOverlap.booking.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.)
                      </div>
                    </div>
                  </div>
                )
              ) : currentSlotOverlap.isValid ? (
                <div style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  borderRadius: '12px',
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#10b981',
                  fontSize: '0.78rem',
                  fontWeight: 700
                }}>
                  <CheckCircle2 size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                  <span>ห้องว่าง พร้อมทำการจองในช่วงเวลานี้</span>
                </div>
              ) : null}

            </div>

            {/* 3. Drawer Footer Actions */}
            <div style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              gap: '8px',
              backgroundColor: 'var(--bg-card)',
              boxShadow: '0 -4px 15px rgba(0,0,0,0.05)'
            }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '44px', padding: '0 14px', borderRadius: '12px', fontWeight: 600, fontSize: '0.82rem' }}
                onClick={closeRoomModal}
              >
                ยกเลิก
              </button>

              <button
                type="button"
                onClick={addRoomToCart}
                disabled={currentSlotOverlap.isOverlap}
                style={{
                  flex: 1,
                  height: '44px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  backgroundColor: currentSlotOverlap.isOverlap ? 'rgba(148, 163, 184, 0.15)' : 'var(--bg-card)',
                  border: currentSlotOverlap.isOverlap ? '1px solid rgba(148, 163, 184, 0.3)' : '1px solid var(--border-color)',
                  color: currentSlotOverlap.isOverlap ? '#94a3b8' : 'var(--text-main)',
                  opacity: currentSlotOverlap.isOverlap ? 0.6 : 1,
                  cursor: currentSlotOverlap.isOverlap ? 'not-allowed' : 'pointer'
                }}
              >
                <ShoppingCart size={15} />
                <span>+ ลงตะกร้า</span>
              </button>

              <button
                type="button"
                className={(currentSlotOverlap.isOverlap || !quickFinancialPreview.is_valid || isSubmittingQuickBooking) ? '' : 'btn btn-primary'}
                style={{
                  flex: 2,
                  height: '44px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.86rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  backgroundColor: (currentSlotOverlap.isOverlap || !quickFinancialPreview.is_valid || isSubmittingQuickBooking) ? '#94a3b8' : undefined,
                  color: '#ffffff',
                  opacity: (currentSlotOverlap.isOverlap || !quickFinancialPreview.is_valid || isSubmittingQuickBooking) ? 0.75 : 1,
                  cursor: (currentSlotOverlap.isOverlap || !quickFinancialPreview.is_valid || isSubmittingQuickBooking) ? 'not-allowed' : 'pointer',
                  boxShadow: (currentSlotOverlap.isOverlap || !quickFinancialPreview.is_valid || isSubmittingQuickBooking) ? 'none' : '0 4px 14px rgba(37,99,235,0.3)',
                  border: 'none'
                }}
                onClick={quickDirectBooking}
                disabled={currentSlotOverlap.isOverlap || !quickFinancialPreview.is_valid || isSubmittingQuickBooking}
              >
                {isSubmittingQuickBooking ? (
                  <span>กำลังบันทึกข้อมูล...</span>
                ) : currentSlotOverlap.isOverlap ? (
                  currentSlotOverlap.isCleaningBuffer ? <Clock size={16} /> : <AlertTriangle size={16} />
                ) : (
                  <Zap size={16} />
                )}
                <span>
                  {isSubmittingQuickBooking
                    ? ''
                    : currentSlotOverlap.isOverlap
                    ? 'ช่วงเวลานี้ไม่สามารถจองได้'
                    : 'ยืนยันจองทันที'}
                </span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 5. SERVICE PICKER MODAL                                   */}
      {/* ========================================================= */}
      {showServicePicker && (
        <div
          onClick={() => setShowServicePicker(false)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '95%', maxWidth: '480px', backgroundColor: 'var(--bg-card)', borderRadius: '20px', padding: '20px', border: '1px solid var(--border-color)', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>เลือกบริการเสริม / อาหารว่าง</h3>
              <button type="button" onClick={() => setShowServicePicker(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', maxHeight: '320px', overflowY: 'auto' }}>
              {services.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '12px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)' }}>{s.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 800 }}>฿{s.price}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addServiceToCart(s)}
                    className="btn btn-primary"
                    style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700 }}
                  >
                    + เพิ่ม
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 6. RECEIPT PRINT MODAL                                    */}
      {/* ========================================================= */}
      {showReceiptModal && printBooking && (
        <div
          onClick={handleCloseReceiptModal}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(20px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px'
          }}
          className="print-modal-overlay"
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '440px', width: '100%', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}
          >
            <div style={{ width: '100%', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Check size={13} /> ชำระเงินสำเร็จ
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => {
                      const bId = printBooking.id || printBooking.booking_id;
                      handleCloseReceiptModal();
                      onNavigate('pending', { bookingId: bId, action: 'view' });
                    }}
                    className="btn btn-secondary"
                    style={{ height: '34px', padding: '0 10px', borderRadius: '10px', fontSize: '0.76rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    title="เปิดดูรายการนี้ในหน้าจัดการการจอง"
                  >
                    <ExternalLink size={14} /> จัดการการจอง
                  </button>
                )}
                <button type="button" onClick={handleDownloadReceiptPDF} className="btn btn-secondary" style={{ height: '34px', padding: '0 10px', borderRadius: '10px', fontSize: '0.76rem', fontWeight: 700 }}>
                  <FileText size={14} /> PDF
                </button>
                <button type="button" onClick={() => printReceipt('print-receipt-area')} className="btn btn-primary" style={{ height: '34px', padding: '0 12px', borderRadius: '10px', fontSize: '0.76rem', fontWeight: 800 }}>
                  <Printer size={14} /> พิมพ์ใบเสร็จ
                </button>
                <button type="button" onClick={handleCloseReceiptModal} style={{ width: '34px', height: '34px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '16px', width: '100%', maxWidth: '380px' }}>
              <ReceiptPrint booking={printBooking} settings={settings} />
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 7. VIEWED EVENT DETAILS MODAL                             */}
      {/* ========================================================= */}
      {viewedEvent && (
        <div
          onClick={() => setViewedEvent(null)}
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(16px)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '95%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', borderRadius: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}
          >
            <button
              type="button"
              style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setViewedEvent(null)}
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  รายละเอียดการจอง
                </span>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(37,99,235,0.08)',
                  color: 'var(--primary-color)',
                  border: '1px solid rgba(37,99,235,0.2)'
                }}>
                  Ref: {viewedEvent.booking_ref || viewedEvent.booking_id || (viewedEvent.id ? `#${viewedEvent.id}` : '-')}
                </span>
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                {viewedEvent.room_name}
              </h3>
            </div>

            {/* Operational Metadata Rows */}
            <div style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>ผู้จอง:</span>
                <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>{viewedEvent.customer_name || '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>เบอร์ติดต่อ:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{viewedEvent.contact || viewedEvent.phone || viewedEvent.customer_phone || '-'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>ประเภทลูกค้า:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                  {viewedEvent.customer_type === 'basecamp'
                    ? `Basecamp (${viewedEvent.basecamp_sub_type === 'office' ? 'Office' : 'Hotdesk'} ${viewedEvent.basecamp_unit || ''})`
                    : viewedEvent.customer_type === 'builtland'
                    ? 'Builtland Staff'
                    : 'ลูกค้าทั่วไป (Walk-in)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>วันที่:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {new Date(viewedEvent.start_time).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' })}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>ช่วงเวลา:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                  {new Date(viewedEvent.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(viewedEvent.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>รูปแบบ / ผังห้อง:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {viewedEvent.booking_type === 'daily' ? 'รายวัน (ทั้งวัน)' : viewedEvent.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง'} · {viewedEvent.layout === 'classroom' ? 'Classroom' : 'Standard'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>จำนวนผู้เข้าใช้:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {viewedEvent.guest_count || viewedEvent.item_guest_count ? `${viewedEvent.guest_count || viewedEvent.item_guest_count} ท่าน` : 'ไม่ระบุ'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>ยอดเงิน:</span>
                <span style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.95rem' }}>
                  ฿{Number(viewedEvent.subtotal || viewedEvent.price || viewedEvent.total_price || 0).toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>สถานะชำระ:</span>
                {(() => {
                  const sInfo = getUnifiedPaymentStatus(viewedEvent);
                  return (
                    <span style={{ color: sInfo.color, fontWeight: 700, backgroundColor: sInfo.bgLight, padding: '2px 8px', borderRadius: '6px', border: `1px solid ${sInfo.border}`, fontSize: '0.76rem' }}>
                      {sInfo.label}
                    </span>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                {(() => {
                  const vRoom = rooms.find(r => r.id === viewedEvent.room_id);
                  const usesPin = roomUsesDoorPin(vRoom || viewedEvent.room_id);
                  const pinInfo = usesPin ? resolveRoomPinInfo({ ...viewedEvent, items: [viewedEvent] }, viewedEvent.room_id, vRoom) : { pin: '', pinType: 'none' };
                  const pin = pinInfo.pin;
                  const isInternal = pinInfo.pinType === 'internal' || isInternalBooking(viewedEvent);
                  const pinDetailLabel = isInternal ? 'รหัสผ่านห้อง (ภายใน):' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป):';
                  const vKey = `viewed-${viewedEvent.booking_id || viewedEvent.id}-${viewedEvent.room_id}`;
                  const isRevealed = !!revealedAgendaPins[vKey];

                  return (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>{pinDetailLabel}</span>
                      {!usesPin ? (
                        <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>ไม่มีรหัสเข้าห้อง</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => toggleAgendaPinReveal(vKey)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: 'var(--primary-color)' }}
                            aria-label={isRevealed ? "ซ่อนรหัสผ่านห้อง" : "ดูรหัสผ่านห้อง"}
                            title={isRevealed ? "ซ่อนรหัสผ่านห้อง" : "ดูรหัสผ่านห้อง"}
                          >
                            {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                            <span>{isRevealed ? 'ซ่อนรหัสผ่านห้อง' : 'ดูรหัสผ่านห้อง'}</span>
                          </button>
                          {isRevealed && (
                            pin ? (
                              <>
                                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.88rem', color: 'var(--primary-color)' }}>
                                  {pin}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyPin(pin, vKey)}
                                  aria-label="คัดลอก"
                                  title="คัดลอก"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.68rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(37, 99, 235, 0.3)', backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--primary-color)', cursor: 'pointer' }}
                                >
                                  {copiedPinKey === vKey ? <Check size={11} /> : <Copy size={11} />}
                                  <span>{copiedPinKey === vKey ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                                </button>
                              </>
                            ) : (
                              <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                ไม่มีรหัสเข้าห้อง
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>สถานะการใช้งาน:</span>
                {(() => {
                  const currentNowTime = new Date();
                  const s = new Date(viewedEvent.start_time);
                  const e = new Date(viewedEvent.end_time);
                  if (currentNowTime > e) return <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>ใช้งานเสร็จสิ้นแล้ว</span>;
                  if (currentNowTime >= s && currentNowTime <= e) return <span style={{ color: '#ea580c', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ea580c' }} />กำลังใช้งานขณะนี้</span>;
                  return <span style={{ color: 'var(--primary-color)', fontWeight: 600 }}>รอเริ่มการใช้งาน</span>;
                })()}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1, height: '42px', borderRadius: '12px', fontWeight: 700, fontSize: '0.84rem' }}
                onClick={() => setViewedEvent(null)}
              >
                ปิดหน้าต่าง
              </button>

              {onNavigate && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1.5, height: '42px', borderRadius: '12px', fontWeight: 800, fontSize: '0.84rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  onClick={() => {
                    const bId = viewedEvent.booking_id || viewedEvent.id;
                    setViewedEvent(null);
                    onNavigate('pending', { bookingId: bId, action: 'view' });
                  }}
                >
                  <ExternalLink size={15} />
                  <span>เปิดในจัดการการจอง</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Floating Hover Tooltip / Popover for Matrix Timeline Booking Blocks */}
      {hoveredBooking && (
        <div
          style={{
            position: 'fixed',
            top: hoveredBooking.rect.top < 150 ? (hoveredBooking.rect.bottom + 8) : (hoveredBooking.rect.top - 8),
            left: Math.max(140, Math.min(window.innerWidth - 140, hoveredBooking.rect.left + hoveredBooking.rect.width / 2)),
            transform: hoveredBooking.rect.top < 150 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            backgroundColor: 'var(--bg-card-solid, #ffffff)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            borderRadius: '10px',
            padding: '10px 14px',
            zIndex: 1000,
            pointerEvents: 'none',
            width: '260px',
            fontSize: '0.75rem',
            color: 'var(--text-main)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          {/* Header: Customer & Reference */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-main)' }}>
                {hoveredBooking.event.customer_name || 'ลูกค้า'}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                {hoveredBooking.roomName} · Ref: {hoveredBooking.event.booking_ref || hoveredBooking.event.booking_id || `#${hoveredBooking.event.id}`}
              </div>
            </div>
            {(() => {
              const sInfo = getUnifiedPaymentStatus(hoveredBooking.event);
              return (
                <span style={{
                  fontSize: '0.64rem',
                  fontWeight: 700,
                  color: sInfo.color,
                  backgroundColor: sInfo.bgLight,
                  border: `1px solid ${sInfo.border}`,
                  padding: '2px 6px',
                  borderRadius: '5px'
                }}>
                  {sInfo.label}
                </span>
              );
            })()}
          </div>

          {/* Time & Duration */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
            <Clock size={12} />
            <span>
              {new Date(hoveredBooking.event.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(hoveredBooking.event.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
            </span>
            {hoveredBooking.event.guest_count ? (
              <>
                <span>·</span>
                <span>{hoveredBooking.event.guest_count} ท่าน</span>
              </>
            ) : null}
          </div>

          {/* Operational State Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '5px', fontSize: '0.68rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>สถานะการใช้งาน:</span>
            {(() => {
              const s = new Date(hoveredBooking.event.start_time);
              const e = new Date(hoveredBooking.event.end_time);
              const now = new Date();
              if (now > e) {
                return <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>ใช้งานเสร็จสิ้นแล้ว</span>;
              }
              if (now >= s && now <= e) {
                return <span style={{ color: '#ea580c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ea580c' }} />กำลังใช้งานขณะนี้</span>;
              }
              return <span style={{ color: 'var(--primary-color)', fontWeight: 600 }}>รอเริ่มการใช้งาน</span>;
            })()}
          </div>
        </div>
      )}

      {/* Floating Room Access PIN Popover Portal for Calendar & Floor Plan (BWORK-CALENDAR-PIN-V1) */}
      {activePinPopover && (
        <div
          className="room-pin-popover-portal"
          onMouseEnter={() => {
            if (pinPopoverTimeoutRef.current) {
              clearTimeout(pinPopoverTimeoutRef.current);
              pinPopoverTimeoutRef.current = null;
            }
          }}
          onMouseLeave={handleLeavePinPopover}
          style={{
            position: 'fixed',
            top: (() => {
              const spaceBelow = window.innerHeight - activePinPopover.rect.bottom;
              if (spaceBelow < 180 && activePinPopover.rect.top > 180) {
                return activePinPopover.rect.top - 8;
              }
              return activePinPopover.rect.bottom + 8;
            })(),
            left: Math.max(12, Math.min(window.innerWidth - 250, activePinPopover.rect.left)),
            transform: (() => {
              const spaceBelow = window.innerHeight - activePinPopover.rect.bottom;
              if (spaceBelow < 180 && activePinPopover.rect.top > 180) {
                return 'translateY(-100%)';
              }
              return 'none';
            })(),
            zIndex: 1060,
            backgroundColor: 'var(--bg-card-solid, #ffffff)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            borderRadius: '10px',
            padding: '10px 14px',
            minWidth: '220px',
            maxWidth: '300px',
            fontSize: '0.75rem',
            color: 'var(--text-main)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 800, fontSize: '0.78rem' }}>
              <Key size={13} style={{ color: 'var(--primary-color)' }} />
              <span>{activePinPopover.isInternal ? 'รหัสผ่านห้อง (ภายใน)' : 'รหัสผ่านห้อง (ลูกค้าทั่วไป)'}</span>
            </div>
            <button
              type="button"
              onClick={() => setActivePinPopover(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
              aria-label="ปิด"
            >
              <X size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {activePinPopover.rooms.map((rm, idx) => (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '4px 0', borderBottom: idx < activePinPopover.rooms.length - 1 ? '1px dashed var(--border-color)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.74rem', color: 'var(--text-main)' }}>
                    {rm.roomName}
                  </span>
                  {rm.hasDoorPin && rm.pin && (
                    <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {rm.pinType === 'internal' ? '(ภายใน)' : '(ลูกค้าทั่วไป)'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  {rm.hasDoorPin && rm.pin ? (
                    <>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.86rem', color: 'var(--primary-color)', letterSpacing: '0.8px' }}>
                        {rm.pin}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopyPin(rm.pin, `${activePinPopover.key}_${rm.roomId}`)}
                        aria-label="คัดลอก"
                        title="คัดลอก"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: '5px',
                          border: '1px solid rgba(37, 99, 235, 0.3)',
                          backgroundColor: 'rgba(37, 99, 235, 0.08)',
                          color: 'var(--primary-color)',
                          cursor: 'pointer'
                        }}
                      >
                        {copiedPinKey === `${activePinPopover.key}_${rm.roomId}` ? <Check size={11} /> : <Copy size={11} />}
                        <span>{copiedPinKey === `${activePinPopover.key}_${rm.roomId}` ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      ไม่มีรหัสเข้าห้อง
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Basecamp Quota Hub Modal */}
      <BasecampQuotaModal isOpen={showBasecampQuotaModal} onClose={() => setShowBasecampQuotaModal(false)} />

    </div>
  );
}

export default BookingPOS;
