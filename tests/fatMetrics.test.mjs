// Offline unit checks only. No credentials, network, or Firestore access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFatAmount, normalizeFatStatus, fatStatusCategory, fatCategoryOf,
  summarizeFatCategories, projectFatRefund, summarizeFatRefunds,
  summarizeFatRefundAnomalies, summarizeFatPaymentReconciliation,
  canTransitionRefundStatus, evaluateRefundPaymentClaim, evaluateRefundPaymentReservation,
  matchesManualRefundRequestId, rejectionPayloadMatchesAuthoritativeState,
  classifyRefundRecovery, recoveryApproveFingerprintPayload, recoveryApproveReceiptMatches,
  buildRecoveryAuditLog, computeFatAnomalyScope,
} from '../src/server/fatMetrics.ts';

test('parseFatAmount separates valid amounts from invalid values', () => {
  assert.deepEqual(parseFatAmount(150000), { value: 150000, valid: true });
  assert.deepEqual(parseFatAmount('150000'), { value: 150000, valid: true });
  assert.deepEqual(parseFatAmount(' 1250.50 '), { value: 1250.5, valid: true });
  // Zero stays valid: it is not converted to null and not treated as a missing value.
  assert.deepEqual(parseFatAmount(0), { value: 0, valid: true });
  assert.deepEqual(parseFatAmount('0'), { value: 0, valid: true });
  assert.deepEqual(parseFatAmount(Number.MAX_SAFE_INTEGER), { value: Number.MAX_SAFE_INTEGER, valid: true });
  for (const v of [null, undefined, '', '  ', '1.000.000', '12,5', '1e3', '150000.999', '1234567890123456', 'abc', NaN, Infinity, -Infinity, -1, -0.01, true, {}, []]) {
    assert.deepEqual(parseFatAmount(v), { value: null, valid: false }, String(v));
  }
});

test('payment status categories include pending_payment and legacy codes', () => {
  assert.equal(fatStatusCategory('paid'), 'paid');
  assert.equal(fatStatusCategory(' PENDING '), 'pending');
  assert.equal(fatStatusCategory('pending_payment'), 'pending');
  assert.equal(fatStatusCategory('pending_manual_verification'), 'pending');
  assert.equal(fatStatusCategory('payment_rejected'), 'rejected');
  assert.equal(fatStatusCategory('failed'), 'rejected');
  assert.equal(fatStatusCategory('expired'), 'expired');
  assert.equal(fatStatusCategory('refunded'), 'refunded');
  assert.equal(fatStatusCategory('partially_refunded'), 'refunded');
  assert.equal(fatStatusCategory('cancelled'), 'cancelled');
  assert.equal(fatStatusCategory('unpaid'), 'unpaid');
  assert.equal(fatStatusCategory('verified'), 'paid');
  assert.equal(fatStatusCategory('settled'), 'paid');
  assert.equal(fatStatusCategory('pending_verification'), 'pending');
  for (const v of ['', undefined, null, '  ', 'waiting_payment']) {
    assert.equal(fatStatusCategory(v), 'unknown', String(v));
  }
  assert.equal(normalizeFatStatus('PAID'), 'paid');
});

test('statusCategory is compared as a category, never as a raw payment status', () => {
  assert.equal(fatCategoryOf('rejected'), 'rejected');
  assert.equal(fatCategoryOf(' PAID '), 'paid');
  assert.equal(fatCategoryOf('payment_rejected'), 'unknown');
  assert.equal(fatCategoryOf('failed'), 'unknown');
  assert.equal(fatCategoryOf('pending_manual_verification'), 'unknown');
  assert.equal(fatCategoryOf('something_else'), 'unknown');
});

test('summarizeFatCategories counts rejected and reconciles with transaction count', () => {
  const rows = [
    { statusCategory: 'paid', amount: 100000, amountValid: true },
    { statusCategory: 'pending', amount: 50000, amountValid: true },
    { statusCategory: 'rejected', amount: 25000, amountValid: true },
    { statusCategory: 'expired', amount: 10000, amountValid: true },
    { statusCategory: 'refunded', amount: 5000, amountValid: true },
    { statusCategory: 'cancelled', amount: 2000, amountValid: true },
    { statusCategory: 'unknown', amount: 1000, amountValid: true },
    { statusCategory: 'unpaid', amount: null, amountValid: false },
  ];
  const s = summarizeFatCategories(rows);
  assert.equal(s.paid.count, 1);
  assert.equal(s.paid.amount, 100000);
  assert.equal(s.pending.count, 1);
  assert.equal(s.rejected.count, 1);
  assert.notEqual(s.rejected.count, 0);
  assert.equal(s.rejected.amount, 25000);
  assert.equal(s.expired.count, 1);
  assert.equal(s.refunded.count, 1);
  assert.equal(s.cancelled.count, 1);
  assert.equal(s.unknown.count, 1);
  assert.equal(s.unpaid.count, 1);
  // Invalid amount is counted but never added to any nominal.
  assert.equal(s.unpaid.amount, 0);
  assert.equal(Object.values(s).reduce((n, b) => n + b.count, 0), rows.length);
});

