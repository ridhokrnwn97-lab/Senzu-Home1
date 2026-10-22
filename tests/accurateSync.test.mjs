// OFFLINE ONLY. All provider responses, Firebase data and credentials are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { createHash, createHmac } from 'node:crypto';
import express from 'express';
import { createAccurateSync, registerAccurateSync } from '../src/server/accurateSync.ts';
import { createXenditLive } from '../src/server/xenditLive.ts';
import { liveQuoteSeal } from '../src/server/xenditLiveQuote.ts';
import { ACCURATE_MASTERS, ACCURATE_APP_KEY, ACCURATE_APP_NAME, ACCURATE_COMPANY } from '../src/lib/accurateContracts.ts';
import { ACCURATE_SYNC_ACK, ACCURATE_SYNC_DATABASE_ID as TARGET } from '../src/lib/accurateSyncContracts.ts';
const h = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sourceText = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', sourceText, ts.ScriptTarget.Latest, true);
const pieces = []; let managerSource;
function visit(n) {
  if (ts.isFunctionDeclaration(n) && ['isValidStage7dDocId', 'sanitizeStage7dText', 'validateStage7dActiveManagerIdentity'].includes(n.name?.text)) pieces.push(n.getText(ast));
  if (ts.isCallExpression(n) && n.expression.getText(ast) === 'registerAccurateSync') managerSource = n.arguments[1].properties.find(p => p.name?.getText(ast) === 'authorizeManager').initializer.getText(ast);
  ts.forEachChild(n, visit);
}
visit(ast); assert.equal(pieces.length, 3); assert.ok(managerSource);
const managerFactory = new Function('adminDb', transformSync(`${pieces.join('\n')}\nreturn ${managerSource};`, { loader: 'ts' }).code);
class DB {
  data = new Map(); created = new Map(); writes = []; queue = Promise.resolve(); retryOnce = false; failCommit = false;
  constructor(clock) { this.clock = clock; }
  collection(name) {
    const make = (filters = [], take = Infinity, order = null) => ({ name, filters, take, order,
      where: (k, op, v) => make([...filters, [k, op, v]], take, order), limit: n => make(filters, n, order), orderBy: (k, dir = 'asc') => make(filters, take, [k, dir]),
      get: () => this.read(make(filters, take, order)),
      doc: id => ({ name, id, path: `${name}/${id}`, get: () => this.read({ name, id }) }),
    }); return make();
  }
  seed(path, value, at = this.clock()) { this.data.set(path, structuredClone(value)); this.created.set(path, at); }
  snap(name, id, value) { return { id, exists: value !== undefined, data: () => structuredClone(value), ref: this.collection(name).doc(id), createTime: { toMillis: () => this.created.get(`${name}/${id}`) || this.clock() } }; }
  async read(ref) {
    if (ref.id) return this.snap(ref.name, ref.id, this.data.get(`${ref.name}/${ref.id}`));
    let rows = [...this.data].filter(([path, v]) => path.startsWith(`${ref.name}/`) && ref.filters.every(([k, op, e]) => op === '==' ? v[k] === e : op === '<=' ? v[k] <= e : false));
    if (ref.order) { const [k, dir] = ref.order; rows.sort((a, b) => (a[1][k] < b[1][k] ? -1 : a[1][k] > b[1][k] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const docs = rows.slice(0, ref.take).map(([path, v]) => this.snap(ref.name, path.slice(ref.name.length + 1), v));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
  async runTransaction(fn) {
    let unlock; const previous = this.queue; this.queue = new Promise(r => unlock = r); await previous;
    try {
      const execute = async () => {
        let writing = false; const writes = [];
        const put = (op, ref, value, options) => { writing = true; writes.push({ op, ref, value: structuredClone(value), options }); };
        const value = await fn({ get: ref => { assert.equal(writing, false, 'all reads precede all writes'); return this.read(ref); },
          create: (r, d) => put('create', r, d), update: (r, d) => put('update', r, d), set: (r, d, o) => put('set', r, d, o) });
        return { value, writes };
      };
      if (this.retryOnce) { this.retryOnce = false; await execute(); }
      const { value, writes } = await execute();
      if (this.failCommit) { this.failCommit = false; throw new Error('fixture commit unavailable'); }
      for (const w of writes) {
        assert.ok(!w.ref.name.startsWith('xendit_test'), 'no Test writes');
        if (w.op === 'create') assert.equal(this.data.has(w.ref.path), false, `duplicate create ${w.ref.path}`);
        if (w.op === 'update') assert.ok(this.data.has(w.ref.path));
      }
      for (const w of writes) {
        const data = w.op === 'update' || w.options?.merge ? structuredClone(this.data.get(w.ref.path) || {}) : {};
        for (const [key, value] of Object.entries(w.value)) {
          const parts = key.split('.'); let target = data;
          for (const p of parts.slice(0, -1)) target = target[p] ||= {};
          target[parts.at(-1)] = value;
        }
        this.data.set(w.ref.path, data); if (!this.created.has(w.ref.path)) this.created.set(w.ref.path, this.clock()); this.writes.push(w);
      }
      return value;
    } finally { unlock(); }
  }
}
const token = 'aat.' + 'A'.repeat(64) + '.offline_fixture', secret = 'fixture_signature_secret_not_real';
const req = (body = {}, uid = 'manager') => ({ body, headers: { authorization: `Bearer ${uid}` }, rawHeaders: ['Authorization', `Bearer ${uid}`], ip: 'fixture', socket: {} });
const approve = { acknowledgement: ACCURATE_SYNC_ACK, taxPolicy: 'no_extra_tax' };
function staff(db, uid = 'manager', role = 'manager') {
  db.seed(`staff_users/staff_${uid}`, { authUserId: uid, name: 'Fixture', role, isStaffMaster: true, sourceSystem: 'STAFF_MASTER_GOVERNANCE' });
  db.seed(`staff_roles/${uid}`, { authUserId: uid, staffId: `staff_${uid}`, role, isActive: true });
}
function fixture() {
  let time = Date.parse('2026-10-22T02:00:00Z'); const clock = () => time, db = new DB(clock); staff(db);
  const env = { ACCURATE_API_TOKEN: token, ACCURATE_SIGNATURE_SECRET: secret, ACCURATE_SYNC_WRITES_ENABLED: 'true',
    ACCURATE_SYNC_WORKER_TOKEN: 'worker_fixture_' + 'A'.repeat(50) };
  const meta = { database: { id: TARGET, alias: ACCURATE_COMPANY, host: 'https://odin.accurate.id', deleted: false, admin: true },
    application: { appKey: ACCURATE_APP_KEY, name: ACCURATE_APP_NAME }, tokenType: 'api' };
  const masters = new Map([...ACCURATE_MASTERS, { kind: 'account', code: '110301', name: 'Piutang Usaha IDR', type: 'ACCOUNT_RECEIVABLE' },
    { kind: 'account', code: '400004', name: 'Diskon Penjualan', type: 'REVENUE' }].map((v, index) => [v.code, { id: 1000 + index, no: v.code, name: v.name,
      currency: { code: 'IDR' }, suspended: false, ...(v.kind === 'account' ? { accountType: v.type } : { itemType: v.type, unitPrice: v.price,
        salesAccount: { no: '400005' }, salesDiscountAccount: { no: '400004' }, tax1: null, tax2: null, tax3: null }) }]));
  const remote = new Map(), calls = []; let responder = null, lostKind = null, absentKind = null;
  const fetcher = async (input, init) => {
    const url = new URL(input), payload = init.body ? JSON.parse(init.body) : null;
    assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers['X-Api-Signature'], createHmac('sha256', secret).update(init.headers['X-Api-Timestamp']).digest('base64'));
    const call = { url, init, payload }; calls.push(call);
    if (responder) { const r = await responder(call); if (r) return r; }
    if (url.hostname === 'account.accurate.id') { assert.equal(init.method, 'POST'); assert.equal(payload, null); return Response.json({ s: true, d: meta }); }
    assert.ok(['odin.accurate.id', 'zeus.accurate.id'].includes(url.hostname), 'no credentials sent to other origins');
    const parts = url.pathname.split('/'), type = parts.at(-2), action = parts.at(-1);
    if (['glaccount', 'item'].includes(type)) return Response.json({ s: true, d: masters.get(url.searchParams.get('no')) });
    if (action === 'list.do') {
      assert.equal(init.method, 'GET'); const number = url.searchParams.get(`filter.${type === 'customer' ? 'no' : 'number'}.val`);
      assert.equal(url.searchParams.get(`filter.${type === 'customer' ? 'no' : 'number'}.op`), 'EQUAL');
      return Response.json({ s: true, d: [...remote.values()].filter(v => v._type === type && (v.no || v.number) === number).map(v => ({ id: v.id, [type === 'customer' ? 'no' : 'number']: number })) });
    }
    if (action === 'detail.do') return Response.json({ s: true, d: [...remote.values()].find(v => v._type === type && v.id === Number(url.searchParams.get('id'))) });
    assert.equal(init.method, 'POST'); assert.equal(payload.id, undefined, 'never update existing provider records');
    const kind = type === 'customer' ? 'customer' : type === 'sales-receipt' ? 'receipt' : action === 'create-down-payment.do' ? 'down_payment' : 'invoice';
    if (absentKind === kind) throw new Error(`fixture unavailable ${token} ${secret}`);
    const id = remote.size + 100, common = { id, _type: type, currency: { code: 'IDR' }, ...payload };
    let d;
    if (kind === 'customer') d = { ...common, no: payload.customerNo };
    else if (kind === 'down_payment') d = { ...common, invoiceDp: true, totalAmount: payload.dpAmount, taxable: payload.isTaxable, customer: { no: payload.customerNo } };
    else if (kind === 'receipt') d = { ...common, bank: { no: payload.bankNo }, customer: { no: payload.customerNo }, detailInvoice: payload.detailInvoice.map(x => ({ invoice: { number: x.invoiceNo }, paymentAmount: x.paymentAmount })) };
    else d = { ...common, customer: { no: payload.customerNo }, totalAmount: payload.detailItem.reduce((s, v) => s + v.unitPrice * v.quantity, 0) + payload.detailExpense.reduce((s, v) => s + v.expenseAmount, 0) - payload.cashDiscount, primeOwing: 0 };
    assert.equal(remote.has(`${type}/${payload.customerNo && kind === 'customer' ? payload.customerNo : payload.number}`), false, 'no duplicate POST');
    remote.set(`${type}/${kind === 'customer' ? payload.customerNo : payload.number}`, d);
    if (lostKind === kind) { lostKind = null; throw new Error(`fixture lost ${secret}`); }
    return Response.json({ s: true, d: { id, number: payload.number } });
  };
  const deps = { db, env, clock, pause: async ms => time += ms, fetch: fetcher, authorizeManager: managerFactory(db),
    verify: async uid => { if (uid === 'invalid') throw Object.assign(new Error(), { code: 'auth/id-token-expired' }); return { uid }; } };
  const service = createAccurateSync(deps);
  const activateControl = (enabled = true) => db.seed('accurate_sync_private/control', { schemaVersion: 1, databaseId: TARGET, taxPolicy: 'no_extra_tax', enabled, activatedAt: new Date(time - 10000).toISOString() });
  function booking(suffix = 'FIX01', overrides = {}) {
    const id = `bk_SH-261022-${suffix}`, owner = 'customer1', referenceId = `shl_${h([owner, id]).slice(0, 48)}`;
    const b = { id, bookingCode: `SH-261022-${suffix}`, customerId: 'crm1', customerName: 'Fixture Customer', customerAuthUid: owner, authUserId: owner,
      serviceId: 'service30', serviceName: 'Signature Treatment', serviceDuration: 30, servicePrice: 160000, homeServiceFee: 0, discountAmount: 0, totalAmount: 160000,
      latitude: -2.98, longitude: 104.75, address: 'Fixture address', area: 'Fixture area', scheduleDate: '2026-10-23', scheduleTime: '10:00', customerGender: 'Laki-laki',
      paymentMethod: 'Xendit', gatewayProvider: 'xendit', gatewayEnvironment: 'live', gatewayReceiptId: `rcpt_${suffix}`, activePaymentId: `PAY-${id}`,
      status: 'Confirmed', paymentStatus: 'PAID', createdAt: new Date(time).toISOString(), ...overrides };
    const quoteHash = liveQuoteSeal(b);
    const p = { id: `PAY-${id}`, bookingId: id, bookingCode: b.bookingCode, customerId: b.customerId, customerAuthUid: owner, authUserId: owner,
      provider: 'xendit', gatewayEnvironment: 'live', amount: b.totalAmount, status: 'paid', verifiedBy: 'xendit', paidAt: new Date(time).toISOString(),
      providerReferenceId: referenceId, gatewaySessionId: 'ps-' + suffix.padEnd(24, '0'), providerTransactionId: 'py-' + suffix.padEnd(24, '0') };
    const i = { bookingId: id, referenceId, ownerUid: owner, environment: 'live', amount: b.totalAmount, quoteHash,
      sessionStatus: 'COMPLETED', creationState: 'ready', sessionId: p.gatewaySessionId, paymentId: p.providerTransactionId, createdAt: new Date(time).toISOString(), expiresAt: new Date(time + 1800000).toISOString(), checkoutUrl: 'https://xen.to/fixture_live' };
    const r = { schemaVersion: 2, bookingId: id, customerAuthUid: owner, paymentMethod: 'Xendit', gatewayEnvironment: 'live', gatewayProvider: 'xendit', gatewayQuoteHash: quoteHash, totalAmount: b.totalAmount };
    db.seed(`bookings/${id}`, b); db.seed(`payments/${p.id}`, p); db.seed(`xendit_live_sessions/${referenceId}`, i); db.seed(`voucher_checkout_receipts/${b.gatewayReceiptId}`, r);
    return { booking: b, payment: p, intent: i, receipt: r, bookingCreatedAt: time };
  }
  const job = v => db.data.get(`accurate_sync_jobs/${h([TARGET, v.booking.id])}`);
  const queue = v => db.runTransaction(t => service.stagePaid(t, v));
  return { db, env, meta, masters, remote, calls, deps, service, booking, job, queue, activateControl,
    advance: n => time += n, clock, respond: fn => responder = fn, lose: kind => lostKind = kind, absent: kind => absentKind = kind,
    posts: kind => calls.filter(c => c.payload && c.url.hostname !== 'account.accurate.id' && (!kind || c.url.pathname.includes(kind))) };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);

test('default deployment is inert; configuration does not inspect bookings or contact provider', async () => {
  const f = fixture(); delete f.env.ACCURATE_SYNC_WRITES_ENABLED; const b = f.booking(); await f.queue(b); await f.service.runOnce();
  const s = await f.service.status(req()); assert.equal(s.enabled, false); assert.equal(s.writesConfigured, false); assert.equal(s.jobs.length, 0); assert.equal(f.calls.length, 0);
});
test('actual Staff Master gate rejects non-manager, disabled, duplicate and conflicting identities', async () => {
  for (const role of ['customer', 'therapist', 'supervisor', 'css']) { const f = fixture(); staff(f.db, 'actor', role); await assert.rejects(f.service.status(req({}, 'actor'))); assert.equal(f.calls.length, 0); }
  for (const change of [db => db.data.get('staff_roles/manager').isActive = false,
    db => db.seed('staff_users/duplicate', { authUserId: 'manager', role: 'manager' }),
    db => db.data.get('staff_users/staff_manager').authUid = 'foreign']) { const f = fixture(); change(f.db); await assert.rejects(f.service.status(req())); assert.equal(f.calls.length, 0); }
  const f = fixture(); await rejects(f.service.status(req({}, 'invalid')), 'AUTH_INVALID');
});
test('malformed auth, bodies, URLs, credentials, financial overrides and duplicate headers are rejected', async () => {
  for (const body of [null, [], { url: 'https://evil.invalid' }, { amount: 1 }, { token }]) {
    const f = fixture(); await rejects(f.service.status(req(body)), 'INVALID_SYNC_REQUEST'); assert.equal(f.calls.length, 0);
  }
  for (const extra of [{ rawHeaders: ['Authorization', 'Bearer manager', 'authorization', 'Bearer manager'] },
    { headers: { authorization: 'Bearer manager', 'x-firebase-auth': 'other' } }]) {
    const f = fixture(); await rejects(f.service.status({ ...req(), ...extra }), 'AUTH_INVALID'); assert.equal(f.calls.length, 0);
  }
});
test('historical booking preview verifies actual mappings without writes or enqueue', async () => {
  const f = fixture(), v = f.booking(); f.advance(10000); const before = structuredClone([...f.db.data]);
  const p = await f.service.preview(req({ bookingId: v.booking.id }));
  assert.equal(p.historical, true); assert.equal(p.eligible, false); assert.equal(p.itemCode, 'SH-SIG-030'); assert.equal(p.amount, 160000);
  assert.equal(f.posts().length, 0); assert.deepEqual([...f.db.data], before);
});
test('activation requires server switch, explicit scope, tax policy, correct DB and reauthorized Manager', async () => {
  const f = fixture(); delete f.env.ACCURATE_SYNC_WRITES_ENABLED; await rejects(f.service.activate(req(approve)), 'SYNC_NOT_CONFIGURED'); assert.equal(f.calls.length, 0);
  const g = fixture(); await rejects(g.service.activate(req({})), 'SYNC_APPROVAL_REQUIRED');
  await rejects(g.service.activate(req({ ...approve, taxPolicy: 'unknown' })), 'SYNC_APPROVAL_REQUIRED');
  const wrong = fixture(); wrong.meta.database.id++; await assert.rejects(wrong.service.activate(req(approve))); assert.equal(wrong.posts().length, 0);
  const revoked = fixture(); revoked.respond(call => { if (call.url.searchParams.get('no') === '400004') revoked.db.data.get('staff_roles/manager').isActive = false; });
  await assert.rejects(revoked.service.activate(req(approve))); assert.equal(revoked.db.data.has('accurate_sync_private/control'), false);
});
test('activation never backfills old bookings; pause/resume preserves original cutoff', async () => {
  const f = fixture(), old = f.booking(); f.advance(10000); const first = await f.service.activate(req(approve)); await f.queue(old); assert.equal(f.job(old), undefined);
  await f.service.pause(req()); f.advance(1000); const second = await f.service.activate(req(approve)); assert.equal(first.activatedAt, second.activatedAt); assert.equal(f.posts().length, 0);
});
test('paid outbox is idempotent under transaction retry and while delivery is paused', async () => {
  const f = fixture(); f.activateControl(false); const v = f.booking(); f.db.retryOnce = true; await f.queue(v); await f.queue(v);
  assert.equal(f.job(v).state, 'queued'); assert.equal([...f.db.data.keys()].filter(k => k.startsWith('accurate_sync_jobs/')).length, 1);
  await f.service.runOnce(); assert.equal(f.calls.length, 0);
});
test('actual Xendit paid transition and accounting queue commit together; failure rolls both back', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking();
  f.db.data.get(`payments/${v.payment.id}`).status = 'pending'; f.db.data.get(`bookings/${v.booking.id}`).paymentStatus = 'unpaid'; f.db.data.get(`xendit_live_sessions/${v.intent.referenceId}`).sessionStatus = 'ACTIVE';
  let shouldFail = true;
  const live = createXenditLive({ ...f.deps, env: { XENDIT_LIVE_SECRET_KEY: 'xnd_production_fixture', XENDIT_LIVE_WEBHOOK_TOKEN: 'fixture_callback', XENDIT_LIVE_BUSINESS_ID: 'merchant_fixture' },
    stagePaid: async (t, value) => { await f.service.stagePaid(t, value); if (shouldFail) throw new Error('fixture queue commit failure'); },
    fetch: async () => Response.json({ reference_id: v.intent.referenceId, payment_session_id: v.intent.sessionId, payment_id: v.intent.paymentId,
      business_id: 'merchant_fixture', amount: v.payment.amount, currency: 'IDR', country: 'ID', session_type: 'PAY', mode: 'PAYMENT_LINK', status: 'COMPLETED',
      expires_at: v.intent.expiresAt, payment_link_url: 'https://xen.to/fixture_live' }) });
  await assert.rejects(live.refresh(req({ bookingId: v.booking.id }, 'customer1')));
  assert.equal(f.db.data.get(`payments/${v.payment.id}`).status, 'pending'); assert.equal(f.job(v), undefined);
  shouldFail = false; await live.refresh(req({ bookingId: v.booking.id }, 'customer1')); assert.equal(f.job(v).state, 'queued');
  await live.refresh(req({ bookingId: v.booking.id }, 'customer1')); assert.equal([...f.db.data.keys()].filter(k => k.startsWith('accurate_sync_jobs/')).length, 1);
  assert.equal(f.db.data.get(`xendit_live_sessions/${v.intent.referenceId}`).paidSource, 'check'); assert.equal(f.posts().length, 0);
});
test('full offline lifecycle records DP + receipt first and invoice only on service completion', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
  const beforeBooking = structuredClone(f.db.data.get(`bookings/${v.booking.id}`));
  await f.service.runOnce(); assert.equal(f.job(v).state, 'waiting_service'); assert.equal(f.posts().length, 3);
  assert.equal(f.posts('create-down-payment.do')[0].payload.dpAmount, 160000); assert.equal(f.posts('sales-receipt/save.do')[0].payload.bankNo, '110103');
  assert.equal(f.posts('sales-invoice/save.do').length, 0);
  f.advance(360000); Object.assign(f.db.data.get(`bookings/${v.booking.id}`), { status: 'Completed', completedAt: new Date(f.clock()).toISOString() });
  await f.service.runOnce(); assert.equal(f.job(v).state, 'complete'); assert.equal(f.posts().length, 4);
  assert.equal(f.posts('sales-invoice/save.do')[0].payload.detailDownPayment[0].paymentAmount, 160000);
  const after = f.db.data.get(`bookings/${v.booking.id}`); assert.equal(after.paymentStatus, beforeBooking.paymentStatus); assert.equal(after.totalAmount, beforeBooking.totalAmount);
  const views = await f.service.status(req()); assert.deepEqual(views.jobs[0].confirmed, ['down_payment', 'receipt', 'invoice']);
  await f.service.runOnce(); assert.equal(f.posts().length, 4);
  assert.ok(f.db.writes.every(w => w.ref.name.startsWith('accurate_sync_')), 'accounting worker never writes bookings, payments or Meta configuration');
});

test('actual completed webhook enqueues exactly once and retains webhook as the first paid source', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking('HOOK1');
  f.db.data.get(`payments/${v.payment.id}`).status = 'pending'; f.db.data.get(`bookings/${v.booking.id}`).paymentStatus = 'unpaid';
  f.db.data.get(`xendit_live_sessions/${v.intent.referenceId}`).sessionStatus = 'ACTIVE';
  const live = createXenditLive({ ...f.deps, env: { XENDIT_LIVE_SECRET_KEY: 'xnd_production_fixture', XENDIT_LIVE_WEBHOOK_TOKEN: 'fixture_callback', XENDIT_LIVE_BUSINESS_ID: 'merchant_fixture' },
    stagePaid: f.service.stagePaid, fetch: async () => Response.json({ reference_id: v.intent.referenceId, payment_session_id: v.intent.sessionId, payment_id: v.intent.paymentId,
      business_id: 'merchant_fixture', amount: v.payment.amount, currency: 'IDR', country: 'ID', session_type: 'PAY', mode: 'PAYMENT_LINK', status: 'COMPLETED',
      expires_at: v.intent.expiresAt, payment_link_url: 'https://xen.to/fixture_live' }) });
  const request = { body: { event: 'payment_session.completed', business_id: 'merchant_fixture', data: { id: v.intent.sessionId, reference_id: v.intent.referenceId } },
    headers: { 'x-callback-token': 'fixture_callback' }, rawHeaders: ['x-callback-token', 'fixture_callback'], ip: 'fixture', socket: {} };
  await live.webhook(request); await live.webhook(request); await live.refresh(req({ bookingId: v.booking.id }, 'customer1'));
  assert.equal(f.job(v).state, 'queued'); assert.equal([...f.db.data.keys()].filter(k => k.startsWith('accurate_sync_jobs/')).length, 1);
  assert.equal(f.db.data.get(`xendit_live_sessions/${v.intent.referenceId}`).paidSource, 'webhook');
  assert.equal(f.db.data.get(`bookings/${v.booking.id}`).paymentStatus, 'PAID'); assert.equal(f.posts().length, 0);
});
test('visit fee and combined discount reconcile to the locked paid total exactly once', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking('FEE01', { homeServiceFee: 15000, discountAmount: 20000, totalAmount: 155000, promoDiscount: 10000, pointsDiscount: 10000, pointsRedeemed: 10000 });
  await f.queue(v); f.advance(10000); Object.assign(f.db.data.get(`bookings/${v.booking.id}`), { status: 'Completed', completedAt: new Date(f.clock()).toISOString() });
  await f.service.runOnce(); assert.equal(f.job(v).state, 'complete'); const body = f.posts('sales-invoice/save.do')[0].payload;
  assert.equal(body.cashDiscount, 20000); assert.equal(body.detailItem[0].unitPrice, 160000); assert.equal(body.detailExpense[0].expenseAmount, 15000);
  assert.equal(body.detailDownPayment[0].paymentAmount, 155000);
});
test('unsupported services are retained for review without changing payment or contacting Accurate', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking('NEW01', { serviceName: 'Unmapped new service' }); await f.queue(v); await f.service.runOnce();
  assert.equal(f.job(v).state, 'review'); assert.equal(f.job(v).issue, 'SYNC_SERVICE_UNMAPPED'); assert.equal(f.calls.length, 0);
});
test('Test/manual/mismatched/refunded/corrected or changed records can never post', async () => {
  for (const change of [v => v.booking.gatewayEnvironment = 'test', v => v.booking.paymentMethod = 'Manual',
    v => v.payment.amount++, v => v.intent.paymentId = 'py-other00000000000000000000', v => v.receipt.gatewayQuoteHash = 'bad',
    v => v.payment.correctedAt = new Date().toISOString(), v => v.payment.reconciliationRequired = true]) {
    const f = fixture(); f.activateControl(); const v = f.booking(); change(v); await f.queue(v); await f.service.runOnce(); assert.equal(f.posts().length, 0); assert.equal(f.job(v).state, 'review');
  }
  for (const change of [db => db.get('bookings').status = 'Cancelled', db => db.get('payments').status = 'refunded', db => db.get('bookings').totalAmount++]) {
    const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
    change(new Map([['bookings', f.db.data.get(`bookings/${v.booking.id}`)], ['payments', f.db.data.get(`payments/${v.payment.id}`)]]));
    await f.service.runOnce(); assert.equal(f.posts().length, 0); assert.equal(f.job(v).state, 'review');
  }
});
test('lost DP response is reconciled on retry without a second POST', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); f.lose('down_payment'); await f.service.runOnce();
  assert.equal(f.job(v).state, 'review'); assert.equal(f.posts('create-down-payment.do').length, 1);
  await f.service.retry(req({ bookingId: v.booking.id })); assert.equal(f.job(v).state, 'waiting_service'); assert.equal(f.posts('create-down-payment.do').length, 1);
});
test('uncertain create with no provider record is never resent, including explicit retry', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); f.absent('down_payment'); await f.service.runOnce();
  const before = f.posts().length; assert.equal(f.job(v).issue, 'ACCURATE_DOCUMENT_UNCERTAIN'); f.absent(null);
  await f.service.retry(req({ bookingId: v.booking.id })); assert.equal(f.job(v).state, 'review'); assert.equal(f.posts().length, before);
  const view = (await f.service.status(req())).jobs[0]; assert.match(view.downPaymentNumber, /^SHDP-/); assert.equal(view.confirmed.includes('down_payment'), false);
});
test('lost receipt and invoice responses recover by number while preserving one create per operation', async () => {
  for (const kind of ['receipt', 'invoice']) {
    const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
    if (kind === 'invoice') { f.advance(10000); Object.assign(f.db.data.get(`bookings/${v.booking.id}`), { status: 'Completed', completedAt: new Date(f.clock()).toISOString() }); }
    f.lose(kind); await f.service.runOnce(); assert.equal(f.job(v).state, 'review'); const before = f.posts().length;
    await f.service.retry(req({ bookingId: v.booking.id })); assert.equal(f.posts().length, before); assert.equal(f.job(v).state, kind === 'invoice' ? 'complete' : 'waiting_service');
  }
});
test('wrong existing document is held for review and never updated or replaced', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); await f.service.runOnce();
  const dp = [...f.remote.values()].find(d => d.invoiceDp === true); dp.totalAmount++;
  await f.service.retry(req({ bookingId: v.booking.id })); assert.equal(f.job(v).state, 'review'); assert.equal(f.job(v).issue, 'ACCURATE_DOCUMENT_MISMATCH'); assert.equal(f.posts().length, 3);
});
test('revoked or changed source immediately before a create prevents further financial posting', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
  f.respond(call => { if (call.url.pathname.endsWith('sales-receipt/list.do')) f.db.data.get(`bookings/${v.booking.id}`).status = 'Cancelled'; });
  await f.service.runOnce(); assert.equal(f.posts('sales-receipt/save.do').length, 0); assert.equal(f.job(v).state, 'review');
  assert.equal(f.posts('create-down-payment.do').length, 1);
});
test('two instances share a durable lease and never create duplicate records', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); const other = createAccurateSync(f.deps);
  await Promise.all([f.service.runOnce(), other.runOnce()]); assert.equal(f.posts().length, 3); assert.equal(f.job(v).state, 'waiting_service');
});
test('expired processing lease recovers after restart without losing the queued job', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
  Object.assign(f.db.data.get('accurate_sync_private/control'), { leaseToken: 'dead-instance', leaseUntil: f.clock() + 90000 });
  Object.assign(f.job(v), { state: 'processing', wakeAt: f.clock() + 100000 });
  await f.service.runOnce(); assert.equal(f.calls.length, 0); f.advance(100001);
  const restarted = createAccurateSync(f.deps); await restarted.runOnce(); assert.equal(f.job(v).state, 'waiting_service');
});
test('wrong DB, app, host, account currency, service GL or tax blocks all financial writes', async () => {
  for (const change of [f => f.meta.database.id++, f => f.meta.application.appKey = 'other',
    f => f.meta.database.host = 'https://evil.invalid', f => f.masters.get('110103').currency.code = 'USD',
    f => f.masters.get('SH-SIG-030').salesAccount.no = 'other', f => f.masters.get('SH-SIG-030').tax1 = { id: 100 }]) {
    const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); change(f); await f.service.runOnce();
    assert.equal(f.job(v).state, 'review'); assert.equal(f.posts().length, 0);
  }
});
test('upstream read outage remains retryable and never leaks raw provider errors', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
  f.respond(() => new Response(`${token} ${secret} private finance`, { status: 503 })); await f.service.runOnce(); assert.equal(f.job(v).state, 'retry');
  const serialized = JSON.stringify([...f.db.data]); assert.equal(serialized.includes(token), false); assert.equal(serialized.includes(secret), false);
  f.respond(null); f.advance(120000); await f.service.runOnce(); assert.equal(f.job(v).state, 'waiting_service');
});
test('scheduler authenticates a single dedicated token; clients cannot bypass Manager auth', async () => {
  const f = fixture(); const base = { body: {}, headers: { 'x-accurate-worker-token': f.env.ACCURATE_SYNC_WORKER_TOKEN }, rawHeaders: ['X-Accurate-Worker-Token', f.env.ACCURATE_SYNC_WORKER_TOKEN], ip: 'worker' };
  assert.deepEqual(await f.service.scheduled(base), { processed: 0 });
  for (const patch of [{ headers: { 'x-accurate-worker-token': 'wrong' } }, { headers: { 'x-accurate-worker-token': 'é'.repeat(f.env.ACCURATE_SYNC_WORKER_TOKEN.length) } }, { rawHeaders: [...base.rawHeaders, ...base.rawHeaders] },
    { headers: { ...base.headers, authorization: 'Bearer manager' } }, { body: { bookingId: 'anything' } }]) await assert.rejects(f.service.scheduled({ ...base, ...patch }));
  await rejects(f.service.status({ ...req(), headers: { authorization: 'Bearer manager', 'x-accurate-worker-token': f.env.ACCURATE_SYNC_WORKER_TOKEN } }), 'AUTH_INVALID');
});
test('dates use the original paid and completed WIB dates rather than retry time', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); f.advance(2 * 86400000);
  Object.assign(f.db.data.get(`bookings/${v.booking.id}`), { status: 'Completed', completedAt: new Date(f.clock()).toISOString() }); await f.service.runOnce();
  assert.equal(f.job(v).state, 'complete'); assert.equal(f.posts('create-down-payment.do')[0].payload.transDate, '22/10/2026'); assert.equal(f.posts('sales-invoice/save.do')[0].payload.transDate, '24/10/2026');
});
test('verification across WIB midnight is held for Finance instead of inventing a gateway payment date', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking();
  v.payment.paidAt = '2026-10-23T02:00:00Z'; await f.queue(v); await f.service.runOnce();
  assert.equal(f.job(v).state, 'review'); assert.equal(f.job(v).issue, 'SYNC_PAYMENT_DATE_REVIEW_REQUIRED'); assert.equal(f.calls.length, 0);
});
test('same customer across bookings is reused without overwriting name or creating duplicate customer', async () => {
  const f = fixture(); f.activateControl(); const one = f.booking(); await f.queue(one); await f.service.runOnce();
  f.advance(1000); const two = f.booking('FIX02', { customerName: 'Changed customer name' }); await f.queue(two); await f.service.runOnce();
  assert.equal(f.job(two).state, 'waiting_service'); assert.equal(f.posts('customer/save.do').length, 1); assert.equal(f.posts('create-down-payment.do').length, 2);
});
test('Express routes expose safe results, preserve no-store and never emit raw upstream bodies', async () => {
  const f = fixture(); const app = express(); app.use(express.json()); const service = registerAccurateSync(app, f.deps);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (action, body = {}, bearer = 'manager') => fetch(`${origin}/api/integrations/accurate/sync/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const status = await call('status'); assert.equal(status.status, 200); assert.match(status.headers.get('cache-control'), /no-store/);
    assert.equal((await call('status', { amount: 100 })).status, 400); assert.equal((await call('activate', {})).status, 400);
    f.meta.database.host = 'https://evil.invalid'; const bad = await call('activate', approve); assert.equal(bad.status, 409); const text = await bad.text();
    assert.equal(text.includes(token), false); assert.equal(text.includes(secret), false); assert.equal(text.includes('stack'), false);
  } finally { service.stop(); await new Promise(r => server.close(r)); }
});
