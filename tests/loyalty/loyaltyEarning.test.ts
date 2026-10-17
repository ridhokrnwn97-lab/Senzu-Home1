// Self-check for the server-side loyalty earning + account provisioning endpoints.
// Runs without the Firestore emulator: a minimal in-memory stand-in covers the
// document/query/transaction shapes these endpoints touch.
//   node_modules/.bin/tsx tests/loyalty/loyaltyEarning.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLoyaltyAccounts } from '../../src/server/loyaltyAccounts.ts';

type Doc = Record<string, any>;

function createFakeDb(seed: Record<string, Record<string, Doc>>) {
  const collections = new Map<string, Map<string, Doc>>();
  for (const [name, entries] of Object.entries(seed)) {
    collections.set(name, new Map(Object.entries(entries).map(([id, d]) => [id, structuredClone(d)])));
  }
  const bucket = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };
  const docSnap = (name: string, id: string) => {
    const data = collections.get(name)?.get(id);
    return { id, exists: id in Object.fromEntries(collections.get(name) || []), data: () => (data === undefined ? undefined : structuredClone(data)) };
  };
  const querySnap = (entries: [string, Doc][]) => ({
    size: entries.length,
    empty: entries.length === 0,
    docs: entries.map(([id, data]) => ({ id, exists: true, data: () => structuredClone(data) })),
  });
  const collection = (name: string): any => {
    if (!collections.has(name)) collections.set(name, new Map());
    const rows = () => [...collections.get(name)!.entries()];
    const docRef = (id: string) => ({
      __col: name,
      id,
      get: async () => docSnap(name, id),
      set: async (data: Doc) => {
        if (!collections.has(name)) collections.set(name, new Map());
        collections.get(name)!.set(id, structuredClone(data));
      },
    });
    return {
      __col: name,
      doc: docRef,
      get: async () => querySnap([...collections.get(name)!.entries()]),
      where: (field: string, _op: string, value: any) => {
        const rows2 = () => [...collections.get(name)!.entries()].filter(([, d]) => d[field] === value);
        const query: any = { get: async () => querySnap(rows2()) };
        query.limit = (n: number) => ({ get: async () => querySnap(rows2().slice(0, n)) });
        return query;
      },
    };
  };
  const db: any = {
    collection,
    runTransaction: async (fn: any) =>
      fn({
        get: async (target: any) =>
          target.id !== undefined ? docSnap(target.__col, target.id) : querySnap([...(collections.get(target.__col) || new Map()).entries()]),
        set: (target: any, data: Doc) => {
          if (!collections.has(target.__col)) collections.set(target.__col, new Map());
          collections.get(target.__col)!.set(target.id, structuredClone(data));
        },
      }),
  };
  return { db, collections };
}

const settings = {
  loyaltyEnabled: true,
  spendPerPoint: 10000,
  includeHomeServiceFeeForPoints: false,
  membershipEnabled: true,
  pointsExpireEnabled: false,
  pointsValidityDays: 365,
};
const memberTier = { id: 'member', level: 1, enabled: true, earningMultiplier: 1, minimumQualifiedSpend: 0, minimumCompletedBookings: 0 };

function seed(bookingExtra: Doc = {}, collections: Record<string, Record<string, Doc>> = {}) {
  return {
    bookings: {
      bk_1: {
        id: 'bk_1', bookingCode: 'BK-1', status: 'Completed', paymentStatus: 'PAID',
        customerId: 'cust_u_alice', customerAuthUid: 'alice', authUserId: 'alice',
        customerName: 'Alice', customerWhatsApp: '08123456789', customerEmail: 'alice@example.com',
        serviceId: 'svc_1', serviceName: 'Massage', servicePrice: 160000, homeServiceFee: 20000,
        therapistId: 'th_1', ...bookingExtra,
      },
      bk_2: {
        id: 'bk_2', bookingCode: 'BK-2', status: 'Completed', paymentStatus: 'UNPAID',
        customerId: 'cust_u_alice', customerAuthUid: 'alice', authUserId: 'alice',
        customerName: 'Alice', customerWhatsApp: '08123456789', servicePrice: 160000, therapistId: 'th_1',
      },
      bk_discount: {
        id: 'bk_3', bookingCode: 'BK-3', status: 'Completed', paymentStatus: 'PAID',
        customerId: 'cust_u_alice', customerAuthUid: 'alice', authUserId: 'alice',
        customerName: 'Alice', customerWhatsApp: '08123456789', servicePrice: 160000, voucherDiscount: 155000,
        therapistId: 'th_1',
      },
    },
    staff_users: {
      th_1: { id: 'th_1', role: 'therapist', isActive: true, authUserId: 'therapist', authUid: 'therapist' },
      css_1: { id: 'css_1', role: 'css', isActive: true, authUserId: 'css', authUid: 'css' },
    },
    staff_roles: {
      therapist: { role: 'therapist', isActive: true, therapistId: 'th_1' },
      css: { role: 'css', isActive: true, therapistId: 'css_1' },
    },
    loyalty_settings: { general: settings },
    membership_tiers: { member: memberTier },
    customers: { cust_u_alice: { id: 'cust_u_alice', authUserId: 'alice', name: 'Alice', phone: '08123456789', whatsapp: '08123456789' } },
    ...collections,
  };
}

