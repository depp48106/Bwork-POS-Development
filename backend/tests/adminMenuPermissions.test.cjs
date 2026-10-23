const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE_URL = 'http://localhost:5000';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json || data });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function login(username, password) {
  const res = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username, password });
  return res.body;
}

describe('Admin Menu Permissions Phase 2 - Full Safety & Authorization Matrix', async () => {
  let adminToken = '';
  let staffToken = '';
  const createdUserIds = [];

  // Helper to create test user with custom permissions
  async function createTestUser(username, permissions, role = 'staff') {
    const res = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/users',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    }, {
      username,
      password: 'password123',
      role,
      permissions,
      fullname: `Test ${username}`
    });
    if (res.body?.id) createdUserIds.push(res.body.id);
    const auth = await login(username, 'password123');
    return auth.token;
  }

  it('Setup: Admin and Staff login and verify baseline tokens', async () => {
    const adminLogin = await login('admin', 'admin123');
    assert.strictEqual(adminLogin.success, true, 'Admin login should succeed');
    adminToken = adminLogin.token;

    const staffLogin = await login('staff', 'staff123');
    assert.strictEqual(staffLogin.success, true, 'Staff login should succeed');
    staffToken = staffLogin.token;
  });

  it('0. Unauthenticated requests to all protected APIs return 401', async () => {
    const endpoints = [
      '/api/bookings',
      '/api/customers',
      '/api/hour-credits',
      '/api/pos/support/tickets',
      '/api/settings',
      '/api/users',
      '/api/roles'
    ];
    for (const ep of endpoints) {
      const res = await request({
        hostname: 'localhost',
        port: 5000,
        path: ep,
        method: 'GET'
      });
      assert.strictEqual(res.status, 401, `Unauthenticated ${ep} must return 401`);
    }
  });

  it('A. Admin Persona: Full authorization across all endpoints without leakage', async () => {
    const eps = [
      '/api/bookings',
      '/api/customers',
      '/api/hour-credits',
      '/api/pos/support/tickets',
      '/api/settings',
      '/api/users',
      '/api/roles'
    ];
    for (const ep of eps) {
      const res = await request({
        hostname: 'localhost',
        port: 5000,
        path: ep,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200, `Admin must have 200 on ${ep}`);
    }

    // Verify settings GET masks sensitive secrets
    const setRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/settings',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(setRes.status, 200);
    if (setRes.body.line_channel_access_token) {
      assert.ok(setRes.body.line_channel_access_token.includes('•'), 'Access token must be masked');
    }
    if (setRes.body.line_channel_secret) {
      assert.ok(setRes.body.line_channel_secret.includes('•'), 'Secret must be masked');
    }
  });

  it('B. Staff Default Persona: Retains access to Hour Credits, CRM, Tickets, but denied Settings', async () => {
    // Permitted
    for (const ep of ['/api/bookings', '/api/customers', '/api/hour-credits', '/api/pos/support/tickets']) {
      const res = await request({
        hostname: 'localhost',
        port: 5000,
        path: ep,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });
      assert.strictEqual(res.status, 200, `Staff default must access ${ep}`);
    }

    // Denied Settings / Admin
    for (const ep of ['/api/users', '/api/roles']) {
      const res = await request({
        hostname: 'localhost',
        port: 5000,
        path: ep,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });
      assert.strictEqual(res.status, 403, `Staff default must be denied 403 on ${ep}`);
    }
  });

  it('C. Staff Custom Permissions Persona: Custom permissions are strictly honored', async () => {
    const token = await createTestUser('u_custom_staff', 'pos,layout,history');

    // Booking is allowed
    const bookRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/bookings',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(bookRes.status, 200);

    // Hour credits denied
    const hcRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/hour-credits',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(hcRes.status, 403, 'User without hour-credits must receive 403');

    // Customers denied
    const custRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/customers',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(custRes.status, 403, 'User without customers must receive 403');
  });

  it('D. User Persona D: Has POS but NOT Hour Credits -> Denied Hour Credits', async () => {
    const token = await createTestUser('u_pos_no_hc', 'pos,pending,layout');

    const hcRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/hour-credits',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(hcRes.status, 403, 'User having POS but lacking hour-credits must be 403');
  });

  it('E. User Persona E: Has Booking History but NOT Customers -> Denied Customers', async () => {
    const token = await createTestUser('u_hist_no_crm', 'history,pending');

    const custRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/customers',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(custRes.status, 403, 'User having history but lacking customers must be 403');
  });

  it('F. User Persona F: Has Booking Management but NOT Tickets -> Denied Tickets', async () => {
    const token = await createTestUser('u_mgmt_no_tickets', 'pending,layout');

    const suppRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/pos/support/tickets',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(suppRes.status, 403, 'User having pending but lacking tickets must be 403');
  });

  it('G. User Persona G: Has General Settings but NOT Door Access -> Denied Door Test', async () => {
    const token = await createTestUser('u_gen_no_door', 'admin-general');

    // Can access settings GET
    const setRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/settings',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(setRes.status, 200);

    // Can POST general settings
    const postRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/settings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, { room_alert_minutes: '15' });
    assert.strictEqual(postRes.status, 200);

    // Denied line/test (requires admin-dooraccess)
    const lineTestRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/settings/line/test',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, {});
    assert.strictEqual(lineTestRes.status, 403, 'User lacking admin-dooraccess is denied 403 on line/test');
  });

  it('H. User Persona H: Has No Admin Permissions -> Denied Settings Modifications', async () => {
    const token = await createTestUser('u_no_admin', 'pos');

    const postRes = await request({
      hostname: 'localhost',
      port: 5000,
      path: '/api/settings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, { company_name: 'Hacked' });
    assert.strictEqual(postRes.status, 403, 'User without settings permissions must receive 403');
  });

  it('Cleanup test users from database', async () => {
    for (const uid of createdUserIds) {
      await request({
        hostname: 'localhost',
        port: 5000,
        path: `/api/users/${uid}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
    }
  });
});
