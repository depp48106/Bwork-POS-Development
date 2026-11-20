import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Users, Wifi, Tv, Wind, CheckCircle2,
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp, ChevronLeft, Calendar, Clock, Sparkles, Building, AlertCircle, Check, Edit3, X, Minus, Plus
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';
import { calculateOnlineBookingPricing } from '../utils/onlinePromotionHelper';
import { getRoomImageUrl, handleRoomImageError } from '../utils/roomImageHelper';
import {
  getAvailabilityMonth,
  getRoomAvailabilityForDay,
  getConflictingRoomIds
} from '../../../shared/roomAvailability.mjs';

// 30-minute interval options: 08:00 to 18:00
const TIME_OPTIONS = [];
for (let h = 8; h <= 18; h++) {
  const hh = h.toString().padStart(2, '0');
  TIME_OPTIONS.push(`${hh}:00`);
  if (h < 18) {
    TIME_OPTIONS.push(`${hh}:30`);
  }
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];
const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

const ROOM_SEQUENCE = ['201', '300', '301', '302', '303', '304', '305', '306'];

const getRoomSortRank = (room) => {
  const name = String(room?.name || '');
  for (let i = 0; i < ROOM_SEQUENCE.length; i++) {
    if (name.includes(`(${ROOM_SEQUENCE[i]})`)) return i;
  }
  return 999;
};

const sortRoomsByStandardOrder = (roomList) =>
  [...roomList].sort((a, b) => getRoomSortRank(a) - getRoomSortRank(b));

const formatToDdMmYyyy = (isoStr) => {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-');
  return `${d}/${m}/${y}`;
};

const formatThaiMonthYear = (monthKey) => {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  const monthName = THAI_MONTHS_FULL[m - 1];
  const thaiYear = y + 543;
  return `${monthName} ${thaiYear}`;
};

// e.g. "อังคาร 24 พฤศจิกายน 2569"
const formatModalHeaderDate = (isoStr) => {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dayName = THAI_DAYS[date.getDay()];
  const monthName = THAI_MONTHS_FULL[m - 1];
  const thaiYear = y + 543;
  return `${dayName} ${d} ${monthName} ${thaiYear}`;
};

// e.g. "24 พ.ย. 2569"
const formatShortThaiDate = (isoStr) => {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-').map(Number);
  const monthShort = THAI_MONTHS_SHORT[m - 1];
  const thaiYear = y + 543;
  return `${d} ${monthShort} ${thaiYear}`;
};

const getBangkokTodayIso = () => {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
};

