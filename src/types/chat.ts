/**
 * In-App Operational Chat Types for Senzu Home
 * Strictly Booking-Scoped: Customer <-> Assigned Therapist
 */

export type ChatSenderType = 'CUSTOMER' | 'THERAPIST' | 'SYSTEM';
export type ChatMessageType = 'TEXT' | 'SYSTEM';
export type BookingChatStatus = 'active' | 'closed';

export interface BookingChat {
  id: string; // bookingId
  bookingId: string;
  bookingCode: string;
  customerUid: string;
  customerName: string;
  therapistId: string;
  therapistAuthUid?: string;
  therapistName: string;
  status: BookingChatStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastSenderType?: ChatSenderType;
  customerUnreadCount: number;
  therapistUnreadCount: number;
  closedAt?: string | null;
  closedReason?: string | null;
}

export interface BookingChatMessage {
  id: string;
  bookingId: string;
  senderType: ChatSenderType;
  senderUid: string;
  senderName: string;
  text: string;
  createdAt: string;
  readAt?: string | null;
  clientMessageId: string;
  messageType: ChatMessageType;
  status?: 'pending' | 'sent' | 'failed';
}

export interface ChatEligibilityResult {
  eligible: boolean;
  canSend: boolean;
  reason?: string;
  isTerminal?: boolean;
}
