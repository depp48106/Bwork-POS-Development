
-- Create roles table if missing
CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, label TEXT NOT NULL, permissions TEXT NOT NULL, is_system INTEGER DEFAULT 0);
INSERT OR IGNORE INTO roles (id, name, label, permissions, is_system) VALUES (1, 'admin', 'ผู้ดูแลระบบ (Admin)', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 1);
INSERT OR IGNORE INTO roles (id, name, label, permissions, is_system) VALUES (2, 'staff', 'พนักงานต้อนรับ (Reception)', 'pos,pending,layout,history,quotations', 1);

-- Ensure users table exists with columns
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT DEFAULT 'staff', permissions TEXT, fullname TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO users (id, username, password_hash, role, permissions, fullname) VALUES (1, 'admin', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918', 'admin', 'pos,dashboard,pending,layout,manage,history,quotations,admin-users,admin-system,admin-backup,admin-quotation', 'ผู้ดูแลระบบหลัก');
INSERT OR IGNORE INTO users (id, username, password_hash, role, permissions, fullname) VALUES (2, 'staff', '1b4f0e9851971998e732078544c96b36c3d01cedf7caa332359d6f1d83567014', 'staff', 'pos,pending,layout,history,quotations', 'พนักงานต้อนรับประจำกะ');

-- Index
CREATE INDEX IF NOT EXISTS idx_booking_items_room_time ON booking_items(room_id, start_time, end_time);