test('FAT refund projection uses recovery.refundPaymentId, not linkedPaymentId', () => {
  const row = projectFatRefund({
    caseId: 'case-1', bookingId: 'booking-1', bookingCode: 'BK-1',
    linkedPaymentId: 'WRONG-LINK',
    recovery: {
      refundStatus: 'COMPLETED_MANUAL', refundAmount: 50000,
      refundPaymentId: 'PAY-1', refundPaymentHistoryId: 'PSH-1',
    },
  }, 'doc-1');
  assert.equal(row.refundPaymentId, 'PAY-1');
  assert.equal(row.refundPaymentHistoryId, 'PSH-1');
  assert.equal(row.caseId, 'case-1');
  assert.equal(row.refundAmount, 50000);
  assert.equal(row.refundAmountValid, true);
  // No writer exists for cases.linkedPaymentId, so it must never leak into the report.
  assert.ok(!('linkedPaymentId' in row));
});

test('refund summary counts only completed as realized and ignores NOT_REQUIRED', () => {
  const completed = projectFatRefund({ caseId: 'c1', recovery: { refundStatus: 'COMPLETED_MANUAL', refundAmount: 50000 } });
  const processing = projectFatRefund({ caseId: 'c2', recovery: { refundStatus: 'PROCESSING_MANUAL', refundAmount: 30000 } });
  const notRequired = projectFatRefund({ caseId: 'c3', recovery: { refundStatus: 'NOT_REQUIRED', refundAmount: 90000 } });
  assert.equal(notRequired, null);
  const s = summarizeFatRefunds([completed, processing, notRequired]);
  assert.equal(s.caseCount, 2);
  assert.equal(s.completedManualCount, 1);
  assert.equal(s.amountTotal, 80000);
  assert.equal(s.amountCompletedManual, 50000);
  assert.equal(s.invalidAmountCount, 0);
});

test('duplicate refund rows for the same case are counted once', () => {
  const doc = { caseId: 'c1', recovery: { refundStatus: 'COMPLETED_MANUAL', refundAmount: 50000, refundPaymentId: 'PAY-1' } };
  const a = projectFatRefund(doc);
  const b = projectFatRefund(doc);
  const s = summarizeFatRefunds([a, b]);
  assert.equal(s.caseCount, 1);
  assert.equal(s.completedManualCount, 1);
  assert.equal(s.amountTotal, 50000);
  assert.equal(s.amountCompletedManual, 50000);
});

test('invalid refund nominal is reported separately and never added to totals', () => {
  const bad = projectFatRefund({ caseId: 'c4', recovery: { refundStatus: 'APPROVED', refundAmount: '1.000.000' } });
  assert.equal(bad.refundAmount, null);
  assert.equal(bad.refundAmountValid, false);
  const s = summarizeFatRefunds([bad]);
  assert.equal(s.caseCount, 1);
  assert.equal(s.amountTotal, 0);
  assert.equal(s.invalidAmountCount, 1);
});

test('refund anomalies are reported for linkage, duplicate events, rejection and legacy gaps', () => {
  const rows = [
    { caseId: 'c1', refundStatus: 'COMPLETED_MANUAL', refundPaymentId: 'PAY-1', refundPaymentHistoryId: '' },
    { caseId: 'c2', refundStatus: 'COMPLETED_MANUAL', refundPaymentId: 'PAY-1', refundPaymentHistoryId: 'PSH-2' },
    { caseId: 'c3', refundStatus: 'REJECTED', refundPaymentId: '', refundPaymentHistoryId: 'PSH-3' },
    { caseId: 'c4', refundStatus: 'APPROVED', refundPaymentId: '', refundPaymentHistoryId: '' },
  ];
  const s = summarizeFatRefundAnomalies({
    rows,
    completionEventCaseIds: ['c1', 'c1', 'c2'],
    completionGuardCaseIds: ['c2'],
  });
  assert.equal(s.duplicateRefundCompletionEvents, 1);
  assert.equal(s.paymentLinkedToMultipleCases, 1);
  assert.equal(s.refundPaymentIdWithoutHistoryId, 1);
  assert.equal(s.refundPaymentHistoryIdWithoutPaymentId, 1);
  assert.equal(s.rejectedWithActiveLinkage, 1);
  assert.equal(s.legacyMissingCompletionGuard, 1);
});

