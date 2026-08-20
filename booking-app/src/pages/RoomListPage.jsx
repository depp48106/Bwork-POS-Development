import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

// Helper to generate 30-min time options (08:00 - 18:00)
const generateTimeOptions = () => {
  const options = [];
  for (let i = 8; i <= 18; i++) {
    const h = i.toString().padStart(2, '0');
    options.push(`${h}:00`);
    if (i < 18) options.push(`${h}:30`);
  }
  return options;
};

const TIME_OPTIONS = generateTimeOptions();

// Helper to format local date as YYYY-MM-DD
const formatLocalDateIso = (year, monthIndex, day) => {
  const m = String(monthIndex + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
};

// Helper to check if a time slot is in the past for the selected date
const isPastTime = (slotTime, selectedDateStr) => {
  if (!selectedDateStr || !slotTime) return false;
  const now = new Date();
  const todayStr = formatLocalDateIso(now.getFullYear(), now.getMonth(), now.getDate());
  if (selectedDateStr !== todayStr) return false;
  
  const [sh, sm] = slotTime.split(':').map(Number);
  const slotMinutes = sh * 60 + (sm || 0);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return slotMinutes <= nowMinutes;
};


// Subcomponent for each Room Card with Smart Option Selection & Offer Badges
function RoomCard({ 
  room, 
  date, 
  guests, 
  bookingsForRoom, 
  onSelectRoom, 
  isOffer = false,
  initialStartTime = '09:00',
  initialEndTime = '10:00'
}) {
  // Check classroom setup capability (e.g. Mars 301)
  const hasClassroom = room.has_classroom === 1;
  // Dynamic initial layout based on guest count: if guests >= 9, default to classroom layout (12 seats)
  const initialLayout = (hasClassroom && guests >= 9) ? 'classroom' : 'standard';
  const [layoutType, setLayoutType] = useState(initialLayout);

  // Dynamic rates based on selected layout
  const hourlyRate = (hasClassroom && layoutType === 'classroom') ? (room.classroom_hourly_rate || room.hourly_rate) : room.hourly_rate;
  const dailyRate = (hasClassroom && layoutType === 'classroom') ? (room.classroom_daily_rate || room.daily_rate) : room.daily_rate;
  const capacity = (hasClassroom && layoutType === 'classroom') ? (room.classroom_capacity || room.capacity) : room.capacity;

  // Determine supported options based on room pricing
  const hasHourly = hourlyRate > 0;
  const hasHalfDay = room.half_day_rate > 0;
  const hasDaily = dailyRate > 0;

  // Default active tab
  const defaultType = hasHourly ? 'hourly' : (hasHalfDay ? 'halfday' : 'daily');
  const [bookingType, setBookingType] = useState(defaultType);

  // Hourly state (initialized from search criteria!)
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);

  // Half day slot: '08:00-12:00' or '13:00-17:00'
  const [halfDaySlot, setHalfDaySlot] = useState('08:00-12:00');

  // Full day slot: '08:00-17:00' or '09:00-18:00'
  const [fullDaySlot, setFullDaySlot] = useState('08:00-17:00');

  // Auto adjust hourly end time
  const handleStartTimeChange = (newStart) => {
    setStartTime(newStart);
    const startHour = parseInt(newStart.split(':')[0]);
    const nextHour = (startHour + 1).toString().padStart(2, '0') + ':00';
    if (TIME_OPTIONS.includes(nextHour)) {
      setEndTime(nextHour);
    }
  };

  // Determine current active start and end time
  const getActiveTimes = () => {
    if (bookingType === 'halfday') {
      const [s, e] = halfDaySlot.split('-');
      return { start: s, end: e };
    }
    if (bookingType === 'daily') {
      const [s, e] = fullDaySlot.split('-');
      return { start: s, end: e };
    }
    return { start: startTime, end: endTime };
  };

  const { start: activeStart, end: activeEnd } = getActiveTimes();

  // Calculate duration in hours
  const calcHours = (sStr, eStr) => {
    const [sh, sm] = sStr.split(':').map(Number);
    const [eh, em] = eStr.split(':').map(Number);
    return Math.max(1, Math.ceil(((eh * 60 + em) - (sh * 60 + sm)) / 60));
  };

  const currentHours = calcHours(activeStart, activeEnd);

  // Calculate Price
  const calculatePrice = () => {
    if (bookingType === 'halfday') {
      return room.half_day_rate > 0 ? room.half_day_rate : (hourlyRate * 4);
    }
    if (bookingType === 'daily') {
      return dailyRate > 0 ? dailyRate : (hourlyRate * 9);
    }
    return currentHours * hourlyRate;
  };

  const totalPrice = calculatePrice();

  // Overlap Check for active selected time range
  const checkIsBooked = () => {
    if (!bookingsForRoom || bookingsForRoom.length === 0) return false;
    const reqStartMs = new Date(`${date}T${activeStart}:00`).getTime();
    const reqEndMs = new Date(`${date}T${activeEnd}:00`).getTime();

    return bookingsForRoom.some(b => {
      const bStartMs = new Date(String(b.start_time).replace(' ', 'T')).getTime();
      const bEndMs = new Date(String(b.end_time).replace(' ', 'T')).getTime();
      return bStartMs < reqEndMs && bEndMs > reqStartMs;
    });
  };

  const isBooked = checkIsBooked();

  const handleBookClick = () => {
    onSelectRoom({
      room,
      date,
      startTime: activeStart,
      endTime: activeEnd,
      guests,
      hours: currentHours,
      bookingType,
      layoutType,
      totalPrice
    });
  };

  // Determine active image URL based on selected layout (Standard vs Classroom)
  const activeImageUrl = (hasClassroom && layoutType === 'classroom' && room.classroom_image_url) 
    ? room.classroom_image_url 
    : room.image_url;

  return (
    <div 
      className="glass-card"
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        borderRadius: '16px',
        border: isBooked ? '1.5px solid #fecaca' : isOffer ? '1.5px solid #93c5fd' : '1.5px solid #cbd5e1',
        boxShadow: isOffer ? '0 6px 18px rgba(37, 99, 235, 0.09)' : '0 4px 14px rgba(15, 23, 42, 0.06)',
        position: 'relative'
      }}
    >
      {/* Room Header Image */}
      <div style={{ height: '150px', backgroundColor: '#e2e8f0', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {activeImageUrl ? (
          <img 
            src={activeImageUrl} 
            alt={`${room.name} (${layoutType})`} 
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'all 0.3s ease' }}
          />
        ) : (
          <div style={{ 
            width: '100%', 
            height: '100%', 
            background: isOffer ? 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
            display: 'flex',
            alignItems: 'center',
            justify: 'center',
            color: 'white',
            fontWeight: 'bold',
            fontSize: '1.3rem'
          }}>
            {room.name}
          </div>
        )}

        {/* Offer Badge vs Status Badge */}
        {isOffer && (
          <span style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: '#1d4ed8',
            color: 'white',
            padding: '0.25rem 0.65rem',
            borderRadius: '20px',
            fontSize: '0.725rem',
            fontWeight: 'bold',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
          }}>
            ข้อเสนอห้องกว้างพิเศษ
          </span>
        )}

        <span style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          backgroundColor: isBooked ? '#ef4444' : '#15803d',
          color: 'white',
          padding: '0.2rem 0.65rem',
          borderRadius: '20px',
          fontSize: '0.725rem',
          fontWeight: 'bold'
        }}>
          {isBooked ? 'ติดจองช่วงเวลานี้' : 'ว่างพร้อมจอง'}
        </span>
      </div>

      {/* Room Details */}
      <div style={{ padding: '1.15rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ 
            margin: '0 0 0.25rem 0', 
            fontSize: '1.15rem', 
            color: '#0f172a', 
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }} title={room.name}>
            {room.name}
          </h3>
          
          <p style={{ fontSize: '0.825rem', color: isOffer ? '#1d4ed8' : '#475569', margin: '0 0 0.75rem 0', height: '20px', display: 'flex', alignItems: 'center', fontWeight: isOffer ? 600 : 400 }}>
            รองรับสูงสุด {capacity} ท่าน {isOffer ? '(เนื้อที่กว้างขวางพิเศษ)' : ''}
          </p>

          {/* Room Layout Setup Toggle (Standard vs Classroom) - Equal 66px height for 100% horizontal alignment! */}
          {hasClassroom ? (
            <div style={{ 
              height: '66px', 
              marginBottom: '0.75rem', 
              backgroundColor: '#f0f9ff', 
              border: '1px solid #bae6fd', 
              padding: '0.4rem 0.5rem', 
              borderRadius: '10px',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justify: 'center'
            }}>
              <div style={{ fontSize: '0.725rem', fontWeight: 'bold', color: '#0369a1', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                ✨ เลือกจัดรูปแบบห้องได้ 2 แบบ:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', backgroundColor: '#e2e8f0', padding: '2px', borderRadius: '8px' }}>
                <button
                  type="button"
                  onClick={() => setLayoutType('standard')}
                  style={{
                    padding: '0.35rem 0.2rem',
                    fontSize: '0.725rem',
                    fontWeight: 'bold',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backgroundColor: layoutType === 'standard' ? 'white' : 'transparent',
                    color: layoutType === 'standard' ? 'var(--primary)' : '#64748b',
                    boxShadow: layoutType === 'standard' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  Standard ({room.capacity} ที่)
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutType('classroom')}
                  style={{
                    padding: '0.35rem 0.2rem',
                    fontSize: '0.725rem',
                    fontWeight: 'bold',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    backgroundColor: layoutType === 'classroom' ? '#ec4899' : 'transparent',
                    color: layoutType === 'classroom' ? 'white' : '#64748b',
                    boxShadow: layoutType === 'classroom' ? '0 1px 4px rgba(236, 72, 153, 0.25)' : 'none'
                  }}
                >
                  Classroom ({room.classroom_capacity} ที่)
                </button>
              </div>
            </div>
          ) : (
            /* Matching 66px Height Spacer Container for standard-only rooms to guarantee 100% row alignment across all cards */
            <div style={{ 
              height: '66px', 
              marginBottom: '0.75rem', 
              display: 'flex', 
              alignItems: 'center',
              backgroundColor: '#f8fafc',
              border: '1px solid #f1f5f9',
              padding: '0.4rem 0.6rem',
              borderRadius: '10px',
              boxSizing: 'border-box'
            }}>
              <span style={{ fontSize: '0.75rem', color: '#475569', backgroundColor: '#e2e8f0', padding: '0.35rem 0.65rem', borderRadius: '6px', fontWeight: 600 }}>
                รูปแบบมาตรฐาน Standard
              </span>
            </div>
          )}

          {/* Segmented Control for Booking Types */}
          <div style={{
            display: 'grid',
            gridAutoFlow: 'column',
            gridAutoColumns: '1fr',
            gap: '4px',
            backgroundColor: '#f1f5f9',
            padding: '4px',
            borderRadius: '8px',
            marginBottom: '0.75rem'
          }}>
            {hasHourly && (
              <button
                type="button"
                onClick={() => setBookingType('hourly')}
                style={{
                  padding: '0.4rem 0.2rem',
                  fontSize: '0.775rem',
                  fontWeight: 'bold',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: bookingType === 'hourly' ? 'var(--primary)' : 'transparent',
                  color: bookingType === 'hourly' ? 'white' : '#64748b',
                  boxShadow: bookingType === 'hourly' ? '0 2px 5px rgba(30, 58, 138, 0.25)' : 'none'
                }}
              >
                รายชั่วโมง
              </button>
            )}
            {hasHalfDay && (
              <button
                type="button"
                onClick={() => setBookingType('halfday')}
                style={{
                  padding: '0.4rem 0.2rem',
                  fontSize: '0.775rem',
                  fontWeight: 'bold',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: bookingType === 'halfday' ? 'var(--primary)' : 'transparent',
                  color: bookingType === 'halfday' ? 'white' : '#64748b',
                  boxShadow: bookingType === 'halfday' ? '0 2px 5px rgba(30, 58, 138, 0.25)' : 'none'
                }}
              >
                ครึ่งวัน
              </button>
            )}
            {hasDaily && (
              <button
                type="button"
                onClick={() => setBookingType('daily')}
                style={{
                  padding: '0.4rem 0.2rem',
                  fontSize: '0.775rem',
                  fontWeight: 'bold',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: bookingType === 'daily' ? 'var(--primary)' : 'transparent',
                  color: bookingType === 'daily' ? 'white' : '#64748b',
                  boxShadow: bookingType === 'daily' ? '0 2px 5px rgba(30, 58, 138, 0.25)' : 'none'
                }}
              >
                เต็มวัน
              </button>
            )}
          </div>

          {/* Fixed-Height Time Slot Panel (Prevents Layout Shifting) */}
          <div style={{ 
            backgroundColor: '#f8fafc', 
            padding: '0.65rem 0.75rem', 
            borderRadius: '10px', 
            marginBottom: '0.85rem', 
            border: '1px solid #cbd5e1',
            height: '96px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justify: 'center'
          }}>
            {bookingType === 'hourly' && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginBottom: '0.25rem' }}>
                  ระบุช่วงเวลาจอง (รายชั่วโมง):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '2px', fontWeight: 600 }}>เริ่ม:</label>
                    <select
                      className="form-control"
                      value={startTime}
                      onChange={(e) => handleStartTimeChange(e.target.value)}
                      style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', fontWeight: 600, color: 'var(--primary)' }}
                    >
                      {TIME_OPTIONS.filter(t => t < '18:00').map(t => {
                        const isPast = isPastTime(t, date);
                        return (
                          <option 
                            key={`s-${t}`} 
                            value={t} 
                            disabled={isPast}
                            style={{ color: isPast ? '#94a3b8' : 'inherit' }}
                          >
                            {t} น.
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '2px', fontWeight: 600 }}>สิ้นสุด:</label>
                    <select
                      className="form-control"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', fontWeight: 600, color: 'var(--primary)' }}
                    >
                      {TIME_OPTIONS.filter(t => t > '08:00').map(t => {
                        const isPast = isPastTime(t, date);
                        const isBefore = startTime ? t <= startTime : false;
                        const isDisabled = isPast || isBefore;
                        return (
                          <option 
                            key={`e-${t}`} 
                            value={t}
                            disabled={isDisabled}
                            style={{ color: isDisabled ? '#94a3b8' : 'inherit' }}
                          >
                            {t} น.
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {bookingType === 'halfday' && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginBottom: '0.25rem' }}>
                  เลือกรอบเวลาครึ่งวัน:
                </div>
                <select
                  className="form-control"
                  value={halfDaySlot}
                  onChange={(e) => setHalfDaySlot(e.target.value)}
                  style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', fontWeight: 600, color: 'var(--primary)' }}
                >
                  <option value="08:00-12:00" disabled={isPastTime('08:00', date)} style={{ color: isPastTime('08:00', date) ? '#94a3b8' : 'inherit' }}>
                    รอบเช้า (08:00 - 12:00 น.)
                  </option>
                  <option value="13:00-17:00" disabled={isPastTime('13:00', date)} style={{ color: isPastTime('13:00', date) ? '#94a3b8' : 'inherit' }}>
                    รอบบ่าย (13:00 - 17:00 น.)
                  </option>
                </select>
              </div>
            )}

            {bookingType === 'daily' && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginBottom: '0.25rem' }}>
                  เลือกรอบเวลาเหมาเต็มวัน:
                </div>
                <select
                  className="form-control"
                  value={fullDaySlot}
                  onChange={(e) => setFullDaySlot(e.target.value)}
                  style={{ padding: '0.45rem 0.6rem', borderRadius: '8px', fontWeight: 600, color: 'var(--primary)' }}
                >
                  <option value="08:00-17:00">รอบ 08:00 - 17:00 น.</option>
                  <option value="09:00-18:00">รอบ 09:00 - 18:00 น.</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Price & Action Button */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '0.825rem', color: '#64748b' }}>
              {bookingType === 'hourly' ? `ค่าบริการ (${currentHours} ชม.):` : (bookingType === 'halfday' ? 'เหมาครึ่งวัน:' : 'เหมาเต็มวัน:')}
            </span>
            <span style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--primary)' }}>
              ฿{totalPrice.toLocaleString()}
            </span>
          </div>

          <button 
            className={`btn ${isBooked ? 'btn-outline' : 'btn-primary'}`}
            onClick={handleBookClick}
            disabled={isBooked}
            style={{ width: '100%', padding: '0.7rem', fontSize: '0.9rem', fontWeight: 'bold', borderRadius: '8px' }}
          >
            {isBooked ? 'ช่วงเวลานี้ติดจอง (เลือกเวลาอื่น)' : 'เลือกจองห้องนี้'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoomListPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [allRooms, setAllRooms] = useState([]);
  const [schedulesMap, setSchedulesMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const date = searchParams.get('date');
  const reqStartTime = searchParams.get('startTime') || '09:00';
  const reqEndTime = searchParams.get('endTime') || '10:00';
  const guests = parseInt(searchParams.get('guests')) || 1;

  // Format date for display
  const formatDateDisplay = (dStr) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayStr = String(d).padStart(2, '0');
    const monthStr = String(m).padStart(2, '0');
    const thaiYear = y + 543;
    const fullText = dateObj.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return `${dayStr}/${monthStr}/${thaiYear} (${fullText})`;
  };

  // Helper to sort rooms numerically by room number (e.g. 201, 202, 301, 306)
  const sortRoomsByNumber = (roomList) => {
    return [...roomList].sort((a, b) => {
      const matchA = (a.name || '').match(/\d+/);
      const matchB = (b.name || '').match(/\d+/);
      const numA = matchA ? parseInt(matchA[0]) : 9999;
      const numB = matchB ? parseInt(matchB[0]) : 9999;
      if (numA !== numB) return numA - numB;
      return (a.name || '').localeCompare(b.name || '');
    });
  };

  useEffect(() => {
    if (!date) {
      navigate('/');
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const [roomsRes, schedRes] = await Promise.all([
          fetch(`${API_BASE}/api/public/rooms`),
          fetch(`${API_BASE}/api/public/rooms/schedule?date=${date}`)
        ]);

        if (roomsRes.ok) {
          const roomData = await roomsRes.json();
          setAllRooms(sortRoomsByNumber(roomData || []));
        } else {
          setError('ไม่สามารถดึงข้อมูลห้องประชุมได้');
        }

        if (schedRes.ok) {
          const schedData = await schedRes.json();
          const map = {};
          (schedData.rooms || []).forEach(r => {
            map[r.id] = r.bookings || [];
          });
          setSchedulesMap(map);
        }
      } catch (err) {
        setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [date, navigate]);

  const handleSelectRoom = (selectedData) => {
    try {
      sessionStorage.setItem('current_booking_selection', JSON.stringify(selectedData));
    } catch (e) {
      console.warn('SessionStorage error:', e);
    }
    navigate('/booking', {
      state: selectedData
    });
  };

  // BWORK Smart Tier Room Matching Algorithm:
  // Categorize rooms based on actual BWORK room capacities (4, 8, 10, 12, 40)
  const validRooms = allRooms.filter(room => {
    const maxCap = Math.max(room.capacity || 0, room.classroom_capacity || 0);
    return maxCap >= guests;
  });

  let perfectFitRooms = [];
  let offerRooms = [];

  if (guests <= 4) {
    // 1-4 Guests: Small rooms (Saturn, Venus, Uranus, Neptune cap 4) are Perfect Fit
    // Medium rooms (Mars cap 8, Mercury cap 10) are Upgrade Offers
    perfectFitRooms = validRooms.filter(r => r.capacity <= 4);
    offerRooms = validRooms.filter(r => r.capacity >= 8 && r.capacity <= 10);
  } else if (guests <= 8) {
    // 5-8 Guests: Medium rooms (Mars cap 8, Mercury cap 10) are Perfect Fit
    // 12-person setups (Mars Classroom cap 12, Pluto cap 12) are Upgrade Offers
    perfectFitRooms = validRooms.filter(r => r.capacity >= 8 && r.capacity <= 10);
    offerRooms = validRooms.filter(r => {
      const maxCap = Math.max(r.capacity || 0, r.classroom_capacity || 0);
      return maxCap === 12;
    });
  } else if (guests <= 12) {
    // 9-12 Guests: Large rooms (Mercury 10, Pluto 12, Mars Classroom 12) are Perfect Fit
    perfectFitRooms = validRooms.filter(r => {
      const maxCap = Math.max(r.capacity || 0, r.classroom_capacity || 0);
      return maxCap >= 10 && maxCap <= 12;
    });
    offerRooms = [];
  } else {
    // 13-40+ Guests: Hall & Co-working (Jupiter 40) are Perfect Fit
    perfectFitRooms = validRooms.filter(r => {
      const maxCap = Math.max(r.capacity || 0, r.classroom_capacity || 0);
      return maxCap >= 40;
    });
    offerRooms = [];
  }

  // DEDUPLICATION: Ensure no room ID appears in offerRooms if it's already in perfectFitRooms
  offerRooms = offerRooms.filter(r => !perfectFitRooms.some(p => p.id === r.id));

  // Fallback: If no exact perfect fit available or booked out, present valid upgrade rooms directly
  if (perfectFitRooms.length === 0 && offerRooms.length > 0) {
    perfectFitRooms = offerRooms;
    offerRooms = [];
  }

  return (
    <div className="page-transition" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      {/* Hero Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ color: 'var(--primary)', fontSize: '2rem', margin: '0 0 0.25rem 0', fontWeight: 'bold' }}>B-WORK</h1>
        <h2 style={{ margin: '0 0 0.35rem 0', fontSize: '1.2rem' }}>เลือกห้องประชุมและรูปแบบการจอง / Choose Room & Option</h2>
      </div>

      {/* Progress Step Indicator (Step 2 Active) */}
      <StepProgress currentStep={2} />

      {/* Search Criteria Summary Bar */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.15rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem' }}>
          <div>
            <div style={{ fontSize: '0.775rem', color: '#64748b' }}>เงื่อนไขการค้นหาห้องว่าง:</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: 'var(--primary)', margin: '2px 0' }}>
              {formatDateDisplay(date)}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#0f172a', fontWeight: 600 }}>
              เวลาที่ต้องการใช้งาน: <span style={{ color: 'var(--primary)' }}>{reqStartTime} - {reqEndTime} น.</span> | จำนวน: <span style={{ color: 'var(--primary)' }}>{guests} ท่าน</span>
            </div>
          </div>
          <button 
            className="btn btn-outline"
            onClick={() => navigate('/')}
            style={{ fontSize: '0.825rem', padding: '0.4rem 0.8rem' }}
          >
            &larr; เปลี่ยนวัน/เวลาจอง
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="glass-card" style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', marginBottom: '1.25rem', borderRadius: '10px' }}>
          {error}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          กำลังคัดกรองห้องประชุมที่เหมาะสมกับกลุ่มของคุณ...
        </div>
      ) : (
        <>
          {/* SECTION 1: PERFECT FIT ROOMS */}
          <div style={{ marginBottom: '2.5rem' }}>
            <h3 style={{ fontSize: '1.15rem', color: '#166534', marginBottom: '0.85rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              ห้องประชุมขนาดพอดีกับกลุ่มของคุณ ({perfectFitRooms.length} ห้อง)
            </h3>

            {perfectFitRooms.length === 0 ? (
              <div className="glass-card" style={{ textAlign: 'center', padding: '2rem', color: '#475569', backgroundColor: '#f8fafc' }}>
                <h4 style={{ color: '#1e3a8a', marginBottom: '0.4rem' }}>ห้องประชุมขนาดพอดีสำหรับ {guests} ท่าน ไม่ว่างในช่วงเวลานี้</h4>
                <p style={{ fontSize: '0.875rem', margin: 0 }}>
                  ขอแนะนำข้อเสนอห้องประชุมขนาดใหญ่กว่าด้านล่างนี้ เพื่อพื้นที่กว้างขวางและความสะดวกสบายในการใช้งานค่ะ
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1.25rem' }}>
                {perfectFitRooms.map((room) => (
                  <RoomCard 
                    key={room.id} 
                    room={room} 
                    date={date} 
                    guests={guests} 
                    bookingsForRoom={schedulesMap[room.id] || []}
                    onSelectRoom={handleSelectRoom}
                    isOffer={false}
                    initialStartTime={reqStartTime}
                    initialEndTime={reqEndTime}
                  />
                ))}
              </div>
            )}
          </div>

          {/* SECTION 2: SPECIAL OFFERS / LARGER SPACE ROOMS */}
          {offerRooms.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ borderTop: '2px dashed #cbd5e1', paddingTop: '1.5rem', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.15rem', color: '#1d4ed8', margin: '0 0 0.25rem 0', fontWeight: 'bold' }}>
                  ข้อเสนอพิเศษ: ห้องประชุมขนาดใหญ่ขวางพิเศษ ({offerRooms.length} ห้อง)
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                  เพิ่มความโปร่งสบาย พื้นที่กว้างขวาง เหมาะสำหรับวางอุปกรณ์ จัดเบรค หรือกิจกรรมกลุ่มใหญ่
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '1.25rem' }}>
                {offerRooms.map((room) => (
                  <RoomCard 
                    key={room.id} 
                    room={room} 
                    date={date} 
                    guests={guests} 
                    bookingsForRoom={schedulesMap[room.id] || []}
                    onSelectRoom={handleSelectRoom}
                    isOffer={true}
                    initialStartTime={reqStartTime}
                    initialEndTime={reqEndTime}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
