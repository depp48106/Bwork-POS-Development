import React from 'react';

function ReceiptPrint({ booking, settings }) {
  if (!booking) return null;

  const safeSettings = settings || {};

  // Format date helper
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    try {
      let normalized = dateString;
      if (typeof dateString === 'string' && !dateString.includes('T') && !dateString.includes('Z')) {
        normalized = dateString.replace(' ', 'T') + 'Z';
      }
      const d = new Date(normalized);
      if (isNaN(d.getTime())) return String(dateString);
      return d.toLocaleString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return String(dateString);
    }
  };

  const formatPeriod = (start, end) => {
    if (!start || !end) return '';
    try {
      const s = new Date(start);
      const e = new Date(end);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${start} - ${end}`;
      const optDate = { month: 'short', day: 'numeric' };
      const optTime = { hour: '2-digit', minute: '2-digit' };
      
      const dateStr = s.toLocaleDateString('th-TH', optDate);
      const startTimeStr = s.toLocaleTimeString('th-TH', optTime);
      const endTimeStr = e.toLocaleTimeString('th-TH', optTime);
      
      return `${dateStr} (${startTimeStr} - ${endTimeStr})`;
    } catch (err) {
      return `${start} - ${end}`;
    }
  };

  const safeItems = Array.isArray(booking.items) ? booking.items : [];
  const safeTotal = Number(booking.total_amount) || 0;

  return (
    <div 
      id="print-receipt-area" 
      className="receipt-wrapper"
      style={{ 
        fontSize: '13px',
        lineHeight: 1.4,
        padding: '4mm'
      }}
    >
      <div className="receipt-header" style={{ textAlign: 'center' }}>
        {safeSettings.logo_image && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <img 
              src={safeSettings.logo_image} 
              alt="" 
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                if (e.currentTarget.parentElement) {
                  e.currentTarget.parentElement.style.display = 'none';
                }
              }}
              style={{ maxWidth: '130px', maxHeight: '75px', objectFit: 'contain' }} 
            />
          </div>
        )}
        {safeSettings.company_name && (
          <div className="receipt-title" style={{ fontSize: '18px', fontWeight: 'bold' }}>
            {safeSettings.company_name}
          </div>
        )}
        {safeSettings.company_address && (
          <div className="receipt-address" style={{ fontSize: '0.8em', color: '#000000', whiteSpace: 'pre-line', marginTop: '4px', fontWeight: '600', textAlign: 'center' }}>
            {safeSettings.company_address}
          </div>
        )}
        <div className="receipt-sub" style={{ fontSize: '0.85em', marginTop: '6px' }}>
          {safeSettings.receipt_header || 'ใบรับจองและใบเสร็จรับเงิน'}
        </div>
      </div>

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-info-row" style={{ fontSize: '0.9em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span style={{ flexShrink: 0 }}>เลขที่ใบเสร็จ:</span>
        <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{booking.receipt_number || `#${String(booking.id || '').padStart(6, '0')}`}</span>
      </div>
      <div className="receipt-info-row" style={{ fontSize: '0.9em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span style={{ flexShrink: 0 }}>วันที่ทำรายการ:</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{formatDateTime(booking.created_at)}</span>
      </div>
      <div className="receipt-info-row" style={{ fontSize: '0.9em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <span style={{ flexShrink: 0 }}>ลูกค้า:</span>
        <span style={{ fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }} title={booking.customer_name}>{booking.customer_name || '-'}</span>
      </div>
      {booking.department && (
        <div className="receipt-info-row" style={{ fontSize: '0.9em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
          <span style={{ flexShrink: 0 }}>แผนก/ฝ่าย:</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }} title={booking.department}>{booking.department}</span>
        </div>
      )}
      {booking.contact && (
        <div className="receipt-info-row" style={{ fontSize: '0.9em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
          <span style={{ flexShrink: 0 }}>เบอร์ติดต่อ:</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right' }}>{booking.contact}</span>
        </div>
      )}

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-items">
        <table style={{ width: '100%', borderCollapse: 'collapse', border: 'none' }}>
          <thead>
            <tr style={{ fontSize: '0.85em', fontWeight: 'bold', color: '#000000', borderBottom: '2px dashed #000000' }}>
              <th style={{ width: '55%', textAlign: 'left', padding: '4px 0' }}>รายการ</th>
              <th style={{ width: '20%', textAlign: 'center', padding: '4px 0' }}>จำนวน</th>
              <th style={{ width: '25%', textAlign: 'right', padding: '4px 0' }}>รวม (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {safeItems.map((item, idx) => {
              const isRoom = !!item.room_id;
              const itemPrice = Number(item.price) || 0;
              const isDaily = isRoom && item.quantity === 1 && itemPrice >= 1000;
              const displayName = isRoom 
                ? (item.room_name && item.room_name.includes('301')
                    ? `${item.room_name} (${item.layout === 'classroom' ? 'Classroom' : 'Standard'})`
                    : (item.room_name || 'ห้องประชุม'))
                : (item.service_name || 'รายการสินค้า');
              let cleanName = displayName;
              let detailText = item.room_description || '';

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

              const itemSubtotal = Number(item.subtotal) || 0;

              return (
                <tr key={idx} style={{ borderBottom: '1px dashed #000000' }}>
                  <td style={{ padding: '6px 0', verticalAlign: 'top', color: '#000000', textAlign: 'left', fontSize: '0.95em', fontWeight: '700' }}>
                    <span style={{ display: 'inline', whiteSpace: 'normal', wordBreak: 'break-word', color: '#000000' }}>{cleanName}</span>
                    {detailText && (
                      <>
                        <br />
                        <span style={{ fontSize: '0.82em', color: '#000000', display: 'inline', fontWeight: '700' }}>
                          {detailText}
                        </span>
                      </>
                    )}
                    {isRoom && item.start_time && (
                      <>
                        <br />
                        <span style={{ fontSize: '0.85em', color: '#000000', display: 'inline', fontWeight: '700' }}>
                          {formatPeriod(item.start_time, item.end_time)}
                        </span>
                      </>
                    )}
                  </td>
                  <td style={{ padding: '6px 0', verticalAlign: 'top', color: '#000000', textAlign: 'center', fontWeight: '700' }}>
                    {isRoom ? (isDaily ? `${item.quantity || 1} วัน` : `${item.quantity || 1} ชม.`) : `x${item.quantity || 1}`}
                  </td>
                  <td style={{ padding: '6px 0', verticalAlign: 'top', color: '#000000', textAlign: 'right', fontWeight: '700' }}>
                    {itemSubtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-total-section" style={{ color: '#000000' }}>
        <div className="receipt-info-row" style={{ fontSize: '1.1em', fontWeight: 'bold', color: '#000000' }}>
          <span>ยอดรวมสุทธิ:</span>
          <span>{safeTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
        </div>
        <div className="receipt-info-row" style={{ fontSize: '0.95em', fontWeight: 'bold', color: '#000000' }}>
          <span>การชำระเงิน:</span>
          <span>
            {booking.payment_status === 'paid' ? 'ชำระเงินแล้ว' : 'ค้างชำระ (Pending)'} 
            {booking.payment_method && ` (${booking.payment_method === 'cash' ? 'เงินสด' : 'โอนเงิน'})`}
          </span>
        </div>
      </div>

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-footer-text" style={{ fontSize: '0.85em', color: '#000000', fontWeight: '600' }}>
        <p>{safeSettings.receipt_footer || 'ขอบคุณที่มาจองบริการกับเรา'}</p>
        <p style={{ marginTop: '8px', fontSize: '0.75em', color: '#000000' }}>พิมพ์โดยระบบ Bwork POS</p>
      </div>
    </div>
  );
}

export default ReceiptPrint;
