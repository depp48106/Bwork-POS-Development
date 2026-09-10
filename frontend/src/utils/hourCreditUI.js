export const creditMenuLabel='ชั่วโมงคงเหลือ';
export const durationLabel=minutes=>`${Math.floor(Math.abs(minutes)/60)} ชั่วโมง ${Math.abs(minutes)%60} นาที`;
export const statusLabel=status=>({available:'พร้อมใช้',partially_used:'ใช้บางส่วน',exhausted:'ใช้หมดแล้ว'}[status]||status);
export const hourCreditLabel=method=>method==='hour_credit'?'เครดิตชั่วโมง':null;
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
export const voucherNotice='ยอดในระบบเป็นข้อมูลอ้างอิงสูงสุด เอกสารนี้แสดงยอด ณ เวลาที่ออกเอกสาร';
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
