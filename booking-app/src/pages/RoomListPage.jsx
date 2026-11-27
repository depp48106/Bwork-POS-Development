import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Users, Wifi, Tv, Wind, CheckCircle2,
  ArrowLeft, ChevronRight, ChevronDown, ChevronUp, ChevronLeft, Calendar, Clock, Sparkles, Building, AlertCircle, Check, Edit3, X, Minus, Plus, MoreHorizontal
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

  // Active room displayed in single-room master-detail view
  const [activeRoomId, setActiveRoomId] = useState(initialRoomId);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(() => !hasUrlOrDraftSelection);
  const [isFullMonthSheetOpen, setIsFullMonthSheetOpen] = useState(false);
  const [isMobileRoomListOpen, setIsMobileRoomListOpen] = useState(false);
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
  const [availabilityByMonth, setAvailabilityByMonth] = useState({});
  const [roomSwitchNotice, setRoomSwitchNotice] = useState('');
  const [hasUserPickedTime, setHasUserPickedTime] = useState(Boolean(savedDraft?.start_time));
  const calendarSectionRef = useRef(null);
  const roomPhotoSectionRef = useRef(null);
  const pendingScrollAfterRoomSwitchRef = useRef(false);

  // -------------------------------------------------------------
  // Bottom Sheet Modal States (staged values until "ตกลง" is pressed)
  // -------------------------------------------------------------
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState(initialDate);
  const [modalMode, setModalMode] = useState(initialMode);
  const [modalGuests, setModalGuests] = useState(initialGuests);
  const [modalRoomId, setModalRoomId] = useState(initialRoomId || '');
  const [slotTooltip, setSlotTooltip] = useState(null); // { roomId, text, pct }
  const [activeDrag, setActiveDrag] = useState(null); // { roomId, type: 'start' | 'end' }

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

  // 7-day strip dates starting from today (Asia/Bangkok), supporting cross-month weeks
  const sevenDayStripDates = useMemo(() => {
    const [y, m, d] = todayIso.split('-').map(Number);
    const list = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      const iso = dt.toISOString().slice(0, 10);
      const dayOfWeek = dt.getUTCDay(); // 0=Sun..6=Sat
      const weekdayShort = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][dayOfWeek];
      list.push({
        date: iso,
        dayNumber: dt.getUTCDate(),
        monthKey: iso.slice(0, 7),
        monthShort: THAI_MONTHS_SHORT[dt.getUTCMonth()],
        thaiYear: dt.getUTCFullYear() + 543,
        weekdayShort,
        isMonthStart: i > 0 && dt.getUTCDate() === 1
      });
    }
    return list;
  }, [todayIso]);

  const sevenDayMonths = useMemo(
    () => Array.from(new Set(sevenDayStripDates.map(d => d.monthKey))),
    [sevenDayStripDates]
  );

  // Fetch monthly availability intervals for current calendar month AND any months covered by 7-day strip
  const fetchMonthlyAvailability = useCallback(async () => {
    setMonthLoading(true);
    setMonthError(false);
    const targetMonths = Array.from(new Set([currentMonthKey, ...sevenDayMonths]));
    try {
      const responses = await Promise.all(
        targetMonths.map(async (mk) => {
          const res = await fetch(`${API_BASE}/api/public/rooms/availability-month?month=${mk}`, { cache: 'no-store' });
          if (!res.ok) return { mk, ok: false, data: null };
          const data = await res.json();
          return { mk, ok: true, data };
        })
      );
      const nextMap = {};
      let currentOk = false;
      for (const r of responses) {
        if (r.ok && r.data && r.data.month === r.mk) {
          nextMap[r.mk] = r.data;
          if (r.mk === currentMonthKey) {
            setAvailabilityData(r.data);
            currentOk = true;
          }
        }
      }
      if (Object.keys(nextMap).length > 0) {
        setAvailabilityByMonth(prev => ({ ...prev, ...nextMap }));
      }
      setMonthError(!currentOk && responses.some(r => !r.ok));
    } catch (err) {
      console.warn('Failed to load monthly availability:', err);
      setMonthError(true);
    } finally {
      setMonthLoading(false);
    }
  }, [currentMonthKey, sevenDayMonths]);

  useEffect(() => {
    fetchMonthlyAvailability();
  }, [fetchMonthlyAvailability]);

  // Fetch active rooms, schedule for selected date, and promotion
  const fetchDailySchedule = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [roomsRes, scheduleRes, promoRes] = await Promise.all([
        fetch(`${API_BASE}/api/public/rooms`, { cache: 'no-store' }),
        fetch(`${API_BASE}/api/public/rooms/schedule?date=${dateStr}`, { cache: 'no-store' }),
        fetch(`${API_BASE}/api/public/promotion`, { cache: 'no-store' }).catch(() => null)
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

  // Ensure only one bottom sheet/modal is open at a time
  const closeAllBottomSheets = () => {
    setIsFullMonthSheetOpen(false);
    setIsMobileRoomListOpen(false);
    setIsMoreOptionsOpen(false);
    setIsModalOpen(false);
  };

  // When tapping a date on calendar (7-day strip or full-month sheet/grid): open bottom sheet modal with staged date
  const handleDateTap = (tappedDate) => {
    const liveBkk = getBangkokNow();
    if (tappedDate < liveBkk.dateIso) return;
    if (tappedDate === liveBkk.dateIso && liveBkk.minutes >= 17 * 60 + 30) return;
    closeAllBottomSheets();
    setModalDate(tappedDate);
    setModalMode(searchMode || 'byGuests');
    setModalGuests(guests ? guests : '');
    setModalRoomId(confirmedRoomId || (rooms.length > 0 ? rooms[0].id : ''));
    setModalError('');
    setIsModalOpen(true);
  };

  // When clicking "แก้ตัวเลือกการจอง": open modal with current confirmed values
  const handleOpenEditModal = () => {
    closeAllBottomSheets();
    setModalDate(dateStr);
    setModalMode(searchMode || 'byGuests');
    setModalGuests(guests ? guests : '');
    setModalRoomId(confirmedRoomId || (rooms.length > 0 ? rooms[0].id : ''));
    setModalError('');
    setIsModalOpen(true);
  };

  // Close modal without saving changes
  const handleCloseModal = () => {
    setModalError('');
    setIsModalOpen(false);
  };

  // Confirm choices in modal and update the view (by date + guests or directRoom; collapses calendar on confirm)
  const handleConfirmModal = () => {
    setModalError('');
    let confirmedGuests = '';

    if (modalMode === 'byGuests') {
      const gVal = parseInt(modalGuests, 10);
      if (!modalGuests || isNaN(gVal) || gVal < 1) {
        setModalError('กรุณาระบุจำนวนผู้เข้าใช้งานอย่างน้อย 1 ท่าน');
        return;
      }
      confirmedGuests = gVal;
    } else {
      // directRoom: never inherit old guest count from byGuests mode; entered for first time on /form
      if (!modalRoomId) {
        setModalError('กรุณาเลือกห้องประชุมที่ต้องการ');
        return;
      }
      confirmedGuests = '';
    }

    setHasConfirmedDate(true);
    setIsCalendarExpanded(false);
    setDateStr(modalDate);
    const newMonth = modalDate.slice(0, 7);
    if (newMonth !== currentMonthKey) {
      setCurrentMonthKey(newMonth);
    }
    setSearchMode(modalMode);
    setGuests(confirmedGuests);
    setDirectGuestError('');
    setRoomSwitchNotice('');
    setIsMobileRoomListOpen(false);
    setHasUserPickedTime(false);
    setRoomSelections({});

    const params = new URLSearchParams();
    params.set('mode', modalMode);
    params.set('date', modalDate);

    if (modalMode === 'byGuests') {
      params.set('guests', confirmedGuests);
      setConfirmedRoomId(null);
      setActiveRoomId(null);
    } else {
      const parsedRoomId = parseInt(modalRoomId, 10) || modalRoomId;
      setConfirmedRoomId(parsedRoomId);
      setActiveRoomId(parsedRoomId);
      setExpandedRoomId(parsedRoomId);
      params.set('roomId', parsedRoomId);
    }

    navigate(`/rooms?${params.toString()}`, { replace: true });
    setIsModalOpen(false);
  };

  // Shared helper: compute availability cell for any date (used by both 7-day strip and full-month calendar)
  const buildCalendarDayCell = useCallback((dayDateStr, dayNumber) => {
    const monthKey = dayDateStr.slice(0, 7);
    const monthAvail = availabilityByMonth[monthKey] || (availabilityData && availabilityData.month === monthKey ? availabilityData : null);
    const isMonthDataReady = !!(monthAvail && monthAvail.month === monthKey && Array.isArray(monthAvail.rooms));
    const liveBkk = getBangkokNow();
    const isTodayExpired = liveBkk.minutes >= (17 * 60 + 30);
    const minStartMinsToday = getMinStartMinutesToday(liveBkk.minutes);
    const isPast = dayDateStr < todayIso;
    const isDayToday = dayDateStr === todayIso;

    let freeCount = 0;
    if (isMonthDataReady) {
      const buffer = 30;
      for (const rm of monthAvail.rooms) {
        const conflicting = getConflictingRoomIds(rm.id);
        const dayBookings = (monthAvail.intervals || []).filter(item => {
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
              if (hasValidFutureSlot) freeCount++;
            }
          } else if (ranges.ranges.length > 0) {
            freeCount++;
          }
        }
      }
    }

    return {
      dayNumber,
      date: dayDateStr,
      isPast,
      isToday: isDayToday,
      isTodayExpired: isDayToday && isTodayExpired,
      freeRoomsCount: freeCount,
      isMonthDataReady
    };
  }, [availabilityByMonth, availabilityData, todayIso, bangkokNow.minutes]);

  // 7-day strip cells (shared logic with full-month calendar, supports cross-month weeks)
  const sevenDayStripCells = useMemo(
    () => sevenDayStripDates.map(d => ({ ...d, ...buildCalendarDayCell(d.date, d.dayNumber) })),
    [sevenDayStripDates, buildCalendarDayCell]
  );

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
      cells.push(buildCalendarDayCell(dayDateStr, d));
    }

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }, [currentMonthKey, buildCalendarDayCell]);

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
    const isTimeCleared = Boolean(current.isTimeCleared);
    const mode = current.mode && (
      (current.mode === 'hourly' && hasHourly) ||
      (current.mode === 'halfday' && hasHalfDay) ||
      (current.mode === 'daily' && hasDaily)
    ) ? current.mode : defaultMode;

    // Auto-select first free slot for hourly if no explicit user selection and default is occupied
    let fallbackStart = globalStartTime;
    let fallbackEnd = globalEndTime;
    if (!isTimeCleared && !current.startTime && mode === 'hourly' && schedule) {
      const [gSH, gSM] = fallbackStart.split(':').map(Number);
      const [gEH, gEM] = fallbackEnd.split(':').map(Number);
      if (!isIntervalClear(room.id, gSH * 60 + gSM, gEH * 60 + gEM)) {
        for (let m = 8 * 60; m <= 17 * 60 + 30; m += 30) {
          if (isToday && m <= currentMins) continue;
          if (m + 60 <= 18 * 60 && isIntervalClear(room.id, m, m + 60)) {
            fallbackStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            fallbackEnd = `${String(Math.floor((m + 60) / 60)).padStart(2, '0')}:${String((m + 60) % 60).padStart(2, '0')}`;
            break;
          } else if (m + 30 <= 18 * 60 && isIntervalClear(room.id, m, m + 30)) {
            fallbackStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            fallbackEnd = `${String(Math.floor((m + 30) / 60)).padStart(2, '0')}:${String((m + 30) % 60).padStart(2, '0')}`;
            break;
          }
        }
      }
    }

    const startTime = isTimeCleared ? '' : (current.startTime || fallbackStart);
    const endTime = isTimeCleared ? '' : (current.endTime || fallbackEnd);
    const halfDaySlot = isTimeCleared ? '' : (current.halfDaySlot || '08-12');
    const dailySlot = isTimeCleared ? '' : (current.dailySlot || '08-17');

    let effStart = startTime;
    let effEnd = endTime;
    let duration = 0;
    let totalPrice = 0;
    let rateLabel = 'อัตรารายชั่วโมง';
    let durText = '';

    if (isTimeCleared) {
      effStart = '';
      effEnd = '';
      duration = 0;
      totalPrice = 0;
      durText = '';
    } else if (mode === 'hourly') {
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
      isTimeCleared,
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
    const bufferMins = 30;

    for (const confId of conflictingIds) {
      const roomObj = schedule.rooms.find(r => r.id === confId);
      if (!roomObj || !roomObj.bookings) continue;

      for (const b of roomObj.bookings) {
        if (
          b.status === 'cancelled' ||
          b.payment_status === 'cancelled' ||
          b.payment_status === 'failed' ||
          b.payment_status === 'rejected' ||
          b.checkin_status === 'cancelled'
        ) continue;

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
    const bufferMins = 30;

    for (const confId of conflictingIds) {
      const roomObj = schedule.rooms.find(r => r.id === confId);
      if (!roomObj || !roomObj.bookings) continue;

      for (const b of roomObj.bookings) {
        if (
          b.status === 'cancelled' ||
          b.payment_status === 'cancelled' ||
          b.payment_status === 'failed' ||
          b.payment_status === 'rejected' ||
          b.checkin_status === 'cancelled'
        ) continue;
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

  // Helper: max seat capacity of a room
  const getRoomMaxCap = useCallback((room) => {
    const standardCap = room.capacity || 4;
    const classroomCap = room.has_classroom === 1 ? (room.classroom_capacity || standardCap) : standardCap;
    return Math.max(standardCap, classroomCap);
  }, []);

  // Helper: starting price display string for switcher rows and active room header (respects selected layout when sel is passed)
  const getRoomStartingPriceText = useCallback((room, sel = null) => {
    const hourly = sel ? sel.hourlyPrice : (room.hourly_rate || 0);
    const halfDay = sel ? sel.halfDayPrice : (room.half_day_rate || 0);
    const daily = sel ? sel.dailyPrice : (room.daily_rate || 0);
    const hasHourly = sel ? sel.hasHourly : (room.has_hourly === 1 && hourly > 0);
    const hasHalfDay = sel ? sel.hasHalfDay : ((room.has_halfday === 1 || halfDay > 0) && halfDay > 0);
    const hasDaily = sel ? sel.hasDaily : (room.has_daily === 1 && daily > 0);

    if (hasHourly && hourly > 0) {
      return `เริ่มต้น ฿${Number(hourly).toLocaleString()}/ชม.`;
    }
    if (hasHalfDay && halfDay > 0) {
      return `เริ่มต้น ฿${Number(halfDay).toLocaleString()}/ครึ่งวัน`;
    }
    if (hasDaily && daily > 0) {
      return `เริ่มต้น ฿${Number(daily).toLocaleString()}/วัน`;
    }
    return '';
  }, []);

  // Smart Single-Room Selection, Switcher Ordering & Capacity Notice
  const {
    switcherRooms,
    activeRoom,
    capacityNotice,
    directSelectedRoom,
    allSortedRooms
  } = useMemo(() => {
    const sortedByStandard = sortRoomsByStandardOrder(rooms);
    const sortedByCap = [...sortedByStandard].sort((a, b) => getRoomMaxCap(a) - getRoomMaxCap(b));
    const reqGuests = Math.max(1, parseInt(guests, 10) || 1);

    if (searchMode === 'directRoom') {
      const selRoom = (activeRoomId ? sortedByCap.find(r => String(r.id) === String(activeRoomId)) : null)
        || (confirmedRoomId ? sortedByCap.find(r => String(r.id) === String(confirmedRoomId)) : null)
        || sortedByCap[0]
        || null;
      return {
        switcherRooms: sortedByCap,
        activeRoom: selRoom,
        capacityNotice: null,
        directSelectedRoom: selRoom,
        allSortedRooms: sortedByStandard
      };
    }

    // Mode: 'byGuests' — find the smallest capacity tier that fits reqGuests and still has bookable slots
    const capableRooms = sortedByCap.filter(r => getRoomMaxCap(r) >= reqGuests);
    const availableRooms = capableRooms.filter(r => !schedule || hasAnyBookableSlotInDay(r.id));

    let notice = null;
    let tierAvailableRooms = [];
    if (availableRooms.length > 0 && capableRooms.length > 0) {
      const smallestCapableCap = getRoomMaxCap(capableRooms[0]);
      const firstAvailableCap = getRoomMaxCap(availableRooms[0]);
      tierAvailableRooms = availableRooms.filter(r => getRoomMaxCap(r) === firstAvailableCap);

      if (smallestCapableCap < firstAvailableCap) {
        // Exact/smaller fitting room exists but ALL of them are full on the selected date
        notice = {
          type: 'fitting_full',
          line1: `ห้องขนาด ${smallestCapableCap} ที่นั่งเต็มแล้วสำหรับวันที่เลือก`,
          line2: `ตอนนี้มีห้องขนาด ${firstAvailableCap} ที่นั่งให้จอง`
        };
      } else if (firstAvailableCap > reqGuests) {
        // No room with exact capacity exists in the system
        notice = {
          type: 'larger_only',
          line1: `ห้องที่รองรับ ${reqGuests} คนและยังว่าง เริ่มที่ ${firstAvailableCap} ที่นั่ง`,
          line2: ''
        };
      }
    }

    const chosenActive = (activeRoomId ? tierAvailableRooms.find(r => String(r.id) === String(activeRoomId)) : null)
      || tierAvailableRooms[0]
      || null;

    return {
      switcherRooms: tierAvailableRooms,
      activeRoom: chosenActive,
      capacityNotice: notice,
      directSelectedRoom: null,
      allSortedRooms: sortedByStandard
    };
  }, [rooms, searchMode, guests, confirmedRoomId, activeRoomId, schedule, hasAnyBookableSlotInDay, getRoomMaxCap]);

  // Switch active room in-place (NO scroll-to-top) and smartly preserve or clear selected time
  const handleSwitchActiveRoom = (nextRoom) => {
    if (!nextRoom) return;
    setIsMobileRoomListOpen(false);
    setSlotTooltip(null);
    setTimelineError('');

    if (activeRoom && String(nextRoom.id) === String(activeRoom.id)) {
      return;
    }

    pendingScrollAfterRoomSwitchRef.current = true;

    if (activeRoom) {
      const curSel = getRoomSelection(activeRoom);
      const hadValidTime = hasUserPickedTime && !curSel.isTimeCleared && curSel.startTime && curSel.endTime;

      if (hadValidTime) {
        const nextHasHourly = nextRoom.has_hourly === 1 && (nextRoom.hourly_rate || 0) > 0;
        const nextHasHalfDay = (nextRoom.has_halfday === 1 || (nextRoom.half_day_rate || 0) > 0) && (nextRoom.half_day_rate || 0) > 0;
        const nextHasDaily = nextRoom.has_daily === 1 && (nextRoom.daily_rate || 0) > 0;

        const modeSupported =
          (curSel.mode === 'hourly' && nextHasHourly) ||
          (curSel.mode === 'halfday' && nextHasHalfDay) ||
          (curSel.mode === 'daily' && nextHasDaily);

        if (!modeSupported) {
          const modeThai = curSel.mode === 'hourly' ? 'รายชั่วโมง' : curSel.mode === 'halfday' ? 'ครึ่งวัน' : 'ทั้งวัน';
          const fallbackMode = nextHasHourly ? 'hourly' : (nextHasHalfDay ? 'halfday' : 'daily');
          setRoomSelections(prev => ({
            ...prev,
            [nextRoom.id]: { mode: fallbackMode, startTime: '', endTime: '', halfDaySlot: '', dailySlot: '', isTimeCleared: true }
          }));
          setRoomSwitchNotice(`ห้องนี้ไม่รองรับการจองแบบ${modeThai} กรุณาเลือกเวลาใหม่`);
        } else {
          const [sH, sM] = curSel.startTime.split(':').map(Number);
          const [eH, eM] = curSel.endTime.split(':').map(Number);
          const isNextFree = isIntervalClear(nextRoom.id, sH * 60 + (sM || 0), eH * 60 + (eM || 0));

          if (isNextFree) {
            setRoomSelections(prev => ({
              ...prev,
              [nextRoom.id]: {
                mode: curSel.mode,
                startTime: curSel.rawStartTime || curSel.startTime,
                endTime: curSel.rawEndTime || curSel.endTime,
                halfDaySlot: curSel.halfDaySlot,
                dailySlot: curSel.dailySlot,
                isTimeCleared: false
              }
            }));
            setRoomSwitchNotice('');
          } else {
            setRoomSelections(prev => ({
              ...prev,
              [nextRoom.id]: { mode: curSel.mode, startTime: '', endTime: '', halfDaySlot: '', dailySlot: '', isTimeCleared: true }
            }));
            setRoomSwitchNotice('ห้องนี้ไม่ว่างในช่วงเดิม กรุณาเลือกเวลาใหม่');
          }
        }
      } else {
        setRoomSwitchNotice('');
      }
    }

    setActiveRoomId(nextRoom.id);
    if (searchMode === 'directRoom') {
      setConfirmedRoomId(nextRoom.id);
    }
  };

  // Scroll once to the new room's photo & title after switching to a different room
  useEffect(() => {
    if (!pendingScrollAfterRoomSwitchRef.current || !activeRoom?.id) return;
    pendingScrollAfterRoomSwitchRef.current = false;

    const rafId = window.requestAnimationFrame(() => {
      const targetEl = roomPhotoSectionRef.current;
      if (!targetEl) return;
      const headerEl = document.querySelector('header, .app-header, .navbar');
      const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 64;
      const offsetTop = targetEl.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
      window.scrollTo({
        top: Math.max(0, Math.round(offsetTop)),
        behavior: 'smooth'
      });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [activeRoom?.id]);

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

    if (sel.isTimeCleared || !sel.startTime || !sel.endTime) {
      setTimelineError('กรุณาเลือกช่วงเวลาที่ต้องการจอง');
      return;
    }

    const occupiedCheck = getRoomOccupiedInfo(room.id, sel.startTime, sel.endTime);
    if (occupiedCheck.isOccupied) {
      setTimelineError(occupiedCheck.label || 'ช่วงเวลานี้ไม่ว่าง กรุณาเลือกเวลาใหม่');
      return;
    }

    let payloadGuests = '';
    if (searchMode === 'byGuests') {
      const parsedGuests = parseInt(guests, 10);
      if (!guests || isNaN(parsedGuests) || parsedGuests < 1) {
        setDirectGuestError('กรุณาระบุจำนวนผู้เข้าใช้งานอย่างน้อย 1 ท่านก่อนกรอกข้อมูลผู้จอง');
        return;
      }
      if (parsedGuests > sel.effectiveCapacity) {
        setDirectGuestError(`จำนวนผู้เข้าใช้งาน (${parsedGuests} ท่าน) เกินความจุของห้อง (${sel.effectiveCapacity} ท่านสำหรับรูปแบบโต๊ะนี้)`);
        return;
      }
      payloadGuests = parsedGuests;
    } else {
      // directRoom mode locks attendee count to selected room's layout capacity
      payloadGuests = sel.effectiveCapacity;
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
      guests: payloadGuests,
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
    setSlotTooltip(null);
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

    const curStep = currentSel.isTimeCleared ? 'start' : (timelineTapStep[room.id] || 'start');

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
      if (currentSel.isTimeCleared || curEndMins <= targetStartMins || !isIntervalClear(room.id, targetStartMins, curEndMins)) {
        if (targetStartMins + 60 <= 18 * 60 && isIntervalClear(room.id, targetStartMins, targetStartMins + 60)) {
          chosenEnd = `${String(Math.floor((targetStartMins + 60) / 60)).padStart(2, '0')}:${String((targetStartMins + 60) % 60).padStart(2, '0')}`;
        } else {
          chosenEnd = `${String(Math.floor((targetStartMins + 30) / 60)).padStart(2, '0')}:${String((targetStartMins + 30) % 60).padStart(2, '0')}`;
        }
      }

      setHasUserPickedTime(true);
      setRoomSwitchNotice('');
      setRoomSelections(prev => ({
        ...prev,
        [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStartStr, endTime: chosenEnd, isTimeCleared: false }
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

        setHasUserPickedTime(true);
        setRoomSwitchNotice('');
        setRoomSelections(prev => ({
          ...prev,
          [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStartStr, endTime: chosenEnd, isTimeCleared: false }
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
      setHasUserPickedTime(true);
      setRoomSwitchNotice('');
      setRoomSelections(prev => ({
        ...prev,
        [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: newEndStr, isTimeCleared: false }
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

    setHasUserPickedTime(true);
    setRoomSwitchNotice('');
    setRoomSelections(prev => ({
      ...prev,
      [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', startTime: newStart, endTime: chosenEnd, isTimeCleared: false }
    }));
    setTimelineTapStep(prev => ({ ...prev, [room.id]: 'end' }));
  };

  // Handle dragging start / end handles (works from first touch without prior tap or dropdown interaction)
  const handleArrowPointerDown = (type, room, e, sel = null) => {
    e.preventDefault();
    e.stopPropagation();
    setSlotTooltip(null);
    setTimelineError('');
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}

    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const resolvedSel = sel || getRoomSelection(room);
    const curStart = resolvedSel?.startTime || globalStartTime;
    const curEnd = resolvedSel?.endTime || globalEndTime;
    if (!curStart || !curEnd) return;

    const [cSH, cSM] = curStart.split(':').map(Number);
    const [cEH, cEM] = curEnd.split(':').map(Number);
    const curStartMins = cSH * 60 + (cSM || 0);
    const curEndMins = cEH * 60 + (cEM || 0);

    // Seed explicit roomSelection immediately on first touch so state matches the displayed range
    setRoomSelections(prev => {
      const existing = prev[room.id];
      if (existing && existing.startTime === curStart && existing.endTime === curEnd && !existing.isTimeCleared) {
        return prev;
      }
      return {
        ...prev,
        [room.id]: {
          ...(existing || {}),
          mode: 'hourly',
          startTime: curStart,
          endTime: curEnd,
          isTimeCleared: false
        }
      };
    });

    draggingRef.current = {
      type,
      roomId: room.id,
      room,
      rect,
      pointerId: e.pointerId,
      curStart,
      curEnd,
      curStartMins,
      curEndMins
    };
    setActiveDrag({ roomId: room.id, type });
  };

  const handleArrowPointerMove = (e) => {
    if (!draggingRef.current || draggingRef.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const drag = draggingRef.current;
    const { type, room, rect } = drag;
    const width = rect.width;
    if (width <= 0) return;

    const currentX = e.clientX - rect.left;
    let pct = currentX / width;
    if (pct < 0) pct = 0;
    if (pct > 1) pct = 1;

    // 08:00 (480 mins) to 18:00 (1080 mins) = 600 minutes total
    const clickedMinute = 480 + pct * 600;
    let targetMins = Math.round(clickedMinute / 30) * 30;

    const { curStart, curEnd, curStartMins, curEndMins } = drag;

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
        drag.curStart = newStartStr;
        drag.curStartMins = targetMins;
        setHasUserPickedTime(true);
        setRoomSwitchNotice('');
        setRoomSelections(prev => ({
          ...prev,
          [room.id]: {
            ...(prev[room.id] || {}),
            mode: 'hourly',
            startTime: newStartStr,
            endTime: curEnd,
            isTimeCleared: false
          }
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
        drag.curEnd = newEndStr;
        drag.curEndMins = targetMins;
        setHasUserPickedTime(true);
        setRoomSwitchNotice('');
        setRoomSelections(prev => ({
          ...prev,
          [room.id]: {
            ...(prev[room.id] || {}),
            mode: 'hourly',
            startTime: curStart,
            endTime: newEndStr,
            isTimeCleared: false
          }
        }));
      }
    }
  };

  const handleArrowPointerUp = (e) => {
    if (draggingRef.current && (!e || e.pointerId === undefined || draggingRef.current.pointerId === e.pointerId)) {
      try {
        if (e && e.currentTarget && e.pointerId !== undefined) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
      draggingRef.current = null;
      setActiveDrag(null);
    }
  };

  // Handle End Time Change via Dropdown
  const handleEndTimeDropdownChange = (room, newEnd) => {
    if (!newEnd) return;
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

    setHasUserPickedTime(true);
    setRoomSwitchNotice('');
    setRoomSelections(prev => ({
      ...prev,
      [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', endTime: newEnd, isTimeCleared: false }
    }));
    setTimelineTapStep(prev => ({ ...prev, [room.id]: 'start' }));
  };

  // Render Horizontal Timeline Bar (08:00 - 18:00, 20 slots of 30 mins)
  const renderInteractiveTimelineBar = (room, sel) => {
    const hasSelectedRange = Boolean(!sel.isTimeCleared && sel.startTime && sel.endTime && sel.endTime > sel.startTime);
    const [selSH, selSM] = hasSelectedRange ? sel.startTime.split(':').map(Number) : [0, 0];
    const [selEH, selEM] = hasSelectedRange ? sel.endTime.split(':').map(Number) : [0, 0];
    const selStartMins = hasSelectedRange ? (selSH * 60 + selSM) : -1;
    const selEndMins = hasSelectedRange ? (selEH * 60 + selEM) : -1;

    const slots = [];
    for (let i = 0; i < 20; i++) {
      const slotStart = 8 * 60 + i * 30;
      const slotEnd = slotStart + 30;
      const slotStartStr = `${String(Math.floor(slotStart / 60)).padStart(2, '0')}:${String(slotStart % 60).padStart(2, '0')}`;
      const slotEndStr = `${String(Math.floor(slotEnd / 60)).padStart(2, '0')}:${String(slotEnd % 60).padStart(2, '0')}`;

      const isPast = isToday && slotStart <= currentMins;
      const occupiedInfo = getRoomOccupiedInfo(room.id, slotStartStr, slotEndStr);

      let bgColor = '#6EE7B7'; // ว่าง (เขียวมิ้นต์ชัดขึ้น)
      let type = 'available';

      if (isPast) {
        type = 'past';
        bgColor = '#64748B'; // ผ่านเวลาเริ่มแล้ว (เทาทึบ)
      } else if (occupiedInfo.isOccupied) {
        if (occupiedInfo.reason === 'cleaning') {
          type = 'cleaning';
          bgColor = '#FACC15'; // ทำความสะอาด (เหลืองทอง)
        } else {
          type = 'booked';
          bgColor = '#F47B5B'; // ติดจอง (ส้มอมแดง)
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

    // Merge contiguous 'booked' / 'cleaning' slots so hover/tap displays full range & 30-min cleaning duration
    const toTimelinePct = (mins) => Math.max(0, Math.min(100, ((mins - 480) / 600) * 100));
    let idx = 0;
    while (idx < slots.length) {
      const sType = slots[idx].type;
      if (sType === 'booked' || sType === 'cleaning') {
        let endIdx = idx;
        while (endIdx + 1 < slots.length && slots[endIdx + 1].type === sType) {
          endIdx++;
        }
        const blockStartStr = slots[idx].startStr;
        const blockEndStr = slots[endIdx].endStr;
        const blockMins = (endIdx - idx + 1) * 30;
        const tooltipText = sType === 'cleaning'
          ? `ทำความสะอาด · ${blockMins} นาที (${blockStartStr}–${blockEndStr} น.)`
          : `ติดจอง (${blockStartStr}–${blockEndStr} น.)`;
        const blockCenterPct = toTimelinePct((slots[idx].startMins + slots[endIdx].endMins) / 2);
        for (let k = idx; k <= endIdx; k++) {
          slots[k].tooltipText = tooltipText;
          slots[k].blockCenterPct = blockCenterPct;
        }
        idx = endIdx + 1;
      } else {
        idx++;
      }
    }

    const selStartPct = hasSelectedRange ? toTimelinePct(selStartMins) : 0;
    const selEndPct = hasSelectedRange ? toTimelinePct(selEndMins) : 0;
    const isDraggingThisRoom = Boolean(activeDrag && activeDrag.roomId === room.id);
    const activeDragType = isDraggingThisRoom ? activeDrag.type : null;
    const isPillsCrowded = (selEndPct - selStartPct) < 22;

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
    if (hasSelectedRange) {
      for (let m = selStartMins + 30; m <= 18 * 60; m += 30) {
        if (isIntervalClear(room.id, selStartMins, m)) {
          const endStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          validEndOptions.push({ time: endStr, value: endStr });
        } else {
          break;
        }
      }
    }

    const timeMarkers = [480, 600, 720, 840, 960, 1080].map(mins => ({
      mins,
      time: `${String(Math.floor(mins / 60)).padStart(2, '0')}:00`,
      pct: toTimelinePct(mins)
    }));

    // Internal 30-min ticks inside the horizontal bar (08:30 .. 17:30)
    const internalTicks = [];
    for (let i = 1; i < 20; i++) {
      const tickMins = 480 + i * 30;
      internalTicks.push({
        mins: tickMins,
        pct: toTimelinePct(tickMins),
        isFullHour: tickMins % 60 === 0,
        isInsideSelected: hasSelectedRange && tickMins > selStartMins && tickMins < selEndMins
      });
    }

    return (
      <div className="timeline-bar-wrapper" data-timeline-style="D">
        {/* 2-Hour Axis Labels Above the Bar (aligned with toTimelinePct) */}
        <div style={{ position: 'relative', height: '16px', margin: '0 18px 4px 18px' }}>
          {timeMarkers.map(m => (
            <div
              key={m.time}
              data-axis-time={m.time}
              style={{
                position: 'absolute',
                left: `${m.pct}%`,
                transform: 'translateX(-50%)',
                textAlign: 'center',
                color: '#475569',
                fontSize: '0.74rem',
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

        {/* Live Floating Start / End Time Pills Above Handles (Style D) */}
        {hasSelectedRange && (
          <div
            data-testid={`timeline-pills-${room.id}`}
            style={{ position: 'relative', height: '24px', margin: '0 18px 4px 18px', pointerEvents: 'none' }}
          >
            {isPillsCrowded && !isDraggingThisRoom ? (
              <div
                data-testid={`timeline-pill-combined-${room.id}`}
                style={{
                  position: 'absolute',
                  left: `${Math.max(18, Math.min(82, (selStartPct + selEndPct) / 2))}%`,
                  bottom: 0,
                  transform: 'translateX(-50%)',
                  backgroundColor: '#0F766E',
                  color: '#FFFFFF',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 2px 6px rgba(15, 118, 110, 0.28)',
                  lineHeight: 1.3
                }}
              >
                {sel.startTime}–{sel.endTime}
              </div>
            ) : (
              <>
                {(!isPillsCrowded || activeDragType === 'start') && (
                  <div
                    data-testid={`timeline-pill-start-${room.id}`}
                    style={{
                      position: 'absolute',
                      left: `${Math.max(8, Math.min(92, selStartPct))}%`,
                      bottom: 0,
                      transform: 'translateX(-50%)',
                      backgroundColor: activeDragType === 'start' ? '#0F766E' : '#FFFFFF',
                      color: activeDragType === 'start' ? '#FFFFFF' : '#0F766E',
                      border: '1.5px solid #0F766E',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '1px 7px',
                      borderRadius: '999px',
                      whiteSpace: 'nowrap',
                      boxShadow: activeDragType === 'start' ? '0 3px 8px rgba(15, 118, 110, 0.35)' : '0 1px 4px rgba(15, 23, 42, 0.1)',
                      lineHeight: 1.35,
                      zIndex: activeDragType === 'start' ? 12 : 10
                    }}
                  >
                    {sel.startTime}
                  </div>
                )}
                {(!isPillsCrowded || activeDragType === 'end') && (
                  <div
                    data-testid={`timeline-pill-end-${room.id}`}
                    style={{
                      position: 'absolute',
                      left: `${Math.max(8, Math.min(92, selEndPct))}%`,
                      bottom: 0,
                      transform: 'translateX(-50%)',
                      backgroundColor: activeDragType === 'end' ? '#0F766E' : '#FFFFFF',
                      color: activeDragType === 'end' ? '#FFFFFF' : '#0F766E',
                      border: '1.5px solid #0F766E',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '1px 7px',
                      borderRadius: '999px',
                      whiteSpace: 'nowrap',
                      boxShadow: activeDragType === 'end' ? '0 3px 8px rgba(15, 118, 110, 0.35)' : '0 1px 4px rgba(15, 23, 42, 0.1)',
                      lineHeight: 1.35,
                      zIndex: activeDragType === 'end' ? 12 : 10
                    }}
                  >
                    {sel.endTime}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Style D Horizontal Bar Container with Internal 30-min Ticks & Draggable Edge/Knob Handles */}
        <div
          data-testid={`timeline-track-${room.id}`}
          style={{
            position: 'relative',
            height: '32px',
            margin: '2px 18px 0 18px',
            touchAction: 'pan-y',
            userSelect: 'none'
          }}
        >
          {/* Slot Status Tooltip (Hover on Desktop / Tap on Mobile for booked & cleaning slots) */}
          {slotTooltip && slotTooltip.roomId === room.id && (
            <div
              data-testid={`timeline-slot-tooltip-${room.id}`}
              role="status"
              style={{
                position: 'absolute',
                left: `${Math.max(20, Math.min(80, slotTooltip.pct))}%`,
                bottom: 'calc(100% + 10px)',
                transform: 'translateX(-50%)',
                backgroundColor: '#0F172A',
                color: '#FFFFFF',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '5px 10px',
                borderRadius: '8px',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.28)',
                zIndex: 25,
                pointerEvents: 'none'
              }}
            >
              {slotTooltip.text}
            </div>
          )}

          {/* Background Capsule Tube Track */}
          <div
            onClick={(e) => handleTimelineBarClick(room, e)}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              borderRadius: '9999px',
              overflow: 'hidden',
              backgroundColor: '#6EE7B7',
              cursor: 'pointer'
            }}
            title="แตะเพื่อเลือกเวลา"
          >
            {slots.map(s => {
              const isInspectable = s.type === 'booked' || s.type === 'cleaning';
              return (
                <div
                  key={s.index}
                  data-slot-type={s.type}
                  data-slot-start={s.startStr}
                  data-slot-tooltip={s.tooltipText || ''}
                  onMouseEnter={isInspectable ? () => setSlotTooltip({ roomId: room.id, text: s.tooltipText, pct: s.blockCenterPct, type: s.type }) : undefined}
                  onMouseLeave={isInspectable ? () => setSlotTooltip(prev => (prev && prev.roomId === room.id ? null : prev)) : undefined}
                  onClick={
                    isInspectable
                      ? (e) => {
                          e.stopPropagation();
                          setTimelineError('');
                          setSlotTooltip({ roomId: room.id, text: s.tooltipText, pct: s.blockCenterPct, type: s.type });
                        }
                      : s.type === 'past'
                      ? (e) => {
                          e.stopPropagation();
                        }
                      : undefined
                  }
                  style={{
                    flex: 1,
                    height: '100%',
                    backgroundColor: s.bgColor,
                    border: 'none',
                    cursor: s.type === 'past' ? 'not-allowed' : isInspectable ? 'help' : 'pointer'
                  }}
                />
              );
            })}
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

          {/* Internal 30-min Ruler Ticks Inside the Bar (Full-hour taller than half-hour) */}
          <div
            data-testid={`timeline-ticks-${room.id}`}
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 3,
              overflow: 'hidden',
              borderRadius: '9999px'
            }}
          >
            {internalTicks.map(tk => (
              <span
                key={tk.mins}
                data-tick-mins={tk.mins}
                data-tick-kind={tk.isFullHour ? 'hour' : 'half'}
                style={{
                  position: 'absolute',
                  left: `${tk.pct}%`,
                  bottom: 0,
                  transform: 'translateX(-50%)',
                  width: tk.isFullHour ? '1.5px' : '1px',
                  height: tk.isFullHour ? '12px' : '7px',
                  backgroundColor: tk.isInsideSelected
                    ? 'rgba(255, 255, 255, 0.72)'
                    : 'rgba(15, 23, 42, 0.28)',
                  borderRadius: '1px 1px 0 0'
                }}
              />
            ))}
          </div>

          {/* Left Draggable Knob + Edge Hit-Target (adjusts Start Time) */}
          {selEndPct > selStartPct && (
            <div
              data-testid={`timeline-edge-start-${room.id}`}
              className="timeline-edge-handle timeline-edge-handle--start"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => handleArrowPointerDown('start', room, e, sel)}
              onPointerMove={handleArrowPointerMove}
              onPointerUp={handleArrowPointerUp}
              onPointerCancel={handleArrowPointerUp}
              onLostPointerCapture={handleArrowPointerUp}
              style={{
                position: 'absolute',
                left: `${selStartPct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '38px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
                cursor: 'ew-resize',
                touchAction: 'none',
                zIndex: activeDragType === 'start' ? 15 : 12
              }}
              title="ลากขอบซ้ายเพื่อปรับเวลาเริ่ม"
              aria-label="ลากขอบซ้ายเพื่อปรับเวลาเริ่ม"
            >
              <span
                style={{
                  width: activeDragType === 'start' ? '22px' : '18px',
                  height: activeDragType === 'start' ? '22px' : '18px',
                  borderRadius: '50%',
                  backgroundColor: '#FFFFFF',
                  border: '2.5px solid #0F766E',
                  boxShadow: activeDragType === 'start'
                    ? '0 0 0 4px rgba(15, 118, 110, 0.22), 0 2px 6px rgba(15, 23, 42, 0.25)'
                    : '0 2px 6px rgba(15, 23, 42, 0.22)',
                  pointerEvents: 'none',
                  transition: 'width 0.12s ease, height 0.12s ease, box-shadow 0.12s ease'
                }}
              />
            </div>
          )}

          {/* Right Draggable Knob + Edge Hit-Target (adjusts End Time) */}
          {selEndPct > selStartPct && (
            <div
              data-testid={`timeline-edge-end-${room.id}`}
              className="timeline-edge-handle timeline-edge-handle--end"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => handleArrowPointerDown('end', room, e, sel)}
              onPointerMove={handleArrowPointerMove}
              onPointerUp={handleArrowPointerUp}
              onPointerCancel={handleArrowPointerUp}
              onLostPointerCapture={handleArrowPointerUp}
              style={{
                position: 'absolute',
                left: `${selEndPct}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '38px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
                cursor: 'ew-resize',
                touchAction: 'none',
                zIndex: activeDragType === 'end' ? 15 : 12
              }}
              title="ลากขอบขวาเพื่อปรับเวลาสิ้นสุด"
              aria-label="ลากขอบขวาเพื่อปรับเวลาสิ้นสุด"
            >
              <span
                style={{
                  width: activeDragType === 'end' ? '22px' : '18px',
                  height: activeDragType === 'end' ? '22px' : '18px',
                  borderRadius: '50%',
                  backgroundColor: '#FFFFFF',
                  border: '2.5px solid #0F766E',
                  boxShadow: activeDragType === 'end'
                    ? '0 0 0 4px rgba(15, 118, 110, 0.22), 0 2px 6px rgba(15, 23, 42, 0.25)'
                    : '0 2px 6px rgba(15, 23, 42, 0.22)',
                  pointerEvents: 'none',
                  transition: 'width 0.12s ease, height 0.12s ease, box-shadow 0.12s ease'
                }}
              />
            </div>
          )}
        </div>

        {/* Legend Row */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '14px', margin: '14px 18px 0 18px', fontSize: '0.82rem', color: '#0F172A', fontWeight: 600 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#6EE7B7' }} />
            ว่าง
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#F47B5B' }} />
            ติดจอง
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FACC15' }} />
            ทำความสะอาด
          </span>
        </div>

        {/* Short Instruction */}
        <div style={{ fontSize: '0.84rem', color: '#64748B', fontWeight: 600, margin: '8px 18px 0 18px' }}>
          แตะบนแถบ หรือลากจุดจับซ้าย–ขวาเพื่อปรับเวลา
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
                id={`select-start-time-${room.id}`}
                value={sel.startTime}
                onChange={(e) => {
                  if (e.target.value) handleStartTimeDropdownChange(room, e.target.value);
                }}
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
                {!hasSelectedRange && <option value="">-- เลือกเวลา --</option>}
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
                id={`select-end-time-${room.id}`}
                value={sel.endTime}
                disabled={!hasSelectedRange}
                onChange={(e) => handleEndTimeDropdownChange(room, e.target.value)}
                style={{
                  width: '100%',
                  height: '46px',
                  padding: '0 36px 0 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #CBD5E1',
                  backgroundColor: !hasSelectedRange ? '#f8fafc' : '#ffffff',
                  color: '#0F172A',
                  fontSize: '1rem',
                  fontWeight: 700,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  cursor: !hasSelectedRange ? 'not-allowed' : 'pointer',
                  outline: 'none'
                }}
              >
                {!hasSelectedRange && <option value="">-- เลือกเวลา --</option>}
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

  // Render Master-Detail Single Room View (Desktop: Left Photo + Switcher, Right Details + Timeline; Mobile: Photo -> Switcher Button -> Details + Timeline)
  const renderSingleRoomView = (room) => {
    if (!room) return null;
    const sel = getRoomSelection(room);
    const hasBookableSlotToday = !schedule || hasAnyBookableSlotInDay(room.id);
    const isCleared = Boolean(sel.isTimeCleared || !sel.startTime || !sel.endTime);
    const occInfo = isCleared
      ? { isOccupied: true, label: 'กรุณาเลือกช่วงเวลา', reason: 'cleared' }
      : getRoomOccupiedInfo(room.id, sel.startTime, sel.endTime);
    const { isOccupied, label: statusLabel, reason } = occInfo;
    const currentLayout = roomLayouts[room.id] || 'standard';
    const isClassroom = currentLayout === 'classroom';
    const rawImage = isClassroom && room.classroom_image_url ? room.classroom_image_url : room.image_url;
    const displayImage = getRoomImageUrl(room, isClassroom);

    const reqGuests = Math.max(1, parseInt(guests, 10) || 1);
    let layoutConditionNotice = '';
    if (room.has_classroom === 1) {
      if (reqGuests > (room.capacity || 4) && reqGuests <= (room.classroom_capacity || 4)) {
        layoutConditionNotice = `รองรับ ${reqGuests} ท่านเฉพาะการจัดโต๊ะแบบ Classroom (${room.classroom_capacity} ที่นั่ง)`;
      } else if (reqGuests <= (room.capacity || 4) && reqGuests > (room.classroom_capacity || 4)) {
        layoutConditionNotice = `จัดโต๊ะแบบ Standard รองรับได้ ${room.capacity} ท่าน`;
      }
    }

    const halfDay0812Info = getRoomOccupiedInfo(room.id, '08:00', '12:00');
    const halfDay1317Info = getRoomOccupiedInfo(room.id, '13:00', '17:00');
    const daily0817Info = getRoomOccupiedInfo(room.id, '08:00', '17:00');
    const daily0918Info = getRoomOccupiedInfo(room.id, '09:00', '18:00');

    const renderSwitcherRows = (prefix) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {switcherRooms.map(r => {
          const isActive = String(r.id) === String(room.id);
          const cap = getRoomMaxCap(r);
          const startPriceText = getRoomStartingPriceText(r);
          return (
            <button
              key={r.id}
              type="button"
              data-testid={`${prefix}-switch-room-${r.id}`}
              onClick={() => handleSwitchActiveRoom(r)}
              className={`room-switcher-item ${isActive ? 'room-switcher-item--active' : ''}`}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 800, color: isActive ? '#0F766E' : 'var(--navy)', lineHeight: 1.25 }}>
                  {r.name}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  รองรับ {cap} ที่นั่ง{startPriceText ? ` · ${startPriceText}` : ''}
                </div>
              </div>
              {isActive && (
                <CheckCircle2 size={17} color="#0F766E" style={{ flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>
    );

    return (
      <div className="room-detail-layout" id={`single-room-view-${room.id}`} ref={roomPhotoSectionRef}>
        {/* LEFT COLUMN: ROOM PHOTO + SWITCHER (DESKTOP LIST / MOBILE BUTTON) */}
        <div className="room-detail-left">
          {/* Room Photo */}
          <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', height: '215px', backgroundColor: '#f1f5f9', border: '1.5px solid var(--border)' }}>
            {displayImage ? (
              <img
                src={displayImage}
                alt={room.name}
                onError={(e) => handleRoomImageError(e, rawImage)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                <Building size={48} />
              </div>
            )}
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              padding: '5px 12px',
              borderRadius: '20px',
              fontSize: '0.74rem',
              fontWeight: 800,
              backgroundColor: !hasBookableSlotToday
                ? 'rgba(239, 68, 68, 0.95)'
                : isCleared
                ? 'rgba(15, 23, 42, 0.85)'
                : isOccupied
                ? (reason === 'cleaning' ? 'rgba(245, 158, 11, 0.95)' : 'rgba(239, 68, 68, 0.95)')
                : 'rgba(16, 185, 129, 0.95)',
              color: '#ffffff',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}>
              {!hasBookableSlotToday ? 'เต็มทั้งวัน' : statusLabel}
            </div>
          </div>

          {/* DESKTOP (>= 1024px): Room Switcher List below photo */}
          {switcherRooms.length > 0 && (
            <div className="room-switcher-desktop" id="desktop-room-switcher">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--navy)' }}>เปลี่ยนห้อง</span>
                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)' }}>({switcherRooms.length} ห้อง)</span>
              </div>
              {renderSwitcherRows('desktop')}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: ACTIVE ROOM DETAILS & TIMELINE */}
        <div className="room-detail-right" id={`room-card-${room.id}`}>
          {/* Soft grey capacity notice when fitting room is full or exact size doesn't exist */}
          {searchMode === 'byGuests' && capacityNotice && (
            <div
              id="room-capacity-notice"
              style={{
                marginBottom: '12px',
                padding: '10px 14px',
                borderRadius: '10px',
                backgroundColor: '#f1f5f9',
                color: '#475569',
                fontSize: '0.8rem',
                fontWeight: 600,
                lineHeight: 1.45
              }}
            >
              <div>{capacityNotice.line1}</div>
              {capacityNotice.line2 && <div>{capacityNotice.line2}</div>}
            </div>
          )}

          {/* Direct Room Full Notice */}
          {searchMode === 'directRoom' && !hasBookableSlotToday && (
            <div
              id="direct-room-full-notice"
              style={{
                marginBottom: '12px',
                padding: '10px 14px',
                borderRadius: '10px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                fontSize: '0.84rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>ห้องนี้ไม่มีช่วงว่างในวันที่เลือก</span>
            </div>
          )}

          {/* Room Switch Notice (when switched room is unavailable at previous time or mode unsupported) */}
          {roomSwitchNotice && (
            <div
              id="room-switch-notice"
              style={{
                marginBottom: '12px',
                padding: '10px 14px',
                borderRadius: '10px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#b45309',
                fontSize: '0.82rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, color: '#d97706' }} />
              <span>{roomSwitchNotice}</span>
            </div>
          )}

          {/* Room Title & Capacity */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: 'var(--navy)' }}>
                {room.name}
              </h3>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#334155' }}>
                  <Users size={14} color="var(--primary)" />
                  รองรับ {sel.effectiveCapacity} ที่นั่ง
                </span>
                {room.floor && <span>· ชั้น {room.floor}</span>}
                <span>· {formatShortThaiDate(dateStr)}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--primary)' }} id="active-room-starting-price">
                {getRoomStartingPriceText(room, sel)}
              </div>
            </div>
          </div>

          {layoutConditionNotice && (
            <div style={{ marginBottom: '10px', padding: '7px 10px', borderRadius: '8px', backgroundColor: '#f0f9ff', color: '#0369a1', fontSize: '0.76rem', fontWeight: 700 }}>
              {layoutConditionNotice}
            </div>
          )}

          {/* Classroom Layout Toggle (if supported) */}
          {room.has_classroom === 1 && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                type="button"
                onClick={() => setRoomLayouts(prev => ({ ...prev, [room.id]: 'standard' }))}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '10px',
                  border: !isClassroom ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                  backgroundColor: !isClassroom ? 'var(--primary-light)' : '#ffffff',
                  color: !isClassroom ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Standard ({room.capacity} ที่นั่ง)
              </button>
              <button
                type="button"
                onClick={() => setRoomLayouts(prev => ({ ...prev, [room.id]: 'classroom' }))}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '10px',
                  border: isClassroom ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                  backgroundColor: isClassroom ? 'var(--primary-light)' : '#ffffff',
                  color: isClassroom ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Classroom ({room.classroom_capacity || room.capacity} ที่นั่ง)
              </button>
            </div>
          )}

          {/* Booking Mode Tabs (Hourly / Half-Day / Daily) */}
          {[sel.hasHourly, sel.hasHalfDay, sel.hasDaily].filter(Boolean).length > 1 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${[sel.hasHourly, sel.hasHalfDay, sel.hasDaily].filter(Boolean).length}, 1fr)`,
              gap: '8px',
              marginBottom: '14px'
            }}>
              {sel.hasHourly && (
                <button
                  type="button"
                  onClick={() => {
                    setHasUserPickedTime(true);
                    setRoomSwitchNotice('');
                    setRoomSelections(prev => ({ ...prev, [room.id]: { ...(prev[room.id] || {}), mode: 'hourly', isTimeCleared: false } }));
                  }}
                  style={{
                    padding: '9px 6px',
                    borderRadius: '10px',
                    border: sel.mode === 'hourly' ? '1.5px solid #0F766E' : '1px solid var(--border)',
                    backgroundColor: sel.mode === 'hourly' ? '#0F766E' : '#ffffff',
                    color: sel.mode === 'hourly' ? '#ffffff' : 'var(--navy)',
                    fontSize: '0.84rem',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  รายชั่วโมง
                </button>
              )}
              {sel.hasHalfDay && (
                <button
                  type="button"
                  onClick={() => {
                    setHasUserPickedTime(true);
                    setRoomSwitchNotice('');
                    setRoomSelections(prev => ({ ...prev, [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: prev[room.id]?.halfDaySlot || '08-12', isTimeCleared: false } }));
                  }}
                  style={{
                    padding: '9px 6px',
                    borderRadius: '10px',
                    border: sel.mode === 'halfday' ? '1.5px solid #0F766E' : '1px solid var(--border)',
                    backgroundColor: sel.mode === 'halfday' ? '#0F766E' : '#ffffff',
                    color: sel.mode === 'halfday' ? '#ffffff' : 'var(--navy)',
                    fontSize: '0.84rem',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  ครึ่งวัน
                </button>
              )}
              {sel.hasDaily && (
                <button
                  type="button"
                  onClick={() => {
                    setHasUserPickedTime(true);
                    setRoomSwitchNotice('');
                    setRoomSelections(prev => ({ ...prev, [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: prev[room.id]?.dailySlot || '08-17', isTimeCleared: false } }));
                  }}
                  style={{
                    padding: '9px 6px',
                    borderRadius: '10px',
                    border: sel.mode === 'daily' ? '1.5px solid #0F766E' : '1px solid var(--border)',
                    backgroundColor: sel.mode === 'daily' ? '#0F766E' : '#ffffff',
                    color: sel.mode === 'daily' ? '#ffffff' : 'var(--navy)',
                    fontSize: '0.84rem',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  ทั้งวัน
                </button>
              )}
            </div>
          )}

          {/* TIMELINE BAR OR PACKAGE CARDS */}
          {sel.mode === 'hourly' && renderInteractiveTimelineBar(room, sel)}

          {sel.mode === 'halfday' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: '08-12', label: '08:00–12:00 น.', info: halfDay0812Info },
                { key: '13-17', label: '13:00–17:00 น.', info: halfDay1317Info }
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={opt.info.isOccupied}
                  onClick={() => {
                    setHasUserPickedTime(true);
                    setRoomSwitchNotice('');
                    setRoomSelections(prev => ({ ...prev, [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: opt.key, isTimeCleared: false } }));
                  }}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    border: sel.halfDaySlot === opt.key && !opt.info.isOccupied ? '2px solid #0F766E' : '1px solid var(--border)',
                    backgroundColor: opt.info.isOccupied ? '#f1f5f9' : (sel.halfDaySlot === opt.key ? '#f0fdfa' : '#ffffff'),
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: opt.info.isOccupied ? 'not-allowed' : 'pointer'
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, color: opt.info.isOccupied ? '#94a3b8' : 'var(--navy)' }}>{opt.label}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>4 ชม.</div>
                  </div>
                  <div style={{ fontWeight: 900, color: opt.info.isOccupied ? '#64748b' : '#0F766E' }}>
                    {opt.info.isOccupied ? 'ไม่ว่าง' : `฿${Number(sel.halfDayPrice).toLocaleString()}`}
                  </div>
                </button>
              ))}
            </div>
          )}

          {sel.mode === 'daily' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { key: '08-17', label: '08:00–17:00 น.', info: daily0817Info },
                { key: '09-18', label: '09:00–18:00 น.', info: daily0918Info }
              ].map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  disabled={opt.info.isOccupied}
                  onClick={() => {
                    setHasUserPickedTime(true);
                    setRoomSwitchNotice('');
                    setRoomSelections(prev => ({ ...prev, [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: opt.key, isTimeCleared: false } }));
                  }}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '12px',
                    border: sel.dailySlot === opt.key && !opt.info.isOccupied ? '2px solid #0F766E' : '1px solid var(--border)',
                    backgroundColor: opt.info.isOccupied ? '#f1f5f9' : (sel.dailySlot === opt.key ? '#f0fdfa' : '#ffffff'),
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: opt.info.isOccupied ? 'not-allowed' : 'pointer'
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 800, color: opt.info.isOccupied ? '#94a3b8' : 'var(--navy)' }}>{opt.label}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>9 ชม.</div>
                  </div>
                  <div style={{ fontWeight: 900, color: opt.info.isOccupied ? '#64748b' : '#0F766E' }}>
                    {opt.info.isOccupied ? 'ไม่ว่าง' : `฿${Number(sel.dailyPrice).toLocaleString()}`}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Summary Bar + CTA */}
          <div style={{
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div id="active-room-summary-time" style={{ fontSize: '1.08rem', fontWeight: 900, color: isCleared ? '#64748B' : '#0F766E' }}>
              {isCleared ? 'กรุณาเลือกช่วงเวลา' : `${sel.startTime}–${sel.endTime} น.${sel.durText ? ` · ${sel.durText}` : ''}`}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div id="active-room-summary-price" style={{ fontSize: '1.3rem', fontWeight: 900, color: isCleared ? '#94A3B8' : '#0F766E' }}>
                {isCleared ? '-' : `฿${Number(sel.totalPrice).toLocaleString()}`}
              </div>
              {!isCleared && sel.isPromotionApplied && (
                <div style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 700 }}>
                  ส่วนลดออนไลน์ {sel.discountValue ?? (promotion?.discount_value || 5)}% (-฿{Number(sel.discountAmount).toLocaleString()})
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={isCleared || isOccupied || !hasBookableSlotToday}
            onClick={() => handleProceedToForm(room)}
            className="btn-primary"
            id={`btn-book-room-${room.id}`}
            style={{
              width: '100%',
              height: '50px',
              fontSize: '0.94rem',
              fontWeight: 800,
              borderRadius: '12px',
              backgroundColor: (isCleared || isOccupied || !hasBookableSlotToday) ? '#cbd5e1' : '#0F766E',
              color: (isCleared || isOccupied || !hasBookableSlotToday) ? '#475569' : '#ffffff',
              border: 'none',
              cursor: (isCleared || isOccupied || !hasBookableSlotToday) ? 'not-allowed' : 'pointer',
              marginTop: '12px'
            }}
          >
            <span>
              {!hasBookableSlotToday
                ? 'ห้องนี้ไม่มีช่วงว่างในวันที่เลือก'
                : isCleared
                ? 'กรุณาเลือกเวลาใหม่'
                : isOccupied
                ? (reason === 'past' ? 'เลยเวลาเริ่มแล้ว' : 'ช่วงเวลานี้ไม่ว่าง')
                : 'กรอกข้อมูลผู้จอง'}
            </span>
          </button>
        </div>
      </div>
    );
  };

  const showMobileBottomRoomBar = Boolean(hasConfirmedDate && activeRoom && switcherRooms.length > 0 && !loading);

  const sevenDayHeader = useMemo(() => {
    if (sevenDayStripDates.length === 0) return formatThaiMonthYear(currentMonthKey);
    const first = sevenDayStripDates[0];
    const last = sevenDayStripDates[sevenDayStripDates.length - 1];
    if (first.monthKey === last.monthKey) {
      return formatThaiMonthYear(first.monthKey);
    }
    if (first.thaiYear === last.thaiYear) {
      return `${first.monthShort} – ${last.monthShort} ${first.thaiYear}`;
    }
    return `${first.monthShort} ${first.thaiYear} – ${last.monthShort} ${last.thaiYear}`;
  }, [sevenDayStripDates, currentMonthKey]);

  const renderFullMonthCalendarInner = () => (
    <>
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
                  data-cal-date={cell.date}
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
                    <span className="customer-cal-day__past-x" aria-hidden="true">
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" fill="none">
                        <line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
                        <line x1="100" y1="0" x2="0" y2="100" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
                      </svg>
                    </span>
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
    </>
  );

  return (
    <div className={`main-content ${showMobileBottomRoomBar ? 'has-bottom-room-bar' : ''}`}>
      {/* 3-STEP WIZARD PROGRESS BAR */}
      <StepProgress currentStep={1} />

      {/* 1A. MOBILE & IPAD (< 1024px): 7-DAY STRIP + "ดูทั้งเดือน" BUTTON */}
      {(isCalendarExpanded || !hasConfirmedDate) && (
        <section className="customer-cal-strip-card" id="seven-day-strip" aria-label="แถบเลือกวัน 7 วัน">
          <div className="customer-cal-strip-header">
            <div className="customer-cal-nav__title-group">
              <Calendar size={18} color="var(--primary)" />
              <h2 className="customer-cal-strip-title" id="seven-day-strip-title">
                {sevenDayHeader}
              </h2>
            </div>
            <button
              type="button"
              id="btn-open-full-month"
              className="customer-cal-fullmonth-btn"
              onClick={() => {
                setCurrentMonthKey((dateStr || todayIso).slice(0, 7));
                setIsFullMonthSheetOpen(true);
              }}
            >
              <Calendar size={14} />
              <span>ดูทั้งเดือน</span>
            </button>
          </div>

          <div className="customer-cal-strip-grid" role="group" aria-label="เลือกวันใน 7 วันข้างหน้า">
            {sevenDayStripCells.map(cell => {
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
                  data-strip-date={cell.date}
                  className={`customer-cal-strip-day ${cell.isToday ? 'customer-cal-day--today' : ''} ${isSelected ? 'customer-cal-day--selected' : ''} ${isPast ? 'customer-cal-day--past' : ''} ${isTodayExpired ? 'customer-cal-day--today-expired' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => handleDateTap(cell.date)}
                >
                  <span className="customer-cal-strip-day__weekday">{cell.weekdayShort}</span>
                  <span className="customer-cal-strip-day__num">
                    {cell.dayNumber}
                    {cell.isMonthStart && (
                      <span className="customer-cal-strip-day__month-tag">{cell.monthShort}</span>
                    )}
                  </span>
                  {isTodayExpired ? (
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
        </section>
      )}

      {/* 1B. DESKTOP (>= 1024px): INLINE FULL-MONTH CALENDAR CARD (COLLAPSES AFTER CONFIRM) */}
      {(isCalendarExpanded || !hasConfirmedDate) && (
      <section ref={calendarSectionRef} className="customer-cal-card customer-cal-desktop" aria-label="ปฏิทินเลือกวันจองห้องประชุม">
        {renderFullMonthCalendarInner()}
      </section>
      )}

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
      <div
        className={`customer-summary-filter-bar ${showMobileBottomRoomBar ? 'customer-summary-filter-bar--has-bottom-bar' : ''}`}
        id="summary-date-bar"
      >
        <div className="customer-summary-filter-info">
          <div className="customer-summary-filter-icon">
            <Calendar size={18} />
          </div>
          <div className="customer-summary-filter-body">
            {searchMode === 'byGuests' ? (
              <>
                <div className="customer-summary-filter-text">
                  {formatShortThaiDate(dateStr)} · {guests} คน
                </div>
                <div className="customer-summary-filter-sub">
                  ค้นหาตามจำนวนคน
                </div>
              </>
            ) : (
              <>
                <div className="customer-summary-filter-date" id="summary-direct-date">
                  {formatShortThaiDate(dateStr)}
                </div>
                <div className="customer-summary-filter-room" id="summary-direct-room">
                  ห้อง {activeRoom?.name || directSelectedRoom?.name || 'ที่เลือก'}
                </div>
                <div className="customer-summary-filter-sub">
                  ค้นหาแบบระบุห้อง
                </div>
              </>
            )}
          </div>
        </div>

        <div className="customer-summary-filter-actions">
          <button
            type="button"
            onClick={() => setIsCalendarExpanded(prev => !prev)}
            className="customer-summary-filter-change-btn"
            id="btn-expand-calendar"
          >
            <Calendar size={14} />
            <span>{isCalendarExpanded ? 'ซ่อนปฏิทิน' : 'เปลี่ยนวัน'}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenEditModal}
            className="customer-summary-filter-change-btn"
            id="btn-open-change-filter"
          >
            <Edit3 size={14} />
            <span>แก้ตัวเลือกการจอง</span>
          </button>
        </div>
      </div>

      {/* 3. SINGLE-ROOM MASTER-DETAIL VIEW */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px auto' }} />
          <div>กำลังโหลดข้อมูลห้องประชุมและเวลาว่าง…</div>
        </div>
      ) : searchMode === 'byGuests' && switcherRooms.length === 0 ? (
        /* EMPTY STATE: NO AVAILABLE ROOMS FOR GUEST COUNT ON SELECTED DATE */
        <div
          id="empty-rooms-for-date"
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
            <Calendar size={24} />
          </div>
          <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--navy)' }}>
            ไม่พบห้องว่างสำหรับ {guests} คนในวันที่เลือก
          </div>
          <button
            type="button"
            id="btn-change-date-empty"
            onClick={() => {
              setIsCalendarExpanded(true);
              setTimeout(() => {
                if (calendarSectionRef.current) {
                  calendarSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }, 50);
            }}
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
            เปลี่ยนวัน
          </button>
        </div>
      ) : (
        renderSingleRoomView(activeRoom)
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

            {modalMode === 'byGuests' && (
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
                {modalGuests ? `ระบบจะค้นหาห้องที่ว่างและรองรับได้สำหรับ ${modalGuests} ท่าน` : 'ระบุจำนวนคนเพื่อค้นหาห้องที่เหมาะสม'}
              </div>
            </div>
            )}

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
              disabled={modalMode === 'byGuests' ? (!modalGuests || parseInt(modalGuests, 10) < 1) : !modalRoomId}
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

      {/* 5. FULL-MONTH CALENDAR BOTTOM SHEET (MOBILE & IPAD < 1024px) */}
      {isFullMonthSheetOpen && (
        <div
          className="bottom-sheet-overlay"
          id="full-month-calendar-overlay"
          onClick={() => setIsFullMonthSheetOpen(false)}
        >
          <div
            className="bottom-sheet-container"
            id="full-month-calendar-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '540px', width: '100%' }}
          >
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-header">
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>
                  ปฏิทินเต็มเดือน
                </div>
                <h3 className="bottom-sheet-title">เลือกวันที่ต้องการจอง</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFullMonthSheetOpen(false)}
                className="bottom-sheet-close-btn"
                aria-label="ปิดปฏิทินเต็มเดือน"
                id="btn-close-full-month"
              >
                <X size={20} />
              </button>
            </div>
            <div className="customer-cal-sheet-body">
              {renderFullMonthCalendarInner()}
            </div>
          </div>
        </div>
      )}

      {/* 6. BOTTOM STICKY ACTION BAR (< 1024px AFTER ROOM SELECTED): [เปลี่ยนวัน] [เปลี่ยนห้อง] [⋯] */}
      {showMobileBottomRoomBar && (
        <div className="mobile-bottom-room-bar" id="bottom-room-switcher-bar" role="region" aria-label="แถบจัดการวันและห้องประชุม">
          <button
            type="button"
            id="btn-bottom-change-date"
            data-testid="bottom-change-date-btn"
            className="mobile-bottom-action-btn"
            onClick={() => {
              closeAllBottomSheets();
              setCurrentMonthKey((dateStr || todayIso).slice(0, 7));
              setIsFullMonthSheetOpen(true);
            }}
          >
            <Calendar size={16} />
            <span>เปลี่ยนวัน</span>
          </button>

          <button
            type="button"
            id="btn-mobile-switch-room"
            data-testid="bottom-room-switcher-btn"
            className="mobile-bottom-action-btn mobile-bottom-action-btn--primary"
            onClick={() => {
              closeAllBottomSheets();
              setIsMobileRoomListOpen(true);
            }}
          >
            <Building size={16} />
            <span>เปลี่ยนห้อง</span>
          </button>

          <button
            type="button"
            id="btn-bottom-more-options"
            data-testid="bottom-more-options-btn"
            aria-label="ตัวเลือกเพิ่มเติม"
            aria-expanded={isMoreOptionsOpen}
            className="mobile-bottom-action-btn mobile-bottom-action-btn--icon"
            onClick={() => {
              const nextOpen = !isMoreOptionsOpen;
              closeAllBottomSheets();
              setIsMoreOptionsOpen(nextOpen);
            }}
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
      )}

      {/* 6B. MORE OPTIONS BOTTOM SHEET MENU (< 1024px) */}
      {isMoreOptionsOpen && (
        <div
          className="bottom-sheet-overlay"
          id="bottom-more-options-overlay"
          onClick={() => setIsMoreOptionsOpen(false)}
        >
          <div
            className="bottom-sheet-container"
            id="bottom-more-options-menu"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '540px', width: '100%' }}
          >
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-header">
              <h3 className="bottom-sheet-title">ตัวเลือกเพิ่มเติม</h3>
              <button
                type="button"
                onClick={() => setIsMoreOptionsOpen(false)}
                className="bottom-sheet-close-btn"
                aria-label="ปิดตัวเลือกเพิ่มเติม"
                id="btn-close-more-options"
              >
                <X size={20} />
              </button>
            </div>
            <button
              type="button"
              id="btn-menu-edit-booking-options"
              onClick={handleOpenEditModal}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '14px 16px',
                borderRadius: '14px',
                border: '1.5px solid var(--border)',
                backgroundColor: '#ffffff',
                color: 'var(--navy)',
                fontSize: '0.94rem',
                fontWeight: 800,
                cursor: 'pointer'
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                <Edit3 size={18} color="var(--primary)" />
                <span>แก้ตัวเลือกการจอง</span>
              </span>
              <ChevronRight size={18} color="var(--text-muted)" />
            </button>
          </div>
        </div>
      )}

      {/* 7. ROOM SWITCHER BOTTOM SHEET (< 1024px) */}
      {isMobileRoomListOpen && activeRoom && switcherRooms.length > 0 && (
        <div
          className="bottom-sheet-overlay"
          id="mobile-room-switcher-overlay"
          onClick={() => setIsMobileRoomListOpen(false)}
        >
          <div
            className="bottom-sheet-container"
            id="mobile-room-switcher-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '540px', width: '100%' }}
          >
            <div className="bottom-sheet-handle" />
            <div className="bottom-sheet-header">
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>
                  เลือกห้องประชุม
                </div>
                <h3 className="bottom-sheet-title">เปลี่ยนห้อง ({switcherRooms.length} ห้อง)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileRoomListOpen(false)}
                className="bottom-sheet-close-btn"
                aria-label="ปิดรายการเปลี่ยนห้อง"
                id="btn-close-room-switcher"
              >
                <X size={20} />
              </button>
            </div>
            <div id="mobile-room-switcher-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {switcherRooms.map(r => {
                const isActive = String(r.id) === String(activeRoom.id);
                const cap = getRoomMaxCap(r);
                const startPriceText = getRoomStartingPriceText(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    data-testid={`mobile-switch-room-${r.id}`}
                    onClick={() => handleSwitchActiveRoom(r)}
                    className={`room-switcher-item ${isActive ? 'room-switcher-item--active' : ''}`}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 800, color: isActive ? '#0F766E' : 'var(--navy)', lineHeight: 1.3 }}>
                        {r.name}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        รองรับ {cap} ที่นั่ง{startPriceText ? ` · ${startPriceText}` : ''}
                      </div>
                    </div>
                    {isActive && (
                      <CheckCircle2 size={18} color="#0F766E" style={{ flexShrink: 0 }} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