test('payment reconciliation separates classified, unknown and failed documents', () => {
  const s = summarizeFatPaymentReconciliation({ transactionCount: 10, classified: 7, unknown: 2, failed: 1 });
  assert.equal(s.totalDocuments, 10);
  assert.equal(s.reconciled, true);
  assert.equal(summarizeFatPaymentReconciliation({ transactionCount: 10, classified: 7, unknown: 2, failed: 0 }).reconciled, false);
});

test('refund status transition treats REJECTED and COMPLETED_MANUAL as terminal', () => {
  assert.equal(canTransitionRefundStatus(undefined, 'APPROVED'), true);
  assert.equal(canTransitionRefundStatus('REVIEW_REQUIRED', 'PROCESSING_MANUAL'), true);
  assert.equal(canTransitionRefundStatus('APPROVED', 'COMPLETED_MANUAL'), true);
  assert.equal(canTransitionRefundStatus('REJECTED', 'APPROVED'), false);
  assert.equal(canTransitionRefundStatus('REJECTED', 'REJECTED'), true);
  assert.equal(canTransitionRefundStatus('COMPLETED_MANUAL', 'PROCESSING_MANUAL'), false);
  assert.equal(canTransitionRefundStatus('COMPLETED_MANUAL', 'COMPLETED_MANUAL'), true);
  assert.equal(canTransitionRefundStatus('UNKNOWN', 'COMPLETED_MANUAL'), false);
});

test('payment claim is exclusive per case and per payment', () => {
  assert.equal(evaluateRefundPaymentClaim({ targetPaymentId: 'PAY-1', caseId: 'c1' }).ok, true);
  assert.equal(evaluateRefundPaymentClaim({ targetPaymentId: 'PAY-1', caseId: 'c1', claimOwnerCaseId: 'c1' }).ok, true);
  const conflict = evaluateRefundPaymentClaim({ targetPaymentId: 'PAY-1', caseId: 'c2', claimOwnerCaseId: 'c1' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'PAYMENT_REFUND_CLAIM_CONFLICT');
  const foreign = evaluateRefundPaymentClaim({ targetPaymentId: 'PAY-1', caseId: 'c1', linkedRefundPaymentId: 'PAY-2' });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, 'FOREIGN_PAYMENT_LINKAGE');
  const reservedElsewhere = evaluateRefundPaymentClaim({ targetPaymentId: 'PAY-1', caseId: 'c2', reservationOwnerCaseId: 'c1' });
  assert.equal(reservedElsewhere.ok, false);
  assert.equal(reservedElsewhere.code, 'PAYMENT_REFUND_RESERVATION_CONFLICT');
});

test('terminal completion request id must match authoritative request id', () => {
  assert.equal(matchesManualRefundRequestId('req-1', 'req-1'), true);
  assert.equal(matchesManualRefundRequestId('req-1', 'req-2'), false);
  assert.equal(matchesManualRefundRequestId('req-1', ''), false);
  assert.equal(matchesManualRefundRequestId('', 'req-1'), false);
  assert.equal(matchesManualRefundRequestId('', ''), true);
});

test('rejection no-op requires full authoritative payload match', () => {
  const authoritative = {
    rejectedByUid: 'uid-1', rejectedBy: 'staff-1', rejectedByName: 'Manager A',
    rejectionReason: 'alasan', refundAmount: 50000, refundMethod: 'transfer',
    refundDate: '2026-11-18', refundReference: 'REF-1', refundProofUrl: 'https://proof',
  };
  const incoming = {
    actorUid: 'uid-1', actorStaffId: 'staff-1', actorName: 'Manager A', note: 'alasan',
    refundAmount: 50000, refundMethod: 'transfer', refundDate: '2026-11-18',
    refundReference: 'REF-1', refundProofUrl: 'https://proof',
  };
  assert.equal(rejectionPayloadMatchesAuthoritativeState({ authoritative, incoming }), true);
  assert.equal(rejectionPayloadMatchesAuthoritativeState({
    authoritative, incoming: { ...incoming, actorUid: 'uid-2' },
  }), false);
  assert.equal(rejectionPayloadMatchesAuthoritativeState({
    authoritative, incoming: { ...incoming, note: 'alasan lain' },
  }), false);
  assert.equal(rejectionPayloadMatchesAuthoritativeState({
    authoritative, incoming: { ...incoming, refundAmount: 60000 },
  }), false);
});

