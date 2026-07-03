import React, { useState, useEffect } from 'react';
import { Save, CloudLightning, CheckCircle2, AlertTriangle, Cloud, Users, UserPlus, KeyRound, Trash2, Plus } from 'lucide-react';

function SettingsPanel({ viewMode, onSettingsUpdate, sysAlert, sysConfirm, sysPrompt }) {
  // Config Settings
  const [configs, setConfigs] = useState({
    company_name: '',
    receipt_header: '',
    receipt_footer: '',
    onedrive_path: ''
  });

  // DB Backup logs
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);

  // User list states
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'staff' });
  const [showAddUserForm, setShowAddUserForm] = useState(false);

  useEffect(() => {
    fetchConfigs();
    if (viewMode === 'users') {
      fetchUsers();
    }
  }, [viewMode]);

  const fetchConfigs = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        setConfigs(await res.json());
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
          onedrive_path: configs.onedrive_path
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
        setNewUser({ username: '', password: '', role: 'staff' });
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
      await sysAlert('เกิดข้อผิดพลาดในการส่งข้อมูล');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
      <div className="tab-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
        <div>
          <h1 className="tab-title">
            {viewMode === 'users' && 'จัดการสิทธิ์บัญชีผู้ใช้'}
            {viewMode === 'system' && 'ตั้งค่าระบบ & ใบเสร็จ'}
            {viewMode === 'backup' && 'การสำรองข้อมูลสำรอง'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            {viewMode === 'users' && 'บริหารบัญชีพนักงานต้อนรับและแอดมิน เพื่อสิทธิ์การเปิดบิลและจัดการฐานข้อมูล'}
            {viewMode === 'system' && 'ตั้งค่าข้อมูลบริษัท หัวใบเสร็จ และข้อความขอบคุณที่ส่วนท้ายใบเสร็จรับเงิน'}
            {viewMode === 'backup' && 'กำหนดที่อยู่โฟลเดอร์สำหรับสำรองฐานข้อมูล และสั่งสำรองข้อมูลด่วนลง OneDrive'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* VIEW: SYSTEM SETTINGS */}
        {viewMode === 'system' && (
          <div className="card">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⚙️ ตั้งค่าข้อมูลบริษัทและใบเสร็จ
            </h2>
            <form onSubmit={handleSaveConfigs}>
              <div className="form-group">
                <label htmlFor="companyName">ชื่อหน่วยงาน / บริษัท</label>
                <input 
                  id="companyName"
                  type="text" 
                  className="form-control" 
                  value={configs.company_name}
                  onChange={e => setConfigs({ ...configs, company_name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="receiptHeader">ข้อความส่วนหัวใบเสร็จ</label>
                <input 
                  id="receiptHeader"
                  type="text" 
                  className="form-control" 
                  value={configs.receipt_header}
                  onChange={e => setConfigs({ ...configs, receipt_header: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="receiptFooter">ข้อความส่วนท้ายใบเสร็จ</label>
                <input 
                  id="receiptFooter"
                  type="text" 
                  className="form-control" 
                  value={configs.receipt_footer}
                  onChange={e => setConfigs({ ...configs, receipt_footer: e.target.value })}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '16px', gap: '8px' }}>
                <Save size={18} />
                บันทึกการตั้งค่าระบบทั้งหมด
              </button>
            </form>
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
              <button 
                className="btn btn-primary"
                style={{ padding: '8px 14px', fontSize: '0.8rem', gap: '6px', borderRadius: '99px' }}
                onClick={() => setShowAddUserForm(!showAddUserForm)}
              >
                <Plus size={14} /> เพิ่มบัญชีผู้ใช้ใหม่
              </button>
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
                  <div className="form-group">
                    <label>สิทธิ์ / บทบาท (Role)</label>
                    <select 
                      className="form-control" 
                      value={newUser.role} 
                      onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                    >
                      <option value="staff">พนักงานต้อนรับ (Staff / Reception)</option>
                      <option value="admin">ผู้ดูแลระบบ (Admin)</option>
                    </select>
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
                    <th>บทบาท / สิทธิ์</th>
                    <th>วันที่สร้างบัญชี</th>
                    <th style={{ textAlign: 'center', padding: '14px 18px' }}>การจัดการบัญชี</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: '700', padding: '14px 18px' }}>{u.username}</td>
                      <td>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: '99px',
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          backgroundColor: u.role === 'admin' ? 'rgba(37, 99, 235, 0.15)' : 'var(--primary-light)',
                          color: u.role === 'admin' ? '#2563eb' : 'var(--text-muted)'
                        }}>
                          {u.role === 'admin' ? 'ผู้ดูแลระบบ (Admin)' : 'พนักงานต้อนรับ (Reception)'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {new Date(u.created_at).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ textAlign: 'center', padding: '14px 18px' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '6px 10px', fontSize: '0.75rem', gap: '4px' }} 
                            onClick={() => handleResetUserPassword(u.id, u.username)}
                          >
                            <KeyRound size={12} />
                            <span>รีเซ็ตพาส</span>
                          </button>
                          {u.username !== 'admin' && (
                            <button 
                              className="btn btn-danger" 
                              style={{ padding: '6px 10px', fontSize: '0.75rem', gap: '4px' }} 
                              onClick={() => handleDeleteUser(u.id, u.username)}
                            >
                              <Trash2 size={12} />
                              <span>ลบ</span>
                            </button>
                          )}
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
        {viewMode === 'backup' && (
          <>
            {/* OneDrive Path Config */}
            <div className="card">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                📂 กำหนดที่อยู่โฟลเดอร์สำหรับสำรองข้อมูล
              </h2>
              <form onSubmit={handleSaveOneDrivePath}>
                <div className="form-group">
                  <label htmlFor="onedrivePath" style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>ที่อยู่โฟลเดอร์ OneDrive ในเครื่อง</label>
                  <input 
                    id="onedrivePath"
                    type="text" 
                    className="form-control" 
                    placeholder="เช่น C:\Users\ADMIN\OneDrive\POS_Backups"
                    value={configs.onedrive_path}
                    onChange={e => setConfigs({ ...configs, onedrive_path: e.target.value })}
                    required
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', display: 'block' }}>
                    * ระบุโฟลเดอร์ภายใน OneDrive หรือไดรฟ์ที่ต้องการนำฐานข้อมูล SQL ไปสำรองเก็บไว้เมื่อเปิดโปรแกรม
                  </span>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', gap: '8px' }}>
                  <Save size={18} />
                  บันทึกที่อยู่สำรองข้อมูล
                </button>
              </form>
            </div>

            {/* Trigger Manual Backup */}
            <div className="card">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cloud size={20} className="text-primary" />
                ซิงค์สำรองข้อมูลทันที (OneDrive Manual Backup)
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                ปกติระบบหลังบ้านจะทำงานซิงค์ฐานข้อมูล SQL ขึ้น OneDrive เป็นประจำทุกวันโดยอัตโนมัติ คุณสามารถสั่งทำระบบสำรองด่วนได้ในคลิกเดียวด้านล่าง
              </p>

              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', gap: '8px', color: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
                onClick={handleTriggerBackup}
                disabled={backupLoading}
              >
                <CloudLightning size={18} />
                {backupLoading ? 'กำลังสร้างไฟล์ฐานข้อมูลสำรอง...' : 'กดสำรองไฟล์ข้อมูล SQLite ด่วนเดี๋ยวนี้'}
              </button>

              {backupStatus && (
                <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  borderRadius: 'var(--border-radius-sm)',
                  fontSize: '0.85rem',
                  border: '1px solid',
                  borderColor: backupStatus.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  backgroundColor: backupStatus.success ? 'var(--success-bg)' : 'var(--danger-bg)',
                  color: backupStatus.success ? 'var(--success-color)' : 'var(--danger-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {backupStatus.success ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {backupStatus.message}
                  </div>
                  {backupStatus.success && (
                    <>
                      <div><strong>ชื่อไฟล์สำรอง:</strong> {backupStatus.fileName}</div>
                      <div style={{ wordBreak: 'break-all' }}><strong>ที่อยู่สำรอง:</strong> {backupStatus.path}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

export default SettingsPanel;
