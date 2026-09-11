const express = require('express');
function creditRouter(service) {
  const router=express.Router();
  const action=fn=>async(req,res)=>{
    try { res.json(await fn(req)); }
    catch(err) { res.status(err.statusCode||500).json({error:err.statusCode?err.message:'Hour credit operation failed'}); }
  };
  router.get('/',action(req=>service.search(req.query.search)));
  router.get('/source/:reference',action(req=>service.source(req.params.reference)));
  router.get('/:creditId/voucher-qr',action(async req=>{
    const credit=await service.read(req.params.creditId);
    const data_url=await require('qrcode').toDataURL(credit.credit_id,{width:220,margin:2,errorCorrectionLevel:'M'});
    return {data_url};
  }));
  router.get('/:creditId/eligible-rooms',action(req=>service.eligibleRooms(req.params.creditId)));
  router.get('/:creditId/blocked-ranges',action(req=>service.blockedRanges(req.params.creditId,req.query.room_id,req.query.date)));
  router.get('/:creditId',action(req=>service.read(req.params.creditId)));
  router.post('/',action(req=>service.grant(req.body,req.user.id)));
  router.post('/:creditId/redeem',action(req=>service.redeem(req.params.creditId,req.body,req.user.id)));
  router.post('/:creditId/reversals',action(req=>service.reverse(req.params.creditId,req.body,req.user.id)));
  router.post('/:creditId/send-line',action(req=>service.sendLine(req.params.creditId,req.user?.id,req.body)));
  return router;
}
function creditMutationGuard(q,clearHistory=false) {
  return async(req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
    // Existing explicit PIN delivery is not a financial/edit operation.
    if(!clearHistory && req.method==='POST' && /^\/[^/]+\/send-pin\/?$/.test(req.path))return next();
    try {
      // Safe before migration installation; never silently bypass a DB error.
      if(!await q.get("SELECT name FROM sqlite_master WHERE type='table' AND name='room_hour_credits'"))return next();
      if(clearHistory){
        if(await q.get('SELECT credit_id FROM room_hour_credits LIMIT 1'))return res.status(409).json({error:'History contains hour credit; clearing is disabled'});
        return next();
      }
      const ref=decodeURIComponent(req.path.split('/')[1]||'');
      if(!ref)return next();
      const b=await q.get('SELECT id,billing_option,payment_method FROM bookings WHERE id=? OR receipt_number=? OR UPPER(receipt_number)=UPPER(?)',[ref,ref,ref]);
      if(!b)return next();
      const linked=await q.get('SELECT e.id FROM room_hour_credit_entries e JOIN booking_items i ON i.id=e.booking_item_id WHERE i.booking_id=? LIMIT 1',[b.id]);
      if(linked||b.billing_option==='hour_credit'||b.payment_method==='hour_credit')return res.status(409).json({error:'Use hour-credit reversal; generic booking mutations are disabled'});
      if(req.method==='DELETE'&&await q.get('SELECT credit_id FROM room_hour_credits WHERE source_booking_id=?',[b.id]))return res.status(409).json({error:'Source booking is linked to hour credit'});
      next();
    }catch(err){res.status(503).json({error:'Unable to verify hour-credit mutation safety'});}
  };
}
module.exports={creditRouter,creditMutationGuard};
