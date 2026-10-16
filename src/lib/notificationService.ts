import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  writeBatch,
  limit,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  NotificationEvent,
  NotificationEventType,
  NotificationRecipientRole,
  InAppNotification,
  NotificationDelivery,
  AdminNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationDevice,
} from '../types/notification';
import { cleanFirestoreData } from './utils';

const SETTINGS_DOC_ID = 'default';

interface AuthenticatedActorSnapshot {
  uid: string;
  idToken: string;
}

type CanonicalStaffRole = 'admin' | 'manager' | 'supervisor' | 'css' | 'therapist';

function normalizeTrimmedString(value: unknown, maxLen = 256): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function normalizeRecipientRole(value: unknown): NotificationRecipientRole | '' {
  const raw = normalizeTrimmedString(value, 64).toLowerCase();
  if (raw === 'admin') return 'admin';
  if (raw === 'manager') return 'manager';
  if (raw === 'supervisor') return 'supervisor';
  if (raw === 'css') return 'css';
  if (raw === 'therapist') return 'therapist';
  if (raw === 'customer') return 'customer';
  return '';
}

function isStaffStatusDisabled(value: unknown): boolean {
  const status = normalizeTrimmedString(value, 64).toUpperCase();
  return [
    'INACTIVE',
    'DISABLED',
    'ARCHIVED',
    'DINONAKTIFKAN',
    'DELETED',
    'TERMINATED',
  ].includes(status);
}

function isStaffRecordActive(data: Record<string, any> | undefined | null): boolean {
  if (!data || typeof data !== 'object') return false;
  if (data.isActive === false || data.loginEnabled === false) return false;
  if (isStaffStatusDisabled(data.status)) return false;
  if (normalizeTrimmedString(data.loginAccountStatus, 64).toUpperCase() === 'DINONAKTIFKAN') {
    return false;
  }
  return true;
}

async function getAuthenticatedActorSnapshot(): Promise<AuthenticatedActorSnapshot> {
  const currentUser = auth?.currentUser;
  const uid = normalizeTrimmedString(currentUser?.uid, 128);
  if (!currentUser || !uid || typeof currentUser.getIdToken !== 'function') {
    throw Object.assign(new Error('Autentikasi diperlukan untuk operasi notifikasi.'), {
      code: 'AUTH_REQUIRED',
    });
  }

  let idToken = '';
  try {
    const rawToken = await currentUser.getIdToken();
    idToken = normalizeTrimmedString(rawToken, 8192);
  } catch {
    throw Object.assign(new Error('Gagal mengambil token autentikasi.'), {
      code: 'AUTH_TOKEN_UNAVAILABLE',
    });
  }

  if (!idToken) {
    throw Object.assign(new Error('Token autentikasi tidak tersedia.'), {
      code: 'AUTH_TOKEN_UNAVAILABLE',
    });
  }

  const activeUserAfterToken = auth?.currentUser;
  if (!activeUserAfterToken || normalizeTrimmedString(activeUserAfterToken.uid, 128) !== uid) {
    throw Object.assign(new Error('Sesi autentikasi berubah saat memproses notifikasi.'), {
      code: 'SESSION_CHANGED',
    });
  }

  return { uid, idToken };
}

function ensureSessionUnchanged(initialUid: string): void {
  const currentUid = normalizeTrimmedString(auth?.currentUser?.uid, 128);
  if (!currentUid || currentUid !== initialUid) {
    throw Object.assign(new Error('Sesi autentikasi berubah saat memproses notifikasi.'), {
      code: 'SESSION_CHANGED',
    });
  }
}

interface VerifiedCallerContext {
  uid: string;
  isStaff: boolean;
  staffRole?: CanonicalStaffRole;
  staffMasterId?: string;
  therapistIds: Set<string>;
  customerIds: Set<string>;
}

async function resolveVerifiedCallerContext(uid: string): Promise<VerifiedCallerContext> {
  const therapistIds = new Set<string>();
  const customerIds = new Set<string>([uid]);
  let isStaff = false;
  let staffRole: CanonicalStaffRole | undefined;
  let staffMasterId: string | undefined;

  try {
    const roleSnap = await getDoc(doc(db, 'staff_roles', uid));
    if (roleSnap.exists()) {
      const roleData = roleSnap.data() as Record<string, any>;
      const roleAuthUid = normalizeTrimmedString(
        roleData.authUserId || roleData.authUid,
        128
      );
      const roleMatchesUid = !roleAuthUid || roleAuthUid === uid;
      if (roleMatchesUid && roleData.isActive === true && isStaffRecordActive(roleData)) {
        const candidateMasterId =
          normalizeTrimmedString(roleData.staffId, 128) ||
          normalizeTrimmedString(roleData.staffUserId, 128) ||
          uid;
        const masterSnap = await getDoc(doc(db, 'staff_users', candidateMasterId));
        if (masterSnap.exists()) {
          const masterData = masterSnap.data() as Record<string, any>;
          const masterAuthUid = normalizeTrimmedString(
            masterData.authUserId || masterData.authUid,
            128
          );
          const masterMatchesUid =
            masterAuthUid === uid || candidateMasterId === uid;
          const roleStr = normalizeRecipientRole(roleData.role);
          const masterRoleStr = normalizeRecipientRole(masterData.role);
          if (
            masterMatchesUid &&
            isStaffRecordActive(masterData) &&
            roleStr &&
            roleStr !== 'customer' &&
            roleStr === masterRoleStr
          ) {
            isStaff = true;
            staffRole = roleStr as CanonicalStaffRole;
            staffMasterId = candidateMasterId;
            if (staffRole === 'therapist') {
              therapistIds.add(uid);
              therapistIds.add(candidateMasterId);
              for (const candidate of [
                roleData.therapistId,
                roleData.staffId,
                roleData.staffUserId,
                masterData.therapistId,
                masterData.id,
                masterData.uid,
              ]) {
                const clean = normalizeTrimmedString(candidate, 128);
                if (clean) therapistIds.add(clean);
              }
            }
          }
        }
      }
    }
  } catch {
    // Non-staff or restricted read
  }

  try {
    const custSnap = await getDoc(doc(db, 'customers', uid));
    if (custSnap.exists()) {
      const custData = custSnap.data() as Record<string, any>;
      const ownerUid = normalizeTrimmedString(
        custData.authUserId || custData.customerAuthUid,
        128
      );
      if (!ownerUid || ownerUid === uid) {
        customerIds.add(uid);
        const cid = normalizeTrimmedString(custData.id || custData.customerId, 128);
        if (cid) customerIds.add(cid);
      }
    }
  } catch {
    // Ignore
  }

  return {
    uid,
    isStaff,
    staffRole,
    staffMasterId,
    therapistIds,
    customerIds,
  };
}

