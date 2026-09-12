import React, { useState } from 'react';
import {
  Smartphone, Monitor, Code, Copy, Check, CheckCircle2,
  KeyRound, CalendarClock, Ban, Clock, Droplets
} from 'lucide-react';

// ==============================================================================
// 1. ASSET DEFINITIONS & SAFE MOCK DATA (NO DB REQUIRED)
// ==============================================================================
export const LOGO_ASSET_PATH = '/BWORK-LOGO.png';
export const LOGO_PRODUCTION_PUBLIC_URL = 'https://bwork-booking.pages.dev/BWORK-LOGO.png';

// Exact Banner Mapping as specified in Section 2 (with on-disk fallback support)
export const BANNER_MAPPING = {
  confirmation: {
    expected: '/line-banners/bwork-booking-confirmation-banner.png',
    actual: '/line-banners/bwork_meeting_confirmation_banner.png.png',
    prodUrl: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-confirmation-banner.png',
    position: 'center'
  },
  pin: {
    expected: '/line-banners/bwork-door-pin-banner.png',
    actual: '/line-banners/bwork_access_code_ready_banner.png.png',
    prodUrl: 'https://bwork-booking.pages.dev/line-banners/bwork-door-pin-banner.png',
    position: 'center'
  },
  reschedule: {
    expected: '/line-banners/bwork-booking-update-banner.png',
    actual: '/line-banners/luxury_bwork_booking_update_banner.png.png',
    prodUrl: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-update-banner.png',
    position: 'center'
  },
  cancellation: {
    expected: '/line-banners/bwork-booking-cancel-banner.png',
    actual: '/line-banners/bwork_booking_cancellation_banner.png.png',
    prodUrl: 'https://bwork-booking.pages.dev/line-banners/bwork-booking-cancel-banner.png',
    position: 'center'
  },
  credit: {
    expected: '/line-banners/bwork-hour-credit-banner.png',
    actual: '/line-banners/remaining_credit_in_deep_indigo.png.png',
    prodUrl: 'https://bwork-booking.pages.dev/line-banners/bwork-hour-credit-banner.png',
    position: 'center'
  }
};

export const MOCK_DATA = {
  customerName: "คุณสมชาย ใจดี",
  bookingCode: "BK-DEMO-001",
  roomName: "Jupiter (300)",
  serviceDate: "15/09/2026",
  startTime: "13:00",
  endTime: "15:00",
  displayTime: "13:00 - 15:00 น.",
  oldTime: "15/09/2026 13:00 - 14:00",
  newTime: "15/09/2026 14:00 - 15:00",
  totalAmount: 1600,
  pinCode: "123456",
  cancelReason: "หมดเวลาการชำระเงิน",
  creditId: "HC-260912-0001",
  remainingCredit: "05 ชม. 30 นาที",
  creditIssuedDate: "12/09/2026",
  statusUrl: "https://bwork-booking.pages.dev/status"
};

// ==============================================================================
// 2. LINE FLEX MESSAGE JSON BUILDERS (BANNER-HEADER SYSTEM, NO DUPLICATE LOGO)
// ==============================================================================
export const buildConfirmationJson = (data = MOCK_DATA) => ({
  type: "bubble",
  size: "mega",
  hero: {
    type: "image",
    url: BANNER_MAPPING.confirmation.prodUrl,
    size: "full",
    aspectRatio: "3:1",
    aspectMode: "cover"
  },
  body: {
    type: "box",
    layout: "vertical",
    paddingAll: "20px",
    contents: [
      {
        type: "text",
        text: "ยืนยันการจอง",
        size: "xl",
        weight: "bold",
        color: "#0f172a"
      },
      {
        type: "text",
        text: "การจองห้องประชุมของคุณเสร็จสมบูรณ์",
        size: "xs",
        color: "#64748b",
        margin: "xs"
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        spacing: "sm",
        contents: [
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "รหัสการจอง", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.bookingCode, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "ชื่อลูกค้า", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.customerName, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "ห้องประชุม", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.roomName, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "วันที่ใช้งาน", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.serviceDate, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "เวลา", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.displayTime, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] }
        ]
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        paddingAll: "14px",
        backgroundColor: "#ecfdf5",
        cornerRadius: "10px",
        borderWidth: "1px",
        borderColor: "#a7f3d0",
        contents: [
          {
            type: "box",
            layout: "baseline",
            contents: [
              { type: "text", text: "สถานะการชำระเงิน", size: "xs", color: "#065f46", flex: 3 },
              { type: "text", text: "ชำระแล้ว", size: "xs", weight: "bold", color: "#059669", align: "end", flex: 2 }
            ]
          },
          {
            type: "text",
            text: "สามารถรับรหัสเข้าห้องเมื่อถึงเวลาใช้งาน หรือติดต่อเคาน์เตอร์ประชาสัมพันธ์",
            size: "xxs",
            color: "#047857",
            wrap: true,
            margin: "sm"
          }
        ]
      },
      {
        type: "image",
        url: LOGO_PRODUCTION_PUBLIC_URL,
        size: "xs",
        aspectRatio: "550:207",
        aspectMode: "fit",
        margin: "xl",
        align: "center"
      }
    ]
  },
  footer: {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    contents: [
      {
        type: "button",
        action: { type: "uri", label: "ดูรายละเอียดการจอง", uri: data.statusUrl },
        style: "primary",
        color: "#065f46",
        height: "md"
      }
    ]
  }
});

