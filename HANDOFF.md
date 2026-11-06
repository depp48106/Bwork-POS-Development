# BWORK-POS | DEVELOPMENT HANDOFF REPORT

> **Document Version:** 1.6.0  
> **Date:** 5 พฤศจิกายน 2026  
> **Workspace:** Development (`D:\Project BL\Bwork-POS-Development`)  
> **Branch:** `integration/home-office-20261021`  
> **Remote Repository:** `https://github.com/depp48106/Bwork-POS-Development.git`  
> **Status:** **UI LIVE DISPATCH & CONFIRMATION MODAL PREPARED / SELECTIVE PATCH STAGED (NOT DEPLOYED / SWITCHES STRICTLY FALSE)**  

---

## 1. ข้อมูลผู้ส่งและระบบส่งใบกำกับภาษีทางอีเมล (Official Sender & Gmail API Integration)

- **ข้อมูลผู้ส่งทางการ (Official Sender Identity):**
  - **ชื่อผู้ส่ง (Sender Name):** `บริษัท บิลท์ ฮาร์ท จำกัด` (เข้ารหัส MIME RFC 2047 `=?UTF-8?B?...?=` ถูกต้องตามมาตรฐานอีเมลสากล)
  - **อีเมลผู้ส่ง (Sender Email):** `coworkings.bwork@gmail.com`
  - **อีเมลตอบกลับ (Reply-To):** `coworkings.bwork@gmail.com`
- **ขอบเขตสิทธิ์ความปลอดภัยขั้นต่ำ (Principle of Least Privilege):**
  - กำหนด Scope เฉพาะ `https://www.googleapis.com/auth/gmail.send` เท่านั้น
  - ไม่อนุญาต Scope อ่านกล่องจดหมายหรือจัดการบัญชี
- **การจัดเก็บข้อมูลความลับ (Strict Credentials Boundary):**
  - จัดเก็บผ่าน Environment Variables (`backend/.env` สำหรับ Express) และ Cloudflare Worker Secrets (`wrangler secret put` สำหรับ Worker)
  - **ไม่มีการ commit credentials, client secret หรือ refresh token ลงใน Git, Frontend, Logs หรือรายงานโดยเด็ดขาด**
  - ไฟล์ `backend/.env.example` บันทึกเฉพาะชื่อคีย์และคำอธิบายโดยไม่มีค่าความลับจริง

---

## 2. กลไกความปลอดภัยและระบบป้องกันข้อผิดพลาด (Safety Gates & Resilience)

1. **สวิตช์ความปลอดภัยหลัก (Master Safety Switch):**
   - `GMAIL_LIVE_DISPATCH_ENABLED` มีค่าเริ่มต้นเป็น `false` โดยเด็ดขาด
   - **แม้ระบบจะได้รับการกำหนดค่า credentials ครบถ้วนแล้ว ระบบก็จะไม่ส่งอีเมลจริงโดยพลการ** จนกว่าจะเปิดสวิตช์นี้อย่างตั้งใจ
   - หากสวิตช์ปิดอยู่แล้วมีการเรียกส่งจริง ระบบจะ Reject ด้วย Error ชัดเจนและ fallback เป็นโหมดจำลองส่ง (Dry-run)
2. **ระบบคัดกรองอีเมลบน Staging (Staging Recipient Allowlist):**
   - บนสภาพแวดล้อมที่ไม่ใช่ Production (`APP_ENV != 'production'`) ระบบจะตรวจสอบกับ `GMAIL_STAGING_ALLOWLIST`
   - หากอีเมลไม่อยู่ใน Allowlist (เช่น `admin@bwork.co`, `@bwork.co`) ระบบจะปฏิเสธการส่งจริงทันที ป้องกันอีเมลทดสอบหลุดไปยังลูกค้าจริง
3. **การล็อกคำขอส่งแบบอะตอมมิก (Durable Idempotency & Concurrency Lock):**
   - ใช้คำสั่ง SQL Atomic Claim:
     ```sql
     UPDATE tax_invoices 
     SET email_status = 'claiming', email_sent_at = CURRENT_TIMESTAMP 
     WHERE id = ? 
       AND (email_status IS NULL OR email_status IN ('unsent', 'failed', 'uncertain', 'dry_run') 
            OR (email_status = 'claiming' AND (strftime('%s', 'now') - strftime('%s', email_sent_at)) > 60));
     ```
   - ป้องกันการส่งซ้ำจากการกดปุ่มรัว (Rapid Clicks), เครือข่ายหน่วง หรือ Race Condition ระหว่างผู้ใช้
   - คำขอที่เข้ามาซ้ำในขณะที่รายการกำลังส่งอยู่จะได้รับ HTTP 429 In-flight
   - รายการที่ส่งเข้าคิว Gmail API สำเร็จแล้ว (`gmail_accepted`) จะถูกปฏิเสธด้วย HTTP 409 Conflict เพื่อป้องกันการส่งซ้ำ
4. **การจัดการเมื่อหมดเวลาหรือเครือข่ายขัดข้อง (Timeout & Network Uncertainty):**
   - กำหนด Timeout 15 วินาทีด้วย `AbortController`
   - หากเกิด Timeout หรือ Socket Reset หลังจากส่งคำขอไปแล้ว **ระบบจะไม่ Retry อัตโนมัติเด็ดขาด** (เนื่องจากคำขออาจถึง Gmail แล้ว)
   - ระบบจะบันทึกสถานะเป็น `uncertain` (ผลไม่แน่นอน) พร้อมบันทึกลงใน `tax_invoice_email_logs` และแจ้งเตือนให้เจ้าหน้าที่ตรวจสอบโดยตรงก่อนทำรายการใหม่
5. **การแยกสถานะและข้อห้ามบน UI (Status Clarity & Policy):**
   - แยก Badge สถานะชัดเจน 5 สถานะ:
     - `dry_run`: "จำลองส่งแล้ว (Dry-run)"
     - `gmail_accepted`: "Gmail รับคำขอแล้ว" (พร้อมข้อความระบุ: ส่งเข้าคิวระบบ Gmail แล้ว - ข้อความรอการส่งตามคิว)
     - `uncertain`: "ผลส่งไม่แน่นอน (Uncertain / Timeout)" (พร้อมข้อความระบุ: ระบบไม่ส่งซ้ำอัตโนมัติเพื่อความปลอดภัย)
     - `failed`: "ส่งไม่สำเร็จ (Failed)"
     - `unsent`: "ยังไม่ได้ส่ง"
   - ⚠️ **ข้อห้ามเด็ดขาด:** ห้ามแสดงคำว่า "ลูกค้าได้รับแล้ว" หรือ "Delivered" จากการที่ Gmail API ตอบกลับ HTTP 200 เด็ดขาด

