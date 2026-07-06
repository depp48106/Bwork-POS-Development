import React, { useState, useEffect } from 'react';
import { LayoutDashboard, ShoppingCart, History, Settings, LogOut, Moon, Sun, Key, Sliders, Home, Coffee, User, Lock, ChevronDown, ChevronRight, ChevronLeft, Database, KeyRound, X, Users, Cloud, Map, Clock, FileText, Receipt } from 'lucide-react';
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
                placeholder="ชื่อผู้ใช้งาน (เช่น admin)"
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
                placeholder="รหัสผ่าน (เช่น admin123)"
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

          <div className="login-demo-badge">
            <span>สิทธิ์ผู้ใช้จำลอง: admin / admin123</span>
          </div>
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

      {/* Sidebar Section */}
      <aside className="sidebar">
        <div className="brand" style={{ borderBottom: '1px solid var(--sidebar-footer-border)', paddingBottom: '24px', marginBottom: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {/* Concentric Layered Orb */}
          <div style={{
            width: '76px',
            height: '76px',
            borderRadius: '24px',
            background: 'radial-gradient(circle, rgba(56, 189, 248, 0.1) 0%, rgba(255,255,255,0.02) 100%)',
            border: '1px dashed var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            cursor: 'pointer',
            boxShadow: 'inset 0 0 12px rgba(255,255,255,0.05)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05) rotate(5deg)';
            e.currentTarget.style.borderColor = 'var(--primary-color)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
            e.currentTarget.style.borderColor = 'var(--border-color)';
          }}
          >
            <div style={{
              width: '60px',
              height: '60px',
              borderRadius: '18px',
              backgroundColor: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--glass-shadow)',
              border: '1px solid var(--border-color)'
            }}>
              <img src="/logo.jpg" alt="Logo" style={{ width: '44px', height: '44px', borderRadius: '10px', objectFit: 'contain' }} />
            </div>
          </div>

          {/* Pulse Online Indicator Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            padding: '4px 12px',
            borderRadius: '99px',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            marginTop: '14px',
            boxShadow: '0 2px 10px rgba(16, 185, 129, 0.02)'
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              display: 'inline-block',
              boxShadow: '0 0 8px #10b981',
              animation: 'pulse 2s infinite'
            }}></span>
            <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#10b981', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
              Online
            </span>
          </div>
        </div>

        <nav style={{ flex: 1, overflow: 'visible', display: 'flex', flexDirection: 'column' }}>
          <ul className="nav-links" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {hasPermission('pos') && (
              <li>
                <div 
                  className={`nav-item ${activeTab === 'pos' ? 'active' : ''}`}
                  onClick={() => setActiveTab('pos')}
                >
                  <ShoppingCart size={20} />
                  <span>POS</span>
                </div>
              </li>
            )}

            {hasPermission('dashboard') && (
              <li>
                <div 
                  className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                  onClick={() => setActiveTab('dashboard')}
                >
                  <LayoutDashboard size={20} />
                  <span>Dashboard</span>
                </div>
              </li>
            )}

            {hasPermission('pending') && (
              <li>
                <div 
                  className={`nav-item ${activeTab === 'pending' ? 'active' : ''}`}
                  onClick={() => setActiveTab('pending')}
                >
                  <Clock size={20} />
                  <span>รายการสถานะชำระเงิน</span>
                </div>
              </li>
            )}

            {hasPermission('layout') && (
              <li>
                <div 
                  className={`nav-item ${activeTab === 'layout' ? 'active' : ''}`}
                  onClick={() => setActiveTab('layout')}
                >
                  <Map size={20} />
                  <span>แผนผัง</span>
                </div>
              </li>
            )}

            {hasPermission('history') && (
              <li>
                <div 
                  className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                  onClick={() => setActiveTab('history')}
                >
                  <History size={20} />
                  <span>ประวัติย้อนหลัง</span>
                </div>
              </li>
            )}

            {hasPermission('quotations') && (
              <li>
                <div 
                  className={`nav-item ${activeTab === 'quotations' ? 'active' : ''}`}
                  onClick={() => setActiveTab('quotations')}
                >
                  <FileText size={20} />
                  <span>ใบเสนอราคา</span>
                </div>
              </li>
            )}

            {/* Collapsible Admin management (Dynamically filtered) */}
            {hasPermission('admin-management') && (
              <li 
                onMouseEnter={() => setIsAdminOpen(true)}
                onMouseLeave={() => setIsAdminOpen(false)}
                style={{ marginTop: '96px', borderTop: '1px dashed var(--border-color)', paddingTop: '16px', position: 'relative' }}
              >
                <div 
                  className={`nav-item ${(activeTab === 'admin-users' || activeTab === 'admin-system' || activeTab === 'admin-backup' || activeTab === 'admin-quotation' || activeTab === 'manage') ? 'active-parent' : ''}`}
                  style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Sliders size={20} />
                    <span>Admin management</span>
                  </div>
                  {isAdminOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </div>
                
                {/* Floating flyout submenu container */}
                {isAdminOpen && (
                  <div className="admin-flyout-menu">
                    <div className="admin-flyout-title">
                      แผงควบคุมระบบ / Admin
                    </div>
                    {hasPermission('admin-users') && (
                      <div 
                        className={`admin-flyout-item ${activeTab === 'admin-users' ? 'active' : ''}`}
                        onClick={() => {
                          setActiveTab('admin-users');
                          setIsAdminOpen(false);
                        }}
                      >
                        <Users size={15} />
                        <span>จัดการสิทธิใช้งาน</span>
                      </div>
                    )}
                    {hasPermission('manage') && (
                      <div 
                        className={`admin-flyout-item ${activeTab === 'manage' ? 'active' : ''}`}
                        onClick={() => {
                          setActiveTab('manage');
                          setIsAdminOpen(false);
                        }}
                      >
                        <Database size={15} />
                        <span>จัดการคลัง</span>
                      </div>
                    )}
                    {hasPermission('admin-system') && (
                      <div 
                        className={`admin-flyout-item ${activeTab === 'admin-system' ? 'active' : ''}`}
                        onClick={() => {
                          setActiveTab('admin-system');
                          setIsAdminOpen(false);
                        }}
                      >
                        <Receipt size={15} />
                        <span>แก้ไขใบเสร็จ</span>
                      </div>
                    )}
                    {hasPermission('admin-quotation') && (
                      <div 
                        className={`admin-flyout-item ${activeTab === 'admin-quotation' ? 'active' : ''}`}
                        onClick={() => {
                          setActiveTab('admin-quotation');
                          setIsAdminOpen(false);
                        }}
                      >
                        <FileText size={15} />
                        <span>แก้ไขใบเสนอราคา</span>
                      </div>
                    )}
                    {hasPermission('admin-backup') && (
                      <div 
                        className={`admin-flyout-item ${activeTab === 'admin-backup' ? 'active' : ''}`}
                        onClick={() => {
                          setActiveTab('admin-backup');
                          setIsAdminOpen(false);
                        }}
                      >
                        <Cloud size={15} />
                        <span>ตั้งค่าการสำรองข้อมูล</span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>ธีมการแสดงผล</span>
            <button 
              onClick={toggleTheme} 
              style={{
                background: 'transparent',
                border: 'none',
                color: '#38bdf8',
                cursor: 'pointer'
              }}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
          
          <div className="user-profile">
            <div className="user-avatar">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{user.username}</div>
              <div style={{ fontSize: '0.725rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span>{user.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'พนักงานต้อนรับ'}</span>
                <button 
                  onClick={() => setShowChangePassModal(true)} 
                  style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.725rem', cursor: 'pointer', padding: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <KeyRound size={12} /> เปลี่ยนรหัสผ่าน
                </button>
              </div>
            </div>
          </div>
          
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={16} />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="main-content">
        {activeTab === 'pos' && <BookingPOS user={user} settings={settings} sysAlert={customAlert} preselectedRoom={preselectedRoom} clearPreselectedRoom={() => setPreselectedRoom(null)} onNavigate={setActiveTab} onExportToQuotation={handleExportToQuotation} />}
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