export const buildDoorPinJson = (data = MOCK_DATA) => ({
  type: "bubble",
  size: "mega",
  hero: {
    type: "image",
    url: BANNER_MAPPING.pin.prodUrl,
    size: "full",
    aspectRatio: "3:1",
    aspectMode: "cover"
  },
  body: {
    type: "box",
    layout: "vertical",
    paddingAll: "20px",
    contents: [
      {
        type: "text",
        text: "รหัสเข้าห้อง",
        size: "xl",
        weight: "bold",
        color: "#0f172a"
      },
      {
        type: "text",
        text: "กดรหัสผ่านที่ประตูก่อนเข้าใช้งานห้องประชุม",
        size: "xs",
        color: "#64748b",
        margin: "xs"
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        spacing: "sm",
        contents: [
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "ห้องประชุม", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.roomName, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "วันที่ใช้งาน", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.serviceDate, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "เวลา", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.displayTime, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] }
        ]
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        paddingAll: "16px",
        backgroundColor: "#f0f9ff",
        cornerRadius: "12px",
        borderWidth: "1px",
        borderColor: "#bae6fd",
        alignItems: "center",
        contents: [
          { type: "text", text: "รหัสเข้าห้อง (PIN)", size: "xs", weight: "bold", color: "#0369a1", align: "center" },
          { type: "text", text: data.pinCode, size: "3xl", weight: "bold", color: "#0f172a", align: "center", margin: "xs" },
          { type: "text", text: "กดรหัส 6 หลัก ตามด้วย #", size: "xs", weight: "bold", color: "#0f172a", align: "center", margin: "xs" },
          { type: "text", text: "รหัสนี้ใช้ได้เฉพาะในวันและเวลาที่จอง", size: "xxs", color: "#64748b", align: "center", margin: "xs" }
        ]
      },
      {
        type: "image",
        url: LOGO_PRODUCTION_PUBLIC_URL,
        size: "xs",
        aspectRatio: "550:207",
        aspectMode: "fit",
        margin: "xl",
        align: "center"
      }
    ]
  },
  footer: {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    contents: [
      {
        type: "button",
        action: { type: "uri", label: "ดูรายละเอียดการจอง", uri: data.statusUrl },
        style: "primary",
        color: "#0284c7",
        height: "md"
      }
    ]
  }
});

export const buildRescheduleJson = (data = MOCK_DATA) => ({
  type: "bubble",
  size: "mega",
  hero: {
    type: "image",
    url: BANNER_MAPPING.reschedule.prodUrl,
    size: "full",
    aspectRatio: "3:1",
    aspectMode: "cover"
  },
  body: {
    type: "box",
    layout: "vertical",
    paddingAll: "20px",
    contents: [
      {
        type: "text",
        text: "เปลี่ยนแปลงการจอง",
        size: "xl",
        weight: "bold",
        color: "#0f172a"
      },
      {
        type: "text",
        text: "รายละเอียดวันและเวลาใช้งานใหม่ของคุณ",
        size: "xs",
        color: "#64748b",
        margin: "xs"
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        spacing: "sm",
        contents: [
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "รหัสการจอง", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.bookingCode, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "ห้องประชุม", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.roomName, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] }
        ]
      },
      {
        type: "box",
        layout: "vertical",
        margin: "md",
        paddingAll: "14px",
        backgroundColor: "#f8fafc",
        cornerRadius: "10px",
        borderWidth: "1px",
        borderColor: "#e2e8f0",
        contents: [
          { type: "text", text: "เดิม", size: "xs", color: "#94a3b8", weight: "bold" },
          { type: "text", text: data.oldTime, size: "xs", color: "#94a3b8", decoration: "line-through", margin: "xs" },
          { type: "separator", margin: "sm" },
          { type: "text", text: "ใหม่", size: "xs", weight: "bold", color: "#1e3a8a", margin: "sm" },
          { type: "text", text: data.newTime, size: "sm", weight: "bold", color: "#1e3a8a", margin: "xs" },
          { type: "text", text: `ยอดชำระใหม่: ฿${data.totalAmount.toLocaleString()}`, size: "xs", color: "#0f172a", weight: "bold", margin: "sm" }
        ]
      },
      {
        type: "text",
        text: "กรุณารับรหัสเข้าห้องใหม่สำหรับช่วงเวลาที่เปลี่ยนแปลง",
        size: "xxs",
        color: "#1e40af",
        margin: "sm"
      },
      {
        type: "image",
        url: LOGO_PRODUCTION_PUBLIC_URL,
        size: "xs",
        aspectRatio: "550:207",
        aspectMode: "fit",
        margin: "xl",
        align: "center"
      }
    ]
  },
  footer: {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    contents: [
      {
        type: "button",
        action: { type: "uri", label: "ดูรายละเอียดการจอง", uri: data.statusUrl },
        style: "primary",
        color: "#1e3a8a",
        height: "md"
      }
    ]
  }
});

