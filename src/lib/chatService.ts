/**
 * Realtime Booking-Scoped Chat Service for Senzu Home
 * Strictly for Operational Communication: Customer <-> Assigned Therapist
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  increment,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { Booking } from '../types';
import {
  BookingChat,
  BookingChatMessage,
  ChatEligibilityResult,
  ChatSenderType,
} from '../types/chat';
import { showBrowserNotification } from './notificationChannels';
import { cleanFirestoreData } from './utils';
import { triggerChatNotificationDispatch } from './chatNotificationManager';

// Maximum characters per text message (Phase 1 constraint)
export const MAX_CHAT_MESSAGE_LENGTH = 1000;

// Communication-eligible active booking statuses
export const ACTIVE_CHAT_BOOKING_STATUSES = [
  'Therapist Assigned',
  'Accepted',
  'On The Way',
  'Arrived',
  'Treatment',
];

// Terminal statuses: chat remains visible in read-only mode; sending is closed
export const TERMINAL_CHAT_BOOKING_STATUSES = [
  'Completed',
  'Cancelled',
  'Rescheduled',
];

/**
 * Checks whether a booking is eligible for in-app chat and whether sending is allowed.
 */
export function isChatEligibleForBooking(
  booking: Booking | null | undefined
): ChatEligibilityResult {
  if (!booking) {
    return {
      eligible: false,
      canSend: false,
      reason: 'Data pesanan tidak ditemukan.',
    };
  }

  // Therapist must be assigned
  const hasTherapist = Boolean(booking.therapistId || booking.therapistName);
  if (!hasTherapist) {
    return {
      eligible: false,
      canSend: false,
      reason: 'Chat belum tersedia karena terapis belum ditugaskan.',
    };
  }

  const rawStatus = (booking.status || '').trim();
  const isTerminal =
    TERMINAL_CHAT_BOOKING_STATUSES.includes(rawStatus) ||
    rawStatus.toLowerCase() === 'completed' ||
    rawStatus.toLowerCase() === 'cancelled';

  if (isTerminal) {
    return {
      eligible: true,
      canSend: false,
      isTerminal: true,
      reason: 'Pesanan telah selesai. Percakapan ini sudah ditutup.',
    };
  }

  // Active status check
  const isActive =
    ACTIVE_CHAT_BOOKING_STATUSES.includes(rawStatus) ||
    rawStatus.toLowerCase() === 'therapist assigned' ||
    rawStatus.toLowerCase() === 'accepted' ||
    rawStatus.toLowerCase() === 'on the way' ||
    rawStatus.toLowerCase() === 'arrived' ||
    rawStatus.toLowerCase() === 'treatment' ||
    (rawStatus === 'Confirmed' && hasTherapist);

  if (isActive) {
    return {
      eligible: true,
      canSend: true,
      isTerminal: false,
    };
  }

  return {
    eligible: false,
    canSend: false,
    reason: 'Chat belum tersedia pada status pesanan saat ini.',
  };
}

/**
 * Initializes or retrieves an authoritative BookingChat record.
 * Derives participant identities strictly from the authoritative booking.
 */
