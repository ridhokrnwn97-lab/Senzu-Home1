// OFFLINE ONLY. All provider responses, Firebase data and credentials are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { createHash, createHmac } from 'node:crypto';
import express from 'express';
import { createAccurateSync, registerAccurateSync } from '../src/server/accurateSync.ts';
import { createAccurateSyncProvider } from '../src/server/accurateSyncProvider.ts';
import { createXenditLive } from '../src/server/xenditLive.ts';
import { feePlan, matchesFeeJournal } from '../src/server/accurateFeePosting.ts';
import { liveQuoteSeal } from '../src/server/xenditLiveQuote.ts';
import { ACCURATE_MASTERS, ACCURATE_APP_KEY, ACCURATE_APP_NAME, ACCURATE_COMPANY } from '../src/lib/accurateContracts.ts';
import { ACCURATE_SYNC_ACK, ACCURATE_FEE_ACK, ACCURATE_SYNC_DATABASE_ID as TARGET, isAccurateXenditStateDiagnostic } from '../src/lib/accurateSyncContracts.ts';
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
        salesGlAccount: { no: '400005' }, salesDiscountGlAccount: { no: '400004' }, tax1: null, tax2: null, tax3: null, tax4: null, usePpn: false }) }]));
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
      assert.equal(url.searchParams.get('fields'), type === 'customer' ? 'id,customerNo' : 'id,number');
      return Response.json({ s: true, d: [...remote.values()].filter(v => v._type === type && (type === 'customer' ? v.customerNo : v.number) === number).map(v => ({ id: v.id, [type === 'customer' ? 'customerNo' : 'number']: number })) });
    }
    if (action === 'detail.do') return Response.json({ s: true, d: [...remote.values()].find(v => v._type === type && v.id === Number(url.searchParams.get('id'))) });
    assert.equal(init.method, 'POST'); assert.equal(payload.id, undefined, 'never update existing provider records');
    const kind = type === 'journal-voucher' ? 'fee' : type === 'customer' ? 'customer' : type === 'sales-receipt' ? 'receipt' : action === 'create-down-payment.do' ? 'down_payment' : 'invoice';
    if (absentKind === kind) throw new Error(`fixture unavailable ${token} ${secret}`);
    const id = remote.size + 100, common = { id, _type: type, currency: { code: 'IDR' }, ...payload };
    let d;
    if (kind === 'customer') {
      d = { ...common, customerReceivableAccountList: [{ no: '110301' }], customerDownPaymentAccountList: [{ no: '210102' }] };
      delete d.number; delete d.customerReceivableAccountListNo; delete d.customerDownPaymentAccountListNo;
    }
    else if (kind === 'down_payment') d = { ...common, invoiceDp: true, totalAmount: payload.dpAmount, taxable: payload.isTaxable, customer: { customerNo: payload.customerNo } };
    else if (kind === 'receipt') d = { ...common, bank: { no: payload.bankNo }, customer: { customerNo: payload.customerNo }, detailInvoice: payload.detailInvoice.map(x => ({ invoice: { number: x.invoiceNo }, paymentAmount: x.paymentAmount })) };
    else if (kind === 'fee') d = { ...common, detailJournalVoucher: payload.detailJournalVoucher.map(r => ({ ...r, account: { no: r.accountNo, currency: { code: 'IDR' } } })) };
    else d = { ...common, customer: { customerNo: payload.customerNo }, totalAmount: payload.detailItem.reduce((s, v) => s + v.unitPrice * v.quantity, 0) + payload.detailExpense.reduce((s, v) => s + v.expenseAmount, 0) - payload.cashDiscount, primeOwing: 0 };
    if (kind !== 'customer') delete d.customerNo;
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
test('documented GlAccount objects verify the correct sales and discount accounts without writes', async () => {
  const f = fixture(), v = f.booking(); f.advance(1000);
  const result = await f.service.preview(req({ bookingId: v.booking.id }));
  assert.equal(result.itemCode, 'SH-SIG-030'); assert.equal(result.historical, true); assert.equal(f.posts().length, 0);
});
test('documented GlAccountNo strings and previous account shapes are compatible', async () => {
  for (const format of ['gl_no', 'legacy_object', 'legacy_no', 'idr_detail']) {
    const f = fixture(), v = f.booking(); f.advance(1000);
    for (const data of f.masters.values()) if (data.itemType === 'SERVICE') {
      delete data.salesGlAccount; delete data.salesDiscountGlAccount;
      if (format === 'gl_no') Object.assign(data, { salesGlAccountNo: '400005', salesDiscountGlAccountNo: '400004' });
      if (format === 'legacy_object') Object.assign(data, { salesAccount: { no: '400005' }, salesDiscountAccount: { no: '400004' } });
      if (format === 'legacy_no') Object.assign(data, { salesAccountNo: '400005', salesDiscountAccountNo: '400004' });
      if (format === 'idr_detail') data.detailItemAccount = [{ currency: { code: 'IDR' }, salesGlAccount: { no: '400005' }, salesDiscountGlAccountNo: '400004' }];
    }
    assert.equal((await f.service.preview(req({ bookingId: v.booking.id }))).itemCode, 'SH-SIG-030'); assert.equal(f.posts().length, 0);
  }
});
test('consistent aliases agree; conflicting aliases and multiple IDR mappings fail closed', async () => {
  const f = fixture(), v = f.booking(); f.advance(1000);
  Object.assign(f.masters.get('SH-SIG-030'), { salesGlAccountNo: '400005', salesAccountNo: '400005', salesDiscountAccount: { no: '400004' } });
  assert.equal((await f.service.preview(req({ bookingId: v.booking.id }))).itemCode, 'SH-SIG-030');
  for (const change of [d => d.salesAccountNo = '400006', d => d.salesGlAccountNo = '400006',
    d => d.salesDiscountAccountNo = '400003', d => d.detailItemAccount = [{ currencyCode: 'IDR' }, { currencyCode: 'IDR' }]]) {
    const g = fixture(), b = g.booking(); g.advance(1000); change(g.masters.get('SH-SIG-030'));
    await rejects(g.service.preview(req({ bookingId: b.booking.id })), 'ACCURATE_ITEM_ACCOUNTS_UNVERIFIED'); assert.equal(g.posts().length, 0);
  }
});
test('missing, malformed and unrelated account fields cannot stand in for verified item mappings', async () => {
  for (const change of [d => delete d.salesGlAccount, d => d.salesGlAccount.no = 400005,
    d => d.salesGlAccount.no = '', d => d.salesDiscountGlAccount.no = '400003',
    d => { delete d.salesGlAccount; d.inventoryGlAccount = { no: '400005' }; }]) {
    const f = fixture(), v = f.booking(); f.advance(1000); change(f.masters.get('SH-SIG-030'));
    await rejects(f.service.preview(req({ bookingId: v.booking.id })), 'ACCURATE_ITEM_ACCOUNTS_UNVERIFIED'); assert.equal(f.posts().length, 0);
  }
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
test('customer lookup reads customerNo, keeps filter.no and verifies every supplied identity alias', async () => {
  const number = 'SHC-offline_customer';
  for (const shape of [{ customerNo: number }, { no: number }, { customerNo: number, no: number }]) {
    const f = fixture();
    f.respond(({ url }) => {
      if (url.pathname.endsWith('customer/list.do')) {
        assert.equal(url.searchParams.get('fields'), 'id,customerNo');
        assert.equal(url.searchParams.get('filter.no.op'), 'EQUAL');
        assert.equal(url.searchParams.get('filter.no.val'), number);
        assert.equal(url.searchParams.has('filter.customerNo.val'), false);
        return Response.json({ s: true, d: [{ id: 123, ...shape }] });
      }
      if (url.pathname.endsWith('customer/detail.do')) return Response.json({ s: true, d: { id: 123, ...shape, notes: 'fixture' } });
    });
    const api = await createAccurateSyncProvider(f.deps).connect(f.clock() + 60000);
    assert.deepEqual(await api.lookup('customer', number), { id: 123, ...shape, notes: 'fixture' });
    assert.equal(f.posts().length, 0);
  }
});
test('missing, malformed, conflicting, duplicate or changed customer identities block lookup without POST', async () => {
  const number = 'SHC-offline_customer';
  const bad = [{}, { number }, { customerNo: 'foreign' }, { customerNo: '' }, { customerNo: null },
    { customerNo: 123 }, { customerNo: number, no: 'foreign' }, { customerNo: number, no: null }];
  for (const stage of ['list', 'detail']) for (const shape of bad) {
    const f = fixture();
    f.respond(({ url }) => {
      if (url.pathname.endsWith('customer/list.do')) return Response.json({ s: true, d: [{ id: 123, ...(stage === 'list' ? shape : { customerNo: number }) }] });
      if (url.pathname.endsWith('customer/detail.do')) return Response.json({ s: true, d: { id: 123, ...(stage === 'detail' ? shape : { customerNo: number }) } });
    });
    const api = await createAccurateSyncProvider(f.deps).connect(f.clock() + 60000);
    await rejects(api.lookup('customer', number), 'ACCURATE_DOCUMENT_COLLISION'); assert.equal(f.posts().length, 0);
  }
  for (const mismatch of ['duplicate', 'id']) {
    const f = fixture();
    f.respond(({ url }) => {
      if (url.pathname.endsWith('customer/list.do')) return Response.json({ s: true, d: mismatch === 'duplicate' ?
        [{ id: 123, customerNo: number }, { id: 124, customerNo: number }] : [{ id: 123, customerNo: number }] });
      if (url.pathname.endsWith('customer/detail.do')) return Response.json({ s: true, d: { id: 124, customerNo: number } });
    });
    const api = await createAccurateSyncProvider(f.deps).connect(f.clock() + 60000);
    await rejects(api.lookup('customer', number), 'ACCURATE_DOCUMENT_COLLISION'); assert.equal(f.posts().length, 0);
  }
});
test('saved customer from a parked collision recovers after restart with the original sending receipt and no second customer POST', async () => {
  const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
  const beforeBooking = structuredClone(f.db.data.get(`bookings/${v.booking.id}`));
  const beforePayment = structuredClone(f.db.data.get(`payments/${v.payment.id}`));
  // Emulate the old field selection: the customer is saved but its number is
  // absent from the requested projection. The durable sending receipt survives.
  f.respond(({ url }) => url.pathname.endsWith('customer/list.do') && f.remote.size ?
    Response.json({ s: true, d: [{ id: [...f.remote.values()][0].id }] }) : null);
  await f.service.runOnce(); assert.equal(f.job(v).issue, 'ACCURATE_DOCUMENT_COLLISION');
  assert.equal(f.posts().length, 1); assert.equal(f.posts('customer/save.do').length, 1);
  const [opPath, op] = [...f.db.data].find(([path]) => path.startsWith('accurate_sync_operations/'));
  const original = structuredClone(op); assert.equal(original.state, 'sending');
  assert.equal(original.fingerprint, h({ ...f.posts('customer/save.do')[0].payload, name: null, transDate: null }));
  f.respond(null); const restarted = createAccurateSync(f.deps);
  await restarted.retry(req({ bookingId: v.booking.id }));
  assert.equal(f.job(v).state, 'waiting_service'); assert.equal(f.posts('customer/save.do').length, 1);
  assert.equal(f.posts('create-down-payment.do').length, 1); assert.equal(f.posts('sales-receipt/save.do').length, 1);
  assert.equal(f.db.data.get(opPath).state, 'confirmed'); assert.equal(f.db.data.get(opPath).fingerprint, original.fingerprint);
  assert.equal(f.db.data.get(opPath).createdAt, original.createdAt);
  assert.deepEqual(f.db.data.get(`bookings/${v.booking.id}`), beforeBooking);
  assert.deepEqual(f.db.data.get(`payments/${v.payment.id}`), beforePayment);
  await restarted.retry(req({ bookingId: v.booking.id })); assert.equal(f.posts().length, 3);
});
test('lost customer response recovers by canonical number and missing customer is never recreated', async () => {
  for (const saved of [true, false]) {
    const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
    if (saved) f.lose('customer'); else f.absent('customer');
    await f.service.runOnce(); assert.equal(f.job(v).issue, 'ACCURATE_DOCUMENT_UNCERTAIN');
    assert.equal(f.posts('customer/save.do').length, 1); f.absent(null);
    const restarted = createAccurateSync(f.deps); await restarted.retry(req({ bookingId: v.booking.id }));
    assert.equal(f.posts('customer/save.do').length, 1);
    assert.equal(f.job(v).state, saved ? 'waiting_service' : 'review');
    assert.equal(f.posts().length, saved ? 3 : 1);
  }
});
test('customer recovery retains ownership and account validation, including legacy detail responses', async () => {
  for (const shape of ['legacy', 'marker', 'receivable', 'down_payment']) {
    const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v); f.lose('customer');
    await f.service.runOnce(); const customer = [...f.remote.values()][0];
    if (shape === 'legacy') f.respond(({ url }) => {
      if (!url.pathname.endsWith('customer/detail.do')) return null;
      const d = { ...customer, no: customer.customerNo }; delete d.customerNo;
      return Response.json({ s: true, d });
    });
    if (shape === 'marker') customer.notes = 'foreign customer';
    if (shape === 'receivable') customer.customerReceivableAccountList = [{ no: 'foreign' }];
    if (shape === 'down_payment') customer.customerDownPaymentAccountList = [{ no: 'foreign' }];
    await f.service.retry(req({ bookingId: v.booking.id }));
    assert.equal(f.posts('customer/save.do').length, 1);
    assert.equal(f.job(v).state, shape === 'legacy' ? 'waiting_service' : 'review');
    if (shape !== 'legacy') { assert.equal(f.job(v).issue, 'ACCURATE_DOCUMENT_MISMATCH'); assert.equal(f.posts().length, 1); }
  }
});
test('financial customer references accept canonical and legacy aliases only when all supplied values agree', async () => {
  for (const stage of ['down_payment', 'receipt', 'invoice']) for (const shape of ['canonical', 'legacy', 'root', 'agree', 'conflict', 'null', 'missing']) {
    const f = fixture(); f.activateControl(); const v = f.booking(); await f.queue(v);
    f.advance(10000); Object.assign(f.db.data.get(`bookings/${v.booking.id}`), { status: 'Completed', completedAt: new Date(f.clock()).toISOString() });
    await f.service.runOnce(); assert.equal(f.job(v).state, 'complete');
    const doc = [...f.remote.values()].find(d => stage === 'receipt' ? d._type === 'sales-receipt' : d._type === 'sales-invoice' && d.invoiceDp === (stage === 'down_payment'));
    const number = doc.customer.customerNo; delete doc.customerNo;
    if (shape === 'legacy') doc.customer = { no: number };
    if (shape === 'root') { delete doc.customer; doc.customerNo = number; }
    if (shape === 'agree') { doc.customer = { customerNo: number, no: number }; doc.customerNo = number; }
    if (shape === 'conflict') { doc.customer.no = number; doc.customerNo = 'foreign'; }
    if (shape === 'null') doc.customer.no = null;
    if (shape === 'missing') doc.customer = {};
    // Revisit an existing job without resetting any operation receipts.
    Object.assign(f.job(v), { state: 'review', issue: 'ACCURATE_DOCUMENT_MISMATCH' });
    await f.service.retry(req({ bookingId: v.booking.id }));
    assert.equal(f.job(v).state, ['conflict', 'null', 'missing'].includes(shape) ? 'review' : 'complete');
    assert.equal(f.posts().length, 4, 'rechecking existing documents never sends another financial POST');
  }
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
    f => f.masters.get('SH-SIG-030').salesGlAccount.no = 'other', f => f.masters.get('SH-SIG-030').tax1 = { id: 100 },
    f => f.masters.get('SH-SIG-030').tax4 = { id: 400 }, f => f.masters.get('SH-SIG-030').usePpn = true]) {
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

// Transaction API fixtures are offline. The amounts model the observed Mandiri
// payment; the API envelope/field names follow Xendit's List Transactions docs.
function netFixture() {
  const f = fixture(), v = f.booking();
  f.env.XENDIT_LIVE_SECRET_KEY = 'xnd_production_offline_fixture_key';
  f.env.XENDIT_LIVE_BUSINESS_ID = 'business_offline_fixture';
  f.env.XENDIT_LIVE_ENABLED = 'false'; // Historical reads remain possible while new checkout is disabled.
  const paymentId = 'py-123e4567-e89b-12d3-a456-426614174000';
  f.db.data.get(`payments/${v.payment.id}`).providerTransactionId = paymentId;
  f.db.data.get(`xendit_live_sessions/${v.intent.referenceId}`).paymentId = paymentId;
  const row = { id: '123e4567-e89b-12d3-a456-426614174111', product_id: paymentId.slice(3),
    business_id: f.env.XENDIT_LIVE_BUSINESS_ID, reference_id: v.intent.referenceId, type: 'PAYMENT', status: 'SUCCESS',
    cashflow: 'MONEY_IN', channel_category: 'VIRTUAL_ACCOUNT', channel_code: 'MANDIRI', currency: 'IDR', amount: 160000,
    net_amount: 150010, net_amount_currency: 'IDR', settlement_status: 'SETTLED', created: new Date(f.clock()).toISOString(), updated: new Date(f.clock()).toISOString(),
    fee: { xendit_fee: 9000, value_added_tax: 990, xendit_withholding_tax: 0, third_party_withholding_tax: 0, status: 'COMPLETED' } };
  const state = { value: { has_more: false, data: [row], links: [] }, response: null, error: null, onRead: null }, calls = [];
  const deps = { ...f.deps, fetch: async (input, init) => {
    const url = new URL(input); calls.push({ url, init });
    assert.equal(url.origin, 'https://api.xendit.co'); assert.equal(url.pathname, '/transactions');
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${f.env.XENDIT_LIVE_SECRET_KEY}:`).toString('base64')}`);
    assert.equal(init.headers['for-user-id'], undefined);
    assert.deepEqual(Object.fromEntries(url.searchParams), { reference_id: v.intent.referenceId, types: 'PAYMENT', currency: 'IDR', limit: '2' });
    await state.onRead?.(); if (state.error) throw state.error;
    return state.response || Response.json(state.value);
  } };
  const service = createAccurateSync(deps);
  return { ...f, v, row, state, netCalls: calls, netDeps: deps, net: () => service.netPreview(req({ bookingId: v.booking.id })), netService: service };
}
test('SUCCESS and observed SUCCESSFUL settled Mandiri payments verify the same net without accounting credentials, writes, queueing or payment refresh', async () => {
  for (const status of ['SUCCESS', 'SUCCESSFUL']) {
    const f = netFixture(); f.row.status = status;
    delete f.env.ACCURATE_API_TOKEN; delete f.env.ACCURATE_SIGNATURE_SECRET; delete f.env.ACCURATE_SYNC_WRITES_ENABLED;
    const before = structuredClone([...f.db.data]), result = await f.net();
    assert.equal(result.mode, 'xendit_net_preview_v1');
    assert.equal(result.grossAmount, 160000); assert.equal(result.xenditFee, 9000); assert.equal(result.valueAddedTax, 990); assert.equal(result.netAmount, 150010);
    assert.equal(result.productId, f.row.product_id); assert.equal(result.readOnly, true); assert.equal(result.processingFeeIncluded, false); assert.equal(result.bankPayoutVerified, false);
    assert.equal(result.checkedAt, new Date(f.clock()).toISOString()); assert.equal(f.netCalls.length, 1); assert.equal(f.calls.length, 0);
    assert.deepEqual([...f.db.data], before); assert.deepEqual(f.db.writes, []); assert.equal(f.job(f.v), undefined);
    for (const field of ['business_id', 'account_identifier', 'customer', 'key', 'Authorization', 'fee']) assert.equal(Object.hasOwn(result, field), false);
  }
});
test('similar, nonfinal, refunded, missing and malformed status spellings remain unverified diagnostics without net values', async () => {
  for (const status of ['SUCCESSFUL ', ' SUCCESSFUL', 'successful', 'Successful', 'success', 'SUCCEEDED', 'COMPLETED', 'SETTLED',
    'PAID', 'PENDING', 'FAILED', 'VOIDED', 'REVERSED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING', '', null, undefined, true, 1, [], {}]) {
    const f = netFixture(); f.row.status = status; const before = structuredClone([...f.db.data]), result = await f.net();
    assert.equal(isAccurateXenditStateDiagnostic(result), true); assert.equal(result.verified, false);
    for (const field of ['grossAmount', 'netAmount', 'xenditFee', 'valueAddedTax']) assert.equal(Object.hasOwn(result, field), false);
    assert.equal(f.netCalls.length, 1); assert.equal(f.calls.length, 0); assert.deepEqual(f.db.writes, []); assert.deepEqual([...f.db.data], before);
  }
});
test('SUCCESSFUL still requires matching identity, amounts, currencies, finalized fees, zero withholding and exact net calculation', async () => {
  for (const [change, code] of [
    [f => f.row.business_id = 'foreign_business', 'XENDIT_BUSINESS_MISMATCH'],
    [f => f.row.reference_id = 'foreign_reference', 'XENDIT_REFERENCE_MISMATCH'],
    [f => f.row.product_id = 'foreign_product', 'XENDIT_PRODUCT_MISMATCH'],
    [f => f.row.amount++, 'XENDIT_AMOUNT_MISMATCH'],
    [f => f.row.currency = 'USD', 'XENDIT_CURRENCY_UNVERIFIED'],
    [f => f.row.net_amount_currency = 'USD', 'XENDIT_CURRENCY_UNVERIFIED'],
    [f => f.row.fee.status = 'PENDING', 'XENDIT_FEES_PENDING'],
    [f => f.row.settlement_status = 'PENDING', 'XENDIT_SETTLEMENT_PENDING'],
    [f => delete f.row.fee.xendit_fee, 'XENDIT_FEE_AMOUNT_UNVERIFIED'],
    [f => delete f.row.fee.value_added_tax, 'XENDIT_FEE_VAT_UNVERIFIED'],
    [f => delete f.row.fee.xendit_withholding_tax, 'XENDIT_FEE_WITHHOLDING_UNVERIFIED'],
    [f => delete f.row.fee.third_party_withholding_tax, 'XENDIT_FEE_WITHHOLDING_UNVERIFIED'],
    [f => f.row.fee.xendit_withholding_tax = 1, 'XENDIT_WITHHOLDING_REVIEW'],
    [f => f.row.fee.third_party_withholding_tax = 1, 'XENDIT_WITHHOLDING_REVIEW'],
    [f => f.row.net_amount--, 'XENDIT_NET_AMOUNT_UNVERIFIED']]) {
    const f = netFixture(); f.row.status = 'SUCCESSFUL'; change(f); const before = structuredClone([...f.db.data]);
    await rejects(f.net(), code); assert.equal(f.netCalls.length, 1); assert.equal(f.calls.length, 0);
    assert.deepEqual(f.db.writes, []); assert.deepEqual([...f.db.data], before);
  }
  for (const [field, value] of [['type', 'REFUND'], ['type', 'WITHDRAWAL'], ['type', 'VA_PAYMENT'], ['cashflow', 'MONEY_OUT'], ['cashflow', 'CREDIT']]) {
    const f = netFixture(); f.row.status = 'SUCCESSFUL'; f.row[field] = value; const d = await f.net();
    assert.equal(isAccurateXenditStateDiagnostic(d), true); assert.equal(d.verified, false); assert.equal(Object.hasOwn(d, 'netAmount'), false);
    assert.deepEqual(f.db.writes, []); assert.equal(f.calls.length, 0);
  }
});
test('an otherwise valid SUCCESSFUL payment cannot be mislabeled as a failed state diagnostic', async () => {
  const f = netFixture(); f.row.status = 'SUCCESSFUL'; f.row.cashflow = 'MONEY_OUT'; const d = await f.net();
  assert.equal(isAccurateXenditStateDiagnostic(d), true);
  d.checks.cashflow = { kind: 'known', value: 'MONEY_IN' };
  assert.equal(isAccurateXenditStateDiagnostic(d), false);
  d.checks.status.kind = 'case_variant'; assert.equal(isAccurateXenditStateDiagnostic(d), true);
});
test('net preview supports canonical payment products, other channel fees and exact fractional IDR amounts without guessing zero', async () => {
  for (const free of [false, true]) {
    const f = netFixture(); f.row.product_id = `py-${f.row.product_id}`; f.row.channel_category = 'QR_CODE'; f.row.channel_code = 'QRIS';
    Object.assign(f.row.fee, { xendit_fee: free ? 0 : 1120, value_added_tax: free ? 0 : 123.2 });
    f.row.net_amount = free ? 160000 : 158756.8;
    const result = await f.net(); assert.equal(result.netAmount, f.row.net_amount); assert.equal(result.valueAddedTax, free ? 0 : 123.2); assert.deepEqual(f.db.writes, []);
  }
});
test('net preview rejects Test/manual/unpaid/review/canceled sources and inactive or non-Manager staff before any provider request', async () => {
  for (const change of [f => f.db.data.get(`bookings/${f.v.booking.id}`).paymentMethod = 'Manual',
    f => f.db.data.get(`payments/${f.v.payment.id}`).gatewayEnvironment = 'test',
    f => f.db.data.get(`payments/${f.v.payment.id}`).status = 'pending',
    f => f.db.data.get(`payments/${f.v.payment.id}`).reconciliationRequired = true,
    f => f.db.data.get(`bookings/${f.v.booking.id}`).status = 'Cancelled',
    f => f.db.data.get(`bookings/${f.v.booking.id}`).totalAmount++,
    f => f.db.data.get('staff_roles/manager').isActive = false,
    f => staff(f.db, 'manager', 'therapist')]) {
    const f = netFixture(); change(f); const before = structuredClone([...f.db.data]);
    await assert.rejects(f.net()); assert.equal(f.netCalls.length, 0); assert.deepEqual([...f.db.data], before); assert.deepEqual(f.db.writes, []);
  }
});
test('net preview rejects body overrides and invalid Live configuration without reading secrets from the client', async () => {
  for (const body of [{ bookingId: 'bk_SH-261022-FIX01', amount: 1 }, { bookingId: 'bk_SH-261022-FIX01', url: 'https://evil.invalid' },
    { bookingId: 'bk_SH-261022-FIX01', businessId: 'other' }, { bookingId: '../private' }]) {
    const f = netFixture(); await rejects(f.netService.netPreview(req(body)), 'INVALID_SYNC_REQUEST'); assert.equal(f.netCalls.length, 0);
  }
  for (const change of [f => f.env.XENDIT_LIVE_SECRET_KEY = 'xnd_development_fixture', f => delete f.env.XENDIT_LIVE_SECRET_KEY,
    f => f.env.XENDIT_LIVE_BUSINESS_ID = '', f => f.env.XENDIT_LIVE_SECRET_KEY += '\n']) {
    const f = netFixture(); change(f); await rejects(f.net(), 'XENDIT_NET_NOT_CONFIGURED'); assert.equal(f.netCalls.length, 0); assert.deepEqual(f.db.writes, []);
  }
});
test('net preview blocks mismatched identity and amounts; unsuccessful or non-payment states produce diagnostics without net values', async () => {
  const issues = { business_id: 'XENDIT_BUSINESS_MISMATCH', reference_id: 'XENDIT_REFERENCE_MISMATCH', product_id: 'XENDIT_PRODUCT_MISMATCH',
    amount: 'XENDIT_AMOUNT_MISMATCH', currency: 'XENDIT_CURRENCY_UNVERIFIED', net_amount_currency: 'XENDIT_CURRENCY_UNVERIFIED',
    cashflow: 'XENDIT_STATE_UNVERIFIED', status: 'XENDIT_STATE_UNVERIFIED', type: 'XENDIT_STATE_UNVERIFIED',
    id: 'XENDIT_TRANSACTION_META_UNVERIFIED', updated: 'XENDIT_TRANSACTION_META_UNVERIFIED', channel_code: 'XENDIT_TRANSACTION_META_UNVERIFIED' };
  for (const [key, value] of [['business_id', 'foreign_business'], ['reference_id', 'foreign_ref'], ['product_id', 'foreign_product'],
    ['product_id', 'va_payment_123e4567-e89b-12d3-a456-426614174000'], ['product_id', null], ['amount', 160001], ['amount', '160000'],
    ['currency', 'USD'], ['net_amount_currency', 'USD'], ['cashflow', 'MONEY_OUT'], ['status', 'REVERSED'], ['status', 'PENDING'],
    ['type', 'WITHDRAWAL'], ['id', 'https://evil.invalid'], ['updated', null], ['channel_code', '<script>']]) {
    const f = netFixture(); f.row[key] = value;
    if (['cashflow', 'status', 'type'].includes(key)) {
      const diagnostic = await f.net(); assert.equal(isAccurateXenditStateDiagnostic(diagnostic), true); assert.equal(diagnostic.verified, false);
      assert.equal(diagnostic.checks[key].value, value); assert.equal(Object.hasOwn(diagnostic, 'netAmount'), false);
    } else await rejects(f.net(), issues[key]);
    assert.deepEqual(f.db.writes, []);
  }
});
test('net preview refuses ambiguous or paginated results and never follows navigation URLs', async () => {
  for (const [change, code] of [[f => f.state.value.has_more = true, 'XENDIT_LIST_MULTIPLE_RESULTS'],
    [f => delete f.state.value.has_more, 'XENDIT_LIST_PAGINATION_UNVERIFIED'],
    [f => f.state.value.has_more = 'false', 'XENDIT_LIST_PAGINATION_UNVERIFIED'],
    [f => f.state.value.data.push(structuredClone(f.row)), 'XENDIT_LIST_MULTIPLE_RESULTS'],
    [f => f.state.value.data = null, 'XENDIT_LIST_FORMAT_UNVERIFIED'], [f => delete f.state.value.links, 'XENDIT_LIST_FORMAT_UNVERIFIED']]) {
    const f = netFixture(); change(f); await rejects(f.net(), code); assert.equal(f.netCalls.length, 1); assert.deepEqual(f.db.writes, []);
  }
  const f = netFixture(); f.state.value.data = []; await rejects(f.net(), 'XENDIT_TRANSACTION_NOT_FOUND'); assert.equal(f.netCalls.length, 1);
});
test('one verified payment with has_more false can include navigation links without following or exposing them', async () => {
  for (const href of ['/transactions?after_id=fixture', 'https://api.xendit.co/transactions?after_id=fixture', 'https://evil.invalid/private']) {
    const f = netFixture(); f.state.value.links = [{ rel: 'next', href, method: 'GET' }, { rel: 'previous', href: '/transactions?before_id=fixture', method: 'GET' }];
    const before = structuredClone([...f.db.data]), result = await f.net();
    assert.equal(result.netAmount, 150010); assert.equal(f.netCalls.length, 1); assert.equal(f.calls.length, 0);
    assert.equal(JSON.stringify(result).includes(href), false); assert.deepEqual([...f.db.data], before); assert.deepEqual(f.db.writes, []);
    f.state.value.has_more = true; await rejects(f.net(), 'XENDIT_LIST_MULTIPLE_RESULTS'); assert.equal(f.netCalls.length, 2);
  }
});
test('malformed JSON or list rows have a specific safe format error instead of a guessed payment', async () => {
  for (const body of ['<html>private response</html>', 'null', '{"data":[],"has_more":false}', '{"data":[null],"has_more":false,"links":[]}',
    '{"data":[[]],"has_more":false,"links":[]}']) {
    const f = netFixture(); f.state.response = new Response(body, { status: 200 });
    await rejects(f.net(), 'XENDIT_LIST_FORMAT_UNVERIFIED'); assert.equal(f.netCalls.length, 1); assert.deepEqual(f.db.writes, []);
  }
});
test('missing, pending or nonfinal fees and settlement never display a verified net; nonzero withholding waits Finance', async () => {
  for (const status of ['PENDING', 'NOT_APPLICABLE', 'CANCELED', 'REVERSED', null, undefined]) {
    const f = netFixture(); f.row.fee.status = status; await rejects(f.net(), 'XENDIT_FEES_PENDING'); assert.deepEqual(f.db.writes, []);
  }
  for (const field of ['xendit_fee', 'value_added_tax', 'xendit_withholding_tax', 'third_party_withholding_tax']) {
    const issue = field === 'xendit_fee' ? 'XENDIT_FEE_AMOUNT_UNVERIFIED' : field === 'value_added_tax' ? 'XENDIT_FEE_VAT_UNVERIFIED' : 'XENDIT_FEE_WITHHOLDING_UNVERIFIED';
    for (const value of [undefined, null, '0', -1, 1.001]) {
      const f = netFixture(); f.row.fee[field] = value; await rejects(f.net(), issue); assert.deepEqual(f.db.writes, []);
    }
  }
  for (const status of ['PENDING', 'EARLY_SETTLED', null, undefined]) { const f = netFixture(); f.row.settlement_status = status; await rejects(f.net(), 'XENDIT_SETTLEMENT_PENDING'); }
  for (const field of ['xendit_withholding_tax', 'third_party_withholding_tax']) { const f = netFixture(); f.row.fee[field] = 100; await rejects(f.net(), 'XENDIT_WITHHOLDING_REVIEW'); }
  for (const amount of [145570, 150010.001, '150010', null, -1]) { const f = netFixture(); f.row.net_amount = amount; await rejects(f.net(), 'XENDIT_NET_AMOUNT_UNVERIFIED'); }
});
test('a Manager revoked or source changed during the Xendit read cannot receive the preview', async () => {
  for (const change of [f => f.db.data.get('staff_roles/manager').isActive = false,
    f => f.db.data.get(`bookings/${f.v.booking.id}`).status = 'Completed',
    f => f.db.data.get(`payments/${f.v.payment.id}`).amount++,
    f => f.db.data.get(`xendit_live_sessions/${f.v.intent.referenceId}`).paymentId = 'py-foreign0000000000000000',
    f => f.db.data.get(`voucher_checkout_receipts/${f.v.booking.gatewayReceiptId}`).totalAmount++]) {
    const f = netFixture(); f.state.onRead = () => change(f); await assert.rejects(f.net()); assert.equal(f.netCalls.length, 1); assert.deepEqual(f.db.writes, []);
  }
});
test('net API read failures are safe and retrying a preview only performs another GET', async () => {
  for (const [status, code] of [[401, 'XENDIT_TRANSACTION_AUTH_INVALID'], [403, 'XENDIT_TRANSACTION_PERMISSION_REQUIRED'],
    [429, 'XENDIT_TRANSACTION_UNAVAILABLE'], [503, 'XENDIT_TRANSACTION_UNAVAILABLE'], [302, 'XENDIT_TRANSACTION_UNAVAILABLE']]) {
    const f = netFixture(); f.state.response = new Response(`${f.env.XENDIT_LIVE_SECRET_KEY} private body`, { status, headers: { Location: 'https://evil.invalid' } });
    await rejects(f.net(), code); assert.equal(f.netCalls.length, 1); assert.deepEqual(f.db.writes, []);
  }
  const f = netFixture(); f.state.error = new Error(`${f.env.XENDIT_LIVE_SECRET_KEY} private body`);
  await rejects(f.net(), 'XENDIT_TRANSACTION_UNAVAILABLE'); f.state.error = null; const result = await f.net();
  assert.equal(result.netAmount, 150010); assert.equal(f.netCalls.length, 2); assert.deepEqual(f.db.writes, []);
});
test('net preview route requires Manager auth, has no-store, throttles reads and emits no raw upstream errors', async () => {
  const f = netFixture(), app = express(); app.use(express.json()); const service = registerAccurateSync(app, f.netDeps);
  f.row.status = 'SUCCESSFUL';
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (bearer = 'manager') => fetch(`${origin}/api/integrations/accurate/sync/netPreview`, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: f.v.booking.id }) });
  try {
    const invalid = await call('invalid'); assert.equal(invalid.status, 401); assert.equal(f.netCalls.length, 0);
    const good = await call(); assert.equal(good.status, 200); assert.match(good.headers.get('cache-control'), /no-store/); assert.equal((await good.json()).netAmount, 150010);
    f.state.response = new Response(`${f.env.XENDIT_LIVE_SECRET_KEY} private body`, { status: 403 });
    const bad = await call(); assert.equal(bad.status, 502); const text = await bad.text(); assert.match(text, /XENDIT_TRANSACTION_PERMISSION_REQUIRED/);
    assert.equal(text.includes(f.env.XENDIT_LIVE_SECRET_KEY), false); assert.equal(text.includes('private body'), false); assert.equal(text.includes('stack'), false);
    f.state.response = null; assert.equal((await call()).status, 200); assert.equal((await call()).status, 429); assert.equal(f.netCalls.length, 3); assert.deepEqual(f.db.writes, []);
  } finally { service.stop(); await new Promise(r => server.close(r)); }
});
test('specific validation reasons expose neither actual mismatched values nor provider bodies', async () => {
  const f = netFixture(), app = express(); app.use(express.json()); const service = registerAccurateSync(app, f.netDeps);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/accurate/sync/netPreview`;
  const sensitiveFixture = `${f.env.XENDIT_LIVE_SECRET_KEY} private mismatched customer or business`;
  try {
    for (const [field, code] of [['business_id', 'XENDIT_BUSINESS_MISMATCH'], ['reference_id', 'XENDIT_REFERENCE_MISMATCH']]) {
      const prior = f.row[field]; f.row[field] = sensitiveFixture;
      const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer manager', 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: f.v.booking.id }) });
      assert.equal(response.status, 409); assert.match(response.headers.get('cache-control'), /no-store/);
      const result = await response.json(); assert.equal(result.code, code); assert.deepEqual(Object.keys(result).sort(), ['code', 'error', 'success']);
      assert.equal(JSON.stringify(result).includes(sensitiveFixture), false); assert.equal(JSON.stringify(result).includes(f.env.XENDIT_LIVE_SECRET_KEY), false);
      f.row[field] = prior;
    }
    assert.deepEqual(f.db.writes, []);
  } finally { service.stop(); await new Promise(r => server.close(r)); }
});
test('all three observed API states are diagnosed together; missing, null, noncanonical and unknown values never verify net or expose raw data', async () => {
  const privateFixture = 'xnd_production_fixture_private_do_not_render';
  for (const [raw, kind, value] of [[undefined, 'missing', null], [null, 'null', null], ['money_in', 'case_variant', 'MONEY_IN'],
    [privateFixture, 'unrecognized', null], [{ private: privateFixture }, 'invalid_type', null], ['MONEY_OUT', 'known', 'MONEY_OUT']]) {
    const f = netFixture(); f.row.cashflow = raw; const before = structuredClone([...f.db.data]); const diagnostic = await f.net();
    assert.equal(isAccurateXenditStateDiagnostic(diagnostic), true); assert.equal(diagnostic.mode, 'xendit_state_diagnostic_v1'); assert.equal(diagnostic.verified, false);
    assert.deepEqual(diagnostic.checks, { type: { kind: 'known', value: 'PAYMENT' }, status: { kind: 'known', value: 'SUCCESS' }, cashflow: { kind, value } });
    for (const key of ['amount', 'grossAmount', 'netAmount', 'fee', 'xenditFee', 'valueAddedTax', 'productId', 'businessId', 'referenceId']) assert.equal(Object.hasOwn(diagnostic, key), false);
    assert.equal(JSON.stringify(diagnostic).includes(privateFixture), false); assert.equal(f.netCalls.length, 1); assert.equal(f.calls.length, 0);
    assert.deepEqual([...f.db.data], before); assert.deepEqual(f.db.writes, []);
  }
  const f = netFixture(); Object.assign(f.row, { type: 'VA_PAYMENT', status: 'SUCCESSFUL', cashflow: 'CREDIT' }); const d = await f.net();
  assert.deepEqual(Object.values(d.checks).map(s => s.value), ['VA_PAYMENT', 'SUCCESSFUL', 'CREDIT']); assert.equal(Object.hasOwn(d, 'netAmount'), false);
  assert.equal(isAccurateXenditStateDiagnostic({ ...d, verified: true }), false);
  assert.equal(isAccurateXenditStateDiagnostic({ ...d, checks: { ...d.checks, type: { kind: 'known', value: privateFixture } } }), false);
  assert.equal(isAccurateXenditStateDiagnostic({ ...d, private: privateFixture }), false);
});
test('state diagnostics still reauthorize Manager and recheck the source after the provider read', async () => {
  for (const change of [f => f.db.data.get('staff_roles/manager').isActive = false,
    f => f.db.data.get(`bookings/${f.v.booking.id}`).status = 'Completed']) {
    const f = netFixture(); delete f.row.cashflow; f.state.onRead = () => change(f);
    await assert.rejects(f.net()); assert.equal(f.netCalls.length, 1); assert.deepEqual(f.db.writes, []);
  }
});
test('diagnostic HTTP success means only a completed read, with verified false and no financial values or raw secrets', async () => {
  const f = netFixture(), app = express(); app.use(express.json()); const service = registerAccurateSync(app, f.netDeps);
  f.row.status = 'xnd_production_fixture_private'; f.row.cashflow = null;
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/integrations/accurate/sync/netPreview`;
  try {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer manager', 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingId: f.v.booking.id }) });
    const value = await response.json(); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(value.success, true); assert.equal(value.verified, false); assert.equal(isAccurateXenditStateDiagnostic(value), true);
    assert.equal(JSON.stringify(value).includes(f.row.status), false); assert.equal(Object.hasOwn(value, 'netAmount'), false); assert.deepEqual(f.db.writes, []);
  } finally { service.stop(); await new Promise(r => server.close(r)); }
});

