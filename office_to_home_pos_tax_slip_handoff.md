# BWORK-POS | OFFICE TO HOME HANDOFF REPORT
## POS Payment Slip & Tax Invoice Management UX Restructuring

> **Document Version:** 1.0.0
> **Date:** 2026-10-22
> **Source Environment:** Office Workstation (`D:\Project BL\Bwork-POS-Development`)
> **Target Environment:** Home Workstation
> **Target Branch:** `integration/home-office-20261021`
> **Remote Repository:** `https://github.com/depp48106/Bwork-POS-Development.git`
> **Feature Commit SHA:** `dd7d2d245b99e99d4fd1e880925a0926cf8c6825`

---

## 1. Git Synchronization Summary

| Parameter | Value |
|---|---|
| **Repository** | `https://github.com/depp48106/Bwork-POS-Development.git` |
| **Branch** | `integration/home-office-20261021` |
| **Previous Remote Baseline** | `b58807bf9c19073f4d137366b2ca2890575c51c3` |
| **Feature Commit SHA** | `dd7d2d245b99e99d4fd1e880925a0926cf8c6825` |
| **Feature Commit Message** | `refactor(pos): streamline slip and tax invoice management UX` |
| **Push Mode** | Fast-forward only (NO FORCE PUSH) |
| **Remote Verification** | Local HEAD == Remote `origin/integration/home-office-20261021` |

### Exact Files Committed (Feature):
1. `frontend/src/components/History.jsx` (+119, -31 lines)
2. `frontend/src/components/POSTaxAndSlipSection.jsx` (+2, -2 lines)
3. `frontend/src/components/PendingBookings.jsx` (+91, -21 lines)
4. `frontend/src/components/TaxInvoiceManagementModal.jsx` (+224, -65 lines)

---

## 2. Completed Features & UX Architecture

### A. POS Checkout Workflow (`BookingPOS.jsx` & `POSTaxAndSlipSection.jsx`)
- **Linear 5-Step Order:** 1. Payment summary → 2. Payment method → 3. Slip evidence (`POSTaxAndSlipSection`) → 4. Tax invoice request checkbox (`"ลูกค้าต้องการใบกำกับภาษี"`) → 5. Confirm booking button.
- **Slip Dropzone & Upload:**
  - Displays immediately when payment method is `transfer` or `promptpay`.
  - Button label standardized to **"แนบสลิป"** (`#pos-btn-select-slip`).
  - Supports JPG, PNG, WEBP with client-side magic bytes file signature detection (<10MB).
  - Preview thumbnail with **"เปลี่ยนรูป"** and **"ลบสลิป"** actions.
  - Cash payment (`cash`) does NOT enforce slip attachment.
  - **Decoupled Financial State:** Attaching a slip does NOT automatically mark a booking as `paid`.
- **Tax Invoice Form:**
  - Checkbox labeled **"ลูกค้าต้องการใบกำกับภาษี"** expands the ภ.พ.20 form.
  - Supports Individual / Corporate, Head Office / Branch, Address, Email (e-Tax), Postal, Pickup.
  - Does NOT mandate file attachments at checkout (walk-in payments only request tax info; invoices are issued afterwards).
  - Isolated state between Quick Booking drawer and Cart Checkout drawer.

### B. Booking Management Workflow (`PendingBookings.jsx` & `viewedEvent`)
- **Section A (Payment Info & Transactions):**
  - Displays total, paid amount, balance, and last payment method.
  - Lists individual transactions from `payment_transactions` with **"ดูสลิป"** or **"แนบสลิป"** per round.
  - Attaching a missing slip links directly to the existing transaction record without creating duplicate ledger entries.
- **Section B (Tax Invoice Information & Documents):**
  - **Always Visible:** Displayed in the detail modal whether tax invoice was requested initially or not.
  - Status badge: `ยังไม่ขอ` / `ขอใบกำกับภาษี` / `ออกเอกสารแล้ว`.
  - Primary button: **"จัดการใบกำกับภาษี"** (`#pb-btn-manage-tax-invoice`) opens `TaxInvoiceManagementModal`.
  - When not requested: shows friendly prompt with a button to add tax information on demand.

### C. History Workflow (`History.jsx`)
- **Dedicated Tax Invoice Card:**
  - Rendered on the left column of the History Detail view.
  - Shows document status, taxpayer name, 13-digit tax ID, branch, and address.
  - Primary button: **"จัดการใบกำกับภาษี"** (`#history-btn-manage-tax-invoice`) opens `TaxInvoiceManagementModal`.
- **Cleanups:**
  - Removed duplicate button in footer action bar.
  - Removed emoji characters (`⚠️`, `📱`, `🏪`, `📅`, `⏰`).

### D. Tax Invoice Management Modal (`TaxInvoiceManagementModal.jsx`)
- **2-Column Desktop Layout:**
  - `min(1080px, 94vw)` width, `maxHeight: 90dvh`, fixed header, scrollable body (`#tax-modal-scroll-body`), sticky footer.
  - Left column: Taxpayer info (View Mode & Edit Mode with 13-digit validation).
  - Right column: Issued tax invoice documents list (`"ดูเอกสาร"` link) + upload area with button **"แนบใบกำกับภาษีที่ออกแล้ว"** (`#btn-submit-upload-tax-doc`).
- **Enforced Save Button Rule:**
  - Redundant top save button (`#btn-save-tax-info-top`) and bottom form save button (`#btn-save-tax-info-bottom`) removed from Section A.
  - Single primary save action resides exclusively in the sticky footer: `#btn-save-tax-info-footer` with label **"บันทึกข้อมูล"**.
