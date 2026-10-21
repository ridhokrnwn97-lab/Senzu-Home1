import { createHash } from 'node:crypto';
import { SENZU_BASE_LOCATION } from '../lib/distanceFeeService.ts';

export const liveError = (status: number, code: string, message = 'Pembayaran Xendit belum dapat diproses.') =>
  Object.assign(new Error(message), { status, code });

/** Seal only server-committed commercial terms; operational state may advance later. */
export function liveQuoteSeal(b: any): string {
  return createHash('sha256').update(JSON.stringify([
    b.id, b.bookingCode, b.customerAuthUid, b.authUserId, b.customerId,
    b.serviceId, b.serviceName, b.serviceDuration, b.servicePrice, b.homeServiceFee, b.discountAmount, b.totalAmount,
    b.promoDiscount || 0, b.voucherDiscount || 0, b.pointsRedeemed || 0, b.pointsDiscount || 0,
    b.latitude, b.longitude, b.distanceKm, b.distanceMeters, b.address, b.placeId, b.area,
    b.scheduleDate, b.scheduleTime, b.customerGender, b.gatewayReceiptId,
  ])).digest('hex');
}

export function validateLiveSchedule(input: any, duration: number, settings: any, clock = Date.now) {
  const date = input.scheduleDate, time = input.scheduleTime;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !['Laki-laki', 'Perempuan'].includes(input.customerGender)) {
    throw liveError(400, 'INVALID_LIVE_SCHEDULE', 'Tanggal, jam, atau gender pelanggan belum valid.');
  }
  const stamp = Date.parse(`${date}T${time}:00+07:00`);
  if (!Number.isFinite(stamp) || new Date(stamp + 7 * 3600000).toISOString().slice(0, 10) !== date) {
    throw liveError(400, 'INVALID_LIVE_SCHEDULE', 'Tanggal layanan tidak valid.');
  }
  const lead = settings?.leadTimeMinutes ?? 60, advance = settings?.maxAdvanceDays ?? 14;
  const start = settings?.operatingHoursStart ?? '10:00', end = settings?.operatingHoursEnd ?? '22:00';
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  if (![lead, advance, duration].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0) ||
      ![start, end].every(v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) || start >= end) {
    throw liveError(503, 'LIVE_SCHEDULE_CONFIG_INVALID', 'Pengaturan jadwal perlu diperiksa oleh Manager.');
  }
  const today = new Date(clock() + 7 * 3600000).toISOString().slice(0, 10);
  if (stamp < clock() + lead * 60000 ||
      Date.parse(`${date}T00:00:00+07:00`) - Date.parse(`${today}T00:00:00+07:00`) > advance * 86400000 ||
      minutes(time) < minutes(start) || minutes(time) + duration > minutes(end)) {
    throw liveError(409, 'LIVE_SCHEDULE_UNAVAILABLE', 'Pilih jadwal dalam jam layanan dan jeda minimum pemesanan.');
  }
}

/** Recalculate driving distance on the server. Client distance is never payment authority. */
export async function quoteLiveDrivingDistance(latitude: number, longitude: number, env: NodeJS.ProcessEnv, fetcher = fetch) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw liveError(400, 'INVALID_COORDINATES');
  }
  const key = env.GOOGLE_MAPS_SERVER_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) throw liveError(503, 'LIVE_ROUTE_UNAVAILABLE', 'Jarak layanan belum dapat diverifikasi. Silakan coba kembali.');
  try {
    const r = await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration', 'Referer': 'https://senzu-home.ai.studio/' },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: SENZU_BASE_LOCATION.lat, longitude: SENZU_BASE_LOCATION.lng } } },
        destination: { location: { latLng: { latitude, longitude } } }, travelMode: 'DRIVE',
      }),
    });
    const data = await r.json() as any, route = data?.routes?.[0];
    const atBase = Math.abs(latitude - SENZU_BASE_LOCATION.lat) < 0.0001 && Math.abs(longitude - SENZU_BASE_LOCATION.lng) < 0.0001;
    const meters = route?.distanceMeters ?? (route?.duration === '0s' && atBase ? 0 : NaN);
    if (!r.ok || !Number.isInteger(meters) || meters < 0 || meters > 500000 || (meters === 0 && !atBase)) throw new Error();
    return { distanceKm: meters / 1000, distanceMeters: meters };
  } catch {
    throw liveError(503, 'LIVE_ROUTE_UNAVAILABLE', 'Jarak layanan belum dapat diverifikasi. Silakan coba kembali.');
  }
}
