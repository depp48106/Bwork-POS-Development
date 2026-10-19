/**
 * BWORK-POS — Support Tickets UI & Mobile Responsiveness Compatibility Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const supportPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/SupportTicketPage.jsx'), 'utf8');
const bookingAppSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/App.jsx'), 'utf8');
const statusPageSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/StatusPage.jsx'), 'utf8');

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const posAppSrc = fs.readFileSync(path.join(FRONTEND_DIR, 'src/App.jsx'), 'utf8');
const posTicketsSrc = fs.readFileSync(path.join(FRONTEND_DIR, 'src/components/SupportTicketsManagement.jsx'), 'utf8');

describe('BWORK-POS: Support Tickets UI & Mobile Compatibility Tests', () => {

  // ==========================================================================
  // 1. BOOKING APP SUPPORT TICKET PAGE (CUSTOMER-FACING)
  // ==========================================================================

  test('1.1: SupportTicketPage defines all 4 required categories: booking, payment, facility, other', () => {
    assert.ok(supportPageSrc.includes("id: 'booking'"), 'Must contain booking category');
    assert.ok(supportPageSrc.includes("id: 'payment'"), 'Must contain payment category');
    assert.ok(supportPageSrc.includes("id: 'facility'"), 'Must contain facility category');
    assert.ok(supportPageSrc.includes("id: 'other'"), 'Must contain other category');
    assert.ok(supportPageSrc.includes('ปัญหาการจองห้อง'), 'Thai label for booking');
    assert.ok(supportPageSrc.includes('ปัญหาการชำระเงิน'), 'Thai label for payment');
    assert.ok(supportPageSrc.includes('ปัญหาห้องประชุมและสถานที่'), 'Thai label for facility');
    assert.ok(supportPageSrc.includes('อื่น ๆ'), 'Thai label for other');
  });

  test('1.2: SupportTicketPage enforces attachment limits (max 3 images, max 5MB)', () => {
    assert.ok(supportPageSrc.includes('3 รูป') || supportPageSrc.includes('length > 3') || supportPageSrc.includes('length + files.length > 3'), 'Enforces 3 images limit');
    assert.ok(supportPageSrc.includes('5 * 1024 * 1024'), 'Enforces 5MB file size limit');
  });

  test('1.3: SupportTicketPage supports both Create and Track tabs', () => {
    assert.ok(supportPageSrc.includes("setActiveTab('create')"), 'Has create ticket tab');
    assert.ok(supportPageSrc.includes("setActiveTab('track')"), 'Has track ticket tab');
    assert.ok(supportPageSrc.includes('แจ้งปัญหาใหม่'), 'Thai button for create');
    assert.ok(supportPageSrc.includes('ติดตามสถานะ'), 'Thai button for track');
  });

  test('1.4: SupportTicketPage integrates with LINE LIFF profile and pending booking auto-population', () => {
    assert.ok(supportPageSrc.includes("localStorage.getItem('line_user_name')"), 'Auto populates line_user_name');
    assert.ok(supportPageSrc.includes("localStorage.getItem('bwork_pending_booking')"), 'Auto populates from pending booking');
  });

  test('1.5: SupportTicketPage handles Ticket Number copy and status configurations', () => {
    assert.ok(supportPageSrc.includes('copyTicketNumber') || supportPageSrc.includes('clipboard'), 'Has copy ticket number functionality');
    assert.ok(supportPageSrc.includes('NEW'), 'Handles NEW status');
    assert.ok(supportPageSrc.includes('ACKNOWLEDGED'), 'Handles ACKNOWLEDGED status');
    assert.ok(supportPageSrc.includes('IN_PROGRESS'), 'Handles IN_PROGRESS status');
    assert.ok(supportPageSrc.includes('RESOLVED'), 'Handles RESOLVED status');
    assert.ok(supportPageSrc.includes('CLOSED'), 'Handles CLOSED status');
    assert.ok(supportPageSrc.includes('REOPENED'), 'Handles REOPENED status');
  });

  test('1.6: SupportTicketPage customer reply flow supports messaging & attachments', () => {
    assert.ok(supportPageSrc.includes('handleSendReply'), 'Defines handleSendReply function');
    assert.ok(supportPageSrc.includes('/api/public/support/tickets/'), 'Calls public support ticket reply endpoint');
  });

  test('1.7: SupportTicketPage layout is mobile-first (max-width 640px, no overflow)', () => {
    assert.ok(supportPageSrc.includes("maxWidth: '640px'"), 'Constrained to mobile container');
    assert.ok(!supportPageSrc.includes('min-width: 800px'), 'No desktop-only hard min-width');
  });

  test('1.8: SupportTicketPage implements accessible native category dropdown with ChevronDown', () => {
    assert.ok(supportPageSrc.includes('<select'), 'Uses native select dropdown');
    assert.ok(supportPageSrc.includes('support-category-select'), 'Has support category select ID');
    assert.ok(supportPageSrc.includes('minHeight: \'44px\''), 'Complies with minimum 44px touch target');
    assert.ok(supportPageSrc.includes('ChevronDown'), 'Uses Lucide ChevronDown for single dropdown arrow');
  });

  test('1.9: SupportTicketPage conditionally renders mandatory other_category input when other is selected', () => {
    assert.ok(supportPageSrc.includes("category === 'other'"), 'Conditional rendering for other category');
    assert.ok(supportPageSrc.includes('support-other-category-input'), 'Has other category input ID');
    assert.ok(supportPageSrc.includes('otherCategory'), 'Manages otherCategory state');
    assert.ok(supportPageSrc.includes('setOtherCategory(\'\')'), 'Resets other category when switching categories');
    assert.ok(supportPageSrc.includes('maxLength={100}'), 'Enforces 100 char limit');
  });

  test('1.10: Support ticket components are 100% free of emojis (Clean Corporate standard)', () => {
    const emojiRegex = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert.equal(emojiRegex.test(supportPageSrc), false, 'SupportTicketPage.jsx must have NO emojis');
    assert.equal(emojiRegex.test(posTicketsSrc), false, 'SupportTicketsManagement.jsx must have NO emojis');
  });

  // ==========================================================================
  // 2. BOOKING APP NAVIGATION INTEGRATION
  // ==========================================================================

  test('2.1: Booking App header includes แจ้งปัญหา button with LifeBuoy icon', () => {
    assert.ok(bookingAppSrc.includes('to="/support"'), 'Header has Link to /support');
    assert.ok(bookingAppSrc.includes('<LifeBuoy'), 'Header uses LifeBuoy icon');
    assert.ok(bookingAppSrc.includes('แจ้งปัญหา'), 'Header displays แจ้งปัญหา label');
  });

  test('2.2: Booking App routes include /support and /support/:ticketNumber', () => {
    assert.ok(bookingAppSrc.includes('path="/support"'), 'Route /support registered');
    assert.ok(bookingAppSrc.includes('path="/support/:ticketNumber"'), 'Route /support/:ticketNumber registered');
  });

  test('2.3: Booking App footer includes Support Center link', () => {
    assert.ok(bookingAppSrc.includes('ศูนย์ช่วยเหลือ & แจ้งปัญหา'), 'Footer has support link');
  });

  test('2.4: StatusPage includes direct link to report an issue for a booking', () => {
    assert.ok(statusPageSrc.includes('to={`/support?category=booking&booking_code='), 'StatusPage links to support with booking_code');
    assert.ok(statusPageSrc.includes('พบปัญหาเกี่ยวกับการจองนี้? แจ้งเจ้าหน้าที่'), 'StatusPage displays report issue text');
  });

  // ==========================================================================
  // 3. POS WEB INTEGRATION (STAFF-FACING)
  // ==========================================================================

  test('3.1: POS Web App.jsx includes permission check and tab for tickets', () => {
    assert.ok(posAppSrc.includes("if (tabKey === 'tickets')"), 'Permission check for tickets defined');
    assert.ok(posAppSrc.includes("activeTab === 'tickets'"), 'Active tab tickets handled');
    assert.ok(posAppSrc.includes('<SupportTicketsManagement'), 'Renders SupportTicketsManagement component');
  });

  test('3.2: POS Web App.jsx polls for ticket notification badge', () => {
    assert.ok(posAppSrc.includes('ticketBadgeCount'), 'State ticketBadgeCount declared');
    assert.ok(posAppSrc.includes('/api/pos/support/notifications/count'), 'Polls notification count endpoint');
  });

  test('3.3: POS Web SupportTicketsManagement supports status transitions and notes', () => {
    assert.ok(posTicketsSrc.includes('handleUpdateStatus'), 'Has status update handler');
    assert.ok(posTicketsSrc.includes('ACKNOWLEDGED'), 'Supports ACKNOWLEDGED');
    assert.ok(posTicketsSrc.includes('IN_PROGRESS'), 'Supports IN_PROGRESS');
    assert.ok(posTicketsSrc.includes('RESOLVED'), 'Supports RESOLVED');
    assert.ok(posTicketsSrc.includes('CLOSED'), 'Supports CLOSED');
    assert.ok(posTicketsSrc.includes('replyVisibility'), 'Supports public vs internal reply');
  });

  test('3.4: POS Web SupportTicketsManagement supports category other and displays other_category', () => {
    assert.ok(posTicketsSrc.includes("other: {"), 'Has other category configuration');
    assert.ok(posTicketsSrc.includes('other_category'), 'Displays other_category subtitle');
    assert.ok(posTicketsSrc.includes('<option value="other">'), 'Has other in filter dropdown');
  });
});
