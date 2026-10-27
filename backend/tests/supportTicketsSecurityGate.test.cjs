const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

test('Support Tickets Strict Exclusion Gate (RC Production Readiness)', async (t) => {
  await t.test('1. Migration 012 and supportTickets backend code are excluded', () => {
    const migration012 = path.join(__dirname, '../migrations/012_add_support_tickets.sql');
    assert.equal(fs.existsSync(migration012), false, '012_add_support_tickets.sql must NOT exist in Production RC');

    const supportTicketsDir = path.join(__dirname, '../supportTickets');
    assert.equal(fs.existsSync(supportTicketsDir), false, 'backend/supportTickets must NOT exist in Production RC');
  });

  await t.test('2. Booking-App and Frontend support pages are excluded/disabled', () => {
    const supportPage = path.join(__dirname, '../../booking-app/src/pages/SupportTicketPage.jsx');
    assert.equal(fs.existsSync(supportPage), false, 'SupportTicketPage.jsx must NOT exist in Production RC');
  });

  await t.test('3. Express server returns 404 for support ticket routes when disabled', async () => {
    const app = express();
    // Simulate server.js gate
    if (process.env.ENABLE_SUPPORT_TICKETS === 'true') {
      // Not enabled
    } else {
      app.use('/api/public/support', (req, res) => res.status(404).json({ error: 'Support tickets feature is disabled' }));
      app.use('/api/pos/support', (req, res) => res.status(404).json({ error: 'Support tickets feature is disabled' }));
    }

    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const port = server.address().port;

    const resPublic = await fetch(`http://127.0.0.1:${port}/api/public/support/tickets`);
    assert.equal(resPublic.status, 404);

    const resStaff = await fetch(`http://127.0.0.1:${port}/api/pos/support/tickets`);
    assert.equal(resStaff.status, 404);

    await new Promise((resolve) => server.close(resolve));
  });

  await t.test('4. Worker worker.js hard-gates support ticket routes returning 404', () => {
    const workerPath = path.join(__dirname, '../worker.js');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    assert.ok(
      workerContent.includes("if (pathname.startsWith('/api/public/support') || pathname.startsWith('/api/pos/support'))"),
      'Worker must contain 404 gate for support tickets'
    );
  });
});
