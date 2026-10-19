-- Cloudflare D1 Database Schema for Bwork-POS & Booking App

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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  image_url TEXT,
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
  customer_id INTEGER,
  contract_id INTEGER,
  cancellation_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

-- Performance Indexes for Fast Queries
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
CREATE INDEX IF NOT EXISTS idx_customers_type_status ON customers(customer_type, status);
CREATE INDEX IF NOT EXISTS idx_customers_unit ON customers(basecamp_unit);
CREATE INDEX IF NOT EXISTS idx_contracts_dates ON customer_contracts(start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON customer_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_customer ON customer_audit_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_contract_id ON bookings(contract_id);

-- Support Tickets Tables
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  line_user_id TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  booking_code TEXT,
  room_id INTEGER REFERENCES rooms(id),
  category TEXT NOT NULL CHECK(category IN ('booking', 'payment', 'facility', 'general', 'other')),
  other_category TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('urgent', 'high', 'normal', 'low')),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED')),
  assigned_to TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  closed_at DATETIME
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('customer', 'staff', 'system')),
  sender_name TEXT NOT NULL,
  verified_sender_id TEXT,
  message TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'internal')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  r2_object_key TEXT,
  file_name TEXT,
  content_type TEXT,
  file_size INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('customer', 'staff', 'system')),
  actor_id TEXT,
  actor_name TEXT,
  event_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_ticket_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  staff_username TEXT NOT NULL,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id, staff_username)
);

CREATE INDEX IF NOT EXISTS idx_tickets_number ON support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_tickets_phone ON support_tickets(customer_phone);
CREATE INDEX IF NOT EXISTS idx_tickets_line ON support_tickets(line_user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_booking_code ON support_tickets(booking_code);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON support_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON support_ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON support_ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket ON support_ticket_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reads_staff ON support_ticket_reads(staff_username, ticket_id);
