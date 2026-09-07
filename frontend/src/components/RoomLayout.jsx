import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle, AlertCircle, Users, DollarSign, Calendar, RefreshCw, X, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

function RoomLayout({ sysAlert, onNavigateToBook }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modal for displaying occupied room details
  const [activeRoomDetail, setActiveRoomDetail] = useState(null);
  const [roomBookings, setRoomBookings] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [viewedEvent, setViewedEvent] = useState(null);
  const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  const getLocalDateStr = (timeVal) => {
    if (!timeVal) return '';
    if (typeof timeVal === 'string') {
      if (timeVal.includes('T')) return timeVal.split('T')[0];
      if (timeVal.includes(' ')) return timeVal.split(' ')[0];
    }
    const d = new Date(timeVal);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch occupancy on load
  useEffect(() => {
    fetchOccupancy();
  }, []);

  // Auto-fetch every 30 seconds
  useEffect(() => {
    const fetchTimer = setInterval(() => {
      fetchOccupancy();
    }, 30000);
    return () => clearInterval(fetchTimer);
  }, []);

  const fetchOccupancy = async () => {
    setLoading(true);
    try {
      const clientTimeStr = new Date().toISOString();
      const res = await fetch(`/api/rooms/occupancy?current_time=${clientTimeStr}`);
      if (res.ok) {
        const data = await res.json();
        setRooms(data);
        // If detail modal is open, update its room state in real-time
        if (activeRoomDetail) {
          const updated = data.find(r => r.id === activeRoomDetail.id);
          if (updated) {
            setActiveRoomDetail(updated);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load room occupancy:', err);
    } finally {
      setLoading(false);
    }
  };

  const getShortName = (name) => {
    // Matches letters like A, B, C, or numbers like 301, 302 from room name
    const match = name.match(/(?:ห้องประชุม(?:ใหญ่|กลาง|เล็ก)?\s*([A-Za-z0-9]+))/) || name.match(/([A-Za-z0-9]+)/);
    return match ? match[1] : name.substring(0, 3);
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
    } catch (e) {
      return timeStr;
    }
  };

  const calculateProgress = (startStr, endStr) => {
    if (!startStr || !endStr) return 0;
    try {
      const start = new Date(startStr).getTime();
      const end = new Date(endStr).getTime();
      const now = new Date().getTime();

      if (now >= end) return 100;
      if (now <= start) return 0;

      const total = end - start;
      const elapsed = now - start;
      return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    } catch (e) {
      return 0;
    }
  };

  const getDaysInMonth = (month, year) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month, year) => {
    return new Date(year, month, 1).getDay();
  };

  const handleViewBookingDetails = async (bookingId, roomId) => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}`);
      if (res.ok) {
        const bookingData = await res.json();
        const roomItem = bookingData.items ? bookingData.items.find(item => item.room_id === roomId) : null;
        setViewedEvent({
          room_name: roomItem ? roomItem.room_name : 'ห้องประชุม',
          customer_name: bookingData.customer_name,
          booking_source: bookingData.booking_source || 'walkin',
          receipt_number: bookingData.receipt_number || `#${String(bookingData.id).padStart(6, '0')}`,
          start_time: roomItem ? roomItem.start_time : bookingData.created_at,
          end_time: roomItem ? roomItem.end_time : bookingData.created_at,
          booking_type: roomItem ? roomItem.booking_type : 'hourly',
          layout: roomItem ? roomItem.layout : 'standard',
          booking_id: bookingData.id,
          payment_status: bookingData.payment_status,
          subtotal: roomItem ? roomItem.subtotal : bookingData.total_amount
        });
      } else {
        sysAlert('ไม่สามารถโหลดรายละเอียดการจองได้');
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการโหลดรายละเอียด');
    }
  };

  const handleRoomCardClick = async (room) => {
    setActiveRoomDetail(room);
    const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD'
    setSelectedDate(todayStr);

    const d = new Date();
    setCalendarMonth(d.getMonth());
    setCalendarYear(d.getFullYear());

    try {
      const res = await fetch(`/api/rooms/${room.id}/bookings`);
      if (res.ok) {
        const data = await res.json();
        setRoomBookings(data);
      } else {
        setRoomBookings([]);
      }
    } catch (err) {
      console.error('Failed to load room bookings:', err);
      setRoomBookings([]);
    }
  };

  // --- Data Normalization Helper (Local & Worker compatibility) ---
  const normalizeRoom = (room) => {
    if (!room) return null;
    const rawOccupied = Boolean(room.isOccupied ?? room.is_occupied);
    const booking = room.currentBooking ?? room.current_booking ?? null;

    // Defensive check: If booking is cancelled or no booking exists, it is vacant
    const isCancelled = booking && (booking.payment_status === 'cancelled' || booking.checkin_status === 'cancelled');
    const isOccupied = rawOccupied && Boolean(booking) && !isCancelled;
    const safeBooking = isOccupied ? booking : null;

    let statusKey = 'vacant';
    if (isOccupied && safeBooking) {
      const pStatus = safeBooking.payment_status;
      if (pStatus === 'paid' || pStatus === 'internal_free') {
        statusKey = 'in_use';
      } else if (['pending', 'unpaid', 'reviewing', 'rejected'].includes(pStatus)) {
        statusKey = 'booked_pending';
      } else {
        statusKey = 'in_use';
      }
    }

    return {
      ...room,
      isOccupied,
      booking: safeBooking,
      statusKey
    };
  };

  const getOperationalStatusText = (booking, statusKey) => {
    if (!booking || statusKey === 'vacant') return 'พร้อมให้บริการ';
    const pStatus = booking.payment_status;
    if (pStatus === 'reviewing') return 'รอตรวจสอบสลิป';
    if (pStatus === 'rejected') return 'รอแนบสลิปใหม่';
    if (pStatus === 'pending' || pStatus === 'unpaid') return 'รอชำระเงิน';
    if (statusKey === 'booked_pending') return 'รอชำระเงิน';
    return 'กำลังใช้งาน';
  };

  // Safe wall-clock time extractor (never shift UTC or apply tz offsets to slot hours)
  const formatSlotTime = (timeStr) => {
    if (!timeStr) return '';
    if (typeof timeStr === 'string') {
      const match = timeStr.match(/(?:T|\s)(\d{2}:\d{2})/);
      if (match) return match[1];
      const simple = timeStr.match(/^(\d{2}:\d{2})/);
      if (simple) return simple[1];
    }
    try {
      const d = new Date(timeStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      }
    } catch (e) {}
    return String(timeStr);
  };

  const STATUS_CONFIG = {
    vacant: {
      label: 'ว่าง',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.06)',
      border: '1px solid rgba(16, 185, 129, 0.35)',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
      badgeColor: '#10b981',
      dot: '#10b981',
      actionText: 'คลิกเพื่อดูปฏิทิน / จอง'
    },
    booked_pending: {
      label: 'จอง',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.06)',
      border: '1px solid rgba(245, 158, 11, 0.35)',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
      badgeColor: '#f59e0b',
      dot: '#f59e0b',
      actionText: 'รอชำระเงิน • คลิกดูรายละเอียด'
    },
    in_use: {
      label: 'ใช้งาน',
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.06)',
      border: '1px solid rgba(239, 68, 68, 0.35)',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeColor: '#ef4444',
      dot: '#ef4444',
      actionText: 'กำลังใช้งาน • คลิกดูรายละเอียด'
    }
  };

  const getJupiterRoom = () => {
    return rooms.map(normalizeRoom).find(r =>
      r && (r.name.includes('300') || r.name.toLowerCase().includes('jupiter')) &&
      !r.name.toLowerCase().includes('co-working') &&
      !r.name.toLowerCase().includes('coworking')
    );
  };

  const getCoworkingRoom = () => {
    return rooms.map(normalizeRoom).find(r =>
      r && (r.name.toLowerCase().includes('co-working') || r.name.toLowerCase().includes('coworking'))
    );
  };

  const getRoomByNumber = (numStr) => {
    return rooms.map(normalizeRoom).find(r => r && r.name.includes(numStr));
  };

  const handleSlotClick = (normRoom) => {
    if (!normRoom) return;
    if (normRoom.isOccupied && normRoom.booking) {
      handleViewBookingDetails(normRoom.booking.booking_id, normRoom.id);
    } else {
      handleRoomCardClick(normRoom);
    }
  };

  const renderRoomSlot = (numberStr) => {
    const normRoom = getRoomByNumber(numberStr);
    if (!normRoom) {
      return (
        <div style={{
          minHeight: '136px',
          borderRadius: '16px',
          border: '1px dashed var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.45,
          backgroundColor: 'rgba(255, 255, 255, 0.01)'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>ห้อง {numberStr}</span>
        </div>
      );
    }

    const cfg = STATUS_CONFIG[normRoom.statusKey] || STATUS_CONFIG.vacant;
    const booking = normRoom.booking;
    const hasSlotTimes = booking && (booking.start_time || booking.end_time);

    return (
      <div
        onClick={() => handleSlotClick(normRoom)}
        className="room-layout-box"
        style={{
          minHeight: '132px',
          borderRadius: '16px',
          border: cfg.border,
          backgroundColor: cfg.bg,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: 'hidden'
        }}
        title={`${normRoom.name} - ${cfg.actionText}`}
      >
        {/* Top: Room Name & Status Badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '0.975rem',
              fontWeight: 800,
              color: 'var(--text-main)',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {normRoom.name.replace(/^ห้องประชุม\s*/, '')}
            </div>
            <div style={{
              fontSize: '0.725rem',
              color: 'var(--text-muted)',
              marginTop: '3px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <Users size={12} style={{ opacity: 0.7 }} />
              <span>ความจุ {normRoom.capacity} คน</span>
            </div>
          </div>

          {/* Status Badge */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            borderRadius: '99px',
            fontSize: '0.725rem',
            fontWeight: 700,
            backgroundColor: cfg.badgeBg,
            color: cfg.badgeColor,
            flexShrink: 0
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: cfg.dot
            }}></span>
            <span>{cfg.label}</span>
          </span>
        </div>

        {/* Bottom: Timing line or Available indicator */}
        <div style={{
          marginTop: '10px',
          paddingTop: '8px',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.775rem'
        }}>
          {normRoom.isOccupied && booking ? (
            <div style={{ minWidth: 0, width: '100%' }}>
              <div style={{
                color: cfg.badgeColor,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <Clock size={12} />
                <span>
                  {hasSlotTimes
                    ? `${formatSlotTime(booking.start_time)} - ${formatSlotTime(booking.end_time)} น.`
                    : getOperationalStatusText(booking, normRoom.statusKey)}
                </span>
              </div>
              <div style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                marginTop: '2px'
              }}>
                {normRoom.statusKey === 'booked_pending'
                  ? getOperationalStatusText(booking, normRoom.statusKey)
                  : (hasSlotTimes ? `ถึง ${formatSlotTime(booking.end_time)} น.` : 'กำลังใช้งาน')}
              </div>
            </div>
          ) : (
            <div style={{
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%'
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981', fontWeight: 600 }}>
                <CheckCircle size={12} />
                <span>พร้อมให้บริการ</span>
              </span>
              <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>
                ฿{normRoom.hourly_rate}/ชม.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderJupiterSlot = () => {
    const normRoom = getJupiterRoom();
    if (!normRoom) {
      return (
        <div style={{
          height: '100%',
          minHeight: '276px',
          borderRadius: '20px',
          border: '1px dashed var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.45
        }}>
          <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>ห้องประชุม Jupiter (300)</span>
        </div>
      );
    }

    const cfg = STATUS_CONFIG[normRoom.statusKey] || STATUS_CONFIG.vacant;
    const booking = normRoom.booking;
    const hasSlotTimes = booking && (booking.start_time || booking.end_time);

    return (
      <div
        onClick={() => handleSlotClick(normRoom)}
        className="room-layout-box"
        style={{
          height: '100%',
          minHeight: '276px',
          borderRadius: '20px',
          border: cfg.border,
          backgroundColor: cfg.bg,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative'
        }}
        title={`${normRoom.name} - ${cfg.actionText}`}
      >
        {/* Header inside Card */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: 'var(--primary-color)',
                textTransform: 'uppercase'
              }}>
                ห้องประชุมใหญ่
              </div>
              <h3 style={{
                fontSize: '1.35rem',
                fontWeight: 900,
                color: 'var(--text-main)',
                margin: '4px 0 0 0',
                lineHeight: 1.2
              }}>
                {normRoom.name}
              </h3>
            </div>

            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '99px',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: cfg.badgeBg,
              color: cfg.badgeColor
            }}>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: cfg.dot
              }}></span>
              <span>{cfg.label}</span>
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginTop: '10px',
            fontSize: '0.825rem',
            color: 'var(--text-muted)'
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Users size={14} style={{ opacity: 0.7 }} />
              <span>ความจุ {normRoom.capacity} คน</span>
            </span>
            <span>•</span>
            <span>฿{normRoom.hourly_rate}/ชม.</span>
          </div>
        </div>

        {/* Operational / Timing Status Center & Bottom */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '14px',
          padding: '14px 16px',
          marginTop: '16px'
        }}>
          {normRoom.isOccupied && booking ? (
            <div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                ช่วงเวลาการใช้งานปัจจุบัน
              </div>
              <div style={{
                color: cfg.badgeColor,
                fontWeight: 800,
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Clock size={15} />
                <span>
                  {hasSlotTimes
                    ? `${formatSlotTime(booking.start_time)} - ${formatSlotTime(booking.end_time)} น.`
                    : getOperationalStatusText(booking, normRoom.statusKey)}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: cfg.badgeColor, fontWeight: 600, marginTop: '6px' }}>
                {normRoom.statusKey === 'booked_pending'
                  ? getOperationalStatusText(booking, normRoom.statusKey)
                  : (hasSlotTimes ? `ถึง ${formatSlotTime(booking.end_time)} น.` : 'กำลังใช้งาน')}
              </div>
            </div>
          ) : (
            <div>
              <div style={{
                color: '#10b981',
                fontWeight: 700,
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <CheckCircle size={16} />
                <span>พร้อมให้บริการทันที</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                คลิกเพื่อดูตารางคิวจองรายวัน หรือสร้างการจองใหม่
              </div>
            </div>
          )}
        </div>

        {/* Action cue footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '12px',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <span>{cfg.actionText}</span>
          <Calendar size={13} style={{ opacity: 0.6 }} />
        </div>
      </div>
    );
  };

  const renderCoworkingSlot = () => {
    const normRoom = getCoworkingRoom();
    if (!normRoom) {
      return (
        <div style={{
          height: '100%',
          minHeight: '276px',
          borderRadius: '20px',
          border: '1px dashed var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.45
        }}>
          <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>โซน Co-working</span>
        </div>
      );
    }

    const cfg = STATUS_CONFIG[normRoom.statusKey] || STATUS_CONFIG.vacant;
    const booking = normRoom.booking;
    const hasSlotTimes = booking && (booking.start_time || booking.end_time);

    return (
      <div
        onClick={() => handleSlotClick(normRoom)}
        className="room-layout-box"
        style={{
          height: '100%',
          minHeight: '276px',
          borderRadius: '20px',
          border: cfg.border,
          backgroundColor: cfg.bg,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative'
        }}
        title={`${normRoom.name} - ${cfg.actionText}`}
      >
        {/* Header inside Card */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: 'var(--primary-color)',
                textTransform: 'uppercase'
              }}>
                พื้นที่ทำงานร่วม
              </div>
              <h3 style={{
                fontSize: '1.25rem',
                fontWeight: 900,
                color: 'var(--text-main)',
                margin: '4px 0 0 0',
                lineHeight: 1.25
              }}>
                {normRoom.name}
              </h3>
            </div>

            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '99px',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: cfg.badgeBg,
              color: cfg.badgeColor
            }}>
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: cfg.dot
              }}></span>
              <span>{cfg.label}</span>
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginTop: '10px',
            fontSize: '0.825rem',
            color: 'var(--text-muted)'
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Users size={14} style={{ opacity: 0.7 }} />
              <span>ความจุ {normRoom.capacity} คน</span>
            </span>
            <span>•</span>
            <span>฿{normRoom.hourly_rate}/ชม.</span>
          </div>
        </div>

        {/* Operational / Timing Status Center & Bottom */}
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: '14px',
          padding: '14px 16px',
          marginTop: '16px'
        }}>
          {normRoom.isOccupied && booking ? (
            <div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                ช่วงเวลาการใช้งานปัจจุบัน
              </div>
              <div style={{
                color: cfg.badgeColor,
                fontWeight: 800,
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Clock size={15} />
                <span>
                  {hasSlotTimes
                    ? `${formatSlotTime(booking.start_time)} - ${formatSlotTime(booking.end_time)} น.`
                    : getOperationalStatusText(booking, normRoom.statusKey)}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: cfg.badgeColor, fontWeight: 600, marginTop: '6px' }}>
                {normRoom.statusKey === 'booked_pending'
                  ? getOperationalStatusText(booking, normRoom.statusKey)
                  : (hasSlotTimes ? `ถึง ${formatSlotTime(booking.end_time)} น.` : 'กำลังใช้งาน')}
              </div>
            </div>
          ) : (
            <div>
              <div style={{
                color: '#10b981',
                fontWeight: 700,
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <CheckCircle size={16} />
                <span>พร้อมให้บริการทันที</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                คลิกเพื่อดูตารางคิวจองรายวัน หรือสร้างการจองใหม่
              </div>
            </div>
          )}
        </div>

        {/* Action cue footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '12px',
          fontSize: '0.75rem',
          color: 'var(--text-muted)'
        }}>
          <span>{cfg.actionText}</span>
          <Calendar size={13} style={{ opacity: 0.6 }} />
        </div>
      </div>
    );
  };

  // Status counters calculation
  const normalizedRooms = rooms.map(normalizeRoom).filter(Boolean);
  const statusCounts = {
    vacant: normalizedRooms.filter(r => r.statusKey === 'vacant').length,
    booked_pending: normalizedRooms.filter(r => r.statusKey === 'booked_pending').length,
    in_use: normalizedRooms.filter(r => r.statusKey === 'in_use').length
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header & Integrated Operational Bar */}
      <div className="tab-header" style={{
        margin: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '14px'
      }}>
        <div>
          <h1 className="tab-title" style={{ fontSize: '1.4rem', fontWeight: 850, margin: 0 }}>
            แผนผังสถานะห้องประชุม
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.825rem', marginTop: '3px', marginBottom: 0 }}>
            กระดานตรวจสถานะห้องแบบเรียลไทม์ (ทั้งหมด {rooms.length} ห้อง/โซน)
          </p>
        </div>

        {/* Live Counters & Controls in header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Integrated Status Counters (acts as legend) */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 8px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            fontSize: '0.8rem'
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 8px',
              borderRadius: '8px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              color: '#10b981',
              fontWeight: 700
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
              <span>ว่าง {statusCounts.vacant}</span>
            </div>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 8px',
              borderRadius: '8px',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              color: '#f59e0b',
              fontWeight: 700
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#f59e0b' }}></span>
              <span>จอง {statusCounts.booked_pending}</span>
            </div>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '4px 8px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              fontWeight: 700
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#ef4444' }}></span>
              <span>ใช้งาน {statusCounts.in_use}</span>
            </div>
          </div>

          {/* Live Clock */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            padding: '6px 12px',
            borderRadius: '12px',
            color: 'var(--text-main)',
            fontWeight: 600,
            fontSize: '0.825rem'
          }}>
            <Clock size={13} style={{ color: 'var(--primary-color)' }} />
            <span>{currentTime.toLocaleTimeString('th-TH')} น.</span>
          </div>

          {/* Refresh button */}
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 12px', borderRadius: '12px', fontSize: '0.825rem', gap: '6px', height: '34px' }}
            onClick={fetchOccupancy}
            disabled={loading}
            title="รีเฟรชข้อมูลสถานะห้อง"
          >
            <RefreshCw size={13} className={loading ? 'spin-anim' : ''} />
            <span>รีเฟรช</span>
          </button>
        </div>
      </div>

      {/* 2. Architectural Floor Plan Layout Board */}
      {loading && rooms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังเปิดแผนผังห้อง...</span>
        </div>
      ) : (
        <div className="layout-board-container" style={{
          overflowX: 'auto',
          padding: '16px 20px',
          backgroundColor: 'var(--bg-card)',
          borderRadius: '20px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            display: 'flex',
            gap: '14px',
            minWidth: '960px',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            width: '100%'
          }}>
            {/* 1. Left Section: ห้องประชุม Jupiter (300) */}
            <div style={{
              flex: '1.05',
              minWidth: '220px',
              border: '1px solid var(--border-color)',
              borderRadius: '18px',
              padding: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.01)',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-10px',
                left: '16px',
                backgroundColor: 'var(--bg-card)',
                padding: '0 8px',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontWeight: 700,
                borderRadius: '4px'
              }}>
                ห้องประชุม Jupiter (300)
              </div>
              {renderJupiterSlot()}
            </div>

            {/* 2. Center Section: Rooms 301 - 306 (3x2 Grid) */}
            <div style={{
              flex: '2.6',
              minWidth: '500px',
              border: '1px solid var(--border-color)',
              borderRadius: '18px',
              padding: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.01)',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-10px',
                left: '16px',
                backgroundColor: 'var(--bg-card)',
                padding: '0 8px',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontWeight: 700,
                borderRadius: '4px'
              }}>
                โซนห้องประชุมย่อย (Rooms 301 - 306)
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                height: '100%'
              }}>
                {/* Row 1 */}
                {renderRoomSlot('301')}
                {renderRoomSlot('302')}
                {renderRoomSlot('303')}

                {/* Row 2 */}
                {renderRoomSlot('304')}
                {renderRoomSlot('305')}
                {renderRoomSlot('306')}
              </div>
            </div>

            {/* 3. Right Section: Co-working Space Zone */}
            <div style={{
              flex: '1.05',
              minWidth: '220px',
              border: '1px solid var(--border-color)',
              borderRadius: '18px',
              padding: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.01)',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-10px',
                left: '16px',
                backgroundColor: 'var(--bg-card)',
                padding: '0 8px',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontWeight: 700,
                borderRadius: '4px'
              }}>
                โซน Co-working
              </div>
              {renderCoworkingSlot()}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/*  INTERACTIVE ROOM CALENDAR & BOOKINGS HISTORY MODAL       */}
      {/* ========================================================= */}
      {activeRoomDetail && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '720px',
            padding: '24px',
            boxShadow: '0 24px 70px rgba(0,0,0,0.4)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative',
            borderRadius: '24px'
          }}>
            {/* Close button */}
            <button
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setActiveRoomDetail(null)}
            >
              <X size={20} />
            </button>

            {/* Room Title */}
            <div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 850, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                ตารางการใช้งาน: {activeRoomDetail.name}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                ความจุ {activeRoomDetail.capacity} คน | อัตราค่าบริการ {activeRoomDetail.hourly_rate} บาท/ชั่วโมง
              </p>
            </div>

            {/* Side-by-side Layout (Selected Day schedule left, Calendar right) */}
            <div className="grid-cols-2" style={{ gap: '20px', marginTop: '8px' }}>

              {/* Left Column: Selected Date Schedule & Action */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderRight: '1px solid var(--border-color)', paddingRight: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    คิววันที่: {(() => {
                      const parts = selectedDate.split('-');
                      return `${parts[2]}/${parts[1]}/${parseInt(parts[0], 10) + 543}`;
                    })()}
                  </span>

                  {/* Vacant Badge */}
                  <span style={{
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '99px',
                    fontWeight: 'bold',
                    backgroundColor: roomBookings.some(b => getLocalDateStr(b.start_time) === selectedDate) ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                    color: roomBookings.some(b => getLocalDateStr(b.start_time) === selectedDate) ? 'var(--danger-color)' : 'var(--success-color)'
                  }}>
                    {roomBookings.some(b => getLocalDateStr(b.start_time) === selectedDate) ? 'มีคิวจอง' : 'ว่างไม่มีคิว'}
                  </span>
                </div>

                {/* Bookings List for Selected Date */}
                <div style={{
                  flex: 1,
                  maxHeight: '220px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  paddingRight: '4px'
                }}>
                  {(() => {
                    const dayBookings = roomBookings.filter(b => {
                      try {
                        const localDate = getLocalDateStr(b.start_time);
                        return localDate === selectedDate;
                      } catch (e) {
                        return false;
                      }
                    }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

                    if (dayBookings.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '32px 10px', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
                           ไม่มีรายการจองใช้งานในวันนี้
                        </div>
                      );
                    }

                    return dayBookings.map((b, idx) => {
                      const sTime = new Date(b.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                      const eTime = new Date(b.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

                      return (
                        <div key={idx}
                          onClick={() => handleViewBookingDetails(b.booking_id, activeRoomDetail.id)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '12px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'rgba(255, 255, 255, 0.015)',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.015)';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold', marginBottom: '4px' }}>
                            <span>{sTime} - {eTime} น.</span>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <span style={{
                                fontSize: '0.675rem',
                                padding: '2px 6px',
                                borderRadius: '6px',
                                backgroundColor: b.booking_source === 'online' ? 'rgba(14, 165, 233, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                color: b.booking_source === 'online' ? '#0ea5e9' : '#10b981',
                                fontWeight: 700
                              }}>
                                {b.booking_source === 'online' ? '🌐 ออนไลน์' : '🏬 Walk-in'}
                              </span>
                              <span style={{
                                color: b.payment_status === 'paid' ? 'var(--success-color)' : '#f59e0b',
                                fontSize: '0.725rem'
                              }}>
                                {b.payment_status === 'paid' ? '● ชำระแล้ว' : '● ค้างชำระ'}
                              </span>
                            </div>
                          </div>
                          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>คุณ {b.customer_name}</div>
                          {b.contact && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}> เบอร์ติดต่อ: {b.contact}</div>}
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Quick Booking Button */}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '10px', borderRadius: '12px', gap: '6px' }}
                  onClick={() => {
                    setActiveRoomDetail(null);
                    onNavigateToBook(activeRoomDetail);
                  }}
                >
                  <Plus size={16} />
                  จองห้องนี้
                </button>
              </div>

              {/* Right Column: Month Calendar view */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Month/Year selector */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '4px 6px',
                    backgroundColor: 'var(--bg-color)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <button
                      type="button"
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.1)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      onClick={() => {
                        if (calendarMonth === 0) {
                          setCalendarMonth(11);
                          setCalendarYear(calendarYear - 1);
                        } else {
                          setCalendarMonth(calendarMonth - 1);
                        }
                      }}
                      title="เดือนก่อนหน้า"
                    >
                      <ChevronLeft size={16} style={{ color: 'var(--primary-color)' }} />
                    </button>
                    <span style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][calendarMonth]} {calendarYear + 543}
                    </span>
                    <button
                      type="button"
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(37, 99, 235, 0.1)'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      onClick={() => {
                        if (calendarMonth === 11) {
                          setCalendarMonth(0);
                          setCalendarYear(calendarYear + 1);
                        } else {
                          setCalendarMonth(calendarMonth + 1);
                        }
                      }}
                      title="เดือนถัดไป"
                    >
                      <ChevronRight size={16} style={{ color: 'var(--primary-color)' }} />
                    </button>
                  </div>

                {/* Days Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* Week Labels */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                    {["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map(name => <div key={name}>{name}</div>)}
                  </div>

                  {/* Calendar Grid Numbers */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', justifyItems: 'center' }}>
                    {(() => {
                      const daysInMonth = getDaysInMonth(calendarMonth, calendarYear);
                      const firstDay = getFirstDayOfMonth(calendarMonth, calendarYear);
                      const grid = [];

                      // Empty padding for first day of month
                      for (let i = 0; i < firstDay; i++) {
                        grid.push(<div key={`pad-${i}`} style={{ width: '32px', height: '32px' }}></div>);
                      }

                      // Fill days
                      for (let day = 1; day <= daysInMonth; day++) {
                        const targetStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const isSelected = selectedDate === targetStr;

                        // Check booking status for this specific calendar day
                        const dayBks = roomBookings.filter(b => {
                          try {
                            return getLocalDateStr(b.start_time) === targetStr;
                          } catch (e) {
                            return false;
                          }
                        });

                        const hasBooking = dayBks.length > 0;
                        const hasPending = dayBks.some(b => b.payment_status === 'pending');
                        const hasPaid = dayBks.some(b => b.payment_status === 'paid');

                        let dotColor = 'transparent';
                        if (hasBooking) {
                          if (hasPending) dotColor = '#f59e0b'; // Yellow for unpaid booking
                          else dotColor = 'var(--success-color)'; // Green for fully paid booking
                        }

                        grid.push(
                          <button
                            key={`cal-day-${day}`}
                            type="button"
                            onClick={() => setSelectedDate(targetStr)}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '10px',
                              border: isSelected ? '2px solid var(--primary-color)' : 'none',
                              backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                              color: isSelected ? 'var(--primary-color)' : 'var(--text-main)',
                              fontSize: '0.8rem',
                              fontWeight: isSelected ? 'bold' : 'normal',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              position: 'relative'
                            }}
                          >
                            <span>{day}</span>

                            {/* Small status dot inside cell */}
                            {hasBooking && (
                              <div style={{
                                width: '4px',
                                height: '4px',
                                borderRadius: '50%',
                                backgroundColor: dotColor,
                                position: 'absolute',
                                bottom: '2px'
                              }}></div>
                            )}
                          </button>
                        );
                      }
                      return grid;
                    })()}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
      {/* Liquidglass Booking Details Modal */}
      {viewedEvent && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          zIndex: 10100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '95%',
            maxWidth: '460px',
            padding: '28px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            border: '1px solid var(--glass-border)',
            position: 'relative',
            borderRadius: '24px',
            backgroundColor: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            {/* Close button */}
            <button
              type="button"
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setViewedEvent(null)}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingRight: '28px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary-color)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  รายละเอียดการจองประจำวัน
                </div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                  {viewedEvent.room_name}
                </h2>
              </div>

              {/* Top Right Booking Source Badge */}
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 12px',
                borderRadius: '99px',
                fontSize: '0.75rem',
                fontWeight: 700,
                backgroundColor: viewedEvent.booking_source === 'online' ? 'rgba(14, 165, 233, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: viewedEvent.booking_source === 'online' ? '#0ea5e9' : '#10b981',
                border: `1px solid ${viewedEvent.booking_source === 'online' ? 'rgba(14, 165, 233, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
              }}>
                {viewedEvent.booking_source === 'online' ? '🌐 จองออนไลน์' : '🏬 Walk-in'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Event Info Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '16px',
                fontSize: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                color: 'var(--text-main)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><strong>ผู้จอง:</strong> {viewedEvent.customer_name}</div>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: '99px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    backgroundColor: viewedEvent.booking_source === 'online' ? 'rgba(14, 165, 233, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                    color: viewedEvent.booking_source === 'online' ? '#0ea5e9' : '#10b981',
                    border: `1px solid ${viewedEvent.booking_source === 'online' ? 'rgba(14, 165, 233, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                  }}>
                    {viewedEvent.booking_source === 'online' ? '🌐 จองออนไลน์' : '🏬 Walk-in'}
                  </span>
                </div>
                <div><strong>ช่องทางการจอง:</strong> {viewedEvent.booking_source === 'online' ? '🌐 จองออนไลน์ผ่านเว็บ' : '🏬 Walk-in'}</div>
                <div><strong>จำนวนผู้เข้าใช้:</strong> {viewedEvent.guest_count || viewedEvent.item_guest_count ? `${viewedEvent.guest_count || viewedEvent.item_guest_count} ท่าน` : 'ไม่ระบุ'}</div>
                <div><strong>วันที่จอง:</strong> {(() => {
                  const d = new Date(viewedEvent.start_time);
                  return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear() + 543}`;
                })()}</div>
                <div><strong>เวลาจอง:</strong> {new Date(viewedEvent.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} - {new Date(viewedEvent.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>
                <div><strong>รูปแบบการจอง:</strong> {
                  viewedEvent.booking_type === 'daily' ? 'รายวัน (ทั้งวัน)' :
                  viewedEvent.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง'
                }</div>
                <div><strong>ระยะเวลาใช้งาน:</strong> {(() => {
                  const start = new Date(viewedEvent.start_time);
                  const end = new Date(viewedEvent.end_time);
                  const diffMs = end - start;
                  const diffHrs = diffMs / (1000 * 60 * 60);
                  const hoursRounded = Math.ceil(diffHrs);

                  if (viewedEvent.booking_type === 'daily') {
                    return '1 วัน (9 ชั่วโมง)';
                  } else if (viewedEvent.booking_type === 'halfday') {
                    return 'ครึ่งวัน (4 ชั่วโมง)';
                  }
                  return `${hoursRounded} ชั่วโมง`;
                })()}</div>
                <div><strong>รูปแบบการจัดห้อง:</strong> {viewedEvent.layout === 'classroom' ? 'Classroom (CR)' : 'Standard (Std)'}</div>
              </div>

              {/* Price Details */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '12px',
                marginTop: '4px'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    หมายเลขอ้างอิงใบเสร็จ: #{viewedEvent.booking_id}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      padding: '2px 8px',
                      borderRadius: '99px',
                      backgroundColor: viewedEvent.booking_source === 'online' ? 'rgba(14, 165, 233, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: viewedEvent.booking_source === 'online' ? '#0ea5e9' : '#10b981',
                      border: `1px solid ${viewedEvent.booking_source === 'online' ? 'rgba(14, 165, 233, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                    }}>
                      {viewedEvent.booking_source === 'online' ? '🌐 จองออนไลน์' : '🏬 Walk-in'}
                    </span>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 'bold',
                      padding: '2px 8px',
                      borderRadius: '99px',
                      backgroundColor: viewedEvent.payment_status === 'paid' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                      color: viewedEvent.payment_status === 'paid' ? 'var(--success-color)' : 'var(--warning-color)',
                      border: `1px solid ${viewedEvent.payment_status === 'paid' ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`
                    }}>
                      {viewedEvent.payment_status === 'paid' ? 'จ่ายแล้ว' : 'ค้างชำระ'}
                    </span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ราคาสุทธิเฉพาะห้องนี้</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-main)' }}>
                    {Number(viewedEvent.subtotal).toLocaleString()}.-
                  </div>
                </div>
              </div>

            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', height: '44px', borderRadius: '14px', marginTop: '8px' }}
              onClick={() => setViewedEvent(null)}
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoomLayout;