---

## 3. เอกสารคู่มือและการตั้งค่าระบบ (Runbook & Documentation)

- จัดทำคู่มือปฏิบัติงานฉบับสมบูรณ์: `docs/GMAIL_OAUTH_AND_WORKER_SECRETS_GUIDE.md`
  - ครอบคลุมการตั้งค่า Google Cloud Console, OAuth Consent Screen, สิทธิ์ Scope ขั้นต่ำ
  - ขั้นตอนการขอ OAuth2 Refresh Token ผ่าน Google OAuth 2.0 Playground
  - คำสั่งการตั้งค่า Cloudflare Worker Secrets ผ่าน `wrangler secret put`
  - แผนการตรวจสอบ Audit Trail และขั้นตอนการใช้สวิตช์ปิดฉุกเฉิน (Emergency Killswitch)

---

## 4. ผลการรัน Automated Test Suite

- **ไฟล์ทดสอบ:** `backend/tests/taxInvoiceEmailDryRun.test.cjs`
- **ผลการทดสอบ:** **13/13 PASS (100% Passed, 0 Failures)**
  1. `GmailService - Sender info constants and Gmail scope`: PASS
  2. `GmailService - isValidEmail validation`: PASS
  3. `GmailService - Thai sender name MIME encoding RFC 2047`: PASS
  4. `GmailService - generateTaxInvoiceEmailContent generates bilingual template with default sender`: PASS
  5. `GmailService - buildMimeMessage constructs valid RFC 2822 payload with From, Reply-To and PDF`: PASS
  6. `GmailService - Master Switch & Credentials enforcement`: PASS
  7. `GmailService - Staging Allowlist enforcement on non-production`: PASS
  8. `GmailService - sendTaxInvoiceEmail enforces PDF magic bytes and size check`: PASS
  9. `GmailService - OAuth2 Token Exchange & Live Dispatch with Mock Fetch`: PASS
  10. `GmailService - Timeout / Network Uncertainty does not auto-retry and marks uncertain`: PASS
  11. `Tax Invoice Email Dispatch API - Comprehensive Negative & Positive Suites (Express & SQLite)`: PASS
  12. `Cloudflare Worker - Tax Invoice Email Dispatch Parity (D1 & R2 Simulation)`: PASS
  13. `GmailService - Safe Environment resolution & unknown/missing env protection`: PASS
  1. `GmailService - Sender info constants and Gmail scope`: PASS
  2. `GmailService - isValidEmail validation`: PASS
  3. `GmailService - Thai sender name MIME encoding RFC 2047`: PASS
  4. `GmailService - generateTaxInvoiceEmailContent generates bilingual template with default sender`: PASS
  5. `GmailService - buildMimeMessage constructs valid RFC 2822 payload with From, Reply-To and PDF`: PASS
  6. `GmailService - Master Switch & Credentials enforcement`: PASS
  7. `GmailService - Staging Allowlist enforcement on non-production`: PASS
  8. `GmailService - sendTaxInvoiceEmail enforces PDF magic bytes and size check`: PASS
  9. `GmailService - OAuth2 Token Exchange & Live Dispatch with Mock Fetch`: PASS
  10. `GmailService - Timeout / Network Uncertainty does not auto-retry and marks uncertain`: PASS
  11. `Tax Invoice Email Dispatch API - Comprehensive Negative & Positive Suites (Express & SQLite)`: PASS
  12. `Cloudflare Worker - Tax Invoice Email Dispatch Parity (D1 & R2 Simulation)`: PASS
- **Regression Suite:** `customerTypeDropdownAndTaxInvoice.test.cjs` 7/7 PASS (0 Failures)
- **Frontend Build:** `vite build && node copy_to_backend.cjs` ผ่านสมบูรณ์ (4.41s) ไม่มี Warning ผิดปกติ

---

## 5. สถานะ Release & การ Deploy (STRICT CONSTRAINTS)

- ⏸️ **ยังไม่ deploy Production** (รักษาคำสั่งพัก Release / Deploy ตามคำสั่งของผู้ใช้อย่างเคร่งครัด)
- 🔒 **Zero Production Impact:** ไม่มีการเขียนข้อมูลลงใน Production D1, ไม่มีการ Deploy Worker หรือ Pages บน Production
- 🔒 **Zero External Dispatch:** ไม่มีการส่ง Gmail หรือ LINE ออกไปยังผู้รับภายนอกจริง ทุกขั้นตอนพัฒนาและทดสอบผ่าน Mock และ Dry-run
- 🌿 **RC Customer Type/Tax Invoice:** ยังคงรักษา RC branch `release/selective-customer-tax-20261104` ที่ SHA `5f94a684d9869e0f5ad009afece6a85860673681` ไว้ครบถ้วน ไม่มีการแก้ไข

---

## 6. ผลการเตรียมและตรวจระบบ Gmail บน Staging (Staging Validation Report)

### 6.1 ข้อมูลสภาพแวดล้อม Staging (Staging Environment & Configuration)
- **Worker Target:** `bwork-pos-api-staging`
- **Staging URL:** `https://bwork-pos-api-staging.ohnatza74185-ky.workers.dev`
- **Deployed Staging Version ID:** `da9e3d77-089a-4cf2-81e5-edbe381fddd2`
- **D1 Database Target:** `bworkpos_staging_db` (`8511096e-3c57-428f-8b2c-98fdb297f705`)
- **การสำรองข้อมูล (Pre-migration Backup):**  
  สำรองฐานข้อมูลก่อนรัน migration เรียบร้อยที่ `backend/backups/staging_db_backup_2026-11-05T05-21-43-459Z.sql` (147,646 bytes)
- **การอัปเกรด Schema (Migration 017 Applied):**  
  รันและบันทึกใน `_schema_migrations` (ID: 11) เรียบร้อยแล้ว:
  - เพิ่ม 6 คอลัมน์ใน `tax_invoices`: `email_status`, `email_sent_at`, `email_dry_run`, `email_message_id`, `email_recipient`, `email_error`
  - สร้างตารางตรวจสอบ `tax_invoice_email_logs` พร้อม Index สมบูรณ์

