import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Building2,
  Store,
  FileText,
  AlertTriangle,
  Plus,
  Search,
  Edit2,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  X,
  ArrowRightLeft,
  ShieldAlert,
  Info,
  ChevronRight,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  FileCheck
} from 'lucide-react';
import './CustomerManagement.css';

export default function CustomerManagement({ user, sysAlert, sysConfirm }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));

  // Modals state
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);

  const [showContractModal, setShowContractModal] = useState(false);
  const [contractCustomer, setContractCustomer] = useState(null);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferUnitCustomer, setTransferUnitCustomer] = useState(null);

  // Contract Action sub-mode inside Contract Modal: 'view' | 'renew' | 'terminate'
  const [contractActionTab, setContractActionTab] = useState('view');

  // Alert summary state
  const [alertsSummary, setAlertsSummary] = useState(null);

  // Form states
  const [customerForm, setCustomerForm] = useState({
    customer_type: 'basecamp',
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    tax_id: '',
    address: '',
    basecamp_sub_type: 'office',
    basecamp_unit: '401',
    start_date: '',
    end_date: '',
    monthly_quota_hours: 4.0,
    contract_number: '',
    notes: ''
  });

  const [renewForm, setRenewForm] = useState({
    contract_number: '',
    start_date: '',
    end_date: '',
    monthly_quota_hours: 4.0,
    notes: ''
  });

  const [terminateForm, setTerminateForm] = useState({
    termination_date: '',
    reason: ''
  });

  const [transferForm, setTransferForm] = useState({
    name: '',
    contact_name: '',
    phone: '',
    email: '',
    tax_id: '',
    start_date: '',
    end_date: '',
    monthly_quota_hours: 4.0
  });

  const officeUnits = ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411', '412', '413', '414'];
  const hotdeskUnits = ['419', '420', '421', '422', '427', '428', '429', '430'];

  const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  // Fetch Customers List
  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const qParams = new URLSearchParams({
        type: filterType,
        status: filterStatus,
        q: searchQuery,
        month: selectedMonth,
        year: selectedYear
      });
      const res = await fetch(`/api/customers?${qParams.toString()}`, { headers });
      const data = await res.json();
      if (data.success) {
        setCustomers(data.customers || []);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการโหลดข้อมูลลูกค้า: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Contract Alerts Summary
  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/customers/contracts/alerts', { headers });
      const data = await res.json();
      if (data.success) {
        setAlertsSummary(data);
      }
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchAlerts();
  }, [filterType, filterStatus, selectedMonth, selectedYear]);

  // Handle Search submit / debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Computed summary counts
  const stats = useMemo(() => {
    let basecampCount = 0;
    let shopCount = 0;
    let activeContractCount = 0;

    customers.forEach(c => {
      if (c.customer_type === 'basecamp') basecampCount++;
      if (c.customer_type === 'shop') shopCount++;
      if (c.active_contract && ['ACTIVE', 'EXPIRING'].includes(c.active_contract.evaluated_status)) {
        activeContractCount++;
      }
    });

    return {
      total: customers.length,
      basecamp: basecampCount,
      shop: shopCount,
      activeContracts: activeContractCount,
      expiringAlerts: alertsSummary?.alerts?.length || 0
    };
  }, [customers, alertsSummary]);

  // Open Create Customer Modal
  const handleOpenCreate = () => {
    setEditingCustomer(null);
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 1);
    nextYear.setDate(nextYear.getDate() - 1);

    const todayStr = today.toISOString().slice(0, 10);
    const nextYearStr = nextYear.toISOString().slice(0, 10);

    setCustomerForm({
      customer_type: 'basecamp',
      name: '',
      contact_name: '',
      phone: '',
      email: '',
      tax_id: '',
      address: '',
      basecamp_sub_type: 'office',
      basecamp_unit: '401',
      start_date: todayStr,
      end_date: nextYearStr,
      monthly_quota_hours: 4.0,
      contract_number: '',
      notes: ''
    });
    setShowAddEditModal(true);
  };

  // Open Edit Customer Modal
  const handleOpenEdit = (c) => {
    setEditingCustomer(c);
    setCustomerForm({
      customer_type: c.customer_type,
      name: c.name || '',
      contact_name: c.contact_name || '',
      phone: c.phone || '',
      email: c.email || '',
      tax_id: c.tax_id || '',
      address: c.address || '',
      basecamp_sub_type: c.basecamp_sub_type || 'office',
      basecamp_unit: c.basecamp_unit || '401',
      start_date: '',
      end_date: '',
      monthly_quota_hours: 4.0,
      contract_number: '',
      notes: ''
    });
    setShowAddEditModal(true);
  };

  // Submit Add or Edit Customer
  const handleSubmitCustomerForm = async (e) => {
    e.preventDefault();
    if (!customerForm.name.trim()) {
      if (sysAlert) sysAlert('กรุณาระบุชื่อลูกค้าหรือชื่อร้านค้า', 'warning');
      return;
    }

    try {
      if (editingCustomer) {
        // Update
        const res = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(customerForm)
        });
        const data = await res.json();
        if (data.success) {
          if (sysAlert) sysAlert('บันทึกการแก้ไขข้อมูลเรียบร้อยแล้ว', 'success');
          setShowAddEditModal(false);
          fetchCustomers();
        } else {
          if (sysAlert) sysAlert(data.error || 'บันทึกไม่สำเร็จ', 'error');
        }
      } else {
        // Create
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers,
          body: JSON.stringify(customerForm)
        });
        const data = await res.json();
        if (data.success) {
          if (sysAlert) sysAlert('สร้างข้อมูลลูกค้าและสัญญาเรียบร้อยแล้ว', 'success');
          setShowAddEditModal(false);
          fetchCustomers();
          fetchAlerts();
        } else {
          if (sysAlert) sysAlert(data.error || 'สร้างไม่สำเร็จ', 'error');
        }
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Toggle Customer Active/Inactive
  const handleToggleStatus = async (c) => {
    const nextStatus = c.status === 'active' ? 'inactive' : 'active';
    const actionLabel = nextStatus === 'active' ? 'เปิดใช้งาน' : 'ปิดการใช้งาน (Inactive)';

    const confirmMsg = `คุณต้องการ${actionLabel}ลูกค้ารายนี้ (${c.name}) ใช่หรือไม่?`;
    if (sysConfirm) {
      const ok = await sysConfirm(confirmMsg);
      if (!ok) return;
    }

    try {
      const res = await fetch(`/api/customers/${c.id}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert(data.message, 'success');
        fetchCustomers();
      } else {
        if (sysAlert) sysAlert(data.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Open Contract Lifecycle Modal
  const handleOpenContractModal = async (c) => {
    try {
      const res = await fetch(`/api/customers/${c.id}`, { headers });
      const data = await res.json();
      if (data.success) {
        setContractCustomer(data.customer);
        setContractActionTab('view');

        // Pre-fill renew form defaults
        const today = new Date();
        const nextYear = new Date();
        nextYear.setFullYear(today.getFullYear() + 1);
        nextYear.setDate(nextYear.getDate() - 1);

        setRenewForm({
          contract_number: '',
          start_date: today.toISOString().slice(0, 10),
          end_date: nextYear.toISOString().slice(0, 10),
          monthly_quota_hours: c.customer_type === 'shop' ? 4.0 : (c.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0),
          notes: ''
        });

        setTerminateForm({
          termination_date: today.toISOString().slice(0, 10),
          reason: ''
        });

        setShowContractModal(true);
      }
    } catch (err) {
      if (sysAlert) sysAlert('ไม่สามารถโหลดรายละเอียดสัญญาได้: ' + err.message, 'error');
    }
  };

  // Submit Renew Contract
  const handleSubmitRenew = async (e) => {
    e.preventDefault();
    if (!contractCustomer) return;

    try {
      const res = await fetch(`/api/customers/${contractCustomer.id}/contracts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(renewForm)
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('บันทึกสัญญาใหม่/ต่อสัญญาเรียบร้อยแล้ว', 'success');
        setShowContractModal(false);
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถต่อสัญญาได้', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Submit Terminate Contract
  const handleSubmitTerminate = async (e) => {
    e.preventDefault();
    if (!contractCustomer || !contractCustomer.contracts?.[0]) return;
    const activeContract = contractCustomer.contracts[0];

    const ok = sysConfirm ? await sysConfirm(`ยืนยันการยกเลิกสัญญา ${activeContract.contract_number} ก่อนกำหนด?`) : true;
    if (!ok) return;

    try {
      const res = await fetch(`/api/customers/contracts/${activeContract.id}/terminate`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(terminateForm)
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('ยกเลิกสัญญาเรียบร้อยแล้ว', 'success');
        setShowContractModal(false);
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'ยกเลิกสัญญาไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Open Transfer Unit Modal (Basecamp only)
  const handleOpenTransferModal = (c) => {
    setTransferUnitCustomer(c);
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 1);
    nextYear.setDate(nextYear.getDate() - 1);

    setTransferForm({
      name: '',
      contact_name: '',
      phone: '',
      email: '',
      tax_id: '',
      start_date: today.toISOString().slice(0, 10),
      end_date: nextYear.toISOString().slice(0, 10),
      monthly_quota_hours: c.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0
    });
    setShowTransferModal(true);
  };

  // Submit Transfer Unit
  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    if (!transferUnitCustomer || !transferForm.name.trim()) {
      if (sysAlert) sysAlert('กรุณาระบุชื่อผู้เช่ารายใหม่', 'warning');
      return;
    }

    const ok = sysConfirm
      ? await sysConfirm(`ยืนยันการเปลี่ยนผู้เช่ายูนิต ${transferUnitCustomer.basecamp_unit} เป็น "${transferForm.name}"? ผู้เช่าเดิมจะถูกปิดสถานะ และยอดใช้โควต้าจะแยกจากกันอย่างเด็ดขาด`)
      : true;
    if (!ok) return;

    try {
      const res = await fetch('/api/customers/transfer-unit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          basecamp_unit: transferUnitCustomer.basecamp_unit,
          new_tenant: {
            name: transferForm.name,
            contact_name: transferForm.contact_name,
            phone: transferForm.phone,
            email: transferForm.email,
            tax_id: transferForm.tax_id,
            basecamp_sub_type: transferUnitCustomer.basecamp_sub_type
          },
          new_contract: {
            start_date: transferForm.start_date,
            end_date: transferForm.end_date,
            monthly_quota_hours: transferForm.monthly_quota_hours
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert(data.message, 'success');
        setShowTransferModal(false);
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'เปลี่ยนผู้เช่าไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  return (
    <div className="cust-mgmt-container">
      {/* 1. Header */}
      <div className="cust-mgmt-header">
        <div className="cust-mgmt-title-group">
          <h2>
            <Users size={22} color="#2563eb" />
            ระบบจัดการลูกค้า สัญญา และโควต้าห้องประชุม
          </h2>
          <div className="cust-mgmt-subtitle">
            Customer, Shop & Contract Administration Console (Basecamp & Partner Shops)
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="cust-btn-primary"
            onClick={handleOpenCreate}
          >
            <Plus size={16} />
            <span>เพิ่มลูกค้า / ร้านค้าใหม่</span>
          </button>
        </div>
      </div>

      {/* 2. Stat Cards Grid */}
      <div className="cust-stat-grid">
        <div className="cust-stat-card">
          <div className="cust-stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#2563eb' }}>
            <Users size={22} />
          </div>
          <div className="cust-stat-info">
            <span className="cust-stat-value">{stats.total}</span>
            <span className="cust-stat-label">ลูกค้าทั้งหมดในระบบ</span>
          </div>
        </div>

        <div className="cust-stat-card">
          <div className="cust-stat-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#4f46e5' }}>
            <Building2 size={22} />
          </div>
          <div className="cust-stat-info">
            <span className="cust-stat-value">{stats.basecamp}</span>
            <span className="cust-stat-label">ผู้เช่า Basecamp ชั้น 4</span>
          </div>
        </div>

        <div className="cust-stat-card">
          <div className="cust-stat-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#059669' }}>
            <Store size={22} />
          </div>
          <div className="cust-stat-info">
            <span className="cust-stat-value">{stats.shop}</span>
            <span className="cust-stat-label">ร้านค้าพันธมิตร (Shop)</span>
          </div>
        </div>

        <div className="cust-stat-card">
          <div className="cust-stat-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#d97706' }}>
            <FileCheck size={22} />
          </div>
          <div className="cust-stat-info">
            <span className="cust-stat-value">{stats.activeContracts}</span>
            <span className="cust-stat-label">สัญญาที่มีผล (Active)</span>
          </div>
        </div>

        {stats.expiringAlerts > 0 && (
          <div className="cust-stat-card" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.04)' }}>
            <div className="cust-stat-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#dc2626' }}>
              <AlertTriangle size={22} />
            </div>
            <div className="cust-stat-info">
              <span className="cust-stat-value" style={{ color: '#dc2626' }}>{stats.expiringAlerts}</span>
              <span className="cust-stat-label" style={{ color: '#b91c1c', fontWeight: 700 }}>สัญญาใกล้หมด/หมดอายุ</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. Filter Bar */}
      <div className="cust-filter-bar">
        <div className="cust-filter-left">
          {/* Search box */}
          <div className="cust-search-input-wrapper">
            <Search size={16} />
            <input
              type="text"
              className="cust-search-input"
              placeholder="ค้นหาชื่อลูกค้า, ผู้ติดต่อ, เบอร์โทร, ยูนิต..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Type Pill Filter */}
          <div className="cust-pill-group">
            <button
              type="button"
              className={`cust-filter-pill ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              className={`cust-filter-pill ${filterType === 'basecamp' ? 'active' : ''}`}
              onClick={() => setFilterType('basecamp')}
            >
              Basecamp
            </button>
            <button
              type="button"
              className={`cust-filter-pill ${filterType === 'shop' ? 'active' : ''}`}
              onClick={() => setFilterType('shop')}
            >
              Shop
            </button>
          </div>

          {/* Status Pill Filter */}
          <div className="cust-pill-group">
            <button
              type="button"
              className={`cust-filter-pill ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => setFilterStatus('all')}
            >
              ทุกสถานะ
            </button>
            <button
              type="button"
              className={`cust-filter-pill ${filterStatus === 'active' ? 'active' : ''}`}
              onClick={() => setFilterStatus('active')}
            >
              เปิดใช้งาน (Active)
            </button>
            <button
              type="button"
              className={`cust-filter-pill ${filterStatus === 'inactive' ? 'active' : ''}`}
              onClick={() => setFilterStatus('inactive')}
            >
              ปิดการใช้งาน
            </button>
          </div>
        </div>

        {/* Quota Month/Year Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>ดูโควต้ารอบเดือน:</span>
          <select
            className="cust-form-select"
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.82rem' }}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
              <option key={m} value={String(m)}>เดือน {m}</option>
            ))}
          </select>
          <select
            className="cust-form-select"
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.82rem' }}
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
          >
            <option value="2025">2025</option>
            <option value="2026">2026</option>
            <option value="2027">2027</option>
          </select>
        </div>
      </div>

      {/* 4. Customers Table */}
      <div className="cust-table-card">
        <div className="cust-table-wrapper">
          <table className="cust-table">
            <thead>
              <tr>
                <th>ประเภท / ยูนิต</th>
                <th>ชื่อบริษัท / ร้านค้า</th>
                <th>ข้อมูลผู้ติดต่อ</th>
                <th>สัญญาและการแจ้งเตือน</th>
                <th>โควต้าห้องประชุม (เดือน {selectedMonth}/{selectedYear})</th>
                <th>สถานะ</th>
                <th style={{ textAlign: 'right' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px' }}>
                    <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto', color: '#3b82f6' }} />
                    <div style={{ marginTop: '10px', color: 'var(--text-muted)' }}>กำลังโหลดข้อมูลลูกค้า...</div>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const activeContract = c.active_contract;
                  const quota = c.quota || { max_quota: 4.0, used_quota: 0, remaining_quota: 4.0 };
                  const percentUsed = quota.max_quota > 0 ? Math.min(100, Math.round((quota.used_quota / quota.max_quota) * 100)) : 0;
                  const barColor = percentUsed >= 100 ? '#ef4444' : (percentUsed >= 60 ? '#f59e0b' : '#10b981');

                  return (
                    <tr key={c.id}>
                      {/* Type / Unit */}
                      <td>
                        {c.customer_type === 'basecamp' ? (
                          <span className="cust-type-badge basecamp">
                            <Building2 size={13} />
                            {c.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : 'Office'} {c.basecamp_unit || '-'}
                          </span>
                        ) : (
                          <span className="cust-type-badge shop">
                            <Store size={13} />
                            Shop (ร้านค้า)
                          </span>
                        )}
                      </td>

                      {/* Name */}
                      <td>
                        <div style={{ fontWeight: 800, color: 'var(--text-main)', fontSize: '0.94rem' }}>
                          {c.name}
                        </div>
                        {c.tax_id && (
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            TAX: {c.tax_id}
                          </div>
                        )}
                      </td>

                      {/* Contact Info */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.8rem' }}>
                          {c.contact_name && <span style={{ fontWeight: 600 }}>{c.contact_name}</span>}
                          {c.phone && (
                            <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Phone size={11} /> {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Mail size={11} /> {c.email}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Contract & Alerts */}
                      <td>
                        {activeContract ? (
                          <div className="cust-contract-pill">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{activeContract.contract_number}</span>
                              <span className={`cust-urgency-badge ${activeContract.urgency}`}>
                                {activeContract.evaluated_status === 'ACTIVE' && 'Active'}
                                {activeContract.evaluated_status === 'EXPIRING' && `เตือน (${activeContract.days_left} วัน)`}
                                {activeContract.evaluated_status === 'EXPIRED' && 'หมดสัญญา'}
                                {activeContract.evaluated_status === 'TERMINATED' && 'ยกเลิกแล้ว'}
                              </span>
                            </div>
                            <span className="cust-contract-dates">
                              {activeContract.start_date} → {activeContract.end_date}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            ไม่มีสัญญาที่ใช้งาน
                          </span>
                        )}
                      </td>

                      {/* Monthly Quota */}
                      <td>
                        <div className="cust-quota-box">
                          <div className="cust-quota-labels">
                            <span>ใช้แล้ว: {quota.used_quota} ชม.</span>
                            <span style={{ color: quota.remaining_quota === 0 ? '#ef4444' : '#10b981' }}>
                              เหลือ: {quota.remaining_quota} ชม.
                            </span>
                          </div>
                          <div className="cust-quota-bar-track">
                            <div
                              className="cust-quota-bar-fill"
                              style={{ width: `${percentUsed}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            สิทธิ์สูงสุด: {quota.max_quota} ชม./เดือน ({quota.booking_count} ใบจอง)
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`cust-status-badge ${c.status}`}>
                          {c.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="cust-action-group" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="cust-btn-action"
                            title="แก้ไขข้อมูล"
                            onClick={() => handleOpenEdit(c)}
                          >
                            <Edit2 size={13} />
                            <span>แก้ไข</span>
                          </button>

                          <button
                            type="button"
                            className="cust-btn-action primary"
                            title="จัดการสัญญา"
                            onClick={() => handleOpenContractModal(c)}
                          >
                            <FileText size={13} />
                            <span>สัญญา</span>
                          </button>

                          {c.customer_type === 'basecamp' && (
                            <button
                              type="button"
                              className="cust-btn-action"
                              title="เปลี่ยนผู้เช่ายูนิตนี้"
                              onClick={() => handleOpenTransferModal(c)}
                            >
                              <ArrowRightLeft size={13} />
                              <span>เปลี่ยนผู้เช่า</span>
                            </button>
                          )}

                          <button
                            type="button"
                            className="cust-btn-action"
                            style={{ color: c.status === 'active' ? '#ef4444' : '#10b981' }}
                            title={c.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                            onClick={() => handleToggleStatus(c)}
                          >
                            {c.status === 'active' ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
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

      {/* ===================================================
          MODAL 1: CREATE / EDIT CUSTOMER
          =================================================== */}
      {showAddEditModal && (
        <div className="cust-modal-overlay">
          <div className="cust-modal-dialog">
            <div className="cust-modal-header">
              <h3>
                {editingCustomer ? <Edit2 size={18} color="#2563eb" /> : <Plus size={18} color="#2563eb" />}
                {editingCustomer ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้า / ร้านค้าใหม่'}
              </h3>
              <button
                type="button"
                className="cust-modal-close-btn"
                onClick={() => setShowAddEditModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitCustomerForm}>
              <div className="cust-modal-body">
                {/* Customer Type Selector (Only on create) */}
                {!editingCustomer && (
                  <div className="cust-form-group">
                    <label>ประเภทลูกค้า <span className="required">*</span></label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <button
                        type="button"
                        className={`cust-filter-pill ${customerForm.customer_type === 'basecamp' ? 'active' : ''}`}
                        style={{ padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        onClick={() => {
                          setCustomerForm({
                            ...customerForm,
                            customer_type: 'basecamp',
                            monthly_quota_hours: customerForm.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0
                          });
                        }}
                      >
                        <Building2 size={16} />
                        Basecamp (ผู้เช่าชั้น 4)
                      </button>

                      <button
                        type="button"
                        className={`cust-filter-pill ${customerForm.customer_type === 'shop' ? 'active' : ''}`}
                        style={{ padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                        onClick={() => {
                          setCustomerForm({
                            ...customerForm,
                            customer_type: 'shop',
                            monthly_quota_hours: 4.0
                          });
                        }}
                      >
                        <Store size={16} />
                        Shop (ร้านค้าพันธมิตร)
                      </button>
                    </div>
                  </div>
                )}

                {/* Basecamp unit selection */}
                {customerForm.customer_type === 'basecamp' && (
                  <div className="cust-form-row">
                    <div className="cust-form-group">
                      <label>ประเภทยูนิต</label>
                      <select
                        className="cust-form-select"
                        value={customerForm.basecamp_sub_type}
                        onChange={(e) => {
                          const sub = e.target.value;
                          setCustomerForm({
                            ...customerForm,
                            basecamp_sub_type: sub,
                            basecamp_unit: sub === 'office' ? '401' : '419',
                            monthly_quota_hours: sub === 'office' ? 4.0 : 2.0
                          });
                        }}
                      >
                        <option value="office">Office (โควต้า 4 ชม./เดือน)</option>
                        <option value="hotdesk">Hotdesk (โควต้า 2 ชม./เดือน)</option>
                      </select>
                    </div>

                    <div className="cust-form-group">
                      <label>เลขยูนิตชั้น 4</label>
                      <select
                        className="cust-form-select"
                        value={customerForm.basecamp_unit}
                        onChange={(e) => setCustomerForm({ ...customerForm, basecamp_unit: e.target.value })}
                      >
                        {customerForm.basecamp_sub_type === 'office'
                          ? officeUnits.map(u => <option key={u} value={u}>Office {u}</option>)
                          : hotdeskUnits.map(u => <option key={u} value={u}>Hotdesk {u}</option>)
                        }
                      </select>
                    </div>
                  </div>
                )}

                {/* Company / Shop Name */}
                <div className="cust-form-group">
                  <label>
                    {customerForm.customer_type === 'shop' ? 'ชื่อร้านค้าพันธมิตร' : 'ชื่อบริษัท / ผู้เช่า'}
                    <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    className="cust-form-input"
                    placeholder="เช่น บจก. เทคโนโลยีล้ำเลิศ หรือ Koo.Koo Cafe"
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    required
                  />
                </div>

                {/* Contact info row */}
                <div className="cust-form-row">
                  <div className="cust-form-group">
                    <label>ชื่อผู้ติดต่อประสานงาน</label>
                    <input
                      type="text"
                      className="cust-form-input"
                      placeholder="เช่น คุณสมชาย จัดการดี"
                      value={customerForm.contact_name}
                      onChange={(e) => setCustomerForm({ ...customerForm, contact_name: e.target.value })}
                    />
                  </div>

                  <div className="cust-form-group">
                    <label>เบอร์โทรศัพท์</label>
                    <input
                      type="tel"
                      className="cust-form-input"
                      placeholder="08X-XXX-XXXX"
                      value={customerForm.phone}
                      onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                {/* Email and Tax ID row */}
                <div className="cust-form-row">
                  <div className="cust-form-group">
                    <label>อีเมล</label>
                    <input
                      type="email"
                      className="cust-form-input"
                      placeholder="contact@company.com"
                      value={customerForm.email}
                      onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                    />
                  </div>

                  <div className="cust-form-group">
                    <label>เลขประจำตัวผู้เสียภาษี (Tax ID)</label>
                    <input
                      type="text"
                      className="cust-form-input"
                      placeholder="13 หลัก"
                      value={customerForm.tax_id}
                      onChange={(e) => setCustomerForm({ ...customerForm, tax_id: e.target.value })}
                    />
                  </div>
                </div>

                {/* Address */}
                <div className="cust-form-group">
                  <label>ที่อยู่สำหรับการออกเอกสาร</label>
                  <textarea
                    rows={2}
                    className="cust-form-textarea"
                    placeholder="ที่อยู่บริษัท..."
                    value={customerForm.address}
                    onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                  />
                </div>

                {/* Initial Contract Section (Only on create) */}
                {!editingCustomer && (
                  <div style={{ background: 'var(--bg-main)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.86rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Calendar size={15} color="#2563eb" />
                      <span>ข้อมูลสัญญาเริ่มต้น (Initial Contract)</span>
                    </div>

                    <div className="cust-form-row">
                      <div className="cust-form-group">
                        <label>วันเริ่มสัญญา <span className="required">*</span></label>
                        <input
                          type="date"
                          className="cust-form-input"
                          value={customerForm.start_date}
                          onChange={(e) => setCustomerForm({ ...customerForm, start_date: e.target.value })}
                          required
                        />
                      </div>

                      <div className="cust-form-group">
                        <label>วันสิ้นสุดสัญญา <span className="required">*</span></label>
                        <input
                          type="date"
                          className="cust-form-input"
                          value={customerForm.end_date}
                          onChange={(e) => setCustomerForm({ ...customerForm, end_date: e.target.value })}
                          required
                        />
                      </div>
                    </div>

                    <div className="cust-form-row">
                      <div className="cust-form-group">
                        <label>โควต้าห้องประชุม (ชั่วโมง/เดือน)</label>
                        <input
                          type="number"
                          step="0.5"
                          className="cust-form-input"
                          value={customerForm.monthly_quota_hours}
                          onChange={(e) => setCustomerForm({ ...customerForm, monthly_quota_hours: parseFloat(e.target.value) || 0 })}
                          required
                        />
                      </div>

                      <div className="cust-form-group">
                        <label>หมายเลขสัญญา (เว้นว่างเพื่อสร้างอัตโนมัติ)</label>
                        <input
                          type="text"
                          className="cust-form-input"
                          placeholder="เช่น CTR-2026-001"
                          value={customerForm.contract_number}
                          onChange={(e) => setCustomerForm({ ...customerForm, contract_number: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="cust-modal-footer">
                <button
                  type="button"
                  className="cust-btn-secondary"
                  onClick={() => setShowAddEditModal(false)}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="cust-btn-primary"
                >
                  {editingCustomer ? 'บันทึกการแก้ไข' : 'สร้างลูกค้าใหม่'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL 2: CONTRACT LIFECYCLE & AUDIT TRAIL
          =================================================== */}
      {showContractModal && contractCustomer && (
        <div className="cust-modal-overlay">
          <div className="cust-modal-dialog large">
            <div className="cust-modal-header">
              <div>
                <h3>
                  <FileText size={18} color="#2563eb" />
                  จัดการสัญญา — {contractCustomer.name}
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {contractCustomer.customer_type === 'basecamp' ? `Basecamp Unit ${contractCustomer.basecamp_unit}` : 'Shop Partner'}
                </div>
              </div>
              <button
                type="button"
                className="cust-modal-close-btn"
                onClick={() => setShowContractModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Sub-nav tabs */}
            <div style={{ display: 'flex', gap: '8px', padding: '10px 22px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
              <button
                type="button"
                className={`cust-filter-pill ${contractActionTab === 'view' ? 'active' : ''}`}
                onClick={() => setContractActionTab('view')}
              >
                ประวัติสัญญา ({contractCustomer.contracts?.length || 0})
              </button>
              <button
                type="button"
                className={`cust-filter-pill ${contractActionTab === 'renew' ? 'active' : ''}`}
                onClick={() => setContractActionTab('renew')}
              >
                + ต่อสัญญาใหม่ (Renew)
              </button>
              {contractCustomer.contracts?.[0]?.status === 'ACTIVE' && (
                <button
                  type="button"
                  className={`cust-filter-pill ${contractActionTab === 'terminate' ? 'active' : ''}`}
                  onClick={() => setContractActionTab('terminate')}
                  style={{ color: contractActionTab === 'terminate' ? '#ffffff' : '#ef4444' }}
                >
                  ยกเลิกสัญญาก่อนกำหนด
                </button>
              )}
            </div>

            <div className="cust-modal-body">
              {contractActionTab === 'view' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Active Contract Card */}
                  {contractCustomer.contracts?.[0] ? (
                    <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>สัญญาปัจจุบัน:</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{contractCustomer.contracts[0].contract_number}</div>
                          <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            ระยะเวลา: {contractCustomer.contracts[0].start_date} ถึง {contractCustomer.contracts[0].end_date}
                          </div>
                        </div>

                        <span className={`cust-urgency-badge ${contractCustomer.contracts[0].urgency}`}>
                          {contractCustomer.contracts[0].evaluated_status} ({contractCustomer.contracts[0].days_left} วัน)
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '20px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-color)', fontSize: '0.84rem' }}>
                        <div>โควต้า: <strong>{contractCustomer.contracts[0].monthly_quota_hours} ชม./เดือน</strong></div>
                        {contractCustomer.contracts[0].notes && (
                          <div>หมายเหตุ: <span style={{ color: 'var(--text-muted)' }}>{contractCustomer.contracts[0].notes}</span></div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="cust-alert-box info">
                      <Info size={16} />
                      <div>ลูกค้ารายนี้ยังไม่มีสัญญาที่บันทึกไว้ในระบบ กรุณาใช้ปุ่ม "+ ต่อสัญญาใหม่" เพื่อสร้างสัญญา</div>
                    </div>
                  )}

                  {/* Previous Contracts Table */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem' }}>ประวัติสัญญาทั้งหมด</h4>
                    <table className="cust-table" style={{ fontSize: '0.82rem' }}>
                      <thead>
                        <tr>
                          <th>เลขสัญญา</th>
                          <th>วันเริ่ม - สิ้นสุด</th>
                          <th>โควต้า</th>
                          <th>สถานะ</th>
                          <th>หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractCustomer.contracts?.map((ctr) => (
                          <tr key={ctr.id}>
                            <td style={{ fontWeight: 700 }}>{ctr.contract_number}</td>
                            <td>{ctr.start_date} → {ctr.end_date}</td>
                            <td>{ctr.monthly_quota_hours} ชม./ด.</td>
                            <td>
                              <span className={`cust-urgency-badge ${ctr.urgency}`}>
                                {ctr.evaluated_status}
                              </span>
                            </td>
                            <td style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{ctr.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Audit Logs */}
                  {contractCustomer.audit_logs?.length > 0 && (
                    <div>
                      <h4 style={{ margin: '14px 0 10px 0', fontSize: '0.9rem' }}>ประวัติการแก้ไขและ Audit Log</h4>
                      <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '8px' }}>
                        {contractCustomer.audit_logs.map((log) => (
                          <div key={log.id} style={{ fontSize: '0.76rem', padding: '6px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                            <div>
                              <strong style={{ color: '#2563eb' }}>{log.action}</strong> โดย {log.performed_by}
                              <div style={{ color: 'var(--text-muted)' }}>{log.details}</div>
                            </div>
                            <div style={{ color: 'var(--text-muted)' }}>{log.created_at}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Renew Form */}
              {contractActionTab === 'renew' && (
                <form onSubmit={handleSubmitRenew} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="cust-alert-box info">
                    <Info size={16} />
                    <div>การต่อสัญญาจะสร้างสัญญาฉบับใหม่และคงประวัติสัญญาเดิมไว้ในประวัติอย่างครบถ้วน</div>
                  </div>

                  <div className="cust-form-row">
                    <div className="cust-form-group">
                      <label>วันเริ่มสัญญาใหม่ <span className="required">*</span></label>
                      <input
                        type="date"
                        className="cust-form-input"
                        value={renewForm.start_date}
                        onChange={(e) => setRenewForm({ ...renewForm, start_date: e.target.value })}
                        required
                      />
                    </div>

                    <div className="cust-form-group">
                      <label>วันสิ้นสุดสัญญาใหม่ <span className="required">*</span></label>
                      <input
                        type="date"
                        className="cust-form-input"
                        value={renewForm.end_date}
                        onChange={(e) => setRenewForm({ ...renewForm, end_date: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="cust-form-row">
                    <div className="cust-form-group">
                      <label>โควต้าห้องประชุม (ชั่วโมง/เดือน)</label>
                      <input
                        type="number"
                        step="0.5"
                        className="cust-form-input"
                        value={renewForm.monthly_quota_hours}
                        onChange={(e) => setRenewForm({ ...renewForm, monthly_quota_hours: parseFloat(e.target.value) || 0 })}
                        required
                      />
                    </div>

                    <div className="cust-form-group">
                      <label>หมายเลขสัญญา (เว้นว่างเพื่อสร้างอัตโนมัติ)</label>
                      <input
                        type="text"
                        className="cust-form-input"
                        placeholder="เช่น CTR-BC-401-2027"
                        value={renewForm.contract_number}
                        onChange={(e) => setRenewForm({ ...renewForm, contract_number: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="cust-form-group">
                    <label>หมายเหตุ</label>
                    <textarea
                      rows={2}
                      className="cust-form-textarea"
                      placeholder="เช่น ต่อสัญญาปีที่ 2 เงื่อนไขโปรโมชั่นเดิม..."
                      value={renewForm.notes}
                      onChange={(e) => setRenewForm({ ...renewForm, notes: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                    <button
                      type="button"
                      className="cust-btn-secondary"
                      onClick={() => setContractActionTab('view')}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      className="cust-btn-primary"
                    >
                      ยืนยันการต่อสัญญา
                    </button>
                  </div>
                </form>
              )}

              {/* Terminate Form */}
              {contractActionTab === 'terminate' && (
                <form onSubmit={handleSubmitTerminate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="cust-alert-box warning">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>คำเตือน:</strong> การยกเลิกสัญญาก่อนกำหนดจะเปลี่ยนสถานะเป็น TERMINATED และลูกค้ารายนี้จะไม่สามารถใช้สิทธิ์โควต้าฟรีได้อีก
                    </div>
                  </div>

                  <div className="cust-form-group">
                    <label>วันที่มีผลยกเลิกสัญญา <span className="required">*</span></label>
                    <input
                      type="date"
                      className="cust-form-input"
                      value={terminateForm.termination_date}
                      onChange={(e) => setTerminateForm({ ...terminateForm, termination_date: e.target.value })}
                      required
                    />
                  </div>

                  <div className="cust-form-group">
                    <label>เหตุผลในการยกเลิกสัญญา <span className="required">*</span></label>
                    <textarea
                      rows={3}
                      className="cust-form-textarea"
                      placeholder="ระบุเหตุผล เช่น ย้ายสถานที่ประกอบการ, ไม่ต่อสัญญา..."
                      value={terminateForm.reason}
                      onChange={(e) => setTerminateForm({ ...terminateForm, reason: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                    <button
                      type="button"
                      className="cust-btn-secondary"
                      onClick={() => setContractActionTab('view')}
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="submit"
                      className="cust-btn-primary"
                      style={{ background: '#dc2626' }}
                    >
                      ยืนยันการยกเลิกสัญญานี้
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          MODAL 3: TRANSFER BASECAMP TENANT
          =================================================== */}
      {showTransferModal && transferUnitCustomer && (
        <div className="cust-modal-overlay">
          <div className="cust-modal-dialog">
            <div className="cust-modal-header">
              <h3>
                <ArrowRightLeft size={18} color="#2563eb" />
                เปลี่ยนผู้เช่ายูนิต {transferUnitCustomer.basecamp_unit}
              </h3>
              <button
                type="button"
                className="cust-modal-close-btn"
                onClick={() => setShowTransferModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitTransfer}>
              <div className="cust-modal-body">
                <div className="cust-alert-box info">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>การแยกประวัติอย่างปลอดภัย:</strong><br />
                    ผู้เช่าเดิม (<strong>{transferUnitCustomer.name}</strong>) จะถูกปรับสถานะเป็น Inactive และยุติสัญญาเดิม โดยยอดใช้โควต้าและประวัติการจองของผู้เช่าเดิมจะไม่ถูกโอนมายังผู้เช่ารายใหม่
                  </div>
                </div>

                <div className="cust-form-group">
                  <label>ชื่อบริษัท / ผู้เช่ารายใหม่ <span className="required">*</span></label>
                  <input
                    type="text"
                    className="cust-form-input"
                    placeholder="ชื่อผู้เช่ารายใหม่..."
                    value={transferForm.name}
                    onChange={(e) => setTransferForm({ ...transferForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="cust-form-row">
                  <div className="cust-form-group">
                    <label>ชื่อผู้ติดต่อ</label>
                    <input
                      type="text"
                      className="cust-form-input"
                      placeholder="คุณสมศักดิ์..."
                      value={transferForm.contact_name}
                      onChange={(e) => setTransferForm({ ...transferForm, contact_name: e.target.value })}
                    />
                  </div>

                  <div className="cust-form-group">
                    <label>เบอร์โทรศัพท์</label>
                    <input
                      type="tel"
                      className="cust-form-input"
                      placeholder="08X-XXX-XXXX"
                      value={transferForm.phone}
                      onChange={(e) => setTransferForm({ ...transferForm, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="cust-form-row">
                  <div className="cust-form-group">
                    <label>อีเมล</label>
                    <input
                      type="email"
                      className="cust-form-input"
                      value={transferForm.email}
                      onChange={(e) => setTransferForm({ ...transferForm, email: e.target.value })}
                    />
                  </div>

                  <div className="cust-form-group">
                    <label>เลขประจำตัวผู้เสียภาษี</label>
                    <input
                      type="text"
                      className="cust-form-input"
                      value={transferForm.tax_id}
                      onChange={(e) => setTransferForm({ ...transferForm, tax_id: e.target.value })}
                    />
                  </div>
                </div>

                <div className="cust-form-row">
                  <div className="cust-form-group">
                    <label>วันเริ่มสัญญาใหม่ <span className="required">*</span></label>
                    <input
                      type="date"
                      className="cust-form-input"
                      value={transferForm.start_date}
                      onChange={(e) => setTransferForm({ ...transferForm, start_date: e.target.value })}
                      required
                    />
                  </div>

                  <div className="cust-form-group">
                    <label>วันสิ้นสุดสัญญาใหม่ <span className="required">*</span></label>
                    <input
                      type="date"
                      className="cust-form-input"
                      value={transferForm.end_date}
                      onChange={(e) => setTransferForm({ ...transferForm, end_date: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="cust-modal-footer">
                <button
                  type="button"
                  className="cust-btn-secondary"
                  onClick={() => setShowTransferModal(false)}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="cust-btn-primary"
                >
                  ยืนยันการเปลี่ยนผู้เช่า
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
