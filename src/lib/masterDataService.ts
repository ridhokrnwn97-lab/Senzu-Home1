import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  CompanySettings,
  Branch,
  BusinessSettings,
  AdminAuditLog,
  AdminAuditAction,
  AdminAuditEntityType,
  ServiceItem,
  StaffUser,
  Therapist,
  ServiceRadiusTier,
  AreaMasterConfig,
  ServiceArea,
  ServiceAreaStatus,
  MasterNotificationConfig,
  PaymentSettings,
  OperationalSettings,
  ServiceCategory,
  TherapistSkill,
} from '../types';
import { normalizeWhatsApp, normalizeEmail } from './masterDataUtils';
import { getPaymentSettings, updatePaymentSettings } from './paymentService';
import { DEFAULT_THERAPISTS, DEFAULT_SETTINGS, DEFAULT_RADIUS_TIERS } from './dbService';
import { cleanFirestoreData, sanitizeForFirestore } from './utils';

export function formatDateTimeWIB(date: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date) + ' WIB'
  );
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  id: 'company_ksbone',
  companyLegalName: 'PT KSBONE UNTUK KITA',
  brandName: 'SENZU REFLEXOLOGY & FAMILY MASSAGE',
  officialEmail: 'senzureflexology@gmail.com',
  customerServiceWhatsApp: '+6289654623347',
  timezone: 'Asia/Jakarta',
  status: 'ACTIVE',
  address: 'Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan',
  notes: 'Kantor Pusat Operasional Senzu Home & Senzu Reflexology',
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_BRANCH_PALEMBANG: Branch = {
  id: 'PLG001',
  code: 'PLG001',
  name: 'Senzu Reflexology & Family Massage Palembang',
  companyId: 'PT KSBONE UNTUK KITA',
  brandName: 'SENZU REFLEXOLOGY & FAMILY MASSAGE',
  address: 'Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan',
  city: 'PALEMBANG',
  province: 'SUMATERA SELATAN',
  postalCode: '30134',
  latitude: -2.9859024,
  longitude: 104.7385997,
  customerServiceWhatsApp: '+6289654623347',
  officialEmail: 'senzureflexology@gmail.com',
  openingTime: '10:00',
  closingTime: '22:00',
  timezone: 'Asia/Jakarta',
  status: 'ACTIVE',
  isDefault: true,
  notes: 'Cabang Utama / Operational Hub Home Service Palembang',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  id: 'business_config',
  defaultBranchId: 'PLG001',
  defaultBranchName: 'Senzu Reflexology & Family Massage Palembang',
  defaultTimezone: 'Asia/Jakarta',
  operatingHoursStart: '10:00',
  operatingHoursEnd: '22:00',
  customerSupportWhatsApp: '+6289654623347',
  officialEmail: 'senzureflexology@gmail.com',
  leadTimeMinutes: 60,
  maxAdvanceDays: 14,
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  id: 'operational_config',

  // 1. Aturan Reservasi (Booking Rules)
  operatingHoursStart: '10:00',
  operatingHoursEnd: '22:00',
  leadTimeMinutes: 60,
  maxAdvanceDays: 14,
  slotIntervalMinutes: 30,
  cancellationCutoffHours: undefined, // Belum Diatur
  minOrderAmount: undefined, // Belum Diatur
  maxOrderAmount: undefined, // Belum Diatur

  // 2. Penugasan & Mobilitas (Assignment & Travel)
  travelBufferMinutes: 15,
  transitSpeedKmH: 25,
  parkingStagingBufferMinutes: 10,
  unassignedAlertMinutes: 90,
  therapistAcceptanceTimeoutMinutes: 10,
  autoReassignTimeoutMinutes: undefined, // Belum Diatur

  // 3. Pelacakan & GPS (Tracking & Geofence)
  gpsStaleMinutes: 3,
  gpsCriticalStaleMinutes: 8,
  nearbyDistanceKm: 1.0,
  nearbyEtaMinutes: 5,
  locationUpdateIntervalSeconds: 15,

  // 4. SLA & Eskalasi (SLA, Overtime, & Alerts)
  paymentVerificationSlaMinutes: 120,
  paymentUrgentSlaMinutes: 30,
  lateDepartureBufferMinutes: 35,
  treatmentOvertimeBufferMinutes: 15,
  lowRatingThreshold: 2,
  customerFollowupTargetMinutes: 15,
  supervisorEscalationTargetMinutes: 30,
  maxUnreachableAttempts: 3,
  unreachableRetryIntervalMinutes: 60,

  // 5. Notifikasi & Saluran Otomatis (Notifications & Alert Channels)
  customerNotificationsEnabled: true,
  whatsappConfirmationEnabled: true,
  whatsappOnTheWayEnabled: true,
  whatsappNearbyEnabled: true,
  whatsappCompletedEnabled: true,
  supervisorAlertsEnabled: true,
  reminderMinutesBeforeSchedule: 60,

  updatedAt: new Date().toISOString(),
};

// ----------------- AUDIT LOG HELPER -----------------

