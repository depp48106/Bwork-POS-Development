import React, { useState, useEffect } from 'react';
import { KeyRound, Smartphone, FileSpreadsheet, Save, CheckCircle2, ShieldCheck, Clock, ExternalLink, HelpCircle, Lock, RefreshCw, AlertCircle, Tag } from 'lucide-react';
import { authManager } from '../authManager';

function DoorAccessSettings({ sysAlert }) {
  const [configs, setConfigs] = useState({
    line_channel_access_token: '',
    line_channel_secret: '',
    line_liff_id: '',
    google_sheet_id: '',
    google_service_account_email: '',
    early_checkin_minutes: '15'
  });

  const [hasTokenSaved, setHasTokenSaved] = useState(false);
  const [hasSecretSaved, setHasSecretSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lineTesting, setLineTesting] = useState(false);
  const [lineTestResult, setLineTestResult] = useState(null);
  const [testPin, setTestPin] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);

  // Online Promotion State
  const [promoData, setPromoData] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoActionLoading, setPromoActionLoading] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchPromotion();
  }, []);

  const fetchPromotion = async () => {
    setPromoLoading(true);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/admin/promotion', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setPromoData(data.promotion);
      }
    } catch (err) {
      console.warn('Failed to fetch promotion:', err);
    } finally {
      setPromoLoading(false);
    }
  };

  const handleActivatePromotion = async () => {
    setPromoActionLoading(true);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/admin/promotion/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (sysAlert) sysAlert(data.message || 'เปิดใช้งานโปรโมชั่นสำเร็จ');
        setPromoData(data.promotion);
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถเปิดใช้งานโปรโมชั่นได้');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setPromoActionLoading(false);
    }
  };

  const handleDeactivatePromotion = async () => {
    setPromoActionLoading(true);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/admin/promotion/deactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (sysAlert) sysAlert(data.message || 'หยุดการใช้งานโปรโมชั่นสำเร็จ');
        setPromoData(data.promotion);
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถหยุดการใช้งานโปรโมชั่นได้');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setPromoActionLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/settings', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        const tokenExists = !!data.has_line_channel_access_token || (typeof data.line_channel_access_token === 'string' && data.line_channel_access_token.includes('•'));
        const secretExists = !!data.has_line_channel_secret || (typeof data.line_channel_secret === 'string' && data.line_channel_secret.includes('•'));
        setHasTokenSaved(tokenExists);
        setHasSecretSaved(secretExists);

        setConfigs(prev => ({
          ...prev,
          ...data,
          line_channel_access_token: data.line_channel_access_token || '',
          line_channel_secret: data.line_channel_secret || '',
          early_checkin_minutes: data.early_checkin_minutes || '15'
        }));
      } else {
        console.warn('[DoorAccessSettings] Failed to fetch settings: HTTP', res.status);
      }
    } catch (err) {
      console.error('Failed to load door access settings:', err);
    }
  };

  const handleSaveConfigs = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const payload = { ...configs };

      // MASK PROTECTION: Never send mask placeholder string to avoid overwriting real credentials!
      if (payload.line_channel_access_token && payload.line_channel_access_token.includes('•')) {
        delete payload.line_channel_access_token;
      }
      if (payload.line_channel_secret && payload.line_channel_secret.includes('•')) {
        delete payload.line_channel_secret;
      }

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        if (sysAlert) sysAlert('บันทึกการตั้งค่าระบบจอง LINE OA & รหัสเข้าห้องเรียบร้อยแล้ว');
        fetchSettings();
      } else {
        const errData = await res.json().catch(() => ({}));
        if (sysAlert) sysAlert(errData.error || 'เกิดข้อผิดพลาดในการบันทึกการตั้งค่า');
      }
    } catch (err) {
      if (sysAlert) sysAlert('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
    } finally {
      setSaving(false);
    }
  };

  const handleTestLineConnection = async () => {
    setLineTesting(true);
    setLineTestResult(null);
    try {
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const testPayload = {};

      // Send current input values if user entered new plaintext (unmasked) values
      if (configs.line_channel_access_token && !configs.line_channel_access_token.includes('•') && configs.line_channel_access_token.trim()) {
        testPayload.channel_access_token = configs.line_channel_access_token.trim();
      }
      if (configs.line_channel_secret && !configs.line_channel_secret.includes('•') && configs.line_channel_secret.trim()) {
        testPayload.channel_secret = configs.line_channel_secret.trim();
      }
      if (configs.line_liff_id && configs.line_liff_id.trim()) {
        testPayload.liff_id = configs.line_liff_id.trim();
      }

      const res = await fetch('/api/settings/line/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(testPayload)
      });
      const data = await res.json();
      setLineTestResult(data);
    } catch (err) {
      setLineTestResult({
        success: false,
        connected: false,
        error: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อทดสอบการเชื่อมต่อได้'
      });
    } finally {
      setLineTesting(false);
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
      const token = authManager.getToken() || localStorage.getItem('token') || '';
      const res = await fetch('/api/access/verify-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  LINE Channel Access Token
                </label>
                {hasTokenSaved && (
                  <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>
                    (ตั้งค่าแล้ว)
                  </span>
                )}
              </div>
              <textarea
                rows={2}
                className="form-control"
                placeholder={hasTokenSaved ? "•••••••••••••••••••••••• (ตั้งค่าแล้ว - กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน)" : "วาง Long-lived Channel Access Token จาก LINE Developers"}
                value={configs.line_channel_access_token || ''}
                onFocus={() => {
                  if (configs.line_channel_access_token && configs.line_channel_access_token.includes('•')) {
                    setConfigs({ ...configs, line_channel_access_token: '' });
                  }
                }}
                onChange={e => setConfigs({ ...configs, line_channel_access_token: e.target.value })}
                style={{ fontSize: '0.8rem', padding: '10px 12px', borderRadius: '12px', resize: 'none' }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                  LINE Channel Secret
                </label>
                {hasSecretSaved && (
                  <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>
                    (ตั้งค่าแล้ว)
                  </span>
                )}
              </div>
              <input
                type="password"
                className="form-control"
                placeholder={hasSecretSaved ? "•••••••••••••••• (ตั้งค่าแล้ว - กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน)" : "กรอก Channel Secret"}
                value={configs.line_channel_secret || ''}
                onFocus={() => {
                  if (configs.line_channel_secret && configs.line_channel_secret.includes('•')) {
                    setConfigs({ ...configs, line_channel_secret: '' });
                  }
                }}
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
                placeholder="ตัวอย่าง: 2011049416-AbCdEfGh (ไม่บังคับ)"
                value={configs.line_liff_id || ''}
                onChange={e => setConfigs({ ...configs, line_liff_id: e.target.value })}
                style={{ height: '42px', fontSize: '0.85rem', padding: '0 12px', borderRadius: '12px' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || lineTesting}
                style={{
                  flex: 1,
                  height: '42px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  backgroundColor: '#10b981',
                  border: 'none'
                }}
              >
                <Save size={16} />
                <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า LINE OA'}</span>
              </button>

              <button
                type="button"
                onClick={handleTestLineConnection}
                disabled={saving || lineTesting}
                className="btn btn-secondary"
                style={{
                  height: '42px',
                  padding: '0 18px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: 'var(--primary-color)',
                  border: '1px solid rgba(37, 99, 235, 0.25)'
                }}
              >
                <RefreshCw size={15} style={{ animation: lineTesting ? 'spin 1s linear infinite' : 'none' }} />
                <span>{lineTesting ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}</span>
              </button>
            </div>

            {lineTestResult && (
              <div style={{
                marginTop: '4px',
                padding: '14px 16px',
                borderRadius: '14px',
                border: `1px solid ${lineTestResult.connected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                backgroundColor: lineTestResult.connected ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '0.82rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {lineTestResult.connected ? (
                      <CheckCircle2 size={16} style={{ color: '#10b981' }} />
                    ) : (
                      <AlertCircle size={16} style={{ color: '#ef4444' }} />
                    )}
                    <span style={{ fontWeight: 800, color: lineTestResult.connected ? '#10b981' : '#ef4444' }}>
                      {lineTestResult.connected ? 'สถานะการเชื่อมต่อ: ผ่าน' : 'สถานะการเชื่อมต่อ: ไม่ผ่าน'}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    ตรวจสอบล่าสุด: {new Date().toLocaleTimeString('th-TH')} น.
                  </span>
                </div>

                {lineTestResult.connected && lineTestResult.bot && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-main)', fontSize: '0.82rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>บัญชี LINE OA:</span>
                    <strong style={{ color: '#10b981' }}>{lineTestResult.bot.name}</strong>
                    {lineTestResult.bot.basicId && (
                      <span style={{ color: 'var(--text-muted)' }}>({lineTestResult.bot.basicId})</span>
                    )}
                  </div>
                )}

                {!lineTestResult.connected && lineTestResult.error && (
                  <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.8rem' }}>
                    สาเหตุ: {lineTestResult.error}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px', fontSize: '0.76rem', borderTop: '1px dashed var(--border-color)', paddingTop: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Channel Secret:</span>
                    <span style={{ fontWeight: 700, color: lineTestResult.channelSecretStatus === 'configured' ? '#10b981' : '#f59e0b' }}>
                      {lineTestResult.channelSecretStatus === 'configured' ? 'ตั้งค่าแล้ว' : (lineTestResult.channelSecretStatus === 'not_configured' ? 'ยังไม่ได้ตั้งค่า' : 'ไม่สามารถตรวจสอบได้')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>LIFF App ID:</span>
                    <span style={{ fontWeight: 700, color: lineTestResult.liffIdStatus === 'valid_format' ? '#10b981' : (lineTestResult.liffIdStatus === 'invalid_format' ? '#ef4444' : '#f59e0b') }}>
                      {lineTestResult.liffIdStatus === 'valid_format' ? 'รูปแบบถูกต้อง (ยังไม่ได้ทดสอบ init จริง)' : (lineTestResult.liffIdStatus === 'invalid_format' ? 'รูปแบบไม่ถูกต้อง' : 'ยังไม่ได้ตั้งค่า')}
                    </span>
                  </div>
                </div>
              </div>
            )}
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

        </div>

        {/* Full-width Section: Online Booking Promotion Card */}
        <div style={{
          gridColumn: '1 / -1',
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: '24px',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          boxShadow: 'var(--glass-shadow)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff'
              }}>
                <Tag size={22} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  โปรโมชั่นจองออนไลน์ 5% (Online Booking Promotion)
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  ส่วนลด 5% สำหรับการจองผ่าน LINE OA และระบบออนไลน์เท่านั้น (การจองผ่าน POS หรือหน้าร้านคิดราคาเต็ม)
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '0.82rem',
                fontWeight: 700,
                backgroundColor: promoData?.status === 'active' ? 'rgba(16, 185, 129, 0.15)' :
                                 promoData?.status === 'ready' ? 'rgba(59, 130, 246, 0.15)' :
                                 promoData?.status === 'ended' ? 'rgba(107, 114, 128, 0.15)' :
                                 'rgba(245, 158, 11, 0.15)',
                color: promoData?.status === 'active' ? '#10b981' :
                       promoData?.status === 'ready' ? '#3b82f6' :
                       promoData?.status === 'ended' ? '#6b7280' :
                       '#f59e0b',
                border: `1px solid ${
                  promoData?.status === 'active' ? 'rgba(16, 185, 129, 0.3)' :
                  promoData?.status === 'ready' ? 'rgba(59, 130, 246, 0.3)' :
                  promoData?.status === 'ended' ? 'rgba(107, 114, 128, 0.3)' :
                  'rgba(245, 158, 11, 0.3)'
                }`
              }}>
                {promoData?.status_label || (promoData?.is_enabled ? 'กำลังใช้งาน' : 'รอเปิดใช้งาน')}
              </span>
              <button
                type="button"
                onClick={fetchPromotion}
                disabled={promoLoading}
                className="btn btn-secondary"
                style={{ padding: '6px 12px', height: '34px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer' }}
                title="รีเฟรชข้อมูลโปรโมชั่น"
              >
                <RefreshCw size={14} className={promoLoading ? 'spin' : ''} />
              </button>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '14px',
            backgroundColor: 'var(--bg-page)',
            padding: '16px',
            borderRadius: '16px',
            border: '1px solid var(--border)'
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ประเภทส่วนลด</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                ส่วนลด 5% ทุกห้องประชุม
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ช่องทางที่ได้รับสิทธิ์</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                Online & LINE OA เท่านั้น
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>วันเริ่มเปิดใช้งานได้</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                13 ต.ค. 2026 เวลา 08:00 น.
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>วันสิ้นสุดโปรโมชั่น</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                {promoData?.end_at ? promoData.end_at : 'ไม่มีกำหนดสิ้นสุด (ควบคุมด้วยตนเอง)'}
              </div>
            </div>
          </div>

          {/* Audit trail info */}
          {(promoData?.activated_at || promoData?.deactivated_at) && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {promoData?.activated_at && (
                <span>เปิดใช้งานล่าสุด: {promoData.activated_at} โดย {promoData.activated_by || '-'}</span>
              )}
              {promoData?.deactivated_at && !promoData?.is_enabled && (
                <span>หยุดใช้งานล่าสุด: {promoData.deactivated_at} โดย {promoData.deactivated_by || '-'}</span>
              )}
            </div>
          )}

          {/* Action Button Row */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center' }}>
            {promoData?.status === 'upcoming' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>
                <Clock size={16} />
                <span>สามารถเปิดใช้งานได้ตั้งแต่ 13 ต.ค. 2026 เวลา 08:00 น. เป็นต้นไป</span>
              </div>
            )}

            {promoData?.status === 'active' ? (
              <button
                type="button"
                onClick={handleDeactivatePromotion}
                disabled={promoActionLoading}
                className="btn"
                style={{
                  height: '42px',
                  padding: '0 20px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {promoActionLoading ? 'กำลังดำเนินการ...' : 'หยุดใช้งานโปรโมชั่น'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleActivatePromotion}
                disabled={promoActionLoading || promoData?.status === 'upcoming' || promoData?.status === 'ended'}
                className="btn"
                style={{
                  height: '42px',
                  padding: '0 20px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  backgroundColor: (promoData?.status === 'upcoming' || promoData?.status === 'ended') ? '#94a3b8' : '#10b981',
                  color: '#fff',
                  border: 'none',
                  cursor: (promoData?.status === 'upcoming' || promoData?.status === 'ended') ? 'not-allowed' : 'pointer'
                }}
              >
                {promoActionLoading ? 'กำลังดำเนินการ...' : 'เปิดใช้งานโปรโมชั่น 5%'}
              </button>
            )}
          </div>
        </div>

        {/* Full-width Save Button Footer spanning both columns */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{
              height: '50px',
              padding: '0 32px',
              borderRadius: '16px',
              fontWeight: 800,
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(16, 185, 129, 0.35)',
              backgroundColor: '#10b981',
              border: 'none',
              width: '100%'
            }}
          >
            <Save size={20} />
            <span>{saving ? 'กำลังบันทึกข้อมูล...' : '💾 บันทึกการตั้งค่าระบบจอง LINE OA & รหัสเข้าห้อง (Save Settings)'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default DoorAccessSettings;
