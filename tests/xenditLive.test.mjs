import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import express from 'express';
import { createXenditLive, registerXenditLive } from '../src/server/xenditLive.ts';
import { liveQuoteSeal, quoteLiveDrivingDistance, validateLiveSchedule } from '../src/server/xenditLiveQuote.ts';
import { safeLiveCheckoutUrl } from '../src/lib/xenditLiveContracts.ts';
import { createPaymentAcceptance, assertManualPayment } from '../src/server/paymentAcceptance.ts';
import { calculateHomeServiceFee, SENZU_BASE_LOCATION } from '../src/lib/distanceFeeService.ts';
import { DEFAULT_LOYALTY_SETTINGS, DEFAULT_MEMBERSHIP_TIERS } from '../src/types/loyalty.ts';

const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const functions = new Map(); let managerSource, checkoutSource;
function visit(n) {
  if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n.getText(ast));
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'registerXenditLive') {
    managerSource = n.arguments[1].properties.find(p => p.name?.getText(ast) === 'authorizeManager').initializer.getText(ast);
  }
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'app.post' && n.arguments[0]?.text === '/api/vouchers/checkout') checkoutSource = n.arguments[1].getText(ast);
  ts.forEachChild(n, visit);
}
visit(ast);
assert.ok(managerSource && checkoutSource);
const compile = code => transformSync(code, { loader: 'ts', target: 'es2022', format: 'cjs' }).code;
const managerFactory = new Function('adminDb', compile(`${['isValidStage7dDocId', 'sanitizeStage7dText', 'validateStage7dActiveManagerIdentity'].map(k => functions.get(k)).join('\n')}\nreturn ${managerSource};`));
const checkoutFactory = new Function('adminDb', 'adminAuth', 'verifyCustomerFirebaseIdToken', 'calculateHomeServiceFee', 'SENZU_BASE_LOCATION',
  'DEFAULT_LOYALTY_SETTINGS', 'DEFAULT_MEMBERSHIP_TIERS', 'liveXendit', 'liveQuoteSeal', 'validateLiveSchedule', 'createHash', 'emitStructuredLog',
  compile(`${functions.get('normalizeIndonesianPhoneServer')}\nreturn ${checkoutSource};`));

