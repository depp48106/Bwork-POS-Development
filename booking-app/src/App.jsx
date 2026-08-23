import React, { useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { Search, Building2, ShieldCheck, Sparkles } from 'lucide-react';
import HomePage from './pages/HomePage';
import RoomListPage from './pages/RoomListPage';
import BookingFormPage from './pages/BookingFormPage';
import ConfirmPage from './pages/ConfirmPage';
import StatusPage from './pages/StatusPage';

function App() {
  // Safe LIFF initialization on app launch
  useEffect(() => {
    const initLiff = async () => {
      try {
        if (window.liff) {
          const liffId = '2011136579-c1TeSWNs';
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

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
              transition: 'all 0.15s ease',
              cursor: 'pointer'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.24)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
            }}
          >
            <Search size={13} strokeWidth={2.5} />
            <span>เช็คสถานะการจอง</span>
          </Link>
        </div>
      </header>

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