async function isCallerAuthorizedForNotificationDoc(
  notifData: Record<string, any> | undefined | null,
  ctx: VerifiedCallerContext
): Promise<boolean> {
  if (!notifData || typeof notifData !== 'object') return false;
  const recRole =
    normalizeRecipientRole(notifData.recipientRole) ||
    normalizeRecipientRole(notifData.targetRole);
  const recId = normalizeTrimmedString(notifData.recipientId, 128);
  const recUserId = normalizeTrimmedString(notifData.recipientUserId, 128);

  if (ctx.isStaff && ctx.staffRole) {
    if (ctx.staffRole === 'admin' || ctx.staffRole === 'manager') {
      if (
        ['admin', 'manager', 'supervisor', 'css'].includes(recRole) ||
        ['admin', 'manager', 'supervisor', 'css', ctx.uid, ctx.staffMasterId || ''].includes(recId) ||
        recUserId === ctx.uid
      ) {
        return true;
      }
    }
    if (ctx.staffRole === 'supervisor') {
      if (
        recRole === 'supervisor' ||
        ['supervisor', ctx.uid, ctx.staffMasterId || ''].includes(recId) ||
        recUserId === ctx.uid
      ) {
        return true;
      }
    }
    if (ctx.staffRole === 'css') {
      if (
        ['css', 'supervisor'].includes(recRole) ||
        ['css', ctx.uid, ctx.staffMasterId || ''].includes(recId) ||
        recUserId === ctx.uid
      ) {
        return true;
      }
    }
    if (ctx.staffRole === 'therapist' && recRole === 'therapist') {
      for (const field of [
        notifData.recipientId,
        notifData.recipientUserId,
        notifData.therapistId,
        notifData.targetUserId,
      ]) {
        const clean = normalizeTrimmedString(field, 128);
        if (clean && ctx.therapistIds.has(clean)) {
          return true;
        }
      }
      return false;
    }
  }

  if (recRole === 'customer') {
    const docCustomerAuthUid = normalizeTrimmedString(notifData.customerAuthUid, 128);
    const docAuthUserId = normalizeTrimmedString(notifData.authUserId, 128);
    if (docCustomerAuthUid && docAuthUserId && docCustomerAuthUid !== docAuthUserId) {
      return false;
    }
    if (docCustomerAuthUid || docAuthUserId) {
      const canonicalUid = docCustomerAuthUid || docAuthUserId;
      return canonicalUid === ctx.uid;
    }

    if (recUserId === ctx.uid || recId === ctx.uid) {
      return true;
    }

    const docCustomerId = normalizeTrimmedString(notifData.customerId || recId, 128);
    if (docCustomerId) {
      if (ctx.customerIds.has(docCustomerId)) return true;
      try {
        const cSnap = await getDoc(doc(db, 'customers', docCustomerId));
        if (cSnap.exists()) {
          const cData = cSnap.data() as Record<string, any>;
          const cAuthUid = normalizeTrimmedString(cData.authUserId, 128);
          const cCustAuthUid = normalizeTrimmedString(cData.customerAuthUid, 128);
          if (cAuthUid && cCustAuthUid && cAuthUid !== cCustAuthUid) return false;
          if ((cAuthUid || cCustAuthUid) === ctx.uid) {
            ctx.customerIds.add(docCustomerId);
            return true;
          }
        }
      } catch {
        // Ignore
      }
    }

    const bookingId = normalizeTrimmedString(notifData.bookingId, 128);
    if (bookingId) {
      try {
        const bSnap = await getDoc(doc(db, 'bookings', bookingId));
        if (bSnap.exists()) {
          const bData = bSnap.data() as Record<string, any>;
          const bCustAuthUid = normalizeTrimmedString(bData.customerAuthUid, 128);
          const bAuthUserId = normalizeTrimmedString(bData.authUserId, 128);
          if (bCustAuthUid && bAuthUserId && bCustAuthUid !== bAuthUserId) return false;
          if (bCustAuthUid || bAuthUserId) {
            return (bCustAuthUid || bAuthUserId) === ctx.uid;
          }
          const bCustomerId = normalizeTrimmedString(bData.customerId, 128);
          if (bCustomerId && ctx.customerIds.has(bCustomerId)) {
            return true;
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  return false;
}

// ============================================================================
// 1. NOTIFICATION SETTINGS MANAGEMENT
// ============================================================================

export async function getNotificationSettings(): Promise<AdminNotificationSettings> {
  try {
    const ref = doc(db, 'notification_settings', SETTINGS_DOC_ID);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        ...(snap.data() as Partial<AdminNotificationSettings>),
      };
    }
    return DEFAULT_NOTIFICATION_SETTINGS;
  } catch (err) {
    console.warn('Failed to fetch notification settings, using default:', err);
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export async function saveNotificationSettings(
  settings: Partial<AdminNotificationSettings>,
  updatedBy = 'admin'
): Promise<AdminNotificationSettings> {
  const current = await getNotificationSettings();
  const merged: AdminNotificationSettings & { updatedBy?: string } = {
    ...current,
    ...settings,
    id: SETTINGS_DOC_ID,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await setDoc(doc(db, 'notification_settings', SETTINGS_DOC_ID), cleanFirestoreData(merged), {
    merge: true,
  });
  return merged;
}

// ============================================================================
// 2. DEVICE TOKEN MANAGEMENT (PWA / FCM)
// ============================================================================

export async function registerDeviceToken(device: {
  userId: string;
  role: NotificationRecipientRole;
  token: string;
  platform?: 'web' | 'pwa' | 'ios_pwa' | 'android_web';
  browser?: string;
  deviceName?: string;
}): Promise<NotificationDevice> {
  const actor = await getAuthenticatedActorSnapshot();
  const role = normalizeRecipientRole(device?.role);
  const rawToken = normalizeTrimmedString(device?.token, 4096);
  const requestedUserId = normalizeTrimmedString(device?.userId, 128);
  const platform: NotificationDevice['platform'] =
    device?.platform === 'ios_pwa' ||
    device?.platform === 'android_web' ||
    device?.platform === 'web'
      ? device.platform
      : 'pwa';

  if (!role) {
    throw Object.assign(new Error('Role penerima perangkat tidak valid.'), {
      code: 'INVALID_DEVICE_ROLE',
    });
  }
  if (!rawToken || rawToken.length < 10) {
    throw Object.assign(new Error('Token perangkat push tidak valid.'), {
      code: 'INVALID_DEVICE_TOKEN',
    });
  }
  if (!requestedUserId || requestedUserId.toLowerCase() === 'guest') {
    throw Object.assign(new Error('Identitas pemilik perangkat wajib terautentikasi.'), {
      code: 'INVALID_DEVICE_OWNER',
    });
  }

  let serverHandled = false;
  let serverRecord: NotificationDevice | null = null;
  try {
    const res = await fetch('/api/notifications/devices/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actor.idToken}`,
      },
      body: JSON.stringify({
        userId: requestedUserId,
        role,
        token: rawToken,
        platform,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    });

    ensureSessionUnchanged(actor.uid);

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (res.ok && body?.success === true && body?.device && typeof body.device.id === 'string') {
      serverHandled = true;
      serverRecord = body.device as NotificationDevice;
    } else if (body && typeof body.code === 'string') {
      throw Object.assign(
        new Error(body.error || body.message || 'Registrasi perangkat ditolak oleh server.'),
        { code: body.code, status: res.status }
      );
    }
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code !== 'NETWORK_ERROR') {
      throw err;
    }
  }

  if (serverHandled && serverRecord) {
    return serverRecord;
  }

  ensureSessionUnchanged(actor.uid);
  const ctx = await resolveVerifiedCallerContext(actor.uid);
  ensureSessionUnchanged(actor.uid);

  let canonicalUserId = requestedUserId;
  if (role === 'admin' || role === 'manager') {
    if (!ctx.isStaff || (ctx.staffRole !== 'admin' && ctx.staffRole !== 'manager')) {
      throw Object.assign(new Error('Hanya Manager/Admin aktif yang dapat mendaftarkan perangkat role ini.'), {
        code: 'FORBIDDEN_DEVICE_ROLE',
      });
    }
    if (!['admin', 'manager', actor.uid, ctx.staffMasterId || ''].includes(requestedUserId)) {
      throw Object.assign(new Error('Identitas pemilik perangkat tidak sesuai.'), {
        code: 'FORBIDDEN_DEVICE_OWNER',
      });
    }
  } else if (role === 'supervisor') {
    if (!ctx.isStaff || !['supervisor', 'manager', 'admin'].includes(ctx.staffRole || '')) {
      throw Object.assign(new Error('Hanya Supervisor aktif yang dapat mendaftarkan perangkat role ini.'), {
        code: 'FORBIDDEN_DEVICE_ROLE',
      });
    }
    if (!['supervisor', actor.uid, ctx.staffMasterId || ''].includes(requestedUserId)) {
      throw Object.assign(new Error('Identitas pemilik perangkat tidak sesuai.'), {
        code: 'FORBIDDEN_DEVICE_OWNER',
      });
    }
  } else if (role === 'css') {
    if (!ctx.isStaff || !['css', 'manager', 'admin'].includes(ctx.staffRole || '')) {
      throw Object.assign(new Error('Hanya CSS aktif yang dapat mendaftarkan perangkat role ini.'), {
        code: 'FORBIDDEN_DEVICE_ROLE',
      });
    }
    if (!['css', actor.uid, ctx.staffMasterId || ''].includes(requestedUserId)) {
      throw Object.assign(new Error('Identitas pemilik perangkat tidak sesuai.'), {
        code: 'FORBIDDEN_DEVICE_OWNER',
      });
    }
  } else if (role === 'therapist') {
    if (!ctx.isStaff || ctx.staffRole !== 'therapist' || !ctx.therapistIds.has(requestedUserId)) {
      throw Object.assign(new Error('Terapis hanya dapat mendaftarkan perangkat miliknya sendiri.'), {
        code: 'FORBIDDEN_DEVICE_OWNER',
      });
    }
  } else if (role === 'customer') {
    let customerOwned = requestedUserId === actor.uid || ctx.customerIds.has(requestedUserId);
    if (!customerOwned) {
      const custSnap = await getDoc(doc(db, 'customers', requestedUserId));
      if (custSnap.exists()) {
        const cData = custSnap.data() as Record<string, any>;
        const cAuthUid = normalizeTrimmedString(cData.authUserId, 128);
        const cCustAuthUid = normalizeTrimmedString(cData.customerAuthUid, 128);
        if ((!cAuthUid || !cCustAuthUid || cAuthUid === cCustAuthUid) && (cAuthUid || cCustAuthUid) === actor.uid) {
          customerOwned = true;
        }
      }
    }
    if (!customerOwned) {
      throw Object.assign(new Error('Pelanggan hanya dapat mendaftarkan perangkat miliknya sendiri.'), {
        code: 'FORBIDDEN_DEVICE_OWNER',
      });
    }
  }

  const safeTokenKey = rawToken.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  const id = `dev_${role}_${canonicalUserId}_${safeTokenKey}`;
  const existingSnap = await getDoc(doc(db, 'notification_devices', id));
  if (existingSnap.exists()) {
    const existingData = existingSnap.data() as Record<string, any>;
    const existingAuthUid = normalizeTrimmedString(existingData.authUid, 128);
    if (existingAuthUid && existingAuthUid !== actor.uid) {
      throw Object.assign(new Error('Perangkat telah terdaftar pada akun lain.'), {
        code: 'DEVICE_OWNERSHIP_CONFLICT',
      });
    }
  }

  const now = new Date().toISOString();
  const record: NotificationDevice & { authUid: string } = {
    id,
    userId: canonicalUserId,
    role,
    token: rawToken,
    platform,
    browser:
      device.browser ||
      (typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'),
    deviceName: device.deviceName || 'Browser Device',
    enabled: true,
    authUid: actor.uid,
    createdAt: existingSnap.exists()
      ? normalizeTrimmedString((existingSnap.data() as any)?.createdAt, 64) || now
      : now,
    lastSeenAt: now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'notification_devices', id), cleanFirestoreData(record), { merge: true });
  return record;
}

export async function getRegisteredDevices(
  role?: NotificationRecipientRole,
  userId?: string
): Promise<NotificationDevice[]> {
  try {
    const snap = await getDocs(collection(db, 'notification_devices'));
    let list = snap.docs.map((d) => d.data() as NotificationDevice);
    if (role) {
      list = list.filter((d) => d.role === role);
    }
    if (userId) {
      list = list.filter((d) => d.userId === userId);
    }
    return list;
  } catch (err) {
    console.warn('Error fetching registered devices:', err);
    return [];
  }
}

// ============================================================================
// 3. CENTRAL EVENT DISPATCHER (emitEvent) — SERVER AUTHORITATIVE
// ============================================================================

export async function emitEvent(
  eventType: NotificationEventType | string,
  payload: Record<string, any>,
  actorOrTargetRoles?:
    | { id?: string; name?: string; role?: string }
    | NotificationRecipientRole[],
  idempotencyKey?: string
): Promise<NotificationEvent | null> {
  const normalizedEventType = normalizeTrimmedString(eventType, 128);
  if (!normalizedEventType) {
    throw Object.assign(new Error('Tipe event notifikasi wajib diisi.'), {
      code: 'INVALID_EVENT_TYPE',
    });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Payload notifikasi tidak valid.'), {
      code: 'INVALID_EVENT_PAYLOAD',
    });
  }

  const actorSnapshot = await getAuthenticatedActorSnapshot();

  const isTargetRolesArray = Array.isArray(actorOrTargetRoles);
  const actorMeta =
    !isTargetRolesArray && actorOrTargetRoles && typeof actorOrTargetRoles === 'object'
      ? actorOrTargetRoles
      : undefined;
  const requestedRoles = isTargetRolesArray
    ? actorOrTargetRoles
        .map((r) => normalizeRecipientRole(r))
        .filter((r): r is NotificationRecipientRole => Boolean(r))
    : undefined;

  let res: Response;
  try {
    res = await fetch('/api/notifications/emit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actorSnapshot.idToken}`,
      },
      body: JSON.stringify({
        eventType: normalizedEventType,
        payload,
        actor: actorMeta,
        targetRoles: requestedRoles,
        idempotencyKey: normalizeTrimmedString(idempotencyKey, 200) || undefined,
      }),
    });
  } catch {
    throw Object.assign(new Error('Gagal menghubungi server notifikasi.'), {
      code: 'NETWORK_ERROR',
    });
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw Object.assign(new Error('Respons server notifikasi tidak valid.'), {
      code: 'MALFORMED_RESPONSE',
      status: res?.status,
    });
  }

  ensureSessionUnchanged(actorSnapshot.uid);

  if (!res.ok || !body || body.success !== true || !body.event || typeof body.event.id !== 'string') {
    const errCode =
      typeof body?.code === 'string' && body.code.trim()
        ? body.code.trim()
        : !res.ok
          ? `HTTP_${res.status}`
          : 'NOTIFICATION_EMIT_REJECTED';
    const errMsg =
      typeof body?.error === 'string' && body.error.trim()
        ? body.error.trim()
        : typeof body?.message === 'string' && body.message.trim()
          ? body.message.trim()
          : 'Pengiriman event notifikasi ditolak oleh server.';
    throw Object.assign(new Error(errMsg), {
      code: errCode,
      status: res.status,
    });
  }

  return body.event as NotificationEvent;
}

// ============================================================================
// 4. REALTIME SUBSCRIPTIONS & QUERIES FOR IN-APP NOTIFICATION CENTER
// ============================================================================

export interface NotificationSubscriptionFilterOptions {
  recipientId?: string;
  therapistId?: string;
  customerId?: string;
  customerAuthUid?: string;
  bookingId?: string;
  bookingCode?: string;
}

function matchesNotificationForStaffSubscriber(
  n: InAppNotification & Record<string, any>,
  role: NotificationRecipientRole,
  canonicalId: string,
  extraIds?: Set<string>
): boolean {
  const docRole =
    normalizeRecipientRole(n.recipientRole) || normalizeRecipientRole((n as any).targetRole);
  if (docRole !== role) return false;

  if (role === 'therapist') {
    const allowedIds = new Set<string>();
    if (canonicalId) allowedIds.add(canonicalId);
    if (extraIds) {
      extraIds.forEach((id) => {
        if (id) allowedIds.add(id);
      });
    }
    if (allowedIds.size === 0) return false;

    const candidates = [
      n.recipientId,
      n.recipientUserId,
      n.therapistId,
      (n as any).targetUserId,
    ]
      .map((v) => normalizeTrimmedString(v, 128))
      .filter(Boolean);

    if (candidates.length === 0) return false;
    return candidates.some((c) => allowedIds.has(c));
  }

  if (role === 'supervisor' || role === 'manager' || role === 'admin' || role === 'css') {
    const recId = normalizeTrimmedString(n.recipientId, 128);
    const recUserId = normalizeTrimmedString(n.recipientUserId, 128);
    if (!recId && !recUserId) return true;
    const allowed = new Set<string>([role]);
    if (role === 'admin' || role === 'manager') {
      allowed.add('admin');
      allowed.add('manager');
    }
    if (canonicalId) allowed.add(canonicalId);
    if (extraIds) {
      extraIds.forEach((id) => {
        if (id) allowed.add(id);
      });
    }
    return (recId && allowed.has(recId)) || (recUserId && allowed.has(recUserId));
  }

  return false;
}

function matchesNotificationForCustomerSubscriber(
  n: InAppNotification & Record<string, any>,
  customerId: string,
  customerAuthUid: string,
  bookingId?: string,
  bookingCode?: string
): boolean {
  const docRole =
    normalizeRecipientRole(n.recipientRole) || normalizeRecipientRole((n as any).targetRole);
  if (docRole !== 'customer') return false;

  if (!customerId && !customerAuthUid) {
    return false;
  }

  const docCustAuthUid = normalizeTrimmedString((n as any).customerAuthUid, 128);
  const docAuthUserId = normalizeTrimmedString((n as any).authUserId, 128);
  if (docCustAuthUid && docAuthUserId && docCustAuthUid !== docAuthUserId) {
    return false;
  }

  if (docCustAuthUid || docAuthUserId) {
    const canonicalOwnerUid = docCustAuthUid || docAuthUserId;
    if (!customerAuthUid || canonicalOwnerUid !== customerAuthUid) {
      return false;
    }
  } else {
    const allowedIds = new Set<string>();
    if (customerId) allowedIds.add(customerId);
    if (customerAuthUid) allowedIds.add(customerAuthUid);
    const candidates = [n.customerId, n.recipientId, n.recipientUserId]
      .map((v) => normalizeTrimmedString(v, 128))
      .filter(Boolean);
    if (candidates.length === 0 || !candidates.some((c) => allowedIds.has(c))) {
      return false;
    }
  }

  if (bookingId) {
    const docBookingId = normalizeTrimmedString(n.bookingId, 128);
    if (docBookingId && docBookingId !== bookingId) return false;
  }
  if (bookingCode) {
    const docBookingCode = normalizeTrimmedString(n.bookingCode, 128).toUpperCase();
    if (docBookingCode && docBookingCode !== bookingCode.toUpperCase()) return false;
  }

  return true;
}

/**
 * Subscribe to notifications for a specific role & user ID.
 * Supports both `(role, userId, callback)` and `(role, callback, options)`.
 */
export function subscribeToRoleNotifications(
  role: NotificationRecipientRole,
  userIdOrCallback?: string | ((notifications: InAppNotification[]) => void),
  callbackOrOptions?:
    | ((notifications: InAppNotification[]) => void)
    | NotificationSubscriptionFilterOptions
): () => void {
  const callback =
    typeof userIdOrCallback === 'function'
      ? userIdOrCallback
      : typeof callbackOrOptions === 'function'
        ? callbackOrOptions
        : () => {};

  const options: NotificationSubscriptionFilterOptions =
    typeof userIdOrCallback === 'function'
      ? (callbackOrOptions as NotificationSubscriptionFilterOptions) || {}
      : {
          recipientId: typeof userIdOrCallback === 'string' ? userIdOrCallback : undefined,
        };

  const normalizedRole = normalizeRecipientRole(role);
  if (!normalizedRole) {
    callback([]);
    return () => {};
  }

  if (normalizedRole === 'customer') {
    const cid = normalizeTrimmedString(
      options.customerId || options.recipientId,
      128
    );
    const cuid = normalizeTrimmedString(
      options.customerAuthUid || auth?.currentUser?.uid,
      128
    );
    return subscribeToCustomerNotifications(
      {
        customerId: cid,
        customerAuthUid: cuid,
        bookingId: options.bookingId,
        bookingCode: options.bookingCode,
      },
      callback
    );
  }

  const currentAuthUid = normalizeTrimmedString(auth?.currentUser?.uid, 128);
  const canonicalId = normalizeTrimmedString(
    normalizedRole === 'therapist'
      ? options.therapistId || options.recipientId
      : options.recipientId || normalizedRole,
    128
  );

  if (
    normalizedRole === 'therapist' &&
    (!canonicalId || canonicalId === 'therapist' || canonicalId === 'user' || canonicalId === 'guest')
  ) {
    callback([]);
    return () => {};
  }

  const extraIds = new Set<string>();
  if (canonicalId) extraIds.add(canonicalId);
  if (options.therapistId) extraIds.add(normalizeTrimmedString(options.therapistId, 128));
  if (options.recipientId) extraIds.add(normalizeTrimmedString(options.recipientId, 128));
  if (currentAuthUid) extraIds.add(currentAuthUid);

  const q =
    normalizedRole === 'therapist'
      ? query(
          collection(db, 'notifications'),
          where('recipientRole', '==', 'therapist'),
          where('recipientId', '==', canonicalId),
          limit(150)
        )
      : query(
          collection(db, 'notifications'),
          where('recipientRole', '==', normalizedRole),
          limit(150)
        );

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as InAppNotification & Record<string, any>)
        .filter((n) =>
          matchesNotificationForStaffSubscriber(n, normalizedRole, canonicalId, extraIds)
        );

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(items);
    },
    (err) => {
      console.warn('Notification subscription error:', err);
      callback([]);
    }
  );
}

