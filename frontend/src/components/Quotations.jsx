import React, { useState, useEffect } from 'react';
import { 
  Plus, Minus, Trash2, Calendar, FileText, Check, X, Search, Printer, ArrowRight, 
  AlertCircle, Edit, Trash, RefreshCw, ChevronDown, Clock, Building, Download, Share2, Copy, Eye, UserCheck,
  ArrowUp, ArrowDown, ArrowUpDown
} from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';
import CustomSelect from './CustomSelect';
import { toLocalDateString } from '../dateUtils';

const TIME_SLOT_OPTIONS = [
  '08:00', '08:30', '09:00', '09:30',
  '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30',
  '18:00'
];

const timeOptions = TIME_SLOT_OPTIONS;

function thaiBahtText(num) {
  if (num === null || num === undefined || isNaN(num) || num === 0) return 'ศูนย์บาทถ้วน';
  num = Math.round(num * 100) / 100;

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
        } else if (pos === 0 && digit === 1 && len > 1 && nStr[pos - 1] !== '0') {
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

  let text = '';
  if (baht > 0) {
    text = convertBaht(baht) + 'บาท';
  } else {
    text = 'ศูนย์บาท';
  }

  if (satang === 0) {
    text += 'ถ้วน';
  } else {
    const sStr = satang.toString().padStart(2, '0');
    const d1 = parseInt(sStr[0], 10);
    const d2 = parseInt(sStr[1], 10);
    let sText = '';
    if (d1 === 1) sText += 'สิบ';
    else if (d1 === 2) sText += 'ยี่สิบ';
    else if (d1 > 2) sText += numbers[d1] + 'สิบ';

    if (d2 === 1 && d1 > 0) sText += 'เอ็ด';
    else if (d2 > 0) sText += numbers[d2];

    text += sText + 'สตางค์';
  }
  return text;
}

