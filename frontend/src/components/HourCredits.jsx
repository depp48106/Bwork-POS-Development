import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Clock,
  Search,
  Plus,
  Eye,
  Printer,
  Download,
  Send,
  RotateCcw,
  X,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Info
} from 'lucide-react';
import {
  creditMenuLabel,
  creditSubtitle,
  creditFilterChips,
  filterCreditRows,
  durationLabel,
  statusLabel,
  formatCreditDateTime,
  formatCreditTime,
  formatCreditTimeRange,
  eligibleHourCreditRooms,
  minutesValue,
  bookingTimes,
  canReverse,
  redeemMessage,
  reversalMessage,
  voucherNotice,
  voucherImageFilename,
  exportVoucherAsPng,
  creditRequest,
  createCreditSubmitter,
  sendCreditLine
} from '../utils/hourCreditUI';
import './HourCredits.css';

export function CreditVoucherContent({
  credit,
  qr,
  generated,
  initialAction,
  onClose,
  onSendLine,
  lineSending,
  onExportImage,
  onRefreshCredit
}) {
  const voucherRef = useRef(null);
  const [imageExporting, setImageExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState('');
  const [exportError, setExportError] = useState('');

  const handleExport = async () => {
    if (imageExporting || !qr || !voucherRef.current) return;
    setImageExporting(true);
    setExportFeedback('');
    setExportError('');
    try {
      if (onRefreshCredit) {
        try {
          await onRefreshCredit();
          await new Promise(r => setTimeout(r, 50));
        } catch {
          // Fallback to current balance snapshot if refresh fails
        }
      }
      const filename = voucherImageFilename(credit?.credit_id);
      if (onExportImage) {
        await onExportImage(voucherRef.current, filename);
      } else {
        await exportVoucherAsPng(voucherRef.current, filename);
      }
      setExportFeedback('บันทึกรูปภาพสำเร็จ');
      setTimeout(() => setExportFeedback(''), 4000);
    } catch (err) {
      setExportError(err.message || 'ไม่สามารถบันทึกรูปภาพได้');
      setTimeout(() => setExportError(''), 5000);
    } finally {
      setImageExporting(false);
    }
  };

  useEffect(() => {
    if (!qr) return;
    if (initialAction === 'print') {
      const t = setTimeout(() => window.print(), 350);
      return () => clearTimeout(t);
    }
    if (initialAction === 'image') {
      const t = setTimeout(() => handleExport(), 250);
      return () => clearTimeout(t);
    }
  }, [qr, initialAction]);

  return (
    <section className="credit-voucher-overlay">
      <article className="credit-voucher" ref={voucherRef}>
        <div className="credit-no-print credit-voucher-actions">
          <button type="button" className="credit-voucher-btn close" onClick={onClose}>
            ปิด
          </button>
          <button disabled={!qr} type="button" className="credit-voucher-btn print" onClick={() => window.print()}>
            พิมพ์ / บันทึก PDF
          </button>
          <button disabled={imageExporting || !qr} type="button" className="credit-voucher-btn image" onClick={handleExport}>
            {imageExporting ? 'กำลังสร้างรูป...' : 'บันทึกเป็นรูปภาพ'}
          </button>
          {onSendLine && (
            <button
              disabled={lineSending || !credit?.has_line}
              type="button"
              className="credit-voucher-btn line"
              onClick={onSendLine}
            >
              {lineSending ? 'กำลังส่ง LINE...' : credit?.has_line ? 'ส่ง LINE' : 'ส่ง LINE (ไม่ได้เชื่อมต่อ)'}
            </button>
          )}
          {exportFeedback && <span role="status" className="credit-export-feedback">{exportFeedback}</span>}
          {exportError && <span role="alert" className="credit-export-error">{exportError}</span>}
        </div>

        <div className="credit-voucher-brand">B-WORK</div>
        <h1 className="credit-voucher-title">ใบยืนยันชั่วโมงคงเหลือ</h1>
        <h2 className="credit-voucher-sub">ไม่ใช่ใบเสร็จรับเงิน</h2>

        <div className="credit-voucher-info-box">
          <p><strong>Credit ID:</strong> {credit.credit_id}</p>
          <p><strong>ลูกค้า:</strong> {credit.customer_name}</p>
          <p><strong>ห้องต้นทาง:</strong> {credit.room_name}</p>
        </div>

        <div className="credit-voucher-balance-box">
          <h2>คงเหลือ {durationLabel(credit.remaining_minutes)}</h2>
        </div>

        <div className="credit-voucher-meta-box">
          <p>วันที่ออกเครดิต: {formatCreditDateTime(credit.created_at)}</p>
          <p>เวลาสร้างเอกสาร: {formatCreditDateTime(generated)} (เวลาไทย)</p>
          <p>การจองต้นทาง: {credit.source_reference || credit.source_booking_id}</p>
        </div>

        {qr && (
          <div className="credit-voucher-qr-wrap">
            <img width="220" height="220" src={qr} alt="QR อ้างอิง Credit ID" />
          </div>
        )}

        <div className="credit-voucher-footer">
          <p>{voucherNotice}</p>
          <p className="credit-voucher-qr-notice">QR เป็นเลขอ้างอิงเท่านั้น ไม่ใช่สิทธิ์ยืนยันการใช้เครดิต</p>
        </div>
      </article>
    </section>
  );
}

export function CreditVoucher(props) {
  return createPortal(<CreditVoucherContent {...props} />, document.body);
}

function DurationInputs({ hours, minutes, setHours, setMinutes }) {
  return (
    <div className="credit-fields-row">
      <label className="credit-field-label">
        <span>ชั่วโมง</span>
        <input
          type="number"
          min="0"
          step="1"
          className="credit-number-input"
          value={hours}
          onChange={e => setHours(e.target.value)}
          required
        />
      </label>
      <label className="credit-field-label">
        <span>นาที</span>
        <input
          type="number"
          min="0"
          max="59"
          step="1"
          className="credit-number-input"
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
          required
        />
      </label>
    </div>
  );
}

export default function HourCredits({ sysConfirm }) {
  const [search, setSearch] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lineSending, setLineSending] = useState(false);

  // Form modal modes: 'grant' | 'redeem' | 'reverse'
  const [mode, setMode] = useState(null);
  const [sourceRef, setSourceRef] = useState('');
  const [source, setSource] = useState(null);
  const [itemId, setItemId] = useState('');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [eligibleRooms, setEligibleRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [blockedRanges, setBlockedRanges] = useState(null);
  const [reversal, setReversal] = useState(null);
  const [voucher, setVoucher] = useState(null);
  const [locked, setLocked] = useState(false);

  const submit = useRef(createCreditSubmitter());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!locked) return;
    const warn = e => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [locked]);

  const load = async () => {
    const query = search.trim();
    const data = await creditRequest('?search=' + encodeURIComponent(query));
    setRows(data);
    setHasSearched(true);
    return data;
  };

  const perform = async fn => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };

  useEffect(() => {
    let current = true;
    creditRequest()
      .then(data => {
        if (current) {
          setRows(data);
          if (data.length > 0) {
            creditRequest('/' + encodeURIComponent(data[0].credit_id))
              .then(fresh => { if (current) setDetail(fresh); })
              .catch(() => {});
          }
        }
      })
      .catch(e => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, []);

  const open = credit =>
    perform(async () => {
      const fresh = await creditRequest('/' + encodeURIComponent(credit.credit_id));
      setDetail(fresh);
      setMode(null);
    });

  const form = value => {
    setMode(value);
    setHours('0');
    setMinutes('0');
    setReason('');
    setError('');
    setNotice('');
  };

  const openRedeem = () => perform(async () => {
    const rooms = await creditRequest('/' + encodeURIComponent(detail.credit_id) + '/eligible-rooms');
    const eligible = eligibleHourCreditRooms(rooms, detail.source_hourly_rate);
    setEligibleRooms(eligible);
    setSelectedRoomId(String(eligible.find(room => Number(room.id) === Number(detail.room_id))?.id || eligible[0]?.id || ''));
    setBlockedRanges(null);
    form('redeem');
  });

  useEffect(() => {
    if (mode !== 'redeem' || !detail || !selectedRoomId || !date) {
      setBlockedRanges(null);
      return;
    }
    let current = true;
    setBlockedRanges(null);
    creditRequest('/' + encodeURIComponent(detail.credit_id) + '/blocked-ranges?room_id=' + encodeURIComponent(selectedRoomId) + '&date=' + encodeURIComponent(date))
      .then(data => { if (current) setBlockedRanges(data); })
      .catch(error => { if (current) { setBlockedRanges(null); setError(error.message); } });
    return () => { current = false; };
  }, [mode, detail?.credit_id, selectedRoomId, date]);

  const currentItem = source?.items?.find(i => i.id === Number(itemId));

  const commit = async (path, payload) => {
    setLocked(true);
    let result;
    try {
      result = await submit.current(path, payload);
    } catch (error) {
      if ([400, 401, 403, 404, 409].includes(error.status)) setLocked(false);
      throw error;
    }
    setLocked(false);
    setMode(null);
    setNotice(
      result.booking_id
        ? `สำเร็จ: Booking B #${result.booking_id}`
        : `สำเร็จ: Credit ID ${result.credit_id}`
    );
    const fresh = await creditRequest('/' + encodeURIComponent(result.credit_id));
    setDetail(fresh);
    await load();
  };

  const confirm = message =>
    sysConfirm ? sysConfirm(message) : Promise.resolve(window.confirm(message));

  const grant = e => {
    e.preventDefault();
    perform(async () => {
      if (!source || !currentItem) throw Error('กรุณาตรวจสอบการจองต้นทางและเลือกห้อง');
      const count = minutesValue(hours, minutes);
      if (
        !locked &&
        !(await confirm(
          `ออกเครดิต ${durationLabel(count)}\nการออกเครดิตไม่แก้ไขยอดเงินหรือเวลาการจองเดิม`
        ))
      )
        return;
      await commit('', {
        source_booking_id: source.id,
        source_item_id: currentItem.id,
        minutes: count,
        reason
      });
    });
  };

  const redeem = e => {
    e.preventDefault();
    perform(async () => {
      const count = minutesValue(hours, minutes);
      if (count > detail.remaining_minutes) throw Error('เครดิตไม่เพียงพอ');
      if (!selectedRoomId) throw Error('กรุณาเลือกห้องที่มีอัตราค่าบริการตรงกับเครดิต');
      const times = bookingTimes(date, time, count);
      if (!locked && !(await confirm(redeemMessage(count, detail.remaining_minutes)))) return;
      await commit('/' + detail.credit_id + '/redeem', {
        room_id: Number(selectedRoomId),
        minutes: count,
        ...times,
        reason
      });
    });
  };

  const reverse = e => {
    e.preventDefault();
    perform(async () => {
      if (!locked && !(await confirm(reversalMessage))) return;
      await commit('/' + detail.credit_id + '/reversals', {
        entry_id: reversal.id,
        reason
      });
    });
  };

  const sendLine = async id => {
    if (busy || locked || lineSending) return;
    if (!await confirm('ต้องการส่งใบยืนยันชั่วโมงคงเหลือเข้า LINE OA ของลูกค้าใช่หรือไม่?')) return;
    setLineSending(true);
    setError('');
    setNotice('');
    try {
      const res = await sendCreditLine(id);
      setNotice(res.message || 'ส่งใบยืนยันชั่วโมงคงเหลือเข้า LINE OA ลูกค้าสำเร็จ');
    } catch (err) {
      setError(err.message || 'ไม่สามารถส่ง LINE ได้');
    } finally {
      setLineSending(false);
    }
  };

  const openVoucherModal = (initialAction = null) => {
    if (!detail) return;
    perform(async () => {
      const fresh = await creditRequest('/' + encodeURIComponent(detail.credit_id));
      const qr = await creditRequest('/' + encodeURIComponent(detail.credit_id) + '/voucher-qr');
      setDetail(fresh);
      setVoucher({
        credit: fresh,
        qr: qr.data_url,
        generated: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16),
        initialAction
      });
    });
  };

  const filteredRows = useMemo(() => {
    return filterCreditRows(rows, activeFilter);
  }, [rows, activeFilter]);

  const activeOnly = activeFilter === 'remaining';

  return (
    <section className={`hour-credits-page${locked ? ' credit-pending' : ''}`}>
      {/* 1. Header with Title, Subtitle, and Primary CTA */}
      <header className="hour-credits-header">
        <div className="hour-credits-header-left">
          <div className="hour-credits-title-row">
            <Clock size={26} className="hour-credits-header-icon" />
            <h1>{creditMenuLabel}</h1>
          </div>
          <p className="hour-credits-subtitle">{creditSubtitle}</p>
        </div>
        <div className="hour-credits-header-right">
          <button
            type="button"
            className="credit-btn-primary credit-grant-cta"
            disabled={busy || locked}
            onClick={() => {
              form('grant');
              setSource(null);
              setItemId('');
            }}
          >
            <Plus size={18} />
            <span>ออกเครดิต</span>
          </button>
        </div>
      </header>

      {/* Global Alerts */}
      {error && (
        <div role="alert" className="credit-alert credit-alert-error">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" className="credit-alert-close" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}
      {notice && (
        <div role="status" className="credit-alert credit-alert-success">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button type="button" className="credit-alert-close" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}
      {locked && (
        <div role="alert" className="credit-alert credit-alert-warning">
          <AlertCircle size={18} />
          <span>ยังไม่ยืนยันผลรายการ กรุณาคงหน้านี้และส่งรายการเดิมซ้ำ ห้ามสร้างรายการใหม่เพื่อทดแทน</span>
        </div>
      )}

      {/* 2. Search & Filter Card */}
      <div className="credit-search-card">
        <form
          className="credit-search-form"
          onSubmit={e => {
            e.preventDefault();
            perform(load);
          }}
        >
          <div className="credit-search-input-wrap">
            <Search size={18} className="credit-search-icon" />
            <label htmlFor="credit-search-input" className="credit-search-label-hidden">โทรศัพท์ / Credit ID</label>
            <input
              id="credit-search-input"
              type="text"
              className="credit-search-input"
              placeholder="ค้นหาด้วยเบอร์โทรศัพท์ หรือ Credit ID"
              value={search}
              onChange={e => setSearch(e.target.value)}
              disabled={busy || locked}
            />
            {search && (
              <button
                type="button"
                className="credit-search-clear"
                title="ล้างคำค้นหา"
                disabled={busy || locked}
                onClick={() => {
                  setSearch('');
                  perform(async () => {
                    const data = await creditRequest('');
                    setRows(data);
                    setHasSearched(false);
                  });
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <button type="submit" className="credit-btn-search" disabled={busy || locked}>
            <Search size={16} />
            <span>ค้นหา</span>
          </button>
        </form>

        <div className="credit-chips-row">
          <div className="credit-chips-list">
            {creditFilterChips.map(chip => {
              const count = filterCreditRows(rows, chip.key).length;
              return (
                <button
                  key={chip.key}
                  type="button"
                  className={`credit-filter-chip ${activeFilter === chip.key ? 'active' : ''}`}
                  onClick={() => setActiveFilter(chip.key)}
                  disabled={busy || locked}
                >
                  <span>{chip.label}</span>
                  <span className="credit-chip-badge">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Master / Detail 2-Column Grid */}
      <div className="credit-main-grid">
        {/* Left Column: Credit List / Table Card */}
        <section className="credit-master-pane">
          <div className="credit-pane-header">
            <h2 className="credit-pane-title">
              รายการเครดิต
              <span className="credit-count-tag">
                {filteredRows.length} {filteredRows.length !== rows.length ? `จาก ${rows.length}` : ''} รายการ
              </span>
            </h2>
          </div>

          <div className="credit-table-container">
            {filteredRows.length > 0 ? (
              <table className="credit-table">
                <thead>
                  <tr>
                    <th>Credit ID</th>
                    <th>ลูกค้า</th>
                    <th>ห้องต้นทาง</th>
                    <th>ออกให้</th>
                    <th>ใช้แล้ว</th>
                    <th>คงเหลือ</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(c => {
                    const isSelected = detail?.credit_id === c.credit_id;
                    return (
                      <tr
                        key={c.credit_id}
                        className={`credit-table-row ${isSelected ? 'selected' : ''}`}
                        onClick={() => open(c)}
                      >
                        <td className="credit-td-id">
                          <span className="credit-id-text">{c.credit_id}</span>
                        </td>
                        <td className="credit-td-customer">
                          <div className="credit-cust-name">{c.customer_name}</div>
                          {c.customer_phone && (
                            <div className="credit-cust-phone">{c.customer_phone}</div>
                          )}
                        </td>
                        <td className="credit-td-room">
                          <span className="credit-room-pill">{c.room_name}</span>
                        </td>
                        <td className="credit-td-stat">{durationLabel(c.original_granted_minutes)}</td>
                        <td className="credit-td-stat text-muted">{durationLabel(c.redeemed_minutes)}</td>
                        <td className="credit-td-balance">
                          <strong className={c.remaining_minutes > 0 ? 'text-balance-positive' : 'text-balance-zero'}>
                            {durationLabel(c.remaining_minutes)}
                          </strong>
                        </td>
                        <td className="credit-td-status">
                          <span className={`credit-status-badge status-${c.status}`}>
                            {statusLabel(c.status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* Empty States */
              <div className="credit-empty-container">
                {hasSearched && search.trim() ? (
                  <div className="credit-empty-card">
                    <Search size={44} className="credit-empty-icon text-muted" />
                    <h3 className="credit-empty-title">ไม่พบเครดิตที่ตรงกับคำค้นหา</h3>
                    <p className="credit-empty-desc">
                      ไม่พบข้อมูลสำหรับ "{search.trim()}" ในตัวกรองที่เลือก ลองตรวจสอบความถูกต้อง หรือเลือกแท็บ "ทั้งหมด"
                    </p>
                    <button
                      type="button"
                      className="credit-btn-secondary"
                      onClick={() => {
                        setSearch('');
                        setActiveFilter('all');
                        perform(async () => {
                          const data = await creditRequest('');
                          setRows(data);
                          setHasSearched(false);
                        });
                      }}
                    >
                      <RotateCcw size={15} /> ล้างการค้นหา
                    </button>
                  </div>
                ) : (
                  <div className="credit-empty-card">
                    <Clock size={44} className="credit-empty-icon text-primary" />
                    <h3 className="credit-empty-title">
                      ค้นหาด้วยเบอร์โทรศัพท์หรือ Credit ID เพื่อดูเครดิตชั่วโมงของลูกค้า
                    </h3>
                    <p className="credit-empty-desc">
                      พิมพ์เบอร์โทรศัพท์หรือรหัสเครดิตเพื่อค้นหา หรือกดปุ่ม "+ ออกเครดิต" ด้านบนเพื่อเริ่มออกเครดิตใหม่
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="credit-pane-footer">
            <Info size={14} />
            <span>แสดงสูงสุด 100 รายการ กรุณาค้นหาด้วยเลขอ้างอิงหรือโทรศัพท์เพื่อจำกัดผล</span>
          </div>
        </section>

        {/* Right Column: Selected Credit Detail Panel */}
        <section className="credit-detail-pane">
          {detail ? (
            <div className="credit-detail-card">
              {/* Detail Header */}
              <div className="credit-detail-header">
                <div>
                  <div className="credit-detail-id-wrap">
                    <h3 className="credit-detail-id">{detail.credit_id}</h3>
                    <span className={`credit-status-badge status-${detail.status}`}>
                      {statusLabel(detail.status)}
                    </span>
                  </div>
                  <div className="credit-detail-room-name">ห้องต้นทาง: {detail.room_name}</div>
                </div>
              </div>

              {/* Customer & Origin Meta */}
              <div className="credit-detail-meta-grid">
                <div className="credit-meta-item">
                  <span className="credit-meta-label">ลูกค้า</span>
                  <span className="credit-meta-value">{detail.customer_name}</span>
                </div>
                <div className="credit-meta-item">
                  <span className="credit-meta-label">เบอร์โทรศัพท์</span>
                  <span className="credit-meta-value">{detail.customer_phone || '-'}</span>
                </div>
                <div className="credit-meta-item">
                  <span className="credit-meta-label">การจองต้นทาง</span>
                  <span className="credit-meta-value">
                    Booking #{detail.source_reference || detail.source_booking_id}
                  </span>
                </div>
                <div className="credit-meta-item">
                  <span className="credit-meta-label">ออกเครดิตเมื่อ</span>
                  <span className="credit-meta-value">{formatCreditDateTime(detail.created_at)}</span>
                </div>
                <div className="credit-meta-item">
                  <span className="credit-meta-label">ออกโดยเจ้าหน้าที่</span>
                  <span className="credit-meta-value">#{detail.created_by}</span>
                </div>
              </div>

              {/* Balance Highlight Banner */}
              <div className="credit-balance-summary">
                <div className="credit-bal-stat">
                  <span className="credit-bal-stat-label">ออกให้ทั้งหมด</span>
                  <strong className="credit-bal-stat-val">
                    {durationLabel(detail.original_granted_minutes)}
                  </strong>
                </div>
                <div className="credit-bal-stat">
                  <span className="credit-bal-stat-label">ใช้ไปแล้ว</span>
                  <strong className="credit-bal-stat-val text-muted">
                    {durationLabel(detail.redeemed_minutes)}
                  </strong>
                </div>
                <div className="credit-bal-stat remaining">
                  <span className="credit-bal-stat-label">คงเหลือพร้อมใช้</span>
                  <strong className="credit-bal-stat-val text-primary-balance">
                    {durationLabel(detail.remaining_minutes)}
                  </strong>
                </div>
              </div>

              {/* Actions Section */}
              <div className="credit-actions-section">
                <h4 className="credit-actions-title">การดำเนินการ</h4>
                <div className="credit-actions-grid">
                  {/* Redeem */}
                  <button
                    type="button"
                    className="credit-action-btn btn-action-redeem"
                    disabled={busy || locked || detail.remaining_minutes <= 0}
                    onClick={openRedeem}
                  >
                    <Clock size={16} />
                    <span>ใช้เครดิต</span>
                  </button>

                  {/* View Voucher */}
                  <button
                    type="button"
                    className="credit-action-btn btn-action-voucher"
                    disabled={busy || locked}
                    onClick={() => openVoucherModal()}
                  >
                    <Eye size={16} />
                    <span>ดูใบยืนยัน</span>
                  </button>

                  {/* Print / PDF */}
                  <button
                    type="button"
                    className="credit-action-btn btn-action-print"
                    disabled={busy || locked}
                    onClick={() => openVoucherModal('print')}
                  >
                    <Printer size={16} />
                    <span>พิมพ์ / บันทึก PDF</span>
                  </button>

                  {/* Save PNG */}
                  <button
                    type="button"
                    className="credit-action-btn btn-action-image"
                    disabled={busy || locked}
                    onClick={() => openVoucherModal('image')}
                  >
                    <Download size={16} />
                    <span>บันทึกเป็นรูปภาพ</span>
                  </button>

                  {/* Send LINE */}
                  <button
                    type="button"
                    className={`credit-action-btn btn-action-line ${!detail.has_line ? 'disabled-line' : ''}`}
                    disabled={busy || locked || lineSending || !detail.has_line}
                    onClick={() => sendLine(detail.credit_id)}
                  >
                    <Send size={16} />
                    <span>
                      {lineSending
                        ? 'กำลังส่ง LINE...'
                        : detail.has_line
                        ? 'ส่ง LINE'
                        : 'ส่ง LINE (ไม่ได้เชื่อมต่อ)'}
                    </span>
                  </button>
                </div>
              </div>

              {/* History / Ledger Timeline */}
              <div className="credit-history-section">
                <h4 className="credit-history-title">
                  ประวัติเครดิต ({detail.history?.length || 0})
                </h4>
                {detail.history && detail.history.length > 0 ? (
                  <ul className="credit-history-list">
                    {detail.history.map(e => {
                      const typeLabel = {
                        grant: 'ออกเครดิต',
                        redeem: 'ใช้เครดิต',
                        reversal: 'คืนเครดิต'
                      }[e.entry_type] || e.entry_type;

                      return (
                        <li key={e.id} className={`credit-history-item type-${e.entry_type}`}>
                          <div className="credit-hist-header">
                            <span className={`credit-hist-badge type-${e.entry_type}`}>
                              {typeLabel}
                            </span>
                            <span className={`credit-hist-delta ${e.minutes_delta < 0 ? 'delta-neg' : 'delta-pos'}`}>
                              {e.minutes_delta < 0 ? '−' : '+'}
                              {durationLabel(e.minutes_delta)}
                            </span>
                          </div>
                          <div className="credit-hist-reason">{e.reason}</div>
                          <div className="credit-hist-meta">
                            <span>เจ้าหน้าที่ #{e.created_by}</span>
                            <span>•</span>
                            <span>{formatCreditDateTime(e.created_at)}</span>
                            {e.booking_id && (
                              <>
                                <span>•</span>
                                <span className="credit-hist-booking">
                                  Booking #{e.booking_reference || e.booking_id}
                                </span>
                              </>
                            )}
                            {e.start_time && e.end_time && (
                              <>
                                <span>•</span>
                                <span>{e.room_name || 'ห้อง'} • {formatCreditTimeRange(e.start_time, e.end_time)}</span>
                              </>
                            )}
                          </div>
                          {canReverse(e, detail.history) && (
                            <div className="credit-hist-reversal-action">
                              <button
                                type="button"
                                className="credit-btn-reversal"
                                disabled={busy || locked}
                                onClick={() => {
                                  form('reverse');
                                  setReversal(e);
                                }}
                              >
                                <RotateCcw size={13} />
                                <span>ยกเลิกการใช้เครดิต</span>
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="credit-no-history">ยังไม่มีประวัติการทำรายการ</p>
                )}
              </div>
            </div>
          ) : (
            <div className="credit-detail-placeholder-card">
              <Clock size={48} className="credit-placeholder-icon" />
              <h3>เลือกรายการเครดิต</h3>
              <p>คลิกเลือกรายการเครดิตจากตารางด้านซ้ายเพื่อดูรายละเอียด ยอดคงเหลือ และดำเนินการ</p>
            </div>
          )}
        </section>
      </div>

      {/* 4. Modal Overlays (Grant, Redeem, Reversal) */}
      {/* Grant Modal */}
      {mode === 'grant' && (
        <div className="credit-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !locked) setMode(null); }}>
          <div className="credit-modal-card">
            <div className="credit-modal-header">
              <div className="credit-modal-title-wrap">
                <Plus size={20} className="text-primary" />
                <h2>ออกเครดิตใหม่</h2>
              </div>
              <button type="button" className="credit-modal-close" disabled={locked} onClick={() => setMode(null)}>
                <X size={18} />
              </button>
            </div>

            <form
              className="credit-modal-form"
              onSubmit={e => {
                e.preventDefault();
                perform(async () => {
                  setSource(null);
                  setItemId('');
                  const b = await creditRequest('/source/' + encodeURIComponent(sourceRef.trim()));
                  setSource(b);
                });
              }}
            >
              <fieldset disabled={busy || locked} className="credit-modal-fieldset">
                <label className="credit-field-block">
                  <span className="credit-field-title">Booking ID / เลขที่การจองต้นทาง</span>
                  <div className="credit-inline-search-row">
                    <input
                      required
                      placeholder="เช่น B-12345 หรือรหัสการจอง"
                      className="credit-text-input"
                      value={sourceRef}
                      onChange={e => {
                        setSourceRef(e.target.value);
                        setSource(null);
                        setItemId('');
                      }}
                    />
                    <button type="submit" className="credit-btn-secondary" disabled={busy || locked || !sourceRef.trim()}>
                      <Search size={15} /> ตรวจสอบต้นทาง
                    </button>
                  </div>
                </label>
              </fieldset>
            </form>

            {source && (
              <div className="credit-source-found">
                <div className="credit-source-summary">
                  <div className="credit-source-tag">พบข้อมูลการจอง</div>
                  <p><strong>{source.receipt_number || source.id}</strong> • {source.customer_name} • {source.contact} • สถานะ: {source.payment_status}</p>
                </div>

                <form className="credit-modal-form" onSubmit={grant}>
                  <fieldset disabled={busy} className="credit-modal-fieldset">
                    <label className="credit-field-block">
                      <span className="credit-field-title">ห้องต้นทางที่ต้องการออกเครดิต</span>
                      <select
                        disabled={locked}
                        required
                        className="credit-select-input"
                        value={itemId}
                        onChange={e => setItemId(e.target.value)}
                      >
                        <option value="">-- เลือกห้อง --</option>
                        {source.items.filter(i => i.room_id).map(i => (
                          <option
                            key={i.id}
                            value={i.id}
                            disabled={i.booking_type !== 'hourly' || !!i.existing_credit_id || i.checkin_status === 'cancelled'}
                          >
                            {i.room_name} • {formatCreditTimeRange(i.start_time, i.end_time)}
                            {i.existing_credit_id ? ' (ออกเครดิตแล้ว)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>

                    {currentItem && (
                      <div className="credit-source-item-meta">
                        <span>เวลาที่จอง: {formatCreditTimeRange(currentItem.start_time, currentItem.end_time)}</span>
                        <span>({durationLabel(Math.round((Date.parse(currentItem.end_time) - Date.parse(currentItem.start_time)) / 60000))})</span>
                      </div>
                    )}

                    <fieldset disabled={locked} className="credit-modal-fieldset">
                      <DurationInputs {...{ hours, minutes, setHours, setMinutes }} />

                      <label className="credit-field-block">
                        <span className="credit-field-title">เหตุผลในการออกเครดิต</span>
                        <textarea
                          required
                          rows={2}
                          className="credit-textarea-input"
                          placeholder="ระบุเหตุผล เช่น ลูกค้าขอเลื่อนวัน, ระบบขัดข้อง"
                          value={reason}
                          onChange={e => setReason(e.target.value)}
                        />
                      </label>
                    </fieldset>

                    <div className="credit-form-disclaimer">
                      <ShieldCheck size={16} />
                      <span>การออกเครดิตไม่แก้ไขยอดเงินหรือเวลาการจองเดิม และไม่มีการรับเงินเพิ่ม</span>
                    </div>

                    <div className="credit-modal-actions">
                      <button type="button" className="credit-btn-secondary" disabled={busy || locked} onClick={() => setMode(null)}>
                        ยกเลิก
                      </button>
                      <button type="submit" className="credit-btn-primary" disabled={!currentItem || busy || locked}>
                        <CheckCircle2 size={16} /> ยืนยันออกเครดิต
                      </button>
                    </div>
                  </fieldset>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Redeem Modal */}
      {mode === 'redeem' && detail && (
        <div className="credit-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !locked) setMode(null); }}>
          <div className="credit-modal-card">
            <div className="credit-modal-header">
              <div className="credit-modal-title-wrap">
                <Clock size={20} className="text-primary" />
                <h2>ใช้เครดิต • {detail.credit_id}</h2>
              </div>
              <button type="button" className="credit-modal-close" disabled={locked} onClick={() => setMode(null)}>
                <X size={18} />
              </button>
            </div>

            <p className="credit-modal-subdesc">เลือกได้เฉพาะห้องรายชั่วโมงที่เปิดใช้งานและมีอัตราเท่ากับห้องต้นทาง</p>

            <form className="credit-modal-form" onSubmit={redeem}>
              <fieldset disabled={busy} className="credit-modal-fieldset">
                <fieldset disabled={locked} className="credit-modal-fieldset">
                  <div className="credit-source-item-meta">
                    <span>ห้องต้นทาง: <strong>{detail.room_name}</strong></span>
                    <span>อัตราต้นทาง: <strong>{Number(detail.source_hourly_rate || 0).toLocaleString('th-TH')} บาท/ชั่วโมง</strong></span>
                  </div>

                  <label className="credit-field-block">
                    <span className="credit-field-title">ห้องที่ใช้เครดิต (อัตราเดียวกัน)</span>
                    <select
                      required
                      className="credit-select-input"
                      value={selectedRoomId}
                      onChange={e => setSelectedRoomId(e.target.value)}
                    >
                      <option value="">-- เลือกห้อง --</option>
                      {eligibleRooms.map(room => (
                        <option key={room.id} value={room.id}>
                          {room.name} • {Number(room.hourly_rate).toLocaleString('th-TH')} บาท/ชั่วโมง
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="credit-datetime-row">
                    <label className="credit-field-block">
                      <span className="credit-field-title">วันที่ใช้บริการ</span>
                      <input
                        required
                        type="date"
                        className="credit-text-input"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                      />
                    </label>
                    <label className="credit-field-block">
                      <span className="credit-field-title">เวลาเริ่ม</span>
                      <input
                        required
                        type="time"
                        className="credit-text-input"
                        value={time}
                        onChange={e => setTime(e.target.value)}
                      />
                    </label>
                  </div>

                  <DurationInputs {...{ hours, minutes, setHours, setMinutes }} />

                  {date && selectedRoomId && (
                    <div className="credit-source-item-meta" aria-live="polite">
                      <strong>ช่วงเวลาที่ไม่ว่าง {blockedRanges ? `วันที่ ${formatCreditDateTime(date)}` : ''}</strong>
                      {blockedRanges?.ranges?.length ? blockedRanges.ranges.map((range, index) => (
                        <span key={`${range.start_time}-${index}`}>
                          {formatCreditTime(range.start_time)}–{formatCreditTime(range.end_time)}
                        </span>
                      )) : <span>{blockedRanges ? 'ไม่มีช่วงเวลาจองในวันนี้' : 'กำลังตรวจสอบ...'}</span>}
                      {blockedRanges && <span>ระบบเผื่อเวลาทำความสะอาด {blockedRanges.cleaning_buffer_minutes} นาที และจะตรวจซ้ำเมื่อยืนยัน</span>}
                    </div>
                  )}

                  {date && time && (Number(hours) * 60 + Number(minutes)) > 0 && (() => {
                    try {
                      const range = bookingTimes(date, time, Number(hours) * 60 + Number(minutes));
                      return <div className="credit-source-item-meta"><strong>ช่วงเวลาที่เลือก: {formatCreditTimeRange(range.start_time, range.end_time)}</strong></div>;
                    } catch {
                      return null;
                    }
                  })()}

                  <label className="credit-field-block">
                    <span className="credit-field-title">เหตุผล / บันทึกการใช้งาน</span>
                    <textarea
                      required
                      rows={2}
                      className="credit-textarea-input"
                      placeholder="ระบุวัตถุประสงค์หรือบันทึกของเจ้าหน้าที่"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                    />
                  </label>
                </fieldset>

                <div className="credit-redeem-calc-box">
                  <p style={{ whiteSpace: 'pre-line' }}>
                    {redeemMessage(Number(hours) * 60 + Number(minutes), detail.remaining_minutes)}
                  </p>
                </div>

                <div className="credit-modal-actions">
                  <button type="button" className="credit-btn-secondary" disabled={busy || locked} onClick={() => setMode(null)}>
                    ยกเลิก
                  </button>
                  <button type="submit" className="credit-btn-primary" disabled={busy || locked}>
                    <CheckCircle2 size={16} /> ยืนยันใช้เครดิต
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* Reversal Modal */}
      {mode === 'reverse' && reversal && (
        <div className="credit-modal-overlay" onClick={e => { if (e.target === e.currentTarget && !locked) setMode(null); }}>
          <div className="credit-modal-card">
            <div className="credit-modal-header">
              <div className="credit-modal-title-wrap">
                <RotateCcw size={20} className="text-warning" />
                <h2>ยกเลิกการใช้เครดิต • Booking #{reversal.booking_reference || reversal.booking_id}</h2>
              </div>
              <button type="button" className="credit-modal-close" disabled={locked} onClick={() => setMode(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="credit-reversal-warning-box">
              <AlertCircle size={18} />
              <p>{reversalMessage}</p>
            </div>

            <form className="credit-modal-form" onSubmit={reverse}>
              <fieldset disabled={busy} className="credit-modal-fieldset">
                <label className="credit-field-block">
                  <span className="credit-field-title">เหตุผลในการยกเลิกและคืนเครดิต</span>
                  <textarea
                    required
                    rows={3}
                    disabled={locked}
                    className="credit-textarea-input"
                    placeholder="ระบุเหตุผล เช่น ลูกค้าแจ้งยกเลิกก่อนเวลาเริ่มใช้งาน"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                  />
                </label>

                <div className="credit-modal-actions">
                  <button type="button" className="credit-btn-secondary" disabled={busy || locked} onClick={() => setMode(null)}>
                    ยกเลิก
                  </button>
                  <button type="submit" className="credit-btn-warning" disabled={busy || locked}>
                    <RotateCcw size={16} /> ยืนยันยกเลิกและคืนเครดิต
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </div>
      )}

      {/* 5. Voucher Portal Modal */}
      {voucher && (
        <CreditVoucher
          {...voucher}
          onRefreshCredit={async () => {
            const fresh = await creditRequest('/' + encodeURIComponent(voucher.credit.credit_id));
            setDetail(fresh);
            setVoucher(v => (v ? { ...v, credit: fresh } : null));
            return fresh;
          }}
          lineSending={lineSending}
          onSendLine={() => sendLine(voucher.credit.credit_id)}
          onClose={() => setVoucher(null)}
        />
      )}
    </section>
  );
}
