-- ==============================================================================
-- BWORK-POS — DETERMINISTIC STAGING D1 INITIALIZATION FIXTURE
-- Environment: Cloudflare D1 Staging (bworkpos_staging_db)
-- Phase: RELEASE-2A
--
-- STRICT POLICIES:
-- 1. SYNTHETIC FIXTURES ONLY. ZERO REAL CUSTOMER DATA / PII / PAYMENT SLIPS.
-- 2. ZERO LIVE LINE TOKENS OR INTEGRATION SECRETS.
-- 3. INCLUDES FULL SCHEMA THROUGH MIGRATION 009 (Room Wi-Fi Hotspot Credentials).
-- 4. PRECONFIGURED WITH DETERMINISTIC SINGLE-ITEM AND MULTI-ITEM TEST BOOKINGS.
-- ==============================================================================

-- 1. SCHEMA MIGRATION TRACKING
CREATE TABLE IF NOT EXISTS _schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT UNIQUE NOT NULL,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. CORE TABLES
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  hourly_rate REAL NOT NULL,
  daily_rate REAL DEFAULT 0,
  half_day_rate REAL DEFAULT 0,
  has_classroom INTEGER DEFAULT 0,
  classroom_hourly_rate REAL DEFAULT 0,
  classroom_daily_rate REAL DEFAULT 0,
  classroom_capacity INTEGER DEFAULT 0,
  classroom_image_url TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  image_url TEXT,
  has_hourly INTEGER DEFAULT 1,
  has_halfday INTEGER DEFAULT 0,
  has_daily INTEGER DEFAULT 0,
  category TEXT DEFAULT 'Meeting Room',
  pin_code TEXT,
  builtland_pin_code TEXT,
  wifi_username TEXT,
  wifi_password_enc TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  image_url TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  department TEXT,
  contact TEXT,
  total_amount REAL NOT NULL,
  payment_status TEXT DEFAULT 'pending',
  payment_method TEXT,
  receipt_number TEXT,
  pin_code TEXT,
  qr_token TEXT,
  line_user_id TEXT,
  booking_source TEXT DEFAULT 'online',
  customer_email TEXT,
  booking_details TEXT,
  slip_image_url TEXT,
  checkin_status TEXT DEFAULT 'pending',
  checkin_at DATETIME,
  tax_invoice_required INTEGER DEFAULT 0,
  tax_name TEXT,
  tax_address TEXT,
  tax_id TEXT,
  tax_phone TEXT,
  tax_delivery_method TEXT,
  tax_postal_address TEXT,
  guest_count INTEGER,
  customer_type TEXT DEFAULT 'walkin',
  basecamp_sub_type TEXT,
  basecamp_unit TEXT,
  internal_department TEXT,
  billing_option TEXT DEFAULT 'paid',
  quota_hours_used REAL DEFAULT 0,
  subtotal_amount REAL,
  discount_type TEXT DEFAULT 'none',
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  balance_amount REAL DEFAULT 0,
  slip_trans_ref TEXT,
  slip_verified_at TEXT,
  slip_verify_status TEXT,
  cancellation_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  service_id INTEGER REFERENCES services(id),
  quantity INTEGER DEFAULT 1,
  price REAL NOT NULL,
  start_time TEXT,
  end_time TEXT,
  subtotal REAL NOT NULL,
  layout TEXT DEFAULT 'standard',
  booking_type TEXT DEFAULT 'hourly',
  guest_count INTEGER,
  pin_code TEXT,
  checkin_status TEXT DEFAULT 'pending',
  checkin_at DATETIME
);