// Fee posting integration fixtures: no actual provider credentials or POSTs.
function feeFixture({ activate = true, completed = true } = {}) {
  const f = netFixture(); f.activateControl();
  const c = f.db.data.get('accurate_sync_private/control');
  if (activate) Object.assign(c, { feesEnabled: true, feePolicy: 'expense_including_vat', feesActivatedAt: new Date(f.clock() - 1000).toISOString() });
  const paymentId = 'py-' + f.row.product_id;
  f.v.payment.providerTransactionId = paymentId; f.v.intent.paymentId = paymentId;
  if (completed) {
    f.v.booking.status = 'Completed'; f.v.booking.completedAt = new Date(f.clock()).toISOString();
    Object.assign(f.db.data.get(`bookings/${f.v.booking.id}`), { status: 'Completed', completedAt: f.v.booking.completedAt });
  }
  const service = createAccurateSync({ ...f.deps, fetch: (url, init) => new URL(url).hostname === 'api.xendit.co' ? f.netDeps.fetch(url, init) : f.deps.fetch(url, init) });
  return { ...f, service, c, stage: () => f.db.runTransaction(t => service.stagePaid(t, f.v)),
    retryFee: async () => { f.advance(600000); return service.retry(req({ bookingId: f.v.booking.id })); },
    feePosts: () => f.posts('journal-voucher') };
}
test('fee activation requires explicit Finance policy; no journal is created; cutoff survives pause/resume', async () => {
  const f = feeFixture({ activate: false });
  await rejects(f.service.activateFees(req({ acknowledgement: ACCURATE_FEE_ACK, feePolicy: 'input_vat' })), 'FEE_APPROVAL_REQUIRED');
  const s = await f.service.activateFees(req({ acknowledgement: ACCURATE_FEE_ACK, feePolicy: 'expense_including_vat' }));
  assert.equal(s.feesEnabled, true); const cutoff = s.feesActivatedAt;
  assert.equal(f.feePosts().length, 0);
  await f.service.pauseFees(req()); f.advance(60001);
  const s2 = await f.service.activateFees(req({ acknowledgement: ACCURATE_FEE_ACK, feePolicy: 'expense_including_vat' }));
  assert.equal(s2.feesActivatedAt, cutoff); assert.equal(s2.feesEnabled, true);
});
test('all pre-activation jobs, including the manually recorded booking, stay excluded even on retry', async () => {
  const f = feeFixture({ activate: false }); await f.stage(); await f.service.runOnce();
  assert.equal(f.job(f.v).state, 'complete'); assert.equal(f.feePosts().length, 0);
  Object.assign(f.db.data.get('accurate_sync_private/control'), { feesEnabled: true, feePolicy: 'expense_including_vat', feesActivatedAt: new Date(f.clock()).toISOString() });
  await f.retryFee(); await f.service.runOnce();
  assert.equal(f.feePosts().length, 0); assert.equal(f.netCalls.length, 0);
  const s = await f.service.status(req()); assert.equal(s.jobs[0].feeState, 'excluded');
});
test('both booking creation and session creation must be strictly after the fee cutoff', async () => {
  for (const source of ['booking', 'session']) {
    const f = feeFixture(); const cutoff = Date.parse(f.c.feesActivatedAt);
    if (source === 'booking') f.v.bookingCreatedAt = cutoff;
    else { f.v.intent.createdAt = new Date(cutoff).toISOString(); f.db.data.get(`xendit_live_sessions/${f.v.intent.referenceId}`).createdAt = f.v.intent.createdAt; }
    await f.stage(); await f.service.runOnce(); assert.equal(f.feePosts().length, 0); assert.equal(f.netCalls.length, 0);
  }
});
test('settled fee + VAT posts exactly one two-line expense journal; gross receipt/invoice remain 160000', async () => {
  const f = feeFixture(); f.row.status = 'SUCCESSFUL'; await f.stage(); await f.service.runOnce();
  const j = f.job(f.v); assert.equal(j.state, 'complete'); assert.ok(j.documents.fee?.id); assert.equal(j.feeEvidence.amount, 9990);
  assert.equal(f.feePosts().length, 1); const p = f.feePosts()[0].payload;
  assert.equal(p.number, `SHXF-${h([TARGET, f.v.booking.id]).slice(0,24)}`); assert.equal(p.transDate, '22/10/2026');
  assert.deepEqual(p.detailJournalVoucher, [{ accountNo:'600031', amount:9990, amountType:'DEBIT' }, { accountNo:'110103', amount:9990, amountType:'CREDIT' }]);
  assert.ok(p.description.includes(f.row.id)); assert.equal(p.id, undefined);
  assert.equal(f.posts('sales-receipt')[0].payload.chequeAmount, 160000);
  assert.equal([...f.remote.values()].find(d => d.invoiceDp === false).totalAmount, 160000);
  f.advance(600000); await f.service.retry(req({ bookingId:f.v.booking.id })); await f.service.runOnce(); assert.equal(f.feePosts().length,1);
  assert.equal((await f.service.status(req())).jobs[0].feeState,'confirmed');
  assert.ok(f.db.writes.every(w => ['accurate_sync_jobs','accurate_sync_operations','accurate_sync_private'].includes(w.ref.name)));
});
test('actual channel tariffs including two-decimal fees are used; no daily processing fee is allocated', async () => {
  const f = feeFixture(); f.row.channel_category = 'QR_CODE'; f.row.channel_code = 'QRIS';
  Object.assign(f.row.fee,{ xendit_fee:111.11, value_added_tax:12.22 }); f.row.net_amount=159876.67;
  await f.stage(); await f.service.runOnce(); assert.equal(f.feePosts()[0].payload.detailJournalVoucher[0].amount,123.33);
});
test('pending fees/settlement retry without delaying completed-service invoice or sending a guessed journal', async () => {
  for (const change of [f=>f.row.fee.status='PENDING', f=>f.row.settlement_status='PENDING',f=>f.state.value.data=[]]) {
    const f = feeFixture(); change(f); await f.stage(); await f.service.runOnce();
    assert.equal(f.job(f.v).state,'waiting_fee'); assert.ok(f.job(f.v).documents.invoice?.id); assert.equal(f.feePosts().length,0);
    f.row.fee.status='COMPLETED'; f.row.settlement_status='SETTLED'; f.state.value.data=[f.row]; await f.retryFee();
    assert.equal(f.feePosts().length,1); assert.equal(f.posts('sales-receipt').length,1); assert.equal(f.posts('sales-invoice').length,2);
  }
});
test('fees can post before treatment finishes; completing treatment never posts the fee twice', async () => {
  const f = feeFixture({ completed:false }); await f.stage(); await f.service.runOnce();
  assert.equal(f.job(f.v).state,'waiting_service'); assert.equal(f.feePosts().length,1);
  Object.assign(f.db.data.get(`bookings/${f.v.booking.id}`),{status:'Completed',completedAt:new Date(f.clock()).toISOString()});
  await f.retryFee(); assert.equal(f.job(f.v).state,'complete'); assert.equal(f.feePosts().length,1);
});
test('pausing fee posting preserves the invoice and fee queue; resume retains the same activation boundary', async () => {
  const f = feeFixture(); f.c.feesEnabled=false; await f.stage(); await f.service.runOnce();
  assert.equal(f.job(f.v).state,'waiting_fee'); assert.equal(f.job(f.v).issue,'FEE_POSTING_PAUSED'); assert.ok(f.job(f.v).documents.invoice?.id);
  assert.equal(f.netCalls.length,0); f.db.data.get('accurate_sync_private/control').feesEnabled=true; await f.retryFee(); assert.equal(f.feePosts().length,1);
});
test('mismatched provider data, state, withholding, totals and missing fees park for review without posting', async () => {
  for (const change of [f=>f.row.product_id='wrong',f=>f.row.amount=1,f=>f.row.business_id='foreign',f=>f.row.status='FAILED',
    f=>f.row.fee.xendit_withholding_tax=1,f=>delete f.row.fee.value_added_tax,f=>f.row.net_amount=145570]) {
    const f=feeFixture(); change(f); await f.stage(); await f.service.runOnce(); assert.equal(f.job(f.v).state,'review'); assert.equal(f.feePosts().length,0);
    assert.ok(f.job(f.v).documents.invoice?.id);
  }
});
test('source changes during the Xendit read cannot create a fee journal', async () => {
  for (const change of [f=>f.db.data.get(`bookings/${f.v.booking.id}`).status='Cancelled',
    f=>f.db.data.get(`payments/${f.v.payment.id}`).providerTransactionId='py-foreign'.padEnd(30,'0'),
    f=>f.db.data.get('accurate_sync_private/control').feesEnabled=false]) {
    const f=feeFixture(); f.state.onRead=()=>change(f); await f.stage(); await f.service.runOnce(); assert.equal(f.feePosts().length,0);
  }
});
test('lost fee POST response is reconciled by number, never sent twice', async () => {
  const f=feeFixture(); f.lose('fee'); await f.stage(); await f.service.runOnce();
  assert.equal(f.job(f.v).issue,'ACCURATE_DOCUMENT_UNCERTAIN'); assert.equal(f.feePosts().length,1);
  await f.retryFee(); assert.equal(f.job(f.v).state,'complete'); assert.equal(f.feePosts().length,1);
});
test('missing fee document after ambiguous POST never authorizes a second POST, including across workers', async () => {
  const f=feeFixture(); f.absent('fee'); await f.stage(); await f.service.runOnce();
  assert.equal(f.job(f.v).issue,'ACCURATE_DOCUMENT_UNCERTAIN'); assert.equal(f.feePosts().length,1);
  await f.retryFee(); assert.equal(f.feePosts().length,1); assert.equal(f.job(f.v).state,'review');
});
test('exact existing journal is adopted; manual or conflicting same-number documents are not edited or duplicated', async () => {
  for (const mismatch of [false,true]) {
    const f=feeFixture(); await f.stage(); f.lose('fee'); await f.service.runOnce();
    const d=[...f.remote.values()].find(d=>d._type==='journal-voucher'); if(mismatch)d.description='Manual journal requiring Finance review';
    await f.retryFee(); assert.equal(f.feePosts().length,1); assert.equal(f.job(f.v).state,mismatch?'review':'complete');
  }
});
test('a fee adjustment after an already posted journal requires review rather than changing or creating another journal', async () => {
  const f=feeFixture({completed:false}); await f.stage(); await f.service.runOnce();
  f.row.fee.xendit_fee=8000; f.row.net_amount=151010; await f.retryFee();
  assert.equal(f.job(f.v).issue,'FEE_EVIDENCE_CHANGED'); assert.equal(f.feePosts().length,1);
});
test('explicit zero fees are recorded as zero evidence without an invalid zero-amount journal', async () => {
  const f=feeFixture(); f.row.fee.xendit_fee=0; f.row.fee.value_added_tax=0; f.row.net_amount=160000;
  await f.stage(); await f.service.runOnce(); assert.equal(f.job(f.v).state,'complete'); assert.equal(f.feePosts().length,0);
  assert.equal((await f.service.status(req())).jobs[0].feeState,'zero');
});
test('journal detail validation rejects altered accounts, extra lines, reversed amounts and foreign currencies', async () => {
  const f=feeFixture(); await f.stage(); await f.service.runOnce();
  const d=[...f.remote.values()].find(d=>d._type==='journal-voucher'), p=f.feePosts()[0].payload;
  assert.equal(matchesFeeJournal(d,p),true);
  for(const mutate of [d=>d.detailJournalVoucher.push(d.detailJournalVoucher[0]),d=>d.detailJournalVoucher[0].accountNo='110504',
    d=>d.detailJournalVoucher[0].amountType='CREDIT',d=>d.detailJournalVoucher[1].amount=9991,
    d=>d.detailJournalVoucher[1].account.currency.code='USD',d=>d.description='other',d=>d.transDate='21/10/2026']) {
    const copy=structuredClone(d);mutate(copy);assert.equal(matchesFeeJournal(copy,p),false);
  }
  const api=await createAccurateSyncProvider(f.deps).connect(f.clock()+45000);
  for(const payload of [{...p,id:123},{...p,detailJournalVoucher:[{...p.detailJournalVoucher[0],accountNo:'110504'},p.detailJournalVoucher[1]]}]) await rejects(api.save('fee',payload),'ACCURATE_OPERATION_INVALID');
});
test('two workers share the lease and send one fee journal under concurrent retries', async()=>{
  const f=feeFixture();await f.stage();
  const other=createAccurateSync({...f.deps,fetch:(url,init)=>new URL(url).hostname==='api.xendit.co'?f.netDeps.fetch(url,init):f.deps.fetch(url,init)});
  await Promise.all([f.service.runOnce(),other.runOnce(),f.service.runOnce()]);
  assert.equal(f.feePosts().length,1);assert.equal(f.job(f.v).state,'complete');
});
test('global pause, source cancellation and Manager revocation during activation cannot authorize fee writes',async()=>{
  const f=feeFixture({activate:false});
  f.respond(c=>{if(c.url.pathname.includes('/journal-voucher/list.do'))f.db.data.get('staff_roles/manager').isActive=false;});
  await assert.rejects(f.service.activateFees(req({acknowledgement:ACCURATE_FEE_ACK,feePolicy:'expense_including_vat'})));
  assert.equal(f.db.data.get('accurate_sync_private/control').feesEnabled,undefined);assert.equal(f.feePosts().length,0);
  const g=feeFixture();g.state.onRead=()=>g.db.data.get('accurate_sync_private/control').enabled=false;
  await g.stage();await g.service.runOnce();assert.equal(g.feePosts().length,0);
});
test('pausing fees after a verified journal does not block subsequent completion of the service invoice',async()=>{
  const f=feeFixture({completed:false});await f.stage();await f.service.runOnce();
  await f.service.pauseFees(req());Object.assign(f.db.data.get(`bookings/${f.v.booking.id}`),{status:'Completed',completedAt:new Date(f.clock()).toISOString()});
  await f.retryFee();assert.equal(f.job(f.v).state,'complete');assert.equal(f.feePosts().length,1);assert.ok(f.job(f.v).documents.invoice.id);
});
