const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Mock localStorage for Node.js test environment
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

global.localStorage = new MockLocalStorage();

test.beforeEach(() => {
  global.localStorage.clear();
});

// Helper simulating detection logic from useLiveNotifications
function createEventDetector() {
  const seenKeys = new Set();
  const readKeys = new Set();
  let notifications = [];
  let isInitialSnapshot = true;
  let activeToasts = [];
  const toastQueue = [];
  const MAX_NOTIFICATIONS = 50;
  const MAX_SEEN_KEYS = 200;
  const MAX_READ_KEYS = 200;
  const MAX_VISIBLE_TOASTS = 3;

  function processAlertData(data, mockNowMs = Date.now()) {
    if (!data) return [];

    const incoming = Array.isArray(data.incomingBookings) ? data.incomingBookings : [];
    const today = Array.isArray(data.todayBookings) ? data.todayBookings : [];
    const upcoming = Array.isArray(data.upcoming) ? data.upcoming : [];

    const nowMs = mockNowMs;
    const isInitial = isInitialSnapshot;
    const newEvents = [];
    const seenBookingIdsInPoll = new Set();
    let highestSoundClass = null;

    // EVENT 1 & 2: Process incomingBookings
    incoming.forEach(item => {
      if (!item || !item.booking_id || seenBookingIdsInPoll.has(item.booking_id)) return;
      seenBookingIdsInPoll.add(item.booking_id);

      const isLineOA = item.booking_source === 'online' || item.booking_source === 'line_oa' || item.booking_channel === 'line_oa';
      const isSlip = item.payment_status === 'reviewing' || Boolean(item.slip_image_url);

      // Event A: NEW_LINE_BOOKING
      if (isLineOA) {
        const lineKey = `booking-${item.booking_id}:line-created`;
        if (!seenKeys.has(lineKey)) {
          seenKeys.add(lineKey);
          if (!isInitial) {
            newEvents.push({
              id: `line-${item.booking_id}-${nowMs}`,
              eventKey: lineKey,
              eventType: 'NEW_LINE_BOOKING',
              bookingId: item.booking_id,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'การจองใหม่จาก LINE OA',
              message: `${item.room_name || 'ห้องประชุม'} · ${item.customer_name || ''}`,
              timestamp: nowMs,
              severity: 'info',
              soundClass: 'normal',
              read: readKeys.has(lineKey)
            });
            if (!highestSoundClass) highestSoundClass = 'normal';
          }
        }
      }

      // Event B: SLIP_UPLOADED
      if (isSlip) {
        const slipKey = `booking-${item.booking_id}:slip-reviewing:${item.payment_status}`;
        if (!seenKeys.has(slipKey)) {
          seenKeys.add(slipKey);
          if (!isInitial) {
            newEvents.push({
              id: `slip-${item.booking_id}-${nowMs}`,
              eventKey: slipKey,
              eventType: 'SLIP_UPLOADED',
              bookingId: item.booking_id,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'มีสลิปใหม่รอตรวจสอบ',
              message: `#${item.booking_id} · ${item.room_name || 'ห้องประชุม'} · ฿${Number(item.total_amount || 0).toLocaleString()}`,
              timestamp: nowMs,
              severity: 'action',
              soundClass: 'important',
              read: readKeys.has(slipKey)
            });
            highestSoundClass = 'important';
          }
        }
      }
    });

    // EVENT 3 & 4: Process todayBookings + upcoming
    const scheduleItems = [...today, ...upcoming];
    const seenScheduleItemKeys = new Set();

    scheduleItems.forEach(item => {
      if (!item || !item.booking_id || !item.start_time) return;

      const isConfirmed = item.payment_status === 'paid' || item.payment_status === 'internal_free';
      if (!isConfirmed) return;

      const itemUniqueKey = `${item.booking_id}-${item.room_id || item.room_name}-${item.start_time}`;
      if (seenScheduleItemKeys.has(itemUniqueKey)) return;
      seenScheduleItemKeys.add(itemUniqueKey);

      const startMs = new Date(item.start_time).getTime();
      const endMs = item.end_time ? new Date(item.end_time).getTime() : startMs + 3600000;
      const diffMinutes = (startMs - nowMs) / (60 * 1000);

      // Event C: ROOM_UPCOMING (<= 30 mins before start)
      if (diffMinutes > 0 && diffMinutes <= 30) {
        const upcomingKey = `booking-${item.booking_id}:room-${item.room_id || item.room_name}:upcoming:${item.start_time}`;
        if (!seenKeys.has(upcomingKey)) {
          seenKeys.add(upcomingKey);
          if (!isInitial) {
            newEvents.push({
              id: `upcoming-${item.booking_id}-${item.room_id}-${nowMs}`,
              eventKey: upcomingKey,
              eventType: 'ROOM_UPCOMING',
              bookingId: item.booking_id,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'ห้องใกล้ถึงเวลาใช้งาน',
              message: `${item.room_name || 'ห้องประชุม'} (อีก ${Math.max(1, Math.round(diffMinutes))} นาที)`,
              timestamp: nowMs,
              severity: 'warning',
              soundClass: 'normal',
              read: readKeys.has(upcomingKey)
            });
            if (!highestSoundClass) highestSoundClass = 'normal';
          }
        }
      }

      // Event D: ROOM_STARTED (now >= start_time, and meeting not yet ended)
      if (nowMs >= startMs && nowMs < endMs) {
        const startedKey = `booking-${item.booking_id}:room-${item.room_id || item.room_name}:started:${item.start_time}`;
        if (!seenKeys.has(startedKey)) {
          seenKeys.add(startedKey);
          if (!isInitial) {
            newEvents.push({
              id: `started-${item.booking_id}-${item.room_id}-${nowMs}`,
              eventKey: startedKey,
              eventType: 'ROOM_STARTED',
              bookingId: item.booking_id,
              roomId: item.room_id || null,
              roomName: item.room_name || 'ห้องประชุม',
              title: 'ถึงเวลาใช้งานแล้ว',
              message: `${item.room_name || 'ห้องประชุม'}`,
              timestamp: nowMs,
              severity: 'urgent',
              soundClass: 'important',
              read: readKeys.has(startedKey)
            });
            highestSoundClass = 'important';
          }
        }
      }
    });

    if (isInitial) {
      isInitialSnapshot = false;
      return { newEvents: [], highestSoundClass: null };
    }

    if (newEvents.length > 0) {
      notifications = [...newEvents, ...notifications].slice(0, MAX_NOTIFICATIONS);
      newEvents.forEach(evt => {
        if (activeToasts.length < MAX_VISIBLE_TOASTS) {
          activeToasts.push(evt);
        } else {
          toastQueue.push(evt);
        }
      });
    }

    return { newEvents, highestSoundClass, notifications, activeToasts, toastQueue };
  }

  function markAsRead(idOrKey) {
    readKeys.add(idOrKey);
    notifications = notifications.map(n => {
      if (n.id === idOrKey || n.eventKey === idOrKey) {
        return { ...n, read: true };
      }
      return n;
    });
  }

  function markAllAsRead() {
    notifications.forEach(n => readKeys.add(n.eventKey));
    notifications = notifications.map(n => ({ ...n, read: true }));
  }

  return {
    processAlertData,
    markAsRead,
    markAllAsRead,
    getSeenKeys: () => seenKeys,
    getReadKeys: () => readKeys,
    getNotifications: () => notifications,
    getActiveToasts: () => activeToasts,
    getToastQueue: () => toastQueue,
    getUnreadCount: () => notifications.filter(n => !n.read).length
  };
}

