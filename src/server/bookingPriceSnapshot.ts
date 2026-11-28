// Pure price-resolution helpers for voucher redemption and new bookings.
// No Firestore, credentials, or side effects.

export type PriceResolution =
  | { ok: true; price: number; source: 'snapshot' | 'booking-price' | 'catalog' }
  | { ok: false; code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED'; error: string };

export interface BookingPriceFields {
  servicePrice?: unknown;
  servicePriceSnapshot?: unknown;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function rejected(error: string): PriceResolution {
  return { ok: false, code: 'VOUCHER_REDEMPTION_REVIEW_REQUIRED', error };
}

// Catalog price is authoritative only for a NEW booking.
export function resolveCatalogServicePrice(catalogPrice: unknown): PriceResolution {
  if (finitePositive(catalogPrice)) {
    return { ok: true, price: catalogPrice, source: 'catalog' };
  }
  return rejected('Harga layanan resmi tidak dapat diverifikasi.');
}

// For an EXISTING booking the stored snapshot is the historical price source.
// Legacy bookings without a snapshot fall back to servicePrice, which Firestore
// rules (hasOfficialBookingPrice) validated against the catalog at creation.
export function resolveHistoricalServicePrice(booking: BookingPriceFields): PriceResolution {
  const hasSnapshot = booking.servicePriceSnapshot !== undefined && booking.servicePriceSnapshot !== null;

  if (!hasSnapshot) {
    if (finitePositive(booking.servicePrice)) {
      return { ok: true, price: booking.servicePrice, source: 'booking-price' };
    }
    return rejected('Harga layanan pada pesanan tidak dapat diverifikasi.');
  }

  if (!finitePositive(booking.servicePriceSnapshot)) {
    return rejected('Snapshot harga layanan tidak dapat diverifikasi secara otomatis.');
  }
  if (
    booking.servicePrice !== undefined &&
    booking.servicePrice !== null &&
    booking.servicePrice !== booking.servicePriceSnapshot
  ) {
    return rejected('Harga layanan pada pesanan berbeda dari snapshot dan memerlukan peninjauan.');
  }

  return { ok: true, price: booking.servicePriceSnapshot, source: 'snapshot' };
}
