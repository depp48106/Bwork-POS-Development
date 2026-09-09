const test=require('node:test');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {extractSlipEvidence,analyzeSlipText}=require('../../shared/slipVerificationCore.mjs');
const {normalizeLayout}=require('../../shared/slipLayoutEvidence.mjs');
const line=(text,x,y,blockIndex=0)=>({text,confidence:90,bbox:{x0:x,y0:y,x1:x+80,y1:y+20},blockIndex});
const columns=[line('From',0,0),line('Other Sender',0,30),line('xxx-1234',0,60),
  line('To',400,0,1),line('สม*** ใจดี',400,30,1),line('SOM*** JAIDEE',400,60,1),line('xxx-x-x1234-x',400,90,1)];
test('Two columns and shuffled OCR order preserve masked bilingual roles',()=>{
  for(const layout of [columns,[...columns].reverse()]){
    const e=extractSlipEvidence('arbitrary OCR order',null,layout);
    assert.equal(e.sender.rawName,'Other Sender');
    assert.equal(e.receiver.rawName,'สม*** ใจดี');
    assert.deepEqual(e.receiver.nameVariants,['สม*** ใจดี','SOM*** JAIDEE']);
    assert.equal(e.receiver.accountMasked,'xxx-x-x1234-x');
  }
});
for(const [from,to] of [['From','To'],['จาก','ถึง'],['ผู้โอน','ผู้รับ']]){
  test('Upper/lower explicit labels '+from+'/'+to,()=>{
    const e=extractSlipEvidence('',null,[line(from,0,0),line('Alice Martin',0,30),line(to,0,100),line('Bob Jones',0,130)]);
    assert.equal(e.sender.rawName,'Alice Martin');
    assert.equal(e.receiver.rawName,'Bob Jones');
  });
}
test('Conflicting roles and duplicate labels fail uncertain without guessing',()=>{
  const e=extractSlipEvidence('',null,[line('From',0,0),line('To',20,0),line('Mystery Name',10,30)]);
  assert.equal(e.receiver.confidenceTier,'conflict');
  assert.equal(e.receiver.rawName,null);
  const d=extractSlipEvidence('',null,[line('To',0,0),line('To',400,0)]);
  assert.ok(d.receiver.warnings.includes('role_ambiguous'));
});
for(const text of ['วันที่ 08/09/2569','Date 08-09-2026','Date 2026-09-08','วันที่ 8 ก.ย. 2569','วันที่ 8 กันยายน 2569','Date 8 September 2026']){
  test('Datetime '+text,()=>assert.equal(extractSlipEvidence(text).datetime.date,'2026-09-08'));
}
test('Transaction timestamp retains visible precision; status bar/booking ignored',()=>{
  let e=extractSlipEvidence('09:30\nBooking Date 2026-10-01\nวันที่ 08/09/2569 เวลา 14:25');
  assert.equal(e.datetime.time,'14:25');
  assert.equal(e.datetime.date,'2026-09-08');
  assert.equal(e.datetime.timezone,undefined);
  assert.equal(extractSlipEvidence('Time 14:25:12').datetime.time,'14:25:12');
  assert.equal(extractSlipEvidence('09:30\nScreenshot 2026-09-08').datetime.time,null);
  assert.equal(extractSlipEvidence('Date 31/02/2026').datetime.date,null);
  assert.equal(extractSlipEvidence('วันที่ 8 ก.ย.').datetime.date,null);
});
test('Layout datetime label/value same row',()=>{
  const e=extractSlipEvidence('',null,[line('Date',0,200),line('2026-09-08',100,200)]);
  assert.equal(e.datetime.date,'2026-09-08');
});
test('QR preferred; OCR fallback exact; conflicting references never silently selected',()=>{
  const qr={isValidSlipQR:true,transRef:'ABC234'};
  assert.equal(extractSlipEvidence('',qr).reference.source,'qr');
  assert.equal(extractSlipEvidence('Reference ABC234').reference.value,'ABC234');
  const c=extractSlipEvidence('Reference XYZ678',qr).reference;
  assert.equal(c.value,null);
  assert.equal(c.confidenceTier,'conflict');
  assert.equal(c.evidence.qrReference,'ABC234');
  const a=extractSlipEvidence('เลขที่รายการ AB0O1Il5S8B').reference;
  assert.equal(a.value,'AB0O1Il5S8B');
  assert.equal(a.confidenceTier,'uncertain');
});
test('Metadata adapters preserve words/boxes from blocks and TSV',()=>{
  const l=line('Name',10,10);l.words=[{...l}];
  assert.equal(normalizeLayout({blocks:[{paragraphs:[{lines:[l]}]}]})[0].words[0].text,'Name');
  const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t2\t1\t1\t1\t10\t10\t80\t20\t95\tName';
  assert.equal(normalizeLayout({tsv})[0].text,'Name');
  assert.equal(normalizeLayout({tsv})[0].confidence,95);
});
test('Phase3 metadata has zero Phase2 payment decision deltas',()=>{
  const config={accountName:'TEST COMPANY',accountNumber:'1234567890',bankName:'Krungsri'};
  const qr={isValidSlipQR:true,bankCode:'025',transRef:'ABC234'};
  const fields=['detectedAmount','verificationTier','hasCompanyMatch','hasNameMatch','receiverOcrUncertain','hasBankConflict'];
  for(const amount of ['Amount 300 THB','Balance 300 THB','Amount\nFee 30\n300 THB','Amount 30\nAmount 300']){
    for(const name of ['TEST COMPANY','OTHER PERSON','ด ปิลท์ ฮาร์ท']){
      const text=['From','Sender','To',name,'Krungsri','1234567890',amount,'Reference CONFLICT'].join('\n');
      const before=analyzeSlipText(text,config,qr),after=analyzeSlipText(text,config,qr,columns);
      for(const key of fields)assert.deepEqual(after[key],before[key],key);
    }
  }
});
test('Parser-only incremental cost (synthetic, warm runtime)',()=>{
  const text='Date 2026-09-08\nTime 14:25\nReference ABC234';
  for(let i=0;i<100;i++)extractSlipEvidence(text,null,columns);
  const count=1000,start=performance.now();
  for(let i=0;i<count;i++)extractSlipEvidence(text);
  const plain=(performance.now()-start)/count,startLayout=performance.now();
  for(let i=0;i<count;i++)extractSlipEvidence(text,null,columns);
  const layout=(performance.now()-startLayout)/count;
  console.log(JSON.stringify({parserBenchmark:{iterations:count,plainMs:plain,layoutMs:layout,incrementalMs:layout-plain}}));
});
