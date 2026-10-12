export type CaseType =
  | 'COMPLAINT'
  | 'INCIDENT'
  | 'SERVICE_RECOVERY'
  | 'PAYMENT_ISSUE'
  | 'OPERATIONAL_ISSUE'
  | 'THERAPIST_ISSUE'
  | 'CUSTOMER_REQUEST'
  | 'LOW_RATING';

export type CaseSource =
  | 'Customer App'
  | 'CSS'
  | 'Supervisor'
  | 'Therapist'
  | 'Rating / Review'
  | 'Payment Verification'
  | 'System Alert'
  | 'Manager';

export type CaseSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CasePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type CaseStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'WAITING_SUPERVISOR'
  | 'WAITING_MANAGER'
  | 'WAITING_PAYMENT_REVIEW'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED';

export type CaseAssignedRole = 'CSS' | 'Supervisor' | 'Manager';

export type ComplaintCategory =
  | 'Therapist terlambat'
  | 'Therapist tidak datang'
  | 'Therapist attitude / service concern'
  | 'Treatment concern'
  | 'Customer request not followed'
  | 'Schedule issue'
  | 'Address issue'
  | 'Payment issue'
  | 'Cancellation issue'
  | 'Refund request'
  | 'App / technical issue'
  | 'Customer communication issue'
  | 'Other';

export type IncidentCategory =
  | 'Therapist unavailable'
  | 'Wrong assignment'
  | 'Late arrival'
  | 'GPS / tracking issue'
  | 'Customer unreachable'
  | 'Address not found'
  | 'Schedule conflict'
  | 'Booking mismatch'
  | 'Service cannot continue'
  | 'Operational safety concern'
  | 'System failure'
  | 'Other';

export type RootCauseCategory =
  | 'People'
  | 'Process'
  | 'Scheduling'
  | 'Payment'
  | 'Customer Communication'
  | 'System'
  | 'Address / Location'
  | 'Capacity'
  | 'Other';

export type ServiceRecoveryType =
  | 'Apology / follow-up only'
  | 'Reschedule'
  | 'Repeat Service'
  | 'Voucher'
  | 'Loyalty Credit'
  | 'Refund Review'
  | 'Manual Refund'
  | 'Other Manager-approved recovery';

export type RecoveryStatus =
  | 'NOT_PROPOSED'
  | 'PROPOSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DELIVERED';

export type RefundRequestStatus =
  | 'NOT_REQUIRED'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PROCESSING_MANUAL'
  | 'COMPLETED_MANUAL';

export type SlaStatus = 'WITHIN_SLA' | 'APPROACHING_SLA' | 'BREACHED_SLA';

export interface CaseAttachment {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  isCustomerVisible?: boolean;
}

export interface CaseResolution {
  summary: string;
  rootCauseCategory?: RootCauseCategory | string;
  correctiveAction?: string;
  recoveryAction?: string;
  resolvedBy: string;
  resolvedByName: string;
  resolvedAt: string;
}

export interface CaseRecovery {
  type: ServiceRecoveryType | string;
  description: string;
  expectedOutcome?: string;
  proposedBy: string;
  proposedByName: string;
  proposedAt: string;
  status: RecoveryStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  
  // Specific recovery executions
  voucherId?: string;
  voucherCode?: string;
  loyaltyPointsDelta?: number;
  
  // Manual Refund handling
  refundAmount?: number;
  refundMethod?: string;
  refundStatus: RefundRequestStatus;
  refundDate?: string;
  refundReference?: string;
  refundProofUrl?: string;
  refundProcessedBy?: string;
  refundProcessedByName?: string;
  refundProcessedAt?: string;

  // Delivery / completion state
  deliveredAt?: string;
  deliveredBy?: string;
  deliveredByName?: string;
  customerOutcome?: 'pending' | 'informed' | 'accepted' | 'declined';
  customerOutcomeNote?: string;
}

export interface CaseEvent {
  id: string;
  caseId: string;
  caseCode: string;
  eventType:
    | 'case.created'
    | 'case.assigned'
    | 'contact.attempt'
    | 'customer.responded'
    | 'case.escalated'
    | 'supervisor.action'
    | 'manager.decision'
    | 'recovery.proposed'
    | 'recovery.approved'
    | 'recovery.rejected'
    | 'recovery.delivered'
    | 'refund.status_updated'
    | 'case.resolved'
    | 'case.closed'
    | 'case.reopened'
    | 'note.added';
  actorId: string;
  actorName: string;
  actorRole: string;
  summary: string;
  details?: string;
  oldValue?: string;
  newValue?: string;
  timestamp: string; // ISO
}

export interface UnifiedCase {
  id: string; // doc ID, e.g. case_1725960000000
  caseCode: string; // human-readable, e.g. SC-260910-001
  caseType: CaseType;
  
  bookingId: string;
  bookingCode: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  
  therapistId?: string;
  therapistName?: string;
  branchId: string;
  
  source: CaseSource;
  category: string;
  subCategory?: string;
  
  severity: CaseSeverity;
  priority: CasePriority;
  status: CaseStatus;
  
  assignedRole: CaseAssignedRole;
  assignedStaffId?: string;
  assignedStaffName?: string;
  
  reportedBy: string; // staff ID or customer ID
  reportedByName: string;
  reportedAt: string; // ISO
  