export const buildCancellationJson = (data = MOCK_DATA) => ({
  type: "bubble",
  size: "mega",
  hero: {
    type: "image",
    url: BANNER_MAPPING.cancellation.prodUrl,
    size: "full",
    aspectRatio: "3:1",
    aspectMode: "cover"
  },
  body: {
    type: "box",
    layout: "vertical",
    paddingAll: "20px",
    contents: [
      {
        type: "text",
        text: "ยกเลิกการจอง",
        size: "xl",
        weight: "bold",
        color: "#0f172a"
      },
      {
        type: "text",
        text: "รายการจองห้องประชุมถูกยกเลิกเรียบร้อย",
        size: "xs",
        color: "#64748b",
        margin: "xs"
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        spacing: "sm",
        contents: [
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "ห้องประชุม", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.roomName, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "วันที่ใช้งาน", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.serviceDate, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "เวลา", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.displayTime, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] }
        ]
      },
      {
        type: "box",
        layout: "vertical",
        margin: "md",
        paddingAll: "14px",
        backgroundColor: "#fef2f2",
        cornerRadius: "10px",
        borderWidth: "1px",
        borderColor: "#fecaca",
        contents: [
          { type: "text", text: "เหตุผลในการยกเลิก", size: "xs", weight: "bold", color: "#991b1b" },
          { type: "text", text: data.cancelReason, size: "sm", weight: "bold", color: "#991b1b", margin: "xs" }
        ]
      },
      {
        type: "text",
        text: "หากต้องการจองห้องประชุมใหม่ เรายินดีให้บริการเสมอ",
        size: "xxs",
        color: "#64748b",
        margin: "sm"
      },
      {
        type: "image",
        url: LOGO_PRODUCTION_PUBLIC_URL,
        size: "xs",
        aspectRatio: "550:207",
        aspectMode: "fit",
        margin: "xl",
        align: "center"
      }
    ]
  },
  footer: {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    contents: [
      {
        type: "button",
        action: { type: "uri", label: "จองห้องใหม่", uri: "https://bwork-booking.pages.dev" },
        style: "primary",
        color: "#991b1b",
        height: "md"
      }
    ]
  }
});

export const buildHourCreditJson = (data = MOCK_DATA) => ({
  type: "bubble",
  size: "mega",
  hero: {
    type: "image",
    url: BANNER_MAPPING.credit.prodUrl,
    size: "full",
    aspectRatio: "3:1",
    aspectMode: "cover"
  },
  body: {
    type: "box",
    layout: "vertical",
    paddingAll: "20px",
    contents: [
      {
        type: "text",
        text: "เครดิตชั่วโมง",
        size: "xl",
        weight: "bold",
        color: "#0f172a"
      },
      {
        type: "text",
        text: "สิทธิ์ชั่วโมงคงเหลือสำหรับใช้บริการห้องประชุม",
        size: "xs",
        color: "#64748b",
        margin: "xs"
      },
      {
        type: "box",
        layout: "vertical",
        margin: "lg",
        spacing: "sm",
        contents: [
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "Credit ID", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.creditId, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "ห้องอ้างอิง", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.roomName, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] },
          { type: "box", layout: "baseline", contents: [{ type: "text", text: "วันที่ออกเครดิต", color: "#64748b", size: "sm", flex: 3 }, { type: "text", text: data.creditIssuedDate, color: "#0f172a", size: "sm", weight: "bold", flex: 4, align: "end" }] }
        ]
      },
      {
        type: "box",
        layout: "vertical",
        margin: "md",
        paddingAll: "16px",
        backgroundColor: "#f0fdf4",
        cornerRadius: "10px",
        borderWidth: "1px",
        borderColor: "#bbf7d0",
        alignItems: "center",
        contents: [
          { type: "text", text: "จำนวนชั่วโมงคงเหลือ", size: "xs", weight: "bold", color: "#166534" },
          { type: "text", text: data.remainingCredit, size: "3xl", weight: "bold", color: "#15803d", margin: "xs" }
        ]
      },
      {
        type: "text",
        text: "สามารถใช้กับห้องที่เข้าเงื่อนไขอัตราค่าบริการเดียวกัน",
        size: "xxs",
        color: "#64748b",
        align: "center",
        margin: "sm"
      },
      {
        type: "image",
        url: LOGO_PRODUCTION_PUBLIC_URL,
        size: "xs",
        aspectRatio: "550:207",
        aspectMode: "fit",
        margin: "xl",
        align: "center"
      }
    ]
  },
  footer: {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    contents: [
      {
        type: "button",
        action: { type: "message", label: "แสดง Credit ID", text: data.creditId },
        style: "primary",
        color: "#312e81",
        height: "md"
      }
    ]
  }
});

