export const META_ADS_TRIGGERS = {
  xendit_live_paid: 'Pembayaran Xendit Live terverifikasi',
  booking_submitted: 'Konfirmasi & Ajukan Booking Senzu berhasil',
  payment_confirmation_or_proof: 'Konfirmasi pembayaran atau bukti pembayaran terkirim',
  payment_confirmation_clicked: 'Klik Bantuan / Konfirmasi via WA',
  payment_proof_submitted: 'Bukti pembayaran berhasil dikirim',
} as const;

export type MetaAdsTrigger = keyof typeof META_ADS_TRIGGERS;
export const META_STANDARD_EVENTS = [
  'AddPaymentInfo', 'AddToCart', 'AddToWishlist', 'CompleteRegistration', 'Contact',
  'CustomizeProduct', 'Donate', 'FindLocation', 'InitiateCheckout', 'Lead', 'PageView',
  'Purchase', 'Schedule', 'Search', 'StartTrial', 'SubmitApplication', 'Subscribe', 'ViewContent',
] as const;

export interface MetaAdsPixel { id: string; name: string; pixelId: string; enabled: boolean }
export interface MetaAdsEvent {
  id: string;
  trigger: MetaAdsTrigger;
  kind: 'standard' | 'custom';
  eventName: string;
  pixelIds: 'all' | string[];
  enabled: boolean;
}
export interface MetaAdsSettings {
  schemaVersion: 1;
  enabled: boolean;
  revision: number;
  pixels: MetaAdsPixel[];
  events: MetaAdsEvent[];
}

export function defaultMetaAdsSettings(): MetaAdsSettings {
  return {
    schemaVersion: 1, enabled: false, revision: 0, pixels: [],
    events: [
      { id: 'booking_add_to_cart', trigger: 'booking_submitted', kind: 'standard', eventName: 'AddToCart', pixelIds: 'all', enabled: true },
      { id: 'payment_lead', trigger: 'xendit_live_paid', kind: 'standard', eventName: 'Lead', pixelIds: 'all', enabled: true },
    ],
  };
}

/** Accept IDs and event names, never HTML, JavaScript or arbitrary event parameters. */
export function validateMetaAdsSettings(value: unknown): MetaAdsSettings {
  const data = value as MetaAdsSettings;
  const invalid = (message: string): never => { throw new Error(message); };
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== 1 || typeof data.enabled !== 'boolean'
    || !Number.isSafeInteger(data.revision) || data.revision < 0
    || !Array.isArray(data.pixels) || data.pixels.length > 10 || !Array.isArray(data.events) || data.events.length > 30) {
    return invalid('Format pengaturan Meta Pixel tidak valid (maksimal 10 Pixel dan 30 peristiwa).');
  }
  const ids = new Set<string>(), pixelNumbers = new Set<string>();
  const pixels = data.pixels.map(pixel => {
    if (!pixel || !validId(pixel.id) || ids.has(pixel.id) || typeof pixel.enabled !== 'boolean'
      || typeof pixel.name !== 'string' || !pixel.name.trim() || pixel.name.trim().length > 80
      || typeof pixel.pixelId !== 'string' || !/^\d{5,30}$/.test(pixel.pixelId) || pixelNumbers.has(pixel.pixelId)) {
      return invalid('Isi nama dan Pixel ID berupa 5–30 digit angka. Setiap Pixel ID harus unik.');
    }
    ids.add(pixel.id); pixelNumbers.add(pixel.pixelId);
    return { id: pixel.id, name: pixel.name.trim(), pixelId: pixel.pixelId, enabled: pixel.enabled };
  });
  const eventIds = new Set<string>();
  const events = data.events.map(event => {
    if (!event || !validId(event.id) || eventIds.has(event.id) || typeof event.enabled !== 'boolean'
      || !Object.prototype.hasOwnProperty.call(META_ADS_TRIGGERS, event.trigger)
      || !['standard', 'custom'].includes(event.kind) || typeof event.eventName !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(event.eventName)
      || (event.kind === 'standard' && !(META_STANDARD_EVENTS as readonly string[]).includes(event.eventName))
      || (event.kind === 'custom' && (META_STANDARD_EVENTS as readonly string[]).includes(event.eventName))
      || (event.pixelIds !== 'all' && (!Array.isArray(event.pixelIds) || event.pixelIds.length > 10
        || event.pixelIds.some(id => !ids.has(id)) || new Set(event.pixelIds).size !== event.pixelIds.length))) {
      return invalid('Periksa pemicu, nama peristiwa, dan target Pixel. Nama custom memakai huruf, angka, atau garis bawah (maksimal 40 karakter).');
    }
    eventIds.add(event.id);
    // Upgrade saved Lead rules too, retaining opt-out and Pixel targets.
    const trigger: MetaAdsTrigger = event.kind === 'standard' && event.eventName === 'Lead' ? 'xendit_live_paid' : event.trigger;
    return { id: event.id, trigger, kind: event.kind, eventName: event.eventName, pixelIds: event.pixelIds === 'all' ? 'all' as const : [...event.pixelIds], enabled: event.enabled };
  });
  return { schemaVersion: 1, enabled: data.enabled, revision: data.revision, pixels, events };
}
