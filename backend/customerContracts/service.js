/**
 * customerContracts/service.js
 * Canonical Customer, Shop & Contract Management Engine for BWORK-POS
 */

function getBangkokDateToday() {
  const now = new Date();
  const bkkMs = now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60 * 1000;
  const bkk = new Date(bkkMs);
  const y = bkk.getFullYear();
  const m = String(bkk.getMonth() + 1).padStart(2, '0');
  const d = String(bkk.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getBangkokMonthCurrent() {
  const today = getBangkokDateToday();
  return today.slice(0, 7); // 'YYYY-MM'
}

/**
 * Calculates calendar days difference between targetDate and baseDate.
 * Both dates formatted as 'YYYY-MM-DD'.
 */
function calculateDaysDifference(targetDateStr, baseDateStr = getBangkokDateToday()) {
  if (!targetDateStr) return 0;
  const target = new Date(`${targetDateStr}T00:00:00+07:00`);
  const base = new Date(`${baseDateStr}T00:00:00+07:00`);
  const diffMs = target.getTime() - base.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Computes dynamic contract status and urgency based on today's Bangkok date.
 */
function evaluateContractStatus(contract, baseDateStr = getBangkokDateToday()) {
  if (!contract) return null;
  if (contract.status === 'TERMINATED') {
    return {
      status: 'TERMINATED',
      days_left: calculateDaysDifference(contract.end_date, baseDateStr),
      urgency: 'terminated',
      is_active_or_expiring: false
    };
  }

  const daysLeft = calculateDaysDifference(contract.end_date, baseDateStr);
  let status = 'ACTIVE';
  let urgency = 'normal';

  if (daysLeft < 0) {
    status = 'EXPIRED';
    urgency = 'expired';
  } else if (daysLeft <= 7) {
    status = 'EXPIRING';
    urgency = 'danger';
  } else if (daysLeft <= 15) {
    status = 'EXPIRING';
    urgency = 'warning';
  } else if (daysLeft <= 30) {
    status = 'EXPIRING';
    urgency = 'info';
  }

  return {
    status,
    days_left: daysLeft,
    urgency,
    is_active_or_expiring: status === 'ACTIVE' || status === 'EXPIRING'
  };
}

/**
 * Verifies whether booking service date is within the contract period.
 * Policy: If serviceDate > contract.end_date, cannot use free quota.
 */
function verifyServiceDateContractEligibility(contract, serviceDateStr) {
  if (!contract) {
    return { eligible: false, reason: 'NO_CONTRACT' };
  }
  if (contract.status === 'TERMINATED') {
    return { eligible: false, reason: 'CONTRACT_TERMINATED' };
  }
  const serviceDate = serviceDateStr ? serviceDateStr.slice(0, 10) : getBangkokDateToday();
  if (contract.start_date && serviceDate < contract.start_date) {
    return { eligible: false, reason: 'SERVICE_DATE_BEFORE_CONTRACT_START' };
  }
  if (contract.end_date && serviceDate > contract.end_date) {
    return { eligible: false, reason: 'SERVICE_DATE_AFTER_CONTRACT_EXPIRATION' };
  }
  return { eligible: true };
}

/**
 * Authoritative Customer Quota Calculator
 */
async function calculateCustomerQuota(dbQuery, {
  customerId,
  customerType,
  basecampSubType,
  basecampUnit,
  serviceDate,
  month,
  year
}) {
  const targetDate = serviceDate ? serviceDate.slice(0, 10) : getBangkokDateToday();
  const targetYear = year ? String(year) : targetDate.slice(0, 4);
  const targetMonth = month ? String(month).padStart(2, '0') : targetDate.slice(5, 7);
  const targetMonthStr = `${targetYear}-${targetMonth}`;

  let customer = null;
  let activeContract = null;
  let maxQuota = 0;

  if (customerId) {
    customer = await dbQuery.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    if (!customer) {
      throw new Error(`Customer with ID ${customerId} not found`);
    }

    // Retrieve active or latest contract
    const contracts = await dbQuery.all(
      `SELECT * FROM customer_contracts
       WHERE customer_id = ?
       ORDER BY CASE WHEN status IN ('ACTIVE', 'EXPIRING') THEN 0 ELSE 1 END, end_date DESC`,
      [customerId]
    );

    if (contracts && contracts.length > 0) {
      activeContract = contracts[0];
      const evaluation = evaluateContractStatus(activeContract, targetDate);
      activeContract.evaluated_status = evaluation.status;
      activeContract.days_left = evaluation.days_left;
      activeContract.urgency = evaluation.urgency;
    }
  }

  // Determine effective customer type and unit
  const effectiveType = customer ? customer.customer_type : (customerType || 'walkin');
  const effectiveSubType = customer ? customer.basecamp_sub_type : basecampSubType;
  const effectiveUnit = customer ? customer.basecamp_unit : basecampUnit;

  // Check quota allocation limits
  if (effectiveType === 'shop') {
    maxQuota = activeContract ? Number(activeContract.monthly_quota_hours || 4.0) : 4.0;
  } else if (effectiveType === 'basecamp') {
    if (activeContract && activeContract.monthly_quota_hours) {
      maxQuota = Number(activeContract.monthly_quota_hours);
    } else {
      maxQuota = effectiveSubType === 'office' ? 4.0 : 2.0;
    }
  } else {
    maxQuota = 0;
  }

  // Check contract eligibility for service date
  let contractEligible = true;
  let ineligibilityReason = null;
  if (activeContract) {
    const eligibility = verifyServiceDateContractEligibility(activeContract, targetDate);
    if (!eligibility.eligible) {
      contractEligible = false;
      ineligibilityReason = eligibility.reason;
    }
  } else if (effectiveType === 'shop') {
    // Shop requires contract
    contractEligible = false;
    ineligibilityReason = 'NO_CONTRACT';
  }

  // Calculate used quota for target month
  let usedQuota = 0;
  let bookingCount = 0;

  if (customer && customer.id) {
    // Isolated calculation per customer_id
    const row = await dbQuery.get(
      `SELECT COALESCE(SUM(b.quota_hours_used), 0) AS used_hours, COUNT(DISTINCT b.id) AS booking_count
       FROM bookings b
       WHERE b.customer_id = ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         AND (
           EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND strftime('%Y-%m', bi.start_time) = ?)
           OR (NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id) AND strftime('%Y-%m', b.created_at) = ?)
         )`,
      [customer.id, targetMonthStr, targetMonthStr]
    );
    usedQuota = row ? Number(row.used_hours) : 0;
    bookingCount = row ? Number(row.booking_count) : 0;
  } else if (effectiveType === 'basecamp' && effectiveSubType && effectiveUnit) {
    // Legacy fallback by unit
    const row = await dbQuery.get(
      `SELECT COALESCE(SUM(b.quota_hours_used), 0) AS used_hours, COUNT(DISTINCT b.id) AS booking_count
       FROM bookings b
       WHERE b.customer_type = 'basecamp'
         AND b.basecamp_sub_type = ?
         AND b.basecamp_unit = ?
         AND (b.payment_status IS NULL OR b.payment_status NOT IN ('cancelled', 'failed', 'rejected'))
         AND (
           EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND strftime('%Y-%m', bi.start_time) = ?)
           OR (NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id) AND strftime('%Y-%m', b.created_at) = ?)
         )`,
      [effectiveSubType, effectiveUnit, targetMonthStr, targetMonthStr]
    );
    usedQuota = row ? Number(row.used_hours) : 0;
    bookingCount = row ? Number(row.booking_count) : 0;
  }

  // If service date is after contract expiration, remaining quota for THIS booking is 0
  const effectiveMaxQuota = contractEligible ? maxQuota : 0;
  const remainingQuota = Math.max(0, effectiveMaxQuota - usedQuota);

  return {
    customer_id: customer ? customer.id : null,
    customer_name: customer ? customer.name : null,
    customer_type: effectiveType,
    basecamp_sub_type: effectiveSubType,
    basecamp_unit: effectiveUnit,
    target_month: targetMonthStr,
    service_date: targetDate,
    max_quota: maxQuota,
    used_quota: usedQuota,
    remaining_quota: remainingQuota,
    booking_count: bookingCount,
    contract: activeContract,
    contract_eligible: contractEligible,
    ineligibility_reason: ineligibilityReason
  };
}

/**
 * Retrieve contract alerts for Dashboard and notification panel
 */
async function getContractAlerts(dbQuery, baseDateStr = getBangkokDateToday()) {
  const rows = await dbQuery.all(`
    SELECT ctr.id AS contract_id, ctr.contract_number, ctr.start_date, ctr.end_date,
           ctr.monthly_quota_hours, ctr.status AS db_status, ctr.notes,
           c.id AS customer_id, c.name AS customer_name, c.customer_type,
           c.basecamp_sub_type, c.basecamp_unit, c.contact_name, c.phone, c.email
    FROM customer_contracts ctr
    JOIN customers c ON ctr.customer_id = c.id
    WHERE ctr.status != 'TERMINATED'
    ORDER BY ctr.end_date ASC
  `);

  const alerts = [];
  const summary = {
    expiring_30_days: 0,
    expiring_15_days: 0,
    expiring_7_days: 0,
    expired: 0,
    total_active: 0
  };

  for (const row of rows || []) {
    const evaluation = evaluateContractStatus(row, baseDateStr);
    const item = {
      ...row,
      days_left: evaluation.days_left,
      status: evaluation.status,
      urgency: evaluation.urgency
    };

    if (item.status === 'EXPIRED') {
      summary.expired++;
      alerts.push(item);
    } else if (item.status === 'EXPIRING') {
      if (item.days_left <= 7) summary.expiring_7_days++;
      else if (item.days_left <= 15) summary.expiring_15_days++;
      else summary.expiring_30_days++;
      alerts.push(item);
    } else {
      summary.total_active++;
    }
  }

  return {
    base_date: baseDateStr,
    summary,
    alerts
  };
}

module.exports = {
  getBangkokDateToday,
  getBangkokMonthCurrent,
  calculateDaysDifference,
  evaluateContractStatus,
  verifyServiceDateContractEligibility,
  calculateCustomerQuota,
  getContractAlerts
};
