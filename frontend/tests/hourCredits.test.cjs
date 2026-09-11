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
test('same-rate eligible rooms and Hour Credit date/time display use shared rules',()=>{
  const rooms=[
    {id:1,status:'active',has_hourly:1,hourly_rate:500},
    {id:2,status:'active',has_hourly:1,hourly_rate:400},
    {id:3,status:'inactive',has_hourly:1,hourly_rate:500},
    {id:4,status:'active',has_hourly:0,hourly_rate:500},
    {id:5,status:'active',has_hourly:1,hourly_rate:'500'}
  ];
  assert.deepEqual(ui.eligibleHourCreditRooms(rooms,500).map(room=>room.id),[1,5]);
  assert.equal(ui.formatCreditDate('2026-09-15T09:00:00'),'15/09/2026');
  assert.equal(ui.formatCreditDateTime('2026-09-15T09:00:00'),'15/09/2026 09:00');
  assert.equal(ui.formatCreditTimeRange('2026-09-15T09:00:00','2026-09-15T11:00:00'),'15/09/2026 09:00–11:00');
  assert.deepEqual(ui.bookingTimes('2026-09-15','09:00',120),{start_time:'2026-09-15T09:00',end_time:'2026-09-15T11:00'});
  const code=fs.readFileSync(path.join(root,'src/components/HourCredits.jsx'),'utf8');
  assert.match(code,/eligibleRooms\.map/);assert.match(code,/ห้องที่ใช้เครดิต \(อัตราเดียวกัน\)/);assert.doesNotMatch(code,/เงื่อนไข: ห้องเดิม/);
});
test('reversal eligibility excludes post-start and already reversed',()=>{const e={id:1,entry_type:'redeem',start_time:'2030-01-03T08:00:00',payment_status:'paid'};const now=Date.parse('2030-01-02T00:00Z');assert.equal(ui.canReverse(e,[],now),true);assert.equal(ui.canReverse(e,[{reverses_entry_id:1}],now),false);assert.equal(ui.canReverse(e,[],Date.parse('2030-01-03T01:00Z')),false);assert.match(ui.reversalMessage,/ยกเลิก/);assert.match(ui.reversalMessage,/คืนซ้ำ/);});
test('hour_credit label does not replace cash or transfer',()=>{assert.equal(ui.hourCreditLabel('hour_credit'),'เครดิตชั่วโมง');assert.equal(ui.hourCreditLabel('cash'),null);assert.equal(ui.hourCreditLabel('transfer'),null);});
test('voucher renders only intended public confirmation fields',()=>{
  const html=ui.renderVoucher({credit:{credit_id:'HC-test',customer_name:'TEST CUSTOMER',room_name:'ROOM A',remaining_minutes:240,created_at:'2030-01-01',source_reference:'A-1',line_user_id:'PRIVATE-LINE',pin_code:'PRIVATE-PIN',token:'PRIVATE-TOKEN',customer_phone:'PRIVATE-PHONE'},qr:'data:image/png;base64,TEST',generated:'2030-01-02'});
  for(const value of ['ใบยืนยันชั่วโมงคงเหลือ','ไม่ใช่ใบเสร็จรับเงิน','HC-test','4 ชั่วโมง',ui.voucherNotice,'พิมพ์'])assert.ok(html.includes(value));
  assert.doesNotMatch(html,/PRIVATE-/);assert.doesNotMatch(html,/idempotency/);
});
test('voucher uses short reference for new credits while legacy IDs remain displayable',()=>{
  const shortHtml=ui.renderVoucher({credit:{credit_id:'HC-260911-0001',customer_name:'A',room_name:'Room',remaining_minutes:60},qr:'data:image/png;base64,TEST'});
  const legacyHtml=ui.renderVoucher({credit:{credit_id:'HC-b5a8ebd4-7aed-40f1-9183-6055379514ff',customer_name:'A',room_name:'Room',remaining_minutes:60},qr:'data:image/png;base64,TEST'});
  assert.match(shortHtml,/HC-260911-0001/);assert.match(shortHtml,/ห้องต้นทาง/);
  assert.match(legacyHtml,/HC-b5a8ebd4-7aed-40f1-9183-6055379514ff/);
});
test('search calls encoded query through API client',async()=>{let requested;const old=global.fetch;global.fetch=async url=>{requested=url;return {ok:true,json:async()=>[]};};try{await ui.creditRequest('?search='+encodeURIComponent('081 123'));assert.equal(requested,'/api/hour-credits?search=081%20123');}finally{global.fetch=old;}});
test('network retry keeps same operation key; rejects changed payload',async()=>{const calls=[];let first=true;const submit=ui.createCreditSubmitter(async(p,o)=>{calls.push(JSON.parse(o.body));if(first){first=false;throw Error('network');}return {ok:true};},()=> 'fixed-key');await assert.rejects(submit('/redeem',{minutes:60}));await assert.rejects(submit('/redeem',{minutes:120}));await submit('/redeem',{minutes:60});assert.equal(calls.length,2);assert.equal(calls[0].idempotency_key,calls[1].idempotency_key);});
test('validation rejection permits corrected request',async()=>{let first=true;const submit=ui.createCreditSubmitter(async()=>{if(first){first=false;throw Object.assign(Error('validation'),{status:400});}return true;},()=> 'key');await assert.rejects(submit('',{minutes:0}));assert.equal(await submit('',{minutes:60}),true);});
test('UI wiring uses safe source/QR endpoints, reversal and sendCreditLine, no sensitive leaks',()=>{
  const code=fs.readFileSync(path.join(root,'src/components/HourCredits.jsx'),'utf8');assert.match(code,/\/source\//);assert.match(code,/\/voucher-qr/);assert.match(code,/\/reversals/);assert.match(code,/\/eligible-rooms/);assert.match(code,/\/blocked-ranges/);assert.match(code,/room_id: Number\(selectedRoomId\)/);assert.match(code,/sendCreditLine/);assert.doesNotMatch(code,/\/api\/bookings|line_user_id|pin_code|dangerouslySetInnerHTML/);
  const app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8');assert.match(app,/activeTab === 'hour-credits' && hasPermission\('pos'\)/);
});
test('Phase3: voucher renders "ส่ง LINE" button conditionally based on has_line and lineSending',()=>{
  const onSendLine=()=>{};
  const htmlWithLine=ui.renderVoucher({credit:{credit_id:'HC-test',customer_name:'A',room_name:'B',remaining_minutes:60,has_line:true},qr:'data:image/png;base64,TEST',onSendLine});
  assert.match(htmlWithLine,/>ส่ง LINE<\/button>/);
  assert.doesNotMatch(htmlWithLine,/<button disabled=""[^>]*>ส่ง LINE<\/button>/);

  const htmlNoLine=ui.renderVoucher({credit:{credit_id:'HC-test',customer_name:'A',room_name:'B',remaining_minutes:60,has_line:false},qr:'data:image/png;base64,TEST',onSendLine});
  assert.match(htmlNoLine,/<button disabled=""[^>]*>ส่ง LINE \(ไม่ได้เชื่อมต่อ\)<\/button>/);

  const htmlSending=ui.renderVoucher({credit:{credit_id:'HC-test',customer_name:'A',room_name:'B',remaining_minutes:60,has_line:true},qr:'data:image/png;base64,TEST',onSendLine,lineSending:true});
  assert.match(htmlSending,/<button disabled=""[^>]*>กำลังส่ง LINE\.\.\.<\/button>/);
});
test('Phase3: sendCreditLine calls encoded POST endpoint',async()=>{
  let calledUrl,calledOpts;
  const old=global.fetch;
  global.fetch=async(url,opts)=>{
    calledUrl=url;
    calledOpts=opts;
    return {ok:true,json:async()=>({success:true,message:'ok'})};
  };
  try {
    const res=await ui.sendCreditLine('HC 123/456');
    assert.equal(calledUrl,'/api/hour-credits/HC%20123%2F456/send-line');
    assert.equal(calledOpts.method,'POST');
    assert.equal(res.success,true);
  } finally {
    global.fetch=old;
  }
});
test('voucher print rules do not hide ordinary POS print views',()=>{const css=fs.readFileSync(path.join(root,'src/components/HourCredits.css'),'utf8');assert.match(css,/body:has\(>\.credit-voucher-overlay\)/);assert.doesNotMatch(css,/@media print\{body>\*/);assert.match(css,/@page creditVoucher/);});

test('Voucher Export 1: image export button exists and reflects loading state',()=>{
  const htmlReady=ui.renderVoucher({credit:{credit_id:'HC-100',customer_name:'Customer',room_name:'Room',remaining_minutes:120},qr:'data:image/png;base64,TEST'});
  assert.match(htmlReady,/<button[^>]*>บันทึกเป็นรูปภาพ<\/button>/);
  assert.doesNotMatch(htmlReady,/<button disabled=""[^>]*>บันทึกเป็นรูปภาพ<\/button>/);

  const htmlNoQr=ui.renderVoucher({credit:{credit_id:'HC-100',customer_name:'Customer',room_name:'Room',remaining_minutes:120},qr:null});
  assert.match(htmlNoQr,/<button disabled=""[^>]*>บันทึกเป็นรูปภาพ<\/button>/);
});

test('Voucher Export 2: export uses voucher container and excludes toolbar/buttons',()=>{
  const mockElement={nodeType:1,classList:{contains:cls=>cls==='credit-no-print'}};
  const mockContent={nodeType:1,classList:{contains:()=>false}};

  let capturedOpts;
  const mockToPng=async(el,opts)=>{
    capturedOpts=opts;
    return 'data:image/png;base64,MOCK_PNG';
  };
  ui.exportVoucherAsPng({nodeType:1},'test.png',mockToPng);
  assert.ok(capturedOpts);
  assert.equal(capturedOpts.backgroundColor,'#ffffff');
  assert.equal(capturedOpts.pixelRatio,2);
  assert.equal(capturedOpts.filter(mockElement),false,'credit-no-print must be filtered out');
  assert.equal(capturedOpts.filter(mockContent),true,'voucher content must be retained');
});

test('Voucher Export 3: filename contains Credit ID with BWORK prefix',()=>{
  assert.equal(ui.voucherImageFilename('HC-2609001'),'BWORK-Hour-Credit-HC-2609001.png');
  assert.equal(ui.voucherImageFilename('HC 999/test'),'BWORK-Hour-Credit-HC-999-test.png');
  assert.equal(ui.voucherImageFilename(''),'BWORK-Hour-Credit-voucher.png');
});

test('Voucher Export 4: current balance appears in voucher and B-WORK branding exists',()=>{
  const html=ui.renderVoucher({credit:{credit_id:'HC-101',customer_name:'Somchai',room_name:'Focus 1',remaining_minutes:210},qr:'data:image/png;base64,TEST',generated:'2026-09-10 17:00:00'});
  assert.match(html,/B-WORK/);
  assert.match(html,/คงเหลือ 3 ชั่วโมง 30 นาที/);
  assert.match(html,/Focus 1/);
  assert.match(html,/Somchai/);
});

test('Voucher Export 5: required disclaimer appears in voucher',()=>{
  const html=ui.renderVoucher({credit:{credit_id:'HC-102',customer_name:'Somchai',room_name:'Focus 1',remaining_minutes:60},qr:'data:image/png;base64,TEST'});
  assert.match(html,/ยอดในระบบเป็นข้อมูลอ้างอิงสูงสุด เอกสารนี้แสดงยอด ณ เวลาที่ออก/);
});

test('Voucher Export 6 & 7: QR remains Credit ID only and contains NO phone/PIN/token/auth data',async()=>{
  const creditId='HC-2026-SECURE-ID';
  const html=ui.renderVoucher({credit:{credit_id:creditId,customer_name:'A',customer_phone:'0812345678',pin_code:'999888',token:'SECRET_TOKEN',line_user_id:'U_SECRET'},qr:'data:image/png;base64,TEST'});
  assert.match(html,new RegExp(creditId));
  assert.doesNotMatch(html,/0812345678|999888|SECRET_TOKEN|U_SECRET/);
});

test('Voucher Export 8: generation failure does not mutate credit or trigger backend calls',async()=>{
  const calls=[];
  const oldFetch=global.fetch;
  global.fetch=async(url,opts)=>{
    calls.push({url,opts});
    return {ok:true,json:async()=>({})};
  };
  try {
    const failingToPng=async()=>{throw Error('Canvas taint simulated');};
    await assert.rejects(ui.exportVoucherAsPng({nodeType:1},'fail.png',failingToPng),/Canvas taint simulated/);
    assert.equal(calls.length,0,'zero network calls on export failure');
  } finally {
    global.fetch=oldFetch;
  }
});

test('Voucher Export 9: LINE and Print actions remain intact beside image export button',()=>{
  const onSendLine=()=>{};
  const html=ui.renderVoucher({credit:{credit_id:'HC-103',customer_name:'User',room_name:'Room',remaining_minutes:60,has_line:true},qr:'data:image/png;base64,TEST',onSendLine});
  assert.match(html,/<button[^>]*>พิมพ์ \/ บันทึก PDF<\/button>/);
  assert.match(html,/<button[^>]*>บันทึกเป็นรูปภาพ<\/button>/);
  assert.match(html,/<button[^>]*>ส่ง LINE<\/button>/);
});

test('Redesign 1: Title, subtitle, and primary CTA render with required copy',()=>{
  const html=ui.renderMenu();
  assert.match(html,/จัดการเครดิตชั่วโมง/);
  assert.match(html,/จัดการเครดิตชั่วโมงคงเหลือของลูกค้า ออกใบยืนยัน ใช้เครดิต และส่ง LINE/);
  assert.match(html,/ออกเครดิต/);
});

test('Navigation uses compact label after quotations while page heading stays descriptive',()=>{
  assert.equal(ui.creditNavigationLabel,'เครดิตชั่วโมง');
  assert.equal(ui.creditMenuLabel,'จัดการเครดิตชั่วโมง');
  const app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8');
  const desktop=app.slice(app.indexOf('<nav className="desktop-menu-bar"'),app.indexOf('{/* Hamburger Menu Toggle'));
  const mobile=app.slice(app.indexOf('<div className="menu-grid">'),app.indexOf("{hasPermission('admin-management')",app.indexOf('<div className="menu-grid">')));
  for(const navigation of [desktop,mobile]){
    assert.ok(navigation.indexOf('ประวัติย้อนหลัง') < navigation.indexOf('ใบเสนอราคา'));
    assert.ok(navigation.indexOf('ใบเสนอราคา') < navigation.indexOf('creditNavigationLabel'));
  }
});

test('Redesign 2: Search input placeholder and all 4 status filter chips render',()=>{
  const html=ui.renderMenu();
  assert.match(html,/ค้นหาด้วยเบอร์โทรศัพท์ หรือ Credit ID/);
  assert.match(html,/ทั้งหมด/);
  assert.match(html,/คงเหลือ/);
  assert.match(html,/ใช้บางส่วน/);
  assert.match(html,/ใช้หมด/);
});

test('Redesign 3: filterCreditRows correctly filters all 4 statuses',()=>{
  const mockCredits=[
    {credit_id:'HC-1',remaining_minutes:120,status:'available'},
    {credit_id:'HC-2',remaining_minutes:60,status:'partially_used'},
    {credit_id:'HC-3',remaining_minutes:0,status:'exhausted'}
  ];
  assert.equal(ui.filterCreditRows(mockCredits,'all').length,3);
  assert.equal(ui.filterCreditRows(mockCredits,'remaining').length,2);
  assert.equal(ui.filterCreditRows(mockCredits,'partially_used').length,1);
  assert.equal(ui.filterCreditRows(mockCredits,'partially_used')[0].credit_id,'HC-2');
  assert.equal(ui.filterCreditRows(mockCredits,'exhausted').length,1);
  assert.equal(ui.filterCreditRows(mockCredits,'exhausted')[0].credit_id,'HC-3');
});

test('Redesign 4: Initial empty state renders friendly guidance prompt',()=>{
  const html=ui.renderMenu();
  assert.match(html,/ค้นหาด้วยเบอร์โทรศัพท์หรือ Credit ID เพื่อดูเครดิตชั่วโมงของลูกค้า/);
});