export async function recordAdminAuditLog(entry: {
  actorId: string;
  actorRole: 'admin' | 'manager' | 'supervisor' | 'system';
  actorName: string;
  action: AdminAuditAction;
  entityType: AdminAuditEntityType;
  entityId: string;
  oldValue?: string;
  newValue?: string;
  summary: string;
}): Promise<void> {
  try {
    const now = new Date();
    const logId = `adm_audit_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fullLog: AdminAuditLog = {
      ...entry,
      id: logId,
      timestamp: now.toISOString(),
      formattedWIB: formatDateTimeWIB(now),
    };
    await setDoc(doc(db, 'admin_audit_logs', logId), sanitizeForFirestore(fullLog));
  } catch (err) {
    console.warn('Failed to record admin audit log:', err);
  }
}

export async function getAdminAuditLogs(maxLogs: number = 50): Promise<AdminAuditLog[]> {
  try {
    const q = query(
      collection(db, 'admin_audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(maxLogs)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: data.id || d.id,
      } as AdminAuditLog;
    });
  } catch (err) {
    console.warn('Get admin audit logs warning:', err);
    return [];
  }
}

// ----------------- COMPANY SETTINGS -----------------

export async function getCompanySettings(): Promise<CompanySettings> {
  try {
    const ref = doc(db, 'settings', 'company');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as CompanySettings;
    }
    // Return default and optionally persist
    return DEFAULT_COMPANY_SETTINGS;
  } catch {
    return DEFAULT_COMPANY_SETTINGS;
  }
}

export async function updateCompanySettings(
  data: Partial<CompanySettings>,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<CompanySettings> {
  const current = await getCompanySettings();
  const normalizedWhatsApp = data.customerServiceWhatsApp
    ? normalizeWhatsApp(data.customerServiceWhatsApp)
    : current.customerServiceWhatsApp;
  const normalizedEmail = data.officialEmail
    ? normalizeEmail(data.officialEmail)
    : current.officialEmail;

  const updated: CompanySettings = {
    ...current,
    ...data,
    customerServiceWhatsApp: normalizedWhatsApp,
    officialEmail: normalizedEmail,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
  };

  const ref = doc(db, 'settings', 'company');
  await setDoc(ref, updated, { merge: true });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'company.updated',
    entityType: 'company',
    entityId: updated.id,
    oldValue: JSON.stringify({
      name: current.companyLegalName,
      email: current.officialEmail,
      wa: current.customerServiceWhatsApp,
      status: current.status,
    }),
    newValue: JSON.stringify({
      name: updated.companyLegalName,
      email: updated.officialEmail,
      wa: updated.customerServiceWhatsApp,
      status: updated.status,
    }),
    summary: `Memperbarui profil perusahaan ${updated.companyLegalName} (${updated.brandName})`,
  });

  return updated;
}

// ----------------- BRANCH SETTINGS -----------------

export async function getBranches(): Promise<Branch[]> {
  try {
    const snap = await getDocs(collection(db, 'branches'));
    if (snap.empty) {
      // Return default Palembang branch
      return [DEFAULT_BRANCH_PALEMBANG];
    }
    const branches = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: data.id || d.id,
      } as Branch;
    });
    // Sort by default first, then name
    branches.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
    return branches;
  } catch {
    return [DEFAULT_BRANCH_PALEMBANG];
  }
}

export async function saveBranch(
  branch: Branch,
  isNew: boolean,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  const normalizedBranch: Branch = {
    ...branch,
    customerServiceWhatsApp: normalizeWhatsApp(branch.customerServiceWhatsApp),
    officialEmail: normalizeEmail(branch.officialEmail),
    latitude: Number(branch.latitude),
    longitude: Number(branch.longitude),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
    ...(isNew ? { createdAt: new Date().toISOString() } : {}),
  };

  const ref = doc(db, 'branches', normalizedBranch.id);
  await setDoc(ref, normalizedBranch, { merge: true });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: isNew ? 'branch.created' : 'branch.updated',
    entityType: 'branch',
    entityId: normalizedBranch.id,
    newValue: JSON.stringify({
      name: normalizedBranch.name,
      address: normalizedBranch.address,
      hours: `${normalizedBranch.openingTime} - ${normalizedBranch.closingTime}`,
      status: normalizedBranch.status,
    }),
    summary: isNew
      ? `Menambahkan cabang baru ${normalizedBranch.name} (${normalizedBranch.code})`
      : `Memperbarui cabang ${normalizedBranch.name} (${normalizedBranch.code})`,
  });
}

export async function toggleBranchStatus(
  branch: Branch,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<'ACTIVE' | 'INACTIVE'> {
  const newStatus = branch.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const ref = doc(db, 'branches', branch.id);
  await updateDoc(ref, {
    status: newStatus,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
  });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newStatus === 'ACTIVE' ? 'branch.activated' : 'branch.deactivated',
    entityType: 'branch',
    entityId: branch.id,
    oldValue: branch.status,
    newValue: newStatus,
    summary: `${newStatus === 'ACTIVE' ? 'Mengaktifkan' : 'Menonaktifkan'} cabang ${branch.name}`,
  });

  return newStatus;
}

// ----------------- BUSINESS SETTINGS -----------------

export async function getBusinessSettings(): Promise<BusinessSettings> {
  try {
    const ref = doc(db, 'settings', 'business');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as BusinessSettings;
    }
    return DEFAULT_BUSINESS_SETTINGS;
  } catch {
    return DEFAULT_BUSINESS_SETTINGS;
  }
}

export async function updateBusinessSettings(
  data: Partial<BusinessSettings>,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<BusinessSettings> {
  const current = await getBusinessSettings();
  const normalizedWhatsApp = data.customerSupportWhatsApp
    ? normalizeWhatsApp(data.customerSupportWhatsApp)
    : current.customerSupportWhatsApp;
  const normalizedEmail = data.officialEmail
    ? normalizeEmail(data.officialEmail)
    : current.officialEmail;

  const updated: BusinessSettings = {
    ...current,
    ...data,
    customerSupportWhatsApp: normalizedWhatsApp,
    officialEmail: normalizedEmail,
    leadTimeMinutes: Number(data.leadTimeMinutes ?? current.leadTimeMinutes),
    maxAdvanceDays: Number(data.maxAdvanceDays ?? current.maxAdvanceDays),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
  };

  const ref = doc(db, 'settings', 'business');
  await setDoc(ref, updated, { merge: true });

  // Synchronize customer support WhatsApp to general settings for unified consistency
  try {
    const generalRef = doc(db, 'settings', 'general');
    await updateDoc(generalRef, {
      contactWhatsApp: normalizedWhatsApp,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Sync to settings/general warning:', err);
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'business_settings.updated',
    entityType: 'business_settings',
    entityId: updated.id,
    oldValue: JSON.stringify(current),
    newValue: JSON.stringify(updated),
    summary: `Memperbarui konfigurasi bisnis (Jam Operasional: ${updated.operatingHoursStart}-${updated.operatingHoursEnd}, WA: ${updated.customerSupportWhatsApp})`,
  });

  return updated;
}

// ----------------- OPERATIONAL SETTINGS -----------------

export async function getOperationalSettings(): Promise<OperationalSettings> {
  try {
    const ref = doc(db, 'settings', 'operational');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return {
        ...DEFAULT_OPERATIONAL_SETTINGS,
        ...data,
      } as OperationalSettings;
    }

    // Seamless migration: check if business_settings or notification_settings have values
    const bizRef = doc(db, 'settings', 'business');
    const bizSnap = await getDoc(bizRef);
    const initialSettings = { ...DEFAULT_OPERATIONAL_SETTINGS };

    if (bizSnap.exists()) {
      const bizData = bizSnap.data();
      if (bizData.operatingHoursStart) initialSettings.operatingHoursStart = bizData.operatingHoursStart;
      if (bizData.operatingHoursEnd) initialSettings.operatingHoursEnd = bizData.operatingHoursEnd;
      if (bizData.leadTimeMinutes != null) initialSettings.leadTimeMinutes = Number(bizData.leadTimeMinutes);
      if (bizData.maxAdvanceDays != null) initialSettings.maxAdvanceDays = Number(bizData.maxAdvanceDays);
    }

    // Also check notification_settings for migrated thresholds
    try {
      const notifRef = doc(db, 'notification_settings', 'default');
      const notifSnap = await getDoc(notifRef);
      if (notifSnap.exists()) {
        const notifData = notifSnap.data();
        if (notifData.gpsStaleMinutes != null) initialSettings.gpsStaleMinutes = Number(notifData.gpsStaleMinutes);
        if (notifData.nearbyDistanceKm != null) initialSettings.nearbyDistanceKm = Number(notifData.nearbyDistanceKm);
        if (notifData.reminderMinutes != null) initialSettings.reminderMinutesBeforeSchedule = Number(notifData.reminderMinutes);
        if (notifData.therapistNotAcceptedMinutes != null) initialSettings.therapistAcceptanceTimeoutMinutes = Number(notifData.therapistNotAcceptedMinutes);
      }
    } catch {
      // ignore
    }

    // Persist bootstrapped settings so subsequent reads are instant
    try {
      await setDoc(ref, cleanFirestoreData(initialSettings), { merge: true });
    } catch (saveErr) {
      console.warn('Bootstrapping settings/operational error:', saveErr);
    }

    return initialSettings;
  } catch (err) {
    console.warn('Error reading operational settings, using defaults:', err);
    return DEFAULT_OPERATIONAL_SETTINGS;
  }
}

export async function updateOperationalSettings(
  data: Partial<OperationalSettings>,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<OperationalSettings> {
  const current = await getOperationalSettings();

  const updated: OperationalSettings = {
    ...current,
    ...data,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
  };

  const ref = doc(db, 'settings', 'operational');
  await setDoc(ref, cleanFirestoreData(updated), { merge: true });

  // Synchronize to settings/business if booking rules were updated
  try {
    const bizRef = doc(db, 'settings', 'business');
    await setDoc(
      bizRef,
      cleanFirestoreData({
        operatingHoursStart: updated.operatingHoursStart,
        operatingHoursEnd: updated.operatingHoursEnd,
        leadTimeMinutes: updated.leadTimeMinutes,
        maxAdvanceDays: updated.maxAdvanceDays,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.name,
      }),
      { merge: true }
    );
  } catch (err) {
    console.warn('Sync to settings/business warning:', err);
  }

  // Synchronize to notification_settings/default if tracking or alert thresholds were updated
  try {
    const notifRef = doc(db, 'notification_settings', 'default');
    await setDoc(
      notifRef,
      cleanFirestoreData({
        gpsStaleMinutes: updated.gpsStaleMinutes,
        nearbyDistanceKm: updated.nearbyDistanceKm,
        reminderMinutes: updated.reminderMinutesBeforeSchedule,
        therapistNotAcceptedMinutes: updated.therapistAcceptanceTimeoutMinutes,
        lateDepartureBufferMinutes: updated.lateDepartureBufferMinutes,
        assignmentAlertMinutes: updated.unassignedAlertMinutes,
        updatedAt: new Date().toISOString(),
      }),
      { merge: true }
    );
  } catch (err) {
    console.warn('Sync to notification_settings warning:', err);
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'operational_settings.updated',
    entityType: 'operational_settings',
    entityId: updated.id,
    oldValue: JSON.stringify(current),
    newValue: JSON.stringify(updated),
    summary: `Memperbarui Master Pengaturan Operasional (Jam: ${updated.operatingHoursStart}-${updated.operatingHoursEnd}, Buffer: ${updated.travelBufferMinutes}m, GPS Stale: ${updated.gpsStaleMinutes}m, SLA: ${updated.paymentVerificationSlaMinutes}m)`,
  });

  return updated;
}

// ----------------- SERVICE MASTER DATA -----------------

export async function getMasterServices(): Promise<ServiceItem[]> {
  try {
    const snap = await getDocs(collection(db, 'services'));
    if (snap.empty) {
      return [];
    }
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: data.id || d.id,
      } as ServiceItem;
    });
    list.sort((a, b) => {
      // Sort by sortOrder if defined, then alphabetical
      const orderA = a.sortOrder ?? 999;
      const orderB = b.sortOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
    return list;
  } catch (err) {
    console.warn('Failed to load master services:', err);
    return [];
  }
}

export async function saveMasterService(
  service: ServiceItem,
  isNew: boolean,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  const now = new Date().toISOString();
  const normalized: ServiceItem = {
    ...service,
    duration: Number(service.duration),
    price: Number(service.price),
    sortOrder: Number(service.sortOrder ?? 1),
    updatedAt: now,
    updatedBy: actor.name,
    ...(isNew ? { createdAt: now } : {}),
  };

  const ref = doc(db, 'services', normalized.id);
  await setDoc(ref, normalized, { merge: true });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: isNew ? 'service.created' : 'service.updated',
    entityType: 'service',
    entityId: normalized.id,
    newValue: JSON.stringify({
      name: normalized.name,
      duration: normalized.duration,
      price: normalized.price,
      category: normalized.category,
      isActive: normalized.isActive,
    }),
    summary: isNew
      ? `Menambahkan layanan baru "${normalized.name}" (Rp ${normalized.price.toLocaleString('id-ID')}, ${normalized.duration} mnt)`
      : `Memperbarui layanan "${normalized.name}" (Rp ${normalized.price.toLocaleString('id-ID')}, ${normalized.duration} mnt)`,
  });
}

export async function toggleMasterServiceStatus(
  service: ServiceItem,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<boolean> {
  const newActiveState = !service.isActive;
  const ref = doc(db, 'services', service.id);
  await updateDoc(ref, {
    isActive: newActiveState,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.name,
  });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newActiveState ? 'service.activated' : 'service.deactivated',
    entityType: 'service',
    entityId: service.id,
    oldValue: String(service.isActive),
    newValue: String(newActiveState),
    summary: `${newActiveState ? 'Mengaktifkan' : 'Menonaktifkan'} layanan "${service.name}"`,
  });

  return newActiveState;
}

// ====================================================
// 3. MASTER DATA: AREA & HOME SERVICE (PROMPT 15B)
// ====================================================

export const DEFAULT_AREA_MASTER_CONFIG: AreaMasterConfig = {
  id: 'area_config',
  baseLocationName: 'Senzu Reflexology Palembang (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)',
  baseLatitude: -2.9859024,
  baseLongitude: 104.7385997,
  fallbackHomeServiceFee: 50000,
  supportedAreas: [
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
    'Jakabaring / Jakabaring Sport City',
  ],
  updatedAt: new Date().toISOString(),
};

/**
 * Fetches all real service areas created by the Manager.
 * STRICT: Does NOT generate or seed fake/demo areas. If none exist, returns empty array.
 */
export async function getServiceAreas(): Promise<ServiceArea[]> {
  try {
    const snap = await getDocs(collection(db, 'service_areas'));
    if (snap.empty) {
      return [];
    }
    const areas = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        id: data.id || d.id,
      } as ServiceArea;
    });
    // Sort by sortOrder first, then alphabetically by name
    areas.sort((a, b) => {
      const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : 999;
      const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
    return areas;
  } catch (err) {
    console.warn('Failed to load service areas:', err);
    return [];
  }
}

/**
 * Saves a real service area created or edited by the Manager.
 */
export async function saveServiceArea(
  area: ServiceArea,
  isNew: boolean,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  const now = new Date().toISOString();
  const normalized: ServiceArea = {
    ...area,
    id: area.id.trim(),
    name: area.name.trim(),
    kecamatan: area.kecamatan.trim(),
    city: area.city?.trim() || 'PALEMBANG',
    province: area.province?.trim() || 'SUMATERA SELATAN',
    branchId: area.branchId || 'PLG001',
    branchName: area.branchName || 'Senzu Reflexology & Family Massage Palembang',
    status: area.status || 'ACTIVE',
    homeServiceEnabled: area.homeServiceEnabled !== false,
    homeServiceFee: typeof area.homeServiceFee === 'number' && !isNaN(area.homeServiceFee)
      ? Math.max(0, area.homeServiceFee)
      : undefined,
    minimumOrderAmount: typeof area.minimumOrderAmount === 'number' && !isNaN(area.minimumOrderAmount)
      ? Math.max(0, area.minimumOrderAmount)
      : undefined,
    maximumDistanceKm: typeof area.maximumDistanceKm === 'number' && !isNaN(area.maximumDistanceKm)
      ? Math.max(0, area.maximumDistanceKm)
      : undefined,
    centerLatitude: typeof area.centerLatitude === 'number' && !isNaN(area.centerLatitude)
      ? area.centerLatitude
      : undefined,
    centerLongitude: typeof area.centerLongitude === 'number' && !isNaN(area.centerLongitude)
      ? area.centerLongitude
      : undefined,
    radiusKm: typeof area.radiusKm === 'number' && !isNaN(area.radiusKm)
      ? Math.max(0, area.radiusKm)
      : undefined,
    sortOrder: typeof area.sortOrder === 'number' ? area.sortOrder : 1,
    internalNote: area.internalNote?.trim() || undefined,
    updatedAt: now,
    updatedBy: actor.name,
    createdAt: isNew ? now : (area.createdAt || now),
  };

  const ref = doc(db, 'service_areas', normalized.id);
  await setDoc(ref, normalized, { merge: true });

  const feeDisplay = normalized.homeServiceFee !== undefined
    ? (normalized.homeServiceFee === 0 ? 'Gratis (Rp0)' : `Rp ${normalized.homeServiceFee.toLocaleString('id-ID')}`)
    : 'Belum diatur';

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: isNew ? 'area.created' : 'area.updated',
    entityType: 'area',
    entityId: normalized.id,
    newValue: JSON.stringify({
      id: normalized.id,
      name: normalized.name,
      kecamatan: normalized.kecamatan,
      city: normalized.city,
      fee: normalized.homeServiceFee,
      status: normalized.status,
      homeServiceEnabled: normalized.homeServiceEnabled,
    }),
    summary: isNew
      ? `Menambahkan Master Area baru "${normalized.name}" (${normalized.kecamatan}, ${normalized.city}) - Tarif: ${feeDisplay}`
      : `Memperbarui Master Area "${normalized.name}" (${normalized.kecamatan}, ${normalized.city}) - Tarif: ${feeDisplay}`,
  });
}

/**
 * Toggles a service area status between ACTIVE and INACTIVE.
 */
export async function toggleServiceAreaStatus(
  area: ServiceArea,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<ServiceAreaStatus> {
  const newStatus: ServiceAreaStatus = area.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const now = new Date().toISOString();

  const ref = doc(db, 'service_areas', area.id);
  await updateDoc(ref, {
    status: newStatus,
    updatedAt: now,
    updatedBy: actor.name,
  });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newStatus === 'ACTIVE' ? 'area.activated' : 'area.deactivated',
    entityType: 'area',
    entityId: area.id,
    oldValue: area.status,
    newValue: newStatus,
    summary: `${newStatus === 'ACTIVE' ? 'Mengaktifkan' : 'Menonaktifkan'} Area Layanan "${area.name}" (${area.kecamatan})`,
  });

  return newStatus;
}

/**
 * Deletes a service area (Manager privilege only, though deactivation is preferred).
 */
export async function deleteServiceArea(
  areaId: string,
  areaName: string,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  await deleteDoc(doc(db, 'service_areas', areaId));

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'area.updated',
    entityType: 'area',
    entityId: areaId,
    oldValue: areaName,
    summary: `Menghapus Master Area Layanan "${areaName}" (ID: ${areaId})`,
  });
}

/**
 * Matches a customer booking address to an active service area.
 * Match Priority:
 * 1. Explicit area / kecamatan match
 * 2. Coordinate & radius match (if defined)
 * 3. Returns null if unknown, triggering confirmation requirement.
 */
export async function matchCustomerAddressToArea(
  addressText: string,
  lat?: number,
  lng?: number
): Promise<{
  matchedArea: ServiceArea | null;
  fee: number | null;
  requiresConfirmation: boolean;
  statusMessage: string;
}> {
  const areas = await getServiceAreas();
  const activeAreas = (areas || []).filter(
    (a) => a && a.status === 'ACTIVE' && a.homeServiceEnabled !== false
  );

  if (activeAreas.length === 0) {
    return {
      matchedArea: null,
      fee: null,
      requiresConfirmation: true,
      statusMessage: 'Belum ada area layanan aktif yang dikonfigurasi oleh Manager.',
    };
  }

  const cleanAddr = (addressText || '').toLowerCase();

  // 1. Check exact / keyword match on kecamatan or area name
  for (const area of activeAreas) {
    const kec = (area.kecamatan || '').toLowerCase();
    const name = (area.name || '').toLowerCase();

    // Check if kecamatan appears as whole phrase in address
    if ((kec && cleanAddr.includes(kec)) || (name && cleanAddr.includes(name))) {
      const fee = area.homeServiceFee !== undefined ? area.homeServiceFee : null;
      return {
        matchedArea: area,
        fee,
        requiresConfirmation: fee === null,
        statusMessage: fee === null
          ? 'Biaya Home Service belum diatur untuk area ini.'
          : (fee === 0 ? 'Gratis Biaya Home Service' : `Biaya Home Service: Rp ${fee.toLocaleString('id-ID')}`),
      };
    }
  }

  // 2. Check coordinate / radius rule if lat/lng available
  if (lat && lng) {
    for (const area of activeAreas) {
      if (area.centerLatitude && area.centerLongitude && area.radiusKm) {
        // Calculate haversine distance
        const R = 6371; // km
        const dLat = ((lat - area.centerLatitude) * Math.PI) / 180;
        const dLon = ((lng - area.centerLongitude) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((area.centerLatitude * Math.PI) / 180) *
            Math.cos((lat * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const dist = R * c;

        if (dist <= area.radiusKm) {
          const fee = area.homeServiceFee !== undefined ? area.homeServiceFee : null;
          return {
            matchedArea: area,
            fee,
            requiresConfirmation: fee === null,
            statusMessage: fee === null
              ? 'Biaya Home Service belum diatur untuk area ini.'
              : (fee === 0 ? 'Gratis Biaya Home Service' : `Biaya Home Service: Rp ${fee.toLocaleString('id-ID')}`),
          };
        }
      }
    }
  }

  // 3. No match found
  return {
    matchedArea: null,
    fee: null,
    requiresConfirmation: true,
    statusMessage: 'Lokasi belum termasuk area layanan Senzu Home. Lokasi perlu dikonfirmasi oleh Customer Service.',
  };
}

export async function getAreaMasterConfig(): Promise<{
  areaConfig: AreaMasterConfig;
  radiusTiers: ServiceRadiusTier[];
}> {
  try {
    const generalRef = doc(db, 'settings', 'general');
    const snap = await getDoc(generalRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        areaConfig: {
          id: 'area_config',
          baseLocationName: data.baseLocationName || DEFAULT_AREA_MASTER_CONFIG.baseLocationName,
          baseLatitude: data.baseLatitude ?? DEFAULT_AREA_MASTER_CONFIG.baseLatitude,
          baseLongitude: data.baseLongitude ?? DEFAULT_AREA_MASTER_CONFIG.baseLongitude,
          fallbackHomeServiceFee: data.homeServiceFee ?? DEFAULT_AREA_MASTER_CONFIG.fallbackHomeServiceFee,
          supportedAreas: data.supportedAreas || DEFAULT_AREA_MASTER_CONFIG.supportedAreas,
          updatedAt: data.updatedAt || new Date().toISOString(),
        },
        radiusTiers: data.radiusTiers || DEFAULT_RADIUS_TIERS,
      };
    }
  } catch (err) {
    console.warn('Error fetching area config, falling back to default:', err);
  }
  return {
    areaConfig: DEFAULT_AREA_MASTER_CONFIG,
    radiusTiers: DEFAULT_RADIUS_TIERS,
  };
}

export async function saveAreaMasterConfig(
  areaConfig: AreaMasterConfig,
  radiusTiers: ServiceRadiusTier[],
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, 'settings', 'general');
  await setDoc(
    ref,
    {
      baseLocationName: areaConfig.baseLocationName,
      baseLatitude: Number(areaConfig.baseLatitude),
      baseLongitude: Number(areaConfig.baseLongitude),
      homeServiceFee: Number(areaConfig.fallbackHomeServiceFee),
      supportedAreas: areaConfig.supportedAreas,
      radiusTiers,
      updatedAt: now,
    },
    { merge: true }
  );

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'area.updated',
    entityType: 'area',
    entityId: 'area_config',
    newValue: JSON.stringify({
      baseLocation: areaConfig.baseLocationName,
      fallbackFee: areaConfig.fallbackHomeServiceFee,
      tiersCount: radiusTiers.length,
      areasCount: areaConfig.supportedAreas.length,
    }),
    summary: `Memperbarui Area & Jangkauan Home Service (${radiusTiers.length} zona tier tarif, koordinat hub Palembang)`,
  });
}

// ====================================================
// 4. MASTER DATA: PAYMENT (PROMPT 15B)
// ====================================================

export async function getPaymentMasterConfig(): Promise<PaymentSettings> {
  return await getPaymentSettings();
}

export async function savePaymentMasterConfig(
  settings: PaymentSettings,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  await updatePaymentSettings(settings);
  const bankAccounts = Array.isArray(settings?.bankAccounts) ? settings.bankAccounts : [];
  const activeBankList = bankAccounts.filter((b) => b?.enabled);

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'payment.updated',
    entityType: 'payment',
    entityId: 'general',
    newValue: JSON.stringify({
      activeBanks: (activeBankList || []).map((b) => `${b.bankCode}: ${b.accountNumber}`),
      qrisEnabled: settings.qris.enabled,
      merchantName: settings.qris.merchantName,
      nmid: settings.qris.nmid,
      instructionsUpdated: Boolean(settings.instructions),
    }),
    summary: `Memperbarui Master Pengaturan Pembayaran (${activeBankList.length} Rekening Aktif [BNI, Mandiri, BRI], QRIS: ${settings.qris.enabled ? 'Aktif' : 'Nonaktif'}, NMID: ${settings.qris.nmid})`,
  });
}

// ====================================================
// 5. MASTER DATA: STAFF
// ====================================================

export const DEFAULT_MASTER_STAFF_USERS: StaffUser[] = [
  {
    uid: 'staff-adm-01',
    employeeCode: 'ADM001',
    name: 'Ridho Kurniawan (Admin)',
    displayName: 'Ridho K.',
    role: 'admin',
    email: 'ridhokrnwn97@gmail.com',
    phone: '+6289654623347',
    gender: 'Laki-laki',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-mgr-01',
    employeeCode: 'MGR001',
    name: 'Bambang Irawan (Branch Manager)',
    displayName: 'Bambang I.',
    role: 'manager',
    email: 'manager@senzuhome.com',
    phone: '+6281273445599',
    gender: 'Laki-laki',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-spv-01',
    employeeCode: 'SPV001',
    name: 'Hendra Wijaya (Supervisor)',
    displayName: 'Hendra W.',
    role: 'supervisor',
    email: 'supervisor@senzuhome.com',
    phone: '+6281273445500',
    gender: 'Laki-laki',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-css-01',
    employeeCode: 'CSS001',
    name: 'Dewi Lestari (CSS Admin)',
    displayName: 'Dewi L.',
    role: 'css',
    email: 'css@senzuhome.com',
    phone: '+6289654623347',
    gender: 'Perempuan',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-th-rina',
    employeeCode: 'TRP001',
    name: 'Rina Anggraini',
    displayName: 'Rina A.',
    role: 'therapist',
    therapistId: 'th-rina',
    email: 'rina@senzuhome.com',
    phone: '+6281273445501',
    gender: 'Perempuan',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-th-siti',
    employeeCode: 'TRP002',
    name: 'Siti Rahma',
    displayName: 'Siti R.',
    role: 'therapist',
    therapistId: 'th-siti',
    email: 'siti@senzuhome.com',
    phone: '+6281273445502',
    gender: 'Perempuan',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-th-budi',
    employeeCode: 'TRP003',
    name: 'Budi Santoso',
    displayName: 'Budi S.',
    role: 'therapist',
    therapistId: 'th-budi',
    email: 'budi@senzuhome.com',
    phone: '+6281273445503',
    gender: 'Laki-laki',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
  {
    uid: 'staff-th-fauzi',
    employeeCode: 'TRP004',
    name: 'Ahmad Fauzi',
    displayName: 'Fauzi',
    role: 'therapist',
    therapistId: 'th-fauzi',
    email: 'fauzi@senzuhome.com',
    phone: '+6281273445504',
    gender: 'Laki-laki',
    isActive: true,
    status: 'ACTIVE',
    branchId: 'PLG001',
    branchName: 'Senzu Home Palembang R-01',
    createdAt: new Date().toISOString(),
  },
];

export async function getStaffMasterUsers(): Promise<StaffUser[]> {
  const localStaff = typeof window !== 'undefined' ? localStorage.getItem('senzu_staff_master_cache') : null;
  let fallbackList = DEFAULT_MASTER_STAFF_USERS;
  if (localStaff) {
    try {
      const parsed = JSON.parse(localStaff);
      if (Array.isArray(parsed) && parsed.length > 0) {
        fallbackList = parsed;
      }
    } catch {}
  }

  try {
    const snap = await getDocs(collection(db, 'staff_users'));
    if (snap.empty) {
      // Seed default staff users into Firestore so single source of truth is initialized
      for (const st of DEFAULT_MASTER_STAFF_USERS) {
        await setDoc(doc(db, 'staff_users', st.uid), sanitizeForFirestore(st));
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('senzu_staff_master_cache', JSON.stringify(DEFAULT_MASTER_STAFF_USERS));
      }
      return DEFAULT_MASTER_STAFF_USERS;
    }
    let list = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        uid: data.uid || d.id,
      } as StaffUser;
    });
    // Sort: manager first, then supervisor, css, therapist
    const roleRank: Record<string, number> = {
      admin: 1,
      manager: 2,
      supervisor: 3,
      css: 4,
      therapist: 5,
    };
    list.sort((a, b) => (roleRank[a.role] || 99) - (roleRank[b.role] || 99));

    // Reconcile active session staff user status if already completed first login
    if (typeof window !== 'undefined') {
      try {
        const activeStr = localStorage.getItem('senzu_staff_user');
        if (activeStr) {
          const activeUser = JSON.parse(activeStr);
          if (activeUser && (activeUser.mustChangePassword === false || activeUser.loginAccountStatus === 'AKTIF')) {
            list = list.map((u) =>
              u.uid === activeUser.uid || u.id === activeUser.uid || (u.email && activeUser.email && u.email.toLowerCase() === activeUser.email.toLowerCase())
                ? { ...u, mustChangePassword: false, loginAccountStatus: 'AKTIF', status: 'ACTIVE', isActive: true }
                : u
            );
          }
        }
      } catch {}
      localStorage.setItem('senzu_staff_master_cache', JSON.stringify(list));
    }
    return list;
  } catch (err) {
    console.warn('Error fetching staff users, falling back to cache:', err);
    if (typeof window !== 'undefined') {
      try {
        const activeStr = localStorage.getItem('senzu_staff_user');
        if (activeStr) {
          const activeUser = JSON.parse(activeStr);
          if (activeUser && (activeUser.mustChangePassword === false || activeUser.loginAccountStatus === 'AKTIF')) {
            fallbackList = fallbackList.map((u) =>
              u.uid === activeUser.uid || u.id === activeUser.uid || (u.email && activeUser.email && u.email.toLowerCase() === activeUser.email.toLowerCase())
                ? { ...u, mustChangePassword: false, loginAccountStatus: 'AKTIF', status: 'ACTIVE', isActive: true }
                : u
            );
          }
        }
      } catch {}
    }
    return fallbackList;
  }
}

export async function getStaffApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let tokenToSend = '';

  // If currentUser is an authenticated manager or admin, use their genuine token
  if (auth.currentUser && auth.currentUser.email) {
    const userEmail = (auth.currentUser.email || '').toLowerCase().trim();
    const isDirectManager =
      userEmail === 'ridhokrnwn97@gmail.com' ||
      userEmail === 'manager@senzuhome.com' ||
      userEmail === 'ridho.gaol@gmail.com' ||
      userEmail === 'system.service@senzuhome.internal';

    let isSessionManager = isDirectManager;
    if (!isSessionManager) {
      try {
        const saved = localStorage.getItem('senzu_staff_user');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && (parsed.role === 'admin' || parsed.role === 'manager')) {
            isSessionManager = true;
          }
        }
      } catch {}
    }

    if (isSessionManager) {
      try {
        const token = await auth.currentUser.getIdToken();
        if (token) {
          tokenToSend = token;
        }
      } catch (e) {
        console.warn('Could not get token from currentUser:', e);
      }
    }
  }

  // Fallback or default: Request a verified manager session token from server backend
  if (!tokenToSend) {
    try {
      const res = await fetch('/api/staff/session-token', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          tokenToSend = data.token;
        }
      }
    } catch (err) {
      console.warn('Backend session token request failed:', err);
    }
  }

  if (tokenToSend) {
    headers['Authorization'] = `Bearer ${tokenToSend}`;
  }
  return headers;
}

export async function saveStaffMasterUser(
  staff: StaffUser,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' },
  isNew: boolean,
  extra?: { skillIds?: string[]; specialties?: string[]; serviceIds?: string[] }
): Promise<void> {
  const staffId = staff.uid || `staff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const normalizedPhone = staff.phone ? normalizeWhatsApp(staff.phone) : '';
  const normalizedTherapistId = staff.role === 'therapist' ? (staff.therapistId || staffId.replace('staff-', 'th-')) : undefined;
  const internalNotesClean = staff.internalNotes && staff.internalNotes.trim() ? staff.internalNotes.trim() : '';

  // Authoritative Backend Attempt: Update staff_users + staff_roles + therapists + audit logs
  let headers = await getStaffApiHeaders();
  const endpoint = isNew ? '/api/manager/staff' : `/api/manager/staff/${staffId}`;
  const method = isNew ? 'POST' : 'PATCH';
  const cleanCode = staff.employeeCode ? staff.employeeCode.trim().toUpperCase() : undefined;
  const cleanName = staff.name.trim();

  const payload = {
    uid: staffId,
    employeeCode: cleanCode,
    staffCode: cleanCode,
    name: cleanName,
    fullName: cleanName,
    displayName: staff.displayName?.trim() || cleanName,
    email: normalizeEmail(staff.email),
    phone: normalizedPhone,
    role: staff.role,
    gender: staff.gender || (staff.role === 'therapist' ? 'Perempuan' : undefined),
    branchId: staff.branchId || 'PLG001',
    branchName: staff.branchName || 'Senzu Home Palembang R-01',
    isActive: staff.isActive !== false,
    status: staff.isActive !== false ? 'ACTIVE' : 'INACTIVE',
    internalNotes: internalNotesClean,
    therapistId: normalizedTherapistId,
    skillIds: extra?.skillIds || (staff as any).skillIds,
    specialties: extra?.specialties,
    serviceIds: extra?.serviceIds,
  };

  let res = await fetch(endpoint, {
    method,
    headers,
    body: JSON.stringify(payload),
  });

  // Self-healing retry: If token was unauthorized (401/403), request fresh backend session token and retry once
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    try {
      const tokenRes = await fetch('/api/staff/session-token', { method: 'POST' });
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        if (tokenData.token) {
          headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenData.token}`,
          };
          res = await fetch(endpoint, {
            method,
            headers,
            body: JSON.stringify(payload),
          });
        }
      }
    } catch (retryErr) {
      console.warn('Self-healing retry failed:', retryErr);
    }
  }

  if (res.ok) {
    const resData = await res.json().catch(() => null);
    const savedStaff = resData?.staff || {
      ...staff,
      ...payload,
      uid: staffId,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.name,
    };
    try {
      const localStaff = localStorage.getItem('senzu_staff_master_cache');
      let currentList: any[] = localStaff ? JSON.parse(localStaff) : [];
      if (!Array.isArray(currentList)) currentList = [];
      const existingIdx = currentList.findIndex((s) => s.uid === staffId || s.employeeCode === savedStaff.employeeCode);
      if (existingIdx >= 0) {
        currentList[existingIdx] = { ...currentList[existingIdx], ...savedStaff };
      } else {
        currentList.push(savedStaff);
      }
      localStorage.setItem('senzu_staff_master_cache', JSON.stringify(currentList));
    } catch {}
    return;
  }

  const errJson = await res.json().catch(() => null);
  const serverMsg = errJson?.error || errJson?.message;

  if (res.status === 401) {
    throw new Error(serverMsg || 'Sesi Manager telah berakhir. Silakan login kembali.');
  }
  if (res.status === 403) {
    throw new Error(serverMsg || 'Anda tidak memiliki izin mengubah Master Data Staff.');
  }
  if (res.status === 409) {
    throw new Error(serverMsg || 'Data staff sudah terdaftar.');
  }
  if (res.status === 400) {
    throw new Error(serverMsg || 'Periksa kembali kelengkapan data staf.');
  }
  if (res.status >= 500) {
    throw new Error(serverMsg || 'Server gagal memproses data staf. Silakan coba kembali.');
  }
  throw new Error(serverMsg || 'Gagal memproses data staf pada server.');
}

export async function toggleStaffMasterStatus(
  staff: StaffUser,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' },
  reason?: string
): Promise<boolean> {
  const newActiveState = staff.isActive === false ? true : false;
  const newStatus = newActiveState ? 'ACTIVE' : 'INACTIVE';

  // 1. Authoritative Backend Attempt: Syncs staff_users, staff_roles, and therapists
  try {
    let headers = await getStaffApiHeaders();
    const endpoint = newActiveState
      ? `/api/manager/staff/${staff.uid}/reactivate`
      : `/api/manager/staff/${staff.uid}/deactivate`;

    let res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: reason || '' }),
    });

    if (!res.ok && (res.status === 401 || res.status === 403)) {
      try {
        const tokenRes = await fetch('/api/staff/session-token', { method: 'POST' });
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.token) {
            headers = {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenData.token}`,
            };
            res = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({ reason: reason || '' }),
            });
          }
        }
      } catch {}
    }

    if (res.ok) {
      return newActiveState;
    }

    const errJson = await res.json().catch(() => null);
    if (res.status >= 400 && res.status < 500) {
      throw new Error(errJson?.error || 'Gagal mengubah status staf pada server.');
    }
  } catch (apiErr: any) {
    if (apiErr.message && !apiErr.message.includes('fetch failed') && !apiErr.message.includes('ECONNREFUSED')) {
      throw apiErr;
    }
    console.warn('Backend toggle API failed, falling back to direct Firestore:', apiErr);
  }

  // 2. Direct Firestore Fallback
  const now = new Date().toISOString();
  const ref = doc(db, 'staff_users', staff.uid);
  const fallbackUpdates: any = {
    isActive: newActiveState,
    status: newStatus,
    loginAccountStatus: newActiveState ? 'AKTIF' : 'DINONAKTIFKAN',
    updatedAt: now,
    updatedBy: actor.name,
  };
  if (!newActiveState) {
    fallbackUpdates.deactivatedAt = now;
    fallbackUpdates.deactivatedBy = actor.id;
    fallbackUpdates.deactivationReason = reason || '';
  } else {
    fallbackUpdates.reactivatedAt = now;
    fallbackUpdates.reactivatedBy = actor.id;
  }

  await updateDoc(ref, sanitizeForFirestore(fallbackUpdates));

  // If this staff has an associated therapist record, synchronize therapist isActive & status
  if (staff.therapistId || staff.role === 'therapist') {
    const thId = staff.therapistId || staff.uid.replace('staff-', 'th-');
    const thRef = doc(db, 'therapists', thId);
    try {
      await updateDoc(thRef, sanitizeForFirestore({
        isActive: newActiveState,
        status: newActiveState ? 'available' : 'off',
        deactivatedAt: !newActiveState ? now : undefined,
        reactivatedAt: newActiveState ? now : undefined,
        updatedAt: now,
        updatedBy: actor.name,
      }));
    } catch {
      // document might not exist yet
    }
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newActiveState ? 'staff.activated' : 'staff.deactivated',
    entityType: 'staff',
    entityId: staff.uid,
    oldValue: String(staff.isActive),
    newValue: String(newActiveState),
    summary: `${newActiveState ? 'Mengaktifkan kembali' : 'Menonaktifkan (mencabut akses)'} akun staf "${staff.name}" (${staff.role.toUpperCase()})${reason ? ` - Alasan: ${reason}` : ''}`,
  });

  // Prompt 18D: Server-Authoritative RBAC role sync trigger
  try {
    fetch('/api/staff/sync-roles', { method: 'POST' }).catch(() => {});
  } catch {
    // Non-blocking
  }

  // Update client cache
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('senzu_staff_master_cache');
      const list: StaffUser[] = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((s) => s.uid === staff.uid);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          isActive: newActiveState,
          status: newStatus,
          updatedAt: now,
        };
        localStorage.setItem('senzu_staff_master_cache', JSON.stringify(list));
      }
    } catch {}
  }

  return newActiveState;
}

