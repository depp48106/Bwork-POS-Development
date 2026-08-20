import React, { useState, useEffect } from 'react';
import { Search, ChevronDown, RotateCcw, Ban, Clock, Calendar, Eye, DollarSign, Printer, X, Filter, FileText, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle2, Trash2 } from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';

function HistoryLog({ settings, sysAlert, sysConfirm }) {
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    search: '',
    searchType: 'all', // 'all', 'receipt', 'customer', 'contact', 'room'
    status: 'all'      // 'all', 'paid', 'cancelled'
  });
  const [loading, setLoading] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isSearchTypeDropdownOpen, setIsSearchTypeDropdownOpen] = useState(false);

  // Selected booking details modal
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [selectedTaxBooking, setSelectedTaxBooking] = useState(null);
  const [taxCopied, setTaxCopied] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  // Sorting state
  const [sortKey, setSortKey] = useState('id');
  const [sortOrder, setSortOrder] = useState('desc'); // default: newest first

  // Static Column Definitions
  const columns = [
    { key: 'id', label: 'เลขที่ใบเสร็จ' },
    { key: 'created_at', label: 'วันที่ทำรายการ' },
    { key: 'booking_source', label: 'ช่องทางการจอง' },
    { key: 'customer_name', label: 'ชื่อผู้จอง' },
    { key: 'contact', label: 'เบอร์ติดต่อ' },
    { key: 'total_amount', label: 'ยอดชำระสุทธิ' },
    { key: 'payment_status', label: 'สถานะการจอง' },
    { key: 'payment_method', label: 'ช่องทางชำระ' },
    { key: 'actions', label: 'จัดการ' }
  ];

  // Fetch bookings list (strictly paid ones)
  useEffect(() => {
    fetchBookings();
  }, [filters.startDate, filters.endDate, filters.status]); // trigger auto on date change

  // Reset page to 1 when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.startDate, filters.endDate, filters.search]);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const { startDate, endDate, search } = filters;
      let url = `/api/bookings?start_date=${startDate}&end_date=${endDate}`;
      if (filters.status && filters.status !== 'all') {
        url += `&payment_status=${filters.status}`;
      }
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setBookings(data);
      }
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchBookings();
  };

  // Open details modal
  const openBookingDetails = async (id) => {
    try {
      const res = await fetch(`/api/bookings/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedBooking(data);
        setShowDetailsModal(true);
      }
    } catch (err) {
      sysAlert('ไม่สามารถโหลดรายละเอียดใบจองนี้ได้');
    }
  };

  const triggerPrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    if (!selectedBooking) return;
    const element = document.getElementById('print-receipt-area');
    if (!element) return;

    if (!window.html2pdf) {
      sysAlert('ระบบพิมพ์ PDF ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง');
      return;
    }

    // Force exact print layout formatting for PDF export
    element.classList.add('pdf-export-mode');

    let estimatedHeight = 85;
    if (selectedBooking.items) {
      selectedBooking.items.forEach(item => {
        estimatedHeight += 11;
      });
    }

    const opt = {
      margin:       [0, 0, 0, 0],
      filename:     `receipt-${selectedBooking.receipt_number || String(selectedBooking.id).padStart(6, '0')}.pdf`,
      image:        { type: 'png' },
      html2canvas:  { scale: 4, useCORS: true },
      jsPDF:        { unit: 'mm', format: [72, 200], orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    window.html2pdf().from(element).set(opt).save().then(() => {
      element.classList.remove('pdf-export-mode');
    }).catch(err => {
      element.classList.remove('pdf-export-mode');
      console.error(err);
    });
  };

  const handleDeleteBooking = async (id, customerName, receiptNo, e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    const confirmMessage = `คุณต้องการลบ/ยกเลิกรายการจองของ ${customerName || ''} (${receiptNo || '#' + id}) ใช่หรือไม่?\n\n* ข้อมูลการจองและรายการในบิลนี้จะถูกลบออกจากระบบถาวร`;
    
    let ok = false;
    if (sysConfirm) {
      ok = await sysConfirm(confirmMessage);
    } else {
      ok = window.confirm(confirmMessage);
    }
    if (!ok) return;

    try {
      let res = null;
      if (id) {
        res = await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      }
      
      if ((!res || !res.ok) && receiptNo) {
        res = await fetch(`/api/bookings/${encodeURIComponent(receiptNo)}`, { method: 'DELETE' });
      }

      if (res && res.ok) {
        if (sysAlert) sysAlert('ลบรายการจองเรียบร้อยแล้ว');
        setBookings(prev => prev.filter(b => String(b.id) !== String(id) && String(b.receipt_number) !== String(receiptNo)));
        if (selectedBooking && (String(selectedBooking.id) === String(id) || selectedBooking.receipt_number === receiptNo)) {
          setShowDetailsModal(false);
          setSelectedBooking(null);
        }
        fetchBookings();
      } else {
        let errMessage = 'เกิดข้อผิดพลาดในการลบรายการจอง';
        if (res) {
          try {
            const errData = await res.json();
            errMessage = errData.error || errMessage;
          } catch(errJson) {}
        }
        if (sysAlert) sysAlert(errMessage);
      }
    } catch (err) {
      console.error('Delete booking error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      let str = String(dateStr).trim();
      if (!str.includes('T') && str.includes(' ')) {
        str = str.replace(' ', 'T');
      }
      if (!str.endsWith('Z') && !/\+\d{2}:?\d{2}$/.test(str)) {
        str = str + 'Z';
      }
      const d = new Date(str);
      if (isNaN(d.getTime())) return dateStr;
      const year = d.getFullYear() + 543;
      const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      const month = monthNames[d.getMonth()];
      const day = d.getDate();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${year} ${hours}:${minutes} น.`;
    } catch (e) {
      return dateStr;
    }
  };

  const handleSort = (key) => {
    if (key === 'actions') return;
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  // Stats calculation
  const totalAmountPaid = bookings.reduce((sum, b) => sum + b.total_amount, 0);
  const paidCount = bookings.length;

  // Filtering by searchType & status on frontend for instant responsiveness
  const filteredBookings = bookings.filter(b => {
    // Status filter
    if (filters.status === 'paid' && b.payment_status !== 'paid') return false;
    if (filters.status === 'cancelled' && b.payment_status !== 'cancelled') return false;

    // Search filter
    if (!filters.search) return true;
    const q = filters.search.toLowerCase().trim();
    const receipt = (b.receipt_number || '#' + b.id).toLowerCase();
    const idStr = String(b.id);
    const customer = (b.customer_name || '').toLowerCase();
    const contact = (b.contact || '').toLowerCase();
    const room = (b.items?.[0]?.room_name || b.room_name || '').toLowerCase();

    if (filters.searchType === 'receipt') {
      return receipt.includes(q) || idStr.includes(q);
    } else if (filters.searchType === 'customer') {
      return customer.includes(q);
    } else if (filters.searchType === 'contact') {
      return contact.includes(q);
    } else if (filters.searchType === 'room') {
      return room.includes(q);
    } else {
      return receipt.includes(q) || idStr.includes(q) || customer.includes(q) || contact.includes(q) || room.includes(q);
    }
  });

  // Sorting
  const getSortedBookings = () => {
    const sorted = [...filteredBookings];
    sorted.sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];
      
      if (sortKey === 'id') {
        valA = Number(a.id);
        valB = Number(b.id);
      } else if (sortKey === 'created_at') {
        valA = new Date(a.created_at).getTime();
        valB = new Date(b.created_at).getTime();
      } else if (sortKey === 'total_amount') {
        valA = Number(a.total_amount);
        valB = Number(b.total_amount);
      } else {
        valA = valA ? String(valA).toLowerCase() : '';
        valB = valB ? String(valB).toLowerCase() : '';
      }
      
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  };

  const sortedBookings = getSortedBookings();

  // Pagination Calculations
  const totalRows = sortedBookings.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage);
  const indexOfLastRow = currentPage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const paginatedBookings = sortedBookings.slice(indexOfFirstRow, indexOfLastRow);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="tab-header">
        <div>
          <h1 className="tab-title">ประวัติการใช้บริการย้อนหลัง (พิมพ์ใบเสร็จ)</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            ค้นหาประวัติธุรกรรมที่บันทึกชำระเงินแล้ว และกดเลือกพิมพ์ใบเสร็จรับเงินย้อนหลัง
          </p>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid-cols-2" style={{ gap: '16px' }}>
        {/* Paid Stats */}
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid rgba(34, 197, 94, 0.15)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(34, 197, 94, 0.03) 100%)' }}>
          <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', color: 'var(--success-color)', width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>ยอดเงินที่ได้รับสะสม (บาท)</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--success-color)', margin: '2px 0' }}>
              ฿{totalAmountPaid.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>จำนวน {paidCount} ใบเสร็จ</div>
          </div>
        </div>

        {/* Total Ledger Stats */}
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid var(--glass-border)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(56, 189, 248, 0.03) 100%)' }}>
          <div style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary-color)', width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileText size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>จำนวนใบเสร็จทั้งหมดในระบบ</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', margin: '2px 0' }}>
              {paidCount} รายการ
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>ประวัติทำรายการสำเร็จเสร็จสิ้น</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar Card (Single Row Layout) */}
      <div className="card" style={{ padding: '12px 16px', position: 'relative', zIndex: 10, borderRadius: '16px' }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          
          {/* 1. Search Category Type Dropdown */}
          <div style={{ position: 'relative', width: '130px', flexShrink: 0 }}>
            <div 
              className="form-control"
              onClick={() => { setIsSearchTypeDropdownOpen(!isSearchTypeDropdownOpen); setIsStatusDropdownOpen(false); }}
              style={{
                height: '38px',
                borderRadius: '10px',
                fontSize: '0.82rem',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontWeight: 700,
                color: 'var(--text-main)'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {filters.searchType === 'receipt' ? 'เลขที่ใบเสร็จ' :
                 filters.searchType === 'customer' ? 'ชื่อผู้จอง' :
                 filters.searchType === 'contact' ? 'เบอร์ติดต่อ' :
                 filters.searchType === 'room' ? 'ห้องประชุม' : 'ค้นหาทั้งหมด'}
              </span>
              <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </div>

            {isSearchTypeDropdownOpen && (
              <>
                <div onClick={() => setIsSearchTypeDropdownOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                <div className="action-dropdown-menu" style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  width: '150px',
                  zIndex: 2000,
                  borderRadius: '12px',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}>
                  {[
                    { id: 'all', label: 'ค้นหาทั้งหมด' },
                    { id: 'receipt', label: 'เลขที่ใบเสร็จ' },
                    { id: 'customer', label: 'ชื่อผู้จอง' },
                    { id: 'contact', label: 'เบอร์ติดต่อ' },
                    { id: 'room', label: 'ห้องประชุม' }
                  ].map(item => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setFilters(prev => ({ ...prev, searchType: item.id }));
                        setIsSearchTypeDropdownOpen(false);
                      }}
                      style={{
                        padding: '7px 10px',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: (filters.searchType || 'all') === item.id ? 800 : 500,
                        color: (filters.searchType || 'all') === item.id ? 'var(--primary-color)' : 'var(--text-main)',
                        cursor: 'pointer',
                        background: (filters.searchType || 'all') === item.id ? 'var(--bg-hover)' : 'transparent',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = (filters.searchType || 'all') === item.id ? 'var(--bg-hover)' : 'transparent'}
                    >
                      {item.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 2. Search Input */}
          <div style={{
            position: 'relative',
            flex: '1 1 180px',
            minWidth: '160px',
            display: 'flex',
            alignItems: 'center'
          }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              className="form-control"
              style={{
                width: '100%',
                paddingLeft: '34px',
                paddingRight: filters.search ? '30px' : '10px',
                height: '38px',
                borderRadius: '10px',
                fontSize: '0.82rem',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)'
              }}
              placeholder={
                filters.searchType === 'receipt' ? 'พิมพ์เลขที่ใบเสร็จ...' :
                filters.searchType === 'customer' ? 'พิมพ์ชื่อผู้จอง...' :
                filters.searchType === 'contact' ? 'พิมพ์เบอร์ติดต่อ...' :
                filters.searchType === 'room' ? 'พิมพ์ชื่อห้องประชุม...' :
                'พิมพ์คำค้นหา...'
              }
              value={filters.search}
              onChange={e => setFilters({ ...filters, search: e.target.value })}
            />
            {filters.search && (
              <button 
                type="button"
                onClick={() => setFilters({ ...filters, search: '' })}
                style={{ 
                  position: 'absolute', 
                  right: '8px', 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-muted)', 
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* 3. Status Dropdown */}
          <div style={{ position: 'relative', width: '125px', flexShrink: 0 }}>
            <div 
              className="form-control"
              onClick={() => { setIsStatusDropdownOpen(!isStatusDropdownOpen); setIsSearchTypeDropdownOpen(false); }}
              style={{
                height: '38px',
                borderRadius: '10px',
                fontSize: '0.82rem',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontWeight: 700,
                color: filters.status === 'paid' ? '#10b981' : filters.status === 'cancelled' ? '#ef4444' : 'var(--text-main)'
              }}
            >
              <span>
                {filters.status === 'paid' ? 'สำเร็จ' : filters.status === 'cancelled' ? 'ยกเลิก' : 'สถานะทั้งหมด'}
              </span>
              <ChevronDown size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            </div>

            {isStatusDropdownOpen && (
              <>
                <div onClick={() => setIsStatusDropdownOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                <div className="action-dropdown-menu" style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  width: '100%',
                  zIndex: 2000,
                  borderRadius: '12px',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}>
                  {[
                    { id: 'all', label: 'สถานะทั้งหมด', color: 'var(--text-main)' },
                    { id: 'paid', label: 'สำเร็จ', color: '#10b981' },
                    { id: 'cancelled', label: 'ยกเลิก', color: '#ef4444' }
                  ].map(item => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setFilters(prev => ({ ...prev, status: item.id }));
                        setIsStatusDropdownOpen(false);
                      }}
                      style={{
                        padding: '7px 10px',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: (filters.status || 'all') === item.id ? 800 : 500,
                        color: item.color,
                        cursor: 'pointer',
                        background: (filters.status || 'all') === item.id ? 'var(--bg-hover)' : 'transparent',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = (filters.status || 'all') === item.id ? 'var(--bg-hover)' : 'transparent'}
                    >
                      {item.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 4. Date Range: 2 Separate Clean Input Boxes */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <div style={{ width: '135px' }}>
              <CustomDatePicker 
                value={filters.startDate}
                onChange={val => setFilters({ ...filters, startDate: val })}
                placeholder="วันเริ่มต้น"
                className="form-control"
                style={{
                  height: '38px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
              />
            </div>
            
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>-</span>

            <div style={{ width: '135px' }}>
              <CustomDatePicker 
                value={filters.endDate}
                onChange={val => setFilters({ ...filters, endDate: val })}
                placeholder="วันสิ้นสุด"
                className="form-control"
                style={{
                  height: '38px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>

          {/* 5. Action Buttons: Search & Clear (Compact) */}
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ 
              padding: '0 14px', 
              borderRadius: '10px', 
              fontSize: '0.82rem', 
              fontWeight: 700,
              height: '38px', 
              gap: '5px', 
              display: 'inline-flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
              flexShrink: 0
            }}
          >
            <Search size={13} />
            <span>ค้นหา</span>
          </button>

          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ 
              padding: '0 12px', 
              borderRadius: '10px', 
              fontSize: '0.82rem', 
              fontWeight: 600,
              height: '38px', 
              gap: '4px',
              backgroundColor: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
            onClick={() => setFilters({ startDate: '', endDate: '', search: '', searchType: 'all', status: 'all' })}
            title="ล้างค่าตัวกรองทั้งหมด"
          >
            <RotateCcw size={12} />
            <span>ล้างค่า</span>
          </button>

        </form>
      </div>

      {/* Bookings List Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังโหลดประวัติ...</span>
        </div>
      ) : totalRows === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center', border: '1px solid var(--glass-border)', borderRadius: '24px' }}>
          <FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>ไม่พบบันทึกประวัติ</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '6px' }}>กรุณาลองปรับการเลือกช่วงวันที่หรือคำค้นหา</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--glass-border)', borderRadius: '24px' }}>
          <div className="table-container">
            <table className="custom-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255, 255, 255, 0.02)' }}>
                  {columns.map(col => {
                    const isSortable = col.key !== 'actions';
                    let align = 'left';
                    if (col.key === 'total_amount') align = 'right';
                    else if (col.key === 'booking_source' || col.key === 'payment_status' || col.key === 'payment_method' || col.key === 'actions') align = 'center';

                    const padding = (col.key === 'id' || col.key === 'actions') ? '14px 16px' : '14px 12px';

                    return (
                      <th 
                        key={col.key} 
                        onClick={() => isSortable && handleSort(col.key)}
                        style={{ 
                          textAlign: align,
                          cursor: isSortable ? 'pointer' : 'default',
                          padding: padding,
                          userSelect: 'none',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                          verticalAlign: 'middle',
                          whiteSpace: 'nowrap'
                        }}
                        className={isSortable ? 'sortable-header' : ''}
                      >
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '6px',
                          justifyContent: align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start'),
                          width: '100%'
                        }}>
                          <span>{col.label}</span>
                          {isSortable && (
                            <span style={{ display: 'inline-flex', opacity: sortKey === col.key ? 1 : 0.3 }}>
                              {sortKey === col.key ? (
                                sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                              ) : (
                                <ArrowUpDown size={12} />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paginatedBookings.map((b) => {
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.15s' }}>
                      {columns.map(col => {
                        const key = col.key;
                        const cellPadding = (key === 'id' || key === 'actions') ? '14px 16px' : '14px 12px';

                        if (key === 'id') {
                          return (
                            <td key={key} style={{ fontWeight: 800, color: 'var(--primary-color)', padding: cellPadding, whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: '0.88rem' }}>
                              {b.receipt_number || `#${String(b.id).padStart(6, '0')}`}
                            </td>
                          );
                        }
                        if (key === 'created_at') {
                          return (
                            <td key={key} style={{ color: 'var(--text-muted)', padding: cellPadding, fontSize: '0.82rem', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                              {formatDate(b.created_at)}
                            </td>
                          );
                        }
                        if (key === 'booking_source') {
                          const isOnline = b.booking_source === 'online';
                          return (
                            <td key={key} style={{ textAlign: 'center', padding: cellPadding, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '4px 10px',
                                borderRadius: '99px',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                backgroundColor: isOnline ? 'rgba(14, 165, 233, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                color: isOnline ? '#0ea5e9' : '#10b981',
                                border: `1px solid ${isOnline ? 'rgba(14, 165, 233, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                              }}>
                                {isOnline ? '🌐 จองออนไลน์' : '🏬 Walk-in'}
                              </span>
                            </td>
                          );
                        }
                        if (key === 'customer_name') {
                          return (
                            <td key={key} style={{ padding: cellPadding, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                              <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.88rem' }}>{b.customer_name || '-'}</div>
                              {b.tax_invoice_required === 1 && (
                                <div style={{ marginTop: '3px' }}>
                                  <span 
                                    onClick={(e) => { e.stopPropagation(); setSelectedTaxBooking(b); }}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      padding: '2px 7px',
                                      borderRadius: '6px',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                      color: '#2563eb',
                                      border: '1px solid rgba(59, 130, 246, 0.25)',
                                      cursor: 'pointer'
                                    }}
                                    title="คลิกดูข้อมูลใบกำกับภาษี"
                                  >
                                    <FileText size={11} />
                                    <span>ขอใบกำกับภาษี</span>
                                  </span>
                                </div>
                              )}
                            </td>
                          );
                        }
                        if (key === 'contact') {
                          return (
                            <td key={key} style={{ padding: cellPadding, whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '0.82rem', verticalAlign: 'middle' }}>
                              {b.contact || '-'}
                            </td>
                          );
                        }
                        if (key === 'total_amount') {
                          return (
                            <td key={key} style={{ textAlign: 'right', fontWeight: 800, color: 'var(--primary-color)', padding: cellPadding, whiteSpace: 'nowrap', fontSize: '0.92rem', verticalAlign: 'middle' }}>
                              ฿{Number(b.total_amount || 0).toLocaleString()}
                            </td>
                          );
                        }
                        if (key === 'payment_status') {
                          const isCancelled = b.payment_status === 'cancelled';

                          return (
                            <td key={key} style={{ textAlign: 'center', padding: cellPadding, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                              {isCancelled ? (
                                <span style={{ 
                                  padding: '4px 12px', 
                                  borderRadius: '999px', 
                                  fontSize: '0.75rem', 
                                  fontWeight: 800, 
                                  backgroundColor: 'rgba(239, 68, 68, 0.15)', 
                                  color: '#ef4444',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <Ban size={12} />
                                  <span>ยกเลิก</span>
                                </span>
                              ) : (
                                <span style={{ 
                                  padding: '4px 12px', 
                                  borderRadius: '999px', 
                                  fontSize: '0.75rem', 
                                  fontWeight: 800, 
                                  backgroundColor: 'rgba(16, 185, 129, 0.15)', 
                                  color: '#10b981',
                                  border: '1px solid rgba(16, 185, 129, 0.3)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}>
                                  <CheckCircle2 size={12} />
                                  <span>สำเร็จ</span>
                                </span>
                              )}
                            </td>
                          );
                        }
                        if (key === 'payment_method') {
                          return (
                            <td key={key} style={{ textAlign: 'center', padding: cellPadding, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                backgroundColor: 'var(--bg-hover)',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-muted)'
                              }}>
                                {b.payment_method === 'cash' ? '💵 เงินสด' : b.payment_method === 'transfer' ? '📱 โอนเงิน' : (b.payment_method || '-')}
                              </span>
                            </td>
                          );
                        }
                        if (key === 'actions') {
                          return (
                            <td key={key} style={{ textAlign: 'center', padding: cellPadding, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                              <div style={{ display: 'inline-flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                                <button 
                                  className="btn-modern-receipt"
                                  style={{ 
                                    padding: '6px 12px', 
                                    fontSize: '0.8rem', 
                                    borderRadius: '8px', 
                                    gap: '5px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  onClick={() => openBookingDetails(b.id)}
                                  title="ดูรายละเอียดใบจอง / ใบเสร็จ"
                                >
                                  <Printer size={13} />
                                  <span>ใบเสร็จ</span>
                                </button>
                                <button 
                                  className="btn btn-danger" 
                                  style={{ 
                                    padding: '6px 12px', 
                                    fontSize: '0.8rem', 
                                    borderRadius: '8px', 
                                    gap: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    fontWeight: 600
                                  }}
                                  onClick={() => handleDeleteBooking(b.id)}
                                  title="ลบรายการจองนี้"
                                >
                                  <Trash2 size={13} />
                                  <span>ลบ</span>
                                </button>
                              </div>
                            </td>
                          );
                        }
                        return null;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '12px 18px', 
              borderTop: '1px solid var(--border-color)',
              backgroundColor: 'rgba(0,0,0,0.01)',
              borderBottomLeftRadius: '20px',
              borderBottomRightRadius: '20px'
            }} className="no-print">
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                แสดง {indexOfFirstRow + 1} - {Math.min(indexOfLastRow, totalRows)} จากทั้งหมด {totalRows} รายการ
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button 
                  className="btn-pagination" 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                >
                  ก่อนหน้า
                </button>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, padding: '0 8px', color: 'var(--text-main)' }}>
                  หน้า {currentPage} / {totalPages}
                </span>
                <button 
                  className="btn-pagination" 
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Booking Details and Print Modal Overlay (Redesigned Split Studio Preview) */}
      {showDetailsModal && selectedBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(24px) saturate(200%)',
          WebkitBackdropFilter: 'blur(24px) saturate(200%)',
          display: 'flex',
          zIndex: 9999,
          overflowY: 'auto',
          padding: '24px'
        }} className="print-modal-overlay">
          <div className="history-modal-container" style={{
            display: 'flex',
            maxWidth: '920px',
            width: '100%',
            backgroundColor: 'var(--bg-card)',
            margin: 'auto',
            borderRadius: '28px',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            animation: 'fadeIn 0.25s ease-out'
          }}>
            {/* Left side detail control and updates */}
            <div style={{ flex: 1.1, padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }} className="no-print">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>ประวัติการทำรายการ</div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 850, margin: 0, color: 'var(--text-main)' }}>
                    ใบเสร็จรับเงิน {selectedBooking.receipt_number || `#${String(selectedBooking.id).padStart(6, '0')}`}
                  </h2>
                </div>
                <button 
                  type="button"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                  onClick={() => setShowDetailsModal(false)}
                  title="ปิดหน้าต่าง"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Status Display */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px', 
                color: 'var(--success-color)', 
                fontWeight: '700', 
                fontSize: '0.875rem', 
                backgroundColor: 'var(--success-bg)', 
                padding: '14px 18px', 
                borderRadius: '16px', 
                border: '1px solid rgba(34, 197, 94, 0.2)' 
              }}>
                <CheckCircle2 size={20} /> 
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span>ชำระเงินเสร็จสิ้นแล้ว</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>
                    ช่องทางชำระ: {selectedBooking.payment_method === 'cash' ? 'เงินสด (Cash)' : 'โอนเงินเข้าบัญชี (Transfer)'}
                  </span>
                </div>
              </div>

              {/* Summary breakdown card */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'var(--bg-hover)', padding: '16px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>ลูกค้า:</span>
                  <strong style={{ color: 'var(--text-main)' }}>{selectedBooking.customer_name}</strong>
                </div>
                {selectedBooking.contact && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>เบอร์ติดต่อ:</span>
                    <strong style={{ color: 'var(--text-main)' }}>{selectedBooking.contact}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>ยอดรวมสุทธิ:</span>
                  <strong style={{ color: 'var(--primary-color)', fontSize: '1rem', fontWeight: 800 }}>
                    {Number(selectedBooking.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
                  </strong>
                </div>
              </div>

              {/* Booking Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', padding: '12px', gap: '8px', borderRadius: '14px', backgroundColor: '#e2e8f0', color: '#1e293b', fontWeight: 'bold' }}
                  onClick={handleDownloadPDF}
                >
                  <FileText size={18} /> บันทึกสลิปเป็นไฟล์ PDF
                </button>
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', padding: '12px', gap: '8px', borderRadius: '14px', fontWeight: 800 }}
                  onClick={triggerPrint}
                >
                  <Printer size={18} /> พิมพ์ใบเสร็จออกเครื่องพิมพ์
                </button>
                <button 
                  type="button"
                  className="btn btn-danger" 
                  style={{ width: '100%', padding: '10px', gap: '8px', borderRadius: '14px', backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger-color)', cursor: 'pointer', fontWeight: 'bold' }}
                  onClick={() => handleDeleteBooking(selectedBooking.id, selectedBooking.customer_name, selectedBooking.receipt_number)}
                >
                  <Trash2 size={16} /> ลบรายการจองนี้ถาวร
                </button>
              </div>
            </div>

            {/* Right side live print preview receipt layout */}
            <div className="history-receipt-column" style={{ 
              width: '420px', 
              backgroundColor: 'rgba(15, 23, 42, 0.85)', 
              padding: '32px 24px', 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center',
              borderLeft: '1px solid var(--border-color)',
              position: 'relative' 
            }}>
              <div className="no-print" style={{ 
                fontSize: '0.75rem', 
                color: 'rgba(255, 255, 255, 0.65)', 
                fontWeight: 700, 
                marginBottom: '14px', 
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <Eye size={14} /> ตัวอย่างสลิปใบเสร็จรับเงิน (Thermal Slip Preview)
              </div>
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '18px',
                padding: '18px',
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15)',
                width: '100%',
                maxWidth: '375px',
                display: 'flex',
                justify: 'center'
              }}>
                <ReceiptPrint booking={selectedBooking} settings={settings} />
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* TAX INVOICE DETAILS & PRINT MODAL */}
      {selectedTaxBooking && (() => {
        const total = Number(selectedTaxBooking.total_amount || 0);
        const subtotalBeforeVat = (total / 1.07);
        const vatAmount = total - subtotalBeforeVat;
        const firstItem = selectedTaxBooking.items?.[0] || {};
        const roomName = firstItem.room_name || selectedTaxBooking.room_name || 'ห้องประชุม';

        const handleCopyAllTaxFields = () => {
          let lines = [];
          if (selectedTaxBooking.tax_name) lines.push(`ชื่อผู้เสียภาษี: ${selectedTaxBooking.tax_name}`);
          if (selectedTaxBooking.tax_id) lines.push(`เลขประจำตัวผู้เสียภาษี: ${selectedTaxBooking.tax_id}`);
          if (selectedTaxBooking.tax_address) lines.push(`ที่อยู่: ${selectedTaxBooking.tax_address}`);
          if (selectedTaxBooking.tax_phone || selectedTaxBooking.contact) lines.push(`เบอร์โทรศัพท์: ${selectedTaxBooking.tax_phone || selectedTaxBooking.contact}`);
          
          const deliveryText = selectedTaxBooking.tax_delivery_method === 'postal' 
            ? `จัดส่งทางไปรษณีย์ / จดหมาย (ที่อยู่จัดส่ง: ${selectedTaxBooking.tax_postal_address || selectedTaxBooking.tax_address || '-'})` 
            : (selectedTaxBooking.tax_delivery_method === 'pickup' ? 'รับด้วยตนเองที่หน้าร้าน' : 'จัดส่งทางอีเมล (e-Tax)');
          lines.push(`ช่องทางการจัดส่ง: ${deliveryText}`);

          const fullText = lines.join('\n');
          navigator.clipboard.writeText(fullText);
          setTaxCopied(true);
          setTimeout(() => setTaxCopied(false), 2500);
          if (sysAlert) {
            sysAlert('คัดลอกข้อมูลใบกำกับภาษีเรียบร้อยแล้ว');
          }
        };

        return (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px'
          }}>
            <div className="card" style={{
              width: '100%',
              maxWidth: '560px',
              padding: '24px',
              borderRadius: '20px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative',
              maxHeight: '92vh',
              overflowY: 'auto'
            }}>
              <button 
                style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                onClick={() => { setSelectedTaxBooking(null); setTaxCopied(false); }}
              >
                <X size={20} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '46px', height: '46px', borderRadius: '14px', backgroundColor: 'rgba(37, 99, 235, 0.15)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FileText size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 850, margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>ข้อมูลใบกำกับภาษี</span>
                    <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(37, 99, 235, 0.15)', color: '#2563eb', fontWeight: 800 }}>Tax Invoice</span>
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ใบจอง <strong>{selectedTaxBooking.receipt_number || ('#' + selectedTaxBooking.id)}</strong> · ผู้จอง: <strong style={{ color: 'var(--text-main)' }}>{selectedTaxBooking.customer_name || '-'}</strong>
                  </span>
                </div>
              </div>

              {/* Tax Payer Info Box */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                <div style={{ padding: '14px 16px', borderRadius: '14px', backgroundColor: 'var(--bg-hover)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>ชื่อบุคคล / นิติบุคคล (ตาม ภ.พ.20):</span>
                    <div style={{ fontWeight: 850, color: 'var(--text-main)', fontSize: '1rem', marginTop: '2px' }}>
                      {selectedTaxBooking.tax_name || '-'}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '10px' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>เลขประจำตัวผู้เสียภาษี (13 หลัก):</span>
                      <div style={{ fontWeight: 900, color: 'var(--primary-color)', letterSpacing: '1.2px', marginTop: '2px', fontSize: '0.95rem' }}>
                        {selectedTaxBooking.tax_id || '-'}
                      </div>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>เบอร์โทรศัพท์:</span>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                        {selectedTaxBooking.tax_phone || selectedTaxBooking.contact || '-'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>ที่อยู่สำหรับออกใบกำกับภาษี:</span>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.45 }}>
                      {selectedTaxBooking.tax_address || '-'}
                    </div>
                  </div>
                </div>

                {/* Delivery details box */}
                <div style={{ padding: '12px 16px', borderRadius: '14px', backgroundColor: 'rgba(59, 130, 246, 0.06)', border: '1px solid rgba(59, 130, 246, 0.25)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: '#2563eb', fontWeight: 800 }}>ช่องทางการจัดส่งเอกสาร:</span>
                    <span style={{ fontWeight: 800, color: 'var(--text-main)', backgroundColor: 'rgba(255,255,255,0.8)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                      {selectedTaxBooking.tax_delivery_method === 'postal' ? '📮 จัดส่งทางไปรษณีย์ / จดหมาย' : (selectedTaxBooking.tax_delivery_method === 'pickup' ? '🏢 รับด้วยตนเองที่หน้าร้าน' : '✉️ อีเมล / e-Tax')}
                    </span>
                  </div>

                  {selectedTaxBooking.tax_delivery_method === 'postal' && (
                    <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px dashed rgba(59, 130, 246, 0.25)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 700 }}>ที่อยู่จัดส่งเอกสารทางไปรษณีย์:</span>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.4 }}>
                        {selectedTaxBooking.tax_postal_address || selectedTaxBooking.tax_address || '-'}
                      </div>
                    </div>
                  )}
                </div>


              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1.1,
                    height: '44px',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    backgroundColor: taxCopied ? '#10b981' : 'var(--bg-hover)',
                    color: taxCopied ? '#ffffff' : 'var(--text-main)',
                    border: taxCopied ? '1.5px solid #10b981' : '1px solid var(--border-color)',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    cursor: 'pointer'
                  }}
                  onClick={handleCopyAllTaxFields}
                >
                  {taxCopied ? (
                    <>
                      <CheckCircle2 size={16} />
                      <span>คัดลอกเรียบร้อยแล้ว!</span>
                    </>
                  ) : (
                    <>
                      <FileText size={16} />
                      <span>คัดลอกข้อมูลใบกำกับ</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1.2, height: '44px', borderRadius: '12px', fontWeight: 800, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  onClick={() => {
                    openBookingDetails(selectedTaxBooking.id);
                    setSelectedTaxBooking(null);
                    setTaxCopied(false);
                  }}
                >
                  <Printer size={16} />
                  <span>ดูใบเสร็จ / พิมพ์</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  onClick={() => { setSelectedTaxBooking(null); setTaxCopied(false); }}
                  title="ปิดหน้าต่าง"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default HistoryLog;
