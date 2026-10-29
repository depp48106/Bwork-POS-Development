/**
 * customerContracts/routes.js
 * Express routes for Customer, Shop, Contract & Quota Management
 */

const express = require('express');
const {
  getBangkokDateToday,
  calculateDaysDifference,
  evaluateContractStatus,
  calculateCustomerQuota,
  getContractAlerts,
  updateContractDates
} = require('./service');

function createCustomerRouter(dbQuery) {
  const router = express.Router();

  // Helper to record audit log
  async function recordAuditLog({ customerId, contractId, action, details, performedBy }) {
    try {
      await dbQuery.run(
        `INSERT INTO customer_audit_logs (customer_id, contract_id, action, details, performed_by)
         VALUES (?, ?, ?, ?, ?)`,
        [customerId || null, contractId || null, action, JSON.stringify(details || {}), performedBy || 'system']
      );
    } catch (e) {
      console.warn('[CustomerAudit] Failed to write log:', e.message);
    }
  }

  // Helper to ensure unique contract numbers
  async function generateUniqueContractNumber(prefix) {
    let candidate = prefix;
    let counter = 1;
    while (true) {
      const existing = await dbQuery.get(
        'SELECT id FROM customer_contracts WHERE contract_number = ?',
        [candidate]
      );
      if (!existing) return candidate;
      candidate = `${prefix}-${String(counter++).padStart(2, '0')}`;
    }
  }

  // 1. GET /api/customers/contracts/alerts
  router.get('/contracts/alerts', async (req, res) => {
    try {
      const today = req.query.date || getBangkokDateToday();
      const result = await getContractAlerts(dbQuery, today);
      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      console.error('[CustomerRouter] alerts error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2. GET /api/customers
  router.get('/', async (req, res) => {
    const { type, status, q, month, year } = req.query;
    try {
      let sql = 'SELECT * FROM customers WHERE 1=1';
      const params = [];

      if (type && type !== 'all') {
        sql += ' AND customer_type = ?';
        params.push(type);
      }
      if (status && status !== 'all') {
        sql += ' AND status = ?';
        params.push(status);
      }
      if (q && q.trim()) {
        sql += ' AND (name LIKE ? OR contact_name LIKE ? OR phone LIKE ? OR basecamp_unit LIKE ?)';
        const queryTerm = `%${q.trim()}%`;
        params.push(queryTerm, queryTerm, queryTerm, queryTerm);
      }

      sql += ' ORDER BY CASE customer_type WHEN \'basecamp\' THEN 0 WHEN \'shop\' THEN 1 WHEN \'ondemand\' THEN 2 WHEN \'virtual_office\' THEN 3 ELSE 4 END, basecamp_unit ASC, name ASC';
      const customers = await dbQuery.all(sql, params);

      // Fetch active contracts and quota for each customer
      const enriched = await Promise.all(customers.map(async (c) => {
        const contracts = await dbQuery.all(
          `SELECT * FROM customer_contracts
           WHERE customer_id = ?
           ORDER BY CASE WHEN status IN ('ACTIVE', 'EXPIRING') THEN 0 ELSE 1 END, end_date DESC`,
          [c.id]
        );
        const activeContract = contracts && contracts.length > 0 ? contracts[0] : null;
        if (activeContract) {
          const evalRes = evaluateContractStatus(activeContract);
          activeContract.evaluated_status = evalRes.status;
          activeContract.days_left = evalRes.days_left;
          activeContract.urgency = evalRes.urgency;
        }

        const quota = await calculateCustomerQuota(dbQuery, {
          customerId: c.id,
          month,
          year
        });

        return {
          ...c,
          active_contract: activeContract,
          contracts: contracts || [],
          quota
        };
      }));

      res.json({
        success: true,
        customers: enriched
      });
    } catch (err) {
      console.error('[CustomerRouter] list error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. GET /api/customers/:id
  router.get('/:id', async (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    const { month, year } = req.query;
    try {
      const customer = await dbQuery.get('SELECT * FROM customers WHERE id = ?', [customerId]);
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const contracts = await dbQuery.all(
        'SELECT * FROM customer_contracts WHERE customer_id = ? ORDER BY start_date DESC, id DESC',
        [customerId]
      );

      const evaluatedContracts = (contracts || []).map(ctr => {
        const evalRes = evaluateContractStatus(ctr);
        return {
          ...ctr,
          evaluated_status: evalRes.status,
          days_left: evalRes.days_left,
          urgency: evalRes.urgency
        };
      });

      // Security Gate: Non-admin users must NEVER receive audit logs in Customer Detail API
      const isAdmin = req.user && (req.user.role === 'admin' || req.user.username === 'admin');
      let auditLogs = [];
      if (isAdmin) {
        auditLogs = await dbQuery.all(
          'SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50',
          [customerId]
        );
      }

      const quota = await calculateCustomerQuota(dbQuery, {
        customerId,
        month,
        year
      });

      res.json({
        success: true,
        customer: {
          ...customer,
          contracts: evaluatedContracts,
          audit_logs: auditLogs || [],
          quota
        }
      });
    } catch (err) {
      console.error('[CustomerRouter] get detail error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 3.1. GET /api/customers/:id/audit-logs (Strictly Admin Only)
  router.get('/:id/audit-logs', async (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.username === 'admin');
    if (!isAdmin) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถดูประวัติ Audit Log ได้' });
    }

    try {
      const logs = await dbQuery.all(
        'SELECT * FROM customer_audit_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100',
        [customerId]
      );
      res.json({
        success: true,
        audit_logs: logs || []
      });
    } catch (err) {
      console.error('[CustomerRouter] get audit logs error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. GET /api/customers/:id/quota
  router.get('/:id/quota', async (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    const { month, year, date } = req.query;
    try {
      const quota = await calculateCustomerQuota(dbQuery, {
        customerId,
        serviceDate: date,
        month,
        year
      });
      res.json({
        success: true,
        ...quota
      });
    } catch (err) {
      console.error('[CustomerRouter] get quota error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 5. POST /api/customers
  router.post('/', async (req, res) => {
    const {
      customer_type,
      name,
      contact_name,
      phone,
      email,
      tax_id,
      address,
      basecamp_sub_type,
      basecamp_unit,
      start_date,
      end_date,
      monthly_quota_hours,
      contract_number,
      notes
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'ชื่อลูกค้าหรือชื่อร้านค้าจำเป็นต้องระบุ' });
    }
    if (start_date && end_date && start_date > end_date) {
      return res.status(400).json({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' });
    }
    const validTypes = ['basecamp', 'shop', 'ondemand', 'virtual_office'];
    let cleanType = String(customer_type || '').toLowerCase().trim();
    if (cleanType === 'virtual' || cleanType === 'virtual office' || cleanType === 'virtual-office') {
      cleanType = 'virtual_office';
    }
    if (!validTypes.includes(cleanType)) {
      cleanType = 'basecamp';
    }

    try {
      // Check unit uniqueness for active basecamp customer
      if (cleanType === 'basecamp' && basecamp_unit) {
        const existingActive = await dbQuery.get(
          `SELECT id, name FROM customers
           WHERE customer_type = 'basecamp' AND basecamp_unit = ? AND status = 'active'`,
          [basecamp_unit]
        );
        if (existingActive) {
          return res.status(400).json({
            error: `ยูนิต ${basecamp_unit} มีผู้เช่าที่ใช้งานอยู่แล้ว (${existingActive.name}) กรุณาใช้ฟังก์ชันเปลี่ยนผู้เช่าหรือปิดสถานะผู้เช่าเดิมก่อน`
          });
        }
      }

      const insertRes = await dbQuery.run(
        `INSERT INTO customers
         (customer_type, name, contact_name, phone, email, tax_id, address, basecamp_sub_type, basecamp_unit, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          cleanType,
          name.trim(),
          contact_name ? contact_name.trim() : null,
          phone ? phone.trim() : null,
          email ? email.trim() : null,
          tax_id ? tax_id.trim() : null,
          address ? address.trim() : null,
          cleanType === 'basecamp' ? (basecamp_sub_type || 'office') : null,
          cleanType === 'basecamp' ? (basecamp_unit || null) : null
        ]
      );
      const customerId = insertRes.id;

      let contractId = null;
      let effectiveContractNumber = null;

      // Create initial contract if start_date and end_date provided
      if (start_date && end_date) {
        let defaultQuota = 0;
        if (cleanType === 'basecamp') {
          defaultQuota = basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0;
        } else if (cleanType === 'shop') {
          defaultQuota = 4.0;
        } else {
          defaultQuota = 0.0;
        }
        const quotaVal = monthly_quota_hours !== undefined && monthly_quota_hours !== null && monthly_quota_hours !== ''
          ? Math.max(0, Number(monthly_quota_hours) || 0)
          : defaultQuota;
        const prefix = cleanType === 'basecamp' ? 'BC' : cleanType.toUpperCase();
        const baseCtr = contract_number && contract_number.trim()
          ? contract_number.trim()
          : (cleanType === 'basecamp'
              ? `CTR-BC-${basecamp_unit || 'UNIT'}-${start_date.slice(0, 7).replace('-', '')}`
              : `CTR-${prefix}-${customerId}-${start_date.slice(0, 7).replace('-', '')}`);

        let ctrRes = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          effectiveContractNumber = contract_number && contract_number.trim()
            ? contract_number.trim()
            : await generateUniqueContractNumber(baseCtr);
          try {
            ctrRes = await dbQuery.run(
              `INSERT INTO customer_contracts
               (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [customerId, effectiveContractNumber, start_date, end_date, quotaVal, notes || null]
            );
            break;
          } catch (insertErr) {
            const isUniqueErr = insertErr && (
              insertErr.code === 'SQLITE_CONSTRAINT' ||
              String(insertErr.message || '').includes('UNIQUE constraint failed')
            );
            if (isUniqueErr && (!contract_number || !contract_number.trim()) && attempt < 4) {
              continue;
            }
            if (isUniqueErr && contract_number && contract_number.trim()) {
              return res.status(400).json({ error: `หมายเลขสัญญา "${contract_number.trim()}" มีอยู่ในระบบแล้ว กรุณาระบุหมายเลขสัญญาใหม่` });
            }
            throw insertErr;
          }
        }
        contractId = ctrRes.id;
      }

      const performedBy = req.user?.username || 'staff';
      await recordAuditLog({
        customerId,
        contractId,
        action: 'CREATE_CUSTOMER',
        details: {
          customer_type: cleanType,
          name,
          basecamp_unit,
          contract_number: effectiveContractNumber,
          start_date,
          end_date
        },
        performedBy
      });

      res.status(201).json({
        success: true,
        customer_id: customerId,
        contract_id: contractId,
        message: 'สร้างข้อมูลลูกค้าเรียบร้อยแล้ว'
      });
    } catch (err) {
      console.error('[CustomerRouter] create error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 6. PUT /api/customers/:id
  router.put('/:id', async (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    const {
      name,
      contact_name,
      phone,
      email,
      tax_id,
      address,
      customer_type,
      basecamp_sub_type,
      basecamp_unit,
      monthly_quota_hours
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'ชื่อลูกค้าหรือชื่อร้านค้าจำเป็นต้องระบุ' });
    }

    try {
      const existing = await dbQuery.get('SELECT * FROM customers WHERE id = ?', [customerId]);
      if (!existing) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      // Handle customer_type update if provided
      let targetType = existing.customer_type;
      if (customer_type) {
        const validTypes = ['basecamp', 'shop', 'ondemand', 'virtual_office'];
        let cleanType = String(customer_type).toLowerCase().trim();
        if (cleanType === 'virtual' || cleanType === 'virtual office' || cleanType === 'virtual-office') {
          cleanType = 'virtual_office';
        }
        if (validTypes.includes(cleanType)) {
          targetType = cleanType;
        }
      }

      const targetUnit = targetType === 'basecamp' ? (basecamp_unit || existing.basecamp_unit) : null;
      const targetSubType = targetType === 'basecamp' ? (basecamp_sub_type || existing.basecamp_sub_type || 'office') : null;

      // Unit uniqueness check if basecamp
      if (targetType === 'basecamp' && targetUnit) {
        const conflict = await dbQuery.get(
          `SELECT id, name FROM customers
           WHERE customer_type = 'basecamp' AND basecamp_unit = ? AND status = 'active' AND id != ?`,
          [targetUnit, customerId]
        );
        if (conflict) {
          return res.status(400).json({
            error: `ยูนิต ${targetUnit} มีผู้เช่าที่ใช้งานอยู่แล้ว (${conflict.name}) กรุณาใช้ฟังก์ชันเปลี่ยนผู้เช่าหรือปิดสถานะผู้เช่าเดิมก่อน`
          });
        }
      }

      await dbQuery.run(
        `UPDATE customers
         SET customer_type = ?,
             name = ?,
             contact_name = ?,
             phone = ?,
             email = ?,
             tax_id = ?,
             address = ?,
             basecamp_sub_type = ?,
             basecamp_unit = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          targetType,
          name.trim(),
          contact_name !== undefined ? (contact_name ? contact_name.trim() : null) : existing.contact_name,
          phone !== undefined ? (phone ? phone.trim() : null) : existing.phone,
          email !== undefined ? (email ? email.trim() : null) : existing.email,
          tax_id !== undefined ? (tax_id ? tax_id.trim() : null) : existing.tax_id,
          address !== undefined ? (address ? address.trim() : null) : existing.address,
          targetSubType,
          targetUnit,
          customerId
        ]
      );

      // Update quota in active contract if provided
      if (monthly_quota_hours !== undefined && monthly_quota_hours !== null && monthly_quota_hours !== '') {
        const newQuota = Math.max(0, Number(monthly_quota_hours) || 0);
        const activeContract = await dbQuery.get(
          `SELECT id, monthly_quota_hours FROM customer_contracts
           WHERE customer_id = ? AND status IN ('ACTIVE', 'EXPIRING')
           ORDER BY end_date DESC, id DESC LIMIT 1`,
          [customerId]
        );

        if (activeContract) {
          await dbQuery.run(
            `UPDATE customer_contracts
             SET monthly_quota_hours = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [newQuota, activeContract.id]
          );
        } else {
          const today = new Date().toISOString().slice(0, 10);
          const nextYear = new Date();
          nextYear.setFullYear(nextYear.getFullYear() + 1);
          const endStr = nextYear.toISOString().slice(0, 10);
          const baseCtr = `CTR-${targetType.toUpperCase()}-${customerId}-${today.slice(0, 7).replace('-', '')}`;
          const ctrNum = await generateUniqueContractNumber(baseCtr);
          await dbQuery.run(
            `INSERT INTO customer_contracts
             (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'Initial quota allocated', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [customerId, ctrNum, today, endStr, newQuota]
          );
        }
      }

      const performedBy = req.user?.username || 'staff';
      await recordAuditLog({
        customerId,
        action: 'UPDATE_CUSTOMER',
        details: {
          previous: {
            name: existing.name,
            customer_type: existing.customer_type,
            contact_name: existing.contact_name,
            phone: existing.phone
          },
          updated: {
            name,
            customer_type: targetType,
            contact_name,
            phone,
            monthly_quota_hours: monthly_quota_hours !== undefined ? Number(monthly_quota_hours) : undefined
          }
        },
        performedBy
      });

      res.json({
        success: true,
        message: 'บันทึกการแก้ไขข้อมูลลูกค้าเรียบร้อยแล้ว'
      });
    } catch (err) {
      console.error('[CustomerRouter] update error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 7. PATCH /api/customers/:id/status
  router.patch('/:id/status', async (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    try {
      await dbQuery.run(
        'UPDATE customers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, customerId]
      );

      const performedBy = req.user?.username || 'staff';
      await recordAuditLog({
        customerId,
        action: 'UPDATE_STATUS',
        details: { status },
        performedBy
      });

      res.json({
        success: true,
        message: `เปลี่ยนสถานะเป็น ${status} เรียบร้อยแล้ว`
      });
    } catch (err) {
      console.error('[CustomerRouter] status error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 8. POST /api/customers/:id/contracts (Create or Renew contract)
  router.post('/:id/contracts', async (req, res) => {
    const customerId = parseInt(req.params.id, 10);
    const {
      contract_number,
      start_date,
      end_date,
      monthly_quota_hours,
      notes
    } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'วันเริ่มสัญญาและวันสิ้นสุดสัญญาจำเป็นต้องระบุ' });
    }

    if (start_date > end_date) {
      return res.status(400).json({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' });
    }

    try {
      const customer = await dbQuery.get('SELECT * FROM customers WHERE id = ?', [customerId]);
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      // Check for overlapping active contracts
      const overlapping = await dbQuery.get(
        `SELECT id, contract_number, start_date, end_date FROM customer_contracts
         WHERE customer_id = ?
           AND status != 'TERMINATED'
           AND start_date <= ?
           AND end_date >= ?
         LIMIT 1`,
        [customerId, end_date, start_date]
      );

      if (overlapping) {
        return res.status(400).json({
          error: `ช่วงเวลาของสัญญานี้ซ้อนทับกับสัญญาที่มีอยู่ (${overlapping.contract_number}: ${overlapping.start_date} ถึง ${overlapping.end_date})`
        });
      }

      const defaultQuota = customer.customer_type === 'shop'
        ? 4.0
        : (customer.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0);
      const quotaVal = monthly_quota_hours !== undefined ? Number(monthly_quota_hours) : defaultQuota;

      const baseCtr = contract_number && contract_number.trim()
        ? contract_number.trim()
        : (customer.customer_type === 'basecamp'
            ? `CTR-BC-${customer.basecamp_unit || 'UNIT'}-${start_date.slice(0, 7).replace('-', '')}`
            : `CTR-SHOP-${customerId}-${start_date.slice(0, 7).replace('-', '')}`);

      let ctrRes = null;
      let effectiveContractNumber = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        effectiveContractNumber = contract_number && contract_number.trim()
          ? contract_number.trim()
          : await generateUniqueContractNumber(baseCtr);
        try {
          ctrRes = await dbQuery.run(
            `INSERT INTO customer_contracts
             (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [customerId, effectiveContractNumber, start_date, end_date, quotaVal, notes || null]
          );
          break;
        } catch (insertErr) {
          const isUniqueErr = insertErr && (
            insertErr.code === 'SQLITE_CONSTRAINT' ||
            String(insertErr.message || '').includes('UNIQUE constraint failed')
          );
          if (isUniqueErr && (!contract_number || !contract_number.trim()) && attempt < 4) {
            continue;
          }
          if (isUniqueErr && contract_number && contract_number.trim()) {
            return res.status(400).json({ error: `หมายเลขสัญญา "${contract_number.trim()}" มีอยู่ในระบบแล้ว กรุณาระบุหมายเลขสัญญาใหม่` });
          }
          throw insertErr;
        }
      }

      const performedBy = req.user?.username || 'staff';
      await recordAuditLog({
        customerId,
        contractId: ctrRes.id,
        action: 'RENEW_CONTRACT',
        details: {
          contract_number: effectiveContractNumber,
          start_date,
          end_date,
          monthly_quota_hours: quotaVal,
          notes
        },
        performedBy
      });

      res.status(201).json({
        success: true,
        contract_id: ctrRes.id,
        message: 'บันทึกสัญญาใหม่/ต่อสัญญาเรียบร้อยแล้ว'
      });
    } catch (err) {
      console.error('[CustomerRouter] create contract error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 9. PATCH /api/customers/contracts/:contractId/terminate
  router.patch('/contracts/:contractId/terminate', async (req, res) => {
    const contractId = parseInt(req.params.contractId, 10);
    const { termination_date, reason } = req.body;
    const effectiveTerminationDate = termination_date || getBangkokDateToday();

    try {
      const contract = await dbQuery.get('SELECT * FROM customer_contracts WHERE id = ?', [contractId]);
      if (!contract) {
        return res.status(404).json({ error: 'Contract not found' });
      }

      const updatedNotes = contract.notes
        ? `${contract.notes}\n[TERMINATED ${effectiveTerminationDate}]: ${reason || 'ยกเลิกสัญญาก่อนกำหนด'}`
        : `[TERMINATED ${effectiveTerminationDate}]: ${reason || 'ยกเลิกสัญญาก่อนกำหนด'}`;

      await dbQuery.run(
        `UPDATE customer_contracts
         SET status = 'TERMINATED',
             end_date = ?,
             notes = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [effectiveTerminationDate, updatedNotes, contractId]
      );

      const performedBy = req.user?.username || 'staff';
      await recordAuditLog({
        customerId: contract.customer_id,
        contractId,
        action: 'TERMINATE_CONTRACT',
        details: { termination_date: effectiveTerminationDate, reason },
        performedBy
      });

      res.json({
        success: true,
        message: 'ยกเลิกสัญญาเรียบร้อยแล้ว'
      });
    } catch (err) {
      console.error('[CustomerRouter] terminate contract error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 9.1. PUT & PATCH /api/customers/contracts/:contractId/dates
  const handleEditContractDates = async (req, res) => {
    const contractId = parseInt(req.params.contractId, 10);
    const { start_date, end_date, reason } = req.body || {};

    // Authorization check: User must have manage/admin permission
    const hasContractManagePermission = req.user && (
      req.user.role === 'admin' ||
      req.user.username === 'admin' ||
      String(req.user.permissions || '').split(',').map(p => p.trim()).includes('manage') ||
      String(req.user.permissions || '').split(',').map(p => p.trim()).includes('admin-management')
    );

    if (!hasContractManagePermission) {
      return res.status(403).json({ error: 'สิทธิ์ไม่เพียงพอ ท่านไม่มีสิทธิ์ในการแก้ไขข้อมูลสัญญา' });
    }

    const performedBy = req.user?.username || req.user?.fullname || 'staff';

    try {
      const result = await updateContractDates(dbQuery, {
        contractId,
        startDate: start_date,
        endDate: end_date,
        reason,
        performedBy
      });

      if (!result.success) {
        return res.status(result.status || 400).json({ error: result.error });
      }

      res.json({
        success: true,
        contract: result.contract,
        audit: result.audit,
        message: result.message
      });
    } catch (err) {
      console.error('[CustomerRouter] edit contract dates error:', err);
      res.status(500).json({ error: err.message });
    }
  };

  router.put('/contracts/:contractId/dates', handleEditContractDates);
  router.patch('/contracts/:contractId/dates', handleEditContractDates);

  // 10. POST /api/customers/transfer-unit (Basecamp tenant change)
  router.post('/transfer-unit', async (req, res) => {
    const {
      basecamp_unit,
      new_tenant,
      new_contract
    } = req.body;

    if (!basecamp_unit || !new_tenant || !new_tenant.name) {
      return res.status(400).json({ error: 'กรุณาระบุเลขยูนิตและข้อมูลผู้เช่ารายใหม่' });
    }
    if (new_contract && new_contract.start_date && new_contract.end_date && new_contract.start_date > new_contract.end_date) {
      return res.status(400).json({ error: 'วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา' });
    }

    try {
      // 1. Deactivate old active tenant on this unit
      const oldTenants = await dbQuery.all(
        `SELECT id, name FROM customers
         WHERE customer_type = 'basecamp' AND basecamp_unit = ? AND status = 'active'`,
        [basecamp_unit]
      );

      for (const old of (oldTenants || [])) {
        await dbQuery.run("UPDATE customers SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [old.id]);
        await dbQuery.run(
          "UPDATE customer_contracts SET status = 'TERMINATED', updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND status IN ('ACTIVE', 'EXPIRING')",
          [old.id]
        );
      }

      // 2. Create new tenant
      const subType = new_tenant.basecamp_sub_type || (['419', '420', '421', '422', '427', '428', '429', '430'].includes(basecamp_unit) ? 'hotdesk' : 'office');
      const insRes = await dbQuery.run(
        `INSERT INTO customers
         (customer_type, name, contact_name, phone, email, tax_id, address, basecamp_sub_type, basecamp_unit, status, created_at, updated_at)
         VALUES ('basecamp', ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          new_tenant.name.trim(),
          new_tenant.contact_name ? new_tenant.contact_name.trim() : null,
          new_tenant.phone ? new_tenant.phone.trim() : null,
          new_tenant.email ? new_tenant.email.trim() : null,
          new_tenant.tax_id ? new_tenant.tax_id.trim() : null,
          new_tenant.address ? new_tenant.address.trim() : null,
          subType,
          basecamp_unit
        ]
      );
      const newCustomerId = insRes.id;

      // 3. Create contract for new tenant
      let newContractId = null;
      let ctrNum = null;
      if (new_contract && new_contract.start_date && new_contract.end_date) {
        const quotaVal = new_contract.monthly_quota_hours !== undefined
          ? Number(new_contract.monthly_quota_hours)
          : (subType === 'hotdesk' ? 2.0 : 4.0);
        const baseCtr = new_contract.contract_number && new_contract.contract_number.trim()
          ? new_contract.contract_number.trim()
          : `CTR-BC-${basecamp_unit}-${new_contract.start_date.slice(0, 7).replace('-', '')}`;

        let ctrRes = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          ctrNum = new_contract.contract_number && new_contract.contract_number.trim()
            ? new_contract.contract_number.trim()
            : await generateUniqueContractNumber(baseCtr);
          try {
            ctrRes = await dbQuery.run(
              `INSERT INTO customer_contracts
               (customer_id, contract_number, start_date, end_date, monthly_quota_hours, status, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [newCustomerId, ctrNum, new_contract.start_date, new_contract.end_date, quotaVal, new_contract.notes || null]
            );
            break;
          } catch (insertErr) {
            const isUniqueErr = insertErr && (
              insertErr.code === 'SQLITE_CONSTRAINT' ||
              String(insertErr.message || '').includes('UNIQUE constraint failed')
            );
            if (isUniqueErr && (!new_contract.contract_number || !new_contract.contract_number.trim()) && attempt < 4) {
              continue;
            }
            if (isUniqueErr && new_contract.contract_number && new_contract.contract_number.trim()) {
              return res.status(400).json({ error: `หมายเลขสัญญา "${new_contract.contract_number.trim()}" มีอยู่ในระบบแล้ว กรุณาระบุหมายเลขสัญญาใหม่` });
            }
            throw insertErr;
          }
        }
        newContractId = ctrRes.id;
      }

      const performedBy = req.user?.username || 'staff';
      await recordAuditLog({
        customerId: newCustomerId,
        contractId: newContractId,
        action: 'TRANSFER_UNIT',
        details: {
          basecamp_unit,
          previous_tenants: oldTenants ? oldTenants.map(t => ({ id: t.id, name: t.name })) : [],
          new_tenant_name: new_tenant.name
        },
        performedBy
      });

      res.status(201).json({
        success: true,
        customer_id: newCustomerId,
        contract_id: newContractId,
        message: `เปลี่ยนผู้เช่ายูนิต ${basecamp_unit} เรียบร้อยแล้ว ประวัติของผู้เช่าเดิมถูกแยกเก็บอย่างปลอดภัย`
      });
    } catch (err) {
      console.error('[CustomerRouter] transfer error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createCustomerRouter };
