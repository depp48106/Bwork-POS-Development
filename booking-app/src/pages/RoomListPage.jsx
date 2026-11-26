import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Users, Wifi, Tv, Wind, CheckCircle2,
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp, ChevronLeft, Calendar, Clock, Sparkles, Building, AlertCircle, Check, Edit3, X, Minus, Plus
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';
import { calculateOnlineBookingPricing } from '../utils/onlinePromotionHelper';
import { getRoomImageUrl, handleRoomImageError } from '../utils/roomImageHelper';
import { getBangkokNow, getMinStartMinutesToday, isStartTimePastBangkok } from '../utils/bangkokTime';
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

const getBangkokTodayIso = () => getBangkokNow().dateIso;

export default function RoomListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);

  const [bangkokNow, setBangkokNow] = useState(() => getBangkokNow());
  const todayIso = bangkokNow.dateIso;
  const currentMins = bangkokNow.minutes;

  // Real-time Asia/Bangkok time monitor (15s interval + focus/visibility)
  useEffect(() => {
    const updateTimeAndStatus = () => {
      const now = getBangkokNow();
      setBangkokNow(now);
    };
    const interval = setInterval(updateTimeAndStatus, 15000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') updateTimeAndStatus();
    };
    window.addEventListener('focus', updateTimeAndStatus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', updateTimeAndStatus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Try to restore previous draft from sessionStorage or navigation state
  const savedDraft = useMemo(() => {
    if (location.state && location.state.room_id) {
      return location.state;
    }
    const hasExplicitParams = Boolean(
      query.get('date') || query.get('roomId') || query.get('guests') || query.get('mode')
    );
    if (hasExplicitParams) {
      return null;
    }
    try {
      const raw = sessionStorage.getItem('current_booking_payload');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }, [location.state, location.search]);

  // Determine initial date (query param > saved draft > today / tomorrow if today expired)
  const initialDate = useMemo(() => {
    const qDate = query.get('date');
    if (qDate && qDate >= todayIso) return qDate;
    if (savedDraft?.date && savedDraft.date >= todayIso) return savedDraft.date;
    if (currentMins >= 17 * 60 + 30) {
      return bangkokNow.tomorrowIso;
    }
    return todayIso;
  }, [query, savedDraft, todayIso, currentMins, bangkokNow.tomorrowIso]);

  // Confirmed States in effect
  const [dateStr, setDateStr] = useState(initialDate);
  const [currentMonthKey, setCurrentMonthKey] = useState(initialDate.slice(0, 7));

  // Confirmed Search Mode: 'byGuests' (default) vs 'directRoom'
  const initialMode = useMemo(() => {
    const qMode = query.get('mode');
    if (qMode === 'byGuests' || qMode === 'directRoom') return qMode;
    if (location.state?.search_mode === 'byGuests' || location.state?.search_mode === 'directRoom') {
      return location.state.search_mode;
    }
    if (query.get('roomId') !== null && query.get('roomId') !== '') return 'directRoom';
    if (query.get('guests')) return 'byGuests';
    if (savedDraft?.search_mode === 'byGuests' || savedDraft?.search_mode === 'directRoom') {
      return savedDraft.search_mode;
    }
    if (savedDraft?.guests) return 'byGuests';
    if (savedDraft?.room_id) return 'directRoom';
    return 'byGuests';
  }, [query, location.state, savedDraft]);

  const [searchMode, setSearchMode] = useState(initialMode);

  // Determine if there is an explicit query param or navigation state selection
  const hasUrlOrDraftSelection = useMemo(() => {
    return Boolean(query.get('date') || query.get('roomId') || query.get('guests') || location.state?.room_id || location.state?.date);
  }, [query, location.state]);

  const [hasConfirmedDate, setHasConfirmedDate] = useState(hasUrlOrDraftSelection);

  // Confirmed Guest count - NO default 10 or 4!
  const initialGuests = useMemo(() => {
    const qGuests = query.get('guests');
    if (qGuests) {
      const parsed = parseInt(qGuests, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (location.state?.guests) {
      const parsed = parseInt(location.state.guests, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    if (savedDraft?.guests) {
      const parsed = parseInt(savedDraft.guests, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return '';
  }, [query, location.state, savedDraft]);

  const [guests, setGuests] = useState(initialGuests);

  // Confirmed Direct Room ID
  const initialRoomId = useMemo(() => {
    const qRoom = query.get('roomId');
    if (qRoom !== null && qRoom !== '') return parseInt(qRoom, 10) || qRoom;
    if (location.state?.room_id) return location.state.room_id;
    if (savedDraft?.room_id) return savedDraft.room_id;
    return null;
  }, [query, location.state, savedDraft]);

  const [confirmedRoomId, setConfirmedRoomId] = useState(initialRoomId);

  // Expanded Room (accordion / time selector)
  const [expandedRoomId, setExpandedRoomId] = useState(initialRoomId);
  const [directGuestError, setDirectGuestError] = useState('');
  const [modalError, setModalError] = useState('');
  const [timelineError, setTimelineError] = useState('');
  const [timelineTapStep, setTimelineTapStep] = useState({});
  const draggingRef = useRef(null);

  // Optional time range filter for 'byGuests' mode (e.g. start=10:00&end=12:00)
  const initialFilterStart = useMemo(() => {
    const qStart = query.get('start');
    return qStart && /^\d{2}:\d{2}$/.test(qStart) ? qStart : '';
  }, [query]);
  const initialFilterEnd = useMemo(() => {
    const qEnd = query.get('end');
    return qEnd && /^\d{2}:\d{2}$/.test(qEnd) ? qEnd : '';
  }, [query]);

  const [filterStartTime, setFilterStartTime] = useState(initialFilterStart);
  const [filterEndTime, setFilterEndTime] = useState(initialFilterEnd);

  // -------------------------------------------------------------
  // Bottom Sheet Modal States (staged values until "ตกลง" is pressed)
  // -------------------------------------------------------------
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState(initialDate);
  const [modalMode, setModalMode] = useState(initialMode);
  const [modalGuests, setModalGuests] = useState(initialGuests);
  const [modalRoomId, setModalRoomId] = useState(initialRoomId || '');
  const [modalStartTime, setModalStartTime] = useState(initialFilterStart);
  const [modalEndTime, setModalEndTime] = useState(initialFilterEnd);

  // Master Data States
  const [rooms, setRooms] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [availabilityData, setAvailabilityData] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [loading, setLoading] = useState(true);

  // Per-Room Selections State: { [roomId]: { mode, startTime, endTime, halfDaySlot, dailySlot } }
  const initialDraftSelection = useMemo(() => {
    if (!savedDraft?.room_id) return null;
    const bType = savedDraft.booking_type || 'hourly';
    return {
      mode: bType,
      startTime: savedDraft.start_time || '09:00',
      endTime: savedDraft.end_time || '11:00',
      halfDaySlot: savedDraft.start_time === '13:00' ? '13-17' : '08-12',
      dailySlot: savedDraft.start_time === '09:00' ? '09-18' : '08-17'
    };
  }, [savedDraft]);

  const [roomSelections, setRoomSelections] = useState(() => {
    if (savedDraft?.room_id && initialDraftSelection) {
      return {
        [savedDraft.room_id]: initialDraftSelection
      };
    }
    return {};
  });

  // Last explicitly selected time/package across rooms, preserved when switching rooms if supported & available
  const [lastTimeSelection, setLastTimeSelection] = useState(initialDraftSelection);

  useEffect(() => {
    if (expandedRoomId && roomSelections[expandedRoomId]) {
      setLastTimeSelection(roomSelections[expandedRoomId]);
    }
  }, [expandedRoomId, roomSelections]);

  // Per-Room Layout State: { [roomId]: 'standard' | 'classroom' }
  const [roomLayouts, setRoomLayouts] = useState(() => {
    if (savedDraft?.room_id && savedDraft.layout) {
      return { [savedDraft.room_id]: savedDraft.layout };
    }
    return {};
  });

  const isToday = dateStr === todayIso;

  // Real-time time protection: For today (Asia/Bangkok), filter out past/started slots
  const availableStartOptions = useMemo(() => {
    if (!isToday) {
      return TIME_OPTIONS.filter(t => t < '18:00');
    }
    return TIME_OPTIONS.filter(t => {
      if (t >= '18:00') return false;
      const [h, m] = t.split(':').map(Number);
      return (h * 60 + m) > currentMins;
    });
  }, [isToday, currentMins]);

  const defaultStart = availableStartOptions.length > 0 ? availableStartOptions[0] : '09:00';
  const [defH, defM] = defaultStart.split(':').map(Number);
  const defEndMins = Math.min(18 * 60, defH * 60 + defM + 60);
  const defaultEnd = `${Math.floor(defEndMins / 60).toString().padStart(2, '0')}:${(defEndMins % 60).toString().padStart(2, '0')}`;

  const [globalStartTime, setGlobalStartTime] = useState(defaultStart);
  const [globalEndTime, setGlobalEndTime] = useState(defaultEnd);

  useEffect(() => {
    setGlobalStartTime(defaultStart);
    setGlobalEndTime(defaultEnd);
  }, [dateStr, defaultStart, defaultEnd]);

  // Sync state if query parameters change externally
  useEffect(() => {
    const qDate = query.get('date');
    if (qDate && qDate >= todayIso && qDate !== dateStr) {
      setDateStr(qDate);
      if (qDate.slice(0, 7) !== currentMonthKey) {
        setCurrentMonthKey(qDate.slice(0, 7));
      }
    }

    const qMode = query.get('mode');
    const qRoom = query.get('roomId');
    const qGuests = query.get('guests');

    if (qMode === 'byGuests' || qMode === 'directRoom') {
      setSearchMode(qMode);
    } else if (location.state?.search_mode === 'byGuests' || location.state?.search_mode === 'directRoom') {
      setSearchMode(location.state.search_mode);
    } else if (qRoom !== null && qRoom !== '') {
      setSearchMode('directRoom');
    } else if (qGuests) {
      setSearchMode('byGuests');
    }

    if (qRoom !== null && qRoom !== '') {
      const parsedId = parseInt(qRoom, 10) || qRoom;
      setConfirmedRoomId(parsedId);
      setExpandedRoomId(parsedId);
    }

    if (qGuests) {
      const val = parseInt(qGuests, 10);
      if (!isNaN(val) && val > 0) {
        setGuests(val);
      }
    }

    if (location.state?.openEditModal) {
      setModalDate(qDate && qDate >= todayIso ? qDate : dateStr);
      const nextMode = (qMode === 'byGuests' || qMode === 'directRoom')
        ? qMode
        : (location.state.search_mode || searchMode || 'byGuests');
      setModalMode(nextMode);
      const gFromState = qGuests || location.state.guests || guests;
      setModalGuests(gFromState ? (parseInt(gFromState, 10) || '') : '');
      const rFromState = qRoom || location.state.room_id || confirmedRoomId || '';
      setModalRoomId(rFromState);
      setIsModalOpen(true);
    }
  }, [location.search, location.state]);

  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState(false);

  // Month navigation handlers
  const changeMonth = (delta) => {
    const [y, m] = currentMonthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const newMonthKey = d.toISOString().slice(0, 7);
    setCurrentMonthKey(newMonthKey);
  };

  const jumpToToday = () => {
    const liveBkk = getBangkokNow();
    setCurrentMonthKey(liveBkk.dateIso.slice(0, 7));
    if (liveBkk.minutes < 17 * 60 + 30) {
      handleDateTap(liveBkk.dateIso);
    } else {
      handleDateTap(liveBkk.tomorrowIso);
    }
  };

  // Fetch monthly availability intervals for current calendar month
  const fetchMonthlyAvailability = useCallback(async () => {
    setMonthLoading(true);
    setMonthError(false);
    try {
      const res = await fetch(`${API_BASE}/api/public/rooms/availability-month?month=${currentMonthKey}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.month === currentMonthKey) {
          setAvailabilityData(data);
          setMonthError(false);
        }
      } else {
        setMonthError(true);
      }
    } catch (err) {
      console.warn('Failed to load monthly availability:', err);
      setMonthError(true);
    } finally {
      setMonthLoading(false);
    }
  }, [currentMonthKey]);

  useEffect(() => {
    fetchMonthlyAvailability();
  }, [fetchMonthlyAvailability]);

  // Fetch active rooms, schedule for selected date, and promotion
  const fetchDailySchedule = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [roomsRes, scheduleRes, promoRes] = await Promise.all([
        fetch(`${API_BASE}/api/public/rooms`),
        fetch(`${API_BASE}/api/public/rooms/schedule?date=${dateStr}`),
        fetch(`${API_BASE}/api/public/promotion`).catch(() => null)
      ]);

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
    } catch (err) {
      console.warn('Failed to load room data:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [dateStr]);

  useEffect(() => {
    fetchDailySchedule(true);
  }, [fetchDailySchedule]);

  // Auto-refresh: live Bangkok clock (15s), visibilitychange, focus, and polling (30s when visible)
  useEffect(() => {
    const syncLiveClock = () => {
      setBangkokNow(getBangkokNow());
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncLiveClock();
        fetchMonthlyAvailability();
        fetchDailySchedule(false);
      }
    };
    const clockInterval = setInterval(syncLiveClock, 15000);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncLiveClock();
        fetchMonthlyAvailability();
        fetchDailySchedule(false);
      }
    }, 30000);

    window.addEventListener('focus', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(clockInterval);
      clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchMonthlyAvailability, fetchDailySchedule]);

  // When tapping a date on calendar: open bottom sheet modal with staged date
  const handleDateTap = (tappedDate) => {
    const liveBkk = getBangkokNow();
    if (tappedDate < liveBkk.dateIso) return;
    if (tappedDate === liveBkk.dateIso && liveBkk.minutes >= 17 * 60 + 30) return;
    setModalDate(tappedDate);
    setModalMode(searchMode || 'byGuests');
    setModalGuests(guests ? guests : '');
    setModalRoomId(confirmedRoomId || (rooms.length > 0 ? rooms[0].id : ''));
    setModalStartTime(filterStartTime);
    setModalEndTime(filterEndTime);
    setModalError('');
    setIsModalOpen(true);
  };

  // When clicking "เปลี่ยน" button above results: open modal with current confirmed values
  const handleOpenEditModal = () => {
    setModalDate(dateStr);
    setModalMode(searchMode || 'byGuests');
    setModalGuests(guests ? guests : '');
    setModalRoomId(confirmedRoomId || (rooms.length > 0 ? rooms[0].id : ''));
    setModalStartTime(filterStartTime);
    setModalEndTime(filterEndTime);
    setModalError('');
    setIsModalOpen(true);
  };

  // Close modal without saving changes
  const handleCloseModal = () => {
    setModalError('');
    setIsModalOpen(false);
  };

  // Confirm choices in modal and update the view
  const handleConfirmModal = () => {
    setModalError('');
    const gVal = parseInt(modalGuests, 10);
    if (!modalGuests || isNaN(gVal) || gVal < 1) {
      setModalError('กรุณาระบุจำนวนผู้เข้าใช้งานอย่างน้อย 1 ท่าน');
      return;
    }

    if (modalMode === 'byGuests') {
      if ((modalStartTime && !modalEndTime) || (!modalStartTime && modalEndTime)) {
        setModalError('กรุณาเลือกทั้งเวลาเริ่มและเวลาสิ้นสุด หรือเลือก "ทุกช่วงเวลา"');
        return;
      }
      if (modalStartTime && modalEndTime) {
        if (modalEndTime <= modalStartTime) {
          setModalError('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม');
          return;
        }
        if (modalStartTime < '08:00' || modalEndTime > '18:00') {
          setModalError('กรุณาเลือกช่วงเวลาภายใน 08:00–18:00 น.');
          return;
        }
        if (isStartTimePastBangkok(modalDate, modalStartTime)) {
          setModalError('เลยเวลาเริ่มแล้ว กรุณาเลือกเวลาใหม่');
          return;
        }
      }
    }

    if (modalMode === 'directRoom') {
      if (!modalRoomId) {
        setModalError('กรุณาเลือกห้องประชุมที่ต้องการ');
        return;
      }
      const selRoom = rooms.find(r => String(r.id) === String(modalRoomId));
      if (selRoom) {
        const stdCap = selRoom.capacity || 4;
        const clsCap = selRoom.has_classroom === 1 ? (selRoom.classroom_capacity || stdCap) : stdCap;
        const maxRoomCap = Math.max(stdCap, clsCap);
        if (gVal > maxRoomCap) {
          setModalError(`ห้อง ${selRoom.name} รองรับสูงสุด ${maxRoomCap} ท่าน`);
          return;
        }
      }
    }

    setHasConfirmedDate(true);
    setDateStr(modalDate);
    const newMonth = modalDate.slice(0, 7);
    if (newMonth !== currentMonthKey) {
      setCurrentMonthKey(newMonth);
    }
    setSearchMode(modalMode);
    setGuests(gVal);
    setDirectGuestError('');

    const params = new URLSearchParams();
    params.set('mode', modalMode);
    params.set('date', modalDate);
    params.set('guests', gVal);

    if (modalMode === 'byGuests') {
      setConfirmedRoomId(null);
      setFilterStartTime(modalStartTime);
      setFilterEndTime(modalEndTime);
      if (modalStartTime && modalEndTime) {
        params.set('start', modalStartTime);
        params.set('end', modalEndTime);
        setGlobalStartTime(modalStartTime);
        setGlobalEndTime(modalEndTime);
        // Sync per-room selections to searched time window
        setRoomSelections(prev => {
          const updated = { ...prev };
          rooms.forEach(r => {
            updated[r.id] = {
              ...(updated[r.id] || {}),
              mode: 'hourly',
              startTime: modalStartTime,
              endTime: modalEndTime
            };
          });
          return updated;
        });
      }
    } else {
      const parsedRoomId = parseInt(modalRoomId, 10) || modalRoomId;
      setConfirmedRoomId(parsedRoomId);
      setExpandedRoomId(parsedRoomId);
      setFilterStartTime('');
      setFilterEndTime('');
      params.set('roomId', parsedRoomId);
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

    const isMonthDataReady = !!(availabilityData && availabilityData.month === currentMonthKey && Array.isArray(availabilityData.rooms));
    const liveBkk = getBangkokNow();
    const isTodayExpired = liveBkk.minutes >= (17 * 60 + 30); // 17:30 or later -> all start rounds for today are over
    const minStartMinsToday = getMinStartMinutesToday(liveBkk.minutes);

    for (let d = 1; d <= days; d++) {
      const dayDateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
      const isPast = dayDateStr < todayIso;
      const isDayToday = dayDateStr === todayIso;

      let freeCount = 0;
      if (isMonthDataReady) {
        const buffer = Number(availabilityData.cleaning_buffer_minutes ?? 30);
        for (const rm of availabilityData.rooms) {
          const conflicting = getConflictingRoomIds(rm.id);
          const dayBookings = (availabilityData.intervals || []).filter(item => {
            if (!conflicting.includes(item.room_id)) return false;
            return (item.start || '').slice(0, 10) === dayDateStr;
          });
          const ranges = getRoomAvailabilityForDay(dayDateStr, dayBookings, buffer);
          if (ranges?.status !== 'full' && Array.isArray(ranges?.ranges)) {
            if (isDayToday) {
              if (!isTodayExpired) {
                const hasValidFutureSlot = ranges.ranges.some(r => {
                  const [sh, sm] = (r.start || '08:00').split(':').map(Number);
                  const [eh, em] = (r.end || '18:00').split(':').map(Number);
                  const sMin = sh * 60 + sm;
                  const eMin = eh * 60 + em;
                  const effStart = Math.max(sMin, minStartMinsToday);
                  return (eMin - effStart) >= 30;
                });
                if (hasValidFutureSlot) {
                  freeCount++;
                }
              }
            } else {
              if (ranges.ranges.length > 0) {
                freeCount++;
              }
            }
          }
        }
      }

      cells.push({
        dayNumber: d,
        date: dayDateStr,
        isPast,
        isToday: isDayToday,
        isTodayExpired: isDayToday && isTodayExpired,
        freeRoomsCount: freeCount,
        isMonthDataReady
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

    let current = roomSelections[room.id];
    if (!current && lastTimeSelection) {
      const candidateMode = lastTimeSelection.mode;
      const modeSupported =
        (candidateMode === 'hourly' && hasHourly) ||
        (candidateMode === 'halfday' && hasHalfDay) ||
        (candidateMode === 'daily' && hasDaily);
      if (modeSupported) {
        let candStart = lastTimeSelection.startTime || globalStartTime;
        let candEnd = lastTimeSelection.endTime || globalEndTime;
        if (candidateMode === 'halfday') {
          const slot = lastTimeSelection.halfDaySlot || '08-12';
          candStart = slot === '08-12' ? '08:00' : '13:00';
          candEnd = slot === '08-12' ? '12:00' : '17:00';
        } else if (candidateMode === 'daily') {
          const slot = lastTimeSelection.dailySlot || '08-17';
          candStart = slot === '08-17' ? '08:00' : '09:00';
          candEnd = slot === '08-17' ? '17:00' : '18:00';
        }
        if (!getRoomOccupiedInfo(room.id, candStart, candEnd).isOccupied) {
          current = lastTimeSelection;
        }
      }
    }
    current = current || {};
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
    let durText = '';

    if (mode === 'hourly') {
      const [sH, sM] = startTime.split(':').map(Number);
      const [eH, eM] = endTime.split(':').map(Number);
      const diff = Math.max(0, (eH * 60 + eM) - (sH * 60 + sM));
      const exactHours = diff > 0 ? diff / 60 : 1;
      const billedHours = Math.max(1, Math.ceil(exactHours));
      duration = exactHours;
      totalPrice = hourlyPrice * billedHours;
      rateLabel = `อัตรารายชั่วโมง (฿${hourlyPrice.toLocaleString()}/ชม.)`;
      const hrs = Math.floor(diff / 60);
      const mins = diff % 60;
      if (hrs > 0 && mins > 0) {
        durText = `${hrs} ชม. ${mins} นาที`;
      } else if (hrs > 0) {
        durText = `${hrs} ชม.`;
      } else {
        durText = `${mins} นาที`;
      }
    } else if (mode === 'halfday') {
      effStart = halfDaySlot === '08-12' ? '08:00' : '13:00';
      effEnd = halfDaySlot === '08-12' ? '12:00' : '17:00';
      duration = 4;
      totalPrice = halfDayPrice;
      rateLabel = `ครึ่งวัน (${effStart}–${effEnd} น.)`;
      durText = '4 ชม.';
    } else if (mode === 'daily') {
      effStart = dailySlot === '08-17' ? '08:00' : '09:00';
      effEnd = dailySlot === '08-17' ? '17:00' : '18:00';
      duration = 9;
      totalPrice = dailyPrice;
      rateLabel = `ทั้งวัน (${effStart}–${effEnd} น.)`;
      durText = '9 ชม.';
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
      durText,
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

    // Past time check for today (Asia/Bangkok)
    if (isToday && reqStartMins <= currentMins) {
      return { isOccupied: true, reason: 'past', label: 'เลยเวลาเริ่มแล้ว กรุณาเลือกเวลาใหม่' };
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
    if (isToday && startMins <= currentMins) return false;

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

  // Helper: check if a room has at least one bookable 30-min slot remaining on the selected date
  const hasAnyBookableSlotInDay = useCallback((roomId) => {
    for (let slotStart = 8 * 60; slotStart < 18 * 60; slotStart += 30) {
      if (isToday && slotStart <= currentMins) continue;
      if (isIntervalClear(roomId, slotStart, slotStart + 30)) {
        return true;
      }
    }
    return false;
  }, [isToday, currentMins, isIntervalClear]);

  // Smart Room Categorization for 'byGuests' mode (filtered by capacity + real-time availability)
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
    const hasTimeFilter = Boolean(filterStartTime && filterEndTime && filterEndTime > filterStartTime);
    let fStartMins = null;
    let fEndMins = null;
    if (hasTimeFilter) {
      const [sH, sM] = filterStartTime.split(':').map(Number);
      const [eH, eM] = filterEndTime.split(':').map(Number);
      fStartMins = sH * 60 + (sM || 0);
      fEndMins = eH * 60 + (eM || 0);
    }

    const recommended = [];
    const upgrade = [];

    sorted.forEach(room => {
      const standardCap = room.capacity || 4;
      const classroomCap = room.has_classroom === 1 ? (room.classroom_capacity || standardCap) : standardCap;
      const maxRoomCap = Math.max(standardCap, classroomCap);

      if (maxRoomCap < reqGuests) return;

      // Filter by availability according to selected date / time window
      if (schedule) {
        if (hasTimeFilter) {
          if (!isIntervalClear(room.id, fStartMins, fEndMins)) return;
        } else {
          if (!hasAnyBookableSlotInDay(room.id)) return;
        }
      }

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
  }, [rooms, searchMode, guests, confirmedRoomId, schedule, filterStartTime, filterEndTime, isIntervalClear, hasAnyBookableSlotInDay]);

  // Proceed to Step 2 Form
  const handleProceedToForm = (room) => {
    const layout = roomLayouts[room.id] || 'standard';
    const isClassroom = layout === 'classroom';
    const sel = getRoomSelection(room);

    setBangkokNow(getBangkokNow());
    if (isStartTimePastBangkok(dateStr, sel.startTime)) {
      setTimelineError('เลยเวลาเริ่มแล้ว กรุณาเลือกเวลาใหม่');
      return;
    }

    const parsedGuests = parseInt(guests, 10);
    if (!guests || isNaN(parsedGuests) || parsedGuests < 1) {
      setDirectGuestError('กรุณาระบุจำนวนผู้เข้าใช้งานอย่างน้อย 1 ท่านก่อนกรอกข้อมูลผู้จอง');
      return;
    }
    if (parsedGuests > sel.effectiveCapacity) {
      setDirectGuestError(`จำนวนผู้เข้าใช้งาน (${parsedGuests} ท่าน) เกินความจุของห้อง (${sel.effectiveCapacity} ท่านสำหรับรูปแบบโต๊ะนี้)`);
      return;
    }
    setDirectGuestError('');
    setConfirmedRoomId(room.id);

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
      guests: parsedGuests,
      search_mode: searchMode,
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

  // Handle timeline bar tap: 1st tap sets start time, 2nd tap sets end time
  const handleTimelineBarClick = (room, e) => {
    setTimelineError('');
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    if (width <= 0) return;

    let pct = clickX / width;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;

    // 08:00 (480 mins) to 18:00 (1080 mins) = 600 minutes total
    const clickedMinute = 480 + pct * 600;

    const currentSel = roomSelections[room.id] || {};
    const curStart = currentSel.startTime || globalStartTime;
    const curEnd = currentSel.endTime || globalEndTime;
    const [cSH, cSM] = curStart.split(':').map(Number);
    const [cEH, cEM] = curEnd.split(':').map(Number);
    const curStartMins = cSH * 60 + cSM;
    const curEndMins = cEH * 60 + cEM;

    const curStep = timelineTapStep[room.id] || 'start';

    if (curStep === 'start') {
      // Step 1: Picking Start Time
      let targetStartMins = Math.floor(clickedMinute / 30) * 30;
      if (targetStartMins >= 18 * 60) targetStartMins = 17 * 60 + 30;

      if (isToday && targetStartMins <= currentMins) {
        return;
      }

      if (!isIntervalClear(room.id, targetStartMins, targetStartMins + 30)) {
        setTimelineError('ช่วงเวลานี้ติดจองหรือทำความสะอาด');
        return;
      }

      const newStartStr = `${String(Math.floor(targetStartMins / 60)).padStart(2, '0')}:${String(targetStartMins % 60).padStart(2, '0')}`;

      // Check if existing curEnd is still valid from targetStartMins
      let chosenEnd = curEnd;
      if (curEndMins <= targetStartMins || !isIntervalClear(room.id, targetStartMins, curEndMins)) {
        if (targetStartMins + 60 <= 18 * 60 && isIntervalClear(room.id, targetStartMins, targetStartMins + 60)) {
          chosenEnd = `${String(Math.floor((targetStartMins + 60) / 60)).padStart(2, '0')}:${String((targetStartMins + 60) % 60).padStart(2, '0')}`;
        } else {
          chosenEnd = `${String(Math.floor((targetStartMins + 30) / 60)).padStart(2, '0')}:${String((targetStartMins + 30) % 60).padStart(2, '0')}`;
        }
      }

      setRoomSelections(prev => ({
        ...prev,
        [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStartStr, endTime: chosenEnd }
      }));
      setTimelineTapStep(prev => ({ ...prev, [room.id]: 'end' }));
    } else {
      // Step 2: Picking End Time
      let targetEndMins = Math.round(clickedMinute / 30) * 30;
      if (targetEndMins > 18 * 60) targetEndMins = 18 * 60;

      if (targetEndMins <= curStartMins) {
        // Tapped earlier than or at start time -> Switch to setting new start time
        let newStartMins = Math.floor(clickedMinute / 30) * 30;
        if (newStartMins >= 18 * 60) newStartMins = 17 * 60 + 30;

        if (isToday && newStartMins <= currentMins) {
          return;
        }

        if (!isIntervalClear(room.id, newStartMins, newStartMins + 30)) {
          setTimelineError('ช่วงเวลานี้ติดจองหรือทำความสะอาด');
          return;
        }

        const newStartStr = `${String(Math.floor(newStartMins / 60)).padStart(2, '0')}:${String(newStartMins % 60).padStart(2, '0')}`;
        let chosenEnd = curEnd;
        if (curEndMins <= newStartMins || !isIntervalClear(room.id, newStartMins, curEndMins)) {
          if (newStartMins + 60 <= 18 * 60 && isIntervalClear(room.id, newStartMins, newStartMins + 60)) {
            chosenEnd = `${String(Math.floor((newStartMins + 60) / 60)).padStart(2, '0')}:${String((newStartMins + 60) % 60).padStart(2, '0')}`;
          } else {
            chosenEnd = `${String(Math.floor((newStartMins + 30) / 60)).padStart(2, '0')}:${String((newStartMins + 30) % 60).padStart(2, '0')}`;
          }
        }

        setRoomSelections(prev => ({
          ...prev,
          [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStartStr, endTime: chosenEnd }
        }));
        setTimelineTapStep(prev => ({ ...prev, [room.id]: 'end' }));
        return;
      }

      // Check if range curStartMins -> targetEndMins is continuous and clear
      if (!isIntervalClear(room.id, curStartMins, targetEndMins)) {
        setTimelineError('ไม่สามารถเลือกคร่อมช่วงที่ติดจองหรือทำความสะอาดได้');
        return;
      }

      const newEndStr = `${String(Math.floor(targetEndMins / 60)).padStart(2, '0')}:${String(targetEndMins % 60).padStart(2, '0')}`;
      setRoomSelections(prev => ({
        ...prev,
        [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: newEndStr }
      }));
      setTimelineTapStep(prev => ({ ...prev, [room.id]: 'start' }));
    }
  };

  // Handle Start Time Change via Dropdown
  const handleStartTimeDropdownChange = (room, newStart) => {
    setTimelineError('');
    const [sH, sM] = newStart.split(':').map(Number);
    const newStartMins = sH * 60 + sM;

    // Calculate valid contiguous end options for newStart
    const validEnds = [];
    for (let m = newStartMins + 30; m <= 18 * 60; m += 30) {
      if (isIntervalClear(room.id, newStartMins, m)) {
        const endStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        validEnds.push(endStr);
      } else {
        break;
      }
    }

    const currentSel = roomSelections[room.id] || {};
    const curEnd = currentSel.endTime || globalEndTime;

    // Keep curEnd only if it is still a valid contiguous end option
    let chosenEnd = validEnds[0] || `${String(Math.floor((newStartMins + 30) / 60)).padStart(2, '0')}:${String((newStartMins + 30) % 60).padStart(2, '0')}`;
    if (validEnds.includes(curEnd)) {
      chosenEnd = curEnd;
    } else {
      const oneHourEndStr = `${String(Math.floor((newStartMins + 60) / 60)).padStart(2, '0')}:${String((newStartMins + 60) % 60).padStart(2, '0')}`;
      if (validEnds.includes(oneHourEndStr)) {
        chosenEnd = oneHourEndStr;
      }
    }

    setRoomSelections(prev => ({
      ...prev,
      [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStart, endTime: chosenEnd }
    }));
    setTimelineTapStep(prev => ({ ...prev, [room.id]: 'end' }));
  };

  // Handle dragging start / end arrows
  const handleArrowPointerDown = (type, room, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}

    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    draggingRef.current = {
      type,
      roomId: room.id,
      room,
      rect,
      pointerId: e.pointerId
    };
  };

  const handleArrowPointerMove = (e) => {
    if (!draggingRef.current || draggingRef.current.pointerId !== e.pointerId) return;
    const { type, room, rect } = draggingRef.current;
    const width = rect.width;
    if (width <= 0) return;

    const currentX = e.clientX - rect.left;
    let pct = currentX / width;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;

    // 08:00 (480 mins) to 18:00 (1080 mins) = 600 minutes total
    const clickedMinute = 480 + pct * 600;
    let targetMins = Math.round(clickedMinute / 30) * 30;

    const currentSel = roomSelections[room.id] || {};
    const curStart = currentSel.startTime || globalStartTime;
    const curEnd = currentSel.endTime || globalEndTime;
    const [cSH, cSM] = curStart.split(':').map(Number);
    const [cEH, cEM] = curEnd.split(':').map(Number);
    const curStartMins = cSH * 60 + cSM;
    const curEndMins = cEH * 60 + cEM;

    if (type === 'start') {
      // Must not exceed curEndMins - 30
      if (targetMins > curEndMins - 30) targetMins = curEndMins - 30;
      // Must not be in the past (Asia/Bangkok)
      const minTodayMins = isToday ? getMinStartMinutesToday(currentMins) : 480;
      if (targetMins < minTodayMins) targetMins = minTodayMins;

      // When dragging left (earlier), stop if hitting booked or cleaning
      if (targetMins < curStartMins) {
        let maxAllowedLeft = curStartMins;
        for (let m = curStartMins - 30; m >= targetMins; m -= 30) {
          if (isIntervalClear(room.id, m, curEndMins)) {
            maxAllowedLeft = m;
          } else {
            break;
          }
        }
        targetMins = maxAllowedLeft;
      }

      if (targetMins >= curEndMins) return;

      const newStartStr = `${String(Math.floor(targetMins / 60)).padStart(2, '0')}:${String(targetMins % 60).padStart(2, '0')}`;
      if (newStartStr !== curStart) {
        setRoomSelections(prev => ({
          ...prev,
          [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStartStr }
        }));
      }
    } else {
      // Dragging End Handle
      if (targetMins < curStartMins + 30) targetMins = curStartMins + 30;
      if (targetMins > 18 * 60) targetMins = 18 * 60;

      // When dragging right (later), stop if hitting booked or cleaning
      if (targetMins > curEndMins) {
        let maxAllowedRight = curEndMins;
        for (let m = curEndMins + 30; m <= targetMins; m += 30) {
          if (isIntervalClear(room.id, curStartMins, m)) {
            maxAllowedRight = m;
          } else {
            break;
          }
        }
        targetMins = maxAllowedRight;
      }

      if (targetMins <= curStartMins) return;

      const newEndStr = `${String(Math.floor(targetMins / 60)).padStart(2, '0')}:${String(targetMins % 60).padStart(2, '0')}`;
      if (newEndStr !== curEnd) {
        setRoomSelections(prev => ({
          ...prev,
          [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: newEndStr }
        }));
      }
    }
  };

  const handleArrowPointerUp = (e) => {
    if (draggingRef.current && draggingRef.current.pointerId === e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      draggingRef.current = null;
    }
  };

  // Handle End Time Change via Dropdown
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
    setTimelineTapStep(prev => ({ ...prev, [room.id]: 'start' }));
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

      const isPast = isToday && slotStart <= currentMins;
      const occupiedInfo = getRoomOccupiedInfo(room.id, slotStartStr, slotEndStr);

      let bgColor = '#A7F3D0'; // ว่าง (เขียวอ่อน)
      let type = 'available';

      if (isPast) {
        type = 'past';
        bgColor = '#64748B'; // ผ่านเวลาเริ่มแล้ว (เทาทึบ)
      } else if (occupiedInfo.isOccupied) {
        if (occupiedInfo.reason === 'cleaning') {
          type = 'cleaning';
          bgColor = '#FEF08A'; // ทำความสะอาด (เหลืองอ่อน)
        } else {
          type = 'booked';
          bgColor = '#FDBA74'; // ติดจอง (ส้มอ่อน แยกชัดจากเทาทึบ)
        }
      }

      slots.push({
        index: i,
        startMins: slotStart,
        endMins: slotEnd,
        startStr: slotStartStr,
        endStr: slotEndStr,
        bgColor,
        type
      });
    }

    const selStartPct = Math.max(0, Math.min(100, ((selStartMins - 480) / 600) * 100));
    const selEndPct = Math.max(0, Math.min(100, ((selEndMins - 480) / 600) * 100));

    // Valid start options: only times that can actually start a valid booking
    const validStartOptions = [];
    for (let i = 0; i < 20; i++) {
      const slotStart = 8 * 60 + i * 30;
      if (slotStart >= 18 * 60) break;
      if (isToday && slotStart <= currentMins) continue;
      if (isIntervalClear(room.id, slotStart, slotStart + 30)) {
        const startStr = `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`;
        validStartOptions.push(startStr);
      }
    }

    // Contiguous valid end options starting from selStartMins
    const validEndOptions = [];
    for (let m = selStartMins + 30; m <= 18 * 60; m += 30) {
      if (isIntervalClear(room.id, selStartMins, m)) {
        const endStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        validEndOptions.push({ time: endStr, value: endStr });
      } else {
        break;
      }
    }

    const timeMarkers = [
      { time: '08:00', pct: 0 },
      { time: '10:00', pct: 20 },
      { time: '12:00', pct: 40 },
      { time: '14:00', pct: 60 },
      { time: '16:00', pct: 80 },
      { time: '18:00', pct: 100 }
    ];

    return (
      <div className="timeline-bar-wrapper">
        {/* Time Labels Above the Bar (Clean, NO tick marks) */}
        <div style={{ position: 'relative', height: '18px', margin: '0 18px 4px 18px' }}>
          {timeMarkers.map(m => (
            <div
              key={m.time}
              style={{
                position: 'absolute',
                left: `${m.pct}%`,
                transform: 'translateX(-50%)',
                textAlign: 'center',
                color: '#1E293B',
                fontSize: '0.82rem',
                fontWeight: 700,
                lineHeight: 1,
                whiteSpace: 'nowrap',
                userSelect: 'none'
              }}
            >
              {m.time}
            </div>
          ))}
        </div>

        {/* Capsule Tube Container with Draggable Arrow Handles */}
        <div
          style={{
            position: 'relative',
            height: '28px',
            margin: '14px 18px 0 18px',
            touchAction: 'pan-y',
            userSelect: 'none'
          }}
        >
          {/* Left Arrow Handle (Start Time) */}
          <div
            onPointerDown={(e) => handleArrowPointerDown('start', room, e)}
            onPointerMove={handleArrowPointerMove}
            onPointerUp={handleArrowPointerUp}
            onPointerCancel={handleArrowPointerUp}
            style={{
              position: 'absolute',
              left: `${selStartPct}%`,
              bottom: '100%',
              transform: 'translate(-80%, 0)',
              width: '40px',
              height: '32px',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'flex-end',
              paddingRight: '6px',
              paddingBottom: '2px',
              cursor: 'ew-resize',
              touchAction: 'none',
              zIndex: 10
            }}
            title="ลากเพื่อปรับเวลาเริ่ม"
          >
            <svg width="10" height="7" viewBox="0 0 10 7" fill="none" style={{ pointerEvents: 'none' }}>
              <polygon points="0,0 10,0 5,7" fill="#0F766E" />
            </svg>
          </div>

          {/* Right Arrow Handle (End Time) */}
          <div
            onPointerDown={(e) => handleArrowPointerDown('end', room, e)}
            onPointerMove={handleArrowPointerMove}
            onPointerUp={handleArrowPointerUp}
            onPointerCancel={handleArrowPointerUp}
            style={{
              position: 'absolute',
              left: `${selEndPct}%`,
              bottom: '100%',
              transform: 'translate(-20%, 0)',
              width: '40px',
              height: '32px',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'flex-start',
              paddingLeft: '6px',
              paddingBottom: '2px',
              cursor: 'ew-resize',
              touchAction: 'none',
              zIndex: 10
            }}
            title="ลากเพื่อปรับเวลาสิ้นสุด"
          >
            <svg width="10" height="7" viewBox="0 0 10 7" fill="none" style={{ pointerEvents: 'none' }}>
              <polygon points="0,0 10,0 5,7" fill="#0F766E" />
            </svg>
          </div>

          {/* Background Capsule Tube Track */}
          <div
            onClick={(e) => handleTimelineBarClick(room, e)}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              borderRadius: '9999px',
              overflow: 'hidden',
              backgroundColor: '#A7F3D0',
              cursor: 'pointer'
            }}
            title="แตะเพื่อเลือกเวลา"
          >
            {slots.map(s => (
              <div
                key={s.index}
                data-slot-type={s.type}
                style={{
                  flex: 1,
                  height: '100%',
                  backgroundColor: s.bgColor,
                  border: 'none',
                  cursor: s.type === 'past' ? 'not-allowed' : 'pointer'
                }}
              />
            ))}
          </div>

          {/* Selected Range Overlay Capsule */}
          {selEndPct > selStartPct && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${selStartPct}%`,
                width: `${selEndPct - selStartPct}%`,
                backgroundColor: '#0F766E',
                borderRadius: '9999px',
                pointerEvents: 'none',
                zIndex: 2,
                boxShadow: '0 2px 6px rgba(15, 118, 110, 0.35)'
              }}
            />
          )}

          {/* Invisible Expanded Left Edge Drag Hit-Target (adjusts Start Time) */}
          {selEndPct > selStartPct && (
            <div
              data-testid={`timeline-edge-start-${room.id}`}
              className="timeline-edge-handle timeline-edge-handle--start"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => handleArrowPointerDown('start', room, e)}
              onPointerMove={handleArrowPointerMove}
              onPointerUp={handleArrowPointerUp}
              onPointerCancel={handleArrowPointerUp}
              style={{
                position: 'absolute',
                left: `${selStartPct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '32px',
                height: '44px',
                backgroundColor: 'transparent',
                cursor: 'ew-resize',
                touchAction: 'none',
                zIndex: 9
              }}
              title="ลากขอบซ้ายเพื่อปรับเวลาเริ่ม"
              aria-label="ลากขอบซ้ายเพื่อปรับเวลาเริ่ม"
            />
          )}

          {/* Invisible Expanded Right Edge Drag Hit-Target (adjusts End Time) */}
          {selEndPct > selStartPct && (
            <div
              data-testid={`timeline-edge-end-${room.id}`}
              className="timeline-edge-handle timeline-edge-handle--end"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => handleArrowPointerDown('end', room, e)}
              onPointerMove={handleArrowPointerMove}
              onPointerUp={handleArrowPointerUp}
              onPointerCancel={handleArrowPointerUp}
              style={{
                position: 'absolute',
                left: `${selEndPct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '32px',
                height: '44px',
                backgroundColor: 'transparent',
                cursor: 'ew-resize',
                touchAction: 'none',
                zIndex: 9
              }}
              title="ลากขอบขวาเพื่อปรับเวลาสิ้นสุด"
              aria-label="ลากขอบขวาเพื่อปรับเวลาสิ้นสุด"
            />
          )}

          {/* Centerline 30-min Subtle Dots Layer */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 3
            }}
          >
            {slots.map(s => {
              const isSelected = s.startMins >= selStartMins && s.endMins <= selEndMins;
              return (
                <div
                  key={s.index}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <div
                    style={{
                      width: '3.5px',
                      height: '3.5px',
                      borderRadius: '50%',
                      backgroundColor: isSelected
                        ? 'rgba(255, 255, 255, 0.75)'
                        : s.type === 'past'
                        ? 'transparent'
                        : s.type === 'booked'
                        ? 'rgba(100, 116, 139, 0.4)'
                        : s.type === 'cleaning'
                        ? 'rgba(180, 83, 9, 0.4)'
                        : 'rgba(15, 118, 110, 0.3)'
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend Row */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '14px', margin: '14px 18px 0 18px', fontSize: '0.82rem', color: '#0F172A', fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#A7F3D0' }} />
            ว่าง
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FDBA74' }} />
            ติดจอง
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FEF08A', border: '1px solid #FDE047' }} />
            ทำความสะอาด
          </span>
        </div>

        {/* Short Instruction */}
        <div style={{ fontSize: '0.86rem', color: '#64748B', fontWeight: 600, margin: '8px 18px 0 18px' }}>
          แตะบนแถบ หรือเลื่อนลูกศรเพื่อปรับเวลา
        </div>

        {/* Error / Conflict Alert */}
        {timelineError && (
          <div style={{ margin: '10px 18px 0 18px', padding: '6px 10px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={15} />
            <span>{timelineError}</span>
          </div>
        )}

        {/* Dropdowns: “เวลาเริ่ม” and “เวลาสิ้นสุด” */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '16px 18px 0 18px' }}>
          {/* Start Time Dropdown */}
          <div>
            <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>
              เวลาเริ่ม
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={sel.startTime}
                onChange={(e) => handleStartTimeDropdownChange(room, e.target.value)}
                style={{
                  width: '100%',
                  height: '46px',
                  padding: '0 36px 0 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #CBD5E1',
                  backgroundColor: '#ffffff',
                  color: '#0F172A',
                  fontSize: '1rem',
                  fontWeight: 700,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {validStartOptions.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <ChevronDown
                size={18}
                color="#64748B"
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
            </div>
          </div>

          {/* End Time Dropdown */}
          <div>
            <label style={{ display: 'block', fontSize: '0.95rem', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>
              เวลาสิ้นสุด
            </label>
            <div style={{ position: 'relative' }}>
              <select
                value={sel.endTime}
                onChange={(e) => handleEndTimeDropdownChange(room, e.target.value)}
                style={{
                  width: '100%',
                  height: '46px',
                  padding: '0 36px 0 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #CBD5E1',
                  backgroundColor: '#ffffff',
                  color: '#0F172A',
                  fontSize: '1rem',
                  fontWeight: 700,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {validEndOptions.map(opt => (
                  <option key={opt.time} value={opt.time}>{opt.time}</option>
                ))}
              </select>
              <ChevronDown
                size={18}
                color="#64748B"
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              />
            </div>
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
    const halfDay0812Info = getRoomOccupiedInfo(room.id, '08:00', '12:00');
    const halfDay0812Occupied = halfDay0812Info.isOccupied;
    const halfDay1317Info = getRoomOccupiedInfo(room.id, '13:00', '17:00');
    const halfDay1317Occupied = halfDay1317Info.isOccupied;

    // Daily slot availability checks
    const daily0817Info = getRoomOccupiedInfo(room.id, '08:00', '17:00');
    const daily0817Occupied = daily0817Info.isOccupied;
    const daily0918Info = getRoomOccupiedInfo(room.id, '09:00', '18:00');
    const daily0918Occupied = daily0918Info.isOccupied;

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
              padding: '16px 14px',
              borderRadius: '16px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #0F766E',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              boxShadow: '0 4px 16px rgba(15, 118, 110, 0.08)'
            }}>
              {/* Header: เลือกเวลาจอง + Room | Date */}
              <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '10px' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0F172A', margin: '0 0 2px 0' }}>
                  เลือกเวลาจอง
                </h3>
                <div style={{ fontSize: '0.88rem', color: '#64748B', fontWeight: 600 }}>
                  {room.name} · {formatShortThaiDate(dateStr)}
                </div>
              </div>

              {/* Package Selector Tabs (Only show if room supports multiple packages) */}
              {(sel.hasHalfDay || sel.hasDaily) && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${[sel.hasHourly, sel.hasHalfDay, sel.hasDaily].filter(Boolean).length}, 1fr)`,
                  gap: '8px'
                }}>
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
                        padding: '10px',
                        borderRadius: '10px',
                        border: sel.mode === 'hourly' ? '1.5px solid #0F766E' : '1.5px solid #E2E8F0',
                        backgroundColor: sel.mode === 'hourly' ? '#0F766E' : '#ffffff',
                        color: sel.mode === 'hourly' ? '#ffffff' : '#0F172A',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      รายชั่วโมง
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
                        padding: '10px',
                        borderRadius: '10px',
                        border: sel.mode === 'halfday' ? '1.5px solid #0F766E' : '1.5px solid #E2E8F0',
                        backgroundColor: sel.mode === 'halfday' ? '#0F766E' : '#ffffff',
                        color: sel.mode === 'halfday' ? '#ffffff' : '#0F172A',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      ครึ่งวัน
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
                        padding: '10px',
                        borderRadius: '10px',
                        border: sel.mode === 'daily' ? '1.5px solid #0F766E' : '1.5px solid #E2E8F0',
                        backgroundColor: sel.mode === 'daily' ? '#0F766E' : '#ffffff',
                        color: sel.mode === 'daily' ? '#ffffff' : '#0F172A',
                        fontSize: '0.9rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      ทั้งวัน
                    </button>
                  )}
                </div>
              )}

              {/* 1. HOURLY: Horizontal Time Bar & Start/End Button Grids */}
              {sel.mode === 'hourly' && (
                <div>
                  {renderInteractiveTimelineBar(room, sel)}
                </div>
              )}

              {/* 2. HALF-DAY: Predefined Package Slot Cards */}
              {sel.mode === 'halfday' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Slot 08:00 - 12:00 */}
                  <div
                    onClick={() => {
                      if (!halfDay0812Occupied) {
                        setRoomSelections(prev => ({
                          ...prev,
                          [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '08-12' }
                        }));
                      }
                    }}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: halfDay0812Occupied ? '1px solid #E2E8F0' : sel.halfDaySlot === '08-12' ? '2px solid #0F766E' : '1.5px solid #E2E8F0',
                      backgroundColor: halfDay0812Occupied ? '#F8FAFC' : '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: halfDay0812Occupied ? 'not-allowed' : 'pointer',
                      boxShadow: sel.halfDaySlot === '08-12' && !halfDay0812Occupied ? '0 2px 8px rgba(15, 118, 110, 0.12)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: halfDay0812Occupied ? '#94A3B8' : '#0F172A' }}>
                        08:00–12:00 น.
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
                        4 ชม.
                      </div>
                    </div>
                    <div>
                      {halfDay0812Occupied ? (
                        <span style={{ padding: '6px 14px', borderRadius: '8px', backgroundColor: '#E2E8F0', color: '#64748B', fontSize: '0.85rem', fontWeight: 700 }}>
                          {halfDay0812Info.reason === 'past' ? 'เลยเวลา' : 'ติดจอง'}
                        </span>
                      ) : sel.halfDaySlot === '08-12' ? (
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0F766E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          ฿{Number(sel.halfDayPrice).toLocaleString()}
                          <CheckCircle2 size={20} fill="#0F766E" color="#ffffff" />
                        </span>
                      ) : (
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>
                          ฿{Number(sel.halfDayPrice).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Slot 13:00 - 17:00 */}
                  <div
                    onClick={() => {
                      if (!halfDay1317Occupied) {
                        setRoomSelections(prev => ({
                          ...prev,
                          [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '13-17' }
                        }));
                      }
                    }}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: halfDay1317Occupied ? '1px solid #E2E8F0' : sel.halfDaySlot === '13-17' ? '2px solid #0F766E' : '1.5px solid #E2E8F0',
                      backgroundColor: halfDay1317Occupied ? '#F8FAFC' : '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: halfDay1317Occupied ? 'not-allowed' : 'pointer',
                      boxShadow: sel.halfDaySlot === '13-17' && !halfDay1317Occupied ? '0 2px 8px rgba(15, 118, 110, 0.12)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: halfDay1317Occupied ? '#94A3B8' : '#0F172A' }}>
                        13:00–17:00 น.
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
                        4 ชม.
                      </div>
                    </div>
                    <div>
                      {halfDay1317Occupied ? (
                        <span style={{ padding: '6px 14px', borderRadius: '8px', backgroundColor: '#E2E8F0', color: '#64748B', fontSize: '0.85rem', fontWeight: 700 }}>
                          {halfDay1317Info.reason === 'past' ? 'เลยเวลา' : 'ติดจอง'}
                        </span>
                      ) : sel.halfDaySlot === '13-17' ? (
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0F766E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          ฿{Number(sel.halfDayPrice).toLocaleString()}
                          <CheckCircle2 size={20} fill="#0F766E" color="#ffffff" />
                        </span>
                      ) : (
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>
                          ฿{Number(sel.halfDayPrice).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. FULL-DAY: Predefined Package Slot Cards */}
              {sel.mode === 'daily' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Slot 08:00 - 17:00 */}
                  <div
                    onClick={() => {
                      if (!daily0817Occupied) {
                        setRoomSelections(prev => ({
                          ...prev,
                          [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '08-17' }
                        }));
                      }
                    }}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: daily0817Occupied ? '1px solid #E2E8F0' : sel.dailySlot === '08-17' ? '2px solid #0F766E' : '1.5px solid #E2E8F0',
                      backgroundColor: daily0817Occupied ? '#F8FAFC' : '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: daily0817Occupied ? 'not-allowed' : 'pointer',
                      boxShadow: sel.dailySlot === '08-17' && !daily0817Occupied ? '0 2px 8px rgba(15, 118, 110, 0.12)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: daily0817Occupied ? '#94A3B8' : '#0F172A' }}>
                        08:00–17:00 น.
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
                        9 ชม.
                      </div>
                    </div>
                    <div>
                      {daily0817Occupied ? (
                        <span style={{ padding: '6px 14px', borderRadius: '8px', backgroundColor: '#E2E8F0', color: '#64748B', fontSize: '0.85rem', fontWeight: 700 }}>
                          {daily0817Info.reason === 'past' ? 'เลยเวลา' : 'ติดจอง'}
                        </span>
                      ) : sel.dailySlot === '08-17' ? (
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0F766E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          ฿{Number(sel.dailyPrice).toLocaleString()}
                          <CheckCircle2 size={20} fill="#0F766E" color="#ffffff" />
                        </span>
                      ) : (
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>
                          ฿{Number(sel.dailyPrice).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Slot 09:00 - 18:00 */}
                  <div
                    onClick={() => {
                      if (!daily0918Occupied) {
                        setRoomSelections(prev => ({
                          ...prev,
                          [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '09-18' }
                        }));
                      }
                    }}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '12px',
                      border: daily0918Occupied ? '1px solid #E2E8F0' : sel.dailySlot === '09-18' ? '2px solid #0F766E' : '1.5px solid #E2E8F0',
                      backgroundColor: daily0918Occupied ? '#F8FAFC' : '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: daily0918Occupied ? 'not-allowed' : 'pointer',
                      boxShadow: sel.dailySlot === '09-18' && !daily0918Occupied ? '0 2px 8px rgba(15, 118, 110, 0.12)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color: daily0918Occupied ? '#94A3B8' : '#0F172A' }}>
                        09:00–18:00 น.
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: '2px' }}>
                        9 ชม.
                      </div>
                    </div>
                    <div>
                      {daily0918Occupied ? (
                        <span style={{ padding: '6px 14px', borderRadius: '8px', backgroundColor: '#E2E8F0', color: '#64748B', fontSize: '0.85rem', fontWeight: 700 }}>
                          {daily0918Info.reason === 'past' ? 'เลยเวลา' : 'ติดจอง'}
                        </span>
                      ) : sel.dailySlot === '09-18' ? (
                        <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#0F766E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          ฿{Number(sel.dailyPrice).toLocaleString()}
                          <CheckCircle2 size={20} fill="#0F766E" color="#ffffff" />
                        </span>
                      ) : (
                        <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0F172A' }}>
                          ฿{Number(sel.dailyPrice).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Direct Room Mode: Require actual guest count once before entering form */}
              {searchMode === 'directRoom' && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  borderRadius: '12px',
                  backgroundColor: '#f8fafc',
                  border: directGuestError ? '1.5px solid var(--danger)' : '1px solid var(--border)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '4px' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--navy)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Users size={15} color="var(--primary)" />
                      <span>จำนวนผู้เข้าใช้งาน <span style={{ color: 'var(--danger)' }}>*</span></span>
                    </label>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      รองรับสูงสุด {sel.effectiveCapacity} ท่าน
                    </span>
                  </div>
                  <div className="counter-box" style={{ margin: '6px 0 4px 0' }}>
                    <button
                      type="button"
                      disabled={!guests || parseInt(guests, 10) <= 1}
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setDirectGuestError('');
                        setGuests(g => {
                          const val = parseInt(g, 10);
                          return isNaN(val) || val <= 1 ? 1 : val - 1;
                        });
                      }}
                      className="counter-btn"
                      id={`btn-direct-guest-decrement-${room.id}`}
                      aria-label="ลดจำนวนคน"
                    >
                      <Minus size={18} />
                    </button>
                    <div className="counter-input-wrap">
                      <input
                        type="number"
                        min="1"
                        max={sel.effectiveCapacity}
                        step="1"
                        value={guests}
                        placeholder="ระบุจำนวนคน"
                        onChange={(e) => {
                          setDirectGuestError('');
                          const val = parseInt(e.target.value, 10);
                          if (isNaN(val)) {
                            setGuests('');
                          } else {
                            setGuests(Math.max(1, val));
                          }
                        }}
                        className="counter-input"
                        style={{ paddingRight: guests ? '36px' : '12px' }}
                        id={`input-direct-guests-${room.id}`}
                      />
                      {guests !== '' && (
                        <span style={{ position: 'absolute', right: '12px', fontSize: '0.85rem', fontWeight: 800, color: 'var(--navy)', pointerEvents: 'none' }}>
                          ท่าน
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={parseInt(guests, 10) >= sel.effectiveCapacity}
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setDirectGuestError('');
                        setGuests(g => {
                          const val = parseInt(g, 10);
                          if (isNaN(val) || val < 1) return 1;
                          return Math.min(sel.effectiveCapacity, val + 1);
                        });
                      }}
                      className="counter-btn"
                      id={`btn-direct-guest-increment-${room.id}`}
                      aria-label="เพิ่มจำนวนคน"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {directGuestError && (
                    <div style={{ color: 'var(--danger)', fontSize: '0.76rem', fontWeight: 700, marginTop: '6px', textAlign: 'center' }}>
                      {directGuestError}
                    </div>
                  )}
                </div>
              )}

              {/* Summary Bar directly above full-width button */}
              <div style={{
                marginTop: '10px',
                paddingTop: '12px',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0F766E' }}>
                  {sel.startTime}–{sel.endTime} น.{sel.durText ? ` · ${sel.durText}` : ''}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#0F766E' }}>
                    ฿{Number(sel.totalPrice).toLocaleString()}
                  </div>
                  {sel.isPromotionApplied && (
                    <div style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>
                      ส่วนลดออนไลน์ {sel.discountValue ?? (promotion?.discount_value || 5)}% (-฿{Number(sel.discountAmount).toLocaleString()})
                    </div>
                  )}
                </div>
              </div>

              {isOccupied && reason === 'past' ? (
                <div style={{
                  marginTop: '8px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#dc2626',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span>เลยเวลาเริ่มแล้ว กรุณาเลือกเวลาใหม่</span>
                </div>
              ) : null}

              {/* Full-width Action Button */}
              <button
                type="button"
                disabled={isOccupied}
                onClick={() => handleProceedToForm(room)}
                className="btn-primary"
                id={`btn-book-room-${room.id}`}
                style={{
                  width: '100%',
                  height: '50px',
                  fontSize: '0.92rem',
                  fontWeight: 800,
                  borderRadius: '12px',
                  backgroundColor: isOccupied ? '#cbd5e1' : '#0F766E',
                  color: isOccupied ? '#475569' : '#ffffff',
                  border: 'none',
                  cursor: isOccupied ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  marginTop: '4px',
                  boxShadow: isOccupied ? 'none' : '0 4px 14px rgba(15, 118, 110, 0.3)'
                }}
              >
                <span>
                  {isOccupied
                    ? (reason === 'past' ? 'เลยเวลาเริ่มแล้ว' : 'ช่วงเวลานี้ไม่ว่าง')
                    : 'กรอกข้อมูลผู้จอง'}
                </span>
              </button>
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

        {/* Month Error Alert with Retry Button */}
        {monthError && (
          <div style={{
            margin: '0 0 12px 0',
            padding: '8px 14px',
            borderRadius: '10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8rem',
            color: '#dc2626'
          }}>
            <span>ไม่สามารถโหลดสถานะห้องว่างได้</span>
            <button
              type="button"
              onClick={fetchMonthlyAvailability}
              style={{
                fontWeight: 800,
                color: '#0F766E',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: '2px 6px'
              }}
            >
              ลองใหม่
            </button>
          </div>
        )}

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
                const isReady = cell.isMonthDataReady;
                const hasFree = cell.freeRoomsCount > 0;
                const isPast = cell.isPast;
                const isTodayExpired = cell.isTodayExpired;
                const isDisabled = isPast || isTodayExpired;

                return (
                  <button
                    type="button"
                    key={cell.date}
                    disabled={isDisabled}
                    className={`customer-cal-day ${cell.isToday ? 'customer-cal-day--today' : ''} ${isSelected ? 'customer-cal-day--selected' : ''} ${isPast ? 'customer-cal-day--past' : ''} ${isTodayExpired ? 'customer-cal-day--today-expired' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => handleDateTap(cell.date)}
                    title={
                      isPast
                        ? `${cell.dayNumber} (ผ่านมาแล้ว)`
                        : isTodayExpired
                        ? `${cell.dayNumber} (หมดรอบวันนี้)`
                        : `${cell.dayNumber} (${!isReady ? 'กำลังโหลด...' : hasFree ? `ว่าง ${cell.freeRoomsCount} ห้อง` : 'เต็ม'})`
                    }
                  >
                    <span className="customer-cal-day__num">{cell.dayNumber}</span>
                    {isPast ? (
                      <span className="customer-cal-day__diagonal-label">ผ่านมาแล้ว</span>
                    ) : isTodayExpired ? (
                      <span className="customer-cal-day__badge customer-cal-day__badge--expired">หมดรอบวันนี้</span>
                    ) : (
                      <span className={`customer-cal-day__badge ${!isReady ? 'customer-cal-day__badge--loading' : hasFree ? 'customer-cal-day__badge--free' : 'customer-cal-day__badge--full'}`}>
                        {!isReady ? '···' : hasFree ? `${cell.freeRoomsCount} ห้อง` : 'เต็ม'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* 2. PROMPT CARD OR ROOM RESULTS */}
      {!hasConfirmedDate ? (
        <div
          className="booking-card"
          id="card-select-date-prompt"
          style={{
            textAlign: 'center',
            padding: '36px 20px',
            margin: '16px auto',
            maxWidth: '520px',
            borderRadius: '16px',
            border: '1.5px dashed var(--border)',
            backgroundColor: '#ffffff'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            backgroundColor: 'var(--primary-light)',
            color: 'var(--primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px'
          }}>
            <Calendar size={26} />
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--navy)', marginBottom: '6px' }}>
            เลือกวันที่เพื่อดูห้องว่าง
          </h3>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            แตะเลือกวันที่บนปฏิทินด้านบน เพื่อค้นหาตามจำนวนคนหรือเลือกห้องที่ต้องการ
          </p>
        </div>
      ) : (
        <>
      {/* 2. SUMMARY FILTER BAR ABOVE ROOM RESULTS */}
      <div className="customer-summary-filter-bar">
        <div className="customer-summary-filter-info">
          <div className="customer-summary-filter-icon">
            <Calendar size={18} />
          </div>
          <div>
            <div className="customer-summary-filter-text">
              {searchMode === 'byGuests'
                ? `${formatShortThaiDate(dateStr)} · ${guests} คน${filterStartTime && filterEndTime ? ` · ${filterStartTime}–${filterEndTime} น.` : ''}`
                : `${formatShortThaiDate(dateStr)} · ห้อง ${directSelectedRoom?.name || 'ที่เลือก'}${guests ? ` · ${guests} คน` : ''}`}
            </div>
            <div className="customer-summary-filter-sub">
              {searchMode === 'byGuests'
                ? (filterStartTime && filterEndTime ? 'ค้นหาตามจำนวนคนและช่วงเวลา' : 'ค้นหาตามจำนวนคน (ทุกช่วงเวลาที่ว่าง)')
                : 'ค้นหาแบบระบุห้อง'}
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
        recommendedRooms.length === 0 && upgradeRooms.length === 0 ? (
          /* EMPTY STATE: NO ROOMS AVAILABLE IN SELECTED TIME WINDOW */
          <div
            id="empty-rooms-for-time-window"
            style={{
              padding: '32px 20px',
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              border: '1.5px solid var(--border)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: '#f1f5f9',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Clock size={24} />
            </div>
            <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--navy)' }}>
              ไม่มีห้องว่างในช่วงเวลานี้
            </div>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', maxWidth: '300px', lineHeight: 1.5 }}>
              {filterStartTime && filterEndTime
                ? `ช่วง ${filterStartTime}–${filterEndTime} น. สำหรับ ${guests} ท่าน ไม่มีห้องที่ว่างตลอดช่วงเวลาที่เลือก`
                : `วันที่เลือกไม่มีห้องที่ว่างสำหรับ ${guests} ท่าน`}
            </p>
            <button
              type="button"
              id="btn-change-search-time"
              onClick={handleOpenEditModal}
              className="btn-primary"
              style={{
                width: 'auto',
                minWidth: '160px',
                padding: '10px 22px',
                height: '44px',
                fontSize: '0.9rem',
                fontWeight: 800,
                borderRadius: '12px'
              }}
            >
              เปลี่ยนเวลา
            </button>
          </div>
        ) : (
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
        )
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

        </>
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

            {/* Modal Body: Mode 'directRoom' room selector + shared guest stepper */}
            {modalMode === 'directRoom' && (
              <div>
                <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--navy)', marginBottom: '8px', display: 'block' }}>
                  เลือกห้องประชุมที่ต้องการ:
                </label>

                <select
                  value={modalRoomId}
                  onChange={(e) => {
                    setModalError('');
                    setModalRoomId(e.target.value);
                  }}
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
              </div>
            )}

            <div>
              <label style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--navy)', marginBottom: '8px', display: 'block', textAlign: 'center' }}>
                จำนวนผู้เข้าใช้งาน (Attendees)
              </label>

              {/* Counter Control: [-] [ Input ] [+] */}
              <div className="counter-box">
                <button
                  type="button"
                  disabled={!modalGuests || parseInt(modalGuests, 10) <= 1}
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setModalError('');
                    setModalGuests(g => {
                      const val = parseInt(g, 10);
                      return isNaN(val) || val <= 1 ? 1 : val - 1;
                    });
                  }}
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
                    placeholder="ระบุจำนวนคน"
                    onChange={(e) => {
                      setModalError('');
                      const val = parseInt(e.target.value, 10);
                      if (isNaN(val)) {
                        setModalGuests('');
                      } else {
                        setModalGuests(Math.max(1, val));
                      }
                    }}
                    className="counter-input"
                    style={{ paddingRight: modalGuests !== '' ? '38px' : '12px' }}
                    id="input-modal-guests"
                  />
                  {modalGuests !== '' && (
                    <span style={{ position: 'absolute', right: '12px', fontSize: '0.9rem', fontWeight: 800, color: 'var(--navy)', pointerEvents: 'none' }}>
                      ท่าน
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setModalError('');
                    setModalGuests(g => {
                      const val = parseInt(g, 10);
                      return isNaN(val) || val < 1 ? 1 : val + 1;
                    });
                  }}
                  className="counter-btn"
                  id="btn-guest-increment"
                  aria-label="เพิ่มจำนวนคน"
                >
                  <Plus size={20} />
                </button>
              </div>

              <div style={{ textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                {modalMode === 'byGuests'
                  ? (modalGuests ? `ระบบจะค้นหาห้องที่ว่างและรองรับได้สำหรับ ${modalGuests} ท่าน` : 'ระบุจำนวนคนเพื่อค้นหาห้องที่เหมาะสม')
                  : 'ระบบจะแสดงเฉพาะห้องที่เลือก พร้อมตรวจสอบความจุตามจำนวนผู้เข้าร่วม'}
              </div>
            </div>

            {/* Optional Time Window Filter for 'byGuests' mode */}
            {modalMode === 'byGuests' && (() => {
              const modalIsToday = modalDate === todayIso;
              const modalStartOpts = TIME_OPTIONS.filter(t => {
                if (t >= '18:00') return false;
                if (modalIsToday) {
                  const [h, m] = t.split(':').map(Number);
                  if (h * 60 + m <= currentMins) return false;
                }
                return true;
              });
              const modalEndOpts = TIME_OPTIONS.filter(t => {
                if (t <= '08:00' || t > '18:00') return false;
                if (modalStartTime && t <= modalStartTime) return false;
                return true;
              });
              return (
                <div style={{
                  padding: '12px 14px',
                  borderRadius: '12px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid var(--border)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--navy)' }}>
                      ช่วงเวลาที่ต้องการ (ไม่บังคับ)
                    </label>
                    {(modalStartTime || modalEndTime) && (
                      <button
                        type="button"
                        id="btn-clear-modal-time"
                        onClick={() => {
                          setModalStartTime('');
                          setModalEndTime('');
                          setModalError('');
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--primary)',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        ดูทุกช่วงเวลา
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label htmlFor="select-modal-start-time" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                        เวลาเริ่ม
                      </label>
                      <select
                        id="select-modal-start-time"
                        value={modalStartTime}
                        onChange={(e) => {
                          const nextStart = e.target.value;
                          setModalError('');
                          setModalStartTime(nextStart);
                          if (!nextStart) {
                            setModalEndTime('');
                          } else if (!modalEndTime || modalEndTime <= nextStart) {
                            const [h, m] = nextStart.split(':').map(Number);
                            const autoEndMins = Math.min(18 * 60, h * 60 + m + 60);
                            const autoEnd = `${String(Math.floor(autoEndMins / 60)).padStart(2, '0')}:${String(autoEndMins % 60).padStart(2, '0')}`;
                            setModalEndTime(autoEnd);
                          }
                        }}
                        className="form-input"
                        style={{ height: '42px', fontSize: '0.86rem', fontWeight: 700, borderRadius: '10px' }}
                      >
                        <option value="">ทุกช่วงเวลา</option>
                        {modalStartOpts.map(t => (
                          <option key={t} value={t}>{t} น.</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="select-modal-end-time" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                        เวลาสิ้นสุด
                      </label>
                      <select
                        id="select-modal-end-time"
                        value={modalEndTime}
                        disabled={!modalStartTime}
                        onChange={(e) => {
                          setModalError('');
                          setModalEndTime(e.target.value);
                        }}
                        className="form-input"
                        style={{ height: '42px', fontSize: '0.86rem', fontWeight: 700, borderRadius: '10px' }}
                      >
                        <option value="">{modalStartTime ? '-- เลือกเวลาสิ้นสุด --' : 'ทุกช่วงเวลา'}</option>
                        {modalEndOpts.map(t => (
                          <option key={t} value={t}>{t} น.</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })()}

            {modalError && (
              <div style={{
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                fontSize: '0.8rem',
                fontWeight: 700,
                textAlign: 'center'
              }}>
                {modalError}
              </div>
            )}

            {/* Confirm "ตกลง" Button */}
            <button
              type="button"
              disabled={!modalGuests || parseInt(modalGuests, 10) < 1 || (modalMode === 'directRoom' && !modalRoomId)}
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
