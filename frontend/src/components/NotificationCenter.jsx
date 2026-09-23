import React, { useState, useRef, useEffect } from 'react';
import {
  Bell,
  X,
  CheckCircle2,
  Clock,
  Calendar,
  Volume2,
  VolumeX,
  AlertCircle,
  Receipt,
  PlayCircle,
  Sparkles
} from 'lucide-react';

/**
 * Format relative or short time in Thai
 */
function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffMs = now - Number(timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 45) return 'เมื่อสักครู่';
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  if (diffHour < 24) return `${diffHour} ชม. ที่แล้ว`;

  const d = new Date(timestamp);
  return d.toLocaleDateString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Get icon & style configuration based on event type
 */
function getEventBadgeConfig(type) {
  switch (type) {
    case 'SLIP_UPLOADED':
      return {
        icon: Receipt,
        color: '#0ea5e9',
        bgColor: 'rgba(14, 165, 233, 0.12)',
        borderColor: 'rgba(14, 165, 233, 0.3)',
        tag: 'สลิปโอนเงิน'
      };
    case 'NEW_LINE_BOOKING':
      return {
        icon: Sparkles,
        color: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.12)',
        borderColor: 'rgba(245, 158, 11, 0.3)',
        tag: 'จองออนไลน์'
      };
    case 'ROOM_STARTED':
      return {
        icon: PlayCircle,
        color: '#10b981',
        bgColor: 'rgba(16, 185, 129, 0.12)',
        borderColor: 'rgba(16, 185, 129, 0.3)',
        tag: 'ถึงเวลาเริ่ม'
      };
    case 'ROOM_UPCOMING':
    default:
      return {
        icon: Clock,
        color: '#ef4444',
        bgColor: 'rgba(239, 68, 68, 0.12)',
        borderColor: 'rgba(239, 68, 68, 0.3)',
        tag: 'ใกล้ถึงเวลา'
      };
  }
}

