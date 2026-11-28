// Pure duration-resolution helpers for voucher checkout and redemption.
// Minutes are integers; no Firestore, credentials, or side effects.
// Historical durations never come from the live catalog or the client request.

export type DurationResolution =
  | { ok: true; duration: number; source: 'catalog' | 'snapshot' | 'booking-duration' }
  | { ok: false; code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED'; error: string };

export interface BookingDurationFields {
  serviceDuration?: unknown;
  durationMinutesSnapshot?: unknown;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 1440;

function validMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_MINUTES && value <= MAX_MINUTES;
}

function rejected(error: string): DurationResolution {
  return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error };
}

// Catalog duration is authoritative only for a NEW booking.
export function resolveCatalogServiceDuration(catalogDuration: unknown): DurationResolution {
  if (validMinutes(catalogDuration)) return { ok: true, duration: catalogDuration, source: 'catalog' };
  return rejected('Durasi layanan resmi tidak dapat diverifikasi.');
}

// For an EXISTING booking the stored snapshot is the historical duration source.
// Legacy bookings without a snapshot fall back to serviceDuration, the original
// per-booking field written from the catalog value at creation time. The live
// catalog and request body are never consulted here.
export function resolveHistoricalServiceDuration(booking: BookingDurationFields): DurationResolution {
  const hasSnapshot = booking.durationMinutesSnapshot !== undefined && booking.durationMinutesSnapshot !== null;
  const hasBookingDuration = booking.serviceDuration !== undefined && booking.serviceDuration !== null;

  if (!hasSnapshot) {
    if (validMinutes(booking.serviceDuration)) {
      return { ok: true, duration: booking.serviceDuration, source: 'booking-duration' };
    }
    return rejected('Durasi layanan pada pesanan tidak dapat diverifikasi.');
  }

  if (!validMinutes(booking.durationMinutesSnapshot)) {
    return rejected('Durasi historis layanan tidak dapat diverifikasi secara otomatis.');
  }
  if (hasBookingDuration) {
    if (!validMinutes(booking.serviceDuration)) {
      return rejected('Durasi layanan pada pesanan tidak dapat diverifikasi.');
    }
    if (booking.serviceDuration !== booking.durationMinutesSnapshot) {
      return rejected('Durasi layanan pada pesanan berbeda dari snapshot dan memerlukan peninjauan.');
    }
  }
  return { ok: true, duration: booking.durationMinutesSnapshot, source: 'snapshot' };
}
