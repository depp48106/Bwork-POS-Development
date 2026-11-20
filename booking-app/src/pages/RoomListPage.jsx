import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Users, Wifi, Tv, Wind, CheckCircle2,
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp, ChevronLeft, Calendar, Clock, Sparkles, Building, AlertCircle, Filter, Check
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

const formatThaiDateDesc = (isoStr) => {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dayName = THAI_DAYS[date.getDay()];
  const monthName = THAI_MONTHS_FULL[m - 1];
  const thaiYear = y + 543;
  return `วัน${dayName}ที่ ${d} ${monthName} ${thaiYear}`;
};

const formatThaiMonthYear = (monthKey) => {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-').map(Number);
  const monthName = THAI_MONTHS_FULL[m - 1];
  const thaiYear = y + 543;
  return `${monthName} ${thaiYear}`;
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

  // Try to restore previous draft from sessionStorage on mount
  const savedDraft = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('current_booking_payload');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }, []);

  // Determine initial date (query param > saved draft > today)
  const initialDate = useMemo(() => {
    const qDate = query.get('date');
    if (qDate && qDate >= todayIso) return qDate;
    if (savedDraft?.date && savedDraft.date >= todayIso) return savedDraft.date;
    return todayIso;
  }, [query, savedDraft, todayIso]);

  const [dateStr, setDateStr] = useState(initialDate);
  const [currentMonthKey, setCurrentMonthKey] = useState(initialDate.slice(0, 7));

  // Expanded Room (accordion) - defaults to query param or draft room_id
  const initialExpandedRoomId = useMemo(() => {
    const qRoom = query.get('roomId');
    if (qRoom) return parseInt(qRoom, 10) || qRoom;
    if (savedDraft?.room_id) return savedDraft.room_id;
    return null;
  }, [query, savedDraft]);

  const [expandedRoomId, setExpandedRoomId] = useState(initialExpandedRoomId);

  // Filter category: 'all' | 'small' (1-4) | 'medium' (8-12) | 'large' (40)
  const [capacityFilter, setCapacityFilter] = useState('all');

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
    if (qRoom !== null) {
      const parsedId = parseInt(qRoom, 10) || qRoom;
      setExpandedRoomId(parsedId || null);
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
    handleDateSelect(todayIso);
  };

  const handleDateSelect = (newDate) => {
    if (newDate < todayIso) return;
    setDateStr(newDate);
    const newMonth = newDate.slice(0, 7);
    if (newMonth !== currentMonthKey) {
      setCurrentMonthKey(newMonth);
    }
    navigate(`/rooms?date=${newDate}${expandedRoomId ? `&roomId=${expandedRoomId}` : ''}`, { replace: true });
  };

  // Build Calendar Weeks for Monthly Interactive Grid
  const calendarWeeks = useMemo(() => {
    const monthInfo = getAvailabilityMonth(currentMonthKey);
    if (!monthInfo) return [];
    const { days, firstWeekday } = monthInfo;
    const cells = [];

    // Empty cells before first day of month
    for (let i = 0; i < firstWeekday; i++) {
      cells.push(null);
    }

    // Days of month
    for (let d = 1; d <= days; d++) {
      const dayDateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
      const isPast = dayDateStr < todayIso;
      const isDayToday = dayDateStr === todayIso;

      // Free rooms count calculation on this day
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

  // Robust time string extractor
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

    const roomObj = schedule.rooms.find(r => r.id === roomId);
    if (!roomObj || !roomObj.bookings || roomObj.bookings.length === 0) {
      return { isOccupied: false, label: 'ว่างพร้อมจอง' };
    }

    const bufferMins = Number(schedule.cleaning_buffer_minutes || schedule.buffer_minutes) || 30;

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

    return { isOccupied: false, label: 'ว่างพร้อมจอง' };
  };

  // Filtered rooms list
  const filteredRooms = useMemo(() => {
    const sorted = sortRoomsByStandardOrder(rooms);
    if (capacityFilter === 'small') {
      return sorted.filter(r => (r.capacity || 4) <= 4);
    }
    if (capacityFilter === 'medium') {
      return sorted.filter(r => (r.capacity || 4) >= 8 && (r.capacity || 4) <= 12);
    }
    if (capacityFilter === 'large') {
      return sorted.filter(r => (r.capacity || 4) > 12);
    }
    return sorted;
  }, [rooms, capacityFilter]);

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
      guests: sel.effectiveCapacity,
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

  // Render Visual Timeline Bar (08:00 - 18:00, 20 slots of 30 mins)
  const renderTimelineBar = (room, sel) => {
    const roomObj = schedule?.rooms?.find(r => r.id === room.id);
    const bookings = (roomObj?.bookings || []).filter(b => b.status !== 'cancelled' && b.payment_status !== 'cancelled');
    const bufferMins = Number(schedule?.cleaning_buffer_minutes || schedule?.buffer_minutes) || 30;

    const [selSH, selSM] = sel.startTime.split(':').map(Number);
    const [selEH, selEM] = sel.endTime.split(':').map(Number);
    const selStartMins = selSH * 60 + selSM;
    const selEndMins = selEH * 60 + selEM;

    const slots = [];
    for (let i = 0; i < 20; i++) {
      const slotStart = 8 * 60 + i * 30;
      const slotEnd = slotStart + 30;
      const isPast = isToday && slotStart < currentMins;

      let type = 'available';

      // 1. Check if booked
      const isBooked = bookings.some(b => {
        const bS = extractHHMM(b.start_time);
        const bE = extractHHMM(b.end_time);
        if (!bS || !bE) return false;
        const [bSH, bSM] = bS.split(':').map(Number);
        const [bEH, bEM] = bE.split(':').map(Number);
        const bStartMins = bSH * 60 + bSM;
        const bEndMins = bEH * 60 + bEM;
        return slotStart < bEndMins && slotEnd > bStartMins;
      });

      // 2. Check if in cleaning buffer
      const isCleaning = !isBooked && bookings.some(b => {
        const bE = extractHHMM(b.end_time);
        if (!bE) return false;
        const [bEH, bEM] = bE.split(':').map(Number);
        const bEndMins = bEH * 60 + bEM;
        return bEndMins <= slotStart && slotStart < bEndMins + bufferMins && bEndMins < 18 * 60;
      });

      // 3. Check if in user selection
      const isSelected = slotStart >= selStartMins && slotEnd <= selEndMins;

      if (isSelected) {
        type = 'selected';
      } else if (isBooked) {
        type = 'booked';
      } else if (isCleaning) {
        type = 'cleaning';
      } else if (isPast) {
        type = 'past';
      }

      slots.push({ index: i, type });
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
        <div className="timeline-bar-track">
          {slots.map(s => (
            <div
              key={s.index}
              className={`timeline-segment timeline-segment--${s.type}`}
              title={`ช่วงเวลา ${(8 + Math.floor(s.index / 2)).toString().padStart(2, '0')}:${(s.index % 2 === 0 ? '00' : '30')}`}
            />
          ))}
        </div>
        <div className="timeline-legend">
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#0F766E' }} /> เวลาที่เลือก</span>
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#10b981' }} /> ว่าง</span>
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#ef4444' }} /> ติดจอง</span>
          <span><span className="timeline-legend-dot" style={{ backgroundColor: '#f59e0b' }} /> ทำความสะอาด</span>
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
                    onClick={() => handleDateSelect(cell.date)}
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

      {/* 2. SECTION TITLE & CAPACITY FILTER PILLS */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--navy)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building size={20} color="var(--primary)" />
              <span>ห้องประชุมสำหรับ {formatThaiDateDesc(dateStr)}</span>
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              คลิก “ดูเวลาว่าง” เพื่อเลือกรอบเวลาและตรวจสอบราคา
            </p>
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--primary)', backgroundColor: 'var(--primary-light)', padding: '4px 10px', borderRadius: '999px' }}>
            พบ {filteredRooms.length} ห้อง
          </span>
        </div>

        {/* Filter Pills */}
        <div className="customer-filter-bar">
          <button
            type="button"
            className={`customer-filter-tab ${capacityFilter === 'all' ? 'customer-filter-tab--active' : ''}`}
            onClick={() => setCapacityFilter('all')}
          >
            ทั้งหมด ({rooms.length})
          </button>
          <button
            type="button"
            className={`customer-filter-tab ${capacityFilter === 'small' ? 'customer-filter-tab--active' : ''}`}
            onClick={() => setCapacityFilter('small')}
          >
            <Users size={14} /> 1-4 ท่าน
          </button>
          <button
            type="button"
            className={`customer-filter-tab ${capacityFilter === 'medium' ? 'customer-filter-tab--active' : ''}`}
            onClick={() => setCapacityFilter('medium')}
          >
            <Users size={14} /> 8-12 ท่าน
          </button>
          <button
            type="button"
            className={`customer-filter-tab ${capacityFilter === 'large' ? 'customer-filter-tab--active' : ''}`}
            onClick={() => setCapacityFilter('large')}
          >
            <Users size={14} /> ห้องใหญ่ (40 ท่าน)
          </button>
        </div>
      </div>

      {/* 3. ROOM CARDS LIST */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px auto' }} />
          <div>กำลังโหลดข้อมูลห้องประชุมและเวลาว่าง…</div>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', backgroundColor: '#ffffff', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <Building size={48} color="var(--text-muted)" style={{ margin: '0 auto 12px auto' }} />
          <h4 style={{ margin: '0 0 6px 0', color: 'var(--navy)' }}>ไม่พบห้องประชุมในหมวดนี้</h4>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>ลองเลือกตัวกรองอื่น หรือเปลี่ยนวันที่ต้องการใช้งาน</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredRooms.map(room => {
            const isExpanded = expandedRoomId === room.id;
            const sel = getRoomSelection(room);
            const { isOccupied, label: statusLabel, reason } = getRoomOccupiedInfo(room.id, sel.startTime, sel.endTime);
            const currentLayout = roomLayouts[room.id] || 'standard';
            const isClassroom = currentLayout === 'classroom';
            const rawImage = isClassroom && room.classroom_image_url ? room.classroom_image_url : room.image_url;
            const displayImage = getRoomImageUrl(room, isClassroom);

            return (
              <div
                key={room.id}
                id={`room-card-${room.id}`}
                className="room-card-container"
                style={{
                  borderColor: isExpanded ? 'var(--primary)' : undefined,
                  boxShadow: isExpanded ? '0 6px 24px rgba(15, 118, 110, 0.14)' : undefined
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

                  {/* Status Overlay Badge */}
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

                    {/* Amenities Row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '10px 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Wifi size={13} color="var(--primary)" /> Wi-Fi ฟรี</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Tv size={13} color="var(--primary)" /> จอ TV/โปรเจคเตอร์</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Wind size={13} color="var(--primary)" /> เครื่องปรับอากาศ</span>
                    </div>

                    {/* Classroom Toggle if room supports classroom */}
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
                      {isExpanded ? 'กำลังกำหนดช่วงเวลา' : 'คลิกเพื่อเลือกเวลาที่ต้องการ'}
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedRoomId(prev => (prev === room.id ? null : room.id))}
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
                      {/* Package Tabs */}
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '6px' }}>
                          เลือกแพ็กเกจการจอง:
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {sel.hasHourly && (
                            <button
                              type="button"
                              onClick={() => setRoomSelections(prev => ({
                                ...prev,
                                [room.id]: { ...(prev[room.id] || {}), mode: 'hourly' }
                              }))}
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
                              onClick={() => setRoomSelections(prev => ({
                                ...prev,
                                [room.id]: { ...(prev[room.id] || {}), mode: 'halfday' }
                              }))}
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
                              onClick={() => setRoomSelections(prev => ({
                                ...prev,
                                [room.id]: { ...(prev[room.id] || {}), mode: 'daily' }
                              }))}
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

                      {/* Time Pickers for Hourly */}
                      {sel.mode === 'hourly' && (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                              <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>
                                เวลาเริ่มต้น (Start Time):
                              </label>
                              <select
                                value={sel.rawStartTime}
                                onChange={(e) => {
                                  const newStart = e.target.value;
                                  const [sH, sM] = newStart.split(':').map(Number);
                                  const startMins = sH * 60 + sM;
                                  const [curEndH, curEndM] = (sel.rawEndTime || '18:00').split(':').map(Number);
                                  const curEndMins = curEndH * 60 + curEndM;
                                  let newEndMins = curEndMins <= startMins ? startMins + 60 : curEndMins;
                                  if (newEndMins > 18 * 60) newEndMins = 18 * 60;
                                  const eH = Math.floor(newEndMins / 60).toString().padStart(2, '0');
                                  const eM = (newEndMins % 60).toString().padStart(2, '0');
                                  const newEnd = `${eH}:${eM}`;

                                  setRoomSelections(prev => ({
                                    ...prev,
                                    [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStart, endTime: newEnd }
                                  }));
                                }}
                                className="form-input"
                                style={{ height: '42px', fontSize: '0.9rem', fontWeight: 700, borderRadius: '8px' }}
                              >
                                {availableStartOptions.map(t => (
                                  <option key={t} value={t}>{t} น.</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>
                                เวลาสิ้นสุด (End Time):
                              </label>
                              <select
                                value={sel.rawEndTime}
                                onChange={(e) => {
                                  setRoomSelections(prev => ({
                                    ...prev,
                                    [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: e.target.value }
                                  }));
                                }}
                                className="form-input"
                                style={{ height: '42px', fontSize: '0.9rem', fontWeight: 700, borderRadius: '8px' }}
                              >
                                {TIME_OPTIONS.filter(t => t > sel.rawStartTime).map(t => (
                                  <option key={t} value={t}>{t} น.</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Visual Timeline Bar */}
                          {renderTimelineBar(room, sel)}
                        </div>
                      )}

                      {/* Half-Day Options */}
                      {sel.mode === 'halfday' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setRoomSelections(prev => ({
                              ...prev,
                              [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '08-12' }
                            }))}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: sel.halfDaySlot === '08-12' ? '2px solid #7c3aed' : '1px solid var(--border)',
                              backgroundColor: sel.halfDaySlot === '08-12' ? '#7c3aed' : '#ffffff',
                              color: sel.halfDaySlot === '08-12' ? '#ffffff' : 'var(--text-main)',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            รอบเช้า (08:00 - 12:00 น.)
                          </button>
                          <button
                            type="button"
                            onClick={() => setRoomSelections(prev => ({
                              ...prev,
                              [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '13-17' }
                            }))}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: sel.halfDaySlot === '13-17' ? '2px solid #7c3aed' : '1px solid var(--border)',
                              backgroundColor: sel.halfDaySlot === '13-17' ? '#7c3aed' : '#ffffff',
                              color: sel.halfDaySlot === '13-17' ? '#ffffff' : 'var(--text-main)',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            รอบบ่าย (13:00 - 17:00 น.)
                          </button>
                        </div>
                      )}

                      {/* Daily Options */}
                      {sel.mode === 'daily' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setRoomSelections(prev => ({
                              ...prev,
                              [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '08-17' }
                            }))}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: sel.dailySlot === '08-17' ? '2px solid #059669' : '1px solid var(--border)',
                              backgroundColor: sel.dailySlot === '08-17' ? '#059669' : '#ffffff',
                              color: sel.dailySlot === '08-17' ? '#ffffff' : 'var(--text-main)',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            08:00 - 17:00 น.
                          </button>
                          <button
                            type="button"
                            onClick={() => setRoomSelections(prev => ({
                              ...prev,
                              [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '09-18' }
                            }))}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: sel.dailySlot === '09-18' ? '2px solid #059669' : '1px solid var(--border)',
                              backgroundColor: sel.dailySlot === '09-18' ? '#059669' : '#ffffff',
                              color: sel.dailySlot === '09-18' ? '#ffffff' : 'var(--text-main)',
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            09:00 - 18:00 น.
                          </button>
                        </div>
                      )}

                      {/* Summary Box & Action Button */}
                      <div style={{
                        marginTop: '8px',
                        padding: '12px',
                        borderRadius: '10px',
                        backgroundColor: '#ffffff',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          <span>ห้องที่เลือก:</span>
                          <strong style={{ color: 'var(--navy)' }}>{room.name}</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          <span>วันและเวลา:</span>
                          <strong style={{ color: 'var(--navy)' }}>{formatToDdMmYyyy(dateStr)} ({sel.startTime} - {sel.endTime} น.)</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          <span>ระยะเวลา:</span>
                          <strong style={{ color: 'var(--primary)' }}>{sel.duration} ชม. ({sel.rateLabel})</strong>
                        </div>

                        {sel.isPromotionApplied && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#16a34a', fontWeight: 600 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <Sparkles size={13} /> ส่วนลดจองออนไลน์ {sel.discountValue ?? (promotion?.discount_value || 5)}%
                            </span>
                            <span>-฿{Number(sel.discountAmount).toLocaleString()}</span>
                          </div>
                        )}

                        <div style={{ borderTop: '1px dashed var(--border)', margin: '4px 0' }} />

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>ยอดชำระสุทธิ</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)' }}>
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
          })}
        </div>
      )}
    </div>
  );
}