### 6.2 การตรวจสอบความสอดคล้องของคอนฟิก (Config & Secrets Parity)
- **Environment Variables ใน Staging:**
  - `ENVIRONMENT="staging"`
  - `APP_ENV="staging"`
  - `DISABLE_LIVE_LINE="true"`
  - `STAGING_ISOLATION_VERIFIED="true"`
  - `GMAIL_LIVE_DISPATCH_ENABLED="false"` (ปิดสวิตช์ส่งจริงโดยเด็ดขาด)
  - `GMAIL_SENDER_NAME="บริษัท บิลท์ ฮาร์ท จำกัด"`
  - `GMAIL_USER_EMAIL="coworkings.bwork@gmail.com"`
  - `GMAIL_REPLY_TO="coworkings.bwork@gmail.com"`
- **Cloudflare Worker Secrets (ตรวจเฉพาะชื่อ):**
  - `GMAIL_CLIENT_ID` (มีอยู่)
  - `GMAIL_CLIENT_SECRET` (มีอยู่)
  - `GMAIL_REFRESH_TOKEN` (มีอยู่)
  - `JWT_SECRET` (มีอยู่)
  - `WIFI_CREDENTIAL_ENCRYPTION_KEY` (มีอยู่)
- **Safe Environment Resolution:**
  - เพิ่มฟังก์ชัน `getEffectiveEnvironment(env)` ทั้งใน Worker และ Backend Service
  - ค่าที่ขาดหาย หรือค่าที่ไม่รู้จัก จะ fallback เป็น `development` เสมอ **ห้ามถือเป็น `production` โดยเด็ดขาด**

### 6.3 ผลการทดสอบ Preview และ Dry-Run บน Staging
- **ทดสอบ Preview (`GET /api/bookings/9001/tax-invoice/email-preview`):**
  - HTTP 200 OK แสดงผลตัวอย่างอีเมลภาษาไทย/อังกฤษ พร้อมระบุ `live_dispatch_enabled: false`, `app_env: "staging"`
- **ทดสอบการปฏิเสธการส่งจริง (`POST /api/bookings/9001/tax-invoice/send-email` with `dry_run: false`):**
  - HTTP 400 Bad Request ปฏิเสธทันทีด้วยข้อความ: *"ระบบยังไม่ได้เปิดสวิตช์ส่งอีเมลจริง (GMAIL_LIVE_DISPATCH_ENABLED != true) กรุณาใช้โหมดจำลองส่ง (Dry-run)"*
  - **ยืนยัน: ไม่มีการเรียก Gmail send API โดยเด็ดขาด**
- **ทดสอบจำลองส่ง (`POST /api/bookings/9001/tax-invoice/send-email` with `dry_run: true`):**
  - HTTP 200 OK จำลองส่งสำเร็จ ออก Message ID: `dry_run_msg_1793856884425_ujisn4yr`
  - อัปเดตสถานะใน `tax_invoices` เป็น `email_status = 'dry_run'`, `email_dry_run = 1`
  - บันทึกลงตารางตรวจสอบ `tax_invoice_email_logs` เรียบร้อย

### 6.4 ผลการตรวจ OAuth Token Exchange จากเซิร์ฟเวอร์
- ตรวจสอบผ่าน Admin diagnostic endpoint (`/api/admin/gmail/test-oauth`) บน Staging Worker โดยตรง
- **ประวัติการทดสอบรอบที่ 1 (Version `da9e3d77`):**
  - ผลตอบกลับจาก Google: **HTTP 401 Unauthorized** (`invalid_client`)
- **ประวัติการทดสอบรอบที่ 2 (Version `9f42f826` หลังอัปเดต Client ID/Secret):**
  - ผลตอบกลับจาก Google: **HTTP 400 Bad Request** (`invalid_grant` จาก Refresh Token เดิมที่ผูกกับ Client ID เก่า)
- **ผลการทดสอบรอบสมบูรณ์ (Version `791f95cf` หลังผู้ใช้อัปเดต `GMAIL_REFRESH_TOKEN` ใหม่):**
  - สถานะ: **HTTP 200 OK — เชื่อมต่อและแลกเปลี่ยน Token สำเร็จสมบูรณ์!**
  - ผลลัพธ์: `oauth_connected: true`, `app_env: "staging"`, `sender_email: "coworkings.bwork@gmail.com"`
  - ข้อความ: *"เชื่อมต่อและแลกเปลี่ยน Google OAuth2 Token สำเร็จ (ไม่มีการส่งอีเมล)"*
- **ข้อสรุปสถานะความปลอดภัย:**
  - credentials ครบถ้วนและสามารถขอ Access Token จาก Google ได้จริง
  - สวิตช์ความปลอดภัย `GMAIL_LIVE_DISPATCH_ENABLED="false"` คงปิดสนิท
  - ไม่มีการส่งอีเมลจริง และไม่มีการเปิดเผย Token หรือ Secret ใด ๆ ทั้งสิ้น

---

## 7. ผลการ Deploy ระบบส่งใบกำกับภาษี Gmail ขึ้น Production (Production Release Report)

### 7.1 ข้อมูล Release & Git Traceability
- **Release Branch:** `release/selective-gmail-tax-invoice-20261105`
- **Release SHA:** `3bf94a4ef6da95eeb0821d960d7f1ca5c1e0e8e9`
- **Production Baseline SHA:** `f579b876aee1c11ceb8b172347cb2bb9397a5a73` (งาน History hotfix, รูป R2 และ UI ต่อเวลาเดิมคงอยู่ครบถ้วน 100%)
- **Selective Scope Isolation:** ปล่อยเฉพาะ Gmail service, API, UI จัดการใบกำกับภาษี และ Schema Migration 017 เท่านั้น โดย **ไม่ปล่อย RC Customer Type/Tax Invoice ที่พักไว้ และไม่รัน Migration 016**

### 7.2 Deployment IDs & Live Targets
1. **Production Worker (`bwork-pos-api`):**
   - **URL:** `https://bwork-pos-api.ohnatza74185-ky.workers.dev`
   - **Previous Version ID:** `e844cc93-5f48-4a6d-8d9f-7de6a503b956` (Rollback ID สำหรับถอยกลับ)
   - **Deployed Version ID:** `aeb1bcae-d839-4b7b-9637-2d3fb47a67c4` (Active พร้อม hotfix RFC 2047 From header chunking <=75 chars)
