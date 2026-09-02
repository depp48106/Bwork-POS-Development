import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Search, CreditCard, ChevronRight, X, Clock } from 'lucide-react';
import HomePage from './pages/HomePage';
import RoomListPage from './pages/RoomListPage';
import BookingFormPage from './pages/BookingFormPage';
import ConfirmPage from './pages/ConfirmPage';
import StatusPage from './pages/StatusPage';
import { API_BASE } from './apiConfig';

function App() {
  const location = useLocation();
  const [pendingBooking, setPendingBooking] = useState(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Check pending booking in localStorage (Strict 15-Minute Expiration & Status Sync)
  useEffect(() => {
    const checkPending = async () => {
      try {
        const stored = localStorage.getItem('bwork_pending_booking');
        if (stored) {
          const parsed = JSON.parse(stored);
          const elapsed = Date.now() - (parsed.createdAt || 0);

          // Expire based on dynamic paymentWindowMinutes (fallback: 15 minutes)
          const windowMinutes = Math.max(1, parseInt(parsed.paymentWindowMinutes || 15, 10) || 15);
          if (elapsed >= windowMinutes * 60 * 1000) {
            localStorage.removeItem('bwork_pending_booking');
            setPendingBooking(null);
            return;
          }

          // Check live status from backend if booking ID is present
          if (parsed.id) {
            try {
              const res = await fetch(`${API_BASE}/api/public/bookings/${parsed.id}`, {
                headers: {
                  ...(parsed.accessToken ? { 'X-Booking-Token': parsed.accessToken } : {}),
                  ...(parsed.contact ? { 'X-Booking-Contact': parsed.contact } : {})
                }
              });
              const data = await res.json();
              if (data) {
                if (data.payment_status === 'cancelled' || data.payment_status === 'paid' || data.error) {
                  localStorage.removeItem('bwork_pending_booking');
                  setPendingBooking(null);
                  return;
                }
              }
            } catch (err) {}
          }

          setPendingBooking(parsed);
        } else {
          setPendingBooking(null);
        }
      } catch (e) {
        setPendingBooking(null);
      }
    };

    checkPending();
  }, [location.pathname]);

  // Safe LIFF initialization on app launch
  useEffect(() => {
    const initLiff = async () => {
      try {
        if (window.liff) {
          // Dynamic LIFF ID resolution:
          // 1. line_liff_id from Public Config
          // 2. import.meta.env.VITE_LIFF_ID
          // 3. Fallback: '2011136579-c1TeSWNs'
          let liffId = '';
          try {
            const configRes = await fetch(`${API_BASE}/api/public/settings/payment`);
            if (configRes.ok) {
              const configData = await configRes.json();
              if (configData && configData.line_liff_id && String(configData.line_liff_id).trim()) {
                liffId = String(configData.line_liff_id).trim();
              }
            }
          } catch (cfgErr) {
            console.warn('[LIFF] Could not fetch public config for LIFF ID:', cfgErr.message);
          }

          if (!liffId) {
            liffId = import.meta.env.VITE_LIFF_ID || '2011136579-c1TeSWNs';
          }

          await window.liff.init({ liffId, withLoginOnExternalBrowser: false });
          if (window.liff.isLoggedIn()) {
            const profile = await window.liff.getProfile();
            if (profile && profile.userId) {
              sessionStorage.setItem('line_user_id', profile.userId);
              localStorage.setItem('line_user_id', profile.userId);
              if (profile.displayName) {
                sessionStorage.setItem('line_user_name', profile.displayName);
                localStorage.setItem('line_user_name', profile.displayName);
              }
              if (profile.pictureUrl) {
                sessionStorage.setItem('line_user_pic', profile.pictureUrl);
                localStorage.setItem('line_user_pic', profile.pictureUrl);
              }
            }
          } else {
            if (window.liff.isInClient && window.liff.isInClient()) {
              window.liff.login();
            }
          }
        }
      } catch (err) {
        console.warn('LIFF init warning:', err?.message || err);
      }
    };
    initLiff();
  }, []);

  const isConfirmPage = location.pathname.startsWith('/confirm');

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <img 
              src="/BWORK-LOGO.png" 
              alt="B-WORK" 
              style={{ 
                height: '38px', 
                objectFit: 'contain',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
              }} 
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 900, letterSpacing: '0.5px', color: '#ffffff', lineHeight: 1.1 }}>
                B-WORK
              </div>
              <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#93c5fd', letterSpacing: '0.3px' }}>
                ระบบจองห้องประชุมออนไลน์
              </div>
            </div>
          </Link>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {pendingBooking && !isConfirmPage && (
              <Link 
                to={`/confirm?id=${pendingBooking.id}&code=${encodeURIComponent(pendingBooking.code || '')}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  border: '1px solid rgba(255, 255, 255, 0.4)',
                  color: '#ffffff',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
                  textDecoration: 'none',
                  animation: 'pulse 2s infinite'
                }}
              >
                <CreditCard size={14} />
                <span>แนบสลิปชำระเงิน</span>
              </Link>
            )}

            <Link 
              to="/status" 
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.14)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                color: '#ffffff',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '0.76rem',
                fontWeight: 800,
                whiteSpace: 'nowrap',
                flexShrink: 0,
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                textDecoration: 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Search size={13} strokeWidth={2.5} />
              <span>เช็คสถานะการจอง</span>
            </Link>
          </div>
        </div>
      </header>

      {/* FLOATING / STICKY RESUME PAYMENT BANNER */}
      {pendingBooking && !isConfirmPage && !bannerDismissed && (
        <div style={{
          backgroundColor: '#0284c7',
          backgroundImage: 'linear-gradient(90deg, #0284c7, #0369a1)',
          color: '#ffffff',
          padding: '10px 16px',
          boxShadow: '0 4px 16px rgba(2, 132, 199, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 90
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem' }}>
            <div style={{ 
              width: '28px', 
              height: '28px', 
              borderRadius: '8px', 
              backgroundColor: 'rgba(255,255,255,0.2)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Clock size={16} color="#ffffff" />
            </div>
            <div>
              <span style={{ fontWeight: 800 }}>คุณมีรายการจองที่รอการแนบสลิป:</span>{' '}
              <span style={{ color: '#bae6fd' }}>#{pendingBooking.code} ({pendingBooking.roomName})</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Link 
              to={`/confirm?id=${pendingBooking.id}&code=${encodeURIComponent(pendingBooking.code || '')}`}
              style={{
                backgroundColor: '#ffffff',
                color: '#0284c7',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 900,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
              }}
            >
              <span>ไปที่หน้าแนบสลิป</span>
              <ChevronRight size={14} />
            </Link>

            <button 
              onClick={() => setBannerDismissed(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#bae6fd',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="ปิดการแจ้งเตือนนี้"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT ROUTES */}
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rooms" element={<RoomListPage />} />
          <Route path="/form" element={<BookingFormPage />} />
          <Route path="/booking" element={<BookingFormPage />} />
          <Route path="/confirm" element={<ConfirmPage />} />
          <Route path="/confirm/:bookingId" element={<ConfirmPage />} />
          <Route path="/status" element={<StatusPage />} />
        </Routes>
      </main>

      {/* FOOTER */}
      <footer style={{
        backgroundColor: '#0f172a',
        color: '#94a3b8',
        borderTop: '1px solid #1e293b',
        padding: '24px 16px',
        textAlign: 'center',
        fontSize: '0.8rem',
        marginTop: 'auto'
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.86rem' }}>
            B-WORK Coworking Space & Meeting Rooms
          </div>
          <div>
            © {new Date().getFullYear()} บริษัท บิลท์ ฮาร์ท จำกัด (Built Heart Co., Ltd.) · สงวนลิขสิทธิ์
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
