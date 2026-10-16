import { collection, doc, getDoc, getDocs, setDoc, query, limit } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from './firebase';
import type { NotificationEvent, NotificationEventType, NotificationRecipientRole, InAppNotification, NotificationDelivery, AdminNotificationSettings, NotificationDevice } from '../types/notification';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notification';
import { cleanFirestoreData } from './utils';
import { playNotificationSound, showBrowserNotification } from './notificationChannels';

const SETTINGS_DOC_ID = 'default';
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

const text = (value: unknown, max = 160): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.:@-]{0,159}$/.test(value) && !/^\.+$/.test(value);
const fail = (code: string, message: string, status?: number) => Object.assign(new Error(message), { code, status });
const presentation = new Map<string, { seen: Set<string>; lastSound: number }>();

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw fail('CRYPTO_UNAVAILABLE', 'Identitas permintaan belum dapat dibuat.');
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(20)), n => n.toString(16).padStart(2, '0')).join('');
}

async function notificationRequest(
  route: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; guest?: boolean; uid?: string } = {}
): Promise<any> {
  const session = auth?.currentUser;
  const uid = text(session?.uid);
  const guest = options.guest === true;
  if (guest ? Boolean(session) : !session || !uid || (options.uid && options.uid !== uid)) {
    throw fail('AUTH_REQUIRED', 'Silakan masuk untuk mengakses notifikasi.');
  }
  const stable = () => {
    if (options.signal?.aborted) throw fail('ABORTED', 'Permintaan dibatalkan.');
    if (guest ? Boolean(auth?.currentUser) : auth?.currentUser !== session || text(auth.currentUser?.uid) !== uid) {
      throw fail('SESSION_CHANGED', 'Sesi pengguna telah berubah.');
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    stable();
    let token = '';
    if (!guest) {
      token = await session!.getIdToken();
      stable();
      if (!text(token, 16384)) throw fail('AUTH_TOKEN_INVALID', 'Token sesi tidak tersedia.');
    }
    let response: Response;
    try {
      response = await fetch(route, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(!guest ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body), signal: options.signal,
      });
    } catch (error) {
      stable();
      if (attempt === 0) continue;
      throw fail('NETWORK_ERROR', 'Layanan notifikasi belum dapat dihubungi.');
    }
    stable();
    let result: any;
    try { result = await response.json(); } catch { result = null; }
    stable();
    if ((response.status === 429 || response.status >= 500) && attempt === 0) continue;
    if (!response.ok || !result || result.success !== true) {
      throw fail(text(result?.code) || `HTTP_${response.status}`, text(result?.message || result?.error, 250) || 'Permintaan notifikasi gagal.', response.status);
    }
    return result;
  }
  throw fail('NOTIFICATION_UNAVAILABLE', 'Layanan notifikasi belum tersedia.');
}

const referenceKeys = ['bookingId', 'bookingCode', 'paymentId', 'customerId', 'therapistId', 'loyaltyTransactionId', 'transactionId', 'customerVoucherId', 'voucherId', 'referralId', 'caseId', 'reviewId', 'date', 'tierStartedAt', 'year'] as const;

export async function emitEvent(
  eventType: NotificationEventType | string,
  payload: Record<string, any>,
  _actor?: { id?: string; name?: string; role?: string } | NotificationRecipientRole[],
  _legacyIdempotencyKey?: string
): Promise<string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('INVALID_EVENT_PAYLOAD', 'Referensi notifikasi tidak valid.');
  const type = text(eventType, 100);
  if (!type) throw fail('INVALID_EVENT_TYPE', 'Jenis notifikasi wajib diisi.');
  const session = auth?.currentUser;
  if (!session) {
    if (type !== 'booking.created' || !isId(payload.bookingId)) throw fail('AUTH_REQUIRED', 'Silakan masuk untuk mengakses notifikasi.');
    await notificationRequest('/api/notifications/booking-created-initial', { bookingId: payload.bookingId }, { guest: true });
    return '';
  }
  const references: Record<string, unknown> = {};
  for (const key of referenceKeys) if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') references[key] = payload[key];
  const result = await notificationRequest('/api/notifications/emit', { eventType: type, references, requestId: requestId() });
  if (!isId(result.eventId)) throw fail('MALFORMED_RESPONSE', 'Respons event notifikasi tidak valid.');
  return result.eventId;
}

export interface NotificationSubscriptionFilterOptions {
  recipientId?: string; therapistId?: string; customerId?: string; customerAuthUid?: string; bookingId?: string; bookingCode?: string;
}

