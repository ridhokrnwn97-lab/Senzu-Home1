// Offline fixtures only. Never reads credentials or contacts Accurate/Firebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { createHmac } from 'node:crypto';
import express from 'express';
import { createAccurateConnection, registerAccurateConnection } from '../src/server/accurateConnection.ts';
import { ACCURATE_APP_KEY, ACCURATE_APP_NAME, ACCURATE_COMPANY, ACCURATE_MASTERS } from '../src/lib/accurateContracts.ts';

// Execute the real UID-bound Staff Master authorizer injected by server.ts.
const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const wanted = new Set(['isValidStage7dDocId', 'sanitizeStage7dText', 'validateStage7dActiveManagerIdentity']);
const pieces = []; let authorizeSource = '';
function visit(node) {
  if (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) pieces.push(node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'registerAccurateConnection') {
    authorizeSource = node.arguments[1].properties.find(p => p.name?.getText(ast) === 'authorizeManager').initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast); assert.equal(pieces.length, 3); assert.ok(authorizeSource);
const managerFactory = new Function('adminDb', transformSync(`${pieces.join('\n')}\nreturn ${authorizeSource};`, { loader: 'ts' }).code);
class ReadOnlyDB {
  data = new Map(); reads = [];
  collection(name) {
    const make = (filters = [], take = Infinity) => ({ name, filters, take,
      where: (key, op, value) => { assert.equal(op, '=='); return make([...filters, [key, value]], take); },
      limit: count => make(filters, count), doc: id => ({ name, id }),
    }); return make();
  }
  async read(ref) {
    this.reads.push(ref.name);
    assert.ok(['staff_roles', 'staff_users'].includes(ref.name), 'no booking/payment/other reads');
    const snap = (id, data) => ({ id, exists: data !== undefined, data: () => structuredClone(data) });
    if (ref.id) return snap(ref.id, this.data.get(`${ref.name}/${ref.id}`));
    return { docs: [...this.data.entries()].filter(([path, data]) => path.startsWith(`${ref.name}/`) &&
      ref.filters.every(([k, v]) => data[k] === v)).slice(0, ref.take).map(([path, data]) => snap(path.split('/')[1], data)) };
  }
  runTransaction(fn) {
    const forbidden = () => { throw new Error('No Firestore writes permitted'); };
    return fn({ get: ref => this.read(ref), set: forbidden, create: forbidden, update: forbidden, delete: forbidden });
  }
}
const token = 'aat.' + 'A'.repeat(64) + '.offline_fixture';
const secret = 'signature_fixture_not_a_real_secret';
const req = (body = {}, uid = 'manager1') => ({ body, headers: { authorization: `Bearer ${uid}` },
  rawHeaders: ['Authorization', `Bearer ${uid}`], ip: 'fixture', socket: {} });
function staff(db, uid = 'manager1', role = 'manager') {
  db.data.set(`staff_users/staff_${uid}`, { authUserId: uid, role, name: 'Fixture', isStaffMaster: true, sourceSystem: 'STAFF_MASTER_GOVERNANCE' });
  db.data.set(`staff_roles/${uid}`, { authUserId: uid, role, isActive: true, staffId: `staff_${uid}` });
}
function fixture(options = {}) {
  const db = new ReadOnlyDB(); staff(db);
  const env = { ACCURATE_API_TOKEN: token, ACCURATE_SIGNATURE_SECRET: secret, ...options.env };
  const meta = { database: { id: 96400, alias: ACCURATE_COMPANY, host: 'https://odin.accurate.id', deleted: false, admin: true },
    application: { name: ACCURATE_APP_NAME, appKey: ACCURATE_APP_KEY }, tokenType: 'api', user: { email: 'private@example.invalid' } };
  let time = Date.parse('2026-10-22T08:00:00Z'), responder = null;
  const calls = [], records = new Map(ACCURATE_MASTERS.map((v, i) => [v.code, { id: 100 + i, no: v.code, name: v.name,
    ...(v.kind === 'account' ? { accountType: v.type } : { itemType: v.type, unitPrice: v.price }), suspended: false }]));
  const deps = { db, env, clock: () => time, pause: async ms => { time += ms; },
    verify: async value => {
      if (value === 'invalid') throw Object.assign(new Error(), { code: 'auth/id-token-expired' });
      if (value === 'outage') throw Object.assign(new Error(), { code: 'auth/internal-error' });
      return { uid: value };
    }, authorizeManager: managerFactory(db), fetch: async (input, init) => {
      const url = new URL(input); const at = time;
      if (calls.length) assert.ok(at - calls.at(-1).at >= 250, 'upstream rate bounded to four requests/second');
      assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.headers['X-Api-Timestamp'], new Date(time).toISOString());
      assert.equal(init.headers['X-Api-Signature'], createHmac('sha256', secret).update(new Date(time).toISOString()).digest('base64'));
      const call = { url, init, at }; calls.push(call);
      if (responder) { const response = await responder(call); if (response) return response; }
      if (url.hostname === 'account.accurate.id') {
        assert.equal(url.pathname, '/api/api-token.do'); assert.equal(init.method, 'POST'); assert.equal(init.body, undefined);
        return Response.json({ s: true, d: meta });
      }
      assert.ok(['odin.accurate.id', 'zeus.accurate.id'].includes(url.hostname));
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      const no = url.searchParams.get('no');
      const expected = ACCURATE_MASTERS.find(v => v.code === no); assert.ok(expected);
      assert.equal(url.pathname, `/accurate/api/${expected.kind === 'account' ? 'glaccount' : 'item'}/detail.do`);
      return records.has(no) ? Response.json({ s: true, d: records.get(no) }) : Response.json({ s: false, d: [`private ${token} ${secret}`] });
    } };
  return { db, env, meta, calls, records, deps, service: createAccurateConnection(deps),
    respond: fn => { responder = fn; }, advance: ms => { time += ms; } };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);

