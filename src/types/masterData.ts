import { ServiceItem } from '../types';

export type CompanyStatus = 'ACTIVE' | 'INACTIVE';
export type BranchStatus = 'ACTIVE' | 'INACTIVE';
export type ServiceType = 'HOME_SERVICE' | 'OUTLET' | 'BOTH';

export interface CompanySettings {
  id: string;
  companyLegalName: string;
  brandName: string;
  officialEmail: string;
  customerServiceWhatsApp: string;
  timezone: string;
  status: CompanyStatus;
  address?: string;
  taxId?: string;
  businessRegistrationNumber?: string;
  notes?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  companyId: string;
  brandName: string;
  address: string;
  city: string;
  province: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
  customerServiceWhatsApp: string;
  officialEmail: string;
  openingTime: string;
  closingTime: string;
  timezone: string;
  status: BranchStatus;
  isDefault?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface BusinessSettings {
  id: string;
  defaultBranchId: string;
  defaultBranchName: string;
  defaultTimezone: string;
  operatingHoursStart: string;
  operatingHoursEnd: string;
  customerSupportWhatsApp: string;
  officialEmail: string;
  leadTimeMinutes: number;
  maxAdvanceDays: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type ServiceAreaStatus = 'ACTIVE' | 'INACTIVE';

export interface ServiceArea {
  id: string;
  name: string;
  kecamatan: string;
  kelurahan?: string[];
  city: string;
  province: string;
  branchId: string;
  branchName: string;
  status: ServiceAreaStatus;
  isActive?: boolean;
  homeServiceEnabled: boolean;
  homeServiceFee?: number; // numeric Rupiah, 0 for gratis, or undefined if not set
  minimumOrderAmount?: number;
  maximumDistanceKm?: number;
  centerLatitude?: number;
  centerLongitude?: number;
  radiusKm?: number;
  sortOrder: number;
  internalNote?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type CategoryStatus = 'ACTIVE' | 'INACTIVE';
export type SkillStatus = 'ACTIVE' | 'INACTIVE';

export interface ServiceCategory {
  id: string; // Stable category identifier (e.g., 'cat-reflexology')
  categoryId: string; // Same as id for consistency
  categoryCode?: string; // Optional code (e.g., 'CAT-REFL')
  categoryName: string; // Display name
  name?: string; // Alias for categoryName for convenience
  description?: string;
  sortOrder: number;
  activeStatus: CategoryStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface TherapistSkill {
  id: string; // Stable skill identifier (e.g., 'reflexology')
  skillId: string; // Same as id for consistency
  skillCode?: string; // Optional code (e.g., 'SKL-REFL')
  skillName: string; // Display name
  name?: string; // Alias for skillName for convenience
  description?: string;
  activeStatus: SkillStatus;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type AdminAuditAction =
  | 'company.updated'
  | 'branch.created'
  | 'branch.updated'
  | 'branch.activated'
  | 'branch.deactivated'
  | 'service.created'
  | 'service.updated'
  | 'service.activated'
  | 'service.deactivated'
  | 'service.required_skills_updated'
  | 'service_category.created'
  | 'service_category.updated'
  | 'service_category.activated'
  | 'service_category.deactivated'
  | 'therapist_skill.created'
  | 'therapist_skill.updated'
  | 'therapist_skill.activated'
  | 'therapist_skill.deactivated'
  | 'area.created'
  | 'area.updated'
  | 'area.activated'
  | 'area.deactivated'
  | 'payment.updated'
  | 'payment_method.created'
  | 'payment_method.updated'
  | 'payment_method.activated'
  | 'payment_method.deactivated'
  | 'qris.updated'
  | 'payment_instruction.updated'
  | 'staff.created'
  | 'staff.updated'
  | 'staff.activated'
  | 'staff.deactivated'
  | 'staff.role_changed'
  | 'therapist.created'
  | 'therapist.updated'
  | 'therapist.skills_updated'
  | 'therapist.activated'
  | 'therapist.deactivated'
  | 'business_settings.updated'
  | 'operational_settings.updated'
  | 'notifications.updated'
  | 'staff_account.invite_sent'
  | 'staff_account.created'
  | 'staff_account.password_reset_requested'
  | 'staff_account.disabled'
  | 'staff_account.enabled'
  | 'staff_account.first_password_changed'
  | 'demo_staff.disabled'
  | 'report.exported';

export type AdminAuditEntityType =
  | 'company'
  | 'branch'
  | 'service'
  | 'service_category'
  | 'therapist_skill'
  | 'area'
  | 'payment'
  | 'staff'
  | 'staff_account'
  | 'demo_staff'
  | 'therapist'
  | 'business_settings'
  | 'operational_settings'
  | 'notifications'
  | 'report';

export interface AdminAuditLog {
  id: string;
  actorId: string;
  actorRole: 'admin' | 'manager' | 'supervisor' | 'system';
  actorName: string;
  action: AdminAuditAction;
  entityType: AdminAuditEntityType;
  entityId: string;
  oldValue?: string;
  newValue?: string;
  summary: string;
  timestamp: string;
  formattedWIB: string;
}

export interface NotificationMessageTemplate {
  key: string;
  title: string;
  description: string;
  template: string;
  variables: string[];
}

export interface MasterNotificationConfig {
  id: string;
  customerServiceWhatsApp: string;
  officialEmail: string;
  sendWhatsAppConfirmation: boolean;
  sendWhatsAppOnTheWay: boolean;
  sendWhatsAppCompleted: boolean;
  templates: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AreaMasterConfig {
  id: string;
  baseLocationName: string;
  baseLatitude: number;
  baseLongitude: number;
  fallbackHomeServiceFee: number;
  supportedAreas: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface OperationalSettings {
  id: string;

  // 1. Aturan Reservasi (Booking Rules)
  operatingHoursStart: string; // e.g. '10:00'
  operatingHoursEnd: string; // e.g. '22:00'
  leadTimeMinutes: number; // e.g. 60 (Lead time minimum reservasi)
  maxAdvanceDays: number; // e.g. 14 (Maksimal hari reservasi ke depan)
  slotIntervalMinutes: number; // e.g. 30 (Interval pembagian jam slot)
  cancellationCutoffHours?: number; // Optional cutoff hours (undefined = 'Belum Diatur')
  minOrderAmount?: number; // Optional minimum order (undefined = 'Belum Diatur')
  maxOrderAmount?: number; // Optional maximum order (undefined = 'Belum Diatur')

  // 2. Penugasan & Mobilitas (Assignment & Travel)
  travelBufferMinutes: number; // e.g. 15 (Buffer jeda antar order)
  transitSpeedKmH: number; // e.g. 25 (Estimasi kecepatan transit Palembang)
  parkingStagingBufferMinutes: number; // e.g. 10 (Waktu parkir & persiapan lokasi)
  unassignedAlertMinutes: number; // e.g. 90 (Peringatan order lunas belum ditugaskan)
  therapistAcceptanceTimeoutMinutes: number; // e.g. 10 (Batas konfirmasi terima oleh terapis)
  autoReassignTimeoutMinutes?: number; // Optional auto-reassign (undefined = 'Belum Diatur')

  // 3. Pelacakan & GPS (Tracking & Geofence)
  gpsStaleMinutes: number; // e.g. 3 (Peringatan GPS tidak update)
  gpsCriticalStaleMinutes: number; // e.g. 8 (Kondisi kritis GPS hilang sinyal)
  nearbyDistanceKm: number; // e.g. 1.0 (Radius geofence mendekati lokasi)
  nearbyEtaMinutes: number; // e.g. 5 (Estimasi waktu tempuh mendekati lokasi)
  locationUpdateIntervalSeconds: number; // e.g. 15 (Frekuensi broadcast GPS terapis)

  // 4. SLA & Eskalasi (SLA, Overtime, & Alerts)
  paymentVerificationSlaMinutes: number; // e.g. 120 (SLA verifikasi bukti bayar oleh CSS)
  paymentUrgentSlaMinutes: number; // e.g. 30 (SLA darurat pembayaran mendekati jadwal)
  lateDepartureBufferMinutes: number; // e.g. 35 (Peringatan terapis belum meluncur sebelum jadwal)
  treatmentOvertimeBufferMinutes: number; // e.g. 15 (Toleransi durasi melewati estimasi paket)
  lowRatingThreshold: number; // e.g. 2 (Rating <= threshold memicu evaluasi & pemulihan layanan)
  customerFollowupTargetMinutes?: number; // e.g. 15 (SLA respon & tindak lanjut komplain pelanggan oleh CSS)
  supervisorEscalationTargetMinutes?: number; // e.g. 30 (SLA eskalasi penanganan kendala oleh Supervisor)
  maxUnreachableAttempts: number; // e.g. 3 (Batas maksimal upaya hubungi pelanggan)
  unreachableRetryIntervalMinutes: number; // e.g. 60 (Jeda waktu antar percobaan kontak)

  // 5. Notifikasi & Saluran Otomatis (Notifications & Alert Channels)
  customerNotificationsEnabled: boolean; // default true
  whatsappConfirmationEnabled: boolean; // default true
  whatsappOnTheWayEnabled: boolean; // default true
  whatsappNearbyEnabled: boolean; // default true
  whatsappCompletedEnabled: boolean; // default true
  supervisorAlertsEnabled: boolean; // default true
  reminderMinutesBeforeSchedule: number; // default 60

  updatedAt?: string;
  updatedBy?: string;
}