2. **Production POS Pages (`bwork-pos`):**
   - **Live URL:** `https://bwork-pos.pages.dev`
   - **Previous Deployment ID:** `8bcde5bb-23d6-43b3-96f6-92cd03d1be59`
   - **Deployed Deployment ID:** `d4598e58-92e9-4476-ac7c-47bdae0ec14a`
   - **Preview URL:** `https://d4598e58.bwork-pos.pages.dev`
3. **Production Booking Pages (`bwork-booking`):**
   - คงเดิมที่ Deployment ID `c0211db4-1ccf-4db2-9ac8-a3697703f79a` (ไม่มี dependency ที่จำเป็นต้อง deploy)

### 7.3 การสำรองและอัปเกรด Schema บน Production D1
- **Database:** `bworkpos_db` (`0f171606-080b-4380-bf91-167dc678e2e4`)
- **ไฟล์สำรองก่อน Migration:** `backend/backups/production_db_backup_2026-11-05T06-01-45-727Z.sql` (ขนาด 2,511,392 bytes)
- **Migration ที่รัน:** เฉพาะ `017_tax_invoice_email_dispatch.sql` (บันทึกลงใน `d1_migrations` ID: 7)
  - เพิ่ม 6 คอลัมน์สำหรับติดตามสถานะอีเมลใน `tax_invoices`
  - สร้างตารางตรวจสอบ `tax_invoice_email_logs`
- **Migration 016:** **ไม่ถูกรันบน Production อย่างเด็ดขาด** ตามข้อกำหนดความปลอดภัย

### 7.4 การตั้งค่าสภาพแวดล้อมและ Secrets บน Production
- **Environment Variables ใน Production Worker:**
  - `ENVIRONMENT="production"`
  - `APP_ENV="production"`
  - `GMAIL_LIVE_DISPATCH_ENABLED="false"` (สวิตช์ความปลอดภัยปิดสนิท)
  - `GMAIL_SENDER_NAME="บริษัท บิลท์ ฮาร์ท จำกัด"`
  - `GMAIL_USER_EMAIL="coworkings.bwork@gmail.com"`
  - `GMAIL_REPLY_TO="coworkings.bwork@gmail.com"`
- **สถานะ Worker Secrets:**
  - คงค่าเดิม: `WIFI_CREDENTIAL_ENCRYPTION_KEY`
  - ตั้งค่าครบถ้วนแล้วบน Cloudflare Dashboard (Active Version: `3b3da539-50dd-4f15-b47b-7b5e49dc8877`):
    1. `GMAIL_CLIENT_ID`
    2. `GMAIL_CLIENT_SECRET`
    3. `GMAIL_REFRESH_TOKEN`
  - ยืนยันไม่มีการบันทึกค่า Secret หรือ Token ลงในซอร์สโค้ด, Git, log หรือรายงานใด ๆ ทั้งสิ้น

### 7.5 ผลการทดสอบสดบน Production (Live Verification)
- **Live Login (`POST /api/auth/login`):** HTTP 200 OK ได้รับ Admin JWT
- **OAuth Diagnostic (`POST /api/admin/gmail/test-oauth`):**
  - **HTTP Status:** 200 OK
  - **OAuth Connected:** `true`
  - **Live Dispatch Enabled:** `false` (ปิดสวิตช์ส่งจริงตามนโยบายความปลอดภัย)
  - **App Env:** `production`
  - **Sender Email:** `coworkings.bwork@gmail.com`
  - **Message:** `"เชื่อมต่อและแลกเปลี่ยน Google OAuth2 Token สำเร็จ (ไม่มีการส่งอีเมล)"`
  - ยืนยันเชื่อมต่อและแลกเปลี่ยน Token กับ Google OAuth2 API สำเร็จ 100% ปลอดภัย ไม่มีการแครช และไม่มี Token รั่วไหล
- **Tax Invoice Management & Preview (`GET /api/bookings/47/tax-invoice/email-preview`):** HTTP 200 OK เรนเดอร์ตัวอย่างอีเมลส่งให้ `th.admin@tradequo.com` สำเร็จ พร้อมแสดง `live_dispatch_enabled: false`
- **การบล็อกเมื่อพยายามส่งจริง (`POST /api/bookings/47/tax-invoice/send-email` with `dry_run: false`):**
  HTTP 400 Bad Request บล็อกทันทีด้วยข้อความ *"ระบบยังไม่ได้เปิดสวิตช์ส่งอีเมลจริง (GMAIL_LIVE_DISPATCH_ENABLED != true) กรุณาใช้โหมดจำลองส่ง (Dry-run)"*
- **ยืนยันเด็ดขาด:** ไม่มีการส่งอีเมลหรือ LINE ออกไปยังผู้รับจริง ไม่มีการรัน Migration ซ้ำ และไม่มีการ deploy ซ้ำ

### 7.6 แผนและคำสั่ง Rollback ฉุกเฉิน (Emergency Rollback Runbook)
1. **Rollback Production Worker ทันที:**
   ```bash
   npx wrangler rollback e844cc93-5f48-4a6d-8d9f-7de6a503b956 --config backend/wrangler.toml
   ```
2. **Rollback Production POS Pages ทันที:**
   ```bash
   npx wrangler pages deployment rollback 8bcde5bb-23d6-43b3-96f6-92cd03d1be59 --project-name bwork-pos
   ```
3. **Rollback D1 Database (กรณีฉุกเฉิน):**
   คอลัมน์และตารางของ Migration 017 เป็นส่วนต่อขยาย (Additive) ที่มีค่า Default ไม่กระทบโค้ดเดิม หากต้องการย้อนกลับฐานข้อมูลทั้งหมด สามารถใช้ไฟล์สำรองก่อน deploy: `backend/backups/production_db_backup_2026-11-05T06-01-45-727Z.sql`

