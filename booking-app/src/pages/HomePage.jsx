import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Calendar, Users, ChevronRight, AlertCircle, Building, ChevronDown, RefreshCw } from 'lucide-react';
import StepProgress from '../components/StepProgress';
import { API_BASE } from '../apiConfig';

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];
const THAI_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
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

  // Search Mode: 'byGuests' (Mode B, default) | 'directRoom' (Mode A)
  const initialMode = query.get('roomId') ? 'directRoom' : 'byGuests';
  const [searchMode, setSearchMode] = useState(initialMode);

  // Form States
  const [dateStr, setDateStr] = useState(getInitialDate());
  const [guests, setGuests] = useState(query.get('guests') ? (parseInt(query.get('guests'), 10) || '') : '');
  const [selectedRoomId, setSelectedRoomId] = useState(query.get('roomId') || '');

  // Room catalog states for Direct Room Mode
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch active rooms dynamically from API
  const fetchRooms = useCallback(async () => {
    setLoadingRooms(true);
    setRoomsError('');
    try {
      const res = await fetch(`${API_BASE}/api/public/rooms`);
      if (res.ok) {
        const data = await res.json();
        setRooms(Array.isArray(data) ? data : []);
      } else {
        setRoomsError('ไม่สามารถโหลดรายชื่อห้องประชุมได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err) {
      console.warn('Failed to fetch rooms:', err);
      setRoomsError('เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อดึงรายชื่อห้อง');
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const sortedRooms = useMemo(() => sortRoomsByStandardOrder(rooms), [rooms]);

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

    if (searchMode === 'directRoom') {
      // MODE A: Direct Room Selection (Date First, Room Second)
      if (!dateStr) {
        setErrorMessage('กรุณาเลือกวันที่ต้องการใช้งาน');
        return;
      }
      if (dateStr < todayIso) {
        setErrorMessage('ไม่สามารถเลือกวันที่ย้อนหลังได้ กรุณาเลือกวันที่ปัจจุบันหรือล่วงหน้า');
        return;
      }
      if (dateStr === todayIso && currentMins >= 17 * 60 + 30) {
        setErrorMessage('วันนี้หมดรอบเวลาให้บริการแล้ว กรุณาเลือกวันพรุ่งนี้เป็นต้นไป');
        return;
      }
      if (!selectedRoomId) {
        setErrorMessage('กรุณาเลือกห้องประชุมที่ต้องการใช้งาน');
        return;
      }
      // Ensure selected room is valid
      const roomExists = rooms.some(r => String(r.id) === String(selectedRoomId));
      if (rooms.length > 0 && !roomExists) {
        setErrorMessage('ห้องประชุมที่เลือกไม่มีอยู่ในระบบ กรุณาเลือกห้องใหม่อีกครั้ง');
        return;
      }

      // Guest count is NOT required in Step 1 for Mode A
      navigate(`/rooms?date=${dateStr}&roomId=${selectedRoomId}`);
    } else {
      // MODE B: Search by Attendees (existing flow)
      if (!dateStr) {
        setErrorMessage('กรุณาเลือกวันที่ต้องการใช้งาน');
        return;
      }
      if (dateStr < todayIso) {
        setErrorMessage('ไม่สามารถเลือกวันที่ย้อนหลังได้ กรุณาเลือกวันที่ปัจจุบันหรือล่วงหน้า');
        return;
      }
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
    }
  };

  // Reusable Date Picker component block
  const renderDatePicker = (stepNumber = 1) => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Calendar size={17} style={{ color: 'var(--primary)' }} />
          <span>{stepNumber}. เลือกวันที่ต้องการใช้งาน (Date)</span>
          <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <span style={{ fontSize: '0.74rem', color: 'var(--primary)', fontWeight: 700 }}>
          (DD/MM/YYYY)
        </span>
      </div>

      <div
        onClick={handleOpenDatePicker}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '14px 16px',
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
          padding: '8px 14px',
          borderRadius: '12px',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          color: 'var(--primary)',
          fontSize: '0.82rem',
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0
        }}>
          <Calendar size={18} />
          <span>เปิดปฏิทิน</span>
        </div>

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
  );

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
          margin: '0 0 8px 0',
          lineHeight: 1.4
        }}>
          จองห้องประชุมออนไลน์
        </h1>
        <p style={{
          fontSize: '0.9rem',
          color: 'var(--text-muted)',
          maxWidth: '480px',
          margin: '0 auto',
          lineHeight: 1.6
        }}>
          {searchMode === 'directRoom'
            ? 'เลือกวันที่และห้องประชุมที่ต้องการ เพื่อตรวจสอบช่วงเวลาว่างและเลือกแพ็กเกจ'
            : 'ระบุวันที่และจำนวนผู้เข้าใช้งาน เพื่อค้นหาห้องที่ว่างและเลือกช่วงเวลา'}
        </p>
      </div>

      {/* STEP 1 BOOKING CARD */}
      <div className="booking-card" style={{ padding: '24px 20px', borderRadius: '20px' }}>
        {/* MODE SWITCHER: BY GUESTS vs DIRECT ROOM */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          padding: '5px',
          backgroundColor: '#f1f5f9',
          borderRadius: '16px',
          border: '1.5px solid var(--border)',
          marginBottom: '22px'
        }}>
          <button
            type="button"
            onClick={() => {
              setSearchMode('byGuests');
              setErrorMessage('');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 14px',
              borderRadius: '12px',
              border: searchMode === 'byGuests' ? '1.5px solid var(--primary)' : '1px solid transparent',
              backgroundColor: searchMode === 'byGuests' ? '#ffffff' : 'transparent',
              color: searchMode === 'byGuests' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: searchMode === 'byGuests' ? 900 : 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              boxShadow: searchMode === 'byGuests' ? '0 3px 10px rgba(37, 99, 235, 0.12)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Users size={17} />
            <span>ค้นหาตามจำนวนคน</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSearchMode('directRoom');
              setErrorMessage('');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 14px',
              borderRadius: '12px',
              border: searchMode === 'directRoom' ? '1.5px solid var(--primary)' : '1px solid transparent',
              backgroundColor: searchMode === 'directRoom' ? '#ffffff' : 'transparent',
              color: searchMode === 'directRoom' ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: searchMode === 'directRoom' ? 900 : 700,
              fontSize: '0.88rem',
              cursor: 'pointer',
              boxShadow: searchMode === 'directRoom' ? '0 3px 10px rgba(37, 99, 235, 0.12)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Building size={17} />
            <span>เลือกห้องประชุมเอง</span>
          </button>
        </div>

        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          
          {searchMode === 'directRoom' ? (
            <>
              {/* MODE A: SECTION 1 - DATE PICKER (ON TOP FIRST) */}
              {renderDatePicker(1)}

              {/* MODE A: SECTION 2 - ROOM DROPDOWN (SECOND) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label className="form-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Building size={17} style={{ color: 'var(--primary)' }} />
                    <span>2. เลือกห้องประชุม (Select Meeting Room)</span>
                    <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    เลือกห้องที่ต้องการ
                  </span>
                </div>

                {loadingRooms ? (
                  <div style={{
                    height: '52px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '0 16px',
                    borderRadius: '14px',
                    border: '1.5px solid var(--border)',
                    backgroundColor: 'var(--bg-page)',
                    color: 'var(--text-muted)',
                    fontSize: '0.88rem',
                    fontWeight: 600
                  }}>
                    <RefreshCw size={16} className="spinner" />
                    <span>กำลังโหลดรายชื่อห้องประชุม...</span>
                  </div>
                ) : roomsError ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: '14px',
                    backgroundColor: 'var(--danger-light)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: 'var(--danger)',
                    fontSize: '0.86rem',
                    fontWeight: 700
                  }}>
                    <span>{roomsError}</span>
                    <button
                      type="button"
                      onClick={fetchRooms}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '8px',
                        border: '1px solid var(--danger)',
                        backgroundColor: '#ffffff',
                        color: 'var(--danger)',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      ลองใหม่
                    </button>
                  </div>
                ) : (
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Building size={20} style={{ position: 'absolute', left: '16px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                    <select
                      value={selectedRoomId}
                      onChange={e => {
                        setSelectedRoomId(e.target.value);
                        setErrorMessage('');
                      }}
                      className="form-input"
                      style={{
                        height: '52px',
                        paddingLeft: '48px',
                        paddingRight: '36px',
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: selectedRoomId ? 'var(--text-main)' : 'var(--text-muted)',
                        borderRadius: '14px',
                        border: '1.5px solid var(--border)',
                        cursor: 'pointer',
                        backgroundColor: '#ffffff'
                      }}
                    >
                      <option value="">-- กรุณาเลือกห้องประชุม --</option>
                      {sortedRooms.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.name} (รองรับสูงสุด {r.capacity} ท่าน{r.has_classroom === 1 && r.classroom_capacity ? ` / โต๊ะเรียน ${r.classroom_capacity} ท่าน` : ''})
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={18} style={{ position: 'absolute', right: '14px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* MODE B: SECTION 1 - DATE SELECTION */}
              {renderDatePicker(1)}

              {/* MODE B: SECTION 2 - GUEST COUNT */}
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
            </>
          )}

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
              fontSize: '1rem',
              fontWeight: 800,
              borderRadius: '14px',
              marginTop: '4px',
              padding: '0 16px'
            }}
          >
            <span>{searchMode === 'directRoom' ? 'ตรวจสอบช่วงเวลาว่าง & แพ็กเกจ' : 'ค้นหาห้องประชุมว่าง'}</span>
            <ChevronRight size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