test('configuration authenticates without calling Accurate and never exposes credentials', async () => {
  const f = fixture(); const result = await f.service.configuration(req());
  assert.deepEqual(result, { configured: true, apiTokenPresent: true, signatureSecretPresent: true, databaseIdPinned: false,
    mode: 'connection_only', writesEnabled: false });
  assert.equal(f.calls.length, 0); assert.equal(JSON.stringify(result).includes(token), false);
});
test('missing, duplicate, alternate and invalid auth fail before DB/provider access', async () => {
  for (const request of [req({}, 'invalid'), { ...req(), headers: {}, rawHeaders: [] },
    { ...req(), rawHeaders: ['Authorization', 'Bearer manager1', 'authorization', 'Bearer manager1'] },
    { ...req(), headers: { authorization: 'Bearer manager1', 'x-firebase-auth': 'alternate' } }]) {
    const f = fixture(); await assert.rejects(f.service.check(request)); assert.equal(f.db.reads.length, 0); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); await rejects(f.service.check(req({}, 'outage')), 'AUTH_UNAVAILABLE');
});
test('real Staff Master gate rejects non-manager roles, disabled, conflicting and duplicate identities', async () => {
  for (const role of ['customer', 'therapist', 'css', 'supervisor']) {
    const f = fixture(); staff(f.db, 'actor', role); await assert.rejects(f.service.check(req({}, 'actor'))); assert.equal(f.calls.length, 0);
  }
  for (const mutate of [
    db => { db.data.get('staff_roles/manager1').isActive = false; },
    db => { db.data.get('staff_users/staff_manager1').isActive = false; },
    db => { db.data.get('staff_users/staff_manager1').authUid = 'foreign'; },
    db => db.data.set('staff_users/duplicate', { authUserId: 'manager1', role: 'manager' }),
    db => { db.data.get('staff_roles/manager1').staffId = 'foreign'; },
  ]) { const f = fixture(); mutate(f.db); await assert.rejects(f.service.check(req())); assert.equal(f.calls.length, 0); }
  const f = fixture(); staff(f.db, 'admin1', 'admin'); assert.equal((await f.service.configuration(req({}, 'admin1'))).configured, true);
});
test('client cannot submit URLs, credentials, master overrides, bookings or financial payloads', async () => {
  for (const body of [[], null, { url: 'https://evil.invalid' }, { bookingId: 'real' }, { token }, { amount: 160000 }]) {
    const f = fixture(); await rejects(f.service.check(req(body)), 'INVALID_ACCURATE_REQUEST'); assert.equal(f.calls.length, 0);
  }
});
test('malformed Secrets and invalid database pin fail closed without API calls', async () => {
  for (const env of [{ ACCURATE_API_TOKEN: '' }, { ACCURATE_API_TOKEN: 'xnd_production_fixture' },
    { ACCURATE_API_TOKEN: token + '\n' }, { ACCURATE_SIGNATURE_SECRET: 'short' },
    { ACCURATE_SIGNATURE_SECRET: secret + '\r\n' }, { ACCURATE_DATABASE_ID: '0' }, { ACCURATE_DATABASE_ID: 'NaN' }]) {
    const f = fixture({ env }); assert.equal((await f.service.configuration(req())).configured, false);
    await assert.rejects(f.service.check(req())); assert.equal(f.calls.length, 0);
  }
});
test('successful signed check verifies metadata and eight fixed masters with no financial or Firestore writes', async () => {
  const f = fixture({ env: { ACCURATE_DATABASE_ID: '96400' } });
  const before = structuredClone([...f.db.data]); const result = await f.service.check(req());
  assert.equal(result.mastersMatch, true); assert.equal(result.connected, true); assert.equal(result.writesEnabled, false);
  assert.equal(result.databaseId, 96400); assert.equal(result.databaseIdPinned, true); assert.equal(result.access, 'administrator');
  assert.equal(result.checks.length, 8); assert.equal(f.calls.length, 9);
  assert.deepEqual([...f.db.data], before);
  for (const value of [token, secret, 'private@example.invalid']) assert.equal(JSON.stringify(result).includes(value), false);
});
test('documented data usaha metadata is supported; ambiguous or incomplete metadata is rejected', async () => {
  const f = fixture(); f.meta['data usaha'] = f.meta.database; delete f.meta.database;
  f.meta['data usaha'].admin = false; assert.equal((await f.service.check(req())).access, 'operator');
  const g = fixture(); g.meta['data usaha'] = { ...g.meta.database, id: 1234 };
  await rejects(g.service.check(req()), 'ACCURATE_IDENTITY_MISMATCH'); assert.equal(g.calls.length, 1);
});
test('wrong company, app, deleted database, token type and pinned ID are rejected before reading masters', async () => {
  for (const change of [m => m.database.alias = 'OTHER COMPANY', m => m.database.id = 0,
    m => m.database.deleted = true, m => m.application.appKey = 'other', m => m.application.name = 'Other App',
    m => m.tokenType = 'oauth', m => delete m.database.admin]) {
    const f = fixture(); change(f.meta); await rejects(f.service.check(req()), 'ACCURATE_IDENTITY_MISMATCH'); assert.equal(f.calls.length, 1);
  }
  const f = fixture({ env: { ACCURATE_DATABASE_ID: '1234' } }); await rejects(f.service.check(req()), 'ACCURATE_DATABASE_MISMATCH'); assert.equal(f.calls.length, 1);
});
test('Staff Master permission revoked during network check blocks the returned provider result', async () => {
  const f = fixture(); f.respond(call => {
    if (call.url.searchParams.get('no') === 'SH-SIG-120') f.db.data.get('staff_roles/manager1').isActive = false;
    return null;
  });
  await assert.rejects(f.service.check(req())); assert.equal(f.calls.length, 9);
});
test('wrong type, price, names, suspension and missing masters cannot become a successful mapping', async () => {
  for (const change of [f => f.records.get('110103').accountType = 'EXPENSE',
    f => f.records.get('SH-SIG-030').unitPrice = 100000, f => f.records.get('SH-SIG-060').itemType = 'INVENTORY',
    f => f.records.get('400005').name = token, f => f.records.get('600031').suspended = true,
    f => f.records.delete('210102')]) {
    const f = fixture(); change(f); const result = await f.service.check(req());
    assert.equal(result.mastersMatch, false); assert.ok(result.checks.some(r => r.status !== 'match'));
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});
test('untrusted metadata host and redirect targets never receive credentials', async () => {
  for (const host of ['http://odin.accurate.id', 'https://accurate.id.evil.invalid', 'https://evil.invalid',
    'https://user:pass@odin.accurate.id', 'https://odin.accurate.id:444', 'https://odin.accurate.id/path',
    'https://odin.accurate.id/?q=1', 'https://account.accurate.id', 'https://127.0.0.1']) {
    const f = fixture(); f.meta.database.host = host; await rejects(f.service.check(req()), 'ACCURATE_UNSAFE_REDIRECT'); assert.equal(f.calls.length, 1);
  }
  for (const location of ['https://evil.invalid/leak', 'https://u:p@zeus.accurate.id/accurate/api/glaccount/detail.do?no=110103',
    'https://zeus.accurate.id/accurate/api/glaccount/save.do?no=110103',
    'https://zeus.accurate.id/accurate/api/glaccount/detail.do?no=other',
    'https://zeus.accurate.id/accurate/api/glaccount/detail.do?no=110103#x']) {
    const f = fixture(); f.respond(call => call.url.hostname !== 'account.accurate.id' ? new Response(null, { status: 308, headers: { location } }) : null);
    await rejects(f.service.check(req()), 'ACCURATE_UNSAFE_REDIRECT'); assert.equal(f.calls.length, 2);
  }
});
test('official cloud host migration follows 308 with same path/query only, and loops are bounded', async () => {
  const f = fixture(); f.respond(call => call.url.hostname === 'odin.accurate.id' ? new Response(null, { status: 308,
    headers: { location: 'https://zeus.accurate.id' + call.url.pathname + call.url.search } }) : null);
  assert.equal((await f.service.check(req())).mastersMatch, true); assert.equal(f.calls.length, 17);
  const g = fixture(); g.respond(call => call.url.hostname !== 'account.accurate.id' ? new Response(null, { status: 308,
    headers: { location: call.url.href } }) : null);
  await rejects(g.service.check(req()), 'ACCURATE_UNSAFE_REDIRECT'); assert.equal(g.calls.length, 4);
});
test('upstream errors, network failures, HTML and broken shapes remain safe and release the busy guard', async () => {
  for (const response of [() => new Response(token + secret, { status: 401 }), () => new Response(token, { status: 403 }),
    () => new Response(token, { status: 429 }), () => new Response(token, { status: 500 }),
    () => new Response('<html>' + secret, { status: 200 }), () => Response.json({ s: true, d: null }),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid' } }),
    () => { throw new Error(secret); }]) {
    const f = fixture(); f.respond(response);
    await assert.rejects(f.service.check(req()), e => !e.message.includes(token) && !e.message.includes(secret));
    f.respond(null); assert.equal((await f.service.check(req())).mastersMatch, true);
  }
});
test('overlapping checks, repeated checks and the one minute overall deadline are bounded', async () => {
  const f = fixture(); let release; f.respond(async () => { await new Promise(r => release = r); return null; });
  const pending = f.service.check(req()); while (!release) await new Promise(r => setImmediate(r));
  await rejects(f.service.check(req()), 'ACCURATE_CHECK_BUSY'); f.respond(null); release(); await pending;
  await f.service.check(req()); await rejects(f.service.check(req()), 'RATE_LIMITED');
  f.advance(61000); assert.equal((await f.service.check(req())).mastersMatch, true);
  const g = fixture(); g.respond(() => { g.advance(61000); return null; });
  await rejects(g.service.check(req()), 'ACCURATE_UNAVAILABLE'); assert.equal(g.calls.length, 1);
});
test('actual Express endpoints authenticate, reject payload injection and redact all external errors', async () => {
  const f = fixture(); const app = express(); app.use(express.json()); registerAccurateConnection(app, f.deps);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (action, body = {}, bearer = 'manager1') => fetch(origin + '/api/integrations/accurate/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  try {
    const c = await call('configuration'); assert.equal(c.status, 200); assert.match(c.headers.get('cache-control'), /no-store/); assert.equal(f.calls.length, 0);
    assert.equal((await call('check', { host: 'https://evil.invalid' })).status, 400); assert.equal(f.calls.length, 0);
    staff(f.db, 'customer', 'customer'); assert.equal((await call('check', {}, 'customer')).status, 403); assert.equal(f.calls.length, 0);
    assert.equal((await (await call('check')).json()).mastersMatch, true);
    f.respond(() => new Response(token + secret, { status: 401 }));
    const bad = await call('check'); assert.equal(bad.status, 502); const text = await bad.text();
    assert.equal(text.includes(token), false); assert.equal(text.includes(secret), false); assert.equal(text.includes('stack'), false);
  } finally { await new Promise(r => server.close(r)); }
});