function safeNotification(value: any): InAppNotification | null {
  if (!value || !isId(value.id) || !isId(value.eventId) || typeof value.eventType !== 'string' || typeof value.read !== 'boolean') return null;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (typeof value.title !== 'string' || typeof value.message !== 'string' || !safeActionUrl(value.actionUrl)) return null;
  const result: any = {
    id: value.id, eventId: value.eventId, eventType: value.eventType, recipientRole: value.recipientRole,
    title: value.title.slice(0, 200), message: value.message.slice(0, 1000), actionUrl: value.actionUrl,
    priority: ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].includes(value.priority) ? value.priority : 'NORMAL',
    channel: 'in_app', read: value.read, readAt: typeof value.readAt === 'string' ? value.readAt : null, createdAt: value.createdAt,
  };
  for (const key of ['bookingId', 'bookingCode', 'customerId', 'therapistId', 'caseId', 'caseCode', 'recipientUserId']) if (isId(value[key])) result[key] = value[key];
  return result;
}

function safeActionUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 400 && /^\/(?:\?|$|(?:track|css|reconciliation|supervisor|therapist|portal|crm|loyalty)(?:[/?]|$))/.test(value) && !/[\\\u0000-\u0020]/.test(value) && !value.startsWith('//');
}

function presentArrival(uid: string, items: InAppNotification[], initial: boolean): void {
  let state = presentation.get(uid);
  if (!state) { state = { seen: new Set(), lastSound: 0 }; presentation.set(uid, state); }
  const arrived = items.filter(n => !state!.seen.has(n.id));
  items.forEach(n => state!.seen.add(n.id));
  if (state.seen.size > 2000) state.seen = new Set(items.map(n => n.id));
  if (initial || text(auth?.currentUser?.uid) !== uid) return;
  const fresh = arrived.filter(n => !n.read && n.eventType !== ('chat.message_received' as any) && Date.now() - Date.parse(n.createdAt) < 120000);
  if (!fresh.length) return;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('senzu_notif_sound') !== 'false' && Date.now() - state.lastSound > 1500) {
      state.lastSound = Date.now(); playNotificationSound();
    }
    if (typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const latest = fresh[0];
      showBrowserNotification(latest.title, { body: latest.message, tag: `senzu-${latest.id}`, data: { url: latest.actionUrl } }).catch(() => {});
    }
  } catch { /* Notification presentation never blocks inbox updates. */ }
}

function subscribePrivateNotifications(filters: Record<string, unknown>, callback: (notifications: InAppNotification[]) => void): () => void {
  const session = auth?.currentUser;
  const uid = text(session?.uid);
  callback([]);
  if (!session || !uid) return () => {};
  let active = true, inFlight = false, initial = true;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopAuth: (() => void) | undefined;
  const stop = () => {
    if (!active) return;
    active = false; controller?.abort(); if (timer) clearInterval(timer);
    stopAuth?.(); if (auth?.currentUser !== session) presentation.delete(uid); callback([]);
  };
  const stable = () => active && auth?.currentUser === session && text(auth.currentUser?.uid) === uid;
  const poll = async () => {
    if (!active || inFlight) return;
    if (!stable()) { stop(); return; }
    inFlight = true;
    const current = new AbortController(); controller = current;
    try {
      const result = await notificationRequest('/api/notifications/list', filters, { uid, signal: current.signal });
      if (!stable() || current.signal.aborted) return;
      if (!Array.isArray(result.notifications)) throw fail('MALFORMED_RESPONSE', 'Daftar notifikasi tidak valid.');
      const items = result.notifications.map(safeNotification).filter((n: InAppNotification | null): n is InAppNotification => Boolean(n));
      presentArrival(uid, items, initial); initial = false;
      if (stable()) callback(items);
    } catch (error: any) {
      if (!stable()) { stop(); return; }
      if ([401, 403].includes(error?.status)) callback([]);
    } finally { inFlight = false; if (controller === current) controller = null; }
  };
  stopAuth = onAuthStateChanged(auth, user => { if (user !== session || text(user?.uid) !== uid) stop(); });
  if (active) { timer = setInterval(() => { void poll(); }, 5000); void poll(); }
  return stop;
}