/**
 * Subscribe to notifications for a specific customer (strictly scoped by authenticated customer identity, never bookingCode-only).
 */
export function subscribeToCustomerNotifications(
  customerFilterOrIdentifier:
    | string
    | {
        customerId?: string;
        customerAuthUid?: string;
        bookingId?: string;
        bookingCode?: string;
      },
  callback: (notifications: InAppNotification[]) => void
): () => void {
  const currentAuthUid = normalizeTrimmedString(auth?.currentUser?.uid, 128);
  let customerId = '';
  let customerAuthUid = currentAuthUid;
  let bookingId = '';
  let bookingCode = '';

  if (typeof customerFilterOrIdentifier === 'string') {
    const clean = normalizeTrimmedString(customerFilterOrIdentifier, 128);
    if (!clean) {
      callback([]);
      return () => {};
    }
    const looksLikeBookingCode = /^SH-[0-9-]+$/i.test(clean);
    if (looksLikeBookingCode) {
      bookingCode = clean;
      customerId = currentAuthUid;
    } else {
      customerId = clean;
      if (!customerAuthUid) {
        customerAuthUid = clean;
      }
    }
  } else if (customerFilterOrIdentifier && typeof customerFilterOrIdentifier === 'object') {
    customerId = normalizeTrimmedString(customerFilterOrIdentifier.customerId, 128);
    customerAuthUid =
      normalizeTrimmedString(customerFilterOrIdentifier.customerAuthUid, 128) || currentAuthUid;
    bookingId = normalizeTrimmedString(customerFilterOrIdentifier.bookingId, 128);
    bookingCode = normalizeTrimmedString(customerFilterOrIdentifier.bookingCode, 128);
  }

  // Never allow unauthenticated or bookingCode-only customer notification subscriptions
  if (!customerId && !customerAuthUid) {
    callback([]);
    return () => {};
  }
  if (currentAuthUid && customerAuthUid && currentAuthUid !== customerAuthUid) {
    callback([]);
    return () => {};
  }

  const effectiveCustomerId = customerId || customerAuthUid;
  const q = query(
    collection(db, 'notifications'),
    where('recipientRole', '==', 'customer'),
    where('recipientId', '==', effectiveCustomerId),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as InAppNotification & Record<string, any>)
        .filter((n) =>
          matchesNotificationForCustomerSubscriber(
            n,
            effectiveCustomerId,
            customerAuthUid,
            bookingId || undefined,
            bookingCode || undefined
          )
        );
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(list);
    },
    (err) => {
      console.warn('Customer notification subscription error:', err);
      callback([]);
    }
  );
}

