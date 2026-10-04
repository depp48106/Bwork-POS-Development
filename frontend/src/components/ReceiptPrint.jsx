import React, { useMemo } from 'react';
import { formatTransactionDateTime } from '../dateUtils';
import {
  normalizeBookingReceipt,
  getReceiptTotals,
  getReceiptPaymentDetails
} from '../utils/receiptUtils';

function ReceiptPrint({ booking, settings }) {
  if (!booking) return null;

  const safeSettings = settings || {};
  const companyName = safeSettings.company_name || safeSettings.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)';
  const companyAddress = safeSettings.company_address || safeSettings.quotation_company_address || '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต 602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ตำบลคลองเกลือ อำเภอปากเกร็ด จ.นนทบุรี 11120';
  const companyTaxId = safeSettings.company_tax_id || safeSettings.quotation_company_tax_id || '0125554000401';
  const companyPhone = safeSettings.company_phone || safeSettings.phone || '';
  const receiptLogo = safeSettings.logo_image || '/BWORK-LOGO.png';

  // Format Created At Date (Point-in-time timestamp in Asia/Bangkok)
  const formatDateTime = (dateString) => formatTransactionDateTime(dateString);

  // Normalize, sort and group items
  const receiptData = useMemo(() => normalizeBookingReceipt(booking), [booking]);
  const totals = useMemo(() => getReceiptTotals(booking, receiptData.normalizedItems), [booking, receiptData]);
  const payment = useMemo(() => getReceiptPaymentDetails(booking), [booking]);
  const { isMultiDate, groups, normalizedItems } = receiptData;

  const bookingDetails =
    typeof booking?.booking_details === 'string'
      ? booking.booking_details.trim()
      : '';

  return (
    <div
      id="print-receipt-area"
      className="receipt-wrapper"
      style={{
        width: '72mm',
        maxWidth: '72mm',
        height: 'auto',
        minHeight: 0,
        maxHeight: 'none',
        overflow: 'visible',
        margin: '0 auto',
        padding: '3mm 4mm',
        fontSize: '13px',
        lineHeight: 1.35,
        color: '#000000',
        backgroundColor: '#ffffff',
        fontFamily: "'Sarabun', 'Prompt', 'Noto Sans Thai', 'Segoe UI', Tahoma, sans-serif",
        boxSizing: 'border-box'
      }}

    >
      {/* 1. Header & Company Section */}
      <div className="receipt-header" style={{ textAlign: 'center', marginBottom: '8px' }}>
        {receiptLogo && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <img
              src={receiptLogo}
              alt="Logo"
              onError={(e) => {
                if (!e.currentTarget.dataset.fallbackTried && !e.currentTarget.src.endsWith('/BWORK-LOGO.png')) {
                  e.currentTarget.dataset.fallbackTried = 'true';
                  e.currentTarget.src = '/BWORK-LOGO.png';
                } else {
                  e.currentTarget.onerror = null;
                }
              }}
              style={{ maxWidth: '120px', maxHeight: '55px', objectFit: 'contain' }}
            />
          </div>
        )}
        <div className="receipt-title" style={{ fontSize: '1.05rem', fontWeight: 800, color: '#000000', lineHeight: 1.25, marginBottom: '4px' }}>
          {companyName}
        </div>
        {companyAddress && (
          <div className="receipt-address" style={{ fontSize: '0.68rem', color: '#000000', lineHeight: 1.3, fontWeight: 600, textAlign: 'center', padding: '0 1mm' }}>
            {companyAddress}
          </div>
        )}
        {companyTaxId && (
          <div style={{ fontSize: '0.68rem', color: '#000000', marginTop: '2px', fontWeight: 600, textAlign: 'center' }}>
            เลขประจำตัวผู้เสียภาษี: {companyTaxId}
          </div>
        )}
        {companyPhone && (
          <div style={{ fontSize: '0.68rem', color: '#000000', marginTop: '2px', fontWeight: 600, textAlign: 'center' }}>
            โทร: {companyPhone}
          </div>
        )}
        <div className="receipt-sub" style={{ fontSize: '0.92rem', marginTop: '6px', fontWeight: 800, color: '#000000', letterSpacing: '0.5px' }}>
          {(!payment.isPaid || payment.isDeposit || payment.isFree) ? payment.receiptTitle : (safeSettings.receipt_header || payment.receiptTitle || 'ใบเสร็จรับเงิน')}
        </div>
      </div>

      {/* Crisp Divider */}
      <div className="receipt-divider" style={{ borderTop: '1.5px dashed #000000', margin: '8px 0' }}></div>

      {/* 2. Customer & Booking Meta Info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '8px' }}>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
          <span style={{ flexShrink: 0, fontWeight: 700 }}>เลขที่ใบเสร็จ:</span>
          <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{booking.receipt_number || booking.receiptNumber || booking.booking_code || booking.bookingCode || (booking.id ? `#${String(booking.id).padStart(6, '0')}` : '-')}</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
          <span style={{ flexShrink: 0, fontWeight: 700 }}>วันที่ทำรายการ:</span>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatDateTime(booking.created_at)}</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
          <span style={{ flexShrink: 0, fontWeight: 700 }}>ลูกค้า:</span>
          <span style={{ fontWeight: 700, textAlign: 'right' }} title={booking.customer_name}>{booking.customer_name || '-'}</span>
        </div>
        {booking.department && (
          <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
            <span style={{ flexShrink: 0, fontWeight: 700 }}>แผนก/ฝ่าย:</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }} title={booking.department}>{booking.department}</span>
          </div>
        )}
        {booking.contact && (
          <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
            <span style={{ flexShrink: 0, fontWeight: 700 }}>เบอร์ติดต่อ:</span>
            <span style={{ fontWeight: 700, textAlign: 'right' }}>{booking.contact}</span>
          </div>
        )}
        {(booking.guest_count || normalizedItems[0]?.guestCount) && (
          <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
            <span style={{ flexShrink: 0, fontWeight: 700 }}>จำนวนผู้เข้าใช้:</span>
            <span style={{ fontWeight: 700, textAlign: 'right' }}>{booking.guest_count || normalizedItems[0]?.guestCount} ท่าน</span>
          </div>
        )}
        {bookingDetails && (
          <div className="receipt-info-row" style={{ fontSize: '0.80rem', marginTop: '2px', color: '#000000', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 700 }}>รายละเอียด:</span>
            <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word', lineHeight: 1.35 }}>
              {bookingDetails}
            </div>
          </div>
        )}
      </div>

      {/* Crisp Divider */}
      <div className="receipt-divider" style={{ borderTop: '1.5px dashed #000000', margin: '8px 0' }}></div>

      {/* 3. Items Table */}
      <div className="receipt-items" style={{ marginBottom: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
          <thead>
            <tr style={{ fontSize: '0.82rem', fontWeight: 800, color: '#000000', borderBottom: '1.5px dashed #000000' }}>
              <th style={{ width: '62%', textAlign: 'left', padding: '3px 0' }}>รายการ</th>
              <th style={{ width: '14%', textAlign: 'center', padding: '3px 0' }}>จำนวน</th>
              <th style={{ width: '24%', textAlign: 'right', padding: '3px 0' }}>รวม (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((grp, grpIdx) => (
              <React.Fragment key={grp.dateKey || `group-${grpIdx}`}>
                {isMultiDate && grp.thaiDate && (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        padding: grpIdx > 0 ? '7px 0 3px 0' : '3px 0 3px 0',
                        borderBottom: '1px solid #000000',
                        textAlign: 'left'
                      }}
                    >
                      <div style={{ fontSize: '0.80rem', fontWeight: 900, color: '#000000' }}>
                        {grp.thaiFullDate || grp.thaiDate}
                      </div>
                    </td>
                  </tr>
                )}
                {grp.items.map((item, idx) => (
                  <tr key={item.id || `${grpIdx}-${idx}`} style={{ borderBottom: '1px dashed #000000' }}>
                    <td style={{ padding: '5px 0', verticalAlign: 'top', color: '#000000', textAlign: 'left' }}>
                      <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#000000', lineHeight: 1.25 }}>
                        {item.displayName}
                      </div>

                      {/* Item Details Hierarchy (Compact & Clean) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' }}>
                        {item.isRoom && item.timePeriod && (
                          <div style={{ fontSize: '0.70rem', color: '#000000', fontWeight: 700, lineHeight: 1.25 }}>
                            {!isMultiDate && grp.thaiDate ? `${grp.thaiDate} ` : ''}{item.timePeriod} ({item.typeLabel})
                          </div>
                        )}
                        {item.isRoom && (
                          <div style={{ fontSize: '0.66rem', color: '#000000', fontWeight: 600, lineHeight: 1.25 }}>
                            รูปแบบ: {item.isClassroom ? 'Classroom (จัดโต๊ะเรียน)' : 'Standard (จัดปกติ)'}
                          </div>
                        )}
                        {item.unitPrice > 0 && item.quantity > 1 && (
                          <div style={{ fontSize: '0.66rem', color: '#000000', fontWeight: 600, lineHeight: 1.25 }}>
                            @ {item.unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท / {item.bookingType === 'daily' ? 'วัน' : (item.bookingType === 'halfday' ? 'ครึ่งวัน' : (item.isRoom ? 'ชม.' : 'ชิ้น'))}
                          </div>
                        )}
                        {item.detailText && (
                          <div style={{ fontSize: '0.66rem', color: '#000000', fontWeight: 600, lineHeight: 1.25 }}>
                            {item.detailText.startsWith('(') ? item.detailText : `(${item.detailText})`}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '5px 0', verticalAlign: 'top', color: '#000000', textAlign: 'center', fontSize: '0.80rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {item.durationLabel}
                    </td>
                    <td style={{ padding: '5px 0', verticalAlign: 'top', color: '#000000', textAlign: 'right', fontSize: '0.86rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {item.subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Crisp Divider */}
      <div className="receipt-divider" style={{ borderTop: '1.5px dashed #000000', margin: '8px 0' }}></div>

      {/* 4. Total & Payment Section */}
      <div className="receipt-total-section" style={{ color: '#000000', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {totals.hasDiscount && (
          <>
            <div className="receipt-info-row" style={{ fontSize: '0.84rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>ยอดรวมก่อนส่วนลด:</span>
              <span>{totals.grossSubtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
            </div>
            <div className="receipt-info-row" style={{ fontSize: '0.84rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{totals.discountLabel}:</span>
              <span>
                -{totals.discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
              </span>
            </div>
          </>
        )}
        {totals.hasAdjustment && !totals.hasDiscount && (
          <>
            <div className="receipt-info-row" style={{ fontSize: '0.84rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>รวมมูลค่ารายการ:</span>
              <span>{totals.itemsSubtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
            </div>
            <div className="receipt-info-row" style={{ fontSize: '0.84rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{totals.adjustmentLabel}:</span>
              <span>
                {totals.adjustmentAmount < 0 ? '-' : '+'}
                {Math.abs(totals.adjustmentAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
              </span>
            </div>
          </>
        )}
        <div className="receipt-info-row" style={{ fontSize: '1.05rem', fontWeight: 900, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>ยอดสุทธิ:</span>
          <span>{totals.netTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{payment.paidLabel || 'ชำระแล้ว'}:</span>
          <span>{totals.paidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>ยอดคงเหลือ:</span>
          <span>{totals.balanceAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>สถานะ:</span>
          <span>{payment.statusLabel}</span>
        </div>
        {payment.methodLabel && !payment.isFree && (
          <div className="receipt-info-row" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{payment.isDeposit ? 'วิธีชำระล่าสุด:' : 'วิธีชำระ:'}</span>
            <span>{payment.methodLabel}</span>
          </div>
        )}
        {payment.isFree && (
          <div className="receipt-info-row" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>ช่องทาง:</span>
            <span>{payment.methodLabel}</span>
          </div>
        )}
        {payment.transRef && (
          <div className="receipt-info-row" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>เลขอ้างอิงสลิป:</span>
            <span>{payment.transRef}</span>
          </div>
        )}
        {payment.note && (
          <div className="receipt-info-row" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>สิทธิ์ / รายละเอียด:</span>
            <span>{payment.note}</span>
          </div>
        )}
      </div>

      {/* Crisp Divider */}
      <div className="receipt-divider" style={{ borderTop: '1.5px dashed #000000', margin: '8px 0' }}></div>

      {/* 5. Footer Text */}
      <div className="receipt-footer-text" style={{ fontSize: '0.82rem', color: '#000000', fontWeight: 700, textAlign: 'center', marginTop: '6px' }}>
        <p style={{ margin: 0 }}>{safeSettings.receipt_footer || 'ขอบคุณที่ใช้บริการของเรา'}</p>
        <p style={{ marginTop: '4px', marginBottom: 0, fontSize: '0.72rem', color: '#000000', fontWeight: 600 }}>พิมพ์โดยระบบ Bwork POS</p>
      </div>
    </div>
  );
}

export default ReceiptPrint;
