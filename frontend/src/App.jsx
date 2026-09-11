import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, ShoppingCart, History, Settings, LogOut, Moon, Sun, Key, Sliders, Home, Coffee, User, Lock, ChevronDown, ChevronRight, ChevronLeft, Database, KeyRound, X, Users, Cloud, Map, Clock, FileText, Receipt, Menu, Trash2, Package, Bell, CheckCircle2, Calendar, AlertCircle } from 'lucide-react';
import BookingPOS from './components/BookingPOS';
import Dashboard from './components/Dashboard';
import HistoryLog from './components/History';
import SettingsPanel from './components/Settings';
import ManagementPanel from './components/Management';
import RoomLayout from './components/RoomLayout';
import PendingBookings from './components/PendingBookings';
import Quotations from './components/Quotations';
import BasecampQuotaModal from './components/BasecampQuotaModal';
import HourCredits from './components/HourCredits';
import { creditNavigationLabel } from './utils/hourCreditUI';

function App() {
  const [activeTab, setActiveTab] = useState('pos');
  const [showBasecampQuotaModal, setShowBasecampQuotaModal] = useState(false);
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
    if (!user) return false;
    if (user.username === 'admin') return true;
    const permString = typeof user.permissions === 'string' ? user.permissions : '';
    const perms = permString.split(',').map(p => p.trim()).filter(Boolean);
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
  const [upcomingAlerts, setUpcomingAlerts] = useState([]);
  const [todayBookings, setTodayBookings] = useState([]);
  const [incomingBookings, setIncomingBookings] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [reviewingCount, setReviewingCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [isBellOpen, setIsBellOpen] = useState(false);
  const [bellTab, setBellTab] = useState('incoming');
  const [readAlertKeys, setReadAlertKeys] = useState(() => {
    try {
      const saved = localStorage.getItem('bwork_read_alerts');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (e) {
      return new Set();
    }
  });

  const markAllAsRead = (upcomingList = upcomingAlerts, incomingList = incomingBookings) => {
    setReadAlertKeys(prev => {
      const next = new Set(prev);
      (upcomingList || []).forEach(item => {
        next.add(`${item.booking_id}-${item.start_time}`);
        next.add(`b-${item.booking_id}`);
      });
      (incomingList || []).forEach(item => {
        next.add(`incoming-${item.booking_id}-${item.payment_status}`);
        next.add(`incoming-${item.booking_id}`);
        next.add(`b-${item.booking_id}`);
      });
      try {
        localStorage.setItem('bwork_read_alerts', JSON.stringify(Array.from(next)));
      } catch (e) {}
      return next;
    });
  };

  // Count unread alerts (upcoming + incoming) for badge display
  const unreadAlerts = useMemo(() => {
    const unreadUpcoming = upcomingAlerts.filter(item => 
      !readAlertKeys.has(`${item.booking_id}-${item.start_time}`) &&
      !readAlertKeys.has(`b-${item.booking_id}`)
    );
    const unreadIncoming = incomingBookings.filter(item => 
      !readAlertKeys.has(`incoming-${item.booking_id}-${item.payment_status}`) &&
      !readAlertKeys.has(`incoming-${item.booking_id}`) &&
      !readAlertKeys.has(`b-${item.booking_id}`)
    );
    return [...unreadUpcoming, ...unreadIncoming];
  }, [upcomingAlerts, incomingBookings, readAlertKeys]);

  const handleToggleBell = () => {
    if (!isBellOpen) {
      markAllAsRead(upcomingAlerts, incomingBookings);
      setIsBellOpen(true);
    } else {
      setIsBellOpen(false);
    }
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    if (!user) return;

    const checkUpcomingAlerts = async () => {
      try {
        const res = await fetch('/api/bookings/upcoming-alerts');
        if (!res.ok) return;
        const data = await res.json();
        
        const upcomingList = Array.isArray(data) ? data : (data.upcoming || []);
        const todayList = data.todayBookings || [];
        const incomingList = data.incomingBookings || [];

        setUpcomingAlerts(upcomingList);
        setTodayBookings(todayList);
        setIncomingBookings(incomingList);
        setPendingCount(data.pendingCount || 0);
        setReviewingCount(data.reviewingCount || 0);

        // Get persistent notified toasts from localStorage
        let notifiedSet = new Set();
        try {
          const savedNotified = localStorage.getItem('bwork_notified_toasts');
          if (savedNotified) {
            notifiedSet = new Set(JSON.parse(savedNotified));
          }
        } catch (e) {}

        let updatedNotified = false;

        // 1. Pop up toast for incoming LINE / Online bookings & slips
        incomingList.forEach(item => {
          const incomingKey = `toast-incoming-${item.booking_id}-${item.payment_status}-${item.slip_image_url ? 'slip' : 'noslip'}`;
          if (!notifiedSet.has(incomingKey)) {
            notifiedSet.add(incomingKey);
            updatedNotified = true;

            const isSlip = item.payment_status === 'reviewing' || !!item.slip_image_url;
            const toastId = Date.now() + Math.random().toString(36).substr(2, 9);
            const newToast = {
              id: toastId,
              type: 'incoming',
              isSlip,
              booking_id: item.booking_id,
              room_name: item.room_name || 'ห้องประชุม',
              customer_name: item.customer_name || 'ลูกค้า LINE OA',
              total_amount: item.total_amount,
              booking_source: item.booking_source
            };

            setToasts(prev => [newToast, ...prev]);

            setTimeout(() => {
              setToasts(prev => prev.filter(t => t.id !== toastId));
            }, 15000);
          }
        });

        // 2. Pop up toast for upcoming bookings nearing start time (<= 15 minutes)
        upcomingList.forEach(item => {
          const alertKey = `toast-upcoming-${item.booking_id}-${item.start_time}`;
          if (!notifiedSet.has(alertKey)) {
            notifiedSet.add(alertKey);
            updatedNotified = true;

            const startT = new Date(item.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            const endT = new Date(item.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

            const toastId = Date.now() + Math.random().toString(36).substr(2, 9);
            const newToast = {
              id: toastId,
              type: 'upcoming',
              room_name: item.room_name,
              customer_name: item.customer_name,
              start_time_formatted: startT,
              end_time_formatted: endT
            };

            setToasts(prev => [newToast, ...prev]);

            setTimeout(() => {
              setToasts(prev => prev.filter(t => t.id !== toastId));
            }, 12000);
          }
        });

        if (updatedNotified) {
          try {
            localStorage.setItem('bwork_notified_toasts', JSON.stringify(Array.from(notifiedSet)));
          } catch (e) {}
        }
      } catch (err) {
        console.error('Failed to fetch upcoming booking alerts:', err);
      }
    };

    checkUpcomingAlerts();

    const interval = setInterval(checkUpcomingAlerts, 15000);
    return () => clearInterval(interval);
  }, [user]);

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
    company_name: 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
    receipt_header: 'ใบเสร็จรับเงิน / ใบรับจองบริการ',
    receipt_footer: 'ขอบคุณที่ใช้บริการห้องประชุมของเรา'
  });

  // Verify session with backend /api/auth/me on initial load
  useEffect(() => {
    const initAuthAndSettings = async () => {
      const savedUser = localStorage.getItem('pos_user');
      const savedToken = localStorage.getItem('pos_token');
      const savedTheme = localStorage.getItem('pos_theme') || 'light';
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);

      if (savedUser && savedToken) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${savedToken}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
              setUser(data.user);
              localStorage.setItem('pos_user', JSON.stringify(data.user));
              triggerTransition();
            } else {
              // Token invalid or user no longer exists
              handleForceLogout();
            }
          } else {
            // Token expired or invalid
            handleForceLogout();
          }
        } catch (err) {
          // If server offline, keep local user
          setUser(JSON.parse(savedUser));
        }
      }
      fetchSettings();
    };

    initAuthAndSettings();
  }, []);

  const handleForceLogout = () => {
    setUser(null);
    localStorage.removeItem('pos_user');
    localStorage.removeItem('pos_token');
    localStorage.removeItem('token');
    setIsTransitioning(false);
  };

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
        if (data.token) {
          localStorage.setItem('pos_token', data.token);
          localStorage.setItem('token', data.token);
        }
        triggerTransition();
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
      localStorage.removeItem('pos_token');
    localStorage.removeItem('token');
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
        <div className="login-card" style={{ zIndex: 4, border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)', maxWidth: '440px', width: '100%', padding: '36px 32px' }}>
          <div className="login-logo-container">
            <img src="/BWORK-LOGO.png" alt="Bwork Logo" style={{ width: '80px', height: '80px', borderRadius: '20px', objectFit: 'contain', backgroundColor: '#ffffff', padding: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
          </div>
          <h2 className="login-title" style={{ marginTop: '16px', fontSize: '1.65rem', fontWeight: 800 }}>Bwork POS</h2>
          <p className="login-subtitle" style={{ marginBottom: '18px' }}>ระบบบริหารจัดการจุดขายและห้องประชุม</p>

          {loginError && (
            <div style={{
              backgroundColor: 'var(--danger-bg)',
              color: 'var(--danger-color)',
              padding: '12px 16px',
              borderRadius: '14px',
              fontSize: '0.825rem',
              marginBottom: '18px',
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
                placeholder="ชื่อผู้ใช้งาน (Username)"
                required
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              />
              <User size={18} className="login-input-icon" />
            </div>

            <div className="login-input-group" style={{ marginBottom: '24px' }}>
              <input
                id="password"
                type="password"
                className="login-input"
                placeholder="รหัสผ่าน (Password)"
                required
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
              />
              <Lock size={18} className="login-input-icon" />
            </div>

            <button type="submit" className="login-button">
              <Key size={18} />
              <span>เข้าสู่ระบบ (Login)</span>
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
                <span>รายการจองห้อง</span>
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
            {hasPermission('pos') && (
              <button
                type="button"
                className={`top-menu-item ${activeTab === 'hour-credits' ? 'active' : ''}`}
                onClick={() => setActiveTab('hour-credits')}
              >
                <Clock size={15} />
                <span>{creditNavigationLabel}</span>
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

          {/* User Info Badge */}
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '4px 10px', 
              borderRadius: '12px', 
              background: 'rgba(255, 255, 255, 0.05)', 
              border: '1px solid var(--border-color)',
              marginRight: '4px'
            }}
          >
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: user.role === 'admin' ? 'linear-gradient(135deg, #3b82f6, #6366f1)' : 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '0.8rem',
              fontWeight: 800
            }}>
              {(user.fullname || user.username || 'U').charAt(0).toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {user.fullname || user.username}
              </span>
              <span style={{ fontSize: '0.675rem', fontWeight: 700, color: user.role === 'admin' ? '#3b82f6' : '#10b981' }}>
                {user.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'พนักงานต้อนรับ (Staff)'}
              </span>
            </div>
          </div>

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

          {/* Upcoming Meeting Alert Notification Bell */}
          <div style={{ position: 'relative' }}>
            <button 
              onClick={handleToggleBell}
              type="button"
              className="hamburger-btn"
              style={{
                position: 'relative',
                background: isBellOpen ? 'var(--primary-color)' : 'transparent',
                color: isBellOpen ? '#ffffff' : (unreadAlerts.length > 0 ? '#ef4444' : 'var(--text-main)'),
                width: '38px',
                height: '38px',
                borderRadius: '10px'
              }}
              title="การแจ้งเตือนห้องประชุม"
            >
              <Bell size={18} />
              {unreadAlerts.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  fontSize: '0.6rem',
                  fontWeight: 'bold',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 8px rgba(239,68,68,0.7)'
                }}>
                  {unreadAlerts.length}
                </span>
              )}
            </button>

            {/* Notification Dropdown Box (Top-Right) */}
            {isBellOpen && (
              <>
                <div 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }}
                  onClick={() => setIsBellOpen(false)} 
                />
                <div 
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: '380px',
                    maxWidth: '92vw',
                    backgroundColor: 'var(--bg-glass-modal, #ffffff)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '18px',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35), 0 0 1px rgba(0,0,0,0.1)',
                    padding: '14px',
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    animation: 'fadeIn 0.15s ease-out'
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: 'rgba(37, 99, 235, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                        <Bell size={15} />
                      </div>
                      <span style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-main)', letterSpacing: '0.01em' }}>
                        การแจ้งเตือน
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {unreadAlerts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => markAllAsRead()}
                          style={{
                            background: 'rgba(37, 99, 235, 0.08)',
                            border: '1px solid rgba(37, 99, 235, 0.2)',
                            color: 'var(--primary-color)',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          ✓ อ่านทั้งหมด
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsBellOpen(false)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '4px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)'; e.currentTarget.style.color = 'var(--text-main)'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Modern Full-Width Segmented Control */}
                  <div style={{ 
                    display: 'flex', 
                    gap: '4px', 
                    background: 'var(--bg-color)', 
                    padding: '3px', 
                    borderRadius: '12px', 
                    border: '1px solid var(--border-color)' 
                  }}>
                    {[
                      { key: 'incoming', label: 'จองใหม่', count: incomingBookings.length },
                      { key: 'upcoming', label: 'ใกล้เริ่ม', count: upcomingAlerts.length },
                      { key: 'today', label: 'วันนี้', count: todayBookings.length }
                    ].map(tab => {
                      const isSel = bellTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setBellTab(tab.key)}
                          style={{
                            flex: 1,
                            border: 'none',
                            background: isSel ? 'var(--primary-color)' : 'transparent',
                            color: isSel ? '#ffffff' : 'var(--text-muted)',
                            fontSize: '0.74rem',
                            fontWeight: isSel ? 800 : 600,
                            padding: '6px 4px',
                            borderRadius: '9px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '5px',
                            boxShadow: isSel ? '0 2px 8px rgba(37, 99, 235, 0.3)' : 'none',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span>{tab.label}</span>
                          <span style={{
                            fontSize: '0.66rem',
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: '8px',
                            backgroundColor: isSel ? 'rgba(255, 255, 255, 0.25)' : (tab.count > 0 ? 'rgba(37, 99, 235, 0.12)' : 'transparent'),
                            color: isSel ? '#ffffff' : (tab.count > 0 ? 'var(--primary-color)' : 'var(--text-muted)')
                          }}>
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Body Content */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto' }} className="scrollbar-thin">
                    {bellTab === 'incoming' ? (
                      incomingBookings.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                            <CheckCircle2 size={22} />
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--text-main)', marginTop: '4px' }}>
                            ไม่มีรายการจองใหม่ค้างตรวจสอบ
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            ทุกรายการได้รับการตรวจสอบและบันทึกเรียบร้อยแล้ว
                          </div>
                        </div>
                      ) : (
                        incomingBookings.map((b, idx) => {
                          const isSlip = b.payment_status === 'reviewing' || !!b.slip_image_url;
                          return (
                            <div 
                              key={idx}
                              onClick={() => {
                                setIsBellOpen(false);
                                setActiveTab('pending');
                              }}
                              style={{
                                padding: '10px 12px',
                                borderRadius: '12px',
                                backgroundColor: isSlip ? 'rgba(14, 165, 233, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                                border: `1px solid ${isSlip ? 'rgba(14, 165, 233, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
                                borderLeft: `4px solid ${isSlip ? '#0ea5e9' : '#f59e0b'}`,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'transform 0.15s ease'
                              }}
                              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-main)' }}>
                                  #{b.booking_id} · {b.room_name || 'ห้องประชุม'}
                                </span>
                                <span style={{ 
                                  fontSize: '0.68rem', 
                                  fontWeight: 800, 
                                  color: isSlip ? '#0ea5e9' : '#f59e0b', 
                                  backgroundColor: isSlip ? 'rgba(14,165,233,0.15)' : 'rgba(245,158,11,0.15)', 
                                  padding: '2px 6px', 
                                  borderRadius: '6px' 
                                }}>
                                  {isSlip ? '📎 แนบสลิปแล้ว' : '⚠️ รอชำระเงิน'}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{b.customer_name || 'ลูกค้า LINE OA'}</strong> · ยอด <strong style={{ color: 'var(--primary-color)' }}>฿{Number(b.total_amount || 0).toLocaleString()}</strong>
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--primary-color)', marginTop: '2px', fontWeight: 700 }}>
                                👉 คลิกเพื่อตรวจสลิป / รับชำระ
                              </div>
                            </div>
                          );
                        })
                      )
                    ) : bellTab === 'upcoming' ? (
                      upcomingAlerts.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'rgba(249, 115, 22, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f97316' }}>
                            <Clock size={22} />
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--text-main)', marginTop: '4px' }}>
                            ขณะนี้ไม่มีห้องที่ใกล้ถึงเวลาใช้งาน
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            ระบบจะแจ้งเตือนเมื่อมีคิวที่ใกล้ถึงเวลาใน 15 นาที
                          </div>
                        </div>
                      ) : (
                        upcomingAlerts.map((alert, idx) => {
                          const startT = new Date(alert.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          const endT = new Date(alert.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          return (
                            <div 
                              key={idx}
                              style={{
                                padding: '10px 12px',
                                borderRadius: '12px',
                                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                borderLeft: '4px solid #ef4444',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                textAlign: 'left'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-main)' }}>{alert.room_name}</span>
                                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)', padding: '2px 6px', borderRadius: '6px' }}>
                                  ใกล้เริ่มใช้งาน
                                </span>
                              </div>
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                เวลา: <strong style={{ color: 'var(--text-main)' }}>{startT} - {endT} น.</strong>
                              </div>
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{alert.customer_name || 'ลูกค้า'}</strong>
                              </div>
                            </div>
                          );
                        })
                      )
                    ) : (
                      todayBookings.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                            <Calendar size={22} />
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--text-main)', marginTop: '4px' }}>
                            วันนี้ยังไม่มีรายการจองห้อง
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            สามารถทำการจองคิวใหม่ได้ที่หน้าแผนผังจองห้อง
                          </div>
                        </div>
                      ) : (
                        todayBookings.map((item, idx) => {
                          const startT = new Date(item.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          const endT = new Date(item.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                          const isExpired = new Date() > new Date(item.end_time);
                          return (
                            <div 
                              key={idx}
                              style={{
                                padding: '10px 12px',
                                borderRadius: '12px',
                                backgroundColor: 'var(--bg-color)',
                                border: '1px solid var(--border-color)',
                                borderLeft: `4px solid ${isExpired ? '#94a3b8' : (item.payment_status === 'paid' ? '#10b981' : '#f59e0b')}`,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                textAlign: 'left',
                                opacity: isExpired ? 0.65 : 1
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-main)' }}>{item.room_name}</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary-color)' }}>{startT} - {endT} น.</span>
                              </div>
                              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{item.customer_name || 'ลูกค้า'}</strong> · {isExpired ? 'ใช้งานเสร็จแล้ว' : (item.payment_status === 'paid' ? 'ชำระแล้ว' : 'รอชำระ')}
                              </div>
                            </div>
                          );
                        })
                      )
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Theme display switcher */}
          <button 
            onClick={toggleTheme} 
            className="hamburger-btn"
            style={{ width: '38px', height: '38px', borderRadius: '10px' }}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {/* Switch User / Logout button */}
          <button 
            className="hamburger-btn"
            onClick={handleLogout}
            style={{ width: '38px', height: '38px', borderRadius: '10px', color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
            title="สลับผู้ใช้ / ออกจากระบบ"
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
                  <span>รายการจองห้อง</span>
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
              {hasPermission('pos') && (
                <button className={`menu-card ${activeTab === 'hour-credits' ? 'active' : ''}`} onClick={() => setActiveTab('hour-credits')}>
                  <div className="menu-card-icon-wrapper">
                    <Clock size={20} />
                  </div>
                  <span>{creditNavigationLabel}</span>
                </button>
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
        paddingTop: activeTab === 'pos' ? '66px' : '78px', 
        paddingBottom: activeTab === 'pos' ? '6px' : '24px', 
        paddingLeft: activeTab === 'pos' ? '12px' : '16px',
        paddingRight: activeTab === 'pos' ? '12px' : '16px',
        height: activeTab === 'pos' ? '100vh' : 'auto',
        minHeight: '100vh',
        boxSizing: 'border-box', 
        overflow: activeTab === 'pos' ? 'hidden' : 'auto', 
        display: 'flex', 
        flexDirection: 'column' 
      }}>
        {activeTab === 'pos' && <BookingPOS user={user} settings={settings} sysAlert={customAlert} preselectedRoom={preselectedRoom} clearPreselectedRoom={() => setPreselectedRoom(null)} onNavigate={setActiveTab} onExportToQuotation={handleExportToQuotation} showCartSidebar={showCartSidebar} setShowCartSidebar={setShowCartSidebar} onCartCountChange={setCartCount} />}
        {activeTab === 'layout' && <RoomLayout sysAlert={customAlert} onNavigateToBook={(room) => { setPreselectedRoom(room); setActiveTab('pos'); }} />}
        {activeTab === 'pending' && <PendingBookings settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} />}
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'history' && <HistoryLog settings={settings} sysAlert={customAlert} sysConfirm={customConfirm} />}
        {activeTab === 'hour-credits' && hasPermission('pos') && <HourCredits sysConfirm={customConfirm}/>}
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
                    <span>จัดการผู้ใช้ & บทบาท</span>
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
                    <span>ตั้งค่าระบบ & ใบเสร็จ</span>
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
                    <span>สำรองข้อมูล (Backup)</span>
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
              {activeSettingsSubTab === 'users' && hasPermission('admin-users') && <SettingsPanel viewMode="users" currentUser={user} onUserUpdate={setUser} onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'manage' && hasPermission('manage') && <ManagementPanel sysAlert={customAlert} sysConfirm={customConfirm} />}
              {activeSettingsSubTab === 'system' && hasPermission('admin-system') && <SettingsPanel viewMode="system" currentUser={user} onUserUpdate={setUser} onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'quotation' && hasPermission('admin-quotation') && <SettingsPanel viewMode="quotation" currentUser={user} onUserUpdate={setUser} onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'backup' && hasPermission('admin-backup') && <SettingsPanel viewMode="backup" currentUser={user} onUserUpdate={setUser} onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} onClearHistory={handleClearHistory} />}
              {activeSettingsSubTab === 'dooraccess' && <SettingsPanel viewMode="dooraccess" currentUser={user} onUserUpdate={setUser} onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
              {activeSettingsSubTab === 'general' && <SettingsPanel viewMode="general" currentUser={user} onUserUpdate={setUser} onSettingsUpdate={fetchSettings} sysAlert={customAlert} sysConfirm={customConfirm} sysPrompt={customPrompt} />}
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

      {/* Toast Notification Container (Pops up at screen edge only when booking is <= 15 mins before start) */}
      {toasts.length > 0 && (
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
          {toasts.map(toast => {
            const isIncoming = toast.type === 'incoming';
            const borderColor = isIncoming ? (toast.isSlip ? '#0ea5e9' : '#f59e0b') : '#ef4444';
            const iconBg = isIncoming ? (toast.isSlip ? 'rgba(14, 165, 233, 0.15)' : 'rgba(245, 158, 11, 0.15)') : 'rgba(239, 68, 68, 0.15)';
            const iconColor = isIncoming ? (toast.isSlip ? '#0ea5e9' : '#f59e0b') : '#ef4444';

            return (
              <div 
                key={toast.id}
                onClick={() => {
                  if (isIncoming) {
                    setActiveTab('pending');
                    removeToast(toast.id);
                  }
                }}
                style={{
                  pointerEvents: 'auto',
                  background: 'var(--bg-card)',
                  borderLeft: `5px solid ${borderColor}`,
                  borderTop: '1px solid var(--border-color)',
                  borderRight: '1px solid var(--border-color)',
                  borderBottom: '1px solid var(--border-color)',
                  borderRadius: '14px',
                  padding: '14px 16px',
                  boxShadow: '0 14px 45px rgba(0, 0, 0, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  position: 'relative',
                  animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                  backdropFilter: 'blur(25px)',
                  WebkitBackdropFilter: 'blur(25px)',
                  cursor: isIncoming ? 'pointer' : 'default'
                }}
              >
                {/* Icon */}
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: iconBg,
                  border: `1px solid ${borderColor}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {isIncoming ? (
                    <Bell size={20} style={{ color: iconColor }} />
                  ) : (
                    <AlertCircle size={20} style={{ color: iconColor }} />
                  )}
                </div>

                {/* Text */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: iconColor, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {isIncoming ? (
                      toast.isSlip ? (
                        <span>📎 สลิปโอนเงินใหม่จาก LINE OA!</span>
                      ) : (
                        <span>📥 การจองใหม่จาก LINE OA!</span>
                      )
                    ) : (
                      <span>⚠️ ห้องประชุมใกล้เริ่ม (อีก 15 นาที)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 700 }}>
                    {isIncoming ? (
                      `#${toast.booking_id} · ${toast.room_name}`
                    ) : (
                      toast.room_name
                    )}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {isIncoming ? (
                      `คุณ ${toast.customer_name} · ยอด ฿${Number(toast.total_amount || 0).toLocaleString()} (คลิกเพื่อตรวจสลิป)`
                    ) : (
                      `คุณ ${toast.customer_name} (${toast.start_time_formatted} - ${toast.end_time_formatted} น.)`
                    )}
                  </div>
                </div>

                {/* Close button */}
                <button 
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeToast(toast.id);
                  }}
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
                    alignSelf: 'flex-start',
                    marginTop: '-4px',
                    marginRight: '-6px'
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