  summary: string;
  description: string;
  
  // Separation of visibility
  internalNotes?: string;
  customerVisibleNote?: string;
  
  // Linkages
  reviewId?: string;
  rating?: number;
  
  // Resolution & Recovery
  resolution?: CaseResolution;
  recovery?: CaseRecovery;
  
  // Operational follow-up & SLA
  followUpAt?: string; // ISO
  nextAction?: string;
  slaTargetMinutes?: number;
  slaStatus?: SlaStatus;
  
  // Closure & Reopening
  closedAt?: string;
  closedBy?: string;
  closedByName?: string;
  closureReason?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenedByName?: string;
  reopenReason?: string;
  
  attachments?: CaseAttachment[];
  
  createdAt: string;
  updatedAt: string;
}

export const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
  'Therapist terlambat',
  'Therapist tidak datang',
  'Therapist attitude / service concern',
  'Treatment concern',
  'Customer request not followed',
  'Schedule issue',
  'Address issue',
  'Payment issue',
  'Cancellation issue',
  'Refund request',
  'App / technical issue',
  'Customer communication issue',
  'Other',
];

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  'Therapist unavailable',
  'Wrong assignment',
  'Late arrival',
  'GPS / tracking issue',
  'Customer unreachable',
  'Address not found',
  'Schedule conflict',
  'Booking mismatch',
  'Service cannot continue',
  'Operational safety concern',
  'System failure',
  'Other',
];

export const ROOT_CAUSE_CATEGORIES: RootCauseCategory[] = [
  'People',
  'Process',
  'Scheduling',
  'Payment',
  'Customer Communication',
  'System',
  'Address / Location',
  'Capacity',
  'Other',
];

export const SERVICE_RECOVERY_TYPES: ServiceRecoveryType[] = [
  'Apology / follow-up only',
  'Reschedule',
  'Repeat Service',
  'Voucher',
  'Loyalty Credit',
  'Refund Review',
  'Manual Refund',
  'Other Manager-approved recovery',
];

// Indonesian Customer-friendly Status Mapper (never expose internal names on public UI)
export function getCustomerFriendlyCaseStatus(status: CaseStatus): {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  switch (status) {
    case 'OPEN':
      return {
        label: 'Laporan Diterima',
        bgClass: 'bg-blue-50',
        textClass: 'text-blue-700',
        borderClass: 'border-blue-200',
      };
    case 'IN_PROGRESS':
    case 'WAITING_SUPERVISOR':
    case 'WAITING_MANAGER':
    case 'WAITING_PAYMENT_REVIEW':
      return {
        label: 'Sedang Ditangani',
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-800',
        borderClass: 'border-amber-200',
      };
    case 'WAITING_CUSTOMER':
      return {
        label: 'Menunggu Informasi Anda',
        bgClass: 'bg-purple-50',
        textClass: 'text-purple-700',
        borderClass: 'border-purple-200',
      };
    case 'RESOLVED':
    case 'CLOSED':
      return {
        label: 'Selesai',
        bgClass: 'bg-emerald-50',
        textClass: 'text-emerald-800',
        borderClass: 'border-emerald-200',
      };
    case 'REOPENED':
      return {
        label: 'Laporan Dibuka Kembali',
        bgClass: 'bg-orange-50',
        textClass: 'text-orange-700',
        borderClass: 'border-orange-200',
      };
    default:
      return {
        label: 'Dalam Proses',
        bgClass: 'bg-slate-50',
        textClass: 'text-slate-700',
        borderClass: 'border-slate-200',
      };
  }
}

// Operational Staff Status Label & Styling
export function getStaffCaseStatusBadge(status: CaseStatus): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case 'OPEN':
      return { label: 'Open', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200' };
    case 'IN_PROGRESS':
      return { label: 'In Progress', badgeClass: 'bg-sky-100 text-sky-800 border-sky-200' };
    case 'WAITING_CUSTOMER':
      return { label: 'Menunggu Pelanggan', badgeClass: 'bg-purple-100 text-purple-800 border-purple-200' };
    case 'WAITING_SUPERVISOR':
      return { label: 'Menunggu Supervisor', badgeClass: 'bg-amber-100 text-amber-800 border-amber-200' };
    case 'WAITING_MANAGER':
      return { label: 'Menunggu Manager', badgeClass: 'bg-rose-100 text-rose-800 border-rose-200' };
    case 'WAITING_PAYMENT_REVIEW':
      return { label: 'Review Pembayaran', badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200' };
    case 'RESOLVED':
      return { label: 'Terselesaikan', badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
    case 'CLOSED':
      return { label: 'Ditutup (Closed)', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' };
    case 'REOPENED':
      return { label: 'Dibuka Kembali', badgeClass: 'bg-orange-100 text-orange-800 border-orange-200' };
  }
}

export function getCaseSeverityBadge(severity: CaseSeverity): {
  label: string;
  badgeClass: string;
} {
  switch (severity) {
    case 'LOW':
      return { label: 'Low', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200' };
    case 'MEDIUM':
      return { label: 'Medium', badgeClass: 'bg-blue-100 text-blue-800 border-blue-200' };
    case 'HIGH':
      return { label: 'High', badgeClass: 'bg-amber-100 text-amber-800 border-amber-300' };
    case 'CRITICAL':
      return { label: 'Critical', badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse' };
  }
}
