
-- Create roles table if missing
CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, label TEXT NOT NULL, permissions TEXT NOT NULL, is_system INTEGER DEFAULT 0);
INSERT OR IGNORE INTO roles (id, name, label, permissions, is_system) VALUES (1, 'admin', 'ผู้ดูแลระบบ (Admin)', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 1);
INSERT OR IGNORE INTO roles (id, name, label, permissions, is_system) VALUES (2, 'staff', 'พนักงานต้อนรับ (Reception)', 'pos,pending,layout,history,quotations', 1);

-- Ensure users table exists with columns
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff', permissions TEXT, fullname TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO users (id, username, password_hash, role, permissions, fullname) VALUES (1, 'admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 'ผู้ดูแลระบบหลัก');
INSERT OR IGNORE INTO users (id, username, password_hash, role, permissions, fullname) VALUES (2, 'staff', '1b4f0e9851971998e732078544c96b36c3d01cedf7caa332359d6f1d83567014', 'staff', 'pos,pending,layout,history,quotations', 'พนักงานต้อนรับประจำกะ');

-- Create quotations tables if missing
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT
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

-- Indexes for High-Speed Queries
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
