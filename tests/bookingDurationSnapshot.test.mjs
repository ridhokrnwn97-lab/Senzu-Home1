// Red-green coverage for historical service-duration snapshots.
// Pure helpers: no Firestore, no network, no mutation of booking records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveCatalogServiceDuration,
  resolveHistoricalServiceDuration,
} from '../src/server/bookingDurationSnapshot.ts';

test('new booking takes duration from the authoritative catalog only', () => {
  assert.deepEqual(resolveCatalogServiceDuration(90), { ok: true, duration: 90, source: 'catalog' });
  assert.deepEqual(resolveCatalogServiceDuration('90'), {
    ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error: 'Durasi layanan resmi tidak dapat diverifikasi.',
  });
});

test('booking keeps its 60-minute snapshot after the catalog changes to 90 minutes', () => {
  const booking = Object.freeze({ serviceDuration: 60, durationMinutesSnapshot: 60 });
  assert.deepEqual(resolveHistoricalServiceDuration(booking), { ok: true, duration: 60, source: 'snapshot' });
});

test('legacy booking without a snapshot uses its own stored serviceDuration, never the catalog', () => {
  assert.deepEqual(resolveHistoricalServiceDuration({ serviceDuration: 75 }),
    { ok: true, duration: 75, source: 'booking-duration' });
  assert.deepEqual(resolveHistoricalServiceDuration({ serviceDuration: 75, durationMinutesSnapshot: null }),
    { ok: true, duration: 75, source: 'booking-duration' });
});

test('missing, malformed or inconsistent historical duration fails closed', () => {
  const bad = [
    {},
    { durationMinutesSnapshot: undefined },
    { durationMinutesSnapshot: null },
    { durationMinutesSnapshot: '60', serviceDuration: 60 },
    { durationMinutesSnapshot: 0 },
    { durationMinutesSnapshot: -1 },
    { durationMinutesSnapshot: NaN },
    { durationMinutesSnapshot: Infinity },
    { durationMinutesSnapshot: 60.5 },
    { durationMinutesSnapshot: 1441 },
    { durationMinutesSnapshot: 60, serviceDuration: '60' },
    { durationMinutesSnapshot: 60, serviceDuration: 90 },
    { durationMinutesSnapshot: 60, serviceDuration: 0 },
  ];
  for (const booking of bad) {
    const result = resolveHistoricalServiceDuration(booking);
    assert.equal(result.ok, false, JSON.stringify(booking));
    assert.equal(result.code, 'VOUCHER_REDEMPTION_REVIEW_REQUIRED');
    assert.ok(result.error.includes('Durasi'), result.error);
  }
});

test('resolving historical duration does not mutate bookings or leak across bookings', () => {
  const first = Object.freeze({ serviceDuration: 60, durationMinutesSnapshot: 60 });
  const second = Object.freeze({ serviceDuration: 120, durationMinutesSnapshot: 120 });
  assert.equal(resolveHistoricalServiceDuration(first).duration, 60);
  assert.equal(resolveHistoricalServiceDuration(second).duration, 120);
  assert.equal(resolveHistoricalServiceDuration(first).duration, 60);
  assert.deepEqual(first, { serviceDuration: 60, durationMinutesSnapshot: 60 });
});

test('source guard: redeem and checkout no longer compare historical duration with live catalog', () => {
  const server = fs.readFileSync('server.ts', 'utf8').replace(/\s+/g, '');
  assert.ok(!server.includes('bookingData.serviceDuration!==serviceData.duration'));
  assert.ok(!server.includes('req.body?.serviceDuration!==serviceData.duration'));
  assert.ok(server.includes('resolveHistoricalServiceDuration(bookingData)'));
  assert.ok(server.includes('resolveCatalogServiceDuration(serviceData.duration)'));
  // New bookings write one validated value to both historical duration fields.
  assert.ok(server.includes('serviceDuration:authoritativeDuration.duration'));
  assert.ok(server.includes('durationMinutesSnapshot:authoritativeDuration.duration'));
  // Service validity is still checked independently of historical duration.
  assert.ok(server.includes('serviceData.isActive!==true'));
});
