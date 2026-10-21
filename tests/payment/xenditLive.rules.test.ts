// Actual Firestore rules + Admin transaction integration, with a local Xendit fixture.
// No production database, customer or payment API is contacted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { createXenditLive } from '../../src/server/xenditLive';
import { liveQuoteSeal } from '../../src/server/xenditLiveQuote';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8187') throw new Error('Local emulator only');
const projectId='demo-senzu-live-rules', admin=initializeApp({projectId}, 'live-rules-tests'), db=getFirestore(admin);
let env:any, next=0;
const client=(uid?:string)=>uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const liveEnv={XENDIT_LIVE_SECRET_KEY:'xnd_production_fixture_not_a_key',XENDIT_LIVE_WEBHOOK_TOKEN:'fixture_callback',
  XENDIT_LIVE_BUSINESS_ID:'fixture_merchant',XENDIT_LIVE_ENABLED:'true',VITE_GOOGLE_MAPS_API_KEY:'fixture_not_a_key'};
const request=(bookingId:string)=>({body:{bookingId},headers:{authorization:'Bearer alice'},rawHeaders:['Authorization','Bearer alice'],ip:'127.0.0.1'} as any);
async function seed(extra:any={}) {
  const id=`bk_live_${++next}`, b:any={id,bookingCode:`SH-FIX-${next}`,customerId:'alice',customerAuthUid:'alice',authUserId:'alice',
    customerName:'Fixture',customerWhatsApp:'080000000000',serviceId:'fixture_service',serviceName:'Fixture Service',serviceDuration:60,
    servicePrice:160000,homeServiceFee:30000,discountAmount:0,totalAmount:190000,paymentMethod:'Xendit',gatewayProvider:'xendit',
    gatewayEnvironment:'live',gatewayReceiptId:`receipt_${id}`,status:'Menunggu Pembayaran',paymentStatus:'UNPAID',
    paymentPolicyVersion:2,paymentDeadline:null,therapistId:'therapist',scheduleDate:'2026-10-22',scheduleTime:'12:00',
    customerGender:'Laki-laki',latitude:-2.97,longitude:104.74,distanceKm:12,distanceMeters:12000,...extra};
  b.gatewayQuoteHash=liveQuoteSeal(b);
  await db.collection('bookings').doc(id).set(b);
  await db.collection('voucher_checkout_receipts').doc(b.gatewayReceiptId).set({schemaVersion:2,bookingId:id,customerAuthUid:'alice',
    paymentMethod:'Xendit',gatewayProvider:'xendit',gatewayEnvironment:'live',gatewayQuoteHash:b.gatewayQuoteHash,totalAmount:b.totalAmount});
  return b;
}
before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8187,rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.clearFirestore();
  await db.collection('services').doc('fixture_service').set({price:160000,isActive:true});
  for (const [uid,role] of [['manager','manager'],['css','css'],['therapist','therapist']]) {
    await db.collection('staff_roles').doc(uid).set({role,isActive:true,staffId:uid,therapistId:'therapist'});
    await db.collection('staff_users').doc(uid).set({role,isActive:true,authUserId:uid});
  }
});
after(async()=>{await env?.cleanup();await deleteApp(admin);});

