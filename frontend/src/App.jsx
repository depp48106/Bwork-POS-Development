import React, { useState, useEffect } from 'react';
import { LayoutDashboard, ShoppingCart, History, Settings, LogOut, Moon, Sun, Key, Sliders, Home, Coffee, User, Lock, ChevronDown, ChevronRight, ChevronLeft, Database, KeyRound, X, Users, Cloud, Map, Clock, FileText, Receipt, Menu } from 'lucide-react';
import BookingPOS from './components/BookingPOS';
import Dashboard from './components/Dashboard';
import HistoryLog from './components/History';
import SettingsPanel from './components/Settings';
import ManagementPanel from './components/Management';
import RoomLayout from './components/RoomLayout';
import PendingBookings from './components/PendingBookings';
import Quotations from './components/Quotations';

function App() {
  const [activeTab, setActiveTab] = useState('pos');
  const [theme, setTheme] = useState('light');
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  
  // Transition States (Liquid Glass Loader)
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [fadeClass, setFadeClass] = useState('');

  // Collapsible Sidebar Submenus
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Hamburger Top Menu State
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // POS Checkout Cart States (lifted up for top menu display)
  const [cartCount, setCartCount] = useState(0);
  const [showCartSidebar, setShowCartSidebar] = useState(false);

  // Auto-close submenus on activeTab changes
  useEffect(() => {
    setIsAdminOpen(false);
    setIsMenuOpen(false);
  }, [activeTab]);

  // Quotation Cart State
  const [quotationCartData, setQuotationCartData] = useState(null);

  const handleExportToQuotation = (data) => {
    setQuotationCartData(data);
    setActiveTab('quotations');
  };

  // Check if current user has permission to view tab/menu
  const hasPermission = (tabKey) => {
    if (user && user.username === 'admin') return true;
    if (!user) return false;
    const permString = user.permissions || 'pos,pending,layout,history';
    const perms = permString.split(',').map(p => p.trim());
    if (tabKey === 'admin-management') {
      return perms.includes('admin-users') || perms.includes('admin-system') || perms.includes('admin-backup') || perms.includes('admin-quotation') || perms.includes('manage');
    }
    return perms.includes(tabKey);
  };

  // Change Password states
  const [showChangePassModal, setShowChangePassModal] = useState(false);
  const [changePassForm, setChangePassForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

  // Room pre-selection from layout status screen
  const [preselectedRoom, setPreselectedRoom] = useState(null);

  // Global Liquid Glass Custom Dialog System
  const [dialog, setDialog] = useState(null);

  const customAlert = (message) => {
    return new Promise((resolve) => {
      setDialog({ type: 'alert', message, resolve: (val) => { setDialog(null); resolve(val); } });
    });
  };

  const customConfirm = (message) => {
    return new Promise((resolve) => {
      setDialog({ type: 'confirm', message, resolve: (val) => { setDialog(null); resolve(val); } });
    });
  };

  const customPrompt = (message, defaultValue = '') => {
    return new Promise((resolve) => {
      setDialog({ type: 'prompt', message, defaultValue, resolve: (val) => { setDialog(null); resolve(val); } });
    });
  };

  // Auto-expand submenus based on activeTab
  useEffect(() => {
    if (activeTab === 'manage-rooms' || activeTab === 'manage-services') {
      setIsManageOpen(true);
    }
    if (activeTab === 'admin-users' || activeTab === 'admin-system' || activeTab === 'admin-backup') {
      setIsAdminOpen(true);
    }
  }, [activeTab]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (changePassForm.newPassword !== changePassForm.confirmPassword) {
      await customAlert('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user.username,
          oldPassword: changePassForm.oldPassword,
          newPassword: changePassForm.newPassword
        })
      });
      const data = await res.json();
      if (res.ok) {
        await customAlert('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
        setShowChangePassModal(false);
        setChangePassForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        await customAlert(data.error || 'เปลี่ยนรหัสผ่านล้มเหลว');
      }
    } catch (err) {
      await customAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const [settings, setSettings] = useState({
    company_name: 'บริษัท ดีพมายด์ โซลูชั่น จำกัด',
    receipt_header: 'ใบเสร็จรับเงิน / ใบรับจองบริการ',
    receipt_footer: 'ขอบคุณที่ใช้บริการห้องประชุมของเรา'
  });

  // Load user from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('pos_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
      triggerTransition(); // Transition on initial load
    }
    fetchSettings();
  }, []);

  // Fetch settings from API
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  // Liquid glass transition animation trigger
  const triggerTransition = () => {
    setIsTransitioning(true);
    setFadeClass('');
    
    // Step 1: Start fading out the glass loader at 1.5 seconds
    setTimeout(() => {
      setFadeClass('fade-out');
    }, 1500);

    // Step 2: Fully unmount the loader component at 2.3 seconds
    setTimeout(() => {
      setIsTransitioning(false);
    }, 2300);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUser(data.user);
        localStorage.setItem('pos_user', JSON.stringify(data.user));
        triggerTransition(); // Trigger loading screen after successful login
      } else {
        setLoginError(data.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch (err) {
      setLoginError('เซิร์ฟเวอร์หลังบ้านยังไม่ได้เปิดทำงาน หรือเกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('pos_user');
    setIsTransitioning(false);
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  // If there's no user, we render the login screen (no glass transition needed yet)
  if (!user) {
    return (
      <div className="login-bg">
        <div className="bg-glow-orb-1"></div>
        <div className="bg-glow-orb-2"></div>
        <div className="login-card">
          <div className="login-logo-container">
            <img src="/logo.jpg" alt="Bwork Logo" />
          </div>
          <h2 className="login-title">เข้าสู่ระบบ Bwork POS</h2>
          <p className="login-subtitle">ระบบจองพื้นที่และจัดการบริการเสริมห้องประชุม</p>

          {loginError && (
            <div style={{
              backgroundColor: 'var(--danger-bg)',
              color: 'var(--danger-color)',
              padding: '14px 18px',
              borderRadius: '18px',
              fontSize: '0.85rem',
              marginBottom: '20px',
              fontWeight: 650,
              width: '100%',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              textAlign: 'center'
            }}>
              ⚠️ {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ width: '100%' }}>
            <div className="login-input-group">
              <input
                id="username"
                type="text"
                className="login-input"
                placeholder="ชื่อผู้ใช้งาน"
                required
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              />
              <User size={18} className="login-input-icon" />
            </div>

            <div className="login-input-group" style={{ marginBottom: '28px' }}>
              <input
                id="password"
                type="password"
                className="login-input"
                placeholder="รหัสผ่าน"
                required
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
              />
              <Lock size={18} className="login-input-icon" />
            </div>

            <button type="submit" className="login-button">
              <Key size={18} />
              <span>เข้าสู่ระบบความปลอดภัย</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Once the user is logged in, we render the app layout.
  // If isTransitioning is true, the liquid-glass loading overlay sits on top of this,
  // blurring the main app UI layout beneath it.
  return (
    <div className="app-container">
      <div className="bg-glow-orb-1"></div>
      <div className="bg-glow-orb-2"></div>
      {/* Liquid Glass Transition Overlay */}
      {isTransitioning && (
        <div className={`liquid-glass-overlay ${fadeClass}`}>
          <div className="liquid-logo-container">
            <img src="/logo.jpg" alt="Logo" />
          </div>
        </div>
      )}

      {/* Top Navbar Header Section */}
      <header className="top-navbar">
        {/* Left Side: Logo & Hamburger Button */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          {/* Logo */}
          <div style={{
            width: '54px',
            height: '54px',
            borderRadius: '14px',
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--glass-shadow)',
            border: '1px solid var(--border-color)',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          >
            <img src="/logo.jpg" alt="Logo" style={{ width: '44px', height: '44px', borderRadius: '10px', objectFit: 'contain' }} />
          </div>

          {/* Hamburger Menu Toggle */}
          <button 
            className="hamburger-btn"
            style={{ width: '38px', height: '38px', borderRadius: '10px' }}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Right Side: User info text, Cart, Theme Toggle & Logout */}
        <div className="top-navbar-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-end' }}>
          {/* User Info Text */}
          <span 
            className="navbar-user-container"
            style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', cursor: 'pointer', transition: 'color 0.2s ease', marginRight: '6px' }} 
            onClick={() => setShowChangePassModal(true)} 
            title="เปลี่ยนรหัสผ่าน"
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary-color)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-main)'}
          >
            <span className="navbar-user-label">ผู้ใช้งาน: </span>
            <span style={{ color: 'var(--primary-color)', fontWeight: 800 }}>{user.username}</span>
          </span>

          {/* Cart Toggle Icon Button with Red Badge (Only on POS tab) */}
          {activeTab === 'pos' && (
            <button 
              onClick={() => setShowCartSidebar(!showCartSidebar)}
              type="button"
              className="hamburger-btn"
              style={{
                position: 'relative',
                background: showCartSidebar ? 'var(--primary-color)' : 'transparent',
                color: showCartSidebar ? '#ffffff' : 'var(--text-main)',
                width: '38px',
                height: '38px',
                borderRadius: '10px'
              }}
              title="ดูสินค้าในตะกร้า"
            >
              <ShoppingCart size={18} />
              {cartCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  backgroundColor: 'var(--danger-color)',
                  color: '#ffffff',
                  fontSize: '0.6rem',
                  fontWeight: 'bold',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {cartCount}
                </span>
              )}
            </button>
          )}

          {/* Theme display switcher */}
          <button 
            onClick={toggleTheme} 
            className="hamburger-btn"
            style={{ width: '38px', height: '38px', borderRadius: '10px' }}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {/* Logout button */}
          <button 
            className="hamburger-btn"
            onClick={handleLogout}
            style={{ width: '38px', height: '38px', borderRadius: '10px', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
            title="ออกจากระบบ"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Hamburger Liquid Glass Dropdown Menu */}
      {isMenuOpen && (
        <div className="menu-overlay">
          <div>
            <div className="menu-section-title">เมนูหลัก / Services</div>
            <div className="menu-grid">
              {hasPermission('pos') && (
                <div className={`menu-card ${activeTab === 'pos' ? 'active' : ''}`} onClick={() => setActiveTab('pos')}>
                  <div className="menu-card-icon-wrapper">
                    <ShoppingCart size={20} />
                  </div>
                  <span>จุดขาย POS</span>
                </div>
              )}
              {hasPermission('dashboard') && (
                <div className={`menu-card ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                  <div className="menu-card-icon-wrapper">
                    <LayoutDashboard size={20} />
                  </div>
                  <span>Dashboard</span>
                </div>
              )}
              {hasPermission('pending') && (
                <div className={`menu-card ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>
                  <div className="menu-card-icon-wrapper">
                    <Clock size={20} />
                  </div>
                  <span>รายการรอชำระเงิน</span>
                </div>
              )}
              {hasPermission('layout') && (
                <div className={`menu-card ${activeTab === 'layout' ? 'active' : ''}`} onClick={() => setActiveTab('layout')}>
                  <div className="menu-card-icon-wrapper">
                    <Map size={20} />
                  </div>
                  <span>แผนผังห้อง</span>
                </div>
              )}
              {hasPermission('history') && (
                <div className={`menu-card ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
                  <div className="menu-card-icon-wrapper">
                    <History size={20} />
                  </div>
                  <span>ประวัติย้อนหลัง</span>
                </div>
              )}
              {hasPermission('quotations') && (
                <div className={`menu-card ${activeTab === 'quotations' ? 'active' : ''}`} onClick={() => setActiveTab('quotations')}>
                  <div className="menu-card-icon-wrapper">
                    <FileText size={20} />
                  </div>
                  <span>ใบเสนอราคา</span>
                </div>
              )}
            </div>
          </div>

          {hasPermission('admin-management') && (
            <div>
              <div className="menu-section-title">แผงควบคุมระบบ / Admin Panel</div>
              <div className="menu-grid">
                {hasPermission('admin-users') && (
                  <div className={`menu-card ${activeTab === 'admin-users' ? 'active' : ''}`} onClick={() => setActiveTab('admin-users')}>
                    <div className="menu-card-icon-wrapper">
                      <Users size={20} />
                    </div>
                    <span>จัดการสิทธิใช้งาน</span>
                  </div>
                )}
                {hasPermission('manage') && (
                  <div className={`menu-card ${activeTab === 'manage' ? 'active' : ''}`} onClick={() => setActiveTab('manage')}>
                    <div className="menu-card-icon-wrapper">
                      <Database size={20} />
                    </div>
                    <span>จัดการคลัง</span>
                  </div>
                )}
                {hasPermission('admin-system') && (
                  <div className={`menu-card ${activeTab === 'admin-system' ? 'active' : ''}`} onClick={() => setActiveTab('admin-system')}>
                    <div className="menu-card-icon-wrapper">
                      <Receipt size={20} />
                    </div>
                    <span>แก้ไขใบเสร็จ</span>
                  </div>
                )}
                {hasPermission('admin-quotation') && (
                  <div className={`menu-card ${activeTab === 'admin-quotation' ? 'active' : ''}`} onClick={() => setActiveTab('admin-quotation')}>
                    <div className="menu-card-icon-wrapper">
                      <FileText size={20} />
                    </div>
                    <span>แก้ไขใบเสนอราคา</span>
                  </div>
                )}
                {hasPermission('admin-backup') && (
                  <div className={`menu-card ${activeTab === 'admin-backup' ? 'active' : ''}`} onClick={() => setActiveTab('admin-backup')}>
                    <div className="menu-card-icon-wrapper">
                      <Cloud size={20} />
                    </div>
                    <span>ตั้งค่าการสำรองข้อมูล</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content Workspace */}
      <main className="main-content" style={{ 
        marginLeft: 0, 
        marginTop: 0, 
        paddingTop: '100px', 
        paddingBottom: '24px', 
        height: '100vh', 
        boxSizing: 'border-box', 
        overflow: 'auto', 
        display: 'flex', 
        flexDirection: 'column' 
      }}>
        {activeTab === 'pos' && <BookingPOS user={user} settings={settings} sysAlert={customAlert} preselectedRoom={preselectedRoom} clearPreselectedRoom={() => setPreselectedRoom(null)} onNavigate={setActiveTab} onExportToQuotation={handleExportToQuotation} showCartSidebar={showCartSidebar} setShowCartSidebar={setShowCartSidebar} onCartCountChange={setCartCount} />}
        {activeTab === 'layout' && <RoomLayout sysAlert={customAlert} onNavigateToBook={(room) => { setPreselectedRoom(room); setActiveTab('pos'); }} />}
        {activeTab === 'pending' && <PendingBookings settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} />}
        {user.role === 'admin' && activeTab === 'manage' && <ManagementPanel sysAlert={customAlert} sysConfirm={customConfirm} />}
        {user.role === 'admin' && activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'history' && <HistoryLog settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} />}
        {activeTab === 'quotations' && <Quotations user={user} settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} quotationCartData={quotationCartData} clearQuotationCartData={() => setQuotationCartData(null)} onNavigate={setActiveTab} />}
        {user.role === 'admin' && activeTab === 'admin-users' && <SettingsPanel viewMode="users" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
        {user.role === 'admin' && activeTab === 'admin-system' && <SettingsPanel viewMode="system" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
        {user.role === 'admin' && activeTab === 'admin-backup' && <SettingsPanel viewMode="backup" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
        {user.role === 'admin' && activeTab === 'admin-quotation' && <SettingsPanel viewMode="quotation" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
      </main>

      {/* ========================================================= */}
      {/* 🔮 SELF-SERVICE CHANGE PASSWORD MODAL                     */}
      {/* ========================================================= */}
      {showChangePassModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '420px',
            padding: '32px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            border: '1px solid var(--glass-border)',
            position: 'relative'
          }}>
            <button 
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setShowChangePassModal(false)}
            >
              <X size={20} />
            </button>

            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <KeyRound size={22} className="text-primary" />
              เปลี่ยนรหัสผ่านส่วนตัว
            </h2>

            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>รหัสผ่านเดิม</label>
                <input 
                  type="password" 
                  className="form-control" 
                  required 
                  placeholder="กรอกรหัสผ่านปัจจุบัน"
                  value={changePassForm.oldPassword} 
                  onChange={e => setChangePassForm({...changePassForm, oldPassword: e.target.value})} 
                />
              </div>
              <div className="form-group">
                <label>รหัสผ่านใหม่</label>
                <input 
                  type="password" 
                  className="form-control" 
                  required 
                  placeholder="ขั้นต่ำ 4 ตัวอักษร"
                  value={changePassForm.newPassword} 
                  onChange={e => setChangePassForm({...changePassForm, newPassword: e.target.value})} 
                />
              </div>
              <div className="form-group" style={{ marginBottom: '28px' }}>
                <label>ยืนยันรหัสผ่านใหม่</label>
                <input 
                  type="password" 
                  className="form-control" 
                  required 
                  placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
                  value={changePassForm.confirmPassword} 
                  onChange={e => setChangePassForm({...changePassForm, confirmPassword: e.target.value})} 
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => setShowChangePassModal(false)}
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 2 }}
                >
                  ยืนยันการเปลี่ยน
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ========================================================= */}
      {/* 🔮 IN-APP LIQUID GLASS DIALOG MODAL                       */}
      {/* ========================================================= */}
      {dialog && (
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
            maxWidth: '440px',
            padding: '32px',
            boxShadow: '0 24px 70px rgba(0,0,0,0.4)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            position: 'relative'
          }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              {dialog.type === 'alert' && '🔔 แจ้งเตือนจากระบบ'}
              {dialog.type === 'confirm' && '❓ ยืนยันการทำรายการ'}
              {dialog.type === 'prompt' && '📝 กรอกข้อมูลเพิ่มเติม'}
            </h3>
            
            <p style={{ fontSize: '0.925rem', lineHeight: 1.6, color: 'var(--text-main)', whiteSpace: 'pre-line', margin: 0 }}>
              {dialog.message}
            </p>

            {dialog.type === 'prompt' && (
              <input
                id="custom-dialog-input"
                type="text"
                className="form-control"
                defaultValue={dialog.defaultValue}
                autoFocus
                style={{ width: '100%', padding: '12px 16px', borderRadius: '14px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-main)' }}
              />
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', justifyContent: 'flex-end' }}>
              {dialog.type !== 'alert' && (
                <button 
                  className="btn btn-secondary" 
                  style={{ minWidth: '100px', padding: '10px 18px' }}
                  onClick={() => dialog.resolve(dialog.type === 'confirm' ? false : null)}
                >
                  ยกเลิก
                </button>
              )}
              <button 
                className="btn btn-primary" 
                style={{ minWidth: '100px', padding: '10px 18px' }}
                onClick={() => {
                  if (dialog.type === 'prompt') {
                    const val = document.getElementById('custom-dialog-input')?.value || '';
                    dialog.resolve(val);
                  } else {
                    dialog.resolve(true);
                  }
                }}
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