export async function getOrCreateBookingChat(
  booking: Booking,
  userRole: 'customer' | 'therapist',
  authUid: string,
  userDisplayName?: string
): Promise<BookingChat> {
  const bookingId = booking.id;

  // 1. Authoritative Backend Flow (Prompt Section 9)
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
    const res = await fetch('/api/chat/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        bookingId,
        requestedRole: userRole,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.chat) {
        return data.chat as BookingChat;
      }
    }
  } catch (apiErr) {
    console.warn('[ChatService] /api/chat/init non-fatal fallback to client SDK:', apiErr);
  }

  // 2. Client SDK Fallback (protected by Firestore Security Rules)
  const chatRef = doc(db, 'booking_chats', bookingId);
  const now = new Date().toISOString();
  const eligibility = isChatEligibleForBooking(booking);

  try {
    const snap = await getDoc(chatRef);
    if (snap.exists()) {
      const existing = snap.data() as BookingChat;
      const updates: Partial<BookingChat> = { updatedAt: now };
      let hasUpdates = false;

      if (userRole === 'therapist' && authUid && (!existing.therapistAuthUid || existing.therapistAuthUid !== authUid)) {
        updates.therapistAuthUid = authUid;
        hasUpdates = true;
      }
      if (userRole === 'customer' && authUid && (!existing.customerUid || existing.customerUid !== authUid)) {
        updates.customerUid = authUid;
        hasUpdates = true;
      }
      if (eligibility.isTerminal && existing.status !== 'closed') {
        updates.status = 'closed';
        updates.closedAt = now;
        updates.closedReason = 'Booking completed or cancelled';
        hasUpdates = true;
      }

      if (hasUpdates) {
        await updateDoc(chatRef, cleanFirestoreData(updates)).catch(() => {});
      }

      return {
        ...existing,
        ...updates,
      };
    }
  } catch (getErr) {
    console.warn('[ChatService] getDoc notice, attempting setDoc creation:', getErr);
  }

  // Create new booking chat document
  const customerUid =
    booking.customerAuthUid ||
    booking.authUserId ||
    (userRole === 'customer' ? authUid : '') ||
    booking.customerId ||
    '';

  const therapistAuthUid = userRole === 'therapist' ? authUid : undefined;

  const newChat: BookingChat = {
    id: bookingId,
    bookingId,
    bookingCode: booking.bookingCode,
    customerUid,
    customerName: booking.customerName || (userRole === 'customer' ? userDisplayName || 'Customer' : 'Customer'),
    therapistId: booking.therapistId || '',
    therapistAuthUid,
    therapistName: booking.therapistName || (userRole === 'therapist' ? userDisplayName || 'Terapis Senzu' : 'Terapis Senzu'),
    status: eligibility.isTerminal ? 'closed' : 'active',
    createdAt: now,
    updatedAt: now,
    customerUnreadCount: 0,
    therapistUnreadCount: 0,
    closedAt: eligibility.isTerminal ? now : null,
  };

  await setDoc(chatRef, cleanFirestoreData(newChat));
  return newChat;
}

/**
 * Subscribes to the booking chat parent document.
 */
