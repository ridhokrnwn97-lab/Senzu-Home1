import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  UnifiedCase,
  CaseEvent,
  CaseType,
  CaseSeverity,
  CasePriority,
  CaseStatus,
  CaseAssignedRole,
  CaseSource,
  CaseResolution,
  CaseRecovery,
  CaseAttachment,
  RefundRequestStatus,
  RecoveryStatus,
} from '../types/case';
import { Booking } from '../types';
import { cleanFirestoreData, formatDateTimeWIB, formatDateIndo } from './utils';
import { addOperationalAuditLog, addBookingStatusHistory } from './dbService';
import { addCustomerInteraction, createCrmTask } from './crmService';
import { emitEvent } from './notificationService';
import { issueVoucherToCustomer, createVoucher, adminManualPointAdjustment, getAllVouchers } from './loyaltyService';

const CASES_COLLECTION = 'cases';
const CASE_EVENTS_COLLECTION = 'case_events';

/**
 * Generate human-readable case code (e.g. SC-260910-001)
 */
export async function generateCaseCode(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `SC-${yy}${mm}${dd}`;

  try {
    const q = query(
      collection(db, CASES_COLLECTION),
      where('caseCode', '>=', prefix),
      where('caseCode', '<=', `${prefix}-\uf8ff`),
      orderBy('caseCode', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const lastCode = snap.docs[0].data().caseCode as string;
      const parts = lastCode.split('-');
      const seq = parseInt(parts[2], 10) || 0;
      const nextSeq = String(seq + 1).padStart(3, '0');
      return `${prefix}-${nextSeq}`;
    }
  } catch (err) {
    // Fallback using random sequence if index not ready
    console.warn('Fallback generating case code:', err);
  }

  const randomSeq = String(Math.floor(Math.random() * 900) + 100);
  return `${prefix}-${randomSeq}`;
}

/**
 * Check for existing active duplicate cases for the same booking and category
 */
export async function checkDuplicateActiveCase(
  bookingId: string,
  category: string
): Promise<UnifiedCase | null> {
  try {
    const activeStatuses: CaseStatus[] = [
      'OPEN',
      'IN_PROGRESS',
      'WAITING_CUSTOMER',
      'WAITING_SUPERVISOR',
      'WAITING_MANAGER',
      'WAITING_PAYMENT_REVIEW',
      'REOPENED',
    ];

    const q = query(
      collection(db, CASES_COLLECTION),
      where('bookingId', '==', bookingId),
      where('status', 'in', activeStatuses)
    );
    const snap = await getDocs(q);
    for (const docSnap of snap.docs) {
      const c = docSnap.data() as UnifiedCase;
      if ((c.category || '').toLowerCase().trim() === (category || '').toLowerCase().trim()) {
        return c;
      }
    }
    return null;
  } catch (err) {
    console.warn('Error checking duplicate active case:', err);
    return null;
  }
}

export interface CreateCaseParams {
  caseType: CaseType;
  source: CaseSource;
  booking: {
    id: string;
    bookingCode: string;
    customerId?: string;
    customerName: string;
    customerWhatsApp?: string;
    therapistId?: string;
    therapistName?: string;
    branchId?: string;
  };
  category: string;
  subCategory?: string;
  severity: CaseSeverity;
  priority?: CasePriority;
  summary: string;
  description: string;
  internalNotes?: string;
  customerVisibleNote?: string;
  reviewId?: string;
  rating?: number;
  reportedBy: string;
  reportedByName: string;
  assignedRole?: CaseAssignedRole;
  assignedStaffId?: string;
  assignedStaffName?: string;
  followUpAt?: string;
  nextAction?: string;
  slaTargetMinutes?: number;
  attachments?: CaseAttachment[];
}

/**
 * Creates a new unified Case / Incident / Complaint
 */
export async function createCase(params: CreateCaseParams): Promise<UnifiedCase> {
  const now = new Date();
  const isoNow = now.toISOString();

  // Automatic Routing default
  let defaultAssignedRole: CaseAssignedRole = 'CSS';
  if (
    params.caseType === 'OPERATIONAL_ISSUE' ||
    params.caseType === 'THERAPIST_ISSUE' ||
    params.caseType === 'INCIDENT' ||
    params.category.includes('Terlambat') ||
    params.category.includes('Alamat') ||
    params.category.includes('unavailable') ||
    params.category.includes('safety') ||
    params.severity === 'CRITICAL'
  ) {
    defaultAssignedRole = 'Supervisor';
  } else if (params.category.includes('Payment') || params.caseType === 'PAYMENT_ISSUE') {
    defaultAssignedRole = 'CSS';
  }

  const assignedRole = params.assignedRole || defaultAssignedRole;
  const priority = params.priority || (params.severity === 'CRITICAL' ? 'CRITICAL' : params.severity === 'HIGH' ? 'HIGH' : 'NORMAL');
  const caseCode = await generateCaseCode();
  const caseId = `case_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Set default initial SLA target if not provided
  let slaTarget = params.slaTargetMinutes;
  if (!slaTarget) {
    if (params.severity === 'CRITICAL') slaTarget = 15;
    else if (params.severity === 'HIGH') slaTarget = 30;
    else if (params.severity === 'MEDIUM') slaTarget = 60;
    else slaTarget = 120;
  }

  const newCase: UnifiedCase = {
    id: caseId,
    caseCode,
    caseType: params.caseType,
    bookingId: params.booking.id,
    bookingCode: params.booking.bookingCode,
    customerId: params.booking.customerId || `cust_${(params.booking.customerWhatsApp || '').replace(/[^0-9]/g, '')}`,
    customerName: params.booking.customerName,
    customerPhone: params.booking.customerWhatsApp || '',
    therapistId: params.booking.therapistId,
    therapistName: params.booking.therapistName,
    branchId: params.booking.branchId || 'branch_palembang_pusat',
    source: params.source,
    category: params.category,
    subCategory: params.subCategory,
    severity: params.severity,
    priority,
    status: 'OPEN',
    assignedRole,
    assignedStaffId: params.assignedStaffId,
    assignedStaffName: params.assignedStaffName,
    reportedBy: params.reportedBy,
    reportedByName: params.reportedByName,
    reportedAt: isoNow,
    summary: params.summary.trim(),
    description: params.description.trim(),
    internalNotes: params.internalNotes?.trim() || undefined,
    customerVisibleNote: params.customerVisibleNote?.trim() || undefined,
    reviewId: params.reviewId,
    rating: params.rating,
    followUpAt: params.followUpAt,
    nextAction: params.nextAction || 'Pemeriksaan awal kendala',
    slaTargetMinutes: slaTarget,
    slaStatus: 'WITHIN_SLA',
    attachments: params.attachments || [],
    createdAt: isoNow,
    updatedAt: isoNow,
  };

  // 1. Save case to Firestore
  const docRef = doc(db, CASES_COLLECTION, caseId);
  await setDoc(docRef, cleanFirestoreData(newCase));

  // 2. Append initial case.created event
  await addCaseTimelineEvent({
    caseId,
    caseCode,
    eventType: 'case.created',
    actorId: params.reportedBy,
    actorName: params.reportedByName,
    actorRole: params.source === 'Customer App' ? 'Customer' : assignedRole,
    summary: `Kasus dibuat: [${params.severity}] ${params.category} - ${params.summary}`,
    details: params.description,
  });

  // 3. Operational Audit Log
  await addOperationalAuditLog({
    bookingId: params.booking.id,
    bookingCode: params.booking.bookingCode,
    customerId: newCase.customerId,
    therapistId: params.booking.therapistId,
    therapistName: params.booking.therapistName,
    action: 'case_created',
    actorRole: (params.source === 'Customer App' ? 'customer' : (assignedRole || 'supervisor').toLowerCase()) as any,
    actorName: params.reportedByName,
    note: `[KASUS BARU: ${caseCode}] [${params.severity}] ${params.category}: ${params.summary}`,
  });

  // 4. In-App and Push Notification emission
  try {
    const isCriticalOrHigh = params.severity === 'CRITICAL' || params.severity === 'HIGH';
    await emitEvent(
      isCriticalOrHigh ? 'case.high_severity' : 'case.created',
      {
        caseId,
        caseCode,
        bookingId: params.booking.id,
        bookingCode: params.booking.bookingCode,
        customerId: newCase.customerId,
        customerName: newCase.customerName,
        therapistId: newCase.therapistId,
        severity: params.severity,
        category: params.category,
        summary: params.summary,
        assignedRole,
      },
      { id: params.reportedBy, role: params.source === 'Customer App' ? 'customer' : ((assignedRole || 'supervisor').toLowerCase() as any) }
    );
  } catch (notifErr) {
    console.warn('Failed to emit case creation notification:', notifErr);
  }

  // 5. If reported by therapist, update booking.issueReport for backward compatibility
  if (params.source === 'Therapist' && params.booking.id) {
    try {
      const bRef = doc(db, 'bookings', params.booking.id);
      await updateDoc(bRef, {
        issueReport: {
          category: params.category,
          note: params.description,
          reportedAt: isoNow,
          reportedBy: params.reportedByName,
          caseId,
          caseCode,
        },
        updatedAt: isoNow,
      });
    } catch (bErr) {
      console.warn('Could not update legacy issueReport on booking:', bErr);
    }
  }

  return newCase;
}

/**
 * Appends an immutable timeline event to case_events
 */
export async function addCaseTimelineEvent(params: {
  caseId: string;
  caseCode: string;
  eventType: CaseEvent['eventType'];
  actorId: string;
  actorName: string;
  actorRole: string;
  summary: string;
  details?: string;
  oldValue?: string;
  newValue?: string;
}): Promise<CaseEvent> {
  const eventId = `cevt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  const eventRecord: CaseEvent = {
    id: eventId,
    caseId: params.caseId,
    caseCode: params.caseCode,
    eventType: params.eventType,
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: params.summary,
    details: params.details,
    oldValue: params.oldValue,
    newValue: params.newValue,
    timestamp: now,
  };

  await setDoc(doc(db, CASE_EVENTS_COLLECTION, eventId), cleanFirestoreData(eventRecord));
  return eventRecord;
}

/**
 * Fetch all timeline events for a given case, ordered chronologically
 */
export async function getCaseTimelineEvents(caseId: string): Promise<CaseEvent[]> {
  try {
    const q = query(
      collection(db, CASE_EVENTS_COLLECTION),
      where('caseId', '==', caseId),
      orderBy('timestamp', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as CaseEvent);
  } catch (err) {
    console.warn('Index not ready for case events, falling back to manual sort:', err);
    const qFallback = query(collection(db, CASE_EVENTS_COLLECTION), where('caseId', '==', caseId));
    const snap = await getDocs(qFallback);
    const list = snap.docs.map((d) => d.data() as CaseEvent);
    return list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
}

/**
 * Reassigns case ownership
 */
export async function assignCase(params: {
  caseItem: UnifiedCase;
  newRole: CaseAssignedRole;
  newStaffId?: string;
  newStaffName?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  reason: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  const updates: Partial<UnifiedCase> = {
    assignedRole: params.newRole,
    assignedStaffId: params.newStaffId || undefined,
    assignedStaffName: params.newStaffName || undefined,
    updatedAt: now,
  };

  await updateDoc(caseRef, cleanFirestoreData(updates));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'case.assigned',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Kasus dialihkan ke ${params.newRole}${params.newStaffName ? ` (${params.newStaffName})` : ''}`,
    details: params.reason,
    oldValue: params.caseItem.assignedRole,
    newValue: params.newRole,
  });

  await addOperationalAuditLog({
    bookingId: params.caseItem.bookingId,
    bookingCode: params.caseItem.bookingCode,
    customerId: params.caseItem.customerId,
    therapistId: params.caseItem.therapistId,
    therapistName: params.caseItem.therapistName,
    action: 'case_assigned',
    actorRole: (params.actorRole || 'staff').toLowerCase() as any,
    actorName: params.actorName,
    note: `Kasus ${params.caseItem.caseCode} dialihkan dari ${params.caseItem.assignedRole} ke ${params.newRole}. Alasan: ${params.reason}`,
  });
}

/**
 * Log customer contact attempt (Phone, WhatsApp, In-App)
 */
export async function logCaseCustomerContact(params: {
  caseItem: UnifiedCase;
  channel: 'whatsapp' | 'phone' | 'in_app' | 'email';
  direction: 'inbound' | 'outbound';
  summary: string;
  outcome: 'pending' | 'informed' | 'accepted' | 'declined';
  actorId: string;
  actorName: string;
  actorRole: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  // Update case status if waiting customer
  let nextStatus = params.caseItem.status;
  if (params.direction === 'outbound' && params.outcome === 'pending') {
    nextStatus = 'WAITING_CUSTOMER';
  } else if (params.direction === 'inbound') {
    nextStatus = 'IN_PROGRESS';
  }

  await updateDoc(caseRef, cleanFirestoreData({
    status: nextStatus,
    customerContactOutcome: params.outcome,
    updatedAt: now,
  }));

  // Timeline event
  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: params.direction === 'inbound' ? 'customer.responded' : 'contact.attempt',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Kontak Pelanggan (${params.channel.toUpperCase()} - ${params.direction.toUpperCase()}): ${params.summary}`,
    details: `Hasil: ${params.outcome}`,
  });

  // Also log into CRM Customer Interactions so CRM Customer 360 sees it
  try {
    await addCustomerInteraction({
      customerId: params.caseItem.customerId,
      bookingId: params.caseItem.bookingId,
      channel: params.channel,
      direction: params.direction,
      summary: `[KASUS ${params.caseItem.caseCode}] ${params.summary} (Hasil: ${params.outcome})`,
      staffId: params.actorId,
      staffName: params.actorName,
    });
  } catch (crmErr) {
    console.warn('Could not log interaction to CRM:', crmErr);
  }
}

/**
 * Add internal notes to case (Internal only, never visible to customer)
 */
export async function addCaseInternalNote(params: {
  caseItem: UnifiedCase;
  note: string;
  actorId: string;
  actorName: string;
  actorRole: string;
}): Promise<void> {
  const now = new Date();
  const isoNow = now.toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  const entry = `[${formatDateTimeWIB(now)} - ${params.actorRole.toUpperCase()}: ${params.actorName}] ${params.note.trim()}`;
  const updatedNotes = params.caseItem.internalNotes ? `${params.caseItem.internalNotes}\n${entry}` : entry;

  await updateDoc(caseRef, cleanFirestoreData({
    internalNotes: updatedNotes,
    updatedAt: isoNow,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'note.added',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Catatan internal ditambahkan oleh ${params.actorName}`,
    details: params.note.trim(),
  });
}

/**
 * Propose a Service Recovery (CSS or Supervisor proposes, requires Manager approval for vouchers/refunds/high value)
 */
export async function proposeServiceRecovery(params: {
  caseItem: UnifiedCase;
  recoveryType: string;
  description: string;
  expectedOutcome?: string;
  refundAmount?: number;
  actorId: string;
  actorName: string;
  actorRole: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  const recovery: CaseRecovery = {
    type: params.recoveryType,
    description: params.description.trim(),
    expectedOutcome: params.expectedOutcome?.trim(),
    proposedBy: params.actorId,
    proposedByName: params.actorName,
    proposedAt: now,
    status: 'PROPOSED',
    refundAmount: params.refundAmount || undefined,
    refundStatus: params.recoveryType.includes('Refund') ? 'REVIEW_REQUIRED' : 'NOT_REQUIRED',
  };

  await updateDoc(caseRef, cleanFirestoreData({
    recovery,
    status: 'WAITING_MANAGER',
    updatedAt: now,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'recovery.proposed',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Pengajuan Pemulihan Layanan (${params.recoveryType}) diajukan oleh ${params.actorName}`,
    details: `${params.description} ${params.refundAmount ? `(Nominal: Rp ${params.refundAmount.toLocaleString('id-ID')})` : ''}`,
  });

  await addOperationalAuditLog({
    bookingId: params.caseItem.bookingId,
    bookingCode: params.caseItem.bookingCode,
    customerId: params.caseItem.customerId,
    therapistId: params.caseItem.therapistId,
    therapistName: params.caseItem.therapistName,
    action: 'recovery_proposed',
    actorRole: (params.actorRole || 'staff').toLowerCase() as any,
    actorName: params.actorName,
    note: `Pengajuan Recovery [${params.caseItem.caseCode}]: ${params.recoveryType} - ${params.description}`,
  });
}

/**
 * Approve or Reject Service Recovery (Manager only)
 */
export async function approveServiceRecovery(params: {
  caseItem: UnifiedCase;
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
  voucherPresetId?: string; // If issuing an existing voucher template
  loyaltyPointsDelta?: number;
  approvedRefundAmount?: number;
  actorId: string;
  actorName: string;
  actorRole: 'Manager' | 'Admin';
}): Promise<void> {
  if (!params.caseItem.recovery) {
    throw new Error('Tidak ada pengajuan recovery pada kasus ini.');
  }

  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);
  const prevRec = params.caseItem.recovery;

  if (params.decision === 'REJECT') {
    const updatedRec: CaseRecovery = {
      ...prevRec,
      status: 'REJECTED',
      rejectedBy: params.actorId,
      rejectedByName: params.actorName,
      rejectedAt: now,
      rejectionReason: params.reason || 'Ditolak oleh Manager',
    };

    await updateDoc(caseRef, cleanFirestoreData({
      recovery: updatedRec,
      status: 'IN_PROGRESS',
      updatedAt: now,
    }));

    await addCaseTimelineEvent({
      caseId: params.caseItem.id,
      caseCode: params.caseItem.caseCode,
      eventType: 'recovery.rejected',
      actorId: params.actorId,
      actorName: params.actorName,
      actorRole: params.actorRole,
      summary: `Pengajuan Pemulihan Layanan Ditolak oleh Manager ${params.actorName}`,
      details: params.reason,
    });

    return;
  }

  // APPROVAL PATH
  let issuedVoucherCode: string | undefined;
  let issuedVoucherId: string | undefined;

  // 1. If recovery involves a voucher, execute using existing loyalty/voucher engine
  if ((prevRec.type || '').toLowerCase().includes('voucher')) {
    try {
      const allVouchers = await getAllVouchers();
      let targetVoucher = allVouchers.find((v) => v.id === params.voucherPresetId);
      if (!targetVoucher) {
        // Find recovery voucher template or create one
        targetVoucher = allVouchers.find((v) => (v.name || '').toLowerCase().includes('recovery')) || allVouchers[0];
      }

      if (targetVoucher) {
        const cv = await issueVoucherToCustomer({
          customerId: params.caseItem.customerId,
          voucher: targetVoucher,
          source: 'admin_goodwill',
          issuedBy: params.actorName,
          issuedReason: `Service Recovery untuk Kasus ${params.caseItem.caseCode}`,
        });
        issuedVoucherId = cv.id;
        issuedVoucherCode = cv.voucherCode;
      }
    } catch (vErr) {
      console.warn('Voucher issuance warning:', vErr);
    }
  }

  // 2. If recovery involves Loyalty Credit points, execute via existing loyalty ledger
  if (params.loyaltyPointsDelta && params.loyaltyPointsDelta > 0) {
    try {
      await adminManualPointAdjustment({
        customerId: params.caseItem.customerId,
        pointsDelta: params.loyaltyPointsDelta,
        reason: `Service Recovery [${params.caseItem.caseCode}]: ${prevRec.description}`,
        adminName: params.actorName,
      });
    } catch (pErr) {
      console.warn('Loyalty point adjustment warning:', pErr);
    }
  }

  // 3. If recovery involves Refund, transition refund status to APPROVED
  let refundStatus: RefundRequestStatus = prevRec.refundStatus;
  let finalRefundAmount = prevRec.refundAmount;
  if ((prevRec.type || '').toLowerCase().includes('refund')) {
    refundStatus = 'APPROVED';
    if (params.approvedRefundAmount !== undefined) {
      finalRefundAmount = params.approvedRefundAmount;
    }
  }

  const updatedRec: CaseRecovery = {
    ...prevRec,
    status: 'APPROVED',
    approvedBy: params.actorId,
    approvedByName: params.actorName,
    approvedAt: now,
    voucherId: issuedVoucherId,
    voucherCode: issuedVoucherCode,
    loyaltyPointsDelta: params.loyaltyPointsDelta,
    refundAmount: finalRefundAmount,
    refundStatus,
  };

  await updateDoc(caseRef, cleanFirestoreData({
    recovery: updatedRec,
    status: 'IN_PROGRESS',
    updatedAt: now,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'recovery.approved',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Pemulihan Layanan Disetujui oleh Manager ${params.actorName}`,
    details: `${prevRec.type} ${issuedVoucherCode ? `(Voucher: ${issuedVoucherCode})` : ''} ${finalRefundAmount ? `(Refund: Rp ${finalRefundAmount.toLocaleString('id-ID')})` : ''}`,
  });

  await addOperationalAuditLog({
    bookingId: params.caseItem.bookingId,
    bookingCode: params.caseItem.bookingCode,
    customerId: params.caseItem.customerId,
    therapistId: params.caseItem.therapistId,
    therapistName: params.caseItem.therapistName,
    action: 'recovery_approved',
    actorRole: 'manager',
    actorName: params.actorName,
    note: `Manager ${params.actorName} menyetujui recovery untuk kasus ${params.caseItem.caseCode}: ${prevRec.type}`,
  });
}

/**
 * Deliver / Mark Recovery complete (CSS or Supervisor communicates and delivers to customer)
 */
export async function deliverServiceRecovery(params: {
  caseItem: UnifiedCase;
  customerOutcome: 'informed' | 'accepted' | 'declined';
  customerOutcomeNote?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
}): Promise<void> {
  if (!params.caseItem.recovery) {
    throw new Error('Tidak ada data recovery untuk kasus ini.');
  }

  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  const updatedRecovery: CaseRecovery = {
    ...params.caseItem.recovery,
    status: 'DELIVERED',
    deliveredAt: now,
    deliveredBy: params.actorId,
    deliveredByName: params.actorName,
    customerOutcome: params.customerOutcome,
    customerOutcomeNote: params.customerOutcomeNote,
  };

  await updateDoc(caseRef, cleanFirestoreData({
    recovery: updatedRecovery,
    updatedAt: now,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'recovery.delivered',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Pemulihan Layanan Disampaikan ke Pelanggan (${params.customerOutcome.toUpperCase()})`,
    details: params.customerOutcomeNote || `Pelanggan telah menerima informasi kompensasi / pemulihan.`,
  });
}

const ALLOWED_MANUAL_REFUND_STATUSES = new Set<RefundRequestStatus>([
  'APPROVED',
  'PROCESSING_MANUAL',
  'COMPLETED_MANUAL',
  'REJECTED',
]);

function isValidManualRefundDocId(value: unknown, maxLen = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLen &&
    value.trim() === value &&
    !value.includes('/') &&
    !/[\x00-\x1F\x7F\s]/.test(value)
  );
}

function generateManualRefundRequestId(): string {
  const ts = Date.now().toString(36);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `mref_${ts}_${hex}`;
  }
  return `mref_${ts}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Update Manual Refund Status (Manual Bank / QRIS Transfer without Gateway)
 */
export async function updateManualRefundStatus(params: {
  caseItem: UnifiedCase;
  newStatus: RefundRequestStatus;
  refundAmount?: number;
  refundMethod?: string; // 'Transfer BNI' | 'Transfer BRI' | 'Transfer Mandiri' | 'QRIS'
  refundDate?: string;
  refundReference?: string;
  refundProofUrl?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  note?: string;
}): Promise<void> {
  const caseId = typeof params?.caseItem?.id === 'string' ? params.caseItem.id.trim() : '';
  if (!isValidManualRefundDocId(caseId, 128)) {
    throw new Error('ID kasus tidak valid.');
  }

  if (
    typeof params?.newStatus !== 'string' ||
    !ALLOWED_MANUAL_REFUND_STATUSES.has(params.newStatus)
  ) {
    throw new Error('Status refund manual tidak valid.');
  }

  if (params.refundAmount !== undefined && params.refundAmount !== null) {
    if (
      typeof params.refundAmount !== 'number' ||
      !Number.isFinite(params.refundAmount) ||
      params.refundAmount <= 0 ||
      params.refundAmount > 100_000_000
    ) {
      throw new Error('Nominal refund manual tidak valid.');
    }
  }

  let cleanMethod: string | undefined;
  if (params.refundMethod !== undefined && params.refundMethod !== null) {
    if (typeof params.refundMethod !== 'string') {
      throw new Error('Metode refund manual tidak valid.');
    }
    const trimmed = params.refundMethod.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (!trimmed || trimmed.length > 100) {
      throw new Error('Metode refund manual tidak valid.');
    }
    cleanMethod = trimmed;
  }

  let cleanDate: string | undefined;
  if (params.refundDate !== undefined && params.refundDate !== null) {
    if (typeof params.refundDate !== 'string') {
      throw new Error('Tanggal refund manual tidak valid.');
    }
    const trimmed = params.refundDate.trim();
    if (!trimmed || trimmed.length > 40 || Number.isNaN(Date.parse(trimmed))) {
      throw new Error('Tanggal refund manual tidak valid.');
    }
    cleanDate = trimmed;
  }

  let cleanReference: string | undefined;
  if (params.refundReference !== undefined && params.refundReference !== null) {
    if (typeof params.refundReference !== 'string') {
      throw new Error('Referensi refund manual tidak valid.');
    }
    const trimmed = params.refundReference.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (trimmed.length > 150) {
      throw new Error('Referensi refund manual melebihi batas.');
    }
    if (trimmed) cleanReference = trimmed;
  }

  let cleanProofUrl: string | undefined;
  if (params.refundProofUrl !== undefined && params.refundProofUrl !== null) {
    if (typeof params.refundProofUrl !== 'string') {
      throw new Error('URL bukti refund manual tidak valid.');
    }
    const trimmed = params.refundProofUrl.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (trimmed.length > 2000) {
      throw new Error('URL bukti refund manual melebihi batas.');
    }
    if (trimmed) cleanProofUrl = trimmed;
  }

  let cleanNote: string | undefined;
  if (params.note !== undefined && params.note !== null) {
    if (typeof params.note !== 'string') {
      throw new Error('Catatan refund manual tidak valid.');
    }
    const trimmed = params.note.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    if (trimmed.length > 1000) {
      throw new Error('Catatan refund manual melebihi batas.');
    }
    if (trimmed) cleanNote = trimmed;
  }

  const initialSession = auth?.currentUser;
  const initialUid =
    initialSession && typeof initialSession.uid === 'string' ? initialSession.uid.trim() : '';
  if (
    !initialSession ||
    !initialUid ||
    initialSession.uid !== initialUid ||
    !isValidManualRefundDocId(initialUid, 128) ||
    typeof initialSession.getIdToken !== 'function'
  ) {
    throw new Error('Autentikasi Manager diperlukan untuk memperbarui status refund manual.');
  }

  let cleanBookingId: string | undefined;
  if (
    params.caseItem?.bookingId !== undefined &&
    params.caseItem?.bookingId !== null &&
    params.caseItem?.bookingId !== ''
  ) {
    const trimmedBkId =
      typeof params.caseItem.bookingId === 'string' ? params.caseItem.bookingId.trim() : '';
    if (!isValidManualRefundDocId(trimmedBkId, 128)) {
      throw new Error('ID reservasi pada kasus tidak valid.');
    }
    cleanBookingId = trimmedBkId;
  }

  let cleanBookingCode: string | undefined;
  if (
    params.caseItem?.bookingCode !== undefined &&
    params.caseItem?.bookingCode !== null &&
    params.caseItem?.bookingCode !== ''
  ) {
    if (typeof params.caseItem.bookingCode !== 'string') {
      throw new Error('Kode reservasi pada kasus tidak valid.');
    }
    const trimmedBkCode = params.caseItem.bookingCode.trim().toUpperCase();
    if (
      !isValidManualRefundDocId(trimmedBkCode, 64) ||
      trimmedBkCode.length < 3 ||
      /^bk_/i.test(trimmedBkCode) ||
      !/^[A-Z0-9_-]+$/.test(trimmedBkCode)
    ) {
      throw new Error('Kode reservasi pada kasus tidak valid.');
    }
    cleanBookingCode = trimmedBkCode;
  }

  const requestId = generateManualRefundRequestId();
  const payload: Record<string, unknown> = {
    newStatus: params.newStatus,
    requestId,
    ...(cleanBookingId !== undefined ? { bookingId: cleanBookingId } : {}),
    ...(cleanBookingCode !== undefined ? { bookingCode: cleanBookingCode } : {}),
    ...(params.refundAmount !== undefined && params.refundAmount !== null
      ? { refundAmount: params.refundAmount }
      : {}),
    ...(cleanMethod !== undefined ? { refundMethod: cleanMethod } : {}),
    ...(cleanDate !== undefined ? { refundDate: cleanDate } : {}),
    ...(cleanReference !== undefined ? { refundReference: cleanReference } : {}),
    ...(cleanProofUrl !== undefined ? { refundProofUrl: cleanProofUrl } : {}),
    ...(cleanNote !== undefined ? { note: cleanNote } : {}),
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const currentSession = auth?.currentUser;
      if (
        !currentSession ||
        currentSession.uid !== initialUid ||
        typeof currentSession.getIdToken !== 'function'
      ) {
        throw new Error('Sesi pengguna telah berubah atau berakhir.');
      }

      const rawToken = await currentSession.getIdToken();
      const idToken = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (!idToken || !auth?.currentUser || auth.currentUser.uid !== initialUid) {
        throw new Error('Sesi pengguna telah berubah atau berakhir.');
      }

      const res = await fetch(
        `/api/cases/${encodeURIComponent(caseId)}/manual-refund-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        throw new Error('Sesi pengguna telah berubah atau berakhir.');
      }

      const data = await res.json().catch(() => null);

      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        throw new Error('Sesi pengguna telah berubah atau berakhir.');
      }

      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 40));
          continue;
        }
        const errMsg =
          (typeof data?.error === 'string' && data.error.trim()) ||
          (typeof data?.message === 'string' && data.message.trim()) ||
          'Gagal memperbarui status refund manual.';
        const nonRetryableErr = new Error(errMsg);
        (nonRetryableErr as any).nonRetryable = true;
        throw nonRetryableErr;
      }

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data.success !== true ||
        data.caseId !== caseId ||
        !data.recovery ||
        typeof data.recovery !== 'object' ||
        Array.isArray(data.recovery) ||
        data.recovery.refundStatus !== params.newStatus
      ) {
        const badPayloadErr = new Error('Respons pembaruan refund manual dari server tidak valid.');
        (badPayloadErr as any).nonRetryable = true;
        throw badPayloadErr;
      }

      return;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error('Gagal memperbarui status refund manual.');
      if (!auth?.currentUser || auth.currentUser.uid !== initialUid) {
        throw new Error('Sesi pengguna telah berubah atau berakhir.');
      }
      if (err?.nonRetryable) {
        throw lastError;
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('Gagal memperbarui status refund manual.');
}