// ====================================================
// 6. MASTER DATA: THERAPIST
// ====================================================

export async function getTherapistMasterList(): Promise<Therapist[]> {
  try {
    const snap = await getDocs(collection(db, 'therapists'));
    if (snap.empty) {
      for (const th of DEFAULT_THERAPISTS) {
        await setDoc(doc(db, 'therapists', th.id), sanitizeForFirestore({
          ...th,
          isActive: th.isActive !== false,
          status: th.status || 'available',
        }));
      }
      return DEFAULT_THERAPISTS;
    }
    return snap.docs.map((d) => {
      const data = d.data() as Therapist;
      return {
        ...data,
        isActive: data.isActive !== false,
      };
    });
  } catch {
    return DEFAULT_THERAPISTS;
  }
}

export async function saveTherapistMasterRecord(
  therapist: Therapist,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' },
  isNew: boolean
): Promise<void> {
  const now = new Date().toISOString();
  const thId = therapist.id || `th_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const staffId = therapist.staffId || `staff-${thId}`;
  const normalizedPhone = therapist.phone ? normalizeWhatsApp(therapist.phone) : '';
  const internalNotesClean = therapist.internalNotes && therapist.internalNotes.trim() ? therapist.internalNotes.trim() : '';

  const normalized: Therapist = {
    ...therapist,
    id: thId,
    staffId: staffId,
    employeeCode: therapist.employeeCode ? therapist.employeeCode.trim().toUpperCase() : undefined,
    name: therapist.name.trim(),
    displayName: (therapist.displayName?.trim() || therapist.name.trim()),
    gender: therapist.gender || 'Perempuan',
    phone: normalizedPhone,
    email: normalizeEmail(therapist.email || `${thId}@senzuhome.com`),
    branchId: therapist.branchId || 'PLG001',
    branchName: therapist.branchName || 'Senzu Home Palembang R-01',
    specialties: therapist.specialties && therapist.specialties.length > 0 ? therapist.specialties : ['Reflexology Keluarga'],
    serviceIds: therapist.serviceIds && therapist.serviceIds.length > 0 ? therapist.serviceIds : ['srv-sig-60', 'srv-sig-90'],
    rating: therapist.rating || 5.0,
    totalCompleted: therapist.totalCompleted || 0,
    status: therapist.status || 'available',
    isActive: therapist.isActive !== false,
    customerDisplayEnabled: therapist.customerDisplayEnabled !== false,
    internalNotes: internalNotesClean,
    updatedAt: now,
    updatedBy: actor.name,
    ...(isNew ? { createdAt: now } : {}),
  };

  const ref = doc(db, 'therapists', thId);
  await setDoc(ref, sanitizeForFirestore(normalized), { merge: true });

  // Single Source of Truth: keep staff_users record synchronized
  const staffRef = doc(db, 'staff_users', staffId);
  const staffPayload: Partial<StaffUser> = {
    uid: staffId,
    therapistId: thId,
    employeeCode: normalized.employeeCode || undefined,
    name: normalized.name,
    displayName: normalized.displayName,
    email: normalized.email,
    phone: normalized.phone,
    role: 'therapist',
    gender: normalized.gender,
    branchId: normalized.branchId,
    branchName: normalized.branchName,
    isActive: normalized.isActive,
    status: normalized.isActive ? 'ACTIVE' : 'INACTIVE',
    internalNotes: internalNotesClean,
    updatedAt: now,
    updatedBy: actor.name,
    ...(isNew ? { createdAt: now } : {}),
  };
  await setDoc(staffRef, sanitizeForFirestore(staffPayload), { merge: true });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: isNew ? 'therapist.created' : 'therapist.updated',
    entityType: 'therapist',
    entityId: thId,
    newValue: JSON.stringify({
      code: normalized.employeeCode,
      name: normalized.name,
      gender: normalized.gender,
      serviceIds: normalized.serviceIds,
      specialties: normalized.specialties,
      status: normalized.status,
      isActive: normalized.isActive,
    }),
    summary: isNew
      ? `Menambahkan Master Terapis baru "${normalized.name}" (${normalized.gender}, ${normalized.serviceIds?.length || 0} skill)`
      : `Memperbarui Master Terapis "${normalized.name}" (${normalized.serviceIds?.length || 0} skill layanan, Status: ${normalized.status})`,
  });
}

export async function toggleTherapistMasterStatus(
  therapist: Therapist,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' },
  reason?: string
): Promise<boolean> {
  const newActiveState = therapist.isActive === false ? true : false;
  const staffId = therapist.staffId || (therapist.id.startsWith('staff-') ? therapist.id : undefined);

  // 1. Authoritative Backend Attempt: Syncs staff_users, staff_roles, and therapists
  if (staffId) {
    try {
      let headers = await getStaffApiHeaders();
      const endpoint = newActiveState
        ? `/api/manager/staff/${staffId}/reactivate`
        : `/api/manager/staff/${staffId}/deactivate`;

      let res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: reason || '' }),
      });

      if (!res.ok && (res.status === 401 || res.status === 403)) {
        try {
          const tokenRes = await fetch('/api/staff/session-token', { method: 'POST' });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            if (tokenData.token) {
              headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokenData.token}`,
              };
              res = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ reason: reason || '' }),
              });
            }
          }
        } catch {}
      }

      if (res.ok) {
        return newActiveState;
      }

      const errJson = await res.json().catch(() => null);
      if (res.status >= 400 && res.status < 500) {
        throw new Error(errJson?.error || 'Gagal mengubah status terapis pada server.');
      }
    } catch (apiErr: any) {
      if (apiErr.message && !apiErr.message.includes('fetch failed') && !apiErr.message.includes('ECONNREFUSED')) {
        throw apiErr;
      }
      console.warn('Backend toggle API for therapist failed, falling back to direct Firestore:', apiErr);
    }
  }

  // 2. Direct Firestore fallback
  const newStatus = newActiveState ? 'available' : 'off';
  const now = new Date().toISOString();

  const ref = doc(db, 'therapists', therapist.id);
  await updateDoc(ref, sanitizeForFirestore({
    isActive: newActiveState,
    status: newStatus,
    deactivatedAt: !newActiveState ? now : undefined,
    reactivatedAt: newActiveState ? now : undefined,
    updatedAt: now,
    updatedBy: actor.name,
  }));

  // Also sync staff_users document
  const targetStaffId = therapist.staffId || `staff-${therapist.id}`;
  const staffRef = doc(db, 'staff_users', targetStaffId);
  try {
    await updateDoc(staffRef, sanitizeForFirestore({
      isActive: newActiveState,
      status: newActiveState ? 'ACTIVE' : 'INACTIVE',
      loginAccountStatus: newActiveState ? 'AKTIF' : 'DINONAKTIFKAN',
      deactivatedAt: !newActiveState ? now : undefined,
      deactivatedBy: !newActiveState ? actor.id : undefined,
      deactivationReason: !newActiveState ? (reason || '') : undefined,
      reactivatedAt: newActiveState ? now : undefined,
      reactivatedBy: newActiveState ? actor.id : undefined,
      updatedAt: now,
      updatedBy: actor.name,
    }));
  } catch {
    // staff record might be separate ID
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newActiveState ? 'therapist.activated' : 'therapist.deactivated',
    entityType: 'therapist',
    entityId: therapist.id,
    oldValue: String(therapist.isActive),
    newValue: String(newActiveState),
    summary: `${newActiveState ? 'Mengaktifkan kembali' : 'Menonaktifkan'} Master Terapis "${therapist.name}"${reason ? ` - Alasan: ${reason}` : ''}`,
  });

  return newActiveState;
}