/**
 * Mark a single notification as read (verified recipient only, read/readAt fields only)
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const cleanId = normalizeTrimmedString(notificationId, 160);
  if (!cleanId) {
    throw Object.assign(new Error('ID notifikasi wajib diisi.'), {
      code: 'INVALID_NOTIFICATION_ID',
    });
  }

  const actor = await getAuthenticatedActorSnapshot();

  let serverHandled = false;
  try {
    const res = await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actor.idToken}`,
      },
      body: JSON.stringify({ notificationId: cleanId }),
    });
    ensureSessionUnchanged(actor.uid);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && body?.success === true) {
      serverHandled = true;
    } else if (body && typeof body.code === 'string') {
      throw Object.assign(
        new Error(body.error || body.message || 'Gagal menandai notifikasi telah dibaca.'),
        { code: body.code, status: res.status }
      );
    }
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code !== 'NETWORK_ERROR') {
      throw err;
    }
  }

  if (serverHandled) return;

  ensureSessionUnchanged(actor.uid);
  const ctx = await resolveVerifiedCallerContext(actor.uid);
  const notifRef = doc(db, 'notifications', cleanId);
  const snap = await getDoc(notifRef);
  if (!snap.exists()) {
    throw Object.assign(new Error('Notifikasi tidak ditemukan.'), {
      code: 'NOTIFICATION_NOT_FOUND',
    });
  }

  const data = snap.data() as Record<string, any>;
  const authorized = await isCallerAuthorizedForNotificationDoc(data, ctx);
  if (!authorized) {
    throw Object.assign(new Error('Anda tidak memiliki akses ke notifikasi ini.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }

  await updateDoc(notifRef, {
    read: true,
    readAt: new Date().toISOString(),
  });
}

/**
 * Mark all notifications for a role/recipient as read (scoped to caller's authorized notifications)
 */
