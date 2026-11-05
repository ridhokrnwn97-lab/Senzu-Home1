/** A read-only analytics receipt. Never changes a payment, booking or ledger. */
export function manualPaidMetaReceipt(booking: any, payment: any, uid: string, hasStaffRole: boolean, now = Date.now()) {
  const owner = (record: any) => {
    const primary = record?.customerAuthUid, legacy = record?.authUserId;
    if (primary && legacy && primary !== legacy) return null;
    return typeof (primary || legacy) === 'string' ? primary || legacy : null;
  };
  const stamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
  const b = booking, p = payment;
  if (hasStaffRole || !uid || !b || !p || owner(b) !== uid || owner(p) !== uid
    || typeof b.id !== 'string' || !b.id || p.bookingId !== b.id || b.activePaymentId !== p.id
    || typeof p.id !== 'string' || !p.id || p.paymentType !== 'manual' || p.currency !== 'IDR'
    || p.status !== 'paid' || !['paid', 'PAID'].includes(b.paymentStatus)
    || !Number.isSafeInteger(p.amount) || p.amount <= 0 || p.amount !== b.totalAmount
    || !['BNI', 'MANDIRI', 'BRI', 'QRIS'].includes(p.bankCode)
    || p.provider !== (p.bankCode === 'QRIS' ? 'bni_merchant' : 'manual_senzu')
    || b.paymentMethod === 'Xendit' || b.gatewayProvider || b.gatewayEnvironment || b.gatewayReviewRequired
    || p.gatewayEnvironment || p.gatewaySessionId || p.providerReferenceId || p.providerTransactionId
    || b.isTest || p.isTest || b.environment === 'test' || p.environment === 'test'
    || p.correctedAt || p.reconciliationRequired || p.possibleDuplicatePayment
    || p.refundedAt || p.refundAmount || p.refundStatus
    || /cancel|batal|refund|expired|kedaluwarsa|rejected|ditolak/i.test(String(b.status))
    || !p.paymentProofUrl || !p.verifiedBy || typeof p.verifiedByAuthUid !== 'string' || !p.verifiedByAuthUid
    || !['css', 'supervisor', 'manager', 'admin'].includes(p.verifiedByRole)
    || !stamp(p.verifiedAt) || !stamp(p.paidAt) || !stamp(p.createdAt)
    || Date.parse(p.createdAt) > Date.parse(p.verifiedAt) || Date.parse(p.paidAt) > Date.parse(p.verifiedAt)
    || Date.parse(p.verifiedAt) > now) return null;
  return { schemaVersion: 1, source: 'staff_verified_manual', bookingId: b.id, paymentId: p.id,
    amount: p.amount, currency: 'IDR', verifiedAt: p.verifiedAt };
}