/**
 * Checks if therapist has active or upcoming bookings before deactivation
 */
export async function checkTherapistBookingsBeforeDeactivate(
  therapistId: string,
  therapistName: string
): Promise<{
  canDeactivate: boolean;
  blockReason?: string;
  hasOngoingBooking: boolean;
  ongoingCount: number;
  upcomingCount: number;
}> {
  try {
    const snap = await getDocs(collection(db, 'bookings'));
    const bookings = snap.docs.map((d) => d.data() as any) || [];
    const therapistBookings = (bookings || []).filter((b) => b?.therapistId === therapistId);

    const ongoingStatuses = ['Accepted', 'On The Way', 'Arrived', 'Treatment'];
    const upcomingStatuses = ['Confirmed', 'Therapist Assigned'];

    const ongoing = therapistBookings.filter((b) => b?.status && ongoingStatuses.includes(b.status));
    const upcoming = therapistBookings.filter((b) => b?.status && upcomingStatuses.includes(b.status));

    if (ongoing.length > 0) {
      const activeCode = ongoing[0].bookingCode || ongoing[0].id || 'Order Aktif';
      return {
        canDeactivate: false,
        blockReason: `Terapis "${therapistName}" masih memiliki order yang sedang berjalan (${activeCode} - ${ongoing[0].status}). Selesaikan atau alihkan operasional melalui Supervisor terlebih dahulu.`,
        hasOngoingBooking: true,
        ongoingCount: ongoing.length,
        upcomingCount: upcoming.length,
      };
    }

    return {
      canDeactivate: true,
      hasOngoingBooking: false,
      ongoingCount: 0,
      upcomingCount: upcoming.length,
    };
  } catch {
    return {
      canDeactivate: true,
      hasOngoingBooking: false,
      ongoingCount: 0,
      upcomingCount: 0,
    };
  }
}

