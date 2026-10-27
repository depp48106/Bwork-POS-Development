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
| **Development Source** | `https://github.com/depp48106/Bwork-POS-Development.git` | `integration/home-office-20261021` | `7a2a384a326ff13aa0b25e1014e7a8360d5bfa7a` | Tested & Pushed (Non-force) |

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

## 4. CONCURRENCY SAFETY & REAL CLOUDFLARE D1 STAGING PROOF

The D1 Concurrency Suite is **VERIFIED ON REAL CLOUDFLARE D1 STAGING** (Not a mock):
- **Staging Database:** `bworkpos_staging_db` (`8511096e-3c57-428f-8b2c-98fdb297f705`) in Singapore (`SIN`).
- **Execution Mechanism:** Parameterized multi-statement REST queries directly against Cloudflare's production D1 engine.

### Verification of 10 Parallel Scenarios:
1. **Online vs Online:** 2 simultaneous requests -> Exactly 1 won (201), 1 rejected (409), 1 row in D1.
2. **POS vs Online:** Cross-channel race -> Exactly 1 won, 1 rejected with 409 conflict.
3. **POS Extend vs Online:** Room extension slot race -> Resolved safely, active items preserved.
4. **POS vs POS:** Two staff booking same room -> Exactly 1 won, 1 rejected with 409 conflict.
5. **Extension vs Reschedule:** Concurrency race -> Handled cleanly without collision.
6. **Cleaning Buffer (30m):** Boundary collision -> Rejected with 409 and buffer notice.
7. **Multi-Room Booking:** Partial failure atomic rollback -> Left 0 orphan rows in D1.
8. **5 Concurrent Requests Stress:** 5 simultaneous threads -> Exactly 1 won (201), 4 rejected (409).
9. **Stale Availability (TOCTOU):** Stale commit attempt -> Safely trapped with 409 conflict.
10. **Timeout / Retry Idempotency:** Balance replay -> Accepted first time (200), retry rejected (400), financial invariant `total = paid + balance` maintained, 0 duplicate transactions.

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
3. **Automated Verification:** Verified via [`scratch/test_support_404.js`](file:///C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101/scratch/test_support_404.js) that all support routes return 404.

---

## 6. BUILD & AUTOMATED TEST RESULTS

- **Automated Regression Suites:** **109 / 109 tests passed (100%)**
  - `realD1StagingValidation.cjs`: 11 / 11 PASS (Real Cloudflare APAC D1)
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