### 7.7 การทดสอบส่ง Gmail จริงจำนวน 1 ฉบับตามการอนุมัติ (Approved 1-Shot Live Test Verification)
- **วัตถุประสงค์:** ตรวจสอบการส่งอีเมลจริงผ่าน Gmail API ไปยังผู้รับที่ได้รับอนุมัติ โดยแยกอิสระจากข้อมูลลูกค้า 100%
- **Endpoint:** `POST /api/admin/gmail/test-send` (Admin only)
- **สวิตช์ควบคุมแยก:** `GMAIL_TEST_DISPATCH_ENABLED` (ค่าเริ่มต้น `false` และรีเซ็ตกลับ `false` อัตโนมัติทันทีหลังส่งหรือเกิดข้อผิดพลาด)
- **สวิตช์ส่งงานลูกค้า:** `GMAIL_LIVE_DISPATCH_ENABLED="false"` (คงสถานะ `false` ตลอดเวลา ไม่มีการแตะต้อง)
- **รายละเอียดการส่งจริง 1 ฉบับ:**
  - **HTTP Status:** 200 OK
  - **Gmail Status:** `gmail_accepted` (Gmail API รับคำขอส่งเข้าคิวเรียบร้อย)
  - **Message ID:** `1a1aa7efe0abcc8a`
  - **ผู้ส่ง:** บริษัท บิลท์ ฮาร์ท จำกัด `<coworkings.bwork@gmail.com>`
  - **ผู้รับ:** `kunakornwhynatt@gmail.com` (ล็อกตายตัวจาก server-side ห้าม CC/BCC)
  - **หัวข้อ:** `[BWORK TEST] ทดสอบส่งเอกสาร PDF — ไม่ใช่ใบกำกับภาษีจริง`
  - **ไฟล์แนบ:** `BWORK_TEST_SAMPLE.pdf` (ขนาด 959 bytes สร้างในหน่วยความจำ มีข้อความแจ้งเตือน "เอกสารข้อมูลสมมติเพื่อการทดสอบระบบเท่านั้น ไม่ใช่ใบกำกับภาษีจริง")
- **การบันทึก Audit และ Concurrency:**
  - บันทึกแยกต่างหากในตาราง `settings` (`gmail_test_send_claim` และ `gmail_test_send_audit_logs`)
  - ไม่อ่าน ไม่เขียน และไม่แก้ไขตาราง `bookings`, `tax_invoices`, หรือ `booking_history` ของลูกค้าจริง
  - ไม่มีการอัปโหลดไฟล์ไปยัง R2 Storage
- **สถานะสวิตช์หลังการส่ง:**
  - `GMAIL_TEST_DISPATCH_ENABLED`: กลับสู่สถานะ `false` เรียบร้อย (Auto-disarmed via finally block)
  - `GMAIL_LIVE_DISPATCH_ENABLED`: ยังคงเป็น `false` อย่างเคร่งครัด
  - ไม่มีการรั่วไหลของ Token หรือ Secret

### 7.8 การแก้ไขชื่อผู้ส่ง Gmail ภาษาไทยเพี้ยน (Hotfix RFC 2047 From Header Encoding)
- **สาเหตุที่ตรวจพบอย่างแน่ชัด:**
  1. ใน `worker.js` เดิม ฟังก์ชัน `buildMimeMessageWorker()` นำสตริง `from` (`บริษัท บิลท์ ฮาร์ท จำกัด <coworkings.bwork@gmail.com>`) มาต่อลงใน MIME header โดยตรงโดยไม่ได้เข้ารหัส RFC 2047 สำหรับชื่อผู้ส่ง (Display Name) ทำให้กลายเป็น 8-bit UTF-8 ดิบใน Header
  2. เมื่อ Gmail / Mail User Agent ประมวลผล Header ตามมาตรฐาน RFC 822 / 5322 (ซึ่งอนุญาตเฉพาะ 7-bit ASCII) ไบต์ UTF-8 ของภาษาไทยจึงถูกตีความเป็น ISO-8859-1 (Latin-1) ส่งผลให้แสดงผลเป็นตัวอักษรเพี้ยน (Mojibake)
  3. ฟังก์ชัน `encodeMimeHeader()` เดิมไม่ได้ทำการแบ่งส่วน (Chunking) เมื่อชื่อมีความยาว UTF-8 เกิน 45 ไบต์ (ชื่อบริษัทมีความยาว 66 ไบต์ ทำให้ Base64 ยาว 88 ตัวอักษร รวม Header เป็น 100 ตัวอักษร) ซึ่งขัดกับมาตรฐาน RFC 2047 Section 2 ที่กำหนดว่า encoded-word ต้องไม่เกิน 75 ตัวอักษร
- **การแก้ไขที่ดำเนินการ:**
  1. อัปเกรด `encodeMimeHeader()` ให้รองรับการแบ่งคำ encoded-word อัตโนมัติ (ความยาวไม่เกิน 75 ตัวอักษรต่อคำ) โดยตัดแบ่งตามขอบเขตของ Unicode Code Point อย่างปลอดภัย ไม่ตัดกลางตัวอักษรหลายไบต์
  2. เพิ่มฟังก์ชัน `formatFromHeader()` / `formatFromHeaderWorker()` เพื่อแยก display name และอีเมล โดยเข้ารหัส RFC 2047 เฉพาะ display name และคงรูปแบบ `<email>` ไว้อย่างถูกต้อง
  3. ป้องกันการ Encode ซ้ำซ้อน (Idempotent RFC 2047 check)
  4. เพิ่ม Regression Tests ทั้งใน Express (`gmailService.js`) และ Worker (`worker.js`) ตรวจสอบว่า `From:` ถอดรหัสกลับมาตรงกับ "บริษัท บิลท์ ฮาร์ท จำกัด" 100% (ผ่าน 22/22 tests)
  5. Deploy Selective Hotfix ขึ้น Production Worker (Version ID: `aeb1bcae-d839-4b7b-9637-2d3fb47a67c4`) โดยรักษา Secrets ทั้งหมดและสวิตช์ส่งงานลูกค้า `GMAIL_LIVE_DISPATCH_ENABLED="false"` อย่างเคร่งครัด
  6. ทดสอบความถูกต้องด้วย Dry-run บน Production เรียบร้อย (ไม่มีการส่งอีเมลจริงเพิ่มเติม)

### 7.9 การทดสอบส่ง Gmail จริงรอบที่ 2 บน Production เพื่อยืนยันการแก้ชื่อผู้ส่งภาษาไทย (Approved 2nd Live Test Verification)
- **วัตถุประสงค์:** ตรวจสอบการแสดงผลชื่อผู้ส่งภาษาไทยจริงในกล่องข้อความของผู้รับ หลังจาก Deploy Hotfix RFC 2047 Chunking (Version: `aeb1bcae-d839-4b7b-9637-2d3fb47a67c4`)
- **การตรวจสอบความปลอดภัยก่อนส่ง (Pre-flight Safety Checks):**
  - ยืนยัน Worker Version เป็น `aeb1bcae-d839-4b7b-9637-2d3fb47a67c4` (100% active traffic)
  - ยืนยัน `GMAIL_LIVE_DISPATCH_ENABLED="false"` ตลอดเวลา
  - ยืนยันกลไก Concurrency Claim: สถานะเดิมใน `gmail_test_send_claim` ไม่ค้างในสถานะ `claiming` ระบบอนุญาตให้ส่งรอบถัดไปได้อย่างราบรื่นโดยไม่ลบ audit logs หรือแก้ไข DB
  - ยืนยัน MIME `From` header เข้ารหัส RFC 2047: แบ่งเป็น 2 encoded-words (ความยาว 72 และ 44 ตัวอักษรตามลำดับ ไม่เกิน 75 ตัวอักษร) ถอดรหัสกลับมาตรงกับ "บริษัท บิลท์ ฮาร์ท จำกัด" ถูกต้อง 100%