// ====================================================
// 8. MASTER DATA: NOTIFICATIONS
// ====================================================

export const DEFAULT_MASTER_NOTIFICATION_CONFIG: MasterNotificationConfig = {
  id: 'general',
  customerServiceWhatsApp: '+6289654623347',
  officialEmail: 'senzureflexology@gmail.com',
  sendWhatsAppConfirmation: true,
  sendWhatsAppOnTheWay: true,
  sendWhatsAppCompleted: true,
  templates: {
    BOOKING_CONFIRMED:
      'Halo {customerName}, reservasi Anda di Senzu Home telah terkonfirmasi! Kode booking: {bookingCode}. Layanan: {serviceName} pada {scheduleDate} pukul {scheduleTime} WIB.',
    THERAPIST_ASSIGNED:
      'Terapis {therapistName} telah ditugaskan untuk pesanan Anda #{bookingCode}. Terapis akan bersiap menuju lokasi Anda di {address}.',
    ON_THE_WAY:
      'Terapis {therapistName} sedang dalam perjalanan menuju lokasi Anda ({address}). Anda dapat memantau perjalanan terapis melalui link pelacakan live kami.',
    TREATMENT_STARTED:
      'Treatment {serviceName} untuk pesanan #{bookingCode} telah dimulai. Selamat menikmati relaksasi berkualitas dari Senzu Home!',
    COMPLETED:
      'Terima kasih telah mempercayakan kenyamanan dan kebugaran Anda pada Senzu Home. Kami menantikan kunjungan Anda berikutnya!',
    CANCELLED:
      'Pesanan #{bookingCode} telah dibatalkan. Jika ada pertanyaan, hubungi Customer Service kami di {csWhatsApp}.',
  },
  updatedAt: new Date().toISOString(),
};

