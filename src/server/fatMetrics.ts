// Pure FAT metric helpers: no Firestore, no credentials, no side effects.
import type { PaymentStatusCode } from '../types/payment';

export type FatAmount = { value: number | null; valid: boolean };

// Accepts only finite non-negative numbers or strict plain decimal strings.
// Never coerces separators, empty values, NaN/Infinity, or negatives to zero.
export function parseFatAmount(v: unknown): FatAmount {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? { value: v, valid: true } : { value: null, valid: false };
  if (typeof v === 'string') {
    const s = v.trim();
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(s)) return { value: null, valid: false };
    const n = Number(s);
    return Number.isFinite(n) ? { value: n, valid: true } : { value: null, valid: false };
  }
  return { value: null, valid: false };
}

export const normalizeFatStatus = (v: unknown) => String(v ?? '').trim().toLowerCase();

// Legacy codes are still accepted by payment proof-event validation in server.ts.
export type LegacyPaymentStatusCode = 'verified' | 'settled' | 'pending_verification';
export type FatCategory = 'paid' | 'pending' | 'rejected' | 'expired' | 'refunded' | 'unpaid' | 'cancelled' | 'unknown';

// Anything not listed (including missing/empty) is Unknown, never Unpaid.
export const FAT_STATUS_CATEGORY: Record<PaymentStatusCode | LegacyPaymentStatusCode, FatCategory> = {
  paid: 'paid',
  pending: 'pending',
  pending_payment: 'pending',
  pending_manual_verification: 'pending',
  payment_rejected: 'rejected',
  failed: 'rejected',
  expired: 'expired',
  refunded: 'refunded',
  partially_refunded: 'refunded',
  unpaid: 'unpaid',
  cancelled: 'cancelled',
  verified: 'paid',
  settled: 'paid',
  pending_verification: 'pending',
};

export const fatStatusCategory = (v: unknown): FatCategory =>
  FAT_STATUS_CATEGORY[normalizeFatStatus(v) as PaymentStatusCode | LegacyPaymentStatusCode] || 'unknown';

const FAT_CATEGORIES: readonly FatCategory[] = ['paid', 'pending', 'rejected', 'expired', 'refunded', 'unpaid', 'cancelled', 'unknown'];

// statusCategory is already a category; never compare it with raw payment statuses.
export const fatCategoryOf = (v: unknown): FatCategory => {
  const s = normalizeFatStatus(v);
  return FAT_CATEGORIES.includes(s as FatCategory) ? s as FatCategory : 'unknown';
};

export type FatCategoryItem = { statusCategory?: unknown; amount?: unknown; amountValid?: boolean };

export function summarizeFatCategories<T extends FatCategoryItem>(items: readonly T[]) {
  const bucket = () => ({ count: 0, amount: 0 });
  const result: Record<FatCategory, { count: number; amount: number }> = {
    paid: bucket(), pending: bucket(), rejected: bucket(), expired: bucket(),
    refunded: bucket(), unpaid: bucket(), cancelled: bucket(), unknown: bucket(),
  };
  for (const item of items) {
    const target = result[fatCategoryOf(item.statusCategory)];
    target.count += 1;
    if (item.amountValid === true && typeof item.amount === 'number') target.amount += item.amount;
  }
  return result;
}

export type FatRefundRow = {
  caseId: string;
  bookingId: string;
  bookingCode: string;
  refundPaymentId: string;
  refundPaymentHistoryId: string;
  refundStatus: string;
  refundAmount: number | null;
  refundAmountValid: boolean;
  refundNotes: string;
  updatedAt: unknown;
  createdAt: unknown;
};

// One row per case. payment_status_history is an audit trail, never the nominal source.
export function projectFatRefund(data: any, docId = ''): FatRefundRow | null {
  const c = data || {};
  const rec = c.recovery || {};
  const rs = String(rec.refundStatus || '').toUpperCase();
  if (!rs || rs === 'NOT_REQUIRED') return null;
  const ra = parseFatAmount(rec.refundAmount);
  return {
    caseId: String(c.caseId || docId || ''),
    bookingId: String(c.bookingId || ''),
    bookingCode: String(c.bookingCode || ''),
    refundPaymentId: String(rec.refundPaymentId || ''),
    refundPaymentHistoryId: String(rec.refundPaymentHistoryId || ''),
    refundStatus: rs,
    refundAmount: ra.value,
    refundAmountValid: ra.valid,
    refundNotes: typeof rec.refundNotes === 'string' ? rec.refundNotes.slice(0, 240) : '',
    updatedAt: rec.updatedAt || c.updatedAt,
    createdAt: c.createdAt,
  };
}

