import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Minus, Trash2, Calendar, ShoppingCart, Printer, X, CreditCard, 
  User, Users, Building, Phone, FileText, Check, ChevronLeft, ChevronRight, 
  Clock, Search, ChevronUp, ChevronDown, Image, CheckCircle2, Key, Send, 
  AlertTriangle, LayoutGrid, Columns, Sparkles, Layers, Presentation, Laptop, Coffee, Car, BookmarkPlus, Zap,
  Banknote, Smartphone
} from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';

const TIMELINE_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const TIMELINE_START = 8;
const TIMELINE_END = 18;
const TIMELINE_TOTAL_HOURS = 10;

const TIME_OPTIONS_POS = [];
for (let h = 8; h <= 20; h++) {
  const hh = String(h).padStart(2, '0');
  TIME_OPTIONS_POS.push(`${hh}:00`);
  if (h < 20) {
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

function BookingPOS({ user, settings, sysAlert, preselectedRoom, clearPreselectedRoom, onNavigate, onExportToQuotation, showCartSidebar, setShowCartSidebar, onCartCountChange }) {
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // View Modes: 'matrix' (Unified Timeline Matrix & Rich Room Cards) | 'calendar' (Monthly Calendar Overview)
  const [mainViewMode, setMainViewMode] = useState('matrix');
  const [timelineCategory, setTimelineCategory] = useState('all');
  const [timelineDate, setTimelineDate] = useState(formatDateToYYYYMMDD(new Date()));

  // Customer details
  const [customer, setCustomer] = useState({
    name: '',
    department: '',
    contact: ''
  });

  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [paymentMethod, setPaymentMethod] = useState('cash');

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

  // =========================================================
  // FILTERED ROOMS & EVENTS
  // =========================================================
  const filteredTimelineRooms = useMemo(() => {
    return rooms.filter(r => {
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
    return eventsByDay[dateKey] || [];
  }, [sidebarSelectedDay, eventsByDay]);

  // Timeline events for specific room on timelineDate
  const getTimelineRoomEvents = (roomId) => {
    return calendarEvents.filter(ev => {
      if (ev.room_id !== roomId) return false;
      if (ev.status === 'cancelled') return false;
      const dStr = getLocalDateStr(ev.start_time);
      return dStr === timelineDate;
    }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  };

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
  const openDrawerForSlot = (room, hour = 9) => {
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
    const endMins = startH * 60 + startM + 60;
    const endH = Math.floor(endMins / 60);
    const endM = endMins % 60;

    setRoomSchedule({
      date: timelineDate,
      startHour: String(startH).padStart(2, '0'),
      startMinute: String(startM).padStart(2, '0'),
      endHour: String(endH).padStart(2, '0'),
      endMinute: String(endM).padStart(2, '0'),
      guestCount: ''
    });
    setPaymentStatus('paid');
    setPaymentMethod('cash');
  };

  const closeRoomModal = () => {
    setSelectedRoom(null);
  };

  // Quick Duration Setter inside Drawer (+1 ชม., +2 ชม., +3 ชม., +4 ชม.)
  const setQuickDuration = (hoursCount) => {
    setBookingType('hourly');
    const sh = parseInt(roomSchedule.startHour, 10) || 9;
    const sm = parseInt(roomSchedule.startMinute, 10) || 0;
    let endMins = sh * 60 + sm + hoursCount * 60;
    if (endMins > 20 * 60) endMins = 20 * 60;
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

  // ⚡ Quick Direct Booking (Checkout directly from Drawer without Cart)
  const quickDirectBooking = async () => {
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
    const singleItem = buildCartItem();
    if (!singleItem) return;

    try {
      const payload = {
        customer_name: customer.name,
        customer_department: customer.department || '',
        customer_contact: customer.contact || '',
        payment_status: paymentStatus,
        payment_method: paymentStatus === 'paid' ? paymentMethod : '',
        total_amount: singleItem.subtotal,
        guest_count: singleItem.guest_count || null,
        items: [singleItem]
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
        setCustomer({ name: '', department: '', contact: '' });
        fetchCalendarEvents();
      } else {
        const errData = await res.json();
        sysAlert(`เกิดข้อผิดพลาด: ${errData.error || 'ไม่สามารถบันทึกการจองได้'}`);
      }
    } catch (err) {
      console.error('Direct booking failed:', err);
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
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
    if (cart.length === 0) {
      sysAlert('กรุณาเพิ่มรายการห้องหรือบริการลงในตะกร้าก่อนทำรายการ');
      return;
    }
    if (!customer.name.trim()) {
      sysAlert('กรุณาระบุชื่อผู้จอง');
      return;
    }
    if (!paymentStatus) {
      sysAlert('กรุณาเลือกสถานะการชำระเงิน');
      return;
    }
    if (paymentStatus === 'paid' && !paymentMethod) {
      sysAlert('กรุณาเลือกช่องทางการชำระเงิน');
      return;
    }

    try {
      const payload = {
        customer_name: customer.name,
        customer_department: customer.department || '',
        customer_contact: customer.contact || '',
        payment_status: paymentStatus,
        payment_method: paymentStatus === 'paid' ? paymentMethod : '',
        total_amount: totalAmount,
        guest_count: cart.find(c => c.guest_count)?.guest_count || null,
        items: cart
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
        setCustomer({ name: '', department: '', contact: '' });
        fetchCalendarEvents();
      } else {
        const errData = await res.json();
        sysAlert(`เกิดข้อผิดพลาด: ${errData.error || 'ไม่สามารถบันทึกการจองได้'}`);
      }
    } catch (err) {
      console.error('Checkout failed:', err);
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
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
    if (printBooking) {
      if (printBooking.payment_status === 'paid' && onNavigate) {
        onNavigate('history');
      } else if (printBooking.payment_status === 'pending' && onNavigate) {
        onNavigate('pending');
      }
    }
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
      
      {/* 1. TOP CONTROL BAR (2-TIER CLEAN DESIGN) */}
      <div style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '18px',
        padding: '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxShadow: 'var(--glass-shadow)',
        flexShrink: 0
      }}>
        
        {/* ROW 1: Date Navigation & View Mode Switcher */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          
          {/* Left: Date Navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-color)', borderRadius: '12px', padding: '2px', border: '1px solid var(--border-color)' }}>
              <button 
                type="button" 
                onClick={handlePrevTimelineDay}
                style={{ background: 'transparent', border: 'none', padding: '6px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: '8px' }}
                title="วันก่อนหน้า"
              >
                <ChevronLeft size={16} />
              </button>
              <button 
                type="button" 
                onClick={handleTodayTimeline}
                style={{ background: 'transparent', border: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary-color)' }}
              >
                วันนี้
              </button>
              <button 
                type="button" 
                onClick={handleNextTimelineDay}
                style={{ background: 'transparent', border: 'none', padding: '6px 8px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', borderRadius: '8px' }}
                title="วันถัดไป"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Thai Date Badge & Integrated Calendar Picker Popover */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.2px' }}>
                {getThaiDateFull(timelineDate)}
              </span>
              <CustomDatePicker
                value={timelineDate}
                onChange={val => setTimelineDate(val)}
                className="form-control"
                style={{ 
                  height: '32px', 
                  fontSize: '0.78rem', 
                  padding: '0 10px', 
                  borderRadius: '10px', 
                  cursor: 'pointer',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center'
                }}
              />
            </div>
          </div>

          {/* Right: View Mode Switcher Tabs & Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            
            {/* Search Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0 10px', height: '36px' }}>
              <Search size={14} style={{ color: 'var(--text-muted)' }} />
              <input 
                type="text" 
                placeholder="ค้นหาห้อง..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.8rem', color: 'var(--text-main)', width: '110px' }}
              />
            </div>

            {/* 2 Unified View Mode Tabs */}
            <div style={{ display: 'flex', gap: '2px', backgroundColor: 'var(--bg-color)', padding: '3px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <button
                type="button"
                onClick={() => setMainViewMode('matrix')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '9px',
                  fontSize: '0.8rem',
                  fontWeight: mainViewMode === 'matrix' ? 800 : 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: mainViewMode === 'matrix' ? 'var(--primary-color)' : 'transparent',
                  color: mainViewMode === 'matrix' ? '#ffffff' : 'var(--text-muted)',
                  boxShadow: mainViewMode === 'matrix' ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
                  transition: 'all 0.15s ease'
                }}
                title="ตารางผังเวลาและการ์ดห้อง (Timeline Matrix & Cards)"
              >
                <LayoutGrid size={15} />
                <span>ผังจองห้องประจำวัน (Matrix & Cards)</span>
              </button>

              <button
                type="button"
                onClick={() => setMainViewMode('calendar')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '9px',
                  fontSize: '0.8rem',
                  fontWeight: mainViewMode === 'calendar' ? 800 : 600,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: mainViewMode === 'calendar' ? 'var(--primary-color)' : 'transparent',
                  color: mainViewMode === 'calendar' ? '#ffffff' : 'var(--text-muted)',
                  boxShadow: mainViewMode === 'calendar' ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
                  transition: 'all 0.15s ease'
                }}
                title="ปฏิทินรายเดือน (Monthly Calendar)"
              >
                <Calendar size={15} />
                <span>ปฏิทินเดือน</span>
              </button>
            </div>

          </div>
        </div>

        {/* ROW 2: Category Filter Pills & Color Status Legend */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '8px', flexWrap: 'wrap', gap: '10px' }}>
          
          {/* Category Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto' }}>
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
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 12px',
                    borderRadius: '8px',
                    fontSize: '0.76rem',
                    fontWeight: isSel ? 700 : 500,
                    cursor: 'pointer',
                    border: isSel ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                    backgroundColor: isSel ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-color)',
                    color: isSel ? 'var(--primary-color)' : 'var(--text-muted)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Icon size={12} />
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>

          {/* Status Legend Badges (Requested Color Specification) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 5px rgba(16, 185, 129, 0.5)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>รอใช้งาน</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#f97316', boxShadow: '0 0 6px rgba(249, 115, 22, 0.6)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>กำลังใช้งาน</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#ef4444', boxShadow: '0 0 5px rgba(239, 68, 68, 0.5)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>ใช้งานเสร็จแล้ว</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '9px', height: '9px', borderRadius: '2px', backgroundColor: 'rgba(245, 158, 11, 0.4)', border: '1px dashed #f59e0b' }} />
              <span style={{ color: 'var(--text-muted)' }}>ทำความสะอาด (30m)</span>
            </span>
          </div>

        </div>

      </div>

      {/* 2. MAIN WORKSPACE CONTENT */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showCartSidebar ? '1fr 340px' : '1fr',
        gap: '10px',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        transition: 'grid-template-columns 0.3s ease'
      }}>
        
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
                <div style={{ minWidth: '980px' }}>
                  
                  {/* Timeline Header Row (08:00 - 18:00) */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '290px repeat(10, 1fr)',
                    borderBottom: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    color: 'var(--text-muted)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                  }}>
                    <div style={{ padding: '10px 14px', borderRight: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>🗂️ การ์ดห้อง / รายละเอียด</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--primary-color)' }}>{filteredTimelineRooms.length} ห้อง</span>
                    </div>
                    {TIMELINE_HOURS.map(h => (
                      <div key={h} style={{ padding: '10px 2px', textAlign: 'center', borderRight: '1px solid var(--border-color)', fontFamily: 'monospace' }}>
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
                        
                        // Real-time live status for this room today
                        const currentNow = new Date();
                        const activeEvent = dayEvents.find(ev => currentNow >= new Date(ev.start_time) && currentNow <= new Date(ev.end_time));
                        const upcomingEvents = dayEvents.filter(ev => currentNow < new Date(ev.start_time));
                        const allExpired = dayEvents.length > 0 && dayEvents.every(ev => currentNow > new Date(ev.end_time));

                        let liveStatusBadge = null;
                        if (activeEvent) {
                          const endTStr = new Date(activeEvent.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#ea580c', backgroundColor: 'rgba(249, 115, 22, 0.14)', padding: '1px 6px', borderRadius: '6px', border: '1px solid rgba(249, 115, 22, 0.35)' }}>
                              🟠 กำลังใช้งาน (ถึง {endTStr} น.)
                            </span>
                          );
                        } else if (allExpired) {
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#dc2626', backgroundColor: 'rgba(239, 68, 68, 0.12)', padding: '1px 6px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                              🔴 ใช้งานเสร็จแล้วทุกคิว
                            </span>
                          );
                        } else if (upcomingEvents.length > 0) {
                          const nextTStr = new Date(upcomingEvents[0].start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#059669', backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '1px 6px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              🟢 ว่าง (มีคิวถัดไป {nextTStr} น.)
                            </span>
                          );
                        } else {
                          liveStatusBadge = (
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#059669', backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '1px 6px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                              🟢 ว่างตลอดวัน
                            </span>
                          );
                        }

                        return (
                          <div 
                            key={room.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '290px repeat(10, 1fr)',
                              borderBottom: '1px solid var(--border-color)',
                              minHeight: '74px',
                              alignItems: 'stretch',
                              position: 'relative'
                            }}
                          >
                            {/* Rich Room Card Cell (Left Column) */}
                            <div 
                              onClick={() => openDrawerForSlot(room, 9)}
                              style={{
                                padding: '8px 12px',
                                borderRight: '1px solid var(--border-color)',
                                backgroundColor: 'var(--bg-card)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease'
                              }}
                              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.04)'}
                              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--bg-card)'}
                              title="คลิกเพื่อเปิดฟอร์มจองห้องนี้"
                            >
                              {room.image_url ? (
                                <img src={room.image_url} alt={room.name} style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border-color)' }} />
                              ) : (
                                <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <Building size={22} />
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

                                <div style={{ marginTop: '1px' }}>
                                  {liveStatusBadge}
                                </div>
                              </div>
                            </div>

                            {/* 10 Hourly Cells Container (Right Gantt Area) */}
                            <div style={{ gridColumn: 'span 10', position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', backgroundColor: 'var(--bg-card)' }}>
                              
                              {/* Real-time Red "NOW" Line indicator */}
                              {showNowLine && (
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  left: `${nowLineLeftPercent}%`,
                                  width: '2px',
                                  backgroundColor: '#ef4444',
                                  zIndex: 8,
                                  pointerEvents: 'none',
                                  boxShadow: '0 0 8px rgba(239, 68, 68, 0.8)'
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

                                const bufferLeft = ((eHour - TIMELINE_START) / TIMELINE_TOTAL_HOURS) * 100;
                                const bufferWidth = (0.5 / TIMELINE_TOTAL_HOURS) * 100;

                                const sT = s.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                                const eT = e.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

                                // Color coding: Red = Expired, Orange = Active, Green = Upcoming
                                const pillBg = isExpired ? '#ef4444' : (isActive ? '#f97316' : '#10b981');
                                const pillShadow = isActive ? '0 0 12px rgba(249, 115, 22, 0.6)' : '0 2px 8px rgba(0,0,0,0.18)';
                                const statusLabel = isExpired ? 'ใช้งานเสร็จแล้ว' : (isActive ? 'กำลังใช้งาน' : 'รอใช้งาน');

                                return (
                                  <React.Fragment key={evIdx}>
                                    {/* Booking Pill */}
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setViewedEvent(ev);
                                      }}
                                      style={{
                                        position: 'absolute',
                                        top: '6px',
                                        bottom: '6px',
                                        left: `${leftPercent}%`,
                                        width: `calc(${widthPercent}% - 3px)`,
                                        backgroundColor: pillBg,
                                        color: '#ffffff',
                                        borderRadius: '10px',
                                        padding: '4px 8px',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'center',
                                        boxShadow: pillShadow,
                                        cursor: 'pointer',
                                        zIndex: 5,
                                        overflow: 'hidden',
                                        transition: 'transform 0.15s ease'
                                      }}
                                      title={`${ev.customer_name} (${sT} - ${eT} น.) - ${isExpired ? 'ใช้งานเสร็จแล้ว' : isActive ? 'กำลังใช้งาน' : 'รอใช้งาน'}`}
                                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.customer_name} {ev.guest_count ? `(${ev.guest_count} ท่าน)` : ''}</span>
                                        <span style={{ fontSize: '0.62rem', opacity: 0.95, backgroundColor: 'rgba(0,0,0,0.22)', padding: '1px 5px', borderRadius: '4px' }}>{statusLabel}</span>
                                      </div>
                                      <div style={{ fontSize: '0.65rem', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <Clock size={10} />
                                        <span>{sT} - {eT} น.</span>
                                      </div>
                                    </div>

                                    {/* 30-min Buffer Strip */}
                                    {bufferLeft < 100 && (
                                      <div
                                        className="timeline-buffer-stripe"
                                        style={{
                                          position: 'absolute',
                                          top: '8px',
                                          bottom: '8px',
                                          left: `${bufferLeft}%`,
                                          width: `${Math.min(bufferWidth, 100 - bufferLeft)}%`,
                                          borderRadius: '6px',
                                          zIndex: 4,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          pointerEvents: 'none'
                                        }}
                                        title="ระยะเวลาพักทำความสะอาด 30 นาที"
                                      >
                                        <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#d97706', opacity: 0.9 }}>🧹 30m</span>
                                      </div>
                                    )}
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
          {/* VIEW 2: MONTHLY CALENDAR (REDESIGNED COMPACT LAYOUT)    */}
          {/* ======================================================= */}
          {mainViewMode === 'calendar' && (
            <div className="pos-layout" style={{ 
              display: 'grid', 
              gridTemplateColumns: '240px 1fr', 
              gap: '10px', 
              height: '100%',
              minHeight: 0,
              overflow: 'hidden'
            }}>
              {/* Left Sidebar: Compact Mini-Calendar + Selected Day Agenda */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid var(--border-color)',
                paddingRight: '10px',
                height: '100%',
                minHeight: 0,
                overflowY: 'auto',
                gap: '10px'
              }}>
                {/* 1. Mini-Calendar Block */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '12px 10px',
                  boxShadow: 'var(--glass-shadow)',
                  flexShrink: 0
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {calendarYear} {monthNamesEng[calendarMonth]}
                    </span>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <button 
                        onClick={() => {
                          if (calendarMonth === 0) { setCalendarMonth(11); setCalendarYear(calendarYear - 1); }
                          else { setCalendarMonth(calendarMonth - 1); }
                        }}
                        type="button"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                        title="เดือนก่อนหน้า"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button 
                        onClick={() => {
                          if (calendarMonth === 11) { setCalendarMonth(0); setCalendarYear(calendarYear + 1); }
                          else { setCalendarMonth(calendarMonth + 1); }
                        }}
                        type="button"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                        title="เดือนถัดไป"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((dayChar, i) => (
                      <div key={i} style={{ fontSize: '0.68rem', fontWeight: 800, color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : 'var(--text-muted)' }}>
                        {dayChar}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                    {calendarDays.map((dayObj, i) => {
                      const dateKey = getDateKey(dayObj.day, dayObj.month, dayObj.year);
                      const dayEvents = filteredEventsByDay[dateKey] || [];
                      const isSelected = (sidebarSelectedDay && sidebarSelectedDay.day === dayObj.day && sidebarSelectedDay.month === dayObj.month && sidebarSelectedDay.year === dayObj.year) || (timelineDate === dateKey);
                      
                      return (
                        <div 
                          key={i}
                          onClick={() => {
                            setSidebarSelectedDay(dayObj);
                            setSelectedDay(dayObj);
                            setTimelineDate(dateKey);
                          }}
                          className={`mini-calendar-cell${isSelected ? ' selected' : ''}`}
                          style={{
                            color: isSelected ? '#ffffff' : (dayObj.isOtherMonth ? 'var(--text-muted)' : 'var(--text-main)'),
                            opacity: dayObj.isOtherMonth ? 0.35 : 1,
                            cursor: 'pointer',
                            fontWeight: isSelected ? 800 : 500,
                            position: 'relative'
                          }}
                        >
                          {dayObj.day}
                          {dayEvents.length > 0 && (
                            <div style={{ position: 'absolute', bottom: '2px', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: isSelected ? '#ffffff' : 'var(--primary-color)' }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Selected Day Agenda / Booking History (Compact & Full) */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '12px 10px',
                  boxShadow: 'var(--glass-shadow)',
                  minHeight: 0
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      รายการจองประจำวัน
                    </span>
                    <span style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      backgroundColor: 'rgba(37, 99, 235, 0.12)',
                      color: 'var(--primary-color)',
                      padding: '2px 8px',
                      borderRadius: '6px'
                    }}>
                      {selectedDayBookings.length} คิว
                    </span>
                  </div>

                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
                    {sidebarSelectedDay ? `${sidebarSelectedDay.day} ${monthNames[sidebarSelectedDay.month]} ${sidebarSelectedDay.year + 543}` : ''}
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 }} className="scrollbar-thin">
                    {selectedDayBookings.length === 0 ? (
                      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.74rem', padding: '24px 0', fontStyle: 'italic' }}>
                        ไม่มีรายการจองห้องในวันนี้
                      </div>
                    ) : (
                      selectedDayBookings.map((ev, i) => {
                        const currentNowTime = new Date();
                        const startTime = new Date(ev.start_time);
                        const endTime = new Date(ev.end_time);
                        const isExpired = currentNowTime > endTime;
                        const isActive = currentNowTime >= startTime && currentNowTime <= endTime;
                        const sT = startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                        const eT = endTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

                        const statusBg = isExpired ? 'rgba(239, 68, 68, 0.12)' : (isActive ? 'rgba(249, 115, 22, 0.14)' : 'rgba(16, 185, 129, 0.12)');
                        const statusBorder = isExpired ? 'rgba(239, 68, 68, 0.3)' : (isActive ? 'rgba(249, 115, 22, 0.4)' : 'rgba(16, 185, 129, 0.3)');
                        const statusText = isExpired ? '🔴 ใช้งานเสร็จแล้ว' : (isActive ? '🟠 กำลังใช้งาน' : '🟢 รอใช้งาน');
                        const statusColor = isExpired ? '#ef4444' : (isActive ? '#ea580c' : '#059669');

                        return (
                          <div
                            key={i}
                            onClick={() => setViewedEvent(ev)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: '10px',
                              backgroundColor: 'var(--bg-color)',
                              border: `1px solid ${statusBorder}`,
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              transition: 'transform 0.15s ease'
                            }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>{ev.room_name}</strong>
                              <span style={{ fontSize: '0.62rem', fontWeight: 800, color: statusColor, backgroundColor: statusBg, padding: '1px 5px', borderRadius: '4px' }}>
                                {statusText}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--primary-color)', fontWeight: 700 }}>
                              {sT} - {eT} น.
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              ผู้จอง: {ev.customer_name} {ev.guest_count ? `(${ev.guest_count} คน)` : ''}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Big Monthly Calendar Grid (Synchronized Blue Highlight & Detailed Event Chips) */}
              <div className="calendar-container" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Main Month Navigation Toolbar */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  flexShrink: 0
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-main)' }}>
                      {monthNames[calendarMonth]} {calendarYear + 543}
                    </h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      ({monthNamesEng[calendarMonth]} {calendarYear})
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (calendarMonth === 0) {
                          setCalendarMonth(11);
                          setCalendarYear(calendarYear - 1);
                        } else {
                          setCalendarMonth(calendarMonth - 1);
                        }
                      }}
                      className="btn-secondary"
                      style={{ height: '32px', padding: '0 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="เดือนก่อนหน้า"
                    >
                      <ChevronLeft size={15} />
                      <span>เดือนก่อนหน้า</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        setCalendarMonth(now.getMonth());
                        setCalendarYear(now.getFullYear());
                        const todayStr = formatDateToYYYYMMDD(now);
                        setTimelineDate(todayStr);
                        setSelectedDay({ day: now.getDate(), month: now.getMonth(), year: now.getFullYear(), isOtherMonth: false });
                        setSidebarSelectedDay({ day: now.getDate(), month: now.getMonth(), year: now.getFullYear(), isOtherMonth: false });
                      }}
                      className="btn-secondary"
                      style={{ height: '32px', padding: '0 10px', fontSize: '0.78rem', fontWeight: 700 }}
                      title="กลับมาเดือนปัจจุบัน"
                    >
                      เดือนปัจจุบัน
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (calendarMonth === 11) {
                          setCalendarMonth(0);
                          setCalendarYear(calendarYear + 1);
                        } else {
                          setCalendarMonth(calendarMonth + 1);
                        }
                      }}
                      className="btn-secondary"
                      style={{ height: '32px', padding: '0 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="เดือนถัดไป"
                    >
                      <span>เดือนถัดไป</span>
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>

                <div className="calendar-grid-wrapper" style={{ flex: 1, minHeight: 0 }}>
                  <div className="calendar-weekday-row">
                    {weekdays.map(wd => (
                      <div key={wd} className="calendar-weekday-cell">{wd}</div>
                    ))}
                  </div>

                  <div className="calendar-body">
                    {calendarDays.map((dayObj, idx) => {
                      const dateKey = getDateKey(dayObj.day, dayObj.month, dayObj.year);
                      const dayEvents = filteredEventsByDay[dateKey] || [];
                      const isSelected = (sidebarSelectedDay && sidebarSelectedDay.day === dayObj.day && sidebarSelectedDay.month === dayObj.month && sidebarSelectedDay.year === dayObj.year) || (timelineDate === dateKey);

                      return (
                        <div 
                          key={idx} 
                          className={`calendar-cell ${dayObj.isOtherMonth ? 'other-month' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedDay(dayObj);
                            setSidebarSelectedDay(dayObj);
                            setTimelineDate(dateKey);
                          }}
                          style={{
                            cursor: 'pointer',
                            border: isSelected ? '2px solid var(--primary-color)' : undefined,
                            boxShadow: isSelected ? '0 0 12px rgba(37, 99, 235, 0.35)' : undefined,
                            backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.05)' : undefined,
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div className="calendar-day-header">
                            <div className="calendar-day-number" style={{ fontWeight: isSelected ? 900 : 700 }}>
                              {dayObj.day}
                            </div>
                            {dayEvents.length > 0 && (
                              <span className="calendar-day-count-badge">{dayEvents.length} รายการ</span>
                            )}
                          </div>
                          
                          {/* Event Chips List (Showing Room Name + Usage Time + Status Color) */}
                          <div className="calendar-events-list">
                            {dayEvents.slice(0, 3).map((ev, i) => {
                              const currentNowTime = new Date();
                              const startTime = new Date(ev.start_time);
                              const endTime = new Date(ev.end_time);
                              const isExpired = currentNowTime > endTime;
                              const isActive = currentNowTime >= startTime && currentNowTime <= endTime;
                              const isUpcoming = currentNowTime < startTime;

                              const sT = startTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                              const eT = endTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                              const statusClass = isExpired ? 'expired' : (isActive ? 'active' : 'upcoming');
                              const badgeLabel = isExpired ? '🔴 ใช้งานเสร็จแล้ว' : (isActive ? '🟠 กำลังใช้งาน' : '🟢 รอใช้งาน');

                              return (
                                <div 
                                  key={i} 
                                  className={`calendar-event-chip ${statusClass}`} 
                                  onClick={(e) => { e.stopPropagation(); setViewedEvent(ev); }}
                                  title={`${ev.room_name} | ${sT} - ${eT} น. | ผู้จอง: ${ev.customer_name || 'ลูกค้า'} (${isExpired ? 'ใช้งานเสร็จแล้ว' : isActive ? 'กำลังใช้งาน' : 'รอใช้งาน'})`}
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '3px', padding: '1px 5px' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
                                    <span className="event-chip-room" style={{ fontWeight: 800, fontSize: '0.73rem' }}>{ev.room_name}</span>
                                    <span className="event-chip-time" style={{ fontWeight: 700, fontSize: '0.65rem' }}>{sT}-{eT}</span>
                                  </div>
                                  <span style={{ fontSize: '0.6rem', fontWeight: 800, flexShrink: 0, opacity: 0.9 }}>
                                    {badgeLabel}
                                  </span>
                                </div>
                              );
                            })}

                            {dayEvents.length > 3 && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--primary-color)', fontWeight: 700, textAlign: 'center', marginTop: '1px' }}>
                                +{dayEvents.length - 3} ดูเพิ่มเติม...
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* 3. CART SIDEBAR (WHEN OPEN) */}
        {showCartSidebar && (
          <div style={{
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
          }}>
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

            {/* Cart Footer: Total & Checkout */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรวมสุทธิ:</span>
                <strong style={{ fontSize: '1.25rem', color: 'var(--text-main)', fontWeight: 900 }}>฿{Number(totalAmount).toLocaleString()}</strong>
              </div>

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
                  disabled={cart.length === 0}
                  className="btn btn-primary"
                  style={{ flex: 2, borderRadius: '12px', fontSize: '0.82rem', fontWeight: 800, padding: '10px' }}
                >
                  ชำระเงิน / ยืนยันการจอง
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ========================================================= */}
      {/* 4. SEAMLESS SLIDE-OVER BOOKING DRAWER (POLISHED REDESIGN)  */}
      {/* ========================================================= */}
      {selectedRoom && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 2000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '500px',
            height: '100%',
            backgroundColor: 'var(--bg-card)',
            boxShadow: '-12px 0 45px rgba(0,0,0,0.35)',
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--border-color)',
            animation: 'slideInRight 0.25s ease-out'
          }}>
            
            {/* 1. Drawer Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.02)'
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    <span>{selectedRoom.category || 'ห้องประชุม'}</span>
                    <span>•</span>
                    <span>ความจุ {layoutType === 'classroom' ? (selectedRoom.classroom_capacity || selectedRoom.capacity) : selectedRoom.capacity} ที่นั่ง</span>
                    <span>•</span>
                    <strong style={{ color: 'var(--primary-color)' }}>฿{selectedRoom.hourly_rate}/ชม.</strong>
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

            {/* 2. Drawer Scrollable Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }} className="scrollbar-thin">
              
              {/* Group A: Booking Type & Layout */}
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
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
              </div>

              {/* Group B: Date & Time Configuration */}
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
                            if (newEndMins > 20 * 60) newEndMins = 20 * 60;
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
                          options={TIME_OPTIONS_POS.filter(t => t < '20:00').map(t => ({
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
                            return (eh * 60 + em) > (sh * 60 + sm);
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
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>⚡ ปุ่มลัดขยายเวลา:</span>
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
              </div>

              {/* Group C: Guest Count */}
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
                    placeholder={`ระบุจำนวนผู้เข้าใช้ห้อง...`}
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

              {/* Group D: Live Price & Duration Preview Box */}
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
                    background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%)',
                    border: '1px solid rgba(37, 99, 235, 0.25)',
                    borderRadius: '16px',
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>ระยะเวลาที่เลือกใช้งาน</div>
                      <div style={{ color: 'var(--primary-color)', fontSize: '0.92rem', fontWeight: 800, marginTop: '2px' }}>
                        {durationText}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดรวมเบื้องต้น</div>
                      <div style={{ color: 'var(--text-main)', fontSize: '1.2rem', fontWeight: 900, marginTop: '1px' }}>
                        ฿{Number(estSubtotal).toLocaleString()}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Group E: Customer Information */}
              <div style={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                      ชื่อผู้จอง <span style={{ color: 'var(--danger-color)' }}>*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setCustomer({ ...customer, name: 'ลูกค้า Walk-in' })}
                      style={{
                        fontSize: '0.68rem',
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0 10px', backgroundColor: 'var(--bg-color)', height: '40px' }}>
                    <User size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input 
                      type="text"
                      placeholder="กรอกชื่อผู้จอง / องค์กร"
                      value={customer.name}
                      onChange={e => setCustomer({ ...customer, name: e.target.value })}
                      style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.82rem', color: 'var(--text-main)' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                    เบอร์ติดต่อ
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0 10px', backgroundColor: 'var(--bg-color)', height: '40px' }}>
                    <Phone size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <input 
                      type="text"
                      placeholder="08x-xxx-xxxx"
                      value={customer.contact}
                      onChange={e => setCustomer({ ...customer, contact: e.target.value })}
                      style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.82rem', color: 'var(--text-main)' }}
                    />
                  </div>
                </div>
              </div>

              {/* Group F: Payment Status & Method */}
              <div style={{ display: 'grid', gridTemplateColumns: paymentStatus === 'paid' ? '1fr 1fr' : '1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                    สถานะชำระเงิน *
                  </label>
                  <CustomSelect
                    value={paymentStatus}
                    onChange={val => setPaymentStatus(val)}
                    options={[
                      { value: 'paid', label: 'ชำระเงินแล้ว (Paid)', icon: CheckCircle2, iconColor: '#10b981' },
                      { value: 'pending', label: 'ค้างชำระ (Pending)', icon: Clock, iconColor: '#f59e0b' }
                    ]}
                  />
                </div>

                {paymentStatus === 'paid' && (
                  <div>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '5px', display: 'block' }}>
                      ช่องทางชำระ *
                    </label>
                    <CustomSelect
                      value={paymentMethod}
                      onChange={val => setPaymentMethod(val)}
                      options={[
                        { value: 'cash', label: 'เงินสด (Cash)', icon: Banknote, iconColor: '#10b981' },
                        { value: 'transfer', label: 'โอนเงินเข้าบัญชี (Transfer)', icon: Smartphone, iconColor: '#3b82f6' },
                        { value: 'card', label: 'บัตรเครดิต (Card)', icon: CreditCard, iconColor: '#8b5cf6' }
                      ]}
                      align="right"
                    />
                  </div>
                )}
              </div>

              {/* Group G: Real-time Overlap Alert */}
              {currentSlotOverlap.isOverlap ? (
                currentSlotOverlap.isCleaningBuffer ? (
                  <div style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '14px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px'
                  }}>
                    <Clock size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: '0.78rem' }}>
                      <div style={{ fontWeight: 800, color: '#d97706' }}>🧹 ช่วงเวลานี้ติดทำความสะอาด / เคลียร์ห้อง ({currentSlotOverlap.bufferMinutes || 30} นาที)</div>
                      <div style={{ color: 'var(--text-main)', marginTop: '3px', lineHeight: 1.4 }}>
                        คิวก่อนหน้าใช้งานถึง <strong>{new Date(currentSlotOverlap.booking.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</strong>
                        {currentSlotOverlap.booking.customer_name && ` (คุณ ${currentSlotOverlap.booking.customer_name})`}
                        <br />
                        <span style={{ color: '#b45309', fontWeight: 700 }}>
                          ✨ สามารถจองได้ตั้งแต่เวลา {new Date(new Date(currentSlotOverlap.booking.end_time).getTime() + (currentSlotOverlap.bufferMinutes || 30) * 60000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น. เป็นต้นไป
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: '14px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px'
                  }}>
                    <AlertTriangle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
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
                  padding: '8px 12px',
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
              backgroundColor: 'var(--bg-color)',
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
                className={currentSlotOverlap.isOverlap ? '' : 'btn btn-primary'}
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
                  backgroundColor: currentSlotOverlap.isOverlap ? '#94a3b8' : undefined,
                  color: '#ffffff',
                  opacity: currentSlotOverlap.isOverlap ? 0.75 : 1,
                  cursor: currentSlotOverlap.isOverlap ? 'not-allowed' : 'pointer',
                  boxShadow: currentSlotOverlap.isOverlap ? 'none' : '0 4px 14px rgba(37,99,235,0.3)',
                  border: 'none'
                }} 
                onClick={quickDirectBooking}
                disabled={currentSlotOverlap.isOverlap}
              >
                {currentSlotOverlap.isOverlap ? (
                  currentSlotOverlap.isCleaningBuffer ? <Clock size={16} /> : <AlertTriangle size={16} />
                ) : (
                  <Zap size={16} />
                )}
                <span>
                  {currentSlotOverlap.isOverlap 
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
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{ width: '95%', maxWidth: '480px', backgroundColor: 'var(--bg-card)', borderRadius: '20px', padding: '20px', border: '1px solid var(--border-color)', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
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
        <div style={{
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
        }}>
          <div style={{ maxWidth: '440px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '100%', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Check size={13} /> ชำระเงินสำเร็จ
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={handleDownloadReceiptPDF} className="btn btn-secondary" style={{ height: '34px', padding: '0 12px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 700 }}>
                  <FileText size={14} /> PDF
                </button>
                <button type="button" onClick={() => window.print()} className="btn btn-primary" style={{ height: '34px', padding: '0 14px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 800 }}>
                  <Printer size={14} /> พิมพ์ใบเสร็จ
                </button>
                <button type="button" onClick={handleCloseReceiptModal} style={{ width: '34px', height: '34px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)', cursor: 'pointer' }}>
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
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(16px)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{ width: '95%', maxWidth: '440px', padding: '24px', borderRadius: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
            <button type="button" style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setViewedEvent(null)}>
              <X size={18} />
            </button>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 'bold', color: 'var(--primary-color)', textTransform: 'uppercase' }}>รายละเอียดการจองห้อง</div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: '2px 0 0 0' }}>{viewedEvent.room_name}</h3>
            </div>
            <div style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div><strong>ผู้จอง:</strong> {viewedEvent.customer_name}</div>
              <div><strong>จำนวนผู้เข้าใช้:</strong> {viewedEvent.guest_count || viewedEvent.item_guest_count ? `${viewedEvent.guest_count || viewedEvent.item_guest_count} ท่าน` : 'ไม่ระบุ'}</div>
              <div><strong>ช่วงเวลา:</strong> {new Date(viewedEvent.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(viewedEvent.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>
              <div><strong>รูปแบบ:</strong> {viewedEvent.booking_type === 'daily' ? 'รายวัน (ทั้งวัน)' : viewedEvent.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง'} · {viewedEvent.layout === 'classroom' ? 'Classroom' : 'Standard'}</div>
              <div><strong>สถานะชำระ:</strong> {viewedEvent.payment_status === 'paid' ? '✅ ชำระเงินแล้ว' : '⏳ ค้างชำระ'}</div>
              <div><strong>สถานะการใช้งาน:</strong> {(() => {
                const currentNowTime = new Date();
                const s = new Date(viewedEvent.start_time);
                const e = new Date(viewedEvent.end_time);
                if (currentNowTime > e) return <span style={{ color: '#ef4444', fontWeight: 700 }}>🔴 ใช้งานเสร็จแล้ว</span>;
                if (currentNowTime >= s && currentNowTime <= e) return <span style={{ color: '#ea580c', fontWeight: 800 }}>🟠 กำลังใช้งาน</span>;
                return <span style={{ color: '#10b981', fontWeight: 700 }}>🟢 รอใช้งาน</span>;
              })()}</div>
            </div>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', height: '40px', borderRadius: '12px', fontWeight: 700 }} onClick={() => setViewedEvent(null)}>
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default BookingPOS;
