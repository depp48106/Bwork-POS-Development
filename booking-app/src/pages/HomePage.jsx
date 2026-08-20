import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StepProgress from '../components/StepProgress';

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

const getTodayIso = () => {
  const now = new Date();
  return formatLocalDateIso(now.getFullYear(), now.getMonth(), now.getDate());
};

export default function HomePage() {
  const navigate = useNavigate();
  const dateInputRef = useRef(null);
  const todayIso = getTodayIso();

  const [dateStr, setDateStr] = useState(todayIso);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [guests, setGuests] = useState(1);
  const [timeError, setTimeError] = useState('');

  const handleSearch = (e) => {
    e.preventDefault();
    setTimeError('');

    if (!dateStr) return;
    if (!startTime || !endTime) {
      setTimeError('กรุณาเลือกเวลาเริ่มต้นและเวลาสิ้นสุดที่ต้องการใช้งาน');
      return;
    }
    if (endTime <= startTime) {
      setTimeError('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น');
      return;
    }
    if (isPastTime(startTime, dateStr)) {
      setTimeError('เวลาเริ่มต้นที่เลือกได้ผ่านไปแล้ว กรุณาเลือกช่วงเวลาใหม่');
      return;
    }

    const guestNum = Math.max(1, parseInt(guests) || 1);
    navigate(`/rooms?date=${dateStr}&startTime=${startTime}&endTime=${endTime}&guests=${guestNum}`);
  };

  // Format Date strictly as DD/MM/YYYY พ.ศ. (e.g. 04/08/2569)
  const formatDdMmYyyy = (dStr) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-').map(Number);
    const dayStr = String(d).padStart(2, '0');
    const monthStr = String(m).padStart(2, '0');
    const thaiYear = y + 543;
    return `${dayStr}/${monthStr}/${thaiYear}`;
  };

  // Format Thai Full Date Display (without parentheses)
  const formatThaiFullDate = (dStr) => {
    if (!dStr) return '';
    const [y, m, d] = dStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const thaiYear = y + 543;
    const weekday = dateObj.toLocaleDateString('th-TH', { weekday: 'long' });
    const monthName = dateObj.toLocaleDateString('th-TH', { month: 'long' });
    return `${weekday}ที่ ${d} ${monthName} ${thaiYear}`;
  };

  // Trigger date picker on box click anywhere
  const handleBoxClick = () => {
    if (dateInputRef.current) {
      try {
        if (typeof dateInputRef.current.showPicker === 'function') {
          dateInputRef.current.showPicker();
        } else {
          dateInputRef.current.focus();
          dateInputRef.current.click();
        }
      } catch (err) {
        dateInputRef.current.click();
      }
    }
  };

  return (
    <div className="page-transition" style={{ maxWidth: '460px', margin: '0 auto' }}>
      {/* Hero Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ color: 'var(--primary)', fontSize: '2.2rem', margin: '0 0 0.2rem 0', fontWeight: 'bold' }}>B-WORK</h1>
        <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.2rem' }}>ระบบจองห้องประชุมออนไลน์</h2>
        <p style={{ color: '#475569', margin: 0, fontSize: '0.95rem', fontWeight: 500 }}>
          เลือกวันและเวลาที่ต้องการใช้งาน เพื่อดูสถานะห้องว่างและรูปแบบการจอง
        </p>
      </div>

      {/* Progress Step Indicator (Step 1 Active) */}
      <StepProgress currentStep={1} />

      {/* Step 1 Search Form Card */}
      <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '16px' }}>
        <form onSubmit={handleSearch}>
          
          {/* Custom Date Input with Icon Far Right */}
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-dark)' }}>
              วันที่ต้องการจอง (วัน/เดือน/ปี)
            </label>

            {/* Clickable Box Container */}
            <div 
              onClick={handleBoxClick}
              className="form-control"
              style={{ 
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 0.85rem',
                fontSize: '1rem',
                fontWeight: 'bold',
                color: 'var(--text-dark)',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                border: '1.5px solid var(--primary)',
                boxShadow: '0 2px 6px rgba(30, 58, 138, 0.08)',
                cursor: 'pointer',
                position: 'relative'
              }}
            >
              {/* Date Text DD/MM/YYYY */}
              <span>{formatDdMmYyyy(dateStr)}</span>

              {/* Far Right SVG Calendar Icon */}
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--primary)" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                style={{ flexShrink: 0, marginLeft: 'auto' }}
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>

              {/* Native Date Input Overlay - perfectly receives touch on iOS without blocking visual UI */}
              <input 
                ref={dateInputRef}
                type="date"
                value={dateStr}
                min={todayIso}
                onChange={(e) => {
                  if (e.target.value) {
                    setDateStr(e.target.value);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  zIndex: 5,
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              />
            </div>

            {/* Thai Date Text Below */}
            <div style={{ fontSize: '0.825rem', color: 'var(--primary)', marginTop: '0.4rem', fontWeight: 600 }}>
              {formatThaiFullDate(dateStr)}
            </div>
          </div>

          {/* Time Range Selector (Manual Selection, No Auto-fill) */}
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-dark)' }}>
              ช่วงเวลาที่ต้องการใช้งาน <span style={{ color: '#ef4444' }}>*</span>
            </label>

            {timeError && (
              <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 'bold', marginBottom: '0.5rem', backgroundColor: '#fee2e2', padding: '0.4rem 0.6rem', borderRadius: '6px' }}>
                {timeError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '4px', fontWeight: 600 }}>เวลาเริ่มต้น:</label>
                <select
                  id="home-select-start-time"
                  className="form-control"
                  value={startTime}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setStartTime(newStart);
                    setTimeError('');
                    if (newStart && (!endTime || endTime <= newStart)) {
                      const startHour = parseInt(newStart.split(':')[0], 10);
                      const nextHour = (startHour + 1).toString().padStart(2, '0') + ':00';
                      if (TIME_OPTIONS.includes(nextHour)) {
                        setEndTime(nextHour);
                      }
                    }
                  }}
                  style={{ 
                    fontWeight: startTime ? 'bold' : 'normal',
                    color: startTime ? 'var(--primary)' : '#0f172a',
                    border: !startTime && timeError ? '1.5px solid #ef4444' : '1.5px solid var(--border)'
                  }}
                >
                  <option value="">-- เลือกเวลาเริ่ม --</option>
                  {TIME_OPTIONS.filter(t => t < '18:00').map(t => {
                    const isPast = isPastTime(t, dateStr);
                    return (
                      <option 
                        key={`hs-${t}`} 
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
                <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '4px', fontWeight: 600 }}>เวลาสิ้นสุด:</label>
                <select
                  id="home-select-end-time"
                  className="form-control"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setTimeError('');
                  }}
                  style={{ 
                    fontWeight: endTime ? 'bold' : 'normal',
                    color: endTime ? 'var(--primary)' : '#0f172a',
                    border: !endTime && timeError ? '1.5px solid #ef4444' : '1.5px solid var(--border)'
                  }}
                >
                  <option value="">-- เลือกเวลาสิ้นสุด --</option>
                  {TIME_OPTIONS.filter(t => t > '08:00').map(t => {
                    const isPast = isPastTime(t, dateStr);
                    const isBeforeStart = startTime ? t <= startTime : false;
                    const isDisabled = isPast || isBeforeStart;
                    return (
                      <option 
                        key={`he-${t}`} 
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

          {/* Guest Count Input */}
          <div className="form-group" style={{ marginBottom: '1.5rem' }}>
            <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-dark)' }}>
              จำนวนผู้เข้าประชุม (ระบุจำนวนคน)
            </label>
            <input 
              type="text" 
              inputMode="numeric"
              pattern="[0-9]*"
              className="form-control"
              value={guests}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '');
                setGuests(val);
              }}
              placeholder="กรอกจำนวนคน เช่น 1, 5, 10"
              style={{ fontSize: '0.95rem', padding: '0.75rem 0.85rem', borderRadius: '8px' }}
            />
          </div>

          {/* Submit Search Button */}
          <button 
            type="submit" 
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 'bold', borderRadius: '10px' }}
          >
            ค้นหาห้องประชุม
          </button>
        </form>
      </div>

      {/* Booking Status Link */}
      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <a href="/status" style={{ color: 'var(--primary)', textDecoration: 'underline', fontSize: '0.85rem' }}>
          เช็คสถานะการจองด้วยหมายเลข BK / Check Booking Status
        </a>
      </div>
    </div>
  );
}
