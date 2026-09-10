const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {openConnection}=require('../hourCredits/connection');
const {createHourCreditService}=require('../hourCredits/service');
const {creditMutationGuard,creditRouter}=require('../hourCredits/routes');
const express=require('express');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
// Execute the CURRENT overlap/receipt/PIN helpers, not an approximation of room blocking.
const helpers=source.slice(source.indexOf('async function generateReceiptNumber('),source.indexOf("app.post('/api/bookings',"));
const context=vm.createContext({console,Date,Math,Number,String,parseInt,isNaN});
vm.runInContext(helpers,context);
async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bwork-hour-credit-'));
  const filename=path.join(dir,'test.sqlite'),q=await openConnection(filename);
  await q.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
  await q.exec(fs.readFileSync(path.join(__dirname,'../migrations/005_room_hour_credits.sql'),'utf8'));
  await q.run("INSERT INTO rooms(id,name,capacity,hourly_rate,status,pin_code) VALUES(1,'Test room',10,250,'active','123456')");
  await q.run("INSERT INTO bookings(id,customer_name,contact,total_amount,payment_status,billing_option,receipt_number) VALUES(1,'Test customer','081-234-5678',2000,'paid','standard','A-1')");
  await q.run("INSERT INTO booking_items(id,booking_id,room_id,quantity,price,subtotal,start_time,end_time,booking_type) VALUES(1,1,1,8,250,2000,'2030-01-01T08:00:00','2030-01-01T16:00:00','hourly')");
  let clock=Date.parse('2030-01-02T00:00:00+07:00'),failure=null;
  const options={filename,overlap:context.checkRoomOverlap,receipt:context.generateReceiptNumber,pin:context.generateUniquePinCode,now:()=>clock,fault:async point=>{if(point===failure)throw Error('injected failure');}};
  const service=createHourCreditService(options);
  t.after(async()=>{await q.close();fs.rmSync(dir,{recursive:true,force:true});});
  let seq=0;
  const grant=(extra={})=>service.grant({source_booking_id:1,source_item_id:1,minutes:240,reason:'Staff approved',idempotency_key:'grant-key-'+(++seq),...extra},1);
  const redeem=(id,extra={})=>service.redeem(id,{minutes:120,start_time:'2030-01-03T08:00',end_time:'2030-01-03T10:00',reason:'Use credit',idempotency_key:'redeem-key-'+(++seq),...extra},1);
  const reverse=(id,entry,extra={})=>service.reverse(id,{entry_id:entry,reason:'Cancelled before use',idempotency_key:'reverse-key-'+(++seq),...extra},1);
  return {q,service,options,grant,redeem,reverse,setFailure:v=>failure=v,setClock:v=>clock=v};
}
test('grant, derived balance, snapshots and Booking A unchanged',async t=>{
  const f=await fixture(t),a=await f.q.get('SELECT * FROM bookings WHERE id=1'),i=await f.q.get('SELECT * FROM booking_items WHERE id=1');
  const g=await f.grant(),d=await f.service.read(g.credit_id);
  assert.equal(d.original_granted_minutes,240);assert.equal(d.remaining_minutes,240);assert.equal(d.history.length,1);
  assert.equal(d.customer_phone,'0812345678');assert.equal('line_user_id' in d,false);
  assert.deepEqual(await f.q.get('SELECT * FROM bookings WHERE id=1'),a);assert.deepEqual(await f.q.get('SELECT * FROM booking_items WHERE id=1'),i);
});
test('duplicate source grant rejected',async t=>{const f=await fixture(t);await f.grant();await assert.rejects(f.grant(),/already/);});
test('grant greater than duration rejected',async t=>{const f=await fixture(t);await assert.rejects(f.grant({minutes:481}),/duration/);});
test('partial then full redeem; zero money and same normal PIN; A unchanged',async t=>{
  const f=await fixture(t),before=await f.q.get('SELECT * FROM bookings WHERE id=1'),g=await f.grant();
  const r=await f.redeem(g.credit_id),b=await f.q.get('SELECT * FROM bookings WHERE id=?',[r.booking_id]),i=await f.q.get('SELECT * FROM booking_items WHERE id=?',[r.booking_item_id]);
  assert.equal(b.total_amount,0);assert.equal(b.payment_status,'paid');assert.equal(b.payment_method,'hour_credit');assert.equal(b.billing_option,'hour_credit');assert.equal(b.pin_code,'123456');
  assert.equal(i.price,0);assert.equal(i.subtotal,0);assert.equal(i.quantity,2);
  assert.equal((await f.service.read(g.credit_id)).remaining_minutes,120);
  await f.redeem(g.credit_id,{start_time:'2030-01-04T08:00',end_time:'2030-01-04T10:00'});
  const d=await f.service.read(g.credit_id);assert.equal(d.remaining_minutes,0);assert.equal(d.redeemed_minutes,240);assert.equal(d.status,'exhausted');
  assert.deepEqual(await f.q.get('SELECT * FROM bookings WHERE id=1'),before);
});
test('over-redeem rejected without Booking B',async t=>{const f=await fixture(t),g=await f.grant();await assert.rejects(f.redeem(g.credit_id,{minutes:300,end_time:'2030-01-03T13:00'}),/Insufficient/);assert.equal((await f.q.get('SELECT COUNT(*) AS n FROM bookings')).n,1);});
test('actual existing overlap semantics and cleaning buffer enforced',async t=>{
  const f=await fixture(t),g=await f.grant();await f.redeem(g.credit_id);
  await assert.rejects(f.redeem(g.credit_id),/overlap/);
  await assert.rejects(f.redeem(g.credit_id,{start_time:'2030-01-03T10:15',end_time:'2030-01-03T12:15'}),/overlap/);
  assert.equal((await f.service.read(g.credit_id)).remaining_minutes,120);
});
test('failure after booking insert rolls back all writes',async t=>{
  const f=await fixture(t),g=await f.grant();f.setFailure('after_booking');await assert.rejects(f.redeem(g.credit_id),/injected/);
  assert.equal((await f.q.get('SELECT COUNT(*) AS n FROM bookings')).n,1);assert.equal((await f.q.get('SELECT COUNT(*) AS n FROM booking_items')).n,1);assert.equal((await f.service.read(g.credit_id)).remaining_minutes,240);
});
test('independent service connections cannot double spend concurrently',async t=>{
  const f=await fixture(t),g=await f.grant(),second=createHourCreditService(f.options);
  const request={minutes:240,start_time:'2030-01-05T08:00',end_time:'2030-01-05T12:00',reason:'Concurrent',idempotency_key:'parallel-second'};
  const results=await Promise.allSettled([f.redeem(g.credit_id,{minutes:240,end_time:'2030-01-03T12:00'}),second.redeem(g.credit_id,request,1)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.service.read(g.credit_id)).remaining_minutes,0);assert.equal((await f.q.get('SELECT COUNT(*) AS n FROM bookings')).n,2);
});
test('concurrent identical request returns same result; payload conflict rejected',async t=>{
  const f=await fixture(t),g=await f.grant();const same={idempotency_key:'identical-request'};
  const [a,b]=await Promise.all([f.redeem(g.credit_id,same),f.redeem(g.credit_id,same)]);assert.deepEqual(a,b);
  await assert.rejects(f.redeem(g.credit_id,{...same,reason:'Different'}),/different request/);
  assert.equal((await f.service.read(g.credit_id)).remaining_minutes,120);
});
test('grant retry returns original result',async t=>{const f=await fixture(t),a=await f.grant({idempotency_key:'grant-retry'});assert.deepEqual(await f.grant({idempotency_key:'grant-retry'}),a);});
test('reversal cancels atomically and restores exactly once',async t=>{
  const f=await fixture(t),g=await f.grant(),r=await f.redeem(g.credit_id),opts={idempotency_key:'reverse-repeat'};
  const a=await f.reverse(g.credit_id,r.entry_id,opts);assert.deepEqual(await f.reverse(g.credit_id,r.entry_id,opts),a);
  await assert.rejects(f.reverse(g.credit_id,r.entry_id),/already reversed/);
  assert.equal((await f.service.read(g.credit_id)).remaining_minutes,240);assert.equal((await f.q.get('SELECT payment_status FROM bookings WHERE id=?',[r.booking_id])).payment_status,'cancelled');
});
test('failed cancellation rolls back and post-start cancellation rejects',async t=>{
  const f=await fixture(t),g=await f.grant(),r=await f.redeem(g.credit_id);f.setFailure('after_cancel');await assert.rejects(f.reverse(g.credit_id,r.entry_id),/injected/);
  assert.equal((await f.q.get('SELECT payment_status FROM bookings WHERE id=?',[r.booking_id])).payment_status,'paid');assert.equal((await f.service.read(g.credit_id)).remaining_minutes,120);
  f.setFailure(null);f.setClock(Date.parse('2030-01-03T08:00:00+07:00'));await assert.rejects(f.reverse(g.credit_id,r.entry_id),/before booking start/);
});
test('hard delete and bulk delete blocked; ledger append-only',async t=>{
  const f=await fixture(t),g=await f.grant(),r=await f.redeem(g.credit_id);
  for(const sql of ['DELETE FROM bookings WHERE id=1','DELETE FROM booking_items','DELETE FROM bookings','DELETE FROM room_hour_credit_entries','UPDATE room_hour_credit_entries SET minutes_delta=100','DELETE FROM bookings WHERE id='+r.booking_id])await assert.rejects(f.q.run(sql));
  assert.equal((await f.q.get('SELECT COUNT(*) AS n FROM bookings')).n,2);
});
test('search phone/credit ID and reject client snapshots/invalid duration',async t=>{
  const f=await fixture(t),g=await f.grant();assert.equal((await f.service.search('081-234')).length,1);assert.equal((await f.service.search(g.credit_id)).length,1);
  await assert.rejects(f.grant({customer_name:'Injected'}),/Unsupported/);await assert.rejects(f.redeem(g.credit_id,{minutes:60}),/Duration/);
});
test('HTTP guard blocks edit, cancel, reprice, delete and clear-history',async t=>{
  const f=await fixture(t),g=await f.grant(),r=await f.redeem(g.credit_id);
  for(const [method,url,clear] of [['PATCH','/'+r.booking_id+'/payment'],['POST','/'+r.booking_id+'/reschedule'],['POST','/'+r.booking_id+'/cancel'],['DELETE','/1'],['POST','/',true]]){
    let status=0,passed=false;const res={status(n){status=n;return this;},json(){}};
    await creditMutationGuard(f.q,clear)({method,path:url},res,()=>passed=true);assert.equal(status,409);assert.equal(passed,false);
  }
});
test('router grant/read/search/redeem/reverse integration with staff identity',async t=>{
  const f=await fixture(t),app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:1};next();});app.use('/api/hour-credits',creditRouter(f.service));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api/hour-credits';
  const post=async(url,data)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
  const g=await post('',{source_booking_id:1,source_item_id:1,minutes:240,reason:'Approved',idempotency_key:'api-grant'});
  assert.equal((await (await fetch(base+'/'+g.credit_id)).json()).remaining_minutes,240);assert.equal((await (await fetch(base+'?search=081')).json()).length,1);
  const r=await post('/'+g.credit_id+'/redeem',{minutes:60,start_time:'2030-01-03T08:00',end_time:'2030-01-03T09:00',reason:'Use',idempotency_key:'api-redeem'});
  await post('/'+g.credit_id+'/reversals',{entry_id:r.entry_id,reason:'Cancel',idempotency_key:'api-reverse'});
  assert.equal((await (await fetch(base+'/'+g.credit_id)).json()).remaining_minutes,240);
  assert.match(source,/app\.use\('\/api\/hour-credits', authenticateToken, requireAnyPermission\('pos'\)/);
});
test('two concurrent reversals restore credit once',async t=>{
  const f=await fixture(t),g=await f.grant(),r=await f.redeem(g.credit_id);
  const outcomes=await Promise.allSettled([f.reverse(g.credit_id,r.entry_id),f.reverse(g.credit_id,r.entry_id)]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal((await f.service.read(g.credit_id)).remaining_minutes,240);
});
test('unrelated connection writes cannot join or roll back with credit transaction',async t=>{
  const f=await fixture(t),g=await f.grant();let externalWrite;
  const service=createHourCreditService({...f.options,fault:async()=>{
    externalWrite=f.q.run("UPDATE rooms SET name='Independent write' WHERE id=1");
    throw Error('abort isolated credit transaction');
  }});
  await assert.rejects(service.redeem(g.credit_id,{minutes:60,start_time:'2030-01-03T08:00',end_time:'2030-01-03T09:00',reason:'Isolation',idempotency_key:'isolation-test'},1),/isolated/);
  await externalWrite;
  assert.equal((await f.q.get('SELECT name FROM rooms WHERE id=1')).name,'Independent write');assert.equal((await f.service.read(g.credit_id)).remaining_minutes,240);
});
test('guard preserves explicit PIN route and rejects mixed/add-on/room override input',async t=>{
  const f=await fixture(t),g=await f.grant();let passed=false;
  await creditMutationGuard(f.q)({method:'POST',path:'/2/send-pin'},{},()=>passed=true);assert.equal(passed,true);
  for(const input of [{room_id:2},{items:[]},{cash:100},{booking_type:'daily'}])await assert.rejects(f.redeem(g.credit_id,input),/Unsupported/);
});
test('staff identity and paid-source validation fail closed',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.grant({source_booking_id:1,source_item_id:1,minutes:60,reason:'Test',idempotency_key:'no-staff'},null),/Staff/);
  await f.q.run("UPDATE bookings SET payment_status='pending' WHERE id=1");await assert.rejects(f.grant(),/paid hourly/);
  assert.equal((await f.q.get('SELECT COUNT(*) AS n FROM room_hour_credits')).n,0);
});
test('Phase2 safe source and ledger metadata omit sensitive fields',async t=>{
  const f=await fixture(t);await f.q.run("UPDATE bookings SET line_user_id='PRIVATE',pin_code='PRIVATE' WHERE id=1");
  const source=await f.service.source('A-1');assert.equal(source.id,1);assert.equal(source.items[0].room_name,'Test room');assert.doesNotMatch(JSON.stringify(source),/PRIVATE|line_user_id|pin_code/);
  const g=await f.grant(),r=await f.redeem(g.credit_id),d=await f.service.read(g.credit_id),e=d.history.find(e=>e.id===r.entry_id);
  assert.equal(e.start_time,'2030-01-03T08:00:00');assert.ok(e.booking_reference);assert.doesNotMatch(JSON.stringify(d),/PRIVATE|idempotency|fingerprint/);
});
test('Phase2 voucher QR decodes to Credit ID only',async t=>{
  const f=await fixture(t),g=await f.grant(),app=express();app.use(creditRouter(f.service));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/'+g.credit_id+'/voucher-qr');assert.equal(response.status,200);const {data_url}=await response.json();
  const image=await require('jimp').read(Buffer.from(data_url.split(',')[1],'base64'));const qr=require('jsqr')(new Uint8ClampedArray(image.bitmap.data),image.bitmap.width,image.bitmap.height);
  assert.equal(qr.data,g.credit_id);
});
