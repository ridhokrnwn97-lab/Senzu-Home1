// Pure location validation/freshness logic. No Firestore or Google Maps call is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const bundle = await build({
  entryPoints: ['src/lib/locationTracking.ts'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  Date,
  Number,
  Math,
  console,
});
const {
  isValidLatLng,
  parseTherapistLocation,
  getLocationFreshness,
  LIVE_MAX_AGE_MS,
  STALE_MAX_AGE_MS,
} = module.exports;

const NOW = Date.parse('2026-11-14T04:00:00.000Z');

function fixture(overrides = {}) {
  return {
    therapistId: 'th-1',
    therapistName: 'Sari',
    bookingId: 'bk-1',
    bookingCode: 'SZH-1',
    latitude: -2.976074,
    longitude: 104.757305,
    accuracy: 12,
    timestamp: new Date(NOW - 5000).toISOString(),
    updatedAtMillis: NOW - 5000,
    isTrackingActive: true,
    ...overrides,
  };
}

test('valid GPS location is accepted only for its own booking', () => {
  const parsed = parseTherapistLocation(fixture(), 'bk-1');
  assert.ok(parsed);
  assert.equal(parsed.latitude, -2.976074);
  assert.equal(parsed.longitude, 104.757305);
  assert.equal(parsed.isTrackingActive, true);
  assert.equal(parseTherapistLocation(fixture(), 'bk-other'), null);
  assert.equal(parseTherapistLocation(fixture({ bookingId: '' }), 'bk-1'), null);
});

test('invalid latitude/longitude, accuracy and timestamp are rejected', () => {
  const rejected = [
    { latitude: Number.NaN },
    { longitude: Number.POSITIVE_INFINITY },
    { latitude: 91 },
    { latitude: -91 },
    { longitude: 180.5 },
    { longitude: -180.5 },
    { latitude: '2.9' },
    { accuracy: -1 },
    { accuracy: Number.NaN },
    { accuracy: undefined },
    { timestamp: 'not-a-date', updatedAtMillis: undefined },
    { timestamp: undefined, updatedAtMillis: Number.NaN },
    { timestamp: undefined, updatedAtMillis: 0 },
  ];
  for (const patch of rejected) {
    assert.equal(
      parseTherapistLocation(fixture(patch), 'bk-1'),
      null,
      JSON.stringify(patch)
    );
  }
  for (const raw of [null, undefined, [], 'x', 42]) {
    assert.equal(parseTherapistLocation(raw, 'bk-1'), null);
  }
});

test('updatedAtMillis falls back to the ISO timestamp when absent', () => {
  const parsed = parseTherapistLocation(
    fixture({ updatedAtMillis: undefined }),
    'bk-1'
  );
  assert.ok(parsed);
  assert.equal(parsed.updatedAtMillis, NOW - 5000);
});

test('freshness is LIVE, STALE, then OFFLINE by age and tracking state', () => {
  assert.equal(getLocationFreshness(fixture({ updatedAtMillis: NOW }), NOW), 'LIVE');
  assert.equal(
    getLocationFreshness(fixture({ updatedAtMillis: NOW - LIVE_MAX_AGE_MS }), NOW),
    'LIVE'
  );
  assert.equal(
    getLocationFreshness(fixture({ updatedAtMillis: NOW - LIVE_MAX_AGE_MS - 1 }), NOW),
    'STALE'
  );
  assert.equal(
    getLocationFreshness(fixture({ updatedAtMillis: NOW - STALE_MAX_AGE_MS }), NOW),
    'STALE'
  );
  assert.equal(
    getLocationFreshness(fixture({ updatedAtMillis: NOW - STALE_MAX_AGE_MS - 1 }), NOW),
    'OFFLINE'
  );
  assert.equal(
    getLocationFreshness(
      { updatedAtMillis: NOW, isTrackingActive: false },
      NOW
    ),
    'OFFLINE'
  );
});

test('latitude/longitude range validation accepts boundaries', () => {
  assert.equal(isValidLatLng(-90, -180), true);
  assert.equal(isValidLatLng(90, 180), true);
  assert.equal(isValidLatLng(0, 0), true);
  assert.equal(isValidLatLng(90.0001, 0), false);
  assert.equal(isValidLatLng(0, -180.0001), false);
  assert.equal(isValidLatLng('0', 0), false);
});
