/**
 * Centralized Chat Notification Manager
 * Handles foreground in-app banners, background push subscription,
 * deduplication, unread badges, and account binding.
 */

import { playNotificationSound, showBrowserNotification } from './notificationChannels';
import { ChatNotificationItem } from '../components/chat/ChatNotificationBanner';
import { collection, query, orderBy, limit, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db, auth } from './firebase';
import { onIdTokenChanged } from 'firebase/auth';
import { Booking } from '../types';
import { isChatEligibleForBooking } from './chatService';

// Active chat modal tracking: when user already has this chat open,
// banners and system notifications are suppressed.
let activeOpenChatBookingId: string | null = null;

export function setActiveOpenChatBookingId(bookingId: string | null): void {
  activeOpenChatBookingId = bookingId;
}

export function getActiveOpenChatBookingId(): string | null {
  return activeOpenChatBookingId;
}

// In-memory deduplication set to prevent duplicate alerts for the same message ID
const notifiedMessageIds = new Set<string>();

// Callback listeners for in-app banner UI
type NotificationBannerCallback = (item: ChatNotificationItem) => void;
const bannerListeners = new Set<NotificationBannerCallback>();

export function subscribeToChatBannerNotifications(
  callback: NotificationBannerCallback
): () => void {
  bannerListeners.add(callback);
  return () => {
    bannerListeners.delete(callback);
  };
}

/**
 * Evaluates an incoming chat message and dispatches in-app banner
 * and browser notification if appropriate.
 */
export function handleIncomingChatMessageNotification(params: {
  bookingId: string;
  bookingCode?: string;
  messageId: string;
  senderType: 'CUSTOMER' | 'THERAPIST' | 'SYSTEM';
  currentUserRole: 'customer' | 'therapist';
  messageCreatedAt: string;
}): void {
  const {
    bookingId,
    bookingCode,
    messageId,
    senderType,
    currentUserRole,
    messageCreatedAt,
  } = params;

  // Ignore system messages or messages sent by the user themselves
  if (senderType === 'SYSTEM') return;
  const isSelf =
    (currentUserRole === 'customer' && senderType === 'CUSTOMER') ||
    (currentUserRole === 'therapist' && senderType === 'THERAPIST');
  if (isSelf) return;

  // Deduplication check: do not notify twice for the same message ID
  if (notifiedMessageIds.has(messageId)) return;
  notifiedMessageIds.add(messageId);

  // Keep set bounded to prevent memory growth
  if (notifiedMessageIds.size > 200) {
    const it = notifiedMessageIds.values();
    for (let i = 0; i < 50; i++) {
      const val = it.next().value;
      if (val) notifiedMessageIds.delete(val);
    }
  }

  // If the user already has this specific chat open, do not show banner or play sound
  if (activeOpenChatBookingId === bookingId) {
    return;
  }

  // Ignore historical messages (older than 2 minutes before current session)
  const msgTime = new Date(messageCreatedAt).getTime();
  if (!isNaN(msgTime) && Date.now() - msgTime > 2 * 60 * 1000) {
    return;
  }

  // Notification content complying strictly with Section 3:
  // Customer receives: Title: "Senzu Home", Body: "Pesan baru dari terapis Anda."
  // Therapist receives: Title: "Senzu Home", Body: "Pesan baru dari customer."
  const isRecipientCustomer = currentUserRole === 'customer';
  const title = 'Senzu Home';
  const body = isRecipientCustomer
    ? 'Pesan baru dari terapis Anda.'
    : 'Pesan baru dari customer.';

  const item: ChatNotificationItem = {
    id: `notif_${messageId}`,
    messageId,
    bookingId,
    bookingCode,
    title,
    body,
    senderRole: senderType === 'CUSTOMER' ? 'customer' : 'therapist',
    timestamp: Date.now(),
  };

  // 1. Play warm chime sound
  playNotificationSound();

  // 2. Dispatch in-app banner for foreground users viewing another screen
  bannerListeners.forEach((fn) => {
    try {
      fn(item);
    } catch (err) {
      console.warn('[ChatNotificationManager] Banner callback error:', err);
    }
  });

  // 3. If app is hidden/backgrounded in browser tab, show system notification
  if (typeof document !== 'undefined' && document.hidden) {
    showBrowserNotification(title, {
      body,
      icon: '/assets/brand/senzu-app-icon-192.png',
      badge: '/assets/brand/senzu-app-icon-192.png',
      tag: `chat-${bookingId}`,
      data: {
        url: isRecipientCustomer
          ? `/?openChat=${encodeURIComponent(bookingId)}`
          : `/?portal=therapist&openChat=${encodeURIComponent(bookingId)}`,
        bookingId,
      },
    }).catch(() => {});
  }

  // 4. Update OS app badge where supported (Requirement 9)
  if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
    try {
      (navigator as any).setAppBadge(1).catch(() => {});
    } catch {}
  }
}

