# B-WORK POS | Gmail API OAuth2 & Cloudflare Worker Secrets Runbook

> **ความลับและความปลอดภัยขั้นสูงสุด:**
> ห้ามบันทึก Client Secret, Refresh Token หรือข้อมูลลับจริงลงใน Git, frontend, logs, หรือช่องแชทโดยเด็ดขาด 
> ให้จัดเก็บผ่าน Environment Variables สำหรับเครื่องเซิร์ฟเวอร์ และ Cloudflare Worker Secrets (`wrangler secret put`) เท่านั้น

---

## 1. ภาพรวมสถาปัตยกรรมการส่งใบกำกับภาษี (Architecture & Security Guardrails)

ระบบส่งใบกำกับภาษีทางอีเมลของ **B-WORK (บริษัท บิลท์ ฮาร์ท จำกัด)** ได้รับการออกแบบตามมาตรฐานความปลอดภัยขั้นสูง (Defense-in-depth):

```
+-----------------------------------------------------------------------------------+
|                                  B-WORK POS UI                                    |
| - แสดงสถานะชัดเจน: dry_run | gmail_accepted | uncertain | failed | unsent          |
| - ห้ามแสดง "ลูกค้าได้รับแล้ว" เด็ดขาด (เนื่องจาก Gmail API 200 ยืนยันเพียงรับคำขอ)  |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                         Backend API (Express & Worker D1)                         |
| 1. Atomic Database Claim (email_status = 'claiming') ป้องกัน race condition & double send|
| 2. Master Safety Switch (GMAIL_LIVE_DISPATCH_ENABLED != true -> ปฏิเสธส่งจริง)     |
| 3. Staging Allowlist (GMAIL_STAGING_ALLOWLIST) ป้องกันอีเมลทดสอบหลุดถึงลูกค้าจริง |
| 4. Minimal Scope (https://www.googleapis.com/auth/gmail.send เท่านั้น)             |
| 5. Private PDF Storage (เข้าถึงเฉพาะสิทธิ์ POS/Admin และเจ้าของเอกสาร)            |
| 6. Durable Timeout Handling (เมื่อ Timeout/ขัดข้อง มาร์ก uncertain ไม่ retry อัตโนมัติ)|
+-----------------------------------------------------------------------------------+
```

### ข้อมูลผู้ส่ง (Official Sender Identity)
- **ชื่อผู้ส่ง (From Name):** `บริษัท บิลท์ ฮาร์ท จำกัด` (เข้ารหัส MIME RFC 2047 `=?UTF-8?B?...?=` รองรับภาษาไทยสมบูรณ์)
- **อีเมลผู้ส่ง (From Email):** `coworkings.bwork@gmail.com`
- **อีเมลตอบกลับ (Reply-To):** `coworkings.bwork@gmail.com`
- **OAuth2 Scope:** `https://www.googleapis.com/auth/gmail.send` (จำกัดเฉพาะการส่งอีเมล ไม่อนุญาตให้อ่าน กล่องจดหมาย หรือจัดการบัญชี)

---

## 2. ขั้นตอนการตั้งค่า Google Cloud Console OAuth2