// ==========================================
// TEST SUITE: BWORK-POS LIVE NOTIFICATIONS
// ==========================================

test('1. Initial snapshot suppression suppresses toasts and sounds on first load', () => {
  const detector = createEventDetector();
  const initialData = {
    incomingBookings: [
      { booking_id: 101, booking_source: 'online', customer_name: 'Existing Customer', total_amount: 1000, payment_status: 'pending' }
    ],
    todayBookings: [
      { booking_id: 201, room_id: 4, room_name: 'Venus', start_time: new Date(Date.now() + 15 * 60000).toISOString(), end_time: new Date(Date.now() + 75 * 60000).toISOString(), payment_status: 'paid' }
    ],
    upcoming: []
  };

  const result = detector.processAlertData(initialData);
  assert.equal(result.newEvents.length, 0, 'No events emitted on initial snapshot');
  assert.equal(result.highestSoundClass, null, 'No sound played on initial snapshot');
  assert.equal(detector.getSeenKeys().has('booking-101:line-created'), true, 'Existing booking marked as seen');
  assert.equal(detector.getSeenKeys().has('booking-201:room-4:upcoming:' + initialData.todayBookings[0].start_time), true, 'Existing upcoming room marked as seen');
});

test('2. New LINE OA booking triggers NEW_LINE_BOOKING event and normal sound', () => {
  const detector = createEventDetector();
  // Prime initial snapshot
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  // Second poll with new LINE booking
  const pollData = {
    incomingBookings: [
      { booking_id: 301, booking_source: 'line_oa', customer_name: 'Khun Somsak', room_name: 'Jupiter', total_amount: 1500, payment_status: 'pending' }
    ],
    todayBookings: [],
    upcoming: []
  };

  const result = detector.processAlertData(pollData);
  assert.equal(result.newEvents.length, 1);
  assert.equal(result.newEvents[0].eventType, 'NEW_LINE_BOOKING');
  assert.equal(result.newEvents[0].soundClass, 'normal');
  assert.equal(result.highestSoundClass, 'normal');
  assert.equal(detector.getUnreadCount(), 1);
});

