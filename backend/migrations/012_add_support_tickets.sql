-- Migration 012: Add Customer Issue Tickets & Support System
-- BWORK-SUPPORT-TICKETS-V1

-- 1. Create support_tickets table
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

-- 2. Create support_ticket_messages table
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

-- 3. Create support_ticket_attachments table
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

-- 4. Create support_ticket_events table (audit trail)
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

-- 5. Create support_ticket_reads table (tracks staff read timestamps)
CREATE TABLE IF NOT EXISTS support_ticket_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  staff_username TEXT NOT NULL,
  last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(ticket_id, staff_username)
);

-- 6. Performance & Lookup Indexes
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

-- 7. Ensure other_category column exists if table was pre-created
ALTER TABLE support_tickets ADD COLUMN other_category TEXT;
