import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import { transform } from 'esbuild';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { createPaymentAcceptance, registerPaymentAcceptance, assertPaymentLink, bookingDeadline } from '../../src/server/paymentAcceptance';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8187') throw new Error('Tests only run against local emulator 127.0.0.1:8187');
const projectId = 'demo-senzu-payments';
const admin = initializeApp({ projectId }, 'payment-tests');
const db = getFirestore(admin);
let env: any, http: any, url: string;
const proof = { dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\nfixture payment proof\n%%EOF').toString('base64')}`, mimeType: 'application/pdf', fileName: 'proof.pdf' };
let n = 0;
async function booking(extra: any = {}) {
  const id = `bk_test_${++n}`;
  await db.collection('bookings').doc(id).set({ bookingCode: id, status: 'Menunggu Pembayaran', paymentStatus: 'UNPAID', customerAuthUid: 'alice', authUserId: 'alice', customerName: 'Test', servicePrice: 160000, homeServiceFee: 20000, paymentPolicyVersion: 2, paymentDeadline: null, createdAt: '2099-01-01T00:00:00Z', ...extra });
  return id;
}
async function post(path: string, body: any = {}, token?: string) {
  const r = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
}
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8187, rules: fs.readFileSync('firestore.rules','utf8') } });
  const app = express(); app.use(express.json({ limit: '5mb' }));
  const adminAuth = { verifyIdToken: async (token: string) => {
    if (!['alice','bob','css','manager','therapist','inactive'].includes(token)) throw new Error('invalid');
    return { uid: token };
  }};
  // Execute the actual payment endpoint registrations without importing server startup/production sync.
  const source = fs.readFileSync('server.ts','utf8');
  const start = source.indexOf('  registerPaymentAcceptance(app,');
  const endpoint = source.indexOf("  app.post('/api/payments/:paymentId/expire'");
  const end = source.indexOf('\n  });', endpoint) + '\n  });'.length;
  assert.ok(start > 0 && end > start);
  const js = (await transform(source.slice(start, end), { loader: 'ts', format: 'cjs', target: 'es2022' })).code;
  new Function('app','adminDb','adminAuth','registerPaymentAcceptance','assertPaymentLink','ensureServerAuthenticated','emitStructuredLog', js)(app, db, adminAuth, registerPaymentAcceptance, assertPaymentLink, async () => {}, () => {});
  for (const [uid, role, isActive] of [['css','css',true],['manager','manager',true],['therapist','therapist',true],['inactive','manager',false]] as const) await db.collection('staff_roles').doc(uid).set({ role, isActive, name: uid, staffId: uid });
  http = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => http.once('listening', resolve));
  url = `http://127.0.0.1:${http.address().port}`;
});
after(async () => { if(http) await new Promise<void>(resolve => http.close(resolve)); await env?.cleanup(); await deleteApp(admin); });

