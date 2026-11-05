# BWORK-POS | DEVELOPMENT HANDOFF REPORT

> **Document Version:** 1.2.0  
> **Date:** 4 พฤศจิกายน 2026  
> **Workspace:** Development (`D:\Project BL\Bwork-POS-Development`)  
> **Branch:** `integration/home-office-20261021`  
> **Remote Repository:** `https://github.com/depp48106/Bwork-POS-Development.git`  
> **Status:** **DEVELOPMENT READY / ROOM CONFIRMATION INTEGRITY VERIFIED**  

---

## 1. สถานะงาน Customer Type & Tax Invoice Separation

- ✅ **ผ่านการทดสอบบน Staging Live:** 23/23 รายการ (100% Passed)
  - ทั้ง API, Mobile 390px Viewport (CDP) และ Console Browser Exceptions = 0
- ✅ **ผ่านการรัน Regression Test Suite:** 41/41 รายการ (0 Failures)
- ✅ **Additive Database Migration 016 (`016_tax_payer_type_nullable.sql`):**
  - ไม่แก้ไข migration ประวัติเดิม (001-015)
  - รายการจองเก่าในระบบ (เช่น Booking #9001) คงสถานะ `tax_payer_type: null` ปลอดภัย

---

## 2. ข้อมูล Release Candidate (RC) Branch & Commit

- **RC Branch:** `release/selective-customer-tax-20261104` (สร้างใน `D:\Project BL\Bwork-POS-Release` จาก baseline `f579b876`)
- **RC SHA:** [`5f94a684d9869e0f5ad009afece6a85860673681`](file:///D:/Project%20BL/Bwork-POS-Release)
- **Remote RC Branch:** `origin/release/selective-customer-tax-20261104` (Local & Remote SHA ตรงกัน 100%)
- **Selective Patching Scope:** คัดเลือกเฉพาะงาน Customer Type Dropdown และ Tax Invoice Separation โดยรักษา:
  1. Hotfix หน้าประวัติ (`History.jsx`: `Plus`, `ShieldCheck`, `fetchBookings`)
  2. UI ต่อเวลาห้องประชุม POS (`RoomExtensionModal.jsx`, `RoomExtensionModal.css`)
  3. รูปห้องประชุมบน Cloudflare R2 (`bwork-uploads`) ทั้ง 10 ห้อง
- **Production Asset Build Check:**
  - `backend/public/assets/index-B8o3Gc9u.js` (SHA256: `b38d86bcdc1205b86f3363a221a3f4e6f8b65617bea0de6631b918b0d5799ab6`)
  - `booking-app/dist/assets/index-Bs8zxBAy.js` (SHA256: `c0f9b7187f742e63c5edf6236b01398fd5f8034f13682a4f4ead8c6bd99fe2db`)
  - ทั้งสองชุดชี้ Production API และ **ไม่พบ Staging URL (0 รายการ)**

---

## 3. สถานะการ Deploy (STRICT SAFETY GATE)

- ⏸️ **ยังไม่ deploy Production** (พัก Release และ Deploy ตามคำสั่งล่าสุดของผู้ใช้)
- 🔒 **Zero Production Impact:** ไม่มีการเขียนข้อมูลลงใน Production D1, ไม่มีการ deploy Worker หรือ Pages บน Production

---

## 4. ข้อกำหนดการ Migration บน Production D1 จริง

- ตัวเลข **49 แถว** ที่วิเคราะห์ได้ เป็นการอ้างอิงจากข้อมูลสำรอง (Backup วันที่ 2 พ.ย. 2026)
- ⚠️ **ก่อนรัน Migration 016 บน Production D1 จริง:**
  1. ต้องสำรองข้อมูล Production D1 สด ณ เวลานั้นด้วย timestamp
  2. ต้อง query ตรวจนับจำนวนแถวที่ `tax_invoice_required = 0 OR tax_invoice_required IS NULL` สดอีกครั้งก่อนรันจริง
  3. ตรวจสอบว่ารายการที่ `tax_invoice_required = 1` จะไม่ถูกแก้ไข

---

## 5. ข้อกำหนดการ Rollback (Row-Level Restoration)

- 🚫 **ห้ามลบ migration history (`DELETE FROM _schema_migrations`) เพียงอย่างเดียวเพื่ออ้างว่าย้อนคืนข้อมูลแล้ว**
- 🔄 **การกู้คืนข้อมูล (Database Rollback):**
  - ต้องอิงค่าก่อนเปลี่ยนเฉพาะแถวที่ถูก migration จริง
  - ต้องมีเงื่อนไข (Conditional Guard) ป้องกันการเขียนทับรายการจองใหม่ที่สร้างหลัง migration
  - ตัวอย่างคำสั่งกู้คืน:
    ```sql
    UPDATE bookings 
    SET tax_payer_type = 'corporate' 
    WHERE id IN (<รายการ ID ที่เปลี่ยนจริง>)
      AND tax_payer_type IS NULL 
      AND (tax_invoice_required = 0 OR tax_invoice_required IS NULL);
    ```
- 📍 **บันทึก Live Production Targets สำหรับย้อนคืน (Instant Re-routing):**
  - **Worker API:** Version ID `c2e7f688-9000-444c-bc88-3cb02093bab2`
  - **POS Pages:** Deployment ID `8bcde5bb-23d6-43b3-96f6-92cd03d1be59` (Source `f579b87`)
  - **Booking Pages:** Deployment ID `c0211db4-1ccf-4db2-9ac8-a3697703f79a` (Source `2b56b85`)

---

## 6. สถานะงานแก้ไขรูปภาพห้องประชุมในใบยืนยันการจอง (Booking Confirmation Card)

- ✅ **แก้ไขปัญหาแสดง "ไม่มีรูปภาพห้องประชุมที่ตั้งค่าไว้":**
  - ใน `PendingBookings.jsx` แปลง URL ผ่าน `getRoomImageUrl` เพื่อต่อ `API_BASE` ดึงรูปจาก Cloudflare R2 สำหรับ `/uploads/rooms/` ป้องกัน 404 บน Pages
  - เพิ่ม `crossOrigin="anonymous"` ให้กับแท็ก `<img>` ทั้งหมดในการ์ดยืนยัน (Hero banner, BWORK logo, building banner, room thumbnails) ป้องกัน Canvas Tainting
  - รองรับ Fallback เมื่อรูปเสียด้วย `handleRoomImageError` + `fallbackTried` ลองสลับระหว่าง API_BASE และ relative 1 ครั้ง หากยังล้มเหลวจะหยุดโหลดถาวร ไม่เกิด Infinite Loop
- ✅ **ความปลอดภัย Path Traversal & Sanitization (`server.js` & `worker.js`):**
  - ปฏิเสธ `..` และ `\` ทันที ป้องกันการเข้าถึงไฟล์ระบบ
  - Normalize path ที่ขาด leading slash (`uploads/rooms/` → `/uploads/rooms/`)
  - ปฏิเสธ External URL scheme ทั้งหมด (`http:`, `https:`, `//`, `javascript:`)
- ✅ **ความถูกต้องของการ Export และ Print (`printReceiptHelper.js`):**
  - ตรวจจับ SecurityError / Tainted Canvas อย่างชัดเจน โดยแจ้ง Error ชัดเจน ไม่ซ่อนข้อผิดพลาด และไม่ถือว่า `naturalWidth > 0` เพียงพอต่อการ Export
  - สร้างไฟล์จริงบนดิสก์และผ่านการตรวจสอบ:
    - Single-room JPG: `actual_exported_confirmation_single_room.jpg` (259 KB)
    - Single-room PDF: `actual_printed_confirmation_single_room.pdf` (1.49 MB)
    - Multi-room JPG: `actual_exported_confirmation_multi_room.jpg` (352 KB)
    - Multi-room PDF: `actual_printed_confirmation_multi_room.pdf` (11.64 MB)
- ✅ **ผลการรัน Test Suite ทั้งหมด:**
  - `bookingConfirmationCard.test.cjs`: 15/15 PASS
  - `roomImageResolution.test.cjs`: 6/6 PASS
  - `verifyCrossoriginExportPrintAndSafety.cjs`: PASS ครบทุกการทดสอบ (Traversal, Staging CORS, Taint Rejection, Real Export, Retry Halt)

---

## 7. สถานะระบบส่งใบกำกับภาษีผ่าน Gmail แบบ Dry-run (Current Queue Completed)

- ✅ **Additive Migration 017 (`017_tax_invoice_email_dispatch.sql`):**
  - เพิ่มฟิลด์ในตาราง `tax_invoices`: `email_status`, `email_sent_at`, `email_dry_run`, `email_message_id`, `email_recipient`, `email_error`
  - สร้างตาราง Audit Trail `tax_invoice_email_logs` บันทึกประวัติการส่งอีเมลทุกครั้ง (ทั้ง Dry-run และ Live ในอนาคต)
  - รองรับทั้ง SQLite (`backend/server.js`) และ Cloudflare D1 (`backend/worker.js`)
- ✅ **Decoupled Gmail API Service Module (`backend/services/gmailService.js`):**
  - `isGmailConfigured()` ตรวจสอบค่าคอนฟิก OAuth2 credentials
  - `isValidEmail()` ตรวจสอบรูปแบบอีเมลตามมาตรฐาน RFC 5322
  - `generateTaxInvoiceEmailContent()` สร้างเนื้อหาอีเมลทางการสองภาษา (Thai/English) พร้อมรายละเอียดเลขที่ใบกำกับภาษี รหัสการจอง และแจ้งเอกสารแนบ PDF
  - `buildMimeMessage()` สร้างโครงสร้าง RFC 2822 Multipart MIME พร้อมแนบไฟล์ PDF base64 chunked
  - `sendTaxInvoiceEmail()` ทำงานแบบ Dry-run โดยค่าเริ่มต้น ตรวจสอบ magic bytes (`%PDF-`) และขนาดไฟล์ไม่เกิน 10MB พร้อมบันทึก `dry_run_msg_*`
- ✅ **Backend Endpoints Parity (`server.js` & `worker.js`):**
  - `GET /api/bookings/:id/tax-invoice/email-preview`: ตรวจสอบสิทธิ์ผู้ใช้ (`pos`, `manage`, `admin`), ตรวจสอบความถูกต้องของรายการจอง, ความเป็นเจ้าของเอกสาร (Document Ownership Mismatch Check), ความถูกต้องของอีเมลผู้รับ และความสมบูรณ์ของไฟล์ PDF บนระบบไฟล์ Private/R2
  - `POST /api/bookings/:id/tax-invoice/send-email`: ตรวจสอบสิทธิ์, ตรวจสอบเอกสาร, ป้องกันการส่งซ้ำ/รัว (Double-click Debounce 4 วินาที), ส่งแบบ Dry-run, บันทึกสถานะ `dry_run` (**ห้ามขึ้น "ส่งแล้ว" เด็ดขาด**), บันทึกลง `tax_invoice_email_logs` และ `booking_history`
  - เข้าถึงไฟล์ PDF ผ่าน Private Path เดิม ห้ามเปิด R2 หรือระบบไฟล์เป็น Public เด็ดขาด
- ✅ **Frontend UI (`TaxInvoiceManagementModal.jsx`):**
  - เมื่อช่องทางจัดส่งเป็น `email`: แสดงการ์ด e-Tax Invoice Delivery พร้อมอีเมลผู้รับ และสถานะไฟล์ PDF แนบ
  - Badge สถานะ: แสดง `"จำลองส่งแล้ว (Dry-run)"` หรือ `"ยังไม่ได้ส่ง"` (**ไม่แสดงคำว่า "ส่งแล้ว"**)
  - ปุ่ม `"ดูตัวอย่างอีเมล"` (`#btn-tax-email-preview`) เปิด Sub-modal ตัวอย่างอีเมลพร้อมสลับแท็บ HTML และ Plain Text
  - ปุ่ม `"จำลองส่งอีเมล (Dry-run)"` (`#btn-tax-simulate-send-email`) ทำงานปลอดภัยพร้อม Disabled state เมื่อไม่มี PDF หรือไม่มีอีเมล
  - รองรับหน้าจอมือถือความกว้าง 390px (iPhone 12/13/14) แบบ Responsive และ Desktop 1280px
- ✅ **ผลการทดสอบ Automated Test Suite (`taxInvoiceEmailDryRun.test.cjs`):** 6/6 PASS
  - Test 1: Unauthenticated -> 401
  - Test 2: Unauthorized (พนักงานไม่มีสิทธิ์ pos/manage) -> 403
  - Test 3: รายการจองไม่มีอยู่จริง -> 404
  - Test 4: รายการจองที่ไม่มีไฟล์ PDF ใบกำกับภาษี -> 400
  - Test 5: รูปแบบอีเมลผู้รับไม่ถูกต้อง -> 400
  - Test 6: Document Mismatch (`invoice_id` ของรายการจองอื่น) -> 400
  - Test 7: Double-click Debounce ทันที -> 429
  - Test 8: จำลองส่ง Dry-run สำเร็จ -> บันทึกสถานะ `dry_run`, audit trail ครบถ้วน
  - Test 9: ตัวอย่างอีเมล (Preview endpoint) ทำงานถูกต้อง
  - Test 10: Cloudflare Worker D1 & R2 simulation parity ทำงานถูกต้อง
- ✅ **ผลการทดสอบ Browser UI UAT (Headless Chrome CDP):**
  - บันทึกภาพจริงครบ 4 ภาพใน Artifact Directory:
    1. `pos_tax_email_dispatch_mobile_390.png` (Mobile 390px Initial Load)
    2. `pos_tax_email_preview_mobile_390.png` (Mobile 390px Email Preview Modal)
    3. `pos_tax_email_dispatch_sent_mobile_390.png` (Mobile 390px Post Dry-run Sent Status)
    4. `pos_tax_email_dispatch_desktop.png` (Desktop 1280px View)
- 🔒 **สิ่งที่ต้องกรอกเมื่อพร้อมขึ้นระบบส่งจริง (Live Gmail Activation):**
  - `GMAIL_CLIENT_ID`: OAuth 2.0 Client ID จาก Google Cloud Console
  - `GMAIL_CLIENT_SECRET`: OAuth 2.0 Client Secret
  - `GMAIL_REFRESH_TOKEN`: Authorized Refresh Token พร้อม Scope `https://www.googleapis.com/auth/gmail.send`
  - `GMAIL_USER_EMAIL`: อีเมลบัญชีผู้ส่ง เช่น `billing@bwork.co`

---

## 8. คิวงานถัดไป (Next Queue)

1. **พักงาน Release/Deploy ตามคำสั่ง:** ยังไม่ Deploy Production และไม่รัน Migration บน Production DB
2. **เตรียม Credentials สำหรับเปิด Live Gmail:** เมื่อผู้บริหารอนุมัติให้ต่อบัญชีจริง
