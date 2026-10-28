import { createHash } from 'node:crypto';
import { paymentOwner } from './paymentAcceptance.ts';
import { syncFailure } from './accurateSyncProvider.ts';

export const MANUAL_CHANNELS = ['BNI', 'MANDIRI', 'BRI', 'QRIS'] as const;
export type ManualChannel = typeof MANUAL_CHANNELS[number];
export type ManualAccount = { code: string; name: string };
export type AccurateManualPaidEvent = { kind: 'manual'; booking: any; payment: any; bookingCreatedAt: number; receipt: any };
export const isManualSource = (v: any): v is AccurateManualPaidEvent => v?.kind === 'manual';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stamp = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const safeId = (v: any) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function manualSourceSeal(booking: any, payment: any) {
  return digest([booking.id, booking.bookingCode, booking.customerAuthUid ?? null, booking.authUserId ?? null,
    booking.customerId ?? null, booking.serviceId, booking.serviceName, booking.serviceDuration,
    booking.servicePrice, booking.homeServiceFee, booking.discountAmount ?? 0, booking.totalAmount,
    booking.paymentMethod, booking.activePaymentId, payment.id, payment.bookingId, payment.customerAuthUid ?? null,
    payment.authUserId ?? null, payment.paymentType, payment.provider, payment.currency, payment.amount,
    payment.bankCode, payment.accountNumberSnapshot, payment.accountHolderSnapshot, payment.paymentMethod,
    payment.createdAt, payment.paidAt, payment.verifiedAt, payment.verifiedBy, payment.verifiedByAuthUid,
    payment.verifiedByRole, payment.paymentProofHash ?? null, digest(payment.paymentProofUrl ?? null)]);
}
export function validateManualSource(v: AccurateManualPaidEvent) {
  const b = v.booking, p = v.payment, r = v.receipt;
  const channel = p?.bankCode;
  if (!b || !p || !r || !safeId(b.id) || !/^SH-\d{6}-[A-Z0-9]{5,20}$/.test(b.bookingCode || '') ||
      b.paymentMethod === 'Xendit' || b.gatewayProvider || b.gatewayEnvironment || b.gatewayReviewRequired ||
      !['paid', 'PAID'].includes(b.paymentStatus) || b.activePaymentId !== p.id || p.id !== `PAY-${b.id}` ||
      p.bookingId !== b.id || p.status !== 'paid' || p.paymentType !== 'manual' || p.currency !== 'IDR' ||
      !MANUAL_CHANNELS.includes(channel) || p.provider !== (channel === 'QRIS' ? 'bni_merchant' : 'manual_senzu') ||
      p.gatewayEnvironment || p.providerReferenceId || p.providerTransactionId || p.gatewaySessionId ||
      p.correctedAt || p.reconciliationRequired || p.possibleDuplicatePayment || p.refundedAt || p.refundAmount || p.refundStatus ||
      !safeId(p.verifiedBy) || !safeId(p.verifiedByAuthUid) || !['css', 'supervisor', 'manager', 'admin'].includes(p.verifiedByRole) ||
      !stamp(p.verifiedAt) || !stamp(p.paidAt) || !stamp(p.createdAt) || Date.parse(p.createdAt) > Date.parse(p.verifiedAt) ||
      !p.paymentProofUrl || typeof p.accountNumberSnapshot !== 'string' || !p.accountNumberSnapshot ||
      typeof p.accountHolderSnapshot !== 'string' || !p.accountHolderSnapshot ||
      r.schemaVersion !== 1 || r.bookingId !== b.id || r.paymentId !== p.id || r.verifiedAt !== p.verifiedAt ||
      r.actorUid !== p.verifiedByAuthUid || r.seal !== manualSourceSeal(b, p) ||
      ['cancelled', 'canceled', 'refunded', 'expired', 'rescheduled', 'rejected'].includes(String(b.status).toLowerCase())) {
    throw syncFailure('SYNC_MANUAL_SOURCE_INVALID', true);
  }
  // Authenticated and guest bookings use the same existing ownership checks.
  try {
    const bo = paymentOwner(b), po = paymentOwner(p);
    if (bo !== po) throw new Error();
  } catch { throw syncFailure('SYNC_MANUAL_SOURCE_INVALID', true); }
  return channel as ManualChannel;
}