export default function RoomListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);

  const todayIso = useMemo(() => getBangkokTodayIso(), []);
  const today = new Date();
  const currentMins = today.getHours() * 60 + today.getMinutes();

  // Try to restore previous draft from sessionStorage or navigation state
  const savedDraft = useMemo(() => {
    if (location.state && location.state.room_id) {
      return location.state;
    }
    try {
      const raw = sessionStorage.getItem('current_booking_payload');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }, [location.state]);

  // Determine initial date (query param > saved draft > today)
  const initialDate = useMemo(() => {
    const qDate = query.get('date');
    if (qDate && qDate >= todayIso) return qDate;
    if (savedDraft?.date && savedDraft.date >= todayIso) return savedDraft.date;
    return todayIso;
  }, [query, savedDraft, todayIso]);

  // Confirmed States in effect
  const [dateStr, setDateStr] = useState(initialDate);
  const [currentMonthKey, setCurrentMonthKey] = useState(initialDate.slice(0, 7));

  // Confirmed Search Mode: 'byGuests' (default) vs 'directRoom'
  const initialMode = useMemo(() => {
    if (query.get('roomId') !== null && query.get('roomId') !== '') return 'directRoom';
    if (query.get('guests')) return 'byGuests';
    if (savedDraft?.guests) return 'byGuests';
    if (savedDraft?.room_id) return 'directRoom';
    return 'byGuests';
  }, [query, savedDraft]);

  const [searchMode, setSearchMode] = useState(initialMode);

  // Confirmed Guest count for 'byGuests' mode
  const initialGuests = useMemo(() => {
    const qGuests = query.get('guests');
    if (qGuests) {
      const parsed = parseInt(qGuests, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (savedDraft?.guests) return parseInt(savedDraft.guests, 10) || 4;
    return 4;
  }, [query, savedDraft]);

  const [guests, setGuests] = useState(initialGuests);

  // Confirmed Direct Room ID
  const initialRoomId = useMemo(() => {
    const qRoom = query.get('roomId');
    if (qRoom !== null && qRoom !== '') return parseInt(qRoom, 10) || qRoom;
    if (savedDraft?.room_id) return savedDraft.room_id;
    return null;
  }, [query, savedDraft]);

  const [confirmedRoomId, setConfirmedRoomId] = useState(initialRoomId);

  // Expanded Room (accordion / time selector)
  const [expandedRoomId, setExpandedRoomId] = useState(initialRoomId);
  const [timelineError, setTimelineError] = useState('');

  // -------------------------------------------------------------
  // Bottom Sheet Modal States (staged values until "ตกลง" is pressed)
  // -------------------------------------------------------------
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState(initialDate);
  const [modalMode, setModalMode] = useState(initialMode);
  const [modalGuests, setModalGuests] = useState(initialGuests);
  const [modalRoomId, setModalRoomId] = useState(initialRoomId || '');

  // Master Data States
  const [rooms, setRooms] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [availabilityData, setAvailabilityData] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [loading, setLoading] = useState(true);

  // Per-Room Selections State: { [roomId]: { mode, startTime, endTime, halfDaySlot, dailySlot } }
  const [roomSelections, setRoomSelections] = useState(() => {
    if (savedDraft?.room_id) {
      return {
        [savedDraft.room_id]: {
          mode: savedDraft.booking_type || 'hourly',
          startTime: savedDraft.start_time || '09:00',
          endTime: savedDraft.end_time || '11:00',
          halfDaySlot: '08-12',
          dailySlot: '08-17'
        }
      };
    }
    return {};
  });

  // Per-Room Layout State: { [roomId]: 'standard' | 'classroom' }
  const [roomLayouts, setRoomLayouts] = useState(() => {
    if (savedDraft?.room_id && savedDraft.layout) {
      return { [savedDraft.room_id]: savedDraft.layout };
    }
    return {};
  });

  const isToday = dateStr === todayIso;

  // Real-time time protection: For today, filter out past slots
  const availableStartOptions = useMemo(() => {
    if (!isToday) {
      return TIME_OPTIONS.filter(t => t < '18:00');
    }
    return TIME_OPTIONS.filter(t => {
      if (t >= '18:00') return false;
      const [h, m] = t.split(':').map(Number);
      return (h * 60 + m) >= currentMins;
    });
  }, [isToday, currentMins]);

  const defaultStart = availableStartOptions.length > 0 ? availableStartOptions[0] : '09:00';
  const [defH, defM] = defaultStart.split(':').map(Number);
  const defEndMins = Math.min(18 * 60, defH * 60 + defM + 60);
  const defaultEnd = `${Math.floor(defEndMins / 60).toString().padStart(2, '0')}:${(defEndMins % 60).toString().padStart(2, '0')}`;

  const [globalStartTime, setGlobalStartTime] = useState(defaultStart);
  const [globalEndTime, setGlobalEndTime] = useState(defaultEnd);

  // Sync state if query parameters change externally
  useEffect(() => {
    const qDate = query.get('date');
    if (qDate && qDate >= todayIso && qDate !== dateStr) {
      setDateStr(qDate);
      if (qDate.slice(0, 7) !== currentMonthKey) {
        setCurrentMonthKey(qDate.slice(0, 7));
      }
    }
    const qRoom = query.get('roomId');
    if (qRoom !== null && qRoom !== '') {
      const parsedId = parseInt(qRoom, 10) || qRoom;
      setConfirmedRoomId(parsedId);
      setExpandedRoomId(parsedId);
      setSearchMode('directRoom');
    }
    const qGuests = query.get('guests');
    if (qGuests) {
      const val = parseInt(qGuests, 10);
      if (!isNaN(val) && val > 0) {
        setGuests(val);
        setSearchMode('byGuests');
      }
    }
  }, [location.search]);

  // Fetch monthly availability intervals for current calendar month
  useEffect(() => {
    let active = true;
    const fetchMonth = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/rooms/availability-month?month=${currentMonthKey}`);
        if (res.ok) {
          const data = await res.json();
          if (active && data && data.month === currentMonthKey) {
            setAvailabilityData(data);
          }
        }
      } catch (err) {
        console.warn('Failed to load monthly availability:', err);
      }
    };
    fetchMonth();
    return () => { active = false; };
  }, [currentMonthKey]);

  // Fetch active rooms, schedule for selected date, and promotion
  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [roomsRes, scheduleRes, promoRes] = await Promise.all([
          fetch(`${API_BASE}/api/public/rooms`),
          fetch(`${API_BASE}/api/public/rooms/schedule?date=${dateStr}`),
          fetch(`${API_BASE}/api/public/promotion`).catch(() => null)
        ]);

        if (active) {
          if (roomsRes.ok) {
            const roomsData = await roomsRes.json();
            setRooms(roomsData);
          }
          if (scheduleRes.ok) {
            const scheduleData = await scheduleRes.json();
            setSchedule(scheduleData);
          }
          if (promoRes && promoRes.ok) {
            const promoData = await promoRes.json();
            setPromotion(promoData);
          }
        }
      } catch (err) {
        console.warn('Failed to load room data:', err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();
    return () => { active = false; };
  }, [dateStr]);

  // Month navigation handlers
  const changeMonth = (delta) => {
    const [y, m] = currentMonthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const newMonthKey = d.toISOString().slice(0, 7);
    setCurrentMonthKey(newMonthKey);
  };

  const jumpToToday = () => {
    setCurrentMonthKey(todayIso.slice(0, 7));
    handleDateTap(todayIso);
  };

  // When tapping a date on calendar: open bottom sheet modal with staged date
  const handleDateTap = (tappedDate) => {
    if (tappedDate < todayIso) return;
    setModalDate(tappedDate);
    setModalMode(searchMode);
    setModalGuests(guests || 4);
    setModalRoomId(confirmedRoomId || (rooms.length > 0 ? rooms[0].id : ''));
    setIsModalOpen(true);
  };

  // When clicking "เปลี่ยน" button above results: open modal with current confirmed values
  const handleOpenEditModal = () => {
    setModalDate(dateStr);
    setModalMode(searchMode);
    setModalGuests(guests || 4);
    setModalRoomId(confirmedRoomId || (rooms.length > 0 ? rooms[0].id : ''));
    setIsModalOpen(true);
  };

  // Close modal without saving changes
  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  // Confirm choices in modal and update the view
  const handleConfirmModal = () => {
    setDateStr(modalDate);
    const newMonth = modalDate.slice(0, 7);
    if (newMonth !== currentMonthKey) {
      setCurrentMonthKey(newMonth);
    }
    setSearchMode(modalMode);

    const params = new URLSearchParams();
    params.set('date', modalDate);

    if (modalMode === 'byGuests') {
      const gVal = Math.max(1, parseInt(modalGuests, 10) || 1);
      setGuests(gVal);
      params.set('guests', gVal);
      setConfirmedRoomId(null);
    } else {
      setConfirmedRoomId(modalRoomId);
      setExpandedRoomId(modalRoomId);
      params.set('roomId', modalRoomId);
    }

    navigate(`/rooms?${params.toString()}`, { replace: true });
    setIsModalOpen(false);
  };

  // Build Calendar Weeks for Monthly Interactive Grid
  const calendarWeeks = useMemo(() => {
    const monthInfo = getAvailabilityMonth(currentMonthKey);
    if (!monthInfo) return [];
    const { days, firstWeekday } = monthInfo;
    const cells = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push(null);
    }

    for (let d = 1; d <= days; d++) {
      const dayDateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
      const isPast = dayDateStr < todayIso;
      const isDayToday = dayDateStr === todayIso;

      let freeCount = 0;
      if (availabilityData && Array.isArray(availabilityData.rooms)) {
        const buffer = Number(availabilityData.cleaning_buffer_minutes ?? 30);
        for (const rm of availabilityData.rooms) {
          const conflicting = getConflictingRoomIds(rm.id);
          const dayBookings = (availabilityData.intervals || []).filter(item => {
            if (!conflicting.includes(item.room_id)) return false;
            return (item.start || '').slice(0, 10) === dayDateStr;
          });
          const ranges = getRoomAvailabilityForDay(dayDateStr, dayBookings, buffer);
          if (ranges.length > 0) {
            freeCount++;
          }
        }
      }

      cells.push({
        dayNumber: d,
        date: dayDateStr,
        isPast,
        isToday: isDayToday,
        freeRoomsCount: freeCount
      });
    }

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }, [currentMonthKey, todayIso, availabilityData]);

  // Robust time string extractor (Public, zero PII)
  const extractHHMM = (timeStr) => {
    if (!timeStr) return null;
    if (typeof timeStr !== 'string') {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return null;
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const str = timeStr.trim();
    if (str.includes('T')) {
      const timePart = str.split('T')[1];
      const [h, m] = timePart.split(':');
      return `${h.padStart(2, '0')}:${(m || '00').padStart(2, '0')}`;
    }
    if (str.includes(' ')) {
      const timePart = str.split(' ')[1];
      const [h, m] = timePart.split(':');
      return `${h.padStart(2, '0')}:${(m || '00').padStart(2, '0')}`;
    }
    const parts = str.split(':');
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return null;
  };

  // Helper to extract full selection details for a specific room
  const getRoomSelection = (room) => {
    const isClassroom = roomLayouts[room.id] === 'classroom';
    const hourlyPrice = isClassroom ? (room.classroom_hourly_rate || room.hourly_rate) : (room.hourly_rate || 0);
    const dailyPrice = isClassroom ? (room.classroom_daily_rate || room.daily_rate) : (room.daily_rate || 0);
    const halfDayPrice = room.half_day_rate || 0;

    const hasHourly = room.has_hourly === 1 && hourlyPrice > 0;
    const hasHalfDay = (room.has_halfday === 1 || halfDayPrice > 0) && halfDayPrice > 0;
    const hasDaily = room.has_daily === 1 && dailyPrice > 0;

    const defaultMode = hasHourly ? 'hourly' : (hasHalfDay ? 'halfday' : 'daily');

    const current = roomSelections[room.id] || {};
    const mode = current.mode && (
      (current.mode === 'hourly' && hasHourly) ||
      (current.mode === 'halfday' && hasHalfDay) ||
      (current.mode === 'daily' && hasDaily)
    ) ? current.mode : defaultMode;

    const startTime = current.startTime || globalStartTime;
    const endTime = current.endTime || globalEndTime;
    const halfDaySlot = current.halfDaySlot || '08-12';
    const dailySlot = current.dailySlot || '08-17';

    let effStart = startTime;
    let effEnd = endTime;
    let duration = 2;
    let totalPrice = hourlyPrice * 2;
    let rateLabel = 'อัตรารายชั่วโมง';

    if (mode === 'hourly') {
      const [sH, sM] = startTime.split(':').map(Number);
      const [eH, eM] = endTime.split(':').map(Number);
      const diff = (eH * 60 + eM) - (sH * 60 + sM);
      const exactHours = diff > 0 ? diff / 60 : 1;
      const billedHours = Math.max(1, Math.ceil(exactHours));
      duration = exactHours;
      totalPrice = hourlyPrice * billedHours;
      rateLabel = `อัตรารายชั่วโมง (฿${hourlyPrice.toLocaleString()}/ชม.)`;
    } else if (mode === 'halfday') {
      effStart = halfDaySlot === '08-12' ? '08:00' : '13:00';
      effEnd = halfDaySlot === '08-12' ? '12:00' : '17:00';
      duration = 4;
      totalPrice = halfDayPrice;
      rateLabel = `อัตราเหมาครึ่งวัน ${halfDaySlot === '08-12' ? '(รอบเช้า 08:00 - 12:00 น.)' : '(รอบบ่าย 13:00 - 17:00 น.)'}`;
    } else if (mode === 'daily') {
      effStart = dailySlot === '08-17' ? '08:00' : '09:00';
      effEnd = dailySlot === '08-17' ? '17:00' : '18:00';
      duration = 9;
      totalPrice = dailyPrice;
      rateLabel = `อัตราเหมาทั้งวัน (${effStart} - ${effEnd} น.)`;
    }

    const promoPricing = calculateOnlineBookingPricing({
      subtotal: totalPrice,
      promo: promotion,
      currentTime: Date.now()
    });

    return {
      mode,
      startTime: effStart,
      endTime: effEnd,
      rawStartTime: startTime,
      rawEndTime: endTime,
      halfDaySlot,
      dailySlot,
      duration,
      subtotalPrice: promoPricing.subtotal_amount,
      totalPrice: promoPricing.total_amount,
      discountAmount: promoPricing.discount_amount,
      discountValue: promoPricing.discount_value,
      isPromotionApplied: promoPricing.is_promotion_applied,
      rateLabel,
      hasHourly,
      hasHalfDay,
      hasDaily,
      hourlyPrice,
      halfDayPrice,
      dailyPrice,
      effectiveCapacity: isClassroom ? (room.classroom_capacity || room.capacity) : room.capacity
    };
  };

  // Check if a room has booking overlap or buffer conflicts
  const getRoomOccupiedInfo = (roomId, effStart, effEnd) => {
    if (!schedule || !schedule.rooms) return { isOccupied: false, label: 'ว่างพร้อมจอง' };

    const startHHMM = extractHHMM(effStart || globalStartTime || '09:00');
    const endHHMM = extractHHMM(effEnd || globalEndTime || '11:00');
    if (!startHHMM || !endHHMM) return { isOccupied: false, label: 'ว่างพร้อมจอง' };

    const [sH, sM] = startHHMM.split(':').map(Number);
    const [eH, eM] = endHHMM.split(':').map(Number);
    const reqStartMins = sH * 60 + (sM || 0);
    const reqEndMins = eH * 60 + (eM || 0);

    // Business hours boundary: 08:00 - 18:00
    if (reqStartMins < 8 * 60 || reqStartMins >= 18 * 60 || reqEndMins > 18 * 60 || reqEndMins <= reqStartMins) {
      return { isOccupied: true, reason: 'outside_hours', label: 'อยู่นอกเวลาทำการ (08:00 - 18:00 น.)' };
    }

    // Past time check for today
    if (isToday && reqStartMins < currentMins) {
      return { isOccupied: true, reason: 'past', label: 'เวลานี้ผ่านมาแล้ว' };
    }

    const conflictingIds = getConflictingRoomIds(roomId);
    const bufferMins = Number(schedule.cleaning_buffer_minutes || schedule.buffer_minutes) || 30;

    for (const confId of conflictingIds) {
      const roomObj = schedule.rooms.find(r => r.id === confId);
      if (!roomObj || !roomObj.bookings) continue;

      for (const b of roomObj.bookings) {
        if (b.status === 'cancelled' || b.payment_status === 'cancelled') continue;

        const bStartHHMM = extractHHMM(b.start_time);
        const bEndHHMM = extractHHMM(b.end_time);
        if (!bStartHHMM || !bEndHHMM) continue;

        const [bStartH, bStartM] = bStartHHMM.split(':').map(Number);
        const [bEndH, bEndM] = bEndHHMM.split(':').map(Number);
        const bStartMins = bStartH * 60 + (bStartM || 0);
        const bEndMins = bEndH * 60 + (bEndM || 0);
        const bEndBufferedMins = bEndMins + bufferMins;
        const reqEndBufferedMins = reqEndMins + bufferMins;

        // 1. Direct overlap
        if (reqStartMins < bEndMins && reqEndMins > bStartMins) {
          return {
            isOccupied: true,
            reason: 'booked',
            label: `ติดจอง (${bStartHHMM} - ${bEndHHMM} น.)`
          };
        }

        // 2. Buffer after previous booking b
        if (bEndMins <= reqStartMins && reqStartMins < bEndBufferedMins && bEndMins < 18 * 60) {
          const cleanEndH = Math.floor(bEndBufferedMins / 60);
          const cleanEndM = bEndBufferedMins % 60;
          const cleanEndHHMM = `${String(cleanEndH).padStart(2, '0')}:${String(cleanEndM).padStart(2, '0')}`;
          return {
            isOccupied: true,
            reason: 'cleaning',
            label: `ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง ${bEndHHMM} น. • พร้อมจอง ${cleanEndHHMM} น.)`
          };
        }

        // 3. Buffer before subsequent booking b
        if (reqEndMins <= bStartMins && reqEndBufferedMins > bStartMins) {
          return {
            isOccupied: true,
            reason: 'cleaning',
            label: `ติดเวลาเตรียมห้องสำหรับคิวถัดไป (${bStartHHMM} น.)`
          };
        }
      }
    }

    return { isOccupied: false, label: 'ว่างพร้อมจอง' };
  };

  // Helper to check if a specific time interval is clear
  const isIntervalClear = useCallback((roomId, startMins, endMins) => {
    if (!schedule || !schedule.rooms) return true;
    if (startMins < 8 * 60 || endMins > 18 * 60 || startMins >= endMins) return false;
    if (isToday && startMins < currentMins) return false;

    const conflictingIds = getConflictingRoomIds(roomId);
    const bufferMins = Number(schedule.cleaning_buffer_minutes || schedule.buffer_minutes) || 30;

    for (const confId of conflictingIds) {
      const roomObj = schedule.rooms.find(r => r.id === confId);
      if (!roomObj || !roomObj.bookings) continue;

      for (const b of roomObj.bookings) {
        if (b.status === 'cancelled' || b.payment_status === 'cancelled') continue;
        const bStartHHMM = extractHHMM(b.start_time);
        const bEndHHMM = extractHHMM(b.end_time);
        if (!bStartHHMM || !bEndHHMM) continue;

        const [bSH, bSM] = bStartHHMM.split(':').map(Number);
        const [bEH, bEM] = bEndHHMM.split(':').map(Number);
        const bStartMins = bSH * 60 + bSM;
        const bEndMins = bEH * 60 + bEM;
        const bEndBufferedMins = bEndMins + bufferMins;
        const reqEndBufferedMins = endMins + bufferMins;

        if (startMins < bEndMins && endMins > bStartMins) return false;
        if (bEndMins <= startMins && startMins < bEndBufferedMins && bEndMins < 18 * 60) return false;
        if (endMins <= bStartMins && reqEndBufferedMins > bStartMins) return false;
      }
    }
    return true;
  }, [schedule, isToday, currentMins]);

  // Smart Room Categorization for 'byGuests' mode
  const { recommendedRooms, upgradeRooms, directSelectedRoom, allSortedRooms } = useMemo(() => {
    const sorted = sortRoomsByStandardOrder(rooms);

    if (searchMode === 'directRoom') {
      const selRoom = confirmedRoomId ? sorted.find(r => String(r.id) === String(confirmedRoomId)) : null;
      return {
        recommendedRooms: selRoom ? [selRoom] : sorted,
        upgradeRooms: [],
        directSelectedRoom: selRoom,
        allSortedRooms: sorted
      };
    }

    const reqGuests = Math.max(1, parseInt(guests, 10) || 1);
    const recommended = [];
    const upgrade = [];

    sorted.forEach(room => {
      const standardCap = room.capacity || 4;
      const classroomCap = room.has_classroom === 1 ? (room.classroom_capacity || standardCap) : standardCap;
      const maxRoomCap = Math.max(standardCap, classroomCap);

      if (maxRoomCap < reqGuests) return;

      if (reqGuests <= 4) {
        if (maxRoomCap <= 4) {
          recommended.push(room);
        } else {
          upgrade.push(room);
        }
      } else if (reqGuests <= 8) {
        if (maxRoomCap <= 10) {
          recommended.push(room);
        } else {
          upgrade.push(room);
        }
      } else if (reqGuests <= 12) {
        if (maxRoomCap <= 12) {
          recommended.push(room);
        } else {
          upgrade.push(room);
        }
      } else {
        recommended.push(room);
      }
    });

    return {
      recommendedRooms: recommended,
      upgradeRooms: upgrade,
      directSelectedRoom: null,
      allSortedRooms: sorted
    };
  }, [rooms, searchMode, guests, confirmedRoomId]);

  // Proceed to Step 2 Form
  const handleProceedToForm = (room) => {
    const layout = roomLayouts[room.id] || 'standard';
    const isClassroom = layout === 'classroom';
    const sel = getRoomSelection(room);

    const rawImage = isClassroom && room.classroom_image_url ? room.classroom_image_url : room.image_url;
    const safeImage = (typeof rawImage === 'string' && rawImage.startsWith('data:')) ? '' : rawImage;

    const bookingPayload = {
      room_id: room.id,
      room_name: room.name,
      room_capacity: room.capacity || 4,
      classroom_capacity: room.classroom_capacity || room.capacity || 4,
      effective_capacity: sel.effectiveCapacity,
      image_url: safeImage,
      date: dateStr,
      start_time: sel.startTime,
      end_time: sel.endTime,
      duration: sel.duration,
      guests: guests || sel.effectiveCapacity,
      layout: layout,
      booking_type: sel.mode,
      rate_label: sel.rateLabel,
      hourly_rate: sel.hourlyPrice,
      daily_rate: sel.dailyPrice,
      half_day_rate: sel.halfDayPrice,
      subtotal_amount: sel.subtotalPrice || sel.totalPrice,
      discount_amount: sel.discountAmount || 0,
      discount_type: sel.isPromotionApplied ? 'percent' : 'none',
      discount_value: sel.isPromotionApplied ? (sel.discountValue ?? (promotion?.discount_value || 5)) : 0,
      total_amount: sel.totalPrice
    };

    try {
      sessionStorage.setItem('current_booking_payload', JSON.stringify(bookingPayload));
    } catch (e) {
      console.warn('[Storage] sessionStorage current_booking_payload failed:', e);
    }

    navigate('/form', { state: bookingPayload });
  };

  // Handle slot tap on horizontal timeline bar
  const handleTimelineSlotTap = (room, slotIndex) => {
    setTimelineError('');
    const slotStartMins = 8 * 60 + slotIndex * 30;
    const slotEndMins = slotStartMins + 30;

    if (!isIntervalClear(room.id, slotStartMins, slotEndMins)) {
      setTimelineError('ช่วงเวลานี้ไม่ว่าง (ติดจอง หรือ อยู่ในช่วงทำความสะอาด)');
      return;
    }

    const currentSel = roomSelections[room.id] || {};
    const curStart = currentSel.startTime || globalStartTime;
    const [cSH, cSM] = curStart.split(':').map(Number);
    const curStartMins = cSH * 60 + cSM;

    const slotStartStr = `${String(Math.floor(slotStartMins / 60)).padStart(2, '0')}:${String(slotStartMins % 60).padStart(2, '0')}`;
    const slotEndStr = `${String(Math.floor(slotEndMins / 60)).padStart(2, '0')}:${String(slotEndMins % 60).padStart(2, '0')}`;

    if (slotStartMins < curStartMins || slotStartMins === curStartMins) {
      let newEndMins = slotStartMins + 60;
      if (newEndMins > 18 * 60) newEndMins = 18 * 60;
      if (!isIntervalClear(room.id, slotStartMins, newEndMins)) {
        if (isIntervalClear(room.id, slotStartMins, slotStartMins + 30)) {
          newEndMins = slotStartMins + 30;
        } else {
          setTimelineError('ไม่สามารถเริ่มเวลานี้ได้เนื่องจากติดคิวถัดไป');
          return;
        }
      }
      const newEndStr = `${String(Math.floor(newEndMins / 60)).padStart(2, '0')}:${String(newEndMins % 60).padStart(2, '0')}`;
      setRoomSelections(prev => ({
        ...prev,
        [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: slotStartStr, endTime: newEndStr }
      }));
    } else {
      const proposedEndMins = slotEndMins;
      if (!isIntervalClear(room.id, curStartMins, proposedEndMins)) {
        setTimelineError('ไม่สามารถเลือกคร่อมช่วงที่ติดจองหรือทำความสะอาดได้');
        return;
      }
      setRoomSelections(prev => ({
        ...prev,
        [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: slotEndStr }
      }));
    }
  };

  // Handle Start Time Change via Start Dropdown Button
  const handleStartTimeDropdownChange = (room, newStart) => {
    setTimelineError('');
    const [sH, sM] = newStart.split(':').map(Number);
    const newStartMins = sH * 60 + sM;

    const currentSel = roomSelections[room.id] || {};
    const curEnd = currentSel.endTime || globalEndTime;
    const [eH, eM] = curEnd.split(':').map(Number);
    const curEndMins = eH * 60 + eM;

    let newEndMins = curEndMins;

    if (curEndMins <= newStartMins || !isIntervalClear(room.id, newStartMins, curEndMins)) {
      newEndMins = Math.min(18 * 60, newStartMins + 60);
      if (!isIntervalClear(room.id, newStartMins, newEndMins)) {
        if (isIntervalClear(room.id, newStartMins, newStartMins + 30)) {
          newEndMins = newStartMins + 30;
        }
      }
    }

    const newEndStr = `${String(Math.floor(newEndMins / 60)).padStart(2, '0')}:${String(newEndMins % 60).padStart(2, '0')}`;
    setRoomSelections(prev => ({
      ...prev,
      [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStart, endTime: newEndStr }
    }));
  };

  // Handle End Time Change via End Dropdown Button
  const handleEndTimeDropdownChange = (room, newEnd) => {
    setTimelineError('');
    const currentSel = roomSelections[room.id] || {};
    const curStart = currentSel.startTime || globalStartTime;
    const [sH, sM] = curStart.split(':').map(Number);
    const [eH, eM] = newEnd.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;

    if (!isIntervalClear(room.id, startMins, endMins)) {
      setTimelineError('ไม่สามารถเลือกคร่อมช่วงที่ติดจองหรือทำความสะอาดได้');
      return;
    }

    setRoomSelections(prev => ({
      ...prev,
      [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: newEnd }
    }));
  };

  // Render Horizontal Timeline Bar (08:00 - 18:00, 20 slots of 30 mins)
  const renderInteractiveTimelineBar = (room, sel) => {
    const [selSH, selSM] = sel.startTime.split(':').map(Number);
    const [selEH, selEM] = sel.endTime.split(':').map(Number);
    const selStartMins = selSH * 60 + selSM;
    const selEndMins = selEH * 60 + selEM;

    const slots = [];
    for (let i = 0; i < 20; i++) {
      const slotStart = 8 * 60 + i * 30;
      const slotEnd = slotStart + 30;
      const slotStartStr = `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`;
      const slotEndStr = `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`;

      const isPast = isToday && slotStart < currentMins;
      const isSelected = slotStart >= selStartMins && slotEnd <= selEndMins;
      const occupiedInfo = getRoomOccupiedInfo(room.id, slotStartStr, slotEndStr);

      let type = 'available';
      if (isSelected) {
        type = 'selected';
      } else if (isPast) {
        type = 'past';
      } else if (occupiedInfo.isOccupied) {
        type = occupiedInfo.reason === 'cleaning' ? 'cleaning' : 'booked';
      }

      slots.push({
        index: i,
        startStr: slotStartStr,
        endStr: slotEndStr,
        type,
        isBlocked: isPast || occupiedInfo.isOccupied
      });
    }

    const validEndOptions = [];
    let obstacleFound = false;
    for (let i = 0; i < 20; i++) {
      const slotStart = 8 * 60 + i * 30;
      const slotEnd = slotStart + 30;
      if (slotEnd <= selStartMins) continue;

      if (!obstacleFound) {
        if (!isIntervalClear(room.id, slotStart, slotEnd)) {
          obstacleFound = true;
          break;
        }
        const optStr = `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`;
        validEndOptions.push(optStr);
      }
    }

    return (
      <div className="timeline-bar-wrapper">
        <div className="timeline-bar-labels">
          <span>08:00</span>
          <span>10:00</span>
          <span>12:00</span>
          <span>14:00</span>
          <span>16:00</span>
          <span>18:00</span>
        </div>

        {/* The Single Horizontal Tap Bar */}
        <div
          className="interactive-time-bar"
          role="slider"
          aria-label="แถบเลือกเวลาใช้งาน"
        >
          {slots.map(s => (
            <div
              key={s.index}
              onClick={() => handleTimelineSlotTap(room, s.index)}
              className={`interactive-time-segment interactive-time-segment--${s.type}`}
              title={`${s.startStr} - ${s.endStr} น. (${s.type === 'selected' ? 'เลือกอยู่' : s.type === 'available' ? 'ว่าง' : s.type === 'cleaning' ? 'ทำความสะอาด' : s.type === 'booked' ? 'ติดจอง' : 'ผ่านมาแล้ว'})`}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="timeline-legend">
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#0F766E' }} /> เวลาที่เลือก</span>
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#10b981' }} /> ว่าง</span>
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#ef4444' }} /> ติดจอง</span>
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#f59e0b' }} /> ทำความสะอาด</span>
        </div>

        {/* Error / Conflict Alert */}
        {timelineError && (
          <div style={{ marginTop: '8px', padding: '6px 10px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={15} />
            <span>{timelineError}</span>
          </div>
        )}

        {/* Underneath: Buttons “เริ่ม” and “สิ้นสุด” */}
        <div className="time-control-grid">
          {/* Start Time Control Box */}
          <div className="time-control-card">
            <div className="time-control-card__header">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={14} color="var(--primary)" />
                <span>เวลาเริ่ม (Start):</span>
              </span>
              <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{sel.startTime} น.</span>
            </div>
            <select
              value={sel.rawStartTime}
              onChange={(e) => handleStartTimeDropdownChange(room, e.target.value)}
              className="time-control-card__select"
            >
              {availableStartOptions.map(t => {
                const [h, m] = t.split(':').map(Number);
                const sMins = h * 60 + m;
                const isClear = isIntervalClear(room.id, sMins, sMins + 30);
                return (
                  <option key={t} value={t} disabled={!isClear}>
                    {t} น. {!isClear ? '(ไม่ว่าง)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* End Time Control Box */}
          <div className="time-control-card">
            <div className="time-control-card__header">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={14} color="var(--primary)" />
                <span>เวลาสิ้นสุด (End):</span>
              </span>
              <span style={{ color: 'var(--primary)', fontWeight: 800 }}>{sel.endTime} น.</span>
            </div>
            <select
              value={sel.rawEndTime}
              onChange={(e) => handleEndTimeDropdownChange(room, e.target.value)}
              className="time-control-card__select"
            >
              {validEndOptions.map(t => (
                <option key={t} value={t}>
                  {t} น.
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  };

  // Render a Single Room Card
  const renderRoomCard = (room, isUpgrade = false) => {
    const isExpanded = expandedRoomId === room.id;
    const sel = getRoomSelection(room);
    const { isOccupied, label: statusLabel, reason } = getRoomOccupiedInfo(room.id, sel.startTime, sel.endTime);
    const currentLayout = roomLayouts[room.id] || 'standard';
    const isClassroom = currentLayout === 'classroom';
    const rawImage = isClassroom && room.classroom_image_url ? room.classroom_image_url : room.image_url;
    const displayImage = getRoomImageUrl(room, isClassroom);

    // Layout capacity condition check
    const reqGuests = Math.max(1, parseInt(guests, 10) || 1);
    let layoutConditionNotice = '';
    if (searchMode === 'byGuests' && room.has_classroom === 1) {
      if (reqGuests > (room.capacity || 4) && reqGuests <= (room.classroom_capacity || 4)) {
        layoutConditionNotice = `รองรับ ${reqGuests} ท่านเฉพาะการจัดโต๊ะแบบ Classroom (${room.classroom_capacity} ที่นั่ง)`;
      } else if (reqGuests <= (room.capacity || 4) && reqGuests > (room.classroom_capacity || 4)) {
        layoutConditionNotice = `จัดโต๊ะแบบ Standard รองรับได้ ${room.capacity} ท่าน`;
      }
    }

    // Half-day slot availability checks
    const halfDay0812Occupied = getRoomOccupiedInfo(room.id, '08:00', '12:00').isOccupied;
    const halfDay1317Occupied = getRoomOccupiedInfo(room.id, '13:00', '17:00').isOccupied;

    // Daily slot availability checks
    const daily0817Occupied = getRoomOccupiedInfo(room.id, '08:00', '17:00').isOccupied;
    const daily0918Occupied = getRoomOccupiedInfo(room.id, '09:00', '18:00').isOccupied;

    return (
      <div
        key={room.id}
        id={`room-card-${room.id}`}
        className="room-card-container"
        style={{
          borderColor: isExpanded ? 'var(--primary)' : undefined,
          boxShadow: isExpanded ? '0 6px 24px rgba(15, 118, 110, 0.16)' : undefined
        }}
      >
        {/* Left Column: Room Photo */}
        <div className="room-card-image" style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', height: '220px', backgroundColor: '#f1f5f9' }}>
          {displayImage ? (
            <img
              src={displayImage}
              alt={room.name}
              onError={(e) => handleRoomImageError(e, rawImage)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
              <Building size={48} />
            </div>
          )}

          {/* Status Overlay Badge (Zero PII, only "ว่าง", "ติดจอง", "ทำความสะอาด") */}
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            padding: '5px 12px',
            borderRadius: '20px',
            fontSize: '0.74rem',
            fontWeight: 800,
            backgroundColor: isOccupied
              ? (reason === 'cleaning' ? 'rgba(245, 158, 11, 0.95)' : 'rgba(239, 68, 68, 0.95)')
              : 'rgba(16, 185, 129, 0.95)',
            color: '#ffffff',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}>
            {statusLabel}
          </div>

          {/* Upgrade Tag */}
          {isUpgrade && (
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.72rem',
              fontWeight: 800,
              backgroundColor: 'rgba(19, 36, 64, 0.88)',
              color: '#a7f3d0',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Sparkles size={12} />
              <span>ห้องใหญ่ขึ้น ({room.capacity} ท่าน)</span>
            </div>
          )}
        </div>

        {/* Right Column: Room Details & Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            {/* Header: Room Name, Category, Capacity */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h4 style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--navy)', margin: '0 0 4px 0' }}>
                  {room.name}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', fontWeight: 700, color: 'var(--navy)' }}>
                    <Users size={13} /> {sel.effectiveCapacity} ท่าน
                  </span>
                  <span>{room.category || 'ห้องประชุม'}</span>
                </div>
              </div>

              {/* Hourly Price Tag */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>เริ่มต้น</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--primary)' }}>
                  ฿{Number(sel.hourlyPrice || sel.halfDayPrice || sel.dailyPrice).toLocaleString()}
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    {sel.hasHourly ? ' / ชม.' : (sel.hasHalfDay ? ' / ครึ่งวัน' : ' / วัน')}
                  </span>
                </div>
              </div>
            </div>

            {/* Layout Condition Notice Banner if required */}
            {layoutConditionNotice && (
              <div className="room-layout-notice">
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{layoutConditionNotice}</span>
              </div>
            )}

            {/* Amenities Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '10px 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Wifi size={13} color="var(--primary)" /> Wi-Fi ฟรี</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Tv size={13} color="var(--primary)" /> จอ TV/โปรเจคเตอร์</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Wind size={13} color="var(--primary)" /> เครื่องปรับอากาศ</span>
            </div>

            {/* Table Layout Toggle (ONLY if room genuine supports classroom) */}
            {room.has_classroom === 1 && (
              <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)' }}>รูปแบบจัดโต๊ะ:</span>
                <div style={{ display: 'flex', gap: '4px', backgroundColor: 'var(--bg-page)', padding: '2px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setRoomLayouts({ ...roomLayouts, [room.id]: 'standard' })}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      border: 'none',
                      backgroundColor: currentLayout === 'standard' ? 'var(--navy)' : 'transparent',
                      color: currentLayout === 'standard' ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Standard ({room.capacity} ที่นั่ง)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoomLayouts({ ...roomLayouts, [room.id]: 'classroom' })}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      border: 'none',
                      backgroundColor: currentLayout === 'classroom' ? 'var(--primary)' : 'transparent',
                      color: currentLayout === 'classroom' ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Classroom ({room.classroom_capacity} ที่นั่ง)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Toggle "ดูเวลาว่าง" Button */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {isExpanded ? 'กำหนดช่วงเวลาที่ต้องการ' : 'แตะเพื่อเลือกเวลาและจอง'}
            </div>

            <button
              type="button"
              onClick={() => {
                setTimelineError('');
                setExpandedRoomId(prev => (prev === room.id ? null : room.id));
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '10px',
                fontSize: '0.86rem',
                fontWeight: 700,
                backgroundColor: isExpanded ? 'var(--navy)' : 'var(--primary-light)',
                color: isExpanded ? '#ffffff' : 'var(--primary)',
                border: isExpanded ? '1px solid var(--navy)' : '1px solid rgba(15, 118, 110, 0.25)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span>{isExpanded ? 'ย่อรายละเอียด' : 'ดูเวลาว่าง'}</span>
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {/* EXPANDED TIME SELECTION DRAWER */}
          {isExpanded && (
            <div style={{
              marginTop: '12px',
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: '#f8fafc',
              border: '1.5px solid rgba(15, 118, 110, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {/* Package Selector Tabs (Only show if room has multiple packages) */}
              {(sel.hasHalfDay || sel.hasDaily) && (
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '6px' }}>
                    เลือกรูปแบบการจอง:
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {sel.hasHourly && (
                      <button
                        type="button"
                        onClick={() => {
                          setTimelineError('');
                          setRoomSelections(prev => ({
                            ...prev,
                            [room.id]: { ...(prev[room.id] || {}), mode: 'hourly' }
                          }));
                        }}
                        style={{
                          flex: '1 1 auto',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: sel.mode === 'hourly' ? '2px solid var(--primary)' : '1px solid var(--border)',
                          backgroundColor: sel.mode === 'hourly' ? 'var(--primary-light)' : '#ffffff',
                          color: sel.mode === 'hourly' ? 'var(--primary)' : 'var(--text-main)',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        รายชั่วโมง (฿{sel.hourlyPrice.toLocaleString()}/ชม.)
                      </button>
                    )}

                    {sel.hasHalfDay && (
                      <button
                        type="button"
                        onClick={() => {
                          setTimelineError('');
                          setRoomSelections(prev => ({
                            ...prev,
                            [room.id]: { ...(prev[room.id] || {}), mode: 'halfday' }
                          }));
                        }}
                        style={{
                          flex: '1 1 auto',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: sel.mode === 'halfday' ? '2px solid #7c3aed' : '1px solid var(--border)',
                          backgroundColor: sel.mode === 'halfday' ? 'rgba(124, 58, 237, 0.08)' : '#ffffff',
                          color: sel.mode === 'halfday' ? '#7c3aed' : 'var(--text-main)',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        เหมาครึ่งวัน (฿{Number(sel.halfDayPrice).toLocaleString()})
                      </button>
                    )}

                    {sel.hasDaily && (
                      <button
                        type="button"
                        onClick={() => {
                          setTimelineError('');
                          setRoomSelections(prev => ({
                            ...prev,
                            [room.id]: { ...(prev[room.id] || {}), mode: 'daily' }
                          }));
                        }}
                        style={{
                          flex: '1 1 auto',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: sel.mode === 'daily' ? '2px solid #059669' : '1px solid var(--border)',
                          backgroundColor: sel.mode === 'daily' ? 'rgba(5, 150, 105, 0.08)' : '#ffffff',
                          color: sel.mode === 'daily' ? '#059669' : 'var(--text-main)',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        เหมาทั้งวัน (฿{Number(sel.dailyPrice).toLocaleString()})
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* 1. HOURLY: Horizontal Time Bar & Start/End Buttons */}
              {sel.mode === 'hourly' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--navy)' }}>
                      แตะแถบเวลาเพื่อเลือกช่วงเวลา (08:00 - 18:00 น.):
                    </div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      แตะจุดเริ่มและจุดสิ้นสุด
                    </span>
                  </div>

                  {/* The Horizontal Bar Component */}
                  {renderInteractiveTimelineBar(room, sel)}
                </div>
              )}

              {/* 2. HALF-DAY: Predefined Package Slots */}
              {sel.mode === 'halfday' && (
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '8px' }}>
                    เลือกรอบเวลาเหมาครึ่งวัน:
                  </div>
                  <div className="package-slots-grid">
                    <button
                      type="button"
                      disabled={halfDay0812Occupied}
                      onClick={() => setRoomSelections(prev => ({
                        ...prev,
                        [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '08-12' }
                      }))}
                      className={`package-slot-card ${sel.halfDaySlot === '08-12' ? 'package-slot-card--active' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '0.88rem' }}>รอบเช้า</span>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: halfDay0812Occupied ? '#fee2e2' : '#dcfce7',
                          color: halfDay0812Occupied ? '#dc2626' : '#15803d'
                        }}>
                          {halfDay0812Occupied ? 'ติดจอง' : 'ว่าง'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={13} /> 08:00 - 12:00 น. (4 ชม.)
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--primary)', marginTop: '4px' }}>
                        ฿{Number(sel.halfDayPrice).toLocaleString()}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={halfDay1317Occupied}
                      onClick={() => setRoomSelections(prev => ({
                        ...prev,
                        [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '13-17' }
                      }))}
                      className={`package-slot-card ${sel.halfDaySlot === '13-17' ? 'package-slot-card--active' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '0.88rem' }}>รอบบ่าย</span>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: halfDay1317Occupied ? '#fee2e2' : '#dcfce7',
                          color: halfDay1317Occupied ? '#dc2626' : '#15803d'
                        }}>
                          {halfDay1317Occupied ? 'ติดจอง' : 'ว่าง'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={13} /> 13:00 - 17:00 น. (4 ชม.)
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--primary)', marginTop: '4px' }}>
                        ฿{Number(sel.halfDayPrice).toLocaleString()}
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* 3. FULL-DAY: Predefined Package Slots */}
              {sel.mode === 'daily' && (
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '8px' }}>
                    เลือกรอบเวลาเหมาทั้งวัน:
                  </div>
                  <div className="package-slots-grid">
                    <button
                      type="button"
                      disabled={daily0817Occupied}
                      onClick={() => setRoomSelections(prev => ({
                        ...prev,
                        [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '08-17' }
                      }))}
                      className={`package-slot-card ${sel.dailySlot === '08-17' ? 'package-slot-card--active' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '0.88rem' }}>ช่วงเช้าถึงเย็น</span>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: daily0817Occupied ? '#fee2e2' : '#dcfce7',
                          color: daily0817Occupied ? '#dc2626' : '#15803d'
                        }}>
                          {daily0817Occupied ? 'ติดจอง' : 'ว่าง'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={13} /> 08:00 - 17:00 น. (9 ชม.)
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--primary)', marginTop: '4px' }}>
                        ฿{Number(sel.dailyPrice).toLocaleString()}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={daily0918Occupied}
                      onClick={() => setRoomSelections(prev => ({
                        ...prev,
                        [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '09-18' }
                      }))}
                      className={`package-slot-card ${sel.dailySlot === '09-18' ? 'package-slot-card--active' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '0.88rem' }}>ช่วงสายถึงหัวค่ำ</span>
                        <span style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: daily0918Occupied ? '#fee2e2' : '#dcfce7',
                          color: daily0918Occupied ? '#dc2626' : '#15803d'
                        }}>
                          {daily0918Occupied ? 'ติดจอง' : 'ว่าง'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={13} /> 09:00 - 18:00 น. (9 ชม.)
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 900, color: 'var(--primary)', marginTop: '4px' }}>
                        ฿{Number(sel.dailyPrice).toLocaleString()}
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Summary Box & Action Button */}
              <div style={{
                marginTop: '8px',
                padding: '14px',
                borderRadius: '10px',
                backgroundColor: '#ffffff',
                border: '1.5px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  <span>ห้องที่เลือก:</span>
                  <strong style={{ color: 'var(--navy)' }}>{room.name}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  <span>วันและเวลา:</span>
                  <strong style={{ color: 'var(--navy)' }}>{formatToDdMmYyyy(dateStr)} ({sel.startTime} - {sel.endTime} น.)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  <span>ระยะเวลา:</span>
                  <strong style={{ color: 'var(--primary)' }}>
                    {sel.duration} ชม. {sel.mode === 'hourly' && sel.duration % 1 !== 0 ? `(คิดราคา ${Math.ceil(sel.duration)} ชม.)` : ''} ({sel.rateLabel})
                  </strong>
                </div>

                {sel.isPromotionApplied && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#16a34a', fontWeight: 600 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Sparkles size={13} /> ส่วนลดจองออนไลน์ {sel.discountValue ?? (promotion?.discount_value || 5)}%
                    </span>
                    <span>-฿{Number(sel.discountAmount).toLocaleString()}</span>
                  </div>
                )}

                <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>ยอดชำระสุทธิ</div>
                    <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--primary)' }}>
                      ฿{Number(sel.totalPrice).toLocaleString()}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isOccupied}
                    onClick={() => handleProceedToForm(room)}
                    className="btn-primary"
                    id={`btn-book-room-${room.id}`}
                    style={{
                      width: 'auto',
                      minWidth: '160px',
                      height: '48px',
                      fontSize: '0.95rem',
                      backgroundColor: isOccupied ? '#cbd5e1' : undefined
                    }}
                  >
                    <span>{isOccupied ? 'ช่วงเวลานี้ไม่ว่าง' : 'กรอกข้อมูลผู้จอง'}</span>
                    {!isOccupied && <ChevronRight size={18} />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="main-content">
      {/* 3-STEP WIZARD PROGRESS BAR */}
      <StepProgress currentStep={1} />

      {/* 1. INTERACTIVE MONTHLY CALENDAR CARD (NAVY & TEAL) */}
      <section className="customer-cal-card" aria-label="ปฏิทินเลือกวันจองห้องประชุม">
        {/* Month Navigation Bar */}
        <div className="customer-cal-nav">
          <div className="customer-cal-nav__title-group">
            <Calendar size={20} color="var(--primary)" />
            <h2 className="customer-cal-nav__title">
              {formatThaiMonthYear(currentMonthKey)}
            </h2>
          </div>

          <div className="customer-cal-nav__controls">
            <button
              type="button"
              className="customer-cal-nav__btn"
              onClick={() => changeMonth(-1)}
              title="เดือนก่อนหน้า"
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeft size={18} />
            </button>

            <button
              type="button"
              className="customer-cal-nav__today-pill"
              onClick={jumpToToday}
              title="ไปที่วันนี้"
            >
              วันนี้
            </button>

            <button
              type="button"
              className="customer-cal-nav__btn"
              onClick={() => changeMonth(1)}
              title="เดือนถัดไป"
              aria-label="เดือนถัดไป"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* 7-Column Weekday Headers (จ. - อา.) */}
        <div className="customer-cal-weekdays" aria-hidden="true">
          {WEEKDAYS.map(w => (
            <span key={w} className="customer-cal-weekday">{w}</span>
          ))}
        </div>

        {/* Monthly Calendar Grid */}
        <div className="customer-cal-grid" role="group" aria-label="ตารางวันที่ในเดือน">
          {calendarWeeks.map((week, wIdx) => (
            <div key={wIdx} className="customer-cal-row">
              {week.map((cell, cIdx) => {
                if (!cell) {
                  return <div key={`empty-${cIdx}`} className="customer-cal-day customer-cal-day--empty" />;
                }

                const isSelected = cell.date === dateStr;
                const hasFree = cell.freeRoomsCount > 0;
                const isPast = cell.isPast;

                return (
                  <button
                    type="button"
                    key={cell.date}
                    disabled={isPast}
                    className={`customer-cal-day ${cell.isToday ? 'customer-cal-day--today' : ''} ${isSelected ? 'customer-cal-day--selected' : ''} ${isPast ? 'customer-cal-day--past' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => handleDateTap(cell.date)}
                    title={isPast ? `${cell.dayNumber} (ผ่านมาแล้ว)` : `${cell.dayNumber} (${hasFree ? `ว่าง ${cell.freeRoomsCount} ห้อง` : 'เต็ม'})`}
                  >
                    <span className="customer-cal-day__num">{cell.dayNumber}</span>
                    <span className={`customer-cal-day__badge ${isPast ? 'customer-cal-day__badge--past' : hasFree ? 'customer-cal-day__badge--free' : 'customer-cal-day__badge--full'}`}>
                      {isPast ? 'ผ่านแล้ว' : hasFree ? `${cell.freeRoomsCount} ห้อง` : 'เต็ม'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* 2. SUMMARY FILTER BAR ABOVE ROOM RESULTS */}
      <div className="customer-summary-filter-bar">
        <div className="customer-summary-filter-info">
          <div className="customer-summary-filter-icon">
            <Calendar size={18} />
          </div>
          <div>
            <div className="customer-summary-filter-text">
              {searchMode === 'byGuests'
                ? `${formatShortThaiDate(dateStr)} · ${guests} คน`
                : `${formatShortThaiDate(dateStr)} · ห้อง ${directSelectedRoom?.name || 'ที่เลือก'}`}
            </div>
            <div className="customer-summary-filter-sub">
              {searchMode === 'byGuests' ? 'ค้นหาตามจำนวนคน' : 'ค้นหาแบบระบุห้อง'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenEditModal}
          className="customer-summary-filter-change-btn"
          id="btn-open-change-filter"
        >
          <Edit3 size={14} />
          <span>เปลี่ยน</span>
        </button>
      </div>

      {/* 3. ROOM CARDS LIST */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px auto' }} />
          <div>กำลังโหลดข้อมูลห้องประชุมและเวลาว่าง…</div>
        </div>
      ) : searchMode === 'byGuests' ? (
        /* MODE: BY GUESTS (GROUP 1: ห้องที่เหมาะกับจำนวนคน, GROUP 2: ห้องใหญ่ขึ้น) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* GROUP 1: ห้องที่เหมาะกับจำนวนคน */}
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={16} color="var(--primary)" />
              <span>ห้องที่เหมาะกับจำนวนคน ({guests} ท่าน)</span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>({recommendedRooms.length} ห้อง)</span>
            </div>

            {recommendedRooms.length === 0 ? (
              <div style={{ padding: '20px', backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid var(--border)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                ไม่มีห้องขนาดพอดีกับจำนวนนี้ แต่สามารถดูตัวเลือกห้องขนาดใหญ่ขึ้นด้านล่างได้
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {recommendedRooms.map(r => renderRoomCard(r, false))}
              </div>
            )}
          </div>

          {/* GROUP 2: ห้องใหญ่ขึ้น เพิ่มความสบาย */}
          {upgradeRooms.length > 0 && (
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} color="#0284c7" />
                <span>ห้องใหญ่ขึ้น เพิ่มความสบาย</span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>({upgradeRooms.length} ห้อง)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {upgradeRooms.map(r => renderRoomCard(r, true))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* MODE: DIRECT ROOM (SHOWS ONLY THE SELECTED ROOM) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {directSelectedRoom ? (
            renderRoomCard(directSelectedRoom, false)
          ) : (
            allSortedRooms.map(r => renderRoomCard(r, false))
          )}
        </div>
      )}

      {/* 4. BOTTOM SHEET MODAL (SLIDES UP FROM BOTTOM ON MOBILE) */}
      {isModalOpen && (
        <div
          className="bottom-sheet-overlay"
          onClick={handleCloseModal}
          id="modal-backdrop-overlay"
        >
          <div
            className="bottom-sheet-container"
            onClick={(e) => e.stopPropagation()}
            id="modal-sheet-content"
          >
            {/* Handle Bar on Mobile */}
            <div className="bottom-sheet-handle" />

            {/* Modal Header: Date in clear Thai format */}
            <div className="bottom-sheet-header">
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>
                  กำหนดตัวเลือกการจอง
                </div>
                <h3 className="bottom-sheet-title" id="modal-date-title">
                  {formatModalHeaderDate(modalDate)}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="bottom-sheet-close-btn"
                aria-label="ปิดหน้าต่าง"
                id="btn-close-modal"
              >
                <X size={20} />
              </button>
            </div>

            {/* Segmented Mode Control (ตามจำนวนคน vs ระบุห้อง) */}
            <div className="modal-mode-tabs">
              <button
                type="button"
                onClick={() => setModalMode('byGuests')}
                className={`modal-mode-tab ${modalMode === 'byGuests' ? 'modal-mode-tab--active' : ''}`}
                id="tab-mode-by-guests"
              >
                <Users size={16} />
                <span>ตามจำนวนคน</span>
              </button>
              <button
                type="button"
                onClick={() => setModalMode('directRoom')}
                className={`modal-mode-tab ${modalMode === 'directRoom' ? 'modal-mode-tab--active' : ''}`}
                id="tab-mode-direct-room"
              >
                <Building size={16} />
                <span>ระบุห้อง</span>
              </button>
            </div>

            {/* Modal Body: Mode 'byGuests' */}
            {modalMode === 'byGuests' ? (
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--navy)', marginBottom: '8px', display: 'block', textAlign: 'center' }}>
                  จำนวนผู้เข้าใช้งาน (Attendees)
                </label>

                {/* Counter Control: [-] [ Input ] [+] */}
                <div className="counter-box">
                  <button
                    type="button"
                    disabled={!modalGuests || modalGuests <= 1}
                    onClick={() => setModalGuests(g => Math.max(1, (parseInt(g, 10) || 1) - 1))}
                    className="counter-btn"
                    id="btn-guest-decrement"
                    aria-label="ลดจำนวนคน"
                  >
                    <Minus size={20} />
                  </button>

                  <div className="counter-input-wrap">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={modalGuests}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (isNaN(val)) {
                          setModalGuests('');
                        } else {
                          setModalGuests(Math.max(1, val));
                        }
                      }}
                      className="counter-input"
                      id="input-modal-guests"
                    />
                    <span style={{ position: 'absolute', right: '12px', fontSize: '0.9rem', fontWeight: 800, color: 'var(--navy)', pointerEvents: 'none' }}>
                      ท่าน
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setModalGuests(g => (parseInt(g, 10) || 0) + 1)}
                    className="counter-btn"
                    id="btn-guest-increment"
                    aria-label="เพิ่มจำนวนคน"
                  >
                    <Plus size={20} />
                  </button>
                </div>

                <div style={{ textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                  ระบบจะค้นหาห้องที่พอดีและห้องขนาดใหญ่ขึ้นสำหรับ {modalGuests || 1} ท่าน
                </div>
              </div>
            ) : (
              /* Modal Body: Mode 'directRoom' */
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--navy)', marginBottom: '8px', display: 'block' }}>
                  เลือกห้องประชุมที่ต้องการ:
                </label>

                <select
                  value={modalRoomId}
                  onChange={(e) => setModalRoomId(e.target.value)}
                  className="form-input"
                  id="select-modal-room"
                  style={{ height: '48px', fontSize: '0.92rem', fontWeight: 700, borderRadius: '12px' }}
                >
                  <option value="">-- กรุณาเลือกห้องประชุม --</option>
                  {allSortedRooms.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} (รองรับ {r.capacity} ท่าน{r.has_classroom === 1 && r.classroom_capacity ? ` / โต๊ะเรียน ${r.classroom_capacity} ท่าน` : ''})
                    </option>
                  ))}
                </select>

                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                  ระบบจะแสดงเฉพาะห้องที่คุณเลือก พร้อมสถานะและช่วงเวลาว่างของวันนั้น
                </div>
              </div>
            )}

            {/* Confirm "ตกลง" Button */}
            <button
              type="button"
              disabled={modalMode === 'byGuests' ? (!modalGuests || modalGuests < 1) : !modalRoomId}
              onClick={handleConfirmModal}
              className="btn-primary"
              id="btn-confirm-modal"
              style={{ width: '100%', height: '50px', fontSize: '1rem', marginTop: '4px' }}
            >
              <span>ตกลง</span>
              <Check size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
