import React from 'react';

function ReceiptPrint({ booking, settings }) {
  if (!booking) return null;

  // Format date helper
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    try {
      // If dateString is in SQLite format "YYYY-MM-DD HH:mm:ss", append "Z" so JS parses it as UTC
      let normalized = dateString;
      if (typeof dateString === 'string' && !dateString.includes('T') && !dateString.includes('Z')) {
        normalized = dateString.replace(' ', 'T') + 'Z';
      }
      const d = new Date(normalized);
      return d.toLocaleString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateString;
    }
  };

  const formatPeriod = (start, end) => {
    if (!start || !end) return '';
    try {
      const s = new Date(start);
      const e = new Date(end);
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

  const itemCount = booking.items ? booking.items.length : 0;
  const hasRoom = booking.items ? booking.items.some(item => !!item.room_id) : false;

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
      <div className="receipt-header">
        {settings.logo_image && (
          <div style={{ textAlign: 'center', marginBottom: '8px' }}>
            <img 
              src={settings.logo_image} 
              alt="Logo" 
              style={{ maxWidth: '80px', maxHeight: '50px', objectFit: 'contain' }} 
            />
          </div>
        )}
        <div className="receipt-title" style={{ fontSize: '18px', fontWeight: 'bold' }}>
          {settings.company_name || 'บริษัทจองห้องประชุม'}
        </div>
        {settings.company_address && (
          <div className="receipt-address" style={{ fontSize: '0.8em', color: '#000000', whiteSpace: 'pre-line', marginTop: '4px', fontWeight: '600', textAlign: 'center' }}>
            {settings.company_address}
          </div>
        )}
        <div className="receipt-sub" style={{ fontSize: '0.85em', marginTop: '6px' }}>
          {settings.receipt_header || 'ใบรับจองและใบเสร็จรับเงิน'}
        </div>
      </div>

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-info-row" style={{ fontSize: '0.9em' }}>
        <span>เลขที่ใบเสร็จ:</span>
        <span style={{ fontWeight: 'bold' }}>#{String(booking.id).padStart(6, '0')}</span>
      </div>
      <div className="receipt-info-row" style={{ fontSize: '0.9em' }}>
        <span>วันที่ทำรายการ:</span>
        <span>{formatDateTime(booking.created_at)}</span>
      </div>
      <div className="receipt-info-row" style={{ fontSize: '0.9em' }}>
        <span>{hasRoom ? 'ชื่อผู้จองห้อง:' : 'ลูกค้า:'}</span>
        <span style={{ fontWeight: '600' }}>{booking.customer_name}</span>
      </div>
      {booking.department && (
        <div className="receipt-info-row" style={{ fontSize: '0.9em' }}>
          <span>แผนก/ฝ่าย:</span>
          <span>{booking.department}</span>
        </div>
      )}
      {booking.contact && (
        <div className="receipt-info-row" style={{ fontSize: '0.9em' }}>
          <span>เบอร์ติดต่อ:</span>
          <span>{booking.contact}</span>
        </div>
      )}

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-items">
        <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr', fontSize: '0.85em', fontWeight: 'bold', marginBottom: '8px', color: '#000000' }}>
          <span>รายการ</span>
          <span style={{ textAlign: 'center' }}>จำนวน</span>
          <span style={{ textAlign: 'right' }}>รวม (บาท)</span>
        </div>
        
        {booking.items && booking.items.map((item, idx) => {
          const isRoom = !!item.room_id;
          const isDaily = isRoom && item.quantity === 1 && item.price >= 1000;
          const displayName = isRoom 
            ? (item.room_name && item.room_name.includes('301')
                ? `${item.room_name} (${item.layout === 'classroom' ? 'Classroom' : 'Standard'})`
                : (item.room_name || 'ห้องประชุม'))
            : (item.service_name || 'รายการสินค้า');

          return (
            <div key={idx} style={{ marginBottom: itemCount > 6 ? '4px' : '8px', borderBottom: '1px dotted #000000', paddingBottom: '4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr', fontSize: '0.95em', color: '#000000' }}>
                <span style={{ fontWeight: '700' }}>{displayName}</span>
                <span style={{ textAlign: 'center', fontWeight: '700' }}>
                  {isRoom ? (isDaily ? `${item.quantity} วัน` : `${item.quantity} ชม.`) : `x${item.quantity}`}
                </span>
                <span style={{ textAlign: 'right', fontWeight: '700' }}>
                  {item.subtotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {isRoom && item.start_time && (
                <div style={{ fontSize: '0.85em', color: '#000000', paddingLeft: '4px', marginTop: '2px', fontWeight: '700' }}>
                  {formatPeriod(item.start_time, item.end_time)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="receipt-divider" style={{ margin: '12px 0' }}></div>

      <div className="receipt-total-section" style={{ color: '#000000' }}>
        <div className="receipt-info-row" style={{ fontSize: '1.1em', fontWeight: 'bold', color: '#000000' }}>
          <span>ยอดรวมสุทธิ:</span>
          <span>{booking.total_amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</span>
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
        <p>{settings.receipt_footer || 'ขอบคุณที่มาจองบริการกับเรา'}</p>
        <p style={{ marginTop: '8px', fontSize: '0.75em', color: '#000000' }}>พิมพ์โดยระบบ Bwork POS ท้องถิ่น</p>
      </div>
    </div>
  );
}

export default ReceiptPrint;
