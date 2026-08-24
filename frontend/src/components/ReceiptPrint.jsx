import React from 'react';

function ReceiptPrint({ booking, settings }) {
  if (!booking) return null;

  const safeSettings = settings || {};
  const companyName = safeSettings.company_name || safeSettings.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)';
  const companyAddress = safeSettings.company_address || safeSettings.quotation_company_address || '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต 602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ตำบลคลองเกลือ อำเภอปากเกร็ด จ.นนทบุรี 11120';
  const companyTaxId = safeSettings.company_tax_id || safeSettings.quotation_company_tax_id || '0125554000401';
  const companyPhone = safeSettings.company_phone || safeSettings.phone || '';

  const monthNamesThai = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  // Format Created At Date (Local Time with Thai year & timezone conversion)
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    try {
      let str = String(dateString).trim();
      if (!str.includes('T') && str.includes(' ')) {
        str = str.replace(' ', 'T');
      }
      if (!str.endsWith('Z') && !/\+\d{2}:?\d{2}$/.test(str)) {
        str = str + 'Z';
      }
      const d = new Date(str);
      if (isNaN(d.getTime())) return String(dateString);
      const year = d.getFullYear() + 543;
      const month = monthNamesThai[d.getMonth()];
      const day = d.getDate();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${year} ${hours}:${minutes} น.`;
    } catch (e) {
      return String(dateString);
    }
  };

  // Format Booking Item Period (e.g. 20 ส.ค. 2569 (08:00 - 17:00))
  const formatPeriod = (start, end) => {
    if (!start || !end) return '';
    try {
      let datePart = '';
      let startTimeStr = '';
      let endTimeStr = '';

      if (typeof start === 'string' && start.includes('T')) {
        const [dPart, tPart] = start.split('T');
        const [y, m, day] = dPart.split('-').map(Number);
        const thaiYear = y + 543;
        datePart = `${day} ${monthNamesThai[m - 1]} ${thaiYear}`;
        startTimeStr = tPart.substring(0, 5);
      } else {
        const s = new Date(start);
        const thaiYear = s.getFullYear() + 543;
        datePart = `${s.getDate()} ${monthNamesThai[s.getMonth()]} ${thaiYear}`;
        startTimeStr = s.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      }

      if (typeof end === 'string' && end.includes('T')) {
        const [, tPart] = end.split('T');
        endTimeStr = tPart.substring(0, 5);
      } else {
        const e = new Date(end);
        endTimeStr = e.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      }

      return `${datePart} (${startTimeStr} - ${endTimeStr})`;
    } catch (err) {
      return `${start} - ${end}`;
    }
  };

  const safeItems = Array.isArray(booking.items) ? booking.items : [];
  const safeTotal = Number(booking.total_amount || booking.totalAmount) || 0;

  // Fallback if safeItems is empty but booking root has room info
  let renderItems = [...safeItems];
  if (renderItems.length === 0 && (booking.room_id || booking.room_name || booking.room)) {
    renderItems = [{
      room_id: booking.room_id || booking.room?.id,
      room_name: booking.room_name || booking.room?.name || 'ห้องประชุม',
      room_description: booking.room_description || booking.room?.description || '',
      price: safeTotal,
      quantity: 1,
      subtotal: safeTotal,
      start_time: booking.start_time || (booking.booking_date ? `${booking.booking_date}T${booking.startTime || '08:00'}:00` : null),
      end_time: booking.end_time || (booking.booking_date ? `${booking.booking_date}T${booking.endTime || '17:00'}:00` : null),
      layout: booking.layout || 'standard',
      booking_type: booking.booking_type || 'hourly'
    }];
  }

  return (
    <div 
      id="print-receipt-area" 
      className="receipt-wrapper"
      style={{ 
        width: '72mm',
        maxWidth: '72mm',
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
        {safeSettings.logo_image && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <img 
              src={safeSettings.logo_image} 
              alt="Logo" 
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.style.display = 'none';
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
          {safeSettings.receipt_header || 'ใบเสร็จรับเงิน'}
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
        {(booking.guest_count || renderItems[0]?.guest_count) && (
          <div className="receipt-info-row" style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', color: '#000000' }}>
            <span style={{ flexShrink: 0, fontWeight: 700 }}>จำนวนผู้เข้าใช้:</span>
            <span style={{ fontWeight: 700, textAlign: 'right' }}>{booking.guest_count || renderItems[0]?.guest_count} ท่าน</span>
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
            {renderItems.map((item, idx) => {
              const isRoom = !!(item.room_id || item.booking_type || item.layout || item.start_time);
              const itemPrice = Number(item.price) || 0;
              const isDaily = isRoom && item.quantity === 1 && itemPrice >= 1000;
              
              const roomMap = {
                4: 'Mars (301)',
                5: 'Mercury (302)',
                6: 'Saturn (303)',
                7: 'Venus (304)',
                8: 'Uranus (305)',
                9: 'Neptune (306)',
                10: 'Jupiter (300)',
                11: 'Pluto (201)',
                12: 'Jupiter (300) & Co-Working',
                13: 'เหมาโซน Co-working'
              };

              const rId = item.room_id || booking.room_id || booking.room?.id;
              let roomName = item.room_name || item.name || item.room_title || item.room?.name || booking.room_name || booking.room?.name || roomMap[rId] || roomMap[Number(rId)] || '';

              if (isRoom) {
                if (!roomName) roomName = roomMap[rId] || roomMap[Number(rId)] || 'ห้องประชุม';
                if (item.layout === 'classroom' && !roomName.toLowerCase().includes('classroom')) {
                  roomName += ' (Classroom)';
                }
              }
              const displayName = isRoom ? roomName : (item.service_name || item.name || 'รายการสินค้า');

              let cleanName = displayName;
              let detailText = isRoom 
                ? (item.room_description || item.description || booking.room_description || '') 
                : (item.service_description || item.description || item.detail || item.notes || (item.service_category || item.category ? `หมวดหมู่: ${item.service_category || item.category}` : ''));

              if (displayName.includes(' (ส่วนลด')) {
                const parts = displayName.split(' (ส่วนลด');
                cleanName = parts[0];
                if (!detailText) {
                  detailText = '(ส่วนลด' + parts[1];
                }
              } else if (displayName.includes('(ส่วนลด')) {
                const parts = displayName.split('(ส่วนลด');
                cleanName = parts[0].trim();
                if (!detailText) {
                  detailText = '(ส่วนลด' + parts[1];
                }
              }

              const layoutLabel = item.layout === 'classroom' ? 'Classroom (จัดโต๊ะเรียน)' : 'Standard (จัดปกติ)';
              const typeLabel = item.booking_type === 'daily' ? 'เหมาวัน' : item.booking_type === 'halfday' ? 'เหมาครึ่งวัน' : 'รายชั่วโมง';
              const periodText = item.start_time ? formatPeriod(item.start_time, item.end_time) : '';
              const itemSubtotal = Number(item.subtotal) || 0;

              return (
                <tr key={idx} style={{ borderBottom: '1px dashed #000000' }}>
                  <td style={{ padding: '5px 0', verticalAlign: 'top', color: '#000000', textAlign: 'left' }}>
                    <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#000000', lineHeight: 1.25 }}>
                      {cleanName}
                    </div>
                    
                    {/* Item Details Hierarchy (Compact & Clean) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' }}>
                      {isRoom && periodText && (
                        <div style={{ fontSize: '0.68rem', color: '#000000', fontWeight: 600, lineHeight: 1.25 }}>
                          {`${periodText} (${typeLabel})`}
                        </div>
                      )}
                      {isRoom && (
                        <div style={{ fontSize: '0.66rem', color: '#000000', fontWeight: 600, lineHeight: 1.25 }}>
                          {`รูปแบบ: ${layoutLabel}`}
                        </div>
                      )}
                      {detailText && (
                        <div style={{ fontSize: '0.66rem', color: '#000000', fontWeight: 600, lineHeight: 1.25 }}>
                          {detailText.startsWith('(') ? detailText : `(${detailText})`}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '5px 0', verticalAlign: 'top', color: '#000000', textAlign: 'center', fontSize: '0.80rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {isRoom ? (isDaily ? `${item.quantity || 1} วัน` : `${item.quantity || 1} ชม.`) : `x${item.quantity || 1}`}
                  </td>
                  <td style={{ padding: '5px 0', verticalAlign: 'top', color: '#000000', textAlign: 'right', fontSize: '0.86rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {itemSubtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Crisp Divider */}
      <div className="receipt-divider" style={{ borderTop: '1.5px dashed #000000', margin: '8px 0' }}></div>

      {/* 4. Total & Payment Section */}
      <div className="receipt-total-section" style={{ color: '#000000', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div className="receipt-info-row" style={{ fontSize: '1.05rem', fontWeight: 900, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>ยอดรวมสุทธิ:</span>
          <span>{safeTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#000000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>การชำระเงิน:</span>
          <span>
            {booking.payment_status === 'paid' ? 'ชำระเงินแล้ว' : 'ค้างชำระ (Pending)'} 
            {booking.payment_method && ` (${booking.payment_method === 'cash' ? 'เงินสด' : 'โอนเงิน'})`}
          </span>
        </div>
        {(booking.note || booking.notes) && (
          <div className="receipt-info-row" style={{ fontSize: '0.80rem', marginTop: '3px', color: '#000000', display: 'flex', gap: '4px' }}>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>หมายเหตุ:</span>
            <span style={{ fontWeight: 600 }}>{booking.note || booking.notes}</span>
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
