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
  Sparkles
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
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));

  // Modals & Drawer State
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);

  // Side Drawer state for Contract Management
  const [showContractDrawer, setShowContractDrawer] = useState(false);
  const [contractCustomer, setContractCustomer] = useState(null);
  const [contractDrawerTab, setContractDrawerTab] = useState('overview'); // 'overview' | 'edit_dates' | 'renew' | 'history' | 'audit'
  const [contractToEdit, setContractToEdit] = useState(null);
  const [editDateStep, setEditDateStep] = useState('input'); // 'input' | 'confirm'
  const [showTerminateInline, setShowTerminateInline] = useState(false);

  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

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

  // Fetch Audit Logs for Customer (Admin Only)
  const fetchAuditLogs = async (customerId) => {
    if (!isAdmin || !customerId) {
      setAuditLogs([]);
      return;
    }
    setLoadingAudit(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/audit-logs`, { headers });
      const data = await res.json();
      if (data.success) {
        setAuditLogs(data.audit_logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchAlerts();
  }, [filterType, filterStatus, selectedMonth, selectedYear]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Clean, Minimal Metrics Summary
  const summaryCards = useMemo(() => {
    let totalCust = customers.length;
    let activeCtr = 0;
    let expiringCtr = 0;
    let expiredCtr = 0;

    if (alertsSummary?.summary) {
      const s = alertsSummary.summary;
      activeCtr = s.total_active || 0;
      expiringCtr = (s.expiring_30_days || 0) + (s.expiring_15_days || 0) + (s.expiring_7_days || 0);
      expiredCtr = s.expired || 0;
    } else {
      customers.forEach(c => {
        if (c.active_contract) {
          const st = c.active_contract.evaluated_status;
          if (st === 'ACTIVE') activeCtr++;
          else if (st === 'EXPIRING') expiringCtr++;
          else if (st === 'EXPIRED') expiredCtr++;
        }
      });
    }

    return {
      total: totalCust,
      active: activeCtr,
      expiring: expiringCtr,
      expired: expiredCtr
    };
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

  // Safe Close for Add/Edit Customer Modal (prompts if dirty)
  const handleRequestCloseAddEditModal = async () => {
    if (isCustomerFormDirty()) {
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
    initialCustomerFormRef.current = null;
  };

  // Check if Contract Drawer has unsaved changes
  const isContractDrawerDirty = () => {
    if (contractDrawerTab === 'edit_dates') {
      if (!initialContractEditRef.current) return false;
      const init = initialContractEditRef.current;
      return (
        editDateForm.start_date !== init.start_date ||
        editDateForm.end_date !== init.end_date ||
        (editDateForm.reason || '').trim() !== ''
      );
    }
    if (contractDrawerTab === 'renew') {
      return (
        (renewForm.contract_number || '').trim() !== '' ||
        (renewForm.notes || '').trim() !== ''
      );
    }
    return false;
  };

  // Safe Close for Contract Drawer (prompts if dirty)
  const handleRequestCloseContractDrawer = async () => {
    if (isContractDrawerDirty()) {
      const msg = 'คุณมีข้อมูลการแก้ไขสัญญาที่ยังไม่ได้บันทึก ต้องการยกเลิกและปิดแถบด้านข้างหรือไม่?';
      let confirmed = false;
      if (sysConfirm) {
        confirmed = await sysConfirm(msg);
      } else {
        confirmed = window.confirm(msg);
      }
      if (!confirmed) return;
    }
    setShowContractDrawer(false);
    setContractDrawerTab('overview');
    setShowTerminateInline(false);
    setEditDateStep('input');
    initialContractEditRef.current = null;
  };

  // Global Escape key listener: isolated from ThaiDatePicker popovers via capture phase
  useEffect(() => {
    const handleEscapeKey = (e) => {
      if (e.key === 'Escape') {
        if (showAddEditModal) {
          handleRequestCloseAddEditModal();
        } else if (showContractDrawer) {
          handleRequestCloseContractDrawer();
        } else if (showTransferModal) {
          setShowTransferModal(false);
        }
      }
    };

    if (showAddEditModal || showContractDrawer || showTransferModal) {
      document.addEventListener('keydown', handleEscapeKey);
      return () => {
        document.removeEventListener('keydown', handleEscapeKey);
      };
    }
  }, [showAddEditModal, showContractDrawer, showTransferModal, customerForm, editingCustomer, contractDrawerTab, editDateForm, renewForm]);

  // Open Create Customer Modal
  const handleOpenCreate = () => {
    setEditingCustomer(null);
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 1);
    nextYear.setDate(nextYear.getDate() - 1);

    const todayStr = today.toISOString().slice(0, 10);
    const nextYearStr = nextYear.toISOString().slice(0, 10);

    const initialData = {
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
    };
    initialCustomerFormRef.current = initialData;
    setCustomerForm(initialData);
    setShowAddEditModal(true);
  };

  // Open Edit Customer Info Modal
  const handleOpenEdit = (c) => {
    setEditingCustomer(c);
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
      notes: ''
    };
    initialCustomerFormRef.current = initialData;
    setCustomerForm(initialData);
    setShowAddEditModal(true);
  };

  // Submit Add or Edit Customer
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
          if (sysAlert) sysAlert('บันทึกการแก้ไขข้อมูลเรียบร้อยแล้ว', 'success');
          initialCustomerFormRef.current = null;
          setShowAddEditModal(false);
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

  // Open Side Drawer for Customer Contracts
  const handleOpenContractDrawer = async (c, defaultTab = 'overview') => {
    try {
      const res = await fetch(`/api/customers/${c.id}`, { headers });
      const data = await res.json();
      if (data.success) {
        const cust = data.customer;
        setContractCustomer(cust);
        setContractDrawerTab(defaultTab);
        setEditDateStep('input');
        setShowTerminateInline(false);

        const currentActiveCtr = cust.contracts?.[0] || null;
        setContractToEdit(currentActiveCtr);

        if (currentActiveCtr) {
          const initEdit = {
            start_date: currentActiveCtr.start_date || '',
            end_date: currentActiveCtr.end_date || '',
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
          monthly_quota_hours: cust.customer_type === 'shop' ? 4.0 : (cust.basecamp_sub_type === 'hotdesk' ? 2.0 : 4.0),
          notes: ''
        });

        setTerminateForm({
          termination_date: today.toISOString().slice(0, 10),
          reason: ''
        });

        setShowContractDrawer(true);

        if (isAdmin) {
          fetchAuditLogs(cust.id);
        }
      }
    } catch (err) {
      if (sysAlert) sysAlert('ไม่สามารถโหลดรายละเอียดสัญญาได้: ' + err.message, 'error');
    }
  };

  // Start Edit Dates for a Specific Contract in Drawer
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
    setContractDrawerTab('edit_dates');
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
    if (!contractToEdit) return;

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

        // Reload customer contract details
        const custRes = await fetch(`/api/customers/${contractCustomer.id}`, { headers });
        const custData = await custRes.json();
        if (custData.success) {
          setContractCustomer(custData.customer);
          setContractToEdit(custData.customer.contracts?.[0] || null);
        }
        setEditDateStep('input');
        setContractDrawerTab('overview');
        initialContractEditRef.current = null;
        fetchCustomers();
        fetchAlerts();
        if (isAdmin) fetchAuditLogs(contractCustomer.id);
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
    if (!contractCustomer) return;

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
      const res = await fetch(`/api/customers/${contractCustomer.id}/contracts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(renewForm)
      });
      const data = await res.json();
      if (data.success) {
        if (sysAlert) sysAlert('บันทึกสัญญาใหม่/ต่อสัญญาเรียบร้อยแล้ว', 'success');

        // Reload drawer data
        const custRes = await fetch(`/api/customers/${contractCustomer.id}`, { headers });
        const custData = await custRes.json();
        if (custData.success) {
          setContractCustomer(custData.customer);
          setContractToEdit(custData.customer.contracts?.[0] || null);
        }
        setContractDrawerTab('overview');
        fetchCustomers();
        fetchAlerts();
        if (isAdmin) fetchAuditLogs(contractCustomer.id);
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
    if (!contractCustomer || !contractCustomer.contracts?.[0]) return;
    const activeContract = contractCustomer.contracts[0];

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

        // Reload drawer
        const custRes = await fetch(`/api/customers/${contractCustomer.id}`, { headers });
        const custData = await custRes.json();
        if (custData.success) {
          setContractCustomer(custData.customer);
          setContractToEdit(custData.customer.contracts?.[0] || null);
        }
        setContractDrawerTab('overview');
        fetchCustomers();
        fetchAlerts();
        if (isAdmin) fetchAuditLogs(contractCustomer.id);
      } else {
        if (sysAlert) sysAlert(data.error || 'ยกเลิกสัญญาไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      setIsSubmitting(false);
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

    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="crm-container">
      {/* 1. Dashboard Header */}
      <div className="crm-header">
        <div className="crm-title-area">
          <div className="crm-title-row">
            <Users size={22} className="crm-title-icon" />
            <h1 className="crm-title">จัดการลูกค้าและสัญญา</h1>
            <span className="crm-badge-corporate">Enterprise CRM</span>
          </div>
          <p className="crm-subtitle">
            Customer, Shop & Contract Lifecycle Console (Basecamp & Partner Shops)
          </p>
        </div>

        <div className="crm-header-actions">
          <button
            type="button"
            className="crm-btn-primary"
            onClick={handleOpenCreate}
          >
            <Plus size={16} />
            <span>เพิ่มลูกค้า / ร้านค้า</span>
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
              เปิดใช้งาน (Active)
            </button>
            <button
              type="button"
              className={`crm-segment-btn ${filterStatus === 'inactive' ? 'active' : ''}`}
              onClick={() => setFilterStatus('inactive')}
            >
              ปิดการใช้งาน
            </button>
          </div>
        </div>

        {/* Quota Month/Year Selector */}
        <div className="crm-filter-right">
          <div className="crm-quota-period-picker">
            <CalendarDays size={15} className="crm-picker-icon" />
            <span className="crm-picker-label">รอบโควต้า:</span>
            <select
              className="crm-select-compact"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m)}>เดือน {m}</option>
              ))}
            </select>
            <select
              className="crm-select-compact"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="2025">พ.ศ. 2568</option>
              <option value="2026">พ.ศ. 2569</option>
              <option value="2027">พ.ศ. 2570</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Customer Data Table */}
      <div className="crm-table-container">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '150px' }}>ประเภท / ยูนิต</th>
                <th style={{ minWidth: '220px' }}>ชื่อบริษัท / ร้านค้า</th>
                <th style={{ minWidth: '190px' }}>ผู้ติดต่อและโทรศัพท์</th>
                <th style={{ minWidth: '210px' }}>สัญญาและวันสิ้นสุด (พ.ศ.)</th>
                <th style={{ minWidth: '200px' }}>โควต้า (ด.{selectedMonth}/{selectedYear})</th>
                <th style={{ width: '100px' }}>สถานะ</th>
                <th style={{ width: '220px', textAlign: 'right' }}>การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="crm-table-placeholder">
                    <RefreshCw size={24} className="animate-spin crm-spinner" />
                    <span>กำลังโหลดข้อมูลลูกค้า...</span>
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="crm-table-placeholder">
                    <Info size={28} className="crm-placeholder-icon" />
                    <span>ไม่พบข้อมูลลูกค้าตามเงื่อนไขที่เลือก</span>
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const activeContract = c.active_contract;
                  const quota = c.quota || { max_quota: 4.0, used_quota: 0, remaining_quota: 4.0 };
                  const percentUsed = quota.max_quota > 0 ? Math.min(100, Math.round((quota.used_quota / quota.max_quota) * 100)) : 0;
                  const barColor = percentUsed >= 100 ? '#ef4444' : (percentUsed >= 60 ? '#f59e0b' : '#10b981');

                  return (
                    <tr key={c.id} className="crm-table-row">
                      {/* Type / Unit Badge */}
                      <td>
                        {c.customer_type === 'basecamp' ? (
                          <div className="crm-type-badge basecamp">
                            <Building2 size={13} />
                            <span>{c.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : 'Office'} {c.basecamp_unit || '-'}</span>
                          </div>
                        ) : (
                          <div className="crm-type-badge shop">
                            <Store size={13} />
                            <span>Partner Shop</span>
                          </div>
                        )}
                      </td>

                      {/* Company / Shop Name */}
                      <td>
                        <div className="crm-name-cell">
                          <span className="crm-primary-name">{c.name}</span>
                          {c.tax_id && <span className="crm-tax-num">TAX: {c.tax_id}</span>}
                        </div>
                      </td>

                      {/* Contact Info */}
                      <td>
                        <div className="crm-contact-cell">
                          {c.contact_name ? (
                            <span className="crm-contact-person">{c.contact_name}</span>
                          ) : (
                            <span className="crm-text-muted">-</span>
                          )}
                          <div className="crm-contact-links">
                            {c.phone && (
                              <span className="crm-contact-pill">
                                <Phone size={11} /> {c.phone}
                              </span>
                            )}
                            {c.email && (
                              <span className="crm-contact-pill">
                                <Mail size={11} /> {c.email}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Contract Info with True Thai BE Date */}
                      <td>
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
                      <td>
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
                          {/* Manage Contract Drawer Button */}
                          <button
                            type="button"
                            className="crm-action-btn primary"
                            title="เปิดระบบจัดการสัญญาและวันที่"
                            onClick={() => handleOpenContractDrawer(c, 'overview')}
                          >
                            <FileText size={13} />
                            <span>สัญญา</span>
                          </button>

                          {/* Edit Customer Profile */}
                          <button
                            type="button"
                            className="crm-action-btn secondary"
                            title="แก้ไขข้อมูลลูกค้า"
                            onClick={() => handleOpenEdit(c)}
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
                            className={`crm-action-btn icon-toggle ${c.status}`}
                            title={c.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                            onClick={() => handleToggleStatus(c)}
                          >
                            {c.status === 'active' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
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

      {/* =========================================================================
          SLIDE-OVER SIDE DRAWER: CONTRACT CONSOLE (POLISHED & STREAMLINED)
          ========================================================================= */}
      {showContractDrawer && contractCustomer && (
        <div className="crm-drawer-backdrop">
          <div className="crm-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* 1. Compact Sticky Drawer Header */}
            <div className="crm-drawer-header">
              <div className="crm-drawer-header-left">
                <div className="crm-drawer-header-badges">
                  {contractCustomer.customer_type === 'basecamp' ? (
                    <span className="crm-type-badge basecamp">
                      <Building2 size={12} />
                      {contractCustomer.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : 'Office'} {contractCustomer.basecamp_unit || '-'}
                    </span>
                  ) : (
                    <span className="crm-type-badge shop">
                      <Store size={12} /> Partner Shop
                    </span>
                  )}
                  <span className={`crm-status-dot-badge ${contractCustomer.status}`}>
                    <span className="dot" />
                    {contractCustomer.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h2 className="crm-drawer-title">{contractCustomer.name}</h2>
                <div className="crm-drawer-contact-line">
                  {contractCustomer.contact_name && <span>{contractCustomer.contact_name}</span>}
                  {contractCustomer.phone && <span>• {contractCustomer.phone}</span>}
                  {contractCustomer.email && <span>• {contractCustomer.email}</span>}
                </div>
              </div>

              <button
                type="button"
                className="crm-drawer-close-btn"
                onClick={handleRequestCloseContractDrawer}
                title="ปิดแถบด้านข้าง (Close)"
              >
                <X size={18} />
              </button>
            </div>

            {/* 2. Streamlined Drawer Navigation (Clean 3-Tab Segmented Bar or Contextual Back Bar) */}
            {(contractDrawerTab === 'edit_dates' || contractDrawerTab === 'renew') ? (
              <div className="crm-drawer-sub-nav">
                <button
                  type="button"
                  className="crm-drawer-back-btn crm-subnav-back-btn"
                  onClick={async () => {
                    if (isContractDrawerDirty()) {
                      const msg = 'คุณมีข้อมูลการแก้ไขสัญญาที่ยังไม่ได้บันทึก ต้องการยกเลิกและกลับสู่ภาพรวมสัญญาหรือไม่?';
                      const ok = sysConfirm ? await sysConfirm(msg) : window.confirm(msg);
                      if (!ok) return;
                    }
                    setContractDrawerTab('overview');
                    setEditDateStep('input');
                    setShowTerminateInline(false);
                  }}
                  title="กลับสู่ภาพรวมสัญญา"
                >
                  <ChevronLeft size={16} />
                  <span>กลับสู่ภาพรวมสัญญา</span>
                </button>
                <div className="crm-drawer-sub-badge">
                  {contractDrawerTab === 'edit_dates' ? (
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
            ) : (
              <div className="crm-drawer-nav-bar">
                <div className="crm-drawer-tabs-grid">
                  <button
                    type="button"
                    className={`crm-drawer-tab-btn ${contractDrawerTab === 'overview' ? 'active' : ''}`}
                    onClick={() => {
                      setContractDrawerTab('overview');
                      setShowTerminateInline(false);
                    }}
                  >
                    <FileText size={14} />
                    <span>ภาพรวม</span>
                  </button>

                  <button
                    type="button"
                    className={`crm-drawer-tab-btn ${contractDrawerTab === 'history' ? 'active' : ''}`}
                    onClick={() => {
                      setContractDrawerTab('history');
                      setShowTerminateInline(false);
                    }}
                  >
                    <History size={14} />
                    <span>ประวัติสัญญา ({contractCustomer.contracts?.length || 0})</span>
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      className={`crm-drawer-tab-btn ${contractDrawerTab === 'audit' ? 'active' : ''}`}
                      onClick={() => {
                        setContractDrawerTab('audit');
                        setShowTerminateInline(false);
                      }}
                    >
                      <ShieldCheck size={14} />
                      <span>Audit Log</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 3. Scrollable Drawer Body (Clean Single Container, No Nested Cards) */}
            <div className="crm-drawer-body">
              {/* TAB 1: OVERVIEW */}
              {contractDrawerTab === 'overview' && (
                <div className="crm-tab-pane">
                  {contractCustomer.contracts?.[0] ? (
                    <div className="crm-overview-section">
                      {/* Contract Summary Box */}
                      <div className="crm-summary-hero-box">
                        <div className="crm-hero-headline">
                          <div>
                            <span className="crm-sub-lbl">สัญญาที่ใช้งานปัจจุบัน</span>
                            <div className="crm-hero-id">{contractCustomer.contracts[0].contract_number}</div>
                          </div>
                          <span className={`crm-urgency-tag large ${contractCustomer.contracts[0].urgency}`}>
                            {contractCustomer.contracts[0].evaluated_status} ({contractCustomer.contracts[0].days_left} วัน)
                          </span>
                        </div>

                        <div className="crm-hero-dates-strip">
                          <div className="crm-hds-item">
                            <span className="lbl">วันเริ่มสัญญา (พ.ศ.)</span>
                            <span className="val">{formatThaiDate(contractCustomer.contracts[0].start_date)}</span>
                          </div>
                          <ChevronRight size={16} className="crm-hds-arrow" />
                          <div className="crm-hds-item">
                            <span className="lbl">วันสิ้นสุดสัญญา (พ.ศ.)</span>
                            <span className="val highlight">{formatThaiDate(contractCustomer.contracts[0].end_date)}</span>
                          </div>
                        </div>

                        <div className="crm-hero-meta-row">
                          <div className="crm-meta-item">
                            <Clock size={14} />
                            <span>โควต้าห้องประชุม: <strong>{contractCustomer.contracts[0].monthly_quota_hours} ชม./เดือน</strong></span>
                          </div>
                          {contractCustomer.contracts[0].notes && (
                            <div className="crm-meta-item notes">
                              <Info size={14} />
                              <span>{contractCustomer.contracts[0].notes}</span>
                            </div>
                          )}
                        </div>

                        <div className="crm-hero-btn-row">
                          {canManageContracts && contractCustomer.contracts[0].status !== 'TERMINATED' && (
                            <button
                              type="button"
                              className="crm-btn-action-primary"
                              onClick={() => handleStartEditDates(contractCustomer.contracts[0])}
                            >
                              <Edit2 size={13} />
                              <span>แก้ไขวันที่สัญญา</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="crm-btn-action-secondary"
                            onClick={() => setContractDrawerTab('renew')}
                          >
                            <Plus size={14} />
                            <span>ต่อสัญญาใหม่</span>
                          </button>
                        </div>
                      </div>

                      {/* Inline Danger Action: Terminate Contract */}
                      {contractCustomer.contracts?.[0]?.status === 'ACTIVE' && (
                        <div className="crm-terminate-wrapper">
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
                                <h4>ขอยกเลิกสัญญาก่อนกำหนด ({contractCustomer.contracts[0].contract_number})</h4>
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
                    </div>
                  ) : (
                    <div className="crm-drawer-empty-state">
                      <Info size={24} />
                      <p>ลูกค้ารายนี้ยังไม่มีสัญญาที่บันทึกไว้ในระบบ</p>
                      <button
                        type="button"
                        className="crm-btn-primary"
                        onClick={() => setContractDrawerTab('renew')}
                      >
                        <Plus size={14} />
                        <span>สร้างสัญญาใหม่ (Create Contract)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: EDIT CONTRACT DATES */}
              {contractDrawerTab === 'edit_dates' && contractToEdit && (
                <div className="crm-tab-pane">
                  {editDateStep === 'input' ? (
                    <div className="crm-edit-pane-container">
                      {/* Section Header with quiet micro-copy */}
                      <div className="crm-section-lead">
                        <div className="crm-section-lead-title">
                          <Edit2 size={15} className="crm-lead-icon" />
                          <h3>แก้ไขวันที่สัญญา</h3>
                        </div>
                        <p className="crm-section-lead-desc">
                          การแก้ไขจะบันทึกทับวันที่ของสัญญาเดิม (<strong>{contractToEdit.contract_number}</strong>) โดยไม่เปลี่ยนเลขสัญญา ไม่รีเซ็ตโควต้า และไม่กระทบต่อประวัติการจองเดิม
                        </p>
                      </div>

                      {/* Reference line */}
                      <div className="crm-ref-strip">
                        <span className="lbl">วันที่ปัจจุบันในระบบ:</span>
                        <span className="val">{formatThaiDate(contractToEdit.start_date)} ถึง {formatThaiDate(contractToEdit.end_date)} (พ.ศ.)</span>
                      </div>

                      {/* 2-Column Responsive Date Pickers with Adaptive Alignment */}
                      <div className="crm-form-grid-2">
                        <div className="crm-form-group">
                          <label className="crm-form-label">
                            <Calendar size={13} />
                            <span>วันเริ่มสัญญาใหม่ (พ.ศ.)</span>
                            <span className="req">*</span>
                          </label>
                          <ThaiDatePicker
                            value={editDateForm.start_date}
                            onChange={(val) => setEditDateForm(prev => ({ ...prev, start_date: val }))}
                            required
                            align="left"
                          />
                        </div>

                        <div className="crm-form-group">
                          <label className="crm-form-label">
                            <Calendar size={13} />
                            <span>วันสิ้นสุดสัญญาใหม่ (พ.ศ.)</span>
                            <span className="req">*</span>
                          </label>
                          <ThaiDatePicker
                            value={editDateForm.end_date}
                            onChange={(val) => setEditDateForm(prev => ({ ...prev, end_date: val }))}
                            required
                            align="right"
                          />
                        </div>
                      </div>

                      {/* Reason */}
                      <div className="crm-form-group">
                        <label className="crm-form-label">
                          <ShieldCheck size={13} color="#2563eb" />
                          <span>เหตุผลในการแก้ไขวันที่สัญญา</span>
                          <span className="req">*</span>
                          <span className="crm-label-hint">(จำเป็นต้องบันทึกใน Audit Log)</span>
                        </label>
                        <textarea
                          rows={3}
                          className="crm-form-textarea"
                          placeholder="เช่น ปรับวันเริ่มสัญญาให้ตรงตามเอกสารส่งมอบพื้นที่จริง, ขยายเวลาสัญญาชดเชย..."
                          value={editDateForm.reason}
                          onChange={(e) => setEditDateForm(prev => ({ ...prev, reason: e.target.value }))}
                          required
                        />
                      </div>
                    </div>
                  ) : (
                    /* Step 2: Inline Diff Confirmation inside Drawer */
                    <div className="crm-confirm-diff-container">
                      <div className="crm-section-lead">
                        <div className="crm-section-lead-title">
                          <AlertCircle size={16} color="#2563eb" />
                          <h3>ตรวจสอบการแก้ไขวันที่สัญญา</h3>
                        </div>
                        <p className="crm-section-lead-desc">
                          กรุณาตรวจสอบความถูกต้องของข้อมูลสัญญาก่อนบันทึกการเปลี่ยนแปลง
                        </p>
                      </div>

                      <div className="crm-diff-summary-card">
                        <div className="crm-dsc-head">
                          <span>สัญญาเลขที่: <strong>{contractToEdit.contract_number}</strong></span>
                        </div>

                        <div className="crm-diff-table">
                          <div className="crm-diff-thead">
                            <span>รายการ</span>
                            <span>วันที่เดิม</span>
                            <span>วันที่แก้ไขใหม่ (พ.ศ.)</span>
                          </div>
                          <div className="crm-diff-trow">
                            <span className="lbl">วันเริ่มสัญญา:</span>
                            <span className="old">{formatThaiDate(contractToEdit.start_date)}</span>
                            <span className="new highlight">{formatThaiDate(editDateForm.start_date)}</span>
                          </div>
                          <div className="crm-diff-trow">
                            <span className="lbl">วันสิ้นสุดสัญญา:</span>
                            <span className="old">{formatThaiDate(contractToEdit.end_date)}</span>
                            <span className="new highlight">{formatThaiDate(editDateForm.end_date)}</span>
                          </div>
                        </div>

                        <div className="crm-dsc-reason">
                          <span className="lbl">เหตุผลที่ระบุ:</span>
                          <p className="txt">{editDateForm.reason}</p>
                        </div>

                        <div className="crm-dsc-notice">
                          <ShieldCheck size={14} color="#059669" />
                          <span>การแก้ไขนี้จะถูกบันทึกลง Audit Log พร้อมชื่อผู้ใช้งานของคุณ ({user?.username || 'staff'})</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: RENEW CONTRACT */}
              {contractDrawerTab === 'renew' && (
                <div className="crm-tab-pane">
                  <div className="crm-section-lead">
                    <div className="crm-section-lead-title">
                      <Sparkles size={15} className="crm-lead-icon" />
                      <h3>ต่อสัญญาใหม่ (Renew Contract)</h3>
                    </div>
                    <p className="crm-section-lead-desc">
                      สร้างสัญญาฉบับใหม่สำหรับรอบถัดไป และคงประวัติสัญญาเดิมไว้ในระบบอย่างครบถ้วน
                    </p>
                  </div>

                  <div className="crm-form-grid-2">
                    <div className="crm-form-group">
                      <label className="crm-form-label">
                        <Calendar size={13} />
                        <span>วันเริ่มสัญญาใหม่ (พ.ศ.)</span>
                        <span className="req">*</span>
                      </label>
                      <ThaiDatePicker
                        value={renewForm.start_date}
                        onChange={(val) => setRenewForm(prev => ({ ...prev, start_date: val }))}
                        required
                        align="left"
                      />
                    </div>

                    <div className="crm-form-group">
                      <label className="crm-form-label">
                        <Calendar size={13} />
                        <span>วันสิ้นสุดสัญญาใหม่ (พ.ศ.)</span>
                        <span className="req">*</span>
                      </label>
                      <ThaiDatePicker
                        value={renewForm.end_date}
                        onChange={(val) => setRenewForm(prev => ({ ...prev, end_date: val }))}
                        required
                        align="right"
                      />
                    </div>
                  </div>

                  <div className="crm-form-grid-2">
                    <div className="crm-form-group">
                      <label className="crm-form-label">
                        <Clock size={13} />
                        <span>โควต้าห้องประชุม (ชม./เดือน)</span>
                        <span className="req">*</span>
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
                      <label className="crm-form-label">
                        <FileText size={13} />
                        <span>เลขสัญญา (เว้นว่างเพื่อสร้างอัตโนมัติ)</span>
                      </label>
                      <input
                        type="text"
                        className="crm-form-input"
                        placeholder="เช่น CTR-BC-401-2027"
                        value={renewForm.contract_number}
                        onChange={(e) => setRenewForm(prev => ({ ...prev, contract_number: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="crm-form-group">
                    <label className="crm-form-label">หมายเหตุการต่อสัญญา</label>
                    <textarea
                      rows={2}
                      className="crm-form-textarea"
                      placeholder="เช่น ต่อสัญญารอบปีที่ 2, เงื่อนไขส่วนลดเดิม..."
                      value={renewForm.notes}
                      onChange={(e) => setRenewForm(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              {/* TAB 4: CONTRACT HISTORY */}
              {contractDrawerTab === 'history' && (
                <div className="crm-tab-pane">
                  <div className="crm-section-lead">
                    <div className="crm-section-lead-title">
                      <History size={15} className="crm-lead-icon" />
                      <h3>ประวัติสัญญาทั้งหมด ({contractCustomer.contracts?.length || 0} ฉบับ)</h3>
                    </div>
                    <p className="crm-section-lead-desc">
                      รายการสัญญาทั้งหมดของ {contractCustomer.name} จัดเรียงตามรอบระยะเวลาสัญญา
                    </p>
                  </div>

                  <div className="crm-history-stream">
                    {contractCustomer.contracts?.map((ctr) => (
                      <div key={ctr.id} className="crm-history-card">
                        <div className="crm-hc-header">
                          <div className="crm-hc-id-group">
                            <span className="crm-hc-id">{ctr.contract_number}</span>
                            <span className={`crm-urgency-tag ${ctr.urgency}`}>
                              {ctr.evaluated_status}
                            </span>
                          </div>
                          {canManageContracts && ctr.status !== 'TERMINATED' && (
                            <button
                              type="button"
                              className="crm-action-btn secondary"
                              onClick={() => handleStartEditDates(ctr)}
                              title="แก้ไขวันที่ของสัญญานี้"
                            >
                              <Edit2 size={12} />
                              <span>แก้วันที่</span>
                            </button>
                          )}
                        </div>

                        <div className="crm-hc-dates">
                          <span>ระยะเวลา: </span>
                          <strong>{formatThaiDate(ctr.start_date)}</strong>
                          <span> ถึง </span>
                          <strong>{formatThaiDate(ctr.end_date)}</strong>
                          <span className="crm-be-pill">พ.ศ.</span>
                        </div>

                        <div className="crm-hc-footer">
                          <span>โควต้า: {ctr.monthly_quota_hours} ชม./เดือน</span>
                          {ctr.notes && <span>• {ctr.notes}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 5: AUDIT LOG (Admin Only) */}
              {contractDrawerTab === 'audit' && isAdmin && (
                <div className="crm-tab-pane">
                  <div className="crm-section-lead">
                    <div className="crm-section-lead-title">
                      <ShieldCheck size={16} color="#2563eb" />
                      <h3>บันทึกประวัติการแก้ไขสัญญา (Audit History)</h3>
                      <span className="crm-admin-pill">Admin</span>
                    </div>
                    <p className="crm-section-lead-desc">
                      บันทึกการกระทำและการแก้ไขสัญญาของผู้ใช้งานในระบบอย่างปลอดภัย
                    </p>
                  </div>

                  {loadingAudit ? (
                    <div className="crm-drawer-empty-state">
                      <RefreshCw size={20} className="animate-spin crm-spinner" />
                      <span>กำลังโหลดบันทึก Audit Log...</span>
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="crm-drawer-empty-state">
                      <History size={24} style={{ color: '#94a3b8' }} />
                      <p>ยังไม่มีประวัติการแก้ไขข้อมูลของลูกค้ารายนี้</p>
                    </div>
                  ) : (
                    <div className="crm-audit-stream">
                      {auditLogs.map((log) => {
                        let detailsObj = null;
                        try {
                          detailsObj = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                        } catch (_) {
                          detailsObj = { raw: log.details };
                        }

                        return (
                          <div key={log.id} className="crm-audit-entry">
                            <div className="crm-ae-top">
                              <div className="crm-ae-badge-row">
                                <span className="crm-ae-action-tag">{log.action}</span>
                                <span className="crm-ae-user">โดย: <strong>{log.performed_by}</strong></span>
                              </div>
                              <span className="crm-ae-time">{formatThaiDateTime(log.created_at)}</span>
                            </div>

                            {log.action === 'EDIT_CONTRACT_DATES' && detailsObj && (
                              <div className="crm-ae-diff-box">
                                <div className="crm-ae-diff-row">
                                  <span className="lbl">วันเริ่มสัญญา:</span>
                                  <span className="old">{formatThaiDate(detailsObj.old_start_date)}</span>
                                  <ChevronRight size={12} />
                                  <span className="new">{formatThaiDate(detailsObj.new_start_date)}</span>
                                </div>
                                <div className="crm-ae-diff-row">
                                  <span className="lbl">วันสิ้นสุดสัญญา:</span>
                                  <span className="old">{formatThaiDate(detailsObj.old_end_date)}</span>
                                  <ChevronRight size={12} />
                                  <span className="new">{formatThaiDate(detailsObj.new_end_date)}</span>
                                </div>
                                {detailsObj.change_reason && (
                                  <div className="crm-ae-reason-row">
                                    <strong>เหตุผล:</strong> {detailsObj.change_reason}
                                  </div>
                                )}
                              </div>
                            )}

                            {log.action !== 'EDIT_CONTRACT_DATES' && (
                              <div className="crm-ae-raw">
                                {typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}
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

            {/* 4. Unified Sticky Action Footer (ONLY when editing or renewing, no redundant close buttons) */}
            {(contractDrawerTab === 'edit_dates' || contractDrawerTab === 'renew') && (
              <div className="crm-drawer-action-footer">
                {contractDrawerTab === 'edit_dates' && editDateStep === 'input' && (
                  <>
                    <button
                      type="button"
                      className="crm-btn-secondary"
                      onClick={async () => {
                        if (isContractDrawerDirty()) {
                          const msg = 'คุณมีข้อมูลการแก้ไขสัญญาที่ยังไม่ได้บันทึก ต้องการยกเลิกและกลับสู่ภาพรวมสัญญาหรือไม่?';
                          const ok = sysConfirm ? await sysConfirm(msg) : window.confirm(msg);
                          if (!ok) return;
                        }
                        setContractDrawerTab('overview');
                        setEditDateStep('input');
                      }}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      className="crm-btn-primary"
                      onClick={handleProceedToConfirmEdit}
                    >
                      <span>ตรวจสอบข้อมูลก่อนบันทึก</span>
                      <ChevronRight size={15} />
                    </button>
                  </>
                )}

                {contractDrawerTab === 'edit_dates' && editDateStep === 'confirm' && (
                  <>
                    <button
                      type="button"
                      className="crm-btn-secondary"
                      onClick={() => setEditDateStep('input')}
                      disabled={isSubmitting}
                    >
                      <ChevronLeft size={15} />
                      <span>ย้อนกลับไปแก้ไข</span>
                    </button>
                    <button
                      type="button"
                      className="crm-btn-primary"
                      onClick={handleConfirmSubmitEdit}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการแก้ไขวันที่สัญญา'}
                    </button>
                  </>
                )}

                {contractDrawerTab === 'renew' && (
                  <>
                    <button
                      type="button"
                      className="crm-btn-secondary"
                      onClick={() => setContractDrawerTab('overview')}
                      disabled={isSubmitting}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      className="crm-btn-primary"
                      onClick={handleSubmitRenew}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันการต่อสัญญาใหม่'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: CREATE / EDIT CUSTOMER (WIDE 3-SECTION ARCHITECTURE)
          ========================================================================= */}
      {showAddEditModal && (
        <div className="crm-modal-backdrop">
          <div
            className={`crm-modal-dialog crm-modal-dialog-wide ${editingCustomer ? 'edit-mode' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="crm-modal-header">
              <div className="crm-modal-title">
                <div className="crm-modal-icon-badge">
                  {editingCustomer ? <Edit2 size={18} /> : <Plus size={18} />}
                </div>
                <div>
                  <h3>{editingCustomer ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้า / ร้านค้าใหม่'}</h3>
                  <p className="crm-modal-subtitle">
                    {editingCustomer
                      ? 'แก้ไขรายละเอียดข้อมูลผู้เช่าหรือร้านค้าพันธมิตร'
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

            <form onSubmit={handleSubmitCustomerForm} className="crm-modal-form">
              <div className="crm-modal-body">
                <div className={`crm-wide-modal-grid ${editingCustomer ? 'edit-mode' : ''}`}>
                  {/* SECTION 1: ข้อมูลผู้เช่า / บริษัท (Customer Information) */}
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

                  {/* SECTION 2: ข้อมูลการติดต่อ (Contact Details) */}
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

                  {/* SECTION 3: ข้อมูลสัญญาเริ่มต้น (Initial Contract — ปฏิทินไทย พ.ศ.) */}
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
                    {isSubmitting ? 'กำลังบันทึก...' : (editingCustomer ? 'บันทึกการแก้ไข' : 'สร้างลูกค้าใหม่')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: TRANSFER BASECAMP TENANT
          ========================================================================= */}
      {showTransferModal && transferUnitCustomer && (
        <div className="crm-modal-backdrop">
          <div className="crm-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header">
              <div className="crm-modal-title">
                <ArrowRightLeft size={18} />
                <h3>เปลี่ยนผู้เช่ายูนิต {transferUnitCustomer.basecamp_unit}</h3>
              </div>
              <button
                type="button"
                className="crm-modal-close-btn"
                onClick={() => setShowTransferModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitTransfer}>
              <div className="crm-modal-body">
                <div className="crm-transfer-notice">
                  <ShieldAlert size={18} />
                  <div>
                    <strong>การแยกประวัติอย่างปลอดภัย:</strong> ผู้เช่าเดิม (<strong>{transferUnitCustomer.name}</strong>) จะถูกปรับสถานะเป็น Inactive และยุติสัญญาเดิม โดยยอดใช้โควต้าและประวัติการจองของผู้เช่าเดิมจะไม่ถูกโอนมายังผู้เช่ารายใหม่
                  </div>
                </div>

                <div className="crm-form-group">
                  <label className="crm-form-label">ชื่อบริษัท / ผู้เช่ารายใหม่ <span className="req">*</span></label>
                  <input
                    type="text"
                    className="crm-form-input"
                    placeholder="ชื่อผู้เช่ารายใหม่..."
                    value={transferForm.name}
                    onChange={(e) => setTransferForm({ ...transferForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="crm-form-grid-2">
                  <div className="crm-form-group">
                    <label className="crm-form-label">ชื่อผู้ติดต่อ</label>
                    <input
                      type="text"
                      className="crm-form-input"
                      placeholder="คุณสมศักดิ์..."
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
                </div>

                <div className="crm-form-grid-2">
                  <div className="crm-form-group">
                    <label className="crm-form-label">อีเมล</label>
                    <input
                      type="email"
                      className="crm-form-input"
                      value={transferForm.email}
                      onChange={(e) => setTransferForm({ ...transferForm, email: e.target.value })}
                    />
                  </div>

                  <div className="crm-form-group">
                    <label className="crm-form-label">เลขประจำตัวผู้เสียภาษี</label>
                    <input
                      type="text"
                      className="crm-form-input"
                      value={transferForm.tax_id}
                      onChange={(e) => setTransferForm({ ...transferForm, tax_id: e.target.value })}
                    />
                  </div>
                </div>

                <div className="crm-form-grid-2">
                  <div className="crm-form-group">
                    <label className="crm-form-label">
                      วันเริ่มสัญญาใหม่ (พ.ศ.) <span className="req">*</span>
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
                      วันสิ้นสุดสัญญาใหม่ (พ.ศ.) <span className="req">*</span>
                    </label>
                    <ThaiDatePicker
                      value={transferForm.end_date}
                      onChange={(val) => setTransferForm(prev => ({ ...prev, end_date: val }))}
                      required
                      align="right"
                    />
                  </div>
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
