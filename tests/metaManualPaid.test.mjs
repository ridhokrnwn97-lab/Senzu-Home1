// Actual lookup route and eligibility logic; all records and identities are local fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import express from 'express';
import vm from 'node:vm';
const bundle=await build({entryPoints:['src/server/paymentAcceptance.ts','src/server/metaManualPaid.ts'],
  bundle:true,write:false,format:'cjs',platform:'node',outdir:'fixture-output'});
function exportsFor(name){const module={exports:{}};vm.runInNewContext(bundle.outputFiles.find(f=>f.path.endsWith(name+'.js')).text,{module,exports:module.exports,Date,Buffer,console,require:()=>({createHash(){throw new Error('Unexpected hash/write');}})});return module.exports;}
const {registerPaymentAcceptance}=exportsFor('paymentAcceptance');
const {manualPaidMetaReceipt}=exportsFor('metaManualPaid');
function fixture(){
  const booking={id:'booking_fixture',customerAuthUid:'alice',authUserId:'alice',paymentMethod:'Transfer BNI',activePaymentId:'PAY-booking_fixture',
    paymentStatus:'PAID',totalAmount:200000,status:'Confirmed'};
  const payment={id:'PAY-booking_fixture',bookingId:booking.id,customerAuthUid:'alice',authUserId:'alice',paymentType:'manual',provider:'manual_senzu',
    bankCode:'BNI',currency:'IDR',amount:200000,status:'paid',paymentProofUrl:'fixture-proof',verifiedBy:'staff_fixture',
    verifiedByAuthUid:'css',verifiedByRole:'css',createdAt:'2026-10-31T01:00:00.000Z',paidAt:'2026-10-31T02:00:00.000Z',verifiedAt:'2026-10-31T02:00:00.000Z'};
  return {booking,payment};
}
test('all official manual channels qualify only after staff verification; receipt contains no customer or proof data',()=>{
  for(const bankCode of ['BNI','MANDIRI','BRI','QRIS']){
    const{booking,payment}=fixture();payment.bankCode=bankCode;payment.provider=bankCode==='QRIS'?'bni_merchant':'manual_senzu';
    const receipt=manualPaidMetaReceipt(booking,payment,'alice',false);
    assert.ok(receipt);assert.deepEqual(Object.keys(receipt).sort(),['amount','bookingId','currency','paymentId','schemaVersion','source','verifiedAt']);
  }
});
test('pending, rejected, corrected, refunded, Test, duplicate, wrong amount and missing server verifier cannot qualify',()=>{
  const patches=[{status:'pending_manual_verification'},{status:'unpaid'},{status:'payment_rejected'},{status:'expired'},
    {verifiedByAuthUid:undefined},{verifiedByRole:undefined},{verifiedByRole:'customer'},{verifiedAt:undefined},{verifiedAt:'bad'},
    {verifiedAt:'2999-01-01T00:00:00Z'},{paidAt:'2999-01-01T00:00:00Z'},{createdAt:'2999-01-01T00:00:00Z'},
    {correctedAt:'2026-11-01'},{reconciliationRequired:true},{possibleDuplicatePayment:true},{refundedAt:'2026-11-01'},
    {refundAmount:1},{refundStatus:'pending'},{paymentProofUrl:undefined},{amount:0},{amount:1},{amount:200000.5},
    {provider:'xendit'},{paymentType:'gateway'},{gatewayEnvironment:'test'},{gatewaySessionId:'ps-fixture'},
    {providerTransactionId:'fixture'},{currency:'USD'},{isTest:true},{environment:'test'},{bankCode:'unknown'}];
  for(const patch of patches){const{booking,payment}=fixture();assert.equal(manualPaidMetaReceipt(booking,{...payment,...patch},'alice',false),null,JSON.stringify(patch));}
  for(const patch of [{paymentStatus:'unpaid'},{activePaymentId:'foreign'},{totalAmount:1},{gatewayReviewRequired:true},
    {paymentMethod:'Xendit'},{gatewayEnvironment:'live'},{isTest:true},{status:'Cancelled'},{status:'Dibatalkan'},{status:'refunded'}]){
    const{booking,payment}=fixture();assert.equal(manualPaidMetaReceipt({...booking,...patch},payment,'alice',false),null,JSON.stringify(patch));
  }
});
test('staff and foreign/conflicting owners cannot qualify, including a staff member owning the booking',()=>{
  const{booking,payment}=fixture();
  assert.equal(manualPaidMetaReceipt(booking,payment,'alice',true),null);
  assert.equal(manualPaidMetaReceipt(booking,payment,'bob',false),null);
  assert.equal(manualPaidMetaReceipt({...booking,authUserId:'bob'},payment,'alice',false),null);
  assert.equal(manualPaidMetaReceipt(booking,{...payment,customerAuthUid:'bob'},'alice',false),null);
  assert.equal(manualPaidMetaReceipt(booking,{...payment,bookingId:'foreign'},'alice',false),null);
});
test('actual authenticated lookup returns receipt only for own verified payment and performs no writes',async()=>{
  const f=fixture(),roles=new Map([['manager',{isActive:true,role:'manager'}],['alice',{isActive:false,role:'therapist'}]]);
  let staffOwner=false,duplicate=false,reads=0;
  const snapshot=(id,data)=>({id,exists:!!data,data:()=>data});
  const db={collection:name=>({doc:id=>({name,id}),where:(_field,_operator,id)=>({name,query:id})}),
    runTransaction:async action=>action({get:async ref=>{
      reads++;if(ref.name==='bookings')return snapshot(ref.id,ref.id===f.booking.id?f.booking:undefined);
      if(ref.name==='staff_roles')return snapshot(ref.id,ref.id==='alice'&&!staffOwner?undefined:roles.get(ref.id));
      if(ref.name==='payments')return{docs:[snapshot(f.payment.id,f.payment),...(duplicate?[snapshot('second_paid',{...f.payment,id:'second_paid'})]:[])]};
      throw new Error('Unexpected read');
    }})};
  const app=express();app.use(express.json());registerPaymentAcceptance(app,db,async token=>{
    if(!['alice','bob','manager'].includes(token))throw new Error('invalid');return{uid:token};
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const post=async token=>{
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/payments/lookup`,{method:'POST',
      headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({bookingId:f.booking.id,manualPaidLead:{forged:true}})});
    return{status:r.status,cache:r.headers.get('cache-control'),data:await r.json()};
  };
  try{
    const paid=await post('alice');assert.equal(paid.status,200);assert.equal(paid.cache,'no-store');
    assert.equal(paid.data.manualPaidLead.source,'staff_verified_manual');assert.equal(paid.data.payment.id,f.payment.id);
    assert.equal((await post('bob')).status,403);assert.equal((await post()).status,401);assert.equal((await post('invalid')).status,401);
    assert.equal((await post('manager')).data.manualPaidLead,null);
    staffOwner=true;assert.equal((await post('alice')).data.manualPaidLead,null);staffOwner=false;
    duplicate=true;assert.equal((await post('alice')).data.manualPaidLead,null);duplicate=false;
    f.payment.status='pending_manual_verification';assert.equal((await post('alice')).data.manualPaidLead,null);
    assert.ok(reads>0);
  }finally{await new Promise(r=>server.close(r));}
});
