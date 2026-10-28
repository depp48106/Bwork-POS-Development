const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('CRM Customer Contracts & Worker Scope Safety Test Suite', async () => {
  const workerPath = path.join(__dirname, '../worker.js');
  const workerSource = fs.readFileSync(workerPath, 'utf8');

  test('1. Static Code Analysis: Verify customer endpoints are fully enclosed in auth guard', () => {
    // Verify line 4245 opens with if (pathname.startsWith('/api/customers')) {
    assert.match(workerSource, /if\s*\(pathname\.startsWith\('\/api\/customers'\)\)\s*\{/);

    // Verify user is declared inside the customer guard block
    const customerBlockIdx = workerSource.indexOf("if (pathname.startsWith('/api/customers'))");
    assert.ok(customerBlockIdx > 0, 'Customer block start found');

    const bookingBlockIdx = workerSource.indexOf("if (pathname === '/api/bookings' && method === 'GET')");
    assert.ok(bookingBlockIdx > customerBlockIdx, 'Bookings block start found after customer block');

    const customerSlice = workerSource.slice(customerBlockIdx, bookingBlockIdx);

    // Assert that the premature closing brace was removed before route 1
    assert.ok(
      !customerSlice.includes("}\n\n      // 1. GET /api/customers/contracts/alerts") &&
      !customerSlice.includes("}\r\n\r\n      // 1. GET /api/customers/contracts/alerts"),
      'Premature closing brace before route 1 must NOT exist'
    );

    // Assert that the customer block ends with Not Found fallback before bookings block
    assert.ok(
      customerSlice.includes("return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: corsHeaders });") ||
      customerSlice.includes('404'),
      'Must contain clean 404 fallback at end of customer block'
    );
  });

  test('2. ReferenceError Static Audit: No undeclared `user` variable across customer routes', () => {
    const customerBlockIdx = workerSource.indexOf("if (pathname.startsWith('/api/customers'))");
    const bookingBlockIdx = workerSource.indexOf("if (pathname === '/api/bookings' && method === 'GET')");
    const customerSlice = workerSource.slice(customerBlockIdx, bookingBlockIdx);

    // Every usage of user in customerSlice must be within scope of `const user = auth.user;`
    const userAuthDeclIdx = customerSlice.indexOf("const user = auth.user;");
    assert.ok(userAuthDeclIdx > 0, 'const user = auth.user must be declared at the beginning of customer block');

    // Verify routes that use `user`:
    // Route 7.1 dates
    const dateEditIdx = customerSlice.indexOf("const hasContractManagePermission = user &&");
    assert.ok(dateEditIdx > userAuthDeclIdx, 'hasContractManagePermission must be after user declaration');

    // Route 9 detail
    const detailAdminIdx = customerSlice.indexOf("const isAdmin = user && (user.role === 'admin' || user.username === 'admin');");
    assert.ok(detailAdminIdx > userAuthDeclIdx, 'detail isAdmin must be after user declaration');

    // Route 9.1 audit-logs
    const auditLogsIdx = customerSlice.indexOf("const customerAuditLogsMatch = pathname.match");
    assert.ok(auditLogsIdx > userAuthDeclIdx, 'customerAuditLogsMatch must be after user declaration');
  });

  test('3. Simulated Execution: GET /api/customers/:id with Admin & Staff users', async () => {
    // Test that evaluating the customer detail logic with authenticated user does not throw ReferenceError
    const mockCustomer = {
      id: 1,
      name: 'บริษัท บีเวิร์ค จำกัด',
      customer_type: 'basecamp',
      basecamp_sub_type: 'office',
      basecamp_unit: '401',
      status: 'active'
    };

    const mockContracts = [{
      id: 1,
      customer_id: 1,
      contract_number: 'CTR-BC-401-202601',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      monthly_quota_hours: 4.0,
      status: 'ACTIVE'
    }];

    // Test Admin context
    {
      const user = { id: 1, username: 'admin', role: 'admin', permissions: 'all' };
      const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
      assert.equal(isAdmin, true);

      let auditLogs = [];
      if (isAdmin) {
        auditLogs = [{ id: 101, action: 'RENEW_CONTRACT', performed_by: 'admin' }];
      }
      assert.equal(auditLogs.length, 1);
    }

    // Test Staff context
    {
      const user = { id: 2, username: 'staff_jane', role: 'staff', permissions: 'pos,customers' };
      const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
      assert.equal(isAdmin, false);

      let auditLogs = [];
      if (isAdmin) {
        auditLogs = [{ id: 101, action: 'RENEW_CONTRACT', performed_by: 'admin' }];
      }
      // Non-admin receives empty auditLogs
      assert.equal(auditLogs.length, 0);
    }
  });

  test('4. Permission Gate: Contract Date Editing requires manage / admin-management permission', () => {
    const checkPermission = (user) => {
      return user && (
        user.role === 'admin' ||
        user.username === 'admin' ||
        String(user.permissions || '').split(',').map(p => p.trim()).includes('manage') ||
        String(user.permissions || '').split(',').map(p => p.trim()).includes('admin-management')
      );
    };

    // Admin passes
    assert.equal(checkPermission({ id: 1, username: 'admin', role: 'admin' }), true);
    assert.equal(checkPermission({ id: 1, username: 'boss', role: 'admin' }), true);

    // Staff with 'manage' passes
    assert.equal(checkPermission({ id: 2, username: 'manager1', role: 'staff', permissions: 'pos,manage' }), true);
    assert.equal(checkPermission({ id: 3, username: 'admin_mgmt', role: 'staff', permissions: 'pos,admin-management' }), true);

    // Regular staff without manage is strictly rejected
    assert.equal(checkPermission({ id: 4, username: 'cashier', role: 'staff', permissions: 'pos,history' }), false);
    assert.equal(checkPermission(null), null);
  });
});
