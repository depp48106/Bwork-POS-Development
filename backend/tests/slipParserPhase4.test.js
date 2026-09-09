'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Jimp=require('jimp');
const {fallbackReasons,mergeEvidence,PILOT_POLICY}=require('../../shared/slipAdaptiveEvidence.mjs');
const {runAdaptive}=require('../evaluation/slipAdaptive.cjs');
const {validateSize,imageSize,score}=require('../evaluation/slipPhase4.cjs');
const evidence=()=>({amount:{value:300,raw:'300',confidenceTier:'strong',warnings:[],evidence:{recoveredAcrossFeeContext:false}},
  sender:{rawName:'Alice',normalizedName:'alice',confidenceTier:'partial',warnings:[],roleEvidence:[]},
  receiver:{rawName:'Bob',normalizedName:'bob',confidenceTier:'partial',warnings:[],roleEvidence:[]},
  datetime:{date:'2026-09-08',time:'10:30',confidenceTier:'partial',warnings:[]},
  reference:{value:'ABC234',raw:'ABC234',source:'qr',confidenceTier:'strong',warnings:[]},layout:[]});
const quality={width:1000,contrastRange:200,meanConfidence:90};
test('Clear strong evidence does not trigger fallback',()=>assert.deepEqual(fallbackReasons(evidence(),quality,{isValidSlipQR:true}),[]));
test('Low confidence uses explicitly reported provisional threshold',()=>{
  assert.ok(fallbackReasons(evidence(),{...quality,meanConfidence:60},{isValidSlipQR:true}).includes('mean_confidence_below_70_provisional'));
});
test('Missing evidence triggers fallback without ground truth or receiver settings',()=>{
  const e=evidence();e.amount.value=null;e.receiver.rawName=null;
  const r=fallbackReasons(e,quality,{isValidSlipQR:true});
  assert.ok(r.includes('amount_missing'));assert.ok(r.includes('receiver_role_weak'));
});
test('Field merge retains baseline receiver while recovering reference',()=>{
  const a=evidence(),b=evidence();a.reference.value=null;a.reference.confidenceTier='uncertain';b.receiver.rawName=null;
  const original=structuredClone(a),m=mergeEvidence(a,b,{type:'gray',scale:1.5});
  assert.equal(m.receiver.rawName,'Bob');assert.equal(m.reference.value,'ABC234');
  assert.equal(m.adaptive.provenance.reference.selectedVariant,'fallback');
  assert.equal(m.adaptive.provenance.reference.candidates[1].preprocessing.scale,1.5);
  assert.deepEqual(a,original);
});
test('Material disagreement is uncertainty, never majority voting',()=>{
  const a=evidence(),b=evidence();b.amount.value=1300;
  const m=mergeEvidence(a,b,{type:'gray',scale:1.5});
  assert.equal(m.amount.value,null);assert.equal(m.amount.confidenceTier,'conflict');
  assert.equal(m.adaptive.provenance.receiver.scoreBonus,0);
  assert.equal(m.adaptive.provenance.receiver.correlated,true);
});
test('QR/OCR conflict cannot be erased by another variant',()=>{
  const a=evidence(),b=evidence();b.reference.confidenceTier='conflict';b.reference.value=null;
  assert.equal(mergeEvidence(a,b,{}).reference.value,null);
});
test('Fee recovery guard provenance survives merge',()=>{
  const a=evidence(),b=evidence();a.amount.evidence.recoveredAcrossFeeContext=true;
  assert.equal(mergeEvidence(a,b,{}).amount.evidence.recoveredAcrossFeeContext,true);
});
test('Hard image-size protection precedes decode',()=>{
  assert.throws(()=>validateSize({width:100000,height:100000}),/limits/);
  assert.throws(()=>imageSize(Buffer.from('invalid')),/unsupported/);
  assert.equal(validateSize({width:1000,height:1000}).decodedPixels,1000000);
});
test('Null truth excluded; notes ignored; references exact; masked names not expanded',()=>{
  const truth={amount:300,sender:'สม***',receiver:null,date:null,time:'8:33 PM',reference:'ABC0',notes:'anything'};
  const s=score({amount:300,sender:'สมชาย',receiver:'Bob',date:'2026-01-01',time:'20:33',reference:'ABCO'},truth);
  assert.equal(s.sender,false);assert.equal(s.reference,false);assert.equal(s.receiver,null);assert.equal(s.date,null);assert.equal(s.time,true);
});
test('Fallback failure preserves baseline and never exceeds two operations',async()=>{
  const e=evidence();e.amount.value=null;
  const before=structuredClone(e);
  const image=new Jimp(100,100,0xffffffff),bytes=await image.getBufferAsync(Jimp.MIME_PNG);
  let calls=0;
  const result=await runAdaptive(bytes,{evidence:e},null,{decodedPixels:10000},{recognize:async()=>{calls++;throw Error('synthetic failure');}});
  assert.equal(calls,1);assert.equal(result.extraPasses,1);assert.equal(result.fallbackFailure,'synthetic failure');
  assert.deepEqual(result.evidence,before);assert.equal(PILOT_POLICY.maxFullPasses,2);assert.equal(PILOT_POLICY.roiEnabled,false);
});
test('Adaptive pilot is not imported by payment/runtime modules',()=>{
  for(const file of ['backend/server.js','backend/slipVerifier.js','backend/worker.js','frontend/src/utils/browserSlipVerifier.js']){
    const source=fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
    assert.doesNotMatch(source,/require\([^)]*slipAdaptive|from\s+['"][^'"]*slipAdaptive/);
  }
});
