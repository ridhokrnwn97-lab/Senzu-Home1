// Endpoint-level authorization/mutation tests with an in-memory Firestore.
// No credentials, network to Firebase, or emulator required.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerCatalogApi } from '../src/server/catalogApi.ts';
import { resolveHistoricalServicePrice, resolveCatalogServicePrice } from '../src/server/bookingPriceSnapshot.ts';

const KEYS = ['view', 'create', 'editInfo', 'editPrice', 'editDuration', 'manageCategories', 'toggleStatus'];
const allPerms = () => Object.fromEntries(KEYS.map(k => [k, true]));
const only = (...keys) => Object.fromEntries(KEYS.map(k => [k, keys.includes(k)]));

const WRITABLE = new Set(['services', 'service_categories', 'admin_audit_logs']);

class MemoryDB {
  data = new Map(); writes = []; failAudit = false;
  collection(name) {
    const make = (filters = [], take = Infinity) => ({
      name, filters, take,
      where: (key, op, value) => { assert.equal(op, '=='); return make([...filters, [key, value]], take); },
      limit: n => make(filters, n),
      doc: id => ({ name, id, path: `${name}/${id}` }),
    });
    return make();
  }
  seed(path, value) { this.data.set(path, structuredClone(value)); }
  snapshot(ref) {
    if (ref.id) {
      const value = this.data.get(`${ref.name}/${ref.id}`);
      return { id: ref.id, exists: value !== undefined, data: () => structuredClone(value) };
    }
    const docs = [...this.data.entries()]
      .filter(([path, value]) => path.startsWith(`${ref.name}/`) && ref.filters.every(([k, v]) => value[k] === v))
      .slice(0, ref.take)
      .map(([path, value]) => ({ id: path.slice(ref.name.length + 1), exists: true, data: () => structuredClone(value) }));
    return { docs };
  }
  async runTransaction(fn) {
    const pending = [];
    const t = {
      get: async ref => this.snapshot(ref),
      create: (ref, value) => {
        assert.ok(WRITABLE.has(ref.name), `FORBIDDEN WRITE ${ref.name}`);
        assert.equal(this.data.has(ref.path), false, 'create on existing document');
        pending.push({ type: 'create', ref, value: structuredClone(value) });
      },
      set: (ref, value) => {
        assert.ok(WRITABLE.has(ref.name), `FORBIDDEN WRITE ${ref.name}`);
        pending.push({ type: 'set', ref, value: structuredClone(value) });
      },
    };
    const result = await fn(t);
    for (const item of pending) {
      if (item.ref.name === 'admin_audit_logs' && this.failAudit) throw new Error('audit commit unavailable');
    }
    for (const item of pending) {
      this.data.set(item.ref.path, item.value);
      this.writes.push(item);
    }
    return result;
  }
  audits() { return this.writes.filter(w => w.ref.name === 'admin_audit_logs').map(w => w.value); }
  lastAudit() { return this.audits().at(-1); }
}

function seedStaff(db, uid, role, catalogPermissions, opts = {}) {
  db.seed(`staff_users/staff_${uid}`, {
    authUserId: uid, role, name: opts.name || 'Fixture Staff',
    isActive: opts.staffActive !== false, status: opts.status || 'active',
  });
  db.seed(`staff_roles/${uid}`, {
    authUserId: uid, role, isActive: opts.roleActive !== false, status: 'active',
    staffId: `staff_${uid}`, staffUserId: `staff_${uid}`,
    ...(catalogPermissions === undefined ? {} : { catalogPermissions }),
  });
}

function seedCatalog(db) {
  db.seed('service_categories/cat-1', { id: 'cat-1', categoryId: 'cat-1', categoryName: 'Refleksi', categoryCode: 'CAT-REF', isActive: true, sortOrder: 1 });
  db.seed('services/svc-1', {
    id: 'svc-1', name: 'Refleksi 60', price: 100000, duration: 60,
    description: 'old', categoryId: 'cat-1', category: 'Refleksi', isActive: true,
    serviceType: 'BOTH', createdAt: '2026-01-01T00:00:00.000Z',
  });
}

