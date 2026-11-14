import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Users,
  Clock,
  Building,
  AlertCircle,
  CheckCircle2,
  X,
  Maximize2,
  Minimize2,
  User,
  ListFilter
} from 'lucide-react';
import {
  getAvailabilityMonth,
  getRoomAvailabilityForDay
} from '../../../shared/roomAvailability.mjs';
import { getRoomImageUrl } from '../utils/roomImageHelper';
import './StaffAvailabilityPage.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Internal Builtland departments
const BUILTLAND_DEPARTMENTS = [
  'ฝ่ายการเงินและบัญชี',
  'ฝ่ายขายและการตลาด',
  'ฝ่ายทรัพยากรบุคคลและธุรการ (HR)',
  'ฝ่ายเทคโนโลยีสารสนเทศ (IT)',
  'ฝ่ายบริหารโครงการและก่อสร้าง',
  'สำนักกรรมการผู้จัดการ / ผู้บริหาร'
];

// Weekday names for 7-column calendar (Mon -> Sun)
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const WEEKDAYS_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

function bangkokToday() {
  const now = new Date();
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bangkok.toISOString().slice(0, 10);
}

function roomDay(monthKey, dayNum) {
  return `${monthKey}-${String(dayNum).padStart(2, '0')}`;
}

const dateFormat = new Intl.DateTimeFormat('th-TH', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});

function getStaffAuthToken() {
  try {
    return localStorage.getItem('token') ||
           localStorage.getItem('pos_token') ||
           localStorage.getItem('staff_token') ||
           sessionStorage.getItem('token') ||
           '';
  } catch (_) {
    return '';
  }
}

