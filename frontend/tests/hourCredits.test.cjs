const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..');
const result=buildSync({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import HourCredits,{CreditVoucherContent} from './src/components/HourCredits.jsx'; export * from './src/utils/hourCreditUI.js'; export const renderMenu=()=>renderToStaticMarkup(React.createElement(HourCredits)); export const renderVoucher=p=>renderToStaticMarkup(React.createElement(CreditVoucherContent,p));`,resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false,loader:{'.css':'empty'}});
const mod=new Module(path.join(__dirname,'compiled.cjs'),module);mod.filename=path.join(__dirname,'compiled.cjs');mod.paths=module.paths;mod._compile(result.outputFiles[0].text,mod.filename);const ui=mod.exports;
test('staff menu screen renders search and credit actions',()=>{const html=ui.renderMenu();assert.match(html,/ชั่วโมงคงเหลือ/);assert.match(html,/โทรศัพท์ \/ Credit ID/);assert.match(html,/ออกเครดิต/);assert.match(html,/คงเหลือ/);});
test('friendly integer-minute balance and statuses',()=>{assert.equal(ui.durationLabel(245),'4 ชั่วโมง 5 นาที');assert.equal(ui.durationLabel(0),'0 ชั่วโมง 0 นาที');assert.equal(ui.statusLabel('exhausted'),'ใช้หมดแล้ว');});
test('grant duration input validation',()=>{assert.equal(ui.minutesValue('4','15'),255);for(const [h,m] of [[0,0],[1,60],[-1,0],[.5,0]])assert.throws(()=>ui.minutesValue(h,m));});
test('redeem confirmation shows zero payment and remaining',()=>{const message=ui.redeemMessage(120,240);assert.match(message,/ใช้เครดิต 2 ชั่วโมง/);assert.match(message,/คงเหลือหลังใช้ 2 ชั่วโมง/);assert.match(message,/ยอดชำระ 0 บาท/);});
test('redeem wall times preserve Bangkok and cross midnight',()=>{assert.deepEqual(ui.bookingTimes('2030-01-01','23:30',90),{start_time:'2030-01-01T23:30',end_time:'2030-01-02T01:00'});});
test('reversal eligibility excludes post-start and already reversed',()=>{const e={id:1,entry_type:'redeem',start_time:'2030-01-03T08:00:00',payment_status:'paid'};const now=Date.parse('2030-01-02T00:00Z');assert.equal(ui.canReverse(e,[],now),true);assert.equal(ui.canReverse(e,[{reverses_entry_id:1}],now),false);assert.equal(ui.canReverse(e,[],Date.parse('2030-01-03T01:00Z')),false);assert.match(ui.reversalMessage,/ยกเลิก/);assert.match(ui.reversalMessage,/คืนซ้ำ/);});
test('hour_credit label does not replace cash or transfer',()=>{assert.equal(ui.hourCreditLabel('hour_credit'),'เครดิตชั่วโมง');assert.equal(ui.hourCreditLabel('cash'),null);assert.equal(ui.hourCreditLabel('transfer'),null);});
test('voucher renders only intended public confirmation fields',()=>{
  const html=ui.renderVoucher({credit:{credit_id:'HC-test',customer_name:'TEST CUSTOMER',room_name:'ROOM A',remaining_minutes:240,created_at:'2030-01-01',source_reference:'A-1',line_user_id:'PRIVATE-LINE',pin_code:'PRIVATE-PIN',token:'PRIVATE-TOKEN',customer_phone:'PRIVATE-PHONE'},qr:'data:image/png;base64,TEST',generated:'2030-01-02'});
  for(const value of ['ใบยืนยันชั่วโมงคงเหลือ','ไม่ใช่ใบเสร็จรับเงิน','HC-test','4 ชั่วโมง',ui.voucherNotice,'พิมพ์'])assert.ok(html.includes(value));
  assert.doesNotMatch(html,/PRIVATE-/);assert.doesNotMatch(html,/idempotency/);
});
test('search calls encoded query through API client',async()=>{let requested;const old=global.fetch;global.fetch=async url=>{requested=url;return {ok:true,json:async()=>[]};};try{await ui.creditRequest('?search='+encodeURIComponent('081 123'));assert.equal(requested,'/api/hour-credits?search=081%20123');}finally{global.fetch=old;}});
test('network retry keeps same operation key; rejects changed payload',async()=>{const calls=[];let first=true;const submit=ui.createCreditSubmitter(async(p,o)=>{calls.push(JSON.parse(o.body));if(first){first=false;throw Error('network');}return {ok:true};},()=> 'fixed-key');await assert.rejects(submit('/redeem',{minutes:60}));await assert.rejects(submit('/redeem',{minutes:120}));await submit('/redeem',{minutes:60});assert.equal(calls.length,2);assert.equal(calls[0].idempotency_key,calls[1].idempotency_key);});
test('validation rejection permits corrected request',async()=>{let first=true;const submit=ui.createCreditSubmitter(async()=>{if(first){first=false;throw Object.assign(Error('validation'),{status:400});}return true;},()=> 'key');await assert.rejects(submit('',{minutes:0}));assert.equal(await submit('',{minutes:60}),true);});
test('UI wiring uses safe source/QR endpoints, reversal only, no LINE feature',()=>{
  const code=fs.readFileSync(path.join(root,'src/components/HourCredits.jsx'),'utf8');assert.match(code,/\/source\//);assert.match(code,/\/voucher-qr/);assert.match(code,/\/reversals/);assert.doesNotMatch(code,/\/api\/bookings|send-line|line_user_id|pin_code|dangerouslySetInnerHTML/);
  const app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8');assert.match(app,/activeTab === 'hour-credits' && hasPermission\('pos'\)/);
});
test('voucher print rules do not hide ordinary POS print views',()=>{const css=fs.readFileSync(path.join(root,'src/components/HourCredits.css'),'utf8');assert.match(css,/body:has\(>\.credit-voucher-overlay\)/);assert.doesNotMatch(css,/@media print\{body>\*/);assert.match(css,/@page creditVoucher/);});
