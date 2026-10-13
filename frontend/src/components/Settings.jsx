import React, { useState, useEffect, useRef } from 'react';
import { Save, CloudLightning, CheckCircle2, AlertTriangle, Cloud, Users, UserPlus, KeyRound, Trash2, Plus, Sliders, X, Edit2, Settings, Printer, ChevronDown, Database, Smartphone, CreditCard, Building2, Download, RefreshCw, ExternalLink, ShieldCheck, Clock, FileText, UploadCloud, RotateCcw, Upload } from 'lucide-react';
import DoorAccessSettings from './DoorAccessSettings';
import PromotionSettings from './PromotionSettings';

function SettingsPanel({ viewMode, currentUser, onUserUpdate, onSettingsUpdate, sysAlert, sysConfirm, sysPrompt, onClearHistory }) {
  // Config Settings
  const [configs, setConfigs] = useState({
    company_name: '',
    receipt_header: '',
    receipt_footer: '',
    onedrive_path: '',
    company_address: '',
    company_tax_id: '',
    logo_image: '',
    quotation_company_name: 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)',
    quotation_company_address: '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต 602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120',
    quotation_company_tax_id: '0125554000401',
    quotation_company_phone: '02-123-4567',
    quotation_company_email: 'coworking@bwork.biz',
    quotation_bank_name: 'ธนาคารกรุงศรีอยุธยา (Krungsri Bank) สาขา ซอฟต์แวร์ ปาร์ค',
    quotation_bank_account_name: 'บริษัท บิลท์ ฮาร์ท จำกัด (Built Heart Co., Ltd.)',
    quotation_bank_account_no: '329-1-38429-0',
    quotation_payment_notice: 'coworking@bwork.biz หรือ LINE Official: @bwork',
    quotation_terms: '',
    quotation_signer: 'คุณสมชาย ชื่นใจ (ฝ่ายขาย), คุณโอ ภัทรพล (ผู้จัดการ), คุณนภัสสรณ์ (บริการลูกค้า)',
    quotation_valid_days: '7',
    quotation_default_vat: '1',
    quotation_default_wht: '0',
    quotation_signature_image: '',
    quotation_signature_image2: '',
    room_alert_minutes: '15',
    cleaning_buffer_minutes: '30',
    promptpay_id: '',
    payment_bank_name: '',
    payment_bank_account: '',
    payment_bank_account_name: '',
    payment_window_minutes: '15',
    wifi_ssid: '@BWORK'
  });

  // DB Backup logs & OneDrive Cloud
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [oneDriveStatus, setOneDriveStatus] = useState({
    connected: false,
    userEmail: '',
    lastBackup: null,
    lastFile: '',
    clientId: ''
  });
  const [oneDriveLoading, setOneDriveLoading] = useState(false);
  const [downloadSqlLoading, setDownloadSqlLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const restoreInputRef = useRef(null);

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

  const handleAddSeller = async () => {
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
    const updatedSigners = updated.join(', ');
    setConfigs(prev => ({ ...prev, quotation_signer: updatedSigners }));
    setSellerInput('');

    try {
      const token = localStorage.getItem('token') || '';
      await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ quotation_signer: updatedSigners })
      });
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (err) {
      console.error('Failed to auto-save signer:', err);
    }
  };

  const handleRemoveSeller = async (indexToRemove) => {
    const currentList = configs.quotation_signer
      ? configs.quotation_signer.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
      : [];
    const updated = currentList.filter((_, i) => i !== indexToRemove);
    const updatedSigners = updated.join(', ');
    setConfigs(prev => ({ ...prev, quotation_signer: updatedSigners }));

    try {
      const token = localStorage.getItem('token') || '';
      await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ quotation_signer: updatedSigners })
      });
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (err) {
      console.error('Failed to auto-save signer removal:', err);
    }
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
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/settings', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
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
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/users', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch users list:', err);
    }
  };

  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/roles', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
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
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(configs)
      });
      if (res.ok) {
        if (sysAlert) await sysAlert('บันทึกการตั้งค่าระบบเรียบร้อยแล้ว');
        if (onSettingsUpdate) await onSettingsUpdate(); // notify parent
        fetchConfigs();
      } else {
        const data = await res.json().catch(() => ({}));
        if (sysAlert) await sysAlert(data.error || 'บันทึกการตั้งค่าล้มเหลว');
      }
    } catch (err) {
      if (sysAlert) await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อ');
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

  // Fetch OneDrive Cloud Status
  const fetchOneDriveStatus = async () => {
    try {
      const res = await fetch('/api/backup/onedrive/status');
      if (res.ok) {
        const data = await res.json();
        setOneDriveStatus(data);
      }
    } catch (e) {}
  };

  useEffect(() => {
    if (viewMode === 'backup') {
      fetchOneDriveStatus();
    }
  }, [viewMode]);

  // Direct SQL Download
  const handleDownloadSql = async () => {
    setDownloadSqlLoading(true);
    try {
      const res = await fetch('/api/backup/download-sql');
      if (!res.ok) throw new Error('ไม่สามารถดาวน์โหลดไฟล์ได้');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const dStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `bwork_pos_backup_${dStr}.sql`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการดาวน์โหลดไฟล์ฐานข้อมูล: ' + err.message);
    } finally {
      setDownloadSqlLoading(false);
    }
  };

  // Connect OneDrive (1-Click OAuth Popup)
  const handleConnectOneDrive = async () => {
    setOneDriveLoading(true);
    try {
      const res = await fetch('/api/backup/onedrive/auth-url');
      const data = await res.json();
      if (!data.authUrl) throw new Error('ไม่สามารถสร้างลิงก์เข้าสู่ระบบ Microsoft ได้');

      // Listen for callback postMessage
      const handleMessage = async (event) => {
        if (event.data && event.data.type === 'ONEDRIVE_AUTH_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          await sysAlert(`เชื่อมต่อบัญชี OneDrive (${event.data.email || ''}) สำเร็จ!`);
          await fetchOneDriveStatus();
          setOneDriveLoading(false);
        }
      };
      window.addEventListener('message', handleMessage);

      // Open Microsoft OAuth popup
      const popup = window.open(data.authUrl, 'OneDriveAuth', 'width=600,height=720,status=yes,toolbar=no,menubar=no,scrollbars=yes');
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        // Fallback if popup blocked
        window.location.href = data.authUrl;
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาด: ' + err.message);
      setOneDriveLoading(false);
    }
  };

  // Trigger Manual OneDrive Cloud Backup
  const handleTriggerOneDriveBackup = async () => {
    setOneDriveLoading(true);
    try {
      const res = await fetch('/api/backup/onedrive/trigger', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        await sysAlert(`สำรองข้อมูลขึ้น OneDrive สำเร็จ!\nชื่อไฟล์: ${data.file?.name || 'bwork_backup.sql'}`);
        await fetchOneDriveStatus();
      } else {
        await sysAlert('การสำรองข้อมูลขึ้น OneDrive ล้มเหลว: ' + (data.error || ''));
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการสำรองข้อมูล: ' + err.message);
    } finally {
      setOneDriveLoading(false);
    }
  };

  // Disconnect OneDrive
  const handleDisconnectOneDrive = async () => {
    const confirmed = await sysConfirm('คุณแน่ใจหรือไม่ว่าต้องการยกเลิกการเชื่อมต่อกับ OneDrive?');
    if (!confirmed) return;
    try {
      const res = await fetch('/api/backup/onedrive/disconnect', { method: 'POST' });
      if (res.ok) {
        await sysAlert('ยกเลิกการเชื่อมต่อเรียบร้อยแล้ว');
        await fetchOneDriveStatus();
      }
    } catch (err) {}
  };

  // Handle Restore Database from .sql file
  const handleRestoreSqlFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.sql')) {
      await sysAlert('กรุณาเลือกไฟล์สำรองข้อมูลที่เป็นนามสกุล .sql เท่านั้น');
      e.target.value = '';
      return;
    }

    const confirmed = await sysConfirm(
      `⚠️ คำเตือนสำคัญสำหรับการกู้คืนข้อมูล!\n\nคุณกำลังจะกู้คืนฐานข้อมูลจากไฟล์:\n"${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB)\n\nการกู้คืนนี้จะทำการแทนที่ข้อมูลปัจจุบันด้วยข้อมูลจากไฟล์นี้ทั้งหมด!\nคุณแน่ใจหรือไม่ว่าต้องการดำเนินการกู้คืนข้อมูล?`
    );
    if (!confirmed) {
      e.target.value = '';
      return;
    }

    setRestoreLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const sqlContent = reader.result;
        const res = await fetch('/api/backup/restore-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sqlContent })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          await sysAlert('🎉 กู้คืนฐานข้อมูลสำเร็จเรียบร้อยแล้ว!\nระบบจะทำการรีโหลดหน้าจอเพื่อแสดงข้อมูลล่าสุด...');
          window.location.reload();
        } else {
          await sysAlert('การกู้คืนฐานข้อมูลล้มเหลว: ' + (data.error || 'กรุณาตรวจสอบโครงสร้างไฟล์ SQL'));
        }
      } catch (err) {
        await sysAlert('เกิดข้อผิดพลาดในการกู้คืนฐานข้อมูล: ' + err.message);
      } finally {
        setRestoreLoading(false);
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  // Trigger Local SQLite Backup
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
            {viewMode === 'system' && 'ตั้งค่าใบเสร็จ & บัญชีรับเงิน'}
            {viewMode === 'promotion' && 'ตั้งค่าโปรโมชั่น'}
            {viewMode === 'backup' && 'จัดการฐานข้อมูล'}
            {viewMode === 'quotation' && 'แก้ไขใบเสนอราคา'}
            {viewMode === 'dooraccess' && 'ระบบจอง LINE OA & รหัสเข้าห้อง'}
            {viewMode === 'general' && 'ตั้งค่าทั่วไป'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            {viewMode === 'users' && 'บริหารบัญชีพนักงานต้อนรับและแอดมิน เพื่อสิทธิ์การเปิดบิลและจัดการฐานข้อมูล'}
            {viewMode === 'system' && 'ตั้งค่าข้อมูลบริษัท ข้อความใบเสร็จ และข้อมูลบัญชีธนาคาร/พร้อมเพย์ สำหรับรับชำระเงินระบบออนไลน์'}
            {viewMode === 'promotion' && 'จัดการโปรโมชั่นสำหรับการจองออนไลน์'}
            {viewMode === 'backup' && 'จัดการการสำรองข้อมูล คัดลอกฐานข้อมูล และล้างข้อมูลประวัติการทำรายการเพื่อรีเซ็ตระบบ'}
            {viewMode === 'quotation' && 'กำหนดเงื่อนไขเริ่มต้น วันหมดอายุ และชื่อผู้ลงนามบนเอกสารใบเสนอราคา'}
            {viewMode === 'dooraccess' && 'กำหนดการเชื่อมต่อ LINE Messaging API, Google Sheets Sync และสิทธิ์เวลาการเช็คอินรหัส PIN'}
            {viewMode === 'general' && 'กำหนดค่าการทำงานทั่วไปของระบบ เช่น ช่วงเวลาการเตือนก่อนห้องประชุมเริ่มใช้งาน'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* VIEW: PROMOTION SETTINGS */}
        {viewMode === 'promotion' && (
          <PromotionSettings sysAlert={sysAlert} />
        )}

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
                ตั้งค่าข้อมูลใบเสร็จ & บัญชีรับเงิน
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

                {/* Bank Account & Payment Settings Section */}
                <div style={{
                  borderTop: '1.5px solid var(--border-color)',
                  paddingTop: '20px',
                  marginTop: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CreditCard size={20} className="text-primary" />
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--primary-color)' }}>
                      ข้อมูลบัญชีรับเงิน & พร้อมเพย์ (ระบบจองออนไลน์ & สลิป)
                    </h3>
                  </div>

                  {/* Bank Name */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                      ชื่อธนาคาร
                    </label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={configs.payment_bank_name || ''}
                      onChange={e => setConfigs({ ...configs, payment_bank_name: e.target.value })}
                      placeholder="เช่น ธนาคารกรุงศรีอยุธยา (Krungsri)"
                      style={{ height: '42px', padding: '10px 14px', borderRadius: '12px', fontSize: '0.875rem' }}
                    />
                  </div>

                  {/* Bank Account Number */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                      เลขที่บัญชีธนาคาร
                    </label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={configs.payment_bank_account || ''}
                      onChange={e => setConfigs({ ...configs, payment_bank_account: e.target.value })}
                      placeholder="เช่น 329-1-38429-0"
                      style={{ height: '42px', padding: '10px 14px', borderRadius: '12px', fontSize: '0.875rem' }}
                    />
                  </div>

                  {/* Bank Account Name */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                      ชื่อบัญชีธนาคาร
                    </label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={configs.payment_bank_account_name || ''}
                      onChange={e => setConfigs({ ...configs, payment_bank_account_name: e.target.value })}
                      placeholder="เช่น บริษัท บิลท์ ฮาร์ท จำกัด"
                      style={{ height: '42px', padding: '10px 14px', borderRadius: '12px', fontSize: '0.875rem' }}
                    />
                  </div>

                  {/* PromptPay ID */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                      หมายเลขพร้อมเพย์ (PromptPay ID / เลขผู้เสียภาษี 13 หลัก / เบอร์โทรศัพท์)
                    </label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={configs.promptpay_id || ''}
                      onChange={e => setConfigs({ ...configs, promptpay_id: e.target.value })}
                      placeholder="เช่น 0125554000401"
                      style={{ height: '42px', padding: '10px 14px', borderRadius: '12px', fontSize: '0.875rem' }}
                    />
                  </div>

                  {/* Payment window (minutes) */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                      กำหนดเวลาให้ลูกค้าชำระเงินและแนบสลิปหลังทำการจอง (นาที)
                    </label>
                    <input 
                      type="number" 
                      className="form-control" 
                      min="1"
                      placeholder="15"
                      value={configs.payment_window_minutes || '15'}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        setConfigs({ ...configs, payment_window_minutes: val });
                      }}
                      style={{ height: '42px', padding: '10px 14px', borderRadius: '12px', fontSize: '0.875rem' }}
                    />
                    <small style={{ color: 'var(--text-muted)' }}>ระบบจะยกเลิกรายการจองออนไลน์ที่ยังไม่ชำระเงินโดยอัตโนมัติเมื่อครบเวลาที่กำหนด (ค่าเริ่มต้น 15 นาที)</small>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '44px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '10px', fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 20px rgba(99, 102, 241, 0.3)' }}>
                  <Save size={18} />
                  บันทึกการตั้งค่าทั้งหมด
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
            
            {/* 💾 1. ONEDRIVE CLOUD AUTO BACKUP SECTION */}
            <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '12px', backgroundColor: 'rgba(37, 99, 235, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary-color)' }}>
                    <Cloud size={24} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      ระบบสำรองข้อมูลออนไลน์ Microsoft OneDrive (Cloud-to-Cloud)
                    </h2>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      สำรองข้อมูลขึ้น OneDrive ออนไลน์อัตโนมัติทุกวันเวลา 00:00 น. โดยไม่ต้องเปิดคอมพิวเตอร์และไม่ต้องล็อกอินแอปในเครื่อง
                    </p>
                  </div>
                </div>

                <span style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  backgroundColor: oneDriveStatus.connected ? 'rgba(34, 197, 94, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                  color: oneDriveStatus.connected ? '#16a34a' : '#64748b',
                  border: `1px solid ${oneDriveStatus.connected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: oneDriveStatus.connected ? '#16a34a' : '#94a3b8' }} />
                  {oneDriveStatus.connected ? 'เชื่อมต่อ OneDrive สำเร็จ' : 'ยังไม่ได้เชื่อมต่อ OneDrive'}
                </span>
              </div>

              {oneDriveStatus.connected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    backgroundColor: 'rgba(37, 99, 235, 0.04)',
                    border: '1px solid rgba(37, 99, 235, 0.15)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '16px'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>👤 บัญชี OneDrive ที่เชื่อมต่อ</div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '3px' }}>
                        {oneDriveStatus.userEmail || 'Microsoft Account'}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>⏰ รอบการสำรองข้อมูลอัตโนมัติ</div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#16a34a', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Clock size={15} />
                        <span>ทุกวัน เวลา 00:00 น. (เที่ยงคืน)</span>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>📁 โฟลเดอร์จัดเก็บบน OneDrive</div>
                      <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--primary-color)', marginTop: '3px' }}>
                        /Bwork_POS_Backups/
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>🕒 การสำรองข้อมูลล่าสุด</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '3px' }}>
                        {oneDriveStatus.lastBackup ? new Date(oneDriveStatus.lastBackup).toLocaleString('th-TH') : 'ยังไม่มีรอบสำรอง'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ height: '42px', padding: '0 20px', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                      onClick={handleTriggerOneDriveBackup}
                      disabled={oneDriveLoading}
                    >
                      <CloudLightning size={16} />
                      <span>{oneDriveLoading ? 'กำลังส่งข้อมูลขึ้น OneDrive...' : '⚡ สั่งสำรองข้อมูลขึ้น OneDrive ทันที'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ height: '42px', padding: '0 16px', borderRadius: '12px', fontWeight: 600, fontSize: '0.82rem', color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                      onClick={handleDisconnectOneDrive}
                    >
                      ยกเลิกการเชื่อมต่อ OneDrive
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}>
                    <ShieldCheck size={22} style={{ color: 'var(--primary-color)', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--text-main)' }}>
                      <strong>เชื่อมต่อบัญชี Microsoft OneDrive เพียงครั้งเดียว</strong><br />
                      ระบบจะสร้าง Snapshot ฐานข้อมูลเป็นไฟล์ SQL และส่งขึ้นโฟลเดอร์ <code>/Bwork_POS_Backups/</code> ใน OneDrive ออนไลน์ของคุณโดยอัตโนมัติทุกๆ เที่ยงคืน ปลอดภัย ข้อมูลย้อนหลังได้ไม่จำกัดระยะเวลา และไม่ต้องเปิดคอมพิวเตอร์ทิ้งไว้
                    </div>
                  </div>

                  <div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ height: '44px', padding: '0 24px', borderRadius: '12px', fontWeight: 800, fontSize: '0.88rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                      onClick={handleConnectOneDrive}
                      disabled={oneDriveLoading}
                    >
                      <Cloud size={18} />
                      <span>{oneDriveLoading ? 'กำลังเชื่อมต่อ...' : '☁️ เชื่อมต่อบัญชี Microsoft OneDrive'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '12px', backgroundColor: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
                    <Database size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      ดาวน์โหลดไฟล์ฐานข้อมูล SQL ฉบับเต็ม (Direct Database SQL Export)
                    </h3>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      ดาวน์โหลด Snapshot ฐานข้อมูลทั้งหมดทุกตาราง (.sql) ลงเครื่องคอมพิวเตอร์ของคุณได้ทันทีด้วยคลิกเดียว
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    height: '42px',
                    padding: '0 18px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#10b981',
                    borderColor: 'rgba(16, 185, 129, 0.35)',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)'
                  }}
                  onClick={handleDownloadSql}
                  disabled={downloadSqlLoading}
                >
                  <Download size={16} />
                  <span>{downloadSqlLoading ? 'กำลังสร้างไฟล์ SQL...' : '📥 ดาวน์โหลดไฟล์ฐานข้อมูล .sql ทันที'}</span>
                </button>
              </div>
            </div>

            {/* 🔄 3. DATABASE RESTORE SECTION */}
            <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid rgba(245, 158, 11, 0.3)', background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.02), rgba(245, 158, 11, 0.04))' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '12px', backgroundColor: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706' }}>
                    <UploadCloud size={24} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      กู้คืนฐานข้อมูลจากไฟล์ .sql (Restore Database from .sql file)
                    </h3>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      เลือกไฟล์สำรองข้อมูล (.sql) เพื่อกู้คืนและนำเข้าข้อมูลทั้งหมด ข้อมูลเดิมจะถูกแทนที่ด้วยข้อมูลจากไฟล์
                    </p>
                  </div>
                </div>

                <div>
                  <input
                    type="file"
                    accept=".sql"
                    ref={restoreInputRef}
                    onChange={handleRestoreSqlFile}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      height: '42px',
                      padding: '0 20px',
                      borderRadius: '12px',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: '#d97706',
                      borderColor: 'rgba(245, 158, 11, 0.4)',
                      backgroundColor: 'rgba(245, 158, 11, 0.08)'
                    }}
                    onClick={() => restoreInputRef.current?.click()}
                    disabled={restoreLoading}
                  >
                    <RotateCcw size={16} className={restoreLoading ? 'spin' : ''} />
                    <span>{restoreLoading ? 'กำลังกู้คืนข้อมูล กรุณารอสักครู่...' : '📤 เลือกไฟล์เพื่อกู้คืนฐานข้อมูล (Restore .sql)'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 🚨 4. SYSTEM RESET / CLEAR OPERATION HISTORY SECTION */}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '850px' }}>
            
            <form onSubmit={handleSaveConfigs} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* CARD 1: 🏢 ข้อมูลบริษัทและส่วนหัวเอกสาร */}
              <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', boxShadow: 'var(--glass-shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(234, 88, 12, 0.1)', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Building2 size={20} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      1. ข้อมูลบริษัทและส่วนหัวเอกสาร (Company & Header Branding)
                    </h2>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ข้อมูลชื่อบริษัท ที่อยู่ และเลขผู้เสียภาษี สำหรับแสดงในเอกสารใบเสนอราคา (แยกอิสระจากใบเสร็จรับเงิน)
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ชื่อบริษัทของเรา (Company Name)</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      value={configs.quotation_company_name || ''} 
                      onChange={e => setConfigs({ ...configs, quotation_company_name: e.target.value })} 
                      placeholder="เช่น บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)"
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ที่อยู่บริษัทของเรา (Company Address)</label>
                    <textarea 
                      className="form-control" 
                      rows="2"
                      value={configs.quotation_company_address || ''} 
                      onChange={e => setConfigs({ ...configs, quotation_company_address: e.target.value })} 
                      placeholder="เช่น 98 หมู่ 2 อาคารบีเวิร์ค ยูนิต 602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120"
                      style={{ borderRadius: '12px', padding: '10px', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>เลขประจำตัวผู้เสียภาษี (Tax ID)</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={configs.quotation_company_tax_id || ''} 
                        onChange={e => setConfigs({ ...configs, quotation_company_tax_id: e.target.value })} 
                        placeholder="เช่น 0125554000401"
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>เบอร์โทรศัพท์ / อีเมลติดต่อ</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={configs.quotation_company_phone || ''} 
                        onChange={e => setConfigs({ ...configs, quotation_company_phone: e.target.value })} 
                        placeholder="เช่น 02-123-4567, coworking@bwork.biz"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* CARD 2: 🏦 บัญชีธนาคารและการชำระเงิน */}
              <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', boxShadow: 'var(--glass-shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CreditCard size={20} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      2. บัญชีธนาคารและเงื่อนไขการชำระเงิน (Bank Account & Payment Terms)
                    </h2>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      ข้อมูลบัญชีรับโอนเงินที่จะปรากฏในกล่องเงื่อนไขการชำระเงินท้ายใบเสนอราคา
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ชื่อบัญชีรับโอน (Account Name)</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={configs.quotation_bank_account_name || ''} 
                        onChange={e => setConfigs({ ...configs, quotation_bank_account_name: e.target.value })} 
                        placeholder="เช่น บริษัท บิลท์ ฮาร์ท จำกัด (Built Heart Co., Ltd.)"
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>เลขที่บัญชี (Account Number)</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={configs.quotation_bank_account_no || ''} 
                        onChange={e => setConfigs({ ...configs, quotation_bank_account_no: e.target.value })} 
                        placeholder="เช่น 329-1-38429-0"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ชื่อธนาคารและสาขา (Bank & Branch)</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={configs.quotation_bank_name || ''} 
                        onChange={e => setConfigs({ ...configs, quotation_bank_name: e.target.value })} 
                        placeholder="เช่น ธนาคารกรุงศรีอยุธยา (Krungsri Bank) สาขา ซอฟต์แวร์ ปาร์ค"
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ช่องทางแจ้งสลิปโอนเงิน (Slip Notice)</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        value={configs.quotation_payment_notice || ''} 
                        onChange={e => setConfigs({ ...configs, quotation_payment_notice: e.target.value })} 
                        placeholder="เช่น coworking@bwork.biz หรือ LINE Official: @bwork"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ข้อกำหนดและเงื่อนไขเพิ่มเติม (Terms & Conditions)</label>
                    <textarea 
                      className="form-control" 
                      rows="3"
                      value={configs.quotation_terms || ''} 
                      onChange={e => setConfigs({ ...configs, quotation_terms: e.target.value })} 
                      placeholder="เช่น &#10;- ชำระเงินมัดจำ 50% เมื่อยืนยันใบเสนอราคา&#10;- ยอดคงเหลือชำระก่อนวันเริ่มใช้บริการ 1 วัน"
                      style={{ borderRadius: '12px', padding: '10px', fontSize: '0.85rem' }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ข้อความเงื่อนไขเสริมที่จะแสดงใต้ข้อมูลการโอนเงิน (เว้นว่างได้หากไม่ต้องการระบุ)</span>
                  </div>
                </div>
              </div>

              {/* CARD 3: ⚖️ การคำนวณภาษีและอายุเอกสาร */}
              <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', boxShadow: 'var(--glass-shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Clock size={20} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      3. การคำนวณภาษีและวันหมดอายุเริ่มต้น (Default Taxes & Validity)
                    </h2>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      กำหนดค่ามาตรฐานสำหรับการเปิดใบเสนอราคาใหม่ทุกครั้ง
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>จำนวนวันเสนอราคาเริ่มต้น (Valid Days)</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      min="1"
                      value={configs.quotation_valid_days || '7'} 
                      onChange={e => setConfigs({ ...configs, quotation_valid_days: e.target.value })} 
                      placeholder="เช่น 7, 15, 30 วัน"
                      style={{ height: '44px', padding: '8px 14px', fontSize: '0.9rem', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>คำนวณวันยืนยันราคาอัตโนมัติตั้งแต่วันที่ออกเอกสาร</span>
                  </div>

                  <div className="form-group">
                    <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ภาษีมูลค่าเพิ่ม (VAT 7%) เริ่มต้น</label>
                    <select
                      className="form-control"
                      value={configs.quotation_default_vat !== undefined ? String(configs.quotation_default_vat) : '1'}
                      onChange={e => setConfigs({ ...configs, quotation_default_vat: e.target.value })}
                      style={{ height: '44px', padding: '6px 14px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}
                    >
                      <option value="1">เปิดใช้งาน VAT 7% เสมอ (แนะนำ)</option>
                      <option value="0">ปิดการคำนวณ VAT 7%</option>
                    </select>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>สถานะเริ่มต้นของสวิตช์ VAT เมื่อเปิดหน้าสร้างใบเสนอราคา</span>
                  </div>

                  <div className="form-group">
                    <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>หักภาษี ณ ที่จ่ายเริ่มต้น (Withholding Tax)</label>
                    <select
                      className="form-control"
                      value={configs.quotation_default_wht !== undefined ? String(configs.quotation_default_wht) : '0'}
                      onChange={e => setConfigs({ ...configs, quotation_default_wht: e.target.value })}
                      style={{ height: '44px', padding: '6px 14px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}
                    >
                      <option value="0">ไม่หัก ณ ที่จ่าย (0%)</option>
                      <option value="1">หัก ณ ที่จ่าย 1% (ค่าขนส่ง/บริการ)</option>
                      <option value="3">หัก ณ ที่จ่าย 3% (ค่าบริการนิติบุคคล)</option>
                    </select>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>อัตราหัก ณ ที่จ่ายเริ่มต้นสำหรับเอกสารใหม่</span>
                  </div>
                </div>
              </div>

              {/* CARD 4: ✍️ ผู้มีอำนาจลงนามและภาพลายเซ็น */}
              <div className="card" style={{ padding: '24px', borderRadius: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', boxShadow: 'var(--glass-shadow)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                      4. ผู้มีอำนาจลงนามและภาพลายเซ็น (Sellers & Signatures)
                    </h2>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      จัดการรายชื่อผู้ขายสำหรับเลือกในเอกสาร และอัปโหลดไฟล์ภาพลายเซ็นผู้อนุมัติ
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  
                  {/* Sellers List Management */}
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.825rem', fontWeight: 650, marginBottom: '6px', display: 'block' }}>
                      รายชื่อผู้มีอำนาจลงนาม / ผู้ขาย (Salespeople / Signers)
                    </label>
                    
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
                        placeholder="พิมพ์ชื่อ-นามสกุล / ตำแหน่ง แล้วกดปุ่มแอด..."
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
                      รายชื่อที่เพิ่มไว้ตรงนี้ จะถูกนำไปเป็นตัวเลือก Dropdown ในช่อง 'ผู้เสนอราคา' ในหน้าสร้างใบเสนอราคา
                    </span>
                  </div>

                  {/* Signature 1 & 2 Uploads */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    
                    {/* Signature 1 */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ภาพลายเซ็นผู้อนุมัติ 1 (Signature 1)</label>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
                        {configs.quotation_signature_image ? (
                          <div style={{ position: 'relative', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '8px', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
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
                        ไฟล์ภาพ PNG/JPG พื้นหลังโปร่งใส (ขนาดไม่เกิน 2MB)
                      </span>
                    </div>

                    {/* Signature 2 */}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ภาพลายเซ็นผู้อนุมัติ 2 (Signature 2 - ถ้ามี)</label>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '6px' }}>
                        {configs.quotation_signature_image2 ? (
                          <div style={{ position: 'relative', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '8px', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
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
                        ไฟล์ภาพสำหรับช่องผู้อนุมัติร่วมคนที่ 2 (เว้นว่างได้)
                      </span>
                    </div>

                  </div>

                </div>
              </div>

              {/* SAVE BUTTON */}
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: '16px',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(234, 88, 12, 0.35)'
                }}
              >
                <Save size={18} />
                บันทึกการตั้งค่าใบเสนอราคาทั้งหมด
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
                  placeholder="เช่น บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)..."
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

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  🧹 ระยะเวลาทำความสะอาด / เตรียมห้อง (Buffer Time ระหว่างคิว)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input 
                    type="number" 
                    className="form-control" 
                    required
                    min="0"
                    max="120"
                    step="5"
                    style={{ width: '120px', height: '40px', borderRadius: '10px', textAlign: 'center', fontWeight: 'bold' }}
                    value={configs.cleaning_buffer_minutes !== undefined ? configs.cleaning_buffer_minutes : '30'} 
                    onChange={e => setConfigs({ ...configs, cleaning_buffer_minutes: e.target.value })} 
                  />
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-main)' }}>นาที</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block', lineHeight: 1.4 }}>
                  ระยะเวลาที่ระบบจะล็อกห้องพักอัตโนมัติหลังจากการใช้งานแต่ละรายการเสร็จสิ้น เพื่อให้แม่บ้านทำความสะอาดและจัดเตรียมห้องสำหรับคิวถัดไป (เช่น 30 นาที, 0 คือไม่เว้นเวลา)
                </span>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px', display: 'block' }}>
                  ชื่อสัญญาณ Wi-Fi สำหรับผู้มาติดต่อ (Guest Wi-Fi SSID)
                </label>
                <input
                  type="text"
                  className="form-control"
                  style={{ width: '100%', height: '40px', borderRadius: '10px' }}
                  placeholder="เช่น @BWORK"
                  value={configs.wifi_ssid || ''}
                  onChange={e => setConfigs({ ...configs, wifi_ssid: e.target.value })}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block', lineHeight: 1.4 }}>
                  ชื่อเครือข่าย Wi-Fi ส่วนกลางของอาคารที่ลูกค้าใช้เชื่อมต่อเพื่อเข้าสู่หน้า MikroTik Hotspot Login
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
                              { key: 'dashboard', label: 'Dashboard' },
                              { key: 'pending', label: 'รายการจองห้อง' },
                              { key: 'layout', label: 'แผนผังห้อง' },
                              { key: 'history', label: 'ประวัติย้อนหลัง' },
                              { key: 'quotations', label: 'ใบเสนอราคา' },
                              { key: 'manage', label: 'จัดการคลังสินค้า' },
                              { key: 'admin-users', label: 'จัดการผู้ใช้ & บทบาท' },
                              { key: 'admin-system', label: 'ตั้งค่าระบบ & ใบเสร็จ' },
                              { key: 'admin-promotion', label: 'ตั้งค่าโปรโมชั่น' },
                              { key: 'admin-quotation', label: 'ตั้งค่าใบเสนอราคา' },
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
                                  if (currentUser && currentUser.role === roleForm.name.trim()) {
                                    const updatedUser = { ...currentUser, permissions: permStr };
                                    localStorage.setItem('pos_user', JSON.stringify(updatedUser));
                                    if (typeof onUserUpdate === 'function') onUserUpdate(updatedUser);
                                  }
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