export async function markAllNotificationsAsRead(
  role: NotificationRecipientRole,
  userId?: string
): Promise<void> {
  const targetRole = normalizeRecipientRole(role);
  if (!targetRole) {
    throw Object.assign(new Error('Role notifikasi tidak valid.'), {
      code: 'INVALID_RECIPIENT_ROLE',
    });
  }

  const actor = await getAuthenticatedActorSnapshot();
  const cleanUserId = normalizeTrimmedString(userId, 128);

  let serverHandled = false;
  try {
    const res = await fetch('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actor.idToken}`,
      },
      body: JSON.stringify({
        role: targetRole,
        userId: cleanUserId || undefined,
      }),
    });
    ensureSessionUnchanged(actor.uid);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && body?.success === true) {
      serverHandled = true;
    } else if (body && typeof body.code === 'string') {
      throw Object.assign(
        new Error(body.error || body.message || 'Gagal menandai semua notifikasi.'),
        { code: body.code, status: res.status }
      );
    }
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code !== 'NETWORK_ERROR') {
      throw err;
    }
  }

  if (serverHandled) return;

  ensureSessionUnchanged(actor.uid);
  const ctx = await resolveVerifiedCallerContext(actor.uid);
  if (targetRole === 'therapist' && (!ctx.isStaff || ctx.staffRole !== 'therapist')) {
    throw Object.assign(new Error('Akses notifikasi terapis ditolak.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }
  if (
    targetRole === 'therapist' &&
    cleanUserId &&
    !ctx.therapistIds.has(cleanUserId)
  ) {
    throw Object.assign(new Error('Tidak dapat memodifikasi notifikasi terapis lain.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }
  if (
    ['admin', 'manager', 'supervisor', 'css'].includes(targetRole) &&
    !ctx.isStaff
  ) {
    throw Object.assign(new Error('Akses notifikasi staf ditolak.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }

  const q = query(
    collection(db, 'notifications'),
    where('recipientRole', '==', targetRole),
    where('read', '==', false)
  );
  const snap = await getDocs(q);
  if (snap.empty) return;

  const batch = writeBatch(db);
  const now = new Date().toISOString();
  let count = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, any>;
    if (cleanUserId) {
      const candidates = [
        data.recipientId,
        data.recipientUserId,
        data.therapistId,
        data.customerId,
      ]
        .map((v) => normalizeTrimmedString(v, 128))
        .filter(Boolean);
      if (
        (targetRole === 'therapist' || targetRole === 'customer') &&
        !candidates.includes(cleanUserId)
      ) {
        continue;
      }
    }
    const authorized = await isCallerAuthorizedForNotificationDoc(data, ctx);
    if (!authorized) continue;

    batch.update(docSnap.ref, { read: true, readAt: now });
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }
}

/**
 * Delete a single notification (verified recipient only)
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  const cleanId = normalizeTrimmedString(notificationId, 160);
  if (!cleanId) {
    throw Object.assign(new Error('ID notifikasi wajib diisi.'), {
      code: 'INVALID_NOTIFICATION_ID',
    });
  }

  const actor = await getAuthenticatedActorSnapshot();

  let serverHandled = false;
  try {
    const res = await fetch('/api/notifications/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actor.idToken}`,
      },
      body: JSON.stringify({ notificationId: cleanId }),
    });
    ensureSessionUnchanged(actor.uid);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && body?.success === true) {
      serverHandled = true;
    } else if (body && typeof body.code === 'string') {
      throw Object.assign(
        new Error(body.error || body.message || 'Gagal menghapus notifikasi.'),
        { code: body.code, status: res.status }
      );
    }
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code !== 'NETWORK_ERROR') {
      throw err;
    }
  }

  if (serverHandled) return;

  ensureSessionUnchanged(actor.uid);
  const ctx = await resolveVerifiedCallerContext(actor.uid);
  const notifRef = doc(db, 'notifications', cleanId);
  const snap = await getDoc(notifRef);
  if (!snap.exists()) {
    throw Object.assign(new Error('Notifikasi tidak ditemukan.'), {
      code: 'NOTIFICATION_NOT_FOUND',
    });
  }

  const data = snap.data() as Record<string, any>;
  const authorized = await isCallerAuthorizedForNotificationDoc(data, ctx);
  if (!authorized) {
    throw Object.assign(new Error('Anda tidak memiliki akses untuk menghapus notifikasi ini.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }

  await deleteDoc(notifRef);
}

/**
 * Clear all read notifications for a role/recipient (scoped strictly to caller's own read notifications)
 */
export async function clearReadNotifications(
  role: NotificationRecipientRole,
  userId?: string
): Promise<void> {
  const targetRole = normalizeRecipientRole(role);
  if (!targetRole) {
    throw Object.assign(new Error('Role notifikasi tidak valid.'), {
      code: 'INVALID_RECIPIENT_ROLE',
    });
  }

  const actor = await getAuthenticatedActorSnapshot();
  const cleanUserId = normalizeTrimmedString(userId, 128);

  let serverHandled = false;
  try {
    const res = await fetch('/api/notifications/clear-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${actor.idToken}`,
      },
      body: JSON.stringify({
        role: targetRole,
        userId: cleanUserId || undefined,
      }),
    });
    ensureSessionUnchanged(actor.uid);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok && body?.success === true) {
      serverHandled = true;
    } else if (body && typeof body.code === 'string') {
      throw Object.assign(
        new Error(body.error || body.message || 'Gagal membersihkan notifikasi.'),
        { code: body.code, status: res.status }
      );
    }
  } catch (err: any) {
    if (err && typeof err.code === 'string' && err.code !== 'NETWORK_ERROR') {
      throw err;
    }
  }

  if (serverHandled) return;

  ensureSessionUnchanged(actor.uid);
  const ctx = await resolveVerifiedCallerContext(actor.uid);
  if (targetRole === 'therapist' && (!ctx.isStaff || ctx.staffRole !== 'therapist')) {
    throw Object.assign(new Error('Akses notifikasi terapis ditolak.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }
  if (
    targetRole === 'therapist' &&
    cleanUserId &&
    !ctx.therapistIds.has(cleanUserId)
  ) {
    throw Object.assign(new Error('Tidak dapat menghapus notifikasi terapis lain.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }
  if (
    ['admin', 'manager', 'supervisor', 'css'].includes(targetRole) &&
    !ctx.isStaff
  ) {
    throw Object.assign(new Error('Akses notifikasi staf ditolak.'), {
      code: 'FORBIDDEN_NOTIFICATION_ACCESS',
    });
  }

  const q = query(
    collection(db, 'notifications'),
    where('recipientRole', '==', targetRole),
    where('read', '==', true)
  );
  const snap = await getDocs(q);
  if (snap.empty) return;

  const batch = writeBatch(db);
  let count = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as Record<string, any>;
    if (cleanUserId) {
      const candidates = [
        data.recipientId,
        data.recipientUserId,
        data.therapistId,
        data.customerId,
      ]
        .map((v) => normalizeTrimmedString(v, 128))
        .filter(Boolean);
      if (
        (targetRole === 'therapist' || targetRole === 'customer') &&
        !candidates.includes(cleanUserId)
      ) {
        continue;
      }
    }
    const authorized = await isCallerAuthorizedForNotificationDoc(data, ctx);
    if (!authorized) continue;

    batch.delete(docSnap.ref);
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }
}

// ============================================================================
// 5. AUDIT & DELIVERY HISTORY QUERIES (ADMIN / MANAGER DASHBOARD)
// ============================================================================

export async function getRecentNotificationEvents(limitCount = 50): Promise<NotificationEvent[]> {
  try {
    const q = query(collection(db, 'notification_events'), limit(limitCount));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as NotificationEvent);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch (err) {
    console.warn('Error fetching notification events:', err);
    return [];
  }
}

export async function getNotificationDeliveries(limitCount = 100): Promise<NotificationDelivery[]> {
  try {
    const q = query(collection(db, 'notification_deliveries'), limit(limitCount));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as NotificationDelivery & Record<string, any>);
    return list.sort(
      (a, b) =>
        new Date(b.createdAt || b.sentAt || b.deliveredAt || 0).getTime() -
        new Date(a.createdAt || a.sentAt || a.deliveredAt || 0).getTime()
    );
  } catch (err) {
    console.warn('Error fetching notification deliveries:', err);
    return [];
  }
}
