import type { TherapistLocation } from '../types';

// Ambang kesegaran posisi. Penulisan dari TherapistDashboard dibatasi minimal
// 30 detik, jadi 90 detik memberi ruang untuk satu siklus tulis yang terlewat.
export const LIVE_MAX_AGE_MS = 90_000;
export const STALE_MAX_AGE_MS = 5 * 60_000;

export type LocationFreshness = 'LIVE' | 'STALE' | 'OFFLINE';

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// Satu-satunya gerbang data lokasi dari Firestore. Data yang tidak lolos
// validasi tidak boleh dipakai sebagai posisi terapis.
export function parseTherapistLocation(
  raw: unknown,
  expectedBookingId?: string
): TherapistLocation | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const loc = raw as Record<string, unknown>;

  if (typeof loc.bookingId !== 'string' || !loc.bookingId) return null;
  if (expectedBookingId && loc.bookingId !== expectedBookingId) return null;
  if (!isValidLatLng(loc.latitude, loc.longitude)) return null;

  const accuracy = loc.accuracy;
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) return null;

  const parsedTimestamp = typeof loc.timestamp === 'string' ? Date.parse(loc.timestamp) : NaN;
  const millis =
    typeof loc.updatedAtMillis === 'number' &&
    Number.isFinite(loc.updatedAtMillis) &&
    loc.updatedAtMillis > 0
      ? loc.updatedAtMillis
      : parsedTimestamp;
  if (!Number.isFinite(millis) || millis <= 0) return null;

  return {
    therapistId: typeof loc.therapistId === 'string' ? loc.therapistId : '',
    therapistName: typeof loc.therapistName === 'string' ? loc.therapistName : '',
    bookingId: loc.bookingId,
    bookingCode: typeof loc.bookingCode === 'string' ? loc.bookingCode : '',
    latitude: loc.latitude as number,
    longitude: loc.longitude as number,
    accuracy,
    heading: typeof loc.heading === 'number' && Number.isFinite(loc.heading) ? loc.heading : null,
    speed: typeof loc.speed === 'number' && Number.isFinite(loc.speed) ? loc.speed : null,
    timestamp: typeof loc.timestamp === 'string' ? loc.timestamp : new Date(millis).toISOString(),
    updatedAtMillis: millis,
    isTrackingActive: loc.isTrackingActive !== false,
  };
}

export function locationAgeMs(
  loc: Pick<TherapistLocation, 'updatedAtMillis'>,
  now = Date.now()
): number {
  return Math.max(0, now - loc.updatedAtMillis);
}

export function getLocationFreshness(
  loc: Pick<TherapistLocation, 'updatedAtMillis' | 'isTrackingActive'>,
  now = Date.now()
): LocationFreshness {
  if (!loc.isTrackingActive) return 'OFFLINE';
  const age = locationAgeMs(loc, now);
  if (age <= LIVE_MAX_AGE_MS) return 'LIVE';
  if (age <= STALE_MAX_AGE_MS) return 'STALE';
  return 'OFFLINE';
}