async function harness(collections: Record<string, Record<string, Doc>> = {}) {
  const { db, collections: store } = createFakeDb(seed({}, collections));
  const routes = new Map<string, any>();
  const app: any = { post: (path: string, handler: any) => routes.set(path, handler) };
  registerLoyaltyAccounts(app, db, async (token: string) => {
    if (!token || token === 'bad') throw new Error('invalid token');
    return { uid: token };
  });
  const call = async (path: string, body: Doc = {}, token?: string) => {
    const res: any = {
      statusCode: 200,
      body: null,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { this.body = payload; return this; },
    };
    await routes.get(path)!({ body, headers: token ? { authorization: `Bearer ${token}` } : {} }, res);
    return { status: res.statusCode, body: res.body as any };
  };
  return { store, call };
}

const earn = (call: any, body: Doc, token?: string) => call('/api/loyalty/earn', body, token);
const ensure = (call: any, body: Doc, token?: string) => call('/api/loyalty/account/ensure', body, token);

test('assigned therapist earns points and creates the account + ledger entry', async () => {
  const { store, call } = await harness();
  const res = await earn(call, { bookingId: 'bk_1' }, 'therapist');
  assert.equal(res.status, 200);
  assert.equal(res.body.pointsEarned, 16); // Rp160.000 / Rp10.000 per point
  assert.equal(res.body.balance, 16);

  const account = store.get('loyalty_accounts')!.get('cust_u_alice')!;
  assert.equal(account.pointsBalance, 16);
  assert.equal(account.lifetimePointsEarned, 16);
  assert.equal(account.qualifiedSpend, 160000);
  assert.equal(account.qualifiedBookings, 1);
  assert.equal(account.currentTierId, 'member');

  const ledger = store.get('loyalty_transactions')!.get('ltx_earn_bk_1')!;
  assert.equal(ledger.transactionType, 'earn');
  assert.equal(ledger.points, 16);
  assert.equal(ledger.balanceAfter, 16);
  assert.equal(ledger.customerAuthUid, 'alice');
});

test('a second call for the same booking never double-credits', async () => {
  const { store, call } = await harness();
  await earn(call, { bookingId: 'bk_1' }, 'therapist');
  const again = await earn(call, { bookingId: 'bk_1' }, 'therapist');
  assert.equal(again.status, 200);
  assert.equal(again.body.pointsEarned, 0);
  assert.equal(again.body.reason, 'ALREADY_EARNED');
  assert.equal(store.get('loyalty_accounts')!.get('cust_u_alice')!.pointsBalance, 16);
  assert.equal(store.get('loyalty_transactions')!.size, 1);
});

test('the booking owner, staff and the assigned therapist may earn; outsiders may not', async () => {
  const { call } = await harness();
  const asOwner = await earn(call, { bookingId: 'bk_1' }, 'alice');
  assert.equal(asOwner.status, 200);
  assert.equal(asOwner.body.reason, 'Earned');
  const asCss = await earn(call, { bookingId: 'bk_1' }, 'css');
  assert.equal(asCss.status, 200);
  assert.equal(asCss.body.reason, 'ALREADY_EARNED');
  const asOutsider = await earn(call, { bookingId: 'bk_1' }, 'bob');
  assert.equal(asOutsider.status, 403);
  assert.equal(asOutsider.body.code, 'PERMISSION_DENIED');
  const anonymous = await earn(call, { bookingId: 'bk_1' });
  assert.equal(anonymous.status, 401);
});

test('unpaid or not-yet-completed bookings earn nothing and write nothing', async () => {
  const base = seed();
  const { store, call } = await harness({
    bookings: { ...base.bookings, bk_4: { ...base.bookings.bk_1, id: 'bk_4', bookingCode: 'BK-4', status: 'Treatment' } },
  });
  const inProgress = await earn(call, { bookingId: 'bk_4' }, 'therapist');
  assert.equal(inProgress.status, 200);
  assert.equal(inProgress.body.reason, 'NOT_ELIGIBLE');
  const unpaid = await earn(call, { bookingId: 'bk_2' }, 'therapist');
  assert.equal(unpaid.status, 200);
  assert.equal(unpaid.body.reason, 'NOT_ELIGIBLE');
  assert.equal((store.get('loyalty_accounts') || new Map()).size, 0);
  assert.equal((store.get('loyalty_transactions') || new Map()).size, 0);
});