export default function NotificationCenter({
  notifications = [],
  unreadCount = 0,
  onNotificationClick,
  onMarkAllRead,
  soundEnabled = true,
  onToggleSound,
  audioStatus = 'ready'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'incoming' | 'rooms'
  const dropdownRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Filtered notifications
  const filteredNotifications = notifications.filter(item => {
    if (activeTab === 'incoming') {
      return item.type === 'NEW_LINE_BOOKING' || item.type === 'SLIP_UPLOADED';
    }
    if (activeTab === 'rooms') {
      return item.type === 'ROOM_UPCOMING' || item.type === 'ROOM_STARTED';
    }
    return true;
  });

  const incomingCount = notifications.filter(
    n => n.type === 'NEW_LINE_BOOKING' || n.type === 'SLIP_UPLOADED'
  ).length;

  const roomCount = notifications.filter(
    n => n.type === 'ROOM_UPCOMING' || n.type === 'ROOM_STARTED'
  ).length;

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        type="button"
        className="hamburger-btn"
        style={{
          position: 'relative',
          background: isOpen ? 'var(--primary-color)' : 'transparent',
          color: isOpen ? '#ffffff' : (unreadCount > 0 ? '#ef4444' : 'var(--text-main)'),
          width: '38px',
          height: '38px',
          borderRadius: '10px'
        }}
        title="ศูนย์การแจ้งเตือน (Live Notifications)"
        aria-label={`การแจ้งเตือน ${unreadCount > 0 ? `(${unreadCount} รายการใหม่)` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            backgroundColor: '#ef4444',
            color: '#ffffff',
            fontSize: '0.62rem',
            fontWeight: 800,
            borderRadius: '999px',
            minWidth: '17px',
            height: '17px',
            padding: unreadCount > 9 ? '0 5px' : '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 8px rgba(239, 68, 68, 0.7)',
            lineHeight: 1
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Center Dropdown Box */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '400px',
            maxWidth: '92vw',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '14px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15)',
            padding: '14px',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '10px',
            borderBottom: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                backgroundColor: 'rgba(37, 99, 235, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary-color)'
              }}>
                <Bell size={15} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-main)', letterSpacing: '0.01em', lineHeight: 1.2 }}>
                  ศูนย์การแจ้งเตือน
                </div>
                {audioStatus === 'suspended' && (
                  <div style={{ fontSize: '0.66rem', color: '#f59e0b', fontWeight: 600 }}>
                    คลิกหน้าจอ 1 ครั้งเพื่อเปิดระบบเสียง
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Sound Toggle */}
              {onToggleSound && (
                <button
                  type="button"
                  onClick={onToggleSound}
                  title={soundEnabled ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน'}
                  style={{
                    background: soundEnabled ? 'rgba(37, 99, 235, 0.08)' : 'rgba(0,0,0,0.05)',
                    border: `1px solid ${soundEnabled ? 'rgba(37, 99, 235, 0.25)' : 'var(--border-color)'}`,
                    color: soundEnabled ? 'var(--primary-color)' : 'var(--text-muted)',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '4px 7px',
                    borderRadius: '7px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                  <span>{soundEnabled ? 'เปิด' : 'ปิด'}</span>
                </button>
              )}

              {/* Mark All Read */}
              {unreadCount > 0 && onMarkAllRead && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  style={{
                    background: 'rgba(37, 99, 235, 0.08)',
                    border: '1px solid rgba(37, 99, 235, 0.2)',
                    color: 'var(--primary-color)',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '7px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  ✓ อ่านทั้งหมด
                </button>
              )}

              {/* Close Dropdown */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
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
                aria-label="ปิดเมนูการแจ้งเตือน"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Segmented Filter Tabs */}
          <div style={{
            display: 'flex',
            gap: '4px',
            background: 'var(--bg-color)',
            padding: '3px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)'
          }}>
            {[
              { key: 'all', label: 'ทั้งหมด', count: notifications.length },
              { key: 'incoming', label: 'จองใหม่ / สลิป', count: incomingCount },
              { key: 'rooms', label: 'ห้องประชุม', count: roomCount }
            ].map(tab => {
              const isSel = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
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
                  {tab.count > 0 && (
                    <span style={{
                      fontSize: '0.66rem',
                      fontWeight: 800,
                      padding: '1px 5px',
                      borderRadius: '8px',
                      backgroundColor: isSel ? 'rgba(255, 255, 255, 0.25)' : 'rgba(37, 99, 235, 0.12)',
                      color: isSel ? '#ffffff' : 'var(--primary-color)'
                    }}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Body Content List */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '360px',
              overflowY: 'auto'
            }}
            className="scrollbar-thin"
          >
            {filteredNotifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10b981'
                }}>
                  <CheckCircle2 size={22} />
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.86rem', color: 'var(--text-main)', marginTop: '4px' }}>
                  ไม่มีรายการแจ้งเตือน
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {activeTab === 'incoming'
                    ? 'ไม่มีรายการจองใหม่หรือสลิปที่ต้องตรวจสอบ'
                    : activeTab === 'rooms'
                    ? 'ไม่มีห้องประชุมที่ใกล้ถึงเวลาหรือกำลังเริ่มใช้งาน'
                    : 'ทุกรายการได้รับการดำเนินการเรียบร้อยแล้ว'}
                </div>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const badge = getEventBadgeConfig(item.type);
                const IconComponent = badge.icon;
                const isUnread = !item.read;

                return (
                  <div
                    key={item.id || item.eventKey}
                    onClick={() => {
                      if (onNotificationClick) {
                        onNotificationClick(item);
                      }
                      setIsOpen(false);
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      backgroundColor: isUnread ? 'rgba(37, 99, 235, 0.04)' : 'var(--bg-color)',
                      border: `1px solid ${isUnread ? 'rgba(37, 99, 235, 0.2)' : 'var(--border-color)'}`,
                      borderLeft: `4px solid ${badge.color}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'transform 0.15s ease, background-color 0.15s ease',
                      position: 'relative'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.backgroundColor = isUnread ? 'rgba(37, 99, 235, 0.07)' : 'rgba(0,0,0,0.03)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.backgroundColor = isUnread ? 'rgba(37, 99, 235, 0.04)' : 'var(--bg-color)';
                    }}
                  >
                    {/* Header line: tag + unread dot + time */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '6px',
                          backgroundColor: badge.bgColor,
                          color: badge.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <IconComponent size={12} />
                        </div>
                        <span style={{
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          color: badge.color,
                          backgroundColor: badge.bgColor,
                          padding: '2px 6px',
                          borderRadius: '6px'
                        }}>
                          {badge.tag}
                        </span>
                        {isUnread && (
                          <span style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: '#ef4444',
                            display: 'inline-block'
                          }} title="ยังไม่ได้อ่าน" />
                        )}
                      </div>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {formatTimeAgo(item.timestamp)}
                      </span>
                    </div>

                    {/* Title */}
                    <div style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-main)', marginTop: '2px' }}>
                      {item.title}
                    </div>

                    {/* Message */}
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                      {item.message}
                    </div>

                    {/* Deep link helper */}
                    <div style={{ fontSize: '0.68rem', color: 'var(--primary-color)', fontWeight: 700, marginTop: '2px' }}>
                      👉 คลิกเพื่อดูรายละเอียด / ดำเนินการ
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