// ==============================================================================
// 3. CARD CONFIGURATIONS (EXACT BANNER MAPPINGS, ALT TEXT, CTAS)
// ==============================================================================
export const CARDS_CONFIG = [
  {
    id: 'confirmation',
    tabName: '1. ยืนยันการจอง',
    shortTitle: 'ยืนยันการจอง',
    icon: CheckCircle2,
    bannerUrl: BANNER_MAPPING.confirmation.expected,
    fallbackBannerUrl: BANNER_MAPPING.confirmation.actual,
    bannerPosition: BANNER_MAPPING.confirmation.position,
    accentColor: '#065f46',
    ctaColor: '#065f46',
    ctaLabel: 'ดูรายละเอียดการจอง',
    altText: `ยืนยันการจองสำเร็จ - ${MOCK_DATA.roomName} - ${MOCK_DATA.bookingCode}`,
    jsonBuilder: buildConfirmationJson
  },
  {
    id: 'pin',
    tabName: '2. รหัสเข้าห้อง',
    shortTitle: 'รหัสเข้าห้อง',
    icon: KeyRound,
    bannerUrl: BANNER_MAPPING.pin.expected,
    fallbackBannerUrl: BANNER_MAPPING.pin.actual,
    bannerPosition: BANNER_MAPPING.pin.position,
    accentColor: '#0369a1',
    ctaColor: '#0284c7',
    ctaLabel: 'ดูรายละเอียดการจอง',
    altText: `รหัสเข้าห้อง ${MOCK_DATA.roomName}`,
    jsonBuilder: buildDoorPinJson
  },
  {
    id: 'reschedule',
    tabName: '3. เปลี่ยนแปลงการจอง',
    shortTitle: 'เปลี่ยนแปลงการจอง',
    icon: CalendarClock,
    bannerUrl: BANNER_MAPPING.reschedule.expected,
    fallbackBannerUrl: BANNER_MAPPING.reschedule.actual,
    bannerPosition: BANNER_MAPPING.reschedule.position,
    accentColor: '#1e3a8a',
    ctaColor: '#1e3a8a',
    ctaLabel: 'ดูรายละเอียดการจอง',
    altText: `แจ้งเปลี่ยนแปลงการจอง ${MOCK_DATA.roomName} - ${MOCK_DATA.bookingCode}`,
    jsonBuilder: buildRescheduleJson
  },
  {
    id: 'cancellation',
    tabName: '4. ยกเลิกการจอง',
    shortTitle: 'ยกเลิกการจอง',
    icon: Ban,
    bannerUrl: BANNER_MAPPING.cancellation.expected,
    fallbackBannerUrl: BANNER_MAPPING.cancellation.actual,
    bannerPosition: BANNER_MAPPING.cancellation.position,
    accentColor: '#991b1b',
    ctaColor: '#991b1b',
    ctaLabel: 'จองห้องใหม่',
    altText: `แจ้งยกเลิกการจอง ${MOCK_DATA.roomName} - ${MOCK_DATA.bookingCode}`,
    jsonBuilder: buildCancellationJson
  },
  {
    id: 'credit',
    tabName: '5. เครดิตชั่วโมง',
    shortTitle: 'เครดิตชั่วโมง',
    icon: Clock,
    bannerUrl: BANNER_MAPPING.credit.expected,
    fallbackBannerUrl: BANNER_MAPPING.credit.actual,
    bannerPosition: BANNER_MAPPING.credit.position,
    accentColor: '#312e81',
    ctaColor: '#312e81',
    ctaLabel: 'แสดง Credit ID',
    altText: `เครดิตชั่วโมงคงเหลือ ${MOCK_DATA.creditId} - ${MOCK_DATA.remainingCredit}`,
    jsonBuilder: buildHourCreditJson
  }
];

// ==============================================================================
// 4. SHARED SUBCOMPONENTS (BANNER IMAGE, WATERMARK)
// ==============================================================================

