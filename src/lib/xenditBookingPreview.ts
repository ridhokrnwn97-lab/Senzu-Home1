import { calculateHomeServiceFee } from './distanceFeeService.ts';

/** Internal simulation inputs, never a booking, voucher redemption or Live quote. */
export type XenditBookingPreviewInput = {
  serviceId: string;
  distanceKm: number;
  discountAmount: number;
  expectedAmount: number;
};
export type XenditBookingPreview = {
  source: 'internal_booking_simulation';
  serviceId: string;
  serviceName: string;
  servicePrice: number;
  distanceKm: number;
  homeServiceFee: number;
  discountAmount: number;
  totalAmount: number;
};
const money = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000;
const serviceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const distance = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 500;

export function normalizeXenditBookingPreview(value: any): XenditBookingPreviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 4 || Object.keys(value).some(key => !['serviceId', 'distanceKm', 'discountAmount', 'expectedAmount'].includes(key)) ||
      !serviceId(value.serviceId) || !distance(value.distanceKm) || !money(value.discountAmount) ||
      !money(value.expectedAmount) || value.expectedAmount < 10_000) {
    throw new Error('Ringkasan uji belum valid. Pilih layanan, periksa jarak dan potongan; total uji minimal Rp10.000.');
  }
  return { serviceId: value.serviceId, distanceKm: value.distanceKm,
    discountAmount: value.discountAmount, expectedAmount: value.expectedAmount };
}

export function isXenditBookingPreview(value: any): value is XenditBookingPreview {
  return Boolean(value && value.source === 'internal_booking_simulation' && serviceId(value.serviceId) &&
    typeof value.serviceName === 'string' && value.serviceName.trim() && value.serviceName.length <= 160 &&
    money(value.servicePrice) && value.servicePrice > 0 && distance(value.distanceKm) && money(value.homeServiceFee) &&
    value.homeServiceFee === calculateHomeServiceFee(value.distanceKm).fee && money(value.discountAmount) &&
    money(value.totalAmount) && value.totalAmount >= 10_000 &&
    value.totalAmount === value.servicePrice + value.homeServiceFee - value.discountAmount);
}