test('server creation time sets exactly 60 minutes; forged input and retries cannot reset it', async () => {
  const id = await booking();
  const first = await post('/api/payments/initialize', { bookingId:id, methodType:'bni', amount:1, paymentDeadline:'2099-01-01' }, 'alice');
  assert.equal(first.status,200);
  const snap = await db.collection('bookings').doc(id).get();
  assert.equal(Date.parse(first.body.payment.paymentDeadline), snap.createTime!.toMillis()+3600000);
  assert.equal(first.body.payment.amount,180000);
  const results = await Promise.all([post('/api/payments/initialize',{bookingId:id,methodType:'mandiri'},'alice'),post('/api/payments/initialize',{bookingId:id,methodType:'bri'},'alice')]);
  for (const r of results) { assert.equal(r.status,200); assert.equal(r.body.payment.id,first.body.payment.id); assert.equal(r.body.payment.paymentDeadline,first.body.payment.paymentDeadline); }
  assert.equal((await db.collection('payments').where('bookingId','==',id).get()).size,1);
});
test('missing/invalid tokens and foreign customers cannot initialize or submit proof', async () => {
  const id = await booking();
  for (const token of [undefined,'invalid','bob']) {
    const r = await post('/api/payments/initialize',{bookingId:id,methodType:'bni'},token);
    assert.equal(r.status,token==='bob'?403:401);
  }
});
test('proof at deadline - 1ms accepted, remains review after deadline, retry idempotent', async () => {
  const id = await booking(); const init = await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  const deadline = Date.parse(init.payment.paymentDeadline!);
  const accepted = await createPaymentAcceptance(db,()=>deadline-1).acceptProof('alice',init.payment.id,{bookingId:id,...proof});
  assert.equal((accepted.payment as any).status,'pending_manual_verification');
  const retry = await createPaymentAcceptance(db,()=>deadline+100).acceptProof('alice',init.payment.id,{bookingId:id,...proof});
  assert.equal(retry.isIdempotent,true);
  const expiry = await post(`/api/payments/${init.payment.id}/expire`,{bookingId:id},'alice'); assert.equal(expiry.body.expired,false);
  assert.equal((await db.collection('payment_status_history').where('paymentId','==',init.payment.id).where('eventType','==','payment_proof_uploaded').get()).size,1);
});
test('proof at/after deadline denied regardless of supplied browser timestamp', async () => {
  for (const offset of [0,1,3600000]) {
    const id = await booking(); const {payment} = await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
    await assert.rejects(createPaymentAcceptance(db,()=>Date.parse(payment.paymentDeadline!)+offset).acceptProof('alice',payment.id,{bookingId:id,...proof,createdAt:'2000-01-01'}), (e:any)=>e.status===409);
    assert.equal((await db.collection('payments').doc(payment.id).get()).data()!.status,'unpaid');
  }
});
test('legacy without deadline stays legacy and expiry does not cancel booking', async () => {
  const id = await booking({paymentPolicyVersion: null, paymentDeadline:null});
  const {payment} = await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'qris'});
  assert.equal(payment.paymentDeadline,null);
  assert.equal((await post(`/api/payments/${payment.id}/expire`,{bookingId:id},'alice')).body.expired,false);
  await db.collection('payments').doc(payment.id).update({paymentDeadline:'2000-01-01T00:00:00.000Z'});
  assert.equal((await post(`/api/payments/${payment.id}/expire`,{bookingId:id},'alice')).body.expired,true);
  assert.equal((await db.collection('bookings').doc(id).get()).data()!.status,'Menunggu Pembayaran');
  await assert.rejects(createPaymentAcceptance(db).acceptProof('alice',payment.id,{bookingId:id,...proof}));
});
test('cross-document ownership conflict and mismatched booking IDs denied before idempotency', async () => {
  const id = await booking(); const {payment} = await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  await db.collection('payments').doc(payment.id).update({customerAuthUid:'bob',authUserId:'bob'});
  for(const uid of ['alice','bob']) assert.equal((await post(`/api/payments/${payment.id}/expire`,{bookingId:id},uid)).status,403);
  await db.collection('payments').doc(payment.id).update({customerAuthUid:'alice',authUserId:'alice',status:'paid'});
  assert.equal((await post(`/api/payments/${payment.id}/verify`,{bookingId:'wrong'},'css')).status,400);
});
test('actual verify/reject HTTP guards and transaction idempotency', async () => {
  const id = await booking(); const {payment} = await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  for (const endpoint of ['verify','reject','expire']) {
    for(const uid of [undefined,'invalid']) assert.equal((await post(`/api/payments/${payment.id}/${endpoint}`,{bookingId:id,reason:'test'},uid)).status,401);
  }
  for(const uid of ['bob','therapist','inactive']) assert.equal((await post(`/api/payments/${payment.id}/verify`,{bookingId:id},uid)).status,403);
  const concurrent = await Promise.all([post(`/api/payments/${payment.id}/verify`,{bookingId:id},'css'),post(`/api/payments/${payment.id}/reject`,{bookingId:id,reason:'test'},'manager')]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,400]);
  const state=(await db.collection('payments').doc(payment.id).get()).data()!.status;
  const endpoint=state==='paid'?'verify':'reject';
  assert.equal((await post(`/api/payments/${payment.id}/${endpoint}`,{bookingId:id,reason:'test'},'css')).body.isIdempotent,true);
});
test('client rules deny forged payment creation/proof/deadline and foreign reads; own reads/authorized lookup work', async () => {
  const id = await booking(); const {payment} = await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  const alice=env.authenticatedContext('alice').firestore(), bob=env.authenticatedContext('bob').firestore(), guest=env.unauthenticatedContext().firestore();
  await assertSucceeds(alice.doc(`payments/${payment.id}`).get());
  await assertFails(bob.doc(`payments/${payment.id}`).get());
  await assertFails(guest.doc(`payments/${payment.id}`).get());
  await assertFails(alice.doc('payments/forged').set({...payment,id:'forged',amount:1}));
  await assertFails(alice.doc(`payments/${payment.id}`).update({status:'pending_manual_verification',paymentProofUrl:'fake'}));
  await assertFails(alice.doc(`bookings/${id}`).update({paymentDeadline:'2099-01-01'}));
  await assertFails(alice.collection('payments').where('bookingId','==',id).get());
  assert.equal((await post('/api/payments/lookup',{bookingId:id},'alice')).body.payment.id,payment.id);
  assert.equal((await post('/api/payments/lookup',{bookingId:id},'bob')).status,403);
});
test('new booking rules require unforgeable clock policy; legacy cannot opt out via update', async () => {
  const alice=env.authenticatedContext('alice').firestore();
  const payload={status:'Menunggu Pembayaran',paymentStatus:'UNPAID',customerAuthUid:'alice',authUserId:'alice',paymentPolicyVersion:2,paymentDeadline:null};
  await assertSucceeds(alice.doc('bookings/client-valid').set(payload));
  await assertFails(alice.doc('bookings/client-forged').set({...payload,paymentDeadline:'2099-01-01'}));
  await assertFails(alice.doc('bookings/client-no-policy').set({...payload,paymentPolicyVersion:1}));
  await assertFails(alice.doc('bookings/client-valid').update({paymentPolicyVersion:1}));
});
test('valid proof HTTP path, file validation, and concurrent expiry preserve one final state', async () => {
  const id=await booking(); const {payment}=await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  assert.equal((await post(`/api/payments/${payment.id}/proof`,{bookingId:id,...proof},'bob')).status,403);
  assert.equal((await post(`/api/payments/${payment.id}/proof`,{bookingId:id,...proof,dataUrl:'data:application/pdf;base64,YmFk'},'alice')).status,400);
  assert.equal((await post(`/api/payments/${payment.id}/proof`,{bookingId:'wrong',...proof},'alice')).status,400);
  const results=await Promise.all([post(`/api/payments/${payment.id}/proof`,{bookingId:id,...proof},'alice'),post(`/api/payments/${payment.id}/expire`,{bookingId:id},'alice')]);
  assert.equal(results[0].status,200); assert.equal(results[1].body.expired,false);
  assert.equal((await db.collection('payments').doc(payment.id).get()).data()!.status,'pending_manual_verification');
  // Advance the fixture's deadline after acceptance; expiry still must preserve the accepted proof.
  await db.collection('payments').doc(payment.id).update({paymentDeadline:'2000-01-01T00:00:00Z'});
  assert.equal((await post(`/api/payments/${payment.id}/expire`,{bookingId:id},'alice')).body.expired,false);
});
test('rules conflict denial and authorized staff reads/corrections remain available', async () => {
  const id=await booking(); const {payment}=await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  const alice=env.authenticatedContext('alice',{email:'alice@example.test'}).firestore();
  const css=env.authenticatedContext('css',{email:'css@example.test'}).firestore();
  await assertSucceeds(css.collection('payments').where('status','==','unpaid').get());
  await assertSucceeds(css.doc(`payments/${payment.id}`).update({correctionReason:'test fixture',updatedAt:new Date().toISOString()}));
  await assertFails(css.doc(`payments/${payment.id}`).update({paymentDeadline:'2099-01-01'}));
  await db.collection('payments').doc(payment.id).update({authUserId:'bob'});
  await assertFails(alice.doc(`payments/${payment.id}`).get());
  await assertFails(alice.collection('payments').where('bookingId','==',id).get());
});
test('legacy owned payment remains accessible and new unowned bookings cannot be claimed', async () => {
  const id=await booking({paymentPolicyVersion:null,paymentDeadline:null});
  await db.collection('payments').doc('legacy-owned').set({id:'legacy-owned',bookingId:id,bookingCode:id,amount:180000,status:'unpaid',createdAt:'2025-01-01T00:00:00Z'});
  const result=await createPaymentAcceptance(db).initialize('alice',{bookingId:id,methodType:'bni'});
  assert.equal(result.payment.id,'legacy-owned'); assert.equal(result.payment.paymentDeadline,null);
  assert.equal((await post('/api/payments/lookup',{bookingId:id},'alice')).body.payment.id,'legacy-owned');
  await assertSucceeds(env.authenticatedContext('alice').firestore().doc('payments/legacy-owned').get());
  const unowned=await booking({customerAuthUid:null,authUserId:null,customerId:'alice'});
  await assert.rejects(createPaymentAcceptance(db).initialize('alice',{bookingId:unowned,methodType:'bni'}),(e:any)=>e.status===403);
});