const CardBannerImage = ({ card }) => {
  const [imgSrc, setImgSrc] = useState(card.bannerUrl);

  const handleError = () => {
    // If the expected path returns 404 or HTML fallback, load the actual on-disk asset
    if (card.fallbackBannerUrl && imgSrc !== card.fallbackBannerUrl) {
      setImgSrc(card.fallbackBannerUrl);
    }
  };

  return (
    <div style={{
      width: '100%',
      aspectRatio: '3 / 1',
      overflow: 'hidden',
      backgroundColor: '#f1f5f9',
      position: 'relative',
      lineHeight: 0
    }}>
      <img
        src={imgSrc}
        alt={card.shortTitle}
        onError={handleError}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: card.bannerPosition || 'center',
          display: 'block'
        }}
      />
    </div>
  );
};

const CardWatermark = ({ visible = true }) => {
  if (!visible) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '14px 0 2px', pointerEvents: 'none', userSelect: 'none' }}>
      <img
        src={LOGO_ASSET_PATH}
        alt="B-WORK Watermark"
        style={{
          width: '124px',
          height: 'auto',
          opacity: 0.06,
          filter: 'grayscale(100%)',
          display: 'block',
          objectFit: 'contain'
        }}
      />
    </div>
  );
};

const CorporateFlexBubble = ({ card, data = MOCK_DATA, showWatermark = true }) => {
  return (
    <div
      className="line-flex-bubble"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
        fontFamily: "'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif",
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* A. BANNER IMAGE (Full-width, top visual header with integrated B-WORK branding) */}
      <CardBannerImage card={card} />

      {/* B. MAIN TITLE & SUPPORTING TEXT (Thai title directly below banner) */}
      <div style={{ padding: '18px 22px 6px', backgroundColor: '#ffffff' }}>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', lineHeight: '1.25' }}>
          {card.shortTitle}
        </div>
        <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '3px' }}>
          {card.id === 'confirmation' && 'การจองห้องประชุมของคุณเสร็จสมบูรณ์'}
          {card.id === 'pin' && 'กดรหัสผ่านที่ประตูก่อนเข้าใช้งานห้องประชุม'}
          {card.id === 'reschedule' && 'รายละเอียดวันและเวลาใช้งานใหม่ของคุณ'}
          {card.id === 'cancellation' && 'รายการจองห้องประชุมถูกยกเลิกเรียบร้อย'}
          {card.id === 'credit' && 'สิทธิ์ชั่วโมงคงเหลือสำหรับใช้บริการห้องประชุม'}
        </div>
      </div>

      {/* C. MAIN INFORMATION & D. PRIMARY HIGHLIGHT BLOCK */}
      <div style={{ padding: '12px 22px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {card.id === 'confirmation' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>รหัสการจอง</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.bookingCode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>ชื่อลูกค้า</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.customerName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>ห้องประชุม</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.roomName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>วันที่ใช้งาน</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.serviceDate}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>เวลา</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.displayTime}</span>
              </div>
            </div>

            {/* Primary Highlight: Payment status block */}
            <div style={{ marginTop: '16px', padding: '12px 14px', backgroundColor: '#ecfdf5', borderRadius: '10px', border: '1px solid #a7f3d0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#065f46', fontWeight: 600 }}>สถานะการชำระเงิน</span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#059669', backgroundColor: '#ffffff', padding: '2px 8px', borderRadius: '6px', border: '1px solid #a7f3d0' }}>
                  ชำระแล้ว
                </span>
              </div>
              <div style={{ fontSize: '11.5px', color: '#047857', marginTop: '6px', lineHeight: '1.4' }}>
                สามารถรับรหัสเข้าห้องเมื่อถึงเวลาใช้งาน หรือติดต่อเคาน์เตอร์ประชาสัมพันธ์
              </div>
            </div>
          </div>
        )}

        {card.id === 'pin' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>ห้องประชุม</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.roomName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>วันที่ใช้งาน</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.serviceDate}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>เวลา</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.displayTime}</span>
              </div>
            </div>

            {/* Primary Highlight: Large PIN Block */}
            <div style={{ marginTop: '16px', padding: '16px 14px', backgroundColor: '#f0f9ff', borderRadius: '12px', border: '1px solid #bae6fd', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#0369a1', letterSpacing: '0.5px' }}>
                รหัสเข้าห้อง (PIN)
              </div>
              <div style={{ fontSize: '36px', fontWeight: 900, color: '#0f172a', letterSpacing: '6px', margin: '6px 0', fontFamily: 'monospace' }}>
                {data.pinCode}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                กดรหัส 6 หลัก ตามด้วย #
              </div>
              <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '3px' }}>
                รหัสนี้ใช้ได้เฉพาะในวันและเวลาที่จอง
              </div>
            </div>
          </div>
        )}

        {card.id === 'reschedule' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>รหัสการจอง</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.bookingCode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>ห้องประชุม</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.roomName}</span>
              </div>
            </div>

            {/* Primary Highlight: Comparison Layout */}
            <div style={{ marginTop: '14px', padding: '14px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 700 }}>เดิม</div>
              <div style={{ fontSize: '12.5px', color: '#94a3b8', textDecoration: 'line-through', marginTop: '2px' }}>
                {data.oldTime}
              </div>

              <div style={{ borderTop: '1px dashed #cbd5e1', margin: '8px 0' }} />

              <div style={{ fontSize: '12px', color: '#1e3a8a', fontWeight: 800 }}>ใหม่</div>
              <div style={{ fontSize: '14px', color: '#1e3a8a', fontWeight: 800, marginTop: '2px' }}>
                {data.newTime}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #e2e8f0', fontSize: '12.5px' }}>
                <span style={{ color: '#64748b' }}>ยอดชำระใหม่</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>฿{data.totalAmount.toLocaleString()}</span>
              </div>
            </div>

            <div style={{ fontSize: '11.5px', color: '#1e40af', marginTop: '10px', textAlign: 'center' }}>
              กรุณารับรหัสเข้าห้องใหม่สำหรับช่วงเวลาที่เปลี่ยนแปลง
            </div>
          </div>
        )}

        {card.id === 'cancellation' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>ห้องประชุม</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.roomName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>วันที่ใช้งาน</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.serviceDate}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>เวลา</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.displayTime}</span>
              </div>
            </div>

            {/* Primary Highlight: Cancellation Reason */}
            <div style={{ marginTop: '16px', padding: '14px', backgroundColor: '#fef2f2', borderRadius: '10px', border: '1px solid #fecaca' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#991b1b' }}>เหตุผลในการยกเลิก</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#991b1b', marginTop: '3px' }}>
                {data.cancelReason}
              </div>
            </div>

            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '12px', textAlign: 'center', lineHeight: '1.4' }}>
              หากต้องการจองห้องประชุมใหม่ เรายินดีให้บริการเสมอ
            </div>
          </div>
        )}

        {card.id === 'credit' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>Credit ID</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.creditId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>ห้องอ้างอิง</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.roomName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' }}>
                <span style={{ color: '#64748b' }}>วันที่ออกเครดิต</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{data.creditIssuedDate}</span>
              </div>
            </div>

            {/* Primary Highlight: Hour Credit Balance */}
            <div style={{ marginTop: '16px', padding: '16px 14px', backgroundColor: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#166534' }}>
                จำนวนชั่วโมงคงเหลือ
              </div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: '#15803d', margin: '4px 0' }}>
                {data.remainingCredit}
              </div>
            </div>

            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '10px', textAlign: 'center' }}>
              สามารถใช้กับห้องที่เข้าเงื่อนไขอัตราค่าบริการเดียวกัน
            </div>
          </div>
        )}

        {/* E. BWORK WATERMARK (5-8% opacity, lower body, never behind key values) */}
        <CardWatermark visible={showWatermark} />
      </div>

      {/* F. FOOTER CTA BUTTON (Single Full-Width Button, 44px height, No Emoji) */}
      <div style={{ padding: '0 22px 20px', marginTop: 'auto' }}>
        {card.id === 'credit' ? (
          <button
            type="button"
            onClick={() => navigator.clipboard && navigator.clipboard.writeText(data.creditId)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '44px', backgroundColor: card.ctaColor, color: '#ffffff', borderRadius: '9px', fontWeight: 700, fontSize: '14.5px', border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
          >
            <span>{card.ctaLabel}</span>
          </button>
        ) : (
          <a
            href={card.id === 'cancellation' ? 'https://bwork-booking.pages.dev' : data.statusUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '44px', backgroundColor: card.ctaColor, color: '#ffffff', borderRadius: '9px', fontWeight: 700, fontSize: '14.5px', textDecoration: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
          >
            <span>{card.ctaLabel}</span>
          </a>
        )}
      </div>
    </div>
  );
};

