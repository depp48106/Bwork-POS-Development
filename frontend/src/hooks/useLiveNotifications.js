import { useState, useEffect, useRef, useCallback } from 'react';
import { playNotificationSound, isAudioUnlocked, unlockAudioContext } from '../utils/notificationSound';
import { parseTransactionTimestamp } from '../dateUtils';

const MAX_NOTIFICATIONS = 50;
const MAX_SEEN_KEYS = 200;
const MAX_READ_KEYS = 200;
const MAX_VISIBLE_TOASTS = 3;

const TOAST_DURATIONS = {
  NEW_LINE_BOOKING: 9000,
  SLIP_UPLOADED: 12000,
  ROOM_UPCOMING: 9000,
  ROOM_STARTED: 15000
};

export function useLiveNotifications({ onNavigate }) {
  // 1. Persistent Notifications List (Last 50)
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('bwork_notifications_v1');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // 2. Persistent Seen Event Keys (Prevents repeat toasts/sounds)
  const seenKeysRef = useRef(new Set());
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bwork_seen_notification_keys_v1');
      if (saved) {
        seenKeysRef.current = new Set(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  // 3. Persistent Read Event Keys (Tracks read status across sessions)
  const readKeysRef = useRef(new Set());
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bwork_read_notification_keys_v1');
      if (saved) {
        readKeysRef.current = new Set(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  // 4. Sound Enabled Toggle
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('bwork_sound_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch (e) {
      return true;
    }
  });

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      try {
        localStorage.setItem('bwork_sound_enabled', JSON.stringify(next));
      } catch (e) {}
      if (next) {
        unlockAudioContext();
      }
      return next;
    });
  }, []);

  // 5. Audio Status
  const [audioReady, setAudioReady] = useState(isAudioUnlocked());
  useEffect(() => {
    const checkAudio = () => {
      setAudioReady(isAudioUnlocked());
    };
    window.addEventListener('click', checkAudio, { once: true });
    window.addEventListener('keydown', checkAudio, { once: true });
    window.addEventListener('pointerdown', checkAudio, { once: true });
    return () => {
      window.removeEventListener('click', checkAudio);
      window.removeEventListener('keydown', checkAudio);
      window.removeEventListener('pointerdown', checkAudio);
    };
  }, []);

  // 6. Active Toasts & Queue
  const [activeToasts, setActiveToasts] = useState([]);
  const toastQueueRef = useRef([]);

  const dismissToast = useCallback((toastId) => {
    setActiveToasts(prev => {
      const remaining = prev.filter(t => t.id !== toastId);
      // Promote from queue if space available
      if (remaining.length < MAX_VISIBLE_TOASTS && toastQueueRef.current.length > 0) {
        const next = toastQueueRef.current.shift();
        return [...remaining, next];
      }
      return remaining;
    });
  }, []);

  const queueToast = useCallback((toast) => {
    setActiveToasts(prev => {
      if (prev.length < MAX_VISIBLE_TOASTS) {
        return [...prev, toast];
      }
      toastQueueRef.current.push(toast);
      return prev;
    });

    const duration = toast.duration || TOAST_DURATIONS[toast.eventType] || 10000;
    setTimeout(() => {
      dismissToast(toast.id);
    }, duration);
  }, [dismissToast]);

  // 7. Initial Snapshot Flag (Suppresses toasts/sounds on first load)
  const isInitialSnapshotRef = useRef(true);

  // Helper to persist bounded sets
  const saveSeenKeys = useCallback(() => {
    try {
      const arr = Array.from(seenKeysRef.current);
      const bounded = arr.slice(-MAX_SEEN_KEYS);
      localStorage.setItem('bwork_seen_notification_keys_v1', JSON.stringify(bounded));
    } catch (e) {}
  }, []);

  const saveReadKeys = useCallback(() => {
    try {
      const arr = Array.from(readKeysRef.current);
      const bounded = arr.slice(-MAX_READ_KEYS);
      localStorage.setItem('bwork_read_notification_keys_v1', JSON.stringify(bounded));
    } catch (e) {}
  }, []);

  const saveNotifications = useCallback((notifs) => {
    try {
      const bounded = notifs.slice(0, MAX_NOTIFICATIONS);
      localStorage.setItem('bwork_notifications_v1', JSON.stringify(bounded));
    } catch (e) {}
  }, []);

  // 8. Event Detection Engine
  const processAlertData = useCallback((data) => {
    if (!data) return;

    const incoming = Array.isArray(data.incomingBookings) ? data.incomingBookings : [];
    const today = Array.isArray(data.todayBookings) ? data.todayBookings : [];
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];

    const now = new Date();
    const nowMs = now.getTime();
    const isInitial = isInitialSnapshotRef.current;

    const newEvents = [];
    const seenBookingIdsInPoll = new Set();
    let highestSoundClass = null;

    const formatTimeOnly = (isoStr) => {
      const d = parseTransactionTimestamp(isoStr);
      return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '--:--';
    };

    // -------------------------------------------------------------
    // EVENT 1 & 2: Process incomingBookings (NEW_LINE_BOOKING, SLIP_UPLOADED)
    // -------------------------------------------------------------
    incoming.forEach(item => {
      if (!item || !item.booking_id || seenBookingIdsInPoll.has(item.booking_id)) return;
      seenBookingIdsInPoll.add(item.booking_id);

      const isLineOA = item.booking_source === 'online' || item.booking_source === 'line_oa' || item.booking_channel === 'line_oa';
      const isSlip = item.payment_status === 'reviewing' || Boolean(item.slip_image_url);

      // Event A: NEW_LINE_BOOKING
      if (isLineOA) {
        const lineKey = `booking-${item.booking_id}:line-created`;
        if (!seenKeysRef.current.has(lineKey)) {
          seenKeysRef.current.add(lineKey);
          if (!isInitial) {
            const timeStr = item.start_time ? formatTimeOnly(item.start_time) : '';
            newEvents.push({
              id: `line-${item.booking_id}-${Date.now()}`,
              eventKey: lineKey,
              eventType: 'NEW_LINE_BOOKING',
              bookingId: item.booking_id,
              bookingItemId: item.item_id || null,
              bookingRef: item.receipt_number || `#${item.booking_id}`,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'การจองใหม่จาก LINE OA',
              message: `${item.room_name || 'ห้องประชุม'}${timeStr ? ` · เริ่ม ${timeStr} น.` : ''}${item.customer_name ? ` · ${item.customer_name}` : ''}`,
              timestamp: nowMs,
              severity: 'info',
              actionTarget: 'pending',
              actionType: 'view',
              actionLabel: 'ดูการจอง',
              soundClass: 'normal',
              read: readKeysRef.current.has(lineKey)
            });
            if (!highestSoundClass) highestSoundClass = 'normal';
          }
        }
      }

      // Event B: SLIP_UPLOADED
      if (isSlip) {
        const slipKey = `booking-${item.booking_id}:slip-reviewing:${item.payment_status}`;
        if (!seenKeysRef.current.has(slipKey)) {
          seenKeysRef.current.add(slipKey);
          if (!isInitial) {
            newEvents.push({
              id: `slip-${item.booking_id}-${Date.now()}`,
              eventKey: slipKey,
              eventType: 'SLIP_UPLOADED',
              bookingId: item.booking_id,
              bookingItemId: item.item_id || null,
              bookingRef: item.receipt_number || `#${item.booking_id}`,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'มีสลิปใหม่รอตรวจสอบ',
              message: `#${item.booking_id} · ${item.room_name || 'ห้องประชุม'} · ฿${Number(item.total_amount || 0).toLocaleString()}`,
              timestamp: nowMs,
              severity: 'action',
              actionTarget: 'pending',
              actionType: 'review',
              actionLabel: 'ตรวจสอบสลิป',
              soundClass: 'important',
              read: readKeysRef.current.has(slipKey)
            });
            highestSoundClass = 'important';
          }
        }
      }
    });

    // -------------------------------------------------------------
    // EVENT 3 & 4: Process todayBookings (ROOM_UPCOMING, ROOM_STARTED)
    // -------------------------------------------------------------
    // Combine todayBookings and upcoming items safely
    const scheduleItems = [...today, ...upcoming];
    const seenScheduleItemKeys = new Set();

    scheduleItems.forEach(item => {
      if (!item || !item.booking_id || !item.start_time) return;

      // Filter operationally confirmed bookings (unpaid/unverified pending/reviewing do not trigger room-use alerts)
      const isConfirmed = item.payment_status === 'paid' || item.payment_status === 'internal_free';
      if (!isConfirmed) return;

      const itemUniqueKey = `${item.booking_id}-${item.room_id || item.room_name}-${item.start_time}`;
      if (seenScheduleItemKeys.has(itemUniqueKey)) return;
      seenScheduleItemKeys.add(itemUniqueKey);

      const startD = parseTransactionTimestamp(item.start_time);
      const endD = parseTransactionTimestamp(item.end_time);
      if (!startD) return;

      const startMs = startD.getTime();
      const endMs = endD ? endD.getTime() : startMs + 3600000;
      const diffMinutes = (startMs - nowMs) / (60 * 1000);

      const startT = formatTimeOnly(item.start_time);
      const endT = endD ? formatTimeOnly(item.end_time) : '';

      // Event C: ROOM_UPCOMING (<= 30 mins before start, and start is still in future)
      if (diffMinutes > 0 && diffMinutes <= 30) {
        const upcomingKey = `booking-${item.booking_id}:room-${item.room_id || item.room_name}:upcoming:${item.start_time}`;
        if (!seenKeysRef.current.has(upcomingKey)) {
          seenKeysRef.current.add(upcomingKey);
          if (!isInitial) {
            newEvents.push({
              id: `upcoming-${item.booking_id}-${item.room_id}-${Date.now()}`,
              eventKey: upcomingKey,
              eventType: 'ROOM_UPCOMING',
              bookingId: item.booking_id,
              bookingItemId: item.item_id || null,
              bookingRef: item.receipt_number || `#${item.booking_id}`,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'ห้องใกล้ถึงเวลาใช้งาน',
              message: `${item.room_name || 'ห้องประชุม'} · เริ่ม ${startT} น. (อีก ${Math.max(1, Math.round(diffMinutes))} นาที)`,
              timestamp: nowMs,
              severity: 'warning',
              actionTarget: 'pending',
              actionType: 'view',
              actionLabel: 'ดูรายละเอียด',
              soundClass: 'normal',
              read: readKeysRef.current.has(upcomingKey)
            });
            if (!highestSoundClass) highestSoundClass = 'normal';
          }
        }
      }

      // Event D: ROOM_STARTED (now >= start_time, and meeting not yet ended)
      if (nowMs >= startMs && nowMs < endMs) {
        const startedKey = `booking-${item.booking_id}:room-${item.room_id || item.room_name}:started:${item.start_time}`;
        if (!seenKeysRef.current.has(startedKey)) {
          seenKeysRef.current.add(startedKey);
          if (!isInitial) {
            newEvents.push({
              id: `started-${item.booking_id}-${item.room_id}-${Date.now()}`,
              eventKey: startedKey,
              eventType: 'ROOM_STARTED',
              bookingId: item.booking_id,
              bookingItemId: item.item_id || null,
              bookingRef: item.receipt_number || `#${item.booking_id}`,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'ถึงเวลาใช้งานแล้ว',
              message: `${item.room_name || 'ห้องประชุม'} · เวลา ${startT}${endT ? `–${endT}` : ''} น.`,
              timestamp: nowMs,
              severity: 'urgent',
              actionTarget: 'pending',
              actionType: 'view',
              actionLabel: 'เปิดรายการ',
              soundClass: 'important',
              read: readKeysRef.current.has(startedKey)
            });
            highestSoundClass = 'important';
          }
        }
      }
    });

    // Save seen keys baseline
    saveSeenKeys();

    // Mark initial snapshot as established
    if (isInitial) {
      isInitialSnapshotRef.current = false;
      return;
    }

    // Process newly generated events
    if (newEvents.length > 0) {
      // 1. Prepend to notifications list
      setNotifications(prev => {
        const updated = [...newEvents, ...prev].slice(0, MAX_NOTIFICATIONS);
        saveNotifications(updated);
        return updated;
      });

      // 2. Queue toasts for new events
      newEvents.forEach(evt => {
        queueToast(evt);
      });

      // 3. Play prioritized sound
      if (soundEnabled && highestSoundClass) {
        playNotificationSound(highestSoundClass);
      }
    }
  }, [queueToast, soundEnabled, saveSeenKeys, saveNotifications]);

  // 9. Mark Single Notification as Read
  const markAsRead = useCallback((notificationId) => {
    setNotifications(prev => {
      const updated = prev.map(n => {
        if (n.id === notificationId || n.eventKey === notificationId) {
          if (n.eventKey) readKeysRef.current.add(n.eventKey);
          return { ...n, read: true };
        }
        return n;
      });
      saveReadKeys();
      saveNotifications(updated);
      return updated;
    });
  }, [saveReadKeys, saveNotifications]);

  // 10. Mark All as Read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => {
      prev.forEach(n => {
        if (n.eventKey) readKeysRef.current.add(n.eventKey);
      });
      const updated = prev.map(n => ({ ...n, read: true }));
      saveReadKeys();
      saveNotifications(updated);
      return updated;
    });
  }, [saveReadKeys, saveNotifications]);

  // 11. Handle Notification Click (Deep-link & dismiss)
  const handleNotificationClick = useCallback((notification) => {
    if (!notification) return;
    markAsRead(notification.id);
    dismissToast(notification.id);

    if (onNavigate) {
      onNavigate(notification.actionTarget || 'pending', {
        bookingId: notification.bookingId,
        action: notification.actionType || (notification.eventType === 'SLIP_UPLOADED' ? 'review' : 'view')
      });
    }
  }, [markAsRead, dismissToast, onNavigate]);

  // Unread Count
  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    notifications,
    unreadCount,
    activeToasts,
    soundEnabled,
    toggleSound,
    audioReady,
    audioStatus: audioReady ? 'ready' : 'suspended',
    processAlertData,
    markAsRead,
    markAllAsRead,
    dismissToast,
    handleNotificationClick
  };
}