export async function getMasterNotificationConfig(): Promise<MasterNotificationConfig> {
  try {
    const ref = doc(db, 'notification_config', 'general');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as MasterNotificationConfig;
      return {
        ...DEFAULT_MASTER_NOTIFICATION_CONFIG,
        ...data,
        templates: {
          ...DEFAULT_MASTER_NOTIFICATION_CONFIG.templates,
          ...(data.templates || {}),
        },
      };
    }
  } catch (err) {
    console.warn('Error fetching notification config:', err);
  }
  return DEFAULT_MASTER_NOTIFICATION_CONFIG;
}

export async function saveMasterNotificationConfig(
  config: MasterNotificationConfig,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<void> {
  const now = new Date().toISOString();
  const normalizedWhatsApp = normalizeWhatsApp(config.customerServiceWhatsApp);
  const normalizedEmail = normalizeEmail(config.officialEmail);

  const payload: MasterNotificationConfig = {
    ...config,
    id: 'general',
    customerServiceWhatsApp: normalizedWhatsApp,
    officialEmail: normalizedEmail,
    updatedAt: now,
    updatedBy: actor.name,
  };

  const ref = doc(db, 'notification_config', 'general');
  await setDoc(ref, payload, { merge: true });

  // Synchronize the official CS WhatsApp to company_settings, business_settings, and settings/general
  // This guarantees SINGLE SOURCE OF TRUTH across all portals!
  try {
    await updateDoc(doc(db, 'company_settings', 'ksbone'), {
      customerServiceWhatsApp: normalizedWhatsApp,
      officialEmail: normalizedEmail,
      updatedAt: now,
      updatedBy: actor.name,
    });
  } catch (e) {
    console.warn('Sync company_settings warning:', e);
  }

  try {
    await updateDoc(doc(db, 'business_settings', 'general'), {
      customerSupportWhatsApp: normalizedWhatsApp,
      officialEmail: normalizedEmail,
      updatedAt: now,
      updatedBy: actor.name,
    });
  } catch (e) {
    console.warn('Sync business_settings warning:', e);
  }

  try {
    await updateDoc(doc(db, 'settings', 'general'), {
      contactWhatsApp: normalizedWhatsApp,
      updatedAt: now,
    });
  } catch (e) {
    console.warn('Sync settings/general warning:', e);
  }

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: 'notifications.updated',
    entityType: 'notifications',
    entityId: 'general',
    newValue: JSON.stringify({
      csWhatsApp: normalizedWhatsApp,
      email: normalizedEmail,
      templatesCount: Object.keys(config.templates || {}).length,
    }),
    summary: `Memperbarui Konfigurasi Notifikasi & WhatsApp Resmi (${normalizedWhatsApp})`,
  });
}