export function summarizeFatRefunds(rows: readonly (FatRefundRow | null)[]) {
  const seen = new Set<string>();
  let caseCount = 0, completedManualCount = 0, amountTotal = 0, amountCompletedManual = 0, invalidAmountCount = 0;
  for (const row of rows) {
    if (!row || seen.has(row.caseId)) continue; // one refund per case; never double count
    seen.add(row.caseId);
    caseCount += 1;
    if (row.refundStatus === 'COMPLETED_MANUAL') completedManualCount += 1;
    if (!row.refundAmountValid || row.refundAmount === null) { invalidAmountCount += 1; continue; }
    amountTotal += row.refundAmount;
    if (row.refundStatus === 'COMPLETED_MANUAL') amountCompletedManual += row.refundAmount;
  }
  return { caseCount, completedManualCount, amountTotal, amountCompletedManual, invalidAmountCount };
}

export type FatRefundAnomalySummary = {
  duplicateRefundCompletionEvents: number;
  paymentLinkedToMultipleCases: number;
  refundPaymentIdWithoutHistoryId: number;
  refundPaymentHistoryIdWithoutPaymentId: number;
  rejectedWithActiveLinkage: number;
  legacyMissingCompletionGuard: number;
};

// Anomalies are reported, never used to silently drop or inflate a refund row.
export function summarizeFatRefundAnomalies(input: {
  rows: readonly FatRefundRow[];
  completionEventCaseIds?: readonly string[];
  completionGuardCaseIds?: readonly string[];
}): FatRefundAnomalySummary {
  const eventCounts = new Map<string, number>();
  for (const caseId of input.completionEventCaseIds || []) {
    if (!caseId) continue;
    eventCounts.set(caseId, (eventCounts.get(caseId) || 0) + 1);
  }
  let duplicateRefundCompletionEvents = 0;
  for (const count of eventCounts.values()) if (count > 1) duplicateRefundCompletionEvents += 1;

  const paymentOwners = new Map<string, Set<string>>();
  let refundPaymentIdWithoutHistoryId = 0;
  let refundPaymentHistoryIdWithoutPaymentId = 0;
  let rejectedWithActiveLinkage = 0;
  let legacyMissingCompletionGuard = 0;
  const guardIds = new Set(input.completionGuardCaseIds || []);

  for (const row of input.rows) {
    if (row.refundPaymentId && !row.refundPaymentHistoryId) refundPaymentIdWithoutHistoryId += 1;
    if (row.refundPaymentHistoryId && !row.refundPaymentId) refundPaymentHistoryIdWithoutPaymentId += 1;
    if (row.refundStatus === 'REJECTED' && (row.refundPaymentId || row.refundPaymentHistoryId)) rejectedWithActiveLinkage += 1;
    if (row.refundStatus === 'COMPLETED_MANUAL' && !guardIds.has(row.caseId)) legacyMissingCompletionGuard += 1;
    if (row.refundPaymentId) {
      const owners = paymentOwners.get(row.refundPaymentId) || new Set<string>();
      if (row.caseId) owners.add(row.caseId);
      paymentOwners.set(row.refundPaymentId, owners);
    }
  }
  let paymentLinkedToMultipleCases = 0;
  for (const owners of paymentOwners.values()) if (owners.size > 1) paymentLinkedToMultipleCases += 1;

  return {
    duplicateRefundCompletionEvents,
    paymentLinkedToMultipleCases,
    refundPaymentIdWithoutHistoryId,
    refundPaymentHistoryIdWithoutPaymentId,
    rejectedWithActiveLinkage,
    legacyMissingCompletionGuard,
  };
}

export function summarizeFatPaymentReconciliation(input: {
  transactionCount: number;
  classified: number;
  unknown: number;
  failed: number;
}) {
  return {
    totalDocuments: input.transactionCount,
    classified: input.classified,
    unknown: input.unknown,
    failed: input.failed,
    reconciled: input.transactionCount === input.classified + input.unknown + input.failed,
  };
}

export function canTransitionRefundStatus(current: string | undefined | null, next: string): boolean {
  const allowed = ['APPROVED', 'PROCESSING_MANUAL', 'COMPLETED_MANUAL', 'REJECTED'];
  const knownCurrent = ['', 'REVIEW_REQUIRED', 'APPROVED', 'PROCESSING_MANUAL', 'REJECTED', 'COMPLETED_MANUAL'];
  if (!allowed.includes(next)) return false;
  const now = String(current || '').toUpperCase();
  if (!knownCurrent.includes(now)) return false;
  if (now === 'REJECTED' || now === 'COMPLETED_MANUAL') return now === next;
  return true;
}

