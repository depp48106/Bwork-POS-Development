// Offline Phase 4 policy. Scores are heuristic, never probabilities or payment evidence.
export const PILOT_POLICY = Object.freeze({ meanConfidence:70, smallWidth:600, lowContrastRange:80,
  maxSourcePixels:4000000, maxVariantPixels:8000000, maxFullPasses:2, roiEnabled:false });
export function fallbackReasons(evidence, quality, qr) {
  const reasons=[];
  if(evidence?.amount?.value==null)reasons.push('amount_missing');
  if(evidence?.amount?.confidenceTier==='uncertain')reasons.push('amount_uncertain');
  if(!evidence?.receiver?.rawName||['uncertain','conflict'].includes(evidence.receiver.confidenceTier))reasons.push('receiver_role_weak');
  if(evidence?.sender?.confidenceTier==='conflict')reasons.push('sender_role_conflict');
  if(!qr?.isValidSlipQR&&!evidence?.reference?.value)reasons.push('reference_missing_without_qr');
  if(quality.meanConfidence!==null&&quality.meanConfidence<PILOT_POLICY.meanConfidence)reasons.push('mean_confidence_below_70_provisional');
  if(quality.width<PILOT_POLICY.smallWidth)reasons.push('width_below_600');
  if(quality.contrastRange<PILOT_POLICY.lowContrastRange)reasons.push('low_contrast_range_below_80');
  return reasons;
}
const values=e=>({amount:e?.amount?.value??null,sender:e?.sender?.rawName??null,receiver:e?.receiver?.rawName??null,
  date:e?.datetime?.date??null,time:e?.datetime?.time??null,reference:e?.reference?.value??null});
const canonical=v=>typeof v==='string'?v.normalize('NFC').replace(/\s+/g,' ').trim():v;
export function mergeEvidence(baseline,fallback,preprocessing) {
  const merged=structuredClone(baseline),provenance={};
  const b=values(baseline),f=values(fallback);
  const parent=key=>['date','time'].includes(key)?'datetime':key;
  for(const key of Object.keys(b)){
    const p=parent(key);
    const candidate=(e,value,variant)=>{
      const source=e[p]||{};
      const boxes=(source.roleEvidence||[]).filter(x=>x.bbox).map(x=>x.bbox);
      return {value,raw:source.raw??source.rawName??null,variant,
        preprocessing:variant==='baseline'?{type:'original',scale:1}:preprocessing,
        confidenceTier:source.confidenceTier??'uncertain',bbox:boxes,
        confidence:source.roleEvidence?.map(x=>x.confidence).filter(x=>x!==null)??[],
        evidence:source.evidence??null};
    };
    provenance[key]={candidates:[candidate(baseline,b[key],'baseline'),candidate(fallback,f[key],'fallback')],
      selectedVariant:'baseline',agreement:false,correlated:true,scoreBonus:0};
    let selected=b[key];
    const upstreamConflict=baseline[p]?.confidenceTier==='conflict'||fallback[p]?.confidenceTier==='conflict';
    if(upstreamConflict||(b[key]!==null&&f[key]!==null&&canonical(b[key])!==canonical(f[key]))){
      selected=null;
      provenance[key].selectedVariant=null;
      merged[p].confidenceTier='conflict';
      merged[p].warnings=[...(merged[p].warnings||[]),'ocr_variant_disagreement'];
    }else if(b[key]===null&&f[key]!==null){
      selected=f[key];provenance[key].selectedVariant='fallback';
      if(p!=='datetime')merged[p]=structuredClone(fallback[p]);
      else{
        merged[p].confidenceTier=fallback[p].confidenceTier;
        merged[p].warnings=[...(merged[p].warnings||[]),...(fallback[p].warnings||[])];
      }
    }else if(b[key]!==null&&canonical(b[key])===canonical(f[key])){
      provenance[key].agreement=true; // Same image variants are correlated: no bonus.
    }
    if(['sender','receiver'].includes(key)){
      merged[p].rawName=selected;
      if(selected===null)merged[p].normalizedName=null;
    }else if(p==='datetime')merged[p][key]=selected;
    else merged[p].value=selected;
  }
  // Guard provenance must not disappear when alternate OCR hides the Fee label.
  if(baseline.amount?.evidence?.recoveredAcrossFeeContext||fallback.amount?.evidence?.recoveredAcrossFeeContext)
    merged.amount.evidence={...merged.amount.evidence,recoveredAcrossFeeContext:true};
  merged.adaptive={provenance,evidenceOnly:true};
  return merged;
}
