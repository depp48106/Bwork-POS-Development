import React, { useState, useEffect } from 'react';
import { Save, CloudLightning, CheckCircle2, AlertTriangle, Cloud, Users, UserPlus, KeyRound, Trash2, Plus, Sliders, X, Edit2, Settings, Printer, ChevronDown, Database, Smartphone } from 'lucide-react';
import DoorAccessSettings from './DoorAccessSettings';

function SettingsPanel({ viewMode, onSettingsUpdate, sysAlert, sysConfirm, sysPrompt, onClearHistory }) {
  // Config Settings
  const [configs, setConfigs] = useState({
    company_name: '',
    receipt_header: '',
    receipt_footer: '',
    onedrive_path: '',
    company_address: '',
    company_tax_id: '',
    logo_image: '',
    quotation_terms: '',
    quotation_signer: '',
    quotation_valid_days: '',
    room_alert_minutes: '15'
  });

  // DB Backup logs
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);

  // User list states
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'staff', fullname: '' });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  
  // Custom permissions settings states
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ username: '', role: 'staff', fullname: '', permissions: [], password: '' });
  const [isNewUserRoleOpen, setIsNewUserRoleOpen] = useState(false);
  const [isEditUserRoleOpen, setIsEditUserRoleOpen] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPassForm, setResetPassForm] = useState({ newPassword: '', confirmPassword: '' });

  // Roles management states
  const [roles, setRoles] = useState([]);
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [roleForm, setRoleForm] = useState({ name: '', label: '', permissions: [] });
  const [roleMode, setRoleMode] = useState(null); // 'edit' | 'create' | null

  // Quotation Sellers input state
  const [sellerInput, setSellerInput] = useState('');

  const handleAddSeller = () => {
    if (!sellerInput.trim()) return;
    const newName = sellerInput.trim();
    const currentList = configs.quotation_signer
      ? configs.quotation_signer.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
      : [];
    if (currentList.includes(newName)) {
      if (sysAlert) sysAlert('มีรายชื่อผู้ขายนี้อยู่ในระบบแล้ว');
      return;
    }
    const updated = [...currentList, newName];
    setConfigs(prev => ({ ...prev, quotation_signer: updated.join(', ') }));
    setSellerInput('');
  };

  const handleRemoveSeller = (indexToRemove) => {
    const currentList = configs.quotation_signer
      ? configs.quotation_signer.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
      : [];
    const updated = currentList.filter((_, i) => i !== indexToRemove);
    setConfigs(prev => ({ ...prev, quotation_signer: updated.join(', ') }));
  };

  useEffect(() => {
    fetchConfigs();
    if (viewMode === 'users') {
      fetchUsers();
      fetchRoles();
    }
  }, [viewMode]);

  const fetchConfigs = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setConfigs(prev => ({
          ...prev,
          ...data,
          quotation_company_name: data.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
          quotation_company_address: data.quotation_company_address || '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120',
          quotation_company_tax_id: data.quotation_company_tax_id || '0125554000401'
        }));
      }
    } catch (err) {
      console.error('Failed to load settings configs:', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch users list:', err);
    }
  };

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/roles');
      if (res.ok) {
        setRoles(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  };

  // Save General configs
  const handleSaveConfigs = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configs)
      });
      if (res.ok) {
        await sysAlert('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
        if (onSettingsUpdate) onSettingsUpdate(); // notify parent
      } else {
        await sysAlert('บันทึกการตั้งค่าล้มเหลว');
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  // Save only OneDrive path config
  const handleSaveOneDrivePath = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: configs.company_name,
          receipt_header: configs.receipt_header,
          receipt_footer: configs.receipt_footer,
          onedrive_path: configs.onedrive_path,
          company_address: configs.company_address,
          logo_image: configs.logo_image
        })
      });
      if (res.ok) {
        await sysAlert('บันทึกที่อยู่โฟลเดอร์สำหรับสำรองข้อมูล OneDrive สำเร็จ');
      } else {
        await sysAlert('บันทึกข้อมูลล้มเหลว');
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      await sysAlert('ขนาดโลโก้เกิน 2MB กรุณาเลือกรูปภาพที่มีขนาดเล็กลง');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageName: `logo_${Date.now()}_${file.name}`,
            base64Data: reader.result
          })
        });
        const data = await res.json();
        if (res.ok && data.url) {
          setConfigs(prev => ({ ...prev, logo_image: data.url }));
        } else {
          await sysAlert(data.error || 'อัปโหลดรูปภาพล้มเหลว');
        }
      } catch (err) {
        await sysAlert('เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setConfigs(prev => ({ ...prev, logo_image: '' }));
  };

  // Trigger Backup
  const handleTriggerBackup = async () => {
    setBackupLoading(true);
    setBackupStatus(null);
    try {
      const res = await fetch('/api/backup/trigger', { method: 'POST' });
      const data = await res.json();
      setBackupStatus(data);
      if (data.success) {
        await sysAlert('สำรองไฟล์ข้อมูล SQLite ไปยังโฟลเดอร์ OneDrive สำเร็จ!');
      } else {
        await sysAlert('การสำรองข้อมูลล้มเหลว: ' + data.message);
      }
    } catch (err) {
      setBackupStatus({
        success: false,
        message: 'ไม่สามารถติดต่อเซิร์ฟเวอร์หลังบ้านเพื่อทำการสำรองข้อมูลได้'
      });
    } finally {
      setBackupLoading(false);
    }
  };

  // Add new staff user
  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUser.username || !newUser.password) {
      await sysAlert('กรุณากรอกข้อมูลผู้ใช้และรหัสผ่านให้ครบถ้วน');
      return;
    }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });
      const data = await res.json();
      if (res.ok) {
        await sysAlert(`เพิ่มบัญชีผู้ใช้ "${newUser.username}" สำเร็จ`);
        setNewUser({ username: '', password: '', role: 'staff', fullname: '' });
        setShowAddUserForm(false);
        fetchUsers();
      } else {
        await sysAlert(data.error || 'ล้มเหลวในการสร้างผู้ใช้');
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการติดต่อเซิร์ฟเวอร์');
    }
  };

  // Delete staff user
  const handleDeleteUser = async (userId, username) => {
    if (username === 'admin') {
      await sysAlert('ไม่สามารถลบผู้ดูแลระบบหลัก (admin) ได้');
      return;
    }
    if (!await sysConfirm(`คุณแน่ใจว่าต้องการลบบัญชีผู้ใช้งาน "${username}" ใช่หรือไม่?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (res.ok) {
        await sysAlert(`ลบบัญชีผู้ใช้งาน "${username}" เรียบร้อย`);
        fetchUsers();
      } else {
        const data = await res.json();
        await sysAlert(data.error || 'ลบไม่สำเร็จ');
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  // Reset user password (as admin)
  const handleResetUserPassword = async (userId, username) => {
    const newPassword = await sysPrompt(`กรุณากรอกรหัสผ่านใหม่ที่ต้องการตั้งให้กับผู้ใช้ "${username}":`);
    if (newPassword === null) return; // cancel clicked
    if (!newPassword.trim()) {
      await sysAlert('รหัสผ่านต้องมีความยาวอย่างน้อย 1 ตัวอักษร');
      return;
    }

    try {
      const res = await fetch(`/api/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      if (res.ok) {
        await sysAlert(`รีเซ็ตรหัสผ่านสำหรับ "${username}" เป็นรหัสผ่านใหม่เรียบร้อยแล้ว`);
      } else {
        const data = await res.json();
        await sysAlert(data.error || 'ไม่สามารถรีเซ็ตรหัสผ่านได้');
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '950px', margin: '0 auto', width: '100%' }}>
      <div className="tab-header">
        <div>
          <h1 className="tab-title">
            {viewMode === 'users' && 'จัดการสิทธิ์บัญชีผู้ใช้'}
            {viewMode === 'system' && 'ตั้งค่าใบเสร็จ'}
            {viewMode === 'backup' && 'จัดการฐานข้อมูล'}
            {viewMode === 'quotation' && 'แก้ไขใบเสนอราคา'}
            {viewMode === 'dooraccess' && 'ระบบจอง LINE OA & รหัสเข้าห้อง'}
            {viewMode === 'general' && 'ตั้งค่าทั่วไป'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            {viewMode === 'users' && 'บริหารบัญชีพนักงานต้อนรับและแอดมิน เพื่อสิทธิ์การเปิดบิลและจัดการฐานข้อมูล'}
            {viewMode === 'system' && 'ตั้งค่าข้อมูลบริษัท ข้อความหัวใบเสร็จ และส่วนท้ายใบเสร็จพร้อมดูตัวอย่างจริง'}
            {viewMode === 'backup' && 'จัดการการสำรองข้อมูล คัดลอกฐานข้อมูล และล้างข้อมูลประวัติการทำรายการเพื่อรีเซ็ตระบบ'}
            {viewMode === 'quotation' && 'กำหนดเงื่อนไขเริ่มต้น วันหมดอายุ และชื่อผู้ลงนามบนเอกสารใบเสนอราคา'}
            {viewMode === 'dooraccess' && 'กำหนดการเชื่อมต่อ LINE Messaging API, Google Sheets Sync และสิทธิ์เวลาการเช็คอินรหัส PIN'}
            {viewMode === 'general' && 'กำหนดค่าการทำงานทั่วไปของระบบ เช่น ช่วงเวลาการเตือนก่อนห้องประชุมเริ่มใช้งาน'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* VIEW: DOOR ACCESS & LINE OA SETTINGS */}
        {viewMode === 'dooraccess' && (
          <DoorAccessSettings sysAlert={sysAlert} />
        )}
        
        {/* VIEW: SYSTEM SETTINGS */}
        {viewMode === 'system' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '28px', alignItems: 'start' }}>
            {/* Left side: The Settings Form (Liquidglass theme) */}
            <div style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: 'var(--glass-shadow)',
              borderRadius: '24px',
              margin: 0,
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--primary-color)' }}>
                <Settings size={22} />
                ตั้งค่าข้อมูลใบเสร็จ
              </h2>
              <form onSubmit={handleSaveConfigs} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* Logo Image Upload */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>โลโก้ร้าน / บริษัท (แสดงบนสุดของใบเสร็จ)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {configs.logo_image ? (
                      <div style={{ position: 'relative', display: 'inline-block' }}>
                        <img 
                          src={configs.logo_image} 
                          alt="Logo Preview" 
                          style={{ maxWidth: '100px', maxHeight: '60px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '4px', backgroundColor: '#fff' }} 
                        />
                        <button 
                          type="button" 
                          onClick={handleRemoveLogo}
                          style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 'bold' }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div style={{ 
                        border: '2px dashed var(--border-color)', 
                        borderRadius: '12px', 
                        padding: '12px', 
                        textAlign: 'center', 
                        cursor: 'pointer',
                        width: '100%',
                        position: 'relative',
                        backgroundColor: 'rgba(255,255,255,0.01)'
                      }}>
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleLogoUpload}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>คลิกเพื่ออัปโหลดโลโก้ (แนะนำภาพแนวนอน / สี่เหลี่ยมผืนผ้า)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Company Name */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label htmlFor="companyName" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>ชื่อหน่วยงาน / บริษัท</label>
                  <input 
                    id="companyName"
                    type="text" 
                    className="form-control" 
                    value={configs.company_name}
                    onChange={e => setConfigs({ ...configs, company_name: e.target.value })}
                    required
                    style={{ height: '42px', padding: '10px 14px', borderRadius: '12px', fontSize: '0.875rem' }}
                  />
                </div>

                {/* Company Address */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label htmlFor="companyAddress" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>ที่อยู่หน่วยงาน / บริษัท (แสดงใต้ชื่อบริษัท)</label>
                  <textarea 
                    id="companyAddress"
                    rows={2}
                    className="form-control" 
                    value={configs.company_address || ''}
                    onChange={e => setConfigs({ ...configs, company_address: e.target.value })}
                    placeholder="ตัวอย่าง: 88/8 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110"
                    style={{ padding: '10px 12px', borderRadius: '12px', fontSize: '0.875rem', resize: 'none', lineHeight: '1.4' }}
                  />
                </div>

                {/* Receipt Header */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label htmlFor="receiptHeader" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>ข้อความส่วนหัวใบเสร็จ</label>
                  <textarea 
                    id="receiptHeader"
                    rows={3}
                    className="form-control" 
                    value={configs.receipt_header}
                    onChange={e => setConfigs({ ...configs, receipt_header: e.target.value })}
                    required
                    style={{ padding: '10px 12px', borderRadius: '12px', fontSize: '0.875rem', resize: 'none', lineHeight: '1.4' }}
                  />
                </div>

                {/* Receipt Footer */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label htmlFor="receiptFooter" style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', display: 'block' }}>ข้อความส่วนท้ายใบเสร็จ</label>
                  <textarea 
                    id="receiptFooter"
                    rows={3}
                    className="form-control" 
                    value={configs.receipt_footer}
                    onChange={e => setConfigs({ ...configs, receipt_footer: e.target.value })}
                    required
                    style={{ padding: '10px 12px', borderRadius: '12px', fontSize: '0.875rem', resize: 'none', lineHeight: '1.4' }}
                  />
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '44px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '10px', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 20px rgba(99, 102, 241, 0.3)' }}>
                  <Save size={18} />
                  บันทึกการตั้งค่าใบเสร็จ
                </button>
              </form>
            </div>

            {/* Right side: Real receipt size live preview (approx 80mm / 320px width) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Printer size={16} className="text-primary" /> ตัวอย่างใบเสร็จจริง (Thermal 80mm)
              </span>
              
              <div 
                style={{
                  width: '320px',
                  minHeight: '450px',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  padding: '20px 16px',
                  boxSizing: 'border-box',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div 
                  className="receipt-wrapper"
                  style={{ 
                    fontSize: '13px',
                    lineHeight: 1.4,
                    padding: 0, 
                    width: '100%',
                    maxWidth: '100%'
                  }}
                >
                  <div className="receipt-header">
                    {configs.logo_image && (
                      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                        <img 
                          src={configs.logo_image} 
                          alt="Logo Preview" 
                          style={{ maxWidth: '80px', maxHeight: '50px', objectFit: 'contain' }} 
                        />
                      </div>
                    )}
                    <div className="receipt-title" style={{ fontSize: '18px', fontWeight: 'bold' }}>
                      {configs.company_name || 'ชื่อบริษัท'}
                    </div>
                    {configs.company_address && (
                      <div className="receipt-address" style={{ fontSize: '0.8em', color: '#000000', whiteSpace: 'pre-line', marginTop: '4px', fontWeight: '600', textAlign: 'center' }}>
                        {configs.company_address}
                      </div>
                    )}
                    <div className="receipt-sub" style={{ fontSize: '0.85em', whiteSpace: 'pre-line', marginTop: '6px' }}>
                      {configs.receipt_header || 'ใบเสร็จรับเงิน / ใบรับจองบริการ'}
                    </div>
                  </div>

                  <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

                  <div className="receipt-info-row" style={{ fontSize: '0.95em' }}>
                    <span>เลขที่ใบเสร็จ:</span>
                    <span style={{ fontWeight: 'bold' }}>#012345</span>
                  </div>
                  <div className="receipt-info-row" style={{ fontSize: '0.95em' }}>
                    <span>วันที่ทำรายการ:</span>
                    <span>05 ก.ค. 2569 15:45</span>
                  </div>
                  <div className="receipt-info-row" style={{ fontSize: '0.95em' }}>
                    <span>ชื่อผู้จองห้อง:</span>
                    <span style={{ fontWeight: '600' }}>คุณสมเกียรติ รักบริการ</span>
                  </div>

                  <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

                  <div className="receipt-items">
                    <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr', fontSize: '0.875em', fontWeight: 'bold', marginBottom: '8px', color: '#000000' }}>
                      <span>รายการ</span>
                      <span style={{ textAlign: 'center' }}>จำนวน</span>
                      <span style={{ textAlign: 'right' }}>รวม (บาท)</span>
                    </div>

                    <div style={{ marginBottom: '8px', borderBottom: '1px dotted #000000', paddingBottom: '4px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr', fontSize: '0.95em', color: '#000000' }}>
                        <span style={{ fontWeight: '700' }}>ห้องประชุม 301 (Standard)</span>
                        <span style={{ textAlign: 'center', fontWeight: '700' }}>3 ชม.</span>
                        <span style={{ textAlign: 'right', fontWeight: '700' }}>1,500.00</span>
                      </div>
                      <div style={{ fontSize: '0.85em', color: '#000000', paddingLeft: '4px', marginTop: '2px', fontWeight: '700' }}>
                        05 ก.ค. (09:00 - 12:00)
                      </div>
                    </div>

                    <div style={{ marginBottom: '8px', borderBottom: '1px dotted #000000', paddingBottom: '4px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr', fontSize: '0.95em', color: '#000000' }}>
                        <span style={{ fontWeight: '700' }}>โกโก้ร้อน</span>
                        <span style={{ textAlign: 'center', fontWeight: '700' }}>x2</span>
                        <span style={{ textAlign: 'right', fontWeight: '700' }}>120.00</span>
                      </div>
                    </div>
                  </div>

                  <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

                  <div className="receipt-total-section" style={{ color: '#000000' }}>
                    <div className="receipt-info-row" style={{ fontSize: '1.1em', fontWeight: 'bold', color: '#000000' }}>
                      <span>ยอดรวมสุทธิ:</span>
                      <span>1,620.00 บาท</span>
                    </div>
                    <div className="receipt-info-row" style={{ fontSize: '0.95em', fontWeight: 'bold', color: '#000000' }}>
                      <span>การชำระเงิน:</span>
                      <span>ชำระเงินแล้ว (เงินสด)</span>
                    </div>
                  </div>

                  <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

                  <div className="receipt-footer-text" style={{ fontSize: '0.85em', color: '#000000', fontWeight: '600', whiteSpace: 'pre-line' }}>
                    <p>{configs.receipt_footer || 'ขอบคุณที่ใช้บริการห้องประชุมของเรา'}</p>
                    <p style={{ marginTop: '8px', fontSize: '0.75em', color: '#000000' }}>พิมพ์โดยระบบ Bwork POS ท้องถิ่น</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: USER MANAGEMENT */}
        {viewMode === 'users' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={20} className="text-primary" />
                บัญชีผู้ใช้งานระบบทั้งหมด
              </h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '99px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)', color: 'var(--text-main)' }}
                  onClick={() => {
                    setShowRolesModal(true);
                    setEditingRole(null);
                    setRoleMode(null);
                    setRoleForm({ name: '', label: '', permissions: ['pos', 'layout', 'pending', 'history'] });
                  }}
                >
                  <Sliders size={14} />
                  <span>จัดการบทบาท & สิทธิ์</span>
                </button>
                <button 
                  className="btn btn-primary"
                  style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px', borderRadius: '99px' }}
                  onClick={() => setShowAddUserForm(!showAddUserForm)}
                >
                  <Plus size={14} /> เพิ่มบัญชีผู้ใช้ใหม่
                </button>
              </div>
            </div>

            {showAddUserForm && (
              <form onSubmit={handleCreateUser} style={{ backgroundColor: 'var(--bg-color)', padding: '20px', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
                <div style={{ fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <UserPlus size={16} className="text-primary" /> สร้างบัญชีใหม่
                </div>
                
                 <div className="form-group">
                  <label>ชื่อผู้ใช้งาน (Username)</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    required 
                    placeholder="ตัวอย่างเช่น staff_reception"
                    value={newUser.username} 
                    onChange={e => setNewUser({ ...newUser, username: e.target.value })} 
                  />
                </div>

                <div className="form-group">
                  <label>ชื่อ-นามสกุล (Full Name)</label>
                  <input 
                    type="text" 
                    className="form-control" 
                    required 
                    placeholder="ตัวอย่างเช่น สมชาย ยิ้มแย้ม"
                    value={newUser.fullname} 
                    onChange={e => setNewUser({ ...newUser, fullname: e.target.value })} 
                  />
                </div>

                <div className="grid-cols-2" style={{ gap: '12px' }}>
                  <div className="form-group">
                    <label>รหัสผ่านเริ่มต้น (Password)</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      required 
                      placeholder="ขั้นต่ำ 4 ตัวอักษร"
                      value={newUser.password} 
                      onChange={e => setNewUser({ ...newUser, password: e.target.value })} 
                  />
                  </div>
                  <div className="form-group" style={{ position: 'relative' }}>
                    <label>สิทธิ์ / บทบาท (Role)</label>
                    <div 
                      className="form-control"
                      onClick={() => setIsNewUserRoleOpen(!isNewUserRoleOpen)}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        height: '40px', 
                        fontSize: '0.9rem', 
                        borderRadius: '10px', 
                        cursor: 'pointer',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color)',
                        padding: '0 12px',
                        fontWeight: 600
                      }}
                    >
                      <span>
                        {roles.find(r => r.name === newUser.role)?.label || newUser.role}
                      </span>
                      <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                    </div>

                    {isNewUserRoleOpen && (
                      <>
                        <div onClick={() => setIsNewUserRoleOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                        <div className="liquidglass-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000, borderRadius: '12px', padding: '6px' }}>
                          {roles.map(r => (
                            <div 
                              key={r.name}
                              onClick={() => { setNewUser({ ...newUser, role: r.name }); setIsNewUserRoleOpen(false); }}
                              style={{ padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', color: newUser.role === r.name ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: newUser.role === r.name ? 'bold' : 'normal', background: newUser.role === r.name ? 'rgba(37, 99, 235, 0.15)' : 'transparent', transition: 'all 0.2s', marginBottom: '2px' }}
                              onMouseEnter={e => { if (newUser.role !== r.name) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                              onMouseLeave={e => { if (newUser.role !== r.name) e.currentTarget.style.background = 'transparent'; }}
                            >
                              {r.label}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '10px' }} onClick={() => setShowAddUserForm(false)}>ยกเลิก</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 2, padding: '10px' }}>สร้างพนักงาน</button>
                </div>
              </form>
            )}

            <div className="table-container">
              <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '14px 18px' }}>ชื่อผู้ใช้</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>บทบาท / สิทธิ์</th>
                    <th>วันที่สร้างบัญชี</th>
                    <th style={{ textAlign: 'center', padding: '14px 18px' }}>การจัดการบัญชี</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: '700', padding: '14px 18px' }}>{u.username}</td>
                      <td>{u.fullname || '-'}</td>
                      <td>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: '99px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          backgroundColor: u.role === 'admin' ? 'rgba(37, 99, 235, 0.15)' : 'var(--primary-light)',
                          color: u.role === 'admin' ? '#2563eb' : 'var(--text-muted)'
                        }}>
                          {u.role_label || u.role}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {new Date(u.created_at).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ textAlign: 'center', padding: '14px 18px' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px', gap: '4px', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-color)', color: 'var(--text-main)', cursor: 'pointer' }} 
                            onClick={() => {
                              setEditingUser(u);
                              setIsResettingPassword(false);
                              setResetPassForm({ newPassword: '', confirmPassword: '' });
                              setEditForm({
                                username: u.username,
                                role: u.role,
                                fullname: u.fullname || '',
                                password: '',
                                permissions: (u.permissions || 'pos,pending,layout,history').split(',').map(p => p.trim())
                              });
                            }}
                          >
                            <Edit2 size={12} />
                            <span>แก้ไข</span>
                          </button>
                          <button 
                            className="btn btn-danger" 
                            style={{ 
                              padding: '6px 12px', 
                              fontSize: '0.8rem', 
                              borderRadius: '8px', 
                              gap: '4px', 
                              cursor: 'pointer',
                              visibility: u.username === 'admin' ? 'hidden' : 'visible'
                            }} 
                            onClick={() => handleDeleteUser(u.id, u.username)}
                          >
                            <Trash2 size={12} />
                            <span>ลบ</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW: DATABASE BACKUP */}
        {/* VIEW: DATABASE MANAGEMENT (BACKUP & SYSTEM RESET) */}
        {viewMode === 'backup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* 💾 1. DATABASE BACKUP SECTION */}
            <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <Database size={22} className="text-primary" />
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  ระบบสำรองข้อมูล (Database Backup & Synchronization)
                </h2>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flexWrap: 'wrap' }}>
                
                {/* Left side: OneDrive Config */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
                  <form onSubmit={handleSaveOneDrivePath} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label htmlFor="onedrivePath" style={{ color: 'var(--primary-color)', fontWeight: 'bold', fontSize: '0.85rem', display: 'block', marginBottom: '6px' }}>
                        เส้นทางโฟลเดอร์ OneDrive ภายในเครื่อง
                      </label>
                      <input 
                        id="onedrivePath"
                        type="text" 
                        className="form-control" 
                        placeholder="เช่น C:\Users\ADMIN\OneDrive\POS_Backups"
                        value={configs.onedrive_path}
                        onChange={e => setConfigs({ ...configs, onedrive_path: e.target.value })}
                        required
                        style={{ fontSize: '0.85rem', padding: '8px 12px' }}
                      />
                      <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '6px', display: 'block', lineHeight: 1.4 }}>
                        * เมื่อเปิดระบบ POS ในแต่ละวัน ไฟล์ฐานข้อมูล SQLite สำรองจะถูกคัดลอกไปบันทึกไว้ในเส้นทางที่คุณระบุนี้ทันทีเพื่อให้เชื่อมโยงขึ้น OneDrive อัตโนมัติ
                      </span>
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', gap: '8px', borderRadius: '12px', height: '40px', fontSize: '0.85rem', fontWeight: 'bold' }}>
                      <Save size={16} />
                      <span>บันทึกเส้นทางสำรองข้อมูล</span>
                    </button>
                  </form>
                </div>

                {/* Right side: Manual Trigger Backup */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderLeft: '1px solid var(--border-color)', paddingLeft: '24px' }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CloudLightning size={16} className="text-primary" />
                    คัดลอกสำรองข้อมูลด่วนด้วยตนเอง
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                    ปกติระบบจะทำการซิงค์ไฟล์เป็นประจำเมื่อเปิดโปรแกรม หากต้องการสำรองข้อมูลด่วนเดี่ยวนี้ สามารถกดทำรายการคัดลอกไฟล์ได้ทันที
                  </p>

                  <button 
                    className="btn btn-secondary" 
                    style={{ 
                      width: '100%', 
                      gap: '8px', 
                      color: 'var(--primary-color)', 
                      borderColor: 'var(--primary-color)',
                      borderRadius: '12px',
                      height: '40px',
                      fontSize: '0.85rem',
                      fontWeight: 'bold',
                      marginTop: '8px'
                    }}
                    onClick={handleTriggerBackup}
                    disabled={backupLoading}
                  >
                    <Cloud size={16} />
                    <span>{backupLoading ? 'กำลังสร้างไฟล์สำรอง...' : 'กดบันทึกไฟล์ SQLite ด่วนทันที'}</span>
                  </button>

                  {backupStatus && (
                    <div style={{
                      marginTop: '8px',
                      padding: '12px 14px',
                      borderRadius: '12px',
                      fontSize: '0.775rem',
                      border: '1px solid',
                      borderColor: backupStatus.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      backgroundColor: backupStatus.success ? 'var(--success-bg)' : 'var(--danger-bg)',
                      color: backupStatus.success ? 'var(--success-color)' : 'var(--danger-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px'
                    }}>
                      <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {backupStatus.success ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                        {backupStatus.message}
                      </div>
                      {backupStatus.success && (
                        <div style={{ fontSize: '0.7rem', opacity: 0.85, marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div><strong>ชื่อไฟล์:</strong> {backupStatus.fileName}</div>
                          <div style={{ wordBreak: 'break-all' }}><strong>พาธ:</strong> {backupStatus.path}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* 🚨 2. SYSTEM RESET / CLEAR OPERATION HISTORY SECTION */}
            <div className="card" style={{ 
              padding: '24px', 
              borderRadius: '24px', 
              border: '1px solid rgba(239, 68, 68, 0.25)', 
              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.02), rgba(239, 68, 68, 0.05))',
              boxShadow: '0 8px 32px rgba(239, 68, 68, 0.03)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', borderBottom: '1px solid rgba(239, 68, 68, 0.15)', paddingBottom: '12px' }}>
                <Trash2 size={22} style={{ color: 'var(--danger-color)' }} />
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--danger-color)' }}>
                  ล้างข้อมูลและประวัติการใช้งานระบบ (System Data Reset)
                </h2>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '280px' }}>
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-main)', margin: '0 0 8px 0', fontWeight: 'bold' }}>
                    ลบประวัติการทำธุรกรรมทั้งหมดและเริ่มต้นระบบนับหนึ่งใหม่
                  </p>
                  <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    ปุ่มนี้จะทำการลบประวัติการจองห้องประชุมทั้งหมด, ประวัติการชำระเงินบิลหน้าร้าน, และประวัติการจัดทำเอกสารใบเสนอราคาทั้งหมดแบบถาวร (รวมถึงรีเซ็ตเลขที่รันบิลกลับไปเริ่มต้นใหม่ด้วย)
                  </p>
                  <div style={{ 
                    marginTop: '12px', 
                    padding: '8px 12px', 
                    borderRadius: '8px', 
                    backgroundColor: 'rgba(239, 68, 68, 0.08)', 
                    color: 'var(--danger-color)', 
                    fontSize: '0.725rem', 
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <AlertTriangle size={12} />
                    <span>ข้อมูลสินค้า คลังห้องประชุม บริการเสริม และบัญชีสิทธิ์พนักงานจะไม่มีการเปลี่ยนแปลงใดๆ</span>
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  <button 
                    type="button"
                    className="btn"
                    style={{ 
                      padding: '12px 24px', 
                      borderRadius: '16px', 
                      fontSize: '0.875rem', 
                      fontWeight: 800, 
                      backgroundColor: 'var(--danger-color)',
                      border: 'none',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 16px rgba(239, 68, 68, 0.25)',
                      transition: 'all 0.2s'
                    }}
                    onClick={onClearHistory}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(239, 68, 68, 0.35)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 16px rgba(239, 68, 68, 0.25)';
                    }}
                  >
                    <Trash2 size={18} />
                    <span>สั่งล้างประวัติการทำรายการด่วน</span>
                  </button>
                </div>
              </div>

            </div>

          </div>
        )}

        {viewMode === 'quotation' && (
          <div className="card" style={{ maxWidth: '680px', padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '18px', color: 'var(--primary-color)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              ตั้งค่าเอกสารใบเสนอราคาและข้อมูลบริษัท
            </h2>
            <form onSubmit={handleSaveConfigs} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ชื่อบริษัทของเรา (สำหรับใบเสนอราคา)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={configs.quotation_company_name || ''} 
                  onChange={e => setConfigs({ ...configs, quotation_company_name: e.target.value })} 
                  placeholder="เช่น บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)..."
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ชื่อบริษัทที่แสดงบริเวณส่วนหัวของเอกสารใบเสนอราคา (แยกอิสระจากใบเสร็จรับเงิน)</span>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ที่อยู่บริษัทของเรา (สำหรับใบเสนอราคา)</label>
                <textarea 
                  className="form-control" 
                  rows="2"
                  value={configs.quotation_company_address || ''} 
                  onChange={e => setConfigs({ ...configs, quotation_company_address: e.target.value })} 
                  placeholder="เช่น 98 หมู่ 2 อาคารบีเวิร์ค ยูนิต602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35..."
                  style={{ borderRadius: '12px', padding: '10px', fontSize: '0.85rem' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ที่อยู่บริษัทที่แสดงใต้ชื่อบริษัทในใบเสนอราคา</span>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>เลขประจำตัวผู้เสียภาษี (สำหรับใบเสนอราคา)</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={configs.quotation_company_tax_id || ''} 
                  onChange={e => setConfigs({ ...configs, quotation_company_tax_id: e.target.value })} 
                  placeholder="เช่น 0125554000401..."
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>เลขประจำตัวผู้เสียภาษีอากร 13 หลัก สำหรับแสดงในใบเสนอราคา</span>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ภาพลายเซ็นผู้อนุมัติ 1 (Signature 1)</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
                  {configs.quotation_signature_image ? (
                    <div style={{ position: 'relative', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '8px', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img 
                        src={configs.quotation_signature_image} 
                        alt="ลายเซ็นผู้อนุมัติ 1" 
                        style={{ height: '48px', maxWidth: '180px', objectFit: 'contain' }} 
                      />
                      <button
                        type="button"
                        onClick={() => setConfigs({ ...configs, quotation_signature_image: '' })}
                        style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'var(--danger-color)', color: '#ffffff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
                        title="ลบลายเซ็น"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <input 
                        type="file" 
                        accept="image/*"
                        className="form-control"
                        onChange={e => {
                          const file = e.target.files[0];
                          if (file) {
                            if (file.size > 2 * 1024 * 1024) {
                              if (sysAlert) sysAlert('ขนาดไฟล์ลายเซ็นต้องไม่เกิน 2MB');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = (uploadEvent) => {
                              setConfigs({ ...configs, quotation_signature_image: uploadEvent.target.result });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        style={{ fontSize: '0.85rem', padding: '6px 12px' }}
                      />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  อัปโหลดไฟล์ภาพลายเซ็นหลัก สำหรับแสดงตรงช่อง 'ผู้อนุมัติ' ในเอกสารใบเสนอราคา
                </span>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ภาพลายเซ็นผู้อนุมัติ 2 (Signature 2 - ถ้ามี)</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
                  {configs.quotation_signature_image2 ? (
                    <div style={{ position: 'relative', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '8px', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img 
                        src={configs.quotation_signature_image2} 
                        alt="ลายเซ็นผู้อนุมัติ 2" 
                        style={{ height: '48px', maxWidth: '180px', objectFit: 'contain' }} 
                      />
                      <button
                        type="button"
                        onClick={() => setConfigs({ ...configs, quotation_signature_image2: '' })}
                        style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'var(--danger-color)', color: '#ffffff', border: 'none', borderRadius: '50%', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}
                        title="ลบลายเซ็น"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <input 
                        type="file" 
                        accept="image/*"
                        className="form-control"
                        onChange={e => {
                          const file = e.target.files[0];
                          if (file) {
                            if (file.size > 2 * 1024 * 1024) {
                              if (sysAlert) sysAlert('ขนาดไฟล์ลายเซ็นต้องไม่เกิน 2MB');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = (uploadEvent) => {
                              setConfigs({ ...configs, quotation_signature_image2: uploadEvent.target.result });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        style={{ fontSize: '0.85rem', padding: '6px 12px' }}
                      />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  อัปโหลดภาพลายเซ็นที่ 2 (หากต้องการให้มี 2 ลายเซ็นบนเอกสารใบเสนอราคา)
                </span>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>จำนวนวันเสนอราคาเริ่มต้น (Valid Days)</label>
                <input 
                  type="number" 
                  className="form-control" 
                  min="1"
                  value={configs.quotation_valid_days || ''} 
                  onChange={e => setConfigs({ ...configs, quotation_valid_days: e.target.value })} 
                  placeholder="เช่น 7, 15, 30 วัน..."
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>จำนวนวันเสนอราคานับตั้งแต่วันที่ออกเอกสารใบเสนอราคา</span>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 650, marginBottom: '6px', display: 'block' }}>
                  รายชื่อผู้มีอำนาจลงนาม / ผู้ขาย
                </label>
                
                {/* Input box and Add button */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <input 
                    type="text" 
                    className="form-control" 
                    value={sellerInput} 
                    onChange={e => setSellerInput(e.target.value)} 
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSeller();
                      }
                    }}
                    placeholder="พิมพ์ชื่อ-นามสกุล ผู้มีอำนาจลงนาม/ผู้ขาย แล้วกดปุ่มแอด..."
                    style={{ flex: 1, height: '40px', borderRadius: '12px', fontSize: '0.85rem' }}
                  />
                  <button 
                    type="button" 
                    onClick={handleAddSeller}
                    className="btn btn-primary"
                    title="เพิ่มรายชื่อผู้ขาย"
                    style={{ width: '40px', height: '40px', padding: 0, borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Plus size={20} />
                  </button>
                </div>

                {/* Display list of added sellers */}
                {(() => {
                  const currentList = configs.quotation_signer
                    ? configs.quotation_signer.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
                    : [];
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', minHeight: '42px', padding: '10px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
                      {currentList.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>ยังไม่มีรายชื่อ (กรุณาพิมพ์ชื่อแล้วกดปุ่มแอด)</span>
                      ) : (
                        currentList.map((name, idx) => (
                          <div 
                            key={idx} 
                            style={{ 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '6px', 
                              padding: '5px 12px', 
                              background: 'var(--bg-card)', 
                              border: '1px solid var(--border-color)', 
                              borderRadius: '99px',
                              fontSize: '0.8rem',
                              fontWeight: 'bold',
                              color: 'var(--text-main)',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                            }}
                          >
                            <span>{name}</span>
                            <button 
                              type="button" 
                              onClick={() => handleRemoveSeller(idx)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px', borderRadius: '50%' }}
                              title="ลบรายชื่อนี้"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })()}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                  รายชื่อผู้มีอำนาจลงนาม/ผู้ขายที่แอดไว้ที่นี่ จะถูกนำไปเป็นตัวเลือก Liquidglass Dropdown ในช่อง 'ผู้ขาย' ของใบเสนอราคา
                </span>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>เงื่อนไขการจองและชำระเงินเริ่มต้น (Terms & Conditions)</label>
                <textarea 
                  className="form-control" 
                  rows="4"
                  value={configs.quotation_terms || ''} 
                  onChange={e => setConfigs({ ...configs, quotation_terms: e.target.value })} 
                  placeholder="เช่น &#10;- ชำระมัดจำ 50% &#10;- ส่วนที่เหลือชำระวันเข้างาน..."
                  style={{ borderRadius: '12px', padding: '10px', fontSize: '0.85rem' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>เงื่อนไขต่าง ๆ ที่ระบุตรงช่องเงื่อนไขด้านซ้ายในเอกสารใบเสนอราคา (สามารถกดขึ้นบรรทัดใหม่ได้)</span>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px', borderRadius: '12px', marginTop: '8px', gap: '8px' }}>
                <Save size={16} />
                บันทึกการตั้งค่าใบเสนอราคา
              </button>
            </form>
          </div>
        )}

        {/* VIEW: GENERAL SETTINGS */}
        {viewMode === 'general' && (
          <div className="card" style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: '24px',
            padding: '28px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.05)',
            maxWidth: '680px'
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '18px', color: 'var(--primary-color)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
              ตั้งค่าข้อมูลบริษัท (สำหรับใบเสร็จรับเงิน) และระบบทั่วไป
            </h2>
            <form onSubmit={handleSaveConfigs} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  ชื่อบริษัทของเรา (สำหรับพิมพ์ใบเสร็จรับเงิน)
                </label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={configs.company_name || ''} 
                  onChange={e => setConfigs({ ...configs, company_name: e.target.value })} 
                  placeholder="เช่น บริษัท ดีพมายด์ โซลูชั่น จำกัด..."
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>ชื่อบริษัทที่แสดงส่วนหัวของใบเสร็จรับเงิน/สลิปหน้าร้าน</span>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  ที่อยู่บริษัทของเรา (สำหรับพิมพ์ใบเสร็จรับเงิน)
                </label>
                <textarea 
                  className="form-control" 
                  rows="2"
                  value={configs.company_address || ''} 
                  onChange={e => setConfigs({ ...configs, company_address: e.target.value })} 
                  placeholder="เช่น ที่อยู่บริษัทสำหรับพิมพ์บนใบเสร็จ..."
                  style={{ borderRadius: '12px', padding: '10px', fontSize: '0.85rem' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>ที่อยู่บริษัทที่แสดงบนใบเสร็จรับเงิน</span>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  เลขประจำตัวผู้เสียภาษี (สำหรับพิมพ์ใบเสร็จรับเงิน)
                </label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={configs.company_tax_id || ''} 
                  onChange={e => setConfigs({ ...configs, company_tax_id: e.target.value })} 
                  placeholder="เช่น 0125554000401..."
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  เวลาแจ้งเตือนก่อนถึงกำหนดเวลาใช้งานห้องประชุม (นาที)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input 
                    type="number" 
                    className="form-control" 
                    required
                    min="1"
                    max="120"
                    style={{ width: '120px', height: '40px', borderRadius: '10px', textAlign: 'center', fontWeight: 'bold' }}
                    value={configs.room_alert_minutes || '15'} 
                    onChange={e => setConfigs({ ...configs, room_alert_minutes: e.target.value })} 
                  />
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>นาที</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block', lineHeight: 1.4 }}>
                  ระบุจำนวนนาทีล่วงหน้าที่จะแสดงป๊อปอัปแจ้งเตือนสไตล์ LINE บริเวณมุมขวา-ล่างของหน้าจอ เมื่อคิวการจองของห้องต่าง ๆ ใกล้เริ่มใช้งาน
                </span>
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', padding: '12px', borderRadius: '12px', marginTop: '8px', gap: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Save size={16} />
                <span>บันทึกการตั้งค่าทั่วไป</span>
              </button>
            </form>
          </div>
        )}

       {/* Modal for editing user details (Unified Modal) */}
        {editingUser && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }} onClick={() => setEditingUser(null)}>
            <div style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '24px',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--glass-shadow)',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
              color: 'var(--text-main)',
              animation: 'fadeIn 0.2s ease-out'
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isResettingPassword ? <KeyRound size={20} className="text-primary" /> : <Sliders size={20} className="text-primary" />}
                  <span>{isResettingPassword ? `เปลี่ยนรหัสผ่านใหม่: ${editingUser.username}` : `แก้ไขข้อมูลบัญชีผู้ใช้: ${editingUser.username}`}</span>
                </h2>
                <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setEditingUser(null)}>
                  <X size={22} />
                </button>
              </div>

              {isResettingPassword ? (
                /* Reset Password View */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>รหัสผ่านใหม่ (New Password)</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      value={resetPassForm.newPassword}
                      onChange={e => setResetPassForm({ ...resetPassForm, newPassword: e.target.value })}
                      placeholder="ป้อนรหัสผ่านใหม่อย่างน้อย 4 ตัวอักษร"
                      style={{ height: '40px', borderRadius: '10px' }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>ยืนยันรหัสผ่านใหม่ (Confirm Password)</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      value={resetPassForm.confirmPassword}
                      onChange={e => setResetPassForm({ ...resetPassForm, confirmPassword: e.target.value })}
                      placeholder="ป้อนรหัสผ่านใหม่อีกครั้งเพื่อยืนยัน"
                      style={{ height: '40px', borderRadius: '10px' }}
                    />
                  </div>
                </div>
              ) : (
                /* Edit User Details View */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                  {/* Username Field */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>ชื่อผู้ใช้งาน (Username)</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      disabled={editingUser.username === 'admin'}
                      value={editForm.username}
                      onChange={e => setEditForm({ ...editForm, username: e.target.value })}
                      placeholder="เช่น reception_bwork"
                      style={{ height: '40px', borderRadius: '10px' }}
                    />
                    {editingUser.username === 'admin' && (
                      <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                        บัญชีผู้ดูแลระบบหลัก (admin) ไม่สามารถเปลี่ยนชื่อผู้ใช้งานได้
                      </span>
                    )}
                  </div>

                  {/* Fullname Field */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>ชื่อ-นามสกุล (Full Name)</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={editForm.fullname}
                      onChange={e => setEditForm({ ...editForm, fullname: e.target.value })}
                      placeholder="เช่น สมชาย ใจดี"
                      style={{ height: '40px', borderRadius: '10px' }}
                    />
                  </div>

                  {/* Role Field */}
                  <div className="form-group" style={{ margin: 0, position: 'relative' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>สิทธิ์ / บทบาท (Role)</label>
                    <div 
                      className="form-control"
                      onClick={() => {
                        if (editingUser.username !== 'admin') {
                          setIsEditUserRoleOpen(!isEditUserRoleOpen);
                        }
                      }}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        height: '40px', 
                        fontSize: '0.9rem', 
                        borderRadius: '10px', 
                        cursor: editingUser.username === 'admin' ? 'not-allowed' : 'pointer',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color)',
                        padding: '0 12px',
                        fontWeight: 600,
                        opacity: editingUser.username === 'admin' ? 0.6 : 1
                      }}
                    >
                      <span>
                        {roles.find(r => r.name === editForm.role)?.label || editForm.role}
                      </span>
                      {editingUser.username !== 'admin' && <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
                    </div>

                    {isEditUserRoleOpen && editingUser.username !== 'admin' && (
                      <>
                        <div onClick={() => setIsEditUserRoleOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                        <div className="liquidglass-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000, borderRadius: '12px', padding: '6px' }}>
                          {roles.map(r => (
                            <div 
                              key={r.name}
                              onClick={() => {
                                const rName = r.name;
                                const matchedRole = roles.find(role => role.name === rName);
                                const defaultPerms = matchedRole ? matchedRole.permissions.split(',').map(p => p.trim()) : [];
                                setEditForm({ ...editForm, role: rName, permissions: defaultPerms });
                                setIsEditUserRoleOpen(false);
                              }}
                              style={{ padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', color: editForm.role === r.name ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: editForm.role === r.name ? 'bold' : 'normal', background: editForm.role === r.name ? 'rgba(37, 99, 235, 0.15)' : 'transparent', transition: 'all 0.2s', marginBottom: '2px' }}
                              onMouseEnter={e => { if (editForm.role !== r.name) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                              onMouseLeave={e => { if (editForm.role !== r.name) e.currentTarget.style.background = 'transparent'; }}
                            >
                              {r.label}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Password reset action button */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>การรักษาความปลอดภัย</label>
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      style={{ 
                        padding: '8px 16px', 
                        fontSize: '0.8rem', 
                        borderRadius: '10px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        backgroundColor: 'var(--bg-hover)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-main)',
                        cursor: 'pointer',
                        height: '40px'
                      }}
                      onClick={() => {
                        setResetPassForm({ newPassword: '', confirmPassword: '' });
                        setIsResettingPassword(true);
                      }}
                    >
                      <KeyRound size={14} />
                      <span>รีเซ็ตรหัสผ่านใหม่...</span>
                    </button>
                  </div>
                </div>
              )}

              {isResettingPassword ? (
                /* Password Reset Footer Buttons */
                <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '4px' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1, padding: '10px 16px', borderRadius: '99px', height: '40px', fontSize: '0.875rem' }} 
                    onClick={() => setIsResettingPassword(false)}
                  >
                    ย้อนกลับ
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    style={{ flex: 2, padding: '10px 16px', borderRadius: '99px', height: '40px', fontSize: '0.875rem' }}
                    onClick={async () => {
                      const { newPassword, confirmPassword } = resetPassForm;
                      if (newPassword.trim().length < 4) {
                        sysAlert('รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร');
                        return;
                      }
                      if (newPassword !== confirmPassword) {
                        sysAlert('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน');
                        return;
                      }
                      try {
                        const res = await fetch(`/api/users/${editingUser.id}/reset-password`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ newPassword: newPassword.trim() })
                        });
                        if (res.ok) {
                          await sysAlert('รีเซ็ตรหัสผ่านสำเร็จแล้ว');
                          setIsResettingPassword(false);
                        } else {
                          const data = await res.json();
                          sysAlert(data.error || 'รีเซ็ตรหัสผ่านล้มเหลว');
                        }
                      } catch (e) {
                        sysAlert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อรีเซ็ตรหัสผ่านได้');
                      }
                    }}
                  >
                    บันทึกรหัสผ่านใหม่
                  </button>
                </div>
              ) : (
                /* Edit User Details Footer Buttons */
                <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '4px' }}>
                  <button type="button" className="btn btn-secondary" style={{ flex: 1, padding: '10px 16px', borderRadius: '99px', height: '40px', fontSize: '0.875rem' }} onClick={() => setEditingUser(null)}>
                    ยกเลิก
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    style={{ flex: 2, padding: '10px 16px', borderRadius: '99px', height: '40px', fontSize: '0.875rem' }}
                    onClick={async () => {
                      if (!editForm.username.trim()) {
                        sysAlert('กรุณากรอกชื่อผู้ใช้งาน');
                        return;
                      }
                      try {
                        const res = await fetch(`/api/users/${editingUser.id}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            username: editForm.username,
                            role: editForm.role,
                            fullname: editForm.fullname
                          })
                        });
                        if (res.ok) {
                          setEditingUser(null);
                          fetchUsers();
                          sysAlert('บันทึกข้อมูลบัญชีผู้ใช้เรียบร้อยแล้ว');
                        } else {
                          const data = await res.json();
                          sysAlert(data.error || 'บันทึกข้อมูลล้มเหลว');
                        }
                      } catch (e) {
                        sysAlert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกข้อมูลได้');
                      }
                    }}
                  >
                    บันทึกข้อมูล
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

       {/* Roles Management Modal */}
        {showRolesModal && (
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
            padding: '16px'
          }} onClick={() => setShowRolesModal(false)}>
            <div style={{
              maxWidth: '800px',
              width: '100%',
              backgroundColor: 'var(--bg-card)',
              borderRadius: '24px',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--glass-shadow)',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              color: 'var(--text-main)',
              animation: 'fadeIn 0.2s ease-out'
            }} onClick={(e) => e.stopPropagation()}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sliders size={20} className="text-primary" />
                  <span>จัดการบทบาทผู้ใช้งาน & สิทธิ์พื้นฐาน (Roles Management)</span>
                </h2>
                <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowRolesModal(false)}>
                  <X size={22} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', minHeight: '360px' }}>
                {/* Role List */}
                 <div style={{ borderRight: '1px solid var(--border-color)', paddingRight: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-muted)' }}>บทบาททั้งหมดในระบบ</h3>
                    <button 
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRole(null);
                        setRoleMode('create');
                        setRoleForm({ name: '', label: '', permissions: ['pos', 'layout', 'pending', 'history'] });
                      }}
                    >
                      <Plus size={12} />
                      เพิ่ม Role
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
                    {roles.map(r => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: '16px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{r.label}</div>
                          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>รหัสบทบาท: {r.name}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button 
                              type="button"
                              className="btn btn-secondary" 
                              style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px', cursor: 'pointer' }}
                              onClick={() => {
                                setEditingRole(r);
                                setRoleMode('edit');
                                setRoleForm({
                                  name: r.name,
                                  label: r.label,
                                  permissions: r.permissions.split(',').map(p => p.trim())
                                });
                              }}
                            >
                              แก้ไข
                            </button>
                          {!r.is_system && (
                            <button 
                              type="button"
                              className="btn btn-danger" 
                              style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px', cursor: 'pointer' }}
                              onClick={async () => {
                                if (await sysConfirm(`คุณแน่ใจหรือไม่ว่าต้องการลบบทบาท "${r.label}"?`)) {
                                  try {
                                    const res = await fetch(`/api/roles/${r.id}`, { method: 'DELETE' });
                                    if (res.ok) {
                                      fetchRoles();
                                      sysAlert('ลบบทบาทเรียบร้อยแล้ว');
                                    } else {
                                      const data = await res.json();
                                      sysAlert(data.error || 'ล้มเหลวในการลบ');
                                    }
                                  } catch (e) {
                                    sysAlert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
                                  }
                                }
                              }}
                            >
                              ลบ
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {!roleMode ? (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      minHeight: '300px',
                      border: '2px dashed var(--border-color)',
                      borderRadius: '16px',
                      padding: '24px',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      backgroundColor: 'rgba(255,255,255,0.01)'
                    }}>
                      <Sliders size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>จัดการบทบาทผู้ใช้งาน</span>
                      <p style={{ fontSize: '0.75rem', margin: '6px 0 0 0', maxWidth: '240px', lineHeight: '1.4' }}>
                        คลิกปุ่ม <strong>"แก้ไข"</strong> ในบทบาทที่ต้องการปรับปรุง หรือคลิกปุ่ม <strong>"+ เพิ่ม Role"</strong> เพื่อสร้างบทบาทใหม่
                      </p>
                    </div>
                  ) : (
                    <>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                        {editingRole ? `แก้ไขบทบาท: ${editingRole.label}` : 'สร้างบทบาทใหม่'}
                      </h3>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.775rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>รหัสบทบาท (Role Key - ภาษาอังกฤษเท่านั้น)</label>
                          <input 
                            type="text" 
                            className="form-control"
                            disabled={!!editingRole}
                            value={roleForm.name}
                            onChange={e => setRoleForm({ ...roleForm, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                            placeholder="เช่น manager, cashier"
                            style={{ height: '36px', borderRadius: '8px', fontSize: '0.8rem' }}
                          />
                        </div>

                        <div className="form-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.775rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>ชื่อแสดงผล (Display Label)</label>
                          <input 
                            type="text" 
                            className="form-control"
                            value={roleForm.label}
                            onChange={e => setRoleForm({ ...roleForm, label: e.target.value })}
                            placeholder="เช่น ผู้จัดการกะ, แคชเชียร์"
                            style={{ height: '36px', borderRadius: '8px', fontSize: '0.8rem' }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: '0.775rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>สิทธิ์เข้าใช้งานเริ่มต้น (Default Permissions)</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border-color)', padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(0,0,0,0.1)' }}>
                            {[
                              { key: 'pos', label: 'จุดขาย POS' },
                              { key: 'dashboard', label: 'Dashboard สรุปยอด' },
                              { key: 'pending', label: 'รายการรอชำระเงิน' },
                              { key: 'layout', label: 'แผนผังห้องประชุม' },
                              { key: 'manage', label: 'คลังสินค้า & ห้องประชุม' },
                              { key: 'history', label: 'ประวัติการจองย้อนหลัง' },
                              { key: 'quotations', label: 'ใบเสนอราคา' },
                              { key: 'admin-users', label: 'จัดการผู้ใช้ & บทบาท' },
                              { key: 'admin-system', label: 'ตั้งค่าระบบ & ใบเสร็จ' },
                              { key: 'admin-backup', label: 'สำรองข้อมูล (Backup)' }
                            ].map(menu => {
                              const checked = Array.isArray(roleForm.permissions) && roleForm.permissions.includes(menu.key);
                              return (
                                <label key={menu.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.775rem', cursor: 'pointer', color: checked ? 'var(--text-main)' : 'var(--text-muted)' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={checked}
                                    onChange={() => {
                                      const currentPerms = Array.isArray(roleForm.permissions) ? roleForm.permissions : [];
                                      if (checked) {
                                        setRoleForm({ ...roleForm, permissions: currentPerms.filter(k => k !== menu.key) });
                                      } else {
                                        setRoleForm({ ...roleForm, permissions: [...currentPerms, menu.key] });
                                      }
                                    }}
                                  />
                                  <span>{menu.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <button 
                            type="button" 
                            className="btn btn-secondary" 
                            style={{ flex: 1, height: '36px', fontSize: '0.8rem', borderRadius: '8px', cursor: 'pointer' }}
                            onClick={() => {
                              setEditingRole(null);
                              setRoleMode(null);
                              setRoleForm({ name: '', label: '', permissions: ['pos', 'layout', 'pending', 'history'] });
                            }}
                          >
                            ล้างฟอร์ม
                          </button>
                          <button 
                            type="button" 
                            className="btn btn-primary" 
                            style={{ flex: 1.5, height: '36px', fontSize: '0.8rem', borderRadius: '8px', cursor: 'pointer' }}
                            onClick={async () => {
                              if (!roleForm.name.trim() || !roleForm.label.trim()) {
                                sysAlert('กรุณากรอกข้อมูลให้ครบถ้วน (รหัสบทบาท และ ชื่อแสดงผล)');
                                return;
                              }
                              try {
                                let res;
                                const permStr = Array.isArray(roleForm.permissions) ? roleForm.permissions.join(',') : '';
                                if (editingRole) {
                                  res = await fetch(`/api/roles/${editingRole.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      name: roleForm.name.trim(),
                                      label: roleForm.label.trim(),
                                      permissions: permStr
                                    })
                                  });
                                } else {
                                  res = await fetch('/api/roles', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      name: roleForm.name.trim(),
                                      label: roleForm.label.trim(),
                                      permissions: permStr
                                    })
                                  });
                                }

                                if (res.ok) {
                                  sysAlert(editingRole ? 'บันทึกบทบาทสำเร็จ' : 'สร้างบทบาทใหม่สำเร็จแล้ว');
                                  setEditingRole(null);
                                  setRoleMode(null);
                                  setRoleForm({ name: '', label: '', permissions: ['pos', 'layout', 'pending', 'history'] });
                                  fetchRoles();
                                  fetchUsers();
                                } else {
                                  const data = await res.json();
                                  sysAlert(data.error || 'บันทึกบทบาทล้มเหลว');
                                }
                              } catch (e) {
                                sysAlert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
                              }
                            }}
                          >
                            {editingRole ? 'บันทึกข้อมูล' : 'สร้างบทบาท'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default SettingsPanel;
