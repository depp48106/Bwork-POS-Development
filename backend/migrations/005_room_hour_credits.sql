CREATE TABLE room_hour_credits (
  credit_id TEXT PRIMARY KEY NOT NULL,
  source_booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  source_item_id INTEGER NOT NULL UNIQUE REFERENCES booking_items(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  line_user_id TEXT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX room_hour_credit_phone ON room_hour_credits(customer_phone);
CREATE TABLE room_hour_credit_entries (
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
CREATE UNIQUE INDEX room_hour_credit_grant ON room_hour_credit_entries(credit_id) WHERE entry_type='grant';
CREATE UNIQUE INDEX room_hour_credit_redeem_item ON room_hour_credit_entries(booking_item_id) WHERE entry_type='redeem';
CREATE INDEX room_hour_credit_history ON room_hour_credit_entries(credit_id,id);
CREATE TRIGGER hour_credit_no_negative BEFORE INSERT ON room_hour_credit_entries
WHEN COALESCE((SELECT SUM(minutes_delta) FROM room_hour_credit_entries WHERE credit_id=NEW.credit_id),0)+NEW.minutes_delta<0
BEGIN SELECT RAISE(ABORT,'hour credit insufficient balance'); END;
CREATE TRIGGER hour_credit_valid_reversal BEFORE INSERT ON room_hour_credit_entries
WHEN NEW.entry_type='reversal' AND NOT EXISTS (
 SELECT 1 FROM room_hour_credit_entries e WHERE e.id=NEW.reverses_entry_id AND e.entry_type='redeem'
 AND e.credit_id=NEW.credit_id AND e.booking_item_id=NEW.booking_item_id AND e.minutes_delta=-NEW.minutes_delta)
BEGIN SELECT RAISE(ABORT,'invalid hour credit reversal'); END;
CREATE TRIGGER hour_credit_entries_no_update BEFORE UPDATE ON room_hour_credit_entries
BEGIN SELECT RAISE(ABORT,'hour credit ledger is append only'); END;
CREATE TRIGGER hour_credit_entries_no_delete BEFORE DELETE ON room_hour_credit_entries
BEGIN SELECT RAISE(ABORT,'hour credit ledger is append only'); END;
CREATE TRIGGER hour_credit_no_update BEFORE UPDATE ON room_hour_credits
BEGIN SELECT RAISE(ABORT,'hour credit identity is immutable'); END;
CREATE TRIGGER hour_credit_no_delete BEFORE DELETE ON room_hour_credits
BEGIN SELECT RAISE(ABORT,'hour credit history is permanent'); END;
-- Protect even callers that do not enable foreign_keys; abort whole bulk-delete statements.
CREATE TRIGGER hour_credit_booking_no_delete BEFORE DELETE ON bookings
WHEN EXISTS(SELECT 1 FROM room_hour_credits WHERE source_booking_id=OLD.id)
 OR EXISTS(SELECT 1 FROM room_hour_credit_entries e JOIN booking_items i ON i.id=e.booking_item_id WHERE i.booking_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'booking linked to hour credit cannot be deleted'); END;
CREATE TRIGGER hour_credit_item_no_delete BEFORE DELETE ON booking_items
WHEN EXISTS(SELECT 1 FROM room_hour_credits WHERE source_item_id=OLD.id)
 OR EXISTS(SELECT 1 FROM room_hour_credit_entries WHERE booking_item_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'item linked to hour credit cannot be deleted'); END;