class MemoryDB {
  data = new Map(); writes = []; queue = Promise.resolve(); created = new Map(); retryOnce = false;
  constructor(clock) { this.clock = clock; }
  collection(name) {
    const make = (filters = [], limit = Infinity) => ({ name, filters, take: limit,
      where: (key, op, value) => make([...filters, [key, op, value]], limit), limit: n => make(filters, n),
      doc: (id = `auto_${this.data.size}`) => ({ name, id, path: `${name}/${id}`, get: () => this.read({ name, id }) }),
    }); return make();
  }
  snap(name, id, value) { return { id, exists: value !== undefined, data: () => structuredClone(value),
    createTime: { toMillis: () => this.created.get(`${name}/${id}`) ?? this.clock() }, ref: this.collection(name).doc(id) }; }
  async read(ref) {
    if (ref.id) return this.snap(ref.name, ref.id, this.data.get(`${ref.name}/${ref.id}`));
    const docs = [...this.data.entries()].filter(([p, v]) => p.startsWith(`${ref.name}/`) &&
      ref.filters.every(([k, op, expected]) => op === '==' ? v[k] === expected : op === 'in' ? expected.includes(v[k]) : false))
      .slice(0, ref.take).map(([p, v]) => this.snap(ref.name, p.slice(ref.name.length + 1), v));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  seed(path, value) { this.data.set(path, structuredClone(value)); this.created.set(path, this.clock()); }
  async runTransaction(fn) {
    let unlock; const before = this.queue; this.queue = new Promise(r => { unlock = r; }); await before;
    try {
      const execute = async () => {
        const pending = []; let writing = false;
        const write = (type, ref, data, options) => { assert.ok(!ref.name.startsWith('xendit_test'), 'Live cannot write Test records'); writing = true; pending.push({ type, ref, data: structuredClone(data), options }); };
        const value = await fn({ get: ref => { assert.equal(writing, false, 'Firestore read after write'); return this.read(ref); },
          create: (r, d) => write('create', r, d), update: (r, d) => write('update', r, d), set: (r, d, o) => write('set', r, d, o) });
        return { pending, value };
      };
      if (this.retryOnce) { this.retryOnce = false; await execute(); }
      const { pending, value } = await execute();
      for (const { type, ref } of pending) { if (type === 'create') assert.equal(this.data.has(ref.path), false); if (type === 'update') assert.equal(this.data.has(ref.path), true); }
      for (const { type, ref, data, options } of pending) {
        this.data.set(ref.path, type === 'update' || options?.merge ? { ...this.data.get(ref.path), ...data } : data);
        if (!this.created.has(ref.path)) this.created.set(ref.path, this.clock()); this.writes.push({ type, ref, data });
      }
      return value;
    } finally { unlock(); }
  }
}
const fixtureEnv = { XENDIT_LIVE_SECRET_KEY: 'xnd_production_fixture_not_a_real_key', XENDIT_LIVE_WEBHOOK_TOKEN: 'fixture_live_callback',
  XENDIT_LIVE_BUSINESS_ID: 'merchant_fixture', XENDIT_LIVE_ENABLED: 'true', VITE_GOOGLE_MAPS_API_KEY: 'fixture_maps_not_a_key' };
const bookingId = 'bk_SH-261021-FIX01';
const req = (body = {}, uid = 'alice') => ({ body, headers: { authorization: `Bearer ${uid}` }, rawHeaders: ['Authorization', `Bearer ${uid}`], ip: '127.0.0.1', socket: {} });
const webhookReq = (s, event = 'payment_session.completed', token = fixtureEnv.XENDIT_LIVE_WEBHOOK_TOKEN) => ({
  body: { event, business_id: 'merchant_fixture', data: { id: s.payment_session_id, reference_id: s.reference_id } },
  headers: { 'x-callback-token': token }, rawHeaders: ['x-callback-token', token], ip: '127.0.0.1', socket: {},
});
function fixture(options = {}) {
  let time = Date.parse('2026-10-21T02:00:00Z'); const clock = () => time, db = new MemoryDB(clock);
  db.seed('staff_users/staff_manager', { authUserId: 'manager', role: 'manager', name: 'Fixture', isStaffMaster: true, sourceSystem: 'STAFF_MASTER_GOVERNANCE' });
  db.seed('staff_roles/manager', { authUserId: 'manager', role: 'manager', isActive: true, staffId: 'staff_manager' });
  const env = { ...fixtureEnv, ...options.env }, calls = [], remote = new Map(); let mode = 'ok', patch = {}, pause, paidCallbacks = 0;
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.xendit.co'); assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${env.XENDIT_LIVE_SECRET_KEY}:`).toString('base64')}`);
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') {
      if (mode === 'network') throw new Error('network');
      if (mode === 'rejected') return Response.json({ message: env.XENDIT_LIVE_SECRET_KEY }, { status: 422 });
      const input = JSON.parse(init.body), s = { ...input, payment_session_id: `ps-${String(remote.size + 1).padStart(24, '0')}`,
        business_id: 'merchant_fixture', status: 'ACTIVE', payment_id: null, payment_link_url: 'https://xen.to/fixture_live' };
      remote.set(s.payment_session_id, structuredClone(s));
      if (mode === 'lost') throw new Error('response lost');
      if (pause) await pause;
      return Response.json({ ...s, ...patch }, { status: 201 });
    }
    const value = remote.get(decodeURIComponent(url.split('/').pop()));
    return value ? Response.json({ ...value, ...patch }) : Response.json({}, { status: 404 });
  };
  const deps = { db, env, fetch: fetcher, clock, verify: async token => { if (!['alice', 'bob', 'manager'].includes(token)) throw new Error(); return { uid: token }; },
    authorizeManager: managerFactory(db), onPaid: async () => { paidCallbacks++; } };
  const service = createXenditLive(deps);
  const b = { id: bookingId, bookingCode: 'SH-261021-FIX01', customerId: 'alice', customerAuthUid: 'alice', authUserId: 'alice',
    customerName: 'Fixture Buyer', customerWhatsApp: '080000000000', serviceId: 'service_fixture', servicePrice: 160000, homeServiceFee: 30000,
    discountAmount: 20000, totalAmount: 170000, promoDiscount: 20000, voucherDiscount: 0, pointsRedeemed: 0, pointsDiscount: 0,
    latitude: -2.97, longitude: 104.74, distanceKm: 12, distanceMeters: 12000, scheduleDate: '2026-10-22', scheduleTime: '12:00',
    customerGender: 'Laki-laki', paymentMethod: 'Xendit', gatewayProvider: 'xendit', gatewayEnvironment: 'live', gatewayReceiptId: 'vchk_fixture',
    status: 'Menunggu Pembayaran', paymentStatus: 'UNPAID', paymentPolicyVersion: 2, paymentDeadline: null };
  b.gatewayQuoteHash = liveQuoteSeal(b); db.seed(`bookings/${bookingId}`, b);
  db.seed('voucher_checkout_receipts/vchk_fixture', { schemaVersion: 2, bookingId, customerAuthUid: 'alice', paymentMethod: 'Xendit',
    gatewayProvider: 'xendit', gatewayEnvironment: 'live', gatewayQuoteHash: b.gatewayQuoteHash, totalAmount: b.totalAmount });
  return { db, env, deps, service, calls, remote, b, get paidCallbacks() { return paidCallbacks; },
    setTime: v => { time = v; }, setMode: v => { mode = v; }, setPatch: v => { patch = v; }, setPause: v => { pause = v; },
    complete() { const s = remote.values().next().value; s.status = 'COMPLETED'; s.payment_id = 'py-123456789012345678901234'; return s; } };
}
const rejects = (fn, code) => assert.rejects(fn, e => e.code === code);
const payment = f => f.db.data.get(`payments/PAY-${bookingId}`);

