import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import express from 'express';
import { createXenditSandbox, registerXenditSandbox, safeTestCheckoutUrl } from '../src/server/xenditSandbox.ts';

// Extract the actual existing Manager policy AND the actual injected callback.
// No application startup, Firebase initialization, credentials or network access.
const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const wanted = new Set(['isValidStage7dDocId', 'sanitizeStage7dText', 'validateStage7dActiveManagerIdentity']);
const pieces = []; let authorizeSource = '';
function visit(node) {
  if (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) pieces.push(node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerXenditSandbox') {
    const entry = node.arguments[1].properties.find(p => p.name?.getText(ast) === 'authorizeManager');
    authorizeSource = entry.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast); assert.equal(pieces.length, 3); assert.ok(authorizeSource);
const managerFactory = new Function('adminDb', transformSync(`${pieces.join('\n')}\nreturn ${authorizeSource};`, { loader: 'ts' }).code);

class MemoryDB {
  data = new Map(); writes = []; reads = []; queue = Promise.resolve(); failCommit = false; retryOnce = false;
  collection(name) {
    const make = (filters = [], limit = Infinity) => ({ name, filters, take: limit,
      where: (key, op, value) => { assert.equal(op, '=='); return make([...filters, [key, value]], limit); },
      limit: count => make(filters, count),
      doc: id => ({ name, id, path: `${name}/${id}`, get: () => this.read({ name, id }) }),
    });
    return make();
  }
  snap(name, id, data) { return { id, exists: data !== undefined, data: () => structuredClone(data), ref: { name, id } }; }
  async read(ref) {
    this.reads.push(ref.name);
    if (ref.id) return this.snap(ref.name, ref.id, this.data.get(`${ref.name}/${ref.id}`));
    const docs = [...this.data.entries()].filter(([path, data]) => path.startsWith(`${ref.name}/`) &&
      ref.filters.every(([key, value]) => data[key] === value)).slice(0, ref.take)
      .map(([path, data]) => this.snap(ref.name, path.slice(ref.name.length + 1), data));
    return { docs };
  }
  seed(path, value) { this.data.set(path, structuredClone(value)); }
  async runTransaction(fn) {
    let unlock;
    const previous = this.queue; this.queue = new Promise(resolve => { unlock = resolve; });
    await previous;
    try {
      const execute = async () => {
        const pending = []; let writing = false;
        const write = (type, ref, data) => {
          assert.ok(['xendit_test_sessions', 'xendit_test_webhook_events'].includes(ref.name), `FORBIDDEN WRITE ${ref.name}`);
          writing = true; pending.push({ type, ref, data: structuredClone(data) });
        };
        const value = await fn({ get: ref => { assert.equal(writing, false, 'read after write'); return this.read(ref); },
          create: (ref, value) => write('create', ref, value), set: (ref, value) => write('set', ref, value), update: (ref, value) => write('update', ref, value) });
        return { pending, value };
      };
      if (this.retryOnce) { this.retryOnce = false; await execute(); }
      const { pending, value } = await execute();
      if (pending.length && this.failCommit) throw new Error('commit unavailable');
      for (const { type, ref } of pending) if (type === 'create') assert.equal(this.data.has(ref.path), false, 'immutable create collision');
      for (const item of pending) {
        const { type, ref, data } = item;
        this.data.set(ref.path, type === 'update' ? { ...this.data.get(ref.path), ...data } : data); this.writes.push(item);
      }
      return value;
    } finally { unlock(); }
  }
}
const key = 'xnd_development_fixture_not_a_real_secret';
const token = 'fixture_callback_not_a_real_secret';
const env = { XENDIT_SECRET_KEY: key, XENDIT_WEBHOOK_TOKEN: token };
const attempt = 'attempt_000000000001';
function req(body = {}, uid = 'manager1') {
  return { headers: { authorization: `Bearer ${uid}` }, rawHeaders: ['Authorization', `Bearer ${uid}`], body, ip: '127.0.0.1', socket: {} };
}
function seedManager(db, uid = 'manager1', role = 'manager') {
  db.seed(`staff_users/staff_${uid}`, { authUserId: uid, role, name: 'Fixture Manager', isStaffMaster: true, sourceSystem: 'STAFF_MASTER_GOVERNANCE' });
  db.seed(`staff_roles/${uid}`, { authUserId: uid, role, isActive: true, staffId: `staff_${uid}` });
}
function fixture(overrides = {}) {
  const db = new MemoryDB(); seedManager(db);
  const remote = new Map(); const calls = []; let postMode = 'ok', getPatch = {}, gate;
  const fetch = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.xendit.co');
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${key}:`).toString('base64')}`);
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') {
      if (gate) await gate;
      if (postMode === 'network') throw new Error('uncertain');
      if (postMode === 'reject') return new Response('{}', { status: 422 });
      const body = JSON.parse(init.body);
      const value = { ...body, payment_session_id: `ps-${String(remote.size + 1).padStart(24, '0')}`, status: 'ACTIVE',
        business_id: 'merchant_fixture', payment_link_url: 'https://dev.xen.to/fixture', payment_id: null };
      remote.set(value.payment_session_id, value);
      if (postMode === 'commitFail') db.failCommit = true;
      if (postMode === 'badUrl') value.payment_link_url = 'https://xen.to/live';
      return Response.json(value, { status: 201 });
    }
    const stored = remote.get(decodeURIComponent(url.split('/').pop()));
    assert.ok(stored); return Response.json({ ...stored, ...getPatch });
  };
  const verify = async value => {
    if (value === 'invalid') throw Object.assign(new Error('invalid'), { code: 'auth/argument-error' });
    if (value === 'outage') throw Object.assign(new Error('offline'), { code: 'auth/internal-error' });
    return { uid: value };
  };
  const deps = { db, verify, authorizeManager: managerFactory(db), env: { ...env }, fetch, ...overrides };
  const service = createXenditSandbox(deps);
  return { db, remote, calls, deps, service, setMode: value => { postMode = value; }, setGate: value => { gate = value; }, patchGet: value => { getPatch = value; } };
}
const rejectCode = (promise, status, code) => assert.rejects(promise, e => e.status === status && (!code || e.code === code));
function webhook(value, event = 'payment_session.completed', header = token) {
  const data = { ...value, status: event.endsWith('completed') ? 'COMPLETED' : 'EXPIRED' };
  return { headers: { 'x-callback-token': header }, rawHeaders: ['x-callback-token', header], body: { event, business_id: value.business_id, data } };
}

