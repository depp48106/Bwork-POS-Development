import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function CustomDatePicker({ value, onChange, placeholder = 'เลือกวันที่', className, style }) {
  // value represents 'YYYY-MM-DD'
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  
  // Date parsing
  const dateObj = value ? new Date(value) : new Date();
  const [currentYear, setCurrentYear] = useState(isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(isNaN(dateObj.getTime()) ? new Date().getMonth() : dateObj.getMonth()); // 0-11
  
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setCurrentYear(d.getFullYear());
        setCurrentMonth(d.getMonth());
      }
    }
  }, [value]);

  // Close calendar popover on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    onChange(`${yyyy}-${mm}-${dd}`);
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

  const monthNames = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];
  
  const dayNames = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);
  
  // Build calendar grid
  const daysGrid = [];
  for (let i = 0; i < firstDay; i++) {
    daysGrid.push(<div key={`empty-${i}`} style={{ width: '30px', height: '30px' }}></div>);
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    const formattedTarget = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isSelected = value === formattedTarget;
    daysGrid.push(
      <button
        key={`day-${day}`}
        type="button"
        onClick={() => handleDayClick(day)}
        style={{
          width: '30px',
          height: '30px',
          borderRadius: '50%',
          border: 'none',
          backgroundColor: isSelected ? 'var(--primary-color)' : 'transparent',
          color: isSelected ? '#ffffff' : 'var(--text-main)',
          fontSize: '0.8rem',
          fontWeight: isSelected ? 'bold' : 'normal',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s'
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
      style={{ position: 'relative', zIndex: isOpen ? 99 : 1, ...style }}
      onClick={() => setIsOpen(!isOpen)}
    >
      <div 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          userSelect: 'none',
          width: '100%'
        }}
      >
        <span style={{ fontSize: '0.85rem', color: value ? 'var(--text-main)' : 'var(--text-muted)' }}>
          {value ? formatDateDisplay(value) : placeholder}
        </span>
      </div>

      {isOpen && (
        <div 
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--glass-border)',
            borderRadius: '16px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
            padding: '14px',
            zIndex: 9999,
            width: '250px',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <button type="button" onClick={prevMonth} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', padding: '4px' }}>
              <ChevronLeft size={16} />
            </button>
            <div style={{ fontSize: '0.825rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
              {monthNames[currentMonth]} {currentYear + 543}
            </div>
            <button type="button" onClick={nextMonth} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', padding: '4px' }}>
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Week Days */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', marginBottom: '6px', fontWeight: 'bold', fontSize: '0.725rem', color: 'var(--text-muted)' }}>
            {dayNames.map(name => <div key={name}>{name}</div>)}
          </div>

          {/* Days Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', justifyItems: 'center' }}>
            {daysGrid}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomDatePicker;