- **Unsaved Changes Protection Guard:**
  - `initialTaxFormRef` tracks form values upon entering edit mode.
  - `isTaxFormDirty()` compares all form fields.
  - `handleSafeClose(action)` intercepts modal backdrop clicks, top-right `X` button, cancel buttons, and bottom close button.
  - Warns staff before discarding edits: *"คุณมีข้อมูลใบกำกับภาษีที่ยังไม่ได้บันทึก ต้องการปิดโดยไม่บันทึกหรือไม่?"*
- **Mobile Responsive Stack:**
  - Collapses smoothly into a single-column stack on 390px viewports.

---

## 3. Test Verification Results

All automated suites executed on `D:\Project BL\Bwork-POS-Development`:

| Test Suite | Scope | Result | Status |
|---|---|:---:|:---:|
| `posPaymentSlipAndTaxInvoice.test.cjs` | Migration 013, Magic Bytes, Ledger Safety, Tax API | 9 / 9 | **PASS** |
| `paymentSlipWorkflow.test.cjs` | Rejection, Idempotency, Multi-tx Isolation, Slip Security | 32 / 32 | **PASS** |
| `customerContractEditAndAudit.test.cjs` | Customer contract dates, quota integrity, audit logging | 19 / 19 | **PASS** |
| `test_complete_walkin_payment_and_tax_ux_uat.js` | 12 Walk-in E2E scenarios via Chrome CDP | 12 / 12 | **PASS** |
| `test_pos_payment_slip_and_tax_ux_restructuring.js` | 7 Comprehensive UX/UI restructuring checks & screenshots | 7 / 7 | **PASS** |
| `npm run build` | Vite 5.4.21 production build | 0 errors | **PASS** |
| `git diff --check` | Whitespace and merge conflict markers check | 0 errors | **PASS** |

---

## 4. Known Issues & Operational Considerations

1. **Local File Storage vs Cloudflare R2:**
   - In the local Express development environment, files are stored in `backend/public/uploads/slips/` and `backend/public/uploads/tax-invoices/`.
   - In Cloudflare Workers (`backend/src/worker.js`), files > 700KB are uploaded to Cloudflare R2 bucket (`bwork-slips`), while the database stores the public URL.
   - Ensure R2 credentials and bucket bindings (`SLIP_BUCKET`) are configured if testing against Cloudflare Staging.
2. **Database Migration 013 Parity:**
   - SQLite migration `013_add_payment_slip_and_tax_invoice.sql` adds columns to `bookings` (`tax_invoice_required`, `tax_payer_type`, `tax_name`, `tax_id`, `tax_branch_type`, `tax_branch_number`, `tax_address`, `tax_email`, `tax_phone`, `tax_delivery_method`, `tax_postal_address`, `tax_invoice_status`) and creates the `tax_invoices` table.
   - For local development, this runs automatically on server start.
   - For Cloudflare D1 Staging/Production, verify D1 migration execution before deploying:
     `wrangler d1 migrations apply bwork-db --local` / `--remote`.
3. **Browser Modal Scrollbar Visibility:**
   - The scroll body uses `overflowY: 'auto'` and `WebkitOverflowScrolling: 'touch'`. On macOS/iOS devices, scrollbars are hidden by default until scrolling.

---

## 5. Home Workstation Setup Instructions

Follow these exact steps when resuming work on the home machine:

### Step 1: Preflight Check on Home Machine
```bash
cd "D:\Project BL\Bwork-POS-Development"  # หรือ path workspace บนเครื่องบ้าน
git status --short
git branch --show-current
git remote -v
```
> [!CAUTION]
> หากบนเครื่องบ้านมี Uncommitted Changes อยู่ **ห้ามรัน `git reset --hard` หรือ `git checkout -f`**
> ให้ตรวจสอบและแยก commit หรือ stash ไว้ก่อนเสมอ

### Step 2: Fetch and Switch to Integration Branch
```bash
git fetch origin
git switch integration/home-office-20261021
git pull --ff-only origin integration/home-office-20261021
```

### Step 3: Verify HEAD Commit SHA
```bash
git rev-parse HEAD
# ต้องแสดงผล SHA เดียวกับ Feature Commit หรือ Handoff Commit
git log -3 --oneline
```

### Step 4: Start Dev Servers & Run Regression
```bash
npm run dev:all
# ใน terminal แยก:
node backend/tests/posPaymentSlipAndTaxInvoice.test.cjs
node backend/tests/paymentSlipWorkflow.test.cjs
```

---

## 6. Prompt สำหรับเริ่มงานต่อที่เครื่องบ้าน (Resume Prompt)

คัดลอกข้อความด้านล่างนี้ส่งให้ Antigravity บนเครื่องที่บ้านเพื่อเริ่มงานต่อได้ทันที:

```text
# BWORK-POS | RESUME DEVELOPMENT AT HOME WORKSTATION

สวัสดีครับ เริ่มงานต่อจากเครื่องออฟฟิศ:
1. Workspace: D:\Project BL\Bwork-POS-Development (หรือ path บนเครื่องนี้)
2. ตรวจสอบ git status, git branch, และ git remote -v
3. ดึงงานล่าสุด:
   git fetch origin
   git switch integration/home-office-20261021
   git pull --ff-only origin integration/home-office-20261021
4. ตรวจสอบว่า HEAD commit ตรงกับ origin/integration/home-office-20261021
5. อ่านไฟล์รายงาน: office_to_home_pos_tax_slip_handoff.md
6. รัน npm run dev:all และรันชุดทดสอบ backend/tests/posPaymentSlipAndTaxInvoice.test.cjs
7. ตรวจสอบสถานะและรายงานความพร้อมก่อนเริ่มงานขั้นต่อไป
```
