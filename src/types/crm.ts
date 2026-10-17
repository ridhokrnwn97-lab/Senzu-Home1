import { GenderPreference } from '../types';

export type CrmCustomerSegment =
  | 'NEW'
  | 'ACTIVE'
  | 'REPEAT'
  | 'HIGH_VALUE'
  | 'AT_RISK'
  | 'INACTIVE'
  | 'VIP';

export type CrmCustomerStatus =
  | 'active'
  | 'blocked'
  | 'archived'
  | 'do_not_contact';

export interface CustomerCRM {
  id: string; // Canonical identifier (e.g. cust_6281272902321)
  name: string;
  normalizedName: string;
  phone: string; // Original phone as entered (e.g. 081272902321)
  normalizedPhone: string; // Canonical E.164-like (e.g. +6281272902321)
  email?: string;
  genderPreference?: GenderPreference;
  gender?: 'Laki-laki' | 'Perempuan';

  // Customer Account & Firebase Auth
  authUserId?: string; // Firebase Auth UID
  displayName?: string;
  nickname?: string;
  accountType?: 'GUEST' | 'CUSTOMER';
  accountStatus?: 'ACTIVE' | 'DISABLED' | 'UNVERIFIED' | 'NOT_REGISTERED';
  emailVerified?: boolean;
  registeredAt?: string;
  lastLoginAt?: string;
  birthDate?: string;

  // Primary / Default Address
  defaultAddress: string;
  defaultArea: string;
  defaultLatitude?: number;
  defaultLongitude?: number;
  defaultPlaceId?: string;
  addressNotes?: string;

  // Booking & Lifetime Metrics
  firstBookingAt: string; // ISO string
  firstCompletedBookingAt?: string; // ISO string
  lastBookingAt: string; // ISO string
  lastCompletedTreatmentAt?: string; // ISO string

  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;

  totalSpend: number; // Lifetime Net Paid Spend (Rp)
  averageOrderValue: number; // AOV (Rp)
  totalTreatmentMinutes: number; // Minutes completed

  // Preferences & Favorites (Calculated from completed bookings)
  favoriteServiceId?: string;
  favoriteServiceName?: string;
  favoriteTherapistId?: string;
  favoriteTherapistName?: string;

  // Ratings & Satisfaction
  averageRating?: number;
  totalReviews?: number;

  // CRM State & Segmentation
  crmStatus: CrmCustomerStatus;
  blockedReason?: string;
  customerSegment: CrmCustomerSegment;
  vipSource?: 'manual' | 'automatic';

  // Consents & Preferences
  marketingConsent: boolean;
  marketingConsentAt?: string;
  marketingConsentSource?: string;
  transactionalNotificationEnabled: boolean;

  // Operational Insight
  crmOwnerId?: string;
  tags?: string[];
  averageDaysBetweenTreatments?: number;
  nextExpectedBookingAt?: string; // Estimated ISO date
  repeatInsight?: string;

  // Backward-compatibility aliases for legacy views
  whatsapp?: string;
  totalBooking?: number;
  completedBooking?: number;
  lastBooking?: string;
  favoriteTreatment?: string;
  favoriteTherapist?: string;
  area?: string;
  address?: string;
  isVip?: boolean;
  customerStatus?: CrmCustomerStatus;

  createdAt: string;
  updatedAt: string;
}

export interface CustomerReview {
  id: string;
  bookingId: string;
  bookingCode: string;
  customerId: string;
  customerName: string;
  therapistId?: string;
  therapistName?: string;
  serviceId: string;
  serviceName: string;

  // Ratings
  overallRating: number; // 1-5
  serviceRating?: number; // 1-5
  professionalismRating?: number; // 1-5
  punctualityRating?: number; // 1-5
  hygieneRating?: number; // 1-5

  comment: string;
  tags: string[]; // e.g. ['Terapis Ramah', 'Tepat Waktu', 'Treatment Nyaman']
  isAnonymous: boolean;

  // Internal CRM flags
  publishApproved: boolean;
  publishAnonymously: boolean;
  status: 'active' | 'hidden' | 'flagged';

  // Low rating service recovery (Rating <= 2)
  serviceRecoveryStatus?: 'open' | 'contacted' | 'resolved' | 'closed';
  recoveryStatus?: 'open' | 'contacted' | 'resolved' | 'closed';
  serviceRecoveryNote?: string;