export function subscribeToRoleNotifications(
  role: NotificationRecipientRole,
  userIdOrCallback?: string | ((notifications: InAppNotification[]) => void),
  callbackOrOptions?: ((notifications: InAppNotification[]) => void) | NotificationSubscriptionFilterOptions
): () => void {
  const callback = typeof userIdOrCallback === 'function' ? userIdOrCallback : typeof callbackOrOptions === 'function' ? callbackOrOptions : () => {};
  const options = typeof userIdOrCallback === 'function' ? callbackOrOptions as NotificationSubscriptionFilterOptions || {} : {};
  if (role === 'customer') return subscribeToCustomerNotifications(options, callback);
  // Role/business-ID hints never grant access; the backend resolves the current Staff Master.
  return subscribePrivateNotifications({ ...(options.bookingCode ? { bookingCode: options.bookingCode } : {}) }, callback);
}

export function subscribeToCustomerNotifications(
  filter: string | { customerId?: string; customerAuthUid?: string; bookingId?: string; bookingCode?: string },
  callback: (notifications: InAppNotification[]) => void
): () => void {
  const uid = text(auth?.currentUser?.uid);
  if (!uid || (typeof filter === 'object' && filter.customerAuthUid && filter.customerAuthUid !== uid)) { callback([]); return () => {}; }
  const bookingCode = typeof filter === 'string' && /^SH-/i.test(filter) ? filter : typeof filter === 'object' ? filter.bookingCode : '';
  const bookingId = typeof filter === 'object' ? filter.bookingId : '';
  return subscribePrivateNotifications({ ...(bookingCode ? { bookingCode } : {}), ...(bookingId ? { bookingId } : {}) }, callback);
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  if (!isId(notificationId)) throw fail('INVALID_NOTIFICATION_ID', 'ID notifikasi tidak valid.');
  const result = await notificationRequest('/api/notifications/mark-read', { notificationId, requestId: requestId() });
  if (result.notificationId !== notificationId) throw fail('MALFORMED_RESPONSE', 'Respons notifikasi tidak sesuai.');
}

async function bulkAction(action: 'mark-all-read' | 'clear-read'): Promise<void> {
  for (let page = 0; page < 20; page++) {
    const result = await notificationRequest(`/api/notifications/${action}`, { requestId: requestId() });
    if (typeof result.hasMore !== 'boolean') throw fail('MALFORMED_RESPONSE', 'Respons notifikasi tidak valid.');
    if (!result.hasMore) return;
  }
  throw fail('BULK_LIMIT', 'Sebagian notifikasi telah diproses. Silakan ulangi untuk sisanya.');
}
export async function markAllNotificationsAsRead(_role: NotificationRecipientRole, _userId?: string): Promise<void> { await bulkAction('mark-all-read'); }
export async function clearReadNotifications(_role: NotificationRecipientRole, _userId?: string): Promise<void> { await bulkAction('clear-read'); }
export async function deleteNotification(notificationId: string): Promise<void> {
  if (!isId(notificationId)) throw fail('INVALID_NOTIFICATION_ID', 'ID notifikasi tidak valid.');
  const result = await notificationRequest('/api/notifications/delete', { notificationId, requestId: requestId() });
  if (result.notificationId !== notificationId) throw fail('MALFORMED_RESPONSE', 'Respons notifikasi tidak sesuai.');
}

export async function registerDeviceToken(device: {
  userId: string; role: NotificationRecipientRole; token: string; platform?: NotificationDevice['platform']; browser?: string; deviceName?: string;
}): Promise<NotificationDevice> {
  const uid = text(auth?.currentUser?.uid);
  if (!uid) throw fail('AUTH_REQUIRED', 'Silakan masuk terlebih dahulu.');
  if (!/^[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{80,}$/.test(device.token) || /^(?:token_|dev_|device_)/i.test(device.token)) {
    throw fail('PUSH_NOT_CONFIGURED', 'Izin notifikasi lokal tersedia. Token FCM untuk push server belum terkonfigurasi.');
  }
  const result = await notificationRequest('/api/notifications/register-device', {
    userId: uid, token: device.token, platform: device.platform || 'pwa', browser: text(device.browser, 512), deviceName: text(device.deviceName, 128),
  }, { uid });
  if (!isId(result.deviceId)) throw fail('MALFORMED_RESPONSE', 'Respons registrasi perangkat tidak valid.');
  const now = new Date().toISOString();
  return { id: result.deviceId, userId: uid, role: device.role, token: device.token, platform: device.platform || 'pwa', enabled: true, createdAt: now, lastSeenAt: now, updatedAt: now };
}

export async function getRegisteredDevices(_role?: NotificationRecipientRole, _userId?: string): Promise<NotificationDevice[]> {
  const result = await notificationRequest('/api/notifications/devices/list', {});
  if (!Array.isArray(result.devices)) throw fail('MALFORMED_RESPONSE', 'Respons perangkat tidak valid.');
  return result.devices;
}

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
