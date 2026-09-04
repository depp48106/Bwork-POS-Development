import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Calendar, Clock, MapPin } from 'lucide-react';

function CustomDatePicker({ value, onChange, placeholder = 'เลือกวันที่', className, style, showHistory = false, align = 'left', selectedDate, onChangeDate, minDate }) {
  const actualValue = value !== undefined ? value : selectedDate;
  const actualOnChange = onChange || onChangeDate || (() => {});
  // value represents 'YYYY-MM-DD'
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredDay, setHoveredDay] = useState(null);
  const [dailyBookings, setDailyBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const containerRef = useRef(null);

  // Date parsing
  const dateObj = actualValue ? new Date(actualValue) : new Date();
  const [currentYear, setCurrentYear] = useState(isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(isNaN(dateObj.getTime()) ? new Date().getMonth() : dateObj.getMonth()); // 0-11

  useEffect(() => {
    if (actualValue) {
      const d = new Date(actualValue);
      if (!isNaN(d.getTime())) {
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
      }
    }
  }, [value]);

  const popoverRef = useRef(null);

  // Close calendar popover on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target) &&
        (!popoverRef.current || !popoverRef.current.contains(event.target))
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const updatePopoverPos = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const popoverWidth = 280;
      let left = align === 'right' ? rect.right - popoverWidth : rect.left;
      if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
      }
      if (left < 12) left = 12;
      setPopoverPos({
        top: rect.bottom + 6,
        left
      });
    }
  }, [align]);

  useEffect(() => {
    if (isOpen) {
      updatePopoverPos();
      window.addEventListener('resize', updatePopoverPos);
      window.addEventListener('scroll', updatePopoverPos, true);
      return () => {
        window.removeEventListener('resize', updatePopoverPos);
        window.removeEventListener('scroll', updatePopoverPos, true);
      };
    }
  }, [isOpen, updatePopoverPos]);

  // Fetch daily bookings when value changes
  const fetchDailyBookings = useCallback(async (dateStr) => {
    if (!showHistory) return;
    if (!dateStr) { setDailyBookings([]); return; }
    setLoadingBookings(true);
    try {
      const d = new Date(dateStr);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      const res = await fetch(`/api/bookings/calendar?month=${month}&year=${year}`);
      if (res.ok) {
        const data = await res.json();
        // Filter bookings for the specific date
        const filtered = data.filter(ev => {
          if (['cancelled', 'failed'].includes(ev.payment_status) || ['cancelled', 'failed'].includes(ev.status) || ev.checkin_status === 'cancelled') return false;
          let evDate = '';
          if (typeof ev.start_time === 'string') {
            // Extract YYYY-MM-DD directly from the string to avoid timezone shifts
            if (ev.start_time.includes('T')) {
              evDate = ev.start_time.split('T')[0];
            } else if (ev.start_time.includes(' ')) {
              evDate = ev.start_time.split(' ')[0];
            } else {
              evDate = ev.start_time.substring(0, 10);
            }
          } else {
            evDate = new Date(ev.start_time).toLocaleDateString('en-CA');
          }
          return evDate === dateStr;
        });
        setDailyBookings(filtered);
      }
    } catch (err) {
      console.error('Failed to fetch daily bookings:', err);
      setDailyBookings([]);
    }
    setLoadingBookings(false);
  }, [showHistory]);

  useEffect(() => {
    if (value && showHistory) {
      fetchDailyBookings(value);
    }
  }, [value, showHistory, fetchDailyBookings]);

  const formatDateDisplay = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const yyyy = parts[0];
    const mm = parts[1];
    const dd = parts[2];
    return `${dd}/${mm}/${yyyy}`; // dd/mm/yyyy format
  };

  const getDaysInMonth = (month, year) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (month, year) => {
    return new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  };

  const handleDayClick = (day) => {
    const yyyy = currentYear;
    const mm = String(currentMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const chosenDate = `${yyyy}-${mm}-${dd}`;
    console.log('[CustomDatePicker] Date selected:', chosenDate);
    actualOnChange(chosenDate);
    setIsOpen(false);
  };

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    actualOnChange(`${yyyy}-${mm}-${dd}`);
    setIsOpen(false);
  };

  const monthNames = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);

  // Today reference
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Format time for display
  const formatTime = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  // Build calendar grid
  const daysGrid = [];
  // Previous month empty slots
  for (let i = 0; i < firstDay; i++) {
    daysGrid.push(
      <div key={`empty-${i}`} style={{ width: '100%', height: '34px' }}></div>
    );
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const formattedTarget = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isSelected = value === formattedTarget;
    const isToday = formattedTarget === todayStr;
    const isHovered = hoveredDay === day;

    daysGrid.push(
      <button
        key={`day-${day}`}
        type="button"
        onClick={() => handleDayClick(day)}
        onMouseEnter={() => setHoveredDay(day)}
        onMouseLeave={() => setHoveredDay(null)}
        style={{
          width: '100%',
          maxWidth: '34px',
          height: '34px',
          borderRadius: '8px',
          border: isSelected
            ? '2px solid var(--primary-color)'
            : isHovered
              ? '1.5px solid var(--primary-color)'
              : isToday
                ? '1.5px dashed var(--primary-color)'
                : '1px solid transparent',
          backgroundColor: isSelected
            ? 'var(--primary-color)'
            : isHovered
              ? 'var(--bg-hover)'
              : 'transparent',
          color: isSelected
            ? '#ffffff'
            : isToday
              ? 'var(--primary-color)'
              : 'var(--text-main)',
          fontSize: '0.82rem',
          fontWeight: isSelected || isToday || isHovered ? 800 : 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
          boxShadow: isSelected ? '0 3px 8px rgba(37, 99, 235, 0.3)' : 'none'
        }}
      >
        {day}
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        zIndex: isOpen ? 9999 : 1,
        ...style,
        display: 'inline-flex',
        alignItems: 'center'
      }}
      onClick={() => setIsOpen(!isOpen)}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          userSelect: 'none',
          width: '100%',
          lineHeight: 1
        }}
      >
        <Calendar size={15} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: actualValue ? 'var(--text-main)' : 'var(--text-muted)', whiteSpace: 'nowrap', lineHeight: 1 }}>
          {actualValue ? formatDateDisplay(actualValue) : placeholder}
        </span>
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          <div
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99998 }}
          />
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            className="custom-datepicker-popover"
            style={{
              position: 'fixed',
              top: `${popoverPos.top}px`,
              left: `${popoverPos.left}px`,
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px var(--border-color)',
              padding: '12px',
              zIndex: 99999,
              width: '280px',
              maxWidth: '90vw',
              boxSizing: 'border-box',
              animation: 'fadeIn 0.15s ease-out'
            }}
          >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <button
              type="button"
              onClick={prevMonth}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                padding: '6px',
                borderRadius: '8px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary-color)';
                e.currentTarget.style.color = 'var(--primary-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-main)' }}>
              {monthNames[currentMonth]} {currentYear + 543}
            </div>
            <button
              type="button"
              onClick={nextMonth}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                padding: '6px',
                borderRadius: '8px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--primary-color)';
                e.currentTarget.style.color = 'var(--primary-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Week Days Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '4px',
            textAlign: 'center',
            marginBottom: '8px',
            fontWeight: 800,
            fontSize: '0.725rem',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '6px'
          }}>
            {dayNames.map((name, idx) => (
              <div
                key={name}
                style={{
                  color: idx === 0 ? '#ef4444' : idx === 6 ? '#3b82f6' : 'var(--text-muted)'
                }}
              >
                {name}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', justifyItems: 'center', alignItems: 'center', marginBottom: '10px', width: '100%' }}>
            {daysGrid}
          </div>

          {/* Today button */}
          <button
            type="button"
            onClick={goToToday}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '10px',
              border: '1px solid var(--primary-color)',
              background: 'transparent',
              color: 'var(--primary-color)',
              fontSize: '0.78rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s',
              marginBottom: (showHistory && dailyBookings.length > 0) ? '12px' : 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--primary-color)';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--primary-color)';
            }}
          >
            📅 วันนี้
          </button>

          {/* Daily Booking History Panel */}
          {showHistory && actualValue && (
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                📋 ประวัติจองวันที่ {formatDateDisplay(value)}
              </div>

              {loadingBookings ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  กำลังโหลด...
                </div>
              ) : dailyBookings.length > 0 ? (
                <div style={{ maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {dailyBookings.map((b, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '10px',
                        background: 'var(--bg-body)',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.75rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700, color: 'var(--text-main)' }}>
                        <MapPin size={11} style={{ color: 'var(--primary-color)' }} />
                        {b.room_name || `ห้อง ${b.room_id}`}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-muted)' }}>
                        <Clock size={11} />
                        {formatTime(b.start_time)} - {formatTime(b.end_time)}
                        <span style={{
                          marginLeft: 'auto',
                          padding: '1px 6px',
                          borderRadius: '6px',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          background: b.status === 'paid' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: b.status === 'paid' ? 'var(--success-color)' : 'var(--warning-color)'
                        }}>
                          {b.status === 'paid' ? 'ชำระแล้ว' : 'รอชำระ'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0', opacity: 0.7 }}>
                  ไม่มีรายการจองในวันนี้
                </div>
              )}
            </div>
          )}
        </div>
      </>,
      document.body
    )}
  </div>
);
}

export default CustomDatePicker;
