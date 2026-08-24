import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Calendar, Users, ChevronRight, AlertCircle, Building } from 'lucide-react';
import StepProgress from '../components/StepProgress';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];
const THAI_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];

const formatToIso = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

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
  return `${dayName}ที่ ${d} ${monthName} ${thaiYear}`;
};

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const dateInputRef = useRef(null);

  const today = new Date();
  const todayIso = formatToIso(today);
  const currentMins = today.getHours() * 60 + today.getMinutes();

  // If past 17:00 today, default to tomorrow
  const getInitialDate = () => {
    if (query.get('date')) {
      const qDate = query.get('date');
      if (qDate >= todayIso) return qDate;
    }
    if (currentMins >= 17 * 60) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return formatToIso(tomorrow);
    }
    return todayIso;
  };

  // States
  const [dateStr, setDateStr] = useState(getInitialDate());
  const [guests, setGuests] = useState(query.get('guests') ? (parseInt(query.get('guests'), 10) || '') : '');
  const [errorMessage, setErrorMessage] = useState('');

  const handleOpenDatePicker = () => {
    if (dateInputRef.current) {
      if (typeof dateInputRef.current.showPicker === 'function') {
        dateInputRef.current.showPicker();
      } else {
        dateInputRef.current.focus();
      }
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!dateStr) {
      setErrorMessage('กรุณาเลือกวันที่ต้องการใช้งาน');
      return;
    }
    // Prevent past date
    if (dateStr < todayIso) {
      setErrorMessage('ไม่สามารถเลือกวันที่ย้อนหลังได้ กรุณาเลือกวันที่ปัจจุบันหรือล่วงหน้า');
      return;
    }
    // Check if today is selected but business hours ended
    if (dateStr === todayIso && currentMins >= 17 * 60 + 30) {
      setErrorMessage('วันนี้หมดรอบเวลาให้บริการแล้ว กรุณาเลือกวันพรุ่งนี้เป็นต้นไป');
      return;
    }
    if (!guests || guests < 1) {
      setErrorMessage('กรุณาระบุจำนวนผู้เข้าใช้ห้องอย่างน้อย 1 ท่าน');
      return;
    }

    // Navigate to Room List with Date & Guests
    navigate(`/rooms?date=${dateStr}&guests=${guests}`);
  };

  return (
    <div className="main-content" style={{ maxWidth: '640px', margin: '0 auto', paddingBottom: '32px' }}>
      {/* 4-STEP WIZARD PROGRESS BAR */}
      <StepProgress currentStep={1} />

      {/* HERO BANNER */}
      <div style={{
        textAlign: 'center',
        marginTop: '12px',
        marginBottom: '28px',
        padding: '0 8px'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 14px',
          borderRadius: '20px',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          color: 'var(--primary)',
          fontSize: '0.8rem',
          fontWeight: 800,
          marginBottom: '10px'
        }}>
          <Building size={14} />
          <span>B-WORK MEETING ROOM</span>
        </div>
        <h1 style={{
          fontSize: '1.8rem',
          fontWeight: 900,
          color: 'var(--text-main)',
          letterSpacing: '-0.02em',
          margin: '0 0 8px 0',
          lineHeight: 1.3
        }}>
          จองห้องประชุมออนไลน์
        </h1>
        <p style={{
          fontSize: '0.9rem',
          color: 'var(--text-muted)',
          maxWidth: '480px',
          margin: '0 auto',
          lineHeight: 1.5
        }}>
          ระบุวันที่และจำนวนผู้เข้าใช้งาน เพื่อค้นหาห้องที่ว่างและเลือกช่วงเวลา
        </p>
      </div>

      {/* STEP 1 BOOKING CARD */}
      <div className="booking-card" style={{ padding: '24px 20px', borderRadius: '20px' }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          
          {/* SECTION 1: DATE SELECTION (DD/MM/YYYY) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Calendar size={17} style={{ color: 'var(--primary)' }} />
                <span>1. เลือกวันที่ต้องการใช้งาน (Date)</span>
                <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <span style={{ fontSize: '0.74rem', color: 'var(--primary)', fontWeight: 700 }}>
                (DD/MM/YYYY)
              </span>
            </div>

            {/* Interactive Apple-Style Date Display Box */}
            <div 
              onClick={handleOpenDatePicker}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderRadius: '16px',
                border: '2px solid var(--primary)',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.08)',
                transition: 'all 0.2s ease'
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  วันที่เลือก (DD/MM/YYYY)
                </div>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '1px', marginTop: '2px' }}>
                  {formatToDdMmYyyy(dateStr)}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 600, marginTop: '2px' }}>
                  {formatThaiDateDesc(dateStr)}
                </div>
              </div>

              <div style={{
                padding: '10px 16px',
                borderRadius: '12px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                color: 'var(--primary)',
                fontSize: '0.84rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Calendar size={18} />
                <span>เปิดปฏิทิน</span>
              </div>

              {/* Native HTML5 Date Input Overlay (strictly min=todayIso) */}
              <input
                ref={dateInputRef}
                type="date"
                required
                min={todayIso}
                value={dateStr}
                onChange={(e) => {
                  setDateStr(e.target.value);
                  setErrorMessage('');
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  zIndex: 2
                }}
              />
            </div>
          </div>

          {/* SECTION 2: GUEST COUNT (Number of people) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Users size={17} style={{ color: 'var(--primary)' }} />
                <span>2. จำนวนผู้เข้าใช้งาน (Attendees)</span>
                <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                ระบุจำนวนคน
              </span>
            </div>

            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center'
            }}>
              <Users size={20} style={{ position: 'absolute', left: '16px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="number"
                min="1"
                max="100"
                required
                value={guests}
                onChange={e => {
                  const val = parseInt(e.target.value, 10);
                  setGuests(isNaN(val) ? '' : val);
                  setErrorMessage('');
                }}
                placeholder="กรุณาระบุจำนวนผู้เข้าใช้งาน (เช่น 2, 4, 8 ท่าน)"
                className="form-input"
                style={{
                  height: '52px',
                  paddingLeft: '48px',
                  paddingRight: '60px',
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  color: 'var(--text-main)',
                  borderRadius: '14px',
                  border: '1.5px solid var(--border)'
                }}
              />
              <span style={{
                position: 'absolute',
                right: '16px',
                fontSize: '0.9rem',
                fontWeight: 800,
                color: 'var(--text-muted)',
                pointerEvents: 'none'
              }}>
                ท่าน
              </span>
            </div>
          </div>

          {/* ERROR ALERT */}
          {errorMessage && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '12px',
              backgroundColor: 'var(--danger-light)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--danger)',
              fontSize: '0.88rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* SUBMIT BUTTON */}
          <button
            type="submit"
            className="btn-primary"
            style={{
              height: '52px',
              fontSize: '1.05rem',
              fontWeight: 800,
              borderRadius: '14px',
              marginTop: '4px'
            }}
          >
            <span>ค้นหาห้องประชุมว่าง (Next: Choose Room & Time)</span>
            <ChevronRight size={22} />
          </button>
        </form>
      </div>
    </div>
  );
}