// ==============================================================================
// 5. MAIN PREVIEW SANDBOX PAGE
// ==============================================================================

export default function LinePreview() {
  const [selectedTab, setSelectedTab] = useState('all');
  const [deviceWidth, setDeviceWidth] = useState('380px');
  const [bgTheme, setBgTheme] = useState('line-chat');
  const [showJson, setShowJson] = useState(false);
  const [watermarkOn, setWatermarkOn] = useState(true);
  const [copiedAltId, setCopiedAltId] = useState(null);

  const handleCopyAltText = (cardId, text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedAltId(cardId);
      setTimeout(() => setCopiedAltId(null), 2000);
    }
  };

  const getCanvasBg = () => {
    switch (bgTheme) {
      case 'line-chat':
        return '#849ebf';
      case 'light':
        return '#f1f5f9';
      case 'dark':
        return '#0f172a';
      default:
        return '#849ebf';
    }
  };

  const displayedCards = selectedTab === 'all'
    ? CARDS_CONFIG
    : CARDS_CONFIG.filter(c => c.id === selectedTab);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8fafc', color: '#1e293b', fontFamily: "'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* TOP CONTROLS NAVBAR */}
      <header style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '12px 20px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          {/* Brand & Sandbox Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src={LOGO_ASSET_PATH}
              alt="B-WORK"
              style={{ width: '42px', height: 'auto', objectFit: 'contain' }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: '#0f172a' }}>LINE OA Card Design Sandbox</h1>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}>
                  BANNER-HEADER SYSTEM (3:1)
                </span>
              </div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                3:1 Banner Header + Clean White Body + Aligned CTA (No Duplicate Logo, No Emoji)
              </p>
            </div>
          </div>

          {/* Quick View Controls */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            {/* Watermark Toggle */}
            <button
              type="button"
              onClick={() => setWatermarkOn(!watermarkOn)}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '8px', border: '1px solid', borderColor: watermarkOn ? '#0284c7' : '#cbd5e1', backgroundColor: watermarkOn ? '#f0f9ff' : '#ffffff', color: watermarkOn ? '#0284c7' : '#64748b', fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s ease' }}
              title="เปิด/ปิด ลายน้ำ B-WORK"
            >
              <Droplets size={14} />
              <span>ลายน้ำ: {watermarkOn ? 'เปิด' : 'ปิด'}</span>
            </button>

            {/* Width Selector */}
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={() => setDeviceWidth('360px')}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 9px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: deviceWidth === '360px' ? 700 : 500, backgroundColor: deviceWidth === '360px' ? '#ffffff' : 'transparent', color: deviceWidth === '360px' ? '#0f172a' : '#64748b', cursor: 'pointer', boxShadow: deviceWidth === '360px' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                title="Mobile Compact (360px)"
              >
                <Smartphone size={13} />
                <span>360px</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceWidth('380px')}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 9px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: deviceWidth === '380px' ? 700 : 500, backgroundColor: deviceWidth === '380px' ? '#ffffff' : 'transparent', color: deviceWidth === '380px' ? '#0f172a' : '#64748b', cursor: 'pointer', boxShadow: deviceWidth === '380px' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                title="Mobile Standard (380-390px)"
              >
                <Smartphone size={13} />
                <span>380px</span>
              </button>
              <button
                type="button"
                onClick={() => setDeviceWidth('100%')}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 9px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: deviceWidth === '100%' ? 700 : 500, backgroundColor: deviceWidth === '100%' ? '#ffffff' : 'transparent', color: deviceWidth === '100%' ? '#0f172a' : '#64748b', cursor: 'pointer', boxShadow: deviceWidth === '100%' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
                title="Grid / Full Canvas"
              >
                <Monitor size={13} />
                <span>Grid</span>
              </button>
            </div>

            {/* Background Theme Selector */}
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <button
                type="button"
                onClick={() => setBgTheme('line-chat')}
                style={{ padding: '5px 9px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: bgTheme === 'line-chat' ? 700 : 500, backgroundColor: bgTheme === 'line-chat' ? '#ffffff' : 'transparent', color: bgTheme === 'line-chat' ? '#0369a1' : '#64748b', cursor: 'pointer', boxShadow: bgTheme === 'line-chat' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
              >
                LINE Chat
              </button>
              <button
                type="button"
                onClick={() => setBgTheme('light')}
                style={{ padding: '5px 9px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: bgTheme === 'light' ? 700 : 500, backgroundColor: bgTheme === 'light' ? '#ffffff' : 'transparent', color: bgTheme === 'light' ? '#0f172a' : '#64748b', cursor: 'pointer', boxShadow: bgTheme === 'light' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => setBgTheme('dark')}
                style={{ padding: '5px 9px', borderRadius: '6px', border: 'none', fontSize: '12px', fontWeight: bgTheme === 'dark' ? 700 : 500, backgroundColor: bgTheme === 'dark' ? '#ffffff' : 'transparent', color: bgTheme === 'dark' ? '#0f172a' : '#64748b', cursor: 'pointer', boxShadow: bgTheme === 'dark' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}
              >
                Dark
              </button>
            </div>

            {/* Toggle JSON view */}
            <button
              type="button"
              onClick={() => setShowJson(!showJson)}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: showJson ? '#0f172a' : '#ffffff', color: showJson ? '#ffffff' : '#334155', fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s ease' }}
            >
              <Code size={14} />
              <span>{showJson ? 'ซ่อน JSON' : 'ดู JSON Schema'}</span>
            </button>
          </div>
        </div>

        {/* Card Navigation Tabs */}
        <div style={{ maxWidth: '1440px', margin: '10px auto 0', display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
          <button
            type="button"
            onClick={() => setSelectedTab('all')}
            style={{ padding: '6px 14px', borderRadius: '20px', border: '1px solid', borderColor: selectedTab === 'all' ? '#0f172a' : '#e2e8f0', backgroundColor: selectedTab === 'all' ? '#0f172a' : '#ffffff', color: selectedTab === 'all' ? '#ffffff' : '#475569', fontSize: '13px', fontWeight: selectedTab === 'all' ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease' }}
          >
            ทั้งหมด (Comparison Grid)
          </button>
          {CARDS_CONFIG.map(c => {
            const Icon = c.icon;
            const isSelected = selectedTab === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedTab(c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px', border: '1px solid', borderColor: isSelected ? '#0f172a' : '#e2e8f0', backgroundColor: isSelected ? '#0f172a' : '#ffffff', color: isSelected ? '#ffffff' : '#475569', fontSize: '13px', fontWeight: isSelected ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease' }}
              >
                <Icon size={14} />
                <span>{c.tabName}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* CANVAS AREA */}
      <main style={{ flex: 1, backgroundColor: getCanvasBg(), padding: '30px 20px 60px', transition: 'background-color 0.25s ease' }}>
        <div style={{ maxWidth: '1440px', margin: '0 auto' }}>

          {/* EQUAL HEIGHT COMPARISON GRID */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: selectedTab === 'all' && deviceWidth === '100%'
              ? 'repeat(auto-fit, minmax(360px, 1fr))'
              : 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '32px',
            justifyContent: 'center',
            alignItems: 'stretch'
          }}>
            {displayedCards.map((card) => {
              const Icon = card.icon;
              const jsonPayload = card.jsonBuilder(MOCK_DATA);

              return (
                <div
                  key={card.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    maxWidth: deviceWidth === '100%' ? '420px' : deviceWidth,
                    margin: '0 auto'
                  }}
                >
                  {/* Card Title Header Bar */}
                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', padding: '0 4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: bgTheme === 'dark' ? '#ffffff' : '#0f172a' }}>
                      <Icon size={16} color={card.accentColor} />
                      <span style={{ fontWeight: 800, fontSize: '14px' }}>{card.shortTitle}</span>
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.85)', color: card.accentColor, border: '1px solid rgba(0,0,0,0.06)' }}>
                      3:1 Banner Header
                    </span>
                  </div>

                  {/* Corporate Hero Flex Bubble (Banner is now the Top Header) */}
                  <CorporateFlexBubble card={card} data={MOCK_DATA} showWatermark={watermarkOn} />

                  {/* Meta Section */}
                  <div style={{ width: '100%', marginTop: '12px', backgroundColor: '#ffffff', borderRadius: '12px', padding: '12px 14px', border: '1px solid #e2e8f0', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                    {/* AltText */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>altText (ข้อความแจ้งเตือน):</span>
                        <button
                          type="button"
                          onClick={() => handleCopyAltText(card.id, card.altText)}
                          style={{ display: 'flex', alignItems: 'center', gap: '3px', border: 'none', background: 'transparent', color: copiedAltId === card.id ? '#059669' : '#0284c7', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                        >
                          {copiedAltId === card.id ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedAltId === card.id ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                        </button>
                      </div>
                      <div style={{ fontSize: '12px', color: '#1e293b', backgroundColor: '#f8fafc', padding: '6px 8px', borderRadius: '6px', border: '1px solid #f1f5f9', wordBreak: 'break-word', fontFamily: 'monospace' }}>
                        {card.altText}
                      </div>
                    </div>

                    {/* Banner Path Info */}
                    <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: '6px', marginTop: '8px', fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>
                      <span style={{ fontWeight: 700 }}>Banner Header:</span>{' '}
                      <code style={{ color: '#0f172a', fontWeight: 600 }}>{card.bannerUrl}</code>
                      {' · '}<span style={{ color: '#059669', fontWeight: 600 }}>Top Header (No Duplicate Logo)</span>
                    </div>

                    {/* Optional JSON Payload toggle */}
                    {showJson && (
                      <div style={{ marginTop: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>LINE Flex Bubble JSON (Production Schema):</span>
                        <pre style={{ margin: '6px 0 0', maxHeight: '180px', overflow: 'auto', backgroundColor: '#0f172a', color: '#38bdf8', padding: '10px', borderRadius: '8px', fontSize: '11px', lineHeight: '1.4', fontFamily: 'Consolas, monospace' }}>
                          {JSON.stringify(jsonPayload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </main>
    </div>
  );
}
