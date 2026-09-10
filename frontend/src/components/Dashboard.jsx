import React, { useState, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, DollarSign, FileText, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import CustomDatePicker from './CustomDatePicker';
import { toLocalDateString } from '../dateUtils';

function Dashboard() {
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });
  const [kpis, setKpis] = useState({
    revenue: 0,
    bookingsCount: 0,
    paidCount: 0,
    pendingCount: 0,
    trend: [],
    popularRooms: [],
    popularServices: []
  });
  const [loading, setLoading] = useState(false);

  // Initialize date range to current month
  useEffect(() => {
    setQuickRange('month');
  }, []);

  // Fetch dashboard summary when dateRange changes
  useEffect(() => {
    if (dateRange.startDate && dateRange.endDate) {
      fetchSummary();
    }
  }, [dateRange]);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/summary?start_date=${dateRange.startDate}&end_date=${dateRange.endDate}`);
      if (res.ok) {
        const data = await res.json();
        setKpis(data);
      }
    } catch (err) {
      console.error('Failed to load dashboard summary:', err);
    } finally {
      setLoading(false);
    }
  };

  const setQuickRange = (type) => {
    const now = new Date();
    let start = '';
    let end = '';

    if (type === 'today') {
      const todayStr = toLocalDateString(now);
      start = todayStr;
      end = todayStr;
    } else if (type === 'month') {
      // First day of current month
      const y = now.getFullYear();
      const m = now.getMonth();
      start = toLocalDateString(new Date(y, m, 1));
      end = toLocalDateString(new Date(y, m + 1, 0));
    } else if (type === 'year') {
      const y = now.getFullYear();
      start = `${y}-01-01`;
      end = `${y}-12-31`;
    }

    setDateRange({ startDate: start, endDate: end });
  };

  const formatCurrency = (val) => {
    return val.toLocaleString('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header and Date Filter */}
      <div className="tab-header">
        <div>
          <h1 className="tab-title">แดชบอร์ดสรุปผลการใช้งาน</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>วิเคราะห์รายได้ ยอดจองห้องประชุม และบริการเสริม</p>
        </div>

        {/* Date Filters Control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={() => setQuickRange('today')}>รายวัน (วันนี้)</button>
            <button className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={() => setQuickRange('month')}>รายเดือน (เดือนนี้)</button>
            <button className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem' }} onClick={() => setQuickRange('year')}>รายปี (ปีนี้)</button>
          </div>

          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            border: '1px solid var(--border-color)', 
            padding: '6px 14px', 
            borderRadius: '99px', 
            backgroundColor: 'var(--bg-card)' 
          }}>
            <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
            <CustomDatePicker 
              value={dateRange.startDate}
              onChange={val => setDateRange({ ...dateRange, startDate: val })}
              placeholder="วันเริ่มต้น"
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px' }}>ถึง</span>
            <CustomDatePicker 
              value={dateRange.endDate}
              onChange={val => setDateRange({ ...dateRange, endDate: val })}
              placeholder="วันสิ้นสุด"
            />
          </div>

          <button 
            type="button" 
            className="btn btn-secondary" 
            style={{ padding: '8px 16px', fontSize: '0.85rem', borderRadius: '99px' }}
            onClick={() => setQuickRange('month')}
          >
            ล้างตัวกรอง
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}>
          <span style={{ fontSize: '1.2rem', fontWeight: 500, color: 'var(--text-muted)' }}>กำลังคำนวณข้อมูลสถิติ...</span>
        </div>
      ) : (
        <>
          {/* KPI Cards Grid */}
          <div className="grid-cols-4">
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ backgroundColor: 'rgba(2, 132, 199, 0.15)', color: 'var(--accent-color)', padding: '12px', borderRadius: '50%' }}>
                <DollarSign size={24} />
              </div>
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>รายได้สุทธิรวม</p>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 700 }}>{formatCurrency(kpis.revenue)}</h3>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ backgroundColor: 'rgba(56, 189, 248, 0.15)', color: 'var(--primary-color)', padding: '12px', borderRadius: '50%' }}>
                <FileText size={24} />
              </div>
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>ยอดการจองบริการ</p>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 700 }}>{kpis.bookingsCount} รายการ</h3>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-color)', padding: '12px', borderRadius: '50%' }}>
                <CheckCircle size={24} />
              </div>
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>ชำระเงินเรียบร้อย</p>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 700 }} className="text-success">{kpis.paidCount} รายการ</h3>
              </div>
            </div>

            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning-color)', padding: '12px', borderRadius: '50%' }}>
                <Clock size={24} />
              </div>
              <div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>ค้างชำระเงิน (Pending)</p>
                <h3 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--warning-color)' }}>{kpis.pendingCount} รายการ</h3>
              </div>
            </div>
          </div>

          {/* Revenue Trend Area Chart */}
          <div className="card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <TrendingUp size={20} style={{ color: 'var(--accent-color)' }} />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>กราฟแนวโน้มรายได้การใช้บริการ (แยกรายวัน)</h2>
            </div>
            
            <div style={{ width: '100%', height: '300px' }}>
              {kpis.trend.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  ไม่มีข้อมูลแนวโน้มรายได้ในช่วงวันที่ระบุ
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={kpis.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={d => {
                        const parts = d.split('-');
                        return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
                      }}
                      stroke="var(--text-muted)"
                      style={{ fontSize: '0.75rem' }}
                    />
                    <YAxis stroke="var(--text-muted)" style={{ fontSize: '0.75rem' }} />
                    <Tooltip 
                      formatter={(value) => [formatCurrency(value), 'รายได้']}
                      labelFormatter={(label) => `วันที่: ${label}`}
                      contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-main)' }}
                    />
                    <Area type="monotone" dataKey="revenue" stroke="var(--accent-color)" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Breakdown Analysis Grid */}
          <div className="grid-cols-2">
            {/* Rooms Popularity Chart */}
            <div className="card">
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '20px' }}>รายได้แยกตามห้องประชุม</h2>
              
              <div style={{ width: '100%', height: '240px' }}>
                {kpis.popularRooms.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                    ไม่มีข้อมูลห้องประชุมถูกจองในช่วงวันที่ระบุ
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={kpis.popularRooms} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                      <XAxis type="number" stroke="var(--text-muted)" style={{ fontSize: '0.7rem' }} />
                      <YAxis dataKey="name" type="category" stroke="var(--text-main)" style={{ fontSize: '0.7rem' }} width={120} />
                      <Tooltip formatter={(value) => [formatCurrency(value), 'รายได้ห้อง']} />
                      <Bar dataKey="total_revenue" fill="var(--accent-color)" radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Popular Services Table/List */}
            <div className="card">
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '16px' }}>สถิติการขายบริการเสริม</h2>
              
              {kpis.popularServices.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '160px', color: 'var(--text-muted)' }}>
                  ไม่มีข้อมูลการขายบริการเสริมในช่วงวันที่ระบุ
                </div>
              ) : (
                <div className="table-container">
                  <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>ชื่อบริการเสริม</th>
                        <th style={{ textAlign: 'center' }}>จำนวนที่สั่ง</th>
                        <th style={{ textAlign: 'right' }}>รายได้รวม (บาท)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.popularServices.map((service, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: '500' }}>{service.name}</td>
                          <td style={{ textAlign: 'center' }}>x{service.total_quantity}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--primary-color)' }}>
                            {service.total_revenue.toLocaleString()}.-
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
