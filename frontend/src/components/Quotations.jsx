import React, { useState, useEffect } from 'react';
import { Plus, Minus, Trash2, Calendar, FileText, Check, X, Search, Printer, ArrowRight, AlertCircle, Edit, Trash, RefreshCw } from 'lucide-react';

function Quotations({ user, settings, sysAlert, sysConfirm, quotationCartData, clearQuotationCartData, onNavigate }) {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [viewMode, setViewMode] = useState('list');
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // Sorting State
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');

  // Form State
  const [customerName, setCustomerName] = useState('');
  const [department, setDepartment] = useState('');
  const [contact, setContact] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState([]);

  // Database room & services for manual item adding
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);

  // Manual Add Item state
  const [itemType, setItemType] = useState('room'); // 'room' or 'service'
  const [selectedItemObj, setSelectedItemObj] = useState(null);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState('');
  const [layout, setLayout] = useState('standard');
  const [bookingType, setBookingType] = useState('hourly');

  useEffect(() => {
    fetchQuotations();
    fetchCatalog();
  }, []);

  // Pre-fill from POS cart if available
  useEffect(() => {
    if (quotationCartData) {
      setCustomerName(quotationCartData.customerName || '');
      setContact(quotationCartData.contact || '');
      setDepartment(quotationCartData.department || '');
      
      // Default validity date from settings
      const validDays = Number(settings?.quotation_valid_days) || 7;
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + validDays);
      setValidUntil(defaultDate.toLocaleDateString('en-CA'));

      // Map cart items to quotation items format
      const mapped = quotationCartData.cart.map(item => ({
        room_id: item.room_id || null,
        service_id: item.service_id || null,
        room_name: item.room_name || null,
        service_name: item.service_name || null,
        quantity: item.quantity || 1,
        price: item.price,
        start_time: item.start_time || null,
        end_time: item.end_time || null,
        subtotal: item.subtotal,
        layout: item.layout || 'standard',
        booking_type: item.booking_type || 'hourly'
      }));
      setItems(mapped);
      setViewMode('create');
      clearQuotationCartData(); // Consume the cart data
    }
  }, [quotationCartData]);

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quotations');
      if (res.ok) {
        const data = await res.json();
        setQuotations(data);
      }
    } catch (err) {
      console.error(err);
      sysAlert('ไม่สามารถเชื่อมต่อดึงข้อมูลใบเสนอราคาได้');
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    try {
      const resRooms = await fetch('/api/rooms');
      const resServices = await fetch('/api/services');
      if (resRooms.ok) setRooms(await resRooms.json());
      if (resServices.ok) setServices(await resServices.json());
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateQuotation = () => {
    setCustomerName('');
    setDepartment('');
    setContact('');
    
    // Default valid date from settings
    const validDays = Number(settings?.quotation_valid_days) || 7;
    const d = new Date();
    d.setDate(d.getDate() + validDays);
    setValidUntil(d.toLocaleDateString('en-CA'));
    setItems([]);
    setViewMode('create');
  };

  const handleEditQuotation = async (q) => {
    try {
      const res = await fetch(`/api/quotations/${q.id}`);
      if (res.ok) {
        const fullQ = await res.json();
        setSelectedQuotation(fullQ);
        setCustomerName(fullQ.customer_name);
        setDepartment(fullQ.department || '');
        setContact(fullQ.contact || '');
        setValidUntil(fullQ.valid_until || '');
        setItems(fullQ.items || []);
        setViewMode('edit');
      }
    } catch (err) {
      console.error(err);
      sysAlert('ไม่สามารถโหลดรายละเอียดใบเสนอราคาได้');
    }
  };

  const handleSaveQuotation = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      sysAlert('กรุณากรอกชื่อลูกค้า');
      return;
    }
    if (items.length === 0) {
      sysAlert('กรุณาเลือกรายการเสนอราคาอย่างน้อย 1 รายการ');
      return;
    }

    const payload = {
      customer_name: customerName,
      department: department || '',
      contact,
      total_amount: items.reduce((sum, item) => sum + item.subtotal, 0),
      valid_until: validUntil,
      items
    };

    const isEdit = viewMode === 'edit';
    const url = isEdit ? `/api/quotations/${selectedQuotation.id}/status` : '/api/quotations';
    const method = isEdit ? 'PATCH' : 'POST';

    // Wait, if it is editing, we should actually support full update!
    // But since server-side we only have PATCH /status and POST /quotations and DELETE, 
    // let's do a simple workaround: if editing, we delete the old one and create a new one, or we can write a PUT /api/quotations/:id!
    // Let's check: yes, we can just save it. Wait! Let's write a PUT /api/quotations/:id endpoint in server.js to support complete edits!
    // For now, if we create it, we use POST. If we edit it, let's write a backend handler for PUT /api/quotations/:id.
    // Yes! Let's write PUT /api/quotations/:id in server.js in a moment. Let's make the frontend call it.
    
    try {
      const res = await fetch(isEdit ? `/api/quotations/${selectedQuotation.id}` : '/api/quotations', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        sysAlert(isEdit ? 'อัปเดตใบเสนอราคาสำเร็จ' : 'บันทึกใบเสนอราคาสำเร็จ');
        setViewMode('list');
        fetchQuotations();
      } else {
        const err = await res.json();
        sysAlert(err.error || 'เกิดข้อผิดพลาดในการบันทึก');
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const handleDeleteQuotation = async (id) => {
    const ok = await sysConfirm('คุณต้องการลบใบเสนอราคานี้ใช่หรือไม่?');
    if (!ok) return;

    try {
      const res = await fetch(`/api/quotations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        sysAlert('ลบใบเสนอราคาสำเร็จ');
        fetchQuotations();
      }
    } catch (e) {
      sysAlert('เกิดข้อผิดพลาดในการลบ');
    }
  };

  const handleUpdateStatus = async (id, newStatus) => {
    try {
      const res = await fetch(`/api/quotations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        fetchQuotations();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConvertQuotation = async (q) => {
    const ok = await sysConfirm(`คุณต้องการแปลงใบเสนอราคาของ คุณ ${q.customer_name} เป็นรายการจองและเปิดบิลใช่หรือไม่?`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/quotations/${q.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'pending', payment_method: 'cash' })
      });
      if (res.ok) {
        sysAlert('แปลงเป็นรายการจองบิลค้างชำระสำเร็จ! ระบบจะนำทางท่านไปยังหน้ารายการชำระเงิน');
        onNavigate('pending');
      } else {
        const err = await res.json();
        sysAlert(err.error || 'แปลงรายการไม่สำเร็จ');
      }
    } catch (e) {
      sysAlert('เกิดข้อผิดพลาดการสื่อสาร');
    }
  };

  const handlePrintQuotation = async (q) => {
    try {
      const res = await fetch(`/api/quotations/${q.id}`);
      if (res.ok) {
        const fullQ = await res.json();
        setSelectedQuotation(fullQ);
        setShowPreview(true);
      }
    } catch (e) {
      sysAlert('ไม่สามารถโหลดตัวอย่างใบเสนอราคาได้');
    }
  };

  const getRealtimeCalculation = () => {
    if (!selectedItemObj) return null;

    let qty = 1;
    let rate = Number(price) || 0;
    let total = 0;
    let desc = '';

    if (itemType === 'room') {
      const standardRate = layout === 'classroom' 
        ? (selectedItemObj.classroom_hourly_rate || selectedItemObj.hourly_rate || 0)
        : (selectedItemObj.hourly_rate || 0);

      if (bookingType === 'daily') {
        const dailyRate = layout === 'classroom'
          ? (selectedItemObj.classroom_daily_rate || selectedItemObj.daily_rate || standardRate * 9)
          : (selectedItemObj.daily_rate || standardRate * 9);
        rate = (price !== '' && !isNaN(Number(price))) ? Number(price) : dailyRate;
        qty = 1;
        total = rate;
        desc = `รายวัน (ทั้งวัน) 1 วัน`;
      } else if (bookingType === 'halfday') {
        const halfdayRate = selectedItemObj.half_day_rate || standardRate * 4;
        rate = (price !== '' && !isNaN(Number(price))) ? Number(price) : halfdayRate;
        qty = 1;
        total = rate;
        desc = `ครึ่งวัน 1 ครั้ง`;
      } else {
        qty = 0;
        if (startTime && endTime) {
          const [sh, sm] = startTime.split(':').map(Number);
          const [eh, em] = endTime.split(':').map(Number);
          if (!isNaN(sh) && !isNaN(eh)) {
            const diff = (eh * 60 + em) - (sh * 60 + sm);
            qty = Math.max(1, Math.ceil(diff / 60));
          }
        }
        rate = (price !== '' && !isNaN(Number(price))) ? Number(price) : standardRate;
        total = rate * qty;
        desc = `รายชั่วโมง ${qty} ชั่วโมง`;
      }
    } else {
      rate = (price !== '' && !isNaN(Number(price))) ? Number(price) : (selectedItemObj.price || 0);
      qty = Number(quantity) || 1;
      total = rate * qty;
      desc = `บริการเสริม ${qty} ชิ้น`;
    }

    return { qty, rate, total, desc };
  };

  const handleAddManualItem = () => {
    if (!selectedItemObj) {
      sysAlert('กรุณาเลือกรายการสินค้า/บริการ');
      return;
    }

    const calc = getRealtimeCalculation();
    if (itemType === 'room' && bookingType === 'hourly' && (!startTime || !endTime)) {
      sysAlert('กรุณาระบุเวลาเข้าใช้งานสำหรับแบบรายชั่วโมง');
      return;
    }

    if (itemType === 'room') {
      setItems([...items, {
        room_id: selectedItemObj.id,
        service_id: null,
        room_name: selectedItemObj.name,
        service_name: null,
        quantity: calc.qty,
        price: calc.rate,
        start_time: startTime ? `2000-01-01T${startTime}` : null,
        end_time: endTime ? `2000-01-01T${endTime}` : null,
        subtotal: calc.total,
        layout,
        booking_type: bookingType
      }]);
    } else {
      setItems([...items, {
        room_id: null,
        service_id: selectedItemObj.id,
        room_name: null,
        service_name: selectedItemObj.name,
        quantity: calc.qty,
        price: calc.rate,
        start_time: null,
        end_time: null,
        subtotal: calc.total,
        layout: 'standard',
        booking_type: 'hourly'
      }]);
    }

    // Reset Item Adding inputs
    setSelectedItemObj(null);
    setPrice('');
    setStartTime('');
    setEndTime('');
    setQuantity(1);
  };

  const handleRemoveItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const getStatusLabel = (s) => {
    switch (s) {
      case 'draft': return 'ร่าง';
      case 'sent': return 'ส่งแล้ว';
      case 'accepted': return 'อนุมัติ/ยืนยัน';
      case 'rejected': return 'ปฏิเสธ';
      default: return s;
    }
  };

  const getStatusColor = (s) => {
    switch (s) {
      case 'accepted': return 'var(--success-color)';
      case 'sent': return 'var(--primary-color)';
      case 'rejected': return 'var(--danger-color)';
      default: return 'var(--text-muted)';
    }
  };

  const filteredQuotations = quotations.filter(q => {
    const matchesSearch = q.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) || (q.department && q.department.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedQuotations = [...filteredQuotations].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    if (sortField === 'id') {
      aVal = Number(a.id);
      bVal = Number(b.id);
    } else if (sortField === 'total_amount') {
      aVal = Number(a.total_amount);
      bVal = Number(b.total_amount);
    } else if (sortField === 'customer_name') {
      aVal = a.customer_name || '';
      bVal = b.customer_name || '';
    } else if (sortField === 'valid_until') {
      aVal = a.valid_until ? new Date(a.valid_until).getTime() : 0;
      bVal = b.valid_until ? new Date(b.valid_until).getTime() : 0;
    } else if (sortField === 'status') {
      aVal = a.status || '';
      bVal = b.status || '';
    } else if (sortField === 'created_at') {
      aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
      bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
    }

    if (typeof aVal === 'string') {
      return sortDirection === 'asc' 
        ? aVal.localeCompare(bVal, 'th')
        : bVal.localeCompare(aVal, 'th');
    } else {
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    }
  });

  const renderQuotationDocument = (q) => {
    if (!q) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', color: '#1e293b' }}>
        <div>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #cbd5e1', paddingBottom: '20px', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#1e3a8a', margin: '0', fontFamily: 'Sarabun, sans-serif' }}>ใบเสนอราคา / QUOTATION</h1>
              <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                <strong>เลขที่เอกสาร / Quotation ID:</strong> #QT-{q.id.toString().padStart(5, '0')}
              </p>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                <strong>วันที่ / Date:</strong> {new Date(q.created_at).toLocaleDateString('th-TH')}
              </p>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', fontWeight: 'bold', color: '#e11d48' }}>
                <strong>ยืนยันราคาก่อนวันที่ / Valid Until:</strong> {q.valid_until ? new Date(q.valid_until).toLocaleDateString('th-TH') : 'ไม่มีกำหนด'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h3 style={{ margin: '0', fontSize: '1.1rem', fontWeight: 'bold', color: '#1e3a8a' }}>{settings.company_name || 'Bwork POS'}</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b', maxWidth: '280px', lineHeight: 1.4 }}>
                {settings.receipt_header || 'ให้บริการเช่าพื้นที่ Co-working Space และห้องประชุมสัมมนาครบวงจร'}
              </p>
            </div>
          </div>

          {/* Client & Terms Block */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', margin: '24px 0', backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold' }}>ลูกค้าผู้ขอเสนอราคา / PREPARED FOR:</h4>
              <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: '#0f172a' }}>คุณ {q.customer_name}</div>
              {q.contact && <div style={{ marginTop: '4px', fontSize: '0.8rem', color: '#475569' }}>เบอร์ติดต่อ: {q.contact}</div>}
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold' }}>เงื่อนไขการจองและชำระเงิน:</h4>
              <div style={{ margin: '0', fontSize: '0.775rem', color: '#475569', lineHeight: 1.4, whiteSpace: 'pre-line', textAlign: 'right' }}>
                {settings?.quotation_terms || `- ชำระมัดจำ 50% เพื่อจองคิวการใช้งาน\n- ส่วนที่เหลือชำระ ณ วันเข้าใช้งานบริการ\n- อัตราค่าบริการนี้รวมภาษีมูลค่าเพิ่มแล้ว`}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e3a8a', color: '#ffffff' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', borderRadius: '6px 0 0 6px', fontSize: '0.8rem', width: '50%' }}>รายละเอียดรายการบริการ / DESCRIPTION</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: '0.8rem', width: '15%' }}>จำนวน / QTY</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '0.8rem', width: '15%' }}>ราคาต่อหน่วย / UNIT</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', borderRadius: '0 6px 6px 0', fontSize: '0.8rem', width: '20%' }}>จำนวนเงินสุทธิ / AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {q.items && q.items.map((item, index) => {
                let itemName = item.room_name || item.service_name;
                let details = '';
                if (item.room_id) {
                  const startT = item.start_time ? new Date(item.start_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
                  const endT = item.end_time ? new Date(item.end_time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
                  
                  if (item.booking_type === 'daily') {
                    details = `บริการห้องประชุมรายวัน (ทั้งวัน) - สไตล์ ${item.layout === 'classroom' ? 'Classroom' : 'Standard'}`;
                  } else if (item.booking_type === 'halfday') {
                    details = `บริการห้องประชุมครึ่งวัน (4 ชม.) - สไตล์ ${item.layout === 'classroom' ? 'Classroom' : 'Standard'}`;
                  } else {
                    details = `บริการห้องประชุมรายชั่วโมง (${startT} - ${endT} น.) - สไตล์ ${item.layout === 'classroom' ? 'Classroom' : 'Standard'}`;
                  }
                } else {
                  details = 'บริการเสริมเพิ่มเติม';
                }

                return (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{itemName}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>{details}</div>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center', color: '#0f172a' }}>
                      {item.room_id ? (
                        item.booking_type === 'daily' ? '1 วัน' : 
                        item.booking_type === 'halfday' ? 'ครึ่งวัน' : 
                        `${item.quantity} ชั่วโมง`
                      ) : `${item.quantity} รายการ`}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#0f172a' }}>
                      {item.price ? `${item.price.toLocaleString()}.-` : '-'}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 'bold', color: '#0f172a' }}>
                      {item.subtotal.toLocaleString()}.-
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Total Block */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
            <div style={{ width: '280px', backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.8rem', color: '#475569' }}>
                <span>ราคารวม / Subtotal:</span>
                <span>{q.total_amount.toLocaleString()}.-</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#64748b', fontSize: '0.775rem' }}>
                <span>ภาษีมูลค่าเพิ่ม / VAT 7%:</span>
                <span>รวมแล้ว</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #cbd5e1', paddingTop: '10px', fontWeight: 'bold', fontSize: '1.1rem', color: '#1e3a8a' }}>
                <span>ยอดสุทธิ / Total:</span>
                <span>{q.total_amount.toLocaleString()} บาท</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Signature Block */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '80px', marginTop: '60px', textAlign: 'center' }}>
          <div style={{ flex: 1, borderTop: '1px dashed #64748b', paddingTop: '10px' }}>
            <p style={{ margin: '0', fontSize: '0.775rem', color: '#64748b' }}>{settings?.quotation_signer || 'ผู้อนุมัติเสนอราคา'} / Authorized Signature</p>
            <p style={{ margin: '40px 0 0 0', fontWeight: 'bold', color: '#0f172a' }}>({user.fullname || 'พนักงานประจำ'})</p>
          </div>
          <div style={{ flex: 1, borderTop: '1px dashed #64748b', paddingTop: '10px' }}>
            <p style={{ margin: '0', fontSize: '0.775rem', color: '#64748b' }}>ผู้ยืนยันรับใบเสนอราคา / Client Acceptance</p>
            <p style={{ margin: '40px 0 0 0', color: '#cbd5e1' }}>(ลงนามยืนยันจองคิว)</p>
          </div>
        </div>
      </div>
    );
  };

  const triggerPrint = () => {
    setTimeout(() => {
      window.print();
    }, 300);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Dynamic Local Stylesheet Injection to completely optimize printing and prevent web-app freezes */}
      <style dangerouslySetInnerHTML={{__html: `
        @media screen {
          .print-quotation-document {
            display: none !important;
          }
        }
        @media print {
          body * {
            visibility: hidden !important;
          }
          .print-quotation-document, .print-quotation-document * {
            visibility: visible !important;
          }
          .print-quotation-document {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 24px !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-size: 11pt !important;
            line-height: 1.4 !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}} />

      {/* Hidden Print Container - Rendered ONLY on printed page */}
      {selectedQuotation && (
        <div className="print-quotation-document">
          {renderQuotationDocument(selectedQuotation)}
        </div>
      )}

      {/* 🔮 QUOTATION PREVIEW MODAL */}
      {showPreview && selectedQuotation && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '24px'
        }} onClick={() => setShowPreview(false)}>
          <div className="card animate-fade-in" style={{
            width: '100%',
            maxWidth: '850px',
            height: '92vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '0px',
            borderRadius: '24px',
            border: '1px solid var(--glass-border)',
            background: 'var(--bg-glass-modal, rgba(30, 41, 59, 0.95))',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
            overflow: 'hidden'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'rgba(0, 0, 0, 0.2)'
            }}>
              <div>
                <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  ตัวอย่างเอกสารใบเสนอราคา (Quotation Preview)
                </h2>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  เอกสารเลขที่ #QT-{selectedQuotation.id.toString().padStart(5, '0')}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.8rem', gap: '6px', height: '36px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                  onClick={triggerPrint}
                >
                  <Printer size={15} />
                  <span>พิมพ์เอกสาร</span>
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ padding: '8px 16px', borderRadius: '10px', fontSize: '0.8rem', border: '1px solid var(--border-color)', color: 'var(--text-main)', background: 'transparent', height: '36px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setShowPreview(false)}
                >
                  <span>ปิดหน้าต่าง</span>
                </button>
              </div>
            </div>

            {/* Scrollable A4 Document Sheet Area */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px',
              backgroundColor: 'rgba(0,0,0,0.12)',
              display: 'flex',
              justifyContent: 'center'
            }}>
              {/* Actual A4 Sheet Preview */}
              <div style={{
                backgroundColor: '#ffffff',
                padding: '40px',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '780px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                fontFamily: 'Sarabun, sans-serif',
                fontSize: '0.875rem',
                minHeight: '270mm',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid #cbd5e1'
              }}>
                {renderQuotationDocument(selectedQuotation)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. VIEW MODE: FORM (CREATE / EDIT) */}
      {(viewMode === 'create' || viewMode === 'edit') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="tab-header">
            <div>
              <h1 className="tab-title">
                {viewMode === 'create' ? 'เขียนใบเสนอราคาใหม่' : `แก้ไขใบเสนอราคา #${selectedQuotation?.id}`}
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px', fontWeight: '650' }}>
                สร้างเอกสารประมาณการและใบเสนอราคาสำหรับจองห้องประชุมและบริการเสริม
              </p>
            </div>
            <button className="btn btn-secondary" style={{ padding: '8px 18px', borderRadius: '12px', height: '40px' }} onClick={() => setViewMode('list')}>
              ยกเลิก
            </button>
          </div>

          <form onSubmit={handleSaveQuotation} className="grid-cols-3" style={{ gap: '24px', alignItems: 'stretch' }}>
            
            {/* Form Fields: Customer Metadata (Left 1/3) */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', borderRadius: '24px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: 'var(--primary-color)', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                ข้อมูลผู้รับเสนอราคา
              </h3>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ชื่อลูกค้า / บริษัท <span style={{ color: 'var(--danger-color)' }}>*</span></label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={customerName} 
                  onChange={e => setCustomerName(e.target.value)} 
                  placeholder="กรอกชื่อลูกค้า/บริษัทหลัก..."
                  required
                />
              </div>



              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ช่องทางการติดต่อ</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={contact} 
                  onChange={e => setContact(e.target.value)} 
                  placeholder="เบอร์โทร หรือ อีเมล..."
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.825rem', fontWeight: 650 }}>ราคาเสนอมีผลถึงวันที่ (Valid Until)</label>
                <input 
                  type="date" 
                  className="form-control" 
                  value={validUntil} 
                  onChange={e => setValidUntil(e.target.value)} 
                />
              </div>
            </div>

            {/* Items Management (Right 2/3) */}
            <div className="card" style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--glass-border)', background: 'var(--bg-card)', borderRadius: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  รายการห้องและบริการเสริมในเสนอราคา
                </h3>
                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>
                  รวม {items.length} รายการ
                </span>
              </div>

              {/* Add Manual Item Dock */}
              <div style={{ 
                padding: '16px', 
                borderRadius: '16px', 
                backgroundColor: 'rgba(255, 255, 255, 0.015)', 
                border: '1px dashed var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '6px', background: 'rgba(0, 0, 0, 0.12)', padding: '4px', borderRadius: '99px', border: '1px solid var(--border-color)' }}>
                    <button
                      type="button"
                      onClick={() => { setItemType('room'); setSelectedItemObj(null); }}
                      style={{ padding: '6px 14px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', background: itemType === 'room' ? 'var(--primary-color)' : 'transparent', color: itemType === 'room' ? '#ffffff' : 'var(--text-muted)' }}
                    >
                      ห้องประชุม
                    </button>
                    <button
                      type="button"
                      onClick={() => { setItemType('service'); setSelectedItemObj(null); }}
                      style={{ padding: '6px 14px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', background: itemType === 'service' ? 'var(--primary-color)' : 'transparent', color: itemType === 'service' ? '#ffffff' : 'var(--text-muted)' }}
                    >
                      บริการเสริม
                    </button>
                  </div>

                  {/* Dropdown selector */}
                  <select
                    className="form-control"
                    style={{ flex: 1, height: '36px', fontSize: '0.8rem', borderRadius: '10px' }}
                    value={selectedItemObj ? selectedItemObj.id : ''}
                    onChange={e => {
                      const id = Number(e.target.value);
                      const list = itemType === 'room' ? rooms : services;
                      const found = list.find(x => x.id === id);
                      setSelectedItemObj(found || null);
                      if (found) {
                        if (itemType === 'room') {
                          if (bookingType === 'daily') {
                            setPrice(layout === 'classroom' ? (found.classroom_daily_rate || found.daily_rate) : found.daily_rate);
                          } else if (bookingType === 'halfday') {
                            setPrice(found.half_day_rate);
                          } else {
                            setPrice(layout === 'classroom' ? (found.classroom_hourly_rate || found.hourly_rate) : found.hourly_rate);
                          }
                        } else {
                          setPrice(found.price);
                        }
                      }
                    }}
                  >
                    <option value="">-- เลือก{itemType === 'room' ? 'ห้องประชุม' : 'บริการเสริม'} --</option>
                    {(itemType === 'room' ? rooms : services).map(x => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                </div>

                {selectedItemObj && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '12px', alignItems: 'center' }}>
                    
                    {itemType === 'room' && (
                      <>
                        <div className="form-group" style={{ margin: 0 }}>
                          <select 
                            className="form-control" 
                            style={{ height: '34px', fontSize: '0.75rem', borderRadius: '8px' }} 
                            value={bookingType} 
                            onChange={e => {
                              const bt = e.target.value;
                              setBookingType(bt);
                              if (selectedItemObj) {
                                if (bt === 'daily') {
                                  setPrice(layout === 'classroom' ? (selectedItemObj.classroom_daily_rate || selectedItemObj.daily_rate) : selectedItemObj.daily_rate);
                                } else if (bt === 'halfday') {
                                  setPrice(selectedItemObj.half_day_rate);
                                } else {
                                  setPrice(layout === 'classroom' ? (selectedItemObj.classroom_hourly_rate || selectedItemObj.hourly_rate) : selectedItemObj.hourly_rate);
                                }
                              }
                            }}
                          >
                            <option value="hourly">รายชั่วโมง</option>
                            <option value="halfday">ครึ่งวัน</option>
                            <option value="daily">รายวัน (ทั้งวัน)</option>
                          </select>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <select 
                            className="form-control" 
                            style={{ height: '34px', fontSize: '0.75rem', borderRadius: '8px' }} 
                            value={layout} 
                            onChange={e => {
                              const l = e.target.value;
                              setLayout(l);
                              if (selectedItemObj) {
                                if (bookingType === 'daily') {
                                  setPrice(l === 'classroom' ? (selectedItemObj.classroom_daily_rate || selectedItemObj.daily_rate) : selectedItemObj.daily_rate);
                                } else if (bookingType === 'halfday') {
                                  setPrice(selectedItemObj.half_day_rate);
                                } else {
                                  setPrice(l === 'classroom' ? (selectedItemObj.classroom_hourly_rate || selectedItemObj.hourly_rate) : selectedItemObj.hourly_rate);
                                }
                              }
                            }}
                          >
                            <option value="standard">Standard (Std)</option>
                            <option value="classroom">Classroom (CR)</option>
                          </select>
                        </div>
                        {bookingType === 'hourly' && (
                          <>
                            <div className="form-group" style={{ margin: 0 }}>
                              <input type="time" className="form-control" style={{ height: '34px', fontSize: '0.75rem', borderRadius: '8px' }} value={startTime} onChange={e => setStartTime(e.target.value)} />
                            </div>
                            <div className="form-group" style={{ margin: 0 }}>
                              <input type="time" className="form-control" style={{ height: '34px', fontSize: '0.75rem', borderRadius: '8px' }} value={endTime} onChange={e => setEndTime(e.target.value)} />
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {itemType === 'service' && (
                      <div className="form-group" style={{ margin: 0 }}>
                        <input type="number" className="form-control" style={{ height: '34px', fontSize: '0.75rem', borderRadius: '8px' }} min="1" value={quantity} onChange={e => setQuantity(Number(e.target.value))} placeholder="จำนวน" />
                      </div>
                    )}

                    <div className="form-group" style={{ margin: 0 }}>
                      <input type="number" className="form-control" style={{ height: '34px', fontSize: '0.75rem', borderRadius: '8px' }} value={price} onChange={e => setPrice(e.target.value !== '' ? Number(e.target.value) : '')} placeholder="ระบุราคาพิเศษ" />
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ height: '34px', borderRadius: '8px', padding: '0 12px', fontSize: '0.75rem', width: 'auto' }}
                      onClick={handleAddManualItem}
                    >
                      เพิ่มรายการ
                    </button>

                    {(() => {
                      const calc = getRealtimeCalculation();
                      if (!calc) return null;
                      return (
                        <div style={{
                          gridColumn: '1 / -1',
                          padding: '10px 14px',
                          borderRadius: '12px',
                          backgroundColor: 'rgba(99, 102, 241, 0.08)',
                          border: '1px solid rgba(99, 102, 241, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '0.8rem',
                          color: 'var(--text-main)',
                          marginTop: '6px'
                        }}>
                          <span><strong>สรุปคำนวณราคาด่วน:</strong> {calc.desc}</span>
                          <span>
                            <strong>{calc.qty}</strong> x <strong>{calc.rate.toLocaleString()}.-</strong> = <strong style={{ color: 'var(--primary-color)', fontSize: '0.9rem' }}>{calc.total.toLocaleString()} บาท</strong>
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Items List Table */}
              <div style={{ flex: 1, maxHeight: '250px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '16px' }}>
                <table className="custom-table" style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '10px' }}>รายละเอียดบริการ</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>จำนวน</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>ราคาหน่วย</th>
                      <th style={{ padding: '10px', textAlign: 'right' }}>ราคาสุทธิ</th>
                      <th style={{ padding: '10px', textAlign: 'center' }}>ลบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          ยังไม่มีสินค้า/บริการในเสนอราคา
                        </td>
                      </tr>
                    ) : (
                      items.map((item, idx) => (
                        <tr key={idx}>
                          <td style={{ padding: '10px' }}>
                            <div style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>{item.room_name || item.service_name}</div>
                            {item.room_id && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {item.booking_type === 'daily' ? 'รายวัน' : item.booking_type === 'halfday' ? 'ครึ่งวัน' : 'รายชั่วโมง'}{' '}
                                ({item.layout === 'classroom' ? 'Classroom' : 'Standard'})
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'center' }}>
                            {item.room_id ? (
                              item.booking_type === 'daily' ? '1 วัน' : 
                              item.booking_type === 'halfday' ? 'ครึ่งวัน' : 
                              `${item.quantity} ชม.`
                            ) : `${item.quantity} ชิ้น`}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right' }}>
                            {item.price ? `${item.price.toLocaleString()}.-` : '-'}
                          </td>
                          <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold' }}>
                            {item.subtotal.toLocaleString()}.-
                          </td>
                          <td style={{ padding: '10px', textAlign: 'center' }}>
                            <button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--danger-color)', cursor: 'pointer' }} onClick={() => handleRemoveItem(idx)}>
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Form Actions bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: 'auto' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>ราคาสุทธิรวมทั้งหมด</span>
                  <div style={{ fontSize: '1.4rem', fontWeight: 900, color: 'var(--text-main)' }}>
                    {items.reduce((sum, item) => sum + item.subtotal, 0).toLocaleString()}.-
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" className="btn btn-secondary" style={{ padding: '10px 20px', borderRadius: '12px' }} onClick={() => setViewMode('list')}>
                    กลับรายการ
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ padding: '10px 24px', borderRadius: '12px', gap: '6px' }}>
                    <Check size={16} />
                    บันทึกเอกสาร
                  </button>
                </div>
              </div>
            </div>

          </form>
        </div>
      )}

      {/* 3. VIEW MODE: LIST OF QUOTATIONS */}
      {viewMode === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          <div className="tab-header">
            <div>
              <h1 className="tab-title">ระบบจัดการใบเสนอราคา (Quotations)</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px', fontWeight: '650' }}>
                พิมพ์ ปรับปรุง แก้ไขสถานะ หรือแปลงใบเสนอราคาเป็นประวัติการจองและเปิดบิล
              </p>
            </div>
            
            <button className="btn btn-primary" style={{ padding: '10px 22px', borderRadius: '14px', height: '42px', gap: '8px' }} onClick={handleCreateQuotation}>
              <Plus size={16} />
              <span>สร้างใบเสนอราคาใหม่</span>
            </button>
          </div>

          {/* Filter & Search Bar */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
            background: 'var(--bg-card)',
            padding: '18px 24px',
            borderRadius: '24px',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'blur(20px)',
            boxShadow: 'var(--glass-shadow)',
          }}>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flex: 1, minWidth: '300px' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '280px' }}>
                <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder="ค้นหาชื่อลูกค้า หรือหน่วยงาน..."
                  style={{ paddingLeft: '44px', width: '100%', borderRadius: '14px', fontSize: '0.85rem', height: '42px', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', color: 'var(--text-main)', fontWeight: '600' }}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Status Tabs switcher */}
              <div style={{
                display: 'flex',
                gap: '4px',
                background: 'rgba(0, 0, 0, 0.12)',
                border: '1px solid var(--border-color)',
                padding: '4px',
                borderRadius: '99px'
              }}>
                {['all', 'draft', 'sent', 'accepted', 'rejected'].map(st => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '99px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      border: 'none',
                      transition: 'all 0.2s',
                      background: statusFilter === st ? 'var(--primary-color)' : 'transparent',
                      color: statusFilter === st ? '#ffffff' : 'var(--text-muted)'
                    }}
                  >
                    {st === 'all' ? 'ทั้งหมด' : getStatusLabel(st)}
                  </button>
                ))}
              </div>
            </div>

            <button className="btn btn-secondary" style={{ height: '42px', borderRadius: '14px', padding: '0 16px', gap: '8px' }} onClick={fetchQuotations}>
              <RefreshCw size={14} className={loading ? 'spin-anim' : ''} />
              <span>รีเฟรช</span>
            </button>
          </div>

          {/* Quotations Table */}
          {loading ? (
            <div className="card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0', border: '1px solid var(--glass-border)', background: 'var(--bg-card)' }}>
              <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังดึงข้อมูลใบเสนอราคา...</span>
            </div>
          ) : (
            <div className="card" style={{ 
              padding: '0px', 
              overflow: 'hidden', 
              border: '1px solid var(--glass-border)', 
              background: 'var(--bg-card)', 
              boxShadow: 'var(--glass-shadow)',
              borderRadius: '24px'
            }}>
              <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '100px', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none', color: sortField === 'id' ? 'var(--primary-color)' : 'inherit' }} onClick={() => handleSort('id')}>
                        ID {sortField === 'id' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none', color: sortField === 'customer_name' ? 'var(--primary-color)' : 'inherit' }} onClick={() => handleSort('customer_name')}>
                        ชื่อลูกค้า {sortField === 'customer_name' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none', color: sortField === 'created_at' ? 'var(--primary-color)' : 'inherit' }} onClick={() => handleSort('created_at')}>
                        วันที่สร้าง {sortField === 'created_at' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th>เบอร์ติดต่อ</th>
                      <th style={{ textAlign: 'right', cursor: 'pointer', userSelect: 'none', color: sortField === 'total_amount' ? 'var(--primary-color)' : 'inherit' }} onClick={() => handleSort('total_amount')}>
                        ยอดเงินสุทธิ {sortField === 'total_amount' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none', color: sortField === 'valid_until' ? 'var(--primary-color)' : 'inherit' }} onClick={() => handleSort('valid_until')}>
                        มีผลถึงวันที่ {sortField === 'valid_until' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th style={{ cursor: 'pointer', userSelect: 'none', color: sortField === 'status' ? 'var(--primary-color)' : 'inherit' }} onClick={() => handleSort('status')}>
                        สถานะ {sortField === 'status' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      <th style={{ textAlign: 'center', width: '320px' }}>การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedQuotations.length === 0 ? (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                          ไม่พบรายการใบเสนอราคาในระบบ
                        </td>
                      </tr>
                    ) : (
                      sortedQuotations.map(q => (
                        <tr key={q.id}>
                          <td style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>#QT-{q.id.toString().padStart(5, '0')}</td>
                          <td style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>คุณ {q.customer_name}</td>
                          <td>
                            {new Date(q.created_at).toLocaleDateString('th-TH')}
                          </td>
                          <td>{q.contact || '-'}</td>
                          <td style={{ textAlign: 'right', fontWeight: '900', color: 'var(--text-main)', fontSize: '0.95rem' }}>
                            {q.total_amount.toLocaleString()}.-
                          </td>
                          <td>
                            {q.valid_until ? (
                              <span style={{ 
                                color: new Date(q.valid_until) < new Date() ? 'var(--danger-color)' : 'var(--text-main)',
                                fontWeight: new Date(q.valid_until) < new Date() ? 'bold' : 'normal'
                              }}>
                                {new Date(q.valid_until).toLocaleDateString('th-TH')}
                                {new Date(q.valid_until) < new Date() && ' (หมดอายุ)'}
                              </span>
                            ) : 'ไม่มีกำหนด'}
                          </td>
                          <td>
                            <select
                              value={q.status}
                              onChange={e => handleUpdateStatus(q.id, e.target.value)}
                              style={{ 
                                padding: '4px 8px', 
                                borderRadius: '8px', 
                                fontSize: '0.75rem', 
                                fontWeight: 'bold',
                                backgroundColor: 'rgba(0,0,0,0.1)',
                                border: '1px solid var(--border-color)',
                                color: getStatusColor(q.status)
                              }}
                            >
                              <option value="draft" style={{ color: 'var(--text-muted)' }}>ร่าง (Draft)</option>
                              <option value="sent" style={{ color: 'var(--primary-color)' }}>ส่งลูกค้าแล้ว (Sent)</option>
                              <option value="accepted" style={{ color: 'var(--success-color)' }}>อนุมัติแล้ว (Accepted)</option>
                              <option value="rejected" style={{ color: 'var(--danger-color)' }}>ปฏิเสธ (Rejected)</option>
                            </select>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.75rem', height: '32px', gap: '4px', cursor: 'pointer' }}
                                onClick={() => handlePrintQuotation(q)}
                              >
                                <Printer size={14} />
                                พิมพ์
                              </button>
                              
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.75rem', height: '32px', gap: '4px', cursor: 'pointer' }}
                                onClick={() => handleEditQuotation(q)}
                              >
                                <Edit size={14} />
                                แก้ไข
                              </button>

                              <button
                                className="btn btn-primary"
                                style={{ 
                                  padding: '6px 12px', 
                                  borderRadius: '8px', 
                                  fontSize: '0.75rem', 
                                  height: '32px', 
                                  gap: '4px',
                                  backgroundColor: 'var(--primary-color)',
                                  border: 'none',
                                  cursor: 'pointer',
                                  visibility: q.status === 'accepted' ? 'hidden' : 'visible'
                                }}
                                onClick={() => handleConvertQuotation(q)}
                              >
                                <ArrowRight size={14} />
                                จอง/เปิดบิล
                              </button>

                              <button
                                className="btn-action btn-action-danger"
                                style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                                onClick={() => handleDeleteQuotation(q.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

export default Quotations;
