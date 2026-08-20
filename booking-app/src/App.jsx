import React, { useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RoomListPage from './pages/RoomListPage';
import BookingFormPage from './pages/BookingFormPage';
import ConfirmPage from './pages/ConfirmPage';
import StatusPage from './pages/StatusPage';
import { API_BASE } from './apiConfig';

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
      <header className="app-header">
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/" className="logo-container">
            <img 
              src="/BWORK-LOGO.png" 
              alt="B-WORK" 
              style={{ 
                height: '42px', 
                objectFit: 'contain',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))'
              }} 
              onError={(e) => {
                // Fallback if image fails to render
                e.target.style.display = 'none';
              }}
            />
            <div>
              <div className="logo-title">B-WORK</div>
              <div className="logo-subtitle">MEETING ROOM BOOKING</div>
            </div>
          </Link>

          <Link to="/status" className="header-status-btn">
            ตรวจสอบสถานะการจอง
          </Link>
        </div>
      </header>

      <main className="main-content">
        <div className="container">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/rooms" element={<RoomListPage />} />
            <Route path="/booking" element={<BookingFormPage />} />
            <Route path="/confirm/:bookingId" element={<ConfirmPage />} />
            <Route path="/status" element={<StatusPage />} />
          </Routes>
        </div>
      </main>

      <footer className="app-footer">
        <div className="container">
          <p>© {new Date().getFullYear()} บจก.บิลท์ ฮาร์ท (Built Heart Co., Ltd.)</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.35rem', color: '#64748b' }}>B-WORK Coworking Space &amp; Meeting Rooms</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