/**
 * Clear OS App-icon badge when chats are read
 */
export function clearAppBadge(): void {
  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    try {
      (navigator as any).clearAppBadge().catch(() => {});
    } catch {}
  }
}

/**
 * Request notification permission explicitly on user action (Section 6)
 */
export async function requestChatNotificationPermission(
  userRole: 'customer' | 'therapist',
  userId: string
): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && userId) {
      // Register device subscription with backend
      await registerDeviceWithBackend(userId, userRole);
    }
    return permission;
  } catch (err) {
    console.warn('[ChatNotificationManager] Request permission notice:', err);
    return 'denied';
  }
}

// Device cleanup holds only tokens obtained from the real Firebase session,
// in memory. Authentication and AuthContext behavior are unchanged.
type NotificationDeviceBinding = {
  uid: string;
  idToken: string;
  token: string;
  ready: Promise<void>;
  pendingRegistration: Promise<void>;
  cleanup?: Promise<void>;
};
const notificationDeviceBindings = new Map<string, NotificationDeviceBinding>();

function refreshBoundNotificationIdToken(
  session: { uid: string; getIdToken: () => Promise<string> },
  binding: NotificationDeviceBinding
): void {
  // Capture only the currently authenticated owner. Cleanup may await this
  // already-started request after sign-out, without adopting the next user.
  if (auth.currentUser?.uid !== session.uid || binding.uid !== session.uid || binding.cleanup) return;
  const previous = binding.ready;
  const tokenRequest = session.getIdToken().catch(() => '');
  binding.ready = (async () => {
    await previous.catch(() => {});
    const token = await tokenRequest;
    if (token && notificationDeviceBindings.get(session.uid) === binding) binding.idToken = token;
  })();
  binding.ready.catch(() => {});
}

async function readNotificationDeviceToken(createGuid: boolean): Promise<string> {
  if (typeof window === 'undefined') return '';
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    if ('pushManager' in registration) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) return JSON.stringify(subscription);
    }
  }
  let guid = localStorage.getItem('senzu_device_guid') || '';
  if (!guid && createGuid) {
    guid = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem('senzu_device_guid', guid);
  }
  return guid;
}

async function cleanupBoundNotificationDevice(binding: NotificationDeviceBinding): Promise<void> {
  if (binding.cleanup) return binding.cleanup;
  binding.cleanup = (async () => {
    await binding.ready;
    await binding.pendingRegistration.catch(() => {});
    if (!binding.idToken || !binding.token) return;
    const response = await fetch('/api/notifications/unregister-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${binding.idToken}` },
      body: JSON.stringify({ userId: binding.uid, token: binding.token }),
    });
    if (!response.ok) throw new Error(`Notification device cleanup failed (${response.status})`);
  })().finally(() => {
    if (notificationDeviceBindings.get(binding.uid) === binding) notificationDeviceBindings.delete(binding.uid);
  });
  return binding.cleanup;
}

// Read-only session observer: warms device identity after refresh, keeps its
// cached ID token current, and cleans the old binding on sign-out/switch.
if (typeof window !== 'undefined') {
  onIdTokenChanged(auth, (user) => {
    const activeUid = auth.currentUser?.uid;
    for (const binding of notificationDeviceBindings.values()) {
      if (binding.uid !== activeUid) {
        cleanupBoundNotificationDevice(binding).catch((err) => console.warn('[ChatNotificationManager] Device cleanup notice:', err));
      }
    }
    if (!user || user.uid !== activeUid) return;
    const existing = notificationDeviceBindings.get(user.uid);
    if (existing && !existing.cleanup) {
      refreshBoundNotificationIdToken(user, existing);
      return;
    }
    const warm = async () => {
      if (existing?.cleanup) await existing.cleanup.catch(() => {});
      if (auth.currentUser?.uid !== user.uid) return;
      const binding: NotificationDeviceBinding = {
        uid: user.uid, idToken: '', token: '', ready: Promise.resolve(), pendingRegistration: Promise.resolve(),
      };
      notificationDeviceBindings.set(user.uid, binding);
      const tokenRequest = user.getIdToken();
      binding.ready = (async () => {
        binding.idToken = await tokenRequest;
        binding.token = await readNotificationDeviceToken(false);
      })();
      binding.ready.catch((err) => console.warn('[ChatNotificationManager] Device identity notice:', err));
    };
    warm().catch((err) => console.warn('[ChatNotificationManager] Device identity notice:', err));
  });

  // ID-token observers do not themselves refresh an expiring token. Use the
  // SDK's cached getIdToken() only while this owner and device are active.
  const refreshActiveDevice = () => {
    const session = auth.currentUser;
    const binding = session ? notificationDeviceBindings.get(session.uid) : null;
    if (session && binding?.token) refreshBoundNotificationIdToken(session, binding);
  };
  window.setInterval(refreshActiveDevice, 60000);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshActiveDevice();
    });
  }
}