  createdAt: string;
  updatedAt: string;
}

export type CustomerSegment = CrmCustomerSegment;
export type CustomerStatus = CrmCustomerStatus;
export type CustomerNoteCategory = 'operational' | 'preference' | 'complaint' | 'general' | 'medical_allergy_alert';
export type CrmTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' | 'low' | 'medium' | 'high';
export type CrmTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled' | 'pending';
export type CrmTaskType = 'reactivation' | 'service_recovery' | 'customer_followup' | 'vip_followup' | 'periodic_rebooking_reminder';

export interface CustomerNote {
  id: string;
  customerId: string;
  bookingId?: string;
  noteType?: 'operational' | 'preference' | 'complaint' | 'general' | 'medical_allergy_alert';
  category?: CustomerNoteCategory;
  note?: string;
  content?: string;
  createdBy?: string;
  createdByRole?: string;
  authorName?: string;
  authorRole?: string;
  isPinned?: boolean;
  visibility?: 'internal' | 'operational';
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSavedAddress {
  id: string;
  customerId: string;
  label: string; // 'Rumah' | 'Kantor' | 'Apartemen' | 'Lainnya'
  address: string;
  area: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  addressNotes?: string;
  notes?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrmTask {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  bookingId?: string;
  taskType: CrmTaskType;
  title: string;
  description?: string;
  assignedTo?: string;
  assignedToName?: string;
  priority: CrmTaskPriority;
  dueAt?: string;
  dueDate?: string;
  status: CrmTaskStatus;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  completedAt?: string;
}

export interface CustomerInteraction {
  id: string;
  customerId: string;
  bookingId?: string;
  channel: 'whatsapp' | 'phone' | 'in_app' | 'email' | 'manual_note';
  interactionType?: string;
  direction: 'inbound' | 'outbound';
  summary: string;
  staffId: string;
  staffName?: string;
  createdAt: string;
}

export interface CustomerAuditLog {
  id: string;
  customerId: string;
  action:
    | 'created'
    | 'updated'
    | 'merged'
    | 'status_change'
    | 'status_changed'
    | 'vip_change'
    | 'promoted_to_vip'
    | 'demoted_from_vip'
    | 'segment_change'
    | 'note_added'
    | 'tag_added'
    | 'review_added';
  performedBy: string;
  details: string;
  timestamp: string;
}

export interface CrmSettings {
  id: string;
  repeatMinBookings: number; // default: 2
  activeDays: number; // default: 60
  atRiskDays: number; // default: 90
  inactiveDays: number; // default: 90
  highValueSpend: number; // default: 1000000 (Rp 1.000.000)
  highValueBookings: number; // default: 5
  reviewReminderEnabled: boolean;
  reviewReminderDelayHours: number;
  reactivationEnabled: boolean;
  updatedAt: string;
}

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  id: 'general',
  repeatMinBookings: 2,
  activeDays: 60,
  atRiskDays: 90,
  inactiveDays: 90,
  highValueSpend: 1000000,
  highValueBookings: 5,
  reviewReminderEnabled: true,
  reviewReminderDelayHours: 2,
  reactivationEnabled: true,
  updatedAt: new Date().toISOString(),
};

export const REVIEW_TAG_OPTIONS = [
  'Terapis Ramah & Sopan',
  'Tepat Waktu',
  'Teknik Pijat Mantap & Nyaman',
  'Sangat Profesional',
  'Bersih & Higienis',
  'Meredakan Pegal & Capek',
  'Aroma Terapi Enak',
  'Akan Pesan Lagi',
] as const;

export const CUSTOMER_SEGMENT_LABELS: Record<string, string> = {
  NEW: 'Pelanggan Baru',
  ACTIVE: 'Aktif',
  REPEAT: 'Repeat Order',
  HIGH_VALUE: 'High Value',
  AT_RISK: 'At-Risk (Perlu Sapa)',
  INACTIVE: 'Tidak Aktif',
  VIP: 'VIP Senzu',
};

export const CUSTOMER_SEGMENT_COLORS: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  NEW: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  REPEAT: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  HIGH_VALUE: { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-300' },
  AT_RISK: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  INACTIVE: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
  VIP: { bg: 'bg-amber-100', text: 'text-[#8B6B14]', border: 'border-[#D4AF37]' },
};

export type { GenderPreference } from '../types';

