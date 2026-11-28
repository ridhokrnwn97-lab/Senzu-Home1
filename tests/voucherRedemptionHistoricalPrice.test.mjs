// Integration coverage for the real /api/vouchers/redeem handler: the handler is
// extracted from server.ts and run against an in-memory Firestore, so a catalog
// rejection before resolveHistoricalServicePrice() cannot go unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { calculateHomeServiceFee, SENZU_BASE_LOCATION } from '../src/lib/distanceFeeService.ts';
import { DEFAULT_LOYALTY_SETTINGS, DEFAULT_MEMBERSHIP_TIERS } from '../src/types/loyalty.ts';
import { resolveCatalogServicePrice, resolveHistoricalServicePrice } from '../src/server/bookingPriceSnapshot.ts';
import { resolveHistoricalServiceDuration } from '../src/server/bookingDurationSnapshot.ts';

const source = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
let handlerSource = null;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.post' &&
      node.arguments[0]?.text === '/api/vouchers/redeem') {
    handlerSource = node.arguments[1].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handlerSource, 'redemption handler must exist in server.ts');
const compiled = transformSync(`return ${handlerSource};`, { loader: 'ts', target: 'es2022', format: 'cjs' }).code;
const handler = new Function(
  'adminDb', 'adminAuth', 'verifyCustomerFirebaseIdToken', 'ensureServerAuthenticated',
  'normalizeIndonesianPhoneServer', 'emitStructuredLog', 'calculateHomeServiceFee',
  'SENZU_BASE_LOCATION', 'DEFAULT_LOYALTY_SETTINGS', 'DEFAULT_MEMBERSHIP_TIERS',
  'resolveCatalogServicePrice', 'resolveHistoricalServicePrice', 'resolveHistoricalServiceDuration',
  compiled
);

class MemoryDB {
  data = new Map();
  writes = [];
  collection(name) {
    const make = (filters = [], take = Infinity) => ({
      name, filters, take,
      where: (key, op, value) => make([...filters, [key, op, value]], take),
      limit: n => make(filters, n),
      doc: id => ({ name, id, path: `${name}/${id}` }),
    });
    return make();
  }
  snap(ref) {
    if (ref.id) {
      const value = this.data.get(`${ref.name}/${ref.id}`);
      return { id: ref.id, exists: value !== undefined, data: () => structuredClone(value), ref };
    }
    const docs = [...this.data.entries()]
      .filter(([p, v]) => p.startsWith(`${ref.name}/`) &&
        ref.filters.every(([k, op, expected]) => op === '==' ? v[k] === expected : false))
      .slice(0, ref.take)
      .map(([p, v]) => this.snap({ name: ref.name, id: p.slice(ref.name.length + 1) }));
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  seed(path, value) { this.data.set(path, structuredClone(value)); }
  async runTransaction(fn) {
    const pending = []; let writing = false;
    const write = (type, ref, data, options) => { writing = true; pending.push({ type, ref, data, options }); };
    const transaction = {
      get: async ref => { assert.equal(writing, false, 'no Firestore reads after writes'); return this.snap(ref); },
      set: (ref, data, options) => write('set', ref, data, options),
      update: (ref, data) => write('update', ref, data),
      create: (ref, data) => write('create', ref, data),
    };
    const value = await fn(transaction);
    for (const { type, ref, data, options } of pending) {
      const path = `${ref.name}/${ref.id}`;
      if (type === 'update' || options?.merge) this.data.set(path, { ...this.data.get(path), ...data });
      else this.data.set(path, structuredClone(data));
      this.writes.push({ type, path, data });
    }
    return value;
  }
}

const CODE = 'HISTPRICE10';
const BOOKING_ID = 'bk_hist_price';
const REDEMPTION_ID = `vred_${CODE}_${BOOKING_ID}`;
const DISCOUNT_ID = `voucher_redemptions/${REDEMPTION_ID}`;
const RECEIPT_ID = `voucher_redemption_receipts/${REDEMPTION_ID}`;

function fixture({ booking = {}, service = {}, body = {} } = {}) {
  const db = new MemoryDB();
  db.seed('vouchers/promo_hist', {
    code: CODE, voucherType: 'percentage_discount', value: 10, minimumSpend: 0,
    enabled: true, validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z',
    currentUsageCount: 0, usageLimitTotal: 0, usageLimitPerCustomer: 0,
  });
  db.seed('bookings/' + BOOKING_ID, {
    customerAuthUid: 'alice', status: 'Menunggu Pembayaran', bookingCode: 'SH-HIST-001',
    promoId: 'promo_hist', promoCode: CODE, serviceId: 'svc_hist',
    servicePrice: 100000, servicePriceSnapshot: 100000,
    serviceDuration: 60, durationMinutesSnapshot: 60,
    homeServiceFee: 0, customerWhatsApp: '081234567890',
    ...booking,
  });
  db.seed('services/svc_hist', { price: 100000, duration: 60, isActive: true, ...service });
  db.seed('membership_tiers/member', {
    id: 'member', name: 'Member', discountPercentage: 0, earningMultiplier: 1,
  });
  db.seed('loyalty_settings/general', { voucherEnabled: true, allowStacking: false });
  const run = createHandler(db);
  return { db, run: () => run({ body: { bookingId: BOOKING_ID, voucherCode: CODE, ...body },
    headers: { authorization: 'Bearer alice' } }) };
}

function createHandler(db) {
  const redeem = handler(
    db,
    { verifyIdToken: async () => ({}) },
    async () => ({ success: true, uid: 'alice' }),
    async () => {},
    raw => ({ cleanDigits: String(raw || '').replace(/\D/g, '') }),
    () => {},
    calculateHomeServiceFee,
    SENZU_BASE_LOCATION,
    DEFAULT_LOYALTY_SETTINGS,
    DEFAULT_MEMBERSHIP_TIERS,
    resolveCatalogServicePrice,
    resolveHistoricalServicePrice,
    resolveHistoricalServiceDuration
  );
  return async req => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await redeem(req, res);
    assert.ok(res.body, 'handler must send a JSON response');
    return res;
  };
}