export function evaluateRefundPaymentClaim(input: {
  targetPaymentId: string;
  linkedRefundPaymentId?: string | null;
  claimOwnerCaseId?: string | null;
  claimStatus?: string | null;
  reservationOwnerCaseId?: string | null;
  caseId: string;
}): { ok: boolean; code?: string; message?: string } {
  const claimStatus = cleanRefundText(input.claimStatus).toUpperCase();
  const claimOwner = cleanRefundText(input.claimOwnerCaseId);
  if (claimStatus === 'CLAIMED' && !claimOwner) {
    return {
      ok: false,
      code: 'PAYMENT_REFUND_CLAIM_MARKER_INCONSISTENT',
      message: 'Marker claim permanen tidak memiliki case pemilik yang valid.',
    };
  }
  if (claimOwner && claimOwner !== input.caseId) {
    return {
      ok: false,
      code: 'PAYMENT_REFUND_CLAIM_CONFLICT',
      message: 'Pembayaran ini sudah terkait dengan kasus refund lain.',
    };
  }
  if (input.reservationOwnerCaseId && input.reservationOwnerCaseId !== input.caseId) {
    return {
      ok: false,
      code: 'PAYMENT_REFUND_RESERVATION_CONFLICT',
      message: 'Pembayaran ini sudah reservasi untuk kasus refund lain.',
    };
  }
  if (input.linkedRefundPaymentId && input.linkedRefundPaymentId !== input.targetPaymentId) {
    return {
      ok: false,
      code: 'FOREIGN_PAYMENT_LINKAGE',
      message: 'ID pembayaran pada permintaan tidak sesuai dengan pembayaran tertaut.',
    };
  }
  return { ok: true };
}

const cleanRefundText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function matchesManualRefundRequestId(
  authoritativeRequestId: string | null | undefined,
  incomingRequestId: string | null | undefined
): boolean {
  const authoritative = cleanRefundText(authoritativeRequestId);
  const incoming = cleanRefundText(incomingRequestId);
  if (!authoritative && !incoming) return true;
  return Boolean(authoritative && incoming && authoritative === incoming);
}

export function rejectionPayloadMatchesAuthoritativeState(input: {
  authoritative: {
    rejectedByUid?: unknown;
    rejectedBy?: unknown;
    rejectedByName?: unknown;
    rejectionReason?: unknown;
    refundAmount?: unknown;
    refundMethod?: unknown;
    refundDate?: unknown;
    refundReference?: unknown;
    refundProofUrl?: unknown;
  };
  incoming: {
    actorUid: string;
    actorStaffId: string;
    actorName: string;
    note: string;
    refundAmount: number | null;
    refundMethod: string;
    refundDate: string;
    refundReference: string;
    refundProofUrl: string;
  };
}): boolean {
  const a = input.authoritative;
  const i = input.incoming;
  if (cleanRefundText(a.rejectedByUid) !== cleanRefundText(i.actorUid)) return false;
  if (cleanRefundText(a.rejectedBy) !== cleanRefundText(i.actorStaffId)) return false;
  if (cleanRefundText(a.rejectedByName) !== cleanRefundText(i.actorName)) return false;
  if (cleanRefundText(a.rejectionReason) !== cleanRefundText(i.note)) return false;
  if (i.refundAmount === null) {
    if (a.refundAmount !== undefined && a.refundAmount !== null) return false;
  } else if (typeof a.refundAmount !== 'number' || a.refundAmount !== i.refundAmount) {
    return false;
  }
  return (
    cleanRefundText(a.refundMethod) === cleanRefundText(i.refundMethod) &&
    cleanRefundText(a.refundDate) === cleanRefundText(i.refundDate) &&
    cleanRefundText(a.refundReference) === cleanRefundText(i.refundReference) &&
    cleanRefundText(a.refundProofUrl) === cleanRefundText(i.refundProofUrl)
  );
}

export function evaluateRefundPaymentReservation(input: {
  caseId: string;
  claimOwnerCaseId?: string | null;
  claimStatus?: string | null;
  reservationOwnerCaseId?: string | null;
  reservationStatus?: string | null;
}): { ok: boolean; code?: string; message?: string } {
  const claimStatus = cleanRefundText(input.claimStatus).toUpperCase();
  const claimOwner = cleanRefundText(input.claimOwnerCaseId);
  const reservationOwner = cleanRefundText(input.reservationOwnerCaseId);
  if (claimStatus === 'CLAIMED' && !claimOwner) {
    return {
      ok: false,
      code: 'PAYMENT_REFUND_CLAIM_MARKER_INCONSISTENT',
      message: 'Marker claim permanen tidak memiliki case pemilik yang valid.',
    };
  }
  if (claimOwner && claimOwner !== input.caseId) {
    return {
      ok: false,
      code: 'PAYMENT_REFUND_CLAIM_CONFLICT',
      message: 'Pembayaran ini sudah diklaim untuk kasus refund lain.',
    };
  }
  if (reservationOwner && reservationOwner !== input.caseId) {
    return {
      ok: false,
      code: 'PAYMENT_REFUND_RESERVATION_CONFLICT',
      message: 'Pembayaran ini sudah reservasi untuk kasus refund lain.',
    };
  }
  if (reservationOwner === input.caseId && cleanRefundText(input.reservationStatus).toUpperCase() === 'RELEASED') {
    return { ok: false, code: 'REFUND_RESERVATION_RELEASED', message: 'Reservasi refund kasus ini sudah dilepaskan.' };
  }
  return { ok: true };
}

