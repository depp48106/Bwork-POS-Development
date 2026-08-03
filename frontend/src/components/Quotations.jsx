import React, { useState, useEffect } from 'react';
import { Plus, Minus, Trash2, Calendar, FileText, Check, X, Search, Printer, ArrowRight, AlertCircle, Edit, Trash, RefreshCw, ChevronDown, Clock } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';

const timeOptions = (() => {
  const options = [];
  for (let h = 0; h < 24; h++) {
    const hh = h.toString().padStart(2, '0');
    options.push(`${hh}:00`);
    options.push(`${hh}:30`);
  }
  return options;
})();

function thaiBahtText(num) {
  if (num === null || num === undefined || isNaN(num)) return '';
  num = Math.round(num * 100) / 100;
  if (num === 0) return 'ศูนย์บาทถ้วน';

  const numbers = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const digits = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

  const parts = num.toFixed(2).split('.');
  const baht = parseInt(parts[0], 10);
  const satang = parseInt(parts[1], 10);

  function convertGroup(nStr) {
    let res = '';
    const len = nStr.length;
    for (let i = 0; i < len; i++) {
      const digit = parseInt(nStr[i], 10);
      const pos = len - i - 1;
      if (digit !== 0) {
        if (pos === 1 && digit === 1) {
          res += 'สิบ';
        } else if (pos === 1 && digit === 2) {
          res += 'ยี่สิบ';
        } else if (pos === 0 && digit === 1 && len > 1) {
          res += 'เอ็ด';
        } else {
          res += numbers[digit] + digits[pos];
        }
      }
    }
    return res;
  }

  function convertBaht(n) {
    if (n === 0) return '';
    const nStr = n.toString();
    if (nStr.length <= 6) return convertGroup(nStr);
    const millions = nStr.substring(0, nStr.length - 6);
    const remainder = nStr.substring(nStr.length - 6);
    return convertBaht(parseInt(millions, 10)) + 'ล้าน' + convertGroup(remainder);
  }

  let text = convertBaht(baht) + 'บาท';
  if (satang === 0) {
    text += 'ถ้วน';
  } else {
    text += convertGroup(satang.toString().padStart(2, '0')) + 'สตางค์';
  }
  return text;
}


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
  const [customerAddress, setCustomerAddress] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [jobName, setJobName] = useState('Meeting Room');
  const [quotationNo, setQuotationNo] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState([]);

  // Database room & services for manual item adding
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);

  // Manual Add Item state
  const [itemType, setItemType] = useState('room'); // 'room' or 'service'
  const [selectedItemObj, setSelectedItemObj] = useState(null);
  const [isQuotationProductDropdownOpen, setIsQuotationProductDropdownOpen] = useState(false);
  const [isSellerDropdownOpen, setIsSellerDropdownOpen] = useState(false);
  const [isBookingTypeOpen, setIsBookingTypeOpen] = useState(false);
  const [isLayoutOpen, setIsLayoutOpen] = useState(false);
  const [isStartTimeOpen, setIsStartTimeOpen] = useState(false);
  const [isEndTimeOpen, setIsEndTimeOpen] = useState(false);
  const [activeStatusDropdownId, setActiveStatusDropdownId] = useState(null);
  const [statusDropdownPos, setStatusDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState('amount'); // 'amount' (บาท) or 'percent' (%)
  const [editingIndex, setEditingIndex] = useState(null);
  const [itemDate, setItemDate] = useState(new Date().toISOString().split('T')[0]);
  const [layout, setLayout] = useState('standard');
  const [bookingType, setBookingType] = useState('hourly');

  // Live Settings state from database
  const [localSettings, setLocalSettings] = useState(settings || {});

  const fetchLiveSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setLocalSettings(data);
      }
    } catch (err) {
      console.error('Failed to fetch live settings in Quotations:', err);
    }
  };

  useEffect(() => {
    fetchQuotations();
    fetchCatalog();
    fetchLiveSettings();
  }, []);

  // Pre-fill from POS cart if available
  useEffect(() => {
    if (quotationCartData) {
      setCustomerName(quotationCartData.customerName || '');
      setContact(quotationCartData.contact || '');
      setDepartment(quotationCartData.department || '');
      setCustomerAddress(quotationCartData.department || quotationCartData.contact || '');
      setSellerName(user?.fullname || 'นางสาวอุณรวี อิศรางกูร ณ อยุธยา');
      setJobName('Meeting Room');
      
      fetchNextQuotationNo().then(qNo => setQuotationNo(qNo));
      
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

  const fetchNextQuotationNo = async () => {
    try {
      const res = await fetch('/api/quotations/next-number');
      if (res.ok) {
        const data = await res.json();
        return data.quotation_no;
      }
    } catch (e) {
      console.error('Failed to fetch next quotation number:', e);
    }
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `QT${y}${m}0001`;
  };

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

  const handleCreateQuotation = async () => {
    fetchLiveSettings();
    setCustomerName('');
    setDepartment('');
    setContact('');
    setCustomerAddress('');

    setSellerName('');
    setJobName('Meeting Room');
    
    const autoNo = await fetchNextQuotationNo();
    setQuotationNo(autoNo);
    
    // Default valid date from settings
    const activeSt = localSettings?.quotation_valid_days ? localSettings : settings;
    const validDays = Number(activeSt?.quotation_valid_days) || 7;
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
        setCustomerName(fullQ.customer_name || '');
        setDepartment(fullQ.department || '');
        setContact(fullQ.contact || '');
        setCustomerAddress(fullQ.customer_address || fullQ.department || fullQ.contact || '');
        setSellerName(fullQ.seller_name || user?.fullname || 'นางสาวอุณรวี อิศรางกูร ณ อยุธยา');
        setJobName(fullQ.job_name || 'Meeting Room');
        setQuotationNo(fullQ.quotation_no || `QT${new Date(fullQ.created_at || Date.now()).getFullYear()}${(new Date(fullQ.created_at || Date.now()).getMonth()+1).toString().padStart(2,'0')}${String(fullQ.id || '').padStart(4,'0')}`);
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
    if (!customerName || !customerName.trim()) {
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
      customer_address: customerAddress,
      seller_name: sellerName,
      job_name: jobName,
      quotation_no: quotationNo,
      total_amount: items.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0),
      valid_until: validUntil,
      items
    };

    const isEdit = viewMode === 'edit';

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

    let qty = Number(quantity) || 1;
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
        qty = Number(quantity) || 1;
        total = rate * qty;
        desc = `รายวัน (ทั้งวัน) ${qty} วัน`;
      } else if (bookingType === 'halfday') {
        const halfdayRate = selectedItemObj.half_day_rate || standardRate * 4;
        rate = (price !== '' && !isNaN(Number(price))) ? Number(price) : halfdayRate;
        qty = Number(quantity) || 1;
        total = rate * qty;
        desc = `ครึ่งวัน ${qty} ครั้ง`;
      } else {
        let hourCount = 1;
        if (startTime && endTime) {
          const [sh, sm] = startTime.split(':').map(Number);
          const [eh, em] = endTime.split(':').map(Number);
          if (!isNaN(sh) && !isNaN(eh)) {
            const diff = (eh * 60 + em) - (sh * 60 + sm);
            hourCount = Math.max(1, Math.ceil(diff / 60));
          }
        }
        qty = Number(quantity) > 1 ? Number(quantity) : hourCount;
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

    const discVal = Number(discount) || 0;
    const discAmt = discountType === 'percent' ? (total * discVal) / 100 : discVal;
    const finalTotal = Math.max(0, total - discAmt);

    return { qty, rate, total: finalTotal, rawTotal: total, discount: discVal, discountType, discountAmt: discAmt, desc };
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

    const newItem = {
      room_id: itemType === 'room' ? selectedItemObj.id : null,
      service_id: itemType === 'service' ? selectedItemObj.id : null,
      room_name: itemType === 'room' ? selectedItemObj.name : null,
      room_description: itemType === 'room' ? (selectedItemObj.description || '') : '',
      room_capacity: selectedItemObj.capacity || selectedItemObj.room_capacity || 4,
      capacity: selectedItemObj.capacity || selectedItemObj.room_capacity || 4,
      service_name: itemType === 'service' ? selectedItemObj.name : null,
      service_description: itemType === 'service' ? (selectedItemObj.description || '') : '',
      quantity: calc.qty,
      price: calc.rate,
      start_time: startTime ? `${itemDate}T${startTime}` : `${itemDate}T00:00`,
      end_time: endTime ? `${itemDate}T${endTime}` : `${itemDate}T23:59`,
      item_date: itemDate,
      discount: calc.discount,
      discount_type: discountType,
      subtotal: calc.total,
      layout: itemType === 'room' ? layout : 'standard',
      booking_type: itemType === 'room' ? bookingType : 'hourly'
    };

    if (editingIndex !== null) {
      const updated = [...items];
      updated[editingIndex] = newItem;
      setItems(updated);
      setEditingIndex(null);
    } else {
      setItems([...items, newItem]);
    }

    // Reset Item Adding inputs
    setSelectedItemObj(null);
    setPrice('');
    setStartTime('');
    setEndTime('');
    setQuantity(1);
    setDiscount(0);
    setDiscountType('amount');
    setItemDate(new Date().toISOString().split('T')[0]);
  };

  const handleEditRow = (index) => {
    const item = items[index];
    if (!item) return;

    setEditingIndex(index);
    if (item.room_id) {
      setItemType('room');
      const foundRoom = rooms.find(r => r.id === item.room_id) || {
        id: item.room_id,
        name: item.room_name,
        capacity: item.capacity || item.room_capacity,
        hourly_rate: item.price
      };
      setSelectedItemObj(foundRoom);
    } else {
      setItemType('service');
      const foundService = services.find(s => s.id === item.service_id) || {
        id: item.service_id,
        name: item.service_name,
        price: item.price
      };
      setSelectedItemObj(foundService);
    }

    setQuantity(item.quantity || 1);
    setPrice(item.price || 0);
    setDiscount(item.discount || 0);
    setDiscountType(item.discount_type || 'amount');
    setLayout(item.layout || 'standard');
    setBookingType(item.booking_type || 'hourly');
    setItemDate(item.item_date || (item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[0] : new Date().toISOString().split('T')[0]));

    if (item.start_time && item.start_time.includes('T')) {
      const t = item.start_time.split('T')[1];
      if (t) setStartTime(t.slice(0, 5));
    }
    if (item.end_time && item.end_time.includes('T')) {
      const t = item.end_time.split('T')[1];
      if (t) setEndTime(t.slice(0, 5));
    }
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

    const totalAmt = Number(q.total_amount) || 0;
    const vatAmt = totalAmt * (7 / 107);
    const beforeVatAmt = totalAmt - vatAmt;

    const qNo = q.quotation_no || (q.id ? `QT${new Date(q.created_at || Date.now()).getFullYear()}${(new Date(q.created_at || Date.now()).getMonth()+1).toString().padStart(2,'0')}${String(q.id || '').padStart(4,'0')}` : 'QT2026060002');
    const qDate = q.created_at ? new Date(q.created_at).toLocaleDateString('th-TH') : new Date().toLocaleDateString('th-TH');
    const qSeller = q.seller_name || user?.fullname || 'นางสาวอุณรวี อิศรางกูร ณ อยุธยา';
    const qJob = q.job_name || 'Meeting Room';
    const qValidUntil = q.valid_until || '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', color: '#1e293b', backgroundColor: '#ffffff', padding: '10px 5px', fontFamily: 'Sarabun, "Noto Sans Thai", sans-serif' }}>
        <div>
          {/* Header Section: Left (Logo & Company & Customer) | Right (Title & Meta) */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            
            {/* Left Box: Branding + Company Address + Customer Info */}
            <div style={{ width: '58%' }}>
              {/* Logos */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px', alignItems: 'flex-start' }}>
                <img 
                  src="/BH-LOGO.png" 
                  alt="BUILT HEART" 
                  style={{ height: '28px', width: 'auto', objectFit: 'contain' }} 
                />
                <img 
                  src="/BWORK-LOGO.png" 
                  alt="B WORK" 
                  style={{ height: '36px', width: 'auto', objectFit: 'contain' }} 
                />
              </div>

              {/* Company Info */}
              <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.45 }}>
                <div style={{ fontWeight: 'bold' }}>{localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)'}</div>
                <div>{localSettings?.quotation_company_address || settings?.quotation_company_address || '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120'}</div>
                <div>เลขประจำตัวผู้เสียภาษี {localSettings?.quotation_company_tax_id || settings?.quotation_company_tax_id || '0125554000401'}</div>
              </div>

              {/* Customer Section */}
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#f38f1d' }}>ลูกค้า</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#0f172a', marginTop: '2px' }}>{q.customer_name}</div>
                <div style={{ fontSize: '0.8rem', color: '#334155', whiteSpace: 'pre-line', marginTop: '2px', lineHeight: 1.4 }}>
                  {q.customer_address || q.department || q.contact || ''}
                </div>
              </div>
            </div>

            {/* Right Box: Document Title "ใบเสนอราคา" + Metadata Grid */}
            <div style={{ width: '38%', textAlign: 'right' }}>
              <h1 style={{ fontSize: '1.9rem', fontWeight: 'bold', color: '#f38f1d', margin: 0, padding: 0, fontFamily: 'Sarabun, sans-serif' }}>
                ใบเสนอราคา
              </h1>
              <div style={{ borderBottom: '1px solid #cbd5e1', margin: '8px 0 12px 0' }}></div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '3px 0', color: '#f38f1d', width: '35%', fontWeight: '500' }}>เลขที่</td>
                    <td style={{ padding: '3px 0', color: '#0f172a', fontWeight: '600' }}>{qNo}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 0', color: '#f38f1d', fontWeight: '500' }}>วันที่</td>
                    <td style={{ padding: '3px 0', color: '#0f172a' }}>{qDate}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 0', color: '#f38f1d', fontWeight: '500' }}>ผู้ขาย</td>
                    <td style={{ padding: '3px 0', color: '#0f172a' }}>{qSeller}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 0', color: '#f38f1d', fontWeight: '500' }}>ชื่องาน</td>
                    <td style={{ padding: '3px 0', color: '#0f172a' }}>{qJob}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '3px 0', color: '#f38f1d', fontWeight: '500' }}>ยืนยันราคาถึง</td>
                    <td style={{ padding: '3px 0', color: '#e11d48', fontWeight: 'bold' }}>{qValidUntil ? (new Date(qValidUntil).toLocaleDateString('th-TH') !== 'Invalid Date' ? new Date(qValidUntil).toLocaleDateString('th-TH') : qValidUntil) : '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Main Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f38f1d', color: '#ffffff' }}>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: '5%', fontWeight: 'bold' }}>#</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', width: '45%', fontWeight: 'bold' }}>รายละเอียด</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: '15%', fontWeight: 'bold' }}>จำนวน</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', width: '13%', fontWeight: 'bold' }}>ราคาต่อหน่วย</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', width: '10%', fontWeight: 'bold' }}>ส่วนลด</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', width: '12%', fontWeight: 'bold' }}>มูลค่า</th>
              </tr>
            </thead>
            <tbody>
              {q.items && q.items.map((item, index) => {
                let itemName = item.room_name || item.service_name || 'รายการสินค้า/บริการ';
                let cleanName = itemName;
                let descText = item.room_description || item.service_description || '';

                if (itemName && itemName.includes(' (ส่วนลด')) {
                  const parts = itemName.split(' (ส่วนลด');
                  cleanName = parts[0];
                  if (!descText) descText = '(ส่วนลด' + parts[1];
                } else if (itemName && itemName.includes('(ส่วนลด')) {
                  const parts = itemName.split('(ส่วนลด');
                  cleanName = parts[0].trim();
                  if (!descText) descText = '(ส่วนลด' + parts[1];
                }

                let detailsDate = '';
                let detailsNote = '';

                const rawDate = item.item_date || (item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[0] : null);
                if (rawDate) {
                  const dateStr = new Date(rawDate).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                  if (dateStr && dateStr !== 'Invalid Date') {
                    detailsDate = `- ${dateStr}`;
                  }
                }

                if (item.room_id) {
                  const cap = item.capacity || item.room_capacity || 4;
                  const formattedItemPrice = Number(item.price || 0).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});
                  if (item.booking_type === 'daily') {
                    detailsNote = `** ${cleanName} for ${cap} seats : ${formattedItemPrice} THB per day.**`;
                  } else if (item.booking_type === 'halfday') {
                    detailsNote = `** ${cleanName} for ${cap} seats : ${formattedItemPrice} THB per 4 hours.**`;
                  } else {
                    detailsNote = `** Room for ${cap} seat${cap > 1 ? 's' : ''} : ${formattedItemPrice} THB per hour.**`;
                  }
                } else {
                  if (descText) detailsNote = descText;
                }

                let qtyStr = `${item.quantity || 1}`;
                if (item.room_id) {
                  if (item.booking_type === 'daily') qtyStr = `${item.quantity || 1} วัน`;
                  else if (item.booking_type === 'halfday') qtyStr = `${item.quantity || 1} ครึ่งวัน`;
                  else qtyStr = `${item.quantity || 1} ชม.`;
                } else {
                  qtyStr = `${item.quantity || 1} รายการ`;
                }

                let discountStr = '-';
                if (item.discount) {
                  const discVal = Number(item.discount) || 0;
                  if (item.discount_type === 'percent') {
                    const rawSub = (item.quantity || 1) * (Number(item.price) || 0);
                    const discAmt = (rawSub * discVal) / 100;
                    discountStr = `${discVal}% (${discAmt.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2})})`;
                  } else {
                    discountStr = discVal.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});
                  }
                }

                const displayPrice = item.price !== undefined && item.price !== null && item.price !== '' 
                  ? Number(item.price).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}) 
                  : '-';
                const displaySubtotal = Number(item.subtotal || 0).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});

                return (
                  <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>{index + 1}</td>
                    <td style={{ padding: '10px', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{cleanName}</div>
                      {detailsDate && <div style={{ color: '#475569', marginTop: '2px', fontSize: '0.75rem' }}>{detailsDate}</div>}
                      {detailsNote && <div style={{ fontWeight: 'bold', color: '#0f172a', marginTop: '2px', fontSize: '0.75rem' }}>{detailsNote}</div>}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top', color: '#0f172a' }}>{qtyStr}</td>
                    <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top', color: '#0f172a' }}>{displayPrice}</td>
                    <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top', color: '#0f172a' }}>{discountStr}</td>
                    <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top', fontWeight: '500', color: '#0f172a' }}>{displaySubtotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Summary & Payment Section */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', alignItems: 'flex-start' }}>
            {/* Left: Baht Text & Notes */}
            <div style={{ width: '55%' }}>
              <div style={{ fontSize: '0.8rem', color: '#334155', fontWeight: '500' }}>
                ({thaiBahtText(totalAmt)})
              </div>

              <div style={{ marginTop: '20px', fontSize: '0.75rem', color: '#334155', lineHeight: 1.5 }}>
                <div style={{ color: '#f38f1d', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.8rem' }}>หมายเหตุ</div>
                <div>Please transfer the payment under the name Built Heart Co., Ltd. (Savings Account)</div>
                <div>Bank: Krungsri Bank</div>
                <div>Account Number: 329-1-38429-0</div>
                <div>Branch: Software Park</div>
                <div style={{ marginTop: '8px' }}>Kindly send the payment slip to coworking@bwork.biz</div>
              </div>
            </div>

            {/* Right: Calculations */}
            <div style={{ width: '40%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#f38f1d' }}>รวมเป็นเงิน</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '500', width: '45%' }}>{totalAmt.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#f38f1d' }}>ภาษีมูลค่าเพิ่ม 7%</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '500' }}>{vatAmt.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0', textAlign: 'right', color: '#f38f1d' }}>ราคาไม่รวมภาษีมูลค่าเพิ่ม</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '500' }}>{beforeVatAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #cbd5e1' }}>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: '#f38f1d', fontWeight: 'bold' }}>จำนวนเงินรวมทั้งสิ้น</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 'bold', color: '#0f172a', fontSize: '0.85rem' }}>{totalAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Signatures & Tag */}
        <div style={{ color: '#0f172a' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', paddingTop: '10px' }}>
            {/* Customer Signature Block */}
            <div style={{ width: '45%', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '35px' }}>
                ในนาม {q.customer_name || 'ลูกค้า'}
              </div>
              <div style={{ display: 'flex', gap: '20px' }}>
                {/* Signature column */}
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: '30px' }}></div>
                  <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>ผู้สั่งซื้อสินค้า</div>
                </div>
                {/* Date column */}
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: '30px' }}></div>
                  <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>วันที่</div>
                </div>
              </div>
            </div>

            {/* Company Signature Block */}
            <div style={{ width: '45%', fontSize: '0.8rem' }}>
              <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '35px', textAlign: 'right' }}>
                ในนาม {localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด'}
              </div>
              <div style={{ display: 'flex', gap: '20px' }}>
                {/* Approver 1 column */}
                <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                  <div style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {(localSettings?.quotation_signature_image || settings?.quotation_signature_image) ? (
                      <img 
                        src={localSettings?.quotation_signature_image || settings?.quotation_signature_image} 
                        alt="ลายเซ็นผู้อนุมัติ 1" 
                        style={{ height: '38px', maxWidth: '100px', objectFit: 'contain' }} 
                      />
                    ) : (
                      <svg width="65" height="26" viewBox="0 0 100 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 25 C30 5, 40 35, 60 15 C70 5, 80 25, 90 20" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                      </svg>
                    )}
                  </div>
                  <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>
                    {(localSettings?.quotation_signature_image2 || settings?.quotation_signature_image2) ? 'ผู้อนุมัติ 1' : 'ผู้อนุมัติ'}
                  </div>
                </div>

                {/* Approver 2 column (if uploaded) */}
                {(localSettings?.quotation_signature_image2 || settings?.quotation_signature_image2) && (
                  <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                    <div style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img 
                        src={localSettings?.quotation_signature_image2 || settings?.quotation_signature_image2} 
                        alt="ลายเซ็นผู้อนุมัติ 2" 
                        style={{ height: '38px', maxWidth: '100px', objectFit: 'contain' }} 
                      />
                    </div>
                    <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>ผู้อนุมัติ 2</div>
                  </div>
                )}
                {/* Date column */}
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: '#0f172a' }}>
                    {qDate}
                  </div>
                  <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>วันที่</div>
                </div>
              </div>
            </div>
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
          zIndex: 2000,
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
                  เอกสารเลขที่ #QT-{String(selectedQuotation.id || '').padStart(5, '0')}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <style dangerouslySetInnerHTML={{__html: `
            .inline-doc-input {
              background: transparent !important;
              border: none !important;
              border-bottom: 1px dashed rgba(30, 41, 59, 0.25) !important;
              color: #0f172a !important;
              font-family: 'Sarabun', sans-serif !important;
              font-size: inherit !important;
              font-weight: inherit !important;
              padding: 2px 4px !important;
              outline: none !important;
              transition: all 0.2s !important;
              border-radius: 4px !important;
            }
            .inline-doc-input:hover {
              background: rgba(37, 99, 235, 0.04) !important;
              border-bottom: 1px dashed var(--primary-color) !important;
            }
            .inline-doc-input:focus {
              background: rgba(37, 99, 235, 0.08) !important;
              border-bottom: 2px solid var(--primary-color) !important;
            }
            .inline-doc-input::placeholder {
              color: #94a3b8 !important;
              font-style: italic;
              font-weight: normal;
            }
            
            .document-desk-bg {
              background-color: rgba(15, 23, 42, 0.25);
              border: 1px solid var(--glass-border);
              border-radius: 28px;
              padding: 40px 20px;
              display: flex;
              justify-content: center;
              width: 100%;
              backdrop-filter: blur(20px);
              box-shadow: var(--glass-shadow);
            }

            .interactive-a4-sheet {
              background-color: #ffffff;
              padding: 50px;
              border-radius: 16px;
              width: 100%;
              max-width: 1200px;
              box-shadow: 0 15px 50px rgba(0, 0, 0, 0.35);
              font-family: 'Sarabun', sans-serif;
              font-size: 0.875rem;
              min-height: 270mm;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              border: 1px solid #cbd5e1;
            }

            /* Custom date picker overrides inside document */
            .inline-doc-datepicker {
              border: none !important;
              background: transparent !important;
              border-bottom: 1px dashed rgba(30, 41, 59, 0.25) !important;
              border-radius: 4px !important;
              padding: 2px 6px !important;
              font-weight: bold !important;
              font-size: 0.85rem !important;
              color: #e11d48 !important;
            }
            .inline-doc-datepicker:hover {
              background: rgba(37, 99, 235, 0.04) !important;
              border-bottom: 1px dashed var(--primary-color) !important;
            }
          `}} />

          <form onSubmit={handleSaveQuotation} style={{ display: 'flex', flexDirection: 'column' }}>
            
            {/* Liquidglass Actions Header (Static, doesn't scroll with mouse) */}
            <div className="quotation-editor-header">
              <div>
                <h1 className="header-title" style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                  {viewMode === 'create' ? 'เขียนใบเสนอราคาใหม่ (Interactive Live Editor)' : `แก้ไขใบเสนอราคา #${selectedQuotation?.id}`}
                </h1>
                <p className="header-desc" style={{ fontSize: '0.75rem', margin: '4px 0 0 0', fontWeight: 550 }}>
                  ปรับปรุง แก้ไข ชื่อลูกค้า ข้อมูลติดต่อ วันที่เสนอราคา และรายการสินค้าได้ทันทีจากหน้ากระดาษใบเสนอราคา
                </p>
              </div>
              
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  type="button" 
                  className="btn-cancel-glass"
                  onClick={() => setViewMode('list')}
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit" 
                  style={{ 
                    padding: '8px 22px', 
                    borderRadius: '12px', 
                    height: '38px', 
                    gap: '6px', 
                    fontSize: '0.8rem', 
                    fontWeight: 'bold', 
                    background: 'linear-gradient(135deg, #10b981, #059669)', 
                    border: 'none',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => { 
                    e.currentTarget.style.transform = 'translateY(-1px)'; 
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.45)'; 
                  }}
                  onMouseLeave={e => { 
                    e.currentTarget.style.transform = 'translateY(0)'; 
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.35)'; 
                  }}
                >
                  <Check size={14} />
                  <span>บันทึกเอกสาร</span>
                </button>
              </div>
            </div>

            {/* Document Desk Container */}
            <div className="document-desk-bg">
              <div className="interactive-a4-sheet">
                
                {/* 📄 Inner PDF/A4 Document Layout */}
                <div style={{ color: '#1e293b', backgroundColor: '#ffffff', fontFamily: 'Sarabun, "Noto Sans Thai", sans-serif' }}>
                  
                  {/* Header Section */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    
                    {/* Left Box: Branding + Company Address + Customer Info */}
                    <div style={{ width: '58%' }}>
                      {/* Logos */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px', alignItems: 'flex-start' }}>
                        <img 
                          src="/BH-LOGO.png" 
                          alt="BUILT HEART" 
                          style={{ height: '28px', width: 'auto', objectFit: 'contain' }} 
                        />
                        <img 
                          src="/BWORK-LOGO.png" 
                          alt="B WORK" 
                          style={{ height: '36px', width: 'auto', objectFit: 'contain' }} 
                        />
                      </div>

                      {/* Company Info */}
                      <div style={{ fontSize: '0.8rem', color: '#334155', lineHeight: 1.45 }}>
                        <div style={{ fontWeight: 'bold' }}>{localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)'}</div>
                        <div>{localSettings?.quotation_company_address || settings?.quotation_company_address || '98 หมู่ 2 อาคารบีเวิร์ค ยูนิต602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120'}</div>
                        <div>เลขประจำตัวผู้เสียภาษี {localSettings?.quotation_company_tax_id || settings?.quotation_company_tax_id || '0125554000401'}</div>
                      </div>

                      {/* Customer Section Inputs */}
                      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#f38f1d' }}>ลูกค้า</div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input 
                            type="text" 
                            className="inline-doc-input" 
                            style={{ fontWeight: 'bold', fontSize: '0.9rem', width: '100%', color: '#0f172a' }} 
                            value={customerName} 
                            onChange={e => setCustomerName(e.target.value)} 
                            placeholder="ระบุชื่อลูกค้า/บริษัท"
                            required
                          />
                        </div>

                        <textarea 
                          className="inline-doc-input" 
                          style={{ fontSize: '0.8rem', width: '100%', height: '55px', resize: 'vertical', lineHeight: 1.4, color: '#334155' }} 
                          value={customerAddress} 
                          onChange={e => setCustomerAddress(e.target.value)} 
                          placeholder="ระบุที่อยู่"
                        />
                      </div>
                    </div>

                    {/* Right Box: Document Title "ใบเสนอราคา" + Metadata Grid */}
                    <div style={{ width: '38%', textAlign: 'right' }}>
                      <h1 style={{ fontSize: '1.9rem', fontWeight: 'bold', color: '#f38f1d', margin: 0, padding: 0, fontFamily: 'Sarabun, sans-serif' }}>
                        ใบเสนอราคา
                      </h1>
                      <div style={{ borderBottom: '1px solid #cbd5e1', margin: '8px 0 12px 0' }}></div>

                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                        <tbody>
                          <tr style={{ height: '38px' }}>
                            <td style={{ padding: '2px 0', color: '#f38f1d', width: '35%', fontWeight: 'bold', verticalAlign: 'middle' }}>เลขที่</td>
                            <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                              <input 
                                type="text" 
                                className="inline-doc-input" 
                                style={{ fontSize: '0.8rem', fontWeight: 'bold', width: '100%', height: '32px', boxSizing: 'border-box' }} 
                                value={quotationNo} 
                                onChange={e => setQuotationNo(e.target.value)} 
                                placeholder="QT2026060002"
                              />
                            </td>
                          </tr>
                          <tr style={{ height: '38px' }}>
                            <td style={{ padding: '2px 0', color: '#f38f1d', fontWeight: 'bold', verticalAlign: 'middle' }}>วันที่</td>
                            <td style={{ padding: '2px 0', color: '#0f172a', fontWeight: 'bold', verticalAlign: 'middle' }}>
                              <div style={{ height: '32px', display: 'flex', alignItems: 'center', paddingLeft: '4px' }}>
                                {new Date().toLocaleDateString('th-TH')}
                              </div>
                            </td>
                          </tr>
                          <tr style={{ height: '38px' }}>
                            <td style={{ padding: '2px 0', color: '#f38f1d', fontWeight: 'bold', verticalAlign: 'middle' }}>ผู้ขาย</td>
                            <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                              {(() => {
                                const activeSt = (localSettings && localSettings.quotation_signer) ? localSettings : settings;
                                const sellerList = activeSt?.quotation_signer
                                  ? activeSt.quotation_signer.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)
                                  : [user?.fullname].filter(Boolean);

                                return (
                                  <div style={{ position: 'relative' }}>
                                    <div 
                                      className="doc-liquidglass-trigger"
                                      onClick={() => setIsSellerDropdownOpen(!isSellerDropdownOpen)}
                                    >
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {sellerName || '-- เลือกชื่อผู้ขาย --'}
                                      </span>
                                      <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: '6px' }} />
                                    </div>

                                    {isSellerDropdownOpen && (
                                      <>
                                        <div onClick={() => setIsSellerDropdownOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                                        <div className="doc-liquidglass-menu">
                                          {sellerList.map(name => {
                                            const isSelected = sellerName === name;
                                            return (
                                              <div 
                                                key={name}
                                                className={`doc-liquidglass-item ${isSelected ? 'active' : ''}`}
                                                onClick={() => {
                                                  setSellerName(name);
                                                  setIsSellerDropdownOpen(false);
                                                }}
                                              >
                                                {name}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                          <tr style={{ height: '38px' }}>
                            <td style={{ padding: '2px 0', color: '#f38f1d', fontWeight: 'bold', verticalAlign: 'middle' }}>ชื่องาน</td>
                            <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                              <input 
                                type="text" 
                                className="inline-doc-input" 
                                style={{ fontSize: '0.8rem', width: '100%', height: '32px', boxSizing: 'border-box' }} 
                                value={jobName} 
                                onChange={e => setJobName(e.target.value)} 
                                placeholder="Meeting Room..."
                              />
                            </td>
                          </tr>
                          <tr style={{ height: '38px' }}>
                            <td style={{ padding: '2px 0', color: '#e11d48', fontWeight: 'bold', verticalAlign: 'middle' }}>ยืนยันราคาถึง</td>
                            <td style={{ padding: '2px 0', verticalAlign: 'middle' }}>
                              <CustomDatePicker
                                value={validUntil}
                                onChange={val => setValidUntil(val)}
                                className="inline-doc-datepicker"
                                style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', height: '32px' }}
                              />
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Items Table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f38f1d', color: '#ffffff' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'center', width: '5%', fontWeight: 'bold' }}>#</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left', width: '40%', fontWeight: 'bold' }}>รายละเอียด</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', width: '15%', fontWeight: 'bold' }}>จำนวน</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', width: '13%', fontWeight: 'bold' }}>ราคาต่อหน่วย</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', width: '10%', fontWeight: 'bold' }}>ส่วนลด</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', width: '12%', fontWeight: 'bold' }}>มูลค่า</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center', width: '5%', fontWeight: 'bold' }}>ลบ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: '#64748b', fontStyle: 'italic' }}>
                            ยังไม่มีสินค้า/บริการในใบเสนอราคา
                          </td>
                        </tr>
                      ) : (
                        items.map((item, index) => {
                          let itemName = item.room_name || item.service_name || 'รายการสินค้า/บริการ';
                          let cleanName = itemName;
                          let descText = item.room_description || item.service_description || '';

                          if (itemName && itemName.includes(' (ส่วนลด')) {
                            const parts = itemName.split(' (ส่วนลด');
                            cleanName = parts[0];
                            if (!descText) descText = '(ส่วนลด' + parts[1];
                          } else if (itemName && itemName.includes('(ส่วนลด')) {
                            const parts = itemName.split('(ส่วนลด');
                            cleanName = parts[0].trim();
                            if (!descText) descText = '(ส่วนลด' + parts[1];
                          }

                          let detailsDate = '';
                          let detailsNote = '';

                          if (item.room_id) {
                            const rawDate = item.item_date || (item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[0] : null);
                            const dateStr = rawDate ? new Date(rawDate).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
                            if (dateStr && dateStr !== 'Invalid Date') {
                              detailsDate = `- ${dateStr}`;
                            }
                            
                            const cap = item.capacity || item.room_capacity || 4;
                            if (item.booking_type === 'daily') {
                              detailsNote = `** ${cleanName} for ${cap} seats : ${item.price ? item.price.toLocaleString(undefined, {minimumFractionDigits:2}) : 0} THB per day.**`;
                            } else if (item.booking_type === 'halfday') {
                              detailsNote = `** ${cleanName} for ${cap} seats : ${item.price ? item.price.toLocaleString(undefined, {minimumFractionDigits:2}) : 0} THB per 4 hours.**`;
                            } else {
                              detailsNote = `** Room for ${cap} seat${cap > 1 ? 's' : ''} : ${item.price ? item.price.toLocaleString(undefined, {minimumFractionDigits:2}) : 0} THB per hour.**`;
                            }
                          } else {
                            if (descText) detailsNote = descText;
                          }

                          return (
                            <tr key={index} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: editingIndex === index ? 'rgba(37, 99, 235, 0.08)' : 'transparent' }}>
                              <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>{index + 1}</td>
                              <td style={{ padding: '10px', verticalAlign: 'top' }}>
                                <div style={{ fontWeight: 'bold', color: '#0f172a' }}>{cleanName}</div>
                                {detailsDate && <div style={{ color: '#475569', marginTop: '2px', fontSize: '0.75rem' }}>{detailsDate}</div>}
                                {detailsNote && <div style={{ fontWeight: 'bold', color: '#0f172a', marginTop: '2px', fontSize: '0.75rem' }}>{detailsNote}</div>}
                              </td>
                              <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>
                                <input 
                                  type="number" 
                                  className="inline-doc-input" 
                                  style={{ width: '60px', textAlign: 'center', fontWeight: 'bold' }} 
                                  min="1" 
                                  value={item.quantity} 
                                  onChange={e => {
                                    const newQty = Number(e.target.value) || 1;
                                    const updated = [...items];
                                    updated[index].quantity = newQty;
                                    const rawSub = updated[index].price * newQty;
                                    const discVal = updated[index].discount || 0;
                                    const discAmt = updated[index].discount_type === 'percent' ? (rawSub * discVal) / 100 : discVal;
                                    updated[index].subtotal = Math.max(0, rawSub - discAmt);
                                    setItems(updated);
                                  }} 
                                />
                              </td>
                              <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top' }}>
                                <input 
                                  type="number" 
                                  className="inline-doc-input" 
                                  style={{ width: '90px', textAlign: 'right', fontWeight: 'bold' }} 
                                  value={item.price} 
                                  onChange={e => {
                                    const newPrice = Number(e.target.value) || 0;
                                    const updated = [...items];
                                    updated[index].price = newPrice;
                                    const rawSub = newPrice * updated[index].quantity;
                                    const discVal = updated[index].discount || 0;
                                    const discAmt = updated[index].discount_type === 'percent' ? (rawSub * discVal) / 100 : discVal;
                                    updated[index].subtotal = Math.max(0, rawSub - discAmt);
                                    setItems(updated);
                                  }} 
                                />
                              </td>
                              <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'flex-end' }}>
                                  <input 
                                    type="number" 
                                    className="inline-doc-input" 
                                    style={{ width: '50px', textAlign: 'right', fontWeight: 'bold' }} 
                                    min="0"
                                    value={item.discount || 0} 
                                    onChange={e => {
                                      const newDiscount = Number(e.target.value) || 0;
                                      const updated = [...items];
                                      updated[index].discount = newDiscount;
                                      const rawSub = updated[index].quantity * updated[index].price;
                                      const discAmt = updated[index].discount_type === 'percent' ? (rawSub * newDiscount) / 100 : newDiscount;
                                      updated[index].subtotal = Math.max(0, rawSub - discAmt);
                                      setItems(updated);
                                    }} 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = [...items];
                                      const newType = updated[index].discount_type === 'percent' ? 'amount' : 'percent';
                                      updated[index].discount_type = newType;
                                      const rawSub = updated[index].quantity * updated[index].price;
                                      const discVal = updated[index].discount || 0;
                                      const discAmt = newType === 'percent' ? (rawSub * discVal) / 100 : discVal;
                                      updated[index].subtotal = Math.max(0, rawSub - discAmt);
                                      setItems(updated);
                                    }}
                                    style={{
                                      padding: '2px 4px',
                                      fontSize: '0.65rem',
                                      fontWeight: 'bold',
                                      borderRadius: '4px',
                                      border: '1px solid var(--border-color)',
                                      background: item.discount_type === 'percent' ? 'var(--primary-color)' : 'rgba(0,0,0,0.06)',
                                      color: item.discount_type === 'percent' ? '#ffffff' : '#475569',
                                      cursor: 'pointer'
                                    }}
                                    title="สลับส่วนลด บาท / %"
                                  >
                                    {item.discount_type === 'percent' ? '%' : '฿'}
                                  </button>
                                </div>
                              </td>
                              <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top', fontWeight: 'bold', color: '#0f172a' }}>
                                {item.subtotal ? item.subtotal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '0.00'}
                              </td>
                              <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>
                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                  <button 
                                    type="button" 
                                    onClick={() => handleEditRow(index)}
                                    style={{ background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    title="แก้ไขรายการนี้"
                                  >
                                    <Edit size={15} />
                                  </button>
                                  <button 
                                    type="button" 
                                    onClick={() => handleRemoveItem(index)}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px' }}
                                    title="ลบรายการนี้"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}

                      {/* ➕ Add New Item / Edit Item Inline Row */}
                      <tr style={{ borderBottom: '2px solid #cbd5e1', backgroundColor: editingIndex !== null ? 'rgba(37, 99, 235, 0.06)' : 'rgba(37, 99, 235, 0.025)' }}>
                        <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top', fontWeight: 'bold', color: editingIndex !== null ? '#2563eb' : '#f38f1d' }}>
                          {editingIndex !== null ? `#${editingIndex + 1}` : '+'}
                        </td>
                        <td style={{ padding: '10px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <div style={{ display: 'flex', gap: '4px', background: 'rgba(0, 0, 0, 0.08)', padding: '2px', borderRadius: '99px', border: '1px solid var(--border-color)', flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => { setItemType('room'); setSelectedItemObj(null); setIsQuotationProductDropdownOpen(false); }}
                                  style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '0.65rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', background: itemType === 'room' ? 'var(--primary-color)' : 'transparent', color: itemType === 'room' ? '#ffffff' : 'var(--text-muted)' }}
                                >
                                  ห้องประชุม
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setItemType('service'); setSelectedItemObj(null); setIsQuotationProductDropdownOpen(false); }}
                                  style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '0.65rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', background: itemType === 'service' ? 'var(--primary-color)' : 'transparent', color: itemType === 'service' ? '#ffffff' : 'var(--text-muted)' }}
                                >
                                  บริการเสริม
                                </button>
                              </div>
                              
                              <div style={{ flex: 1, position: 'relative' }}>
                                <div 
                                  className="doc-liquidglass-trigger"
                                  onClick={() => setIsQuotationProductDropdownOpen(!isQuotationProductDropdownOpen)}
                                >
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {selectedItemObj 
                                      ? `${selectedItemObj.name} ${selectedItemObj.capacity ? `(${selectedItemObj.capacity} ที่นั่ง)` : ''}`
                                      : `-- เลือก${itemType === 'room' ? 'ห้องประชุม' : 'บริการเสริม'} (${(itemType === 'room' ? rooms : services).length} รายการ) --`
                                    }
                                  </span>
                                  <ChevronDown size={12} style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: '6px' }} />
                                </div>

                                {isQuotationProductDropdownOpen && (
                                  <>
                                    <div onClick={() => setIsQuotationProductDropdownOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                                    <div className="doc-liquidglass-menu">
                                      {(itemType === 'room' ? rooms : services).map(x => {
                                        const isSelected = selectedItemObj?.id === x.id;
                                        return (
                                          <div 
                                            key={x.id}
                                            className={`doc-liquidglass-item ${isSelected ? 'active' : ''}`}
                                            onClick={() => {
                                              setSelectedItemObj(x);
                                              setIsQuotationProductDropdownOpen(false);
                                              setQuantity(1);
                                              setDiscount(0);
                                              if (itemType === 'room') {
                                                if (bookingType === 'daily') {
                                                  setPrice(layout === 'classroom' ? (x.classroom_daily_rate || x.daily_rate) : x.daily_rate);
                                                } else if (bookingType === 'halfday') {
                                                  setPrice(x.half_day_rate);
                                                } else {
                                                  setPrice(layout === 'classroom' ? (x.classroom_hourly_rate || x.hourly_rate) : x.hourly_rate);
                                                }
                                              } else {
                                                setPrice(x.price);
                                              }
                                            }}
                                          >
                                            {x.name} {x.capacity ? `(${x.capacity} ที่นั่ง)` : ''}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>

                            {selectedItemObj && (
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
                                {/* Date Picker for Item */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
                                  <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 'bold' }}>วันที่:</span>
                                  <CustomDatePicker
                                    value={itemDate}
                                    onChange={val => setItemDate(val)}
                                    placeholder="เลือกวันที่"
                                    className="inline-doc-datepicker"
                                    style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                                  />
                                </div>

                                {itemType === 'room' && (
                                  <>
                                    <div style={{ position: 'relative' }}>
                                      <div onClick={() => setIsBookingTypeOpen(!isBookingTypeOpen)} style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '26px', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0 8px', background: '#ffffff', cursor: 'pointer', fontWeight: 'bold' }}>
                                        <span>{bookingType === 'hourly' ? 'รายชั่วโมง' : bookingType === 'halfday' ? 'ครึ่งวัน' : 'รายวัน'}</span>
                                        <ChevronDown size={10} />
                                      </div>
                                      {isBookingTypeOpen && (
                                        <>
                                          <div onClick={() => setIsBookingTypeOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                                          <div className="liquidglass-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: '120px', zIndex: 2000, borderRadius: '8px', padding: '4px' }}>
                                            {[
                                              { value: 'hourly', label: 'รายชั่วโมง' },
                                              { value: 'halfday', label: 'ครึ่งวัน' },
                                              { value: 'daily', label: 'รายวัน' }
                                            ].map(opt => (
                                              <div key={opt.value} onClick={() => { setBookingType(opt.value); setIsBookingTypeOpen(false); setPrice(opt.value === 'daily' ? (layout === 'classroom' ? (selectedItemObj.classroom_daily_rate || selectedItemObj.daily_rate) : selectedItemObj.daily_rate) : opt.value === 'halfday' ? selectedItemObj.half_day_rate : (layout === 'classroom' ? (selectedItemObj.classroom_hourly_rate || selectedItemObj.hourly_rate) : selectedItemObj.hourly_rate)); }} style={{ padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.725rem' }}>{opt.label}</div>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    <div style={{ position: 'relative' }}>
                                      <div onClick={() => setIsLayoutOpen(!isLayoutOpen)} style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '26px', fontSize: '0.7rem', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0 8px', background: '#ffffff', cursor: 'pointer', fontWeight: 'bold' }}>
                                        <span>{layout === 'standard' ? 'Standard' : 'Classroom'}</span>
                                        <ChevronDown size={10} />
                                      </div>
                                      {isLayoutOpen && (
                                        <>
                                          <div onClick={() => setIsLayoutOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                                          <div className="liquidglass-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: '100px', zIndex: 2000, borderRadius: '8px', padding: '4px' }}>
                                            {[
                                              { value: 'standard', label: 'Standard' },
                                              { value: 'classroom', label: 'Classroom' }
                                            ].map(opt => (
                                              <div key={opt.value} onClick={() => { setLayout(opt.value); setIsLayoutOpen(false); setPrice(bookingType === 'daily' ? (opt.value === 'classroom' ? (selectedItemObj.classroom_daily_rate || selectedItemObj.daily_rate) : selectedItemObj.daily_rate) : bookingType === 'halfday' ? selectedItemObj.half_day_rate : (opt.value === 'classroom' ? (selectedItemObj.classroom_hourly_rate || selectedItemObj.hourly_rate) : selectedItemObj.hourly_rate)); }} style={{ padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.725rem' }}>{opt.label}</div>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>

                                    {bookingType === 'hourly' && (
                                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        {/* Start Time Picker */}
                                        <div style={{ position: 'relative' }}>
                                          <div 
                                            onClick={() => { setIsStartTimeOpen(!isStartTimeOpen); setIsEndTimeOpen(false); }}
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '26px', fontSize: '0.725rem', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0 8px', background: '#ffffff', cursor: 'pointer', fontWeight: 'bold', minWidth: '75px', justifyContent: 'space-between', color: '#0f172a' }}
                                          >
                                            <span>{startTime || 'เริ่ม'}</span>
                                            <Clock size={11} style={{ color: '#64748b' }} />
                                          </div>
                                          {isStartTimeOpen && (
                                            <>
                                              <div onClick={() => setIsStartTimeOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                                              <div className="liquidglass-dropdown" style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, width: '100px', maxHeight: '180px', overflowY: 'auto', zIndex: 2000, borderRadius: '8px', padding: '4px' }}>
                                                {timeOptions.map(t => (
                                                  <div 
                                                    key={t} 
                                                    onClick={() => { setStartTime(t); setIsStartTimeOpen(false); }}
                                                    style={{ padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.725rem', color: startTime === t ? 'var(--primary-color)' : 'var(--text-main)', background: startTime === t ? 'rgba(37, 99, 235, 0.12)' : 'transparent', fontWeight: startTime === t ? 'bold' : 'normal', textAlign: 'left' }}
                                                  >
                                                    {t}
                                                  </div>
                                                ))}
                                              </div>
                                            </>
                                          )}
                                        </div>

                                        <span style={{ fontSize: '0.725rem', color: '#64748b', fontWeight: 'bold' }}>-</span>

                                        {/* End Time Picker */}
                                        <div style={{ position: 'relative' }}>
                                          <div 
                                            onClick={() => { setIsEndTimeOpen(!isEndTimeOpen); setIsStartTimeOpen(false); }}
                                            style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '26px', fontSize: '0.725rem', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0 8px', background: '#ffffff', cursor: 'pointer', fontWeight: 'bold', minWidth: '75px', justifyContent: 'space-between', color: '#0f172a' }}
                                          >
                                            <span>{endTime || 'สิ้นสุด'}</span>
                                            <Clock size={11} style={{ color: '#64748b' }} />
                                          </div>
                                          {isEndTimeOpen && (
                                            <>
                                              <div onClick={() => setIsEndTimeOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                                              <div className="liquidglass-dropdown" style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, width: '100px', maxHeight: '180px', overflowY: 'auto', zIndex: 2000, borderRadius: '8px', padding: '4px' }}>
                                                {timeOptions.map(t => (
                                                  <div 
                                                    key={t} 
                                                    onClick={() => { setEndTime(t); setIsEndTimeOpen(false); }}
                                                    style={{ padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.725rem', color: endTime === t ? 'var(--primary-color)' : 'var(--text-main)', background: endTime === t ? 'rgba(37, 99, 235, 0.12)' : 'transparent', fontWeight: endTime === t ? 'bold' : 'normal', textAlign: 'left' }}
                                                  >
                                                    {t}
                                                  </div>
                                                ))}
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>
                          <input
                            type="number"
                            className="inline-doc-input"
                            style={{ width: '60px', textAlign: 'center', fontWeight: 'bold' }}
                            min="1"
                            value={quantity}
                            onChange={e => setQuantity(Number(e.target.value) || 1)}
                          />
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top' }}>
                          <input
                            type="number"
                            className="inline-doc-input"
                            style={{ width: '90px', textAlign: 'right', fontWeight: 'bold' }}
                            value={price}
                            onChange={e => setPrice(e.target.value !== '' ? Number(e.target.value) : '')}
                            placeholder="ราคา"
                          />
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'flex-end' }}>
                            <input
                              type="number"
                              className="inline-doc-input"
                              style={{ width: '50px', textAlign: 'right', fontWeight: 'bold' }}
                              min="0"
                              value={discount}
                              onChange={e => setDiscount(Number(e.target.value) || 0)}
                              placeholder="0"
                            />
                            <button
                              type="button"
                              onClick={() => setDiscountType(discountType === 'percent' ? 'amount' : 'percent')}
                              style={{
                                padding: '2px 4px',
                                fontSize: '0.65rem',
                                fontWeight: 'bold',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color)',
                                background: discountType === 'percent' ? 'var(--primary-color)' : 'rgba(0,0,0,0.06)',
                                color: discountType === 'percent' ? '#ffffff' : '#475569',
                                cursor: 'pointer'
                              }}
                              title="สลับส่วนลด บาท / %"
                            >
                              {discountType === 'percent' ? '%' : '฿'}
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', verticalAlign: 'top', fontWeight: 'bold', color: '#0f172a' }}>
                          {(() => {
                            const calc = getRealtimeCalculation();
                            return calc ? `${calc.total.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}` : '0.00';
                          })()}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center', verticalAlign: 'top' }}>
                          <button
                            type="button"
                            onClick={handleAddManualItem}
                            className="btn btn-primary"
                            style={{ width: '28px', height: '28px', padding: 0, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: editingIndex !== null ? '#2563eb' : 'var(--success-color)', border: 'none', cursor: 'pointer' }}
                            title={editingIndex !== null ? 'บันทึกการแก้ไขรายการ' : 'เพิ่มรายการ'}
                          >
                            {editingIndex !== null ? <Check size={14} /> : <Plus size={14} />}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Summary & Calculations Section */}
                  {(() => {
                    const totalAmt = items.reduce((sum, item) => sum + item.subtotal, 0);
                    const vatAmt = totalAmt * (7 / 107);
                    const beforeVatAmt = totalAmt - vatAmt;

                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', alignItems: 'flex-start' }}>
                        {/* Left: Baht Text & Notes */}
                        <div style={{ width: '55%' }}>
                          <div style={{ fontSize: '0.8rem', color: '#334155', fontWeight: '500' }}>
                            ({thaiBahtText(totalAmt)})
                          </div>

                          <div style={{ marginTop: '20px', fontSize: '0.75rem', color: '#334155', lineHeight: 1.5 }}>
                            <div style={{ color: '#f38f1d', fontWeight: 'bold', marginBottom: '4px', fontSize: '0.8rem' }}>หมายเหตุ</div>
                            <div>Please transfer the payment under the name Built Heart Co., Ltd. (Savings Account)</div>
                            <div>Bank: Krungsri Bank</div>
                            <div>Account Number: 329-1-38429-0</div>
                            <div>Branch: Software Park</div>
                            <div style={{ marginTop: '8px' }}>Kindly send the payment slip to coworking@bwork.biz</div>
                          </div>
                        </div>

                        {/* Right: Calculations */}
                        <div style={{ width: '40%' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                            <tbody>
                              <tr>
                                <td style={{ padding: '4px 0', textAlign: 'right', color: '#f38f1d' }}>รวมเป็นเงิน</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '500', width: '45%' }}>{totalAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '4px 0', textAlign: 'right', color: '#f38f1d' }}>ภาษีมูลค่าเพิ่ม 7%</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '500' }}>{vatAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                              </tr>
                              <tr>
                                <td style={{ padding: '4px 0', textAlign: 'right', color: '#f38f1d' }}>ราคาไม่รวมภาษีมูลค่าเพิ่ม</td>
                                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: '500' }}>{beforeVatAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                              </tr>
                              <tr style={{ borderTop: '1px solid #cbd5e1' }}>
                                <td style={{ padding: '6px 0', textAlign: 'right', color: '#f38f1d', fontWeight: 'bold' }}>จำนวนเงินรวมทั้งสิ้น</td>
                                <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 'bold', color: '#0f172a', fontSize: '0.85rem' }}>{totalAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} บาท</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                </div>

                {/* Footer Signatures & Tag */}
                <div style={{ color: '#0f172a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '35px', paddingTop: '10px' }}>
                    {/* Customer Signature Block */}
                    <div style={{ width: '45%', fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '35px' }}>
                        ในนาม {customerName || 'ลูกค้า'}
                      </div>
                      <div style={{ display: 'flex', gap: '20px' }}>
                        {/* Signature column */}
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ height: '30px' }}></div>
                          <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>ผู้สั่งซื้อสินค้า</div>
                        </div>
                        {/* Date column */}
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ height: '30px' }}></div>
                          <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>วันที่</div>
                        </div>
                      </div>
                    </div>

                    {/* Company Signature Block */}
                    <div style={{ width: '45%', fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '35px', textAlign: 'right' }}>
                        ในนาม {localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด'}
                      </div>
                      <div style={{ display: 'flex', gap: '20px' }}>
                        {/* Approver 1 column */}
                        <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                          <div style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {(localSettings?.quotation_signature_image || settings?.quotation_signature_image) ? (
                              <img 
                                src={localSettings?.quotation_signature_image || settings?.quotation_signature_image} 
                                alt="ลายเซ็นผู้อนุมัติ 1" 
                                style={{ height: '38px', maxWidth: '100px', objectFit: 'contain' }} 
                              />
                            ) : (
                              <svg width="65" height="26" viewBox="0 0 100 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 25 C30 5, 40 35, 60 15 C70 5, 80 25, 90 20" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                              </svg>
                            )}
                          </div>
                          <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>
                            {(localSettings?.quotation_signature_image2 || settings?.quotation_signature_image2) ? 'ผู้อนุมัติ 1' : 'ผู้อนุมัติ'}
                          </div>
                        </div>

                        {/* Approver 2 column (if uploaded) */}
                        {(localSettings?.quotation_signature_image2 || settings?.quotation_signature_image2) && (
                          <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                            <div style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <img 
                                src={localSettings?.quotation_signature_image2 || settings?.quotation_signature_image2} 
                                alt="ลายเซ็นผู้อนุมัติ 2" 
                                style={{ height: '38px', maxWidth: '100px', objectFit: 'contain' }} 
                              />
                            </div>
                            <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                            <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>ผู้อนุมัติ 2</div>
                          </div>
                        )}
                        {/* Date column */}
                        <div style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: '#0f172a' }}>
                            {new Date().toLocaleDateString('th-TH')}
                          </div>
                          <div style={{ borderTop: '1px solid #94a3b8', width: '100%' }}></div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#0f172a', marginTop: '4px' }}>วันที่</div>
                        </div>
                      </div>
                    </div>
                  </div>

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
                          <td style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>#QT-{String(q.id || '').padStart(5, '0')}</td>
                          <td style={{ fontWeight: 'bold', color: 'var(--text-main)' }}>คุณ {q.customer_name || '-'}</td>
                          <td>
                            {q.created_at ? new Date(q.created_at).toLocaleDateString('th-TH') : '-'}
                          </td>
                          <td>{q.contact || '-'}</td>
                          <td style={{ textAlign: 'right', fontWeight: '900', color: 'var(--text-main)', fontSize: '0.95rem' }}>
                            {Number(q.total_amount || 0).toLocaleString('th-TH')}.-
                          </td>
                          <td>
                            {q.valid_until ? (() => {
                              const expiryDate = new Date(q.valid_until);
                              expiryDate.setHours(23, 59, 59, 999);
                              
                              let isExpired = false;
                              if (q.status === 'accepted') {
                                if (q.approved_at) {
                                  isExpired = new Date(q.approved_at) > expiryDate;
                                } else {
                                  isExpired = false;
                                }
                              } else {
                                isExpired = new Date() > expiryDate;
                              }

                              return (
                                <span style={{ 
                                  color: isExpired ? 'var(--danger-color)' : 'var(--text-main)',
                                  fontWeight: isExpired ? 'bold' : 'normal'
                                }}>
                                  {new Date(q.valid_until).toLocaleDateString('th-TH')}
                                  {isExpired && ' (หมดอายุ)'}
                                </span>
                              );
                            })() : 'ไม่มีกำหนด'}
                          </td>
                          <td>
                            <div 
                              onClick={(e) => {
                                if (activeStatusDropdownId === q.id) {
                                  setActiveStatusDropdownId(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setStatusDropdownPos({
                                    top: rect.bottom,
                                    left: rect.left,
                                    width: rect.width
                                  });
                                  setActiveStatusDropdownId(q.id);
                                }
                              }}
                              style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between', 
                                padding: '6px 10px', 
                                borderRadius: '10px', 
                                fontSize: '0.75rem', 
                                fontWeight: 'bold',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: '1px solid var(--border-color)',
                                color: getStatusColor(q.status),
                                cursor: 'pointer',
                                gap: '4px',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <span>
                                {q.status === 'draft' ? 'ร่าง (Draft)' : q.status === 'sent' ? 'ส่งลูกค้าแล้ว (Sent)' : q.status === 'accepted' ? 'อนุมัติแล้ว (Accepted)' : q.status === 'rejected' ? 'ปฏิเสธ (Rejected)' : q.status}
                              </span>
                              <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
                            </div>
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

      {/* 🔮 GLOBAL STATUS DROPDOWN PORTAL (to prevent clipping by overflow table container) */}
      {activeStatusDropdownId && (
        <>
          <div 
            onClick={() => setActiveStatusDropdownId(null)} 
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} 
          />
          <div 
            className="liquidglass-dropdown" 
            style={{ 
              position: 'fixed', 
              top: `${statusDropdownPos.top + 4}px`, 
              left: `${statusDropdownPos.left}px`, 
              width: `${statusDropdownPos.width}px`, 
              zIndex: 2000, 
              borderRadius: '12px', 
              padding: '6px' 
            }}
          >
            {[
              { value: 'draft', label: 'ร่าง (Draft)', color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)' },
              { value: 'sent', label: 'ส่งลูกค้าแล้ว (Sent)', color: 'var(--primary-color)', bg: 'rgba(37, 99, 235, 0.15)' },
              { value: 'accepted', label: 'อนุมัติแล้ว (Accepted)', color: 'var(--success-color)', bg: 'rgba(16, 185, 129, 0.15)' },
              { value: 'rejected', label: 'ปฏิเสธ (Rejected)', color: 'var(--danger-color)', bg: 'rgba(239, 68, 68, 0.15)' }
            ].map(opt => {
              const q = quotations.find(x => x.id === activeStatusDropdownId);
              const isCurrent = q?.status === opt.value;
              return (
                <div 
                  key={opt.value}
                  onClick={() => { handleUpdateStatus(activeStatusDropdownId, opt.value); setActiveStatusDropdownId(null); }}
                  style={{ 
                    padding: '6px 10px', 
                    borderRadius: '8px', 
                    cursor: 'pointer', 
                    fontSize: '0.75rem', 
                    color: isCurrent ? opt.color : 'var(--text-main)', 
                    fontWeight: isCurrent ? 'bold' : 'normal', 
                    background: isCurrent ? opt.bg : 'transparent', 
                    marginBottom: '2px',
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                  onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                >
                  {opt.label}
                </div>
              );
            })}
          </div>
        </>
      )}

    </div>
  );
}

export default Quotations;
