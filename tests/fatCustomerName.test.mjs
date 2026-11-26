// FAT Finance customer-name resolution. Offline fixtures follow the real writer schemas in
// src/server/paymentAcceptance.ts (payments) and server.ts/cleanBookingRecord (bookings).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveFatCustomerName, hydrateFatCustomerNames } from '../src/server/fatCustomerName.ts';

const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');

// Real payment shape: PAY-<bookingId> id, bookingId relation, snapshot customerName (may be absent on legacy docs).
const payment = (id, bookingId, customerName) => ({
  id: `PAY-${id}`,
  bookingId,
  bookingCode: `SR-${id}`,
  ...(customerName === undefined ? {} : { customerName }),
  customerId: `cust-${id}`,
  customerWhatsApp: '081234567890',
  amount: 250000,
  currency: 'IDR',
  status: 'paid',
  createdAt: '2026-11-24T02:00:00.000Z',
});
// Real booking shape: document id is the bookingId; authoritative customerName snapshot on the booking.
const booking = (customerName, extra = {}) => ({
  id: 'b1',
  bookingCode: 'SR-1',
  customerId: 'cust-1',
  customerAuthUid: 'uid-1',
  customerName,
  customerWhatsApp: '081234567890',
  customerEmail: 'pemesan@example.com',
  ...extra,
});

function fakeDb(records = new Map()) {
  const calls = [];
  return {
    calls,
    collection(name) {
      assert.equal(name, 'bookings', 'lookup must target the bookings collection only');
      return { doc: (id) => ({ __bookingId: id }) };
    },
    async getAll(...args) {
      const options = args.pop();
      assert.deepEqual(options, { fieldMask: ['customerName'] }, 'fetch only the customerName field');
      calls.push(args.map(ref => ref.__bookingId));
      return args.map(ref => {
        const data = records.get(ref.__bookingId);
        return data === undefined
          ? { exists: false, data: () => undefined }
          : { exists: true, data: () => data };
      });
    },
  };
}

test('1. payment customerName snapshot is used directly', () => {
  assert.equal(resolveFatCustomerName(payment('1', 'b1', 'Rina Pertiwi'), booking('Nama Lama')), 'Rina Pertiwi');
});

test('2. payment without name falls back to booking customerName', () => {
  assert.equal(resolveFatCustomerName(payment('1', 'b1'), booking('Rina Pertiwi')), 'Rina Pertiwi');
});

test('3. legacy payment with a valid booking relation gets the name from the booking', async () => {
  const rows = [payment('legacy', 'b1')];
  delete rows[0].customerWhatsApp; // older documents may also lack later snapshot fields
  const db = fakeDb(new Map([['b1', booking('Rina Pertiwi')]]));
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, 'Rina Pertiwi');
  assert.equal(db.calls.length, 1);
});

test('4. multiple payments pointing at different bookings resolve independently', async () => {
  const rows = [payment('a', 'b1'), payment('b', 'b2', 'Snapshot B'), payment('c', 'b3')];
  const db = fakeDb(new Map([['b1', booking('Nama B1')], ['b2', booking('Nama B2 Baru')], ['b3', booking('Nama B3')]]));
  await hydrateFatCustomerNames(rows, db);
  assert.deepEqual(rows.map(r => r.customerName), ['Nama B1', 'Snapshot B', 'Nama B3']);
});

test('5. payment without a booking relation keeps an empty name', async () => {
  const rows = [payment('orphan', '')];
  const db = fakeDb(new Map([['b1', booking('Rina Pertiwi')]]));
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, '');
  assert.equal(db.calls.length, 0, 'no lookup should be attempted without a bookingId');
});

test('6. booking not found keeps an empty name', async () => {
  const rows = [payment('missing', 'b999')];
  const db = fakeDb(new Map());
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, '');
});

test('7. booking found but customerName absent keeps an empty name', async () => {
  const rows = [payment('noname', 'b1')];
  const db = fakeDb(new Map([['b1', booking(undefined)]]));
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, '');
});

