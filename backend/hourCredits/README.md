# Hour credit: local backend phase 1

Migration: `../migrations/005_room_hour_credits.sql`. Applied by the existing
local migration runner on initialization. This change does not run that runner
against the application database. Tests apply it only to disposable SQLite files.
No Worker implementation, UI, voucher or LINE sender is included.

Routes require the existing staff authentication and `pos` permission (or admin).
Grant: POST `/api/hour-credits`, fields `source_booking_id`, `source_item_id`,
`minutes`, `reason`, `idempotency_key`.
Read/search: GET `/api/hour-credits/:creditId` or `?search=phone-or-credit-id`.
Redeem: POST `/:creditId/redeem`, fields `minutes`, `start_time`, `end_time`,
`reason`, `idempotency_key`. Times are Bangkok wall-clock, whole minutes.
Reversal: POST `/:creditId/reversals`, fields `entry_id` (redeem entry),
`reason`, `idempotency_key`.
Keys are global; the same staff/key/payload returns the original operation result,
even after a later reversal. Read detail separately for the current balance.
A different key attempting to reverse an already reversed entry receives 409.

Only paid positive-value hourly source bookings qualify. One credit per source
item, same room only, no services/room overrides/mixed payment. Input snapshots
are rejected. Source fields are never updated. Phone is a normalized search
snapshot, not proof of customer identity. LINE identity stays private on the
credit header; B does not opt into LINE notifications in this phase.

Each operation uses its own SQLite connection. BEGIN IMMEDIATE acquires the
database writer lock before balance and overlap checks. The connection is never
shared with ordinary queries. Busy errors return 503 for a same-key retry.
Existing receipt/PIN/overlap helpers accept this connection; default behavior
for ordinary callers is unchanged. Cancellation and reversal are atomic, only
before start, with no network events. Grant reversal is not part of Phase 1.

Generic credit-booking mutation routes are blocked, excluding the existing
explicit send-pin operation. Source hard deletion and clear-history are blocked.
Deletion triggers additionally protect references in bulk SQL operations.
Ledger mutation is prohibited by triggers, with a nonnegative-balance check and
exact reversal validation. Do not manually alter credit-booking SQL outside the service.

Reports remain unchanged: B contributes zero booking/item revenue, counts as a
paid booking and blocks the room normally. A retains its original duration and
revenue. No actual usage calculation is introduced.

Validation: `node --test backend/tests/hourCredits.test.js` and
`node --test backend/tests/*.test.js`. Tests never load database.js, server.js as
a module, environment files, or the live database. Current lower-level helpers
are evaluated directly from source against disposable DB fixtures.
