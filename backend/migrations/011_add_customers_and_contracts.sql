-- Migration 011: Add Customer, Shop, Contract Management and Audit Logs
-- BWORK-CUSTOMER-SHOP-CONTRACT-V1

-- 1. Create customers table
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_type TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  address TEXT,
  basecamp_sub_type TEXT,
  basecamp_unit TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create customer_contracts table
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

-- 3. Create customer_audit_logs table
CREATE TABLE IF NOT EXISTS customer_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  contract_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  performed_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Add customer_id and contract_id columns to bookings table
ALTER TABLE bookings ADD COLUMN customer_id INTEGER;
ALTER TABLE bookings ADD COLUMN contract_id INTEGER;

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_customers_type_status ON customers(customer_type, status);
CREATE INDEX IF NOT EXISTS idx_customers_unit ON customers(basecamp_unit);
CREATE INDEX IF NOT EXISTS idx_contracts_dates ON customer_contracts(start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON customer_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_customer ON customer_audit_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_contract_id ON bookings(contract_id);
