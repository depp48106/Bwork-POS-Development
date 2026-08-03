import React, { useState, useEffect } from 'react';
import { KeyRound, Smartphone, FileSpreadsheet, Save, CheckCircle2, ShieldCheck, Clock, ExternalLink, HelpCircle, Lock, RefreshCw } from 'lucide-react';

function DoorAccessSettings({ sysAlert }) {
  const [configs, setConfigs] = useState({
    line_channel_access_token: '',
    line_channel_secret: '',
    line_liff_id: '',
    google_sheet_id: '',
    google_service_account_email: '',
    early_checkin_minutes: '15'
  });

  const [saving, setSaving] = useState(false);
  const [testPin, setTestPin] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setConfigs(prev => ({
          ...prev,
          ...data,
          early_checkin_minutes: data.early_checkin_minutes || '15'
        }));
      }
    } catch (err) {
      console.error('Failed to load door access settings:', err);
    }
  };

  const handleSaveConfigs = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configs)
      });
      if (res.ok) {
        if (sysAlert) sysAlert('บันทึกการตั้งค่าระบบจอง LINE OA & รหัสเข้าห้องเรียบร้อยแล้ว');
      } else {
        if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า');
      }
    } catch (err) {
      if (sysAlert) sysAlert('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    } finally {
      setSaving(false);
    }
  };

  const handleTestPinVerification = async () => {
    if (!testPin.trim()) {
      if (sysAlert) sysAlert('กรุณากรอกรหัส PIN 6 หลักเพื่อทดสอบ');
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/access/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin_code: testPin.trim() })
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, error: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '950px', width: '100%' }}>
      {/* Header Info */}
      <div style={{
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: '24px',
        padding: '24px 28px',
        boxShadow: 'var(--glass-shadow)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 8px 20px rgba(16, 185, 129, 0.25)'
          }}>
            <KeyRound size={26} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 850, margin: 0, color: 'var(--text-main)' }}>
              ตั้งค่าระบบจอง LINE OA & รหัสเข้าห้อง (LINE OA & Door Access Settings)
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
              จัดการการเชื่อมต่อ LINE Messaging API, Google Sheets Sync และกำหนดเงื่อนไขเวลาในการรับรหัส PIN เช็คอิน
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveConfigs} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        
        {/* Left Column: LINE OA & Google Sheets Settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Section 1: LINE OA Configuration */}
          <div style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '20px',
            padding: '24px',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981' }}>
              <Smartphone size={20} />
              ตั้งค่าการเชื่อมต่อ LINE OA & LIFF
            </h3>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                LINE Channel Access Token
              </label>
              <textarea
                rows={2}
                className="form-control"
                placeholder="วาง Long-lived Channel Access Token จาก LINE Developers"
                value={configs.line_channel_access_token || ''}
                onChange={e => setConfigs({ ...configs, line_channel_access_token: e.target.value })}
                style={{ fontSize: '0.8rem', padding: '10px 12px', borderRadius: '12px', resize: 'none' }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                LINE Channel Secret
              </label>
              <input
                type="password"
                className="form-control"
                placeholder="กรอก Channel Secret"
                value={configs.line_channel_secret || ''}
                onChange={e => setConfigs({ ...configs, line_channel_secret: e.target.value })}
                style={{ height: '42px', fontSize: '0.85rem', padding: '0 12px', borderRadius: '12px' }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                LINE LIFF App ID (สำหรับเปิดหน้าจอง)
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="ตัวอย่าง: 1657891234-AbCdEfGh"
                value={configs.line_liff_id || ''}
                onChange={e => setConfigs({ ...configs, line_liff_id: e.target.value })}
                style={{ height: '42px', fontSize: '0.85rem', padding: '0 12px', borderRadius: '12px' }}
              />
            </div>
          </div>

          {/* Section 2: Google Sheets Configuration */}
          <div style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '20px',
            padding: '24px',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#0ea5e9' }}>
              <FileSpreadsheet size={20} />
              ซิงค์ข้อมูลกับ Google Sheets (Optional)
            </h3>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                Google Sheet ID
              </label>
              <input
                type="text"
                className="form-control"
                placeholder="วาง Sheet ID จาก URL (เช่น 1BxiMVs0XRA5nFMd...)"
                value={configs.google_sheet_id || ''}
                onChange={e => setConfigs({ ...configs, google_sheet_id: e.target.value })}
                style={{ height: '42px', fontSize: '0.85rem', padding: '0 12px', borderRadius: '12px' }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                Google Service Account Email
              </label>
              <input
                type="email"
                className="form-control"
                placeholder="อีเมล Service Account สำหรับแก้ไข Sheet"
                value={configs.google_service_account_email || ''}
                onChange={e => setConfigs({ ...configs, google_service_account_email: e.target.value })}
                style={{ height: '42px', fontSize: '0.85rem', padding: '0 12px', borderRadius: '12px' }}
              />
            </div>
          </div>

        </div>

        {/* Right Column: Check-in Rules & Door Access PIN Tester */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Section 3: Check-in Time Rules */}
          <div style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '20px',
            padding: '24px',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b' }}>
              <Clock size={20} />
              เงื่อนไขเวลาการกดรับรหัส PIN เช็คอิน
            </h3>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
                อนุญาตให้กดรับรหัส PIN ผ่าน LINE OA ล่วงหน้าก่อนเวลาจอง (นาที)
              </label>
              <select
                className="form-control"
                value={configs.early_checkin_minutes || '15'}
                onChange={e => setConfigs({ ...configs, early_checkin_minutes: e.target.value })}
                style={{ height: '42px', fontSize: '0.85rem', padding: '0 12px', borderRadius: '12px', fontWeight: 700 }}
              >
                <option value="5">5 นาที ก่อนเวลาจอง</option>
                <option value="10">10 นาที ก่อนเวลาจอง</option>
                <option value="15">15 นาที ก่อนเวลาจอง (แนะนำ)</option>
                <option value="30">30 นาที ก่อนเวลาจอง</option>
                <option value="60">60 นาที ก่อนเวลาจอง</option>
              </select>
            </div>

            <div style={{
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '12px',
              padding: '12px 14px',
              fontSize: '0.78rem',
              color: 'var(--text-main)',
              lineHeight: 1.45
            }}>
              💡 <strong>ข้อกำหนดระบบ:</strong> เมื่อลูกค้ากดปุ่ม "เช็คอิน" บน LINE OA ระบบ Bwork-POS จะตรวจสอบว่าเวลาปัจจุบันอยู่ก่อนเวลาจองไม่เกิน {configs.early_checkin_minutes || 15} นาที และชำระเงินเรียบร้อยแล้วเท่านั้น จึงจะสร้างรหัส PIN 6 หลักให้อัตโนมัติ
            </div>
          </div>

          {/* Section 4: Live PIN Code Tester */}
          <div style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '20px',
            padding: '24px',
            boxShadow: 'var(--glass-shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary-color)' }}>
              <ShieldCheck size={20} />
              ทดสอบตรวจสอบรหัส PIN หน้าห้อง (PIN Verification Tester)
            </h3>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                className="form-control"
                placeholder="กรอก PIN 6 หลักเพื่อทดสอบ"
                maxLength={6}
                value={testPin}
                onChange={e => setTestPin(e.target.value.replace(/\D/g, ''))}
                style={{ height: '44px', fontSize: '1.1rem', fontWeight: 'bold', letterSpacing: '3px', textAlign: 'center', borderRadius: '12px', flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleTestPinVerification}
                disabled={testLoading}
                style={{ height: '44px', padding: '0 18px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', flexShrink: 0 }}
              >
                {testLoading ? 'กำลังตรวจ...' : 'ทดสอบ PIN'}
              </button>
            </div>

            {testResult && (
              <div style={{
                padding: '14px',
                borderRadius: '14px',
                backgroundColor: testResult.success ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                border: `1px solid ${testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                color: testResult.success ? '#10b981' : 'var(--danger-color)',
                fontSize: '0.85rem',
                fontWeight: 700
              }}>
                {testResult.success ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div>✅ {testResult.message}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-main)', fontWeight: 'normal' }}>
                      ผู้เข้าใช้งาน: <strong>{testResult.customer_name}</strong> | ห้อง: <strong>{testResult.room_name}</strong>
                    </div>
                  </div>
                ) : (
                  <div>❌ {testResult.error}</div>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{
              height: '46px',
              borderRadius: '14px',
              fontWeight: 800,
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(16, 185, 129, 0.3)',
              backgroundColor: '#10b981',
              border: 'none',
              marginTop: '4px'
            }}
          >
            <Save size={18} />
            <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าระบบจอง LINE OA & รหัสเข้าห้อง'}</span>
          </button>

        </div>
      </form>
    </div>
  );
}

export default DoorAccessSettings;
