import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  Plus,
  Calendar,
  LayoutGrid,
  AlertCircle,
  ArrowRight,
  Check
} from 'lucide-react';
import './Dashboard.css';

function Dashboard({ user, hasPermission, onNavigate, sysAlert, sysConfirm }) {
  // Real Data States
  const [upcomingAlerts, setUpcomingAlerts] = useState([]);
  const [incomingBookings, setIncomingBookings] = useState([]);
  const [todayBookings, setTodayBookings] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [reviewingCount, setReviewingCount] = useState(0);

  // Status & Control States
  const [loading, setLoading] = useState(true);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdatedTime, setLastUpdatedTime] = useState('');
  const [currentTimeText, setCurrentTimeText] = useState('');

  // Manual refresh visual feedback states: 'idle' | 'loading' | 'success'
  const [manualRefreshState, setManualRefreshState] = useState('idle');
  const successTimerRef = useRef(null);

  // Cleanup feedback timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Request guard to prevent overlapping calls
  const isFetchingRef = useRef(false);

  // Real-time Clock (updates once every 30 seconds)
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      setCurrentTimeText(`${timeStr} น.`);
    };
    updateClock();
    const clockTimer = setInterval(updateClock, 30000);
    return () => clearInterval(clockTimer);
  }, []);

  // Format Thai Date string (e.g. "วันอาทิตย์ที่ 13 กันยายน 2569")
  const thaiDateFormatted = useMemo(() => {
    try {
      const now = new Date();
      return new Intl.DateTimeFormat('th-TH', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(now);
    } catch (e) {
      return '';
    }
  }, []);

  // Fetch real operational data from existing backend endpoints
  const fetchOperationalData = async (isManual = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (isManual) {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      setManualRefreshState('loading');
    }

    if (!isManual && !loading) {
      setIsBackgroundRefreshing(true);
    } else if (isManual) {
      setIsBackgroundRefreshing(true);
    }

    const startedAt = isManual ? performance.now() : 0;

    try {
      setApiError(null);
      const now = new Date();
      const isoLocal = now.toISOString();

      // Parallel fetch for alerts and current room occupancy
      const [alertsRes, occupancyRes] = await Promise.all([
        fetch('/api/bookings/upcoming-alerts'),
        fetch(`/api/rooms/occupancy?current_time=${encodeURIComponent(isoLocal)}`)
      ]);

      if (!alertsRes.ok || !occupancyRes.ok) {
        throw new Error(`โหลดข้อมูลไม่สำเร็จ (สถานะ: ${alertsRes.status}/${occupancyRes.status})`);
      }

      const alertsData = await alertsRes.json();
      const occupancyData = await occupancyRes.json();

      // Data is applied immediately
      setUpcomingAlerts(Array.isArray(alertsData.upcoming) ? alertsData.upcoming : []);
      setIncomingBookings(Array.isArray(alertsData.incomingBookings) ? alertsData.incomingBookings : []);
      setTodayBookings(Array.isArray(alertsData.todayBookings) ? alertsData.todayBookings : []);
      setReviewingCount(typeof alertsData.reviewingCount === 'number' ? alertsData.reviewingCount : 0);

      setRooms(Array.isArray(occupancyData) ? occupancyData : []);

      const updateTime = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLastUpdatedTime(updateTime);

      if (isManual) {
        const elapsed = performance.now() - startedAt;
        const remaining = Math.max(0, 350 - elapsed);
        if (remaining > 0) {
          await new Promise(r => setTimeout(r, remaining));
        }
        setManualRefreshState('success');
        successTimerRef.current = setTimeout(() => {
          setManualRefreshState('idle');
        }, 1000);
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching operational data:', err);
      if (isManual) {
        setManualRefreshState('idle');
      }
      if (loading || isManual) {
        setApiError(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      }
    } finally {
      setLoading(false);
      setIsBackgroundRefreshing(false);
      isFetchingRef.current = false;
    }
  };

  // Initial load and background polling interval (30 seconds)
  useEffect(() => {
    fetchOperationalData();

    const interval = setInterval(() => {
      fetchOperationalData(false);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Compute active dataset
  const activeData = useMemo(() => ({
    reviewingCount,
    upcomingAlerts,
    incomingBookings,
    todayBookings,
    rooms
  }), [reviewingCount, upcomingAlerts, incomingBookings, todayBookings, rooms]);

  // Compute Action Required items (Priority 1: reviewing slip, Priority 2: approaching time)
  const actionItems = useMemo(() => {
    const items = [];

    // Priority 1: Reviewing Payment / Slips
    (activeData.incomingBookings || []).forEach(b => {
      if (b.payment_status === 'reviewing') {
        items.push({
          id: `review-${b.booking_id || b.id}`,
          booking_id: b.booking_id || b.id,
          priority: 'reviewing',
          room_name: b.room_name || 'ห้องประชุม',
          customer_name: b.customer_name || 'ลูกค้า',
          start_time: b.start_time,
          end_time: b.end_time,
          statusLabel: 'รอตรวจสอบสลิป',
          statusType: 'blue',
          actionLabel: 'ตรวจสอบ',
          actionType: 'primary',
          actionTarget: 'pending'
        });
      }
    });

    // Priority 2: Upcoming bookings starting soon
    (activeData.upcomingAlerts || []).forEach(b => {
      const isAlreadyReviewing = items.some(it => String(it.booking_id) === String(b.booking_id || b.id));
      if (!isAlreadyReviewing) {
        items.push({
          id: `upcoming-${b.booking_id || b.id}`,
          booking_id: b.booking_id || b.id,
          priority: 'upcoming',
          room_name: b.room_name || 'ห้องประชุม',
          customer_name: b.customer_name || 'ลูกค้า',
          start_time: b.start_time,
          end_time: b.end_time,
          statusLabel: 'ใกล้ถึงเวลาใช้งาน',
          statusType: 'amber',
          actionLabel: 'ดูการจอง',
          actionType: 'amber',
          actionTarget: 'pending'
        });
      }
    });

    return items;
  }, [activeData]);

  // Filtered Action Items by Search
  const filteredActionItems = useMemo(() => {
    if (!searchQuery.trim()) return actionItems;
    const q = searchQuery.toLowerCase().trim();
    return actionItems.filter(item => {
      const code = String(item.booking_id).toLowerCase();
      const customer = String(item.customer_name || '').toLowerCase();
      const room = String(item.room_name || '').toLowerCase();
      return code.includes(q) || customer.includes(q) || room.includes(q);
    });
  }, [actionItems, searchQuery]);

  // Chronological Today Schedule
  const sortedTodayBookings = useMemo(() => {
    return [...(activeData.todayBookings || [])].sort((a, b) => {
      const tA = new Date(a.start_time).getTime();
      const tB = new Date(b.start_time).getTime();
      return tA - tB;
    });
  }, [activeData.todayBookings]);

  // Filtered Schedule by Search
  const filteredSchedule = useMemo(() => {
    if (!searchQuery.trim()) return sortedTodayBookings;
    const q = searchQuery.toLowerCase().trim();
    return sortedTodayBookings.filter(b => {
      const code = String(b.booking_id || b.id || '').toLowerCase();
      const customer = String(b.customer_name || '').toLowerCase();
      const room = String(b.room_name || '').toLowerCase();
      return code.includes(q) || customer.includes(q) || room.includes(q);
    });
  }, [sortedTodayBookings, searchQuery]);

  // Determine Room States dynamically
  const roomStatusList = useMemo(() => {
    const now = new Date();

    return (activeData.rooms || []).map(room => {
      if (room.isOccupied && room.currentBooking) {
        let endFormatted = '';
        try {
          endFormatted = new Date(room.currentBooking.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
          endFormatted = '';
        }

        return {
          ...room,
          stateType: 'occupied',
          stateLabel: 'กำลังใช้งาน',
          formattedEnd: endFormatted,
          detailText: endFormatted ? `ถึง ${endFormatted} น.` : 'กำลังใช้งาน',
          customerName: room.currentBooking.customer_name
        };
      }

      // Check if there is an upcoming booking today for this room
      const upcomingToday = (activeData.todayBookings || [])
        .filter(b => {
          const matchesRoom = (b.room_id != null && Number(b.room_id) === Number(room.id)) ||
            (b.room_name && room.name && b.room_name.trim().toLowerCase() === room.name.trim().toLowerCase());
          const isFuture = new Date(b.start_time).getTime() > now.getTime();
          const notCancelled = b.payment_status !== 'cancelled' && b.payment_status !== 'rejected';
          return matchesRoom && isFuture && notCancelled;
        })
        .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

      if (upcomingToday.length > 0) {
        const nextB = upcomingToday[0];
        let startFormatted = '';
        try {
          startFormatted = new Date(nextB.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
          startFormatted = '';
        }

        return {
          ...room,
          stateType: 'upcoming',
          stateLabel: 'ว่าง',
          formattedStart: startFormatted,
          detailText: startFormatted ? `จองถัดไป ${startFormatted} น.` : 'มีการจองถัดไป',
          customerName: nextB.customer_name
        };
      }

      return {
        ...room,
        stateType: 'available',
        stateLabel: 'ว่าง',
        formattedStart: null,
        detailText: 'พร้อมใช้งาน',
        customerName: null
      };
    });
  }, [activeData]);

  // Filtered Rooms by Search
  const filteredRooms = useMemo(() => {
    if (!searchQuery.trim()) return roomStatusList;
    const q = searchQuery.toLowerCase().trim();
    return roomStatusList.filter(room => {
      const name = String(room.name || '').toLowerCase();
      const customer = String(room.customerName || '').toLowerCase();
      return name.includes(q) || customer.includes(q);
    });
  }, [roomStatusList, searchQuery]);

  // Permission Destination Guard
  const canAccess = (tabKey) => {
    if (typeof hasPermission === 'function') {
      return hasPermission(tabKey);
    }
    if (!user) return false;
    if (user.username === 'admin') return true;
    const permString = typeof user.permissions === 'string' ? user.permissions : '';
    const perms = permString.split(',').map(p => p.trim()).filter(Boolean);
    return perms.includes(tabKey);
  };

  const canAccessPos = canAccess('pos');
  const canAccessPending = canAccess('pending');

  // Handlers
  const handleActionClick = (item) => {
    const target = item.actionTarget || 'pending';
    if (!canAccess(target)) return;

    if (onNavigate) {
      onNavigate(target, {
        bookingId: item.booking_id,
        action: item.priority === 'reviewing' ? 'review' : 'view'
      });
    }
  };

  const handleQuickAction = (targetTab, options = {}) => {
    if (!canAccess(targetTab)) return;
    if (onNavigate) {
      onNavigate(targetTab, options);
    }
  };

  const formatTimeOnly = (isoStr) => {
    try {
      if (!isoStr) return '--:--';
      return new Date(isoStr).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '--:--';
    }
  };

  const formatServiceTime = (startStr, endStr) => {
    try {
      if (!startStr) return '-';
      const startT = formatTimeOnly(startStr);
      const endT = endStr ? formatTimeOnly(endStr) : '';
      return endT ? `${startT} - ${endT} น.` : `${startT} น.`;
    } catch (e) {
      return `${startStr} - ${endStr || ''}`;
    }
  };

  const getTimelineState = (startStr, endStr) => {
    try {
      const now = new Date();
      const startT = new Date(startStr);
      const endT = new Date(endStr);

      if (!isNaN(endT.getTime()) && now > endT) {
        return 'past';
      }
      if (!isNaN(startT.getTime()) && !isNaN(endT.getTime()) && now >= startT && now <= endT) {
        return 'current';
      }
      return 'future';
    } catch (e) {
      return 'future';
    }
  };

  const occupiedRoomsCount = useMemo(() => {
    return (activeData.rooms || []).filter(r => r.isOccupied).length;
  }, [activeData.rooms]);

  return (
    <div className="op-console">
      {/* ===================================================
          1. HEADER (Compact operational header)
          =================================================== */}
      <header className="op-console-header">
        <div className="op-header-left">
          <h1 className="op-console-title">Today Overview</h1>
          <div className="op-console-subline">
            <span>{thaiDateFormatted}</span>
            {currentTimeText && (
              <>
                <span className="op-subline-dot">•</span>
                <span className="op-subline-time">{currentTimeText}</span>
              </>
            )}
            <span className={`op-sync-badge ${manualRefreshState === 'success' ? 'success' : ''}`}>
              <span className={`op-sync-dot ${isBackgroundRefreshing || manualRefreshState === 'loading' ? 'pulsing' : manualRefreshState === 'success' ? 'success' : ''}`} />
              <span>
                {manualRefreshState === 'loading' || isBackgroundRefreshing
                  ? 'กำลังซิงค์...'
                  : manualRefreshState === 'success'
                  ? 'อัปเดตแล้ว'
                  : `อัปเดต ${lastUpdatedTime || '-'}`}
              </span>
            </span>
          </div>
        </div>

        <div className="op-header-right">
          {/* Local Search Input */}
          <div className="op-search-box">
            <Search size={14} className="op-search-icon" />
            <input
              type="text"
              className="op-search-input"
              placeholder="ค้นหารายการ, ลูกค้า, หรือห้อง..."
              aria-label="ค้นหารายการจอง, ลูกค้า, หรือห้องประชุม"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="op-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="ล้างการค้นหา"
              >
                ล้าง
              </button>
            )}
          </div>

          {/* + สร้างการจอง (Existing POS navigation contract - guarded by POS permission) */}
          {canAccessPos && (
            <button
              type="button"
              className="op-btn op-btn-primary"
              onClick={() => handleQuickAction('pos')}
              title="เปิดระบบจุดขาย POS เพื่อสร้างการจองใหม่"
            >
              <Plus size={15} />
              <span>สร้างการจอง</span>
            </button>
          )}

          {/* Refresh Button */}
          <button
            type="button"
            className={`op-btn op-btn-icon ${manualRefreshState === 'success' ? 'success' : ''}`}
            onClick={() => fetchOperationalData(true)}
            disabled={isBackgroundRefreshing || manualRefreshState === 'loading'}
            aria-label="รีเฟรชข้อมูลประจำวัน"
            title="รีเฟรชข้อมูลประจำวัน"
          >
            {manualRefreshState === 'success' ? (
              <Check size={14} style={{ color: '#10b981' }} />
            ) : (
              <RefreshCw size={14} className={manualRefreshState === 'loading' || isBackgroundRefreshing ? 'animate-spin' : ''} />
            )}
          </button>
        </div>
      </header>

      {/* API Error Alert Banner */}
      {apiError && (
        <div className="op-console-error">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{apiError}</span>
          </div>
          <button
            type="button"
            className="op-btn op-btn-sm"
            onClick={() => fetchOperationalData(true)}
            disabled={loading || isBackgroundRefreshing}
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {/* ===================================================
          2. FLAT OPERATIONAL SUMMARY (Directly below header)
          =================================================== */}
      <section className="op-console-summary" aria-label="สรุปข้อมูลการดำเนินงาน">
        {/* รอตรวจสลิป */}
        <div className="op-summary-item accent-blue">
          <span className="op-summary-label">รอตรวจสลิป</span>
          <span className="op-summary-val">{activeData.reviewingCount}</span>
        </div>

        {/* ใกล้ถึงเวลา */}
        <div className="op-summary-item accent-amber">
          <span className="op-summary-label">ใกล้ถึงเวลา</span>
          <span className="op-summary-val">{(activeData.upcomingAlerts || []).length}</span>
        </div>

        {/* กำลังใช้งาน */}
        <div className="op-summary-item accent-green">
          <span className="op-summary-label">กำลังใช้งาน</span>
          <span className="op-summary-val">
            {occupiedRoomsCount}
            <span className="op-summary-denom">/{(activeData.rooms || []).length || 0}</span>
          </span>
        </div>

        {/* การจองวันนี้ */}
        <div className="op-summary-item accent-slate">
          <span className="op-summary-label">การจองวันนี้</span>
          <span className="op-summary-val">{(activeData.todayBookings || []).length}</span>
        </div>
      </section>

      {/* ===================================================
          3. MAIN OPERATIONS GRID (60% / 40% Split)
          Row 1: Today Schedule (60%)   | Rooms Now (40%)
          Row 2: Action Required (60%)  | Booking Workspace (40%)
          =================================================== */}
      <div className="op-console-grid">
        {/* LEFT COLUMN: 60% */}
        <div className="op-grid-col op-col-main">
          {/* PRIMARY LEFT: TODAY SCHEDULE */}
          <section className="op-card-section op-schedule-section">
            <div className="op-section-header">
              <div className="op-section-title-wrap">
                <h2 className="op-section-title">Today Schedule</h2>
                <span className="op-section-sub">กำหนดการวันนี้</span>
                {filteredSchedule.length > 0 && (
                  <span className="op-badge-count">{filteredSchedule.length}</span>
                )}
              </div>
              <span className="op-section-hint">เรียงตามเวลาเริ่มต้น</span>
            </div>

            {loading && !activeData.todayBookings.length ? (
              <div className="op-console-loading">
                <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                <span>กำลังโหลดกำหนดการวันนี้...</span>
              </div>
            ) : filteredSchedule.length === 0 ? (
              <div className="op-console-empty-schedule">
                <p className="op-empty-main-text">
                  {searchQuery ? `ไม่พบกำหนดการที่ตรงกับ "${searchQuery}"` : 'ไม่มีกำหนดการจองสำหรับวันนี้'}
                </p>
                {searchQuery && (
                  <button
                    type="button"
                    className="op-btn op-btn-sm"
                    onClick={() => setSearchQuery('')}
                  >
                    ล้างการค้นหา
                  </button>
                )}
              </div>
            ) : (
              <div className="op-schedule-timeline">
                {filteredSchedule.map((b) => {
                  const timeState = getTimelineState(b.start_time, b.end_time);
                  const isReviewing = b.payment_status === 'reviewing';
                  const isApproaching = (activeData.upcomingAlerts || []).some(
                    u => String(u.booking_id) === String(b.booking_id || b.id)
                  );

                  return (
                    <div
                      key={b.booking_id || b.id}
                      className={`op-timeline-row state-${timeState}`}
                    >
                      {/* Time Rail */}
                      <div className="op-time-rail">
                        <span className="op-time-start">{formatTimeOnly(b.start_time)}</span>
                        <span className="op-time-dash">-</span>
                        <span className="op-time-end">{formatTimeOnly(b.end_time)}</span>
                        <div className="op-time-rail-line" />
                      </div>

                      {/* Schedule Band Content */}
                      <div className="op-schedule-content">
                        <div className="op-schedule-primary">
                          <div className="op-schedule-room-row">
                            <span className="op-schedule-room">{b.room_name || 'ห้องประชุม'}</span>
                            {timeState === 'current' && (
                              <span className="op-schedule-current-badge">
                                <span className="op-badge-pulse-dot" />
                                กำลังใช้งาน
                              </span>
                            )}
                          </div>
                          <span className="op-schedule-customer">{b.customer_name || 'ลูกค้า'}</span>
                        </div>

                        <div className="op-schedule-actions">
                          {/* Compact Payment / Booking Status Pill */}
                          <span className={`op-status-pill ${
                            b.payment_status === 'paid' ? 'op-pill-green' :
                            b.payment_status === 'reviewing' ? 'op-pill-blue' :
                            'op-pill-amber'
                          }`}>
                            {b.payment_status === 'paid' ? 'ชำระแล้ว' :
                             b.payment_status === 'reviewing' ? 'รอตรวจสลิป' :
                             b.payment_status === 'pending' ? 'รอชำระ' : b.payment_status}
                          </span>

                          {/* Contextual Action ONLY when useful and permitted */}
                          {isReviewing && canAccessPending ? (
                            <button
                              type="button"
                              className="op-action-btn op-btn-action-primary"
                              onClick={() => handleActionClick({
                                booking_id: b.booking_id || b.id,
                                priority: 'reviewing',
                                actionTarget: 'pending'
                              })}
                              title={`ตรวจสอบการชำระเงิน #${b.booking_id || b.id}`}
                            >
                              <span>ตรวจสอบ</span>
                              <ArrowRight size={13} />
                            </button>
                          ) : isApproaching && canAccessPending ? (
                            <button
                              type="button"
                              className="op-action-btn op-btn-action-amber"
                              onClick={() => handleActionClick({
                                booking_id: b.booking_id || b.id,
                                priority: 'upcoming',
                                actionTarget: 'pending'
                              })}
                              title={`ดูรายละเอียดการจอง #${b.booking_id || b.id}`}
                            >
                              <span>ดูการจอง</span>
                              <ArrowRight size={13} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECONDARY LEFT: ACTION REQUIRED (ต้องดำเนินการ) */}
          <section className="op-card-section op-action-section">
            <div className="op-section-header">
              <div className="op-section-title-wrap">
                <h2 className="op-section-title">ต้องดำเนินการ</h2>
                {filteredActionItems.length > 0 && (
                  <span className="op-badge-count amber">{filteredActionItems.length}</span>
                )}
              </div>
              <span className="op-section-hint">รายการเร่งด่วนที่ต้องจัดการ</span>
            </div>

            {filteredActionItems.length === 0 ? (
              <div className="op-action-empty-row">
                {searchQuery ? (
                  <span className="op-empty-lead">ไม่พบรายการเร่งด่วนที่ตรงกับคำค้นหา</span>
                ) : (
                  <>
                    <span className="op-empty-pulse-dot" />
                    <span className="op-empty-lead">ไม่มีรายการเร่งด่วน</span>
                    <span className="op-empty-sep">•</span>
                    <span className="op-empty-sub">ทุกอย่างเรียบร้อยแล้ว</span>
                  </>
                )}
              </div>
            ) : (
              <div className="op-action-list">
                {filteredActionItems.map((item) => (
                  <div key={item.id} className={`op-action-row priority-${item.priority}`}>
                    <div className="op-action-info">
                      <div className="op-action-top">
                        <span className="op-booking-tag">#{item.booking_id}</span>
                        <span className="op-action-room">{item.room_name}</span>
                        <span className={`op-status-pill op-pill-${item.statusType}`}>
                          {item.statusLabel}
                        </span>
                      </div>
                      <div className="op-action-meta">
                        <span className="op-action-customer">{item.customer_name}</span>
                        <span className="op-action-time">{formatServiceTime(item.start_time, item.end_time)}</span>
                      </div>
                    </div>

                    {canAccessPending && (
                      <button
                        type="button"
                        className={`op-action-btn ${
                          item.priority === 'reviewing' ? 'op-btn-action-primary' : 'op-btn-action-amber'
                        }`}
                        onClick={() => handleActionClick(item)}
                        title={`${item.actionLabel} รายการ #${item.booking_id}`}
                      >
                        <span>{item.actionLabel}</span>
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: 40% */}
        <div className="op-grid-col op-col-side">
          {/* PRIMARY RIGHT: ROOMS NOW (ห้องประชุมตอนนี้) */}
          <section className="op-card-section op-rooms-section">
            <div className="op-section-header">
              <div className="op-section-title-wrap">
                <h2 className="op-section-title">Rooms Now</h2>
                <span className="op-section-sub">ห้องประชุมตอนนี้</span>
                <span className="op-badge-count">{filteredRooms.length}</span>
              </div>
              <span className="op-section-hint">สถานะเรียลไทม์</span>
            </div>

            {loading && !filteredRooms.length ? (
              <div className="op-console-loading">
                <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
                <span>กำลังตรวจสอบสถานะห้อง...</span>
              </div>
            ) : filteredRooms.length === 0 ? (
              <div className="op-console-empty-schedule">
                <p className="op-empty-main-text">
                  {searchQuery ? 'ไม่พบห้องที่ตรงกับการค้นหา' : 'ไม่มีข้อมูลห้องประชุม'}
                </p>
              </div>
            ) : (
              <div className="op-rooms-list">
                {filteredRooms.map((room) => (
                  <div
                    key={room.id}
                    className={`op-room-row status-${room.stateType}`}
                  >
                    <div className="op-room-main-info">
                      <span className="op-room-title">{room.name}</span>
                      {room.capacity ? (
                        <span className="op-room-cap">{room.capacity} ที่นั่ง</span>
                      ) : null}
                    </div>

                    <div className="op-room-status-info">
                      <span className={`op-room-dot dot-${room.stateType}`} />
                      <div className="op-room-status-texts">
                        <span className="op-room-status-label">{room.stateLabel}</span>
                        <span className="op-room-status-context">
                          {room.stateType === 'occupied'
                            ? `ถึง ${room.formattedEnd || ''} น.`
                            : room.stateType === 'upcoming'
                            ? `จองถัดไป ${room.formattedStart || ''} น.`
                            : 'พร้อมใช้งาน'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* SECONDARY RIGHT: BOOKING WORKSPACE (Direct POS Shortcuts - guarded by POS permission) */}
          {canAccessPos && (
            <section className="op-card-section op-workspace-section">
              <div className="op-section-header">
                <div className="op-section-title-wrap">
                  <h2 className="op-section-title">Booking Workspace</h2>
                  <span className="op-section-sub">เครื่องมือจัดการการจอง</span>
                </div>
                <span className="op-section-hint">ทางลัดระบบ POS</span>
              </div>

              <div className="op-workspace-list">
                {/* Shortcut 1: Calendar */}
                <button
                  type="button"
                  className="op-workspace-item"
                  onClick={() => handleQuickAction('pos', { view: 'calendar' })}
                  title="เปิดปฏิทินรายเดือนในระบบ POS (Calendar View)"
                >
                  <div className="op-workspace-icon-wrap">
                    <Calendar size={18} />
                  </div>
                  <div className="op-workspace-text">
                    <div className="op-workspace-title-row">
                      <span className="op-workspace-title">Calendar</span>
                      <span className="op-workspace-badge">ปฏิทินเดือน</span>
                    </div>
                    <p className="op-workspace-desc">ดูตารางและปฏิทินการจองห้องประชุมรายเดือน</p>
                  </div>
                  <ArrowRight size={15} className="op-workspace-arrow" />
                </button>

                {/* Shortcut 2: Timeline Matrix */}
                <button
                  type="button"
                  className="op-workspace-item"
                  onClick={() => handleQuickAction('pos', { view: 'matrix' })}
                  title="เปิดผังจองห้องประจำวันในระบบ POS (Timeline Matrix & Cards)"
                >
                  <div className="op-workspace-icon-wrap">
                    <LayoutGrid size={18} />
                  </div>
                  <div className="op-workspace-text">
                    <div className="op-workspace-title-row">
                      <span className="op-workspace-title">Timeline Matrix</span>
                      <span className="op-workspace-badge">ผังจองห้องประจำวัน</span>
                    </div>
                    <p className="op-workspace-desc">ดูผังเวลาและการใช้ห้องประชุมรายวันแบบเรียลไทม์</p>
                  </div>
                  <ArrowRight size={15} className="op-workspace-arrow" />
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
