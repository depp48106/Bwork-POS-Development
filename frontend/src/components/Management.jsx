import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Home, Coffee, X, Search, Check, AlertCircle, Layers } from 'lucide-react';

function ManagementPanel({ sysAlert, sysConfirm }) {
  // Inventory catalog States
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Unified Item Form Modal State
  const [itemForm, setItemForm] = useState({
    id: null,
    name: '',
    price: '',
    daily_rate: '',
    half_day_rate: '',
    has_classroom: false,
    classroom_hourly_rate: '',
    classroom_daily_rate: '',
    classroom_capacity: '',
    category: 'Meeting Room', // 'Meeting Room', 'Co-Working', 'Koocafe', 'Parking'
    capacity: '',
    description: '',
    status: 'active',
    dbType: 'room' // 'room' or 'service'
  });
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchCatalog();
  }, []);

  const fetchCatalog = async () => {
    setLoading(true);
    setSearchQuery('');
    try {
      const roomsRes = await fetch('/api/rooms');
      const servicesRes = await fetch('/api/services');
      if (roomsRes.ok && servicesRes.ok) {
        const roomsData = await roomsRes.json();
        const servicesData = await servicesRes.json();
        
        // Merge into a single list
        const merged = [
          ...roomsData.map(r => ({
            id: r.id,
            name: r.name,
            price: r.hourly_rate,
            daily_rate: r.daily_rate || 0,
            half_day_rate: r.half_day_rate || 0,
            has_classroom: r.has_classroom || 0,
            classroom_hourly_rate: r.classroom_hourly_rate || 0,
            classroom_daily_rate: r.classroom_daily_rate || 0,
            classroom_capacity: r.classroom_capacity || 0,
            category: 'Meeting Room',
            capacity: r.capacity,
            description: r.description,
            status: r.status,
            dbType: 'room'
          })),
          ...servicesData.map(s => ({
            id: s.id,
            name: s.name,
            price: s.price,
            category: s.category, // 'Co-Working', 'Koocafe', 'Parking'
            capacity: '',
            description: '',
            status: s.status,
            dbType: 'service'
          }))
        ];
        
        // Sort items by Category, then by Name
        merged.sort((a, b) => {
          if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
          }
          return a.name.localeCompare(b.name);
        });
        
        setInventory(merged);
      }
    } catch (err) {
      console.error('Failed to load catalog:', err);
    } finally {
      setLoading(false);
    }
  };

  // Unified Save Handler (routes to correct database endpoints based on category)
  const handleSaveItem = async (e) => {
    e.preventDefault();

    const isRoom = itemForm.category === 'Meeting Room';
    const method = itemForm.id ? 'PUT' : 'POST';
    
    let url = '';
    let payload = {};

    if (isRoom) {
      url = itemForm.id ? `/api/rooms/${itemForm.id}` : '/api/rooms';
      payload = {
        name: itemForm.name,
        capacity: parseInt(itemForm.capacity, 10) || 0,
        hourly_rate: parseFloat(itemForm.price) || 0,
        daily_rate: parseFloat(itemForm.daily_rate) || 0,
        half_day_rate: parseFloat(itemForm.half_day_rate) || 0,
        has_classroom: itemForm.has_classroom ? 1 : 0,
        classroom_hourly_rate: itemForm.has_classroom ? (parseFloat(itemForm.classroom_hourly_rate) || 0) : 0,
        classroom_daily_rate: itemForm.has_classroom ? (parseFloat(itemForm.classroom_daily_rate) || 0) : 0,
        classroom_capacity: itemForm.has_classroom ? (parseInt(itemForm.classroom_capacity, 10) || 0) : 0,
        description: itemForm.description,
        status: itemForm.status
      };
    } else {
      url = itemForm.id ? `/api/services/${itemForm.id}` : '/api/services';
      payload = {
        name: itemForm.name,
        price: parseFloat(itemForm.price) || 0,
        category: itemForm.category,
        status: itemForm.status
      };
    }

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        await sysAlert(itemForm.id ? 'แก้ไขข้อมูลคลังสำเร็จ' : 'เพิ่มรายการเข้าคลังเรียบร้อย');
        setShowModal(false);
        setItemForm({
          id: null,
          name: '',
          price: '',
          daily_rate: '',
          half_day_rate: '',
          has_classroom: false,
          classroom_hourly_rate: '',
          classroom_daily_rate: '',
          classroom_capacity: '',
          category: 'Meeting Room',
          capacity: '',
          description: '',
          status: 'active',
          dbType: 'room'
        });
        fetchCatalog();
      } else {
        const errorData = await res.json();
        await sysAlert(`ล้มเหลว: ${errorData.error || 'ไม่สามารถบันทึกข้อมูลได้'}`);
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const handleEdit = (item) => {
    setItemForm({
      id: item.id,
      name: item.name,
      price: item.price,
      daily_rate: item.daily_rate || '',
      half_day_rate: item.half_day_rate || '',
      has_classroom: item.has_classroom === 1,
      classroom_hourly_rate: item.classroom_hourly_rate || '',
      classroom_daily_rate: item.classroom_daily_rate || '',
      classroom_capacity: item.classroom_capacity || '',
      category: item.category,
      capacity: item.capacity || '',
      description: item.description || '',
      status: item.status,
      dbType: item.dbType
    });
    setShowModal(true);
  };

  const handleDelete = async (item) => {
    const confirmMsg = item.dbType === 'room'
      ? `คุณต้องการลบห้องประชุม "${item.name}" ใช่หรือไม่?\nการลบนี้จะไม่มีผลย้อนหลังต่อประวัติใบเสร็จที่เคยจองแล้ว`
      : `คุณต้องการลบรายการสินค้า/บริการ "${item.name}" ใช่หรือไม่?`;

    if (!await sysConfirm(confirmMsg)) {
      return;
    }

    const url = item.dbType === 'room' ? `/api/rooms/${item.id}` : `/api/services/${item.id}`;
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        await sysAlert('ลบรายการคลังสำเร็จ');
        fetchCatalog();
      } else {
        const errorData = await res.json();
        await sysAlert(`ล้มเหลว: ${errorData.error || 'ไม่สามารถลบได้'}`);
      }
    } catch (err) {
      await sysAlert('เกิดข้อผิดพลาดทางเทคนิคในการลบ');
    }
  };

  const handleCategoryChange = (cat) => {
    setItemForm({
      ...itemForm,
      category: cat,
      dbType: cat === 'Meeting Room' ? 'room' : 'service'
    });
  };

  // Filter list based on search bar (searches name, category, or description)
  const filteredInventory = inventory.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="tab-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
        <div>
          <h1 className="tab-title">จัดการคลัง</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            เพิ่ม ลบ แก้ไข รายละเอียดคลังสินค้าและบริการ (Meeting Room, Co-Working, Koocafe, Parking)
          </p>
        </div>
      </div>

      {/* Control panel containing Search bar & Add Button */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        gap: '16px', 
        flexWrap: 'wrap', 
        background: 'var(--bg-card)', 
        padding: '16px 24px', 
        borderRadius: 'var(--border-radius)', 
        border: '1px solid var(--border-color)', 
        backdropFilter: 'blur(20px)', 
        boxShadow: 'var(--glass-shadow)' 
      }}>
        
        {/* Title or indicator on the left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={20} className="text-primary" />
          <span style={{ fontWeight: '750', fontSize: '1rem' }}>
            รายการคลังสินค้าทั้งหมด ({inventory.length} รายการ)
          </span>
        </div>

        {/* Search bar & Add Button on the right */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, justifyContent: 'flex-end', minWidth: '300px' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '280px' }}>
            <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              className="form-control" 
              placeholder="ค้นหาชื่อ หรือประเภท..."
              style={{ paddingLeft: '40px', width: '100%', borderRadius: '99px', fontSize: '0.85rem', height: '40px' }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <button 
            className="btn btn-primary"
            style={{ padding: '10px 22px', borderRadius: '99px', fontSize: '0.875rem', height: '40px', gap: '6px' }}
            onClick={() => {
              setItemForm({
                id: null,
                name: '',
                price: '',
                daily_rate: '',
                half_day_rate: '',
                has_classroom: false,
                classroom_hourly_rate: '',
                classroom_daily_rate: '',
                classroom_capacity: '',
                category: 'Meeting Room',
                capacity: '',
                description: '',
                status: 'active',
                dbType: 'room'
              });
              setShowModal(true);
            }}
          >
            <Plus size={16} />
            <span>เพิ่มรายการสินค้า/บริการ</span>
          </button>
        </div>
      </div>

      {/* Main Workspace listing panel */}
      {loading ? (
        <div className="card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังเชื่อมต่อฐานข้อมูลคลัง...</span>
        </div>
      ) : (
        <div className="card" style={{ padding: '0px', overflow: 'hidden' }}>
          <div className="table-container" style={{ border: 'none', boxShadow: 'none' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th style={{ padding: '20px 24px' }}>ชื่อรายการสินค้า / ห้องประชุม</th>
                  <th>ประเภทคลัง</th>
                  <th style={{ textAlign: 'right' }}>ราคา / อัตราค่าบริการ</th>
                  <th>รายละเอียด / ความจุ</th>
                  <th style={{ textAlign: 'center' }}>สถานะคลัง</th>
                  <th style={{ textAlign: 'center', padding: '20px 24px' }}>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                      <AlertCircle size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
                      <div>ไม่พบข้อมูลคลังที่ต้องการหา</div>
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((item, idx) => (
                    <tr key={`${item.dbType}-${item.id}-${idx}`}>
                      <td style={{ fontWeight: '700', fontSize: '0.975rem', padding: '20px 24px' }}>{item.name}</td>
                      <td>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '99px',
                          fontSize: '0.725rem',
                          fontWeight: '700',
                          backgroundColor: item.category === 'Meeting Room' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                          color: item.category === 'Meeting Room' ? '#22c55e' : '#eab308',
                          border: `1px solid ${item.category === 'Meeting Room' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`
                        }}>
                          {item.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: '800', fontSize: '1.05rem', color: 'var(--primary-color)' }}>
                        {Number(item.price).toLocaleString()}.- {item.category === 'Meeting Room' && <span style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-muted)' }}>/ชม.</span>}
                        {item.category === 'Meeting Room' && item.half_day_rate > 0 && (
                          <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#10b981', marginTop: '2px' }}>
                            {Number(item.half_day_rate).toLocaleString()}.- <span style={{ fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)' }}>/ครึ่งวัน</span>
                          </div>
                        )}
                        {item.category === 'Meeting Room' && item.daily_rate > 0 && (
                          <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#f59e0b', marginTop: '2px' }}>
                            {Number(item.daily_rate).toLocaleString()}.- <span style={{ fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)' }}>/วัน</span>
                          </div>
                        )}
                        {item.category === 'Meeting Room' && item.has_classroom === 1 && (
                          <div style={{ fontSize: '0.725rem', fontWeight: '600', color: '#ec4899', marginTop: '2px', borderTop: '1px dashed var(--border-color)', paddingTop: '2px' }}>
                            🏫 Classroom: {Number(item.classroom_hourly_rate).toLocaleString()}.-/ชม. • {Number(item.classroom_daily_rate).toLocaleString()}.-/วัน
                          </div>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {item.category === 'Meeting Room' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>ความจุ {item.capacity} คน {item.has_classroom === 1 && <span style={{ fontWeight: 'normal', color: '#ec4899' }}>(Classroom: {item.classroom_capacity} คน)</span>}</span>
                            <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}>{item.description || '-'}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>-</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`badge ${item.status === 'active' ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.7rem' }}>
                          {item.status === 'active' ? 'เปิดบริการ' : 'ปิดบริการ'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '20px 24px' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '8px 12px', fontSize: '0.8rem', gap: '4px' }}
                            onClick={() => handleEdit(item)}
                          >
                            <Edit2 size={12} />
                            <span>แก้ไข</span>
                          </button>
                          <button 
                            className="btn btn-danger" 
                            style={{ padding: '8px 12px', fontSize: '0.8rem', gap: '4px' }}
                            onClick={() => handleDelete(item)}
                          >
                            <Trash2 size={12} />
                            <span>ลบ</span>
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

      {/* UNIFIED FORM ADD/EDIT MODAL - REDESIGNED WIDER & COMPACT LAYOUT */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '95%',
            maxWidth: '680px',
            padding: '24px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            border: '1px solid var(--glass-border)',
            position: 'relative',
            borderRadius: '24px',
            backgroundColor: 'var(--bg-card)'
          }}>
            {/* Close button */}
            <button 
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setShowModal(false)}
            >
              <X size={20} />
            </button>

            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Layers size={22} className="text-primary" />
              {itemForm.id ? 'แก้ไขข้อมูลคลังสินค้า/บริการ' : 'เพิ่มข้อมูลคลังสินค้า/บริการใหม่'}
            </h2>

            <form onSubmit={handleSaveItem} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              
              {/* Row 1: Category & Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ประเภทหมวดหมู่คลัง <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                  <select 
                    className="form-control" 
                    value={itemForm.category} 
                    onChange={e => handleCategoryChange(e.target.value)}
                    disabled={itemForm.id !== null}
                    style={{ 
                      cursor: itemForm.id !== null ? 'not-allowed' : 'pointer', 
                      height: '42px', 
                      padding: '8px 12px', 
                      borderRadius: '10px',
                      fontSize: '0.9rem'
                    }}
                  >
                    <option value="Meeting Room">Meeting Room (ห้องประชุม)</option>
                    <option value="Co-Working">Co-Working</option>
                    <option value="Koocafe">Koocafe</option>
                    <option value="Parking">Parking</option>
                  </select>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>สถานะคลัง</label>
                  <select 
                    className="form-control" 
                    value={itemForm.status} 
                    onChange={e => setItemForm({...itemForm, status: e.target.value})}
                    style={{ 
                      height: '42px', 
                      padding: '8px 12px', 
                      borderRadius: '10px',
                      fontSize: '0.9rem'
                    }}
                  >
                    <option value="active">เปิดใช้บริการ/ขายตามปกติ (Active)</option>
                    <option value="inactive">ปิดใช้งานชั่วคราว (Inactive)</option>
                  </select>
                </div>
              </div>
              
              {/* Row 1 sub: edit warning lock */}
              {itemForm.id !== null && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '-8px' }}>
                  * ไม่สามารถแก้ไขประเภทของรายการคลังที่มีอยู่แล้วได้
                </span>
              )}

              {/* Row 2: Name */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ชื่อรายการสินค้า / ชื่อห้องประชุม <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder={itemForm.category === 'Meeting Room' ? 'เช่น ห้องประชุม 301, Jupiter' : 'เช่น ของว่าง, บัตรจอดรถเสริม'}
                  required 
                  value={itemForm.name} 
                  onChange={e => setItemForm({...itemForm, name: e.target.value})} 
                  style={{ 
                    height: '42px', 
                    padding: '8px 12px', 
                    borderRadius: '10px',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              {/* Row 3: Rates / Capacity */}
              {itemForm.category === 'Meeting Room' ? (
                /* Room Rates & Capacity in 4 Columns! */
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>เช่า/ชั่วโมง (บาท) <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="เช่น 300"
                      required 
                      value={itemForm.price} 
                      onChange={e => setItemForm({...itemForm, price: e.target.value})} 
                      style={{ 
                        height: '42px', 
                        padding: '8px 12px', 
                        borderRadius: '10px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>เช่า/ครึ่งวัน (บาท)</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="เช่น 6000"
                      value={itemForm.half_day_rate} 
                      onChange={e => setItemForm({...itemForm, half_day_rate: e.target.value})} 
                      style={{ 
                        height: '42px', 
                        padding: '8px 12px', 
                        borderRadius: '10px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>เช่า/วัน (บาท)</label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="เช่น 4000"
                      value={itemForm.daily_rate} 
                      onChange={e => setItemForm({...itemForm, daily_rate: e.target.value})} 
                      style={{ 
                        height: '42px', 
                        padding: '8px 12px', 
                        borderRadius: '10px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ความจุ (คน) <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="เช่น 10"
                      required
                      value={itemForm.capacity} 
                      onChange={e => setItemForm({...itemForm, capacity: e.target.value})} 
                      style={{ 
                        height: '42px', 
                        padding: '8px 12px', 
                        borderRadius: '10px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>
                </div>
              ) : (
                /* Service price in 2 columns (half width) */
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ราคาขายต่อหน่วย (บาท) <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                    <input 
                      type="number" 
                      className="form-control" 
                      placeholder="เช่น 50"
                      required 
                      value={itemForm.price} 
                      onChange={e => setItemForm({...itemForm, price: e.target.value})} 
                      style={{ 
                        height: '42px', 
                        padding: '8px 12px', 
                        borderRadius: '10px',
                        fontSize: '0.9rem'
                      }}
                    />
                  </div>
                  <div></div>
                </div>
              )}

              {/* Classroom Section */}
              {itemForm.category === 'Meeting Room' && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(236, 72, 153, 0.04)',
                  border: '1px solid rgba(236, 72, 153, 0.12)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold', color: '#ec4899', margin: 0, fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={itemForm.has_classroom}
                      onChange={e => setItemForm({...itemForm, has_classroom: e.target.checked})}
                      style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    เปิดใช้งานรูปแบบห้องเรียน (Classroom Layout)
                  </label>

                  {itemForm.has_classroom && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginTop: '2px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.725rem', fontWeight: 'bold', color: '#ec4899' }}>/ชม. (Classroom)</label>
                        <input
                          type="number"
                          className="form-control"
                          placeholder="เช่น 700"
                          required={itemForm.has_classroom}
                          value={itemForm.classroom_hourly_rate}
                          onChange={e => setItemForm({...itemForm, classroom_hourly_rate: e.target.value})}
                          style={{ 
                            height: '36px', 
                            padding: '6px 10px',
                            fontSize: '0.85rem', 
                            borderRadius: '8px' 
                          }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.725rem', fontWeight: 'bold', color: '#ec4899' }}>/วัน (Classroom)</label>
                        <input
                          type="number"
                          className="form-control"
                          placeholder="เช่น 5000"
                          required={itemForm.has_classroom}
                          value={itemForm.classroom_daily_rate}
                          onChange={e => setItemForm({...itemForm, classroom_daily_rate: e.target.value})}
                          style={{ 
                            height: '36px', 
                            padding: '6px 10px',
                            fontSize: '0.85rem', 
                            borderRadius: '8px' 
                          }}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.725rem', fontWeight: 'bold', color: '#ec4899' }}>ความจุ (Classroom)</label>
                        <input
                          type="number"
                          className="form-control"
                          placeholder="เช่น 12"
                          required={itemForm.has_classroom}
                          value={itemForm.classroom_capacity}
                          onChange={e => setItemForm({...itemForm, classroom_capacity: e.target.value})}
                          style={{ 
                            height: '36px', 
                            padding: '6px 10px',
                            fontSize: '0.85rem', 
                            borderRadius: '8px' 
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Row 4: Description */}
              {itemForm.category === 'Meeting Room' && (
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>คำอธิบาย / รายละเอียดเพิ่มเติม</label>
                  <textarea 
                    className="form-control" 
                    placeholder="รายละเอียดอุปกรณ์ในห้องประชุม เช่น โปรเจคเตอร์, จอทีวี"
                    rows={2}
                    style={{ resize: 'none', padding: '8px 10px', borderRadius: '10px', fontSize: '0.85rem' }}
                    value={itemForm.description}
                    onChange={e => setItemForm({...itemForm, description: e.target.value})}
                  />
                </div>
              )}

              {/* Submit / Cancel Buttons */}
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1, height: '40px', borderRadius: '10px' }} 
                  onClick={() => setShowModal(false)}
                >
                  ยกเลิก
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 2, gap: '6px', height: '40px', borderRadius: '10px' }}
                >
                  <Check size={16} />
                  บันทึกข้อมูล
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManagementPanel;
