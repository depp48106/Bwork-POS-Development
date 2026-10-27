# BWORK-POS | CORRECTED RELEASE MANIFEST & PRODUCTION DRY-RUN PLAN

**Document Version:** 2.0.0-PROD-RC  
**Date:** 2026-10-27  
**Status:** AUDITED & VERIFIED (ZERO PRODUCTION WRITES EXECUTED)  
**Safety Gate:** STOP & REPORT COMPLETED

---

## 1. REVISION TRACKING & BASELINE VERIFICATION

| Component | Remote Repository | Branch | Commit SHA | Verified Status |
| :--- | :--- | :--- | :--- | :--- |
| **Production Baseline** | `https://github.com/depp48106/Bwork-POS.git` | `main` | `377c526fa7da4785d172212adb68d73c974eee02` | Audited Clean Baseline |
| **Development Source** | `https://github.com/depp48106/Bwork-POS-Development.git` | `integration/home-office-20261021` | `c88284ae866aa4ac512e0cdc496f7919b5d281fd` | Verified Remote HEAD on GitHub |

> [!NOTE]
> **Commit History Lineage on GitHub Remote:**
> - `c88284ae`: Staging credential security sanitization and Real Cloudflare Worker HTTP E2E validation suite (Remote HEAD).
> - `5da41cc8`: Manifest correction with verified file paths, real Cloudflare project names, and production audit data.
> - `7a2a384a`: Support Tickets 404 route hard-gate and auto-migration guard.
> - `773d22a7`: Real D1 APAC Singapore direct concurrency test suite.
> - `8e55b447`: Atomic conditional SQL guards against cross-channel booking races.

---

## 2. SOURCE INVENTORY & CORRECTED FILE PATHS

The initial manifest referenced generic component names. The audit verified the **actual file paths, imports, and dependencies**:

### A. Corrected File Paths (Resolving Manifest Discrepancies)