test('3. Slip upload triggers SLIP_UPLOADED event with important sound', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const pollData = {
    incomingBookings: [
      { booking_id: 302, booking_source: 'line_oa', customer_name: 'Khun Somchai', room_name: 'Mars', total_amount: 2000, payment_status: 'reviewing', slip_image_url: 'https://r2/slip123.jpg' }
    ],
    todayBookings: [],
    upcoming: []
  };

  const result = detector.processAlertData(pollData);
  // May emit both NEW_LINE_BOOKING and SLIP_UPLOADED if new
  const slipEvt = result.newEvents.find(e => e.eventType === 'SLIP_UPLOADED');
  assert.ok(slipEvt, 'SLIP_UPLOADED event should be emitted');
  assert.equal(slipEvt.soundClass, 'important');
  assert.equal(result.highestSoundClass, 'important', 'Important sound takes priority');
});

test('4. Pending -> Reviewing state transition generates a distinct SLIP_UPLOADED event', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  // Poll 1: Booking created without slip (pending)
  const poll1 = {
    incomingBookings: [
      { booking_id: 401, booking_source: 'online', customer_name: 'Khun A', room_name: 'Saturn', total_amount: 800, payment_status: 'pending', slip_image_url: null }
    ]
  };
  const res1 = detector.processAlertData(poll1);
  assert.equal(res1.newEvents.length, 1);
  assert.equal(res1.newEvents[0].eventType, 'NEW_LINE_BOOKING');

  // Poll 2: Customer uploads slip (status becomes reviewing)
  const poll2 = {
    incomingBookings: [
      { booking_id: 401, booking_source: 'online', customer_name: 'Khun A', room_name: 'Saturn', total_amount: 800, payment_status: 'reviewing', slip_image_url: 'https://r2/slip401.jpg' }
    ]
  };
  const res2 = detector.processAlertData(poll2);
  assert.equal(res2.newEvents.length, 1);
  assert.equal(res2.newEvents[0].eventType, 'SLIP_UPLOADED');
  assert.equal(res2.highestSoundClass, 'important');
});