- **รายละเอียดการส่งจริง 1 ฉบับ (Single Request):**
  - **วัน-เวลาที่ส่ง:** 5 พฤศจิกายน 2026 เวลา 15:40:54 น. (08:40:54 UTC)
  - **HTTP Status:** 200 OK
  - **Gmail API Status:** `gmail_accepted` (Gmail API รับคำขอส่งเข้าคิวเรียบร้อย)
  - **Message ID:** `1a1aade3c63adccc`
  - **ผู้ส่ง:** บริษัท บิลท์ ฮาร์ท จำกัด `<coworkings.bwork@gmail.com>`
  - **ผู้รับ:** `kunakornwhynatt@gmail.com` (เฉพาะบุคคลที่ได้รับอนุมัติ ไม่มี CC/BCC)
  - **หัวข้อ:** `[BWORK TEST] ทดสอบส่งเอกสาร PDF — ไม่ใช่ใบกำกับภาษีจริง`
  - **ไฟล์แนบ:** `BWORK_TEST_SAMPLE.pdf` (ขนาด 959 bytes สร้างในหน่วยความจำ มีข้อความแจ้งเตือน "เอกสารข้อมูลสมมติเพื่อการทดสอบระบบเท่านั้น ไม่ใช่ใบกำกับภาษีจริง")
- **สถานะสวิตช์ความปลอดภัยหลังการส่ง (Post-send Verification):**
  - `GMAIL_TEST_DISPATCH_ENABLED`: กลับสู่สถานะ `false` เรียบร้อย (Auto-disarmed via finally block) และยืนยันในฐานข้อมูล D1
  - `GMAIL_LIVE_DISPATCH_ENABLED`: ยังคงเป็น `false` อย่างเคร่งครัด
  - ไม่มีการแตะต้องข้อมูลลูกค้า (`bookings`, `tax_invoices`, `booking_history`) และไม่มีการอัปโหลด R2
- **การประเมินผลการแสดงผล:**
  - **สถานะทางระบบ:** Gmail API รับคำขอแล้ว (`gmail_accepted`) เข้าสู่คิวส่งจดหมายของ Google
  - **รอการยืนยันทางสายตา (Visual Verification Needed):** ผู้รับ (`kunakornwhynatt@gmail.com`) ตรวจสอบกล่องจดหมายของอีเมลฉบับล่าสุด (Message ID: `1a1aade3c63adccc`) เพื่อยืนยันว่าชื่อผู้ส่งแสดงเป็น **"บริษัท บิลท์ ฮาร์ท จำกัด"** โดยสมบูรณ์

### 7.10 การตรวจและเตรียมปุ่มส่งใบกำกับภาษีจริงใน POS (Tax Invoice Live Dispatch UI Preparation)
- **สาเหตุที่ไม่เห็นปุ่มส่งจริงในโค้ดเดิม:**
  - โค้ดเดิมมีการประกาศฟังก์ชัน handler `handleLiveSendEmail()` ไว้แล้ว แต่ใน JSX ส่วน Render Action buttons มีเพียง 2 ปุ่ม ได้แก่ `btn-tax-email-preview` ("ดูตัวอย่างอีเมล") และ `btn-tax-simulate-send-email` ("จำลองส่งอีเมล (Dry-run)") โดยยังไม่ได้วางปุ่มสำหรับส่งจริง (`btn-tax-live-send-email`)
- **การปรับปรุงและพัฒนาเสร็จสมบูรณ์แล้ว:**
  1. **ปุ่มควบคุม 3 ปุ่มพัฒนาเสร็จแล้ว:**
     - ปุ่ม "ดูตัวอย่างอีเมล" (`#btn-tax-email-preview`)
     - ปุ่ม "จำลองส่งอีเมล (Dry-run)" (`#btn-tax-simulate-send-email`)
     - ปุ่ม "ส่งอีเมล" (`#btn-tax-live-send-email`) สีเขียวมรกต (`#059669`)
  2. **สวิตช์ความปลอดภัยและ Safety Gates:**
     - ปุ่ม "ส่งอีเมล" จะเปิดใช้งานเมื่อ: มีสิทธิ์ (`admin`/`manage`/`pos`), มีอีเมลถูกต้อง, มีไฟล์ PDF แนบ, backend แจ้งว่าเปิดส่งจริงแล้ว (`live_dispatch_enabled === true`), และไม่ได้กำลังส่ง
     - หากสวิตช์ส่งจริงปิดอยู่ (`GMAIL_LIVE_DISPATCH_ENABLED=false`): ปุ่มส่งจริงจะถูก disable พร้อมแสดงแถบเตือนสีเทาอ่อนชี้แจงเหตุผลและแนะนำให้ใช้ Dry-run
  3. **หน้าต่างยืนยันก่อนส่งจริงพัฒนาเสร็จแล้ว (Dedicated Confirmation Modal):**
     - ตรวจสอบอีเมลผู้รับ (`#confirm-recipient-email`), เลขที่ใบกำกับภาษี (`#confirm-invoice-number`), ชื่อและขนาดไฟล์ PDF แนบ (`#confirm-file-name`), รหัสการจอง และชื่อผู้เสียภาษี พร้อมปุ่มยกเลิกและปุ่มยืนยันส่งจริง
  4. **การป้องกันกดซ้ำและสถานะ Uncertain:**
     - ปิดปุ่มทั้งหมดขณะส่ง แสดงสถานะกำลังหมุน และไม่ retry อัตโนมัติเมื่อเกิด timeout/uncertain
  5. **การอัปเดตสถานะ:** แสดง Badge "Gmail รับคำขอแล้ว" (`gmail_accepted`) ทันทีที่ backend ตอบกลับ