test('Live config fails closed for Test credentials, missing credentials and disabled switch', async () => {
  for (const env of [{ XENDIT_LIVE_SECRET_KEY: 'xnd_development_fixture' }, { XENDIT_LIVE_WEBHOOK_TOKEN: '' },
    { XENDIT_LIVE_BUSINESS_ID: '' }, { XENDIT_LIVE_ENABLED: 'false' }, { XENDIT_LIVE_RETURN_URL: 'https://evil.example/' }]) {
    const f = fixture({ env }); assert.equal(f.service.availability().available, false);
    await assert.rejects(() => f.service.checkout(req({ bookingId }))); assert.equal(f.calls.length, 0); assert.equal(f.db.writes.length, 0);
  }
});
test('Live URL validator rejects staging, suffix confusion, credentials and non-HTTPS', () => {
  for (const u of ['https://dev.xen.to/test', 'https://checkout-staging.xendit.co/test', 'https://xen.to.evil.example/', 'https://user@xen.to/a', 'http://xen.to/a']) assert.throws(() => safeLiveCheckoutUrl(u));
  assert.equal(safeLiveCheckoutUrl('https://checkout.xendit.co/sessions/fixture'), 'https://checkout.xendit.co/sessions/fixture');
});
test('only owner with canonical server receipt can create; client amount and ownership spoofing are rejected', async () => {
  const f = fixture(); await assert.rejects(() => f.service.checkout(req({ bookingId }, 'bob')), e => e.status === 403);
  await rejects(() => f.service.checkout(req({ bookingId, amount: 1 })), 'INVALID_LIVE_REQUEST');
  f.db.data.delete('voucher_checkout_receipts/vchk_fixture'); await rejects(() => f.service.checkout(req({ bookingId })), 'LIVE_QUOTE_REQUIRED');
  assert.equal(f.calls.length, 0); assert.equal(f.db.writes.length, 0);
});
test('new Live checkout charges exact sealed net amount once under concurrency and transaction retry', async () => {
  const f = fixture(); f.db.retryOnce = true;
  const results = await Promise.all(Array.from({ length: 3 }, () => f.service.checkout(req({ bookingId }))));
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1); assert.equal(results[0].amount, 170000);
  assert.equal(payment(f).status, 'pending'); assert.equal(f.db.data.get(`bookings/${bookingId}`).paymentStatus, 'UNPAID');
  const body = f.calls[0].body; assert.equal(body.amount, 170000); assert.equal(body.allow_save_payment_method, 'DISABLED');
  assert.equal(body.customer.mobile_number, undefined); assert.equal(body.customer.email, undefined); assert.equal(body.customer.address, undefined);
});
test('failed create response does not create again; existing intent is returned for owner recovery', async () => {
  for (const mode of ['network', 'lost', 'rejected']) {
    const f = fixture(); f.setMode(mode); await assert.rejects(() => f.service.checkout(req({ bookingId })));
    const state = await f.service.checkout(req({ bookingId }));
    assert.equal(state.creationState, mode === 'rejected' ? 'rejected' : 'uncertain'); assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify([...f.db.data.values()]).includes(f.env.XENDIT_LIVE_SECRET_KEY));
  }
});
test('uncertain request is recovered by matching webhook for its real session, without replacement', async () => {
  const f = fixture(); f.setMode('lost'); await assert.rejects(() => f.service.checkout(req({ bookingId })));
  await f.service.webhook(webhookReq(f.complete()));
  assert.equal((await f.service.status(req({ bookingId }))).sessionStatus, 'COMPLETED'); assert.equal(payment(f).status, 'paid');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('webhook validates token and single header before API access or financial writes', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); const s = f.complete(), before = f.db.writes.length, calls = f.calls.length;
  await rejects(() => f.service.webhook(webhookReq(s, 'payment_session.completed', 'wrong')), 'INVALID_WEBHOOK_TOKEN');
  const duplicate = webhookReq(s); duplicate.rawHeaders.push('X-Callback-Token', 'another');
  await rejects(() => f.service.webhook(duplicate), 'INVALID_AUTH_HEADER');
  assert.equal(f.db.writes.length, before); assert.equal(f.calls.length, calls);
});
test('unrelated Test/SAVE sample is acknowledged without reading Xendit or touching real payment', async () => {
  const f = fixture(); const request = webhookReq({ payment_session_id: 'ps-123456789012345678901234', reference_id: 'test_session' });
  request.body.data.session_type = 'SAVE'; request.body.data.amount = 100000;
  assert.equal((await f.service.webhook(request)).ignored, true); assert.equal(f.calls.length, 0); assert.equal(f.db.writes.length, 0);
});
test('matching Completed webhook marks only its own payment paid and confirms booking, once', async () => {
  const f = fixture(); f.db.seed('bookings/unrelated', { paymentStatus: 'UNPAID', status: 'Menunggu Pembayaran' });
  await f.service.checkout(req({ bookingId })); const s = f.complete();
  await f.service.webhook(webhookReq(s)); const first = payment(f).paidAt;
  await f.service.webhook(webhookReq(s));
  const result = await f.service.status(req({ bookingId }));
  assert.equal(result.sessionStatus, 'COMPLETED'); assert.ok(result.lastWebhookAt); assert.equal(result.lastCheckedAt, null);
  assert.equal(payment(f).paidAt, first); assert.equal(f.paidCallbacks, 1);
  assert.equal(f.db.data.get(`bookings/${bookingId}`).status, 'Confirmed'); assert.equal(f.db.data.get('bookings/unrelated').paymentStatus, 'UNPAID');
  assert.equal([...f.db.data.keys()].filter(k => k.startsWith('payment_status_history/')).length, 1);
});
test('canonical amount, merchant, mode, reference, ID and payment-ID conflicts never mark paid', async () => {
  for (const patch of [{ amount: 1 }, { business_id: 'foreign_merchant' }, { mode: 'COMPONENTS' }, { session_type: 'SAVE' },
    { reference_id: 'foreign' }, { payment_session_id: 'ps-999999999999999999999999' }, { payment_id: null }, { capture_method: 'MANUAL' }]) {
    const f = fixture(); await f.service.checkout(req({ bookingId })); const s = f.complete(); f.setPatch(patch);
    await rejects(() => f.service.webhook(webhookReq(s)), 'XENDIT_LIVE_SESSION_CONFLICT'); assert.equal(payment(f).status, 'pending');
  }
});
test('stale create response arriving after Completed webhook never reverts paid state or canonical payment ID', async () => {
  const f = fixture(); let resume; f.setPause(new Promise(r => { resume = r; }));
  const creating = f.service.checkout(req({ bookingId }));
  while (!f.remote.size) await new Promise(r => setImmediate(r));
  const s = f.complete(); await f.service.webhook(webhookReq(s)); resume(); await creating;
  assert.equal(payment(f).status, 'paid'); const saved = await f.service.status(req({ bookingId })); assert.equal(saved.sessionStatus, 'COMPLETED');
  assert.equal(f.db.data.get(`xendit_live_sessions/${saved.referenceId}`).paymentId, s.payment_id); assert.equal(f.paidCallbacks, 1);
});
test('late Expired event reconciles canonical Completed instead of downgrading settlement', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); const s = f.complete();
  await f.service.webhook(webhookReq(s, 'payment_session.expired')); assert.equal(payment(f).status, 'paid');
  assert.equal(f.db.data.get(`bookings/${bookingId}`).paymentStatus, 'PAID');
});
test('disabled new-checkout switch still accepts verified webhooks for existing invoices', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); f.env.XENDIT_LIVE_ENABLED = 'false';
  await f.service.webhook(webhookReq(f.complete())); assert.equal(payment(f).status, 'paid'); assert.equal(f.service.availability().available, false);
});
test('expiry never cancels booking and paid state is irreversible', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); const s = f.remote.values().next().value; s.status = 'EXPIRED';
  await f.service.webhook(webhookReq(s, 'payment_session.expired')); assert.equal(payment(f).status, 'expired');
  assert.equal(f.db.data.get(`bookings/${bookingId}`).status, 'Menunggu Pembayaran');
  f.complete(); await f.service.webhook(webhookReq(s)); assert.equal(payment(f).status, 'paid');
});
test('payment after cancellation is recorded but never automatically confirms or dispatches service', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); f.db.data.get(`bookings/${bookingId}`).status = 'Cancelled';
  await f.service.webhook(webhookReq(f.complete())); assert.equal(payment(f).status, 'paid'); assert.equal(payment(f).reconciliationRequired, true);
  assert.equal(f.db.data.get(`bookings/${bookingId}`).status, 'Cancelled'); assert.equal(f.paidCallbacks, 0);
});
test('commercial terms changed after charge require reconciliation and do not settle altered booking', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); f.db.data.get(`bookings/${bookingId}`).totalAmount = 1;
  await f.service.webhook(webhookReq(f.complete())); assert.equal(payment(f).status, 'paid'); assert.equal(payment(f).reconciliationRequired, true);
  assert.equal(f.db.data.get(`bookings/${bookingId}`).paymentStatus, 'UNPAID'); assert.equal(f.db.data.get(`bookings/${bookingId}`).status, 'Menunggu Pembayaran');
});
test('manual initialize/proof/verification cannot override a gateway payment', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); const manual = createPaymentAcceptance(f.db, f.deps.clock);
  await assert.rejects(() => manual.initialize('alice', { bookingId, methodType: 'qris' }), e => e.status === 409);
  await assert.rejects(() => manual.acceptProof('alice', `PAY-${bookingId}`, { dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-fixture').toString('base64')}`, mimeType: 'application/pdf', fileName: 'proof.pdf' }), e => e.status === 409);
  assert.throws(() => assertManualPayment(payment(f)), e => e.status === 409); assert.equal(payment(f).status, 'pending');
});
test('Manager recovery requires current active Staff Master and validates exact owned intent', async () => {
  const f = fixture(); f.setMode('lost'); await assert.rejects(() => f.service.checkout(req({ bookingId })));
  const s = f.remote.values().next().value;
  await assert.rejects(() => f.service.refresh(req({ bookingId, sessionId: s.payment_session_id }), true), e => e.status === 403);
  const value = await f.service.refresh(req({ bookingId, sessionId: s.payment_session_id }, 'manager'), true); assert.equal(value.sessionStatus, 'ACTIVE'); assert.ok(value.lastCheckedAt);
  f.db.data.get('staff_roles/manager').isActive = false;
  await assert.rejects(() => f.service.managerStatus(req({}, 'manager')), e => e.status === 403);
});
test('status only reads persisted records; explicit check records a separate API-check timestamp', async () => {
  const f = fixture(); await f.service.checkout(req({ bookingId })); const before = f.calls.length;
  await f.service.status(req({ bookingId })); assert.equal(f.calls.length, before);
  const v = await f.service.refresh(req({ bookingId })); assert.ok(v.lastCheckedAt); assert.equal(v.lastWebhookAt, null);
});
test('forged createdAt cannot extend the immutable Firestore payment deadline', async () => {
  const f = fixture(); f.db.data.get(`bookings/${bookingId}`).createdAt = '2099-01-01'; f.setTime(f.deps.clock() + 3600001);
  await rejects(() => f.service.checkout(req({ bookingId })), 'LIVE_BOOKING_EXPIRED'); assert.equal(f.calls.length, 0);
});
test('new session is not sent when remaining booking time is below the Xendit minimum expiry', async () => {
  const f=fixture();f.setTime(Date.parse('2026-10-21T02:50:00Z'));
  await rejects(()=>f.service.checkout(req({bookingId})),'LIVE_BOOKING_EXPIRED');
  assert.equal(f.calls.length,0);assert.equal(f.db.writes.length,0);
});
test('Manager persisted inspection never calls Xendit or replaces webhook/check timestamps', async()=>{
  const f=fixture();await f.service.checkout(req({bookingId}));const s=f.complete();await f.service.webhook(webhookReq(s));
  const apiCalls=f.calls.length,writes=f.db.writes.length;
  const result=await f.service.inspect(req({bookingId},'manager'));
  assert.equal(result.paymentStatus,'paid');assert.ok(result.lastWebhookAt);assert.equal(result.lastCheckedAt,null);
  assert.equal(result.paidSource,'webhook');
  assert.equal(f.calls.length,apiCalls);assert.equal(f.db.writes.length,writes);
  await assert.rejects(()=>f.service.inspect(req({bookingId},'alice')),e=>e.status===403);
});
test('first paid source remains API check when a matching webhook arrives later',async()=>{
  const f=fixture();await f.service.checkout(req({bookingId}));const s=f.complete();
  const checked=await f.service.refresh(req({bookingId}));assert.equal(checked.paidSource,'check');assert.equal(checked.lastWebhookAt,null);
  await f.service.webhook(webhookReq(s));const final=await f.service.inspect(req({bookingId},'manager'));
  assert.equal(final.paidSource,'check');assert.ok(final.lastWebhookAt);assert.ok(final.lastCheckedAt);
});
test('HTTP endpoints preserve auth guards, public availability and masked upstream errors', async () => {
  const f = fixture(), app = express(); app.use(express.json()); registerXenditLive(app, f.deps);
  const http = app.listen(0, '127.0.0.1'); await new Promise(r => http.once('listening', r)); const origin = `http://127.0.0.1:${http.address().port}`;
  try {
    const availability = await (await fetch(`${origin}/api/integrations/xendit/live/availability`)).json(); assert.equal(availability.available, true);
    const denied = await fetch(`${origin}/api/integrations/xendit/live/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId }) }); assert.equal(denied.status, 401);
    f.setMode('rejected'); const response = await fetch(`${origin}/api/integrations/xendit/live/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer alice' }, body: JSON.stringify({ bookingId }) });
    assert.equal(response.status, 502); assert.ok(!(await response.text()).includes(f.env.XENDIT_LIVE_SECRET_KEY));
  } finally { await new Promise(r => http.close(r)); }
});

function actualCheckoutFixture() {
  const f = fixture(); f.db.data.clear(); f.db.created.clear(); f.db.writes = [];
  f.db.seed('services/service_fixture', { name: 'Fixture service', price: 160000, duration: 60, isActive: true, serviceType: 'HOME_SERVICE' });
  f.db.seed('customers/alice', { id: 'alice', authUserId: 'alice', customerAuthUid: 'alice', name: 'Fixture Buyer' });
  f.db.seed('settings/operational', { operatingHoursStart: '10:00', operatingHoursEnd: '22:00', leadTimeMinutes: 60, maxAdvanceDays: 14 });
  let routeCalls = 0;
  const live = { assertBookingAllowed: f.service.assertBookingAllowed, prepareBookingRoute: async () => { f.service.assertBookingAllowed(); routeCalls++; return { distanceKm: 12, distanceMeters: 12000 }; } };
  const handler = checkoutFactory(f.db, { verifyIdToken() {} }, async token => token === 'alice' ? { success: true, uid: 'alice' } : { success: false, statusCode: 401, code: 'AUTH_INVALID' },
    calculateHomeServiceFee, SENZU_BASE_LOCATION, DEFAULT_LOYALTY_SETTINGS, DEFAULT_MEMBERSHIP_TIERS, live, liveQuoteSeal, validateLiveSchedule, createHash, () => {});
  const tomorrow = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10);
  const input = { checkoutAttemptId: 'chk_fixture_live_0001', customerId: 'alice', customerName: 'Fixture Buyer', customerWhatsApp: '080000000000', customerEmail: '',
    serviceId: 'service_fixture', scheduleDate: tomorrow, scheduleTime: '12:00', address: 'Lokasi fixture Palembang', latitude: SENZU_BASE_LOCATION.lat, longitude: SENZU_BASE_LOCATION.lng,
    distanceKm: 1, distanceMeters: 1000, genderPreference: 'Bebas', customerGender: 'Laki-laki', servicePrice: 160000, homeServiceFee: 30000,
    discountAmount: 0, promoDiscount: 0, voucherDiscount: 0, pointsRedeemed: 0, pointsDiscount: 0, totalAmount: 190000, paymentMethod: 'Xendit' };
  return { ...f, input, get routeCalls() { return routeCalls; }, async submit(extra = {}) {
    let code = 200, value; const response = { status(s) { code = s; return this; }, json(v) { value = v; return this; } };
    await handler(req({ ...input, ...extra }), response); return { code, value };
  } };
}
test('actual booking checkout accepts plain Live checkout, quotes driving distance, seals net amount and replays without another quote', async () => {
  const f = actualCheckoutFixture(), first = await f.submit(); assert.equal(first.code, 200, JSON.stringify(first.value));
  const b = first.value.booking; assert.equal(b.homeServiceFee, 30000); assert.equal(b.distanceKm, 12); assert.equal(b.totalAmount, 190000);
  assert.equal(b.gatewayQuoteHash, liveQuoteSeal(b)); assert.equal(b.paymentStatus, 'UNPAID'); assert.equal(b.status, 'Menunggu Pembayaran');
  const writes = f.db.writes.length, second = await f.submit(); assert.equal(second.code, 200, JSON.stringify(second.value)); assert.equal(second.value.booking.id, b.id);
  assert.equal(f.db.writes.length, writes); assert.equal(f.routeCalls, 1);
});
test('actual booking checkout rejects stale price, disabled Live and invalid schedule before any booking or benefit writes', async () => {
  for (const extra of [{ totalAmount: 1 }, { servicePrice: 1 }, { homeServiceFee: 0 }, { scheduleTime: '02:00' }, { customerGender: '' }]) {
    const f = actualCheckoutFixture(), result = await f.submit(extra); assert.notEqual(result.code, 200); assert.equal(f.db.writes.length, 0);
  }
  const f = actualCheckoutFixture(); f.env.XENDIT_LIVE_ENABLED = 'false'; assert.equal((await f.submit()).code, 503); assert.equal(f.db.writes.length, 0);
});
test('actual manual no-voucher requests still use their existing path and cannot opt into gateway authority', async () => {
  const f = actualCheckoutFixture(); const result = await f.submit({ paymentMethod: 'QRIS' });
  assert.equal(result.value.code, 'VOUCHER_REQUIRED'); assert.equal(f.db.writes.length, 0); assert.equal(f.routeCalls, 0);
});
test('new checkout rejects disabled, missing-status and outlet-only services before booking or benefit writes', async () => {
  for (const service of [{ isActive: false }, { isActive: undefined }, { isActive: null }, { isActive: 'true' },
    { isActive: true, serviceType: 'OUTLET' }]) {
    for (const method of ['Xendit', 'Transfer BNI']) {
      const f = actualCheckoutFixture();
      Object.assign(f.db.data.get('services/service_fixture'), service);
      const result = await f.submit(method === 'Xendit' ? {} : { paymentMethod: method, pointsRedeemed: 50, pointsDiscount: 5000 });
      assert.equal(result.code, 409, JSON.stringify(result.value));
      assert.equal(result.value.code, 'SERVICE_UNAVAILABLE');
      assert.equal(f.db.writes.length, 0);
      assert.equal(f.calls.length, 0);
    }
  }
});
test('catalog deactivation during checkout retry discards the earlier transaction writes', async () => {
  const f = actualCheckoutFixture(), run = f.db.runTransaction.bind(f.db);
  let attempts = 0;
  f.db.retryOnce = true;
  f.db.runTransaction = fn => run(async transaction => {
    const result = await fn(transaction);
    if (++attempts === 1) f.db.data.get('services/service_fixture').isActive = false;
    return result;
  });
  const result = await f.submit();
  assert.equal(attempts, 2);
  assert.equal(result.value.code, 'SERVICE_UNAVAILABLE');
  assert.equal(f.db.writes.length, 0);
});
test('existing checkout receipt remains recoverable after the service is deactivated', async () => {
  const f = actualCheckoutFixture(), first = await f.submit();
  assert.equal(first.code, 200);
  const writes = f.db.writes.length;
  f.db.data.get('services/service_fixture').isActive = false;
  const replay = await f.submit();
  assert.equal(replay.code, 200, JSON.stringify(replay.value));
  assert.equal(replay.value.booking.id, first.value.booking.id);
  assert.equal(f.db.writes.length, writes);
  assert.equal(f.routeCalls, 1);
});
test('active BOTH service retains manual points checkout and its idempotent receipt', async () => {
  const f = actualCheckoutFixture();
  f.db.data.get('services/service_fixture').serviceType = 'BOTH';
  f.db.seed('loyalty_accounts/alice', { customerId: 'alice', authUserId: 'alice', customerAuthUid: 'alice', pointsBalance: 500, currentTierId: 'member', lifetimePointsRedeemed: 0 });
  const input = { paymentMethod: 'Transfer BNI', distanceKm: 12, distanceMeters: 12000, pointsRedeemed: 50, pointsDiscount: 5000, discountAmount: 5000, totalAmount: 185000 };
  const first = await f.submit(input);
  assert.equal(first.code, 200, JSON.stringify(first.value));
  assert.equal(first.value.booking.totalAmount, 185000);
  assert.equal(first.value.booking.paymentMethod, 'Transfer BNI');
  assert.equal(f.db.data.get('loyalty_accounts/alice').pointsBalance, 450);
  assert.equal((await f.submit(input)).code, 200);
  assert.equal(f.db.data.get('loyalty_accounts/alice').pointsBalance, 450);
  assert.equal(f.routeCalls, 0);
});
test('actual Live points checkout debits once and charges server-computed net amount on replay', async () => {
  const f = actualCheckoutFixture(); f.db.seed('loyalty_accounts/alice', { customerId: 'alice', authUserId: 'alice', customerAuthUid: 'alice', pointsBalance: 500, currentTierId: 'member', lifetimePointsRedeemed: 0 });
  const input = { pointsRedeemed: 50, pointsDiscount: 5000, discountAmount: 5000, totalAmount: 185000 };
  const first = await f.submit(input); assert.equal(first.code, 200, JSON.stringify(first.value)); assert.equal(first.value.booking.totalAmount, 185000);
  assert.equal(f.db.data.get('loyalty_accounts/alice').pointsBalance, 450);
  const second = await f.submit(input); assert.equal(second.code, 200, JSON.stringify(second.value)); assert.equal(f.db.data.get('loyalty_accounts/alice').pointsBalance, 450);
});
test('Live driving quote requires successful server API result and never silently assumes free transport', async () => {
  const key = { VITE_GOOGLE_MAPS_API_KEY: 'fixture_only' };
  const route = await quoteLiveDrivingDistance(-2.97, 104.74, key, async () => Response.json({ routes: [{ distanceMeters: 15001, duration: '1800s' }] }));
  assert.equal(calculateHomeServiceFee(route.distanceKm).fee, 60000);
  for (const data of [{ routes: [] }, { routes: [{ duration: '1s' }] }, { routes: [{ distanceMeters: 0, duration: '0s' }] }, { routes: [{ distanceMeters: -1 }] }]) {
    await rejects(() => quoteLiveDrivingDistance(-2.97, 104.74, key, async () => Response.json(data)), 'LIVE_ROUTE_UNAVAILABLE');
  }
});
test('Live schedule uses WIB, opening hours, service duration and lead time', () => {
  const clock = () => Date.parse('2026-10-21T02:00:00Z'), base = { scheduleDate: '2026-10-21', scheduleTime: '10:00', customerGender: 'Laki-laki' };
  assert.doesNotThrow(() => validateLiveSchedule(base, 60, {}, clock));
  for (const extra of [{ scheduleTime: '09:30' }, { scheduleTime: '21:30' }, { scheduleDate: '2026-02-30' }, { scheduleDate: '2026-11-21' }, { customerGender: '' }]) {
    assert.throws(() => validateLiveSchedule({ ...base, ...extra }, 60, {}, clock));
  }
});
