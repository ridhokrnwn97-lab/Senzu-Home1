// Offline unit checks only. No credentials, network, or Firestore access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveCatalogServicePrice, resolveHistoricalServicePrice } from '../src/server/bookingPriceSnapshot.ts';
import { calculateBookingPrice } from '../src/lib/pricingService.ts';

const promo = {
  id: 'promo-10', name: 'Diskon 10%', description: 'Diskon 10%', voucherType: 'percentage_discount',
  value: 10, minimumSpend: 0, stackable: false, enabled: true,
  validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

test('booking created at 325000 stays at 325000 after catalog price rises to 425000', () => {
  const booking = { servicePrice: 325000, servicePriceSnapshot: 325000 };
  assert.deepEqual(resolveHistoricalServicePrice(booking), { ok: true, price: 325000, source: 'snapshot' });
});

test('a new booking after the catalog change uses 425000 from the catalog', () => {
  assert.deepEqual(resolveCatalogServicePrice(425000), { ok: true, price: 425000, source: 'catalog' });
});

test('missing snapshot falls back to the immutable booking price; invalid or mismatched snapshots are rejected', () => {
  // Legacy bookings created before snapshots existed still carry a rules-validated servicePrice.
  assert.deepEqual(resolveHistoricalServicePrice({ servicePrice: 325000 }), { ok: true, price: 325000, source: 'booking-price' });

  const rejection = (booking) => {
    const result = resolveHistoricalServicePrice(booking);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'VOUCHER_REDEMPTION_REVIEW_REQUIRED');
  };
  rejection({ servicePrice: 325000, servicePriceSnapshot: 100000 });
  rejection({ servicePrice: 325000, servicePriceSnapshot: '325000' });
  rejection({ servicePrice: 325000, servicePriceSnapshot: 0 });
  rejection({ servicePrice: 325000, servicePriceSnapshot: NaN });
  rejection({ servicePrice: 325000, servicePriceSnapshot: -1 });
  rejection({ servicePrice: 0, servicePriceSnapshot: 0 });
  rejection({});
});

test('voucher discount uses the historical snapshot, not the raised catalog price', () => {
  const oldBooking = { servicePrice: 325000, servicePriceSnapshot: 325000 };
  const historical = resolveHistoricalServicePrice(oldBooking);
  assert.equal(historical.ok, true);

  const redeemed = calculateBookingPrice({ servicePrice: historical.price, homeServiceFee: 0, promoVoucher: promo });
  const repricedFromCatalog = calculateBookingPrice({ servicePrice: 425000, homeServiceFee: 0, promoVoucher: promo });

  assert.equal(redeemed.servicePrice, 325000);
  assert.equal(redeemed.promoDiscountAmount, 32500);
  assert.equal(redeemed.finalAmount, 292500);
  assert.equal(repricedFromCatalog.promoDiscountAmount, 42500);
});

test('resolving one booking neither mutates it nor affects another booking', () => {
  const oldBooking = Object.freeze({ servicePrice: 325000, servicePriceSnapshot: 325000 });
  const otherBooking = Object.freeze({ servicePrice: 425000, servicePriceSnapshot: 425000 });

  assert.equal(resolveHistoricalServicePrice(oldBooking).price, 325000);
  assert.equal(resolveHistoricalServicePrice(otherBooking).price, 425000);
  assert.equal(resolveHistoricalServicePrice(oldBooking).price, 325000);
  assert.deepEqual(oldBooking, { servicePrice: 325000, servicePriceSnapshot: 325000 });
});

test('voucher redemption resolves price from the booking snapshot, never the live catalog', () => {
  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /resolveHistoricalServicePrice\(bookingData\)/);
  assert.doesNotMatch(server, /resolveCatalogServicePrice\(serviceData\.price\)/);
  assert.doesNotMatch(server, /bookingData\.servicePriceSnapshot !== authoritativeServicePrice/);
  assert.doesNotMatch(server, /bookingData\.servicePrice !== authoritativeServicePrice/);
});
