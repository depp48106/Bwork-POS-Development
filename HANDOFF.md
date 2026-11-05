# BWORK-POS | DEVELOPMENT HANDOFF REPORT

> **Document Version:** 1.3.0  
> **Date:** 5 พฤศจิกายน 2026  
> **Workspace:** Development (`D:\Project BL\Bwork-POS-Development`)  
> **Branch:** `integration/home-office-20261021`  
> **Remote Repository:** `https://github.com/depp48106/Bwork-POS-Development.git`  
> **Status:** **DEVELOPMENT READY / GMAIL OAUTH2 & WORKER SECRETS PREPARED (DRY-RUN DEFAULT)**  

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
- **ผลการทดสอบ:** **12/12 PASS (100% Passed, 0 Failures)**
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