/**
 * Resolves a case with complete resolution information
 */
export async function resolveCase(params: {
  caseItem: UnifiedCase;
  resolutionSummary: string;
  rootCauseCategory?: string;
  correctiveAction?: string;
  recoveryAction?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
}): Promise<void> {
  if (!params.resolutionSummary.trim()) {
    throw new Error('Ringkasan solusi (resolution summary) wajib diisi.');
  }

  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  const resolution: CaseResolution = {
    summary: params.resolutionSummary.trim(),
    rootCauseCategory: params.rootCauseCategory || undefined,
    correctiveAction: params.correctiveAction?.trim() || undefined,
    recoveryAction: params.recoveryAction?.trim() || undefined,
    resolvedBy: params.actorId,
    resolvedByName: params.actorName,
    resolvedAt: now,
  };

  await updateDoc(caseRef, cleanFirestoreData({
    status: 'RESOLVED',
    resolution,
    updatedAt: now,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'case.resolved',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Kasus diselesaikan oleh ${params.actorName}: ${params.resolutionSummary}`,
    details: `${params.rootCauseCategory ? `[Root Cause: ${params.rootCauseCategory}] ` : ''}${params.correctiveAction ? `Tindakan Korektif: ${params.correctiveAction}` : ''}`,
  });

  await addOperationalAuditLog({
    bookingId: params.caseItem.bookingId,
    bookingCode: params.caseItem.bookingCode,
    customerId: params.caseItem.customerId,
    therapistId: params.caseItem.therapistId,
    therapistName: params.caseItem.therapistName,
    action: 'case_resolved',
    actorRole: (params.actorRole || 'staff').toLowerCase() as any,
    actorName: params.actorName,
    note: `Kasus ${params.caseItem.caseCode} terselesaikan: ${params.resolutionSummary}`,
  });
}

/**
 * Closes a case (Operational work completed, checklist verified)
 */
export async function closeCase(params: {
  caseItem: UnifiedCase;
  closureReason?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  forceManagerOverride?: boolean;
}): Promise<void> {
  // Checklist verification unless Manager override
  if (!params.forceManagerOverride && params.caseItem.status !== 'RESOLVED') {
    throw new Error('Kasus harus diselesaikan (RESOLVED) terlebih dahulu sebelum dapat ditutup.');
  }

  if (
    params.caseItem.recovery &&
    params.caseItem.recovery.status === 'APPROVED' &&
    !params.caseItem.recovery.deliveredAt &&
    !params.forceManagerOverride
  ) {
    throw new Error('Pemulihan layanan yang telah disetujui harus disampaikan ke pelanggan (DELIVERED) sebelum kasus ditutup.');
  }

  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  await updateDoc(caseRef, cleanFirestoreData({
    status: 'CLOSED',
    closedAt: now,
    closedBy: params.actorId,
    closedByName: params.actorName,
    closureReason: params.closureReason?.trim() || 'Pekerjaan operasional dan tindak lanjut selesai.',
    updatedAt: now,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'case.closed',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Kasus ditutup secara resmi oleh ${params.actorName}`,
    details: params.closureReason || 'Kasus ditutup.',
  });

  await addOperationalAuditLog({
    bookingId: params.caseItem.bookingId,
    bookingCode: params.caseItem.bookingCode,
    customerId: params.caseItem.customerId,
    therapistId: params.caseItem.therapistId,
    therapistName: params.caseItem.therapistName,
    action: 'case_closed',
    actorRole: (params.actorRole || 'staff').toLowerCase() as any,
    actorName: params.actorName,
    note: `Kasus ${params.caseItem.caseCode} ditutup oleh ${params.actorName}. Alasan: ${params.closureReason || '-'}`,
  });
}

/**
 * Reopens a resolved or closed case
 */
export async function reopenCase(params: {
  caseItem: UnifiedCase;
  reopenReason: string;
  actorId: string;
  actorName: string;
  actorRole: string;
}): Promise<void> {
  if (!params.reopenReason.trim()) {
    throw new Error('Alasan pembukaan kembali kasus wajib diisi.');
  }

  const now = new Date().toISOString();
  const caseRef = doc(db, CASES_COLLECTION, params.caseItem.id);

  await updateDoc(caseRef, cleanFirestoreData({
    status: 'REOPENED',
    reopenedAt: now,
    reopenedBy: params.actorId,
    reopenedByName: params.actorName,
    reopenReason: params.reopenReason.trim(),
    updatedAt: now,
  }));

  await addCaseTimelineEvent({
    caseId: params.caseItem.id,
    caseCode: params.caseItem.caseCode,
    eventType: 'case.reopened',
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    summary: `Kasus dibuka kembali oleh ${params.actorName}`,
    details: params.reopenReason.trim(),
    oldValue: params.caseItem.status,
    newValue: 'REOPENED',
  });

  await addOperationalAuditLog({
    bookingId: params.caseItem.bookingId,
    bookingCode: params.caseItem.bookingCode,
    customerId: params.caseItem.customerId,
    therapistId: params.caseItem.therapistId,
    therapistName: params.caseItem.therapistName,
    action: 'case_reopened',
    actorRole: (params.actorRole || 'staff').toLowerCase() as any,
    actorName: params.actorName,
    note: `Kasus ${params.caseItem.caseCode} dibuka kembali oleh ${params.actorName}. Alasan: ${params.reopenReason.trim()}`,
  });
}

/**
 * Realtime subscriber for all cases
 */
export function subscribeToCases(callback: (cases: UnifiedCase[]) => void): () => void {
  try {
    let disposed = false;
    const q = query(collection(db, CASES_COLLECTION), orderBy('createdAt', 'desc'));
    let innerUnsub: (() => void) | null = null;
    const outerUnsub = onSnapshot(
      q,
      (snapshot) => {
        if (disposed) return;
        const list = snapshot.docs.map((d) => d.data() as UnifiedCase);
        callback(list);
      },
      (err: any) => {
        if (disposed) return;
        const errorCode = err?.code || '';
        const errorMessage = typeof err?.message === 'string' ? err.message : '';

        if (errorCode === 'permission-denied' || errorCode === 'unauthenticated') {
          console.warn('[Security Notice] Cases subscription access rejected: permission-denied. Fallback aborted.');
          callback([]);
          return;
        }

        const isIndexError = errorCode === 'failed-precondition' || errorMessage.includes('index');
        if (isIndexError) {
          console.info('Notice subscribing to sorted cases, falling back to simple collection listener: missing index.');
          try {
            const qSimple = collection(db, CASES_COLLECTION);
            if (disposed) return;
            innerUnsub = onSnapshot(
              qSimple,
              (snapSimple) => {
                if (disposed) return;
                const list = snapSimple.docs.map((d) => d.data() as UnifiedCase);
                list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                callback(list);
              },
              (fallbackErr) => {
                console.warn('Fallback case subscription notice:', fallbackErr?.message);
                if (!disposed) callback([]);
              }
            );
          } catch {
            if (!disposed) callback([]);
          }
        } else {
          console.warn('subscribeToCases error:', errorMessage);
          if (!disposed) callback([]);
        }
      }
    );

    return () => {
      disposed = true;
      outerUnsub();
      if (innerUnsub) {
        innerUnsub();
        innerUnsub = null;
      }
    };
  } catch (e: any) {
    console.warn('Error initiating case subscription:', e?.message);
    callback([]);
    return () => {};
  }
}

/**
 * Fetch a single case by ID
 */
export async function getCaseById(caseId: string): Promise<UnifiedCase | null> {
  const ref = doc(db, CASES_COLLECTION, caseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as UnifiedCase;
}

/**
 * Fetch case by booking ID
 */
export async function getCasesByBookingId(bookingId: string): Promise<UnifiedCase[]> {
  try {
    const q = query(collection(db, CASES_COLLECTION), where('bookingId', '==', bookingId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as UnifiedCase);
  } catch (err) {
    console.warn('Failed to query cases by bookingId:', err);
    return [];
  }
}

/**
 * Fetch cases for a specific customer (for customer portal)
 */
export async function getCasesForCustomer(customerId: string): Promise<UnifiedCase[]> {
  try {
    const q = query(collection(db, CASES_COLLECTION), where('customerId', '==', customerId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as UnifiedCase);
  } catch (err) {
    console.warn('Failed to query cases for customer:', err);
    return [];
  }
}

/**
 * Fetch cases for a specific therapist (therapist portal view)
 */
export async function getCasesForTherapist(therapistId: string): Promise<UnifiedCase[]> {
  try {
    const q = query(collection(db, CASES_COLLECTION), where('therapistId', '==', therapistId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as UnifiedCase);
  } catch (err) {
    console.warn('Failed to query cases for therapist:', err);
    return [];
  }
}