test('8. empty and whitespace names are treated as missing; booking name still wins', async () => {
  const rows = [payment('ws', 'b1', '   '), payment('empty', 'b2', '')];
  const db = fakeDb(new Map([['b1', booking('  Rina Pertiwi  ')], ['b2', booking('   ')]]));
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, 'Rina Pertiwi', 'whitespace snapshot must not block the valid booking name');
  assert.equal(rows[1].customerName, '', 'whitespace-only sources must resolve to empty');
});

test('9. name is never replaced by email, phone, booking code or ids', async () => {
  const rows = [payment('contact', 'b1')];
  const db = fakeDb(new Map([['b1', booking(undefined, { customerEmail: 'pemesan@example.com' })]]));
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, '');
  assert.equal(resolveFatCustomerName(payment('contact', 'b1'), booking('   ', { customerEmail: 'pemesan@example.com' })), '');
  assert.equal(resolveFatCustomerName(payment('contact', 'b1', '081234567890'), booking('Rina Pertiwi')), '081234567890',
    'a populated snapshot is preserved verbatim and is not rewritten from other fields');
});

test('10. batched lookup is used instead of one read per payment', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => payment(`p${i}`, `b${i % 7}`));
  const records = new Map(Array.from({ length: 7 }, (_, i) => [`b${i}`, booking(`Nama ${i}`)]));
  const db = fakeDb(records);
  await hydrateFatCustomerNames(rows, db);
  assert.equal(db.calls.length, 1, 'all distinct bookingIds must be fetched in one getAll batch');
  assert.equal(db.calls[0].length, 7, 'each distinct bookingId is fetched exactly once');
  assert.equal(rows.filter(r => r.customerName.startsWith('Nama ')).length, 120);
});

test('11. chunking respects Firestore batch limits and preserves the input set/order', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => payment(`p${i}`, `b${i}`));
  const records = new Map(rows.map((_, i) => [`b${i}`, booking(`Nama ${i}`)]));
  const db = fakeDb(records);
  await hydrateFatCustomerNames(rows, db, 10);
  assert.equal(db.calls.length, 3, '25 ids at chunk size 10 => ceil(25/10) batched reads, not 25');
  assert.deepEqual(rows.map(r => r.id), Array.from({ length: 25 }, (_, i) => `PAY-p${i}`), 'no rows added, removed or reordered');
  assert.equal(rows.filter(r => r.customerName).length, 25, 'page-sized input is fully resolved');
});

test('12. a malformed legacy bookingId does not discard the rest of the batch', async () => {
  const rows = [payment('bad', 'SR/2026/1'), payment('good', 'b1')];
  const db = fakeDb(new Map([['b1', booking('Rina Pertiwi')]]));
  await hydrateFatCustomerNames(rows, db);
  assert.equal(rows[0].customerName, '');
  assert.equal(rows[1].customerName, 'Rina Pertiwi');
  assert.deepEqual(db.calls, [['b1']]);
});

test('13. server endpoint and frontend keep name in projection, search and export', () => {
  const server = read('server.ts');
  assert.match(server, /hydrateFatCustomerNames\(payments, adminDb\)/, 'endpoint must hydrate names after projection');
  assert.match(server, /limit\(FAT_LIST_LIMIT \+ 1\)/, 'existing query limit must remain');
  assert.match(server, /'customerName'/);
  assert.match(server, /'bookingId'/);
  const ui = read('src/components/fat/FatFinanceTab.tsx');
  assert.match(ui, /title=\{p\.customerName \|\| '-'\}/, 'full name tooltip is preserved');
  assert.match(ui, /p\.bookingCode, p\.customerName, p\.bookingId/, 'search still includes customerName');
  assert.match(ui, /'Nama Pemesan': p\.customerName \|\| '-'/, 'export still includes customerName');
});