CREATE TABLE IF NOT EXISTS slip_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  trans_ref TEXT,
  bank_code TEXT,
  bank_name TEXT,
  amount REAL,
  slip_image_url TEXT,
  is_auto_approved INTEGER DEFAULT 0,
  confidence_score REAL DEFAULT 0,
  raw_qr_data TEXT,
  ocr_text TEXT,
  verification_status TEXT DEFAULT 'pending',
  rejection_reason TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'staff',
  permissions TEXT,
  fullname TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  permissions TEXT NOT NULL,
  is_system INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  department TEXT,
  contact TEXT,
  total_amount REAL NOT NULL,
  status TEXT DEFAULT 'draft',
  valid_until TEXT,
  seller_name TEXT,
  job_name TEXT,
  customer_address TEXT,
  quotation_no TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER REFERENCES quotations(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id),
  service_id INTEGER REFERENCES services(id),
  quantity INTEGER DEFAULT 1,
  price REAL NOT NULL,
  start_time TEXT,
  end_time TEXT,
  subtotal REAL NOT NULL,
  layout TEXT DEFAULT 'standard',
  booking_type TEXT DEFAULT 'hourly',
  discount REAL DEFAULT 0,
  item_date TEXT,
  discount_type TEXT DEFAULT 'amount'
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  address TEXT,
  company TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  transaction_type TEXT DEFAULT 'full',
  slip_url TEXT,
  status TEXT DEFAULT 'completed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timeline_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  performed_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS line_notification_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL DEFAULT 'booking_confirmation',
  status TEXT NOT NULL DEFAULT 'processing',
  claim_token TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  http_status INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(booking_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_line_claims_booking_status 
ON line_notification_claims (booking_id, notification_type, status);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  opened_by TEXT NOT NULL,
  opening_cash REAL NOT NULL,
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  closed_by TEXT,
  closing_cash REAL,
  expected_cash REAL,
  difference REAL,
  status TEXT DEFAULT 'open',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_drawer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER,
  action TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  performed_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. ROOM HOUR CREDITS & AUDIT LEDGER (Migration 005)
CREATE TABLE IF NOT EXISTS room_hour_credits (
  credit_id TEXT PRIMARY KEY,
  source_booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  source_item_id INTEGER NOT NULL REFERENCES booking_items(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  line_user_id TEXT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_hour_credit_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id TEXT NOT NULL REFERENCES room_hour_credits(credit_id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('grant','redeem','reversal')),
  minutes_delta INTEGER NOT NULL CHECK(typeof(minutes_delta)='integer' AND minutes_delta != 0),
  booking_item_id INTEGER REFERENCES booking_items(id) ON DELETE RESTRICT,
  reverses_entry_id INTEGER UNIQUE REFERENCES room_hour_credit_entries(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  CHECK((entry_type='grant' AND minutes_delta>0 AND booking_item_id IS NULL AND reverses_entry_id IS NULL)
     OR (entry_type='redeem' AND minutes_delta<0 AND booking_item_id IS NOT NULL AND reverses_entry_id IS NULL)
     OR (entry_type='reversal' AND minutes_delta>0 AND booking_item_id IS NOT NULL AND reverses_entry_id IS NOT NULL))
);

-- 4. PERFORMANCE & INTEGRITY INDEXES
CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id ON booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_room_id ON booking_items(room_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_room_time ON booking_items(room_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_receipt_number ON bookings(receipt_number);
CREATE INDEX IF NOT EXISTS idx_bookings_pin_code ON bookings(pin_code);
CREATE INDEX IF NOT EXISTS idx_bookings_balance_amount ON bookings(balance_amount);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_booking_id ON payment_transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotations_created_at ON quotations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS room_hour_credit_phone ON room_hour_credits(customer_phone);
CREATE INDEX IF NOT EXISTS room_hour_credit_history ON room_hour_credit_entries(credit_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS room_hour_credit_grant ON room_hour_credit_entries(credit_id) WHERE entry_type='grant';
CREATE UNIQUE INDEX IF NOT EXISTS room_hour_credit_redeem_item ON room_hour_credit_entries(booking_item_id) WHERE entry_type='redeem';

-- 5. LEDGER IMMUTABILITY TRIGGERS
CREATE TRIGGER IF NOT EXISTS hour_credit_no_negative BEFORE INSERT ON room_hour_credit_entries
WHEN COALESCE((SELECT SUM(minutes_delta) FROM room_hour_credit_entries WHERE credit_id=NEW.credit_id),0)+NEW.minutes_delta<0
BEGIN SELECT RAISE(ABORT,'hour credit insufficient balance'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_valid_reversal BEFORE INSERT ON room_hour_credit_entries
WHEN NEW.entry_type='reversal' AND NOT EXISTS (
 SELECT 1 FROM room_hour_credit_entries e WHERE e.id=NEW.reverses_entry_id AND e.entry_type='redeem'
 AND e.credit_id=NEW.credit_id AND e.booking_item_id=NEW.booking_item_id AND e.minutes_delta=-NEW.minutes_delta)
BEGIN SELECT RAISE(ABORT,'invalid hour credit reversal'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_entries_no_update BEFORE UPDATE ON room_hour_credit_entries
BEGIN SELECT RAISE(ABORT,'hour credit ledger is append only'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_entries_no_delete BEFORE DELETE ON room_hour_credit_entries
BEGIN SELECT RAISE(ABORT,'hour credit ledger is append only'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_no_update BEFORE UPDATE ON room_hour_credits
BEGIN SELECT RAISE(ABORT,'hour credit identity is immutable'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_no_delete BEFORE DELETE ON room_hour_credits
BEGIN SELECT RAISE(ABORT,'hour credit history is permanent'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_booking_no_delete BEFORE DELETE ON bookings
WHEN EXISTS(SELECT 1 FROM room_hour_credits WHERE source_booking_id=OLD.id)
 OR EXISTS(SELECT 1 FROM room_hour_credit_entries e JOIN booking_items i ON i.id=e.booking_item_id WHERE i.booking_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'booking linked to hour credit cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS hour_credit_item_no_delete BEFORE DELETE ON booking_items
WHEN EXISTS(SELECT 1 FROM room_hour_credits WHERE source_item_id=OLD.id)
 OR EXISTS(SELECT 1 FROM room_hour_credit_entries WHERE booking_item_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'item linked to hour credit cannot be deleted'); END;

-- 6. RECORD SCHEMA MIGRATIONS APPLIED
INSERT OR IGNORE INTO _schema_migrations (version) VALUES
('001_core_schema.sql'),
('002_add_booking_channel.sql'),
('003_slip_unique_index.sql'),
('004_add_builtland_pin_to_rooms.sql'),
('005_room_hour_credits.sql'),
('006_add_booking_details.sql'),
('007_add_builtland_pin_to_rooms.sql'),
('008_add_discount_and_deposit.sql'),
('009_add_room_wifi_credentials.sql');

-- 7. SYNTHETIC MASTER ROOMS
INSERT OR REPLACE INTO rooms (id, name, capacity, hourly_rate, daily_rate, half_day_rate, has_classroom, classroom_hourly_rate, classroom_daily_rate, classroom_capacity, description, status, has_hourly, has_halfday, has_daily, category, pin_code, builtland_pin_code, wifi_username, wifi_password_enc) VALUES
(4, 'Mars (301)', 8, 500.0, 4000.0, 0, 1, 700.0, 5000.0, 12, 'ห้องประชุมขนาด 8 ท่าน (Staging)', 'active', 1, 0, 1, 'Meeting Room', '393478#', 'BL-301', NULL, NULL),
(5, 'Mercury (302)', 10, 500.0, 4000.0, 0, 0, 0, 0, 0, 'ห้องประชุมขนาดกลาง 10 ท่าน พร้อม Wi-Fi สำหรับทดสอบ (Staging)', 'active', 1, 0, 1, 'Meeting Room', '970491#', 'BL-302', 'staging_room_302', NULL),
(6, 'Saturn (303)', 4, 300.0, 2200.0, 0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)', 'active', 1, 0, 1, 'Meeting Room', '812187#', 'BL-303', NULL, NULL),
(7, 'Venus (304)', 4, 200.0, 1500.0, 0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)', 'active', 1, 0, 1, 'Meeting Room', '593105#', 'BL-304', NULL, NULL),
(8, 'Uranus (305)', 4, 200.0, 1500.0, 0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)', 'active', 1, 0, 1, 'Meeting Room', '139231#', 'BL-305', NULL, NULL),
(9, 'Neptune (306)', 4, 200.0, 1500.0, 0, 0, 0, 0, 0, 'ห้องประชุมขนาดเล็ก 4 ท่าน (Staging)', 'active', 1, 0, 1, 'Meeting Room', '593105#', 'BL-306', NULL, NULL),
(10, 'Jupiter (300)', 40, 1700.0, 12000.0, 6000.0, 0, 0, 0, 0, 'ห้องประชุมโถงใหญ่ 40 ท่าน (Staging)', 'active', 1, 1, 1, 'Meeting Room', NULL, 'BL-300', NULL, NULL),
(11, 'Pluto (201)', 12, 600.0, 5000.0, 0, 0, 0, 0, 0, 'ห้องประชุม 12 ท่าน (Staging)', 'active', 1, 0, 1, 'Meeting Room', '765297#', 'BL-201', NULL, NULL);

-- 8. SYNTHETIC SERVICES
INSERT OR REPLACE INTO services (id, name, price, category, status) VALUES
(1, 'กาแฟ & ชา ของว่าง (Catering Box - Staging)', 50.0, 'catering', 'active'),
(2, 'เครื่องโปรเจคเตอร์ 4K (Projector Rental - Staging)', 100.0, 'equipment', 'active');

-- 9. SYNTHETIC SAFE SETTINGS (ZERO LIVE LINE TOKENS)
INSERT OR REPLACE INTO settings (key, value) VALUES
('company_name', 'บริษัท บิลท์ ฮาร์ท จำกัด (Staging Environment)'),
('receipt_header', 'ใบเสร็จรับเงิน (STAGING / TEST ONLY)'),
('receipt_footer', 'เอกสารทดสอบระบบสเตจจิ้ง ไม่ใช่ใบเสร็จรับเงินจริง'),
('company_address', '98 หมู่ 2 อาคารบีเวิร์ค (Staging Lab) จ.นนทบุรี 11120'),
('cleaning_buffer_minutes', '15'),
('payment_deadline_hours', '24'),
('room_alert_minutes', '15'),
('wifi_ssid', '@BWORK'),
('promptpay_id', '0000000000000'),
('payment_bank_name', 'ธนาคารทดสอบสเตจจิ้ง (Mock Test Bank)'),
('payment_bank_account', '000-0-00000-0'),
('payment_bank_account_name', 'บัญชีทดสอบระบบ สเตจจิ้ง');

-- 10. SYNTHETIC ROLES & STAFF USERS
INSERT OR REPLACE INTO roles (id, name, label, permissions, is_system) VALUES
(1, 'admin', 'ผู้ดูแลระบบสเตจจิ้ง', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 1),
(2, 'staff', 'พนักงานบริการสเตจจิ้ง', 'pos,pending,layout,manage', 1);

-- Staging accounts (live Staging D1 password hashes are provisioned securely via CSPRNG SHA-256)
INSERT OR REPLACE INTO users (id, username, password_hash, role, permissions, fullname) VALUES
(1, 'admin_staging', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 'ผู้ดูแลระบบ (Staging Admin)'),
(2, 'staff_staging', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'staff', 'pos,pending,layout,manage', 'พนักงานบริการ (Staging Staff)'),
(3, 'admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 'ผู้ดูแลระบบ (Staging Admin)');

-- 11. DETERMINISTIC SYNTHETIC TEST BOOKINGS

-- Booking #9001: Single-Item Booking (Mercury 302, 1,000 THB Paid)
INSERT OR REPLACE INTO bookings (id, customer_name, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, subtotal_amount, paid_amount, balance_amount, created_at) VALUES
(9001, 'ผู้ทดสอบ สเตจจิ้ง 1 (Single Item Test)', '0800000001', 1000.0, 'paid', 'promptpay', 'REC-STAGE-9001', '123456#', 'online', 1000.0, 1000.0, 0.0, '2026-10-20 08:00:00');

INSERT OR REPLACE INTO booking_items (id, booking_id, room_id, quantity, price, start_time, end_time, subtotal, pin_code, checkin_status) VALUES
(9101, 9001, 5, 1, 500.0, '2026-10-20 10:00', '2026-10-20 12:00', 1000.0, '123456#', 'pending');

INSERT OR REPLACE INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, status, created_at) VALUES
(9201, 9001, 1000.0, 'promptpay', 'full', 'completed', '2026-10-20 08:05:00');

-- Booking #9002: Multi-Item Booking (Mercury 302 + Saturn 303, Total 1,600 THB Paid)
-- Target for testing Multi-Item Rescheduling Isolation in Staging
INSERT OR REPLACE INTO bookings (id, customer_name, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, subtotal_amount, paid_amount, balance_amount, created_at) VALUES
(9002, 'ผู้ทดสอบ สเตจจิ้ง 2 (Multi Item Test)', '0800000002', 1600.0, 'paid', 'promptpay', 'REC-STAGE-9002', '654321#', 'pos', 1600.0, 1600.0, 0.0, '2026-10-21 08:00:00');

INSERT OR REPLACE INTO booking_items (id, booking_id, room_id, quantity, price, start_time, end_time, subtotal, pin_code, checkin_status) VALUES
(9102, 9002, 5, 1, 500.0, '2026-10-21 09:00', '2026-10-21 11:00', 1000.0, '654321#', 'pending'),
(9103, 9002, 6, 1, 300.0, '2026-10-21 13:00', '2026-10-21 15:00', 600.0, '789123#', 'pending');

INSERT OR REPLACE INTO payment_transactions (id, booking_id, amount, payment_method, transaction_type, status, created_at) VALUES
(9202, 9002, 1600.0, 'promptpay', 'full', 'completed', '2026-10-21 08:10:00');

-- Booking #9003: Sibling Collision / Pending Unpaid Test Booking (Mercury 302, 1,000 THB Unpaid)
INSERT OR REPLACE INTO bookings (id, customer_name, contact, total_amount, payment_status, payment_method, receipt_number, pin_code, booking_source, subtotal_amount, paid_amount, balance_amount, created_at) VALUES
(9003, 'ผู้ทดสอบ สเตจจิ้ง 3 (Conflict Test)', '0800000003', 1000.0, 'pending', 'promptpay', 'REC-STAGE-9003', '987654#', 'online', 1000.0, 0.0, 1000.0, '2026-10-22 08:00:00');

INSERT OR REPLACE INTO booking_items (id, booking_id, room_id, quantity, price, start_time, end_time, subtotal, pin_code, checkin_status) VALUES
(9104, 9003, 5, 1, 500.0, '2026-10-22 14:00', '2026-10-22 16:00', 1000.0, '987654#', 'pending');
