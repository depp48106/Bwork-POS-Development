import React, { useState, useEffect } from 'react';
import { Clock, DollarSign, User, Calendar, CheckCircle2, AlertCircle, Trash2, Printer, X, Search, Eye, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, Filter } from 'lucide-react';
import ReceiptPrint from './ReceiptPrint';

function PendingBookings({ settings, sysAlert, sysConfirm }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selection and payment states
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 20;

  // Sorting state
  const [sortKey, setSortKey] = useState('id');
  const [sortOrder, setSortOrder] = useState('desc'); // default: newest first

  // Static Column Definitions
  const columns = [
    { key: 'id', label: 'เลขที่ใบจอง' },
    { key: 'created_at', label: 'วันที่ทำรายการ' },
    { key: 'customer_name', label: 'ชื่อผู้จอง' },
    { key: 'contact', label: 'เบอร์ติดต่อ' },
    { key: 'total_amount', label: 'ยอดชำระสุทธิ' },
    { key: 'payment_status', label: 'สถานะการชำระ' },
    { key: 'payment_method', label: 'ช่องทางชำระ' },
    { key: 'actions', label: 'จัดการ' }
  ];

  useEffect(() => {
    fetchBookings();
  }, []);

  // Reset page to 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings?payment_status=pending');
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

  const handleOpenPayment = (booking) => {
    setSelectedBooking(booking);
    setPayMethod('cash');
    setShowPayModal(true);
  };

  const handleOpenReceipt = (booking) => {
    setSelectedBooking(booking);
    setShowReceiptModal(true);
  };

  const submitPayment = async () => {
    if (!selectedBooking) return;
    try {
      const res = await fetch(`/api/bookings/${selectedBooking.id}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'paid', payment_method: payMethod })
      });
      
      if (res.ok) {
        const detailRes = await fetch(`/api/bookings/${selectedBooking.id}`);
        if (detailRes.ok) {
          const detailData = await detailRes.json();
          setSelectedBooking(detailData);
          setShowPayModal(false);
          setShowReceiptModal(true);
          await sysAlert('อัปเดตรายการชำระเงินสำเร็จเรียบร้อยแล้ว!');
          fetchBookings();
        }
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการทำรายการชำระเงิน');
    }
  };

  const cancelBooking = async (id) => {
    if (!await sysConfirm('คุณต้องการยกเลิกและลบประวัติการจองรายการนี้จริงหรือไม่? ข้อมูลจะไม่สามารถกู้คืนได้')) {
      return;
    }
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await sysAlert('ยกเลิกและลบใบจองสำเร็จ');
        fetchBookings();
      }
    } catch (err) {
      console.error(err);
      sysAlert('เกิดข้อผิดพลาดในการลบรายการ');
    }
  };

  const formatDate = (dateStr) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
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
  const totalAmountPending = bookings.reduce((sum, b) => sum + b.total_amount, 0);
  const pendingCount = bookings.length;

  // Filtering
  const filteredBookings = bookings.filter(b => {
    const searchLower = searchQuery.toLowerCase();
    return (
      String(b.id).includes(searchLower) ||
      (b.customer_name && b.customer_name.toLowerCase().includes(searchLower)) ||
      (b.contact && b.contact.includes(searchLower))
    );
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
      {/* Header Panel */}
      <div className="tab-header">
        <div>
          <h1 className="tab-title">รายการสถานะชำระเงิน (บิลค้างชำระ)</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            รายการธุรกรรมที่ค้างชำระเงินในระบบทั้งหมด ท่านสามารถเลือกทำรายการชำระเงินหรือยกเลิกรายการได้จากที่นี่
          </p>
        </div>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid-cols-2" style={{ gap: '16px' }}>
        {/* Pending Stats */}
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid rgba(245, 158, 11, 0.15)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(245, 158, 11, 0.03) 100%)' }}>
          <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>ค้างชำระเงินคงคลัง (ยอดรวม)</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b', margin: '2px 0' }}>
              ฿{totalAmountPending.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>จำนวน {pendingCount} รายการ</div>
          </div>
        </div>

        {/* Total Ledger Stats */}
        <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', border: '1px solid var(--glass-border)', background: 'linear-gradient(135deg, var(--bg-card) 0%, rgba(56, 189, 248, 0.03) 100%)' }}>
          <div style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary-color)', width: '48px', height: '48px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock size={24} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>รายการค้างชำระทั้งหมด</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main)', margin: '2px 0' }}>
              {pendingCount} รายการ
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>รอการบันทึกชำระเงินหรือยกเลิก</div>
          </div>
        </div>
      </div>

      {/* Control Filters Bar */}
      <div className="card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', position: 'relative', zIndex: 10 }}>
        
        {/* Compact Search Box */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', width: '100%' }}>
          {/* Search Bar */}
          <div className="futuristic-search-container">
            <Search size={14} style={{ color: 'var(--primary-color)' }} />
            <input 
              type="text" 
              style={{ 
                border: 'none', 
                background: 'transparent', 
                outline: 'none', 
                color: 'var(--text-main)', 
                fontSize: '0.8rem', 
                width: '100%',
                paddingRight: searchQuery ? '20px' : '0px'
              }}
              placeholder="ค้นหาใบจอง / ชื่อลูกค้า / เบอร์โทร..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
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

          <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
             คลิกหัวตารางเพื่อจัดเรียงข้อมูลตามต้องการ
          </div>
        </div>
      </div>

      {/* Main Table View */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังโหลดบัญชีประวัติ...</span>
        </div>
      ) : totalRows === 0 ? (
        <div className="card" style={{ padding: '60px', textAlign: 'center', border: '1px solid var(--glass-border)', borderRadius: '24px' }}>
          <Clock size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>ไม่พบบันทึกตรงตามเงื่อนไข</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '6px' }}>กรุณาลองล้างคำค้นหาหรือตัวกรองสถานะเพิ่มเติม</p>
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
                  if (col.key === 'payment_status' || col.key === 'payment_method' || col.key === 'actions') align = 'center';
                  
                  const padding = col.key === 'id' || col.key === 'actions' ? '14px 18px' : undefined;
                  
                  return (
                    <th 
                      key={col.key} 
                      style={{ 
                        textAlign: align,
                        cursor: isSortable ? 'pointer' : 'default',
                        userSelect: 'none',
                        padding: padding
                      }}
                      className={isSortable ? 'sortable-header' : ''}
                      onClick={() => handleSort(col.key)}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
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
              {paginatedBookings.map(b => (
                <tr key={b.id}>
                  {columns.map(col => {
                    const key = col.key;
                    
                    let align = 'left';
                    if (key === 'total_amount') align = 'right';
                    if (key === 'payment_status' || key === 'payment_method' || key === 'actions') align = 'center';

                    const padding = key === 'id' || key === 'actions' ? '14px 18px' : undefined;

                    if (key === 'id') {
                      return (
                        <td key={key} style={{ fontWeight: 'bold', padding: padding }}>
                          #{String(b.id).padStart(6, '0')}
                        </td>
                      );
                    }
                    if (key === 'created_at') {
                      return (
                        <td key={key} style={{ color: 'var(--text-muted)', padding: padding }}>
                          {formatDate(b.created_at)}
                        </td>
                      );
                    }
                    if (key === 'customer_name') {
                      return (
                        <td key={key} style={{ fontWeight: '700', padding: padding }}>
                          {b.customer_name}
                        </td>
                      );
                    }
                    if (key === 'contact') {
                      return (
                        <td key={key} style={{ padding: padding }}>
                          {b.contact || '-'}
                        </td>
                      );
                    }
                    if (key === 'total_amount') {
                      return (
                        <td key={key} style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--primary-color)', padding: padding }}>
                          {b.total_amount.toLocaleString()}.-
                        </td>
                      );
                    }
                    if (key === 'payment_status') {
                      return (
                        <td key={key} style={{ textAlign: 'center', padding: padding }}>
                          <span className={`badge ${b.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`} style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>
                            {b.payment_status === 'paid' ? 'จ่ายแล้ว' : 'ค้างชำระ'}
                          </span>
                        </td>
                      );
                    }
                    if (key === 'payment_method') {
                      return (
                        <td key={key} style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', padding: padding }}>
                          {b.payment_status === 'paid' ? (b.payment_method === 'cash' ? 'เงินสด' : b.payment_method === 'transfer' ? 'โอนเงิน' : '-') : '-'}
                        </td>
                      );
                    }
                    if (key === 'actions') {
                      return (
                        <td key={key} style={{ textAlign: 'center', padding: padding }}>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                            {b.payment_status === 'pending' ? (
                              <>
                                <button 
                                  className="btn-modern-pay"
                                  onClick={() => handleOpenPayment(b)}
                                >
                                  <DollarSign size={12} />
                                  <span>ชำระเงิน</span>
                                </button>
                                <button 
                                  className="btn-modern-trash"
                                  onClick={() => cancelBooking(b.id)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </>
                            ) : (
                              <button 
                                className="btn-modern-receipt"
                                onClick={() => handleOpenReceipt(b)}
                              >
                                <Printer size={12} />
                                <span>ดูใบเสร็จ</span>
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }
                    return null;
                  })}
                </tr>
              ))}
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

      {/* ========================================================= */}
      {/*  SELECT PAYMENT METHOD MODAL                             */}
      {/* ========================================================= */}
      {showPayModal && selectedBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '100%',
            maxWidth: '380px',
            padding: '28px',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 24px 70px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <button 
              style={{ position: 'absolute', right: '16px', top: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setShowPayModal(false)}
            >
              <X size={18} />
            </button>

            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}> ทำรายการรับชำระเงิน</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              ชำระบิลสำหรับคุณ <strong>{selectedBooking.customer_name}</strong> ยอดเงินสุทธิ <strong>{selectedBooking.total_amount.toLocaleString()} บาท</strong>
            </p>

            <div className="form-group" style={{ marginTop: '8px' }}>
              <label>ช่องทางการชำระเงิน</label>
              <select 
                className="form-control" 
                value={payMethod} 
                onChange={e => setPayMethod(e.target.value)}
              >
                <option value="cash">เงินสด (Cash)</option>
                <option value="transfer">โอนเงินเข้าบัญชี</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPayModal(false)}>ยกเลิก</button>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={submitPayment}>ยืนยันชำระเงิน</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/*  PRINTABLE RECEIPT MODAL OVERLAY                        */}
      {/* ========================================================= */}
      {showReceiptModal && selectedBooking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          overflowY: 'auto',
          padding: '20px'
        }} className="print-modal-overlay">
          <div style={{ backgroundColor: 'var(--bg-card)', padding: '16px', borderRadius: 'var(--border-radius)', marginBottom: '16px', display: 'flex', gap: '8px', width: '100%', maxWidth: '380px', flexWrap: 'wrap' }} className="no-print">
            <button className="btn btn-secondary" style={{ flex: '1 1 120px', fontSize: '0.85rem', padding: '10px 12px' }} onClick={() => setShowReceiptModal(false)}>ปิดหน้าต่าง</button>
            <button className="btn btn-primary" style={{ flex: '2 1 160px', fontSize: '0.85rem', padding: '10px 12px', gap: '6px' }} onClick={() => window.print()}>
              <Printer size={16} /> พิมพ์ใบเสร็จ
            </button>
          </div>
          <ReceiptPrint booking={selectedBooking} settings={settings} />
        </div>
      )}
    </div>
  );
}

export default PendingBookings;