export function subscribeToBookingChat(
  bookingId: string,
  onUpdate: (chat: BookingChat | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!bookingId) {
    onUpdate(null);
    return () => {};
  }

  const chatRef = doc(db, 'booking_chats', bookingId);
  return onSnapshot(
    chatRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as BookingChat);
      } else {
        onUpdate(null);
      }
    },
    (err) => {
      console.warn('[ChatService] subscribeToBookingChat error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Subscribes to messages within a booking chat subcollection.
 * Chronologically ordered, retrieving the latest message window.
 */
export function subscribeToChatMessages(
  bookingId: string,
  onUpdate: (messages: BookingChatMessage[]) => void,
  limitCount: number = 50,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!bookingId) {
    onUpdate([]);
    return () => {};
  }

  const messagesRef = collection(db, 'booking_chats', bookingId, 'messages');
  // Order by createdAt desc with limit to capture the newest messages, then reverse for display
  const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(limitCount));

  return onSnapshot(
    q,
    (snapshot) => {
      const msgs: BookingChatMessage[] = snapshot.docs
        .map((docSnap) => docSnap.data() as BookingChatMessage)
        .reverse();
      onUpdate(msgs);
    },
    (err) => {
      console.warn('[ChatService] subscribeToChatMessages error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Sends a text message from Customer or Therapist into the booking chat.
 * Uses authoritative server endpoint with Bearer token verification and idempotency.
 */
export async function sendChatMessage(params: {
  bookingId: string;
  senderType: 'CUSTOMER' | 'THERAPIST';
  senderUid: string;
  senderName: string;
  text: string;
  clientMessageId?: string;
}): Promise<BookingChatMessage> {
  const { bookingId, senderType, senderName, text } = params;

  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('Pesan tidak boleh kosong.');
  }

  if (trimmedText.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new Error(`Pesan melebihi batas maksimal ${MAX_CHAT_MESSAGE_LENGTH} karakter.`);
  }

  const clientMessageId =
    params.clientMessageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 1. Authoritative Backend Flow via /api/chat/send
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({
        bookingId,
        senderType,
        senderName,
        text: trimmedText,
        clientMessageId,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.message) {
        return data.message as BookingChatMessage;
      }
    } else {
      const errData = await res.json().catch(() => null);
      if (errData?.message) {
        throw new Error(errData.message);
      }
    }
  } catch (apiErr: any) {
    // If it was an explicit server rejection (e.g. terminal chat or unauthorized), throw immediately
    if (apiErr?.message && !apiErr.message.includes('fetch')) {
      throw apiErr;
    }
    console.warn('[ChatService] /api/chat/send network fallback to client Firestore:', apiErr);
  }

  // 2. Client SDK Fallback (protected by Firestore Security Rules)
  const messageId = clientMessageId;
  const now = new Date().toISOString();

  const messageDoc: BookingChatMessage = {
    id: messageId,
    bookingId,
    senderType,
    senderUid: params.senderUid || auth.currentUser?.uid || '',
    senderName,
    text: trimmedText,
    createdAt: now,
    readAt: null,
    clientMessageId,
    messageType: 'TEXT',
    status: 'sent',
  };

  const messageRef = doc(db, 'booking_chats', bookingId, 'messages', messageId);
  await setDoc(messageRef, cleanFirestoreData(messageDoc));

  // Atomically update parent chat metadata and unread counts
  const chatRef = doc(db, 'booking_chats', bookingId);
  const unreadUpdateField =
    senderType === 'CUSTOMER' ? 'therapistUnreadCount' : 'customerUnreadCount';

  await updateDoc(chatRef, cleanFirestoreData({
    lastMessageAt: now,
    lastMessagePreview: trimmedText.length > 60 ? trimmedText.substring(0, 57) + '...' : trimmedText,
    lastSenderType: senderType,
    updatedAt: now,
    [unreadUpdateField]: increment(1),
  })).catch((err) => {
    console.warn('[ChatService] Failed to update chat summary document:', err);
  });

  // Trigger background notification dispatch
  triggerChatNotificationDispatch({ bookingId, messageId, senderType }).catch(() => {});

  return messageDoc;
}

/**
 * Dispatches an automated SYSTEM message into the booking chat.
 * (e.g. status transition events like "Terapis sedang menuju lokasi Anda.")
 */
export async function sendSystemChatMessage(
  bookingId: string,
  text: string
): Promise<BookingChatMessage> {
  const messageId = `sys_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const messageDoc: BookingChatMessage = {
    id: messageId,
    bookingId,
    senderType: 'SYSTEM',
    senderUid: 'system',
    senderName: 'Senzu Home',
    text,
    createdAt: now,
    readAt: now, // System messages are marked read immediately
    clientMessageId: messageId,
    messageType: 'SYSTEM',
    status: 'sent',
  };

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        senderType: 'SYSTEM',
        senderName: 'Senzu Home',
        text,
        clientMessageId: messageId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.message) {
        return data.message as BookingChatMessage;
      }
    }
  } catch (err) {
    console.warn('[ChatService] sendSystemChatMessage API notice:', err);
  }

  return messageDoc;
}

/**
 * Marks incoming unread messages as read and zeroes the unread counter.
 */
export async function markChatAsRead(
  bookingId: string,
  readerType: 'CUSTOMER' | 'THERAPIST',
  readerUid: string
): Promise<void> {
  if (!bookingId) return;

  const chatRef = doc(db, 'booking_chats', bookingId);
  const unreadZeroField =
    readerType === 'CUSTOMER' ? 'customerUnreadCount' : 'therapistUnreadCount';

  // Zero unread counter on parent chat document
  await updateDoc(chatRef, {
    [unreadZeroField]: 0,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});

  // Call authoritative backend endpoint if token available
  try {
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
    if (idToken) {
      await fetch('/api/chat/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ bookingId, readerType }),
      }).catch(() => {});
    }
  } catch {}

  // Mark recent incoming unread messages as read
  try {
    const targetSenderType: ChatSenderType =
      readerType === 'CUSTOMER' ? 'THERAPIST' : 'CUSTOMER';
    const messagesRef = collection(db, 'booking_chats', bookingId, 'messages');
    const q = query(
      messagesRef,
      where('senderType', '==', targetSenderType),
      where('readAt', '==', null),
      limit(20)
    );

    const snap = await getDocs(q);
    if (!snap.empty) {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        batch.update(d.ref, { readAt: now });
      });
      await batch.commit();
    }
  } catch (err) {
    // Non-fatal if batch update fails due to indexing or network
    console.warn('[ChatService] markChatAsRead batch error:', err);
  }
}

/**
 * Subscribes to the unread count for a given booking and role.
 * Efficient: listens only to the single parent document.
 */
export function subscribeToUnreadChatCount(
  bookingId: string,
  userRole: 'customer' | 'therapist',
  onCount: (count: number) => void
): Unsubscribe {
  if (!bookingId) {
    onCount(0);
    return () => {};
  }

  const chatRef = doc(db, 'booking_chats', bookingId);
  return onSnapshot(
    chatRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as BookingChat;
        const count =
          userRole === 'customer'
            ? data.customerUnreadCount || 0
            : data.therapistUnreadCount || 0;
        onCount(count);
      } else {
        onCount(0);
      }
    },
    () => {
      onCount(0);
    }
  );
}
