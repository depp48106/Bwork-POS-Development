-- Migration: 001_core_schema.sql
-- Canonical SQLite Schema for Bwork-POS
-- Tables: rooms, services, bookings, booking_items, settings, users, roles, quotations, quotation_items, slip_verifications

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
  booking_source TEXT DEFAULT 'walk-in',
  customer_email TEXT,
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
  pin_code TEXT,
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
  overall_discount REAL DEFAULT 0,
  overall_discount_percent REAL DEFAULT 0,
  has_vat INTEGER DEFAULT 1,
  wht_rate REAL DEFAULT 0,
  customer_tax_id TEXT,
  customer_phone TEXT,
  issue_date TEXT,
  approved_at TEXT,
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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id ON booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_room_id ON booking_items(room_id);
CREATE INDEX IF NOT EXISTS idx_booking_items_room_time ON booking_items(room_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_receipt_number ON bookings(receipt_number);
CREATE INDEX IF NOT EXISTS idx_bookings_pin_code ON bookings(pin_code);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotations_created_at ON quotations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_slip_verifications_trans_ref ON slip_verifications(trans_ref);
CREATE INDEX IF NOT EXISTS idx_slip_verifications_booking_id ON slip_verifications(booking_id);