test('rules reject client-created Live bookings and forged gateway provenance for every role',async()=>{
  for (const uid of [undefined,'alice','css','manager','therapist']) {
    const b=await seed();
    await assertFails(client(uid).doc(`bookings/forged_${b.id}_${uid||'guest'}`).set(b));
    await assertFails(client(uid).doc(`bookings/forged_manual_${b.id}_${uid||'guest'}`).set({...b,paymentMethod:'Transfer BNI'}));
  }
});
test('rules keep sealed Live terms, financial state, identity and method immutable for customers and staff',async()=>{
  const b=await seed();
  const mutations=[{servicePrice:1},{totalAmount:1},{discountAmount:189999},{paymentStatus:'PAID'},
    {paymentMethod:'Transfer BNI'},{customerAuthUid:'bob'},{authUserId:'bob'},{gatewayProvider:'manual'},
    {gatewayEnvironment:'test'},{gatewayQuoteHash:'forged'},{gatewayReviewRequired:false},{activePaymentId:'forged'},
    {scheduleTime:'22:00'},{latitude:0},{address:'changed'},{id:'changed'},{paymentDeadline:'2099-01-01'}];
  for (const uid of ['alice','css','manager','therapist']) for(const patch of mutations) {
    await assertFails(client(uid).doc(`bookings/${b.id}`).update(patch));
  }
});
test('rules block confirmation, assignment and departure before canonical full payment',async()=>{
  const b=await seed();
  for (const uid of ['manager','css','therapist']) for(const status of ['Confirmed','Therapist Assigned','Accepted','On The Way','Arrived','Treatment','Completed']) {
    await assertFails(client(uid).doc(`bookings/${b.id}`).update({status}));
  }
  await assertSucceeds(client('alice').doc(`bookings/${b.id}`).update({customerNotes:'Fixture note'}));
  await assertSucceeds(client('alice').doc(`bookings/${b.id}`).update({status:'Cancelled',cancellationReason:'Fixture'}));
});
test('actual Admin Live checkout + webhook settles a single real-shaped booking and unlocks paid therapist progress',async()=>{
  const b=await seed();let remote:any, creates=0;
  const service=createXenditLive({db,env:liveEnv,verify:async()=>({uid:'alice'}),authorizeManager:async()=>{},
    fetch:async(url,options)=>{
      assert.equal(new URL(String(url)).origin,'https://api.xendit.co');
      if(options?.method==='POST') {creates++; remote={...JSON.parse(String(options.body)),payment_session_id:`ps-${String(next).padStart(24,'0')}`,
        business_id:'fixture_merchant',status:'ACTIVE',payment_link_url:'https://xen.to/fixture',payment_id:null};}
      return Response.json(remote);
    }});
  const both=await Promise.all([service.checkout(request(b.id)),service.checkout(request(b.id))]);
  assert.equal(creates,1);assert.equal(both.filter(Boolean).length,2);
  await assertFails(client('therapist').doc(`bookings/${b.id}`).update({status:'On The Way'}));
  remote={...remote,status:'COMPLETED',payment_id:'py-123456789012345678901234'};
  const event:any={body:{event:'payment_session.completed',data:{id:remote.payment_session_id,reference_id:remote.reference_id}},
    headers:{'x-callback-token':'fixture_callback'},rawHeaders:['x-callback-token','fixture_callback'],ip:'127.0.0.1'};
  await service.webhook(event);await service.webhook(event);
  const persisted=(await db.collection('bookings').doc(b.id).get()).data()!;
  assert.equal(persisted.paymentStatus,'PAID');assert.equal(persisted.status,'Confirmed');
  assert.equal((await db.collection('payments').where('bookingId','==',b.id).get()).size,1);
  assert.equal((await db.collection('booking_status_history').where('bookingId','==',b.id).get()).size,1);
  await assertSucceeds(client('css').doc(`bookings/${b.id}`).update({status:'Therapist Assigned'}));
  await assertSucceeds(client('therapist').doc(`bookings/${b.id}`).update({status:'Accepted'}));
  await assertSucceeds(client('therapist').doc(`bookings/${b.id}`).update({status:'On The Way',onTheWayAt:new Date().toISOString()}));
  // Even a staff client cannot forge or override the financial documents after settlement.
  await assertFails(client('manager').doc(`payments/PAY-${b.id}`).update({status:'refunded'}));
  await assertSucceeds(client('manager').doc(`bookings/${b.id}`).update({status:'Cancelled'}));
  await assertFails(client('manager').doc(`bookings/${b.id}`).update({status:'Menunggu Pembayaran'}));
  await assertFails(client('therapist').doc(`bookings/${b.id}`).update({status:'On The Way'}));
});
test('rules reject claimed PAID without a matching server payment and block reviewed settlements',async()=>{
  for(const extra of [{paymentStatus:'PAID'}, {paymentStatus:'PAID',activePaymentId:'fixture_paid',gatewayReviewRequired:true},
    {paymentStatus:'PAID',activePaymentId:'fixture_paid'}]) {
    const b=await seed(extra);
    await db.collection('payments').doc('fixture_paid').set({provider:'xendit',gatewayEnvironment:'live',status:'paid',amount:190000,
      bookingId:'another_booking',customerAuthUid:'bob',authUserId:'bob'});
    for(const uid of ['manager','css','therapist']) await assertFails(client(uid).doc(`bookings/${b.id}`).update({status:'On The Way'}));
  }
});
test('gateway session, receipt and webhook collections remain private to server',async()=>{
  for(const collection of ['xendit_live_sessions','xendit_live_webhook_events','voucher_checkout_receipts']) {
    await db.collection(collection).doc('fixture_private').set({bookingId:'fixture'});
    for(const uid of [undefined,'alice','manager']) {
      await assertFails(client(uid).doc(`${collection}/fixture_private`).get());
      await assertFails(client(uid).doc(`${collection}/fixture_private`).set({bookingId:'forged'}));
    }
  }
});
test('existing manual booking creation and operational updates retain their prior access',async()=>{
  const b={status:'Menunggu Pembayaran',paymentStatus:'UNPAID',paymentMethod:'Transfer BNI',customerAuthUid:'alice',authUserId:'alice',paymentPolicyVersion:2,paymentDeadline:null,
    serviceId:'fixture_service',servicePrice:160000,homeServiceFee:20000,totalAmount:180000};
  await assertSucceeds(client('alice').doc('bookings/manual_fixture').set(b));
  await assertSucceeds(client('css').doc('bookings/manual_fixture').update({status:'Confirmed'}));
  await assertFails(client('css').doc('bookings/manual_fixture').update({paymentMethod:'Xendit'}));
  await assertFails(client('manager').doc('bookings/manual_fixture').update({gatewayProvider:'xendit',gatewayEnvironment:'live'}));
});