/**
 * Register push notification device with backend.
 * userId remains a compatibility hint; ownership comes from the actual session.
 */
export async function registerDeviceWithBackend(
  userId: string,
  userRole: 'customer' | 'therapist'
): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const session = auth.currentUser;
    if (!session) throw new Error('Authenticated notification session required');
    const pushToken = await readNotificationDeviceToken(true);
    const idToken = await session.getIdToken();
    if (!idToken || auth.currentUser?.uid !== session.uid) throw new Error('Notification session changed');
    const previous = notificationDeviceBindings.get(session.uid);
    if (previous) {
      await previous.ready.catch(() => {});
      await previous.pendingRegistration.catch(() => {});
      if (previous.cleanup) await previous.cleanup.catch(() => {});
    }
    if (auth.currentUser?.uid !== session.uid) throw new Error('Notification session changed');
    const binding: NotificationDeviceBinding = {
      uid: session.uid, idToken, token: pushToken, ready: Promise.resolve(), pendingRegistration: Promise.resolve(),
    };
    notificationDeviceBindings.set(session.uid, binding);
    binding.pendingRegistration = (async () => {
      const response = await fetch('/api/notifications/register-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ userId: session.uid, role: userRole, token: pushToken, platform: 'pwa', browser: navigator.userAgent }),
      });
      if (!response.ok) throw new Error(`Notification device registration failed (${response.status})`);
    })();
    await binding.pendingRegistration;
    if (auth.currentUser?.uid !== session.uid) await cleanupBoundNotificationDevice(binding);
  } catch (err) {
    console.warn('[ChatNotificationManager] Failed to register device with backend:', err);
  }
}

/**
 * Cleanup after logout/account switch, using the original binding's valid ID
 * token and exact device token, never the next user's session.
 */
export async function unregisterNotificationDevice(userId: string): Promise<void> {
  try {
    const activeUid = auth.currentUser?.uid;
    const requested = notificationDeviceBindings.get(userId);
    if (requested && requested.uid !== activeUid) {
      await cleanupBoundNotificationDevice(requested);
    } else if (!activeUid) {
      await Promise.all([...notificationDeviceBindings.values()].map(cleanupBoundNotificationDevice));
    }
    // An old logout callback cannot unregister the newly active account.
  } catch (err) {
    console.warn('[ChatNotificationManager] Failed to unregister device on logout:', err);
  }
}

/**
 * Dispatches backend authoritative notification after message persistence
 */
export async function triggerChatNotificationDispatch(params: {
  bookingId: string;
  messageId: string;
  senderType: 'CUSTOMER' | 'THERAPIST';
}): Promise<void> {
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
    await fetch('/api/chat/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch (err) {
    console.warn('[ChatNotificationManager] triggerChatNotificationDispatch error:', err);
  }
}

/**
 * Sets up realtime listeners across all active eligible bookings for the current user.
 * Dispatches foreground banner, sound chime, and background browser notification when a new message arrives.
 */
export function subscribeToActiveBookingsChatNotifications(
  activeBookings: Booking[],
  currentUserRole: 'customer' | 'therapist',
  currentUserId?: string
): () => void {
  if (!activeBookings || activeBookings.length === 0) {
    return () => {};
  }

  // Filter only active eligible bookings (not terminal/completed)
  const eligibleBookings = activeBookings.filter((b) => {
    const el = isChatEligibleForBooking(b);
    return el.eligible && !el.isTerminal;
  });

  if (eligibleBookings.length === 0) {
    return () => {};
  }

  const unsubs: Unsubscribe[] = [];
  const listenerStartTime = Date.now();

  eligibleBookings.forEach((b) => {
    try {
      const messagesRef = collection(db, 'booking_chats', b.id, 'messages');
      const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(1));

      const unsub = onSnapshot(
        q,
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const data = change.doc.data() as any;
              if (!data) return;

              // Check that message was created around or after listener was attached
              const msgCreatedAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;
              // Allow message within last 10 seconds before listener or any time after
              if (msgCreatedAt && msgCreatedAt < listenerStartTime - 10000) {
                return;
              }

              handleIncomingChatMessageNotification({
                bookingId: b.id,
                bookingCode: b.bookingCode,
                messageId: data.id || change.doc.id,
                senderType: data.senderType,
                currentUserRole,
                messageCreatedAt: data.createdAt || new Date().toISOString(),
              });
            }
          });
        },
        (err) => {
          console.warn(`[ChatNotificationManager] Listener notice for booking ${b.bookingCode}:`, err);
        }
      );

      unsubs.push(unsub);
    } catch (err) {
      console.warn(`[ChatNotificationManager] Failed to attach listener for booking ${b.bookingCode}:`, err);
    }
  });

  return () => {
    unsubs.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  };
}