test('5. Room timing: 30-minute upcoming window threshold', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const nowMs = 1700000000000;

  // Case A: 35 minutes before start -> NOT upcoming
  const item35 = {
    booking_id: 501,
    room_id: 5,
    room_name: 'Mercury',
    start_time: new Date(nowMs + 35 * 60000).toISOString(),
    end_time: new Date(nowMs + 95 * 60000).toISOString(),
    payment_status: 'paid'
  };
  const resA = detector.processAlertData({ todayBookings: [item35] }, nowMs);
  assert.equal(resA.newEvents.filter(e => e.eventType === 'ROOM_UPCOMING').length, 0);

  // Case B: 25 minutes before start -> UPCOMING!
  const item25 = {
    booking_id: 502,
    room_id: 6,
    room_name: 'Earth',
    start_time: new Date(nowMs + 25 * 60000).toISOString(),
    end_time: new Date(nowMs + 85 * 60000).toISOString(),
    payment_status: 'paid'
  };
  const resB = detector.processAlertData({ todayBookings: [item25] }, nowMs);
  assert.equal(resB.newEvents.filter(e => e.eventType === 'ROOM_UPCOMING').length, 1);
  assert.equal(resB.newEvents.find(e => e.eventType === 'ROOM_UPCOMING').soundClass, 'normal');
});

test('6. Room timing: Started threshold (now >= start_time)', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const nowMs = 1700000000000;

  // Booking started 2 minutes ago, ends in 58 minutes
  const startedItem = {
    booking_id: 601,
    room_id: 7,
    room_name: 'Neptune',
    start_time: new Date(nowMs - 2 * 60000).toISOString(),
    end_time: new Date(nowMs + 58 * 60000).toISOString(),
    payment_status: 'paid'
  };

  const res = detector.processAlertData({ todayBookings: [startedItem] }, nowMs);
  const startedEvt = res.newEvents.find(e => e.eventType === 'ROOM_STARTED');
  assert.ok(startedEvt, 'ROOM_STARTED event emitted when meeting is active');
  assert.equal(startedEvt.soundClass, 'important');
  assert.equal(res.highestSoundClass, 'important');
});

test('7. Room timing: Unpaid, unverified, and cancelled/rejected bookings are filtered out', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const nowMs = 1700000000000;

  // Unpaid pending booking
  const pendingItem = {
    booking_id: 701,
    room_id: 8,
    room_name: 'Pluto',
    start_time: new Date(nowMs + 10 * 60000).toISOString(),
    end_time: new Date(nowMs + 70 * 60000).toISOString(),
    payment_status: 'pending'
  };

  // Unverified reviewing booking
  const reviewingItem = {
    booking_id: 702,
    room_id: 9,
    room_name: 'Mars',
    start_time: new Date(nowMs + 10 * 60000).toISOString(),
    end_time: new Date(nowMs + 70 * 60000).toISOString(),
    payment_status: 'reviewing'
  };

  // Cancelled booking
  const cancelledItem = {
    booking_id: 703,
    room_id: 10,
    room_name: 'Venus',
    start_time: new Date(nowMs + 10 * 60000).toISOString(),
    end_time: new Date(nowMs + 70 * 60000).toISOString(),
    payment_status: 'cancelled'
  };

  // Rejected booking
  const rejectedItem = {
    booking_id: 704,
    room_id: 11,
    room_name: 'Saturn',
    start_time: new Date(nowMs + 10 * 60000).toISOString(),
    end_time: new Date(nowMs + 70 * 60000).toISOString(),
    payment_status: 'rejected'
  };

  // Internal free booking (eligible)
  const internalFreeItem = {
    booking_id: 705,
    room_id: 12,
    room_name: 'Jupiter',
    start_time: new Date(nowMs + 10 * 60000).toISOString(),
    end_time: new Date(nowMs + 70 * 60000).toISOString(),
    payment_status: 'internal_free'
  };

  // Paid booking (eligible)
  const paidItem = {
    booking_id: 706,
    room_id: 13,
    room_name: 'Mercury',
    start_time: new Date(nowMs + 10 * 60000).toISOString(),
    end_time: new Date(nowMs + 70 * 60000).toISOString(),
    payment_status: 'paid'
  };

  const res = detector.processAlertData({
    todayBookings: [pendingItem, reviewingItem, cancelledItem, rejectedItem, internalFreeItem, paidItem]
  }, nowMs);

  assert.equal(res.newEvents.length, 2, 'Only paid and internal_free generate room-use timing alerts');
  const roomNames = res.newEvents.map(e => e.roomName).sort();
  assert.deepEqual(roomNames, ['Jupiter', 'Mercury']);
});

