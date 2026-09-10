const { randomUUID, createHash } = require('node:crypto');
const { openConnection } = require('./connection');
const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
const phone = value => String(value || '').replace(/\D/g, '').replace(/^66(?=\d{9}$)/, '0');
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::00)?$/.test(value)) fail('Use Bangkok wall time YYYY-MM-DDTHH:mm, whole minutes', 400);
  const local = value.replace(' ', 'T').slice(0,16) + ':00';
  const ms = Date.parse(local + '+07:00');
  if (!Number.isFinite(ms) || new Date(ms+7*3600000).toISOString().slice(0,19)!==local) fail('Invalid date/time',400);
  return {local,ms};
}
function createHourCreditService({ filename, overlap, receipt, pin, now = () => Date.now(), fault = async () => {} }) {
  async function use(write, fn) {
    const q = await openConnection(filename);
    try {
      await q.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      const result = await fn(q);
      await q.exec('COMMIT');
      return result;
    } catch (err) {
      await q.exec('ROLLBACK').catch(() => {});
      if (err.code === 'SQLITE_BUSY') fail('Database busy; retry with the same idempotency key',503);
      if (err.code === 'SQLITE_CONSTRAINT') fail('Credit constraint conflict');
      throw err;
    } finally { await q.close(); }
  }
  const created = () => new Date(now()+7*3600000).toISOString().slice(0,19);
  function request(kind, creditId, input, actor, allowed) {
    if (!Number.isSafeInteger(actor) || actor<=0) fail('Staff identity required',403);
    if (!input || Object.keys(input).some(k=>!allowed.includes(k))) fail('Unsupported credit fields',400);
    if (typeof input.idempotency_key!=='string' || !/^[\w:-]{8,120}$/.test(input.idempotency_key)) fail('Idempotency key required (8-120 characters)',400);
    if (typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>1000) fail('Reason required',400);
    const payload = Object.fromEntries(Object.keys(input).sort().map(k=>[k,input[k]]));
    return createHash('sha256').update(JSON.stringify({kind,creditId,actor,payload})).digest('hex');
  }
  async function result(q,e) {
    const item = e.booking_item_id ? await q.get('SELECT booking_id FROM booking_items WHERE id=?',[e.booking_item_id]) : null;
    return {credit_id:e.credit_id,entry_id:e.id,entry_type:e.entry_type,minutes_delta:e.minutes_delta,booking_id:item?.booking_id??null,booking_item_id:e.booking_item_id};
  }
  async function replay(q,key,fingerprint) {
    const e=await q.get('SELECT * FROM room_hour_credit_entries WHERE idempotency_key=?',[key]);
    if (!e) return null;
    if(e.request_fingerprint!==fingerprint) fail('Idempotency key already used with a different request');
    return result(q,e);
  }
  async function append(q,creditId,type,delta,item,reverse,input,actor,fingerprint) {
    const r=await q.run(`INSERT INTO room_hour_credit_entries
      (credit_id,entry_type,minutes_delta,booking_item_id,reverses_entry_id,reason,created_by,created_at,idempotency_key,request_fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[creditId,type,delta,item,reverse,input.reason.trim(),actor,created(),input.idempotency_key,fingerprint]);
    return result(q,await q.get('SELECT * FROM room_hour_credit_entries WHERE id=?',[r.id]));
  }
  async function detail(q,id) {
    const c=await q.get(`SELECT c.credit_id,c.source_booking_id,c.source_item_id,c.customer_name,c.customer_phone,c.room_id,c.created_by,c.created_at,
      b.receipt_number AS source_reference,r.name AS room_name FROM room_hour_credits c JOIN bookings b ON b.id=c.source_booking_id JOIN rooms r ON r.id=c.room_id WHERE c.credit_id=?`,[id]);
    if(!c)fail('Credit not found',404);
    const history=await q.all(`SELECT e.id,e.entry_type,e.minutes_delta,e.booking_item_id,e.reverses_entry_id,e.reason,e.created_by,e.created_at,
      i.start_time,b.id AS booking_id,b.receipt_number AS booking_reference,b.payment_status
      FROM room_hour_credit_entries e LEFT JOIN booking_items i ON i.id=e.booking_item_id
      LEFT JOIN bookings b ON b.id=i.booking_id WHERE e.credit_id=? ORDER BY e.id`,[id]);
    const total=type=>history.filter(e=>e.entry_type===type).reduce((n,e)=>n+e.minutes_delta,0);
    const remaining=history.reduce((n,e)=>n+e.minutes_delta,0);
    return {...c,original_granted_minutes:total('grant'),redeemed_minutes:-total('redeem')-total('reversal'),remaining_minutes:remaining,status:remaining===0?'exhausted':remaining===total('grant')?'available':'partially_used',history};
  }
  return {
    source:reference=>use(false,async q=>{
      const b=await q.get(`SELECT id,receipt_number,customer_name,contact,payment_status,total_amount FROM bookings WHERE id=? OR receipt_number=?`,[reference,reference]);
      if(!b)fail('Source booking not found',404);
      const items=await q.all(`SELECT i.id,i.room_id,r.name AS room_name,i.booking_type,i.start_time,i.end_time,i.checkin_status,
        c.credit_id AS existing_credit_id FROM booking_items i LEFT JOIN rooms r ON r.id=i.room_id
        LEFT JOIN room_hour_credits c ON c.source_item_id=i.id WHERE i.booking_id=?`,[b.id]);
      return {...b,items};
    }),
    read:id=>use(false,q=>detail(q,id)),
    search:search=>use(false,async q=>{
      const term=String(search||'').trim().slice(0,120), digits=phone(term);
      const rows=await q.all(`SELECT credit_id FROM room_hour_credits WHERE instr(lower(credit_id),lower(?))>0 OR (?!='' AND instr(customer_phone,?)>0) ORDER BY created_at DESC,credit_id LIMIT 100`,[term,digits,digits]);
      return Promise.all(rows.map(r=>detail(q,r.credit_id)));
    }),
    grant:async(input,actor)=>{
      const fp=request('grant',null,input,actor,['source_booking_id','source_item_id','minutes','reason','idempotency_key']);
      if(!Number.isSafeInteger(input.minutes)||input.minutes<=0)fail('Positive integer minutes required',400);
      return use(true,async q=>{
        const old=await replay(q,input.idempotency_key,fp);if(old)return old;
        const source=await q.get(`SELECT b.id,b.customer_name,b.contact,b.line_user_id,b.payment_status,b.total_amount,b.billing_option,
          i.room_id,i.booking_type,i.start_time,i.end_time,i.checkin_status FROM bookings b JOIN booking_items i ON i.booking_id=b.id WHERE b.id=? AND i.id=?`,[input.source_booking_id,input.source_item_id]);
        if(!source)fail('Source booking/item not found',404);
        if(!source.room_id||source.booking_type!=='hourly'||source.payment_status!=='paid'||source.total_amount<=0||source.billing_option==='hour_credit'||source.checkin_status==='cancelled')fail('Source must be a paid hourly room item');
        const duration=(timestamp(source.end_time).ms-timestamp(source.start_time).ms)/60000;
        if(input.minutes>duration)fail('Grant exceeds original duration');
        if(await q.get('SELECT credit_id FROM room_hour_credits WHERE source_item_id=?',[input.source_item_id]))fail('Source item already has credit');
        const id='HC-'+randomUUID();
        await q.run(`INSERT INTO room_hour_credits (credit_id,source_booking_id,source_item_id,customer_name,customer_phone,line_user_id,room_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[id,source.id,input.source_item_id,source.customer_name,phone(source.contact),source.line_user_id||null,source.room_id,actor,created()]);
        return append(q,id,'grant',input.minutes,null,null,input,actor,fp);
      });
    },
    redeem:async(id,input,actor)=>{
      const fp=request('redeem',id,input,actor,['minutes','start_time','end_time','reason','idempotency_key']);
      const start=timestamp(input.start_time),end=timestamp(input.end_time);
      if(!Number.isSafeInteger(input.minutes)||input.minutes<=0||(end.ms-start.ms)!==input.minutes*60000)fail('Duration must equal positive integer minutes',400);
      return use(true,async q=>{
        const old=await replay(q,input.idempotency_key,fp);if(old)return old;
        if(start.ms<=now())fail('Booking must start in the future');
        const c=await q.get('SELECT * FROM room_hour_credits WHERE credit_id=?',[id]);if(!c)fail('Credit not found',404);
        const balance=await q.get('SELECT COALESCE(SUM(minutes_delta),0) AS minutes FROM room_hour_credit_entries WHERE credit_id=?',[id]);
        if(balance.minutes<input.minutes)fail('Insufficient credit');
        const room=await q.get('SELECT * FROM rooms WHERE id=?',[c.room_id]);if(!room||room.status!=='active')fail('Room unavailable');
        if((await overlap(c.room_id,start.local,end.local,null,q)).hasOverlap)fail('Room overlaps another booking or cleaning buffer');
        const receiptNumber=await receipt(q),pinCode=room.pin_code?.trim()||await pin(q);
        const booking=await q.run(`INSERT INTO bookings (customer_name,contact,total_amount,payment_status,payment_method,billing_option,receipt_number,pin_code,booking_source,customer_type,checkin_status,created_at)
          VALUES (?,?,0,'paid','hour_credit','hour_credit',?,?,'walk-in','walkin','pending',?)`,[c.customer_name,c.customer_phone,receiptNumber,pinCode,created()]);
        const item=await q.run(`INSERT INTO booking_items (booking_id,room_id,quantity,price,subtotal,start_time,end_time,booking_type,layout,pin_code,checkin_status) VALUES (?,?,?,0,0,?,?,'hourly','standard',?,'pending')`,[booking.id,c.room_id,input.minutes/60,start.local,end.local,pinCode]);
        await fault('after_booking');
        return append(q,id,'redeem',-input.minutes,item.id,null,input,actor,fp);
      });
    },
    reverse:async(id,input,actor)=>{
      const fp=request('reverse',id,input,actor,['entry_id','reason','idempotency_key']);
      return use(true,async q=>{
        const old=await replay(q,input.idempotency_key,fp);if(old)return old;
        const e=await q.get("SELECT * FROM room_hour_credit_entries WHERE id=? AND credit_id=? AND entry_type='redeem'",[input.entry_id,id]);if(!e)fail('Redeem entry not found',404);
        if(await q.get('SELECT id FROM room_hour_credit_entries WHERE reverses_entry_id=?',[e.id]))fail('Redeem already reversed');
        const i=await q.get('SELECT * FROM booking_items WHERE id=?',[e.booking_item_id]);
        if(!i||timestamp(i.start_time).ms<=now())fail('Reversal allowed only before booking start');
        await q.run("UPDATE bookings SET payment_status='cancelled',checkin_status='cancelled',cancellation_reason=? WHERE id=?",[input.reason.trim(),i.booking_id]);
        await q.run("UPDATE booking_items SET checkin_status='cancelled' WHERE booking_id=?",[i.booking_id]);
        await fault('after_cancel');
        return append(q,id,'reversal',-e.minutes_delta,i.id,e.id,input,actor,fp);
      });
    }
  };
}
module.exports={createHourCreditService,phone,timestamp};