test('payment reservation is exclusive and distinct from claim', () => {
  assert.equal(evaluateRefundPaymentReservation({ caseId: 'c1' }).ok, true);
  assert.equal(evaluateRefundPaymentReservation({ caseId: 'c1', reservationOwnerCaseId: 'c1' }).ok, true);
  const conflict = evaluateRefundPaymentReservation({ caseId: 'c2', reservationOwnerCaseId: 'c1' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'PAYMENT_REFUND_RESERVATION_CONFLICT');
  const claimed = evaluateRefundPaymentReservation({ caseId: 'c2', claimOwnerCaseId: 'c1' });
  assert.equal(claimed.ok, false);
  assert.equal(claimed.code, 'PAYMENT_REFUND_CLAIM_CONFLICT');
  const released = evaluateRefundPaymentReservation({ caseId: 'c1', reservationOwnerCaseId: 'c1', reservationStatus: 'RELEASED' });
  assert.equal(released.ok, false);
  assert.equal(released.code, 'REFUND_RESERVATION_RELEASED');
});

test('CLAIMED status is checked with its case id fail-closed', () => {
  const missingOwnerClaim = evaluateRefundPaymentClaim({
    targetPaymentId: 'PAY-1', caseId: 'c1', claimStatus: 'CLAIMED',
  });
  assert.equal(missingOwnerClaim.ok, false);
  assert.equal(missingOwnerClaim.code, 'PAYMENT_REFUND_CLAIM_MARKER_INCONSISTENT');

  const missingOwnerReservation = evaluateRefundPaymentReservation({
    caseId: 'c1', claimStatus: 'CLAIMED',
  });
  assert.equal(missingOwnerReservation.ok, false);
  assert.equal(missingOwnerReservation.code, 'PAYMENT_REFUND_CLAIM_MARKER_INCONSISTENT');

  assert.equal(evaluateRefundPaymentClaim({
    targetPaymentId: 'PAY-1', caseId: 'c1', claimStatus: 'CLAIMED', claimOwnerCaseId: 'c1',
  }).ok, true);
  assert.equal(evaluateRefundPaymentReservation({
    caseId: 'c1', claimStatus: 'CLAIMED', claimOwnerCaseId: 'c1', reservationOwnerCaseId: 'c1',
  }).ok, true);

  const otherCaseClaim = evaluateRefundPaymentClaim({
    targetPaymentId: 'PAY-1', caseId: 'c1', claimStatus: 'CLAIMED', claimOwnerCaseId: 'c2',
  });
  assert.equal(otherCaseClaim.ok, false);
  assert.equal(otherCaseClaim.code, 'PAYMENT_REFUND_CLAIM_CONFLICT');

  const otherCaseReservation = evaluateRefundPaymentReservation({
    caseId: 'c1', claimStatus: 'CLAIMED', claimOwnerCaseId: 'c2',
  });
  assert.equal(otherCaseReservation.ok, false);
  assert.equal(otherCaseReservation.code, 'PAYMENT_REFUND_CLAIM_CONFLICT');

  const conflictingReservation = evaluateRefundPaymentReservation({
    caseId: 'c1', claimStatus: 'CLAIMED', claimOwnerCaseId: 'c1',
    reservationOwnerCaseId: 'c2', reservationStatus: 'RESERVED',
  });
  assert.equal(conflictingReservation.ok, false);
  assert.equal(conflictingReservation.code, 'PAYMENT_REFUND_RESERVATION_CONFLICT');
});

test('refund recovery classification treats legacy and missing statuses explicitly', () => {
  const missing = classifyRefundRecovery({ type: 'Manual Refund', refundStatus: undefined });
  assert.deepEqual(missing, {
    isRefund: true, status: '', legacy: true, reason: 'REFUND_STATUS_MISSING',
  });
  const nullStatus = classifyRefundRecovery({ type: 'Manual Refund', refundStatus: null });
  assert.equal(nullStatus.isRefund, true);
  assert.equal(nullStatus.legacy, true);
  const notRequired = classifyRefundRecovery({ type: 'Manual Refund', refundStatus: 'NOT_REQUIRED' });
  assert.deepEqual(notRequired, { isRefund: false, status: 'NOT_REQUIRED', legacy: false });
  const pending = classifyRefundRecovery({ type: 'Manual Refund', refundStatus: 'PENDING' });
  assert.deepEqual(pending, {
    isRefund: true, status: 'PENDING', legacy: true, reason: 'LEGACY_REFUND_STATUS',
  });
  assert.equal(classifyRefundRecovery({ type: 'Voucher', refundStatus: undefined }).isRefund, false);
});

test('approval fingerprint binds request, action and business parameters', () => {
  const base = {
    action: 'recovery_approve', caseId: 'c1', decision: 'APPROVE',
    reason: 'alasan', approvedRefundAmount: 50000, actorUid: 'uid-1', requestId: 'req-1',
  };
  const payload = recoveryApproveFingerprintPayload(base);
  assert.equal(recoveryApproveFingerprintPayload({ ...base }), payload);
  assert.notEqual(recoveryApproveFingerprintPayload({ ...base, decision: 'REJECT' }), payload);
  assert.notEqual(recoveryApproveFingerprintPayload({ ...base, caseId: 'c2' }), payload);
  assert.notEqual(recoveryApproveFingerprintPayload({ ...base, requestId: 'req-2' }), payload);
  assert.notEqual(recoveryApproveFingerprintPayload({ ...base, actorUid: 'uid-2' }), payload);
  assert.notEqual(recoveryApproveFingerprintPayload({ ...base, approvedRefundAmount: 60000 }), payload);
  assert.equal(matchesManualRefundRequestId('req-1', 'req-1'), true);
  assert.equal(matchesManualRefundRequestId('req-1', 'req-2'), false);
});

test('approval receipt rejects request id reuse across case, action and actor', () => {
  const expected = {
    receiptId: 'receipt-1', requestId: 'req-1', actorUid: 'uid-1',
    caseId: 'c1', decision: 'APPROVE', fingerprint: 'fp-1',
  };
  const receipt = {
    id: 'receipt-1', action: 'recovery_approve', requestId: 'req-1',
    actorUid: 'uid-1', caseId: 'c1', decision: 'APPROVE', fingerprint: 'fp-1',
  };
  assert.equal(recoveryApproveReceiptMatches({ receipt, expected }), true);
  const rejectReceipt = { ...receipt, decision: 'REJECT', fingerprint: 'fp-reject' };
  assert.equal(recoveryApproveReceiptMatches({
    receipt: rejectReceipt, expected: { ...expected, decision: 'REJECT', fingerprint: 'fp-reject' },
  }), true);
  assert.equal(recoveryApproveReceiptMatches({
    receipt: rejectReceipt, expected: { ...expected, fingerprint: 'fp-reject-other' },
  }), false);
  assert.equal(recoveryApproveReceiptMatches({
    receipt, expected: { ...expected, requestId: 'req-2' },
  }), false);
  assert.equal(recoveryApproveReceiptMatches({
    receipt, expected: { ...expected, caseId: 'c2' },
  }), false);
  assert.equal(recoveryApproveReceiptMatches({
    receipt, expected: { ...expected, decision: 'REJECT' },
  }), false);
  assert.equal(recoveryApproveReceiptMatches({
    receipt, expected: { ...expected, actorUid: 'uid-2' },
  }), false);
  assert.equal(recoveryApproveReceiptMatches({
    receipt, expected: { ...expected, fingerprint: 'fp-2' },
  }), false);
});

test('recovery audit log uses canonical time, actor role and rejection action', () => {
  const log = buildRecoveryAuditLog({
    id: 'audit-1', caseId: 'c1', caseCode: 'CASE-1', bookingId: 'b1', bookingCode: 'BK-1',
    action: 'recovery_rejected', actorUid: 'uid-1', actorStaffId: 'staff-1',
    actorName: 'Manager A', actorRole: 'manager', note: 'alasan',
    timestamp: '2026-11-18T00:00:00.000Z', formattedWIB: '18 Nov 2026 07.00',
  });
  assert.equal(log.action, 'recovery_rejected');
  assert.equal(log.actorRole, 'manager');
  assert.equal(log.timestamp, '2026-11-18T00:00:00.000Z');
  assert.equal(log.formattedWIB, '18 Nov 2026 07.00');
  assert.equal(log.actorUid, 'uid-1');
  assert.equal(log.actorId, 'staff-1');
});

test('anomaly scope metadata reports documents actually scanned', () => {
  assert.deepEqual(computeFatAnomalyScope({ eventsCount: 1001, guardsCount: 1000, limit: 1000 }), {
    scannedCount: 1001, limit: 1000, hasMore: true,
  });
  assert.deepEqual(computeFatAnomalyScope({ eventsCount: 1000, guardsCount: 999, limit: 1000 }), {
    scannedCount: 1000, limit: 1000, hasMore: false,
  });
});
