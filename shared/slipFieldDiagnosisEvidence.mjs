// Phase 4B offline evidence view. Never imported into payment comparison/verification.
import { temporalAndReference } from './slipLayoutEvidence.mjs';
import { normalizeAmountToken } from './slipVerificationCore.mjs';
const compactLabel=s=>String(s).normalize('NFKC').replace(/\u0e4d\u0e32/g,'ำ').replace(/\s+/g,'');
const norm=s=>String(s).normalize('NFC').replace(/\s+/g,' ').trim();
const roleLabel={sender:/^FROM\b|^Sender\b|^จาก|^ผู้โอน/i,receiver:/^TO\b|^Receiver\b|^ถึง|^ผู้รับ/i};
const negative=s=>/fee|balance|ค่าธรรมเนียม|ยอด(?:เงิน)?คงเหลือ/i.test(compactLabel(s));
const amountLabel=s=>/^(?:amount|total|จำนวนเงิน|จำนวน|ยอดโอน|ยอดชำระ)/i.test(compactLabel(s));
const referenceLabel=s=>/^(?:ref(?:erence)?(?:id)?[:.]?|transaction(?:id|no)|รหัสอ้างอิง|เลขที่รายการ|เลขที่อ้างอิง)/i.test(compactLabel(s));
function iconClean(e,role,lines){
  const anchors=lines.filter(l=>roleLabel[role].test(l.text));
  if(anchors.length!==1)return e; // Do not reinterpret 10 as TO or infer arrow roles.
  const anchor=anchors[0],words=anchor.words||[];
  // Only isolated logo-sized symbols after an explicit role label, spatially separated
  // from the following name. Never strip digits, initials, masks or attached @ handles.
  if(words.length<3||!roleLabel[role].test(words[0].text)||!/^[@©®]$/.test(words[1].text))return e;
  const icon=words[1],first=words[2];
  const ih=icon.bbox.y1-icon.bbox.y0,fh=first.bbox.y1-first.bbox.y0;
  if(ih<fh*1.4||first.bbox.x0-icon.bbox.x1<fh*.3)return e;
  const visible=words.slice(2).map(w=>w.text).join(' ');
  if(!visible||/[*•]/.test(icon.text))return e;
  return {...e,rawName:visible,normalizedName:norm(visible),originalRawName:e.rawName,
    confidenceTier:'partial',warnings:[...(e.warnings||[]),'spatial_logo_token_excluded'],
    diagnosticProvenance:{source:'explicit_role_spatial_words',anchor,excludedToken:icon}};
}
function transactionDatetime(e,lines){
  const anchors=lines.filter(l=>/successful(?:transfer|payment)|transfercompleted|ทำรายการสำเร็จ/i.test(compactLabel(l.text))||
    referenceLabel(l.text)||(/^COMPLETED$/i.test(l.text)&&lines.some(p=>/TRANSFER/i.test(p.text)&&p.bbox.y0<l.bbox.y0&&l.bbox.y0-p.bbox.y0<150)));
  const candidates=[];
  for(const line of lines){
    if(/booking|reservation|screenshot|statusbar|วันจอง|วันที่จอง/i.test(compactLabel(line.text)))continue;
    const source=anchors.find(a=>a!==line&&line.bbox.y0>=a.bbox.y0&&
      line.bbox.y0-a.bbox.y1<=Math.max(120,(a.bbox.y1-a.bbox.y0)*2)&&
      Math.min(a.bbox.x1,line.bbox.x1)>Math.max(a.bbox.x0,line.bbox.x0));
    if(!source)continue;
    // Require a date-shaped row as well as transaction context; never take bare phone time.
    const dateShape=/(?:\d{1,2}\s+[A-Za-zก-๙.ุ]+\s+\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i;
    if(!dateShape.test(line.text.replace(/(?<=[ก-๙.])\s+(?=[ก-๙.])/g,'')))continue;
    // Reuse the existing date grammar; the real spatial label is retained as provenance.
    const date=temporalAndReference('Date '+line.text).datetime.date;
    const match=line.text.match(/(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[AP]M)?(?![\d:])/i);
    candidates.push({raw:line.text,date,time:match?.[0]??null,line,transactionAnchor:source,
      warnings:date===null?['year_or_date_uncertain']:[]});
  }
  const out=structuredClone(e),distinct=key=>[...new Set([e[key],...candidates.map(c=>c[key])].filter(v=>v!==null))];
  for(const key of ['date','time']){
    const values=distinct(key);
    out[key]=values.length===1?values[0]:null;
    if(values.length>1){out.confidenceTier='conflict';out.warnings=[...(out.warnings||[]),'datetime_conflict'];}
  }
  out.diagnosticCandidates=candidates;
  if(candidates.length&&out.confidenceTier!=='conflict')out.confidenceTier='partial';
  return out;
}
function spatialAmount(e,lines){
  if(e.value!==null||e.evidence?.recoveredAcrossFeeContext)return e;
  const candidates=[];
  const anchors=lines.filter(l=>amountLabel(l.text)&&!negative(l.text));
  for(const a of anchors){
    const first=a.words?.[0];
    if(!first)continue;
    const relevant=lines.filter(l=>l===a||(l.bbox.y0>=a.bbox.y0&&l.bbox.y0-a.bbox.y1<Math.max(100,a.bbox.y1-a.bbox.y0)));
    for(const l of relevant){
      if(negative(l.text)||referenceLabel(l.text))continue;
      if(lines.some(stop=>negative(stop.text)&&stop.bbox.y0>a.bbox.y0&&stop.bbox.y0<l.bbox.y0))continue;
      if(l!==a&&Math.abs(l.bbox.x0-first.bbox.x0)>(first.bbox.y1-first.bbox.y0)*2)continue;
      for(let i=0;i<(l.words||[]).length;i++){
        const word=l.words[i],satang=normalizeAmountToken(word.text);
        if(satang===null||satang<=0||/^\d{9,}$/.test(word.text))continue;
        // A numeric token must be independent, not embedded in QR garbage.
        if(word.confidence===null||word.confidence<80)continue;
        if(l===a&&i<1)continue;
        const preceding=l.words.slice(l===a?1:0,i);
        if(preceding.some(w=>!/^[:：฿]$/.test(w.text)))continue;
        candidates.push({value:satang/100,raw:word.text,bbox:word.bbox,confidence:word.confidence,
          source:'explicit_amount_label_spatial_token',anchor:a,line:l});
      }
    }
  }
  const distinct=[...new Set(candidates.map(c=>c.value))];
  if(distinct.length!==1)return {...e,diagnosticCandidates:candidates};
  return {...e,value:distinct[0],raw:candidates[0].raw,confidenceTier:'partial',
    warnings:[...(e.warnings||[]),'evidence_only_amount_recovery_not_payment_eligible'],
    diagnosticCandidates:candidates,paymentUseAllowed:false};
}
function exactReference(e,text,lines,qr){
  // Parse existing UTF8 lines, avoiding TSV-added spaces in Thai labels.
  // Header Ref ID is distinct from customer/biller Reference 1/2.
  const rawLines=String(text).split(/\r?\n/),found=[];
  for(const raw of rawLines){
    const match=raw.match(/^\s*(?:Ref\s+ID|Reference|รหัสอ้างอิง|เลขที่อ้างอิง|เลขที่รายการ)\s*[:：]?\s+([A-Za-z0-9-]{4,80})\s*$/i);
    if(match)found.push({raw:match[1],value:match[1],sourceLine:raw});
  }
  const q=qr?.isValidSlipQR?qr.transRef:null;
  const values=[...new Set(found.map(c=>c.value))];
  const conflict=e.confidenceTier==='conflict'||values.length>1||Boolean(q&&found.some(c=>c.value!==q));
  if(conflict)return {...e,value:null,source:null,confidenceTier:'conflict',
    warnings:[...new Set([...(e.warnings||[]),'reference_conflict'])],diagnosticCandidates:found};
  if(e.value!==null)return {...e,diagnosticCandidates:found};
  if(values.length!==1)return e;
  const value=values[0],ambiguous=/[O0I1lS5B8]/.test(value);
  return {...e,value,raw:value,source:'ocr',confidenceTier:ambiguous?'uncertain':'partial',
    warnings:ambiguous?['reference_character_ambiguity']:[],diagnosticCandidates:found};
}
export function diagnoseAndEnrichFields(text,baselineEvidence,qr=null){
  const out=structuredClone(baselineEvidence),lines=out.layout||[];
  out.sender=iconClean(out.sender,'sender',lines);
  out.receiver=iconClean(out.receiver,'receiver',lines);
  out.datetime=transactionDatetime(out.datetime,lines);
  out.amount=spatialAmount(out.amount,lines);
  out.reference=exactReference(out.reference,text,lines,qr);
  out.phase4b={evidenceOnly:true,paymentUseAllowed:false};
  return out;
}
