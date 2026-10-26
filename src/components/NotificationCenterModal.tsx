import { auth } from '../lib/firebase';
import React, { useState, useEffect } from 'react';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  Trash2,
  Calendar,
  CreditCard,
  UserCheck,
  MapPin,
  AlertTriangle,
  ExternalLink,
  Volume2,
  VolumeX,
  Smartphone,
  Info,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  InAppNotification,
  NotificationRecipientRole,
  NotificationPriority,
  NotificationEventType,
} from '../types/notification';
import {
  subscribeToRoleNotifications,
  subscribeToCustomerNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  clearReadNotifications,
} from '../lib/notificationService';
import { playNotificationSound } from '../lib/notificationChannels';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserRole?: NotificationRecipientRole;
  currentUserId?: string;
  therapistId?: string;
  customerId?: string;
  customerAuthUid?: string;
  customerBookingCode?: string;
  onNavigateToAction?: (actionUrl: string) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  currentUserRole = 'customer',
  currentUserId,
  therapistId,
  customerId,
  customerAuthUid,
  customerBookingCode,
  onNavigateToAction,
}) => {
  const role: NotificationRecipientRole = (currentUserRole as NotificationRecipientRole) || 'customer';
  const resolvedTherapistId = therapistId || (role === 'therapist' ? currentUserId : undefined);
  const resolvedCustomerId = customerId || (role === 'customer' ? currentUserId : undefined);
  const resolvedRecipientId =
    role === 'therapist'
      ? resolvedTherapistId
      : role === 'customer'
        ? resolvedCustomerId
        : currentUserId || role;
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'booking' | 'payment' | 'therapist' | 'alert'>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('senzu_notif_sound') !== 'false';
  });
  const [pushStatus, setPushStatus] = useState<string>('unknown');
  const [isRequestingPush, setIsRequestingPush] = useState(false);

  // Check browser push permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushStatus(Notification.permission);
    } else {
      setPushStatus('unsupported');
    }
  }, []);

  // Private inbox subscription; clear state on close and identity changes.
  useEffect(() => {
    let live = true;
    setNotifications([]);
    if (!isOpen) return;
    const session = auth.currentUser;
    if (!session?.uid) return;
    const receive = (items: InAppNotification[]) => {
      if (live && auth.currentUser === session) setNotifications(items);
    };
    const unsubscribe = role === 'customer'
      ? subscribeToCustomerNotifications({ customerAuthUid: session.uid }, receive)
      : subscribeToRoleNotifications(role, session.uid, receive);
    return () => { live = false; unsubscribe(); setNotifications([]); };
  }, [isOpen, role, resolvedRecipientId, resolvedTherapistId, resolvedCustomerId, customerAuthUid, customerBookingCode]);

  if (!isOpen) return null;

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('senzu_notif_sound', String(next));
    if (next) {
      playNotificationSound();
    }
  };

  const handleEnablePush = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Browser ini tidak mendukung notifikasi lokal.');
      return;
    }
    const session = auth.currentUser;
    if (!session?.uid) return;
    setIsRequestingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (auth.currentUser !== session) return;
      setPushStatus(permission);
      if (permission === 'granted') {
        alert('Izin notifikasi browser telah aktif. Push dari server belum terkonfigurasi; token FCM perangkat belum tersedia.');
      }
    } catch (error) { console.warn('Notification permission request failed:', error); }
    finally { if (auth.currentUser === session) setIsRequestingPush(false); }
  };

  const handleActionClick = (notif: InAppNotification) => {
    markNotificationAsRead(notif.id);
    if (onNavigateToAction && notif.actionUrl) {
      onNavigateToAction(notif.actionUrl);
      onClose();
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsAsRead(role, resolvedRecipientId);
  };

  const handleClearRead = async () => {
    await clearReadNotifications(role, resolvedRecipientId);
  };

  // Filter notifications based on tab
  const filteredNotifications = notifications.filter((item) => {
    if (activeTab === 'unread') return !item.read;
    if (activeTab === 'booking') return item.eventType.startsWith('booking.');
    if (activeTab === 'payment') return item.eventType.startsWith('payment.');
    if (activeTab === 'therapist') return item.eventType.startsWith('therapist.') || item.eventType.startsWith('treatment.');
    if (activeTab === 'alert') return item.priority === 'CRITICAL' || item.priority === 'HIGH' || item.eventType.includes('alert') || item.eventType.includes('stale');
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const getEventIcon = (type: NotificationEventType, priority: NotificationPriority) => {
    if (priority === 'CRITICAL' || type.includes('alert')) {
      return <AlertTriangle className="w-4 h-4 text-red-600" />;
    }
    if (type.startsWith('payment.')) {
      return <CreditCard className="w-4 h-4 text-emerald-600" />;
    }
    if (type.startsWith('therapist.') || type.startsWith('treatment.')) {
      return <UserCheck className="w-4 h-4 text-indigo-600" />;
    }
    if (type === 'therapist.on_the_way' || type === 'therapist.nearby' || type === 'therapist.arrived') {
      return <MapPin className="w-4 h-4 text-amber-600" />;
    }
    return <Calendar className="w-4 h-4 text-blue-600" />;
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Baru saja';
      if (diffMins < 60) return `${diffMins} mnt lalu`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} jam lalu`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays} hari lalu`;
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#8B5A36] text-white px-4 py-3.5 sm:px-6 sm:py-4 flex items-center justify-between border-b border-[#D4AF37]/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/10 text-[#D4AF37] border border-white/10">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif font-bold text-base sm:text-lg text-white">
                  Pusat Notifikasi
                </h2>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#D4AF37] text-[#4B2B18]">
                    {unreadCount} baru
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300">
                {currentUserRole === 'customer'
                  ? 'Update realtime status pemesanan Anda'
                  : `Alert realtime untuk role ${currentUserRole.toUpperCase()}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleSound}
              title={soundEnabled ? 'Matikan Suara Alert' : 'Aktifkan Suara Alert'}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-[#D4AF37]" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Push Notification Gesture Banner if not enabled */}
        {pushStatus !== 'granted' && pushStatus !== 'unsupported' && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-900">
              <Smartphone className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>Aktifkan push notifikasi agar tidak ketinggalan update kedatangan terapis & pembayaran.</span>
            </div>
            <button
              type="button"
              onClick={handleEnablePush}
              disabled={isRequestingPush}
              className="px-3 py-1.5 rounded-lg bg-[#8B5A36] hover:bg-[#94603B] text-[#FDF3CD] font-bold text-[11px] whitespace-nowrap shadow-sm transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {isRequestingPush ? 'Memproses...' : 'Aktifkan'}
            </button>
          </div>
        )}

        {/* Filter Tabs for Staff */}
        {currentUserRole !== 'customer' && (
          <div className="bg-slate-100 px-4 py-2 flex items-center gap-1.5 border-b border-slate-200 overflow-x-auto no-scrollbar text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-[#8B5A36] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              Semua ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unread')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                activeTab === 'unread'
                  ? 'bg-[#8B5A36] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              Belum Dibaca ({unreadCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('booking')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                activeTab === 'booking'
                  ? 'bg-[#8B5A36] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              Booking
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('payment')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                activeTab === 'payment'
                  ? 'bg-[#8B5A36] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              Pembayaran
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('therapist')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                activeTab === 'therapist'
                  ? 'bg-[#8B5A36] text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200'
              }`}
            >
              Terapis & Layanan
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('alert')}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition cursor-pointer ${
                activeTab === 'alert'
                  ? 'bg-red-600 text-white shadow-sm font-bold'
                  : 'bg-white text-red-700 hover:bg-red-50 border border-red-200'
              }`}
            >
              Alert Operasional
            </button>
          </div>
        )}

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 divide-y divide-slate-100">
          {filteredNotifications.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <Bell className="w-10 h-10 mx-auto text-slate-300 stroke-[1.5]" />
              <p className="text-sm font-medium text-slate-600">Tidak ada notifikasi saat ini</p>
              <p className="text-xs text-slate-400">
                Pembaruan booking dan status operasional akan muncul secara realtime di sini.
              </p>
            </div>
          ) : (
            (filteredNotifications || []).map((notif) => {
              const isCritical = notif.priority === 'CRITICAL';
              const isHigh = notif.priority === 'HIGH';

              return (
                <div
                  key={notif.id}
                  className={`pt-2.5 first:pt-0 rounded-xl p-3 transition border ${
                    !notif.read
                      ? isCritical
                        ? 'bg-red-50/70 border-red-200'
                        : isHigh
                        ? 'bg-amber-50/60 border-amber-200'
                        : 'bg-blue-50/40 border-blue-100'
                      : 'bg-white border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 p-2 rounded-lg bg-white shadow-xs border border-slate-200 flex-shrink-0">
                        {getEventIcon(notif.eventType, notif.priority)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-xs sm:text-sm font-bold text-[#4B2B18] leading-tight">
                            {notif.title}
                          </h4>
                          {isCritical && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-red-600 text-white animate-pulse">
                              CRITICAL
                            </span>
                          )}
                          {isHigh && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white">
                              PENTING
                            </span>
                          )}
                          {!notif.read && (
                            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                          )}
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed">
                          {notif.message}
                        </p>

                        <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-400">
                          <span>{formatRelativeTime(notif.createdAt)}</span>
                          {notif.bookingCode && (
                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-semibold">
                              #{notif.bookingCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {notif.actionUrl && (
                        <button
                          type="button"
                          onClick={() => handleActionClick(notif)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-[#8B5A36] hover:bg-[#94603B] text-white shadow-2xs transition cursor-pointer active:scale-95"
                        >
                          <span>Buka</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                      <div className="flex items-center gap-1">
                        {!notif.read && (
                          <button
                            type="button"
                            onClick={() => markNotificationAsRead(notif.id)}
                            title="Tandai Sudah Dibaca"
                            className="p-1 text-slate-400 hover:text-emerald-600 transition cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteNotification(notif.id)}
                          title="Hapus Notifikasi"
                          className="p-1 text-slate-400 hover:text-red-500 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-blue-700 hover:text-blue-900 font-semibold cursor-pointer transition"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Tandai Semua Dibaca</span>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleClearRead}
            className="text-slate-500 hover:text-red-600 font-medium transition cursor-pointer"
          >
            Bersihkan yang Sudah Dibaca
          </button>
        </div>
      </div>
    </div>
  );
};