### ขั้นตอนที่ 1: สร้างหรือเลือกโปรเจกต์
1. เข้าสู่ระบบ [Google Cloud Console](https://console.cloud.google.com/) ด้วยบัญชีผู้ดูแลของระบบ
2. สร้างโปรเจกต์ใหม่ชื่อ `BWORK-POS-Email-Service` หรือเลือกโปรเจกต์เดิมขององค์กร

### ขั้นตอนที่ 2: เปิดใช้งาน Gmail API
1. ไปที่เมนู **APIs & Services** > **Library**
2. ค้นหาคำว่า **Gmail API**
3. คลิก **Enable** เพื่อเปิดใช้งาน API ในโปรเจกต์

### ขั้นตอนที่ 3: กำหนดค่า OAuth Consent Screen (หน้ายินยอมสิทธิ์)
1. ไปที่ **APIs & Services** > **OAuth consent screen**
2. เลือก User Type:
   - **Internal** (หากใช้ Google Workspace โดเมนองค์กร)
   - หรือ **External** (หากใช้บัญชี `@gmail.com` ทั่วไป โดยตั้ง Publishing status เป็น Testing)
3. กรอกข้อมูลแอปพลิเคชัน:
   - **App name:** `B-WORK POS e-Tax Delivery`
   - **User support email:** `coworkings.bwork@gmail.com`
   - **Developer contact information:** `coworkings.bwork@gmail.com`
4. ในหน้า **Scopes**:
   - คลิก **Add or remove scopes**
   - ค้นหาและเลือกเฉพาะ: `https://www.googleapis.com/auth/gmail.send` (Send email on your behalf)
   - **คำเตือนความปลอดภัย:** ห้ามเลือก scope อื่นที่ไม่จำเป็น (เช่น `mail.google.com` หรือ `gmail.readonly`)
5. ในหน้า **Test users** (กรณี External - Testing):
   - เพิ่มอีเมล `coworkings.bwork@gmail.com` เป็น Test user

### ขั้นตอนที่ 4: สร้าง OAuth Client ID & Client Secret
1. ไปที่ **APIs & Services** > **Credentials**
2. คลิก **+ CREATE CREDENTIALS** > เลือก **OAuth client ID**
3. Application type: เลือก **Web application**
4. Name: `BWORK-POS-Gmail-Client`
5. ในส่วน **Authorized redirect URIs**:
   - เพิ่ม: `https://developers.google.com/oauthplayground` (สำหรับการขอ Refresh Token ครั้งแรก)
6. คลิก **Create**
7. คัดลอก **Client ID** และ **Client Secret** เก็บไว้ใน Password Manager ที่ปลอดภัย (ห้ามส่งในแชทหรือ Git)

---

## 3. ขั้นตอนการขอ OAuth2 Refresh Token

สามารถขอ Refresh Token ผ่าน Google OAuth 2.0 Playground ได้อย่างปลอดภัยตามขั้นตอนดังนี้:

1. เปิดเบราว์เซอร์ไปที่ [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. คลิกไอคอนฟันเฟือง **OAuth 2.0 configuration** (มุมขวาบน):
   - ตรวจสอบให้แน่ใจว่าเลือก **Use your own OAuth credentials**
   - กรอก **OAuth Client ID** ที่ได้จากขั้นตอนที่ 4
   - กรอก **OAuth Client secret** ที่ได้จากขั้นตอนที่ 4
3. ในแผงด้านซ้าย **Step 1: Select & authorize APIs**:
   - ในช่อง *Input your own scopes* พิมพ์: `https://www.googleapis.com/auth/gmail.send`
   - คลิกปุ่มสีฟ้า **Authorize APIs**
4. หน้าต่างลงชื่อเข้าใช้ Google จะปรากฏขึ้น:
   - ลงชื่อเข้าใช้ด้วยบัญชีผู้ส่ง: `coworkings.bwork@gmail.com`
   - หากมีข้อความเตือน "Google hasn't verified this app" ให้คลิก **Advanced** > **Go to B-WORK POS e-Tax Delivery (unsafe)**
   - ยืนยันการให้สิทธิ์การส่งอีเมล
5. ระบบจะพากลับมาที่ **Step 2: Exchange authorization code for tokens**:
   - คลิกปุ่มสีฟ้า **Exchange authorization code for tokens**
   - ระบบจะแสดงค่า:
     - `Refresh token` (ขึ้นต้นด้วย `1//...`)
     - `Access token`
6. คัดลอกค่า **Refresh token** เก็บไว้ทันที (ค่านี้จะใช้สำหรับต่ออายุ Access Token อัตโนมัติ)

---

## 4. การตั้งค่าบน Cloudflare Worker Secrets (Staging / Production)

การตั้งค่าบน Cloudflare Workers ต้องทำผ่านคำสั่ง `wrangler secret put` เท่านั้น โดยจะไม่เก็บค่าความลับในไฟล์โค้ดหรือ Git:

```bash
# 1. ติดตั้งหรือเข้าสู่โฟลเดอร์โปรเจกต์
cd backend

# 2. ตั้งค่า Client ID
npx wrangler secret put GMAIL_CLIENT_ID
# เมื่อระบบถาม ให้วางค่า Client ID แล้วกด Enter

# 3. ตั้งค่า Client Secret
npx wrangler secret put GMAIL_CLIENT_SECRET
# เมื่อระบบถาม ให้วางค่า Client Secret แล้วกด Enter

# 4. ตั้งค่า Refresh Token
npx wrangler secret put GMAIL_REFRESH_TOKEN
# เมื่อระบบถาม ให้วางค่า Refresh Token แล้วกด Enter

# 5. สวิตช์ความปลอดภัยหลัก (Master Safety Switch)
# หมายเหตุ: ค่าเริ่มต้นเป็น false ห้ามเปิดส่งจริงจนกว่าจะได้รับการอนุมัติ Release อย่างเป็นทางการ
npx wrangler secret put GMAIL_LIVE_DISPATCH_ENABLED
# ป้อนค่า: false

# 6. รายชื่ออีเมลที่อนุญาตใน Staging (Staging Recipient Allowlist)
npx wrangler secret put GMAIL_STAGING_ALLOWLIST
# ตัวอย่าง: admin@bwork.co,finance@bwork.co,@bwork.co
```

### การตรวจสอบ Secrets ที่กำหนดใน Worker (ไม่แสดงค่าความลับ)
```bash
npx wrangler secret list
```
ผลลัพธ์จะแสดงเฉพาะรายชื่อคีย์ความลับ:
```json
[
  { "name": "GMAIL_CLIENT_ID", "type": "secret_text" },
  { "name": "GMAIL_CLIENT_SECRET", "type": "secret_text" },
  { "name": "GMAIL_REFRESH_TOKEN", "type": "secret_text" },
  { "name": "GMAIL_LIVE_DISPATCH_ENABLED", "type": "secret_text" },
  { "name": "GMAIL_STAGING_ALLOWLIST", "type": "secret_text" }
]
```

---

## 5. การตั้งค่า Local / On-Premise Express Server (`backend/.env`)

สำหรับเครื่อง On-Premise หรือเครื่องพัฒนา ให้กำหนดค่าในไฟล์ `backend/.env` (ซึ่งถูก `.gitignore` ไว้แล้ว):

```ini
# ==========================================
# Gmail API OAuth2 Configuration (DO NOT COMMIT)
# ==========================================
GMAIL_SENDER_NAME="บริษัท บิลท์ ฮาร์ท จำกัด"
GMAIL_USER_EMAIL=coworkings.bwork@gmail.com
GMAIL_REPLY_TO=coworkings.bwork@gmail.com

GMAIL_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-google-client-secret
GMAIL_REFRESH_TOKEN=your-google-refresh-token

# Master Switch: เริ่มต้นเป็น false เสมอ
GMAIL_LIVE_DISPATCH_ENABLED=false

# Staging Allowlist (คั่นด้วยคอมมา)
GMAIL_STAGING_ALLOWLIST=admin@bwork.co,finance@bwork.co,@bwork.co
```

---

## 6. กติกาความปลอดภัยและการจัดการสถานะ (Status Lifecycle & Fallback)

| สถานะ | ความหมาย | พฤติกรรมระบบ | การแสดงผลบน UI |
| :--- | :--- | :--- | :--- |
| `unsent` | ยังไม่ได้ส่ง | เอกสารออกแล้วแต่ยังไม่เริ่มส่ง | Badge สีเทา "ยังไม่ได้ส่ง" |
| `claiming` | กำลังล็อกคำขอส่ง | ล็อกด้วย Atomic SQL (`WHERE email_status IN (...)`) ป้องกันกดซ้ำ | Badge สีน้ำเงิน "กำลังส่งเข้าคิว..." |
| `dry_run` | จำลองการส่งสำเร็จ | สร้าง MIME payload ตรวจสอบความถูกต้อง ไม่เรียก Gmail API | Badge สีฟ้า "จำลองส่งแล้ว (Dry-run)" |
| `gmail_accepted` | Gmail API รับคำขอแล้ว | Gmail API ตอบกลับ HTTP 200 พร้อม Message ID เข้าคิวส่งของ Gmail | Badge สีเขียว "Gmail รับคำขอแล้ว" (มี Subtext ระบุรอการนำส่งตามคิว) |
| `uncertain` | ผลส่งไม่แน่นอน / Timeout | เครือข่ายขัดข้องหรือ Timeout หลังส่ง **ไม่ retry อัตโนมัติเด็ดขาด** | Badge สีส้ม "ผลส่งไม่แน่นอน (Uncertain / Timeout)" |
| `failed` | ส่งไม่สำเร็จ | ได้รับ Error ชัดเจนจาก Gmail API หรือไฟล์ไม่ถูกต้อง | Badge สีแดง "ส่งไม่สำเร็จ (Failed)" |

> [!CAUTION]
> **ข้อกำหนดเด็ดขาด:** ห้ามแสดงข้อความ "ลูกค้าได้รับแล้ว" หรือ "Delivered" จากการที่ Gmail API ตอบ 200 เด็ดขาด เนื่องจาก Gmail API เป็นระบบ Asynchronous Queue การได้ 200 แปลว่า Gmail รับคำขอเข้าคิวส่งแล้วเท่านั้น การแสดงผลต้องใช้คำว่า **"Gmail รับคำขอแล้ว"** เท่านั้น

---

## 7. แผนการตรวจสอบและฉุกเฉิน (Audit Trail & Emergency Killswitch)

### การตรวจสอบ Audit Trail ในฐานข้อมูล
ระบบบันทึกประวัติการส่งทุกครั้งลงในตาราง `tax_invoice_email_logs` และ `booking_history`:
```sql
-- ตรวจสอบประวัติการส่งอีเมลของรายการจอง
SELECT id, booking_id, recipient_email, status, is_dry_run, message_id, dispatched_by, created_at 
FROM tax_invoice_email_logs 
WHERE booking_id = ? 
ORDER BY id DESC;

-- ตรวจสอบสถานะเอกสารใบกำกับภาษี
SELECT id, invoice_number, email_status, email_sent_at, email_dry_run, email_message_id, email_error 
FROM tax_invoices 
WHERE id = ?;
```

### สวิตช์ปิดฉุกเฉินทันที (Emergency Killswitch)
หากตรวจพบความผิดปกติ เช่น อีเมลส่งซ้ำ หรือปัญหาทางเทคนิค สามารถตัดการส่งจริงได้ทันที 100% โดยรันคำสั่ง:
```bash
# ปิดการส่งจริงบน Cloudflare Worker ทันที
npx wrangler secret put GMAIL_LIVE_DISPATCH_ENABLED
# ป้อนค่า: false
```
เมื่อสวิตช์นี้เป็น `false` ระบบทั้งหมดจะ fallback กลับไปเป็น **Dry-run โดยอัตโนมัติ** และปฏิเสธคำขอส่งจริงทุกกรณี
