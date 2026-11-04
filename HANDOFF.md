# BWORK-POS | DEVELOPMENT HANDOFF REPORT

> **Document Version:** 1.1.0  
> **Date:** 4 พฤศจิกายน 2026  
> **Workspace:** Development (`D:\Project BL\Bwork-POS-Development`)  
> **Branch:** `integration/home-office-20261021`  
> **Remote Repository:** `https://github.com/depp48106/Bwork-POS-Development.git`  
> **Status:** **PAUSED RELEASE / READY FOR FUTURE DEPLOYMENT**  

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

## 6. คิวงานถัดไป (Next Queue)

1. **ระบบส่งใบกำกับภาษีผ่าน Gmail API:** พัฒนาการส่ง e-Tax Invoice / เอกสารใบกำกับภาษีหาลูกค้าทาง Gmail
2. **รูปภาพในใบยืนยันการจอง:** จัดการรูปภาพและ Banner ในบัตรยืนยันการจอง (LINE Booking Confirmation Card / Flex Message)
