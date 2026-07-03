import React, { useState, useEffect } from 'react';
import { Clock, CheckCircle, AlertCircle, Users, DollarSign, Calendar, RefreshCw, X, Plus } from 'lucide-react';

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

  const getRoomByName = (numberStr) => {
    return rooms.find(r => r.name.includes(numberStr));
  };

  const renderRoomSlot = (numberStr) => {
    const room = getRoomByName(numberStr);
    if (!room) {
      return (
        <div style={{
          height: '110px',
          borderRadius: '16px',
          border: '1px dashed var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.5
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ห้อง {numberStr}</span>
        </div>
      );
    }

    // 3 Status color configuration
    let cardBorder = '2px solid var(--success-color)';
    let cardBg = 'rgba(34, 197, 94, 0.08)';
    let cardShadow = '0 6px 16px rgba(34, 197, 94, 0.05)';
    let cardDot = 'var(--success-color)';
    let statusText = 'ว่าง';
    let statusColor = 'var(--success-color)';

    if (room.isOccupied && room.currentBooking) {
      if (room.currentBooking.payment_status === 'pending') {
        // Yellow for Pending (จอง)
        cardBorder = '2px solid #f59e0b';
        cardBg = 'rgba(245, 158, 11, 0.08)';
        cardShadow = '0 6px 16px rgba(245, 158, 11, 0.05)';
        cardDot = '#f59e0b';
        statusText = 'จอง';
        statusColor = '#f59e0b';
      } else {
        // Red for Paid (ห้องถูกใช้งาน)
        cardBorder = '2px solid var(--danger-color)';
        cardBg = 'rgba(239, 68, 68, 0.08)';
        cardShadow = '0 6px 16px rgba(239, 68, 68, 0.05)';
        cardDot = 'var(--danger-color)';
        statusText = 'ห้องถูกใช้งาน';
        statusColor = 'var(--danger-color)';
      }
    }

    return (
      <div 
        onClick={() => handleRoomCardClick(room)}
        style={{
          height: '110px',
          borderRadius: '16px',
          border: cardBorder,
          backgroundColor: cardBg,
          boxShadow: cardShadow,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative'
        }}
        className="room-layout-box"
      >
        {/* Room Number */}
        <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-main)', lineHeight: 1 }}>
          ห้อง {numberStr}
        </span>

        {/* Room Status Text */}
        <span style={{ fontSize: '0.75rem', color: statusColor, marginTop: '8px', fontWeight: 750 }}>
          {statusText}
        </span>

        {/* Status Dot */}
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: cardDot,
          boxShadow: `0 0 6px ${cardDot}`
        }}></div>
      </div>
    );
  };

  const renderJupiterSlot = () => {
    const room = getRoomByName('300');
    if (!room) {
      return (
        <div style={{
          width: '100%',
          height: '236px',
          borderRadius: '20px',
          border: '1px dashed var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.5
        }}>
          <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>ห้องประชุม Jupiter (300)</span>
        </div>
      );
    }

    // 3 Status color configuration
    let cardBorder = '2px solid var(--success-color)';
    let cardBg = 'rgba(34, 197, 94, 0.08)';
    let cardShadow = '0 8px 24px rgba(34, 197, 94, 0.08)';
    let cardDot = 'var(--success-color)';
    let statusText = 'ว่าง';
    let statusColor = 'var(--success-color)';

    if (room.isOccupied && room.currentBooking) {
      if (room.currentBooking.payment_status === 'pending') {
        cardBorder = '2px solid #f59e0b';
        cardBg = 'rgba(245, 158, 11, 0.08)';
        cardShadow = '0 8px 24px rgba(245, 158, 11, 0.08)';
        cardDot = '#f59e0b';
        statusText = 'จอง';
        statusColor = '#f59e0b';
      } else {
        cardBorder = '2px solid var(--danger-color)';
        cardBg = 'rgba(239, 68, 68, 0.08)';
        cardShadow = '0 8px 24px rgba(239, 68, 68, 0.08)';
        cardDot = 'var(--danger-color)';
        statusText = 'ห้องถูกใช้งาน';
        statusColor = 'var(--danger-color)';
      }
    }

    return (
      <div 
        onClick={() => handleRoomCardClick(room)}
        style={{
          width: '100%',
          height: '236px',
          borderRadius: '20px',
          border: cardBorder,
          backgroundColor: cardBg,
          boxShadow: cardShadow,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative'
        }}
        className="room-layout-box"
      >
        <span style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-main)', textAlign: 'center' }}>
          {room.name}
        </span>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          ความจุ {room.capacity} คน
        </span>
        <span style={{ fontSize: '0.85rem', color: statusColor, marginTop: '12px', fontWeight: 750 }}>
          {statusText}
        </span>
        <div style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: cardDot,
          boxShadow: `0 0 8px ${cardDot}`
        }}></div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header and Control Bar */}
      <div className="tab-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', borderBottom: 'none', paddingBottom: 0 }}>
        <div>
          <h1 className="tab-title">แผนผังสถานะห้องประชุม</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>แสดงผังห้องประชุมจำลองแบบเรียลไทม์ และนำทางจองได้ทันที</p>
        </div>

        {/* Live Clock & Refresh controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            backgroundColor: 'rgba(56, 189, 248, 0.08)', 
            border: '1px solid rgba(56, 189, 248, 0.15)',
            padding: '8px 16px', 
            borderRadius: '99px',
            color: 'var(--primary-color)',
            fontWeight: 'bold',
            fontSize: '0.85rem',
            boxShadow: '0 4px 12px rgba(56,189,248,0.05)'
          }}>
            <Clock size={14} />
            <span>เวลาปัจจุบัน: {currentTime.toLocaleTimeString('th-TH')} น.</span>
          </div>

          <button 
            className="btn btn-secondary" 
            style={{ padding: '8px 14px', borderRadius: '99px', fontSize: '0.85rem', gap: '6px' }}
            onClick={fetchOccupancy}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
            <span>รีเฟรช</span>
          </button>
        </div>
      </div>

      {/* Legends Row (Matching Reference Image with 3 status colors) */}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', paddingLeft: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: '2px solid var(--success-color)', backgroundColor: 'rgba(34, 197, 94, 0.1)' }}></div>
          <span>ว่าง</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: '2px solid #f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}></div>
          <span>จอง (ยังไม่ชำระเงิน)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: '2px solid var(--danger-color)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}></div>
          <span>ห้องถูกใช้งาน (ชำระเงินแล้ว)</span>
        </div>
      </div>

      {loading && rooms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังเปิดแผนผังห้อง...</span>
        </div>
      ) : (
        /* Architectural Floor Plan Layout Board (Matching Reference Blueprint Image but updated) */
        <div className="layout-board-container" style={{ overflowX: 'auto', padding: '24px' }}>
          <div style={{ 
            display: 'flex', 
            gap: '24px', 
            minWidth: '780px',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            width: '100%'
          }}>
            {/* 1. Left Section: ห้องประชุม Jupiter (300) */}
            <div style={{
              flex: '1',
              border: '2px solid var(--border-color)',
              borderRadius: '20px',
              padding: '20px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minHeight: '260px',
              position: 'relative'
            }}>
              <div style={{ position: 'absolute', top: '-10px', left: '16px', backgroundColor: 'var(--bg-card)', padding: '0 8px', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                ห้องประชุม Jupiter (300)
              </div>
              {renderJupiterSlot()}
            </div>

            {/* 2. Right Section: Meeting Rooms 2x3 Grid (301-306) */}
            <div style={{
              flex: '2.2',
              border: '2px solid var(--border-color)',
              borderRadius: '20px',
              padding: '20px',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              minHeight: '260px',
              position: 'relative'
            }}>
              <div style={{ position: 'absolute', top: '-10px', left: '16px', backgroundColor: 'var(--bg-card)', padding: '0 8px', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>
                โซนห้องประชุม (Rooms 301 - 306)
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
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
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 🔮 INTERACTIVE ROOM CALENDAR & BOOKINGS HISTORY MODAL       */}
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
                🗓️ ตารางการใช้งาน: {activeRoomDetail.name}
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
                    backgroundColor: roomBookings.some(b => new Date(b.start_time).toLocaleDateString('en-CA') === selectedDate) ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                    color: roomBookings.some(b => new Date(b.start_time).toLocaleDateString('en-CA') === selectedDate) ? 'var(--danger-color)' : 'var(--success-color)'
                  }}>
                    {roomBookings.some(b => new Date(b.start_time).toLocaleDateString('en-CA') === selectedDate) ? 'มีคิวจอง' : 'ว่างไม่มีคิว'}
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
                        const localDate = new Date(b.start_time).toLocaleDateString('en-CA');
                        return localDate === selectedDate;
                      } catch (e) {
                        return false;
                      }
                    }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

                    if (dayBookings.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '32px 10px', color: 'var(--text-muted)', fontSize: '0.85rem', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
                          🍃 ไม่มีรายการจองใช้งานในวันนี้
                        </div>
                      );
                    }

                    return dayBookings.map((b, idx) => {
                      const sTime = new Date(b.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                      const eTime = new Date(b.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                      
                      return (
                        <div key={idx} style={{ 
                          padding: '10px 12px', 
                          borderRadius: '12px', 
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-color)',
                          fontSize: '0.85rem'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', marginBottom: '4px' }}>
                            <span>🕒 {sTime} - {eTime} น.</span>
                            <span style={{ 
                              color: b.payment_status === 'paid' ? 'var(--success-color)' : '#f59e0b',
                              fontSize: '0.75rem'
                            }}>
                              {b.payment_status === 'paid' ? '● ชำระแล้ว' : '● ค้างชำระ'}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>คุณ {b.customer_name}</div>
                          {b.contact && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>📞 เบอร์ติดต่อ: {b.contact}</div>}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ padding: '4px 8px', minWidth: 'auto', borderRadius: '8px' }}
                    onClick={() => {
                      if (calendarMonth === 0) {
                        setCalendarMonth(11);
                        setCalendarYear(calendarYear - 1);
                      } else {
                        setCalendarMonth(calendarMonth - 1);
                      }
                    }}
                  >
                    ◀
                  </button>
                  <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
                    {["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][calendarMonth]} {calendarYear + 543}
                  </span>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ padding: '4px 8px', minWidth: 'auto', borderRadius: '8px' }}
                    onClick={() => {
                      if (calendarMonth === 11) {
                        setCalendarMonth(0);
                        setCalendarYear(calendarYear + 1);
                      } else {
                        setCalendarMonth(calendarMonth + 1);
                      }
                    }}
                  >
                    ▶
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
                            return new Date(b.start_time).toLocaleDateString('en-CA') === targetStr;
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
    </div>
  );
}

export default RoomLayout;