test('the membership tier multiplier is applied and the tier is persisted', async () => {
  const { store, call } = await harness({
    loyalty_accounts: {
      cust_u_alice: {
        id: 'cust_u_alice', customerId: 'cust_u_alice', customerName: 'Alice',
        pointsBalance: 4, lifetimePointsEarned: 4, currentTierId: 'gold', currentTierName: 'Gold',
        qualifiedSpend: 0, qualifiedBookings: 0, status: 'active',
      },
    },
    membership_tiers: {
      member: memberTier,
      gold: { id: 'gold', name: 'Gold', level: 2, enabled: true, earningMultiplier: 2, minimumQualifiedSpend: 100000, minimumCompletedBookings: 1 },
    },
  });
  const res = await earn(call, { bookingId: 'bk_1' }, 'therapist');
  assert.equal(res.body.pointsEarned, 32); // 16 base points x 2.0 multiplier
  assert.equal(res.body.balance, 36);
  const account = store.get('loyalty_accounts')!.get('cust_u_alice')!;
  assert.equal(account.currentTierId, 'gold');
  assert.deepEqual(store.get('loyalty_transactions')!.get('ltx_earn_bk_1')!.metadata, {
    serviceName: 'Massage', basePoints: 16, earningMultiplier: 2, netSpend: 160000,
  });
});

test('a fully discounted booking yields NO_POINTS and leaves the balance untouched', async () => {
  const base = seed();
  const { store, call } = await harness({
    bookings: { ...base.bookings, bk_9: { ...base.bookings.bk_1, id: 'bk_9', voucherDiscount: 155000 } },
  });
  const res = await earn(call, { bookingId: 'bk_9' }, 'therapist');
  assert.equal(res.status, 200);
  assert.equal(res.body.reason, 'NO_POINTS');
  assert.equal(res.body.pointsEarned, 0);
  assert.equal((store.get('loyalty_transactions') || new Map()).size, 0);
});

test('account provisioning: owner and staff succeed, a foreign customer is refused', async () => {
  const { store, call } = await harness({ loyalty_accounts: {} });
  const asOwner = await ensure(call, { customerId: 'cust_u_alice' }, 'alice');
  assert.equal(asOwner.status, 200);
  assert.equal(asOwner.body.account.customerId, 'cust_u_alice');
  assert.equal(asOwner.body.account.pointsBalance, 0);
  assert.equal(asOwner.body.account.memberNumber, 'SZH-456789');

  const asStaff = await ensure(call, { customerId: 'cust_u_other' }, 'css');
  assert.equal(asStaff.status, 200);
  assert.equal(store.get('loyalty_accounts')!.has('cust_u_other'), true);

  const asForeigner = await ensure(call, { customerId: 'cust_u_alice' }, 'bob');
  assert.equal(asForeigner.status, 403);
});

test('account provisioning without a customerId resolves the caller profile; no token is refused', async () => {
  const { call } = await harness({ loyalty_accounts: {} });
  const bySession = await ensure(call, {}, 'alice');
  assert.equal(bySession.status, 200);
  assert.equal(bySession.body.account.customerId, 'cust_u_alice');
  const anonymous = await ensure(call, { customerId: 'cust_u_alice' });
  assert.equal(anonymous.status, 401);
});

const sync = (call: any, body: Doc = {}, token?: string) => call('/api/loyalty/sync', body, token);

// ---- catch-up sync: covers orders finished before the fix, or a completion path whose trigger never ran ----

test('sync credits every completed + paid booking of the caller that has no ledger entry yet', async () => {
  const { store, call } = await harness();
  const first = await sync(call, {}, 'alice');
  assert.equal(first.status, 200);
  assert.equal(first.body.customerId, 'cust_u_alice');
  // bk_1 paid -> 16 points; bk_discount is fully discounted -> checked but nothing to credit; bk_2 is UNPAID.
  assert.equal(first.body.checked, 2);
  assert.equal(first.body.credited, 1);
  assert.equal(first.body.points, 16);
  assert.equal(store.get('loyalty_accounts')!.get('cust_u_alice')!.pointsBalance, 16);
  assert.equal(store.get('loyalty_transactions')!.has('ltx_earn_bk_1'), true);

  const second = await sync(call, {}, 'alice');
  assert.equal(second.body.credited, 0);
  assert.equal(store.get('loyalty_accounts')!.get('cust_u_alice')!.pointsBalance, 16);
});

test('sync only credits the caller own profile; staff may name another customer', async () => {
  const { call } = await harness();
  // 'bob' owns no customer profile, so there is nothing he is allowed to sync.
  const foreign = await sync(call, {}, 'bob');
  assert.equal(foreign.status, 403);
  const anonymous = await sync(call, {});
  assert.equal(anonymous.status, 401);

  const asStaff = await sync(call, { customerId: 'cust_u_alice' }, 'css');
  assert.equal(asStaff.status, 200);
  assert.equal(asStaff.body.customerId, 'cust_u_alice');
  assert.equal(asStaff.body.credited, 1);
});