- **ผลการทดสอบที่ทำจริง (Automated UAT & Regression):**
  - ชุดทดสอบอัตโนมัติบน Chrome CDP (`backend/tests/verifyTaxInvoiceModalUI.cjs`):
    - **Scenario 1 (Default Disabled):** ตรวจพบปุ่มครบ 3 ปุ่ม, ปุ่มส่งจริง disabled ถูกต้อง, แสดงแถบเตือนชี้แจงเหตุผล ผ่าน 100% ทั้ง Desktop และ Mobile Viewport (390px)
    - **Scenario 2 (Dry-Run Click):** จำลองส่งสำเร็จ อัปเดต Badge เป็น "จำลองส่งแล้ว (Dry-run)" ผ่าน 100%
    - **Scenario 3 (Live Send & Confirmation):** ปลดล็อกปุ่มสีเขียวเมื่อเปิดสวิตช์, หน้าต่างยืนยันแสดงข้อมูลผู้รับ/เลขที่/PDF ถูกต้อง, ทดสอบกดยกเลิกปิดหน้าต่างได้ปกติ, กดยืนยันส่งจริงอัปเดต Badge เป็น "Gmail รับคำขอแล้ว" (`gmail_accepted`) ผ่าน 100%
  - ชุดทดสอบ Backend Regression (`backend/tests/taxInvoiceEmailDryRun.test.cjs`): ผ่าน 13/13 tests (100%)
- **สถานะ Selective Release Patch:**
  - **Release Patch Commit:** `7ba523ef` บน branch `release/selective-gmail-tax-invoice-20261105`
  - **Development Commit:** `a05fc38b` บน branch `integration/home-office-20261021`
  - **ยังไม่ได้ Deploy patch นี้ขึ้นระบบจริง:**
    - Production Worker ปัจจุบันคงเดิมที่ Version ID: `aeb1bcae-d839-4b7b-9637-2d3fb47a67c4`
    - Production POS Pages ปัจจุบันคงเดิมที่ Deployment ID: `d4598e58-92e9-4476-ac7c-47bdae0ec14a`
- **สถานะสวิตช์ความปลอดภัยที่ตรวจยืนยันล่าสุด:**
  - `GMAIL_LIVE_DISPATCH_ENABLED`: **`false`** (สวิตช์ส่งลูกค้าปิดสนิทบน Production Worker)
  - `GMAIL_TEST_DISPATCH_ENABLED`: **`false`** (สวิตช์ทดสอบปิดสนิท ตรวจยืนยันในตาราง `settings` ของ Production D1)
  - ไม่มีการส่งอีเมลหาลูกค้าจริง และไม่มีการแตะต้องข้อมูลลูกค้าใด ๆ

---

## 8. แผนงานสำหรับดำเนินการต่อที่บ้าน (Home Office Continuity Runbook)

- **สถานะความพร้อม:**
  - โค้ดทั้งหมดได้รับการบันทึกและซิงก์ขึ้น GitHub Remote Repository บน branch `integration/home-office-20261021` และ `release/selective-gmail-tax-invoice-20261105` อย่างสมบูรณ์
  - ไฟล์ทดสอบอัตโนมัติ `backend/tests/verifyTaxInvoiceModalUI.cjs` ถูกบันทึกลงใน repository พร้อมใช้งาน
- **ขั้นตอนการทำงานถัดไปที่บ้าน (Next Steps):**
  1. **ตรวจ Selective Patch ก่อน Deploy:**
     - ตรวจสอบ HEAD commit บน `release/selective-gmail-tax-invoice-20261105` (SHA: `7ba523ef`)
     - รัน `npm run build` ใน `frontend/` และรัน `node backend/tests/taxInvoiceEmailDryRun.test.cjs` เพื่อยืนยันความสมบูรณ์ของ Build Artifacts
  2. **ดำเนินการ Deploy ตามคำสั่งอนุมัติภายหลัง:**
     - Deploy Selective Patch ขึ้น Production POS Pages (`bwork-pos`):
       ```bash
       npx wrangler pages deploy backend/public --project-name bwork-pos --commit-dirty=true
       ```
     - Deploy Selective Patch ขึ้น Production Worker (`bwork-pos-api`):
       ```bash
       npx wrangler deploy --name bwork-pos-api backend/worker.js --compatibility-date 2026-08-08 --compatibility-flags nodejs_compat
       ```
  3. **การเปิดใช้งานสวิตช์ส่งจริง:**
     - รอคำสั่งอนุมัติจากผู้ใช้ก่อนปรับค่า `GMAIL_LIVE_DISPATCH_ENABLED="true"` บน Cloudflare Worker Secrets / Environment Variables
     - ห้ามเปิดสวิตช์ส่งจริงจนกว่าจะได้รับการอนุมัติอย่างเป็นลายลักษณ์อักษร

---

## 9. ผลการ Deploy BWORK Booking Tax Invoice Hotfix ขึ้น Production (2026-11-06)

### 9.1 ปัญหาเดิมและผลการวิเคราะห์สาเหตุ (Root Cause Analysis)
- **อาการบั๊ก:** ลูกค้าติ๊กเลือก "ต้องการขอใบกำกับภาษี / ใบเสร็จรับเงินเต็มรูปแบบ" บนหน้าเว็บจอง (`bwork-booking.pages.dev`) แล้วระบบขึ้นข้อความแจ้งเตือนว่า *"กรุณาระบุประเภทผู้เสียภาษี (บุคคลธรรมดา หรือ นิติบุคคล)"* แต่ไม่มีช่องหรือปุ่มตัวเลือกประเภทผู้เสียภาษีให้กดเลือก ทำให้ไม่สามารถดำเนินการต่อได้
- **สาเหตุทางระบบ (Root Cause):**
  1. การ Release ระบบส่งใบกำกับภาษี Gmail ก่อนหน้านี้ เป็นการปล่อยเฉพาะ Worker API (`bwork-pos-api`) และ POS Pages (`bwork-pos`) โดยที่ Booking Pages (`bwork-booking`) ยังคงอยู่ที่ deployment เดิม (`c0211db4`) ซึ่ง Bundle เดิม (`/assets/index-DoifLwrz.js`) ยังไม่มีฟิลด์ตัวเลือก `tax_payer_type`
  2. Worker API บน Production มี validation บังคับว่าหาก `tax_invoice_required == 1` ค่า `tax_payer_type` ต้องเป็น `'individual'` หรือ `'corporate'` เท่านั้น
  3. เมื่อหน้าเว็บรุ่นเก่าส่ง `tax_invoice_required: 1` โดยไม่มี `tax_payer_type` ทาง Worker จึงตอบกลับ `HTTP 400 Bad Request` ทำให้หน้าเว็บแสดงข้อความแจ้งเตือนดังกล่าว