function Quotations({ user, settings, sysAlert, sysConfirm, quotationCartData, clearQuotationCartData, onNavigate }) {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [viewMode, setViewMode] = useState('list'); // 'list', 'create', 'edit'
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [pdfExportQuotation, setPdfExportQuotation] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [docCopyType, setDocCopyType] = useState('original'); // 'original' | 'copy'
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  // Sorting State
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');

  // Form State
  const [customerName, setCustomerName] = useState('');
  const [department, setDepartment] = useState('');
  const [contact, setContact] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerTaxId, setCustomerTaxId] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [jobName, setJobName] = useState('Meeting Room');
  const [quotationNo, setQuotationNo] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [issueDate, setIssueDate] = useState(toLocalDateString());
  const [items, setItems] = useState([]);

  // Financial Options
  const [hasVat, setHasVat] = useState(true);
  const [whtRate, setWhtRate] = useState(0); // 0, 1, 3%
  const [overallDiscountPercent, setOverallDiscountPercent] = useState(0);

  // Quick Add Bar State
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [selectedCatalogValue, setSelectedCatalogValue] = useState('');
  const [quickAddDate, setQuickAddDate] = useState(toLocalDateString());
  const [quickAddStartTime, setQuickAddStartTime] = useState('09:00');
  const [quickAddEndTime, setQuickAddEndTime] = useState('12:00');
  const [quickAddBookingType, setQuickAddBookingType] = useState('hourly');
  const [quickAddLayout, setQuickAddLayout] = useState('standard');
  const [quickAddQty, setQuickAddQty] = useState(3);
  const [quickAddPrice, setQuickAddPrice] = useState('');

  // Catalog Databases
  const [rooms, setRooms] = useState([]);
  const [services, setServices] = useState([]);

  // Dropdown States
  const [isSellerDropdownOpen, setIsSellerDropdownOpen] = useState(false);
  const [isCustomerSearchModalOpen, setIsCustomerSearchModalOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [activeStatusDropdownId, setActiveStatusDropdownId] = useState(null);
  const [statusDropdownPos, setStatusDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  // Live Settings state
  const [localSettings, setLocalSettings] = useState(settings || {});

  const fetchLiveSettings = async () => {
    try {
      const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
      const res = await fetch('/api/settings', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        setLocalSettings(data);
        return data;
      }
    } catch (err) {
      console.error('Failed to fetch live settings in Quotations:', err);
    }
    return settings || {};
  };

  useEffect(() => {
    if (settings && Object.keys(settings).length > 0) {
      setLocalSettings(settings);
    }
  }, [settings]);

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
      
      const validDays = Number(settings?.quotation_valid_days) || 7;
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + validDays);
      setValidUntil(defaultDate.toLocaleDateString('en-CA'));

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
        booking_type: item.booking_type || 'hourly',
        item_date: toLocalDateString()
      }));

      setItems(mapped);
      setViewMode('create');
      clearQuotationCartData();
    }
  }, [quotationCartData]);

  const formatDateThai = (d) => {
    if (!d) return '-';
    if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d.trim())) return d.trim();
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
      const [y, m, day] = d.substring(0, 10).split('-');
      return `${day}/${m}/${y}`;
    }
    const dateObj = new Date(d);
    if (isNaN(dateObj.getTime())) return String(d);
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${m}/${year}`;
  };

  const getSellerOptions = () => {
    const list = ((localSettings?.quotation_signer || settings?.quotation_signer || '').split(/[\n,;]+/)).map(s => s.trim()).filter(Boolean);
    if (user?.fullname && !list.includes(user.fullname.trim())) {
      list.push(user.fullname.trim());
    }
    return list;
  };

  const getCatalogDropdownOptions = () => {
    const opts = [];
    rooms.forEach(r => {
      opts.push({
        value: `room_${r.id}`,
        label: `ห้องประชุม ${r.name} (ความจุ ${r.capacity || 4} ท่าน)`,
        type: 'room',
        item: r
      });
    });
    services.forEach(s => {
      opts.push({
        value: `srv_${s.id}`,
        label: `${s.name} (${Number(s.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}.-)`,
        type: 'service',
        item: s
      });
    });
    return opts;
  };

  const fetchNextQuotationNo = async () => {
    try {
      const res = await fetch('/api/quotations/next-number');
      if (res.ok) {
        const data = await res.json();
        return data.quotation_no;
      }
    } catch (err) {
      console.error('Failed to fetch next quotation number:', err);
    }
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `QT-${yy}${mm}001`;
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
      const [resR, resS] = await Promise.all([
        fetch('/api/rooms'),
        fetch('/api/services')
      ]);
      if (resR.ok) setRooms(await resR.json());
      if (resS.ok) setServices(await resS.json());
    } catch (err) {
      console.error(err);
    }
  };

  // Realtime Financial Calculations
  const calculateFinancialTotals = () => {
    let subtotal = 0;
    items.forEach(it => {
      const q = Number(it.quantity) || 1;
      const p = Number(it.price) || 0;
      const d = Number(it.discount) || 0;
      const lineRaw = q * p;
      const lineDiscAmt = it.discount_type === 'percent' ? (lineRaw * d) / 100 : d;
      subtotal += Math.max(0, lineRaw - lineDiscAmt);
    });

    const discPercent = Number(overallDiscountPercent) || 0;
    const overallDiscAmt = Math.round((subtotal * discPercent / 100) * 100) / 100;
    const taxExclusive = Math.max(0, subtotal - overallDiscAmt);
    const vatAmt = hasVat ? Math.round((taxExclusive * 0.07) * 100) / 100 : 0;
    const whtAmt = Math.round((taxExclusive * (Number(whtRate) || 0) / 100) * 100) / 100;
    const grandTotal = Math.max(0, taxExclusive + vatAmt - whtAmt);

    return {
      subtotal,
      discountPercent: discPercent,
      discountAmount: overallDiscAmt,
      taxExclusive,
      vatAmount: vatAmt,
      whtAmount: whtAmt,
      grandTotal
    };
  };

    const calcHoursBetween = (st, et) => {
    if (!st || !et) return 1;
    const [sh, sm] = st.split(':').map(Number);
    const [eh, em] = et.split(':').map(Number);
    if (isNaN(sh) || isNaN(eh)) return 1;
    const diffMin = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(0.5, Math.round((diffMin / 60) * 10) / 10);
  };

  const getRoomRate = (room, bType, lType = 'standard') => {
    if (!room) return 0;
    const isClassroom = lType === 'classroom' && (room.has_classroom === 1 || room.has_classroom === true);
    if (bType === 'hourly') {
      if (isClassroom && Number(room.classroom_hourly_rate) > 0) return Number(room.classroom_hourly_rate);
      return Number(room.hourly_rate) || 0;
    }
    if (bType === 'halfday') {
      if (Number(room.half_day_rate) > 0) return Number(room.half_day_rate);
      const base = (isClassroom && Number(room.classroom_hourly_rate) > 0) ? Number(room.classroom_hourly_rate) : Number(room.hourly_rate);
      return base ? base * 4 : 0;
    }
    if (bType === 'daily') {
      if (isClassroom && Number(room.classroom_daily_rate) > 0) return Number(room.classroom_daily_rate);
      if (Number(room.daily_rate) > 0) return Number(room.daily_rate);
      const base = (isClassroom && Number(room.classroom_hourly_rate) > 0) ? Number(room.classroom_hourly_rate) : Number(room.hourly_rate);
      return base ? base * 8 : 0;
    }
    return 0;
  };

  const handleUpdateItem = (index, field, value) => {
    const updated = [...items];
    if (field === 'quantity' || field === 'price' || field === 'discount') {
      updated[index][field] = Number(value) || 0;
    } else {
      updated[index][field] = value;
    }

    if (field === 'start_time' || field === 'end_time') {
      let st = field === 'start_time' ? value : (updated[index].start_time || '09:00');
      let et = field === 'end_time' ? value : (updated[index].end_time || '12:00');

      // Ensure start and end times stay strictly between 08:00 and 18:00
      if (st < '08:00') st = '08:00';
      if (st > '17:30') st = '17:30';
      if (et <= st) {
        const [sh, sm] = st.split(':').map(Number);
        const nextMins = Math.min(18 * 60, sh * 60 + sm + 60);
        const nH = String(Math.floor(nextMins / 60)).padStart(2, '0');
        const nM = String(nextMins % 60).padStart(2, '0');
        et = `${nH}:${nM}`;
      }
      if (et > '18:00') et = '18:00';

      updated[index].start_time = st;
      updated[index].end_time = et;

      if (updated[index].booking_type === 'hourly' && st && et) {
        const [sh, sm] = st.split(':').map(Number);
        const [eh, em] = et.split(':').map(Number);
        if (!isNaN(sh) && !isNaN(eh)) {
          const diffMin = (eh * 60 + em) - (sh * 60 + sm);
          if (diffMin > 0) {
            updated[index].quantity = Math.max(0.5, Math.round((diffMin / 60) * 10) / 10);
          }
        }
      }
    }

    const q = Number(updated[index].quantity) || 1;
    const p = Number(updated[index].price) || 0;
    const d = Number(updated[index].discount) || 0;
    const lineRaw = q * p;
    const lineDiscAmt = updated[index].discount_type === 'percent' ? (lineRaw * d) / 100 : d;
    updated[index].subtotal = Math.max(0, lineRaw - lineDiscAmt);

    setItems(updated);
  };

    const handleRemoveItem = (index) => {
    setItems(prevItems => prevItems.filter((_, i) => i !== index));
  };

  const handleAddQuickItem = () => {
    let name = 'รายการสินค้า/บริการทั่วไป';
    let unitPrice = Number(quickAddPrice) || 0;
    let roomId = null;
    let serviceId = null;
    let bType = 'hourly';
    let lType = 'standard';

    if (selectedCatalogValue) {
      if (selectedCatalogValue.startsWith('room_')) {
        const rId = parseInt(selectedCatalogValue.replace('room_', ''), 10);
        const rObj = rooms.find(r => r.id === rId);
        if (rObj) {
          bType = quickAddBookingType || 'hourly';
          lType = quickAddLayout || 'standard';
          name = `ห้องประชุม ${rObj.name}`;
          if (!unitPrice) unitPrice = getRoomRate(rObj, bType, lType);
          roomId = rObj.id;
        }
      } else if (selectedCatalogValue.startsWith('srv_')) {
        const sId = parseInt(selectedCatalogValue.replace('srv_', ''), 10);
        const sObj = services.find(s => s.id === sId);
        if (sObj) {
          name = sObj.name;
          if (!unitPrice) unitPrice = Number(sObj.price) || 0;
          serviceId = sObj.id;
        }
      }
    }

    const qty = Number(quickAddQty) || 1;
    const p = unitPrice;
    const rObj = roomId ? rooms.find(r => r.id === roomId) : null;
    const sObj = serviceId ? services.find(s => s.id === serviceId) : null;
    const itemDesc = rObj ? rObj.description : (sObj ? sObj.description : null);

    const newItem = {
      room_id: roomId,
      service_id: serviceId,
      room_name: roomId ? name : null,
      service_name: serviceId ? name : null,
      custom_name: !roomId && !serviceId ? name : null,
      capacity: rObj ? (lType === 'classroom' && rObj.classroom_capacity ? rObj.classroom_capacity : rObj.capacity) : null,
      description: itemDesc,
      notes: itemDesc || '',
      quantity: qty,
      price: p,
      discount: 0,
      discount_type: 'amount',
      subtotal: qty * p,
      booking_type: bType,
      layout: lType,
      item_date: quickAddDate || toLocalDateString(),
      start_time: quickAddStartTime || '09:00',
      end_time: quickAddEndTime || '12:00'
    };

    setItems([...items, newItem]);
    setSelectedCatalogValue('');
    setQuickAddPrice('');
    setQuickAddQty(1);
    if (sysAlert) sysAlert('เพิ่มรายการลงใบเสนอราคาเรียบร้อย');
  };

  const handleAddBlankRow = () => {
    setItems([...items, {
      custom_name: 'ระบุชื่อรายการและรายละเอียด...',
      quantity: 1,
      price: 0,
      discount: 0,
      discount_type: 'amount',
      subtotal: 0,
      booking_type: 'hourly',
      layout: 'standard',
      item_date: issueDate || toLocalDateString(),
      start_time: '09:00',
      end_time: '12:00'
    }]);
  };

  const getPreviousCustomerOptions = () => {
    const map = new Map();
    quotations.forEach(q => {
      if (q.customer_name && !map.has(q.customer_name.trim())) {
        map.set(q.customer_name.trim(), {
          name: q.customer_name.trim(),
          address: q.customer_address || q.department || '',
          contact: q.contact || '',
          phone: q.customer_phone || q.contact || '',
          taxId: q.customer_tax_id || ''
        });
      }
    });

    if (map.size < 2) {
      map.set('บริษัท อินโนเวทีฟ โซลูชั่นส์ จำกัด', {
        name: 'บริษัท อินโนเวทีฟ โซลูชั่นส์ จำกัด (คุณธนพล เจริญทรัพย์)',
        address: '88/19 ถนนแจ้งวัฒนะ แขวงทุ่งสองห้อง เขตหลักสี่ กรุงเทพมหานคร 10210',
        contact: '081-987-6543 (คุณธนพล)',
        phone: '081-987-6543',
        taxId: '0105562089123'
      });
      map.set('บริษัท ดิจิทัล บิซเนส คอนซัลติ้ง จำกัด', {
        name: 'บริษัท ดิจิทัล บิซเนส คอนซัลติ้ง จำกัด (คุณอรอนงค์)',
        address: '123 อาคารสาทรซิตี้ทาวเวอร์ ชั้น 18 ถนนสาทรใต้ แขวงทุ่งมหาเมฆ เขตสาทร กทม. 10120',
        contact: '02-678-9900',
        phone: '02-678-9900',
        taxId: '0105559041289'
      });
    }
    return Array.from(map.values());
  };

  const handleOpenCreateForm = async () => {
    const liveSt = await fetchLiveSettings();
    setCustomerName('');
    setDepartment('');
    setContact('');
    setCustomerAddress('');
    setCustomerTaxId('');
    setCustomerPhone('');
    
    const defVat = liveSt?.quotation_default_vat !== undefined ? String(liveSt.quotation_default_vat) !== '0' : true;
    setHasVat(defVat);
    setWhtRate(Number(liveSt?.quotation_default_wht) || 0);
    setOverallDiscountPercent(0);
    setSellerName(user?.fullname || '');
    setJobName('Meeting Room');
    
    const nextNo = await fetchNextQuotationNo();
    setQuotationNo(nextNo);
    setIssueDate(toLocalDateString());

    const validDays = Number(liveSt?.quotation_valid_days) || 7;
    const d = new Date();
    d.setDate(d.getDate() + validDays);
    setValidUntil(d.toLocaleDateString('en-CA'));

    setItems([]);
    setViewMode('create');
  };

  const handleOpenEditForm = async (q) => {
    try {
      const res = await fetch(`/api/quotations/${q.id}`);
      if (res.ok) {
        const fullQ = await res.json();
        setSelectedQuotation(fullQ);
        setCustomerName(fullQ.customer_name || '');
        setDepartment(fullQ.department || '');
        setContact(fullQ.contact || '');
        setCustomerPhone(fullQ.customer_phone || fullQ.contact || '');
        setCustomerAddress(fullQ.customer_address || fullQ.department || fullQ.contact || '');
        setCustomerTaxId(fullQ.customer_tax_id || '');
        setSellerName(fullQ.seller_name || '');
        setJobName(fullQ.job_name || 'Meeting Room');
        setQuotationNo(fullQ.quotation_no || (fullQ.id ? `QT-${String(new Date(fullQ.created_at || Date.now()).getFullYear()).slice(-2)}${(new Date(fullQ.created_at || Date.now()).getMonth()+1).toString().padStart(2,'0')}${String(fullQ.id || '').padStart(3,'0')}` : 'QT-2608001'));
        setValidUntil(fullQ.valid_until || '');
        setIssueDate(fullQ.created_at ? toLocalDateString(new Date(fullQ.created_at)) : toLocalDateString());
        setOverallDiscountPercent(Number(fullQ.overall_discount) || 0);
        setHasVat(fullQ.has_vat !== undefined ? String(fullQ.has_vat) !== '0' && !!fullQ.has_vat : true);
        setWhtRate(Number(fullQ.wht_rate) || 0);
        setItems(fullQ.items || []);
        setViewMode('edit');
      }
    } catch (err) {
      console.error(err);
      sysAlert('ไม่สามารถโหลดรายละเอียดใบเสนอราคาได้');
    }
  };

  const handleSaveQuotation = async (e) => {
    if (e) e.preventDefault();
    if (!customerName || !customerName.trim()) {
      sysAlert('กรุณากรอกชื่อลูกค้า');
      return;
    }
    if (items.length === 0) {
      sysAlert('กรุณาเลือกรายการเสนอราคาอย่างน้อย 1 รายการ');
      return;
    }

    const calc = calculateFinancialTotals();
    const payload = {
      customer_name: customerName,
      department: department || '',
      contact: customerPhone || contact || '',
      customer_phone: customerPhone || contact || '',
      customer_tax_id: customerTaxId || '',
      customer_address: customerAddress,
      seller_name: sellerName,
      job_name: jobName,
      quotation_no: quotationNo,
      total_amount: calc.grandTotal,
      overall_discount: overallDiscountPercent,
      has_vat: hasVat ? 1 : 0,
      wht_rate: whtRate,
      valid_until: validUntil,
      issue_date: issueDate,
      items: items.map(it => ({
        ...it,
        room_name: it.room_name || it.custom_name || it.service_name || 'รายการทั่วไป',
        service_name: it.service_name || it.custom_name || null
      }))
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
    if (await sysConfirm('คุณต้องการลบใบเสนอราคานี้ใช่หรือไม่?')) {
      try {
        const res = await fetch(`/api/quotations/${id}`, { method: 'DELETE' });
        if (res.ok) {
          sysAlert('ลบใบเสนอราคาสำเร็จ');
          fetchQuotations();
        }
      } catch {
        sysAlert('เกิดข้อผิดพลาดในการลบ');
      }
    }
  };

  const handleUpdateStatus = async (id, newStatus) => {
    try {
      const res = await fetch(`/api/quotations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) fetchQuotations();
    } catch (err) {
      console.error(err);
    }
  };

  const handleConvertToBooking = async (q) => {
    if (await sysConfirm(`คุณต้องการแปลงใบเสนอราคาของ คุณ ${q.customer_name} เป็นรายการจองและเปิดบิลใช่หรือไม่?`)) {
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
      } catch {
        sysAlert('เกิดข้อผิดพลาดการสื่อสาร');
      }
    }
  };

    const handlePreviewQuotation = async (q) => {
    try {
      setDocCopyType('copy'); // Default to สำเนา for saved existing quotations
      const res = await fetch(`/api/quotations/${q.id}`);
      if (res.ok) {
        const fullQ = await res.json();
        setSelectedQuotation(fullQ);
      } else {
        setSelectedQuotation(q);
      }
    } catch {
      setSelectedQuotation(q);
    }
    setShowPreview(true);
  };

  const handlePrintQuotation = async (q, copyMode = 'copy') => {
    try {
      setDocCopyType(copyMode);
      const res = await fetch(`/api/quotations/${q.id}`);
      if (res.ok) {
        const fullQ = await res.json();
        setSelectedQuotation(fullQ);
        setTimeout(() => {
          triggerNativePrint(fullQ);
        }, 150);
      }
    } catch {
      sysAlert('ไม่สามารถโหลดข้อมูลสำหรับพิมพ์ใบเสนอราคาได้');
    }
  };

  const triggerNativePrint = (targetQuotation = null) => {
    const qData = targetQuotation || selectedQuotation || (viewMode === 'create' || viewMode === 'edit' ? getCurrentDraftPayload() : null);
    
    // Look for existing rendered canvas
    const sourceEl = document.getElementById('quotation-printable-canvas') || 
                     document.getElementById('quotation-preview-canvas') || 
                     document.getElementById('quotation-pdf-canvas-inner');

    if (!sourceEl) {
      window.print();
      return;
    }

    const existingIframe = document.getElementById('quotation-print-isolated-iframe');
    if (existingIframe && document.body.contains(existingIframe)) {
      document.body.removeChild(existingIframe);
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'quotation-print-isolated-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="utf-8">
        <title>พิมพ์ใบเสนอราคา - B-WORK</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Prompt:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
            height: 295mm !important;
            max-height: 295mm !important;
            background: #ffffff !important;
            overflow: hidden !important;
            font-family: 'Prompt', 'Inter', -apple-system, sans-serif;
          }
          #quotation-isolated-sheet {
            width: 210mm !important;
            height: 295mm !important;
            max-height: 295mm !important;
            padding: 10mm 14mm 8mm 14mm !important;
            box-sizing: border-box !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
        </style>
      </head>
      <body>
        <div id="quotation-isolated-sheet">
          ${sourceEl.innerHTML}
        </div>
      </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 3000);
    }, 300);
  };

  const handleExportPDF = async (targetQ = null) => {
    const qData = targetQ || selectedQuotation || (viewMode === 'create' || viewMode === 'edit' ? getCurrentDraftPayload() : null);
    if (!qData) {
      if (sysAlert) sysAlert('ไม่พบข้อมูลเอกสารสำหรับส่งออก PDF');
      return;
    }

    if (!window.html2pdf && !window.html2canvas) {
      if (sysAlert) sysAlert('ระบบพิมพ์ PDF ยังไม่พร้อมใช้งาน กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
      return;
    }

    setIsExportingPDF(true);
    try {
      setPdfExportQuotation(qData);
      await new Promise(r => setTimeout(r, 450));

      const element = document.getElementById('quotation-pdf-canvas-inner') || document.getElementById('quotation-pdf-staging-canvas');
      if (!element) {
        if (sysAlert) sysAlert('ไม่พบเนื้อหาเอกสารสำหรับสร้าง PDF');
        setIsExportingPDF(false);
        setPdfExportQuotation(null);
        return;
      }

      const filename = qData.quotation_no || (qData.id ? `QT-${String(new Date(qData.created_at || Date.now()).getFullYear()).slice(-2)}${(new Date(qData.created_at || Date.now()).getMonth()+1).toString().padStart(2,'0')}${String(qData.id || '').padStart(3,'0')}` : 'Quotation');

      const h2c = window.html2canvas;
      const jsPDF = window.jspdf?.jsPDF || window.jsPDF;

      if (h2c && jsPDF) {
        const canvas = await h2c(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.98);
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
        pdf.save(`${filename}.pdf`);
        return;
      }

      if (window.html2pdf) {
        const opt = {
          margin: [0, 0, 0, 0],
          filename: `${filename}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        await window.html2pdf().from(element).set(opt).save();
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF: ' + (err.message || err));
    } finally {
      setIsExportingPDF(false);
      setPdfExportQuotation(null);
    }
  };

  const getCurrentDraftPayload = () => {
    const calc = calculateFinancialTotals();
    return {
      id: selectedQuotation?.id,
      quotation_no: quotationNo,
      customer_name: customerName,
      customer_address: customerAddress,
      customer_tax_id: customerTaxId,
      customer_phone: customerPhone,
      department: department,
      contact: contact,
      issue_date: issueDate,
      valid_until: validUntil,
      seller_name: sellerName,
      job_name: jobName,
      items: items,
      overall_discount: overallDiscountPercent,
      has_vat: hasVat,
      wht_rate: whtRate,
      total_amount: calc.grandTotal
    };
  };

  const getStatusLabel = (st) => {
    switch (st) {
      case 'draft': return 'ร่าง';
      case 'sent': return 'ส่งแล้ว';
      case 'accepted': return 'อนุมัติ/ยืนยัน';
      case 'rejected': return 'ปฏิเสธ';
      default: return st;
    }
  };

  const getStatusBadgeColor = (st) => {
    switch (st) {
      case 'accepted': return 'var(--success-color)';
      case 'sent': return 'var(--primary-color)';
      case 'rejected': return 'var(--danger-color)';
      default: return 'var(--text-muted)';
    }
  };

  const filteredQuotations = quotations.filter(q => {
    const matchSearch = q.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (q.department && q.department.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchStatus = statusFilter === 'all' || q.status === statusFilter;
    return matchSearch && matchStatus;
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
      return sortDirection === 'asc' ? aVal.localeCompare(bVal, 'th') : bVal.localeCompare(aVal, 'th');
    }
    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // =========================================================================
  // 🖨️ STANDARDIZED PRINT / PDF CANVAS (100% Matching Screenshot Design)
  // =========================================================================
  const renderQuotationDocument = (q, mode = 'preview', forcedCopyType = null) => {
    if (!q) return null;

    const isForPdf = mode === 'pdf' || mode === true;
    const isForPrint = mode === 'print';
    const canvasId = isForPdf ? "quotation-pdf-canvas-inner" : (isForPrint ? "quotation-printable-canvas" : "quotation-preview-canvas");

    const rawItems = q.items || [];
    const docItems = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);

    let subtotal = 0;
    docItems.forEach(item => {
      const qty = Number(item.quantity) || 1;
      const price = Number(item.price) || 0;
      const lineRaw = qty * price;
      const disc = Number(item.discount) || 0;
      const discAmt = item.discount_type === 'percent' ? (lineRaw * disc) / 100 : disc;
      subtotal += Math.max(0, lineRaw - discAmt);
    });

    const discPercent = Number(q.overall_discount) || 0;
    const overallDiscAmt = Math.round((subtotal * discPercent / 100) * 100) / 100;
    const taxExclusive = Math.max(0, subtotal - overallDiscAmt);
    const hasVatFlag = q.has_vat !== undefined ? String(q.has_vat) !== '0' && !q.has_vat === false : true;
    const vatAmt = hasVatFlag ? Math.round((taxExclusive * 0.07) * 100) / 100 : 0;
    const whtAmt = Math.round((taxExclusive * (Number(q.wht_rate) || 0) / 100) * 100) / 100;
    const grandTotal = Number(q.total_amount) || Math.max(0, taxExclusive + vatAmt - whtAmt);

    const qNo = q.quotation_no || (q.id ? ('QT-' + String(new Date(q.created_at || Date.now()).getFullYear()).slice(-2) + (new Date(q.created_at || Date.now()).getMonth()+1).toString().padStart(2,'0') + String(q.id || '').padStart(3,'0')) : 'QT-2608001');
    const qDate = formatDateThai(q.created_at || q.issue_date || Date.now());
    const qSeller = q.seller_name || '-';
    const qJob = q.job_name || 'Meeting Room';
    const qValidUntil = q.valid_until || '';

    const fontMain = "'Prompt', 'Inter', -apple-system, sans-serif";
    const fontMono = "'Inter', monospace";

    return (
      <div 
        id={canvasId} 
        style={{ 
          width: isForPdf ? '794px' : '210mm',
          minHeight: isForPdf ? '1120px' : '296mm',
          height: isForPdf ? '1120px' : '296mm',
          maxHeight: isForPdf ? '1120px' : '296mm',
          boxSizing: 'border-box',
          padding: isForPdf ? '34px 44px 26px 44px' : '10mm 14mm 8mm 14mm',
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between', 
          color: '#0F172A', 
          backgroundColor: '#FFFFFF', 
          fontFamily: fontMain,
          lineHeight: 1.45,
          position: 'relative',
          overflow: 'hidden',
          pageBreakInside: 'avoid',
          breakInside: 'avoid',
          pageBreakAfter: 'avoid',
          breakAfter: 'avoid'
        }}
      >
        <div>
          {/* 1. TOP HEADER ROW */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '2px solid #0F172A' }}>
            
            {/* Left: Brand Logo & Company Info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                <img 
                  src="/BH-LOGO.png" 
                  alt="BUILT HEART" 
                  crossOrigin="anonymous" 
                  style={{ height: '24px', width: 'auto', objectFit: 'contain' }} 
                />
                <img 
                  src="/BWORK-LOGO.png" 
                  alt="B-WORK" 
                  crossOrigin="anonymous" 
                  style={{ height: '28px', width: 'auto', objectFit: 'contain' }} 
                />
              </div>
              <div style={{ width: '1.5px', height: '46px', backgroundColor: '#E2E8F0' }}></div>
              <div>
                <div style={{ fontSize: '0.88rem', color: '#0F172A', lineHeight: 1.25, fontWeight: 700 }}>
                  {localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)'}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 400, marginTop: '2px' }}>
                  Enterprise Solutions & Co-Working Space
                </div>
              </div>
            </div>

            {/* Right: Original & Document Title */}
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.70rem', color: '#64748B', fontWeight: 600, display: 'block', letterSpacing: '0.08em', lineHeight: 1, textTransform: 'uppercase' }}>QUOTATION</span>
              <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: '3px 0 0 0', lineHeight: 1 }}>ใบเสนอราคา</h1>
            </div>
          </div>

          {/* 2. TWO-COLUMN METADATA & PARTIES GRID */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '24px', marginTop: '14px' }}>
            
            {/* Left 7 Cols: Issuer & Client Info */}
            <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              
              {/* Company Address */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '0.74rem', color: '#475569', lineHeight: 1.35 }}>
                <div><span style={{ fontWeight: 700, color: '#0F172A' }}>ที่อยู่:</span> 98 หมู่ 2 อาคารบีเวิร์ค ยูนิต602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120</div>
                <div style={{ color: '#0F172A', marginTop: '1px' }}>
                  <span style={{ fontWeight: 700 }}>เลขประจำตัวผู้เสียภาษี:</span> <span style={{ fontFamily: fontMono, fontWeight: 400 }}>{localSettings?.quotation_company_tax_id || settings?.quotation_company_tax_id || '0125554000401'}</span>
                </div>
              </div>

              {/* Clean Divider */}
              <div style={{ width: '100%', borderBottom: '1px solid #F1F5F9', margin: '2px 0' }}></div>

              {/* Client Info (ลูกค้า/องค์กร) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>ลูกค้า / องค์กร:</span>
                  <span style={{ fontWeight: 400, color: '#0F172A' }}>{q.customer_name || '-'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>ที่อยู่:</span>
                  <span style={{ color: '#475569', fontWeight: 400, whiteSpace: 'pre-line', lineHeight: 1.3 }}>{q.customer_address || q.department || '-'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>เลขผู้เสียภาษี:</span>
                    <span style={{ fontFamily: fontMono, color: '#334155', fontWeight: 400 }}>{q.customer_tax_id || '-'}</span>
                  </div>
                  <div style={{ color: '#475569', fontSize: '0.73rem' }}>
                    <strong style={{ fontWeight: 700, color: '#0F172A' }}>โทร:</strong> <span style={{ fontWeight: 400 }}>{q.customer_phone || q.contact || '-'}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>ผู้ติดต่อ / เรียน:</span>
                  <span style={{ color: '#334155', fontWeight: 400 }}>{q.contact || q.department || '-'}</span>
                </div>
              </div>

            </div>

            {/* Right 5 Cols: Quotation Metadata Card */}
            <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column' }}>
              <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '9px 13px', display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.74rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '4px', borderBottom: '1px solid #E2E8F0' }}>
                  <span style={{ fontWeight: 700, color: '#0F172A' }}>เลขที่ใบเสนอราคา:</span>
                  <span style={{ fontFamily: fontMono, fontWeight: 700, color: '#0F172A', fontSize: '0.84rem' }}>{qNo}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#475569' }}>วันที่ออกเอกสาร:</span>
                  <span style={{ color: '#0F172A', fontWeight: 400 }}>{qDate}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#475569' }}>ยืนยันราคาถึง:</span>
                  <span style={{ color: '#E11D48', fontWeight: 400 }}>{qValidUntil ? formatDateThai(qValidUntil) : '-'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#475569' }}>ชื่องาน / อ้างอิง:</span>
                  <span style={{ color: '#0F172A', fontWeight: 400 }}>{qJob}</span>
                </div>
                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '4px', marginTop: '1px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#475569' }}>ผู้เสนอราคา:</span>
                  <span style={{ color: '#0F172A', fontWeight: 400 }}>{qSeller}</span>
                </div>
              </div>
            </div>

          </div>

          {/* 3. FULL-WIDTH PRODUCT & SERVICE TABLE */}
          <div style={{ marginTop: '20px', border: '1px solid #CBD5E1', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#FFFFFF', minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left', height: '100%', flex: 1 }}>
              <thead>
                <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1.5px solid #CBD5E1', color: '#0F172A', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '8px 8px', width: '8%', textAlign: 'center', borderRight: '1px solid #E2E8F0', fontWeight: 700, whiteSpace: 'nowrap' }}>ลำดับที่</th>
                  <th style={{ padding: '8px 12px', width: '42%', borderRight: '1px solid #E2E8F0', fontWeight: 700 }}>รายการสินค้า / บริการ</th>
                  <th style={{ padding: '8px 10px', width: '20%', textAlign: 'left', borderRight: '1px solid #E2E8F0', fontWeight: 700 }}>วัน/เวลาที่ใช้งาน</th>
                  <th style={{ padding: '8px 12px', width: '15%', textAlign: 'right', borderRight: '1px solid #E2E8F0', fontWeight: 700 }}>ราคาต่อหน่วย</th>
                  <th style={{ padding: '8px 12px', width: '15%', textAlign: 'right', fontWeight: 700 }}>รวมจำนวนเงิน</th>
                </tr>
              </thead>
              <tbody style={{ color: '#0F172A', verticalAlign: 'top' }}>
                {docItems.length === 0 ? (
                  <tr style={{ height: '220px' }}>
                    <td style={{ borderRight: '1px solid #F1F5F9', padding: '16px 8px' }}></td>
                    <td style={{ textAlign: 'center', verticalAlign: 'middle', color: '#94A3B8', fontStyle: 'italic', fontSize: '0.78rem', borderRight: '1px solid #F1F5F9', padding: '16px 12px', fontWeight: 400 }}>
                      ยังไม่มีรายการสินค้า/บริการ
                    </td>
                    <td style={{ borderRight: '1px solid #F1F5F9', padding: '16px 10px' }}></td>
                    <td style={{ borderRight: '1px solid #F1F5F9', padding: '16px 12px' }}></td>
                    <td style={{ padding: '16px 12px' }}></td>
                  </tr>
                ) : (
                  <>
                    {docItems.map((item, index) => {
                      const itemName = item.room_name || item.service_name || item.custom_name || 'รายการสินค้า/บริการ';
                      const qVal = Number(item.quantity) || 1;
                      const pVal = Number(item.price) || 0;
                      const rawSub = qVal * pVal;
                      const discVal = Number(item.discount) || 0;
                      const discAmt = item.discount_type === 'percent' ? (rawSub * discVal) / 100 : discVal;
                      const net = Math.max(0, rawSub - discAmt);

                      const rawDate = item.item_date || (item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[0] : null);
                      const formattedDate = rawDate ? formatDateThai(rawDate) : '';

                      // Room Details (Capacity for all rooms, Layout ONLY for Room 301, Full Catalog Description)
                      const roomObj = rooms.find(r => r.id === item.room_id) || (item.room_name ? rooms.find(r => item.room_name.includes(r.name)) : null);
                      const cap = item.capacity || (roomObj ? (item.layout === 'classroom' && roomObj.classroom_capacity ? roomObj.classroom_capacity : roomObj.capacity) : null);
                      const isRoom301 = roomObj && (roomObj.has_classroom === 1 || roomObj.has_classroom === true || (roomObj.name && roomObj.name.includes('301')) || (item.room_name && item.room_name.includes('301')));
                      const isClassroom = item.layout === 'classroom' || item.table_layout === 'classroom' || (item.notes && item.notes.toLowerCase().includes('classroom'));
                      
                      let layoutText = null;
                      if (isRoom301) {
                        layoutText = isClassroom ? 'แบบชั้นเรียน (Classroom)' : 'แบบประชุมปกติ (Standard)';
                      }

                      const descText = item.notes || item.description || (roomObj ? roomObj.description : null);

                      let timeDisplay = '';
                      if (item.room_id) {
                        if (item.booking_type === 'hourly') {
                          const st = item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[1].slice(0, 5) : (item.start_time || '09:00');
                          const et = item.end_time && item.end_time.includes('T') ? item.end_time.split('T')[1].slice(0, 5) : (item.end_time || '12:00');
                          timeDisplay = `เวลา ${st} - ${et} น. (${qVal} ชม.)`;
                        } else if (item.booking_type === 'halfday') {
                          timeDisplay = `ครึ่งวัน (${qVal} ครั้ง)`;
                        } else if (item.booking_type === 'daily') {
                          timeDisplay = `รายวัน (${qVal} วัน)`;
                        }
                      } else {
                        timeDisplay = `จำนวน ${qVal} รายการ`;
                      }

                      return (
                        <tr key={index} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '7px 8px', textAlign: 'center', borderRight: '1px solid #F1F5F9', color: '#0F172A', fontFamily: fontMono, fontSize: '0.76rem', fontWeight: 400 }}>
                            {index + 1}
                          </td>
                          <td style={{ padding: '7px 12px', borderRight: '1px solid #F1F5F9' }}>
                            <div style={{ fontWeight: 400, color: '#0F172A', fontSize: '0.80rem' }}>{itemName}</div>
                            
                            {/* Room Capacity & Table Layout Badges */}
                            {(cap || layoutText) && (
                              <div style={{ fontSize: '0.69rem', color: '#64748B', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap', lineHeight: 1.3 }}>
                                {cap ? <span>ความจุ: <span style={{ color: '#334155', fontWeight: 500 }}>{cap} ท่าน</span></span> : null}
                                {layoutText ? <span>จัดโต๊ะ: <span style={{ color: '#334155', fontWeight: 500 }}>{layoutText}</span></span> : null}
                              </div>
                            )}

                            {/* Additional Catalog Description (e.g. ส่วนลดเครื่องดื่ม 20%) */}
                            {descText && (
                              <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: '1px', fontWeight: 400 }}>
                                {descText}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', borderRight: '1px solid #F1F5F9', fontSize: '0.74rem', color: '#475569', fontWeight: 400 }}>
                            {formattedDate && <div style={{ fontWeight: 400, color: '#0F172A' }}>{formattedDate}</div>}
                            <div style={{ color: '#64748B', fontSize: '0.70rem', fontWeight: 400 }}>{timeDisplay}</div>
                          </td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', borderRight: '1px solid #F1F5F9', fontFamily: fontMono, color: '#334155', fontWeight: 400, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {pVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: fontMono, fontWeight: 400, color: '#0F172A', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                            {net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Stretched blank filler row */}
                    <tr style={{ height: '100%' }}>
                      <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 8px' }}></td>
                      <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 12px' }}></td>
                      <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 10px' }}></td>
                      <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 12px' }}></td>
                      <td style={{ padding: '10px 12px' }}></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* 4. FINANCIAL SUMMARY ROW */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '22px', gap: '20px' }}>
            
            {/* Left Side: Thai Baht Text Badge */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ display: 'inline-block', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 14px', fontSize: '0.75rem', color: '#334155' }}>
                <span style={{ fontWeight: 700, color: '#0F172A' }}>จำนวนเงินตัวอักษร:</span>
                <span style={{ color: '#475569', marginLeft: '4px', fontWeight: 400 }}>({thaiBahtText(grandTotal)})</span>
              </div>
            </div>

            {/* Right Side: Financial Calculation Rows */}
            <div style={{ width: '270px', fontSize: '0.76rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, color: '#475569' }}>รวมเป็นเงิน:</span>
                <span style={{ fontFamily: fontMono, fontWeight: 400, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                  {subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                </span>
              </div>

              {discPercent > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 700, color: '#475569' }}>ส่วนลดการค้า ({discPercent}%):</span>
                  <span style={{ fontFamily: fontMono, fontWeight: 400, color: '#DC2626', fontVariantNumeric: 'tabular-nums' }}>
                    -{overallDiscAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, color: '#475569' }}>จำนวนเงินหลังหักส่วนลด:</span>
                <span style={{ fontFamily: fontMono, fontWeight: 400, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                  {taxExclusive.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 700, color: '#475569' }}>ภาษีมูลค่าเพิ่ม (VAT 7%):</span>
                <span style={{ fontFamily: fontMono, fontWeight: 400, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                  {vatAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                </span>
              </div>

              {/* Grand Total Line */}
              <div style={{ borderTop: '2px solid #0F172A', paddingTop: '4px', marginTop: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 800, color: '#0F172A', fontSize: '0.84rem' }}>จำนวนเงินรวมทั้งสิ้น:</span>
                <span style={{ fontFamily: fontMono, fontWeight: 800, color: '#0F172A', fontSize: '0.94rem', fontVariantNumeric: 'tabular-nums' }}>
                  {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                </span>
              </div>

            </div>

          </div>

          {/* 5. PAYMENT REMARKS */}
          <div style={{ marginTop: '16px', fontSize: '0.73rem', color: '#475569', lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ fontWeight: 700, color: '#D97706', fontSize: '0.78rem', marginBottom: '2px' }}>หมายเหตุ</div>
            <div style={{ fontWeight: 400 }}>กรุณาโอนเงินเข้าบัญชี บริษัท บิลท์ ฮาร์ท จำกัด (บัญชีออมทรัพย์)</div>
            <div style={{ fontWeight: 400 }}>ธนาคารกรุงศรีอยุธยา | เลขที่บัญชี: <span style={{ fontFamily: fontMono, fontWeight: 400, color: '#0F172A' }}>329-1-38429-0</span> | สาขา: ซอฟต์แวร์พาร์ค</div>
            <div style={{ fontWeight: 400 }}>ส่งหลักฐานการชำระเงินได้ที่: <span style={{ fontWeight: 400, color: '#0F172A' }}>coworking@bwork.biz</span></div>
          </div>

        </div>

        {/* 6. AUTHORIZED SIGNATURE SECTION */}
        <div style={{ paddingTop: '18px', borderTop: '1px solid #E2E8F0', marginTop: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '36px', alignItems: 'flex-start' }}>
            
            {/* Left: Customer Side */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ color: '#0F172A', minHeight: '32px', fontSize: '0.78rem', display: 'flex', alignItems: 'flex-start', lineHeight: 1.3 }}>
                <span><strong style={{ fontWeight: 700 }}>ในนาม</strong> <span style={{ fontWeight: 400 }}>{q.customer_name ? q.customer_name : 'ลูกค้า'}</span></span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'center', marginTop: '12px' }}>
                <div>
                  <div style={{ height: '32px' }}></div>
                  <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>ผู้สั่งซื้อสินค้า</div>
                </div>
                <div>
                  <div style={{ height: '32px' }}></div>
                  <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>วันที่</div>
                </div>
              </div>
            </div>

            {/* Right: Company Side (Signature & Date) */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ color: '#0F172A', minHeight: '32px', fontSize: '0.78rem', textAlign: 'left', display: 'flex', alignItems: 'flex-start', lineHeight: 1.3 }}>
                <span><strong style={{ fontWeight: 700 }}>ในนาม</strong> <span style={{ fontWeight: 400 }}>{localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด'}</span></span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'center', marginTop: '12px' }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ height: '32px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '2px' }}>
                    {localSettings?.quotation_signature_image || settings?.quotation_signature_image ? (
                      <img 
                        src={localSettings?.quotation_signature_image || settings?.quotation_signature_image} 
                        alt="ลายเซ็นผู้อนุมัติ" 
                        crossOrigin="anonymous" 
                        style={{ maxHeight: '30px', maxWidth: '100px', objectFit: 'contain' }} 
                      />
                    ) : (
                      <svg width="60" height="22" viewBox="0 0 100 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 25 C30 5, 40 35, 60 15 C70 5, 80 25, 90 20" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                      </svg>
                    )}
                  </div>
                  <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>ผู้อนุมัติ</div>
                </div>
                <div>
                  <div style={{ height: '32px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '3px', fontSize: '0.74rem', fontWeight: 400, color: '#0F172A', fontFamily: fontMono }}>
                    {formatDateThai(q.issue_date || q.created_at || Date.now())}
                  </div>
                  <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>วันที่</div>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    );
  };

  const calcState = calculateFinancialTotals();

  return (
    <div className="pos-quotations-container"
      style={{ padding: '20px 24px', width: '100%', boxSizing: 'border-box' }}>
      <style id="quotation-global-print-styles" dangerouslySetInnerHTML={{ __html: `
        @media screen {
          .quotation-print-only-wrapper {
            display: none !important;
            visibility: hidden !important;
          }
        }
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
            height: 296mm !important;
            max-height: 296mm !important;
            background: #FFFFFF !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden !important;
          }
          .quotation-print-only-wrapper,
          .quotation-print-only-wrapper *,
          #quotation-printable-canvas,
          #quotation-printable-canvas * {
            visibility: visible !important;
          }
          .quotation-print-only-wrapper {
            display: block !important;
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
            height: 296mm !important;
            max-height: 296mm !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 99999999 !important;
            background: #FFFFFF !important;
          }
          #quotation-printable-canvas {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
            height: 296mm !important;
            max-height: 296mm !important;
            margin: 0 !important;
            padding: 10mm 13mm 8mm 13mm !important;
            box-sizing: border-box !important;
            background: #FFFFFF !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .no-print {
            display: none !important;
          }
        }
      ` }} />
      
      {/* 1. TOP BAR FOR CREATE / EDIT VIEW */}
      {(viewMode === 'create' || viewMode === 'edit') && (
        <div style={{ marginBottom: '16px' }}>
          
          <form onSubmit={handleSaveQuotation}>
            <div style={{
              position: 'sticky',
              top: '12px',
              zIndex: 100,
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid #E2E8F0',
              borderRadius: '14px',
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.08)',
              marginBottom: '16px',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', padding: '5px 12px', borderRadius: '99px', fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }}></span>
                  <span>{viewMode === 'create' ? 'ร่างเอกสาร (Draft)' : `ใบเสนอราคา #${selectedQuotation?.id}`}</span>
                  <span style={{ color: '#CBD5E1' }}>|</span>
                  <span style={{ fontFamily: 'monospace', color: '#0F172A', fontWeight: 800 }}>{quotationNo}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#64748B' }}>
                  <Check size={14} style={{ color: '#10B981' }} />
                  <span>ระบบคำนวณเงินสด Real-time</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedQuotation(getCurrentDraftPayload());
                    setShowPreview(true);
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 12px', height: '36px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF', color: '#0F172A', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  <Eye size={14} />
                  <span>พรีวิว</span>
                </button>

                <button
                  type="button"
                  disabled={isExportingPDF}
                  onClick={() => handleExportPDF(getCurrentDraftPayload())}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 12px', height: '36px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF', color: '#0F172A', fontSize: '0.78rem', fontWeight: 600, cursor: isExportingPDF ? 'not-allowed' : 'pointer' }}
                >
                  <Download size={14} />
                  <span>{isExportingPDF ? 'กำลัง Export...' : 'Export PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedQuotation(getCurrentDraftPayload());
                    triggerNativePrint();
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 12px', height: '36px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF', color: '#0F172A', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  <Printer size={14} />
                  <span>พิมพ์</span>
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 12px', height: '36px', borderRadius: '8px', border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', color: '#64748B', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  <span>ยกเลิก</span>
                </button>

                <button
                  type="submit"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '0 16px', height: '36px', borderRadius: '8px', fontSize: '0.80rem', fontWeight: 700, background: 'linear-gradient(135deg, #10B981, #059669)', border: 'none', color: '#FFFFFF', cursor: 'pointer', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)' }}
                >
                  <Check size={14} />
                  <span>บันทึกใบเสนอราคา</span>
                </button>
              </div>
            </div>

            {/* MAIN INTERACTIVE A4 DOCUMENT (100% Identical to Print Version) */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 4px' }}>
              
              <div style={{ 
                width: '100%', 
                maxWidth: '920px', 
                backgroundColor: '#FFFFFF', 
                borderRadius: '12px', 
                boxShadow: '0 15px 45px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(15, 23, 42, 0.06)',
                padding: '34px 44px 26px 44px',
                fontFamily: "'Prompt', 'Inter', -apple-system, sans-serif",
                color: '#0F172A',
                boxSizing: 'border-box',
                lineHeight: 1.45,
                position: 'relative'
              }}>

                {/* 1. TOP HEADER ROW (Matching Print Version 1:1) */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '2px solid #0F172A' }}>
                  
                  {/* Left: Brand Logo & Company Info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
                      <img 
                        src="/BH-LOGO.png" 
                        alt="BUILT HEART" 
                        crossOrigin="anonymous" 
                        style={{ height: '24px', width: 'auto', objectFit: 'contain' }} 
                      />
                      <img 
                        src="/BWORK-LOGO.png" 
                        alt="B-WORK" 
                        crossOrigin="anonymous" 
                        style={{ height: '28px', width: 'auto', objectFit: 'contain' }} 
                      />
                    </div>
                    <div style={{ width: '1.5px', height: '46px', backgroundColor: '#E2E8F0' }}></div>
                    <div>
                      <div style={{ fontSize: '0.88rem', color: '#0F172A', lineHeight: 1.25, fontWeight: 700 }}>
                        {localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด (สำนักงานใหญ่)'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 400, marginTop: '2px' }}>
                        Enterprise Solutions & Co-Working Space
                      </div>
                    </div>
                  </div>

                  {/* Right: Original & Document Title */}
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.70rem', color: '#64748B', fontWeight: 600, display: 'block', letterSpacing: '0.08em', lineHeight: 1, textTransform: 'uppercase' }}>QUOTATION</span>
                    <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', margin: '3px 0 0 0', lineHeight: 1 }}>ใบเสนอราคา</h1>
                  </div>
                </div>

                {/* 2. TWO-COLUMN METADATA & PARTIES GRID */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '24px', marginTop: '14px' }}>
                  
                  {/* Left 7 Cols: Issuer & Client Info */}
                  <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    
                    {/* Company Address with ที่อยู่: prefix */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '0.74rem', color: '#475569', lineHeight: 1.35 }}>
                      <div><span style={{ fontWeight: 700, color: '#0F172A' }}>ที่อยู่:</span> 98 หมู่ 2 อาคารบีเวิร์ค ยูนิต602 ซอยแจ้งวัฒนะ-ปากเกร็ด 35 ต.คลองเกลือ อ.ปากเกร็ด จ.นนทบุรี 11120</div>
                      <div style={{ color: '#0F172A', marginTop: '1px' }}>
                        <span style={{ fontWeight: 700 }}>เลขประจำตัวผู้เสียภาษี:</span> <span style={{ fontFamily: "'Inter', monospace", fontWeight: 400 }}>{localSettings?.quotation_company_tax_id || settings?.quotation_company_tax_id || '0125554000401'}</span>
                      </div>
                    </div>

                    {/* Clean Divider */}
                    <div style={{ width: '100%', borderBottom: '1px solid #F1F5F9', margin: '2px 0' }}></div>

                    {/* Client Info (Interactive Input Fields with Prompt Typography) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                      
                      {/* Customer Name + Search Presets */}
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>ลูกค้า / องค์กร:</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                          <input 
                            type="text" 
                            value={customerName} 
                            onChange={e => setCustomerName(e.target.value)} 
                            placeholder="ชื่อบริษัท / ชื่อลูกค้า *" 
                            style={{ 
                              flex: 1, 
                              border: 'none', 
                              borderBottom: '1px dashed #CBD5E1', 
                              padding: '2px 4px', 
                              fontSize: '0.75rem', 
                              color: '#0F172A', 
                              fontWeight: 400, 
                              outline: 'none', 
                              backgroundColor: 'transparent',
                              fontFamily: "'Prompt', sans-serif"
                            }}
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setIsCustomerSearchModalOpen(true)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              border: '1px solid #CBD5E1',
                              backgroundColor: '#F8FAFC',
                              color: '#475569',
                              fontSize: '0.70rem',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                            title="ค้นหาลูกค้าเก่า"
                          >
                            <Search size={11} />
                            <span>ลูกค้าเก่า</span>
                          </button>
                        </div>
                      </div>

                      {/* Address */}
                      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                        <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0, paddingTop: '2px' }}>ที่อยู่:</span>
                        <textarea 
                          value={customerAddress} 
                          onChange={e => setCustomerAddress(e.target.value)} 
                          placeholder="ที่อยู่สำหรับออกเอกสาร..." 
                          rows={2}
                          style={{ 
                            flex: 1, 
                            border: 'none', 
                            borderBottom: '1px dashed #CBD5E1', 
                            padding: '2px 4px', 
                            fontSize: '0.74rem', 
                            color: '#475569', 
                            fontWeight: 400,
                            outline: 'none', 
                            backgroundColor: 'transparent',
                            resize: 'none',
                            lineHeight: 1.3,
                            fontFamily: "'Prompt', sans-serif"
                          }}
                        />
                      </div>

                      {/* Tax ID & Tel */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                          <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>เลขผู้เสียภาษี:</span>
                          <input 
                            type="text" 
                            value={customerTaxId} 
                            onChange={e => setCustomerTaxId(e.target.value)} 
                            placeholder="0105565012345" 
                            style={{ 
                              width: '100%', 
                              border: 'none', 
                              borderBottom: '1px dashed #CBD5E1', 
                              padding: '2px 4px', 
                              fontSize: '0.74rem', 
                              color: '#334155', 
                              fontFamily: "'Inter', monospace", 
                              fontWeight: 400,
                              outline: 'none', 
                              backgroundColor: 'transparent' 
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', width: '170px' }}>
                          <span style={{ fontWeight: 700, color: '#0F172A', marginRight: '4px' }}>โทร:</span>
                          <input 
                            type="text" 
                            value={customerPhone} 
                            onChange={e => setCustomerPhone(e.target.value)} 
                            placeholder="081-987-6543" 
                            style={{ 
                              width: '100%', 
                              border: 'none', 
                              borderBottom: '1px dashed #CBD5E1', 
                              padding: '2px 4px', 
                              fontSize: '0.73rem', 
                              color: '#475569', 
                              fontWeight: 400,
                              outline: 'none', 
                              backgroundColor: 'transparent',
                              fontFamily: "'Inter', sans-serif"
                            }}
                          />
                        </div>
                      </div>

                      {/* Contact Person */}
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: '90px', fontWeight: 700, color: '#0F172A', flexShrink: 0 }}>ผู้ติดต่อ / เรียน:</span>
                        <input 
                          type="text" 
                          value={contact} 
                          onChange={e => setContact(e.target.value)} 
                          placeholder="ชื่อผู้ติดต่อ / แผนกจัดซื้อ" 
                          style={{ 
                            flex: 1, 
                            border: 'none', 
                            borderBottom: '1px dashed #CBD5E1', 
                            padding: '2px 4px', 
                            fontSize: '0.74rem', 
                            color: '#334155', 
                            fontWeight: 400,
                            outline: 'none', 
                            backgroundColor: 'transparent',
                            fontFamily: "'Prompt', sans-serif"
                          }}
                        />
                      </div>

                    </div>

                  </div>

                  {/* Right 5 Cols: Quotation Metadata Card */}
                  <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '9px 13px', display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.74rem' }}>
                      
                      {/* Quotation No */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '4px', borderBottom: '1px solid #E2E8F0' }}>
                        <span style={{ fontWeight: 700, color: '#0F172A' }}>เลขที่ใบเสนอราคา:</span>
                        <input 
                          type="text" 
                          value={quotationNo} 
                          onChange={e => setQuotationNo(e.target.value)} 
                          placeholder="QT-2608001" 
                          style={{ 
                            textAlign: 'right', 
                            border: 'none', 
                            borderBottom: '1px dashed #CBD5E1', 
                            fontFamily: "'Inter', monospace", 
                            fontWeight: 700, 
                            color: '#0F172A', 
                            fontSize: '0.84rem', 
                            outline: 'none', 
                            width: '120px', 
                            backgroundColor: 'transparent' 
                          }}
                        />
                      </div>

                      {/* Issue Date */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#475569' }}>วันที่ออกเอกสาร:</span>
                        <CustomDatePicker 
                          value={issueDate} 
                          onChange={val => setIssueDate(val)} 
                          className="inline-doc-datepicker"
                          style={{ height: '24px', fontSize: '0.74rem' }}
                        />
                      </div>

                      {/* Valid Date */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#475569' }}>ยืนยันราคาถึง:</span>
                        <CustomDatePicker 
                          value={validUntil} 
                          onChange={val => setValidUntil(val)} 
                          className="inline-doc-datepicker"
                          style={{ height: '24px', fontSize: '0.74rem' }}
                        />
                      </div>

                      {/* Reference / Job */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#475569' }}>ชื่องาน / อ้างอิง:</span>
                        <input 
                          type="text" 
                          value={jobName} 
                          onChange={e => setJobName(e.target.value)} 
                          placeholder="Meeting Room" 
                          style={{ 
                            textAlign: 'right', 
                            border: 'none', 
                            borderBottom: '1px dashed #CBD5E1', 
                            fontWeight: 400, 
                            color: '#0F172A', 
                            fontSize: '0.74rem', 
                            outline: 'none', 
                            width: '120px', 
                            backgroundColor: 'transparent',
                            fontFamily: "'Prompt', sans-serif"
                          }}
                        />
                      </div>

                      {/* Seller Name */}
                      <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '4px', marginTop: '1px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, color: '#475569' }}>ผู้เสนอราคา:</span>
                        <div style={{ width: '130px' }}>
                          <CustomSelect
                            value={sellerName}
                            onChange={val => setSellerName(val)}
                            options={getSellerOptions().map(name => ({ value: name, label: name }))}
                            placeholder="-- เลือกผู้เสนอราคา --"
                            size="small"
                          />
                        </div>
                      </div>

                    </div>
                  </div>

                </div>

                {/* 3. FULL-WIDTH PRODUCT & SERVICE TABLE (Matching Print Version 1:1) */}
                <div style={{ marginTop: '20px', border: '1px solid #CBD5E1', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#FFFFFF', minHeight: '280px', display: 'flex', flexDirection: 'column' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left', height: '100%', flex: 1 }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1.5px solid #CBD5E1', color: '#0F172A', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <th style={{ padding: '8px 8px', width: '8%', textAlign: 'center', borderRight: '1px solid #E2E8F0', fontWeight: 700, whiteSpace: 'nowrap' }}>ลำดับที่</th>
                        <th style={{ padding: '8px 12px', width: '42%', borderRight: '1px solid #E2E8F0', fontWeight: 700 }}>รายการสินค้า / บริการ</th>
                        <th style={{ padding: '8px 10px', width: '20%', textAlign: 'left', borderRight: '1px solid #E2E8F0', fontWeight: 700 }}>วัน/เวลาที่ใช้งาน</th>
                        <th style={{ padding: '8px 12px', width: '15%', textAlign: 'right', borderRight: '1px solid #E2E8F0', fontWeight: 700 }}>ราคาต่อหน่วย</th>
                        <th style={{ padding: '8px 12px', width: '15%', textAlign: 'right', fontWeight: 700 }}>รวมจำนวนเงิน</th>
                        <th style={{ padding: '8px 6px', width: '32px', textAlign: 'center' }}></th>
                      </tr>
                    </thead>
                    <tbody style={{ color: '#0F172A', verticalAlign: 'top' }}>
                      {items.length === 0 ? (
                        <tr style={{ height: '220px' }}>
                          <td style={{ borderRight: '1px solid #F1F5F9', padding: '16px 8px' }}></td>
                          <td style={{ textAlign: 'center', verticalAlign: 'middle', color: '#94A3B8', fontStyle: 'italic', fontSize: '0.78rem', borderRight: '1px solid #F1F5F9', padding: '16px 12px', fontWeight: 400 }}>
                            ยังไม่มีรายการสินค้า/บริการ กรุณาเพิ่มรายการจากแถบด้านล่าง
                          </td>
                          <td style={{ borderRight: '1px solid #F1F5F9', padding: '16px 10px' }}></td>
                          <td style={{ borderRight: '1px solid #F1F5F9', padding: '16px 12px' }}></td>
                          <td style={{ padding: '16px 12px' }}></td>
                          <td></td>
                        </tr>
                      ) : (
                        <>
                          {items.map((item, index) => {
                            const itemName = item.room_name || item.service_name || item.custom_name || 'รายการสินค้า/บริการ';
                            const qVal = Number(item.quantity) || 1;
                            const pVal = Number(item.price) || 0;
                            const rawSub = qVal * pVal;
                            const discVal = Number(item.discount) || 0;
                            const discAmt = item.discount_type === 'percent' ? (rawSub * discVal) / 100 : discVal;
                            const net = Math.max(0, rawSub - discAmt);

                            const rawDate = item.item_date || (item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[0] : null);
                            const formattedDate = rawDate ? formatDateThai(rawDate) : '';

                            // Room Details (Capacity for all rooms, Layout ONLY for Room 301, Full Catalog Description)
                            const roomObj = rooms.find(r => r.id === item.room_id) || (item.room_name ? rooms.find(r => item.room_name.includes(r.name)) : null);
                            const cap = item.capacity || (roomObj ? (item.layout === 'classroom' && roomObj.classroom_capacity ? roomObj.classroom_capacity : roomObj.capacity) : null);
                            const isRoom301 = roomObj && (roomObj.has_classroom === 1 || roomObj.has_classroom === true || (roomObj.name && roomObj.name.includes('301')) || (item.room_name && item.room_name.includes('301')));
                            const isClassroom = item.layout === 'classroom' || item.table_layout === 'classroom' || (item.notes && item.notes.toLowerCase().includes('classroom'));
                            
                            let layoutText = null;
                            if (isRoom301) {
                              layoutText = isClassroom ? 'แบบชั้นเรียน (Classroom)' : 'แบบประชุมปกติ (Standard)';
                            }

                            const descText = item.notes || item.description || (roomObj ? roomObj.description : null);

                            let timeDisplay = '';
                            if (item.room_id) {
                              if (item.booking_type === 'hourly') {
                                const st = item.start_time && item.start_time.includes('T') ? item.start_time.split('T')[1].slice(0, 5) : (item.start_time || '09:00');
                                const et = item.end_time && item.end_time.includes('T') ? item.end_time.split('T')[1].slice(0, 5) : (item.end_time || '12:00');
                                timeDisplay = `เวลา ${st} - ${et} น. (${qVal} ชม.)`;
                              } else if (item.booking_type === 'halfday') {
                                timeDisplay = `ครึ่งวัน (${qVal} ครั้ง)`;
                              } else if (item.booking_type === 'daily') {
                                timeDisplay = `รายวัน (${qVal} วัน)`;
                              }
                            } else {
                              timeDisplay = `จำนวน ${qVal} รายการ`;
                            }

                            return (
                              <tr key={index} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '7px 8px', textAlign: 'center', borderRight: '1px solid #F1F5F9', color: '#0F172A', fontFamily: "'Inter', monospace", fontSize: '0.76rem', fontWeight: 400 }}>
                                  {index + 1}
                                </td>
                                <td style={{ padding: '7px 12px', borderRight: '1px solid #F1F5F9' }}>
                                  <div style={{ fontWeight: 400, color: '#0F172A', fontSize: '0.80rem' }}>{itemName}</div>
                                  
                                  {/* Room Capacity & Table Layout Badges */}
                                  {(cap || layoutText) && (
                                    <div style={{ fontSize: '0.69rem', color: '#64748B', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap', lineHeight: 1.3 }}>
                                      {cap ? <span>ความจุ: <span style={{ color: '#334155', fontWeight: 500 }}>{cap} ท่าน</span></span> : null}
                                      {layoutText ? <span>จัดโต๊ะ: <span style={{ color: '#334155', fontWeight: 500 }}>{layoutText}</span></span> : null}
                                    </div>
                                  )}

                                  {/* Additional Catalog Description (e.g. ส่วนลดเครื่องดื่ม 20%) */}
                                  {descText && (
                                    <div style={{ fontSize: '0.68rem', color: '#64748B', marginTop: '1px', fontWeight: 400 }}>
                                      {descText}
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding: '7px 10px', borderRight: '1px solid #F1F5F9', fontSize: '0.74rem', color: '#475569', fontWeight: 400 }}>
                                  {formattedDate && <div style={{ fontWeight: 400, color: '#0F172A' }}>{formattedDate}</div>}
                                  <div style={{ color: '#64748B', fontSize: '0.70rem', fontWeight: 400 }}>{timeDisplay}</div>
                                </td>
                                <td style={{ padding: '7px 12px', textAlign: 'right', borderRight: '1px solid #F1F5F9', fontFamily: "'Inter', monospace", color: '#334155', fontWeight: 400, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                  {pVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: "'Inter', monospace", fontWeight: 400, color: '#0F172A', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                  {net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td style={{ padding: '7px 6px', textAlign: 'center' }}>
                                  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      handleRemoveItem(index);
    }}
    style={{
      border: '1px solid rgba(239, 68, 68, 0.2)',
      background: 'rgba(239, 68, 68, 0.06)',
      color: '#EF4444',
      cursor: 'pointer',
      padding: '4px 6px',
      borderRadius: '6px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.15s ease'
    }}
    title="ลบรายการนี้"
  >
    <Trash2 size={13} />
  </button>
                                </td>
                              </tr>
                            );
                          })}
                          {/* Stretched blank filler row */}
                          <tr style={{ height: '100%' }}>
                            <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 8px' }}></td>
                            <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 12px' }}></td>
                            <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 10px' }}></td>
                            <td style={{ borderRight: '1px solid #F1F5F9', padding: '10px 12px' }}></td>
                            <td style={{ padding: '10px 12px' }}></td>
                            <td></td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* QUICK ADD CATALOG BAR (Smart Time Range Selector & Auto-calculated Hours) */}
                <div style={{ marginTop: '10px', padding: '10px 14px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  
                  {/* 1. Catalog Dropdown */}
                  <div style={{ minWidth: '200px', flex: 1 }}>
                    <CustomSelect
                      value={selectedCatalogValue}
                      onChange={val => {
                        setSelectedCatalogValue(val);
                        if (val && val.startsWith('room_')) {
                          const rId = parseInt(val.replace('room_', ''), 10);
                          const rObj = rooms.find(r => r.id === rId);
                          if (rObj) {
                            setQuickAddPrice(getRoomRate(rObj, quickAddBookingType, quickAddLayout));
                            if (quickAddBookingType === 'hourly') {
                              setQuickAddQty(calcHoursBetween(quickAddStartTime, quickAddEndTime));
                            } else {
                              setQuickAddQty(1);
                            }
                          }
                        } else if (val && val.startsWith('srv_')) {
                          const sId = parseInt(val.replace('srv_', ''), 10);
                          const sObj = services.find(s => s.id === sId);
                          if (sObj) {
                            setQuickAddPrice(Number(sObj.price) || 0);
                            setQuickAddQty(1);
                          }
                        }
                      }}
                      options={getCatalogDropdownOptions()}
                      placeholder="-- เลือกห้องประชุม หรือ บริการเสริม --"
                      size="small"
                    />
                  </div>

                  {/* 2. Room-specific controls */}
                  {selectedCatalogValue && selectedCatalogValue.startsWith('room_') && (() => {
                    const rId = parseInt(selectedCatalogValue.replace('room_', ''), 10);
                    const rObj = rooms.find(r => r.id === rId);
                    const isRoom301 = rObj && (rObj.has_classroom === 1 || rObj.has_classroom === true || (rObj.name && rObj.name.includes('301')));

                    return (
                      <>
                        {/* Booking Type */}
                        <div style={{ width: '105px' }}>
                          <CustomSelect
                            value={quickAddBookingType}
                            onChange={val => {
                              setQuickAddBookingType(val);
                              if (rObj) setQuickAddPrice(getRoomRate(rObj, val, isRoom301 ? quickAddLayout : 'standard'));
                              if (val === 'hourly') {
                                setQuickAddQty(calcHoursBetween(quickAddStartTime, quickAddEndTime));
                              } else {
                                setQuickAddQty(1);
                              }
                            }}
                            options={[
                              { value: 'hourly', label: 'รายชั่วโมง' },
                              { value: 'halfday', label: 'ครึ่งวัน' },
                              { value: 'daily', label: 'รายวัน' }
                            ]}
                            size="small"
                          />
                        </div>

                        {/* Table Layout (Only for Room 301) */}
                        {isRoom301 && (
                          <div style={{ width: '130px' }}>
                            <CustomSelect
                              value={quickAddLayout}
                              onChange={val => {
                                setQuickAddLayout(val);
                                if (rObj) setQuickAddPrice(getRoomRate(rObj, quickAddBookingType, val));
                              }}
                              options={[
                                { value: 'standard', label: 'แบบประชุมปกติ' },
                                { value: 'classroom', label: 'แบบชั้นเรียน' }
                              ]}
                              size="small"
                            />
                          </div>
                        )}

                        {/* Date Picker */}
                        <div style={{ width: '130px' }}>
                          <CustomDatePicker
                            value={quickAddDate}
                            onChange={val => setQuickAddDate(val)}
                            className="inline-doc-datepicker"
                            style={{ height: '30px', fontSize: '0.74rem' }}
                          />
                        </div>

                        {/* Time Selectors for Hourly (Using CustomSelect Matching All Pages) */}
                        {quickAddBookingType === 'hourly' && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{ width: '90px' }}>
                              <CustomSelect
                                value={quickAddStartTime}
                                onChange={val => {
                                  setQuickAddStartTime(val);
                                  let et = quickAddEndTime;
                                  if (et <= val) {
                                    const [sh, sm] = val.split(':').map(Number);
                                    const nextMins = Math.min(18 * 60, sh * 60 + sm + 60);
                                    const nH = String(Math.floor(nextMins / 60)).padStart(2, '0');
                                    const nM = String(nextMins % 60).padStart(2, '0');
                                    et = `${nH}:${nM}`;
                                    setQuickAddEndTime(et);
                                  }
                                  setQuickAddQty(calcHoursBetween(val, et));
                                }}
                                options={TIME_SLOT_OPTIONS.slice(0, -1).map(t => ({ value: t, label: t }))}
                                size="small"
                              />
                            </div>
                            <span style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 500 }}>ถึง</span>
                            <div style={{ width: '90px' }}>
                              <CustomSelect
                                value={quickAddEndTime}
                                onChange={val => {
                                  setQuickAddEndTime(val);
                                  setQuickAddQty(calcHoursBetween(quickAddStartTime, val));
                                }}
                                options={TIME_SLOT_OPTIONS.filter(t => t > quickAddStartTime).map(t => ({ value: t, label: t }))}
                                size="small"
                              />
                            </div>
                            <div style={{ height: '30px', padding: '0 8px', display: 'inline-flex', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: '6px', border: '1px solid #BFDBFE', fontSize: '0.72rem', fontWeight: 700, color: '#2563EB', whiteSpace: 'nowrap' }}>
                              {calcHoursBetween(quickAddStartTime, quickAddEndTime)} ชม.
                            </div>
                          </div>
                        )}

                        {/* Slot Selector for Half-Day */}
                        {quickAddBookingType === 'halfday' && (
                          <div style={{ width: '135px' }}>
                            <CustomSelect
                              value={quickAddStartTime === '13:00' ? 'afternoon' : 'morning'}
                              onChange={val => {
                                if (val === 'morning') {
                                  setQuickAddStartTime('09:00');
                                  setQuickAddEndTime('13:00');
                                } else {
                                  setQuickAddStartTime('13:00');
                                  setQuickAddEndTime('17:00');
                                }
                                setQuickAddQty(1);
                              }}
                              options={[
                                { value: 'morning', label: 'รอบเช้า (09-13น.)' },
                                { value: 'afternoon', label: 'รอบบ่าย (13-17น.)' }
                              ]}
                              size="small"
                            />
                          </div>
                        )}

                        {/* Full Day Indicator */}
                        {quickAddBookingType === 'daily' && (
                          <div style={{ padding: '0 8px', height: '30px', display: 'flex', alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: '6px', border: '1px solid #BFDBFE', fontSize: '0.72rem', color: '#1D4ED8', fontWeight: 600 }}>
                            เต็มวัน (09:00 - 18:00 น.)
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* 3. Non-room quantity input */}
                  {selectedCatalogValue && selectedCatalogValue.startsWith('srv_') && (
                    <div style={{ width: '90px' }}>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={quickAddQty}
                        onChange={e => setQuickAddQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        placeholder="จำนวน"
                        style={{ width: '100%', height: '30px', padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '0.74rem', textAlign: 'center', fontFamily: "'Inter', monospace" }}
                      />
                    </div>
                  )}

                  {/* 4. Unit Price input */}
                  <div style={{ width: '90px' }}>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={quickAddPrice}
                      onChange={e => setQuickAddPrice(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="ราคาต่อหน่วย"
                      style={{ width: '100%', height: '30px', padding: '0 8px', border: '1px solid #CBD5E1', borderRadius: '6px', fontSize: '0.74rem', textAlign: 'right', fontFamily: "'Inter', monospace" }}
                    />
                  </div>

                  {/* 5. Add Button */}
                  <button
                    type="button"
                    onClick={handleAddQuickItem}
                    style={{
                      height: '30px',
                      padding: '0 12px',
                      borderRadius: '6px',
                      backgroundColor: '#2563EB',
                      color: '#FFFFFF',
                      border: 'none',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={13} />
                    <span>+ เพิ่มรายการ</span>
                  </button>
                </div>

                {/* 4. FINANCIAL SUMMARY ROW */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '22px', gap: '20px' }}>
                  
                  {/* Left Side: Thai Baht Text Badge */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start' }}>
                    <div style={{ display: 'inline-block', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 14px', fontSize: '0.75rem', color: '#334155' }}>
                      <span style={{ fontWeight: 700, color: '#0F172A' }}>จำนวนเงินตัวอักษร:</span>
                      <span style={{ color: '#475569', marginLeft: '4px', fontWeight: 400 }}>({thaiBahtText(calcState.grandTotal)})</span>
                    </div>
                  </div>

                  {/* Right Side: Financial Calculation Rows */}
                  <div style={{ width: '270px', fontSize: '0.76rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700, color: '#475569' }}>รวมเป็นเงิน:</span>
                      <span style={{ fontFamily: "'Inter', monospace", fontWeight: 400, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                        {calcState.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700, color: '#475569' }}>ส่วนลดการค้า:</span>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={overallDiscountPercent}
                          onChange={e => setOverallDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                          style={{ width: '42px', height: '22px', border: '1px solid #CBD5E1', borderRadius: '4px', textAlign: 'right', fontSize: '0.72rem', fontFamily: "'Inter', monospace" }}
                        />
                        <span style={{ color: '#64748B', fontSize: '0.72rem' }}>%</span>
                        <span style={{ fontFamily: "'Inter', monospace", fontWeight: 400, color: '#DC2626', fontVariantNumeric: 'tabular-nums', marginLeft: '4px' }}>
                          -{calcState.discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 700, color: '#475569' }}>จำนวนเงินหลังหักส่วนลด:</span>
                      <span style={{ fontFamily: "'Inter', monospace", fontWeight: 400, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                        {calcState.taxExclusive.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={hasVat}
                          onChange={e => setHasVat(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: 700, color: '#475569' }}>ภาษีมูลค่าเพิ่ม (VAT 7%):</span>
                      </label>
                      <span style={{ fontFamily: "'Inter', monospace", fontWeight: 400, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                        {calcState.vatAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                      </span>
                    </div>

                    {/* Grand Total Line */}
                    <div style={{ borderTop: '2px solid #0F172A', paddingTop: '4px', marginTop: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 800, color: '#0F172A', fontSize: '0.84rem' }}>จำนวนเงินรวมทั้งสิ้น:</span>
                      <span style={{ fontFamily: "'Inter', monospace", fontWeight: 800, color: '#0F172A', fontSize: '0.94rem', fontVariantNumeric: 'tabular-nums' }}>
                        {calcState.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                      </span>
                    </div>

                  </div>

                </div>

                {/* 5. PAYMENT REMARKS (Below Grand Total) */}
                <div style={{ marginTop: '16px', fontSize: '0.73rem', color: '#475569', lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ fontWeight: 700, color: '#D97706', fontSize: '0.78rem', marginBottom: '2px' }}>หมายเหตุ</div>
                  <div style={{ fontWeight: 400 }}>กรุณาโอนเงินเข้าบัญชี บริษัท บิลท์ ฮาร์ท จำกัด (บัญชีออมทรัพย์)</div>
                  <div>ธนาคารกรุงศรีอยุธยา | เลขที่บัญชี: <span style={{ fontFamily: "'Inter', monospace", fontWeight: 400, color: '#0F172A' }}>329-1-38429-0</span> | สาขา: ซอฟต์แวร์พาร์ค</div>
                  <div>ส่งหลักฐานการชำระเงินได้ที่: <span style={{ fontWeight: 400, color: '#0F172A' }}>coworking@bwork.biz</span></div>
                </div>

                {/* 6. AUTHORIZED SIGNATURE SECTION (Matching Print Version 1:1) */}
                <div style={{ paddingTop: '18px', borderTop: '1px solid #E2E8F0', marginTop: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '36px', alignItems: 'flex-start' }}>
                    
                    {/* Left: Customer Side */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ color: '#0F172A', minHeight: '32px', fontSize: '0.78rem', display: 'flex', alignItems: 'flex-start', lineHeight: 1.3 }}>
                        <span><strong style={{ fontWeight: 700 }}>ในนาม</strong> <span style={{ fontWeight: 400 }}>{customerName ? customerName : 'ลูกค้า'}</span></span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'center', marginTop: '12px' }}>
                        <div>
                          <div style={{ height: '32px' }}></div>
                          <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>ผู้สั่งซื้อสินค้า</div>
                        </div>
                        <div>
                          <div style={{ height: '32px' }}></div>
                          <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>วันที่</div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Company Side (Signature & Date) */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ color: '#0F172A', minHeight: '32px', fontSize: '0.78rem', textAlign: 'left', display: 'flex', alignItems: 'flex-start', lineHeight: 1.3 }}>
                        <span><strong style={{ fontWeight: 700 }}>ในนาม</strong> <span style={{ fontWeight: 400 }}>{localSettings?.quotation_company_name || settings?.quotation_company_name || 'บริษัท บิลท์ ฮาร์ท จำกัด'}</span></span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', textAlign: 'center', marginTop: '12px' }}>
                        <div style={{ position: 'relative' }}>
                          <div style={{ height: '32px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '2px' }}>
                            {localSettings?.quotation_signature_image || settings?.quotation_signature_image ? (
                              <img 
                                src={localSettings?.quotation_signature_image || settings?.quotation_signature_image} 
                                alt="ลายเซ็นผู้อนุมัติ" 
                                crossOrigin="anonymous" 
                                style={{ maxHeight: '30px', maxWidth: '100px', objectFit: 'contain' }} 
                              />
                            ) : (
                              <svg width="60" height="22" viewBox="0 0 100 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 25 C30 5, 40 35, 60 15 C70 5, 80 25, 90 20" stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                              </svg>
                            )}
                          </div>
                          <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>ผู้อนุมัติ</div>
                        </div>
                        <div>
                          <div style={{ height: '32px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '3px', fontSize: '0.74rem', fontWeight: 400, color: '#0F172A', fontFamily: "'Inter', monospace" }}>
                            {formatDateThai(issueDate || toLocalDateString())}
                          </div>
                          <div style={{ borderTop: '1px solid #CBD5E1', width: '100%' }}></div>
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginTop: '5px' }}>วันที่</div>
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

      
      {/* 2. VIEW MODE: LIST OF QUOTATIONS (Spacious Full-Width Clean Layout) */}
      {viewMode === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' }}>
          
          {/* Executive Page Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', padding: '0 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '50px',
                height: '50px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(99, 102, 241, 0.1))',
                border: '1px solid rgba(37, 99, 235, 0.25)',
                color: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 20px -4px rgba(37, 99, 235, 0.2)',
                flexShrink: 0
              }}>
                <FileText size={26} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 850, color: 'var(--text-main)', margin: 0, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>ระบบใบเสนอราคา</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', backgroundColor: 'rgba(37, 99, 235, 0.1)', color: '#2563EB', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                    Quotations Studio
                  </span>
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                  จัดการ ออกเอกสารใบเสนอราคามาตรฐาน และแปลงเป็นบิลเปิดจองห้องประชุมได้ทันที
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={fetchQuotations}
                disabled={loading}
                className="btn btn-secondary"
                style={{
                  height: '44px',
                  padding: '0 18px',
                  borderRadius: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                <span>รีเฟรช</span>
              </button>

              <button
                type="button"
                onClick={handleOpenCreateForm}
                className="btn btn-primary"
                style={{
                  height: '44px',
                  padding: '0 22px',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                  boxShadow: '0 8px 24px -4px rgba(37, 99, 235, 0.45)',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <Plus size={18} />
                <span>สร้างใบเสนอราคาใหม่</span>
              </button>
            </div>
          </div>

          {/* Search, Filter & Status Tabs Card (Full Width) */}
          <div className="card" style={{ padding: '16px 20px', borderRadius: '18px', display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', boxSizing: 'border-box' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              
              {/* Search Box */}
              <div style={{ position: 'relative', flex: 1, minWidth: '300px' }}>
                <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อลูกค้า, บริษัท, เบอร์โทร, หรือชื่องาน..."
                  style={{
                    width: '100%',
                    height: '42px',
                    padding: '0 14px 0 42px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-main)',
                    color: 'var(--text-main)',
                    fontSize: '0.84rem',
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>

              {/* Status Segmented Control Tabs */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px',
                borderRadius: '14px',
                backgroundColor: 'var(--bg-main)',
                border: '1px solid var(--border-color)',
                gap: '4px',
                flexWrap: 'wrap'
              }}>
                {[
                  { id: 'all', label: 'ทั้งหมด', count: quotations.length },
                  { id: 'draft', label: 'ร่าง', count: quotations.filter(q => q.status === 'draft').length },
                  { id: 'sent', label: 'ส่งแล้ว', count: quotations.filter(q => q.status === 'sent').length },
                  { id: 'accepted', label: 'อนุมัติแล้ว', count: quotations.filter(q => q.status === 'accepted').length },
                  { id: 'rejected', label: 'ปฏิเสธ', count: quotations.filter(q => q.status === 'rejected').length }
                ].map(st => {
                  const isActive = statusFilter === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStatusFilter(st.id)}
                      style={{
                        padding: '6px 16px',
                        borderRadius: '10px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        border: 'none',
                        backgroundColor: isActive ? '#2563EB' : 'transparent',
                        color: isActive ? '#FFFFFF' : 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: isActive ? '0 4px 12px rgba(37, 99, 235, 0.35)' : 'none'
                      }}
                    >
                      <span>{st.label}</span>
                      <span style={{
                        fontSize: '0.72rem',
                        padding: '1px 7px',
                        borderRadius: '999px',
                        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.25)' : 'var(--bg-card)',
                        color: isActive ? '#FFFFFF' : 'var(--text-muted)',
                        fontWeight: 800
                      }}>
                        {st.count}
                      </span>
                    </button>
                  );
                })}
              </div>

            </div>

          </div>

          {/* Expanded Full-Width Table List Card */}
          <div className="card" style={{ borderRadius: '18px', overflow: 'hidden', padding: 0, boxShadow: 'var(--glass-shadow)', width: '100%', boxSizing: 'border-box' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-main)', borderBottom: '1.5px solid var(--border-color)', color: 'var(--text-muted)', fontWeight: 750 }}>
                  <th style={{ padding: '16px 20px', width: '16%', cursor: 'pointer' }} onClick={() => handleSort('quotation_no')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>เลขที่เอกสาร</span>
                      {sortField === 'quotation_no' && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                    </div>
                  </th>
                  <th style={{ padding: '16px 20px', width: '30%', cursor: 'pointer' }} onClick={() => handleSort('customer_name')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>ลูกค้า / องค์กร</span>
                      {sortField === 'customer_name' && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                    </div>
                  </th>
                  <th style={{ padding: '16px 18px', width: '12%', cursor: 'pointer' }} onClick={() => handleSort('created_at')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>วันที่ออกเอกสาร</span>
                      {sortField === 'created_at' && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                    </div>
                  </th>
                  <th style={{ padding: '16px 18px', width: '12%', cursor: 'pointer' }} onClick={() => handleSort('valid_until')}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>ยืนยันราคาถึง</span>
                      {sortField === 'valid_until' && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                    </div>
                  </th>
                  <th style={{ padding: '16px 20px', width: '14%', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('total_amount')}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                      <span>ยอดสุทธิ (฿)</span>
                      {sortField === 'total_amount' && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                    </div>
                  </th>
                  <th style={{ padding: '16px 16px', width: '10%', textAlign: 'center', cursor: 'pointer' }} onClick={() => handleSort('status')}>
                    <span>สถานะ</span>
                  </th>
                  <th style={{ padding: '16px 20px', textAlign: 'center', whiteSpace: 'nowrap', width: '1%' }}>การดำเนินการ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '70px 20px', color: 'var(--text-muted)' }}>
                      <RefreshCw size={32} className="animate-spin" style={{ margin: '0 auto 14px auto', color: '#2563EB' }} />
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>กำลังโหลดข้อมูลใบเสนอราคา...</div>
                    </td>
                  </tr>
                ) : sortedQuotations.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
                      <div style={{ width: '70px', height: '70px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.08)', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                        <FileText size={36} />
                      </div>
                      <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '1.05rem' }}>ไม่พบรายการใบเสนอราคา</div>
                      <p style={{ margin: '6px 0 20px 0', fontSize: '0.84rem' }}>กดปุ่มด้านล่างเพื่อเริ่มสร้างใบเสนอราคาฉบับแรกได้ทันที</p>
                      <button
                        type="button"
                        onClick={handleOpenCreateForm}
                        className="btn btn-primary"
                        style={{ padding: '0 20px', height: '42px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 800 }}
                      >
                        + สร้างใบเสนอราคาใหม่
                      </button>
                    </td>
                  </tr>
                ) : (
                  sortedQuotations.map((q, idx) => {
                    const qNo = q.quotation_no || (q.id ? ('QT-' + String(new Date(q.created_at || Date.now()).getFullYear()).slice(-2) + (new Date(q.created_at || Date.now()).getMonth()+1).toString().padStart(2,'0') + String(q.id || '').padStart(3,'0')) : 'QT-2608001');
                    return (
                      <tr 
                        key={q.id} 
                        style={{ 
                          borderBottom: '1px solid var(--border-color)', 
                          verticalAlign: 'middle',
                          backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(37, 99, 235, 0.015)',
                          transition: 'background-color 0.15s ease'
                        }}
                      >
                        {/* 1. Quotation No */}
                        <td style={{ padding: '16px 20px', fontFamily: "'Inter', monospace", fontWeight: 800, color: '#2563EB', fontSize: '0.90rem' }}>
                          {qNo}
                        </td>

                        {/* 2. Customer Name & Contact */}
                        <td style={{ padding: '16px 20px' }}>
                          <div style={{ fontWeight: 750, color: 'var(--text-main)', fontSize: '0.92rem' }}>{q.customer_name}</div>
                          {q.department && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '3px' }}>{q.department}</div>}
                          {q.job_name && <div style={{ fontSize: '0.76rem', color: '#2563EB', marginTop: '2px', fontWeight: 600 }}>• {q.job_name}</div>}
                        </td>

                        {/* 3. Issue Date */}
                        <td style={{ padding: '16px 18px', color: 'var(--text-main)', fontSize: '0.84rem', fontWeight: 500, fontFamily: "'Inter', monospace" }}>
                          {formatDateThai(q.created_at || q.issue_date)}
                        </td>

                        {/* 4. Valid Date */}
                        <td style={{ padding: '16px 18px', color: 'var(--text-muted)', fontSize: '0.84rem', fontWeight: 500, fontFamily: "'Inter', monospace" }}>
                          {formatDateThai(q.valid_until)}
                        </td>

                        {/* 5. Total Amount */}
                        <td style={{ padding: '16px 20px', textAlign: 'right', fontFamily: "'Inter', monospace", fontWeight: 800, color: 'var(--text-main)', fontSize: '0.94rem' }}>
                          ฿ {Number(q.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* 6. Status Chip */}
                        <td style={{ padding: '16px 16px', textAlign: 'center' }}>
                          <span style={{
                            padding: '5px 14px',
                            borderRadius: '999px',
                            fontSize: '0.76rem',
                            fontWeight: 800,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: q.status === 'accepted' ? 'rgba(16, 185, 129, 0.12)' : q.status === 'sent' ? 'rgba(37, 99, 235, 0.12)' : q.status === 'rejected' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                            color: q.status === 'accepted' ? '#10B981' : q.status === 'sent' ? '#2563EB' : q.status === 'rejected' ? '#EF4444' : '#64748B',
                            border: ('1px solid ' + (q.status === 'accepted' ? 'rgba(16, 185, 129, 0.3)' : q.status === 'sent' ? 'rgba(37, 99, 235, 0.3)' : q.status === 'rejected' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(100, 116, 139, 0.3)'))
                          }}>
                            <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'currentColor' }}></span>
                            <span>{getStatusLabel(q.status || 'draft')}</span>
                          </span>
                        </td>

                        {/* 7. Actions (Clean Single-Row Horizontal Button Group) */}
                        <td style={{ padding: '10px 18px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                            
                            {/* Preview Button */}
                            <button
                              type="button"
                              onClick={() => handlePreviewQuotation(q)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                border: '1px solid rgba(100, 116, 139, 0.2)',
                                backgroundColor: 'var(--bg-main, #FFFFFF)',
                                color: '#475569',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease'
                              }}
                              title="พรีวิวใบเสนอราคา"
                            >
                              <Eye size={14} />
                            </button>

                            {/* Export PDF Button */}
                            <button
                              type="button"
                              disabled={isExportingPDF}
                              onClick={() => handleExportPDF(q)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                border: '1px solid rgba(37, 99, 235, 0.25)',
                                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                                color: '#2563EB',
                                cursor: isExportingPDF ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease'
                              }}
                              title="ส่งออกเอกสารเป็น PDF"
                            >
                              <Download size={14} />
                            </button>

                            {/* Print Button */}
                            <button
                              type="button"
                              onClick={() => handlePrintQuotation(q)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                border: '1px solid rgba(100, 116, 139, 0.2)',
                                backgroundColor: 'var(--bg-main, #FFFFFF)',
                                color: '#334155',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease'
                              }}
                              title="พิมพ์ใบเสนอราคา"
                            >
                              <Printer size={14} />
                            </button>

                            {/* Edit Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditForm(q)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                border: '1px solid rgba(100, 116, 139, 0.2)',
                                backgroundColor: 'var(--bg-main, #FFFFFF)',
                                color: '#334155',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease'
                              }}
                              title="แก้ไขใบเสนอราคา"
                            >
                              <Edit size={14} />
                            </button>

                            {/* Convert to Booking / Open Bill */}
                            <button
                              type="button"
                              onClick={() => handleConvertToBooking(q)}
                              style={{
                                height: '32px',
                                padding: '0 10px',
                                borderRadius: '8px',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                color: '#10B981',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                transition: 'all 0.15s ease'
                              }}
                              title="แปลงเป็นรายการจองและเปิดบิล"
                            >
                              <ArrowRight size={13} />
                              <span>เปิดบิล</span>
                            </button>

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={() => handleDeleteQuotation(q.id)}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                border: '1px solid rgba(239, 68, 68, 0.25)',
                                backgroundColor: 'rgba(239, 68, 68, 0.06)',
                                color: '#EF4444',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.15s ease'
                              }}
                              title="ลบใบเสนอราคา"
                            >
                              <Trash2 size={14} />
                            </button>

                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. PREVIEW MODAL (Clean Preview without Export/Print buttons) */}
      {showPreview && selectedQuotation && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            maxWidth: '920px',
            marginBottom: '12px',
            color: '#FFFFFF'
          }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Eye size={18} className="text-emerald-400" />
              <span>พรีวิวใบเสนอราคา</span>
            </div>
            <div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                style={{ padding: '6px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFFFFF', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
              >
                <span>ปิดหน้าต่าง</span>
              </button>
            </div>
          </div>

          <div style={{ maxHeight: '85vh', overflowY: 'auto', borderRadius: '12px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
            {renderQuotationDocument(selectedQuotation, 'preview')}
          </div>
        </div>
      )}

      {/* 4. OLD CUSTOMER SEARCH MODAL */}
      {isCustomerSearchModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '16px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '540px',
            backgroundColor: '#FFFFFF',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={20} style={{ color: '#0F172A' }} />
                <span>เลือกข้อมูลลูกค้าเดิม (Customer Presets)</span>
              </h3>
              <button 
                type="button" 
                onClick={() => setIsCustomerSearchModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <input 
              type="text" 
              value={customerSearchQuery} 
              onChange={e => setCustomerSearchQuery(e.target.value)} 
              placeholder="พิมพ์ชื่อบริษัท, ชื่อผู้ติดต่อ, หรือเลขผู้เสียภาษี..." 
              style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.82rem', boxSizing: 'border-box' }}
            />

            <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {getPreviousCustomerOptions()
                .filter(c => c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) || (c.contact && c.contact.toLowerCase().includes(customerSearchQuery.toLowerCase())) || (c.taxId && c.taxId.includes(customerSearchQuery)))
                .map((cust, idx) => (
                  <div 
                    key={idx}
                    onClick={() => {
                      setCustomerName(cust.name);
                      setCustomerAddress(cust.address);
                      setContact(cust.contact);
                      setCustomerTaxId(cust.taxId);
                      setCustomerPhone(cust.phone);
                      setIsCustomerSearchModalOpen(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      cursor: 'pointer',
                      backgroundColor: '#F8FAFC',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#EFF6FF'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = '#F8FAFC'}
                  >
                    <div style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.85rem' }}>{cust.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '2px' }}>{cust.address}</div>
                    <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', color: '#475569', marginTop: '4px' }}>
                      <span>เลขผู้เสียภาษี: {cust.taxId || '-'}</span>
                      <span>โทร: {cust.phone || '-'}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Printable Canvas (Rendered cleanly for Browser Print) */}
      <div id="quotation-print-mount-wrapper" className="quotation-print-only-wrapper">
        {renderQuotationDocument(selectedQuotation || getCurrentDraftPayload(), 'print')}
      </div>

      {/* Hidden Staging Canvas for PDF Generation */}
      {pdfExportQuotation && (
        <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', zIndex: -100 }}>
          {renderQuotationDocument(pdfExportQuotation, 'pdf')}
        </div>
      )}

    </div>
  );
}

export default Quotations;
