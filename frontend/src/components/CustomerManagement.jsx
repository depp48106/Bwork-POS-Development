import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  ChevronLeft,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  FileCheck,
  CalendarDays,
  History,
  ShieldCheck,
  Check,
  AlertCircle,
  FileClock,
  Sparkles,
  BarChart3,
  User
} from 'lucide-react';
import ThaiDatePicker from './ThaiDatePicker';
import {
  formatThaiDate,
  formatThaiDateTime,
  getThaiDateInputHint
} from '../utils/thaiDateHelper';
import './CustomerManagement.css';

export default function CustomerManagement({ user, sysAlert, sysConfirm }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'basecamp' | 'shop'
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'active' | 'inactive'
  const [searchQuery, setSearchQuery] = useState('');

  // Month & Year state for Quota calculation
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));

  // Modals & Unified Dialog State
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editModalTab, setEditModalTab] = useState('profile'); // 'profile' | 'contracts' | 'quota'
  const [contractSubTab, setContractSubTab] = useState('overview'); // 'overview' | 'edit_dates' | 'renew'
  const [contractToEdit, setContractToEdit] = useState(null);
  const [editDateStep, setEditDateStep] = useState('input'); // 'input' | 'confirm'
  const [showTerminateInline, setShowTerminateInline] = useState(false);

  // Rich Customer Detail State (Contracts, Quota, Audit Logs)
  const [customerDetail, setCustomerDetail] = useState(null);
  const [loadingCustomerDetail, setLoadingCustomerDetail] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Basecamp Transfer Modal
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferUnitCustomer, setTransferUnitCustomer] = useState(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const [editDateForm, setEditDateForm] = useState({
    start_date: '',
    end_date: '',
    reason: ''
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

  const initialCustomerFormRef = useRef(null);
  const initialContractEditRef = useRef(null);

  const officeUnits = ['401', '402', '403', '404', '405', '406', '407', '408', '409', '410', '411', '412', '413', '414'];
  const hotdeskUnits = ['419', '420', '421', '422', '427', '428', '429', '430'];

  const token = localStorage.getItem('pos_token') || localStorage.getItem('token') || '';
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const isAdmin = Boolean(
    user && (user.role === 'admin' || user.username === 'admin')
  );

  const canManageContracts = Boolean(
    isAdmin || (user && String(user.permissions || '').split(',').map(p => p.trim()).some(p => ['manage', 'admin-management'].includes(p)))
  );

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
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถโหลดข้อมูลลูกค้าได้', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + err.message, 'error');
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
        setAlertsSummary(data.summary);
      }
    } catch (_) {}
  };

  // Fetch Audit Logs for Customer
  const fetchAuditLogs = async (customerId) => {
    if (!customerId || !isAdmin) return;
    setLoadingAudit(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/audit-logs`, { headers });
      const data = await res.json();
      if (data.success) {
        setAuditLogs(data.audit_logs || []);
      }
    } catch (_) {
    } finally {
      setLoadingAudit(false);
    }
  };

  // Fetch Detailed Customer Profile (with contracts & quota)
  const fetchCustomerDetail = async (customerId, monthVal = selectedMonth, yearVal = selectedYear) => {
    if (!customerId) return;
    setLoadingCustomerDetail(true);
    try {
      const res = await fetch(`/api/customers/${customerId}?month=${monthVal}&year=${yearVal}`, { headers });
      const data = await res.json();
      if (res.ok && data.success) {
        const fullCust = data.customer;
        setCustomerDetail(fullCust);
        const activeCtr = fullCust.contracts?.[0] || null;
        setContractToEdit(activeCtr);
        if (activeCtr) {
          const initEdit = {
            start_date: activeCtr.start_date || '',
            end_date: activeCtr.end_date || '',
            reason: ''
          };
          initialContractEditRef.current = initEdit;
          setEditDateForm(initEdit);
        } else {
          initialContractEditRef.current = null;
        }

        const today = new Date();
        const nextYear = new Date();
        nextYear.setFullYear(today.getFullYear() + 1);
        nextYear.setDate(nextYear.getDate() - 1);

        setRenewForm({
          contract_number: '',
          start_date: today.toISOString().slice(0, 10),
          end_date: nextYear.toISOString().slice(0, 10),
          monthly_quota_hours: fullCust.customer_type === 'shop' ? 4.0 : (fullCust.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0),
          notes: ''
        });

        setTerminateForm({
          termination_date: today.toISOString().slice(0, 10),
          reason: ''
        });

        if (isAdmin && fullCust.audit_logs) {
          setAuditLogs(fullCust.audit_logs);
        }
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถโหลดรายละเอียดสัญญาและโควตาได้', 'error');
      }
    } catch (err) {
      console.error('Fetch customer detail error:', err);
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการโหลดรายละเอียดสัญญา: ' + err.message, 'error');
    } finally {
      setLoadingCustomerDetail(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchAlerts();
  }, [filterType, filterStatus, selectedMonth, selectedYear]);

  // Handle Search Debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Calculate Summary Cards
  const summaryCards = useMemo(() => {
    const total = customers.length;
    let active = 0;
    let expiring = 0;
    let expired = 0;

    customers.forEach(c => {
      if (c.active_contract) {
        const st = c.active_contract.evaluated_status;
        if (st === 'ACTIVE') active++;
        else if (st === 'EXPIRING') expiring++;
        else if (st === 'EXPIRED') expired++;
      }
    });

    if (alertsSummary) {
      expiring = alertsSummary.expiring_soon_count;
      expired = alertsSummary.expired_count;
    }

    return { total, active, expiring, expired };
  }, [customers, alertsSummary]);

  // Check if Customer Form has unsaved modifications
  const isCustomerFormDirty = () => {
    if (!initialCustomerFormRef.current) return false;
    const init = initialCustomerFormRef.current;
    return (
      (customerForm.name || '') !== (init.name || '') ||
      (customerForm.contact_name || '') !== (init.contact_name || '') ||
      (customerForm.phone || '') !== (init.phone || '') ||
      (customerForm.email || '') !== (init.email || '') ||
      (customerForm.tax_id || '') !== (init.tax_id || '') ||
      (customerForm.address || '') !== (init.address || '') ||
      (customerForm.notes || '') !== (init.notes || '') ||
      customerForm.customer_type !== init.customer_type ||
      customerForm.basecamp_sub_type !== init.basecamp_sub_type ||
      customerForm.basecamp_unit !== init.basecamp_unit ||
      (customerForm.start_date || '') !== (init.start_date || '') ||
      (customerForm.end_date || '') !== (init.end_date || '') ||
      (customerForm.contract_number || '') !== (init.contract_number || '') ||
      Number(customerForm.monthly_quota_hours) !== Number(init.monthly_quota_hours)
    );
  };

  // Check if Contract Form has unsaved changes
  const isContractFormDirty = () => {
    if (contractSubTab === 'edit_dates') {
      if (!initialContractEditRef.current) return false;
      const init = initialContractEditRef.current;
      return (
        editDateForm.start_date !== init.start_date ||
        editDateForm.end_date !== init.end_date ||
        (editDateForm.reason || '').trim() !== ''
      );
    }
    if (contractSubTab === 'renew') {
      return (
        (renewForm.contract_number || '').trim() !== '' ||
        (renewForm.notes || '').trim() !== ''
      );
    }
    return false;
  };

  // Safe Close for Customer Modal (prompts if dirty)
  const handleRequestCloseAddEditModal = async () => {
    const dirty = isCustomerFormDirty() || isContractFormDirty();
    if (dirty) {
      const msg = 'คุณมีข้อมูลที่ยังไม่ได้บันทึก ต้องการยกเลิกและปิดหน้าต่างนี้หรือไม่?\n(ข้อมูลที่คุณกรอกไว้จะไม่ได้รับการบันทึก)';
      let confirmed = false;
      if (sysConfirm) {
        confirmed = await sysConfirm(msg);
      } else {
        confirmed = window.confirm(msg);
      }
      if (!confirmed) return;
    }
    setShowAddEditModal(false);
    setEditingCustomer(null);
    setCustomerDetail(null);
    initialCustomerFormRef.current = null;
    initialContractEditRef.current = null;
    setContractSubTab('overview');
    setShowTerminateInline(false);
    setEditDateStep('input');
  };

  // Global Escape key listener
  useEffect(() => {
    const handleEscapeKey = (e) => {
      if (e.key === 'Escape') {
        if (showAddEditModal) {
          handleRequestCloseAddEditModal();
        } else if (showTransferModal) {
          setShowTransferModal(false);
        }
      }
    };
    window.addEventListener('keydown', handleEscapeKey, true);
    return () => window.removeEventListener('keydown', handleEscapeKey, true);
  }, [showAddEditModal, showTransferModal, customerForm, editingCustomer, contractSubTab, editDateForm, renewForm]);

  // Open Create Customer Modal
  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setCustomerDetail(null);
    setEditModalTab('profile');
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 1);
    nextYear.setDate(nextYear.getDate() - 1);

    const initialData = {
      customer_type: filterType === 'shop' ? 'shop' : 'basecamp',
      name: '',
      contact_name: '',
      phone: '',
      email: '',
      tax_id: '',
      address: '',
      basecamp_sub_type: 'office',
      basecamp_unit: '401',
      start_date: today.toISOString().slice(0, 10),
      end_date: nextYear.toISOString().slice(0, 10),
      monthly_quota_hours: 4.0,
      contract_number: '',
      notes: ''
    };
    initialCustomerFormRef.current = initialData;
    setCustomerForm(initialData);
    setShowAddEditModal(true);
  };

  // Open Unified Modal for Existing Customer (Profile, Contracts, or Quota)
  const handleOpenEdit = async (c, defaultTab = 'profile') => {
    setEditingCustomer(c);
    setEditModalTab(defaultTab);
    setContractSubTab('overview');
    setShowTerminateInline(false);
    setEditDateStep('input');

    // Pre-populate initial fallback customerDetail from table row
    setCustomerDetail({
      ...c,
      contracts: c.active_contract ? [c.active_contract] : [],
      quota: c.quota_summary || null
    });

    const initialData = {
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
      notes: c.notes || ''
    };
    initialCustomerFormRef.current = initialData;
    setCustomerForm(initialData);
    setShowAddEditModal(true);

    // Fetch authoritative customer details (contracts, quota, audit)
    fetchCustomerDetail(c.id);
  };

  // Alias for backward compatibility: opens unified modal directly to contracts tab
  const handleOpenContractDrawer = (c, defaultSubTab = 'overview') => {
    handleOpenEdit(c, 'contracts');
    setContractSubTab(defaultSubTab);
  };

  // Start Edit Dates for a Specific Contract
  const handleStartEditDates = (ctr) => {
    if (ctr.status === 'TERMINATED') {
      if (sysAlert) sysAlert('ไม่สามารถแก้ไขวันที่ของสัญญาที่ถูกยกเลิก (TERMINATED) แล้วได้ หากต้องการเปิดสัญญาใหม่ กรุณาใช้ฟังก์ชันต่อสัญญา (Renew)', 'warning');
      return;
    }
    const initEdit = {
      start_date: ctr.start_date || '',
      end_date: ctr.end_date || '',
      reason: ''
    };
    initialContractEditRef.current = initEdit;
    setContractToEdit(ctr);
    setEditDateForm(initEdit);
    setEditDateStep('input');
    setContractSubTab('edit_dates');
  };

  // Step 1 to Step 2 validation in Edit Dates
  const handleProceedToConfirmEdit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!contractToEdit) return;

    if (!editDateForm.start_date || !editDateForm.end_date) {
      if (sysAlert) sysAlert('กรุณาระบุวันเริ่มสัญญาและวันสิ้นสุดสัญญาให้ครบถ้วนในปฏิทินไทย', 'warning');
      return;
    }
    if (editDateForm.start_date > editDateForm.end_date) {
      if (sysAlert) sysAlert('วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา', 'warning');
      return;
    }
    if (!editDateForm.reason.trim()) {
      if (sysAlert) sysAlert('กรุณาระบุเหตุผลในการแก้ไขวันที่สัญญา (จำเป็นต้องบันทึกใน Audit Log)', 'warning');
      return;
    }

    setEditDateStep('confirm');
  };

  // Submit Edit Contract Dates
  const handleConfirmSubmitEdit = async () => {
    if (!contractToEdit || !editingCustomer) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/customers/contracts/${contractToEdit.id}/dates`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          start_date: editDateForm.start_date,
          end_date: editDateForm.end_date,
          reason: editDateForm.reason.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('บันทึกการแก้ไขวันที่สัญญาและบันทึกประวัติเรียบร้อยแล้ว', 'success');
        await fetchCustomerDetail(editingCustomer.id);
        setEditDateStep('input');
        setContractSubTab('overview');
        initialContractEditRef.current = null;
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถแก้ไขวันที่สัญญาได้', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Renew Contract
  const handleSubmitRenew = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editingCustomer) return;

    if (!renewForm.start_date || !renewForm.end_date) {
      if (sysAlert) sysAlert('กรุณาระบุวันเริ่มและสิ้นสุดสัญญาในปฏิทินไทย', 'warning');
      return;
    }
    if (renewForm.start_date > renewForm.end_date) {
      if (sysAlert) sysAlert('วันเริ่มสัญญาต้องไม่มากกว่าวันสิ้นสุดสัญญา', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/customers/${editingCustomer.id}/contracts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(renewForm)
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('บันทึกสัญญาใหม่/ต่อสัญญาเรียบร้อยแล้ว', 'success');
        await fetchCustomerDetail(editingCustomer.id);
        setContractSubTab('overview');
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถต่อสัญญาได้', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Terminate Contract
  const handleSubmitTerminate = async (e) => {
    e.preventDefault();
    if (!customerDetail || !customerDetail.contracts?.[0]) return;
    const activeContract = customerDetail.contracts[0];

    const ok = sysConfirm ? await sysConfirm(`ยืนยันการยกเลิกสัญญา ${activeContract.contract_number} ก่อนกำหนด?`) : true;
    if (!ok) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/customers/contracts/${activeContract.id}/terminate`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(terminateForm)
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('ยกเลิกสัญญาเรียบร้อยแล้ว', 'success');
        setShowTerminateInline(false);
        await fetchCustomerDetail(editingCustomer.id);
        setContractSubTab('overview');
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'ยกเลิกสัญญาไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Add or Edit Customer Profile
  const handleSubmitCustomerForm = async (e) => {
    e.preventDefault();
    if (!customerForm.name.trim()) {
      if (sysAlert) sysAlert('กรุณาระบุชื่อลูกค้าหรือชื่อร้านค้า', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingCustomer) {
        const res = await fetch(`/api/customers/${editingCustomer.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(customerForm)
        });
        const data = await res.json();
        if (data.success) {
          if (sysAlert) sysAlert('บันทึกการแก้ไขข้อมูลลูกค้าเรียบร้อยแล้ว', 'success');
          initialCustomerFormRef.current = { ...customerForm };
          await fetchCustomerDetail(editingCustomer.id);
          fetchCustomers();
        } else {
          if (sysAlert) sysAlert(data.error || 'บันทึกไม่สำเร็จ', 'error');
        }
      } else {
        const res = await fetch('/api/customers', {
          method: 'POST',
          headers,
          body: JSON.stringify(customerForm)
        });
        const data = await res.json();
        if (data.success) {
          if (sysAlert) sysAlert('สร้างข้อมูลลูกค้าและสัญญาเรียบร้อยแล้ว', 'success');
          initialCustomerFormRef.current = null;
          setShowAddEditModal(false);
          fetchCustomers();
          fetchAlerts();
        } else {
          if (sysAlert) sysAlert(data.error || 'สร้างไม่สำเร็จ', 'error');
        }
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Customer Active/Inactive
  const handleToggleStatus = async (c) => {
    const nextStatus = c.status === 'active' ? 'inactive' : 'active';
    const actionLabel = nextStatus === 'active' ? 'เปิดใช้งาน' : 'ปิดการใช้งาน (Inactive)';
    const ok = sysConfirm ? await sysConfirm(`ต้องการ ${actionLabel} ลูกค้า "${c.name}" หรือไม่?`) : true;
    if (!ok) return;

    try {
      const res = await fetch(`/api/customers/${c.id}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert(`เปลี่ยนสถานะเป็น ${actionLabel} เรียบร้อยแล้ว`, 'success');
        fetchCustomers();
      } else {
        if (sysAlert) sysAlert(data.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Delete Customer (Admin Only)
  const handleDeleteCustomer = async (c) => {
    if (!isAdmin) return;
    const ok = sysConfirm ? await sysConfirm(`คำเตือน: คุณต้องการลบข้อมูลลูกค้า "${c.name}" ออกจากระบบถาวรหรือไม่?\n(ระบบจะลบประวัติสัญญาที่เกี่ยวข้องทั้งหมด)`) : false;
    if (!ok) return;

    try {
      const res = await fetch(`/api/customers/${c.id}`, {
        method: 'DELETE',
        headers
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('ลบข้อมูลลูกค้าเรียบร้อยแล้ว', 'success');
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'ลบข้อมูลไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Transfer Basecamp Unit Modal Handlers
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

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    if (!transferUnitCustomer) return;
    if (!transferForm.name.trim()) {
      if (sysAlert) sysAlert('กรุณาระบุชื่อผู้เช่ารายใหม่', 'warning');
      return;
    }

    const ok = sysConfirm ? await sysConfirm(`ยืนยันการเปลี่ยนผู้เช่ายูนิต ${transferUnitCustomer.basecamp_unit} จาก "${transferUnitCustomer.name}" เป็น "${transferForm.name}"?`) : true;
    if (!ok) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/customers/transfer-unit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          unit_number: transferUnitCustomer.basecamp_unit,
          basecamp_sub_type: transferUnitCustomer.basecamp_sub_type,
          previous_customer_id: transferUnitCustomer.id,
          new_customer: transferForm
        })
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert(`เปลี่ยนผู้เช่ายูนิต ${transferUnitCustomer.basecamp_unit} สำเร็จเรียบร้อยแล้ว`, 'success');
        setShowTransferModal(false);
        setTransferUnitCustomer(null);
        fetchCustomers();
        fetchAlerts();
      } else {
        if (sysAlert) sysAlert(data.error || 'เปลี่ยนผู้เช่าไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="crm-container">
      {/* 1. Header & Quick Actions */}
      <div className="crm-header-row">
        <div>
          <h1 className="crm-title">จัดการข้อมูลลูกค้า & สัญญา (Customer & Contracts)</h1>
          <p className="crm-subtitle">
            จัดการข้อมูลผู้เช่า Basecamp, ร้านค้าพันธมิตร (Shop), โควต้าการจองห้องประชุม และสัญญาเช่า
          </p>
        </div>

        <div className="crm-header-actions">
          <button
            type="button"
            className="crm-btn-primary"
            onClick={handleOpenCreate}
            id="btn-add-customer"
          >
            <Plus size={16} />
            <span>เพิ่มลูกค้า / ร้านค้าใหม่</span>
          </button>
        </div>
      </div>

      {/* 2. Sleek Summary Metrics Strip */}
      <div className="crm-metrics-strip">
        <div className="crm-metric-card">
          <div className="crm-metric-icon-wrap total">
            <Users size={18} />
          </div>
          <div className="crm-metric-content">
            <div className="crm-metric-val">{summaryCards.total}</div>
            <div className="crm-metric-label">ลูกค้าทั้งหมดในระบบ</div>
          </div>
        </div>

        <div className="crm-metric-card">
          <div className="crm-metric-icon-wrap active">
            <FileCheck size={18} />
          </div>
          <div className="crm-metric-content">
            <div className="crm-metric-val active">{summaryCards.active}</div>
            <div className="crm-metric-label">สัญญาปกติ (Active)</div>
          </div>
        </div>

        <div className={`crm-metric-card ${summaryCards.expiring > 0 ? 'alert-warning' : ''}`}>
          <div className="crm-metric-icon-wrap warning">
            <AlertTriangle size={18} />
          </div>
          <div className="crm-metric-content">
            <div className="crm-metric-val warning">{summaryCards.expiring}</div>
            <div className="crm-metric-label">สัญญาใกล้หมดอายุ (≤30 วัน)</div>
          </div>
        </div>

        <div className={`crm-metric-card ${summaryCards.expired > 0 ? 'alert-danger' : ''}`}>
          <div className="crm-metric-icon-wrap danger">
            <XCircle size={18} />
          </div>
          <div className="crm-metric-content">
            <div className="crm-metric-val danger">{summaryCards.expired}</div>
            <div className="crm-metric-label">สัญญาหมดอายุแล้ว (Expired)</div>
          </div>
        </div>
      </div>

      {/* 3. Filter Bar */}
      <div className="crm-filter-bar">
        <div className="crm-filter-left">
          {/* Search Box */}
          <div className="crm-search-box">
            <Search size={16} className="crm-search-icon" />
            <input
              type="text"
              className="crm-search-input"
              placeholder="ค้นหาชื่อลูกค้า, ผู้ติดต่อ, เบอร์โทร, เลขยูนิต..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="crm-search-clear"
                onClick={() => setSearchQuery('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Type Filter */}
          <div className="crm-segment-control">
            <button
              type="button"
              className={`crm-segment-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              className={`crm-segment-btn ${filterType === 'basecamp' ? 'active' : ''}`}
              onClick={() => setFilterType('basecamp')}
            >
              Basecamp
            </button>
            <button
              type="button"
              className={`crm-segment-btn ${filterType === 'shop' ? 'active' : ''}`}
              onClick={() => setFilterType('shop')}
            >
              Shop
            </button>
          </div>

          {/* Status Filter */}
          <div className="crm-segment-control">
            <button
              type="button"
              className={`crm-segment-btn ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => setFilterStatus('all')}
            >
              ทุกสถานะ
            </button>
            <button
              type="button"
              className={`crm-segment-btn ${filterStatus === 'active' ? 'active' : ''}`}
              onClick={() => setFilterStatus('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={`crm-segment-btn ${filterStatus === 'inactive' ? 'active' : ''}`}
              onClick={() => setFilterStatus('inactive')}
            >
              Inactive
            </button>
          </div>
        </div>

        {/* Quota Month Context Selector */}
        <div className="crm-filter-right">
          <div className="crm-month-picker-wrap">
            <span className="crm-month-lbl">รอบโควต้า:</span>
            <select
              className="crm-select-compact"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m)}>
                  {new Date(2026, m - 1, 1).toLocaleDateString('th-TH', { month: 'short' })}
                </option>
              ))}
            </select>
            <select
              className="crm-select-compact"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {['2025', '2026', '2027', '2028'].map(y => (
                <option key={y} value={y}>พ.ศ. {parseInt(y) + 543}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 4. Customer Table */}
      <div className="crm-table-container">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>ลูกค้า / ร้านค้า</th>
                <th style={{ width: '12%' }}>ยูนิต / ประเภท</th>
                <th style={{ width: '18%' }}>ข้อมูลติดต่อ</th>
                <th style={{ width: '20%' }}>สถานะสัญญา (พ.ศ.)</th>
                <th style={{ width: '16%' }}>โควต้าห้องประชุม</th>
                <th style={{ width: '6%' }}>สถานะ</th>
                <th style={{ width: '12%', textAlign: 'right' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="crm-table-placeholder">
                    <RefreshCw size={24} className="crm-spin" />
                    <span>กำลังโหลดข้อมูลลูกค้า...</span>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="crm-table-placeholder">
                    <Users size={32} />
                    <span>ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก</span>
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const activeContract = c.active_contract || null;
                  const quota = c.quota_summary || {
                    max_quota: 0,
                    used_quota: 0,
                    remaining_quota: 0,
                    booking_count: 0
                  };
                  const percentUsed = quota.max_quota > 0
                    ? Math.min(100, Math.round((quota.used_quota / quota.max_quota) * 100))
                    : 0;
                  const barColor = percentUsed >= 90 ? '#ef4444' : percentUsed >= 50 ? '#f59e0b' : '#10b981';

                  return (
                    <tr key={c.id}>
                      {/* Name & Type */}
                      <td>
                        <div className="crm-cust-cell">
                          <div className="crm-cust-name-row">
                            <span className="crm-cust-name" onClick={() => handleOpenEdit(c, 'profile')} title="คลิกเพื่อแก้ไขข้อมูลลูกค้า">
                              {c.name}
                            </span>
                            {c.customer_type === 'shop' ? (
                              <span className="crm-badge shop"><Store size={10} /> Shop</span>
                            ) : (
                              <span className="crm-badge basecamp"><Building2 size={10} /> Basecamp</span>
                            )}
                          </div>
                          {c.contact_name && (
                            <div className="crm-cust-contact-name">ผู้ติดต่อ: {c.contact_name}</div>
                          )}
                        </div>
                      </td>

                      {/* Unit / Subtype */}
                      <td>
                        {c.customer_type === 'basecamp' ? (
                          <div className="crm-unit-pill">
                            <span className="unit-tag">{c.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : 'Office'}</span>
                            <strong className="unit-number">{c.basecamp_unit || '-'}</strong>
                          </div>
                        ) : (
                          <span className="crm-shop-location">ร้านค้าพันธมิตร</span>
                        )}
                      </td>

                      {/* Contact Info */}
                      <td>
                        <div className="crm-contact-cell">
                          {c.phone && (
                            <div className="crm-contact-item">
                              <Phone size={12} />
                              <span>{c.phone}</span>
                            </div>
                          )}
                          {c.email && (
                            <div className="crm-contact-item">
                              <Mail size={12} />
                              <span className="crm-ellipsis">{c.email}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Contract Info with True Thai BE Date */}
                      <td style={{ cursor: 'pointer' }} onClick={() => handleOpenEdit(c, 'contracts')} title="คลิกเพื่อเปิดแท็บสัญญา">
                        {activeContract ? (
                          <div className="crm-contract-cell">
                            <div className="crm-contract-row-top">
                              <span className="crm-contract-code">{activeContract.contract_number}</span>
                              <span className={`crm-urgency-tag ${activeContract.urgency}`}>
                                {activeContract.evaluated_status === 'ACTIVE' && 'Active'}
                                {activeContract.evaluated_status === 'EXPIRING' && `เตือน (${activeContract.days_left} วัน)`}
                                {activeContract.evaluated_status === 'EXPIRED' && 'หมดสัญญา'}
                                {activeContract.evaluated_status === 'TERMINATED' && 'ยกเลิกแล้ว'}
                              </span>
                            </div>
                            <div className="crm-contract-date-highlight">
                              สิ้นสุด: <strong>{formatThaiDate(activeContract.end_date)}</strong>
                            </div>
                            <div className="crm-contract-date-sub">
                              ({formatThaiDate(activeContract.start_date)} – {formatThaiDate(activeContract.end_date)})
                            </div>
                          </div>
                        ) : (
                          <span className="crm-no-contract-pill">ไม่มีสัญญาที่ใช้งาน</span>
                        )}
                      </td>

                      {/* Quota Progress */}
                      <td style={{ cursor: 'pointer' }} onClick={() => handleOpenEdit(c, 'quota')} title="คลิกเพื่อดูรายละเอียดโควตา">
                        <div className="crm-quota-box">
                          <div className="crm-quota-numbers">
                            <span className="crm-quota-used">ใช้ {quota.used_quota} ชม.</span>
                            <span className="crm-quota-rem" style={{ color: quota.remaining_quota === 0 ? '#ef4444' : '#059669' }}>
                              เหลือ {quota.remaining_quota} ชม.
                            </span>
                          </div>
                          <div className="crm-quota-track">
                            <div
                              className="crm-quota-bar"
                              style={{ width: `${percentUsed}%`, backgroundColor: barColor }}
                            />
                          </div>
                          <div className="crm-quota-foot">
                            สิทธิ์ {quota.max_quota} ชม./ด. ({quota.booking_count} การจอง)
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`crm-status-dot-badge ${c.status}`}>
                          <span className="dot" />
                          {c.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="crm-action-btn-group">
                          {/* Manage Contract Tab Shortcut */}
                          <button
                            type="button"
                            className="crm-action-btn primary"
                            title="เปิดระบบจัดการสัญญาและวันที่"
                            onClick={() => handleOpenEdit(c, 'contracts')}
                          >
                            <FileText size={13} />
                            <span>สัญญา</span>
                          </button>

                          {/* Edit Customer Profile Tab Shortcut */}
                          <button
                            type="button"
                            className="crm-action-btn secondary"
                            title="แก้ไขข้อมูลลูกค้า"
                            onClick={() => handleOpenEdit(c, 'profile')}
                          >
                            <Edit2 size={13} />
                          </button>

                          {/* Basecamp Unit Transfer */}
                          {c.customer_type === 'basecamp' && (
                            <button
                              type="button"
                              className="crm-action-btn secondary"
                              title="เปลี่ยนผู้เช่ายูนิตนี้"
                              onClick={() => handleOpenTransferModal(c)}
                            >
                              <ArrowRightLeft size={13} />
                            </button>
                          )}

                          {/* Toggle Active / Inactive */}
                          <button
                            type="button"
                            className={`crm-action-btn ${c.status === 'active' ? 'toggle-active' : 'toggle-inactive'}`}
                            title={c.status === 'active' ? 'ปิดการใช้งานลูกค้า' : 'เปิดการใช้งานลูกค้า'}
                            onClick={() => handleToggleStatus(c)}
                          >
                            {c.status === 'active' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          </button>

                          {/* Admin Only Delete */}
                          {isAdmin && (
                            <button
                              type="button"
                              className="crm-action-btn danger"
                              title="ลบข้อมูลลูกค้าถาวร (Admin Only)"
                              onClick={() => handleDeleteCustomer(c)}
                            >
                              <X size={13} />
                            </button>
                          )}
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

      {/* =========================================================================
          UNIFIED MODAL: EDIT CUSTOMER / CONTRACTS / QUOTA (OR CREATE CUSTOMER)
          ========================================================================= */}
      {showAddEditModal && (
        <div className="crm-modal-backdrop">
          <div
            className={`crm-modal-dialog crm-modal-dialog-wide ${editingCustomer ? 'edit-mode' : ''}`}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: editingCustomer ? '980px' : '1100px' }}
          >
            {/* Modal Header */}
            <div className="crm-modal-header">
              <div className="crm-modal-title">
                <div className="crm-modal-icon-badge">
                  {editingCustomer ? (
                    editModalTab === 'contracts' ? <FileText size={18} /> : editModalTab === 'quota' ? <Clock size={18} /> : <User size={18} />
                  ) : (
                    <Plus size={18} />
                  )}
                </div>
                <div>
                  <h3>
                    {editingCustomer ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span>{editingCustomer.name}</span>
                        {editingCustomer.customer_type === 'basecamp' ? (
                          <span className="crm-badge basecamp" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                            <Building2 size={11} /> {editingCustomer.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : 'Office'} {editingCustomer.basecamp_unit}
                          </span>
                        ) : (
                          <span className="crm-badge shop" style={{ fontSize: '0.72rem', padding: '2px 8px' }}>
                            <Store size={11} /> Partner Shop
                          </span>
                        )}
                        <span className={`crm-status-dot-badge ${editingCustomer.status}`} style={{ fontSize: '0.72rem' }}>
                          <span className="dot" />
                          {editingCustomer.status === 'active' ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                    ) : (
                      'เพิ่มลูกค้า / ร้านค้าใหม่'
                    )}
                  </h3>
                  <p className="crm-modal-subtitle">
                    {editingCustomer
                      ? (editModalTab === 'profile'
                          ? 'แก้ไขข้อมูลผู้เช่า ข้อมูลติดต่อ และรายละเอียดทั่วไป'
                          : editModalTab === 'contracts'
                            ? 'จัดการสัญญาเช่า วันที่เริ่ม/สิ้นสุด การต่อสัญญา และประวัติสัญญา'
                            : 'ตรวจสอบโควต้าการใช้งานห้องประชุม สิทธิประโยชน์ และเงื่อนไขตามสัญญา')
                      : 'กรอกข้อมูลผู้เช่าและกำหนดระยะเวลาสัญญาเริ่มต้นเพื่อเปิดใช้งานระบบ'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="crm-modal-close-btn"
                onClick={handleRequestCloseAddEditModal}
                title="ปิดหน้าต่าง"
              >
                <X size={18} />
              </button>
            </div>

            {/* Segmented Modal Tab Bar (Only when Editing an Existing Customer) */}
            {editingCustomer && (
              <div className="crm-modal-tabs-bar">
                <button
                  type="button"
                  className={`crm-modal-tab-btn ${editModalTab === 'profile' ? 'active' : ''}`}
                  onClick={() => setEditModalTab('profile')}
                >
                  <User size={15} />
                  <span>ข้อมูลลูกค้า</span>
                  {isCustomerFormDirty() && (
                    <span className="crm-modal-tab-badge amber" title="มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก">•</span>
                  )}
                </button>

                <button
                  type="button"
                  className={`crm-modal-tab-btn ${editModalTab === 'contracts' ? 'active' : ''}`}
                  onClick={() => setEditModalTab('contracts')}
                >
                  <FileText size={15} />
                  <span>สัญญา</span>
                  <span className="crm-modal-tab-badge">
                    {customerDetail?.contracts?.length || editingCustomer.contracts?.length || (editingCustomer.active_contract ? 1 : 0)}
                  </span>
                </button>

                <button
                  type="button"
                  className={`crm-modal-tab-btn ${editModalTab === 'quota' ? 'active' : ''}`}
                  onClick={() => setEditModalTab('quota')}
                >
                  <Clock size={15} />
                  <span>โควตาการใช้งาน</span>
                  <span className="crm-modal-tab-badge green">
                    {customerDetail?.quota?.remaining_hours ?? editingCustomer.quota_summary?.remaining_quota ?? 0} ชม.
                  </span>
                </button>
              </div>
            )}

            {/* TAB 1: Customer Profile (OR Full Creation Form if !editingCustomer) */}
            {(!editingCustomer || editModalTab === 'profile') && (
              <form onSubmit={handleSubmitCustomerForm} className="crm-modal-form">
                <div className="crm-modal-body">
                  <div className={`crm-wide-modal-grid ${editingCustomer ? 'edit-mode' : ''}`}>
                    {/* SECTION 1: ข้อมูลผู้เช่า / บริษัท */}
                    <div className="crm-modal-section-card">
                      <div className="crm-section-headline">
                        <Building2 size={16} />
                        <span>ส่วนที่ 1: ข้อมูลผู้เช่า / บริษัท</span>
                      </div>

                      {!editingCustomer && (
                        <div className="crm-form-group">
                          <label className="crm-form-label">ประเภทลูกค้า <span className="req">*</span></label>
                          <div className="crm-type-selector-grid">
                            <button
                              type="button"
                              className={`crm-type-select-btn ${customerForm.customer_type === 'basecamp' ? 'active' : ''}`}
                              onClick={() => {
                                setCustomerForm({
                                  ...customerForm,
                                  customer_type: 'basecamp',
                                  monthly_quota_hours: customerForm.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0
                                });
                              }}
                            >
                              <Building2 size={16} />
                              <div>
                                <strong>Basecamp</strong>
                                <span className="sub">ผู้เช่าออฟฟิศ/ฮอทเดสก์ ชั้น 4</span>
                              </div>
                            </button>

                            <button
                              type="button"
                              className={`crm-type-select-btn ${customerForm.customer_type === 'shop' ? 'active' : ''}`}
                              onClick={() => {
                                setCustomerForm({
                                  ...customerForm,
                                  customer_type: 'shop',
                                  monthly_quota_hours: 4.0
                                });
                              }}
                            >
                              <Store size={16} />
                              <div>
                                <strong>Partner Shop</strong>
                                <span className="sub">ร้านค้าพันธมิตรในอาคาร</span>
                              </div>
                            </button>
                          </div>
                        </div>
                      )}

                      {customerForm.customer_type === 'basecamp' && (
                        <div className="crm-form-grid-2">
                          <div className="crm-form-group">
                            <label className="crm-form-label">ประเภทยูนิต</label>
                            <select
                              className="crm-form-select"
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
                              <option value="office">Office (โควต้า 4 ชม./ด.)</option>
                              <option value="hotdesk">Hotdesk (โควต้า 2 ชม./ด.)</option>
                            </select>
                          </div>

                          <div className="crm-form-group">
                            <label className="crm-form-label">เลขยูนิตชั้น 4</label>
                            <select
                              className="crm-form-select"
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

                      <div className="crm-form-group">
                        <label className="crm-form-label">
                          {customerForm.customer_type === 'shop' ? 'ชื่อร้านค้าพันธมิตร' : 'ชื่อบริษัท / ผู้เช่า'}
                          <span className="req">*</span>
                        </label>
                        <input
                          type="text"
                          className="crm-form-input"
                          placeholder="เช่น บจก. เทคโนโลยีอนาคต หรือ Koo.Koo Cafe"
                          value={customerForm.name}
                          onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                          required
                        />
                      </div>

                      <div className="crm-form-group">
                        <label className="crm-form-label">เลขประจำตัวผู้เสียภาษี (Tax ID)</label>
                        <input
                          type="text"
                          className="crm-form-input"
                          placeholder="13 หลัก (ถ้ามี)"
                          value={customerForm.tax_id}
                          onChange={(e) => setCustomerForm({ ...customerForm, tax_id: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* SECTION 2: ข้อมูลการติดต่อ */}
                    <div className="crm-modal-section-card">
                      <div className="crm-section-headline">
                        <Phone size={16} />
                        <span>ส่วนที่ 2: ข้อมูลการติดต่อ</span>
                      </div>

                      <div className="crm-form-group">
                        <label className="crm-form-label">ชื่อผู้ติดต่อประสานงาน</label>
                        <input
                          type="text"
                          className="crm-form-input"
                          placeholder="เช่น คุณสมชาย จัดการดี"
                          value={customerForm.contact_name}
                          onChange={(e) => setCustomerForm({ ...customerForm, contact_name: e.target.value })}
                        />
                      </div>

                      <div className="crm-form-group">
                        <label className="crm-form-label">เบอร์โทรศัพท์</label>
                        <input
                          type="tel"
                          className="crm-form-input"
                          placeholder="08X-XXX-XXXX"
                          value={customerForm.phone}
                          onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                        />
                      </div>

                      <div className="crm-form-group">
                        <label className="crm-form-label">อีเมล</label>
                        <input
                          type="email"
                          className="crm-form-input"
                          placeholder="contact@company.com"
                          value={customerForm.email}
                          onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                        />
                      </div>

                      <div className="crm-form-group">
                        <label className="crm-form-label">ที่อยู่สำหรับการออกเอกสาร</label>
                        <textarea
                          rows={2}
                          className="crm-form-textarea"
                          placeholder="ที่อยู่บริษัทสำหรับการออกใบกำกับภาษี..."
                          value={customerForm.address}
                          onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* SECTION 3: ข้อมูลสัญญาเริ่มต้น (Only when Creating New Customer) */}
                    {!editingCustomer && (
                      <div className="crm-modal-section-card crm-contract-init-card">
                        <div className="crm-section-headline">
                          <Calendar size={16} />
                          <span>ส่วนที่ 3: ข้อมูลสัญญาเริ่มต้น (ปฏิทินไทย พ.ศ.)</span>
                        </div>

                        <div className="crm-contract-init-fields">
                          <div className="crm-form-group">
                            <label className="crm-form-label">
                              วันเริ่มสัญญา (พ.ศ.) <span className="req">*</span>
                            </label>
                            <ThaiDatePicker
                              value={customerForm.start_date}
                              onChange={(val) => setCustomerForm(prev => ({ ...prev, start_date: val }))}
                              required
                              align="left"
                            />
                          </div>

                          <div className="crm-form-group">
                            <label className="crm-form-label">
                              วันสิ้นสุดสัญญา (พ.ศ.) <span className="req">*</span>
                            </label>
                            <ThaiDatePicker
                              value={customerForm.end_date}
                              onChange={(val) => setCustomerForm(prev => ({ ...prev, end_date: val }))}
                              required
                              align="right"
                            />
                          </div>

                          <div className="crm-form-grid-2 crm-contract-meta-grid">
                            <div className="crm-form-group">
                              <label className="crm-form-label">โควต้า (ชม./ด.) <span className="req">*</span></label>
                              <input
                                type="number"
                                step="0.5"
                                className="crm-form-input"
                                value={customerForm.monthly_quota_hours}
                                onChange={(e) => setCustomerForm({ ...customerForm, monthly_quota_hours: parseFloat(e.target.value) || 0 })}
                                required
                              />
                            </div>

                            <div className="crm-form-group">
                              <label className="crm-form-label">หมายเลขสัญญา</label>
                              <input
                                type="text"
                                className="crm-form-input"
                                placeholder="สร้างอัตโนมัติ"
                                value={customerForm.contract_number}
                                onChange={(e) => setCustomerForm({ ...customerForm, contract_number: e.target.value })}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="crm-modal-footer">
                  <div className="crm-modal-footer-hint">
                    <span className="req">*</span> จำเป็นต้องระบุข้อมูล
                  </div>
                  <div className="crm-modal-footer-actions">
                    <button
                      type="button"
                      className="crm-btn-secondary"
                      onClick={handleRequestCloseAddEditModal}
                      disabled={isSubmitting}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      className="crm-btn-primary"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'กำลังบันทึก...' : (editingCustomer ? 'บันทึกข้อมูลลูกค้า' : 'สร้างข้อมูลลูกค้าและสัญญา')}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* TAB 2: Contracts Management */}
            {editingCustomer && editModalTab === 'contracts' && (
              <div className="crm-modal-tab-content">
                {loadingCustomerDetail && !customerDetail ? (
                  <div className="crm-table-placeholder" style={{ padding: '40px' }}>
                    <RefreshCw size={24} className="crm-spin" />
                    <span>กำลังโหลดรายละเอียดสัญญา...</span>
                  </div>
                ) : (
                  <>
                    {/* Sub-navigation bar when editing dates or renewing */}
                    {(contractSubTab === 'edit_dates' || contractSubTab === 'renew') && (
                      <div className="crm-drawer-sub-nav" style={{ marginBottom: '16px' }}>
                        <button
                          type="button"
                          className="crm-drawer-back-btn crm-subnav-back-btn"
                          onClick={async () => {
                            if (isContractFormDirty()) {
                              const msg = 'คุณมีข้อมูลการแก้ไขสัญญาที่ยังไม่ได้บันทึก ต้องการยกเลิกและกลับสู่ภาพรวมสัญญาหรือไม่?';
                              const ok = sysConfirm ? await sysConfirm(msg) : window.confirm(msg);
                              if (!ok) return;
                            }
                            setContractSubTab('overview');
                            setEditDateStep('input');
                            setShowTerminateInline(false);
                          }}
                        >
                          <ChevronLeft size={16} />
                          <span>กลับสู่ภาพรวมสัญญา</span>
                        </button>
                        <div className="crm-drawer-sub-badge">
                          {contractSubTab === 'edit_dates' ? (
                            <span className="crm-sub-badge edit">
                              <Edit2 size={12} /> แก้ไขวันที่สัญญาเดิม
                            </span>
                          ) : (
                            <span className="crm-sub-badge renew">
                              <Plus size={12} /> ต่อสัญญาฉบับใหม่
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SUB-VIEW 1: OVERVIEW */}
                    {contractSubTab === 'overview' && (
                      <div className="crm-tab-pane">
                        {customerDetail?.contracts && customerDetail.contracts.length > 0 ? (
                          <div className="crm-overview-section">
                            {/* Active Contract Hero Box */}
                            <div className="crm-summary-hero-box">
                              <div className="crm-hero-headline">
                                <div>
                                  <span className="crm-sub-lbl">สัญญาที่ใช้งานปัจจุบัน</span>
                                  <div className="crm-hero-id">{customerDetail.contracts[0].contract_number}</div>
                                </div>
                                <span className={`crm-urgency-tag large ${customerDetail.contracts[0].urgency}`}>
                                  {customerDetail.contracts[0].evaluated_status} ({customerDetail.contracts[0].days_left} วัน)
                                </span>
                              </div>

                              <div className="crm-hero-dates-strip">
                                <div className="crm-hds-item">
                                  <span className="lbl">วันเริ่มสัญญา (พ.ศ.)</span>
                                  <span className="val">{formatThaiDate(customerDetail.contracts[0].start_date)}</span>
                                </div>
                                <ChevronRight size={16} className="crm-hds-arrow" />
                                <div className="crm-hds-item">
                                  <span className="lbl">วันสิ้นสุดสัญญา (พ.ศ.)</span>
                                  <span className="val highlight">{formatThaiDate(customerDetail.contracts[0].end_date)}</span>
                                </div>
                              </div>

                              <div className="crm-hero-meta-row">
                                <div className="crm-meta-item">
                                  <Clock size={14} />
                                  <span>โควต้าห้องประชุม: <strong>{customerDetail.contracts[0].monthly_quota_hours} ชม./เดือน</strong></span>
                                </div>
                                {customerDetail.contracts[0].notes && (
                                  <div className="crm-meta-item notes">
                                    <Info size={14} />
                                    <span>{customerDetail.contracts[0].notes}</span>
                                  </div>
                                )}
                              </div>

                              <div className="crm-hero-btn-row">
                                {canManageContracts && customerDetail.contracts[0].status !== 'TERMINATED' && (
                                  <button
                                    type="button"
                                    className="crm-btn-action-primary"
                                    onClick={() => handleStartEditDates(customerDetail.contracts[0])}
                                  >
                                    <Edit2 size={13} />
                                    <span>แก้ไขวันที่สัญญา</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="crm-btn-action-secondary"
                                  onClick={() => setContractSubTab('renew')}
                                >
                                  <Plus size={14} />
                                  <span>ต่อสัญญาใหม่</span>
                                </button>
                              </div>
                            </div>

                            {/* Inline Danger Action: Terminate Contract */}
                            {customerDetail.contracts[0]?.status === 'ACTIVE' && (
                              <div className="crm-terminate-wrapper" style={{ marginTop: '16px' }}>
                                {!showTerminateInline ? (
                                  <div className="crm-terminate-bar">
                                    <div className="crm-terminate-text">
                                      <span className="title">ต้องการยกเลิกสัญญาก่อนกำหนด?</span>
                                      <span className="desc">สถานะจะเปลี่ยนเป็น TERMINATED และสิทธิ์โควต้าจะถูกระงับ</span>
                                    </div>
                                    <button
                                      type="button"
                                      className="crm-btn-quiet-danger"
                                      onClick={() => setShowTerminateInline(true)}
                                    >
                                      <AlertTriangle size={13} />
                                      <span>ยกเลิกสัญญา</span>
                                    </button>
                                  </div>
                                ) : (
                                  <form onSubmit={handleSubmitTerminate} className="crm-terminate-form-box">
                                    <div className="crm-tfb-header">
                                      <AlertTriangle size={16} color="#dc2626" />
                                      <h4>ขอยกเลิกสัญญาก่อนกำหนด ({customerDetail.contracts[0].contract_number})</h4>
                                    </div>

                                    <div className="crm-form-group">
                                      <label className="crm-form-label">
                                        วันที่มีผลยกเลิกสัญญา (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                                      </label>
                                      <ThaiDatePicker
                                        value={terminateForm.termination_date}
                                        onChange={(val) => setTerminateForm(prev => ({ ...prev, termination_date: val }))}
                                        required
                                        align="left"
                                      />
                                    </div>

                                    <div className="crm-form-group">
                                      <label className="crm-form-label">
                                        เหตุผลในการยกเลิกสัญญา <span className="req">*</span>
                                      </label>
                                      <textarea
                                        rows={2}
                                        className="crm-form-textarea"
                                        placeholder="ระบุเหตุผล เช่น ย้ายสถานที่ประกอบการ, ไม่ประสงค์เช่าต่อ..."
                                        value={terminateForm.reason}
                                        onChange={(e) => setTerminateForm(prev => ({ ...prev, reason: e.target.value }))}
                                        required
                                      />
                                    </div>

                                    <div className="crm-tfb-actions">
                                      <button
                                        type="button"
                                        className="crm-btn-secondary"
                                        onClick={() => setShowTerminateInline(false)}
                                        disabled={isSubmitting}
                                      >
                                        ยกเลิก
                                      </button>
                                      <button
                                        type="submit"
                                        className="crm-btn-danger"
                                        disabled={isSubmitting}
                                      >
                                        {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการยกเลิกสัญญา'}
                                      </button>
                                    </div>
                                  </form>
                                )}
                              </div>
                            )}

                            {/* Contract History List */}
                            <div className="crm-history-section" style={{ marginTop: '24px' }}>
                              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
                                ประวัติสัญญาทั้งหมด ({customerDetail.contracts.length} ฉบับ)
                              </h4>
                              <div className="crm-contracts-history-list">
                                {customerDetail.contracts.map((ctr) => (
                                  <div key={ctr.id} className="crm-contract-history-card">
                                    <div className="crm-chc-top">
                                      <div className="crm-chc-id">
                                        <FileText size={14} />
                                        <strong>{ctr.contract_number}</strong>
                                      </div>
                                      <span className={`crm-status-dot-badge ${ctr.status.toLowerCase()}`}>
                                        <span className="dot" />
                                        {ctr.evaluated_status || ctr.status}
                                      </span>
                                    </div>
                                    <div className="crm-chc-dates">
                                      <span>ช่วงสัญญา: <strong>{formatThaiDate(ctr.start_date)} – {formatThaiDate(ctr.end_date)}</strong></span>
                                      <span>โควต้า: <strong>{ctr.monthly_quota_hours} ชม./ด.</strong></span>
                                    </div>
                                    {ctr.notes && (
                                      <div className="crm-chc-notes">หมายเหตุ: {ctr.notes}</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Contract Audit Trail (Admin Only) */}
                            {isAdmin && (
                              <div className="crm-audit-section" style={{ marginTop: '24px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <ShieldCheck size={16} color="#059669" />
                                  <span>ประวัติการตรวจสอบและการแก้ไขสัญญา (Audit History)</span>
                                </h4>
                                {loadingAudit ? (
                                  <div className="crm-table-placeholder" style={{ padding: '20px' }}>
                                    <RefreshCw size={18} className="crm-spin" />
                                    <span>กำลังโหลด Audit Logs...</span>
                                  </div>
                                ) : auditLogs.length === 0 ? (
                                  <div className="crm-table-placeholder" style={{ padding: '20px', background: '#f8fafc', borderRadius: '8px' }}>
                                    <span>ยังไม่มีประวัติการแก้ไขสัญญาของลูกค้ารายนี้</span>
                                  </div>
                                ) : (
                                  <div className="crm-audit-list">
                                    {auditLogs.map((log) => {
                                      let parsedDetails = null;
                                      try {
                                        parsedDetails = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                                      } catch (_) {
                                        parsedDetails = { raw: log.details };
                                      }

                                      return (
                                        <div key={log.id} className="crm-audit-card">
                                          <div className="crm-audit-header">
                                            <span className="crm-audit-action">{log.action}</span>
                                            <span className="crm-audit-actor">โดย: <strong>{log.performed_by}</strong></span>
                                            <span className="crm-audit-time">{formatThaiDateTime(log.created_at)}</span>
                                          </div>
                                          {parsedDetails?.reason && (
                                            <div className="crm-audit-reason">
                                              เหตุผล: "{parsedDetails.reason}"
                                            </div>
                                          )}
                                          {parsedDetails?.previous_period && (
                                            <div className="crm-audit-diff">
                                              เดิม: {parsedDetails.previous_period.start_date} ถึง {parsedDetails.previous_period.end_date} →
                                              ใหม่: {parsedDetails.new_period?.start_date} ถึง {parsedDetails.new_period?.end_date}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="crm-drawer-empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
                            <Info size={32} color="#64748b" style={{ margin: '0 auto 12px auto' }} />
                            <p style={{ margin: '0 0 16px 0', fontSize: '0.92rem', color: '#475569' }}>
                              ลูกค้ารายนี้ยังไม่มีสัญญาที่บันทึกไว้ในระบบ
                            </p>
                            <button
                              type="button"
                              className="crm-btn-primary"
                              onClick={() => setContractSubTab('renew')}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', margin: '0 auto' }}
                            >
                              <Plus size={14} />
                              <span>สร้างสัญญาใหม่ (Create Contract)</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUB-VIEW 2: EDIT CONTRACT DATES */}
                    {contractSubTab === 'edit_dates' && contractToEdit && (
                      <div className="crm-tab-pane">
                        {editDateStep === 'input' ? (
                          <div className="crm-edit-pane-container">
                            <div className="crm-edit-callout">
                              <Info size={16} />
                              <div>
                                <strong>แก้ไขระยะเวลาสัญญา: {contractToEdit.contract_number}</strong>
                                <p>กำหนดวันเริ่มต้นและวันสิ้นสุดสัญญาใหม่ในปฏิทินไทย พ.ศ. พร้อมระบุเหตุผลในการแก้ไข</p>
                              </div>
                            </div>

                            <form onSubmit={handleProceedToConfirmEdit} className="crm-contract-edit-form">
                              <div className="crm-form-group">
                                <label className="crm-form-label">
                                  วันเริ่มสัญญาใหม่ (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                                </label>
                                <ThaiDatePicker
                                  value={editDateForm.start_date}
                                  onChange={(val) => setEditDateForm(prev => ({ ...prev, start_date: val }))}
                                  required
                                  align="left"
                                />
                                <span className="crm-form-hint">{getThaiDateInputHint(editDateForm.start_date)}</span>
                              </div>

                              <div className="crm-form-group">
                                <label className="crm-form-label">
                                  วันสิ้นสุดสัญญาใหม่ (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                                </label>
                                <ThaiDatePicker
                                  value={editDateForm.end_date}
                                  onChange={(val) => setEditDateForm(prev => ({ ...prev, end_date: val }))}
                                  required
                                  align="right"
                                />
                                <span className="crm-form-hint">{getThaiDateInputHint(editDateForm.end_date)}</span>
                              </div>

                              <div className="crm-form-group">
                                <label className="crm-form-label">
                                  เหตุผลในการแก้ไขวันที่สัญญา <span className="req">*</span>
                                </label>
                                <textarea
                                  rows={3}
                                  className="crm-form-textarea"
                                  placeholder="ระบุเหตุผล เช่น ขยายเวลาตามข้อตกลงพิเศษ, แก้ไขวันเริ่มตามเอกสารแนบท้าย..."
                                  value={editDateForm.reason}
                                  onChange={(e) => setEditDateForm(prev => ({ ...prev, reason: e.target.value }))}
                                  required
                                />
                              </div>

                              <div className="crm-modal-footer-actions" style={{ marginTop: '20px' }}>
                                <button
                                  type="button"
                                  className="crm-btn-secondary"
                                  onClick={() => setContractSubTab('overview')}
                                >
                                  ยกเลิก
                                </button>
                                <button
                                  type="submit"
                                  className="crm-btn-primary"
                                >
                                  ถัดไป: ตรวจสอบและยืนยัน
                                </button>
                              </div>
                            </form>
                          </div>
                        ) : (
                          /* STEP 2: CONFIRMATION */
                          <div className="crm-confirm-pane-container">
                            <div className="crm-confirm-card">
                              <div className="crm-cc-header">
                                <ShieldAlert size={20} color="#f59e0b" />
                                <h3>ยืนยันการแก้ไขวันที่สัญญา {contractToEdit.contract_number}</h3>
                              </div>

                              <div className="crm-cc-body">
                                <div className="crm-cc-diff-row">
                                  <div className="crm-cc-diff-col old">
                                    <span className="lbl">ช่วงสัญญาเดิม</span>
                                    <div className="val">{formatThaiDate(contractToEdit.start_date)}</div>
                                    <div className="sub-val">ถึง {formatThaiDate(contractToEdit.end_date)}</div>
                                  </div>
                                  <ChevronRight size={20} className="crm-cc-arrow" />
                                  <div className="crm-cc-diff-col new">
                                    <span className="lbl">ช่วงสัญญาใหม่ (ที่แก้ไข)</span>
                                    <div className="val highlight">{formatThaiDate(editDateForm.start_date)}</div>
                                    <div className="sub-val highlight">ถึง {formatThaiDate(editDateForm.end_date)}</div>
                                  </div>
                                </div>

                                <div className="crm-cc-reason-box">
                                  <strong>เหตุผลในการแก้ไข:</strong>
                                  <p>"{editDateForm.reason}"</p>
                                </div>
                              </div>

                              <div className="crm-cc-actions">
                                <button
                                  type="button"
                                  className="crm-btn-secondary"
                                  onClick={() => setEditDateStep('input')}
                                  disabled={isSubmitting}
                                >
                                  ย้อนกลับไปแก้ไข
                                </button>
                                <button
                                  type="button"
                                  className="crm-btn-primary"
                                  onClick={handleConfirmSubmitEdit}
                                  disabled={isSubmitting}
                                >
                                  {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการบันทึกวันที่สัญญา'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUB-VIEW 3: RENEW / CREATE CONTRACT */}
                    {contractSubTab === 'renew' && (
                      <div className="crm-tab-pane">
                        <div className="crm-renew-pane-container">
                          <div className="crm-edit-callout">
                            <Plus size={16} />
                            <div>
                              <strong>ต่อสัญญาฉบับใหม่ หรือ สร้างสัญญา: {editingCustomer.name}</strong>
                              <p>เปิดสัญญาใหม่เพื่อขยายระยะเวลาและสิทธิ์การใช้งานโควต้าห้องประชุม</p>
                            </div>
                          </div>

                          <form onSubmit={handleSubmitRenew} className="crm-contract-edit-form">
                            <div className="crm-form-group">
                              <label className="crm-form-label">หมายเลขสัญญาใหม่</label>
                              <input
                                type="text"
                                className="crm-form-input"
                                placeholder="เว้นว่างไว้เพื่อสร้างอัตโนมัติ"
                                value={renewForm.contract_number}
                                onChange={(e) => setRenewForm(prev => ({ ...prev, contract_number: e.target.value }))}
                              />
                            </div>

                            <div className="crm-form-group">
                              <label className="crm-form-label">
                                วันเริ่มสัญญาใหม่ (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                              </label>
                              <ThaiDatePicker
                                value={renewForm.start_date}
                                onChange={(val) => setRenewForm(prev => ({ ...prev, start_date: val }))}
                                required
                                align="left"
                              />
                              <span className="crm-form-hint">{getThaiDateInputHint(renewForm.start_date)}</span>
                            </div>

                            <div className="crm-form-group">
                              <label className="crm-form-label">
                                วันสิ้นสุดสัญญาใหม่ (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                              </label>
                              <ThaiDatePicker
                                value={renewForm.end_date}
                                onChange={(val) => setRenewForm(prev => ({ ...prev, end_date: val }))}
                                required
                                align="right"
                              />
                              <span className="crm-form-hint">{getThaiDateInputHint(renewForm.end_date)}</span>
                            </div>

                            <div className="crm-form-group">
                              <label className="crm-form-label">
                                โควต้าห้องประชุม (ชม./เดือน) <span className="req">*</span>
                              </label>
                              <input
                                type="number"
                                step="0.5"
                                className="crm-form-input"
                                value={renewForm.monthly_quota_hours}
                                onChange={(e) => setRenewForm(prev => ({ ...prev, monthly_quota_hours: parseFloat(e.target.value) || 0 }))}
                                required
                              />
                            </div>

                            <div className="crm-form-group">
                              <label className="crm-form-label">หมายเหตุสัญญา</label>
                              <textarea
                                rows={2}
                                className="crm-form-textarea"
                                placeholder="ระบุเงื่อนไขพิเศษหรือข้อตกลง..."
                                value={renewForm.notes}
                                onChange={(e) => setRenewForm(prev => ({ ...prev, notes: e.target.value }))}
                              />
                            </div>

                            <div className="crm-modal-footer-actions" style={{ marginTop: '20px' }}>
                              <button
                                type="button"
                                className="crm-btn-secondary"
                                onClick={() => setContractSubTab('overview')}
                                disabled={isSubmitting}
                              >
                                ยกเลิก
                              </button>
                              <button
                                type="submit"
                                className="crm-btn-primary"
                                disabled={isSubmitting}
                              >
                                {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกสัญญาใหม่'}
                              </button>
                            </div>
                          </form>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* TAB 3: Usage Quota & Benefits */}
            {editingCustomer && editModalTab === 'quota' && (
              <div className="crm-modal-tab-content">
                {loadingCustomerDetail && !customerDetail ? (
                  <div className="crm-table-placeholder" style={{ padding: '40px' }}>
                    <RefreshCw size={24} className="crm-spin" />
                    <span>กำลังโหลดข้อมูลโควตา...</span>
                  </div>
                ) : (
                  <div className="crm-quota-tab-container">
                    {/* Month Context Selector */}
                    <div className="crm-quota-month-selector">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CalendarDays size={16} color="#0284c7" />
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>
                          รอบการใช้งานประจำเดือน:
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <select
                          className="crm-select-compact"
                          value={selectedMonth}
                          onChange={(e) => {
                            const newM = e.target.value;
                            setSelectedMonth(newM);
                            fetchCustomerDetail(editingCustomer.id, newM, selectedYear);
                          }}
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <option key={m} value={String(m)}>
                              {new Date(2026, m - 1, 1).toLocaleDateString('th-TH', { month: 'long' })}
                            </option>
                          ))}
                        </select>
                        <select
                          className="crm-select-compact"
                          value={selectedYear}
                          onChange={(e) => {
                            const newY = e.target.value;
                            setSelectedYear(newY);
                            fetchCustomerDetail(editingCustomer.id, selectedMonth, newY);
                          }}
                        >
                          {['2025', '2026', '2027', '2028'].map(y => (
                            <option key={y} value={y}>พ.ศ. {parseInt(y) + 543}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* 3 Hero Metric Cards */}
                    {(() => {
                      const quota = customerDetail?.quota || editingCustomer.quota_summary || {
                        max_quota: 0,
                        used_hours: 0,
                        remaining_hours: 0,
                        booking_count: 0,
                        contract_eligible: true
                      };
                      const usedHours = Number(quota.used_hours ?? quota.used_quota ?? 0);
                      const maxQuota = Number(quota.max_quota ?? 4.0);
                      const remainingHours = Number(quota.remaining_hours ?? quota.remaining_quota ?? 0);
                      const isEligible = quota.contract_eligible !== false;
                      const percentUsed = maxQuota > 0 ? Math.min(100, Math.round((usedHours / maxQuota) * 100)) : 0;
                      const barColor = !isEligible ? '#94a3b8' : (percentUsed >= 90 ? '#ef4444' : percentUsed >= 50 ? '#f59e0b' : '#10b981');

                      return (
                        <>
                          <div className="crm-quota-hero-grid">
                            <div className="crm-quota-hero-card total">
                              <span className="crm-quota-card-lbl">โควตาสิทธิประโยชน์ต่อเดือน</span>
                              <div className="crm-quota-card-val">{maxQuota} ชม.</div>
                              <span className="crm-quota-card-sub">
                                {editingCustomer.customer_type === 'shop'
                                  ? 'ร้านค้าพันธมิตร (Shop 4 ชม./ด.)'
                                  : (editingCustomer.basecamp_sub_type === 'hotdesk' ? 'Hotdesk (2 ชม./ด.)' : 'Office (4 ชม./ด.)')}
                              </span>
                            </div>

                            <div className="crm-quota-hero-card used">
                              <span className="crm-quota-card-lbl">ชั่วโมงที่ใช้ไปแล้วในเดือนนี้</span>
                              <div className="crm-quota-card-val" style={{ color: '#d97706' }}>{usedHours} ชม.</div>
                              <span className="crm-quota-card-sub">
                                จาก {quota.booking_count || 0} รายการการจอง
                              </span>
                            </div>

                            <div className={`crm-quota-hero-card remaining ${remainingHours === 0 ? 'depleted' : ''}`}>
                              <span className="crm-quota-card-lbl">ชั่วโมงโควตาคงเหลือ</span>
                              <div className={`crm-quota-card-val remaining ${remainingHours === 0 ? 'depleted' : ''}`}>
                                {remainingHours} ชม.
                              </div>
                              <span className="crm-quota-card-sub">
                                {remainingHours > 0 ? 'พร้อมใช้งานสำหรับการจอง' : 'โควตาในรอบเดือนนี้ถูกใช้หมดแล้ว'}
                              </span>
                            </div>
                          </div>

                          {/* Progress Meter Box */}
                          <div className="crm-quota-meter-box">
                            <div className="crm-quota-meter-header">
                              <span>ความคืบหน้าการใช้โควตาห้องประชุม</span>
                              <span>{percentUsed}% ({usedHours} / {maxQuota} ชม.)</span>
                            </div>
                            <div className="crm-quota-meter-track">
                              <div
                                className="crm-quota-meter-fill"
                                style={{ width: `${percentUsed}%`, backgroundColor: barColor }}
                              />
                            </div>
                          </div>

                          {/* Eligibility Status Banner */}
                          <div className={`crm-quota-eligibility-banner ${isEligible ? 'eligible' : 'ineligible'}`}>
                            {isEligible ? (
                              <>
                                <CheckCircle2 size={20} color="#16a34a" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                  <h4>สัญญามีผลสมบูรณ์ — ได้รับสิทธิ์ใช้งานโควตาตามเงื่อนไข</h4>
                                  <p>
                                    ลูกค้ารายนี้มีสัญญาเช่าที่ยังไม่หมดอายุ สามารถใช้ชั่วโมงโควตาเพื่อจองห้องประชุมได้ฟรีจนกว่าโควตาในรอบเดือนจะหมด
                                  </p>
                                </div>
                              </>
                            ) : (
                              <>
                                <AlertTriangle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                                <div>
                                  <h4>สิทธิ์โควตาถูกระงับ — สัญญาหมดอายุหรือถูกยกเลิก</h4>
                                  <p>
                                    เนื่องจากสัญญาเช่าของลูกค้ารายนี้สิ้นสุดลงหรือถูกยกเลิก การจองห้องประชุมจะถูกคิดค่าบริการตามอัตรามาตรฐาน (สามารถต่อสัญญาใหม่เพื่อรับสิทธิ์โควตา)
                                  </p>
                                </div>
                              </>
                            )}
                          </div>

                          {/* Terms & Business Rules Reference Box */}
                          <div className="crm-quota-rules-card">
                            <h4>
                              <Info size={14} color="#0284c7" />
                              <span>ข้อกำหนดและเงื่อนไขการใช้โควตา (Bwork Rules)</span>
                            </h4>
                            <ul>
                              <li><strong>ร้านค้าพันธมิตร (Shop):</strong> ได้รับโควตา 4 ชั่วโมงต่อเดือน</li>
                              <li><strong>ผู้เช่าสำนักงาน (Basecamp Office):</strong> ได้รับโควตา 4 ชั่วโมงต่อเดือน</li>
                              <li><strong>ผู้เช่าโต๊ะทำงาน (Basecamp Hotdesk):</strong> ได้รับโควตา 2 ชั่วโมงต่อเดือน</li>
                              <li>โควตาจะถูกรีเซ็ตใหม่ในวันที่ 1 ของทุกเดือน ไม่สามารถสะสมหรือยกยอดไปใช้ในเดือนถัดไปได้</li>
                              <li>แต่ละร้านค้า / ยูนิต มีสิทธิ์โควตาแยกกันโดยสมบูรณ์ ไม่สามารถโอนสิทธิ์ข้ามยูนิตได้</li>
                            </ul>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Basecamp Unit Transfer Modal (Intact) */}
      {showTransferModal && transferUnitCustomer && (
        <div className="crm-modal-backdrop">
          <div className="crm-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header">
              <div className="crm-modal-title">
                <div className="crm-modal-icon-badge">
                  <ArrowRightLeft size={18} />
                </div>
                <div>
                  <h3>เปลี่ยนผู้เช่ายูนิต {transferUnitCustomer.basecamp_unit}</h3>
                  <p className="crm-modal-subtitle">
                    ยกเลิกสัญญาผู้เช่าเดิม ({transferUnitCustomer.name}) และเปิดสัญญาใหม่ให้ผู้เช่ารายใหม่
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="crm-modal-close-btn"
                onClick={() => setShowTransferModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitTransfer} className="crm-modal-form">
              <div className="crm-modal-body">
                <div className="crm-form-group">
                  <label className="crm-form-label">
                    ชื่อผู้เช่ารายใหม่ <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    className="crm-form-input"
                    placeholder="เช่น บจก. พัฒนาการดี"
                    value={transferForm.name}
                    onChange={(e) => setTransferForm({ ...transferForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="crm-form-group">
                  <label className="crm-form-label">ชื่อผู้ติดต่อ</label>
                  <input
                    type="text"
                    className="crm-form-input"
                    placeholder="เช่น คุณมานะ ใจดี"
                    value={transferForm.contact_name}
                    onChange={(e) => setTransferForm({ ...transferForm, contact_name: e.target.value })}
                  />
                </div>

                <div className="crm-form-group">
                  <label className="crm-form-label">เบอร์โทรศัพท์</label>
                  <input
                    type="tel"
                    className="crm-form-input"
                    placeholder="08X-XXX-XXXX"
                    value={transferForm.phone}
                    onChange={(e) => setTransferForm({ ...transferForm, phone: e.target.value })}
                  />
                </div>

                <div className="crm-form-group">
                  <label className="crm-form-label">อีเมล</label>
                  <input
                    type="email"
                    className="crm-form-input"
                    placeholder="contact@newcompany.com"
                    value={transferForm.email}
                    onChange={(e) => setTransferForm({ ...transferForm, email: e.target.value })}
                  />
                </div>

                <div className="crm-form-group">
                  <label className="crm-form-label">
                    วันเริ่มสัญญาใหม่ (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                  </label>
                  <ThaiDatePicker
                    value={transferForm.start_date}
                    onChange={(val) => setTransferForm(prev => ({ ...prev, start_date: val }))}
                    required
                    align="left"
                  />
                </div>

                <div className="crm-form-group">
                  <label className="crm-form-label">
                    วันสิ้นสุดสัญญาใหม่ (ปฏิทินไทย พ.ศ.) <span className="req">*</span>
                  </label>
                  <ThaiDatePicker
                    value={transferForm.end_date}
                    onChange={(val) => setTransferForm(prev => ({ ...prev, end_date: val }))}
                    required
                    align="right"
                  />
                </div>
              </div>

              <div className="crm-modal-footer">
                <button
                  type="button"
                  className="crm-btn-secondary"
                  onClick={() => setShowTransferModal(false)}
                  disabled={isSubmitting}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  className="crm-btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการเปลี่ยนผู้เช่า'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