const redeemedDiscount = f => f.db.data.get(RECEIPT_ID)?.discountAmount;

test('catalog price rise does not reprice a snapshot booking during redemption', async () => {
  const f = fixture({ service: { price: 150000, duration: 90 } });
  const res = await f.run();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.discountAmount, 10000);
  assert.equal(redeemedDiscount(f), 10000);
  assert.equal(f.db.data.get(`bookings/${BOOKING_ID}`).servicePriceSnapshot, 100000);
  assert.equal(f.db.data.get(`bookings/${BOOKING_ID}`).servicePrice, 100000);
});

test('null or malformed catalog price never overrides a valid historical snapshot', async () => {
  for (const price of [null, undefined, 0, -1, '150000', NaN]) {
    const f = fixture({ service: { price } });
    const res = await f.run();
    assert.equal(res.statusCode, 200, `${String(price)}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.discountAmount, 10000);
    assert.equal(redeemedDiscount(f), 10000);
  }
});

test('an invalid snapshot is rejected before any redemption write', async () => {
  for (const snapshot of ['100000', 0, -1, NaN]) {
    const f = fixture({ booking: { servicePriceSnapshot: snapshot } });
    const res = await f.run();
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'VOUCHER_REDEMPTION_REVIEW_REQUIRED');
    assert.equal(f.db.writes.length, 0);
  }
});

test('a servicePrice conflicting with the snapshot is rejected', async () => {
  const f = fixture({ booking: { servicePrice: 120000 } });
  const res = await f.run();
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'VOUCHER_REDEMPTION_REVIEW_REQUIRED');
  assert.equal(f.db.writes.length, 0);
});

test('legacy booking without a snapshot still redeems at its validated servicePrice', async () => {
  const f = fixture({ booking: { servicePriceSnapshot: undefined, servicePrice: 100000 }, service: { price: 150000 } });
  const res = await f.run();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.discountAmount, 10000);
  assert.equal(redeemedDiscount(f), 10000);
});

test('client-supplied servicePrice is never trusted as the authoritative price', async () => {
  const f = fixture({ body: { servicePrice: 999999999, servicePriceSnapshot: 999999999, discountAmount: 999999999 } });
  const res = await f.run();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.discountAmount, 10000);
  assert.equal(redeemedDiscount(f), 10000);
});

test('service existence validation still blocks redemption', async () => {
  const f = fixture();
  f.db.data.delete('services/svc_hist');
  const res = await f.run();
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'VOUCHER_REDEMPTION_REVIEW_REQUIRED');
  assert.equal(f.db.writes.length, 0);
});

test('new bookings still take their price from the authoritative catalog', () => {
  assert.match(source, /const authoritativeServicePrice = serviceData\.price;/);
  assert.match(source, /servicePrice: authoritativeServicePrice/);
  assert.match(source, /servicePriceSnapshot: authoritativeServicePrice/);
});
