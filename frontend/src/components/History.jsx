import React, { useState, useEffect } from 'react';
import { Search, Calendar, Eye, DollarSign, Printer, X, Filter, FileText, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle2, Trash2 } from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';
import CustomDatePicker from './CustomDatePicker';

function HistoryLog({ settings, sysAlert, sysConfirm }) {
  const [bookings, setBookings] = useState([]);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    search: ''
  });
  const [loading, setLoading] = useState(false);

  // Selected booking details modal
  const [selectedBooking, setSelectedBooking] = useState(null);
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
    { key: 'customer_name', label: 'ชื่อผู้จอง' },
    { key: 'contact', label: 'เบอร์ติดต่อ' },
    { key: 'total_amount', label: 'ยอดชำระสุทธิ' },
    { key: 'payment_status', label: 'สถานะการชำระ' },
    { key: 'payment_method', label: 'ช่องทางชำระ' },
    { key: 'actions', label: 'จัดการ' }
  ];

  // Fetch bookings list (strictly paid ones)
  useEffect(() => {
    fetchBookings();
  }, [filters.startDate, filters.endDate]); // trigger auto on date change

  // Reset page to 1 when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.startDate, filters.endDate, filters.search]);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const { startDate, endDate, search } = filters;
      let url = `/api/bookings?payment_status=paid&start_date=${startDate}&end_date=${endDate}`;
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

  const handleDeleteBooking = async (id, customerName, receiptNo) => {
    const confirmMessage = `คุณต้องการลบ/ยกเลิกรายการจองของ ${customerName || ''} (${receiptNo || '#' + id}) ใช่หรือไม่?\n\n* ข้อมูลการจองและรายการในบิลนี้จะถูกลบออกจากระบบถาวร`;
    
    if (sysConfirm) {
      const ok = await sysConfirm(confirmMessage);
      if (!ok) return;
    } else if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (sysAlert) sysAlert('ลบรายการจองเรียบร้อยแล้ว');
        if (selectedBooking && selectedBooking.id === id) {
          setShowDetailsModal(false);
          setSelectedBooking(null);
        }
        fetchBookings();
      } else {
        const errData = await res.json();
        if (sysAlert) sysAlert(errData.error || 'เกิดข้อผิดพลาดในการลบรายการจอง');
      }
    } catch (err) {
      console.error('Delete booking error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const formatDate = (dateStr) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }) + ' ' + d.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit'
      }) + ' น.';
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

  // Sorting
  const getSortedBookings = () => {
    const sorted = [...bookings];
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

      {/* Filter and Search Bar Card (Redesigned Compact Layout) */}
      <div className="card" style={{ padding: '12px 18px', position: 'relative', zIndex: 10 }}>
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
            {/* Futuristic Compact Search Input */}
            <div className="futuristic-search-container">
              <Search size={14} style={{ color: 'var(--primary-color)' }} />
              <input 
                type="text" 
                style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-main)', fontSize: '0.8rem', width: '100%' }}
                placeholder="ค้นหาใบเสร็จ / ชื่อผู้จอง..."
                value={filters.search}
                onChange={e => setFilters({ ...filters, search: e.target.value })}
              />
              {filters.search && (
                <button 
                  type="button"
                  onClick={() => setFilters({ ...filters, search: '' })}
                  style={{ 
                    position: 'absolute', 
                    right: '12px', 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'var(--text-muted)', 
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Custom Modern Calendar Date Picker (Pill-shaped) */}
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid var(--border-color)',
              padding: '8px 18px',
              borderRadius: '99px',
              background: 'var(--bg-hover)',
              position: 'relative',
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'all 0.3s ease',
              height: '40px'
            }}>
              <Calendar size={13} style={{ color: 'var(--primary-color)' }} />
              <CustomDatePicker 
                value={filters.startDate}
                onChange={val => setFilters({ ...filters, startDate: val })}
                placeholder="วันเริ่มต้น"
              />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px' }}>ถึง</span>
              <CustomDatePicker 
                value={filters.endDate}
                onChange={val => setFilters({ ...filters, endDate: val })}
                placeholder="วันสิ้นสุด"
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              style={{ 
                padding: '10px 22px', 
                borderRadius: '99px', 
                fontSize: '0.875rem', 
                height: '40px', 
                gap: '6px', 
                display: 'flex', 
                alignItems: 'center', 
                cursor: 'pointer' 
              }}
            >
              <Filter size={14} /> <span>ค้นหา</span>
            </button>
          </div>

          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ 
              padding: '10px 22px', 
              borderRadius: '99px', 
              fontSize: '0.875rem', 
              height: '40px', 
              gap: '6px',
              backgroundColor: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer'
            }}
            onClick={() => setFilters({ startDate: '', endDate: '', search: '' })}
          >
            ล้างตัวกรอง
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
        <div className="table-container">
          <table className="custom-table" style={{ fontSize: '0.85rem' }}>
            <thead>
              <tr>
                {columns.map(col => {
                  const isSortable = col.key !== 'actions';
                  let align = 'left';
                  if (col.key === 'total_amount') align = 'right';
                  else if (col.key === 'payment_status' || col.key === 'payment_method' || col.key === 'actions') align = 'center';

                  const padding = (col.key === 'id' || col.key === 'actions') ? '14px 18px' : '14px 10px';

                  return (
                    <th 
                      key={col.key} 
                      onClick={() => isSortable && handleSort(col.key)}
                      style={{ 
                        textAlign: align,
                        cursor: isSortable ? 'pointer' : 'default',
                        padding: padding,
                        userSelect: 'none'
                      }}
                      className={isSortable ? 'sortable-header' : ''}
                    >
                      <div style={{ 
                        display: 'inline-flex', 
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
                const padding = '14px 10px';
                return (
                  <tr key={b.id}>
                    {columns.map(col => {
                      const key = col.key;
                      const cellPadding = (key === 'id' || key === 'actions') ? '14px 18px' : padding;

                      if (key === 'id') {
                        return (
                          <td key={key} style={{ fontWeight: 'bold', padding: cellPadding }}>
                            {b.receipt_number || `#${String(b.id).padStart(6, '0')}`}
                          </td>
                        );
                      }
                      if (key === 'created_at') {
                        return (
                          <td key={key} style={{ color: 'var(--text-muted)', padding: cellPadding }}>
                            {formatDate(b.created_at)}
                          </td>
                        );
                      }
                      if (key === 'customer_name') {
                        return (
                          <td key={key} style={{ fontWeight: '700', padding: cellPadding }}>
                            {b.customer_name}
                          </td>
                        );
                      }
                      if (key === 'contact') {
                        return (
                          <td key={key} style={{ padding: cellPadding }}>
                            {b.contact || '-'}
                          </td>
                        );
                      }
                      if (key === 'total_amount') {
                        return (
                          <td key={key} style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--primary-color)', padding: cellPadding }}>
                            {b.total_amount.toLocaleString()}.-
                          </td>
                        );
                      }
                      if (key === 'payment_status') {
                        return (
                          <td key={key} style={{ textAlign: 'center', padding: cellPadding }}>
                            <span className="badge badge-success" style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>
                              จ่ายแล้ว
                            </span>
                          </td>
                        );
                      }
                      if (key === 'payment_method') {
                        return (
                          <td key={key} style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', padding: cellPadding }}>
                            {b.payment_method === 'cash' ? 'เงินสด' : b.payment_method === 'transfer' ? 'โอนเงิน' : '-'}
                          </td>
                        );
                      }
                      if (key === 'actions') {
                        return (
                          <td key={key} style={{ textAlign: 'center', padding: cellPadding }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                              <button 
                                className="btn btn-secondary" 
                                style={{ 
                                  padding: '6px 12px', 
                                  fontSize: '0.8rem', 
                                  borderRadius: '8px', 
                                  gap: '4px',
                                  backgroundColor: 'var(--bg-hover)',
                                  border: '1px solid var(--border-color)',
                                  color: 'var(--text-main)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  cursor: 'pointer'
                                }}
                                onClick={() => openBookingDetails(b.id)}
                                title="พิมพ์ใบเสร็จ"
                              >
                                <Printer size={12} /> <span>พิมพ์ใบเสร็จ</span>
                              </button>
                              <button 
                                type="button"
                                className="btn btn-danger" 
                                style={{ 
                                  padding: '6px 10px', 
                                  fontSize: '0.8rem', 
                                  borderRadius: '8px', 
                                  gap: '4px',
                                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  color: 'var(--danger-color)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  cursor: 'pointer'
                                }}
                                onClick={() => handleDeleteBooking(b.id, b.customer_name, b.receipt_number)}
                                title="ลบรายการจองนี้"
                              >
                                <Trash2 size={12} /> <span>ลบ</span>
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
    </div>
  );
}

export default HistoryLog;
