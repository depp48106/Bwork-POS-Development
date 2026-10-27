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
  X,
  ArrowRightLeft,
  Info,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  RefreshCw,
  Phone,
  Mail,
  MapPin,
  History,
  ShieldCheck,
  Check,
  CalendarDays,
  FileCheck,
  MoreVertical,
  ExternalLink
} from 'lucide-react';
import ThaiDatePicker from './ThaiDatePicker';
import {
  formatThaiDate,
  formatThaiDateTime,
  getThaiDateInputHint
} from '../utils/thaiDateHelper';
import './CustomerManagement.css';

/**
 * Format Thai Contract Status Label & Urgency Style
 * Presentation-layer helper: does not mutate backend/database status.
 */
export const formatThaiContractStatus = (contract) => {
  if (!contract) return { label: 'ไม่มีสัญญา', urgency: 'empty', daysText: null };

  const rawStatus = (contract.evaluated_status || contract.status || '').toUpperCase();
  let urgency = contract.urgency || (rawStatus === 'ACTIVE' ? 'active' : 'expired');

  if (rawStatus === 'TERMINATED') {
    return { label: 'ยกเลิกแล้ว', urgency: 'danger', daysText: null };
  }
  if (rawStatus === 'EXPIRED') {
    return { label: 'หมดอายุ', urgency: 'expired', daysText: null };
  }
  if (rawStatus === 'PENDING') {
    return { label: 'รอเริ่มสัญญา', urgency: 'warning', daysText: null };
  }

  // Active status - calculate or check days left
  let daysLeft = contract.days_left;
  if (daysLeft === undefined && contract.end_date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(contract.end_date);
    end.setHours(0, 0, 0, 0);
    const diffTime = end.getTime() - today.getTime();
    daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  if (daysLeft !== undefined && daysLeft !== null && !isNaN(daysLeft)) {
    if (daysLeft < 0) {
      return { label: 'หมดอายุ', urgency: 'expired', daysText: null };
    }
    return {
      label: `ใช้งานอยู่ · เหลือ ${daysLeft} วัน`,
      urgency: daysLeft <= 7 ? 'danger' : daysLeft <= 30 ? 'warning' : 'active',
      daysText: `เหลือ ${daysLeft} วัน`
    };
  }

  return { label: 'ใช้งานอยู่', urgency: 'active', daysText: null };
};

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

  // 1. Separate Customer Edit/Create Modal State
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
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

  // 2. Separate Dedicated Contract Management Modal State
  const [showContractModal, setShowContractModal] = useState(false);
  const [contractCustomer, setContractCustomer] = useState(null);
  const [loadingContract, setLoadingContract] = useState(false);
  const [contractView, setContractView] = useState('overview'); // 'overview' | 'edit_dates' | 'renew'
  const [contractToEdit, setContractToEdit] = useState(null);
  const [editDateStep, setEditDateStep] = useState('input'); // 'input' | 'confirm'
  const [showTerminateInline, setShowTerminateInline] = useState(false);
  const [showHistoryAccordion, setShowHistoryAccordion] = useState(false);
  const [showAuditAccordion, setShowAuditAccordion] = useState(false);

  // Form states inside Contract Modal
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

  // 3. Basecamp Unit Transfer Modal State
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferUnitCustomer, setTransferUnitCustomer] = useState(null);
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

  // Alerts & Audit Data
  const [alerts, setAlerts] = useState({
    summary: { expiring_30_days: 0, expiring_15_days: 0, expiring_7_days: 0, expired: 0, total_active: 0 },
    alerts: []
  });
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dirty State Tracking Refs
  const initialCustomerFormRef = useRef(null);
  const initialContractEditRef = useRef(null);

  // Auth & Roles
  const token = localStorage.getItem('token');
  const headers = useMemo(() => ({
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }), [token]);

  const isAdmin = user && (user.role === 'admin' || user.username === 'admin');
  const canManageContracts = isAdmin || (user?.role === 'staff') || (user?.role === 'manager');

  // Basecamp Units
  const officeUnits = useMemo(() => Array.from({ length: 18 }, (_, i) => String(401 + i)), []);
  const hotdeskUnits = useMemo(() => Array.from({ length: 16 }, (_, i) => String(419 + i)), []);

  // Fetch Customers with authoritative quota calculation
  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?month=${selectedMonth}&year=${selectedYear}`, { headers });
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

  // Fetch Contract Alerts
  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/customers/contracts/alerts', { headers });
      const data = await res.json();
      if (data.success) {
        setAlerts(data);
      }
    } catch (err) {
      console.error('[CustomerManagement] fetchAlerts error:', err);
    }
  };

  // Fetch Audit Logs for Customer
  const fetchAuditLogs = async (customerId) => {
    if (!isAdmin || !customerId) return;
    setLoadingAudit(true);
    try {
      const res = await fetch(`/api/customers/${customerId}/audit-logs`, { headers });
      const data = await res.json();
      if (data.success) {
        setAuditLogs(data.audit_logs || []);
      }
    } catch (err) {
      console.error('[CustomerManagement] fetchAuditLogs error:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchAlerts();
  }, [selectedMonth, selectedYear]);

  // Dirty State Checker for Customer Profile Form
  const isCustomerFormDirty = () => {
    if (!initialCustomerFormRef.current) return false;
    const init = initialCustomerFormRef.current;
    return (
      customerForm.name !== init.name ||
      customerForm.contact_name !== init.contact_name ||
      customerForm.phone !== init.phone ||
      customerForm.email !== init.email ||
      customerForm.tax_id !== init.tax_id ||
      customerForm.address !== init.address ||
      customerForm.basecamp_unit !== init.basecamp_unit ||
      customerForm.basecamp_sub_type !== init.basecamp_sub_type ||
      customerForm.customer_type !== init.customer_type
    );
  };

  // Dirty State Checker for Contract Edit Form
  const isContractFormDirty = () => {
    if (!initialContractEditRef.current) return false;
    const init = initialContractEditRef.current;
    return (
      editDateForm.start_date !== init.start_date ||
      editDateForm.end_date !== init.end_date ||
      editDateForm.reason !== init.reason
    );
  };

  // Guard Closing Customer Edit Modal
  const handleRequestCloseAddEditModal = async () => {
    if (isCustomerFormDirty()) {
      const msg = 'คุณมีข้อมูลที่แก้ไขค้างอยู่ ต้องการละทิ้งการเปลี่ยนแปลงและปิดหน้าต่างใช่หรือไม่?';
      const ok = sysConfirm ? await sysConfirm(msg) : window.confirm(msg);
      if (!ok) return;
    }
    setShowAddEditModal(false);
    setEditingCustomer(null);
    initialCustomerFormRef.current = null;
  };

  // Guard Closing Contract Management Modal
  const handleRequestCloseContractModal = async () => {
    if (contractView === 'edit_dates' && isContractFormDirty()) {
      const msg = 'คุณมีข้อมูลการแก้ไขสัญญาที่ยังไม่ได้บันทึก ต้องการยกเลิกและปิดหน้าต่างใช่หรือไม่?';
      const ok = sysConfirm ? await sysConfirm(msg) : window.confirm(msg);
      if (!ok) return;
    }
    setShowContractModal(false);
    setContractCustomer(null);
    setContractToEdit(null);
    setContractView('overview');
    setShowTerminateInline(false);
    setEditDateStep('input');
    initialContractEditRef.current = null;
  };

  // Keyboard shortcut (Escape)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showContractModal) {
          handleRequestCloseContractModal();
        } else if (showAddEditModal) {
          handleRequestCloseAddEditModal();
        } else if (showTransferModal) {
          setShowTransferModal(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showContractModal, showAddEditModal, showTransferModal, customerForm, editDateForm]);

  // Open Create Customer Modal
  const handleOpenCreate = () => {
    setEditingCustomer(null);
    const today = new Date();
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 1);
    nextYear.setDate(nextYear.getDate() - 1);

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

  // Open Edit Customer Info Modal (Clean & Focused)
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
          if (sysAlert) sysAlert('บันทึกการแก้ไขข้อมูลลูกค้าเรียบร้อยแล้ว', 'success');
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

  // Open Dedicated Contract Management Modal (Responsive, with Immediate Feedback)
  const handleOpenContractModal = async (c, defaultView = 'overview') => {
    setContractCustomer(c);
    setShowContractModal(true);
    setLoadingContract(true);
    setContractView(defaultView);
    setShowTerminateInline(false);
    setEditDateStep('input');
    setShowHistoryAccordion(false);
    setShowAuditAccordion(false);

    try {
      const res = await fetch(`/api/customers/${c.id}?month=${selectedMonth}&year=${selectedYear}`, { headers });
      const data = await res.json();
      if (data.success && data.customer) {
        const cust = data.customer;
        setContractCustomer(cust);
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

        if (isAdmin) {
          fetchAuditLogs(cust.id);
        }
      } else {
        if (sysAlert) sysAlert(data.error || 'ไม่สามารถโหลดรายละเอียดสัญญาและโควตาได้', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาดในการโหลดสัญญา: ' + err.message, 'error');
    } finally {
      setLoadingContract(false);
    }
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
    setContractView('edit_dates');
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

  // Confirm and Submit Edit Contract Dates
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

        // Reload data
        const custRes = await fetch(`/api/customers/${contractCustomer.id}?month=${selectedMonth}&year=${selectedYear}`, { headers });
        const custData = await custRes.json();
        if (custData.success) {
          setContractCustomer(custData.customer);
          setContractToEdit(custData.customer.contracts?.[0] || null);
        }
        setEditDateStep('input');
        setContractView('overview');
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

        const custRes = await fetch(`/api/customers/${contractCustomer.id}?month=${selectedMonth}&year=${selectedYear}`, { headers });
        const custData = await custRes.json();
        if (custData.success) {
          setContractCustomer(custData.customer);
          setContractToEdit(custData.customer.contracts?.[0] || null);
        }
        setContractView('overview');
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

    const ok = sysConfirm
      ? await sysConfirm(`ยืนยันการยกเลิกสัญญา ${activeContract.contract_number} ก่อนกำหนด?`)
      : true;
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

        const custRes = await fetch(`/api/customers/${contractCustomer.id}?month=${selectedMonth}&year=${selectedYear}`, { headers });
        const custData = await custRes.json();
        if (custData.success) {
          setContractCustomer(custData.customer);
          setContractToEdit(custData.customer.contracts?.[0] || null);
        }
        setContractView('overview');
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

  // Toggle Customer Active/Inactive Status
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
    const ok = sysConfirm
      ? await sysConfirm(`ยืนยันการลบลูกค้ารายนี้ (${c.name}) ออกจากระบบ? สัญญาและประวัติการตรวจสอบจะถูกลบออกด้วย`)
      : true;
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
      } else {
        if (sysAlert) sysAlert(data.error || 'ลบข้อมูลไม่สำเร็จ', 'error');
      }
    } catch (err) {
      if (sysAlert) sysAlert('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
  };

  // Filtered Customers List
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (filterType !== 'all' && c.customer_type !== filterType) return false;
      if (filterStatus !== 'all' && c.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = c.name?.toLowerCase().includes(q);
        const matchUnit = c.basecamp_unit?.toLowerCase().includes(q);
        const matchContact = c.contact_name?.toLowerCase().includes(q);
        const matchPhone = c.phone?.toLowerCase().includes(q);
        const matchTax = c.tax_id?.toLowerCase().includes(q);
        if (!matchName && !matchUnit && !matchContact && !matchPhone && !matchTax) return false;
      }
      return true;
    });
  }, [customers, filterType, filterStatus, searchQuery]);

  return (
    <div className="crm-container">
      {/* 1. Sleek, Minimal Dashboard Header */}
      <div className="crm-header">
        <div className="crm-title-area">
          <div className="crm-title-row">
            <Users size={20} className="crm-title-icon" aria-hidden="true" />
            <h1 className="crm-title">จัดการลูกค้า</h1>
          </div>
          <p className="crm-subtitle">
            จัดการข้อมูลผู้เช่า Basecamp ชั้น 4 ร้านค้าพันธมิตร และสิทธิ์โควตาห้องประชุม
          </p>
        </div>

        <div className="crm-header-actions">
          <button
            type="button"
            className="crm-btn-primary"
            onClick={handleOpenCreate}
            aria-label="เพิ่มข้อมูลลูกค้าหรือร้านค้าใหม่"
            title="เพิ่มข้อมูลลูกค้าหรือร้านค้าใหม่"
          >
            <Plus size={15} aria-hidden="true" />
            <span>เพิ่มลูกค้า / ร้านค้า</span>
          </button>
        </div>
      </div>

      {/* 2. Compact Minimal Metric Bar */}
      <div className="crm-metric-strip">
        <div className="crm-metric-pill">
          <span className="lbl">ลูกค้าทั้งหมด</span>
          <span className="val">{customers.length}</span>
        </div>
        <div className="crm-metric-pill">
          <span className="lbl">สัญญาใช้งานอยู่</span>
          <span className="val text-success">{alerts.summary?.total_active || 0}</span>
        </div>
        <div className="crm-metric-pill">
          <span className="lbl">ใกล้หมดอายุ (30 วัน)</span>
          <span className="val text-warning">
            {(alerts.summary?.expiring_30_days || 0) + (alerts.summary?.expiring_15_days || 0) + (alerts.summary?.expiring_7_days || 0)}
          </span>
        </div>
        <div className="crm-metric-pill">
          <span className="lbl">Basecamp</span>
          <span className="val">{customers.filter(c => c.customer_type === 'basecamp').length}</span>
        </div>
        <div className="crm-metric-pill">
          <span className="lbl">Partner Shop</span>
          <span className="val">{customers.filter(c => c.customer_type === 'shop').length}</span>
        </div>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="crm-filter-bar">
        <div className="crm-search-box">
          <Search size={16} className="crm-search-icon" />
          <input
            type="text"
            className="crm-search-input"
            placeholder="ค้นหาชื่อลูกค้า, เลขยูนิต, ผู้ติดต่อ, หรือเบอร์โทร..."
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

        <div className="crm-filter-group">
          {/* Segmented Filter: Customer Type */}
          <div className="crm-segmented-control">
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
              Partner Shop
            </button>
          </div>

          {/* Status Filter */}
          <select
            className="crm-select-compact"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">สถานะทั้งหมด</option>
            <option value="active">เปิดใช้งาน (Active)</option>
            <option value="inactive">ปิดใช้งาน (Inactive)</option>
          </select>

          {/* Month / Year Quota Period */}
          <div className="crm-period-picker">
            <CalendarDays size={14} className="crm-period-icon" />
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
                <option key={y} value={y}>{parseInt(y) + 543}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 4. Minimal, Clean Customer Table */}
      <div className="crm-table-card">
        <div className="crm-table-responsive">
          <table className="crm-table">
            <thead>
              <tr>
                <th className="crm-col-customer">ลูกค้า / ยูนิต</th>
                <th className="crm-col-contact">ผู้ติดต่อ / เบอร์โทร</th>
                <th className="crm-col-contract">สถานะสัญญา</th>
                <th className="crm-col-quota">โควตาประจำเดือน</th>
                <th className="crm-col-actions" style={{ textAlign: 'right' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="crm-table-placeholder">
                    <RefreshCw size={20} className="crm-spin" />
                    <span>กำลังโหลดข้อมูลลูกค้า...</span>
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="crm-table-placeholder">
                    <span>ไม่พบข้อมูลลูกค้าที่ตรงกับเงื่อนไขการค้นหา</span>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => {
                  const ctr = c.active_contract || (c.contracts && c.contracts[0]) || null;
                  const quota = c.quota_summary || { max_quota: 4.0, remaining_quota: 4.0, used_quota: 0 };
                  const isBasecamp = c.customer_type === 'basecamp';
                  const statusInfo = formatThaiContractStatus(ctr);

                  return (
                    <tr key={c.id} className={c.status === 'inactive' ? 'row-inactive' : ''}>
                      {/* Column 1: Customer Name & Type/Unit */}
                      <td className="crm-col-customer">
                        <div className="crm-customer-cell">
                          <span
                            className="crm-customer-name"
                            onClick={() => handleOpenEdit(c)}
                            title={`คลิกเพื่อแก้ไขข้อมูล ${c.name}`}
                          >
                            {c.name}
                          </span>
                          <div className="crm-customer-sub">
                            {isBasecamp ? (
                              <span className="crm-type-tag basecamp">
                                {c.basecamp_sub_type === 'hotdesk' ? 'Hotdesk' : 'Office'} {c.basecamp_unit}
                              </span>
                            ) : (
                              <span className="crm-type-tag shop">Partner Shop</span>
                            )}
                            {c.tax_id && <span className="crm-tax-hint">Tax: {c.tax_id}</span>}
                          </div>
                          {/* Compact Contact info for Tablet screens */}
                          <div className="crm-tablet-contact-hint">
                            {c.contact_name && <span>{c.contact_name}</span>}
                            {c.phone && <span> · {c.phone}</span>}
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Contact Person (Desktop only) */}
                      <td className="crm-col-contact">
                        <div className="crm-contact-cell">
                          <span className="contact-name">{c.contact_name || '-'}</span>
                          {c.phone && <span className="contact-phone">{c.phone}</span>}
                        </div>
                      </td>

                      {/* Column 3: Contract Summary Badge */}
                      <td className="crm-col-contract">
                        {ctr ? (
                          <div
                            className="crm-contract-cell"
                            onClick={() => handleOpenContractModal(c)}
                            title="คลิกเพื่อดูและจัดการสัญญา"
                          >
                            <span className={`crm-status-pill ${statusInfo.urgency}`}>
                              <span className="dot" aria-hidden="true" />
                              {statusInfo.label}
                            </span>
                            <span className="crm-contract-period">
                              {formatThaiDate(ctr.start_date)} – {formatThaiDate(ctr.end_date)}
                            </span>
                          </div>
                        ) : (
                          <div
                            className="crm-contract-cell empty"
                            onClick={() => handleOpenContractModal(c)}
                            title="คลิกเพื่อสร้างสัญญาใหม่"
                          >
                            <span className="crm-status-pill empty">ไม่มีสัญญา</span>
                            <span className="crm-contract-create-hint">+ สร้างสัญญา</span>
                          </div>
                        )}
                      </td>

                      {/* Column 4: Quota Summary (Desktop only) */}
                      <td className="crm-col-quota">
                        <div
                          className="crm-quota-cell"
                          onClick={() => handleOpenContractModal(c)}
                          title="คลิกเพื่อดูรายละเอียดโควตา"
                        >
                          <div className="crm-quota-val">
                            <strong>{quota.remaining_quota ?? 0}</strong> / {quota.max_quota ?? 4} ชม.
                          </div>
                          <span className="crm-quota-sub">
                            {(quota.used_quota ?? 0) > 0 ? `ใช้ไป ${quota.used_quota} ชม.` : 'ยังไม่ถูกใช้'}
                          </span>
                        </div>
                      </td>

                      {/* Column 5: Clear, Separated Action Buttons */}
                      <td className="crm-col-actions" style={{ textAlign: 'right' }}>
                        <div className="crm-row-actions">
                          {/* 1. ปุ่มแก้ไขข้อมูลลูกค้า */}
                          <button
                            type="button"
                            className="crm-btn-row-action"
                            onClick={() => handleOpenEdit(c)}
                            title={`แก้ไขข้อมูลลูกค้า ${c.name}`}
                            aria-label={`แก้ไขข้อมูลลูกค้า ${c.name}`}
                          >
                            <Edit2 size={13} aria-hidden="true" />
                            <span>แก้ไข</span>
                          </button>

                          {/* 2. ปุ่มจัดการสัญญา */}
                          <button
                            type="button"
                            className="crm-btn-row-action primary"
                            onClick={() => handleOpenContractModal(c)}
                            title={`จัดการสัญญาและโควตาของ ${c.name}`}
                            aria-label={`จัดการสัญญาและโควตาของ ${c.name}`}
                          >
                            <FileText size={13} aria-hidden="true" />
                            <span>สัญญา</span>
                          </button>

                          {/* 3. ปุ่มเปลี่ยนผู้เช่า (Basecamp) */}
                          {isBasecamp && canManageContracts && (
                            <button
                              type="button"
                              className="crm-btn-row-icon"
                              onClick={() => handleOpenTransferModal(c)}
                              title={`เปลี่ยนผู้เช่ายูนิต ${c.basecamp_unit}`}
                              aria-label={`เปลี่ยนผู้เช่ายูนิต ${c.basecamp_unit} (${c.name})`}
                            >
                              <ArrowRightLeft size={13} aria-hidden="true" />
                            </button>
                          )}

                          {/* 4. สถานะ / ลบ */}
                          {isAdmin && (
                            <button
                              type="button"
                              className="crm-btn-row-icon danger"
                              onClick={() => handleDeleteCustomer(c)}
                              title={`ลบข้อมูลลูกค้า ${c.name}`}
                              aria-label={`ลบข้อมูลลูกค้า ${c.name}`}
                            >
                              <X size={13} aria-hidden="true" />
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
          MODAL 1: CUSTOMER PROFILE (CREATE / EDIT) — CLEAN, FOCUSED & MINIMAL
          ========================================================================= */}
      {showAddEditModal && (
        <div className="crm-modal-backdrop" onClick={handleRequestCloseAddEditModal}>
          <div className="crm-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header">
              <div className="crm-modal-title">
                <div className="crm-modal-icon-badge">
                  {editingCustomer ? <Edit2 size={16} /> : <Plus size={16} />}
                </div>
                <div>
                  <h3>{editingCustomer ? `แก้ไขข้อมูล: ${editingCustomer.name}` : 'เพิ่มลูกค้า / ร้านค้าใหม่'}</h3>
                  <p className="crm-modal-subtitle">
                    {editingCustomer ? 'อัปเดตข้อมูลผู้เช่าและช่องทางการติดต่อ' : 'สร้างข้อมูลลูกค้าใหม่พร้อมสัญญาเริ่มต้น'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="crm-modal-close-btn"
                onClick={handleRequestCloseAddEditModal}
                disabled={isSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitCustomerForm} className="crm-modal-form">
              <div className="crm-modal-body">
                {/* SECTION 1: ข้อมูลผู้เช่า / บริษัท */}
                <div className="crm-form-section">
                  <div className="crm-form-section-title">
                    <Building2 size={15} />
                    <span>ข้อมูลผู้เช่า / บริษัท</span>
                  </div>

                  {!editingCustomer && (
                    <div className="crm-form-group">
                      <label className="crm-form-label">ประเภทลูกค้า <span className="req">*</span></label>
                      <div className="crm-type-selector-grid">
                        <button
                          type="button"
                          className={`crm-type-btn ${customerForm.customer_type === 'basecamp' ? 'active' : ''}`}
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
                            <span>ผู้เช่าออฟฟิศ/ฮอทเดสก์ ชั้น 4</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          className={`crm-type-btn ${customerForm.customer_type === 'shop' ? 'active' : ''}`}
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
                            <span>ร้านค้าพันธมิตรในอาคาร</span>
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
                          <option value="office">Office (โควตา 4 ชม./ด.)</option>
                          <option value="hotdesk">Hotdesk (โควตา 2 ชม./ด.)</option>
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

                {/* SECTION 2: ข้อมูลการติดต่อและที่อยู่ */}
                <div className="crm-form-section">
                  <div className="crm-form-section-title">
                    <Phone size={15} />
                    <span>ข้อมูลการติดต่อและเอกสาร</span>
                  </div>

                  <div className="crm-form-grid-2">
                    <div className="crm-form-group">
                      <label className="crm-form-label">ชื่อผู้ติดต่อประสานงาน</label>
                      <input
                        type="text"
                        className="crm-form-input"
                        placeholder="คุณสมชาย จัดการดี"
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
                      placeholder="ที่อยู่บริษัทสำหรับออกใบกำกับภาษี..."
                      value={customerForm.address}
                      onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                    />
                  </div>
                </div>

                {/* SECTION 3: เฉพาะสร้างลูกค้าใหม่ (ข้อมูลสัญญาเริ่มต้น) */}
                {!editingCustomer && (
                  <div className="crm-form-section initial-contract">
                    <div className="crm-form-section-title">
                      <Calendar size={15} />
                      <span>ข้อมูลสัญญาเริ่มต้น (ปฏิทินไทย พ.ศ.)</span>
                    </div>

                    <div className="crm-form-grid-2">
                      <div className="crm-form-group">
                        <label className="crm-form-label">วันเริ่มสัญญา <span className="req">*</span></label>
                        <ThaiDatePicker
                          value={customerForm.start_date}
                          onChange={(val) => setCustomerForm(prev => ({ ...prev, start_date: val }))}
                          required
                          align="left"
                        />
                      </div>

                      <div className="crm-form-group">
                        <label className="crm-form-label">วันสิ้นสุดสัญญา <span className="req">*</span></label>
                        <ThaiDatePicker
                          value={customerForm.end_date}
                          onChange={(val) => setCustomerForm(prev => ({ ...prev, end_date: val }))}
                          required
                          align="right"
                        />
                      </div>
                    </div>

                    <div className="crm-form-grid-2">
                      <div className="crm-form-group">
                        <label className="crm-form-label">โควตาห้องประชุม (ชม./ด.) <span className="req">*</span></label>
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
                )}
              </div>

              <div className="crm-modal-footer">
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
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: DEDICATED CONTRACT MANAGEMENT CONSOLE — CLEAN, SEPARATED & ELEGANT
          ========================================================================= */}
      {showContractModal && contractCustomer && (
        <div className="crm-modal-backdrop" onClick={handleRequestCloseContractModal}>
          <div className="crm-contract-modal-dialog" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="crm-contract-modal-header">
              <div className="crm-cmh-left">
                <div className="crm-cmh-icon">
                  <FileText size={18} />
                </div>
                <div>
                  <div className="crm-cmh-title-row">
                    <h3>จัดการสัญญาและโควตา</h3>
                    <span className={`crm-type-tag ${contractCustomer.customer_type}`}>
                      {contractCustomer.customer_type === 'basecamp'
                        ? `Basecamp ${contractCustomer.basecamp_unit || ''}`
                        : 'Partner Shop'}
                    </span>
                  </div>
                  <span className="crm-cmh-cust-name">{contractCustomer.name}</span>
                </div>
              </div>
              <button
                type="button"
                className="crm-modal-close-btn"
                onClick={handleRequestCloseContractModal}
                disabled={isSubmitting}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="crm-contract-modal-body">
              {loadingContract && !contractCustomer.contracts ? (
                <div className="crm-contract-loading-box">
                  <RefreshCw size={24} className="crm-spin text-primary" />
                  <span>กำลังโหลดรายละเอียดสัญญาและโควตา...</span>
                </div>
              ) : (
                <>
                  {/* VIEW 1: OVERVIEW (Default View) */}
                  {contractView === 'overview' && (
                    <div className="crm-contract-overview-flow">
                      {contractCustomer.contracts && contractCustomer.contracts.length > 0 ? (
                        <>
                          {/* Active Contract Hero Card */}
                          <div className="crm-clean-hero-card">
                            <div className="crm-chc-header">
                              <div className="crm-chc-id-box">
                                <span className="lbl">สัญญาปัจจุบัน</span>
                                <span className="val">{contractCustomer.contracts[0].contract_number}</span>
                              </div>
                              {(() => {
                                const heroStatus = formatThaiContractStatus(contractCustomer.contracts[0]);
                                return (
                                  <span className={`crm-status-pill large ${heroStatus.urgency}`}>
                                    <span className="dot" aria-hidden="true" />
                                    {heroStatus.label}
                                  </span>
                                );
                              })()}
                            </div>

                            {/* Dates Strip */}
                            <div className="crm-clean-dates-row">
                              <div className="crm-date-col">
                                <span className="lbl">วันเริ่มสัญญา (พ.ศ.)</span>
                                <span className="val">{formatThaiDate(contractCustomer.contracts[0].start_date)}</span>
                              </div>
                              <ChevronRight size={16} className="crm-dates-arrow" />
                              <div className="crm-date-col">
                                <span className="lbl">วันสิ้นสุดสัญญา (พ.ศ.)</span>
                                <span className="val highlight">{formatThaiDate(contractCustomer.contracts[0].end_date)}</span>
                              </div>
                            </div>

                            {/* Quota Strip */}
                            <div className="crm-clean-quota-strip">
                              <div className="crm-cqs-item">
                                <Clock size={15} />
                                <span>สิทธิ์ห้องประชุม: <strong>{contractCustomer.contracts[0].monthly_quota_hours} ชม./ด.</strong></span>
                              </div>
                              <div className="crm-cqs-item">
                                <CheckCircle2 size={15} color="#059669" />
                                <span>
                                  โควตาคงเหลือในรอบนี้: <strong style={{ color: '#059669' }}>
                                    {contractCustomer.quota?.remaining_hours ?? contractCustomer.quota_summary?.remaining_quota ?? contractCustomer.contracts[0].monthly_quota_hours} ชม.
                                  </strong>
                                </span>
                              </div>
                            </div>

                            {contractCustomer.contracts[0].notes && (
                              <div className="crm-clean-notes-box">
                                <Info size={14} />
                                <span>หมายเหตุ: {contractCustomer.contracts[0].notes}</span>
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="crm-clean-hero-actions">
                              {canManageContracts && contractCustomer.contracts[0].status !== 'TERMINATED' && (
                                <button
                                  type="button"
                                  className="crm-btn-primary"
                                  onClick={() => handleStartEditDates(contractCustomer.contracts[0])}
                                >
                                  <Edit2 size={13} />
                                  <span>แก้ไขวันที่สัญญา</span>
                                </button>
                              )}

                              <button
                                type="button"
                                className="crm-btn-secondary"
                                onClick={() => setContractView('renew')}
                              >
                                <Plus size={14} />
                                <span>ต่อสัญญาใหม่</span>
                              </button>
                            </div>
                          </div>

                          {/* Inline Danger Action: Terminate Contract */}
                          {contractCustomer.contracts[0]?.status === 'ACTIVE' && (
                            <div className="crm-terminate-section">
                              {!showTerminateInline ? (
                                <button
                                  type="button"
                                  className="crm-btn-text-danger"
                                  onClick={() => setShowTerminateInline(true)}
                                >
                                  <AlertTriangle size={13} />
                                  <span>ขอยกเลิกสัญญาฉบับนี้ก่อนกำหนด</span>
                                </button>
                              ) : (
                                <form onSubmit={handleSubmitTerminate} className="crm-terminate-box">
                                  <div className="crm-terminate-header">
                                    <AlertTriangle size={15} color="#dc2626" />
                                    <span>ยืนยันการขอยกเลิกสัญญา ({contractCustomer.contracts[0].contract_number})</span>
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
                                      placeholder="ระบุเหตุผล เช่น ย้ายสถานที่ประกอบการ, สิ้นสุดการเช่า..."
                                      value={terminateForm.reason}
                                      onChange={(e) => setTerminateForm(prev => ({ ...prev, reason: e.target.value }))}
                                      required
                                    />
                                  </div>

                                  <div className="crm-terminate-actions">
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

                          {/* Accordion 1: Contract History (Collapsed by Default) */}
                          <div className="crm-accordion-wrapper">
                            <button
                              type="button"
                              className="crm-accordion-header"
                              onClick={() => setShowHistoryAccordion(!showHistoryAccordion)}
                            >
                              <div className="crm-ach-left">
                                <History size={15} />
                                <span>ประวัติสัญญาทั้งหมด ({contractCustomer.contracts.length} ฉบับ)</span>
                              </div>
                              <ChevronDown size={16} className={`crm-accordion-arrow ${showHistoryAccordion ? 'open' : ''}`} />
                            </button>

                            {showHistoryAccordion && (
                              <div className="crm-accordion-body">
                                <div className="crm-contracts-history-list">
                                  {contractCustomer.contracts.map((ctr) => (
                                    <div key={ctr.id} className="crm-history-row">
                                      <div className="crm-hr-top">
                                        <span className="ctr-num">
                                          <FileText size={13} />
                                          {ctr.contract_number}
                                        </span>
                                        {(() => {
                                          const rowStatus = formatThaiContractStatus(ctr);
                                          return (
                                            <span className={`crm-status-pill ${rowStatus.urgency}`}>
                                              <span className="dot" aria-hidden="true" />
                                              {rowStatus.label}
                                            </span>
                                          );
                                        })()}
                                      </div>
                                      <div className="crm-hr-dates">
                                        <span>ช่วงสัญญา: <strong>{formatThaiDate(ctr.start_date)} – {formatThaiDate(ctr.end_date)}</strong></span>
                                        <span>โควตา: <strong>{ctr.monthly_quota_hours} ชม./ด.</strong></span>
                                      </div>
                                      {ctr.notes && <div className="crm-hr-notes">หมายเหตุ: {ctr.notes}</div>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Accordion 2: Contract Audit History (Admin Only, Collapsed by Default) */}
                          {isAdmin && (
                            <div className="crm-accordion-wrapper">
                              <button
                                type="button"
                                className="crm-accordion-header"
                                onClick={() => setShowAuditAccordion(!showAuditAccordion)}
                              >
                                <div className="crm-ach-left">
                                  <ShieldCheck size={15} color="#059669" />
                                  <span>ประวัติการตรวจสอบและการแก้ไขสัญญา (Audit Log)</span>
                                </div>
                                <ChevronDown size={16} className={`crm-accordion-arrow ${showAuditAccordion ? 'open' : ''}`} />
                              </button>

                              {showAuditAccordion && (
                                <div className="crm-accordion-body">
                                  {loadingAudit ? (
                                    <div className="crm-table-placeholder" style={{ padding: '16px' }}>
                                      <RefreshCw size={16} className="crm-spin" />
                                      <span>กำลังโหลด Audit Logs...</span>
                                    </div>
                                  ) : auditLogs.length === 0 ? (
                                    <div className="crm-table-placeholder" style={{ padding: '16px' }}>
                                      <span>ยังไม่มีประวัติการแก้ไขสัญญาของลูกค้ารายนี้</span>
                                    </div>
                                  ) : (
                                    <div className="crm-audit-logs-list">
                                      {auditLogs.map((log) => {
                                        let parsed = null;
                                        try {
                                          parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
                                        } catch (_) {
                                          parsed = { raw: log.details };
                                        }

                                        return (
                                          <div key={log.id} className="crm-audit-item">
                                            <div className="crm-audit-item-header">
                                              <span className="action">{log.action}</span>
                                              <span className="actor">โดย: <strong>{log.performed_by}</strong></span>
                                              <span className="time">{formatThaiDateTime(log.created_at)}</span>
                                            </div>
                                            {parsed?.change_reason && (
                                              <div className="reason">เหตุผล: "{parsed.change_reason}"</div>
                                            )}
                                            {parsed?.old_start_date && (
                                              <div className="diff">
                                                เดิม: {parsed.old_start_date} ถึง {parsed.old_end_date} ➔
                                                ใหม่: {parsed.new_start_date} ถึง {parsed.new_end_date}
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
                          )}
                        </>
                      ) : (
                        /* Empty State: ลูกค้าไม่มีสัญญา */
                        <div className="crm-clean-empty-state">
                          <Info size={36} className="empty-icon" />
                          <h4>ยังไม่มีสัญญาสำหรับลูกค้ารายนี้</h4>
                          <p>สามารถสร้างสัญญาเช่าฉบับแรกเพื่อให้ลูกค้าได้รับสิทธิ์ใช้งานโควตาห้องประชุมได้ทันที</p>
                          <button
                            type="button"
                            className="crm-btn-primary"
                            onClick={() => setContractView('renew')}
                          >
                            <Plus size={15} />
                            <span>สร้างสัญญาใหม่ (Create Contract)</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* VIEW 2: EDIT CONTRACT DATES */}
                  {contractView === 'edit_dates' && contractToEdit && (
                    <div className="crm-contract-subview">
                      <div className="crm-subview-nav">
                        <button
                          type="button"
                          className="crm-subview-back-btn"
                          onClick={() => {
                            setContractView('overview');
                            setEditDateStep('input');
                          }}
                        >
                          <ChevronLeft size={16} />
                          <span>กลับสู่สัญญาปัจจุบัน</span>
                        </button>
                        <span className="crm-subview-title">แก้ไขระยะเวลาสัญญา: {contractToEdit.contract_number}</span>
                      </div>

                      {editDateStep === 'input' ? (
                        <form onSubmit={handleProceedToConfirmEdit} className="crm-subview-form">
                          <div className="crm-subview-callout">
                            <Info size={16} />
                            <span>กำหนดวันเริ่มต้นและวันสิ้นสุดสัญญาใหม่ในปฏิทินไทย พ.ศ. พร้อมระบุเหตุผลในการแก้ไข</span>
                          </div>

                          <div className="crm-form-group">
                            <label className="crm-form-label">วันเริ่มสัญญาใหม่ (พ.ศ.) <span className="req">*</span></label>
                            <ThaiDatePicker
                              value={editDateForm.start_date}
                              onChange={(val) => setEditDateForm(prev => ({ ...prev, start_date: val }))}
                              required
                              align="left"
                            />
                            <span className="crm-form-hint">{getThaiDateInputHint(editDateForm.start_date)}</span>
                          </div>

                          <div className="crm-form-group">
                            <label className="crm-form-label">วันสิ้นสุดสัญญาใหม่ (พ.ศ.) <span className="req">*</span></label>
                            <ThaiDatePicker
                              value={editDateForm.end_date}
                              onChange={(val) => setEditDateForm(prev => ({ ...prev, end_date: val }))}
                              required
                              align="right"
                            />
                            <span className="crm-form-hint">{getThaiDateInputHint(editDateForm.end_date)}</span>
                          </div>

                          <div className="crm-form-group">
                            <label className="crm-form-label">เหตุผลในการแก้ไขวันที่สัญญา <span className="req">*</span></label>
                            <textarea
                              rows={3}
                              className="crm-form-textarea"
                              placeholder="ระบุเหตุผล เช่น ขยายระยะเวลาตามข้อตกลงพิเศษ, แก้ไขวันเริ่มสัญญาตามเอกสารแนบท้าย..."
                              value={editDateForm.reason}
                              onChange={(e) => setEditDateForm(prev => ({ ...prev, reason: e.target.value }))}
                              required
                            />
                          </div>

                          <div className="crm-subview-actions">
                            <button
                              type="button"
                              className="crm-btn-secondary"
                              onClick={() => setContractView('overview')}
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
                      ) : (
                        /* STEP 2: CONFIRMATION */
                        <div className="crm-subview-confirm">
                          <div className="crm-confirm-callout warning">
                            <AlertTriangle size={18} color="#d97706" />
                            <div>
                              <strong>กรุณาตรวจสอบการเปลี่ยนแปลงก่อนยืนยัน</strong>
                              <p>การแก้ไขนี้จะมีผลกับโควตาการใช้งานและจะถูกบันทึกลงใน Audit Log ถาวร</p>
                            </div>
                          </div>

                          <div className="crm-confirm-diff-card">
                            <div className="crm-diff-row">
                              <span className="lbl">ช่วงสัญญาเดิม:</span>
                              <span className="val old">{formatThaiDate(contractToEdit.start_date)} ถึง {formatThaiDate(contractToEdit.end_date)}</span>
                            </div>
                            <div className="crm-diff-row highlight">
                              <span className="lbl">ช่วงสัญญาใหม่:</span>
                              <span className="val new">{formatThaiDate(editDateForm.start_date)} ถึง {formatThaiDate(editDateForm.end_date)}</span>
                            </div>
                            <div className="crm-diff-row">
                              <span className="lbl">เหตุผลในการแก้ไข:</span>
                              <span className="val reason">"{editDateForm.reason}"</span>
                            </div>
                          </div>

                          <div className="crm-subview-actions">
                            <button
                              type="button"
                              className="crm-btn-secondary"
                              onClick={() => setEditDateStep('input')}
                              disabled={isSubmitting}
                            >
                              กลับไปแก้ไข
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
                      )}
                    </div>
                  )}

                  {/* VIEW 3: RENEW CONTRACT */}
                  {contractView === 'renew' && (
                    <div className="crm-contract-subview">
                      <div className="crm-subview-nav">
                        <button
                          type="button"
                          className="crm-subview-back-btn"
                          onClick={() => setContractView('overview')}
                        >
                          <ChevronLeft size={16} />
                          <span>กลับสู่สัญญาปัจจุบัน</span>
                        </button>
                        <span className="crm-subview-title">ต่อสัญญาใหม่ / เปิดสัญญาใหม่</span>
                      </div>

                      <form onSubmit={handleSubmitRenew} className="crm-subview-form">
                        <div className="crm-form-group">
                          <label className="crm-form-label">หมายเลขสัญญาใหม่ (เว้นว่างไว้เพื่อสร้างอัตโนมัติ)</label>
                          <input
                            type="text"
                            className="crm-form-input"
                            placeholder="ระบบจะสร้างให้อัตโนมัติ"
                            value={renewForm.contract_number}
                            onChange={(e) => setRenewForm(prev => ({ ...prev, contract_number: e.target.value }))}
                          />
                        </div>

                        <div className="crm-form-grid-2">
                          <div className="crm-form-group">
                            <label className="crm-form-label">วันเริ่มสัญญาใหม่ (พ.ศ.) <span className="req">*</span></label>
                            <ThaiDatePicker
                              value={renewForm.start_date}
                              onChange={(val) => setRenewForm(prev => ({ ...prev, start_date: val }))}
                              required
                              align="left"
                            />
                            <span className="crm-form-hint">{getThaiDateInputHint(renewForm.start_date)}</span>
                          </div>

                          <div className="crm-form-group">
                            <label className="crm-form-label">วันสิ้นสุดสัญญาใหม่ (พ.ศ.) <span className="req">*</span></label>
                            <ThaiDatePicker
                              value={renewForm.end_date}
                              onChange={(val) => setRenewForm(prev => ({ ...prev, end_date: val }))}
                              required
                              align="right"
                            />
                            <span className="crm-form-hint">{getThaiDateInputHint(renewForm.end_date)}</span>
                          </div>
                        </div>

                        <div className="crm-form-group">
                          <label className="crm-form-label">โควตาห้องประชุม (ชม./เดือน) <span className="req">*</span></label>
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

                        <div className="crm-subview-actions">
                          <button
                            type="button"
                            className="crm-btn-secondary"
                            onClick={() => setContractView('overview')}
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
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: BASECAMP TENANT TRANSFER MODAL (PRESERVED & INTACT)
          ========================================================================= */}
      {showTransferModal && transferUnitCustomer && (
        <div className="crm-modal-backdrop" onClick={() => setShowTransferModal(false)}>
          <div className="crm-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header">
              <div className="crm-modal-title">
                <div className="crm-modal-icon-badge">
                  <ArrowRightLeft size={16} />
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
                <div className="crm-form-section">
                  <div className="crm-form-section-title">
                    <Building2 size={15} />
                    <span>ข้อมูลผู้เช่ารายใหม่</span>
                  </div>

                  <div className="crm-form-group">
                    <label className="crm-form-label">ชื่อบริษัท / ผู้เช่าใหม่ <span className="req">*</span></label>
                    <input
                      type="text"
                      className="crm-form-input"
                      placeholder="เช่น บจก. พัฒนาการดี"
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
                        value={transferForm.contact_name}
                        onChange={(e) => setTransferForm({ ...transferForm, contact_name: e.target.value })}
                      />
                    </div>
                    <div className="crm-form-group">
                      <label className="crm-form-label">เบอร์โทรศัพท์</label>
                      <input
                        type="tel"
                        className="crm-form-input"
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
                      <label className="crm-form-label">Tax ID</label>
                      <input
                        type="text"
                        className="crm-form-input"
                        value={transferForm.tax_id}
                        onChange={(e) => setTransferForm({ ...transferForm, tax_id: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="crm-form-section initial-contract">
                  <div className="crm-form-section-title">
                    <Calendar size={15} />
                    <span>สัญญาผู้เช่าใหม่</span>
                  </div>

                  <div className="crm-form-grid-2">
                    <div className="crm-form-group">
                      <label className="crm-form-label">วันเริ่มสัญญา <span className="req">*</span></label>
                      <ThaiDatePicker
                        value={transferForm.start_date}
                        onChange={(val) => setTransferForm(prev => ({ ...prev, start_date: val }))}
                        required
                        align="left"
                      />
                    </div>
                    <div className="crm-form-group">
                      <label className="crm-form-label">วันสิ้นสุดสัญญา <span className="req">*</span></label>
                      <ThaiDatePicker
                        value={transferForm.end_date}
                        onChange={(val) => setTransferForm(prev => ({ ...prev, end_date: val }))}
                        required
                        align="right"
                      />
                    </div>
                  </div>

                  <div className="crm-form-group">
                    <label className="crm-form-label">โควตาห้องประชุม (ชม./ด.)</label>
                    <input
                      type="number"
                      step="0.5"
                      className="crm-form-input"
                      value={transferForm.monthly_quota_hours}
                      onChange={(e) => setTransferForm({ ...transferForm, monthly_quota_hours: parseFloat(e.target.value) || 0 })}
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
                  {isSubmitting ? 'กำลังดำเนินการ...' : 'ยืนยันเปลี่ยนผู้เช่ายูนิต'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