### 9.2 การตรวจยืนยัน API Contract บน Production Worker (`bwork-pos-api`) สด
- **Active Worker Version ID:** `a68b57b8-e161-47d1-86aa-19a7cbd097e1` (รับทราฟฟิก 100%)
- **ผลการยิง Probe ตรวจสอบ Contract จริง:**
  - `tax_invoice_required: 1` ไม่ระบุ `tax_payer_type` $\rightarrow$ ตอบ `400: "กรุณาระบุประเภทผู้เสียภาษี (บุคคลธรรมดา หรือ นิติบุคคล)"`
  - `tax_invoice_required: 1` ส่ง `tax_payer_type: "individual"` $\rightarrow$ ยอมรับและเข้าสู่ validation ชื่อบุคคลธรรมดา (`"กรุณากรอกชื่อ–นามสกุลสำหรับออกใบกำกับภาษี"`)
  - `tax_invoice_required: 1` ส่ง `tax_payer_type: "corporate"` $\rightarrow$ ยอมรับและเข้าสู่ validation ชื่อนิติบุคคล (`"กรุณากรอกชื่อนิติบุคคลสำหรับออกใบกำกับภาษี"`)
  - `tax_invoice_required: 0` ไม่ส่ง `tax_payer_type` $\rightarrow$ ข้ามการตรวจประเภทผู้เสียภาษี 100% (เข้าสู่การตรวจห้อง ไม่บังคับฟิลด์นี้)
  - **ยืนยัน: API Contract ของ Worker จริงตรงกับข้อกำหนดและ Hotfix 100% ไม่มีความขัดแย้ง**

### 9.3 ข้อมูลการ Release & Git Traceability
- **Release Repository:** `D:\Project BL\Bwork-POS-Release`
- **Release Branch:** `release/selective-gmail-tax-invoice-20261105`
- **Release Commit SHA:** `bff68d107b87231ac8973a8c87cd2b661b09d6ad`
- **Development Commit SHA:** `8aa8d747fce5bca578b8ad282713f04494a8c903` (บน branch `integration/home-office-20261021`)
- **ขอบเขตการแก้ไข:** แก้ไขเฉพาะไฟล์เดียว [`booking-app/src/pages/BookingFormPage.jsx`](file:///D:/Project%20BL/Bwork-POS-Development/booking-app/src/pages/BookingFormPage.jsx)
- **การแยกขอบเขต Selective Scope:** ปลอดจาก unreleased features (ไม่มีโค้ด Support Tickets หรือ CRM RC ปะปน 100%)

### 9.4 ข้อมูล Deployment IDs บน Cloudflare Pages (`bwork-booking`)
- **Previous Deployment ID (สำหรับ Rollback):** `c0211db4-1ccf-4db2-9ac8-a3697703f79a`
- **Deployed Deployment ID (Active ล่าสุด):** `3ef05797-e7f4-4fcf-831b-e37ad4fe1e9a`
- **Production URL:** https://bwork-booking.pages.dev
- **Preview URL:** https://3ef05797.bwork-booking.pages.dev
- **ชื่อ Bundle ที่โหลดจริงบน Production:** `/assets/index-DEouKUNO.js` (ขนาด 501,318 bytes)

### 9.5 ผลการทดสอบสดบน Production หลัง Deploy (Real Browser Mobile 390px)
- **ตรวจสอบทางเทคนิค (Live Chrome CDP at 390x844):**
  1. **เมื่อเปิดหน้าเว็บและติ๊กขอใบกำกับภาษี:**
     - แสดงแถวตัวเลือกประเภทผู้เสียภาษี `#btn-tax-individual` ("บุคคลธรรมดา") และ `#btn-tax-corporate` ("นิติบุคคล") วางก่อนช่องกรอกชื่อ
     - เริ่มต้นไม่มีปุ่มใดถูกเลือกไว้ล่วงหน้า (ไม่มี default และไม่เดาจากชื่อบริษัท)
  2. **เมื่อกดเลือก "บุคคลธรรมดา":**
     - ปุ่มบุคคลธรรมดา Active (`indActive: true`), ซ่อนส่วนตัวเลือกสาขา
     - แสดง Label *"ชื่อ–นามสกุล *"* และ Placeholder *"เช่น นายสมชาย ใจดี"*
     - บันทึกภาพหลักฐาน: `prod_live_mobile_390_individual_selected.png`
  3. **เมื่อกดเลือก "นิติบุคคล":**
     - ปุ่มนิติบุคคล Active (`corpActive: true`), แสดงตัวเลือกสาขา ("สำนักงานใหญ่" / "สาขา")
     - แสดง Label *"ชื่อนิติบุคคล *"* และ Placeholder *"เช่น บริษัท ตัวอย่าง จำกัด"*
     - เมื่อกดเลือก "สาขา" แสดงช่องกรอกเลขที่สาขา (`#input-tax-branch-number`) ทันที
     - บันทึกภาพหลักฐาน: `prod_live_mobile_390_corporate_selected.png`
  4. **Safety Gate Compliance:**
     - **หยุดการทำงานก่อนกดปุ่ม "ถัดไป" บน Production อย่างเคร่งครัด**
     - ไม่มีการสร้างรายการจองจริง ไม่มีการบันทึกธุรกรรมการเงิน และไม่มีการเขียนฐานข้อมูล Production ใด ๆ ทั้งสิ้น (ยืนยันขั้นตอนส่งฟอร์มผ่าน Mock UAT Suite ครบทุกเคสแล้ว)

### 9.6 สถานะสวิตช์ความปลอดภัยของระบบโดยรวม
- **Worker `bwork-pos-api`:** คงเดิมที่ Version ID `a68b57b8-e161-47d1-86aa-19a7cbd097e1`
- **POS Pages `bwork-pos`:** คงเดิมที่ Deployment ID `d4598e58-92e9-4476-ac7c-47bdae0ec14a`
- **D1 Database `bworkpos_db`:** ไม่มีการรัน migration เพิ่มเติม
- **สวิตช์ส่งอีเมล:**
  - `GMAIL_LIVE_DISPATCH_ENABLED="false"` (ปิดสนิท)
  - `GMAIL_TEST_DISPATCH_ENABLED="false"` (ปิดสนิท)