const CANONICAL_REFUND_STATUSES = [
  'NOT_REQUIRED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'PROCESSING_MANUAL',
  'REJECTED',
  'COMPLETED_MANUAL',
] as const;

export type RefundRecoveryClassification = {
  isRefund: boolean;
  status: string;
  legacy: boolean;
  reason?: 'REFUND_STATUS_MISSING' | 'LEGACY_REFUND_STATUS';
};

export function classifyRefundRecovery(
  recovery: { type?: unknown; refundStatus?: unknown } | null | undefined
): RefundRecoveryClassification {
  const type = cleanRefundText(recovery?.type).toLowerCase();
  const status = cleanRefundText(recovery?.refundStatus).toUpperCase();
  const typeIndicatesRefund = type.includes('refund');
  if (!status) {
    return typeIndicatesRefund
      ? { isRefund: true, status: '', legacy: true, reason: 'REFUND_STATUS_MISSING' }
      : { isRefund: false, status: '', legacy: false };
  }
  if (status === 'NOT_REQUIRED') return { isRefund: false, status, legacy: false };
  if ((CANONICAL_REFUND_STATUSES as readonly string[]).includes(status)) {
    return { isRefund: true, status, legacy: false };
  }
  return { isRefund: true, status, legacy: true, reason: 'LEGACY_REFUND_STATUS' };
}

export function recoveryApproveFingerprintPayload(input: {
  action: 'recovery_approve';
  caseId: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  approvedRefundAmount: number | null;
  actorUid: string;
  requestId: string;
}): string {
  return JSON.stringify([
    input.action,
    input.caseId,
    input.decision,
    input.reason,
    input.approvedRefundAmount,
    input.actorUid,
    input.requestId,
  ]);
}

export function recoveryApproveReceiptMatches(input: {
  receipt: {
    id?: unknown;
    action?: unknown;
    requestId?: unknown;
    actorUid?: unknown;
    caseId?: unknown;
    decision?: unknown;
    fingerprint?: unknown;
  };
  expected: {
    receiptId: string;
    requestId: string;
    actorUid: string;
    caseId: string;
    decision: string;
    fingerprint: string;
  };
}): boolean {
  const r = input.receipt;
  const e = input.expected;
  return cleanRefundText(r.id) === e.receiptId
    && cleanRefundText(r.action) === 'recovery_approve'
    && cleanRefundText(r.requestId) === e.requestId
    && cleanRefundText(r.actorUid) === e.actorUid
    && cleanRefundText(r.caseId) === e.caseId
    && cleanRefundText(r.decision) === e.decision
    && cleanRefundText(r.fingerprint) === e.fingerprint;
}

export function buildRecoveryAuditLog(input: {
  id: string;
  caseId: string;
  caseCode: string;
  bookingId: string;
  bookingCode: string;
  action: 'recovery_approved' | 'recovery_rejected';
  actorUid: string;
  actorStaffId: string;
  actorName: string;
  actorRole: 'manager' | 'admin' | 'supervisor' | 'css' | 'system';
  note: string;
  timestamp: string;
  formattedWIB: string;
}) {
  return {
    id: input.id,
    caseId: input.caseId,
    caseCode: input.caseCode,
    bookingId: input.bookingId,
    bookingCode: input.bookingCode,
    action: input.action,
    actorUid: input.actorUid,
    actorId: input.actorStaffId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    note: input.note,
    timestamp: input.timestamp,
    formattedWIB: input.formattedWIB,
  };
}

export function computeFatAnomalyScope(input: {
  eventsCount: number;
  guardsCount: number;
  limit: number;
}): { scannedCount: number; limit: number; hasMore: boolean } {
  return {
    scannedCount: Math.max(input.eventsCount, input.guardsCount),
    limit: input.limit,
    hasMore: input.eventsCount > input.limit || input.guardsCount > input.limit,
  };
}
