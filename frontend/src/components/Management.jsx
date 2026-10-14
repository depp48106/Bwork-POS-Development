import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Home, Coffee, X, Search, Check, AlertCircle, Layers, ChevronDown, Crosshair, RotateCcw, Sliders, KeyRound, Building2 } from 'lucide-react';
import { API_BASE } from '../apiConfig';

function ManagementPanel({ sysAlert, sysConfirm }) {
  // Inventory catalog States
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [roomCategoryName, setRoomCategoryName] = useState(() => localStorage.getItem('roomCategoryName') || 'Meeting Room');

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
    category: localStorage.getItem('roomCategoryName') || 'Meeting Room', // roomCategoryName, 'Co-Working', 'Koocafe', 'Parking'
    capacity: '',
    description: '',
    status: 'active',
    image_url: '',
    image_position_x: 50,
    image_position_y: 50,
    pin_code: '',
    builtland_pin_code: '',
    dbType: 'room' // 'room' or 'service'
  });
  const [showModal, setShowModal] = useState(false);
  const [isFocalDragging, setIsFocalDragging] = useState(false);
  const [wifiForm, setWifiForm] = useState({
    username: '',
    password: '',
    hasSavedPassword: false,
    showPassword: false,
    clearConfirmed: false,
    loading: false
  });

  // Category States
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' or 'inactive'
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [customCategories, setCustomCategories] = useState([]);
  const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCatName, setEditingCatName] = useState({ old: '', current: '' });
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isFormDropdownOpen, setIsFormDropdownOpen] = useState(false);
  const [isStatusFormDropdownOpen, setIsStatusFormDropdownOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, categoryFilter]);

  const getCategoryEmoji = (cat) => "";

  // Dynamically compute all categories
  const categories = [
    ...new Set([
      roomCategoryName,
      'Co-Working',
      'Koocafe',
      'Parking',
      ...inventory.map(item => item.category).filter(Boolean),
      ...customCategories
    ])
  ];

  const handleCreateCategory = (e) => {
    e.preventDefault();
    const cleanName = newCategoryName.trim();
    if (!cleanName) {
      sysAlert('กรุณากรอกชื่อประเภทสินค้า');
      return;
    }
    
    const isDuplicate = categories.some(cat => cat.toLowerCase() === cleanName.toLowerCase());
    if (isDuplicate) {
      sysAlert('มีประเภทสินค้านี้อยู่แล้ว');
      return;
    }

    setCustomCategories([...customCategories, cleanName]);
    sysAlert('สร้างประเภทสินค้าใหม่สำเร็จ');
    setNewCategoryName('');
  };

  const handleRenameCategory = async () => {
    const cleanNewName = editingCatName.current.trim();
    if (!cleanNewName) {
      sysAlert('กรุณากรอกชื่อหมวดหมู่ที่ต้องการแก้ไข');
      return;
    }
    if (cleanNewName.toLowerCase() === editingCatName.old.toLowerCase()) {
      setEditingCatName({ old: '', current: '' });
      return;
    }
    const isDuplicate = categories.some(cat => cat.toLowerCase() === cleanNewName.toLowerCase() && cat.toLowerCase() !== editingCatName.old.toLowerCase());
    if (isDuplicate) {
      sysAlert('มีหมวดหมู่ชื่อนี้อยู่ในระบบแล้ว');
      return;
    }

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      if (editingCatName.old === roomCategoryName) {
        const setRes = await fetch(`${API_BASE}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ room_category_name: cleanNewName })
        });
        if (setRes.ok) {
          setRoomCategoryName(cleanNewName);
          localStorage.setItem('roomCategoryName', cleanNewName);
        }
      }

      const res = await fetch(`${API_BASE}/api/categories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ oldName: editingCatName.old, newName: cleanNewName })
      });
      if (res.ok) {
        await sysAlert('แก้ไขชื่อหมวดหมู่เรียบร้อยแล้ว');
        setEditingCatName({ old: '', current: '' });
        fetchCatalog();
      } else {
        const errorData = await res.json();
        sysAlert(`ล้มเหลว: ${errorData.error || 'ไม่สามารถแก้ไขได้'}`);
      }
    } catch (err) {
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const handleDeleteCategory = async (catName) => {
    const count = inventory.filter(item => item.category === catName).length;
    let confirmMsg = `คุณแน่ใจว่าต้องการลบหมวดหมู่ "${catName}" ใช่หรือไม่?`;
    if (count > 0) {
      confirmMsg += `\nคำเตือน: สินค้าและบริการทั้งหมดในหมวดหมู่นี้จำนวน ${count} รายการจะถูกลบไปด้วย!`;
    }
    if (!await sysConfirm(confirmMsg)) return;

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      const res = await fetch(`${API_BASE}/api/categories/${encodeURIComponent(catName)}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        await sysAlert('ลบหมวดหมู่และสินค้าในหมวดหมู่เรียบร้อยแล้ว');
        fetchCatalog();
      } else {
        const errorData = await res.json();
        sysAlert(`ล้มเหลว: ${errorData.error || 'ไม่สามารถลบได้'}`);
      }
    } catch (err) {
      sysAlert('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const fetchSettings = async () => {
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      const res = await fetch(`${API_BASE}/api/settings`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.room_category_name) {
          setRoomCategoryName(data.room_category_name);
          localStorage.setItem('roomCategoryName', data.room_category_name);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const init = async () => {
      await fetchSettings();
      await fetchCatalog();
    };
    init();
  }, []);

  const fetchCatalog = async () => {
    setLoading(true);
    setSearchQuery('');
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      const roomsRes = await fetch(`${API_BASE}/api/rooms`, { headers: { ...authHeaders } });
      const servicesRes = await fetch(`${API_BASE}/api/services`, { headers: { ...authHeaders } });
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
            category: r.category || roomCategoryName,
            capacity: r.capacity,
            description: r.description,
            status: r.status,
            dbType: 'room',
            has_hourly: r.has_hourly,
            has_halfday: r.has_halfday,
            has_daily: r.has_daily,
            image_url: r.image_url || '',
            image_position_x: r.image_position_x !== undefined && r.image_position_x !== null ? r.image_position_x : 50,
            image_position_y: r.image_position_y !== undefined && r.image_position_y !== null ? r.image_position_y : 50,
            pin_code: r.pin_code || '',
            builtland_pin_code: r.builtland_pin_code || ''
          })),
          ...servicesData.map(s => ({
            id: s.id,
            name: s.name,
            price: s.price,
            category: s.category, // 'Co-Working', 'Koocafe', 'Parking'
            capacity: '',
            description: '',
            status: s.status,
            dbType: 'service',
            image_url: s.image_url || ''
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

    let currentItemForm = { ...itemForm };

    // If type has changed, do migration flow!
    if (currentItemForm.id && currentItemForm.dbType !== currentItemForm.originalDbType) {
      const confirmChange = await sysConfirm(
        `คุณกำลังเปลี่ยนประเภทสินค้าข้ามฝั่งระหว่าง ห้องประชุม และ สินค้าทั่วไป\nระบบจะลบข้อมูลเก่าและย้ายไปบันทึกในประเภทใหม่ ยืนยันใช่หรือไม่?`
      );
      if (!confirmChange) return;

      const deletePath = currentItemForm.originalDbType === 'room'
        ? `/api/rooms/${currentItemForm.id}` 
        : `/api/services/${currentItemForm.id}`;
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      
      const deleteRes = await fetch(`${API_BASE}${deletePath}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!deleteRes.ok) {
        const errorData = await deleteRes.json();
        await sysAlert(`ไม่สามารถย้ายประเภทได้: ${errorData.error || 'สินค้านี้ถูกใช้งานในระบบจองแล้ว'}`);
        return;
      }

      // Success, clear id to insert it as a new item in the other table
      currentItemForm.id = null;
    }

    const isRoom = currentItemForm.dbType === 'room';
    const method = currentItemForm.id ? 'PUT' : 'POST';
    
    let url = '';
    let payload = {};

    if (isRoom) {
      url = currentItemForm.id ? `/api/rooms/${currentItemForm.id}` : '/api/rooms';
      
      payload = {
        name: currentItemForm.name,
        capacity: parseInt(currentItemForm.capacity, 10) || 0,
        hourly_rate: currentItemForm.has_hourly ? (parseFloat(currentItemForm.price) || 0) : 0,
        daily_rate: currentItemForm.has_daily ? (parseFloat(currentItemForm.daily_rate) || 0) : 0,
        half_day_rate: currentItemForm.has_halfday ? (parseFloat(currentItemForm.half_day_rate) || 0) : 0,
        has_hourly: currentItemForm.has_hourly ? 1 : 0,
        has_halfday: currentItemForm.has_halfday ? 1 : 0,
        has_daily: currentItemForm.has_daily ? 1 : 0,
        has_classroom: currentItemForm.has_classroom ? 1 : 0,
        classroom_hourly_rate: currentItemForm.has_classroom ? (parseFloat(currentItemForm.classroom_hourly_rate) || 0) : 0,
        classroom_daily_rate: currentItemForm.has_classroom ? (parseFloat(currentItemForm.classroom_daily_rate) || 0) : 0,
        classroom_capacity: currentItemForm.has_classroom ? (parseInt(currentItemForm.classroom_capacity, 10) || 0) : 0,
        description: currentItemForm.description,
        status: currentItemForm.status,
        image_url: currentItemForm.image_url || null,
        image_position_x: typeof currentItemForm.image_position_x === 'number' ? Math.max(0, Math.min(100, Math.round(currentItemForm.image_position_x))) : 50,
        image_position_y: typeof currentItemForm.image_position_y === 'number' ? Math.max(0, Math.min(100, Math.round(currentItemForm.image_position_y))) : 50,
        pin_code: currentItemForm.pin_code || null,
        builtland_pin_code: currentItemForm.builtland_pin_code || null,
        category: roomCategoryName
      };
    } else {
      url = currentItemForm.id ? `/api/services/${currentItemForm.id}` : '/api/services';
      payload = {
        name: currentItemForm.name,
        price: parseFloat(currentItemForm.price) || 0,
        category: currentItemForm.category,
        status: currentItemForm.status,
        image_url: currentItemForm.image_url || null
      };
    }

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
      const res = await fetch(fullUrl, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const responseData = await res.json().catch(() => ({}));
        const targetRoomId = currentItemForm.id || responseData?.id || responseData?.room?.id;

        // If saving a room, synchronize Wi-Fi credentials via dedicated protected endpoint
        if (currentItemForm.dbType === 'room' && targetRoomId) {
          try {
            if (wifiForm.clearConfirmed) {
              await fetch(`${API_BASE}/api/admin/rooms/${targetRoomId}/wifi`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ clear_credentials: true })
              });
            } else if (wifiForm.username !== undefined || wifiForm.password) {
              await fetch(`${API_BASE}/api/admin/rooms/${targetRoomId}/wifi`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                  wifi_username: wifiForm.username,
                  wifi_password: wifiForm.password
                })
              });
            }
          } catch (wifiErr) {
            console.error('Failed to update room Wi-Fi credentials:', wifiErr);
          }
        }

        await sysAlert(currentItemForm.id ? 'แก้ไขข้อมูลคลังสำเร็จ' : 'เพิ่มรายการเข้าคลังเรียบร้อย');
        setShowModal(false);
        setWifiForm({ username: '', password: '', hasSavedPassword: false, showPassword: false, clearConfirmed: false, loading: false });
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
          category: roomCategoryName,
          capacity: '',
          description: '',
          status: 'active',
          image_url: '',
          image_position_x: 50,
          image_position_y: 50,
          pin_code: '',
          builtland_pin_code: '',
          dbType: 'room',
          originalDbType: 'room',
          has_hourly: true,
          has_halfday: false,
          has_daily: false
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

  const fetchRoomWifi = async (roomId) => {
    try {
      setWifiForm(prev => ({ ...prev, loading: true }));
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      const res = await fetch(`${API_BASE}/api/admin/rooms/${roomId}/wifi`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (res.ok) {
        const data = await res.json();
        setWifiForm({
          username: data.wifi_username || '',
          password: '',
          hasSavedPassword: Boolean(data.has_password),
          showPassword: false,
          clearConfirmed: false,
          loading: false
        });
      } else {
        setWifiForm({ username: '', password: '', hasSavedPassword: false, showPassword: false, clearConfirmed: false, loading: false });
      }
    } catch (e) {
      setWifiForm({ username: '', password: '', hasSavedPassword: false, showPassword: false, clearConfirmed: false, loading: false });
    }
  };

  const handleEdit = (item) => {
    if (item.dbType === 'room') {
      fetchRoomWifi(item.id);
    } else {
      setWifiForm({ username: '', password: '', hasSavedPassword: false, showPassword: false, clearConfirmed: false, loading: false });
    }
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
      image_url: item.image_url || '',
      image_position_x: item.image_position_x !== undefined && item.image_position_x !== null ? item.image_position_x : 50,
      image_position_y: item.image_position_y !== undefined && item.image_position_y !== null ? item.image_position_y : 50,
      pin_code: item.pin_code || '',
      builtland_pin_code: item.builtland_pin_code || '',
      dbType: item.dbType,
      originalDbType: item.dbType,
      has_hourly: item.has_hourly === 1 || item.has_hourly === true || (item.dbType === 'room' && item.hourly_rate > 0),
      has_halfday: item.has_halfday === 1 || item.has_halfday === true,
      has_daily: item.has_daily === 1 || item.has_daily === true
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

    const path = item.dbType === 'room' ? `/api/rooms/${item.id}` : `/api/services/${item.id}`;
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
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
      dbType: itemForm.id !== null ? itemForm.dbType : (cat === roomCategoryName ? 'room' : 'service')
    });
  };

  // Filter list based on search bar (searches name, category, or description)
  const filteredInventory = inventory.filter(item => {
    if (item.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    return (
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  const totalPages = Math.ceil(filteredInventory.length / itemsPerPage);
  const paginatedInventory = filteredInventory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="tab-header">
        <div>
          <h1 className="tab-title">
            จัดการคลังระบบ Bwork
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px', fontWeight: '650' }}>
            ควบคุมคลังสินค้า โต๊ะทำงาน ห้องประชุม และบริการเสริมทั้งหมดในหนึ่งเดียว
          </p>
        </div>

        {/* Liquidglass Tab Switcher for Active / Inactive items */}
        <div style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          background: 'rgba(0, 0, 0, 0.12)',
          border: '1px solid var(--border-color)',
          padding: '5px',
          borderRadius: '99px',
          backdropFilter: 'blur(10px)',
        }}>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            style={{
              padding: '8px 18px',
              borderRadius: '99px',
              fontSize: '0.8rem',
              fontWeight: '700',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              background: statusFilter === 'active' 
                ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(37, 99, 235, 0.15))' 
                : 'transparent',
              color: statusFilter === 'active' ? 'var(--primary-color)' : 'var(--text-muted)',
              boxShadow: statusFilter === 'active' ? '0 4px 15px rgba(56, 189, 248, 0.15)' : 'none',
              border: statusFilter === 'active' ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent'
            }}
          >
            สินค้าพร้อมใช้งาน ({inventory.filter(item => item.status === 'active').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            style={{
              padding: '8px 18px',
              borderRadius: '99px',
              fontSize: '0.8rem',
              fontWeight: '700',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              background: statusFilter === 'inactive' 
                ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(244, 63, 94, 0.15))' 
                : 'transparent',
              color: statusFilter === 'inactive' ? '#ef4444' : 'var(--text-muted)',
              boxShadow: statusFilter === 'inactive' ? '0 4px 15px rgba(239, 68, 68, 0.15)' : 'none',
              border: statusFilter === 'inactive' ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid transparent'
            }}
          >
            ปิดใช้งานชั่วคราว ({inventory.filter(item => item.status === 'inactive').length})
          </button>
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
        padding: '18px 24px', 
        borderRadius: '24px', 
        border: '1px solid var(--glass-border)', 
        backdropFilter: 'blur(20px)', 
        boxShadow: 'var(--glass-shadow)',
        position: 'relative',
        zIndex: 10
      }}>
        
        {/* Search bar & Category filter on the left */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flex: 1, minWidth: '300px', flexWrap: 'wrap' }}>
          {/* Search bar */}
          <div style={{ position: 'relative', flex: 1, maxWidth: '280px', minWidth: '200px' }}>
            <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              className="form-control" 
              placeholder="ค้นหาชื่อ หรือประเภท..."
              style={{ paddingLeft: '44px', width: '100%', borderRadius: '14px', fontSize: '0.85rem', height: '42px', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-main)', fontWeight: '600' }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Custom Category Filter Dropdown */}
          <div style={{ position: 'relative', width: '100%', maxWidth: '220px', minWidth: '160px' }}>
            <button
              type="button"
              onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
              style={{
                width: '100%',
                height: '42px',
                padding: '0 18px',
                borderRadius: '14px',
                fontSize: '0.85rem',
                fontWeight: '700',
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: 'var(--text-main)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                transition: 'all 0.35s ease'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {categoryFilter === 'all' 
                  ? `ทุกประเภท (${inventory.filter(item => item.status === statusFilter).length})`
                  : `${getCategoryEmoji(categoryFilter)} ${categoryFilter === roomCategoryName ? 'ห้องประชุม' : categoryFilter} (${inventory.filter(item => item.category === categoryFilter && item.status === statusFilter).length})`}
              </span>
              <ChevronDown size={14} style={{ opacity: 0.6, transform: isFilterDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {isFilterDropdownOpen && (
              <>
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setIsFilterDropdownOpen(false)} />
                <div 
                  className="liquidglass-dropdown"
                  style={{
                    position: 'absolute',
                    top: '48px',
                    left: 0,
                    right: 0,
                    zIndex: 999,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    maxHeight: '260px',
                    overflowY: 'auto'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryFilter('all');
                      setIsFilterDropdownOpen(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      border: 'none',
                      background: categoryFilter === 'all' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                      color: categoryFilter === 'all' ? 'var(--primary-color)' : 'var(--text-main)',
                      fontSize: '0.8rem',
                      fontWeight: categoryFilter === 'all' ? '700' : '500',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <span></span>
                    <span>ทุกประเภท ({inventory.filter(item => item.status === statusFilter).length})</span>
                  </button>

                  {categories.map(cat => {
                    const count = inventory.filter(item => item.category === cat && item.status === statusFilter).length;
                    const isSel = categoryFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(cat);
                          setIsFilterDropdownOpen(false);
                        }}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          border: 'none',
                          background: isSel ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                          color: isSel ? 'var(--primary-color)' : 'var(--text-main)',
                          fontSize: '0.8rem',
                          fontWeight: isSel ? '700' : '500',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span>{getCategoryEmoji(cat)}</span>
                        <span>{cat === roomCategoryName ? 'ห้องประชุม' : cat} ({count})</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons on the right */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button 
            type="button"
            className="btn btn-secondary"
            style={{ 
              padding: '10px 20px', 
              borderRadius: '14px', 
              fontSize: '0.85rem', 
              fontWeight: '700', 
              height: '42px', 
              gap: '8px',
              backgroundColor: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
            onClick={() => setShowManageCategoriesModal(true)}
          >
            <Layers size={16} />
            <span>จัดการประเภทสินค้า</span>
          </button>

          <button 
            type="button"
            className="btn btn-primary"
            style={{ 
              padding: '10px 22px', 
              borderRadius: '14px', 
              fontSize: '0.85rem', 
              fontWeight: '800', 
              height: '42px', 
              gap: '8px',
              boxShadow: '0 8px 20px rgba(56, 189, 248, 0.15)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
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
                category: roomCategoryName,
                has_hourly: true,
                has_halfday: false,
                capacity: '',
                description: '',
                status: 'active',
                image_url: '',
                pin_code: '',
                dbType: 'room',
                originalDbType: 'room',
                has_daily: false
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
        <div className="card" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0', border: '1px solid var(--glass-border)', background: 'var(--bg-card)' }}>
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>กำลังเชื่อมต่อฐานข้อมูลคลัง...</span>
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
                  <th style={{ padding: '20px 24px' }}>ชื่อรายการสินค้า / ห้องประชุม</th>
                  <th>ประเภทคลัง</th>
                  <th style={{ textAlign: 'center' }}>รหัสผ่าน</th>
                  <th style={{ textAlign: 'right' }}>ราคา / อัตราค่าบริการ</th>
                  <th>รายละเอียด / ความจุ</th>
                  <th style={{ textAlign: 'center' }}>สถานะคลัง</th>
                  <th style={{ textAlign: 'center', padding: '20px 24px' }}>การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                      <AlertCircle size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
                      <div>ไม่พบข้อมูลคลังที่ต้องการหา</div>
                    </td>
                  </tr>
                ) : (
                  paginatedInventory.map((item, idx) => (
                    <tr key={`${item.dbType}-${item.id}-${idx}`}>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '44px', height: '44px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {item.image_url ? (
                              <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <Home size={18} style={{ opacity: 0.2 }} />
                            )}
                          </div>
                          <span style={{ fontWeight: '700', fontSize: '0.975rem' }}>{item.name}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '99px',
                          fontSize: '0.725rem',
                          fontWeight: '700',
                          backgroundColor: item.dbType === 'room' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(234, 179, 8, 0.12)',
                          color: item.dbType === 'room' ? '#22c55e' : '#eab308',
                          border: `1px solid ${item.dbType === 'room' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`
                        }}>
                          {item.category}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {item.dbType === 'room' ? (
                          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
                            {item.pin_code && (
                              <span style={{ 
                                fontFamily: 'monospace', 
                                fontWeight: '800', 
                                fontSize: '0.82rem', 
                                padding: '2px 8px', 
                                borderRadius: '6px', 
                                backgroundColor: 'rgba(16, 185, 129, 0.12)', 
                                color: '#10b981',
                                border: '1px solid rgba(16, 185, 129, 0.25)',
                                letterSpacing: '0.5px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }} title="รหัสผ่านสำหรับลูกค้าทั่วไป (LINE OA / Walk-in / Basecamp)">
                                <KeyRound size={11} />
                                {item.pin_code}
                              </span>
                            )}
                            {item.builtland_pin_code && (
                              <span style={{ 
                                fontFamily: 'monospace', 
                                fontWeight: '800', 
                                fontSize: '0.82rem', 
                                padding: '2px 8px', 
                                borderRadius: '6px', 
                                backgroundColor: 'rgba(249, 115, 22, 0.12)', 
                                color: '#ea580c',
                                border: '1px solid rgba(249, 115, 22, 0.25)',
                                letterSpacing: '0.5px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }} title="รหัสผ่านเฉพาะพนักงาน Builtland">
                                <Building2 size={11} />
                                {item.builtland_pin_code}
                              </span>
                            )}
                            {!item.pin_code && !item.builtland_pin_code && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>-</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: '800', fontSize: '1.05rem', color: 'var(--primary-color)' }}>
                        {item.dbType === 'service' ? (
                          <span>{Number(item.price).toLocaleString()}.-</span>
                        ) : (
                          <>
                            {(item.has_hourly === 1 || item.has_hourly === true) && (
                              <div style={{ fontSize: '1.05rem' }}>
                                {Number(item.price).toLocaleString()}.- <span style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-muted)' }}>/ชม.</span>
                              </div>
                            )}
                            {(item.has_halfday === 1 || item.has_halfday === true) && (
                              <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#10b981', marginTop: '2px' }}>
                                {Number(item.half_day_rate).toLocaleString()}.- <span style={{ fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)' }}>/ครึ่งวัน</span>
                              </div>
                            )}
                            {(item.has_daily === 1 || item.has_daily === true) && (
                              <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#f59e0b', marginTop: '2px' }}>
                                {Number(item.daily_rate).toLocaleString()}.- <span style={{ fontSize: '0.7rem', fontWeight: '500', color: 'var(--text-muted)' }}>/วัน</span>
                              </div>
                            )}
                            {!(item.has_hourly === 1 || item.has_hourly === true) && 
                             !(item.has_halfday === 1 || item.has_halfday === true) && 
                             !(item.has_daily === 1 || item.has_daily === true) && (
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>-</span>
                            )}
                            {item.has_classroom === 1 && (
                              <div style={{ fontSize: '0.725rem', fontWeight: '600', color: '#ec4899', marginTop: '2px', borderTop: '1px dashed var(--border-color)', paddingTop: '2px' }}>
                                 Classroom: {Number(item.classroom_hourly_rate).toLocaleString()}.-/ชม. • {Number(item.classroom_daily_rate).toLocaleString()}.-/วัน
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {item.dbType === 'room' ? (
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

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 24px',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'rgba(255,255,255,0.01)',
                borderBottomLeftRadius: '20px',
                borderBottomRightRadius: '20px'
              }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600' }}>
                  แสดง {(currentPage - 1) * itemsPerPage + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredInventory.length)} จากทั้งหมด {filteredInventory.length} รายการ
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', cursor: 'pointer', opacity: currentPage === 1 ? 0.5 : 1, pointerEvents: currentPage === 1 ? 'none' : 'auto' }}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                  >
                    ก่อนหน้า
                  </button>
                  {[...Array(totalPages)].map((_, i) => (
                    <button
                      key={i + 1}
                      className={`btn ${currentPage === i + 1 ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ 
                        padding: '6px 12px', 
                        borderRadius: '8px', 
                        fontSize: '0.8rem', 
                        cursor: 'pointer',
                        fontWeight: '700',
                        backgroundColor: currentPage === i + 1 ? 'var(--primary-color)' : 'transparent',
                        color: currentPage === i + 1 ? 'var(--text-white)' : 'var(--text-main)',
                        border: '1px solid ' + (currentPage === i + 1 ? 'var(--primary-color)' : 'var(--border-color)')
                      }}
                      onClick={() => setCurrentPage(i + 1)}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', cursor: 'pointer', opacity: currentPage === totalPages ? 0.5 : 1, pointerEvents: currentPage === totalPages ? 'none' : 'auto' }}
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                  >
                    ถัดไป
                  </button>
                </div>
              </div>
            )}
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
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '95%',
            maxWidth: '850px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '22px 28px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            border: '1px solid var(--glass-border)',
            position: 'relative',
            borderRadius: '24px',
            backgroundColor: 'var(--bg-card)'
          }}>
            {/* Close button */}
            <button 
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', zIndex: 2 }}
              onClick={() => setShowModal(false)}
            >
              <X size={20} />
            </button>

            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Layers size={20} className="text-primary" />
              {itemForm.id ? 'แก้ไขข้อมูลคลังสินค้า/บริการ' : 'เพิ่มข้อมูลคลังสินค้า/บริการใหม่'}
            </h2>

            <form onSubmit={handleSaveItem} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {/* Row 0: Database Type Selector (only when creating new item) */}
              {itemForm.id === null && (
                <div className="form-group" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ประเภทคลังสินค้า/บริการ <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ 
                        flex: 1, height: '40px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer',
                        border: itemForm.dbType === 'room' ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                        backgroundColor: itemForm.dbType === 'room' ? 'var(--primary-color)' : 'transparent',
                        color: itemForm.dbType === 'room' ? '#ffffff' : 'var(--text-muted)'
                      }}
                      onClick={() => setItemForm({ ...itemForm, dbType: 'room', category: roomCategoryName })}
                    >
                      ห้องประชุม / พื้นที่เช่าจอง (Room)
                    </button>
                    <button 
                      type="button" 
                      className="btn" 
                      style={{ 
                        flex: 1, height: '40px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer',
                        border: itemForm.dbType === 'service' ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                        backgroundColor: itemForm.dbType === 'service' ? 'var(--primary-color)' : 'transparent',
                        color: itemForm.dbType === 'service' ? '#ffffff' : 'var(--text-muted)'
                      }}
                      onClick={() => setItemForm({ ...itemForm, dbType: 'service', category: 'Co-Working' })}
                    >
                      สินค้า / บริการทั่วไป (Service)
                    </button>
                  </div>
                </div>
              )}

              {/* Row 1: Category & Status */}
              <div style={{ display: 'grid', gridTemplateColumns: itemForm.dbType === 'service' ? '1fr 1fr' : '1fr', gap: '16px' }}>
                {itemForm.dbType === 'service' && (
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>ประเภทหมวดหมู่คลัง <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => setIsFormDropdownOpen(!isFormDropdownOpen)}
                        style={{
                          width: '100%',
                          height: '42px',
                          padding: '0 16px',
                          borderRadius: '10px',
                          fontSize: '0.9rem',
                          fontWeight: '500',
                          cursor: 'pointer',
                          border: '1px solid var(--border-color)',
                          background: 'rgba(255, 255, 255, 0.05)',
                          color: 'var(--text-main)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          transition: 'all 0.3s ease'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{getCategoryEmoji(itemForm.category)}</span>
                          <span>{itemForm.category === roomCategoryName ? 'Meeting Room (ห้องประชุม)' : itemForm.category}</span>
                        </span>
                        <ChevronDown size={16} />
                      </button>

                      {isFormDropdownOpen && (
                        <>
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setIsFormDropdownOpen(false)} />
                          <div 
                            className="liquidglass-dropdown"
                            style={{
                              position: 'absolute',
                              top: '46px',
                              left: 0,
                              right: 0,
                              zIndex: 999,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              maxHeight: '200px',
                              overflowY: 'auto'
                            }}
                          >
                            {categories.map(cat => {
                              if (itemForm.dbType === 'service' && cat === roomCategoryName) return null;
                              const isSel = itemForm.category === cat;
                              return (
                                <button
                                  key={cat}
                                  type="button"
                                  onClick={() => {
                                    handleCategoryChange(cat);
                                    setIsFormDropdownOpen(false);
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: isSel ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                                    color: isSel ? 'var(--primary-color)' : 'var(--text-main)',
                                    fontSize: '0.85rem',
                                    fontWeight: isSel ? '700' : '500',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    transition: 'all 0.2s ease'
                                  }}
                                >
                                  <span>{getCategoryEmoji(cat)}</span>
                                  <span>{cat === roomCategoryName ? 'Meeting Room (ห้องประชุม)' : cat}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                 <div className="form-group" style={{ margin: 0, position: 'relative' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>สถานะคลัง</label>
                  <div 
                    className="form-control"
                    onClick={() => setIsStatusFormDropdownOpen(!isStatusFormDropdownOpen)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      height: '42px', 
                      fontSize: '0.9rem', 
                      borderRadius: '10px', 
                      cursor: 'pointer',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-color)',
                      padding: '0 12px',
                      fontWeight: 600
                    }}
                  >
                    <span>
                      {itemForm.status === 'active' ? 'เปิดใช้บริการ/ขายตามปกติ (Active)' : itemForm.status === 'inactive' ? 'ปิดใช้งานชั่วคราว (Inactive)' : itemForm.status}
                    </span>
                    <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />
                  </div>

                  {isStatusFormDropdownOpen && (
                    <>
                      <div onClick={() => setIsStatusFormDropdownOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1999 }} />
                      <div className="liquidglass-dropdown" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 2000, borderRadius: '12px', padding: '6px' }}>
                        <div 
                          onClick={() => { setItemForm({...itemForm, status: 'active'}); setIsStatusFormDropdownOpen(false); }}
                          style={{ padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', color: itemForm.status === 'active' ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: itemForm.status === 'active' ? 'bold' : 'normal', background: itemForm.status === 'active' ? 'rgba(37, 99, 235, 0.15)' : 'transparent', transition: 'all 0.2s', marginBottom: '2px' }}
                          onMouseEnter={e => { if (itemForm.status !== 'active') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                          onMouseLeave={e => { if (itemForm.status !== 'active') e.currentTarget.style.background = 'transparent'; }}
                        >
                          เปิดใช้บริการ/ขายตามปกติ (Active)
                        </div>
                        <div 
                          onClick={() => { setItemForm({...itemForm, status: 'inactive'}); setIsStatusFormDropdownOpen(false); }}
                          style={{ padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', color: itemForm.status === 'inactive' ? 'var(--primary-color)' : 'var(--text-main)', fontWeight: itemForm.status === 'inactive' ? 'bold' : 'normal', background: itemForm.status === 'inactive' ? 'rgba(37, 99, 235, 0.15)' : 'transparent', transition: 'all 0.2s', marginBottom: '2px' }}
                          onMouseEnter={e => { if (itemForm.status !== 'inactive') e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                          onMouseLeave={e => { if (itemForm.status !== 'inactive') e.currentTarget.style.background = 'transparent'; }}
                        >
                          ปิดใช้งานชั่วคราว (Inactive)
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Room Door PIN Codes (Customer & Builtland) */}
              {itemForm.dbType === 'room' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <KeyRound size={14} style={{ color: '#10b981' }} />
                      <span>รหัสเข้าห้องลูกค้าทั่วไป</span>
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="เช่น 393478#"
                      value={itemForm.pin_code || ''}
                      onChange={e => setItemForm({ ...itemForm, pin_code: e.target.value })}
                      style={{ height: '42px', fontSize: '0.9rem', padding: '0 12px', borderRadius: '10px', fontWeight: 'bold', letterSpacing: '1px' }}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      * สำหรับ LINE OA, Walk-in และ Basecamp
                    </span>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#ea580c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Building2 size={14} style={{ color: '#ea580c' }} />
                      <span>รหัสเข้าห้อง Builtland</span>
                    </label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="เช่น 112233#"
                      value={itemForm.builtland_pin_code || ''}
                      onChange={e => setItemForm({ ...itemForm, builtland_pin_code: e.target.value })}
                      style={{ height: '42px', fontSize: '0.9rem', padding: '0 12px', borderRadius: '10px', fontWeight: 'bold', letterSpacing: '1px' }}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                      * เฉพาะพนักงาน Builtland (ไม่ส่งให้ลูกค้าทั่วไป)
                    </span>
                  </div>
                </div>
              )}

              {/* Room Wi-Fi & Hotspot Credentials */}
              {itemForm.dbType === 'room' && (
                <div style={{
                  padding: '16px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(59, 130, 246, 0.04)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#2563eb', display: 'block' }}>
                        การเชื่อมต่อ Wi-Fi & Hotspot ประจำห้อง
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        บัญชีผู้ใช้งานสำหรับระบบ MikroTik Hotspot (แยกต่างหากจากรหัสเปิดประตู)
                      </span>
                    </div>
                    {wifiForm.hasSavedPassword && !wifiForm.clearConfirmed && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (await sysConfirm('คุณต้องการล้างข้อมูลการเชื่อมต่อ Wi-Fi ของห้องนี้ใช่หรือไม่?')) {
                            setWifiForm(prev => ({ ...prev, clearConfirmed: true, username: '', password: '', hasSavedPassword: false }));
                          }
                        }}
                        style={{
                          fontSize: '0.75rem',
                          color: '#ef4444',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        ล้างข้อมูล Wi-Fi
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px', display: 'block' }}>
                        ชื่อผู้ใช้ Wi-Fi (Hotspot Username)
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="เช่น room_101"
                        value={wifiForm.username || ''}
                        onChange={e => setWifiForm({ ...wifiForm, username: e.target.value, clearConfirmed: false })}
                        style={{ height: '40px', fontSize: '0.875rem', padding: '0 12px', borderRadius: '10px' }}
                      />
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
                          รหัสผ่าน Wi-Fi (Hotspot Password)
                        </label>
                        <button
                          type="button"
                          onClick={() => setWifiForm(prev => ({ ...prev, showPassword: !prev.showPassword }))}
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--primary-color)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          {wifiForm.showPassword ? 'ซ่อน' : 'แสดง'}
                        </button>
                      </div>
                      <input
                        type={wifiForm.showPassword ? 'text' : 'password'}
                        className="form-control"
                        placeholder={wifiForm.hasSavedPassword ? 'เว้นว่างไว้หากไม่เปลี่ยนรหัสเดิม' : 'กรอกรหัสผ่าน Wi-Fi'}
                        value={wifiForm.password || ''}
                        onChange={e => setWifiForm({ ...wifiForm, password: e.target.value, clearConfirmed: false })}
                        style={{ height: '40px', fontSize: '0.875rem', padding: '0 12px', borderRadius: '10px' }}
                      />
                      {wifiForm.hasSavedPassword && !wifiForm.password && (
                        <span style={{ fontSize: '0.7rem', color: '#10b981', marginTop: '2px', display: 'block' }}>
                          * มีรหัสผ่านเดิมบันทึกอยู่แล้ว เว้นว่างไว้หากไม่ต้องการเปลี่ยนแปลง
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Image Upload Component */}
              <div className="form-group" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>รูปภาพสินค้า / ห้องประชุม</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '80px', height: '80px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {itemForm.image_url ? (
                      <img src={itemForm.image_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Layers size={24} style={{ opacity: 0.2 }} />
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input 
                        type="file" 
                        accept="image/*" 
                        id="product-image-file" 
                        style={{ display: 'none' }} 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          if (file.size > 3 * 1024 * 1024) {
                            sysAlert('ขนาดรูปภาพเกิน 3MB กรุณาเลือกไฟล์ที่เล็กลง');
                            return;
                          }

                          const reader = new FileReader();
                          reader.onload = async () => {
                            try {
                              const token = localStorage.getItem('token') || localStorage.getItem('pos_token') || '';
                              const res = await fetch(`${API_BASE}/api/upload`, {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                  ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                                },
                                body: JSON.stringify({
                                  imageName: file.name,
                                  base64Data: reader.result,
                                  image: reader.result
                                })
                              });
                              const data = await res.json();
                              if (res.ok && data.url) {
                                setItemForm({ ...itemForm, image_url: data.url });
                              } else {
                                sysAlert(data.error || 'ล้มเหลวในการอัปโหลดรูปภาพ');
                              }
                            } catch (err) {
                              sysAlert('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพไปยังเซิร์ฟเวอร์');
                            }
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.78rem', cursor: 'pointer', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-hover)', color: 'var(--text-main)' }}
                        onClick={() => document.getElementById('product-image-file').click()}
                      >
                        เลือกไฟล์รูปภาพ...
                      </button>
                      {itemForm.image_url && (
                        <button 
                          type="button" 
                          className="btn btn-danger" 
                          style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.78rem', cursor: 'pointer' }}
                          onClick={() => setItemForm({ ...itemForm, image_url: '' })}
                        >
                          ลบรูปภาพ
                        </button>
                      )}
                    </div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      รองรับรูปภาพ JPG, PNG (ขนาดไม่เกิน 3MB)
                    </span>
                  </div>
                </div>
              </div>

              {/* Room Image Focal Point Editor */}
              {itemForm.dbType === 'room' && itemForm.image_url && (
                <div
                  className="room-image-focal-editor"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Crosshair size={16} style={{ color: 'var(--primary-color, #2563eb)' }} />
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)' }}>
                        จัดตำแหน่งจุดโฟกัสรูปห้องประชุม (Confirmation Card Focal Point)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setItemForm(prev => ({ ...prev, image_position_x: 50, image_position_y: 50 }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '0.72rem',
                        color: 'var(--text-muted)',
                        cursor: 'pointer'
                      }}
                      title="รีเซ็ตให้อยู่ตรงกลาง (50% 50%)"
                    >
                      <RotateCcw size={12} />
                      รีเซ็ตตรงกลาง
                    </button>
                  </div>

                  {/* Interactive Visual Preview Box */}
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: '160px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)',
                      backgroundColor: '#0f172a',
                      cursor: 'crosshair',
                      userSelect: 'none'
                    }}
                    onMouseDown={(e) => {
                      setIsFocalDragging(true);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
                      const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)));
                      setItemForm(prev => ({ ...prev, image_position_x: x, image_position_y: y }));
                    }}
                    onMouseMove={(e) => {
                      if (!isFocalDragging) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
                      const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)));
                      setItemForm(prev => ({ ...prev, image_position_x: x, image_position_y: y }));
                    }}
                    onMouseUp={() => setIsFocalDragging(false)}
                    onMouseLeave={() => setIsFocalDragging(false)}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      if (!touch) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.round(Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100)));
                      const y = Math.round(Math.max(0, Math.min(100, ((touch.clientY - rect.top) / rect.height) * 100)));
                      setItemForm(prev => ({ ...prev, image_position_x: x, image_position_y: y }));
                    }}
                    onTouchMove={(e) => {
                      const touch = e.touches[0];
                      if (!touch) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = Math.round(Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100)));
                      const y = Math.round(Math.max(0, Math.min(100, ((touch.clientY - rect.top) / rect.height) * 100)));
                      setItemForm(prev => ({ ...prev, image_position_x: x, image_position_y: y }));
                    }}
                  >
                    {/* Background Room Photo with live focal positioning */}
                    <img
                      src={itemForm.image_url}
                      alt="Room Preview"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: `${itemForm.image_position_x ?? 50}% ${itemForm.image_position_y ?? 50}%`,
                        display: 'block',
                        pointerEvents: 'none'
                      }}
                    />

                    {/* Gradient overlay mimicking confirmation card pass */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(to right, rgba(15, 23, 42, 0.6) 0%, rgba(15, 23, 42, 0.2) 30%, transparent 60%)',
                        pointerEvents: 'none'
                      }}
                    />

                    {/* Reticle / Focal Target Overlay */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `${itemForm.image_position_x ?? 50}%`,
                        top: `${itemForm.image_position_y ?? 50}%`,
                        transform: 'translate(-50%, -50%)',
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        border: '2px solid #ffffff',
                        backgroundColor: 'rgba(37, 99, 235, 0.45)',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 2px 10px rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        transition: isFocalDragging ? 'none' : 'left 0.1s ease, top 0.1s ease'
                      }}
                    >
                      <div
                        style={{
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          backgroundColor: '#ffffff'
                        }}
                      />
                      {/* Crosshair lines */}
                      <div style={{ position: 'absolute', top: -6, bottom: -6, left: '50%', width: '1px', backgroundColor: 'rgba(255,255,255,0.7)', transform: 'translateX(-50%)' }} />
                      <div style={{ position: 'absolute', left: -6, right: -6, top: '50%', height: '1px', backgroundColor: 'rgba(255,255,255,0.7)', transform: 'translateY(-50%)' }} />
                    </div>

                    {/* Coordinates Badge */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        backgroundColor: 'rgba(15, 23, 42, 0.8)',
                        backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: '#f8fafc',
                        pointerEvents: 'none',
                        letterSpacing: '0.02em'
                      }}
                    >
                      {`X: ${itemForm.image_position_x ?? 50}% | Y: ${itemForm.image_position_y ?? 50}%`}
                    </div>
                  </div>

                  {/* Sliders & Fine Controls */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>แนวนอน (X-Axis)</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{itemForm.image_position_x ?? 50}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={itemForm.image_position_x ?? 50}
                        onChange={(e) => setItemForm(prev => ({ ...prev, image_position_x: Number(e.target.value) }))}
                        style={{ width: '100%', accentColor: 'var(--primary-color, #2563eb)', cursor: 'pointer' }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>แนวตั้ง (Y-Axis)</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{itemForm.image_position_y ?? 50}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={itemForm.image_position_y ?? 50}
                        onChange={(e) => setItemForm(prev => ({ ...prev, image_position_y: Number(e.target.value) }))}
                        style={{ width: '100%', accentColor: 'var(--primary-color, #2563eb)', cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    คลิกหรือลากจุดโฟกัสบนรูปภาพ หรือปรับแถบเลื่อน เพื่อจัดตำแหน่งจุดสำคัญของห้องประชุมให้อยู่ในมุมมองที่เหมาะสมบนใบยืนยันการจอง
                  </span>
                </div>
              )}

              {/* Row 2: Name */}
              <div className="form-group" style={{ margin: 0 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 'bold' }}>ชื่อรายการสินค้า / ชื่อห้องประชุม <span style={{ color: 'var(--danger-color)', fontWeight: 'bold' }}>*</span></label>
                <input 
                  type="text" 
                  className="form-control" 
                  placeholder={itemForm.dbType === 'room' ? 'เช่น ห้องประชุม 301, Jupiter' : 'เช่น ของว่าง, บัตรจอดรถเสริม'}
                  required 
                  value={itemForm.name} 
                  onChange={e => setItemForm({...itemForm, name: e.target.value})} 
                  style={{ height: '38px', padding: '6px 10px', borderRadius: '10px', fontSize: '0.85rem' }}
                />
              </div>

              {/* Row 3: Rates / Capacity */}
              {itemForm.dbType === 'room' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  
                  {/* Capacity inline */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.78rem', fontWeight: 'bold' }}>ความจุ (คน)</label>
                      <input type="number" className="form-control" placeholder="เช่น 10" value={itemForm.capacity} onChange={e => setItemForm({...itemForm, capacity: e.target.value})} style={{ height: '38px', padding: '6px 10px', borderRadius: '10px', fontSize: '0.85rem' }} />
                    </div>
                    <div></div>
                  </div>

                  {/* Booking Type Checkboxes - Compact Horizontal */}
                  <label style={{ fontSize: '0.78rem', fontWeight: 'bold', margin: 0 }}>ประเภทการเช่าที่รองรับ <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.7rem' }}>(เลือกอย่างน้อย 1 ประเภท)</span></label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {/* Hourly */}
                    <div style={{ padding: '8px 10px', borderRadius: '10px', backgroundColor: itemForm.has_hourly ? 'rgba(99, 102, 241, 0.06)' : 'transparent', border: `1px solid ${itemForm.has_hourly ? 'rgba(99, 102, 241, 0.25)' : 'var(--border-color)'}`, display: 'flex', flexDirection: 'column', gap: '6px', transition: 'all 0.2s ease' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 700, color: itemForm.has_hourly ? 'var(--primary-color)' : 'var(--text-muted)', margin: 0, fontSize: '0.78rem' }}>
                        <input type="checkbox" checked={itemForm.has_hourly} onChange={e => setItemForm({...itemForm, has_hourly: e.target.checked})} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--primary-color)' }} />
                        รายชั่วโมง
                      </label>
                      {itemForm.has_hourly && (<input type="number" className="form-control" placeholder="บาท/ชม." value={itemForm.price} onChange={e => setItemForm({...itemForm, price: e.target.value})} style={{ height: '32px', padding: '4px 8px', borderRadius: '8px', fontSize: '0.8rem' }} />)}
                    </div>
                    {/* Half-Day */}
                    <div style={{ padding: '8px 10px', borderRadius: '10px', backgroundColor: itemForm.has_halfday ? 'rgba(16, 185, 129, 0.06)' : 'transparent', border: `1px solid ${itemForm.has_halfday ? 'rgba(16, 185, 129, 0.25)' : 'var(--border-color)'}`, display: 'flex', flexDirection: 'column', gap: '6px', transition: 'all 0.2s ease' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 700, color: itemForm.has_halfday ? '#10b981' : 'var(--text-muted)', margin: 0, fontSize: '0.78rem' }}>
                        <input type="checkbox" checked={itemForm.has_halfday} onChange={e => setItemForm({...itemForm, has_halfday: e.target.checked})} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: '#10b981' }} />
                        ครึ่งวัน
                      </label>
                      {itemForm.has_halfday && (<input type="number" className="form-control" placeholder="บาท/ครึ่งวัน" value={itemForm.half_day_rate} onChange={e => setItemForm({...itemForm, half_day_rate: e.target.value})} style={{ height: '32px', padding: '4px 8px', borderRadius: '8px', fontSize: '0.8rem' }} />)}
                    </div>
                    {/* Daily */}
                    <div style={{ padding: '8px 10px', borderRadius: '10px', backgroundColor: itemForm.has_daily ? 'rgba(245, 158, 11, 0.06)' : 'transparent', border: `1px solid ${itemForm.has_daily ? 'rgba(245, 158, 11, 0.25)' : 'var(--border-color)'}`, display: 'flex', flexDirection: 'column', gap: '6px', transition: 'all 0.2s ease' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 700, color: itemForm.has_daily ? '#f59e0b' : 'var(--text-muted)', margin: 0, fontSize: '0.78rem' }}>
                        <input type="checkbox" checked={itemForm.has_daily} onChange={e => setItemForm({...itemForm, has_daily: e.target.checked})} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: '#f59e0b' }} />
                        รายวัน
                      </label>
                      {itemForm.has_daily && (<input type="number" className="form-control" placeholder="บาท/วัน" value={itemForm.daily_rate} onChange={e => setItemForm({...itemForm, daily_rate: e.target.value})} style={{ height: '32px', padding: '4px 8px', borderRadius: '8px', fontSize: '0.8rem' }} />)}
                    </div>
                  </div>
                </div>
              ) : (
                /* Service price */
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.78rem', fontWeight: 'bold' }}>ราคาขายต่อหน่วย (บาท)</label>
                    <input type="number" className="form-control" placeholder="เช่น 50" value={itemForm.price} onChange={e => setItemForm({...itemForm, price: e.target.value})} style={{ height: '38px', padding: '6px 10px', borderRadius: '10px', fontSize: '0.85rem' }} />
                  </div>
                  <div></div>
                </div>
              )}



              {/* Classroom Section */}
              {itemForm.dbType === 'room' && (
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
              {itemForm.dbType === 'room' && (
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

      {/* Category Management Modal */}
      {showManageCategoriesModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div className="card" style={{
            width: '95%',
            maxWidth: '500px',
            padding: '24px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            border: '1px solid var(--glass-border)',
            position: 'relative',
            borderRadius: '24px',
            backgroundColor: 'var(--bg-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            {/* Close button */}
            <button 
              style={{ position: 'absolute', right: '20px', top: '20px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => {
                setShowManageCategoriesModal(false);
                setEditingCatName({ old: '', current: '' });
              }}
            >
              <X size={20} />
            </button>

            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              จัดการประเภทสินค้า/บริการ
            </h2>

            {/* Inline Category Creation Form inside the modal */}
            <form onSubmit={handleCreateCategory} style={{
              display: 'flex',
              gap: '8px',
              borderBottom: '1px solid var(--border-color)',
              paddingBottom: '16px',
              marginBottom: '4px'
            }}>
              <input 
                type="text" 
                className="form-control"
                placeholder="ชื่อประเภท/หมวดหมู่สินค้าใหม่..."
                required
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                style={{ 
                  height: '38px', 
                  padding: '6px 12px', 
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  flex: 1
                }}
              />
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ height: '38px', padding: '0 18px', fontSize: '0.85rem', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Plus size={16} />
                <span>สร้าง</span>
              </button>
            </form>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              maxHeight: '260px',
              overflowY: 'auto',
              paddingRight: '4px'
            }}>
              {categories.map(cat => {
                const isPreset = [roomCategoryName, 'Co-Working', 'Koocafe', 'Parking'].includes(cat);
                const isEditingThis = editingCatName.old === cat;

                return (
                  <div key={cat} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderRadius: '14px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-color)'
                  }}>
                    {isEditingThis ? (
                      <div style={{ display: 'flex', gap: '8px', flex: 1, marginRight: '8px' }}>
                        <input
                          type="text"
                          className="form-control"
                          value={editingCatName.current}
                          onChange={e => setEditingCatName({ ...editingCatName, current: e.target.value })}
                          style={{ height: '36px', padding: '6px 12px', fontSize: '0.85rem', borderRadius: '8px' }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ height: '36px', padding: '0 12px', fontSize: '0.8rem', borderRadius: '8px' }}
                          onClick={handleRenameCategory}
                        >
                          บันทึก
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ height: '36px', padding: '0 12px', fontSize: '0.8rem', borderRadius: '8px' }}
                          onClick={() => setEditingCatName({ old: '', current: '' })}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>{getCategoryEmoji(cat)}</span>
                          <span>{cat}</span>
                          {isPreset && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Preset)</span>}
                        </span>

                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.75rem', borderRadius: '8px', gap: '4px' }}
                            onClick={() => setEditingCatName({ old: cat, current: cat })}
                          >
                            <Edit2 size={12} />
                            <span>แก้ไข</span>
                          </button>
                          {!isPreset && (
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: '6px 10px', fontSize: '0.75rem', borderRadius: '8px', gap: '4px' }}
                              onClick={() => handleDeleteCategory(cat)}
                            >
                              <Trash2 size={12} />
                              <span>ลบ</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <button 
              type="button" 
              className="btn btn-primary" 
              style={{ width: '100%', height: '42px', borderRadius: '12px', marginTop: '8px' }} 
              onClick={() => {
                setShowManageCategoriesModal(false);
                setEditingCatName({ old: '', current: '' });
              }}
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ManagementPanel;
