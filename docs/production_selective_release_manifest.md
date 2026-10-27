# BWORK-POS | SELECTIVE PRODUCTION RELEASE CANDIDATE MANIFEST

**Document Version:** 1.0.0-RC  
**Date:** 2026-10-27  
**Target Environment:** Cloudflare Workers + Cloudflare D1 + Cloudflare R2  
**Safety Status:** PRE-RELEASE AUDIT COMPLETE (ZERO PRODUCTION WRITES EXECUTED)

---

## 1. BASELINE & SOURCE REVISION TRACKING

| Repository | Path / Remote | Branch | Verified SHA | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Production Repo** | `https://github.com/depp48106/Bwork-POS.git` | `main` | `377c526fa7da4785d172212adb68d73c974eee02` | Last Verified Production Baseline |
| **Development Repo** | `https://github.com/depp48106/Bwork-POS-Development.git` | `integration/home-office-20261021` | `8e55b447d323760c53080182de4a47a9d3d223b7` | Concurrency & Real D1 Staging Gate |

---

## 2. INCLUDED FILES & CHERRY-PICK SCOPE

The following files contain the validated features ready for selective production integration:

### A. Backend Core & Cloudflare Worker Runtime
- `backend/worker.js`:
  - **D1 Atomic Conditional SQL Concurrency Guard:** `checkRoomOverlap`, `POST /api/public/bookings`, and `POST /api/bookings` with conditional `INSERT ... WHERE NOT EXISTS (...)` preventing cross-channel race conditions.
  - **Atomic Cleanup on Collision:** Immediate removal of dangling booking shells (`DELETE FROM bookings WHERE id = ?`) when room item insertion is rejected, guaranteeing zero orphan rows.
  - **Room Extension Engine:** `POST /api/bookings/:id/extend` supporting same-room constraint, cleaning buffer bypass between consecutive slots, and 30-min buffer enforcement for subsequent bookings.
  - **Deposit & Balance Workflow:** `POST /api/bookings/:id/pay-balance` with optimistic CAS concurrency guard, financial invariant maintenance (`total_amount = paid_amount + balance_amount`), and multi-transaction history.
  - **Payment Slip Timeline:** Dedicated slip preservation for deposit vs balance vs extension.
- `backend/server.js`: Express parity endpoints matching Worker logic for local development.
- `backend/database.js`: Query helpers, transaction boundaries, and SQLite fallback logic.
- `backend/schema.sql`: Authoritative schema reference.

### B. Frontend POS & Booking App UI
- `frontend/src/components/BookingDetailsModal.jsx`: Responsive wide landscape modal for desktop and tablet POS.
- `frontend/src/components/ExtendRoomModal.jsx`: Modal for extending active bookings with real-time pricing and slip attachment.
- `frontend/src/components/Dashboard.jsx`: Staff handover banner, financial summary card, and balance payment shortcuts.
- `frontend/src/components/PendingBookings.jsx`: Staff manual payment review, replacing client-side auto verification.
- `booking-app/src/components/BookingSummary.jsx`: Online booking payment window (15-min countdown) and slip upload to staff review queue.

---

## 3. EXCLUDED FILES & FEATURES (STRICT PROHIBITION)

The following components **MUST NOT** be included in the production release:

| Component / Path | Reason for Exclusion |
| :--- | :--- |
| `/api/public/support/*` & `/api/pos/support/*` | Support Tickets feature remains in development; disabled on production. |
| `frontend/src/components/SupportTickets.jsx` | Unreleased feature; must remain unrouted. |
| `backend/migrations/012_add_support_tickets.sql` | Unreleased schema table; do not execute on production D1. |
| `backend/tests/realD1StagingValidation.cjs` | Staging validation test suite; contains staging OAuth/D1 IDs. |
| `backend/tests/stagingLineHardBlock.test.cjs` | Staging LINE OA simulation test suite. |
| `backend/wrangler.staging.toml` | Staging worker configuration. |
| `backend/staging_fixtures.sql` | Staging mock seed data. |
| `booking-app/.env.staging` & `frontend/.env.staging` | Staging environment files. |

---

## 4. DATABASE SCHEMA DIFF & REQUIRED MIGRATIONS

