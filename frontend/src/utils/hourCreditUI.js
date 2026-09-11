import {toPng} from 'html-to-image';

export const creditMenuLabel='จัดการเครดิตชั่วโมง';
export const creditNavigationLabel='เครดิตชั่วโมง';
export const creditSubtitle='จัดการเครดิตชั่วโมงคงเหลือของลูกค้า ออกใบยืนยัน ใช้เครดิต และส่ง LINE';
export const creditFilterChips=[
  {key:'all',label:'ทั้งหมด'},
  {key:'remaining',label:'คงเหลือ'},
  {key:'partially_used',label:'ใช้บางส่วน'},
  {key:'exhausted',label:'ใช้หมด'}
];
export function filterCreditRows(rows,filterKey='all'){
  if(!Array.isArray(rows))return [];
  if(filterKey==='remaining')return rows.filter(r=>(r.remaining_minutes||0)>0);
  if(filterKey==='partially_used')return rows.filter(r=>r.status==='partially_used');
  if(filterKey==='exhausted')return rows.filter(r=>r.status==='exhausted'||(r.remaining_minutes||0)<=0);
  return rows;
}
export const durationLabel=minutes=>`${Math.floor(Math.abs(minutes)/60)} ชั่วโมง ${Math.abs(minutes)%60} นาที`;
export const statusLabel=status=>({available:'พร้อมใช้',partially_used:'ใช้บางส่วน',exhausted:'ใช้หมดแล้ว'}[status]||status);
export const hourCreditLabel=method=>method==='hour_credit'?'เครดิตชั่วโมง':null;
const wallParts=value=>{
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  return match?{date:`${match[3]}/${match[2]}/${match[1]}`,time:match[4]?`${match[4]}:${match[5]}`:''}:null;
};
export const formatCreditDate=value=>wallParts(value)?.date||'-';
export const formatCreditTime=value=>wallParts(value)?.time||'-';
export const formatCreditDateTime=value=>{
  const parts=wallParts(value);
  return parts?`${parts.date}${parts.time?' '+parts.time:''}`:'-';
};
export function formatCreditTimeRange(start,end){
  const a=wallParts(start),b=wallParts(end);
  if(!a||!b)return '-';
  return a.date===b.date?`${a.date} ${a.time}–${b.time}`:`${a.date} ${a.time}–${b.date} ${b.time}`;
}
export function eligibleHourCreditRooms(rooms,sourceRate){
  return (Array.isArray(rooms)?rooms:[]).filter(room=>room.status==='active'&&Number(room.has_hourly??1)===1&&Number(room.hourly_rate)===Number(sourceRate));
}
export function minutesValue(hours,minutes){
  const h=Number(hours),m=Number(minutes);
  if(!Number.isInteger(h)||h<0||!Number.isInteger(m)||m<0||m>59||h*60+m<=0)throw Error('กรุณาระบุชั่วโมง/นาทีให้ถูกต้อง');
  return h*60+m;
}
export function bookingTimes(date,time,minutes){
  const start=new Date(`${date}T${time}:00+07:00`);
  if(!Number.isFinite(start.getTime()))throw Error('กรุณาระบุวันและเวลา');
  const wall=ms=>new Date(ms+7*3600000).toISOString().slice(0,16);
  return {start_time:wall(start.getTime()),end_time:wall(start.getTime()+minutes*60000)};
}
export function canReverse(entry,history,now=Date.now()){
  return entry.entry_type==='redeem'&&entry.payment_status==='paid'&&
    !history.some(e=>e.reverses_entry_id===entry.id)&&
    Date.parse(String(entry.start_time).replace(' ','T')+'+07:00')>now;
}
export const redeemMessage=(minutes,balance)=>minutes>balance?'เครดิตไม่เพียงพอ':`ใช้เครดิต ${durationLabel(minutes)}\nคงเหลือหลังใช้ ${durationLabel(balance-minutes)}\nยอดชำระ 0 บาท`;
export const reversalMessage='การจองจะถูกยกเลิก และคืนเวลาที่ใช้กลับเข้าบัญชีเครดิต ระบบไม่อนุญาตให้คืนซ้ำ';
export const voucherNotice='ยอดในระบบเป็นข้อมูลอ้างอิงสูงสุด เอกสารนี้แสดงยอด ณ เวลาที่ออก';
export function voucherImageFilename(creditId){
  const safeId=String(creditId||'voucher').trim().replace(/[^a-zA-Z0-9_-]/g,'-');
  return `BWORK-Hour-Credit-${safeId}.png`;
}
export async function exportVoucherAsPng(element,filename,toPngFn=toPng){
  if(!element)throw Error('ไม่พบข้อมูลเอกสารสำหรับการบันทึกรูป');
  const dataUrl=await toPngFn(element,{
    backgroundColor:'#ffffff',
    pixelRatio:2,
    cacheBust:true,
    style:{
      margin:'0',
      transform:'none'
    },
    filter:node=>!(node.nodeType===1&&node.classList&&node.classList.contains('credit-no-print'))
  });
  if(typeof document!=='undefined'&&document.createElement){
    const link=document.createElement('a');
    link.download=filename;
    link.href=dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
  return dataUrl;
}
export async function creditRequest(path='',options={}){
  const response=await fetch('/api/hour-credits'+path,options);
  let body;try{body=await response.json();}catch{throw Error('ไม่สามารถอ่านคำตอบจากระบบเครดิต กรุณาลองใหม่');}
  if(!response.ok)throw Object.assign(new Error(body.error||'ทำรายการไม่สำเร็จ'),{status:response.status});
  return body;
}
export async function sendCreditLine(creditId){
  return creditRequest('/'+encodeURIComponent(creditId)+'/send-line',{method:'POST'});
}
// Keep an operation key stable across network failures; never render or log it.
export function createCreditSubmitter(api=creditRequest,keyFactory=()=>crypto.randomUUID()){
  let pending=null;
  return async(path,payload)=>{
    const signature=JSON.stringify([path,payload]);
    if(pending&&pending.signature!==signature)throw Error('รายการก่อนหน้ายังไม่ยืนยันผล กรุณาส่งรายการเดิมซ้ำเพื่อตรวจสอบผลก่อนเปลี่ยนข้อมูล');
    if(!pending)pending={signature,key:keyFactory()};
    try{
      const result=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,idempotency_key:pending.key})});
      pending=null;return result;
    }catch(error){if([400,401,403,404,409].includes(error.status))pending=null;throw error;}
  };
}