async function fixture(role = 'fat', perms = allPerms(), opts = {}) {
  const db = new MemoryDB();
  seedStaff(db, opts.uid || 'user1', role, perms, opts);
  seedCatalog(db);
  const app = express();
  app.use(express.json());
  registerCatalogApi(app, { db, verify: async token => {
    if (token === 'bad-token') throw new Error('invalid');
    return { uid: token };
  }, now: () => Date.parse('2026-11-24T10:00:00.000Z') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    db, server, origin,
    call: async (method, path, { token = 'user1', body } = {}) => {
      const headers = {};
      if (token !== null) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const raw = await res.text();
      let json = {};
      try { json = JSON.parse(raw); } catch { /* Express 404 returns HTML */ }
      return { status: res.status, json };
    },
  };
}

test('authentication rejects missing, invalid, unknown, ambiguous, and inactive identities', async t => {
  const f = await fixture(); t.after(() => f.server.close());
  assert.equal((await f.call('GET', '/api/catalog/services', { token: null })).status, 401);
  assert.equal((await f.call('GET', '/api/catalog/services', { token: 'bad-token' })).status, 401);
  f.db.data.delete('staff_roles/user1');
  assert.equal((await f.call('GET', '/api/catalog/services')).status, 403);
  seedStaff(f.db, 'user1', 'fat', allPerms());
  f.db.seed('staff_users/other', { authUserId: 'user1', role: 'fat', isActive: true, status: 'active' });
  assert.equal((await f.call('GET', '/api/catalog/services')).status, 403);
  f.db.data.clear(); seedCatalog(f.db); seedStaff(f.db, 'user1', 'fat', allPerms(), { staffActive: false });
  assert.equal((await f.call('GET', '/api/catalog/services')).status, 403);
  f.db.data.clear(); seedCatalog(f.db); seedStaff(f.db, 'user1', 'fat', allPerms(), { roleActive: false });
  assert.equal((await f.call('GET', '/api/catalog/services')).status, 403);
});

test('non-catalog roles and FAT without catalogPermissions are denied', async t => {
  for (const [role, perms] of [['therapist', allPerms()], ['css', allPerms()], ['fat', null], ['fat', {}]]) {
    const f = await fixture(role, perms); t.after(() => f.server.close());
    assert.equal((await f.call('GET', '/api/catalog/services')).status, 403, `role=${role} perms=${JSON.stringify(perms)}`);
    assert.equal((await f.call('POST', '/api/catalog/services', { body: { name: 'X', price: 1000, duration: 30, categoryId: 'cat-1' } })).status, 403);
    assert.equal(f.db.writes.length, 0);
  }
});

test('view permission gates both read endpoints without changing public Firestore reads', async t => {
  const yes = await fixture('fat', only('view')); t.after(() => yes.server.close());
  assert.equal((await yes.call('GET', '/api/catalog/services')).status, 200);
  assert.equal((await yes.call('GET', '/api/catalog/categories')).status, 200);
  const no = await fixture('fat', only('create')); t.after(() => no.server.close());
  assert.equal((await no.call('GET', '/api/catalog/services')).status, 403);
  assert.equal((await no.call('GET', '/api/catalog/categories')).status, 403);
});

test('create permission gates service creation and persists a server-authored audit', async t => {
  const yes = await fixture('fat', only('create')); t.after(() => yes.server.close());
  const ok = await yes.call('POST', '/api/catalog/services', { body: { name: 'Refleksi 90', price: 150000, duration: 90, categoryId: 'cat-1' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.category, 'Refleksi');
  assert.equal(ok.json.data.updatedBy, 'Fixture Staff');
  assert.deepEqual(yes.db.audits().map(a => a.action), ['service.created']);
  assert.equal(yes.db.lastAudit().actorId, 'user1');
  assert.equal(yes.db.lastAudit().actorRole, 'fat');
  assert.deepEqual(yes.db.lastAudit().changedFields, ['categoryId', 'duration', 'isActive', 'name', 'price']);

  const no = await fixture('fat', only('view')); t.after(() => no.server.close());
  assert.equal((await no.call('POST', '/api/catalog/services', { body: { name: 'X', price: 1, duration: 30, categoryId: 'cat-1' } })).status, 403);
  assert.equal(no.db.writes.length, 0);
});

test('editPrice, editDuration, editInfo and toggleStatus are independently enforced', async t => {
  const cases = [
    [only('editPrice'), { price: 150000 }, 200, 'price'],
    [only('editDuration'), { duration: 90 }, 200, 'duration'],
    [only('editInfo'), { name: 'Refleksi Baru', description: 'updated', imageUrl: 'https://example.com/a.png' }, 200, 'description'],
    [only('toggleStatus'), { isActive: false }, 200, 'isActive'],
    [only('editDuration'), { price: 150000 }, 403, null],
    [only('editPrice'), { duration: 90 }, 403, null],
    [only('editPrice'), { isActive: false }, 403, null],
    [only('editPrice'), { requiredSkillIds: ['skill-1'] }, 403, null],
    [only('toggleStatus'), { name: 'Hacked' }, 403, null],
    [only('editInfo'), { categoryId: 'cat-1' }, 200, 'categoryId'],
  ];
  for (const [perms, body, expected, changed] of cases) {
    const f = await fixture('fat', perms); t.after(() => f.server.close());
    const res = await f.call('PATCH', '/api/catalog/services/svc-1', { body });
    assert.equal(res.status, expected, JSON.stringify({ perms, body, res: res.json }));
    if (expected === 200) {
      assert.equal(f.db.data.get('services/svc-1')[changed], body[changed]);
      assert.equal(f.db.lastAudit().entityType, 'service');
      assert.equal(f.db.lastAudit().entityId, 'svc-1');
      assert.equal(f.db.lastAudit().action, changed === 'isActive' ? 'service.deactivated' : 'service.updated');
    } else {
      assert.equal(f.db.writes.length, 0);
      assert.equal(f.db.data.get('services/svc-1').price, 100000);
      assert.equal(f.db.data.get('services/svc-1').isActive, true);
    }
  }
});

test('combined-field requests require every permission before any write', async t => {
  const partial = await fixture('fat', only('editPrice')); t.after(() => partial.server.close());
  const denied = await partial.call('PATCH', '/api/catalog/services/svc-1', { body: { price: 120000, isActive: false } });
  assert.equal(denied.status, 403);
  assert.equal(partial.db.writes.length, 0);

  const full = await fixture('fat', only('editPrice', 'toggleStatus')); t.after(() => full.server.close());
  const ok = await full.call('PATCH', '/api/catalog/services/svc-1', { body: { price: 120000, isActive: false } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(full.db.lastAudit().changedFields, ['isActive', 'price']);
});

test('manageCategories gates category create/update and status changes need toggleStatus', async t => {
  const yes = await fixture('fat', only('manageCategories', 'toggleStatus')); t.after(() => yes.server.close());
  const created = await yes.call('POST', '/api/catalog/categories', { body: { categoryName: 'Refleksi Premium', description: 'VIP' } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(yes.db.lastAudit().action, 'service_category.created');
  const updated = await yes.call('PATCH', '/api/catalog/categories/cat-1', { body: { description: ' baru ' } });
  assert.equal(updated.status, 200);
  assert.equal(yes.db.lastAudit().action, 'service_category.updated');
  const dup = await yes.call('POST', '/api/catalog/categories', { body: { categoryName: ' Refleksi ' } });
  assert.equal(dup.status, 409);

  const no = await fixture('fat', only('view')); t.after(() => no.server.close());
  assert.equal((await no.call('POST', '/api/catalog/categories', { body: { categoryName: 'X' } })).status, 403);
  assert.equal((await no.call('PATCH', '/api/catalog/categories/cat-1', { body: { description: 'x' } })).status, 403);
  assert.equal(no.db.writes.length, 0);

  const noToggle = await fixture('fat', only('manageCategories')); t.after(() => noToggle.server.close());
  assert.equal((await noToggle.call('PATCH', '/api/catalog/categories/cat-1', { body: { isActive: false } })).status, 403);
  assert.equal(noToggle.db.writes.length, 0);
});

test('a category with active services cannot be deactivated', async t => {
  const f = await fixture('fat', only('manageCategories', 'toggleStatus')); t.after(() => f.server.close());
  assert.equal((await f.call('PATCH', '/api/catalog/categories/cat-1', { body: { isActive: false } })).status, 409);
  assert.equal(f.db.writes.length, 0);
  assert.equal(f.db.data.get('service_categories/cat-1').isActive, true);
  assert.equal((await f.call('PATCH', '/api/catalog/services/svc-1', { body: { isActive: false } })).status, 200);
  assert.equal((await f.call('PATCH', '/api/catalog/categories/cat-1', { body: { isActive: false } })).status, 200);
  assert.equal(f.db.data.get('service_categories/cat-1').activeStatus, 'INACTIVE');
});

test('data integrity rejects bad ids, unknown fields, invalid price/duration/name and stale categories', async t => {
  const f = await fixture('fat', allPerms()); t.after(() => f.server.close());
  const bad = [
    ['PATCH', '/api/catalog/services/bad%20id', { name: 'x' }, 400],
    ['POST', '/api/catalog/services', { name: 'X', price: -1, duration: 30, categoryId: 'cat-1' }, 400],
    ['POST', '/api/catalog/services', { name: 'X', price: 1.5, duration: 30, categoryId: 'cat-1' }, 400],
    ['POST', '/api/catalog/services', { name: 'X', price: 1, duration: 0, categoryId: 'cat-1' }, 400],
    ['POST', '/api/catalog/services', { name: 'X', price: 1, duration: 30, categoryId: 'missing' }, 400],
    ['POST', '/api/catalog/services', { price: 1, duration: 30, categoryId: 'cat-1' }, 400],
    ['POST', '/api/catalog/services', { name: 'X', price: 1, duration: 30, categoryId: 'cat-1', isActive: 'true' }, 400],
    ['PATCH', '/api/catalog/services/svc-1', { actorId: 'attacker', actorRole: 'admin' }, 400],
    ['PATCH', '/api/catalog/services/svc-1', { updatedBy: 'attacker' }, 400],
    ['PATCH', '/api/catalog/services/missing', { price: 1 }, 404],
    ['POST', '/api/catalog/categories', { categoryName: '   ' }, 400],
  ];
  for (const [method, path, body, status] of bad) {
    const res = await f.call(method, path, { body });
    assert.equal(res.status, status, JSON.stringify({ path, body, res: res.json }));
  }
  assert.equal(f.db.writes.length, 0);
});

test('no hard-delete endpoint exists and catalog writes never touch bookings or payments', async t => {
  const f = await fixture('fat', allPerms()); t.after(() => f.server.close());
  const delService = await f.call('DELETE', '/api/catalog/services/svc-1');
  const delCategory = await f.call('DELETE', '/api/catalog/categories/cat-1');
  assert.equal(delService.status, 404);
  assert.equal(delCategory.status, 404);
  assert.equal((await f.call('PATCH', '/api/catalog/services/svc-1', { body: { price: 120000 } })).status, 200);
  assert.equal(f.db.data.has('services/svc-1'), true);
  assert.deepEqual([...f.db.writes.map(w => w.ref.name)].filter(n => !WRITABLE.has(n)), []);
});

test('audit failure rolls back the catalog mutation (no unaudited change)', async t => {
  const f = await fixture('fat', only('editPrice')); t.after(() => f.server.close());
  f.db.failAudit = true;
  const res = await f.call('PATCH', '/api/catalog/services/svc-1', { body: { price: 999000 } });
  assert.ok(res.status >= 500, JSON.stringify(res.json));
  assert.equal(f.db.data.get('services/svc-1').price, 100000);
  assert.equal(f.db.writes.length, 0);
});

test('manager keeps full access and catalog changes do not alter historical booking prices', async t => {
  const f = await fixture('manager', undefined); t.after(() => f.server.close());
  assert.equal((await f.call('GET', '/api/catalog/services')).status, 200);
  assert.equal((await f.call('PATCH', '/api/catalog/services/svc-1', { body: { price: 175000, duration: 75 } })).status, 200);
  assert.equal((await f.call('POST', '/api/catalog/categories', { body: { categoryName: 'Manajer' } })).status, 200);
  assert.equal(f.db.data.get('services/svc-1').price, 175000);

  const historical = { serviceId: 'svc-1', servicePrice: 100000, servicePriceSnapshot: 100000 };
  assert.deepEqual(resolveHistoricalServicePrice(historical), { ok: true, price: 100000, source: 'snapshot' });
  assert.deepEqual(resolveCatalogServicePrice(f.db.data.get('services/svc-1').price), { ok: true, price: 175000, source: 'catalog' });
  assert.deepEqual([...f.db.writes.map(w => w.ref.name)].filter(n => !WRITABLE.has(n)), []);
});