export default function StaffAvailabilityPage() {
  const today = bangkokToday();
  const todayMonthKey = today.slice(0, 7);
  const [currentMonthKey, setCurrentMonthKey] = useState(() => todayMonthKey);

  // Selected date for inline week accordion (null = collapsed initially)
  const [selectedDate, setSelectedDate] = useState(null);

  // View switch: false = Home view (Two-Column with Accordion), true = POS Monthly Calendar view
  const [isPosCalendarView, setIsPosCalendarView] = useState(false);
  const [savedDateBeforePosView, setSavedDateBeforePosView] = useState(null);

  // Booking Popup Modal (Desktop) / Bottom Sheet (Mobile)
  const [bookingModalRoom, setBookingModalRoom] = useState(null);

  // Day Bookings Detail Modal (for "ดูเพิ่มเติม" in POS calendar view)
  const [dayBookingsModalDate, setDayBookingsModalDate] = useState(null);

  // Form states (kept across conflict/refresh)
  const [customerName, setCustomerName] = useState('');
  const [department, setDepartment] = useState(BUILTLAND_DEPARTMENTS[0]);
  const [selectedIntervalIndex, setSelectedIntervalIndex] = useState(0);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  // Booking result & UI feedback states
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [bookingSuccess, setBookingSuccess] = useState(null);

  // Data fetching states
  const [requestVersion, setRequestVersion] = useState(0);
  const [availabilityData, setAvailabilityData] = useState(null);
  const [todayAvailabilityData, setTodayAvailabilityData] = useState(null);
  const [roomsMetadata, setRoomsMetadata] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const month = useMemo(() => getAvailabilityMonth(currentMonthKey), [currentMonthKey]);

  const monthDisplay = useMemo(() => {
    if (!currentMonthKey) return '';
    const [y, m] = currentMonthKey.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(d);
  }, [currentMonthKey]);

  // Fetch rooms metadata (images, capacities, descriptions)
  useEffect(() => {
    let active = true;
    const fetchRooms = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/rooms`);
        if (res.ok) {
          const data = await res.json();
          if (active && Array.isArray(data)) {
            setRoomsMetadata(data);
          }
        }
      } catch (err) {
        console.error('Failed to load rooms metadata:', err);
      }
    };
    fetchRooms();
    return () => { active = false; };
  }, []);

  // Helper to fetch monthly availability: queries staff endpoint if token exists, falls back cleanly to public endpoint
  const fetchMonthAvailability = async (monthKey, signal) => {
    const token = getStaffAuthToken();
    if (token) {
      try {
        const staffRes = await fetch(`${API_BASE}/api/staff/rooms/availability-month?month=${monthKey}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal
        });
        if (staffRes.ok) {
          const staffData = await staffRes.json();
          if (staffData.month === monthKey && Array.isArray(staffData.intervals)) {
            return staffData;
          }
        }
      } catch (err) {
        if (signal?.aborted) throw err;
      }
    }
    // Public endpoint (zero PII)
    const pubRes = await fetch(`${API_BASE}/api/public/rooms/availability-month?month=${monthKey}`, {
      signal
    });
    if (!pubRes.ok) throw new Error('Availability request failed');
    return await pubRes.json();
  };

  // Fetch monthly availability intervals for current calendar month
  useEffect(() => {
    const controller = new AbortController();
    const loadAvailability = async () => {
      setLoading(true);
      setFetchError(false);
      try {
        const data = await fetchMonthAvailability(currentMonthKey, controller.signal);
        if (data.month !== currentMonthKey || !Array.isArray(data.rooms) || !Array.isArray(data.intervals)) {
          throw new Error('Invalid availability response');
        }
        if (!controller.signal.aborted) {
          setAvailabilityData(data);
          setLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setFetchError(true);
          setLoading(false);
        }
      }
    };
    loadAvailability();
    return () => controller.abort();
  }, [currentMonthKey, requestVersion]);

  // Dedicated independent fetch for today's month availability (pins "ตารางจองวันนี้" to today even when navigating other months)
  useEffect(() => {
    let active = true;
    const loadTodayAvailability = async () => {
      try {
        const data = await fetchMonthAvailability(todayMonthKey);
        if (active && Array.isArray(data?.intervals)) {
          setTodayAvailabilityData(data);
        }
      } catch (err) {
        console.error('Failed to load today availability:', err);
      }
    };
    loadTodayAvailability();
    return () => { active = false; };
  }, [todayMonthKey, requestVersion]);

  // Sync todayAvailabilityData whenever currentMonthKey is todayMonthKey and availabilityData finishes loading
  useEffect(() => {
    if (currentMonthKey === todayMonthKey && availabilityData) {
      setTodayAvailabilityData(availabilityData);
    }
  }, [currentMonthKey, todayMonthKey, availabilityData]);

  // Merge room list with metadata (image_url, capacity)
  const rooms = useMemo(() => {
    const rawList = availabilityData?.rooms || roomsMetadata;
    return rawList.map(r => {
      const meta = roomsMetadata.find(m => m.id === r.id);
      return {
        ...r,
        image_url: meta?.image_url || r.image_url || null,
        capacity: meta?.capacity || r.capacity || 10,
        description: meta?.description || r.description || ''
      };
    });
  }, [availabilityData, roomsMetadata]);

  // Room lookup map
  const roomMap = useMemo(() => {
    const map = new Map();
    rooms.forEach(r => map.set(r.id, r));
    return map;
  }, [rooms]);

  // Calculate day-by-day room availability
  const calculateDayAvailability = (dateStr, roomId) => {
    if (!availabilityData) return { ranges: [], status: 'free' };
    const bookings = availabilityData.intervals.filter(i => i.room_id === roomId);
    return getRoomAvailabilityForDay(dateStr, bookings, availabilityData.cleaning_buffer_minutes);
  };

  // Rooms list with availability for the currently selected date
  const selectedDayRooms = useMemo(() => {
    if (!selectedDate || !rooms.length) return [];
    return rooms.map(rm => {
      const dayAvail = calculateDayAvailability(selectedDate, rm.id);
      return {
        ...rm,
        status: dayAvail.status,
        ranges: dayAvail.ranges
      };
    });
  }, [selectedDate, rooms, availabilityData]);

  // Today's Bookings list (strictly pinned to bangkokToday() regardless of calendar date/month selection)
  const todayBookings = useMemo(() => {
    const data = todayAvailabilityData || (currentMonthKey === todayMonthKey ? availabilityData : null);
    if (!data?.intervals) return [];
    const list = [];
    for (const item of data.intervals) {
      const dateKey = (item.start || '').slice(0, 10);
      if (dateKey === today) {
        const rm = roomMap.get(item.room_id);
        const sT = (item.start || '').includes('T') ? item.start.split('T')[1].substring(0, 5) : (item.start || '').substring(0, 5);
        const eT = (item.end || '').includes('T') ? item.end.split('T')[1].substring(0, 5) : (item.end || '').substring(0, 5);
        list.push({
          room_id: item.room_id,
          room_name: rm?.name || `ห้อง ${item.room_id}`,
          start_time: sT,
          end_time: eT,
          customer_name: item.customer_name || 'ลูกค้า (เฉพาะพนักงาน)',
          department: item.internal_department || (item.customer_type === 'builtland' ? 'Builtland' : (item.customer_name ? (item.customer_type || '-') : '-')),
          customer_type: item.customer_type,
          start_iso: item.start,
          end_iso: item.end
        });
      }
    }
    list.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.room_name.localeCompare(b.room_name));
    return list;
  }, [todayAvailabilityData, availabilityData, currentMonthKey, todayMonthKey, today, roomMap]);

  // Build calendar weeks (chunks of 7)
  const calendarWeeks = useMemo(() => {
    if (!month) return [];
    const daysInMonth = month.days;
    const firstDay = month.firstWeekday;

    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = roomDay(currentMonthKey, d);
      let freeRoomsCount = 0;
      if (rooms.length > 0 && availabilityData) {
        for (const rm of rooms) {
          const avail = calculateDayAvailability(dateStr, rm.id);
          if (avail.status !== 'full') freeRoomsCount++;
        }
      }
      cells.push({
        dayNumber: d,
        date: dateStr,
        isToday: dateStr === today,
        freeRoomsCount
      });
    }

    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }, [month, currentMonthKey, rooms, availabilityData, today]);

  // Booked events mapped by day for POS monthly calendar view
  const monthEventsByDay = useMemo(() => {
    if (!availabilityData?.intervals) return {};
    const map = {};
    for (const item of availabilityData.intervals) {
      const dateKey = (item.start || '').slice(0, 10);
      if (!dateKey) continue;
      if (!map[dateKey]) map[dateKey] = [];
      const rm = roomMap.get(item.room_id);
      const sT = (item.start || '').includes('T') ? item.start.split('T')[1].substring(0, 5) : (item.start || '').substring(0, 5);
      const eT = (item.end || '').includes('T') ? item.end.split('T')[1].substring(0, 5) : (item.end || '').substring(0, 5);
      map[dateKey].push({
        room_id: item.room_id,
        room_name: rm?.name || `ห้อง ${item.room_id}`,
        room_capacity: rm?.capacity || 10,
        start_time: sT,
        end_time: eT,
        customer_name: item.customer_name || 'ลูกค้า (เฉพาะพนักงาน)',
        department: item.internal_department || (item.customer_type === 'builtland' ? 'Builtland' : (item.customer_name ? (item.customer_type || '-') : '-')),
        start_iso: item.start,
        end_iso: item.end
      });
    }
    Object.keys(map).forEach(d => {
      map[d].sort((a, b) => a.start_time.localeCompare(b.start_time) || a.room_name.localeCompare(b.room_name));
    });
    return map;
  }, [availabilityData, roomMap]);

  // Group bookings for "ดูเพิ่มเติม" modal in POS monthly view
  const dayBookingsGrouped = useMemo(() => {
    if (!dayBookingsModalDate || !monthEventsByDay[dayBookingsModalDate]) return [];
    const events = monthEventsByDay[dayBookingsModalDate];
    const groupMap = new Map();
    for (const ev of events) {
      if (!groupMap.has(ev.room_id)) {
        groupMap.set(ev.room_id, {
          room_id: ev.room_id,
          room_name: ev.room_name,
          room_capacity: ev.room_capacity,
          bookings: []
        });
      }
      groupMap.get(ev.room_id).bookings.push(ev);
    }
    return Array.from(groupMap.values()).sort((a, b) => a.room_name.localeCompare(b.room_name));
  }, [dayBookingsModalDate, monthEventsByDay]);

  // Active intervals of room selected for booking modal
  const activeIntervals = useMemo(() => {
    if (!bookingModalRoom || !bookingModalRoom.ranges?.length) return [];
    return bookingModalRoom.ranges;
  }, [bookingModalRoom]);

  const currentInterval = activeIntervals[selectedIntervalIndex] || activeIntervals[0] || null;

  // Time slots within current interval
  const availableTimeSlots = useMemo(() => {
    if (!currentInterval) return { startTimes: [], endTimes: [] };
    const [startH, startM] = currentInterval.start.split(':').map(Number);
    const [endH, endM] = currentInterval.end.split(':').map(Number);

    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    const startTimes = [];
    for (let t = startTotal; t < endTotal; t += 30) {
      const h = String(Math.floor(t / 60)).padStart(2, '0');
      const m = String(t % 60).padStart(2, '0');
      startTimes.push(`${h}:${m}`);
    }

    let endTimes = [];
    if (startTime) {
      const [curSH, curSM] = startTime.split(':').map(Number);
      const curSTotal = curSH * 60 + curSM;
      for (let t = curSTotal + 30; t <= endTotal; t += 30) {
        const h = String(Math.floor(t / 60)).padStart(2, '0');
        const m = String(t % 60).padStart(2, '0');
        endTimes.push(`${h}:${m}`);
      }
    }

    return { startTimes, endTimes };
  }, [currentInterval, startTime]);

  // Reset or initialize start/end time when booking room or interval changes
  useEffect(() => {
    if (currentInterval) {
      setStartTime(currentInterval.start);
      const [sH, sM] = currentInterval.start.split(':').map(Number);
      const [eH, eM] = currentInterval.end.split(':').map(Number);
      const defaultEndTotal = Math.min(sH * 60 + sM + 60, eH * 60 + eM);
      const defH = String(Math.floor(defaultEndTotal / 60)).padStart(2, '0');
      const defM = String(defaultEndTotal % 60).padStart(2, '0');
      setEndTime(`${defH}:${defM}`);
    } else {
      setStartTime('');
      setEndTime('');
    }
  }, [bookingModalRoom, selectedIntervalIndex]);

  // Month navigation
  const changeMonth = (offset) => {
    const target = getAvailabilityMonth(currentMonthKey, offset);
    if (target) {
      setCurrentMonthKey(target.month);
      setSelectedDate(null);
      setBookingError(null);
      setBookingSuccess(null);
    }
  };

  const jumpToToday = () => {
    setCurrentMonthKey(today.slice(0, 7));
    setSelectedDate(today);
    setBookingError(null);
    setBookingSuccess(null);
  };

  // Toggle date in home view (inline week accordion)
  const handleToggleDate = (dateStr) => {
    setBookingError(null);
    setBookingSuccess(null);
    if (selectedDate === dateStr) {
      setSelectedDate(null);
    } else {
      setSelectedDate(dateStr);
    }
  };

  // Switch to POS monthly calendar view (preserves current selected date)
  const handleOpenPosView = () => {
    setSavedDateBeforePosView(selectedDate);
    setIsPosCalendarView(true);
  };

  // Return from POS monthly view to Home view (restores saved date prior to opening)
  const handleClosePosView = () => {
    setIsPosCalendarView(false);
    if (savedDateBeforePosView) {
      setSelectedDate(savedDateBeforePosView);
      setCurrentMonthKey(savedDateBeforePosView.slice(0, 7));
    }
  };

  // Click date in POS monthly calendar -> return to Home view and expand panel under that week row immediately
  const handleSelectDateFromPosCalendar = (dateStr) => {
    setCurrentMonthKey(dateStr.slice(0, 7));
    setSelectedDate(dateStr);
    setIsPosCalendarView(false);
  };

  // Open booking popup for room
  const handleOpenBookingModal = (roomItem) => {
    if (roomItem.status === 'full') return;
    setBookingError(null);
    setBookingSuccess(null);
    setSelectedIntervalIndex(0);
    setBookingModalRoom(roomItem);
  };

  // Close booking popup
  const handleCloseBookingModal = () => {
    setBookingModalRoom(null);
    setBookingError(null);
    setBookingSuccess(null);
  };

  // Handle booking form submission
  const handleBookingSubmit = async (e) => {
    e.preventDefault();
    if (!bookingModalRoom || !selectedDate || !startTime || !endTime || !customerName.trim() || !department.trim()) {
      setBookingError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    setSubmitting(true);
    setBookingError(null);
    setBookingSuccess(null);

    try {
      const staffToken = getStaffAuthToken();
      const reqHeaders = { 'Content-Type': 'application/json' };
      if (staffToken) {
        reqHeaders['Authorization'] = `Bearer ${staffToken}`;
      }
      const res = await fetch(`${API_BASE}/api/staff/rooms/staff-booking`, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          room_id: bookingModalRoom.id,
          date: selectedDate,
          start_time: startTime,
          end_time: endTime,
          customer_name: customerName.trim(),
          department: department.trim()
        })
      });

      const result = await res.json();
      if (!res.ok) {
        setBookingError(result.error || 'ช่วงเวลานี้ถูกจองไปแล้ว กรุณาเลือกช่วงเวลาใหม่');
        // Refresh room availability while keeping customerName and department intact in state!
        setRequestVersion(v => v + 1);
        return;
      }

      // Successful booking!
      setBookingSuccess(result);
      setRequestVersion(v => v + 1);
      setStartTime('');
      setEndTime('');
    } catch (err) {
      setBookingError('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="staff-booking-page">
      {/* Top Header - Clean branding without duplicate monthly buttons */}
      <header className="staff-header">
        <div className="staff-header__inner">
          <div className="staff-header__left">
            <img src="/BWORK-LOGO.png" alt="B-WORK" className="staff-header__logo" />
            <div className="staff-header__titles">
              <h1 className="staff-header__title">BWORK Booking</h1>
              <span className="staff-header__tag">สำหรับพนักงาน</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="staff-container">
        {isPosCalendarView ? (
          /* =========================================================================
             VIEW 2: POS MONTHLY CALENDAR VIEW (ดูตารางการจองรายเดือน)
             ========================================================================= */
          <section className="staff-pos-section" aria-label="ตารางจองห้องประชุมรายเดือนแบบ POS">
            <div className="staff-pos-cal-card">
              {/* POS Month Navigation Bar */}
              <div className="staff-pos-nav">
                <div className="staff-pos-nav__title-group">
                  <Calendar size={22} className="staff-pos-nav__icon" />
                  <h2 className="staff-pos-nav__title" id="staff-pos-month-title">
                    {monthDisplay || 'กำลังโหลด…'}
                  </h2>
                </div>

                <div className="staff-pos-nav__controls">
                  <button
                    type="button"
                    className="staff-btn staff-btn--ghost"
                    onClick={() => changeMonth(-1)}
                    title="เดือนก่อนหน้า"
                    aria-label="เดือนก่อนหน้า"
                  >
                    <ChevronLeft size={16} />
                    <span>เดือนก่อนหน้า</span>
                  </button>

                  <button
                    type="button"
                    className="staff-btn staff-btn--today"
                    onClick={jumpToToday}
                    title="เดือนปัจจุบัน (วันนี้)"
                  >
                    <Calendar size={14} />
                    <span>เดือนปัจจุบัน</span>
                  </button>

                  <button
                    type="button"
                    className="staff-btn staff-btn--ghost"
                    onClick={() => changeMonth(1)}
                    title="เดือนถัดไป"
                    aria-label="เดือนถัดไป"
                  >
                    <span>เดือนถัดไป</span>
                    <ChevronRight size={16} />
                  </button>

                  {/* Single back button returning to booking view with preserved date */}
                  <button
                    type="button"
                    className="staff-btn staff-btn--outline"
                    onClick={handleClosePosView}
                    id="staff-btn-back-to-booking"
                    title="กลับหน้าจองห้อง"
                  >
                    <ChevronLeft size={15} />
                    <span>← กลับหน้าจองห้อง</span>
                  </button>
                </div>
              </div>

              {/* Status & Error notice */}
              {loading && !availabilityData && (
                <p className="staff-status-msg" role="status">กำลังโหลดตารางห้องประชุม…</p>
              )}
              {fetchError && (
                <div className="staff-alert staff-alert--error" role="alert">
                  <AlertCircle size={20} />
                  <span>ไม่สามารถโหลดตารางห้องประชุมได้ กรุณาลองใหม่อีกครั้ง</span>
                  <button type="button" className="staff-btn staff-btn--sm" onClick={() => setRequestVersion(v => v + 1)}>
                    ลองใหม่
                  </button>
                </div>
              )}

              {/* Responsive Scroll Container for POS Calendar Grid */}
              <div className="staff-pos-grid-scroll">
                <div className="staff-pos-grid">
                  {/* Weekday Column Headers */}
                  <div className="staff-pos-weekdays">
                    {WEEKDAYS_FULL.map((wd, idx) => (
                      <div key={idx} className="staff-pos-weekday-cell">{wd}</div>
                    ))}
                  </div>

                  {/* Calendar Days Body */}
                  <div className="staff-pos-body">
                    {calendarWeeks.map((week, wIdx) => (
                      <div key={wIdx} className="staff-pos-row">
                        {week.map((cell, cIdx) => {
                          if (!cell) {
                            return <div key={`empty-${cIdx}`} className="staff-pos-cell staff-pos-cell--empty" />;
                          }

                          const dayEvents = monthEventsByDay[cell.date] || [];
                          const isSelected = cell.date === selectedDate;

                          return (
                            <div
                              key={cell.date}
                              className={`staff-pos-cell ${cell.isToday ? 'staff-pos-cell--today' : ''} ${isSelected ? 'staff-pos-cell--selected' : ''}`}
                              onClick={() => handleSelectDateFromPosCalendar(cell.date)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleSelectDateFromPosCalendar(cell.date);
                                }
                              }}
                              title={`คลิกเพื่อกลับหน้าจองห้องและเลือกวันที่ ${cell.dayNumber}`}
                            >
                              <div className="staff-pos-cell__head">
                                <span className={`staff-pos-cell__day-num ${cell.isToday ? 'staff-pos-cell__day-num--today' : ''}`}>
                                  {cell.dayNumber}
                                </span>
                                {dayEvents.length > 0 && (
                                  <span className="staff-pos-cell__queue-badge">
                                    {dayEvents.length} คิว
                                  </span>
                                )}
                              </div>

                              {/* Booked Events List Chips */}
                              <div className="staff-pos-events">
                                {dayEvents.slice(0, 2).map((ev, evIdx) => (
                                  <div
                                    key={evIdx}
                                    className="staff-pos-event-chip"
                                    title={`${ev.room_name} เวลา ${ev.start_time} - ${ev.end_time} น. (${ev.customer_name})`}
                                  >
                                    <span className="staff-pos-event-chip__room">{ev.room_name}</span>
                                    <span className="staff-pos-event-chip__time">{ev.start_time}-{ev.end_time}</span>
                                  </div>
                                ))}

                                {/* ปุ่ม "ดูเพิ่มเติม" เปิดรายละเอียดในหน้ารายเดือนโดยไม่เรียกการทำงานของช่องวัน */}
                                {dayEvents.length > 0 && (
                                  <button
                                    type="button"
                                    className="staff-pos-more-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDayBookingsModalDate(cell.date);
                                    }}
                                    title={`ดูรายละเอียดการจองวันที่ ${cell.dayNumber} ทั้งหมด ${dayEvents.length} รายการ`}
                                  >
                                    {dayEvents.length > 2 ? `ดูเพิ่มเติม (+${dayEvents.length - 2})` : 'ดูเพิ่มเติม'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* POS Footer Legend */}
              <div className="staff-pos-legend">
                <div className="staff-legend-item">
                  <span className="staff-legend-swatch staff-legend-swatch--today" />
                  <span>วันนี้</span>
                </div>
                <div className="staff-legend-item">
                  <span className="staff-legend-swatch staff-legend-swatch--selected" />
                  <span>วันที่เลือก</span>
                </div>
                <div className="staff-legend-item">
                  <span className="staff-legend-swatch staff-legend-swatch--booked" />
                  <span>มีการจองห้องประชุม</span>
                </div>
                <div className="staff-pos-legend__tip">
                  💡 คลิกที่วันใดๆ เพื่อกลับสู่หน้าจองห้องและเปิดแผงจองของวันนั้นทันที
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* =========================================================================
             VIEW 1: HOME VIEW - TWO COLUMNS (Desktop) / STACKED (Mobile)
             - Left: “ตารางจองวันนี้” กว้าง ~320 px (อิง bangkokToday() เสมอ)
             - Right: ปฏิทินกะทัดรัด พร้อม Inline Week Accordion ขยายใต้แถวสัปดาห์
             ========================================================================= */
          <div className="staff-main-layout">
            {/* Left Column: ตารางจองวันนี้ */}
            <aside className="staff-today-column" aria-label="ตารางจองวันนี้">
              <div className="staff-today-card">
                <div className="staff-today-header">
                  <div className="staff-today-header__title-box">
                    <Calendar size={18} className="staff-today-header__icon" />
                    <div>
                      <h3 className="staff-today-header__title">ตารางจองวันนี้</h3>
                      <span className="staff-today-header__date">
                        {dateFormat.format(new Date(today))}
                      </span>
                    </div>
                  </div>
                  <span className="staff-today-header__badge">
                    {todayBookings.length} รายการ
                  </span>
                </div>

                <div className="staff-today-body">
                  {todayBookings.length === 0 ? (
                    <div className="staff-today-empty" id="staff-today-empty-msg">
                      <Clock size={28} className="staff-today-empty__icon" />
                      <p className="staff-today-empty__text">วันนี้ยังไม่มีรายการจอง</p>
                    </div>
                  ) : (
                    <div className="staff-today-list" id="staff-today-list">
                      {todayBookings.map((bk, idx) => (
                        <div key={idx} className="staff-today-item">
                          <div className="staff-today-item__time-row">
                            <span className="staff-today-item__time">
                              <Clock size={13} /> {bk.start_time} - {bk.end_time} น.
                            </span>
                            <span className="staff-today-item__room">
                              <Building size={13} /> {bk.room_name}
                            </span>
                          </div>
                          <div className="staff-today-item__user-row">
                            <span className="staff-today-item__name">
                              <User size={13} /> {bk.customer_name}
                            </span>
                            {bk.department && bk.department !== '-' && (
                              <span className="staff-today-item__dept">
                                {bk.department}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* Right Column: ปฏิทินกะทัดรัด พร้อม Inline Week Accordion */}
            <section className="staff-cal-column" aria-label="ปฏิทินจองห้องประชุมพนักงาน">
              <div className="staff-cal-card">
                {/* Header Bar with Month Navigation & Single Button to POS View */}
                <div className="staff-cal-nav">
                  <div className="staff-cal-nav__title-group">
                    <button
                      type="button"
                      className="staff-cal-nav__btn"
                      onClick={() => changeMonth(-1)}
                      aria-label="เดือนก่อนหน้า"
                      title="เดือนก่อนหน้า"
                    >
                      <ChevronLeft size={18} aria-hidden="true" />
                    </button>

                    <h2 className="staff-cal-nav__title" id="staff-cal-month-title">
                      {monthDisplay || '…'}
                    </h2>

                    <button
                      type="button"
                      className="staff-cal-nav__today-pill"
                      onClick={jumpToToday}
                      title="กลับมาวันนี้"
                    >
                      วันนี้
                    </button>

                    <button
                      type="button"
                      className="staff-cal-nav__btn"
                      onClick={() => changeMonth(1)}
                      aria-label="เดือนถัดไป"
                      title="เดือนถัดไป"
                    >
                      <ChevronRight size={18} aria-hidden="true" />
                    </button>
                  </div>

                  {/* ปุ่มเดียวสำหรับเปิดดูตารางการจองรายเดือน */}
                  <div className="staff-cal-nav__actions">
                    <button
                      type="button"
                      className="staff-btn staff-btn--outline"
                      onClick={handleOpenPosView}
                      id="staff-btn-view-pos-calendar"
                      title="เปิดดูตารางการจองรายเดือนแบบเต็มหน้าจอ"
                    >
                      <Calendar size={15} />
                      <span>ดูตารางการจองรายเดือน</span>
                    </button>
                  </div>
                </div>

                {loading && !availabilityData && (
                  <p className="staff-status-msg" role="status">กำลังโหลดตารางห้องประชุม…</p>
                )}

                {fetchError && (
                  <div className="staff-alert staff-alert--error" role="alert">
                    <AlertCircle size={20} />
                    <span>ไม่สามารถโหลดตารางห้องประชุมได้ กรุณาลองใหม่อีกครั้ง</span>
                    <button type="button" className="staff-btn staff-btn--sm" onClick={() => setRequestVersion(v => v + 1)}>
                      ลองใหม่
                    </button>
                  </div>
                )}

                {/* Weekday Column Headers (7 cols) */}
                <div className="staff-cal-weekdays" aria-hidden="true">
                  {WEEKDAYS.map(dayName => (
                    <span key={dayName} className="staff-cal-weekday">{dayName}</span>
                  ))}
                </div>

                {/* Monthly Calendar Grid with Week-by-Week Inline Accordion */}
                <div className="staff-cal-grid" role="group" aria-label="ตารางวันที่ในเดือน">
                  {calendarWeeks.map((week, weekIndex) => {
                    const weekContainsSelected = week.some(cell => cell && cell.date === selectedDate);

                    return (
                      <React.Fragment key={weekIndex}>
                        {/* Row of 7 Days */}
                        <div className="staff-cal-row">
                          {week.map((cell, cellIndex) => {
                            if (!cell) {
                              return <div key={`empty-${cellIndex}`} className="staff-cal-day staff-cal-day--empty" />;
                            }

                            const isSelected = cell.date === selectedDate;
                            const hasFree = cell.freeRoomsCount > 0;

                            return (
                              <button
                                type="button"
                                key={cell.date}
                                className={`staff-cal-day ${cell.isToday ? 'staff-cal-day--today' : ''} ${isSelected ? 'staff-cal-day--selected' : ''}`}
                                aria-pressed={isSelected}
                                aria-expanded={isSelected}
                                aria-current={cell.isToday ? 'date' : undefined}
                                aria-label={`${dateFormat.format(new Date(cell.date))} ${hasFree ? `ว่าง ${cell.freeRoomsCount} ห้อง` : 'ห้องเต็ม'}`}
                                onClick={() => handleToggleDate(cell.date)}
                              >
                                <span className="staff-cal-day__num">{cell.dayNumber}</span>
                                <span className={`staff-cal-day__badge ${hasFree ? 'staff-cal-day__badge--free' : 'staff-cal-day__badge--full'}`}>
                                  {hasFree ? `${cell.freeRoomsCount} ห้อง` : 'เต็ม'}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Inline Expanded Panel (Full-width underneath the clicked week row in right column) */}
                        {weekContainsSelected && selectedDate && (
                          <div className="staff-expanded-wrapper" id="staff-daily-panel" tabIndex={-1}>
                            <div className="staff-expanded-panel">
                              {/* Daily Panel Header */}
                              <div className="staff-expanded-panel__header">
                                <div className="staff-expanded-panel__title-box">
                                  <span className="staff-expanded-panel__icon-pill">
                                    <Calendar size={18} />
                                  </span>
                                  <div>
                                    <h3 className="staff-expanded-panel__date">
                                      {dateFormat.format(new Date(selectedDate))}
                                    </h3>
                                    <p className="staff-expanded-panel__sub">
                                      สถานะห้องประชุม ({selectedDayRooms.filter(r => r.status !== 'full').length} ห้องว่าง จากทั้งหมด {selectedDayRooms.length} ห้อง)
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="staff-expanded-panel__close-btn"
                                  onClick={() => setSelectedDate(null)}
                                  aria-label="ย่อแผงห้องประชุม"
                                >
                                  <X size={20} />
                                </button>
                              </div>

                              {/* Booking Success Banner if recently booked */}
                              {bookingSuccess && !bookingModalRoom && (
                                <div className="staff-alert staff-alert--success" role="status">
                                  <CheckCircle2 size={24} className="staff-alert__icon" />
                                  <div className="staff-alert__content">
                                    <h5>จองห้องประชุมสำเร็จเรียบร้อย!</h5>
                                    <p>
                                      <strong>หมายเลขการจอง:</strong> {bookingSuccess.receipt_number} | <strong>ห้อง:</strong> {bookingSuccess.room_name}
                                    </p>
                                    <p>
                                      <strong>เวลา:</strong> {bookingSuccess.start_time} - {bookingSuccess.end_time} น. | <strong>ผู้จอง:</strong> {bookingSuccess.customer_name} ({bookingSuccess.department})
                                    </p>
                                  </div>
                                </div>
                              )}

                              {/* Room Cards Grid */}
                              <div className="staff-rooms-grid">
                                {selectedDayRooms.map((rm) => {
                                  const isFull = rm.status === 'full';
                                  const imageUrl = getRoomImageUrl(rm.image_url);

                                  return (
                                    <div
                                      key={rm.id}
                                      data-room-id={rm.id}
                                      className={`staff-room-card ${isFull ? 'staff-room-card--full' : ''}`}
                                    >
                                      {/* Room Image / Neutral Fallback Placeholder */}
                                      <div className="staff-room-card__img-wrap">
                                        {imageUrl ? (
                                          <img
                                            src={imageUrl}
                                            alt={rm.name}
                                            className="staff-room-card__img"
                                            loading="lazy"
                                            onError={(e) => {
                                              e.target.style.display = 'none';
                                              if (e.target.nextSibling) {
                                                e.target.nextSibling.style.display = 'flex';
                                              }
                                            }}
                                          />
                                        ) : null}
                                        <div
                                          className="staff-room-card__fallback"
                                          style={{ display: imageUrl ? 'none' : 'flex' }}
                                        >
                                          <Building size={32} />
                                          <span>ห้องประชุม B-WORK</span>
                                        </div>
                                      </div>

                                      {/* Room Card Body */}
                                      <div className="staff-room-card__body">
                                        <div className="staff-room-card__head">
                                          <h4 className="staff-room-card__name">{rm.name}</h4>
                                          <span className="staff-room-card__capacity">
                                            <Users size={14} /> {rm.capacity} ที่นั่ง
                                          </span>
                                        </div>

                                        {/* Availability Status Tag */}
                                        <div className="staff-room-card__status-box">
                                          {rm.status === 'free' && (
                                            <div className="staff-status-badge staff-status-badge--free">
                                              <span className="staff-status-dot staff-status-dot--free" />
                                              <span>ว่างทั้งวัน (08:00–18:00 น.)</span>
                                            </div>
                                          )}
                                          {rm.status === 'partial' && (
                                            <div className="staff-status-badge staff-status-badge--partial">
                                              <span className="staff-status-dot staff-status-dot--partial" />
                                              <span>ว่างบางช่วง</span>
                                            </div>
                                          )}
                                          {rm.status === 'full' && (
                                            <div className="staff-status-badge staff-status-badge--full">
                                              <span className="staff-status-dot staff-status-dot--full" />
                                              <span>ห้องเต็มตลอดช่วงเปิดให้จอง</span>
                                            </div>
                                          )}
                                        </div>

                                        {/* Available Time Range Chips */}
                                        {rm.ranges && rm.ranges.length > 0 && (
                                          <div className="staff-room-card__ranges">
                                            <span className="staff-room-card__ranges-label">ช่วงเวลาว่าง:</span>
                                            <div className="staff-room-card__chips">
                                              {rm.ranges.map((rng, rIdx) => (
                                                <span key={rIdx} className="staff-time-chip">
                                                  <Clock size={12} /> {rng.start}–{rng.end} น.
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Card Action Button */}
                                        <div className="staff-room-card__footer">
                                          {isFull ? (
                                            <button type="button" className="staff-btn staff-btn--disabled" disabled>
                                              ห้องเต็ม
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              className="staff-btn staff-btn--primary staff-btn--full"
                                              onClick={() => handleOpenBookingModal(rm)}
                                            >
                                              จองห้องประชุม
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Footer Legend */}
                <div className="staff-cal-legend">
                  <div className="staff-legend-item">
                    <span className="staff-legend-badge staff-legend-badge--free">ว่าง</span>
                    <span>มีห้องว่าง</span>
                  </div>
                  <div className="staff-legend-item">
                    <span className="staff-legend-badge staff-legend-badge--full">เต็ม</span>
                    <span>ห้องเต็มทุกห้อง</span>
                  </div>
                  <div className="staff-legend-item">
                    <span className="staff-legend-dot staff-legend-dot--today" />
                    <span>วันนี้</span>
                  </div>
                  <div className="staff-legend-item">
                    <span className="staff-legend-dot staff-legend-dot--selected" />
                    <span>วันที่เลือก</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* =========================================================================
          POPUP MODAL (DESKTOP) / BOTTOM SHEET (MOBILE): ฟอร์มจองห้องประชุม
          ========================================================================= */}
      {bookingModalRoom && (
        <div
          className="staff-modal-backdrop"
          onClick={handleCloseBookingModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-modal-title"
        >
          <div
            className="staff-modal-container"
            onClick={(e) => e.stopPropagation()}
            id="staff-booking-popup"
          >
            {/* Modal Header */}
            <div className="staff-modal-header">
              <div>
                <h3 className="staff-modal-title" id="staff-modal-title">
                  จองห้องประชุม: <strong>{bookingModalRoom.name}</strong>
                </h3>
                <p className="staff-modal-meta">
                  วันที่ {selectedDate ? dateFormat.format(new Date(selectedDate)) : ''} · {bookingModalRoom.capacity} ที่นั่ง
                </p>
              </div>
              <button
                type="button"
                className="staff-modal-close"
                onClick={handleCloseBookingModal}
                aria-label="ปิดหน้าต่างจอง"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body / Scrollable Form */}
            <div className="staff-modal-body">
              {/* Conflict / Overlap or Validation Error Alert */}
              {bookingError && (
                <div className="staff-alert staff-alert--error" role="alert">
                  <AlertCircle size={20} className="staff-alert__icon" />
                  <div>
                    <strong>ไม่สามารถทำรายการได้:</strong> {bookingError}
                  </div>
                </div>
              )}

              {/* Success Notification */}
              {bookingSuccess && (
                <div className="staff-alert staff-alert--success" role="status">
                  <CheckCircle2 size={24} className="staff-alert__icon" />
                  <div className="staff-alert__content">
                    <h5>จองห้องประชุมสำเร็จเรียบร้อย!</h5>
                    <p>
                      <strong>หมายเลขการจอง:</strong> {bookingSuccess.receipt_number}
                    </p>
                    <p>
                      <strong>เวลา:</strong> {bookingSuccess.start_time} - {bookingSuccess.end_time} น. | <strong>ผู้จอง:</strong> {bookingSuccess.customer_name} ({bookingSuccess.department})
                    </p>
                  </div>
                </div>
              )}

              <form onSubmit={handleBookingSubmit} className="staff-form" id="staff-booking-form">
                {/* Interval selector if multiple disjoint free intervals */}
                {activeIntervals.length > 1 && (
                  <div className="staff-form__group staff-form__group--full">
                    <label className="staff-form__label">
                      <Clock size={16} /> เลือกช่วงเวลาว่างที่ต้องการจอง:
                    </label>
                    <div className="staff-interval-chips">
                      {activeIntervals.map((interval, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`staff-interval-btn ${idx === selectedIntervalIndex ? 'staff-interval-btn--active' : ''}`}
                          onClick={() => setSelectedIntervalIndex(idx)}
                        >
                          ช่วงที่ {idx + 1}: {interval.start} - {interval.end} น.
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Time Selection Fields */}
                <div className="staff-form__row">
                  <div className="staff-form__group">
                    <label htmlFor="staff-start-time" className="staff-form__label">
                      <Clock size={16} /> เวลาเริ่มต้น <span className="staff-required">*</span>
                    </label>
                    <select
                      id="staff-start-time"
                      className="staff-form__select"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      required
                    >
                      {availableTimeSlots.startTimes.map(t => (
                        <option key={t} value={t}>{t} น.</option>
                      ))}
                    </select>
                  </div>

                  <div className="staff-form__group">
                    <label htmlFor="staff-end-time" className="staff-form__label">
                      <Clock size={16} /> เวลาสิ้นสุด <span className="staff-required">*</span>
                    </label>
                    <select
                      id="staff-end-time"
                      className="staff-form__select"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      required
                    >
                      {availableTimeSlots.endTimes.map(t => (
                        <option key={t} value={t}>{t} น.</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Department & Booker Name Fields */}
                <div className="staff-form__row">
                  <div className="staff-form__group">
                    <label htmlFor="staff-department" className="staff-form__label">
                      <Building size={16} /> แผนกภายในองค์กร <span className="staff-required">*</span>
                    </label>
                    <select
                      id="staff-department"
                      className="staff-form__select"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      required
                    >
                      {BUILTLAND_DEPARTMENTS.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>

                  <div className="staff-form__group">
                    <label htmlFor="staff-booker-name" className="staff-form__label">
                      <User size={16} /> ชื่อผู้จอง <span className="staff-required">*</span>
                    </label>
                    <input
                      id="staff-booker-name"
                      type="text"
                      className="staff-form__input"
                      placeholder="เช่น สมชาย ใจดี"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="staff-modal-footer">
                  <button
                    type="button"
                    className="staff-btn staff-btn--outline"
                    onClick={handleCloseBookingModal}
                    disabled={submitting}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="staff-btn staff-btn--primary staff-btn--submit"
                    disabled={submitting || !startTime || !endTime}
                  >
                    {submitting ? 'กำลังบันทึกการจอง…' : 'จองห้องประชุม'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          DAY BOOKINGS DETAIL MODAL (ดูเพิ่มเติม ในหน้ารายเดือน)
          - แสดงทุกห้องที่มีการจองวันนั้นพร้อมทุกช่วงเวลาของแต่ละห้อง
          - อยู่ในหน้ารายเดือน ไม่นำออกจากหน้ารายเดือน
          ========================================================================= */}
      {dayBookingsModalDate && (
        <div
          className="staff-modal-backdrop"
          onClick={() => setDayBookingsModalDate(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-day-detail-title"
        >
          <div
            className="staff-modal-container staff-modal-container--pos-detail"
            onClick={(e) => e.stopPropagation()}
            id="staff-pos-day-detail-modal"
          >
            <div className="staff-modal-header">
              <div>
                <h3 className="staff-modal-title" id="staff-day-detail-title">
                  รายละเอียดการจองห้องประชุม
                </h3>
                <p className="staff-modal-meta">
                  {dateFormat.format(new Date(dayBookingsModalDate))} · มีการจองทั้งหมด {monthEventsByDay[dayBookingsModalDate]?.length || 0} รายการ ({dayBookingsGrouped.length} ห้อง)
                </p>
              </div>
              <button
                type="button"
                className="staff-modal-close"
                onClick={() => setDayBookingsModalDate(null)}
                aria-label="ปิดรายละเอียด"
              >
                <X size={20} />
              </button>
            </div>

            <div className="staff-modal-body">
              <div className="staff-day-rooms-list">
                {dayBookingsGrouped.length === 0 ? (
                  <p className="staff-status-msg">ไม่มีรายการจองในวันนี้</p>
                ) : (
                  dayBookingsGrouped.map((grp) => (
                    <div key={grp.room_id} className="staff-day-room-card">
                      <div className="staff-day-room-card__header">
                        <div className="staff-day-room-card__title">
                          <Building size={16} />
                          <strong>{grp.room_name}</strong>
                          <span className="staff-day-room-card__cap">{grp.room_capacity} ที่นั่ง</span>
                        </div>
                        <span className="staff-day-room-card__count">
                          {grp.bookings.length} ช่วงเวลา
                        </span>
                      </div>
                      <div className="staff-day-room-card__bookings">
                        {grp.bookings.map((b, bIdx) => (
                          <div key={bIdx} className="staff-day-room-booking-item">
                            <div className="staff-day-room-booking-item__time">
                              <Clock size={13} />
                              <strong>{b.start_time} - {b.end_time} น.</strong>
                            </div>
                            <div className="staff-day-room-booking-item__user">
                              <span className="staff-day-room-booking-item__name">
                                <User size={13} /> {b.customer_name}
                              </span>
                              {b.department && b.department !== '-' && (
                                <span className="staff-day-room-booking-item__dept">
                                  {b.department}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="staff-modal-footer">
              <button
                type="button"
                className="staff-btn staff-btn--outline"
                onClick={() => setDayBookingsModalDate(null)}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