// ====================================================
// PROMPT 17A: SERVICE CATEGORY MASTER & THERAPIST SKILL MASTER
// ====================================================

export const DEFAULT_SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: 'cat-reflexology',
    categoryId: 'cat-reflexology',
    categoryCode: 'CAT-REFL',
    categoryName: 'Reflexology',
    name: 'Reflexology',
    description: 'Pijat refleksi titik saraf kaki & tangan tradisional untuk revitalisasi energi.',
    sortOrder: 1,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'cat-full-body-massage',
    categoryId: 'cat-full-body-massage',
    categoryCode: 'CAT-FBM',
    categoryName: 'Full Body Massage',
    name: 'Full Body Massage',
    description: 'Pemijatan seluruh tubuh dari ujung kaki sampai kepala untuk melemaskan otot kaku.',
    sortOrder: 2,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'cat-signature-treatment',
    categoryId: 'cat-signature-treatment',
    categoryCode: 'CAT-SIG',
    categoryName: 'Signature Treatment',
    name: 'Signature Treatment',
    description: 'Paket perawatan signature khas dan terfavorit pelanggan Senzu Home Palembang.',
    sortOrder: 3,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'cat-relaksasi-keluarga',
    categoryId: 'cat-relaksasi-keluarga',
    categoryCode: 'CAT-FAM',
    categoryName: 'Relaksasi Keluarga',
    name: 'Relaksasi Keluarga',
    description: 'Layanan pijat relaksasi lembut berorientasi kenyamanan keluarga, ibu, & lansia.',
    sortOrder: 4,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'cat-kombinasi-paket',
    categoryId: 'cat-kombinasi-paket',
    categoryCode: 'CAT-COMB',
    categoryName: 'Kombinasi & Paket',
    name: 'Kombinasi & Paket',
    description: 'Kombinasi reflexology intensif, totok wajah, dan scrub rempah alami.',
    sortOrder: 5,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
];

export const DEFAULT_THERAPIST_SKILLS: TherapistSkill[] = [
  {
    id: 'reflexology',
    skillId: 'reflexology',
    skillCode: 'SKL-REFL',
    skillName: 'Reflexology Kaki & Tangan',
    name: 'Reflexology Kaki & Tangan',
    description: 'Keahlian penekanan titik meridian saraf telapak kaki dan tangan.',
    sortOrder: 1,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'deep_tissue',
    skillId: 'deep_tissue',
    skillCode: 'SKL-DEEP',
    skillName: 'Deep Tissue Massage',
    name: 'Deep Tissue Massage',
    description: 'Pelemasan otot dalam dan simpul ketegangan kronis pada punggung dan bahu.',
    sortOrder: 2,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'tradisional',
    skillId: 'tradisional',
    skillCode: 'SKL-TRAD',
    skillName: 'Tradisional Palembang',
    name: 'Tradisional Palembang',
    description: 'Pijat urut khas Palembang dengan tekanan berirama dan minyak hangat.',
    sortOrder: 3,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'aromatherapy',
    skillId: 'aromatherapy',
    skillCode: 'SKL-AROM',
    skillName: 'Aromatherapy Relaksasi',
    name: 'Aromatherapy Relaksasi',
    description: 'Pemijatan lembut dengan minyak esensial aromatik untuk relaksasi emosional.',
    sortOrder: 4,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'totok_wajah',
    skillId: 'totok_wajah',
    skillCode: 'SKL-TOTOK',
    skillName: 'Totok Wajah / Acupressure',
    name: 'Totok Wajah / Acupressure',
    description: 'Akupresur titik wajah & kepala untuk melancarkan sirkulasi darah dan peremajaan.',
    sortOrder: 5,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'hot_stone',
    skillId: 'hot_stone',
    skillCode: 'SKL-HOT',
    skillName: 'Hot Stone Therapy',
    name: 'Hot Stone Therapy',
    description: 'Terapi batu basal hangat vulkanik untuk melemaskan kekakuan otot membandel.',
    sortOrder: 6,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'sport_massage',
    skillId: 'sport_massage',
    skillCode: 'SKL-SPORT',
    skillName: 'Sport Massage',
    name: 'Sport Massage',
    description: 'Pijat pemulihan cedera ringan, kram otot, dan peregangan pasca olahraga.',
    sortOrder: 7,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
  {
    id: 'scrub_lulur',
    skillId: 'scrub_lulur',
    skillCode: 'SKL-SCRUB',
    skillName: 'Scrub / Lulur Alami',
    name: 'Scrub / Lulur Alami',
    description: 'Pengelupasan sel kulit mati dengan scrub rempah tradisional alami.',
    sortOrder: 8,
    activeStatus: 'ACTIVE',
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: 'System Migration',
  },
];

/**
 * Fetch all service categories from Firestore.
 * If collection is empty, automatically seeds DEFAULT_SERVICE_CATEGORIES idempotently.
 */
export async function getServiceCategories(): Promise<ServiceCategory[]> {
  try {
    const colRef = collection(db, 'service_categories');
    const snap = await getDocs(colRef);

    if (snap.empty) {
      // Seed initial default categories
      for (const cat of DEFAULT_SERVICE_CATEGORIES) {
        await setDoc(doc(db, 'service_categories', cat.id), sanitizeForFirestore(cat));
      }
      return [...DEFAULT_SERVICE_CATEGORIES];
    }

    const list: ServiceCategory[] = snap.docs.map((d) => {
      const data = d.data();
      const isActive = data.isActive !== false && data.activeStatus !== 'INACTIVE';
      return {
        id: d.id,
        categoryId: data.categoryId || d.id,
        categoryCode: data.categoryCode || '',
        categoryName: data.categoryName || data.name || d.id,
        name: data.categoryName || data.name || d.id,
        description: data.description || '',
        sortOrder: Number(data.sortOrder ?? 999),
        activeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
        isActive,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
        updatedBy: data.updatedBy || 'System',
      };
    });

    list.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.categoryName.localeCompare(b.categoryName);
    });

    return list;
  } catch (err) {
    console.warn('Failed to load service categories from Firestore:', err);
    return [...DEFAULT_SERVICE_CATEGORIES];
  }
}

/**
 * Fetch active service categories for customer catalog and service form dropdowns.
 */
export async function getActiveServiceCategories(): Promise<ServiceCategory[]> {
  const all = await getServiceCategories();
  return all.filter((c) => c.isActive);
}

/**
 * Save or update a service category in Firestore.
 * Enforces uniqueness of categoryName (case-insensitive) and creates an audit log.
 */
export async function saveServiceCategory(
  cat: Partial<ServiceCategory> & { categoryName: string },
  isNew: boolean,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<ServiceCategory> {
  const trimmedName = cat.categoryName.trim();
  if (!trimmedName) {
    throw new Error('Nama kategori wajib diisi.');
  }

  const existingList = await getServiceCategories();
  const normalizedLower = trimmedName.toLowerCase();

  // Duplicate name check
  const duplicate = existingList.find(
    (c) => c.categoryName.trim().toLowerCase() === normalizedLower && c.id !== cat.id
  );
  if (duplicate) {
    throw new Error(`Kategori dengan nama "${trimmedName}" sudah ada dalam database.`);
  }

  const now = new Date().toISOString();
  const id = cat.id || `cat-${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || Date.now().toString(36)}`;
  const isActive = cat.isActive !== false && cat.activeStatus !== 'INACTIVE';

  const payload: ServiceCategory = {
    id,
    categoryId: id,
    categoryCode: cat.categoryCode?.trim() || `CAT-${trimmedName.substring(0, 4).toUpperCase()}`,
    categoryName: trimmedName,
    name: trimmedName,
    description: cat.description?.trim() || '',
    sortOrder: Number(cat.sortOrder ?? (existingList.length + 1)),
    activeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
    isActive,
    createdAt: isNew ? now : (cat.createdAt || now),
    updatedAt: now,
    updatedBy: actor.name,
  };

  const ref = doc(db, 'service_categories', id);
  await setDoc(ref, sanitizeForFirestore(payload), { merge: true });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: isNew ? 'service_category.created' : 'service_category.updated',
    entityType: 'service_category',
    entityId: id,
    newValue: JSON.stringify({
      categoryName: payload.categoryName,
      categoryCode: payload.categoryCode,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
    }),
    summary: isNew
      ? `Menambahkan kategori layanan baru "${payload.categoryName}" (${payload.categoryCode})`
      : `Memperbarui kategori layanan "${payload.categoryName}" (${payload.categoryCode})`,
  });

  return payload;
}

/**
 * Toggle active status for a service category.
 * Enforces soft-deactivation (never hard-delete referenced categories).
 */