test('auth gates run before DB, distinguish invalid token and infrastructure, reject duplicate headers', async () => {
  const f = fixture();
  for (const request of [{ headers: {}, rawHeaders: [], ip: 'fixture' }, req({}, 'invalid')]) await rejectCode(f.service.status(request), 401);
  await rejectCode(f.service.status(req({}, 'outage')), 503, 'AUTH_UNAVAILABLE');
  const duplicate = req(); duplicate.rawHeaders.push('Authorization', 'Bearer manager1');
  await rejectCode(f.service.status(duplicate), 401);
  const alternate = req(); alternate.headers['x-firebase-auth'] = '';
  await rejectCode(f.service.status(alternate), 401);
  assert.equal(f.db.reads.length, 0); assert.equal(f.calls.length, 0);
});
test('actual existing Staff Master policy: only active unique UID-bound Manager/Admin', async () => {
  for (const role of ['customer', 'therapist', 'staff', 'css', 'supervisor']) {
    const f = fixture(); seedManager(f.db, 'actor', role);
    await rejectCode(f.service.checkout(req({ attemptId: attempt }, 'actor')), 403);
    assert.equal(f.db.writes.length, 0); assert.equal(f.calls.length, 0);
  }
  for (const mutate of [
    db => db.seed('staff_roles/manager1', { role: 'admin', isActive: true, staffId: 'staff_manager1' }),
    db => { db.data.get('staff_users/staff_manager1').isActive = false; },
    db => { db.data.get('staff_roles/manager1').isActive = false; },
    db => { db.data.get('staff_users/staff_manager1').authUid = 'foreign'; },
    db => db.seed('staff_users/duplicate', { authUserId: 'manager1', role: 'manager' }),
    db => { db.data.get('staff_roles/manager1').staffId = 'foreign'; },
  ]) {
    const f = fixture(); mutate(f.db);
    await rejectCode(f.service.checkout(req({ attemptId: attempt })), 403); assert.equal(f.db.writes.length, 0);
  }
  const f = fixture(); seedManager(f.db, 'admin1', 'admin');
  assert.equal((await f.service.status(req({}, 'admin1'))).configured, true);
});
test('Test-only configuration fails closed for Live key, missing token, invalid return URL/environment', async () => {
  for (const patch of [{ XENDIT_SECRET_KEY: 'xnd_production_fixture' }, { XENDIT_WEBHOOK_TOKEN: '' },
    { XENDIT_ENVIRONMENT: 'live' }, { XENDIT_TEST_RETURN_URL: 'http://unsafe.invalid' }]) {
    const f = fixture({ env: { ...env, ...patch } });
    assert.equal((await f.service.status(req())).configured, false);
    await rejectCode(f.service.checkout(req({ attemptId: attempt })), 503);
    assert.equal(f.calls.length, 0); assert.equal(f.db.writes.length, 0);
  }
});
test('fixed server amount, no customer PII, current API contract, private isolation, retry-safe creation', async () => {
  const f = fixture(); f.db.retryOnce = true;
  f.db.seed('bookings/real', { status: 'Pending', paymentStatus: 'unpaid' });
  f.db.seed('payments/real', { status: 'unpaid', amount: 250000 });
  const before = [...f.db.data].filter(([path]) => /^(bookings|payments)\//.test(path));
  const one = await f.service.checkout(req({ attemptId: attempt }));
  const two = await f.service.checkout(req({ attemptId: attempt }));
  assert.equal(one.session.amount, 10000); assert.equal(two.isIdempotent, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.capture_method, 'AUTOMATIC');
  assert.equal(f.calls[0].body.session_type, 'PAY'); assert.equal(f.calls[0].body.allow_save_payment_method, 'DISABLED');
  assert.ok(!JSON.stringify(f.calls[0].body).includes('Fixture Manager'));
  assert.equal(one.session.environment, 'test'); assert.equal(one.session.realBookingAffected, false);
  assert.deepEqual([...f.db.data].filter(([path]) => /^(bookings|payments)\//.test(path)), before);
  for (const payload of [{ attemptId: attempt, amount: 1 }, { attemptId: [attempt] }, { attemptId: '../escape' }, { bookingId: 'real' }]) {
    await rejectCode(f.service.checkout(req(payload)), 400);
  }
});
test('concurrent same/different attempts never send a second create while first outcome is unknown', async () => {
  const f = fixture(); let release; f.setGate(new Promise(resolve => { release = resolve; }));
  const pending = f.service.checkout(req({ attemptId: attempt }));
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  const replay = await f.service.checkout(req({ attemptId: attempt }));
  assert.equal(replay.session.creationState, 'creating');
  await rejectCode(f.service.checkout(req({ attemptId: 'attempt_000000000002' })), 409, 'TEST_ATTEMPT_PENDING');
  release(); await pending; assert.equal(f.calls.length, 1);
});
test('ambiguous network outcome is retained, survives reload, and never automatically reposted', async () => {
  const f = fixture(); f.setMode('network');
  await rejectCode(f.service.checkout(req({ attemptId: attempt })), 503, 'XENDIT_REQUEST_UNCERTAIN');
  const replay = await f.service.checkout(req({ attemptId: attempt }));
  assert.equal(replay.session.creationState, 'uncertain');
  assert.equal((await f.service.latest(req())).session.referenceId, replay.session.referenceId);
  await rejectCode(f.service.checkout(req({ attemptId: 'attempt_000000000002' })), 409);
  assert.equal(f.calls.length, 1);
});
test('definite rejection permits an explicit new attempt, but the same attempt is never reposted', async () => {
  const f = fixture(); f.setMode('reject');
  await rejectCode(f.service.checkout(req({ attemptId: attempt })), 502, 'XENDIT_REQUEST_REJECTED');
  assert.equal((await f.service.checkout(req({ attemptId: attempt }))).session.creationState, 'rejected');
  f.setMode('ok'); await f.service.checkout(req({ attemptId: 'attempt_000000000002' }));
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 2);
});
test('unsafe checkout hosts and malformed upstream linkage are rejected', async () => {
  for (const url of ['https://xen.to/live', 'https://dev.xen.to.evil.invalid/', 'javascript:alert(1)',
    'https://user:pass@dev.xen.to/a', 'https://dev.xen.to:444/a']) assert.throws(() => safeTestCheckoutUrl(url));
  const f = fixture(); f.setMode('badUrl');
  await rejectCode(f.service.checkout(req({ attemptId: attempt })), 502, 'XENDIT_INVALID_CHECKOUT');
  assert.equal((await f.service.latest(req())).session.creationState, 'uncertain');
});
test('webhook token rejected before any reads, unknown sessions ignored without importing data', async () => {
  const f = fixture(); const value = { payment_session_id: 'ps-000000000000000000000001', reference_id: `szt_${'a'.repeat(48)}`, business_id: 'merchant_fixture' };
  await rejectCode(f.service.webhook(webhook(value, undefined, 'wrong')), 401);
  assert.equal(f.db.reads.length, 0); assert.equal(f.calls.length, 0);
  assert.equal((await f.service.webhook(webhook(value))).ignored, true); assert.equal(f.db.writes.length, 0);
});
test('webhook re-fetches canonical session, deduplicates events and cannot regress completed Test state', async () => {
  const f = fixture(); await f.service.checkout(req({ attemptId: attempt }));
  const value = [...f.remote.values()][0]; value.status = 'COMPLETED'; value.payment_id = 'py-fixture';
  await f.service.webhook(webhook(value)); await f.service.webhook(webhook(value));
  assert.equal([...f.db.data.keys()].filter(path => path.startsWith('xendit_test_webhook_events/')).length, 1);
  value.status = 'EXPIRED'; await f.service.webhook(webhook(value, 'payment_session.expired'));
  const latest = (await f.service.latest(req())).session;
  assert.equal(latest.sessionStatus, 'COMPLETED'); assert.ok(latest.lastWebhookAt);
  assert.equal(f.calls.filter(c => c.method === 'GET').length, 3);
  assert.ok(f.db.writes.every(item => item.ref.name.startsWith('xendit_test_')));
});
test('completed callback cannot override ACTIVE API state; provider retry succeeds after API catches up', async () => {
  const f = fixture(); await f.service.checkout(req({ attemptId: attempt }));
  const value = [...f.remote.values()][0]; const before = f.db.writes.length;
  await rejectCode(f.service.webhook(webhook(value)), 503, 'WEBHOOK_AWAITING_CANONICAL_STATE');
  assert.equal(f.db.writes.length, before);
  value.status = 'COMPLETED'; await f.service.webhook(webhook(value));
  assert.equal((await f.service.latest(req())).session.sessionStatus, 'COMPLETED');
});
test('wrong amount, merchant, session type, capture method and ownership all fail closed', async () => {
  const f = fixture(); const result = await f.service.checkout(req({ attemptId: attempt }));
  const value = [...f.remote.values()][0];
  for (const patch of [{ amount: 9999 }, { business_id: 'foreign' }, { session_type: 'SAVE' }, { capture_method: 'MANUAL' }, { reference_id: 'other' }, { payment_session_id: 'ps-000000000000000000000002' }]) {
    f.patchGet(patch); const count = f.db.writes.length;
    await rejectCode(f.service.read(req({ referenceId: result.session.referenceId })), 409);
    assert.equal(f.db.writes.length, count);
  }
  f.patchGet({}); seedManager(f.db, 'manager2');
  await rejectCode(f.service.read(req({ referenceId: result.session.referenceId }, 'manager2')), 403);
  const forged = webhook(value); forged.body.data.amount = 1;
  await rejectCode(f.service.webhook(forged), 409);
});
test('commit failure remains recoverable through authenticated webhook without changing financial collections', async () => {
  const f = fixture(); f.setMode('commitFail');
  await assert.rejects(f.service.checkout(req({ attemptId: attempt })));
  f.db.failCommit = false;
  const value = [...f.remote.values()][0]; value.status = 'COMPLETED';
  await f.service.webhook(webhook(value));
  assert.equal((await f.service.latest(req())).session.sessionStatus, 'COMPLETED');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});
test('live role revocation after API read blocks the returned result', async () => {
  const f = fixture(); const first = await f.service.checkout(req({ attemptId: attempt }));
  const fetch = f.deps.fetch;
  const service = createXenditSandbox({ ...f.deps, fetch: async (...args) => {
    const response = await fetch(...args); f.db.data.get('staff_roles/manager1').isActive = false; return response;
  } });
  await rejectCode(service.read(req({ referenceId: first.session.referenceId })), 403);
});
test('actual HTTP routes return JSON/no-store, no secrets, 401 and 503 without starting application', async () => {
  const f = fixture(); const app = express(); app.use(express.json()); registerXenditSandbox(app, f.deps);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${origin}/api/integrations/xendit/test/status`, { method: 'POST' }); assert.equal(bad.status, 401);
    const good = await fetch(`${origin}/api/integrations/xendit/test/status`, { method: 'POST', headers: { Authorization: 'Bearer manager1' } });
    assert.equal(good.status, 200); assert.equal(good.headers.get('cache-control'), 'no-store');
    const text = await good.text(); assert.ok(!text.includes(key)); assert.ok(!text.includes(token));
    f.db.failCommit = true;
    const failed = await fetch(`${origin}/api/integrations/xendit/test/checkout`, { method: 'POST', headers: { Authorization: 'Bearer manager1', 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: attempt }) });
    assert.equal(failed.status, 503); assert.equal((await failed.json()).code, 'XENDIT_TEST_UNAVAILABLE');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

const clientSource = fs.readFileSync(new URL('../src/lib/xenditSandboxService.ts', import.meta.url), 'utf8').replace("import { auth } from './firebase';", '');
function clientFixture(fetcher, getIdToken = async () => 'fixture_token') {
  const auth = { currentUser: { uid: 'manager1', getIdToken } };
  const js = transformSync(clientSource, { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} }; new Function('auth', 'fetch', 'module', 'exports', js)(auth, fetcher, module, module.exports);
  return { auth, client: module.exports };
}
test('browser helper refuses missing/switched sessions at token, fetch and JSON boundaries; never retries create', async () => {
  let count = 0;
  const one = clientFixture(async () => { count++; throw new Error('offline'); });
  await assert.rejects(one.client.createXenditTestSession(attempt)); assert.equal(count, 1);
  one.auth.currentUser = null;
  await assert.rejects(one.client.createXenditTestSession(attempt)); assert.equal(count, 1);
  let two;
  two = clientFixture(async () => { assert.fail('must not fetch'); }, async () => { two.auth.currentUser = null; return 'token'; });
  await assert.rejects(two.client.getXenditTestStatus(), /Sesi berubah/);
  let three;
  three = clientFixture(async () => { three.auth.currentUser = null; return Response.json({ success: true }); });
  await assert.rejects(three.client.getXenditTestStatus(), /Sesi berubah/);
  let four;
  four = clientFixture(async () => ({ ok: true, json: async () => { four.auth.currentUser = null; return { success: true }; } }));
  await assert.rejects(four.client.getXenditTestStatus(), /Sesi berubah/);
});
test('browser helper rejects unsafe URL, wrong reference and malformed success payload', async () => {
  const f = fixture(); const result = await f.service.checkout(req({ attemptId: attempt }));
  const g = clientFixture(async () => Response.json({ success: true, session: { ...result.session, environment: 'live' } }));
  await assert.rejects(g.client.createXenditTestSession(attempt), /tidak valid/);
  assert.throws(() => g.client.safeXenditTestLink('https://xen.to/live'));
  const h = clientFixture(async () => Response.json({ success: true, session: { ...result.session, referenceId: `szt_${'b'.repeat(48)}` } }));
  await assert.rejects(h.client.readXenditTestSession(result.session.referenceId), /tidak sesuai/);
});