test('8. Multi-room item deduplication maintains separate keys for each room', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const nowMs = 1700000000000;
  const startTime = new Date(nowMs + 15 * 60000).toISOString();
  const endTime = new Date(nowMs + 75 * 60000).toISOString();

  const multiRoomItems = [
    { booking_id: 801, room_id: 4, room_name: 'Room 4', start_time: startTime, end_time: endTime, payment_status: 'paid' },
    { booking_id: 801, room_id: 5, room_name: 'Room 5', start_time: startTime, end_time: endTime, payment_status: 'paid' }
  ];

  const res = detector.processAlertData({ todayBookings: multiRoomItems }, nowMs);
  assert.equal(res.newEvents.length, 2, 'Both rooms in the same booking receive notifications');
  assert.notEqual(res.newEvents[0].eventKey, res.newEvents[1].eventKey, 'Keys must be distinct per room');
});

test('9. Reschedule generates a new event key when start_time changes', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const nowMs = 1700000000000;
  const timeA = new Date(nowMs + 20 * 60000).toISOString();
  const timeB = new Date(nowMs + 10 * 60000).toISOString();

  // Schedule A
  const itemA = { booking_id: 901, room_id: 9, room_name: 'Galaxy', start_time: timeA, end_time: new Date(nowMs + 80 * 60000).toISOString(), payment_status: 'paid' };
  const resA = detector.processAlertData({ todayBookings: [itemA] }, nowMs);
  assert.equal(resA.newEvents.length, 1);

  // Rescheduled to time B
  const itemB = { booking_id: 901, room_id: 9, room_name: 'Galaxy', start_time: timeB, end_time: new Date(nowMs + 70 * 60000).toISOString(), payment_status: 'paid' };
  const resB = detector.processAlertData({ todayBookings: [itemB] }, nowMs);
  assert.equal(resB.newEvents.length, 1, 'Rescheduled start time produces a new alert event');
});

test('10. Seen vs Read separation: Mark as read updates read status without re-toasting', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  // Generate 2 events
  const poll = {
    incomingBookings: [
      { booking_id: 1001, booking_source: 'line_oa', customer_name: 'User 1', total_amount: 500, payment_status: 'pending' },
      { booking_id: 1002, booking_source: 'line_oa', customer_name: 'User 2', total_amount: 700, payment_status: 'pending' }
    ]
  };
  detector.processAlertData(poll);
  assert.equal(detector.getUnreadCount(), 2);

  // Mark first as read
  const notifs = detector.getNotifications();
  detector.markAsRead(notifs[0].id);
  assert.equal(detector.getUnreadCount(), 1);

  // Mark all as read
  detector.markAllAsRead();
  assert.equal(detector.getUnreadCount(), 0);

  // Next poll with same items -> 0 new events
  const nextPollRes = detector.processAlertData(poll);
  assert.equal(nextPollRes.newEvents.length, 0, 'Seen items must not emit new events');
});

test('11. Toast queue: Max 3 active toasts, remainder queued', () => {
  const detector = createEventDetector();
  detector.processAlertData({ incomingBookings: [], todayBookings: [], upcoming: [] });

  const poll = {
    incomingBookings: [
      { booking_id: 2001, booking_source: 'line_oa', customer_name: 'User 1', total_amount: 100, payment_status: 'pending' },
      { booking_id: 2002, booking_source: 'line_oa', customer_name: 'User 2', total_amount: 200, payment_status: 'pending' },
      { booking_id: 2003, booking_source: 'line_oa', customer_name: 'User 3', total_amount: 300, payment_status: 'pending' },
      { booking_id: 2004, booking_source: 'line_oa', customer_name: 'User 4', total_amount: 400, payment_status: 'pending' },
      { booking_id: 2005, booking_source: 'line_oa', customer_name: 'User 5', total_amount: 500, payment_status: 'pending' }
    ]
  };

  const res = detector.processAlertData(poll);
  assert.equal(res.activeToasts.length, 3, 'Maximum 3 visible toasts active');
  assert.equal(res.toastQueue.length, 2, '2 remaining toasts placed in queue');
});
