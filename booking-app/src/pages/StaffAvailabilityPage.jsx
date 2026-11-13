import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { API_BASE } from '../apiConfig';
import {
  getAvailabilityMonth, getRoomAvailabilityForDay, ROOM_CLOSE_TIME, ROOM_OPEN_TIME
} from '../../../shared/roomAvailability.mjs';
import './StaffAvailabilityPage.css';

const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const STATUS = {
  free: { label: 'ว่างทั้งวัน', symbol: '○' },
  partial: { label: 'ว่างบางช่วง', symbol: '◐' },
  full: { label: 'เต็ม', symbol: '×' }
};
const monthFormat = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateFormat = new Intl.DateTimeFormat('th-TH', { dateStyle: 'full', timeZone: 'UTC' });

function bangkokToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function roomDay(month, number) {
  return `${month}-${String(number).padStart(2, '0')}`;
}

export default function StaffAvailabilityPage() {
  const [day, setDay] = useState(bangkokToday);
  const [roomId, setRoomId] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const [result, setResult] = useState(null);
  const today = bangkokToday();
  const monthKey = day.slice(0, 7);
  const month = useMemo(() => getAvailabilityMonth(monthKey), [monthKey]);

  useEffect(() => {
    const controller = new AbortController();
    const loadAvailability = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/public/rooms/availability-month?month=${monthKey}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Availability request failed');
        const data = await response.json();
        if (data.month !== monthKey || !Array.isArray(data.rooms) || !Array.isArray(data.intervals)) {
          throw new Error('Invalid availability response');
        }
        if (!controller.signal.aborted) setResult({ monthKey, requestVersion, data });
      } catch {
        if (!controller.signal.aborted) setResult({ monthKey, requestVersion, error: true });
      }
    };
    loadAvailability();
    return () => controller.abort();
  }, [monthKey, requestVersion]);

  const current = result?.monthKey === monthKey && result.requestVersion === requestVersion ? result : null;
  const data = current?.data;
  const rooms = data?.rooms ?? [];
  const room = rooms.find(item => String(item.id) === roomId) ?? rooms[0];
  const availability = useMemo(() => {
    if (!data || !room) return [];
    const bookings = data.intervals.filter(item => item.room_id === room.id);
    return Array.from({ length: month.days }, (_, index) => {
      const date = roomDay(monthKey, index + 1);
      return { date, ...getRoomAvailabilityForDay(date, bookings, data.cleaning_buffer_minutes) };
    });
  }, [data, month.days, monthKey, room]);
  const selected = availability[Number(day.slice(8)) - 1];

  function changeMonth(offset) {
    const target = getAvailabilityMonth(monthKey, offset);
    if (target) setDay(roomDay(target.month, 1));
  }

  return (
    <main className="staff-availability">
      <header className="staff-availability__header">
        <img src="/BWORK-LOGO.png" alt="B-WORK" />
        <div><strong>BWORK Booking</strong><span>สำหรับพนักงาน</span></div>
      </header>
      <div className="staff-availability__content">
        <h1>ห้องประชุมว่างเมื่อไหร่</h1>
        <p className="staff-availability__muted">เลือกห้องและวันที่เพื่อดูช่วงเวลาว่างจากตารางจอง POS</p>
        <div className="staff-availability__layout">
          <section className="staff-availability__panel" aria-label="ปฏิทินห้องประชุม">
            {room && (
              <label className="staff-availability__room">
                ห้องประชุม
                <select value={room.id} onChange={event => setRoomId(event.target.value)}>
                  {rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            <div className="staff-availability__month">
              <button type="button" onClick={() => changeMonth(-1)} aria-label="เดือนก่อนหน้า">
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <div>
                <h2 aria-live="polite">{monthFormat.format(new Date(`${month.start}Z`))}</h2>
                <button type="button" className="staff-availability__today" onClick={() => setDay(today)}>วันนี้</button>
              </div>
              <button type="button" onClick={() => changeMonth(1)} aria-label="เดือนถัดไป">
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
            {!current && <p role="status">กำลังโหลดตารางห้องประชุม…</p>}
            {current?.error && (
              <div role="alert">
                <p>โหลดตารางห้องประชุมไม่สำเร็จ</p>
                <button type="button" className="btn-secondary" onClick={() => setRequestVersion(value => value + 1)}>ลองอีกครั้ง</button>
              </div>
            )}
            {data && !room && <p role="status">ไม่มีห้องที่เปิดให้ใช้งาน</p>}
            {room && (
              <>
                <div className="staff-availability__grid staff-availability__muted" aria-hidden="true">
                  {WEEKDAYS.map(weekday => <span key={weekday}>{weekday}</span>)}
                </div>
                <div className="staff-availability__grid" role="group" aria-label="เลือกวันที่">
                  {Array.from({ length: month.firstWeekday }, (_, index) => <span key={index} aria-hidden="true" />)}
                  {availability.map(({ date, status }) => (
                    <button
                      type="button"
                      key={date}
                      aria-pressed={date === day}
                      aria-current={date === today ? 'date' : undefined}
                      aria-label={`${dateFormat.format(new Date(date))} ${STATUS[status].label}`}
                      onClick={() => setDay(date)}
                    >
                      {Number(date.slice(8))}
                      <span data-status={status} aria-hidden="true">{STATUS[status].symbol}</span>
                    </button>
                  ))}
                </div>
                <ul className="staff-availability__legend">
                  {Object.entries(STATUS).map(([key, { label, symbol }]) => (
                    <li key={key}><span data-status={key} aria-hidden="true">{symbol}</span> {label}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section className="staff-availability__panel staff-availability__details" aria-live="polite">
            <h2>{dateFormat.format(new Date(day))}</h2>
            {selected && (
              <>
                <p>{room.name} <span className="staff-availability__muted">· {room.capacity} ที่นั่ง</span></p>
                <p className="staff-availability__status" data-status={selected.status}>{STATUS[selected.status].label}</p>
                <h3>ช่วงเวลาว่าง</h3>
                {selected.ranges.length ? (
                  <ul className="staff-availability__ranges">
                    {selected.ranges.map(({ start, end }) => <li key={start}>{start}–{end} น.</li>)}
                  </ul>
                ) : <p>ห้องเต็มตลอดช่วงเปิดให้จอง</p>}
                <p className="staff-availability__muted">
                  เวลาทำการ {ROOM_OPEN_TIME}–{ROOM_CLOSE_TIME} น. รวมการเผื่อเวลาทำความสะอาด {data.cleaning_buffer_minutes} นาทีแล้ว
                </p>
              </>
            )}
            {!selected && <p className="staff-availability__muted">{current ? 'ไม่มีข้อมูลเวลาว่างสำหรับวันที่เลือก' : 'กำลังโหลดช่วงเวลาว่าง…'}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
