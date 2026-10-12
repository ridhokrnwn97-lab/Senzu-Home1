export type BookingStatus =
  | 'Menunggu Pembayaran'
  | 'Pembayaran Terverifikasi'
  | 'Confirmed'
  | 'Therapist Assigned'
  | 'Accepted'
  | 'On The Way'
  | 'Arrived'
  | 'Treatment'
  | 'Completed'
  | 'Cancelled'
  | 'Rescheduled';

export type PaymentStatusCode =
  | 'unpaid'
  | 'pending_manual_verification'
  | 'paid'
  | 'payment_rejected'
  | 'pending'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

export type PaymentStatus = PaymentStatusCode | 'UNPAID' | 'PAID';

export * from './types/payment';
export * from './types/notification';
export * from './types/roster';
export * from './types/masterData';
export * from './types/case';
export * from './types/chat';

// Active payment method names for new customer bookings
export type ActivePaymentMethodName =
  | 'QRIS'
  | 'QRIS Senzu'
  | 'Transfer'
  | 'Transfer BNI'
  | 'Transfer Bank Mandiri'
  | 'Transfer BRI';

// Deprecated / historical payment methods (for viewing legacy records only; forbidden for new bookings)
export type HistoricalPaymentMethodName =
  | 'Cash'
  | 'Tunai'
  | 'Pay On Service'
  | 'COD'
  | 'Bayar di Tempat';

export type PaymentMethod = ActivePaymentMethodName | HistoricalPaymentMethodName;

export type GenderPreference = 'Bebas' | 'Perempuan' | 'Laki-laki';

export type UserRole = 'css' | 'supervisor' | 'therapist' | 'manager' | 'admin';

