import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, ShoppingCart, History, Settings, LogOut, Moon, Sun, Key, Sliders, Home, Coffee, User, Lock, ChevronDown, ChevronRight, ChevronLeft, Database, KeyRound, X, Users, Cloud, Map, Clock, FileText, Receipt, Menu, Trash2, Package, Bell } from 'lucide-react';
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
  const [activeSettingsSubTab, setActiveSettingsSubTab] = useState('manage');
  
  const getFirstAllowedSettingsTab = (currentUser) => {
    if (!currentUser) return 'manage';
    const permString = currentUser.permissions || 'pos,pending,layout,history';
    const perms = permString.split(',').map(p => p.trim());
    if (perms.includes('manage')) return 'manage';
    if (perms.includes('admin-users') || currentUser.username === 'admin') return 'users';
    if (perms.includes('admin-system')) return 'system';
    if (perms.includes('admin-quotation')) return 'quotation';
    if (perms.includes('admin-backup')) return 'backup';
    return 'general';
  };

  const handleNavigateToSettings = () => {
    setActiveSettingsSubTab(getFirstAllowedSettingsTab(user));
    setActiveTab('settings');
  };

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
    const permString = (user.permissions && user.permissions.trim()) 
      ? user.permissions 
      : (user.role === 'admin' 
          ? 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation' 
          : 'pos,pending,layout,manage,history,quotations');
    const perms = permString.split(',').map(p => p.trim());
    if (tabKey === 'admin-management') {
      return perms.includes('admin-management') || perms.includes('admin-users') || perms.includes('admin-system') || perms.includes('admin-backup') || perms.includes('admin-quotation') || perms.includes('manage');
    }
    // If checking a settings sub-tab, grant it if they have the main 'admin-management' permission
    if (['manage', 'admin-users', 'admin-system', 'admin-quotation', 'admin-backup'].includes(tabKey)) {
      return perms.includes('admin-management') || perms.includes(tabKey);
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

  // Upcoming Room Booking Notifications & Alerts
  const [toasts, setToasts] = useState([]);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [isBellOpen, setIsBellOpen] = useState(false);
  const notifiedIdsRef = useRef(new Set());

  useEffect(() => {
    if (!user) return;

    const checkUpcomingAlerts = async () => {
      try {
        const res = await fetch('/api/bookings/upcoming-alerts');
        if (!res.ok) return;
        const alerts = await res.json();
        
        setActiveAlerts(alerts);

        alerts.forEach(alert => {
          const alertKey = `${alert.booking_id}-${alert.start_time}`;
          if (!notifiedIdsRef.current.has(alertKey)) {
            notifiedIdsRef.current.add(alertKey);

            const startT = new Date(alert.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            const endT = new Date(alert.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

            const toastId = Date.now() + Math.random().toString(36).substr(2, 9);
            const newToast = {
              id: toastId,
              room_name: alert.room_name,
              customer_name: alert.customer_name,
              start_time_formatted: startT,
              end_time_formatted: endT
            };

            setToasts(prev => [...prev, newToast]);

            setTimeout(() => {
              setToasts(prev => prev.filter(t => t.id !== toastId));
            }, 12000);
          }
        });
      } catch (err) {
        console.error('Failed to fetch upcoming booking alerts:', err);
      }
    };

    checkUpcomingAlerts();

    const interval = setInterval(checkUpcomingAlerts, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

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
      const savedTheme = localStorage.getItem('pos_theme') || 'light';
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      // Default to Lightmode always on login page
      setTheme('light');
      document.documentElement.setAttribute('data-theme', 'light');
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

  const handleLogoClick = () => {
    setActiveTab('pos');
    triggerTransition();
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
        setActiveTab('pos');
        setActiveSettingsSubTab(getFirstAllowedSettingsTab(data.user));
        localStorage.setItem('pos_user', JSON.stringify(data.user));
        triggerTransition(); // Trigger loading screen after successful login
      } else {
        setLoginError(data.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
    } catch (err) {
      setLoginError('เซิร์ฟเวอร์หลังบ้านยังไม่ได้เปิดทำงาน หรือเกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  const handleLogout = async () => {
    const confirm = await customConfirm("คุณต้องการออกจากระบบใช่หรือไม่?");
    if (confirm) {
      setUser(null);
      setActiveTab('pos');
      setActiveSettingsSubTab('manage');
      localStorage.removeItem('pos_user');
      setIsTransitioning(false);
      
      // Force theme to light on logout
      setTheme('light');
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.removeItem('pos_theme');
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('pos_theme', nextTheme);
  };

  const handleClearHistory = async () => {
    const confirmClear = await customConfirm(
      "คุณต้องการล้างประวัติการใช้งานทั้งหมด (ประวัติการจองและประวัติใบเสนอราคา) หรือไม่?\n\n*คำเตือน: ข้อมูลประวัติการใช้งานทั้งหมดจะถูกลบถาวร แต่ข้อมูลสินค้าและห้องประชุมในคลังจะไม่ได้รับผลกระทบใดๆ"
    );
    if (!confirmClear) return;

    try {
      const res = await fetch('/api/admin/clear-history', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        await customAlert(data.message);
        // Refresh to pos screen to prevent stale data display
        setActiveTab('pos');
        window.location.reload();
      } else {
        await customAlert(data.error || 'เกิดข้อผิดพลาดในการล้างประวัติ');
      }
    } catch (err) {
      await customAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  // If there's no user, we render the login screen (no glass transition needed yet)
  if (!user) {
    return (
      <div className="login-bg" style={{ 
        position: 'relative', 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '20px', 
        overflow: 'hidden',
        backgroundColor: 'var(--bg-main)'
      }}>
        {/* Full-screen Background Image */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: 'url("/Bworktower.jpg")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: theme === 'light' ? 0.45 : 0.3,
          zIndex: 1,
          pointerEvents: 'none'
        }}></div>

        {/* Overlay matching app theme colors */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: theme === 'light' 
            ? 'linear-gradient(135deg, rgba(240,244,248,0.3) 0%, rgba(240,244,248,0.55) 100%)'
            : 'linear-gradient(135deg, rgba(18,18,20,0.4) 0%, rgba(18,18,20,0.7) 100%)',
          zIndex: 2,
          pointerEvents: 'none'
        }}></div>

        {/* Floating Theme Toggle in Top Right of Login Page */}
        <button 
          onClick={toggleTheme} 
          className="hamburger-btn"
          style={{ 
            position: 'absolute', 
            top: '24px', 
            right: '24px', 
            width: '44px', 
            height: '44px', 
            borderRadius: '12px',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            boxShadow: 'var(--glass-shadow)',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          title={theme === 'light' ? 'สลับเป็นโหมดมืด' : 'สลับเป็นโหมดสว่าง'}
        >
          {theme === 'light' ? <Moon size={20} style={{ color: 'var(--text-main)' }} /> : <Sun size={20} style={{ color: '#fbbf24' }} />}
        </button>

        {/* Glowing Orbs */}
        <div className="bg-glow-orb-1" style={{ zIndex: 3 }}></div>
        <div className="bg-glow-orb-2" style={{ zIndex: 3 }}></div>

        {/* Centered Login Card */}
        <div className="login-card" style={{ zIndex: 4, border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)', maxWidth: '440px', width: '100%', padding: '44px 36px' }}>
          <div className="login-logo-container">
            <img src="/BWORK-LOGO.png" alt="Bwork Logo" style={{ width: '90px', height: '90px', borderRadius: '22px', objectFit: 'contain', backgroundColor: '#ffffff', padding: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
          </div>
          <h2 className="login-title" style={{ marginTop: '20px', fontSize: '1.75rem', fontWeight: 800 }}>Bwork POS</h2>
          <p className="login-subtitle">ระบบบริหารจัดการจุดขายและห้องประชุม</p>

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
              <span>Login</span>
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
            <img src="/BWORK-LOGO.png" alt="Logo" />
          </div>
        </div>
      )}

      {/* Top Navbar Header Section */}
      <header className="top-navbar">
        {/* Left Side: Logo, Desktop Navigation Bar & Hamburger Button */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flex: 1
        }}>
          {/* Logo */}
          <div style={{
            width: '62px',
            height: '62px',
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
          onClick={handleLogoClick}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          >
            <img src="/BWORK-LOGO.png" alt="Logo" style={{ width: '52px', height: '52px', borderRadius: '10px', objectFit: 'contain' }} />
          </div>

          {/* Horizontal Desktop Menu Bar */}
          <nav className="desktop-menu-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
            {hasPermission('pos') && (
              <button 
                type="button"
                className={`top-menu-item ${activeTab === 'pos' ? 'active' : ''}`}
                onClick={() => setActiveTab('pos')}
              >
                <ShoppingCart size={15} />
                <span>จุดขาย POS</span>
              </button>
            )}
            {hasPermission('dashboard') && (
              <button 
                type="button"
                className={`top-menu-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                <LayoutDashboard size={15} />
                <span>Dashboard</span>
              </button>
            )}
            {hasPermission('pending') && (
              <button 
                type="button"
                className={`top-menu-item ${activeTab === 'pending' ? 'active' : ''}`}
                onClick={() => setActiveTab('pending')}
              >
                <Clock size={15} />
                <span>รอชำระเงิน</span>
              </button>
            )}
            {hasPermission('layout') && (
              <button 
                type="button"
                className={`top-menu-item ${activeTab === 'layout' ? 'active' : ''}`}
                onClick={() => setActiveTab('layout')}
              >
                <Map size={15} />
                <span>แผนผังห้อง</span>
              </button>
            )}
            {hasPermission('history') && (
              <button 
                type="button"
                className={`top-menu-item ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                <History size={15} />
                <span>ประวัติย้อนหลัง</span>
              </button>
            )}

            {hasPermission('quotations') && (
              <button 
                type="button"
                className={`top-menu-item ${activeTab === 'quotations' ? 'active' : ''}`}
                onClick={() => setActiveTab('quotations')}
              >
                <FileText size={15} />
                <span>ใบเสนอราคา</span>
              </button>
            )}
          </nav>

          {/* Hamburger Menu Toggle (Only visible on mobile screens) */}
          <button 
            className="hamburger-btn hamburger-menu-toggle"
            style={{ width: '38px', height: '38px', borderRadius: '10px', marginLeft: 'auto' }}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Right Side: User info text, Cart, Theme Toggle & Logout */}
        <div className="top-navbar-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'flex-end' }}>
          {hasPermission('admin-management') && (
            <button 
              type="button"
              className={`top-menu-item ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={handleNavigateToSettings}
              style={{ gap: '6px' }}
            >
              <Settings size={15} />
              <span>Settings</span>
            </button>
          )}

          {/* User Info Text */}
          <span 
            className="navbar-user-container"
            style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginRight: '6px' }} 
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
              <div className="menu-section-title">ตั้งค่าระบบ / Settings</div>
              <div className="menu-grid">
                <div 
                  className={`menu-card ${activeTab === 'settings' ? 'active' : ''}`} 
                  onClick={() => {
                    handleNavigateToSettings();
                    setIsMenuOpen(false);
                  }}
                >
                  <div className="menu-card-icon-wrapper">
                    <Settings size={20} />
                  </div>
                  <span>Settings</span>
                </div>
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
        {user.role === 'admin' && activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'history' && <HistoryLog settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} />}
        {activeTab === 'quotations' && <Quotations user={user} settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} quotationCartData={quotationCartData} clearQuotationCartData={() => setQuotationCartData(null)} onNavigate={setActiveTab} />}
        
        {activeTab === 'settings' && hasPermission('admin-management') && (
          <div style={{
            display: 'flex',
            height: '100%',
            width: '100%',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-main)'
          }}>
            {/* Left Sidebar */}
            <div style={{
              width: '280px',
              borderRight: '1px solid var(--border-color)',
              padding: '24px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              flexShrink: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.01)',
              textAlign: 'left'
            }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 10px 8px', color: 'var(--text-main)' }}>Settings</h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {hasPermission('manage') && (
                  <button
                    onClick={() => setActiveSettingsSubTab('manage')}
                    className={`top-menu-item ${activeSettingsSubTab === 'manage' ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      boxSizing: 'border-box',
                      height: '44px'
                    }}
                  >
                    <Package size={16} />
                    <span>จัดการคลังสินค้า</span>
                  </button>
                )}

                {hasPermission('admin-users') && (
                  <button
                    onClick={() => setActiveSettingsSubTab('users')}
                    className={`top-menu-item ${activeSettingsSubTab === 'users' ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      boxSizing: 'border-box',
                      height: '44px'
                    }}
                  >
                    <Users size={16} />
                    <span>จัดการสิทธิการใช้งาน</span>
                  </button>
                )}

                {hasPermission('admin-system') && (
                  <button
                    onClick={() => setActiveSettingsSubTab('system')}
                    className={`top-menu-item ${activeSettingsSubTab === 'system' ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      boxSizing: 'border-box',
                      height: '44px'
                    }}
                  >
                    <Receipt size={16} />
                    <span>ตั้งค่าใบเสร็จรับเงิน</span>
                  </button>
                )}

                {hasPermission('admin-quotation') && (
                  <button
                    onClick={() => setActiveSettingsSubTab('quotation')}
                    className={`top-menu-item ${activeSettingsSubTab === 'quotation' ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      boxSizing: 'border-box',
                      height: '44px'
                    }}
                  >
                    <FileText size={16} />
                    <span>ตั้งค่าใบเสนอราคา</span>
                  </button>
                )}

                {hasPermission('admin-backup') && (
                  <button
                    onClick={() => setActiveSettingsSubTab('backup')}
                    className={`top-menu-item ${activeSettingsSubTab === 'backup' ? 'active' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      width: '100%',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      boxSizing: 'border-box',
                      height: '44px'
                    }}
                  >
                    <Database size={16} />
                    <span>จัดการฐานข้อมูล</span>
                  </button>
                )}

                <button
                  onClick={() => setActiveSettingsSubTab('dooraccess')}
                  className={`top-menu-item ${activeSettingsSubTab === 'dooraccess' ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    textAlign: 'left',
                    justifyContent: 'flex-start',
                    boxSizing: 'border-box',
                    height: '44px'
                  }}
                >
                  <KeyRound size={16} />
                  <span>ระบบจอง LINE & รหัสเข้าห้อง</span>
                </button>

                <button
                  onClick={() => setActiveSettingsSubTab('general')}
                  className={`top-menu-item ${activeSettingsSubTab === 'general' ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    textAlign: 'left',
                    justifyContent: 'flex-start',
                    boxSizing: 'border-box',
                    height: '44px'
                  }}
                >
                  <Sliders size={16} />
                  <span>ทั่วไป</span>
                </button>
              </div>
            </div>

            {/* Right Work Area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '32px',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {activeSettingsSubTab === 'users' && hasPermission('admin-users') && <SettingsPanel viewMode="users" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'manage' && hasPermission('manage') && <ManagementPanel sysAlert={customAlert} sysConfirm={customConfirm} />}
              {activeSettingsSubTab === 'system' && hasPermission('admin-system') && <SettingsPanel viewMode="system" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'quotation' && hasPermission('admin-quotation') && <SettingsPanel viewMode="quotation" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'backup' && hasPermission('admin-backup') && <SettingsPanel viewMode="backup" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} onClearHistory={handleClearHistory} />}
              {activeSettingsSubTab === 'dooraccess' && <SettingsPanel viewMode="dooraccess" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'general' && <SettingsPanel viewMode="general" onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
            </div>
          </div>
        )}
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
          zIndex: 2000,
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

      {/* Toast Notifications Container (Line Style at Bottom Right) */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 11000,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '380px',
        width: 'calc(100% - 48px)',
        pointerEvents: 'none'
      }}>
        {toasts.map(toast => (
          <div 
            key={toast.id}
            style={{
              pointerEvents: 'auto',
              background: 'var(--bg-glass-modal)',
              borderLeft: '5px solid #06c755', // Line Green accent border
              borderTop: '1px solid var(--border-color)',
              borderRight: '1px solid var(--border-color)',
              borderBottom: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '12px 16px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              position: 'relative',
              animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              backdropFilter: 'blur(25px)',
              WebkitBackdropFilter: 'blur(25px)'
            }}
          >
            {/* Left side: Circular Icon Container (Line Green style) */}
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: 'rgba(6, 199, 85, 0.15)',
              border: '1px solid rgba(6, 199, 85, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Bell size={20} style={{ color: '#06c755' }} />
            </div>

            {/* Middle: Content text */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ห้องประชุมใกล้เริ่มใช้งาน
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                คุณ <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>{toast.customer_name}</span> กำลังจะเข้าใช้ <span style={{ fontWeight: 700, color: 'var(--primary-color)' }}>{toast.room_name}</span> (เวลา {toast.start_time_formatted} - {toast.end_time_formatted} น.)
              </div>
            </div>

            {/* Right: Close button */}
            <button 
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: '4px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                alignSelf: 'flex-start',
                marginTop: '-4px',
                marginRight: '-8px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