| Referenced Name in Old Manifest | Actual Verified Path | Container / Usage |
| :--- | :--- | :--- |
| `frontend/src/components/BookingDetailsModal.jsx` | [`frontend/src/components/BookingPOS.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/BookingPOS.jsx) | Implemented directly inside `BookingPOS.jsx` (Lines 6600–7200); styled by [`BookingDetailsModal.css`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/BookingDetailsModal.css). |
| `frontend/src/components/ExtendRoomModal.jsx` | [`frontend/src/components/RoomExtensionModal.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/RoomExtensionModal.jsx) | Standalone modal component; styled by [`RoomExtensionModal.css`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/RoomExtensionModal.css). |
| `booking-app/src/components/BookingSummary.jsx` | [`booking-app/src/pages/ConfirmPage.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/booking-app/src/pages/ConfirmPage.jsx) & [`BookingFormPage.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/booking-app/src/pages/BookingFormPage.jsx) | Pages handling booking submission, payment countdown ([`paymentCountdown.js`](file:///D:/Project%20BL/Bwork-POS-Development-Home/booking-app/src/utils/paymentCountdown.js)), and slip upload. |

### B. Feature-to-File Matrix & Dependency Trace

1. **CRM Customer Management & Contract Console:**
   - **Frontend:** [`CustomerManagement.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/CustomerManagement.jsx), [`CustomerManagement.css`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/CustomerManagement.css), [`BasecampQuotaModal.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/BasecampQuotaModal.jsx), [`CustomSelect.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/CustomSelect.jsx).
   - **Backend Routes:** `GET/POST /api/customers`, `PUT /api/customers/:id`, `GET/POST /api/customers/:id/contracts`, `PUT /api/contracts/:id`.
   - **D1 Schema Tables:** `customers`, `customer_contracts`, `customer_audit_logs`.
2. **POS Wide Landscape Booking Details:**
   - **Frontend:** [`BookingPOS.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/BookingPOS.jsx), [`BookingDetailsModal.css`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/BookingDetailsModal.css), [`AuthenticatedSlipImage.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/AuthenticatedSlipImage.jsx).
   - **Backend Routes:** `GET /api/bookings/:id` (enriched items, door PIN, multi-transaction timeline).
3. **Room Extension Workflow:**
   - **Frontend:** [`RoomExtensionModal.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/RoomExtensionModal.jsx), [`RoomExtensionModal.css`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/RoomExtensionModal.css).
   - **Backend Routes:** `POST /api/bookings/:id/extend` (same-room constraint, cleaning buffer bypass for extension, 30m buffer enforcement for subsequent queue).
4. **Payment Slip Review & Manual Staff Verification:**
   - **Frontend:** [`PendingBookings.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/PendingBookings.jsx), [`AuthenticatedSlipImage.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/AuthenticatedSlipImage.jsx), [`AttachSlipModal.jsx`](file:///D:/Project%20BL/Bwork-POS-Development-Home/frontend/src/components/AttachSlipModal.jsx).
   - **Backend Routes:** `GET /api/slips/secure/:path+`, `POST /api/bookings/:id/payments/:paymentId/slip`.
5. **Evidence ID / CAS Concurrency Guard:**
   - **Backend:** `POST /api/bookings/:id/pay-balance` (verifies `evidence_id` against latest `slip_verifications.id` to prevent reviewing stale slips).
6. **Cross-Channel Concurrency Guard (POS vs Online):**
   - **Backend:** `checkRoomOverlap()` and D1 Conditional SQL (`INSERT ... WHERE NOT EXISTS (...)`) in `POST /api/public/bookings` and `POST /api/bookings`.

---

## 3. PRODUCTION BASELINE AUDIT (ACTUAL CLOUDFLARE CONFIGURATION)

Audited via read-only Cloudflare REST API queries:

| Asset | Actual Name / UUID / ID | Status |
| :--- | :--- | :--- |
| **Worker API Name** | `bwork-pos-api` *(not bworkpos-worker)* | Active (v8b866f3a, 100% traffic) |
| **Worker Host** | `bwork-pos-api.ohnatza74185-ky.workers.dev` | Healthy |
| **Production D1 Database** | `bworkpos_db` (`0f171606-080b-4380-bf91-167dc678e2e4`) | APAC Singapore Master |
| **Production R2 Bucket** | `bwork-uploads` (Binding: `BUCKET`) | Attached to `bwork-pos-api` |
| **POS Pages Project** | `bwork-pos` (`bwork-pos.pages.dev`) | Active (Deployment: `98527622`) |
| **Booking App Pages Project** | `bwork-booking` (`bwork-booking.pages.dev`) | Active (Deployment: `8b913792`) |

### Production D1 Schema Audit
Direct schema inspection (`SELECT name FROM sqlite_master` & `PRAGMA table_info(bookings)`) confirmed:
- Tables `customers`, `customer_contracts`, `customer_audit_logs`, and `payment_transactions` **ALREADY EXIST** in Production D1.
- Columns `customer_id` and `contract_id` **ALREADY EXIST** in Production `bookings` table.
- Applied Migrations: `009`, `010`, `011_crm_customer_contracts.sql`, `013`, `014` were applied on 2026-10-24.
- Table `support_tickets` **DOES NOT EXIST** in Production D1.
- **Migration Decision:** **ZERO MIGRATIONS REQUIRED (0 SQL files to run)**. Rerunning Migration 011 would cause an error.

---

## 4. CONCURRENCY SAFETY & REAL CLOUDFLARE E2E PROOF

The concurrency protection and cross-channel safety mechanisms are **FULLY VERIFIED ON REAL CLOUDFLARE WORKER AND D1 STAGING** (Zero mocks):
- **Staging Worker Endpoint:** `https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev` (Active Deployment `e6ed5abd-f249-4d6d-a05b-09d7620fb780`)
- **Staging Database:** `bworkpos_staging_db` (`8511096e-3c57-428f-8b2c-98fdb297f705`) in Singapore (`SIN`).
- **Buffer Alignment:** `cleaning_buffer_minutes` aligned to `30` in Staging D1, matching Production D1.
- **Credential Security:** Token hardcoding eliminated; credentials resolve securely via `CLOUDFLARE_API_TOKEN` / `CF_TOKEN` or user home default wrangler config without token leakage in logs or git history.

### A. Real Worker HTTP E2E Validation (`realWorkerHttpE2E.cjs` - 11 Scenarios Over Real Network):
1. **Online Booking vs Online Booking:** Concurrent HTTP POST to `/api/public/bookings` -> Exactly 1 won (201), 1 rejected (409 Conflict), exactly 1 item created in D1.
2. **POS Booking vs Online Booking:** Cross-channel HTTP race (`/api/bookings` with Bearer auth vs `/api/public/bookings`) -> Exactly 1 won, 1 rejected with 409 conflict, zero double bookings.
3. **Room Extension vs Online Booking:** POS `/api/bookings/:id/extend` vs Online new booking -> Resolved cleanly without double-booking.
4. **Cleaning Buffer (30m):** Attempt inside buffer (11:15 after 10:00-11:00) -> Rejected with 409; attempt at boundary (11:30) -> Succeeded with 201.
5. **Booking Reschedule Collision:** POS `/api/bookings/:id/reschedule` into occupied slot -> Trapped with `ERR_ROOM_OVERLAP`, original booking untouched.
6. **Multi-Room Partial Failure:** Multi-item booking with 1 free + 1 occupied room -> Rejected with 409, atomic rollback leaves 0 items in both rooms.
7. **Zero Orphan Shells:** Verification on D1 after conflict -> Zero orphan parent booking shells exist in D1 Staging.
8. **Duplicate Payment Retry & Ledger Integrity:** Deposit booking balance payment (`/pay-balance`) -> Succeeded; replay retry rejected (400), invariant `total = paid + balance` (700 = 700 + 0) maintained, exactly 2 ledger transactions.
9. **Slip Review CAS Concurrency:** Outdated `evidence_id` on `/reject-slip` -> Rejected with 409 `SLIP_VERSION_CONFLICT`; subsequent review attempts on non-reviewing status trapped.
10. **Authentication & Authorization:** Unauthenticated (401), bogus token (401), valid staff token (200) strictly enforced.
11. **Support Tickets Gate:** `/api/public/support/tickets` and `/api/pos/support/tickets` all return HTTP 404 Not Found.

### B. Direct D1 Concurrency Engine Validation (`realD1StagingValidation.cjs` - 11 Scenarios):
- Direct APAC Singapore D1 multi-statement execution verifies SQLite-level atomic conditional guards (`INSERT INTO ... SELECT ... WHERE NOT EXISTS (...)`) under high concurrency.
- 5-thread stress race: 5 concurrent requests -> Exactly 1 winner, 4 rejected (409).
- TOCTOU stale check: Stale availability check followed by sneak-in commit -> Safely trapped by conditional SQL.

---

## 5. SUPPORT TICKETS EXCLUSION & HARD-BLOCK GATE

The unapproved Support Tickets feature is **strictly isolated**:
1. **Route Level Gate (`backend/worker.js` Line 2835):**
   ```javascript
   if (pathname.startsWith('/api/public/support') || pathname.startsWith('/api/pos/support')) {
     if (env.ENABLE_SUPPORT_TICKETS !== 'true') {
       return new Response(JSON.stringify({ error: 'Support tickets feature is disabled' }), { status: 404, headers: corsHeaders });
     }
   }
   ```
   All `/api/public/support/*` and `/api/pos/support/*` endpoints return **HTTP 404** by default.
2. **Schema Level Gate (`backend/worker.js` Line 2598):**
   `ensureD1Schema()` wraps all `CREATE TABLE IF NOT EXISTS support_tickets` in `if (env.ENABLE_SUPPORT_TICKETS === 'true')`, preventing table creation on Production D1.
3. **Automated Verification:** Verified via real HTTP tests that all support routes return 404.

---

## 6. BUILD & AUTOMATED TEST RESULTS

- **Automated Regression Suites:** **120 / 120 tests passed (100%)**
  - `realWorkerHttpE2E.cjs`: 11 / 11 PASS (12/12 assertions over HTTPS network to Cloudflare Worker Staging)
  - `realD1StagingValidation.cjs`: 11 / 11 PASS (Real Cloudflare APAC D1 engine)
  - `stagingLineHardBlock.test.cjs`: 10 / 10 PASS
  - `crossChannelConcurrency.test.cjs`: 6 / 6 PASS
  - `depositBalanceWorkflow.test.cjs`: 20 / 20 PASS
  - `roomExtensionWorkflow.test.cjs`: 16 / 16 PASS
  - `workerBookingAuth.test.js`: 16 / 16 PASS
  - `workerHourCredits.test.js`: 26 / 26 PASS
  - `test_support_404.js`: 4 / 4 PASS
- **Frontend POS Build:** `npm --prefix frontend run build` -> Built in 3.69s (0 errors).
- **Booking App Build:** `npm --prefix booking-app run build` -> Built in 246ms (0 errors).

---

## 7. 10-STEP PRODUCTION DEPLOYMENT DRY-RUN SEQUENCE

> [!CAUTION]
> This is a planned dry-run procedure. **DO NOT EXECUTE UNTIL EXPLICITLY AUTHORIZED.**

### Step 1: Pre-Deployment Backup
- Export snapshot of Production D1:
  ```bash
  npx wrangler d1 export bworkpos_db --remote --output backup_pre_release_$(date +%Y%m%d%H%M%S).sql
  ```
- Record active Worker deployment ID: `5732a59c-ce6e-4aa0-885b-6d09d4a012f7` (Version `8b866f3a`).
- Record active Pages deployment IDs: `bwork-pos` (`98527622`), `bwork-booking` (`8b913792`).

### Step 2: D1 Schema Compatibility Check
- Confirm zero schema migrations are needed (verified already applied).
- Do not run any SQL migration script against Production D1.

### Step 3: Cloudflare Worker Deployment
- From `backend/` directory in Production workspace:
  ```bash
  npx wrangler deploy --config wrangler.toml
  ```
- Target: Worker `bwork-pos-api` (Binding `DB` -> `0f171606`, Binding `BUCKET` -> `bwork-uploads`).

### Step 4: POS Frontend Pages Deployment
- Build and deploy POS Frontend:
  ```bash
  npm --prefix frontend run build
  npx wrangler pages deploy frontend/dist --project-name bwork-pos
  ```

### Step 5: Booking App Pages Deployment
- Build and deploy Booking App:
  ```bash
  npm --prefix booking-app run build
  npx wrangler pages deploy booking-app/dist --project-name bwork-booking
  ```

### Step 6: Authentication & Financial Smoke Tests
- Run [`scripts/production_post_deploy_smoke.cjs`](file:///D:/Project%20BL/Bwork-POS-Development-Home/scripts/production_post_deploy_smoke.cjs) against production URLs:
  - Confirm `https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/rooms` returns 200 with no exposed passwords.
  - Confirm `https://bwork-pos.pages.dev` loads root element.
  - Confirm `https://bwork-booking.pages.dev` loads root element.

### Step 7: Concurrent Booking Verification
- Perform a live walk-in booking test: 50% deposit, verify receipt and door PIN.
- Perform balance payment with slip attachment: verify status changes to `paid` with ฿0 balance.

### Step 8: Support Tickets 404 Check
- Query `https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/public/support/tickets` -> Must return **404**.
- Query `https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/pos/support/tickets` -> Must return **404**.

### Step 9: Rollback Procedure (Real Project Identifiers)
- **Worker Rollback:**
  ```bash
  npx wrangler rollback --name bwork-pos-api 5732a59c-ce6e-4aa0-885b-6d09d4a012f7
  ```
- **POS Pages Rollback:**
  ```bash
  npx wrangler pages deployment rollback 98527622-4d12-4ba1-9ab1-08540c66985f --project-name bwork-pos
  ```
- **Booking App Pages Rollback:**
  ```bash
  npx wrangler pages deployment rollback 8b913792-57d7-4b95-8c0f-ab068ae18d58 --project-name bwork-booking
  ```
> [!WARNING]
> **Data Consistency Notice:** Rolling back Worker/Pages code **DOES NOT** revert or erase records written to D1 database during production execution. Any financial ledger entries created during a faulty release must be reconciled manually via compensating transactions.

### Step 10: Monitoring & Stop Conditions
- Monitor Cloudflare Worker Analytics for error spikes (`5xx` > 0.5%).
- If any uncaught 500 or double-booking occurs, immediately trigger Step 9 rollback and stop.

---

## 8. PRODUCTION GO / NO-GO EVALUATION

| Criterion | Evaluation Standard | Audit Result | Verdict |
| :--- | :--- | :--- | :---: |
| **Source Integrity** | All file paths and imports verified in repository | Verified (BookingPOS, RoomExtensionModal, ConfirmPage) | **PASS** |
| **Production Parity** | Real Cloudflare names verified via API | `bwork-pos-api`, `bwork-pos`, `bwork-booking` verified | **PASS** |
| **D1 Schema Parity** | Production D1 tables and columns inspected | Migration 011 already applied; 0 migrations needed | **PASS** |
| **Concurrency Gate** | Real Cloudflare D1 Staging 10 scenarios passed | 100% pass on APAC Singapore D1 | **PASS** |
| **Financial Integrity** | `total = paid + balance` and zero duplicate payments | Verified with idempotent balance payment retry | **PASS** |
| **Feature Isolation** | Support Tickets routes hard-blocked | Verified all support routes return 404 | **PASS** |
| **Production Safety** | Zero writes to Production D1/R2 during testing | Zero writes executed | **PASS** |

**FINAL RECOMMENDATION:** **GO FOR SELECTIVE PRODUCTION DEPLOYMENT** (Awaiting user authorization to proceed).
