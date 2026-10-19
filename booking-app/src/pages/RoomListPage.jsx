import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Users, Wifi, Tv, Zap, Coffee, Wind, CheckCircle2, 
  ArrowLeft, ChevronRight, Calendar, Clock, Sparkles, Building, AlertCircle, Edit3 
} from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';
import { calculateOnlineBookingPricing } from '../utils/onlinePromotionHelper';

// Generate 30-minute interval time options from 08:00 to 18:00
const TIME_OPTIONS = [];
for (let h = 8; h <= 18; h++) {
  const hh = h.toString().padStart(2, '0');
  TIME_OPTIONS.push(`${hh}:00`);
  if (h < 18) {
    TIME_OPTIONS.push(`${hh}:30`);
  }
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
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
  const monthName = THAI_MONTHS[m - 1];
  const thaiYear = y + 543;
  return `วัน${dayName}ที่ ${d} ${monthName} ${thaiYear}`;
};

export default function RoomListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);

  const today = new Date();
  const todayIso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  // Search parameters from URL
  const [dateStr] = useState(query.get('date') || todayIso);
  const queryRoomId = query.get('roomId');
  const [roomIdParam, setRoomIdParam] = useState(queryRoomId || null);
  const rawGuestsParam = query.get('guests');
  const [guests, setGuests] = useState(rawGuestsParam ? (parseInt(rawGuestsParam, 10) || null) : null);

  const isToday = dateStr === todayIso;
  const currentMins = today.getHours() * 60 + today.getMinutes();

  // Strict Real-Time Time Protection: For today, filter out past time slots
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

  const [globalStartTime, setGlobalStartTime] = useState(query.get('start') || defaultStart);
  const [globalEndTime, setGlobalEndTime] = useState(query.get('end') || defaultEnd);

  const [rooms, setRooms] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [promotion, setPromotion] = useState(null);
  const [loading, setLoading] = useState(true);

  // Per-Room Selections State: { [roomId]: { mode, startTime, endTime, halfDaySlot, dailySlot } }
  const [roomSelections, setRoomSelections] = useState({});
  // Per-Room Layout State: { [roomId]: 'standard' | 'classroom' }
  const [roomLayouts, setRoomLayouts] = useState({});

  const handleGlobalStartChange = useCallback((newStart) => {
    setGlobalStartTime(newStart);
    const [sH, sM] = newStart.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const [curEndH, curEndM] = (globalEndTime || '18:00').split(':').map(Number);
    const curEndMins = curEndH * 60 + curEndM;

    let newEndMins = curEndMins <= startMins ? startMins + 60 : curEndMins;
    if (newEndMins > 18 * 60) newEndMins = 18 * 60;
    const eH = Math.floor(newEndMins / 60).toString().padStart(2, '0');
    const eM = (newEndMins % 60).toString().padStart(2, '0');
    const newEnd = `${eH}:${eM}`;
    setGlobalEndTime(newEnd);

    // Sync all hourly rooms to new global time
    setRoomSelections(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(id => {
        if (updated[id]?.mode === 'hourly') {
          updated[id] = { ...updated[id], startTime: newStart, endTime: newEnd };
        }
      });
      return updated;
    });
  }, [globalEndTime]);

  // Adjust start time if today has changed or current start is past
  useEffect(() => {
    if (availableStartOptions.length > 0 && !availableStartOptions.includes(globalStartTime)) {
      handleGlobalStartChange(availableStartOptions[0]);
    }
  }, [availableStartOptions, globalStartTime, handleGlobalStartChange]);

  // Fetch rooms, schedule, and promotion on date change
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
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
        setLoading(false);
      }
    };
    fetchData();
  }, [dateStr]);

  // Helper to extract full selection details for a specific room
  const getRoomSelection = (room) => {
    const isClassroom = roomLayouts[room.id] === 'classroom';
    const hourlyPrice = isClassroom ? (room.classroom_hourly_rate || room.hourly_rate) : (room.hourly_rate || 0);
    const dailyPrice = isClassroom ? (room.classroom_daily_rate || room.daily_rate) : (room.daily_rate || 0);
    const halfDayPrice = room.half_day_rate || 0;

    const hasHourly = room.has_hourly === 1 && hourlyPrice > 0;
    const hasHalfDay = (room.has_halfday === 1 || halfDayPrice > 0) && halfDayPrice > 0;
    const hasDaily = room.has_daily === 1 && dailyPrice > 0;

    // Default package for this room
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
      const billedHours = Math.max(1, Math.ceil(exactHours)); // ปัดเศษชั่วโมงขึ้นเป็นชั่วโมงเต็ม (เช่น 1.5 ชม. -> คิดราคา 2 ชม.)
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

  // Robust time string extractor (handles ISO string "2026-08-24T09:00:00", space format, or "09:00")
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

  // Check if a room has booking overlap for its specific active times
  const getRoomOccupiedInfo = (roomId, effStart, effEnd) => {
    if (!schedule || !schedule.rooms) return { isOccupied: false, label: 'ว่างพร้อมจอง' };

    const startHHMM = extractHHMM(effStart || globalStartTime || '09:00');
    const endHHMM = extractHHMM(effEnd || globalEndTime || '11:00');
    if (!startHHMM || !endHHMM) return { isOccupied: false, label: 'ว่างพร้อมจอง' };

    const [sH, sM] = startHHMM.split(':').map(Number);
    const [eH, eM] = endHHMM.split(':').map(Number);
    const reqStartMins = sH * 60 + (sM || 0);
    const reqEndMins = eH * 60 + (eM || 0);

    // Business hours boundary checks: 08:00 - 18:00 Asia/Bangkok
    if (reqStartMins < 8 * 60 || reqStartMins >= 18 * 60 || reqEndMins > 18 * 60 || reqEndMins <= reqStartMins) {
      return { isOccupied: true, reason: 'outside_hours', label: 'อยู่นอกเวลาทำการ (08:00 - 18:00 น.)' };
    }

    // Real-time past time check for today
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

      // 1. Direct booking overlap
      if (reqStartMins < bEndMins && reqEndMins > bStartMins) {
        return {
          isOccupied: true,
          reason: 'booked',
          label: `ติดจอง (${bStartHHMM} - ${bEndHHMM} น.)`
        };
      }

      // 2. Cleaning buffer of PREVIOUS booking b:
      // If b ends at or before reqStartMins AND reqStartMins < bEndBufferedMins
      // But if b ends at or after 18:00, its cleaning is entirely outside business hours (>= 18:00), so ignore it.
      if (bEndMins <= reqStartMins && reqStartMins < bEndBufferedMins && bEndMins < 18 * 60) {
        if (bEndBufferedMins >= 18 * 60) {
          // Cleaning intersects closing time (18:00) -> clip visually to closing time
          return {
            isOccupied: true,
            reason: 'cleaning',
            label: `ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง ${bEndHHMM} น.)`
          };
        } else {
          const cleanEndH = Math.floor(bEndBufferedMins / 60);
          const cleanEndM = bEndBufferedMins % 60;
          const cleanEndHHMM = `${String(cleanEndH).padStart(2, '0')}:${String(cleanEndM).padStart(2, '0')}`;
          return {
            isOccupied: true,
            reason: 'cleaning',
            label: `ติดทำความสะอาด (คิวก่อนหน้าใช้ถึง ${bEndHHMM} น. • พร้อมจอง ${cleanEndHHMM} น.)`
          };
        }
      }

      // 3. Cleaning buffer needed before SUBSEQUENT booking b:
      // If requested booking ends at or before b starts, but customer's cleaning buffer overlaps bStartMins.
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

  // Direct room selection memo
  const selectedDirectRoom = useMemo(() => {
    if (!roomIdParam || rooms.length === 0) return null;
    return rooms.find(r => String(r.id) === String(roomIdParam)) || null;
  }, [roomIdParam, rooms]);

  // Smart Room Categorization & Tier Matching (with Special Offers)
  const { recommendedRooms, upgradeRooms, recommendedLabel, upgradeLabel } = useMemo(() => {
    const recommended = [];
    const upgrade = [];
    const effectiveGuests = guests || 4;
    let recLabel = guests ? `ห้องขนาดพอดี (${guests} ท่าน)` : 'ห้องประชุมแนะนำ';
    let upgLabel = 'ข้อเสนอพิเศษ: ห้องขนาดใหญ่ขึ้น เพิ่มความสะดวกสบาย';

    const sortedAll = sortRoomsByStandardOrder(rooms);

    sortedAll.forEach(room => {
      const cap = room.capacity || 4;

      if (effectiveGuests === 1) {
        // 1 Person: 4-person rooms as Perfect Match, 8-12 person rooms as Special Offers
        recLabel = guests ? 'ห้องขนาดพอดี (1 ท่าน) - โซนส่วนตัว/โฟกัสงาน' : 'ห้องขนาด 1-4 ท่าน - โซนส่วนตัว/โฟกัสงาน';
        upgLabel = 'ข้อเสนอพิเศษ: ห้องขนาด 8-12 ท่าน (สำหรับประชุมสัมมนา/ต้องการจอใหญ่)';
        if (cap <= 4) {
          recommended.push(room);
        } else if (cap >= 8 && cap <= 12) {
          upgrade.push(room);
        }
      } else if (effectiveGuests <= 4) {
        // 2 - 4 People: 4-person rooms as Perfect Match, 8-12 person rooms as Special Offers
        recLabel = guests ? `ห้องขนาดพอดี (${guests} ท่าน)` : 'ห้องขนาด 2-4 ท่าน';
        upgLabel = 'ข้อเสนอพิเศษ: ห้องขนาด 8-12 ท่าน (พื้นที่กว้างขวาง เพิ่มความสบาย)';
        if (cap <= 4) {
          recommended.push(room);
        } else if (cap >= 8 && cap <= 12) {
          upgrade.push(room);
        }
      } else if (effectiveGuests <= 8) {
        // 5 - 8 People: 8-10 person rooms as Perfect Match, 12-40 person rooms as Special Offers
        recLabel = guests ? `ห้องขนาดพอดี (${guests} ท่าน)` : 'ห้องขนาด 5-8 ท่าน';
        upgLabel = 'ข้อเสนอพิเศษ: ห้องขนาด 12-40 ท่าน (สำหรับกลุ่มใหญ่)';
        if (cap >= 5 && cap <= 10) {
          recommended.push(room);
        } else if (cap > 10) {
          upgrade.push(room);
        }
      } else if (effectiveGuests <= 12) {
        // 9 - 12 People
        recLabel = guests ? `ห้องขนาดพอดี (${guests} ท่าน)` : 'ห้องขนาด 9-12 ท่าน';
        upgLabel = 'ข้อเสนอพิเศษ: ห้องประชุมใหญ่ 40 ท่าน';
        if (cap >= 10 && cap <= 12) {
          recommended.push(room);
        } else if (cap > 12) {
          upgrade.push(room);
        }
      } else {
        // > 12 People
        recLabel = guests ? `ห้องประชุมใหญ่ / อีเวนต์ (${guests} ท่าน)` : 'ห้องประชุมใหญ่ / อีเวนต์';
        upgLabel = 'ข้อเสนอพิเศษ';
        if (cap > 12) {
          recommended.push(room);
        }
      }
    });

    return {
      recommendedRooms: sortRoomsByStandardOrder(recommended),
      upgradeRooms: sortRoomsByStandardOrder(upgrade),
      recommendedLabel: recLabel,
      upgradeLabel: upgLabel
    };
  }, [rooms, guests]);

  // Handle Room Selection and navigate to Step 3 Form
  const handleSelectRoom = (room) => {
    const layout = roomLayouts[room.id] || 'standard';
    const isClassroom = layout === 'classroom';
    const sel = getRoomSelection(room);

    // CRITICAL: Strip huge Base64 data URIs before storing in sessionStorage to avoid QuotaExceededError
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
      guests: guests || null,
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
    } catch (storageErr) {
      console.warn('[Storage] sessionStorage current_booking_payload failed (non-blocking):', storageErr);
    }
    navigate('/form', { state: bookingPayload });
  };

  // Render a Single Room Card with its dynamic rate options & time controls
  const renderRoomCard = (room, isUpgrade = false) => {
    const sel = getRoomSelection(room);
    const { isOccupied, label: statusLabel, reason } = getRoomOccupiedInfo(room.id, sel.startTime, sel.endTime);
    const currentLayout = roomLayouts[room.id] || 'standard';
    const isClassroom = currentLayout === 'classroom';
    const displayImage = isClassroom && room.classroom_image_url ? room.classroom_image_url : room.image_url;

    return (
      <div 
        key={room.id} 
        className="room-card-container"
        style={{
          opacity: isOccupied ? 0.85 : 1,
          borderColor: isUpgrade && !isOccupied ? 'rgba(37, 99, 235, 0.35)' : undefined
        }}
      >
        {/* Left / Top: Room Image */}
        <div className="room-card-image" style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', height: '220px', backgroundColor: '#f1f5f9' }}>
          {displayImage ? (
            <img 
              src={displayImage} 
              alt={room.name} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
              <Building size={48} />
            </div>
          )}

          {/* Real-time Status Badge Overlay for this room's selected time */}
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

          {/* Upgrade Badge Overlay */}
          {isUpgrade && !isOccupied && (
            <div style={{
              position: 'absolute',
              bottom: '10px',
              left: '10px',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.72rem',
              fontWeight: 800,
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              color: '#93c5fd',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Sparkles size={12} />
              <span>พื้นที่กว้างขึ้น ({room.capacity} ท่าน)</span>
            </div>
          )}
        </div>

        {/* Right / Content: Details & Package Selectors */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            {/* Title & Capacity on Single Line */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-main)', margin: 0 }}>
                  {room.name}
                </h3>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  (ประเภท: <strong>{room.category || 'ห้องประชุม'}</strong> · รองรับ <strong>{sel.effectiveCapacity} ท่าน</strong>)
                </span>
              </div>
            </div>

            {/* Layout Switch (Classroom toggle if supported) */}
            {room.has_classroom === 1 && (
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)' }}>รูปแบบโต๊ะ:</span>
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
                      backgroundColor: currentLayout === 'standard' ? 'var(--primary)' : 'transparent',
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
                      backgroundColor: currentLayout === 'classroom' ? '#ec4899' : 'transparent',
                      color: currentLayout === 'classroom' ? '#ffffff' : 'var(--text-muted)',
                      cursor: 'pointer'
                    }}
                  >
                    Classroom ({room.classroom_capacity} ที่นั่ง)
                  </button>
                </div>
              </div>
            )}

            {/* RATE MODE SELECTOR (Only available packages from inventory) */}
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-muted)' }}>
                เลือกแพ็กเกจการจอง:
              </div>

              <div style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap'
              }}>
                {sel.hasHourly && (
                  <button
                    type="button"
                    onClick={() => setRoomSelections(prev => ({
                      ...prev,
                      [room.id]: { ...(prev[room.id] || {}), mode: 'hourly' }
                    }))}
                    style={{
                      flex: '1 1 auto',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: sel.mode === 'hourly' ? '2px solid var(--primary)' : '1px solid var(--border)',
                      backgroundColor: sel.mode === 'hourly' ? 'rgba(37, 99, 235, 0.08)' : '#ffffff',
                      color: sel.mode === 'hourly' ? 'var(--primary)' : 'var(--text-main)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      boxShadow: sel.mode === 'hourly' ? '0 2px 8px rgba(37,99,235,0.18)' : 'none',
                      minHeight: '42px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Clock size={14} />
                    <span style={{ whiteSpace: 'nowrap' }}>รายชั่วโมง (฿{sel.hourlyPrice.toLocaleString()}/ชม.)</span>
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
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: sel.mode === 'halfday' ? '2px solid #7c3aed' : '1px solid var(--border)',
                      backgroundColor: sel.mode === 'halfday' ? 'rgba(124, 58, 237, 0.08)' : '#ffffff',
                      color: sel.mode === 'halfday' ? '#7c3aed' : 'var(--text-main)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      boxShadow: sel.mode === 'halfday' ? '0 2px 8px rgba(124, 58, 237, 0.18)' : 'none',
                      minHeight: '42px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span style={{ whiteSpace: 'nowrap' }}>ครึ่งวัน (฿{Number(sel.halfDayPrice).toLocaleString()})</span>
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
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: sel.mode === 'daily' ? '2px solid #059669' : '1px solid var(--border)',
                      backgroundColor: sel.mode === 'daily' ? 'rgba(16, 185, 129, 0.08)' : '#ffffff',
                      color: sel.mode === 'daily' ? '#047857' : 'var(--text-main)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '5px',
                      boxShadow: sel.mode === 'daily' ? '0 2px 8px rgba(16, 185, 129, 0.18)' : 'none',
                      minHeight: '42px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span style={{ whiteSpace: 'nowrap' }}>เหมาทั้งวัน (฿{sel.dailyPrice.toLocaleString()})</span>
                  </button>
                )}
              </div>

              {/* TIME CONTROLS BASED ON CHOSEN PACKAGE */}
              {sel.mode === 'hourly' && (
                <div style={{
                  backgroundColor: 'var(--bg-page)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  flexWrap: 'wrap'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>เริ่ม:</span>
                    <select
                      value={sel.rawStartTime}
                      onChange={e => {
                        const newStart = e.target.value;
                        const [sH, sM] = newStart.split(':').map(Number);
                        const startMins = sH * 60 + sM;
                        const [curEndH, curEndM] = (sel.endTime || '18:00').split(':').map(Number);
                        const curEndMins = curEndH * 60 + curEndM;

                        let newEndMins = curEndMins <= startMins ? startMins + 60 : curEndMins;
                        if (newEndMins > 18 * 60) newEndMins = 18 * 60;
                        const eH = Math.floor(newEndMins / 60).toString().padStart(2, '0');
                        const eM = (newEndMins % 60).toString().padStart(2, '0');
                        setRoomSelections(prev => ({
                          ...prev,
                          [room.id]: {
                            ...(prev[room.id] || {}),
                            mode: 'hourly',
                            startTime: newStart,
                            endTime: `${eH}:${eM}`
                          }
                        }));
                      }}
                      className="form-input"
                      style={{ height: '36px', width: 'auto', padding: '0 6px', fontWeight: 800, borderRadius: '8px', cursor: 'pointer' }}
                    >
                      {availableStartOptions.map(t => (
                        <option key={t} value={t}>{t} น.</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>ถึง:</span>
                    <select
                      value={sel.rawEndTime}
                      onChange={e => {
                        setRoomSelections(prev => ({
                          ...prev,
                          [room.id]: {
                            ...(prev[room.id] || {}),
                            mode: 'hourly',
                            endTime: e.target.value
                          }
                        }));
                      }}
                      className="form-input"
                      style={{ height: '36px', width: 'auto', padding: '0 6px', fontWeight: 800, borderRadius: '8px', cursor: 'pointer' }}
                    >
                      {TIME_OPTIONS.filter(t => t > sel.rawStartTime).map(t => (
                        <option key={t} value={t}>{t} น.</option>
                      ))}
                    </select>
                  </div>

                  <span style={{
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    color: 'var(--primary)',
                    backgroundColor: 'var(--primary-light)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  }}>
                    {sel.duration % 1 !== 0
                      ? `รวม ${sel.duration} ชม. (คิดราคา ${Math.ceil(sel.duration)} ชม.)`
                      : `รวม ${sel.duration} ชม.`}
                  </span>
                </div>
              )}

              {sel.mode === 'halfday' && (
                <div style={{
                  backgroundColor: 'rgba(124, 58, 237, 0.04)',
                  border: '1px solid rgba(124, 58, 237, 0.2)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#7c3aed' }}>เลือกรอบเวลาครึ่งวัน:</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setRoomSelections(prev => ({
                        ...prev,
                        [room.id]: { ...(prev[room.id] || {}), mode: 'halfday', halfDaySlot: '08-12' }
                      }))}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: sel.halfDaySlot === '08-12' ? '1.5px solid #7c3aed' : '1px solid var(--border)',
                        backgroundColor: sel.halfDaySlot === '08-12' ? '#7c3aed' : '#ffffff',
                        color: sel.halfDaySlot === '08-12' ? '#ffffff' : 'var(--text-main)',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        minHeight: '38px'
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
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: sel.halfDaySlot === '13-17' ? '1.5px solid #7c3aed' : '1px solid var(--border)',
                        backgroundColor: sel.halfDaySlot === '13-17' ? '#7c3aed' : '#ffffff',
                        color: sel.halfDaySlot === '13-17' ? '#ffffff' : 'var(--text-main)',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        minHeight: '38px'
                      }}
                    >
                      รอบบ่าย (13:00 - 17:00 น.)
                    </button>
                  </div>
                </div>
              )}

              {sel.mode === 'daily' && (
                <div style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.04)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 800, color: '#047857' }}>เลือกช่วงเวลาเหมาวัน:</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setRoomSelections(prev => ({
                        ...prev,
                        [room.id]: { ...(prev[room.id] || {}), mode: 'daily', dailySlot: '08-17' }
                      }))}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: sel.dailySlot === '08-17' ? '1.5px solid #059669' : '1px solid var(--border)',
                        backgroundColor: sel.dailySlot === '08-17' ? '#059669' : '#ffffff',
                        color: sel.dailySlot === '08-17' ? '#ffffff' : 'var(--text-main)',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        minHeight: '38px'
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
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: sel.dailySlot === '09-18' ? '1.5px solid #059669' : '1px solid var(--border)',
                        backgroundColor: sel.dailySlot === '09-18' ? '#059669' : '#ffffff',
                        color: sel.dailySlot === '09-18' ? '#ffffff' : 'var(--text-main)',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        textAlign: 'center',
                        minHeight: '38px'
                      }}
                    >
                      09:00 - 18:00 น.
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pricing and Action Button */}
          <div className="room-card-bottom" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--border)',
            paddingTop: '12px',
            marginTop: '8px',
            gap: '12px'
          }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{sel.rateLabel}</span>
                {sel.isPromotionApplied && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#dcfce7',
                    color: '#15803d',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '1px 7px',
                    borderRadius: '9999px',
                    border: '1px solid #bbf7d0'
                  }}>
                    <Sparkles size={11} /> ส่วนลดจองออนไลน์ {sel.discountValue ?? (promotion?.discount_value || 5)}%
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                {sel.isPromotionApplied ? (
                  <>
                    <span style={{ fontSize: '1.4rem', fontWeight: 900, color: '#16a34a' }}>
                      ฿{Number(sel.totalPrice).toLocaleString()}
                    </span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#94a3b8', textDecoration: 'line-through' }}>
                      ฿{Number(sel.subtotalPrice).toLocaleString()}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--primary)' }}>
                    ฿{Number(sel.totalPrice).toLocaleString()}
                  </span>
                )}
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  ({sel.startTime} - {sel.endTime} น.)
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={isOccupied}
              onClick={() => handleSelectRoom(room)}
              className="btn-primary"
              style={{
                width: 'auto',
                minWidth: '150px',
                height: '46px',
                fontSize: '0.92rem',
                backgroundColor: isOccupied ? '#cbd5e1' : undefined
              }}
            >
              <span>{isOccupied ? 'ช่วงเวลานี้ไม่สามารถจองได้' : 'เลือกห้องนี้'}</span>
              {!isOccupied && <ChevronRight size={18} />}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="main-content">
      {/* 4-STEP WIZARD PROGRESS BAR */}
      <StepProgress currentStep={2} />

      {/* TOP BAR: FIXED DATE/GUESTS DISPLAY (Edit at Step 1 only) */}
      <div style={{
        backgroundColor: '#ffffff',
        border: '1.5px solid var(--border)',
        borderRadius: '16px',
        padding: '14px 16px',
        boxShadow: 'var(--shadow-sm)',
        marginBottom: '22px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }}>
        {/* Row 1: Date Badge (Full Width) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          color: 'var(--primary)',
          padding: '10px 14px',
          borderRadius: '12px',
          fontSize: '0.88rem',
          fontWeight: 800,
          width: '100%'
        }}>
          <Calendar size={18} />
          <span>{formatToDdMmYyyy(dateStr)} ({formatThaiDateDesc(dateStr)})</span>
        </div>

        {/* Row 2: Selected Room or Guests Badge on Left & Change Button on Right */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          alignItems: 'center',
          gap: '10px'
        }}>
          {roomIdParam ? (
            /* Direct Room Badge */
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-page)',
              color: 'var(--text-main)',
              border: '1.5px solid var(--border)',
              padding: '8px 14px',
              borderRadius: '12px',
              fontSize: '0.86rem',
              fontWeight: 800,
              height: '42px',
              whiteSpace: 'nowrap'
            }}>
              <Building size={16} style={{ color: 'var(--primary)' }} />
              <span>{selectedDirectRoom ? selectedDirectRoom.name : `ห้อง ID: ${roomIdParam}`}</span>
            </div>
          ) : (
            /* Guests Badge */
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-page)',
              color: 'var(--text-main)',
              border: '1.5px solid var(--border)',
              padding: '8px 14px',
              borderRadius: '12px',
              fontSize: '0.86rem',
              fontWeight: 800,
              height: '42px',
              whiteSpace: 'nowrap'
            }}>
              <Users size={16} style={{ color: 'var(--primary)' }} />
              <span>{guests ? `${guests} ท่าน` : 'ทุกขนาดห้อง'}</span>
            </div>
          )}

          {/* Change Date / Room Button */}
          <button
            type="button"
            onClick={() => {
              if (roomIdParam) {
                navigate(`/?date=${dateStr}&roomId=${roomIdParam}`);
              } else {
                navigate(`/?date=${dateStr}${guests ? `&guests=${guests}` : ''}`);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: '42px',
              padding: '0 14px',
              backgroundColor: '#ffffff',
              color: 'var(--primary)',
              border: '1.5px solid var(--primary)',
              borderRadius: '12px',
              fontSize: '0.82rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.08)',
              transition: 'all 0.15s ease',
              width: '100%',
              whiteSpace: 'nowrap'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.08)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#ffffff'}
          >
            <Edit3 size={15} />
            <span>{roomIdParam ? 'เปลี่ยนห้อง / วันที่' : 'เปลี่ยนวันที่ / จำนวนคน'}</span>
          </button>
        </div>

        {/* View All Rooms Button (Shown only when in Direct Room mode) */}
        {roomIdParam && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '4px', borderTop: '1px dashed var(--border)' }}>
            <button
              type="button"
              onClick={() => {
                setRoomIdParam(null);
                navigate(`/rooms?date=${dateStr}${guests ? `&guests=${guests}` : ''}`);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '10px',
                backgroundColor: 'rgba(37, 99, 235, 0.06)',
                color: 'var(--primary)',
                border: '1px solid rgba(37, 99, 235, 0.25)',
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.12)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.06)'}
            >
              <Building size={14} />
              <span>ดูห้องประชุมทั้งหมด</span>
            </button>
          </div>
        )}
      </div>

      {/* SECTION TITLE */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1.35rem', fontWeight: 900, color: 'var(--text-main)', margin: 0 }}>
          {roomIdParam ? '2. รายละเอียดห้อง & ช่วงเวลาว่าง' : '2. เลือกห้องประชุม & แพ็กเกจที่ต้องการ'}
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
          {roomIdParam
            ? 'ตรวจสอบช่วงเวลาว่าง แพ็กเกจราคา และเลือกเวลาที่ต้องการจอง'
            : 'แต่ละห้องแสดงแพ็กเกจราคาเฉพาะที่มีในคลังสินค้า สามารถเลือกรายชั่วโมง, ครึ่งวัน หรือเหมาทั้งวันได้ทันที'}
        </p>
      </div>

      {/* LOADING SPINNER */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px auto' }} />
          <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>กำลังตรวจสอบข้อมูลห้องว่างและคลังสินค้า...</div>
        </div>
      ) : roomIdParam ? (
        /* MODE A: DIRECT ROOM SELECTION VIEW */
        selectedDirectRoom ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {renderRoomCard(selectedDirectRoom, false)}

            {/* Occupied Notice & Alternative Actions */}
            {(() => {
              const sel = getRoomSelection(selectedDirectRoom);
              const occInfo = getRoomOccupiedInfo(selectedDirectRoom.id, sel.startTime, sel.endTime);
              if (occInfo && occInfo.isOccupied) {
                return (
                  <div style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    border: '1.5px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '16px',
                    padding: '16px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontWeight: 800, fontSize: '0.92rem' }}>
                      <AlertCircle size={18} />
                      <span>ห้องนี้ไม่สามารถจองในช่วงเวลาที่เลือกได้ ({occInfo.label})</span>
                    </div>
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0 }}>
                      คุณสามารถปรับเปลี่ยนเวลาด้านบน, เปลี่ยนวันที่ใช้งาน หรือเลือกดูห้องประชุมห้องอื่นที่ว่างในวันเดียวกัน
                    </p>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setRoomIdParam(null);
                          navigate(`/rooms?date=${dateStr}`);
                        }}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '10px',
                          border: '1px solid var(--primary)',
                          backgroundColor: '#ffffff',
                          color: 'var(--primary)',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        ดูห้องประชุมอื่นที่ว่าง
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/?date=${dateStr}&roomId=${selectedDirectRoom.id}`)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '10px',
                          border: '1px solid var(--border)',
                          backgroundColor: '#ffffff',
                          color: 'var(--text-main)',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        เปลี่ยนวันที่ใช้งาน
                      </button>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        ) : (
          /* ROOM NOT FOUND STATE */
          <div className="booking-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <AlertCircle size={40} style={{ color: 'var(--danger)', margin: '0 auto 12px auto' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
              ไม่พบห้องประชุมที่เลือก หรือห้องประชุมนี้ปิดให้บริการชั่วคราว
            </h3>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: '16px' }}>
              กรุณาเลือกห้องประชุมใหม่อีกครั้ง หรือเลือกดูห้องประชุมทั้งหมดที่เปิดให้บริการ
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => navigate(`/?date=${dateStr}`)}
                className="btn-secondary"
                style={{ width: 'auto', padding: '0 16px', height: '42px', fontSize: '0.86rem' }}
              >
                กลับไปเลือกห้องใหม่
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoomIdParam(null);
                  navigate(`/rooms?date=${dateStr}`);
                }}
                className="btn-primary"
                style={{ width: 'auto', padding: '0 16px', height: '42px', fontSize: '0.86rem' }}
              >
                ดูห้องประชุมทั้งหมด
              </button>
            </div>
          </div>
        )
      ) : (
        /* MODE B: ALL ROOMS CATEGORIZED VIEW (Existing behavior preserved) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* SECTION A: RECOMMENDED ROOMS (Exact Fit) */}
          {recommendedRooms.length > 0 && (
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px'
              }}>
                <span style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  color: '#10b981',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <CheckCircle2 size={13} />
                  <span>{recommendedLabel}</span>
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  พบ {recommendedRooms.length} ห้องที่ตรงกับจำนวนผู้เข้าใช้
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {recommendedRooms.map(room => renderRoomCard(room, false))}
              </div>
            </div>
          )}

          {/* SECTION B: UPGRADE OFFER ROOMS (Wider Spaces) */}
          {upgradeRooms.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px'
              }}>
                <span style={{
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: 'var(--primary)',
                  padding: '4px 10px',
                  borderRadius: '20px',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <Sparkles size={13} />
                  <span>{upgradeLabel}</span>
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  ตัวเลือกสำหรับผู้ที่ต้องการพื้นที่กว้างขวาง ปลอดโปร่งขึ้น
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {upgradeRooms.map(room => renderRoomCard(room, true))}
              </div>
            </div>
          )}

          {recommendedRooms.length === 0 && upgradeRooms.length === 0 && (
            <div className="booking-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <AlertCircle size={40} style={{ color: 'var(--warning)', margin: '0 auto 12px auto' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                ไม่พบห้องประชุมที่ตรงกับเงื่อนไข
              </h3>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                กรุณาลองปรับเปลี่ยนวันที่หรือจำนวนผู้เข้าใช้งาน
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