export interface ServiceItem {
  id: string;
  name: string;
  duration: number; // in minutes
  price: number; // IDR
  description: string;
  isPopular?: boolean;
  isActive: boolean;
  categoryId?: string; // Stable category ID from ServiceCategory master
  category?: string; // Display name snapshot
  shortDescription?: string;
  serviceType?: 'HOME_SERVICE' | 'OUTLET' | 'BOTH';
  requiredSkillIds?: string[]; // IDs from TherapistSkill master
  sortOrder?: number;
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ServiceRadiusTier {
  id: string;
  minKm: number;
  maxKm: number | null; // null means unbounded (>15km)
  fee: number;
  label: string;
  requiresConfirmation?: boolean;
}

export interface AppSettings {
  id: string;
  homeServiceFee: number;
  baseLocationName?: string;
  baseLatitude?: number;
  baseLongitude?: number;
  radiusTiers?: ServiceRadiusTier[];
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  qrisInstruction: string;
  contactWhatsApp: string;
  updatedAt?: string;
}

export interface WeeklyScheduleDay {
  day: number; // 0 = Minggu, 1 = Senin, 2 = Selasa, 3 = Rabu, 4 = Kamis, 5 = Jumat, 6 = Sabtu
  dayName: string;
  isWorking: boolean;
  shiftStart: string; // HH:mm
  shiftEnd: string;   // HH:mm
  breakStart?: string;
  breakEnd?: string;
  hasBreak: boolean;
}

export type TherapistWeeklySchedule = Record<number, WeeklyScheduleDay>;

export interface ShiftTemplate {
  id: string;
  name: string; // e.g. "Shift Pagi", "Shift Reguler", "Shift Siang", "Weekend"
  shiftStart: string; // HH:mm
  shiftEnd: string;   // HH:mm
  breakStart?: string; // HH:mm
  breakEnd?: string;   // HH:mm
  hasBreak: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type OperationalShiftStatus =
  | 'Belum Mulai Shift'
  | 'Aktif'
  | 'Break'
  | 'Assigned'
  | 'On The Way'
  | 'Treatment'
  | 'Selesai Shift'
  | 'Off'
  | 'Unavailable'
  | 'Jadwal Belum Diatur';

export interface TherapistShiftConfig {
  start: string; // HH:mm e.g. "10:00"
  end: string;   // HH:mm e.g. "22:00"
  offDays: number[]; // 0 for Sunday, 1 for Monday, ..., 6 for Saturday
}

export interface Therapist {
  id: string;
  staffId?: string;
  employeeCode?: string;
  name: string;
  displayName?: string;
  gender: 'Perempuan' | 'Laki-laki';
  phone: string;
  email: string;
  branchId?: string;
  branchName?: string;
  specialties: string[];
  skillIds?: string[]; // IDs of TherapistSkill master (Prompt 17A)
  serviceIds?: string[]; // IDs of ServiceItem matching skill matrix (e.g. ['srv-sig-60', 'srv-sig-90'])
  rating: number;
  totalCompleted: number;
  status: 'available' | 'on_duty' | 'off' | 'busy' | 'break';
  avatarUrl?: string;
  customerDisplayEnabled?: boolean;
  defaultShift?: TherapistShiftConfig;
  weeklySchedule?: TherapistWeeklySchedule;
  isActive?: boolean;
  internalNotes?: string;
  notes?: string;
  authUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface TherapistLocation {
  id?: string; // bookingId
  therapistId: string;
  therapistName: string;
  bookingId: string;
  bookingCode: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  heading?: number | null;
  speed?: number | null;
  timestamp: string; // ISO
  updatedAtMillis: number;
  isTrackingActive: boolean;
}

export interface Booking {
  id: string;
  bookingCode: string;
  customerId: string;
  customerAuthUid?: string; // Firebase Authenticated UID (Preferred Canonical Field)
  authUserId?: string; // Firebase Authenticated UID (Existing Field)
  customerName: string;
  customerWhatsApp: string;
  customerEmail?: string;
  serviceId: string;
  serviceName: string;
  serviceDuration: number;
  therapistId?: string;
  therapistName?: string;
  scheduleDate: string; // YYYY-MM-DD
  scheduleTime: string; // HH:mm
  scheduleAt: string; // formatted full date time
  genderPreference: GenderPreference;
  address: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  area: string;
  addressNotes?: string; // Patokan lokasi / landmark
  distanceKm?: number;
  distanceMeters?: number;
  homeServiceFeeTier?: string;
  baseLocationId?: string;
  baseLocationName?: string;
  baseLatitude?: number;
  baseLongitude?: number;
  customerLat?: number;
  customerLng?: number;
  requiresAdminConfirmation?: boolean;
  servicePrice: number;
  homeServiceFee: number;
  // Historical snapshot fields (protects past bookings from Service & Area Master changes)
  serviceNameSnapshot?: string;
  durationMinutesSnapshot?: number;
  servicePriceSnapshot?: number;
  homeServiceFeeSnapshot?: number;
  areaIdSnapshot?: string;
  areaNameSnapshot?: string;
  discountAmount?: number;
  voucherId?: string;
  voucherCode?: string;
  voucherDiscount?: number;
  promoId?: string;
  promoCode?: string;
  promoCodeSnapshot?: string;
  promoNameSnapshot?: string;
  discountTypeSnapshot?: string;
  discountValueSnapshot?: number;
  promoDiscount?: number;
  pointsRedeemed?: number;
  pointsDiscount?: number;
  pointsEarned?: number;
  referredByCustomerId?: string;
  referralCodeUsed?: string;
  membershipTierAtBooking?: string;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: BookingStatus;
  customerNotes: string;
  internalNotes?: string;
  branchId?: string;
  branchName?: string;
  assignedTherapistName?: string;
  preferredTherapistName?: string;
  areaName?: string;
  customerArea?: string;
  addressDistrict?: string;
  customerAddress?: string;
  assignedAt?: string;
  isReassigned?: boolean;
  reassignedFromTherapistId?: string;
  paymentProofUrl?: string;
  paymentProofUploadedAt?: string;
  paymentDeadline?: string;
  paymentPolicyVersion?: 2;
  paymentExpiredAt?: string;
  paymentVerifiedAt?: string;
  confirmedAt?: string;
  cancellationReason?: string;
  notes?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  onTheWayAt?: string;
  arrivedAt?: string;
  arrivalLatitude?: number;
  arrivalLongitude?: number;
  treatmentStartedAt?: string;
  completedAt?: string;
  earlyCompletion?: boolean;
  issueReport?: {
    category: string;
    note: string;
    reportedAt: string;
    reportedBy: string;
    status?: 'open' | 'resolved';
    resolvedAt?: string;
    resolvedBy?: string;
    resolutionNote?: string;
  };
  escalation?: {
    category: string;
    reason: string;
    priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
    escalatedBy: string;
    escalatedByName: string;
    escalatedAt: string;
    status: 'open' | 'in_progress' | 'resolved';
    resolutionNote?: string;
    resolvedBy?: string;
    resolvedAt?: string;
  };
  customerRequest?: {
    type: 'reschedule' | 'address_change' | 'cancellation' | 'service_change';
    details: string;
    requestedAt: string;
    status: 'pending' | 'processed' | 'rejected';
  };
  unreachableCount?: number;
  lastContactAttemptAt?: string;
  nextFollowUpAt?: string;
  cssOwnerId?: string;
  cssOwnerName?: string;
  taskStatus?: 'Open' | 'In Progress' | 'Waiting Customer' | 'Waiting Supervisor' | 'Resolved' | 'Closed';
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface BookingStatusHistory {
  id: string;
  bookingId: string;
  bookingCode: string;
  status: BookingStatus;
  note?: string;
  updatedByRole: 'customer' | 'css' | 'supervisor' | 'therapist' | 'system' | 'manager' | 'admin';
  updatedByName: string;
  timestamp: string; // ISO
  formattedWIB: string;
}

export interface OperationalAuditLog {
  id: string;
  bookingId?: string;
  bookingCode?: string;
  customerId?: string;
  therapistId?: string;
  therapistName?: string;
  action:
    | 'assign'
    | 'reassign'
    | 'override_status'
    | 'override_arrival'
    | 'resolve_issue'
    | 'internal_note'
    | 'shift_change'
    | 'payment_verified'
    | 'payment_rejected'
    | 'reschedule'
    | 'address_change'
    | 'cancel'
    | 'escalate_supervisor'
    | 'customer_contact'
    | 'service_change'
    | 'claim_task'
    | 'customer_unreachable'
    | 'case_created'
    | 'case_assigned'
    | 'case_resolved'
    | 'case_closed'
    | 'case_reopened'
    | 'recovery_proposed'
    | 'recovery_approved'
    | 'refund_status_updated';
  actorRole: 'supervisor' | 'manager' | 'admin' | 'css' | 'system';
  actorName: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  note?: string;
  timestamp: string; // ISO
  formattedWIB: string;
}

export interface OperationalAlert {
  id: string;
  bookingId?: string;
  bookingCode?: string;
  therapistId?: string;
  therapistName?: string;
  type:
    | 'unassigned_paid'
    | 'acceptance_delayed'
    | 'late_risk'
    | 'gps_stale'
    | 'issue_reported'
    | 'overtime'
    | 'early_completion'
    | 'low_rating'
    | 'css_escalation';
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  title: string;
  message: string;
  actionLabel: string;
  actionType: 'assign' | 'reassign' | 'view_tracking' | 'contact_therapist' | 'resolve_issue' | 'open_detail';
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export * from './types/crm';
export * from './types/loyalty';

export type LoginAccountStatus =
  | 'BELUM_DIBUAT'
  | 'UNDANGAN_TERKIRIM'
  | 'PASSWORD_AWAL_DIBUAT'
  | 'AKTIF'
  | 'WAJIB_GANTI_PASSWORD'
  | 'DINONAKTIFKAN'
  | 'BERMASALAH';

export type DemoAccountCategory =
  | 'SAFE_TO_DISABLE'
  | 'REVIEW_REQUIRED'
  | 'HAS_ACTIVE_REFERENCES'
  | 'ALREADY_DISABLED'
  | 'REAL_PRODUCTION';

export interface StaffUser {
  uid: string;
  id?: string;
  employeeCode?: string;
  name: string;
  displayName?: string;
  email: string;
  role: UserRole;
  therapistId?: string;
  phone?: string;
  gender?: 'Perempuan' | 'Laki-laki';
  branchId?: string;
  branchName?: string;
  isActive?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
  operationalStatus?: string;
  avatarUrl?: string;
  internalNotes?: string;
  authUserId?: string; // Firebase Auth UID
  loginAccountStatus?: LoginAccountStatus;
  mustChangePassword?: boolean;
  firstLoginCompleted?: boolean;
  accountCreatedAt?: string;
  accountDisabledAt?: string;
  lastLoginAt?: string;
  isDemoAccount?: boolean;
  demoCategory?: DemoAccountCategory;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export type User = StaffUser;

export const PALEMBANG_AREAS = [
  'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)',
  'Ilir Barat II (30-35 Ilir, Bukit Baru)',
  'Ilir Timur I (18-20 Ilir, Sekip)',
  'Ilir Timur II (1-3 Ilir, Lawang Kidul)',
  'Ilir Timur III (8-9 Ilir, Duku)',
  'Kemuning (Pipa Reja, Ario Kemuning)',
  'Sukarami (Kebun Bunga, Talang Kelapa)',
  'Sako (Sialang, Sukamaju)',
  'Kalidoni (Bukit Sangkal, Sei Selincah)',
  'Bukit Kecil (Talang Semut, 26 Ilir)',
  'Gandus (Karang Anyar, Pulo Kerto)',
  'Kertapati (Ogan Baru, Karya Jaya)',
  'Plaju (Bagus Kuning, Komperta)',
  'Seberang Ulu I (7-10 Ulu, Silaberanti)',
  'Seberang Ulu II (11-16 Ulu, Tangga Takat)',
  'Alang-Alang Lebar (Talang Kelapa)',
  'Jakabaring / Jakabaring Sport City'
] as const;
