export type NotificationRecipientRole =
  | 'customer'
  | 'css'
  | 'supervisor'
  | 'therapist'
  | 'admin'
  | 'manager'
  | 'finance';

export type NotificationChannel = 'in_app' | 'push' | 'whatsapp' | 'email';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type NotificationEventType =
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'payment.proof_uploaded'
  | 'payment.verified'
  | 'payment.rejected'
  | 'payment.expired'
  | 'booking.ready_for_assignment'
  | 'therapist.assigned'
  | 'therapist.reassigned'
  | 'therapist.accepted'
  | 'therapist.on_the_way'
  | 'therapist.nearby'
  | 'therapist.arrived'
  | 'treatment.started'
  | 'treatment.completed'
  | 'tracking.location_stale'
  | 'booking.reminder'
  | 'supervisor.unassigned_alert'
  | 'therapist.not_accepted_alert'
  | 'therapist.late_departure_alert'
  | 'review.low_rating'
  | 'crm.task_due'
  | 'loyalty.points_earned'
  | 'loyalty.points_redeemed'
  | 'loyalty.points_expiring'
  | 'membership.tier_upgraded'
  | 'membership.tier_renewed'
  | 'voucher.issued'
  | 'voucher.expiring'
  | 'voucher.used'
  | 'referral.qualified'
  | 'birthday.reward_issued'
  | 'therapist.shift_updated'
  | 'therapist.off_updated'
  | 'therapist.schedule_override'
  | 'case.created'
  | 'case.assigned'
  | 'case.escalated'
  | 'case.high_severity'
  | 'case.waiting_customer'
  | 'case.waiting_manager'
  | 'case.resolved'
  | 'case.closed'
  | 'case.reopened'
  | 'recovery.proposed'
  | 'recovery.approved'
  | 'recovery.rejected'
  | 'recovery.completed';

export interface InAppNotification {
  id: string;
  eventId: string;
  eventType: NotificationEventType;
  recipientUserId?: string; // specific user ID, or undefined for role broadcasts
  recipientRole: NotificationRecipientRole;
  bookingId?: string;
  bookingCode?: string;
  customerId?: string;
  therapistId?: string;
  caseId?: string;
  caseCode?: string;
  title: string;
  message: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  read: boolean;
  readAt?: string | null;
  actionUrl: string;
  metadata?: Record<string, any>;
  createdAt: string; // ISO
  expiresAt?: string | null;
}

export interface NotificationEvent {
  id: string;
  eventType: NotificationEventType;
  bookingId?: string;
  paymentId?: string;
  actorId?: string;
  actorRole?: string;
  payload: Record<string, any>;
  createdAt: string; // ISO
  processedAt?: string | null;
  status: 'pending' | 'processing' | 'processed' | 'failed';
  error?: string | null;
}

export interface NotificationDelivery {
  id?: string;
  notificationId: string;
  channel: NotificationChannel;
  recipient: string; // Phone, Email, FCM token, or in-app recipient ID
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  sentAt?: string | null;
  deliveredAt?: string | null;
  failedAt?: string | null;
  failureReason?: string | null;
  retryCount: number;
}

export interface NotificationDevice {
  id: string;
  userId: string;
  role: NotificationRecipientRole;
  token: string;
  platform: 'web' | 'pwa' | 'ios_pwa' | 'android_web';
  browser?: string;
  deviceName?: string;
  enabled: boolean;
  createdAt: string;
  lastSeenAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  id?: string;
  userId: string;
  role: NotificationRecipientRole;
  pushEnabled: boolean;
  bookingUpdates: boolean;
  paymentUpdates: boolean;
  therapistUpdates: boolean;
  reminders: boolean;
  marketing: boolean;
  soundEnabled?: boolean;
  updatedAt: string;
}

export interface AdminNotificationSettings {
  id: string;
  bookingCreatedAlert: boolean;
  paymentAlert: boolean;
  supervisorAlert: boolean;
  therapistAlert: boolean;
  bookingReminder: boolean;
  nearbyNotification: boolean;
  staleGpsAlert: boolean;
  reminderMinutes: number; // default 60
  assignmentAlertMinutes: number; // default 60
  therapistNotAcceptedMinutes: number; // default 10
  lateDepartureBufferMinutes: number; // default 15
  gpsStaleMinutes: number; // default 3
  nearbyDistanceKm: number; // default 1.0 km
  whatsappEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  updatedAt?: string;
}

export const DEFAULT_NOTIFICATION_SETTINGS: AdminNotificationSettings = {
  id: 'default',
  bookingCreatedAlert: true,
  paymentAlert: true,
  supervisorAlert: true,
  therapistAlert: true,
  bookingReminder: true,
  nearbyNotification: true,
  staleGpsAlert: true,
  reminderMinutes: 60,
  assignmentAlertMinutes: 60,
  therapistNotAcceptedMinutes: 10,
  lateDepartureBufferMinutes: 15,
  gpsStaleMinutes: 3,
  nearbyDistanceKm: 1.0,
  whatsappEnabled: true,
  emailEnabled: true,
  pushEnabled: true,
  updatedAt: new Date().toISOString()
};

export interface NotificationCategoryFilter {
  id: string;
  label: string;
  types?: NotificationEventType[];
}