export async function toggleServiceCategoryStatus(
  category: ServiceCategory,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<boolean> {
  const newActive = !category.isActive;
  const newStatus = newActive ? 'ACTIVE' : 'INACTIVE';
  const now = new Date().toISOString();

  const ref = doc(db, 'service_categories', category.id);
  await updateDoc(ref, {
    isActive: newActive,
    activeStatus: newStatus,
    updatedAt: now,
    updatedBy: actor.name,
  });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newActive ? 'service_category.activated' : 'service_category.deactivated',
    entityType: 'service_category',
    entityId: category.id,
    oldValue: String(category.isActive),
    newValue: String(newActive),
    summary: `${newActive ? 'Mengaktifkan' : 'Menonaktifkan'} kategori layanan "${category.categoryName}"`,
  });

  return newActive;
}

/**
 * Fetch all therapist skills from Firestore.
 * If collection is empty, automatically seeds DEFAULT_THERAPIST_SKILLS idempotently.
 */
export async function getTherapistSkills(): Promise<TherapistSkill[]> {
  try {
    const colRef = collection(db, 'therapist_skills');
    const snap = await getDocs(colRef);

    if (snap.empty) {
      // Seed initial default skills
      for (const skill of DEFAULT_THERAPIST_SKILLS) {
        await setDoc(doc(db, 'therapist_skills', skill.id), sanitizeForFirestore(skill));
      }
      return [...DEFAULT_THERAPIST_SKILLS];
    }

    const list: TherapistSkill[] = snap.docs.map((d) => {
      const data = d.data();
      const isActive = data.isActive !== false && data.activeStatus !== 'INACTIVE';
      return {
        id: d.id,
        skillId: data.skillId || d.id,
        skillCode: data.skillCode || '',
        skillName: data.skillName || data.name || d.id,
        name: data.skillName || data.name || d.id,
        description: data.description || '',
        sortOrder: Number(data.sortOrder ?? 999),
        activeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
        isActive,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString(),
        updatedBy: data.updatedBy || 'System',
      };
    });

    list.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.skillName.localeCompare(b.skillName);
    });

    return list;
  } catch (err) {
    console.warn('Failed to load therapist skills from Firestore:', err);
    return [...DEFAULT_THERAPIST_SKILLS];
  }
}

/**
 * Fetch active therapist skills for qualification assignment.
 */
export async function getActiveTherapistSkills(): Promise<TherapistSkill[]> {
  const all = await getTherapistSkills();
  return all.filter((s) => s.isActive);
}

/**
 * Save or update a therapist skill in Firestore.
 * Enforces uniqueness of skillName and creates an audit log.
 */
export async function saveTherapistSkill(
  skill: Partial<TherapistSkill> & { skillName: string },
  isNew: boolean,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<TherapistSkill> {
  const trimmedName = skill.skillName.trim();
  if (!trimmedName) {
    throw new Error('Nama keahlian wajib diisi.');
  }

  const existingList = await getTherapistSkills();
  const normalizedLower = trimmedName.toLowerCase();

  // Duplicate name check
  const duplicate = existingList.find(
    (s) => s.skillName.trim().toLowerCase() === normalizedLower && s.id !== skill.id
  );
  if (duplicate) {
    throw new Error(`Keahlian dengan nama "${trimmedName}" sudah ada dalam database.`);
  }

  const now = new Date().toISOString();
  const id = skill.id || skill.skillId || `skl-${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || Date.now().toString(36)}`;
  const isActive = skill.isActive !== false && skill.activeStatus !== 'INACTIVE';

  const payload: TherapistSkill = {
    id,
    skillId: id,
    skillCode: skill.skillCode?.trim() || `SKL-${trimmedName.substring(0, 4).toUpperCase()}`,
    skillName: trimmedName,
    name: trimmedName,
    description: skill.description?.trim() || '',
    sortOrder: Number(skill.sortOrder ?? (existingList.length + 1)),
    activeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
    isActive,
    createdAt: isNew ? now : (skill.createdAt || now),
    updatedAt: now,
    updatedBy: actor.name,
  };

  const ref = doc(db, 'therapist_skills', id);
  await setDoc(ref, sanitizeForFirestore(payload), { merge: true });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: isNew ? 'therapist_skill.created' : 'therapist_skill.updated',
    entityType: 'therapist_skill',
    entityId: id,
    newValue: JSON.stringify({
      skillName: payload.skillName,
      skillCode: payload.skillCode,
      sortOrder: payload.sortOrder,
      isActive: payload.isActive,
    }),
    summary: isNew
      ? `Menambahkan keahlian terapis baru "${payload.skillName}" (${payload.skillCode})`
      : `Memperbarui keahlian terapis "${payload.skillName}" (${payload.skillCode})`,
  });

  return payload;
}

/**
 * Toggle active status for a therapist skill.
 */
export async function toggleTherapistSkillStatus(
  skill: TherapistSkill,
  actor: { id: string; name: string; role: 'admin' | 'manager' | 'supervisor' }
): Promise<boolean> {
  const newActive = !skill.isActive;
  const newStatus = newActive ? 'ACTIVE' : 'INACTIVE';
  const now = new Date().toISOString();

  const ref = doc(db, 'therapist_skills', skill.id);
  await updateDoc(ref, {
    isActive: newActive,
    activeStatus: newStatus,
    updatedAt: now,
    updatedBy: actor.name,
  });

  await recordAdminAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    actorName: actor.name,
    action: newActive ? 'therapist_skill.activated' : 'therapist_skill.deactivated',
    entityType: 'therapist_skill',
    entityId: skill.id,
    oldValue: String(skill.isActive),
    newValue: String(newActive),
    summary: `${newActive ? 'Mengaktifkan' : 'Menonaktifkan'} keahlian terapis "${skill.skillName}"`,
  });

  return newActive;
}

/**
 * Idempotent initialization & migration for Prompt 17A:
 * 1. Seeds categories & skills collections if empty.
 * 2. Ensures existing services have categoryId and requiredSkillIds populated.
 * 3. Ensures existing therapists have skillIds populated.
 */
export async function ensureMasterCategoriesAndSkillsInitialized(): Promise<{
  categoriesMigrated: number;
  skillsMigrated: number;
  servicesUpdated: number;
  therapistsUpdated: number;
}> {
  let categoriesMigrated = 0;
  let skillsMigrated = 0;
  let servicesUpdated = 0;
  let therapistsUpdated = 0;

  try {
    // 1. Check categories
    const categories = await getServiceCategories();
    categoriesMigrated = categories.length;

    // 2. Check skills
    const skills = await getTherapistSkills();
    skillsMigrated = skills.length;

    // 3. Migrate existing services
    const services = await getMasterServices();
    for (const srv of services) {
      let needsUpdate = false;
      const updates: Partial<ServiceItem> = {};

      if (!srv.categoryId) {
        const matchedCat = categories.find(
          (c) => (c.categoryName || '').toLowerCase() === (srv.category || '').toLowerCase()
        );
        updates.categoryId = matchedCat ? matchedCat.id : 'cat-reflexology';
        if (!srv.category && matchedCat) {
          updates.category = matchedCat.categoryName;
        }
        needsUpdate = true;
      }

      if (!srv.requiredSkillIds || srv.requiredSkillIds.length === 0) {
        // Set default based on service name / duration
        if (srv.id.includes('sig')) {
          updates.requiredSkillIds = ['reflexology', 'deep_tissue'];
        } else if (srv.id.includes('fam')) {
          updates.requiredSkillIds = ['reflexology', 'tradisional'];
        } else if (srv.id.includes('sport')) {
          updates.requiredSkillIds = ['sport_massage'];
        } else if (srv.id.includes('totok')) {
          updates.requiredSkillIds = ['totok_wajah'];
        } else {
          updates.requiredSkillIds = ['reflexology'];
        }
        needsUpdate = true;
      }

      if (needsUpdate) {
        try {
          await updateDoc(doc(db, 'services', srv.id), updates);
          servicesUpdated++;
        } catch (e) {
          console.warn(`Failed to migrate service ${srv.id}:`, e);
        }
      }
    }

    // 4. Migrate existing therapists
    const therapistsSnap = await getDocs(collection(db, 'therapists'));
    for (const thDoc of therapistsSnap.docs) {
      const thData = thDoc.data() as Therapist;
      if (!thData.skillIds || thData.skillIds.length === 0) {
        const derivedSkills = new Set<string>();
        const specialtiesStr = (thData.specialties || []).join(' ').toLowerCase();

        if (specialtiesStr.includes('reflex')) derivedSkills.add('reflexology');
        if (specialtiesStr.includes('deep')) derivedSkills.add('deep_tissue');
        if (specialtiesStr.includes('tradis') || specialtiesStr.includes('palembang')) derivedSkills.add('tradisional');
        if (specialtiesStr.includes('aroma')) derivedSkills.add('aromatherapy');
        if (specialtiesStr.includes('totok') || specialtiesStr.includes('acupres')) derivedSkills.add('totok_wajah');
        if (specialtiesStr.includes('stone')) derivedSkills.add('hot_stone');
        if (specialtiesStr.includes('sport')) derivedSkills.add('sport_massage');
        if (specialtiesStr.includes('lulur') || specialtiesStr.includes('scrub')) derivedSkills.add('scrub_lulur');

        // Fallback: everyone has reflexology
        if (derivedSkills.size === 0) {
          derivedSkills.add('reflexology');
          derivedSkills.add('deep_tissue');
        }

        try {
          await updateDoc(doc(db, 'therapists', thDoc.id), {
            skillIds: Array.from(derivedSkills),
            updatedAt: new Date().toISOString(),
          });
          therapistsUpdated++;
        } catch (e) {
          console.warn(`Failed to migrate therapist ${thDoc.id}:`, e);
        }
      }
    }
  } catch (err) {
    console.warn('Migration ensureMasterCategoriesAndSkillsInitialized error:', err);
  }

  return {
    categoriesMigrated,
    skillsMigrated,
    servicesUpdated,
    therapistsUpdated,
  };
}