### Applied Schema Validations
1. **Migration 008 (`008_add_discount_and_deposit.sql`):**
   - Adds `subtotal_amount`, `discount_type`, `discount_value`, `discount_amount`, `paid_amount`, `balance_amount` to `bookings`.
   - Creates `payment_transactions` table for multi-slip tracking.
2. **Migration 011 (`011_add_customers_and_contracts.sql`):**
   - Adds `customer_id INTEGER` and `contract_id INTEGER` to `bookings` table.
   - Creates `customers`, `customer_contracts`, and `customer_audit_logs`.

### Safety Verification
- All new columns are `NULL` or provide safe `DEFAULT` values.
- Existing production rows remain completely unaffected.
- No `DROP TABLE`, `DROP COLUMN`, or table rewriting required.

---

## 5. ENVIRONMENT ISOLATION & SECRETS MANAGEMENT

| Setting | Production (`wrangler.toml`) | Staging (`wrangler.staging.toml`) |
| :--- | :--- | :--- |
| **Worker Name** | `bworkpos-worker` | `bworkpos-worker-staging` |
| **D1 Database Name** | `bworkpos_db` | `bworkpos_staging_db` |
| **D1 Database UUID** | `0f171606-080b-4380-bf91-167dc678e2e4` | `8511096e-3c57-428f-8b2c-98fdb297f705` |
| **R2 Bucket Name** | `bwork-uploads` | None (Isolated) |
| **LINE Dispatch** | Active Live Push | Hard-Blocked (`DISABLE_LIVE_LINE=true`) |
| **Compatibility Date**| `2024-04-05` | `2024-04-05` |

---

## 6. ROLLBACK PROCEDURE

### A. Worker API Rollback
1. Execute Wrangler instant deployment rollback:
   ```bash
   wrangler rollback --name bworkpos-worker
   ```
2. Or redeploy from the last verified production SHA (`377c526fa7da4785d172212adb68d73c974eee02`):
   ```bash
   git checkout 377c526fa7da4785d172212adb68d73c974eee02
   npm --prefix backend run deploy
   ```

### B. Frontend UI Rollback
1. Checkout production commit `377c526fa7da4785d172212adb68d73c974eee02` in `D:\Project BL\Bwork-POS`.
2. Rebuild and deploy:
   ```bash
   npm --prefix frontend run build
   # Deploy via Cloudflare Pages or backend/public deployment
   ```

### C. Database Rollback
- The added columns (`customer_id`, `contract_id`) are additive and backward-compatible.
- Previous Worker version completely ignores these columns; no database rollback required.

---

## 7. POST-DEPLOYMENT SMOKE TEST PLAN (LIVE PRODUCTION)

1. **POS Health & Authentication:**
   - Log into POS console with admin credentials.
   - Confirm Dashboard displays the active shift and room status grid.
2. **Walk-In Deposit Booking:**
   - Create a 2-hour walk-in booking with 50% deposit (e.g., ฿700 total, ฿350 deposit).
   - Verify financial summary displays: Total ฿700, Paid ฿350, Balance ฿350.
   - Confirm receipt generation and door PIN assignment.
3. **One-Click Balance Payment:**
   - Select the deposit booking from the POS list.
   - Click "รับชำระส่วนที่เหลือ" (Pay Balance) for ฿350.
   - Attach payment slip and submit.
   - Confirm status transitions to `paid` with ฿0 balance.
   - Confirm timeline displays 2 distinct payment transactions (Deposit + Balance).
4. **Room Extension:**
   - On an active booking, click "ขยายเวลาห้อง" (Extend Room) for +1 hour.
   - Confirm same room is locked and cleaning buffer is waived between the consecutive slots.
   - Verify payment ledger records the extension transaction.
5. **Cross-Channel Availability & Buffer Sync:**
   - Open Booking App on mobile/browser.
   - Verify extended room displays as occupied for the extended window + 30-min cleaning buffer.
   - Attempt to book an overlapping time slot from Booking App; verify clean HTTP 409 conflict message.
6. **Support Ticket Route Verification:**
   - Query `GET /api/public/support/tickets` and `GET /api/pos/support/tickets`.
   - Confirm both return HTTP 404 (Route not found / Feature disabled).
