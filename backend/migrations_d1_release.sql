-- ==============================================================================
-- BWORK-POS CLOUDFLARE D1 SELECTIVE PRODUCTION MIGRATION
-- Release SHA: c06b8e002758ee471c6d8bc05043b571ed283ecd
-- Scope: 010 (Focal Point), 011 (CRM & Contracts), 013 (Tax Invoices & Slip), 014 (17 Permissions)
-- STRICT EXCLUSION: Migration 012 (Support Tickets) is NOT included.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ROOMS: Focal Point Coordinates (Migration 010)
-- ------------------------------------------------------------------------------
ALTER TABLE rooms ADD COLUMN image_position_x INTEGER DEFAULT 50;
ALTER TABLE rooms ADD COLUMN image_position_y INTEGER DEFAULT 50;

-- ------------------------------------------------------------------------------
-- 2. CUSTOMERS: CRM Enhancements (Migration 011)
-- Existing columns: id, name, phone, email, tax_id, address, company, created_at
-- ------------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN customer_type TEXT DEFAULT 'basecamp';
ALTER TABLE customers ADD COLUMN contact_name TEXT;
ALTER TABLE customers ADD COLUMN basecamp_sub_type TEXT;
ALTER TABLE customers ADD COLUMN basecamp_unit TEXT;
ALTER TABLE customers ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE customers ADD COLUMN updated_at DATETIME;

-- ------------------------------------------------------------------------------
-- 3. CUSTOMER CONTRACTS & AUDIT LOGS (Migration 011)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contract_number TEXT UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  monthly_quota_hours REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  contract_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  performed_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 4. BOOKINGS: CRM Linkage & Enhanced Tax Invoices (Migrations 011 & 013)
-- ------------------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN customer_id INTEGER;
ALTER TABLE bookings ADD COLUMN contract_id INTEGER;
ALTER TABLE bookings ADD COLUMN tax_payer_type TEXT DEFAULT 'corporate';
ALTER TABLE bookings ADD COLUMN tax_branch_type TEXT DEFAULT 'head';
ALTER TABLE bookings ADD COLUMN tax_branch_number TEXT;
ALTER TABLE bookings ADD COLUMN tax_email TEXT;
ALTER TABLE bookings ADD COLUMN tax_invoice_status TEXT DEFAULT 'pending';

-- ------------------------------------------------------------------------------
-- 5. PAYMENT TRANSACTIONS & TAX INVOICES (Migration 013)
-- ------------------------------------------------------------------------------
ALTER TABLE payment_transactions ADD COLUMN slip_url TEXT;

CREATE TABLE IF NOT EXISTS tax_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  invoice_number TEXT,
  tax_payer_type TEXT DEFAULT 'corporate',
  tax_name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  tax_branch_type TEXT DEFAULT 'head',
  tax_branch_number TEXT,
  tax_address TEXT,
  tax_email TEXT,
  tax_phone TEXT,
  file_url TEXT,
  r2_object_key TEXT,
  file_name TEXT,
  content_type TEXT,
  file_size INTEGER,
  status TEXT DEFAULT 'issued',
  notes TEXT,
  uploaded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 6. PERFORMANCE & LOOKUP INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_type_status ON customers(customer_type, status);
CREATE INDEX IF NOT EXISTS idx_customers_unit ON customers(basecamp_unit);
CREATE INDEX IF NOT EXISTS idx_contracts_dates ON customer_contracts(start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON customer_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_customer ON customer_audit_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_contract_id ON bookings(contract_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_booking_id ON tax_invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_invoice_number ON tax_invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_slip ON payment_transactions(slip_url);

-- ------------------------------------------------------------------------------
-- 7. ROLES & USERS: 17 Menu Permissions Synchronization (Migration 014)
-- ------------------------------------------------------------------------------
UPDATE roles
SET permissions = 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general'
WHERE name = 'admin';

UPDATE roles
SET permissions = 'pos,pending,layout,history,quotations,hour-credits,customers,tickets'
WHERE name = 'staff';

UPDATE users
SET permissions = 'pos,dashboard,pending,layout,history,quotations,hour-credits,customers,tickets,manage,admin-users,admin-system,admin-promotion,admin-quotation,admin-backup,admin-dooraccess,admin-general'
WHERE username = 'admin' OR role = 'admin';

UPDATE users
SET permissions = 'pos,pending,layout,history,quotations,hour-credits,customers,tickets'
WHERE (role = 'staff' OR username = 'staff') AND (permissions IS NULL OR permissions = 'pos,pending,history' OR permissions = 'pos,pending,history,customers' OR permissions = 'pos,pending,layout,history,quotations');
