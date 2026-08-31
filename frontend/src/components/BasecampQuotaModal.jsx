import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export default function BasecampQuotaModal({ isOpen, onClose }) {
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [activeZone, setActiveZone] = useState('office'); // 'office' | 'hotdesk'
  const [searchQuery, setSearchQuery] = useState('');
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected Unit for the Inspector panel
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [unitHistoryList, setUnitHistoryList] = useState([]);

  // Fetch Quota Overview
  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/basecamp/quota/overview?month=${selectedMonth}&year=${selectedYear}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const list = data.units || [];
        setUnits(list);
        if (!selectedUnit && list.length > 0) {
          const firstOffice = list.find(u => u.sub_type === 'office') || list[0];
          setSelectedUnit(firstOffice);
        } else if (selectedUnit) {
          const updated = list.find(u => u.unit === selectedUnit.unit && u.sub_type === selectedUnit.sub_type);
          if (updated) setSelectedUnit(updated);
        }
      }
    } catch (err) {
      console.warn('Failed to load basecamp quota overview:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchOverview();
    }
  }, [isOpen, selectedMonth, selectedYear]);

  // Fetch History whenever selected unit changes or month changes
  useEffect(() => {
    if (selectedUnit && isOpen) {
      setHistoryLoading(true);
      fetch(`/api/basecamp/quota/history?sub_type=${selectedUnit.sub_type}&unit=${selectedUnit.unit}&month=${selectedMonth}&year=${selectedYear}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.success) {
            setUnitHistoryList(data.bookings || []);
          } else {
            setUnitHistoryList([]);
          }
        })
        .catch(err => {
          console.warn('Failed to fetch unit quota history:', err);
          setUnitHistoryList([]);
        })
        .finally(() => {
          setHistoryLoading(false);
        });
    }
  }, [selectedUnit?.unit, selectedUnit?.sub_type, selectedMonth, selectedYear, isOpen]);

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(prev => prev - 1);
    } else {
      setSelectedMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(prev => prev + 1);
    } else {
      setSelectedMonth(prev => prev + 1);
    }
  };

  const handleSetCurrentMonth = () => {
    const now = new Date();
    setSelectedMonth(now.getMonth() + 1);
    setSelectedYear(now.getFullYear());
  };

  if (!isOpen) return null;

  // Calculate totals
  const totalAllocated = units.reduce((sum, u) => sum + u.max_quota, 0);
  const totalUsed = units.reduce((sum, u) => sum + u.used_quota, 0);
  const totalRemaining = units.reduce((sum, u) => sum + u.remaining_quota, 0);
  const usedPercentage = totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0;

  // Filtered lists
  const officeUnits = units.filter(u => u.sub_type === 'office');
  const hotdeskUnits = units.filter(u => u.sub_type === 'hotdesk');

  const currentZoneUnits = (activeZone === 'office' ? officeUnits : hotdeskUnits).filter(u => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return u.unit.toLowerCase().includes(q) || u.label.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      animation: 'fadeIn 0.15s ease-out'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: '20px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.4)',
        width: '100%',
        maxWidth: '1080px',
        height: '88vh',
        maxHeight: '760px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>

        {/* ========================================================= */}
        {/* 1. TOP HEADER & MONTH NAVIGATOR (CLEAN TYPOGRAPHY)        */}
        {/* ========================================================= */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-card)',
          gap: '16px'
        }}>
          {/* Brand Title */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
                โควต้าห้องประชุมผู้เช่าชั้น 4
              </h2>
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                color: '#9333ea',
                border: '1px solid rgba(147, 51, 234, 0.25)',
                padding: '2px 8px',
                borderRadius: '6px'
              }}>
                Basecamp Hub
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              ตรวจสอบสิทธิ์ใช้งานห้องประชุมฟรีประจำเดือน • Office 4 ชม. • Hotdesk 2 ชม.
            </p>
          </div>

          {/* Month Selector Capsule & Close Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Modern Month Capsule */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              backgroundColor: 'var(--bg-main)',
              borderRadius: '10px',
              padding: '3px',
              border: '1px solid var(--border-color)',
              gap: '2px'
            }}>
              <button
                type="button"
                onClick={handlePrevMonth}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '7px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="เดือนก่อนหน้า"
              >
                <ChevronLeft size={16} />
              </button>

              <div style={{
                padding: '0 10px',
                fontWeight: 800,
                fontSize: '0.84rem',
                color: 'var(--text-main)',
                whiteSpace: 'nowrap'
              }}>
                {THAI_MONTHS[selectedMonth - 1]} {selectedYear + 543}
              </div>

              <button
                type="button"
                onClick={handleNextMonth}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '7px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="เดือนถัดไป"
              >
                <ChevronRight size={16} />
              </button>

              <button
                type="button"
                onClick={handleSetCurrentMonth}
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: '1px solid rgba(147, 51, 234, 0.25)',
                  backgroundColor: 'rgba(147, 51, 234, 0.08)',
                  color: '#9333ea',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                วันนี้
              </button>
            </div>

            {/* Close Modal */}
            <button
              type="button"
              onClick={onClose}
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-main)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="ปิดหน้าต่าง"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 2. STATS SUMMARY STRIP                                    */}
        {/* ========================================================= */}
        <div style={{
          padding: '10px 24px',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-main)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          {/* Metric Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              padding: '6px 14px',
              borderRadius: '10px',
              fontSize: '0.8rem'
            }}>
              <span style={{ color: 'var(--text-muted)' }}>โควต้าจัดสรรรวม:</span>
              <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>{totalAllocated} ชม.</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>(22 ยูนิต)</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: totalUsed > 0 ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-card)',
              border: totalUsed > 0 ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid var(--border-color)',
              padding: '6px 14px',
              borderRadius: '10px',
              fontSize: '0.8rem'
            }}>
              <span style={{ color: totalUsed > 0 ? '#ef4444' : 'var(--text-muted)' }}>ใช้ไปแล้ว:</span>
              <strong style={{ color: totalUsed > 0 ? '#ef4444' : 'var(--text-main)', fontSize: '0.9rem' }}>{totalUsed} ชม.</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>({usedPercentage}%)</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '6px 14px',
              borderRadius: '10px',
              fontSize: '0.8rem'
            }}>
              <span style={{ color: '#10b981' }}>คงเหลือพร้อมใช้:</span>
              <strong style={{ color: '#10b981', fontSize: '0.9rem' }}>{totalRemaining} ชม.</strong>
            </div>
          </div>

          {/* Search Box */}
          <div style={{ width: '200px' }}>
            <input
              type="text"
              placeholder="ค้นหาเลขยูนิต..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                height: '32px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-main)',
                padding: '0 10px',
                fontSize: '0.76rem',
                outline: 'none'
              }}
            />
          </div>
        </div>

        {/* ========================================================= */}
        {/* 3. MASTER-DETAIL 2-COLUMN WORKSPACE                       */}
        {/* ========================================================= */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.2fr 1fr', overflow: 'hidden' }}>

          {/* LEFT COLUMN: INTERACTIVE UNIT GRID */}
          <div style={{
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-card)'
          }}>
            {/* Zone Switcher Tabs */}
            <div style={{
              padding: '12px 20px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              gap: '8px',
              backgroundColor: 'var(--bg-main)'
            }}>
              <button
                type="button"
                onClick={() => {
                  setActiveZone('office');
                  const first = officeUnits[0];
                  if (first) setSelectedUnit(first);
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  borderRadius: '9px',
                  border: activeZone === 'office' ? '1px solid #9333ea' : '1px solid var(--border-color)',
                  backgroundColor: activeZone === 'office' ? 'rgba(147, 51, 234, 0.12)' : 'var(--bg-card)',
                  color: activeZone === 'office' ? '#9333ea' : 'var(--text-muted)',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>ห้อง Office (401–414)</span>
                <span style={{
                  fontSize: '0.68rem',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  backgroundColor: activeZone === 'office' ? '#9333ea' : 'var(--bg-main)',
                  color: activeZone === 'office' ? '#ffffff' : 'var(--text-muted)'
                }}>
                  14
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveZone('hotdesk');
                  const first = hotdeskUnits[0];
                  if (first) setSelectedUnit(first);
                }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '8px 14px',
                  borderRadius: '9px',
                  border: activeZone === 'hotdesk' ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                  backgroundColor: activeZone === 'hotdesk' ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-card)',
                  color: activeZone === 'hotdesk' ? '#3b82f6' : 'var(--text-muted)',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>Hotdesk (419–430)</span>
                <span style={{
                  fontSize: '0.68rem',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  backgroundColor: activeZone === 'hotdesk' ? '#3b82f6' : 'var(--bg-main)',
                  color: activeZone === 'hotdesk' ? '#ffffff' : 'var(--text-muted)'
                }}>
                  8
                </span>
              </button>
            </div>

            {/* Units Grid */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                gap: '10px'
              }}>
                {currentZoneUnits.map((u) => {
                  const isSelected = selectedUnit?.unit === u.unit && selectedUnit?.sub_type === u.sub_type;
                  const isOut = u.remaining_quota === 0;
                  const isPartial = u.used_quota > 0 && u.remaining_quota > 0;

                  return (
                    <button
                      key={`${u.sub_type}_${u.unit}`}
                      type="button"
                      onClick={() => setSelectedUnit(u)}
                      style={{
                        padding: '12px 10px',
                        borderRadius: '12px',
                        border: isSelected 
                          ? (activeZone === 'office' ? '2px solid #9333ea' : '2px solid #3b82f6')
                          : '1px solid var(--border-color)',
                        backgroundColor: isSelected 
                          ? (activeZone === 'office' ? 'rgba(147, 51, 234, 0.1)' : 'rgba(59, 130, 246, 0.1)')
                          : 'var(--bg-main)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 4px 12px rgba(147, 51, 234, 0.18)' : 'none',
                        outline: 'none'
                      }}
                    >
                      {/* Unit Number */}
                      <span style={{
                        fontSize: '1rem',
                        fontWeight: 800,
                        color: 'var(--text-main)',
                        letterSpacing: '-0.02em'
                      }}>
                        {activeZone === 'office' ? `ห้อง ${u.unit}` : `Desk ${u.unit}`}
                      </span>

                      {/* Quota Badge */}
                      <span style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '6px',
                        backgroundColor: isOut ? 'rgba(239, 68, 68, 0.12)' : isPartial ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                        color: isOut ? '#ef4444' : isPartial ? '#f59e0b' : '#10b981',
                        border: isOut ? '1px solid rgba(239, 68, 68, 0.25)' : isPartial ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)'
                      }}>
                        {u.remaining_quota} / {u.max_quota} ชม.
                      </span>

                      {/* Usage Count Subtitle */}
                      <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                        {u.used_count > 0 ? `ใช้แล้ว ${u.used_count} ครั้ง` : 'ยังไม่ได้ใช้'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: LIVE UNIT INSPECTOR & USAGE TIMELINE */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: 'var(--bg-main)'
          }}>
            {selectedUnit ? (
              <>
                {/* Selected Unit Header Inspector Card */}
                <div style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                      {selectedUnit.label}
                    </h3>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {selectedUnit.sub_type === 'office' ? 'ห้อง Office ชั้น 4 (โควต้า 4 ชม./เดือน)' : 'ที่นั่ง Hotdesk ชั้น 4 (โควต้า 2 ชม./เดือน)'}
                    </div>
                  </div>

                  {/* Quota Big Pill */}
                  <div style={{
                    padding: '6px 14px',
                    borderRadius: '10px',
                    backgroundColor: selectedUnit.remaining_quota > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    border: selectedUnit.remaining_quota > 0 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                    textAlign: 'right'
                  }}>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>คงเหลือ</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 900, color: selectedUnit.remaining_quota > 0 ? '#10b981' : '#ef4444', lineHeight: 1.1 }}>
                      {selectedUnit.remaining_quota} ชม.
                    </div>
                  </div>
                </div>

                {/* Progress Details Bar */}
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      ใช้ไปแล้ว: <strong style={{ color: selectedUnit.used_quota > 0 ? '#ef4444' : 'var(--text-main)' }}>{selectedUnit.used_quota} ชม.</strong>
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      สิทธิ์เต็ม: <strong>{selectedUnit.max_quota} ชม.</strong>
                    </span>
                  </div>

                  <div style={{
                    width: '100%',
                    height: '8px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--bg-main)',
                    overflow: 'hidden',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      width: `${Math.min(100, Math.round((selectedUnit.used_quota / selectedUnit.max_quota) * 100))}%`,
                      height: '100%',
                      backgroundColor: selectedUnit.remaining_quota === 0 ? '#ef4444' : '#9333ea',
                      borderRadius: '999px',
                      transition: 'width 0.3s ease'
                    }}></div>
                  </div>
                </div>

                {/* Usage Timeline / History List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-main)', marginBottom: '10px' }}>
                    ประวัติการใช้โควต้าในเดือน {THAI_MONTHS[selectedMonth - 1]}
                  </div>

                  {historyLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      กำลังดึงข้อมูลประวัติ...
                    </div>
                  ) : unitHistoryList.length === 0 ? (
                    <div style={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px dashed var(--border-color)',
                      borderRadius: '14px',
                      padding: '36px 20px',
                      textAlign: 'center',
                      color: 'var(--text-muted)'
                    }}>
                      <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-main)' }}>
                        ยังไม่มีการใช้งานโควต้าในเดือนนี้
                      </div>
                      <div style={{ fontSize: '0.76rem', marginTop: '4px' }}>
                        สามารถนำสิทธิ์คงเหลือ {selectedUnit.max_quota} ชม. ไปใช้จองห้องประชุมฟรี 0 บาทได้ทันที
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {unitHistoryList.map((bk, idx) => (
                        <div
                          key={bk.id || idx}
                          style={{
                            backgroundColor: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            padding: '10px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '10px'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <strong style={{ fontSize: '0.86rem', color: 'var(--text-main)' }}>
                                {bk.room_name || 'ห้องประชุม'}
                              </strong>
                              <span style={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                                color: '#9333ea'
                              }}>
                                {bk.booking_code || `#${bk.id}`}
                              </span>
                            </div>

                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              วันที่: {bk.start_time ? new Date(bk.start_time).toLocaleDateString('th-TH') : '-'} | เวลา: {bk.start_time ? new Date(bk.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''} - {bk.end_time ? new Date(bk.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : ''}
                            </div>

                            {bk.customer_name && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                                ผู้จอง: {bk.customer_name}
                              </div>
                            )}
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: 900, color: '#ef4444' }}>
                              -{bk.quota_hours_used || bk.hours || 1} ชม.
                            </div>
                            <span style={{ fontSize: '0.66rem', color: '#10b981', fontWeight: 700 }}>
                              สิทธิ์ฟรี (0 บาท)
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                เลือกยูนิตด้านซ้ายเพื่อดูรายละเอียด
              </div>
            )}
          </div>

        </div>

        {/* ========================================================= */}
        {/* 4. FOOTER BAR                                             */}
        {/* ========================================================= */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-card)'
        }}>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            สิทธิ์โควต้าฟรีจะรีเซ็ตอัตโนมัติทุกวันที่ 1 ของแต่ละเดือน
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 20px',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-main)',
              color: 'var(--text-main)',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            ปิดหน้าต่าง
          </button>
        </div>

      </div>
    </div>
  );
}
