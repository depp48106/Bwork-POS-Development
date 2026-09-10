import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {creditMenuLabel,durationLabel,statusLabel,minutesValue,bookingTimes,canReverse,redeemMessage,reversalMessage,voucherNotice,creditRequest,createCreditSubmitter,sendCreditLine} from '../utils/hourCreditUI';
import './HourCredits.css';

export function CreditVoucherContent({credit,qr,generated,onClose,onSendLine,lineSending}){
  return <section className="credit-voucher-overlay"><article className="credit-voucher">
    <div className="credit-no-print"><button onClick={onClose}>ปิด</button> <button disabled={!qr} onClick={()=>window.print()}>พิมพ์ / บันทึก PDF</button> {onSendLine&&<button disabled={lineSending||!credit?.has_line} onClick={onSendLine}>{lineSending?'กำลังส่ง LINE...':credit?.has_line?'ส่ง LINE':'ส่ง LINE (ไม่ได้เชื่อมต่อ)'}</button>}</div>
    <h1>ใบยืนยันชั่วโมงคงเหลือ</h1><h2>ไม่ใช่ใบเสร็จรับเงิน</h2>
    <p>Credit ID: {credit.credit_id}</p><p>ลูกค้า: {credit.customer_name}</p><p>ห้อง: {credit.room_name}</p>
    <h2>คงเหลือ {durationLabel(credit.remaining_minutes)}</h2><p>วันที่ออกเครดิต: {credit.created_at}</p>
    <p>เวลาสร้างเอกสาร: {generated} (เวลาไทย)</p><p>การจองต้นทาง: {credit.source_reference||credit.source_booking_id}</p>
    {qr&&<img width="220" height="220" src={qr} alt="QR อ้างอิง Credit ID"/>}
    <p>{voucherNotice}</p><p>QR เป็นเลขอ้างอิงเท่านั้น ไม่ใช่สิทธิ์ยืนยันการใช้เครดิต</p>
  </article></section>;
}
export function CreditVoucher(props){return createPortal(<CreditVoucherContent {...props}/>,document.body);}
function DurationInputs({hours,minutes,setHours,setMinutes}){
  return <div className="credit-fields"><label>ชั่วโมง<input type="number" min="0" step="1" value={hours} onChange={e=>setHours(e.target.value)} required/></label><label>นาที<input type="number" min="0" max="59" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)} required/></label></div>;
}
export default function HourCredits({sysConfirm}){
  const [search,setSearch]=useState(''),[rows,setRows]=useState([]),[detail,setDetail]=useState(null),[activeOnly,setActiveOnly]=useState(true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[lineSending,setLineSending]=useState(false);
  const [mode,setMode]=useState(null),[sourceRef,setSourceRef]=useState(''),[source,setSource]=useState(null),[itemId,setItemId]=useState('');
  const [hours,setHours]=useState('0'),[minutes,setMinutes]=useState('0'),[reason,setReason]=useState(''),[date,setDate]=useState(''),[time,setTime]=useState('');
  const [reversal,setReversal]=useState(null),[voucher,setVoucher]=useState(null),[locked,setLocked]=useState(false);
  const submit=useRef(createCreditSubmitter()),inFlight=useRef(false);
  useEffect(()=>{if(!locked)return;const warn=e=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[locked]);
  const load=()=>creditRequest('?search='+encodeURIComponent(search)).then(setRows);
  const perform=async fn=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);inFlight.current=false;}};
  useEffect(()=>{let current=true;creditRequest().then(data=>{if(current)setRows(data);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[]);
  const open=credit=>perform(async()=>{setDetail(await creditRequest('/'+encodeURIComponent(credit.credit_id)));setMode(null);});
  const form=(value)=>{setMode(value);setHours('0');setMinutes('0');setReason('');setError('');setNotice('');};
  const currentItem=source?.items.find(i=>i.id===Number(itemId));
  const commit=async(path,payload)=>{
    setLocked(true);
    let result;try{result=await submit.current(path,payload);}catch(error){if([400,401,403,404,409].includes(error.status))setLocked(false);throw error;}
    setLocked(false);setMode(null);setNotice(result.booking_id?`สำเร็จ: Booking B #${result.booking_id}`:`สำเร็จ: Credit ID ${result.credit_id}`);
    setDetail(await creditRequest('/'+encodeURIComponent(result.credit_id)));await load();
  };
  const confirm=message=>sysConfirm?sysConfirm(message):Promise.resolve(window.confirm(message));
  const grant=e=>{e.preventDefault();perform(async()=>{
    if(!source||!currentItem)throw Error('กรุณาตรวจสอบการจองต้นทางและเลือกห้อง');
    const count=minutesValue(hours,minutes);
    if(!locked&&!await confirm(`ออกเครดิต ${durationLabel(count)}\nการออกเครดิตไม่แก้ไขยอดเงินหรือเวลาการจองเดิม`))return;
    await commit('',{source_booking_id:source.id,source_item_id:currentItem.id,minutes:count,reason});
  });};
  const redeem=e=>{e.preventDefault();perform(async()=>{
    const count=minutesValue(hours,minutes);if(count>detail.remaining_minutes)throw Error('เครดิตไม่เพียงพอ');
    const times=bookingTimes(date,time,count);
    if(!locked&&!await confirm(redeemMessage(count,detail.remaining_minutes)))return;
    await commit('/'+detail.credit_id+'/redeem',{minutes:count,...times,reason});
  });};
  const reverse=e=>{e.preventDefault();perform(async()=>{
    if(!locked&&!await confirm(reversalMessage))return;
    await commit('/'+detail.credit_id+'/reversals',{entry_id:reversal.id,reason});
  });};
  const sendLine=async id=>{
    if(busy||locked||lineSending)return;
    if(!await confirm('ต้องการส่งใบยืนยันชั่วโมงคงเหลือเข้า LINE OA ของลูกค้าใช่หรือไม่?'))return;
    setLineSending(true);setError('');setNotice('');
    try {
      const res=await sendCreditLine(id);
      setNotice(res.message||'ส่งใบยืนยันชั่วโมงคงเหลือเข้า LINE OA ลูกค้าสำเร็จ');
    } catch(err) {
      setError(err.message||'ไม่สามารถส่ง LINE ได้');
    } finally {
      setLineSending(false);
    }
  };
  return <section className={`hour-credits${locked?' credit-pending':''}`}><header><h1>{creditMenuLabel}</h1><p>เครดิตห้องแบบเจ้าหน้าที่ดำเนินการ • ไม่มีการรับเงินเพิ่ม</p></header>
    {error&&<p role="alert" className="credit-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {locked&&<p role="alert">ยังไม่ยืนยันผลรายการ กรุณาคงหน้านี้และส่งรายการเดิมซ้ำ ห้ามสร้างรายการใหม่เพื่อทดแทน</p>}
    <fieldset disabled={busy||locked} className="credit-toolbar"><form onSubmit={e=>{e.preventDefault();perform(load);}}><label>โทรศัพท์ / Credit ID<input value={search} onChange={e=>setSearch(e.target.value)} /></label><button>ค้นหา</button></form>
      <label><input type="checkbox" checked={activeOnly} onChange={e=>setActiveOnly(e.target.checked)}/> เฉพาะเครดิตคงเหลือ</label><button onClick={()=>{form('grant');setSource(null);setItemId('');}}>ออกเครดิต</button>
    </fieldset>
    <p>แสดงสูงสุด 100 รายการ กรุณาค้นหาด้วยเลขอ้างอิงหรือโทรศัพท์เพื่อจำกัดผล</p>
    <div className="credit-scroll"><table><thead><tr>{['Credit ID','ลูกค้า / ห้อง','ออกให้','ใช้แล้ว','คงเหลือ','สถานะ',''].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>
      {rows.filter(c=>!activeOnly||c.remaining_minutes>0).map(c=><tr key={c.credit_id}><td>{c.credit_id}</td><td>{c.customer_name}<br/>{c.room_name}</td><td>{durationLabel(c.original_granted_minutes)}</td><td>{durationLabel(c.redeemed_minutes)}</td><td>{durationLabel(c.remaining_minutes)}</td><td>{statusLabel(c.status)}</td><td><button disabled={busy||locked} onClick={()=>open(c)}>ดูรายละเอียด</button></td></tr>)}
    </tbody></table></div>{!rows.length&&<p>ไม่พบเครดิต</p>}
    {detail&&<article className="credit-card"><h2>{detail.credit_id}</h2><p>{detail.customer_name} • {detail.customer_phone} • {detail.room_name}</p><p>ต้นทาง {detail.source_reference||detail.source_booking_id} • ออกโดย #{detail.created_by} • {detail.created_at}</p>
      <p>ออกให้ {durationLabel(detail.original_granted_minutes)} / ใช้แล้ว {durationLabel(detail.redeemed_minutes)} / คงเหลือ {durationLabel(detail.remaining_minutes)} • {statusLabel(detail.status)}</p>
      <button disabled={busy||locked||detail.remaining_minutes<=0} onClick={()=>form('redeem')}>ใช้เครดิต</button> <button disabled={busy||locked} onClick={()=>perform(async()=>{
        const fresh=await creditRequest('/'+detail.credit_id),qr=await creditRequest('/'+detail.credit_id+'/voucher-qr');setDetail(fresh);
        setVoucher({credit:fresh,qr:qr.data_url,generated:new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})});
      })}>ดูใบยืนยัน</button> <button disabled={busy||locked||lineSending||!detail.has_line} onClick={()=>sendLine(detail.credit_id)}>{lineSending?'กำลังส่ง LINE...':detail.has_line?'ส่ง LINE':'ส่ง LINE (ไม่ได้เชื่อมต่อ)'}</button>
      <h3>ประวัติเครดิต</h3><ul>{detail.history.map(e=><li key={e.id}>{({grant:'ออกเครดิต',redeem:'ใช้เครดิต',reversal:'คืนเครดิต'})[e.entry_type]} {e.minutes_delta<0?'−':'+'}{durationLabel(e.minutes_delta)} — {e.reason} • เจ้าหน้าที่ #{e.created_by} • {e.created_at}
        {e.booking_id&&<span> • Booking {e.booking_reference||e.booking_id}</span>}
        {canReverse(e,detail.history)&&<button disabled={busy||locked} onClick={()=>{form('reverse');setReversal(e);}}>ยกเลิกการใช้เครดิต</button>}
      </li>)}</ul>
    </article>}
    {mode==='grant'&&<article className="credit-card"><h2>ออกเครดิต</h2><form onSubmit={e=>{e.preventDefault();perform(async()=>{setSource(null);setItemId('');const b=await creditRequest('/source/'+encodeURIComponent(sourceRef.trim()));setSource(b);});}}><fieldset disabled={busy||locked}><label>Booking ID / เลขที่การจอง<input required value={sourceRef} onChange={e=>{setSourceRef(e.target.value);setSource(null);setItemId('');}}/></label><button>ตรวจสอบต้นทาง</button></fieldset></form>
      {source&&<><p>{source.receipt_number||source.id} • {source.customer_name} • {source.contact} • {source.payment_status}</p><form onSubmit={grant}><fieldset disabled={busy}><label>ห้องต้นทาง<select disabled={locked} required value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">เลือกห้อง</option>{source.items.filter(i=>i.room_id).map(i=><option key={i.id} value={i.id} disabled={i.booking_type!=='hourly'||!!i.existing_credit_id||i.checkin_status==='cancelled'}>{i.room_name} • {i.start_time} – {i.end_time}{i.existing_credit_id?' (ออกเครดิตแล้ว)':''}</option>)}</select></label>
        {currentItem&&<p>เวลาที่จอง: {currentItem.start_time} – {currentItem.end_time} ({durationLabel(Math.round((Date.parse(currentItem.end_time)-Date.parse(currentItem.start_time))/60000))})</p>}
        <fieldset disabled={locked}><DurationInputs {...{hours,minutes,setHours,setMinutes}}/><label>เหตุผล<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label></fieldset><p>การออกเครดิตไม่แก้ไขยอดเงินหรือเวลาการจองเดิม</p><button disabled={!currentItem}>ยืนยันออกเครดิต</button></fieldset></form></>}
      </article>}
    {mode==='redeem'&&detail&&<form className="credit-card" onSubmit={redeem}><h2>ใช้เครดิต • {detail.room_name}</h2><p>ห้องเดิม / รายชั่วโมง / ไม่มีบริการเสริม / ไม่มีเงินผสม</p><fieldset disabled={busy}><fieldset disabled={locked}><label>วันที่<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>เวลาเริ่ม<input required type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><DurationInputs {...{hours,minutes,setHours,setMinutes}}/><label>เหตุผล<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label></fieldset><p style={{whiteSpace:'pre-line'}}>{redeemMessage(Number(hours)*60+Number(minutes),detail.remaining_minutes)}</p><button>ยืนยันใช้เครดิต</button></fieldset></form>}
    {mode==='reverse'&&<form className="credit-card" onSubmit={reverse}><h2>ยกเลิกการใช้เครดิต • Booking {reversal.booking_reference||reversal.booking_id}</h2><p>{reversalMessage}</p><fieldset disabled={busy}><label>เหตุผล<textarea required disabled={locked} value={reason} onChange={e=>setReason(e.target.value)}/></label><button>ยืนยันยกเลิกและคืนเครดิต</button></fieldset></form>}
    {mode&&<button disabled={busy||locked} onClick={()=>setMode(null)}>ปิดแบบฟอร์ม</button>}
    {voucher&&<CreditVoucher {...voucher} lineSending={lineSending} onSendLine={()=>sendLine(voucher.credit.credit_id)} onClose={()=>setVoucher(null)}/>}
  </section>;
}
