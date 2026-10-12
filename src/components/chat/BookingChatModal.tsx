import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Send,
  Loader2,
  Check,
  CheckCheck,
  Info,
  Clock,
  User,
  AlertCircle,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { Booking } from '../../types';
import {
  BookingChat,
  BookingChatMessage,
  ChatEligibilityResult,
} from '../../types/chat';
import {
  isChatEligibleForBooking,
  getOrCreateBookingChat,
  subscribeToBookingChat,
  subscribeToChatMessages,
  sendChatMessage,
  markChatAsRead,
  MAX_CHAT_MESSAGE_LENGTH,
} from '../../lib/chatService';
import { auth } from '../../lib/firebase';
import { formatDateTimeWIB } from '../../lib/utils';
import {
  setActiveOpenChatBookingId,
  requestChatNotificationPermission,
  handleIncomingChatMessageNotification,
  clearAppBadge,
} from '../../lib/chatNotificationManager';

export interface BookingChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking;
  currentUserRole: 'customer' | 'therapist';
  currentAuthUid: string;
  currentDisplayName?: string;
}

export const BookingChatModal: React.FC<BookingChatModalProps> = ({
  isOpen,
  onClose,
  booking,
  currentUserRole,
  currentAuthUid,
  currentDisplayName,
}) => {
  const [chat, setChat] = useState<BookingChat | null>(null);
  const [messages, setMessages] = useState<BookingChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [notifPermission, setNotifPermission] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default');
  const [isNotifBannerDismissed, setIsNotifBannerDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('senzu_chat_notif_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  // Track active open chat to suppress banners while chat is open
  useEffect(() => {
    if (isOpen && booking?.id) {
      setActiveOpenChatBookingId(booking.id);
      clearAppBadge();
    }
    return () => {
      setActiveOpenChatBookingId(null);
    };
  }, [isOpen, booking?.id]);

  // Check notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission as any);
    } else {
      setNotifPermission('unsupported');
    }
  }, []);

  const handleEnableNotifications = async () => {
    const res = await requestChatNotificationPermission(currentUserRole, effectiveAuthUid);
    setNotifPermission(res);
    if (res === 'granted' || res === 'denied') {
      setIsNotifBannerDismissed(true);
      try {
        localStorage.setItem('senzu_chat_notif_dismissed', 'true');
      } catch {}
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  const eligibility: ChatEligibilityResult = useMemo(
    () => isChatEligibleForBooking(booking),
    [booking]
  );

  const effectiveAuthUid = useMemo(
    () => currentAuthUid || auth.currentUser?.uid || '',
    [currentAuthUid]
  );

  // Participant display name: Customer sees Therapist, Therapist sees Customer
  const partnerDisplayName = useMemo(() => {
    if (currentUserRole === 'customer') {
      return booking.therapistName || chat?.therapistName || 'Terapis Senzu';
    }
    return booking.customerName || chat?.customerName || 'Pelanggan';
  }, [currentUserRole, booking, chat]);

  const partnerRoleLabel = useMemo(() => {
    return currentUserRole === 'customer' ? 'Terapis Berlisensi Senzu' : 'Customer Senzu Home';
  }, [currentUserRole]);

  // Quick replies according to Prompt Section 7
  const quickReplies = useMemo(() => {
    if (currentUserRole === 'customer') {
      return [
        'Saya sudah menunggu.',
        'Lokasi rumah sesuai titik di aplikasi.',
        'Mohon kabari jika sudah dekat.',
        'Baik, terima kasih.',
      ];
    }
    return [
      'Saya sedang menuju lokasi.',
      'Saya sudah dekat dengan lokasi Anda.',
      'Saya sudah tiba.',
      'Mohon konfirmasi patokan rumah.',
    ];
  }, [currentUserRole]);

  // Scroll to bottom helper
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  };

  // 1. Initialize or load chat document on open
  useEffect(() => {
    if (!isOpen || !booking) return;

    let unsubChat: (() => void) | undefined;
    let unsubMessages: (() => void) | undefined;
    let isCancelled = false;

    setIsInitializing(true);
    setErrorMessage(null);

    getOrCreateBookingChat(booking, currentUserRole, effectiveAuthUid, currentDisplayName)
      .then((c) => {
        if (isCancelled) return;
        setChat(c);
        setIsInitializing(false);

        // Subscribe to chat parent updates
        unsubChat = subscribeToBookingChat(booking.id, (updatedChat) => {
          if (!isCancelled && updatedChat) {
            setChat(updatedChat);
          }
        });

        // Subscribe to messages subcollection
        unsubMessages = subscribeToChatMessages(
          booking.id,
          (newMessages) => {
            if (isCancelled) return;
            setMessages(newMessages);

            // Automatically mark incoming unread messages as read
            const senderType = currentUserRole === 'customer' ? 'CUSTOMER' : 'THERAPIST';
            markChatAsRead(booking.id, senderType, effectiveAuthUid);
          },
          50,
          (err) => {
            console.warn('[BookingChatModal] Messages sub error:', err);
            if (!isCancelled) {
              setErrorMessage('Gagal memuat pesan. Ketuk untuk mencoba lagi.');
            }
          }
        );
      })
      .catch((err: any) => {
        console.error('[BookingChatModal] Init error:', err);
        if (!isCancelled) {
          setErrorMessage('Gagal memuat percakapan. Pastikan koneksi internet stabil.');
          setIsInitializing(false);
        }
      });

    return () => {
      isCancelled = true;
      if (unsubChat) unsubChat();
      if (unsubMessages) unsubMessages();
    };
  }, [isOpen, booking.id, currentUserRole, effectiveAuthUid, currentDisplayName, retryCount]);

  // 2. Scroll to bottom when messages update
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom('smooth');
    }
  }, [messages.length]);

  // 3. Mark read on open or focus
  useEffect(() => {
    if (isOpen && booking.id && effectiveAuthUid) {
      const senderType = currentUserRole === 'customer' ? 'CUSTOMER' : 'THERAPIST';
      markChatAsRead(booking.id, senderType, effectiveAuthUid);
    }
  }, [isOpen, booking.id, currentUserRole, effectiveAuthUid]);

  // Handle Send Message
  const handleSendMessage = async (textToSend?: string) => {
    const rawText = textToSend !== undefined ? textToSend : inputText;
    const text = rawText.trim();
    if (!text || isSending) return;

    if (!eligibility.canSend) {
      setErrorMessage(eligibility.reason || 'Percakapan ini sudah ditutup.');
      return;
    }

    setErrorMessage(null);
    setFailedMessage(null);
    setIsSending(true);

    const senderType = currentUserRole === 'customer' ? 'CUSTOMER' : 'THERAPIST';
    const senderName =
      currentDisplayName || (currentUserRole === 'customer' ? 'Customer' : 'Terapis');

    try {
      await sendChatMessage({
        bookingId: booking.id,
        senderType,
        senderUid: effectiveAuthUid,
        senderName,
        text,
      });

      if (textToSend === undefined) {
        setInputText('');
      }
      setTimeout(() => scrollToBottom('smooth'), 100);
    } catch (err: any) {
      console.error('[BookingChatModal] Send message failed:', err);
      setErrorMessage(err.message || 'Pesan gagal dikirim. Coba lagi.');
      setFailedMessage(text);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id={`chat-modal-${booking.bookingCode}`}
      className="fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-slate-950/70 backdrop-blur-xs overscroll-contain animate-in fade-in duration-200"
    >
      <div className="w-full h-full sm:h-[620px] sm:max-w-md bg-white sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        {/* Header (Section 5) */}
        <div className="bg-[#082A4F] text-white px-4 py-3.5 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B89628] text-[#082A4F] font-bold flex items-center justify-center text-sm shadow-inner shrink-0">
              {partnerDisplayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white truncate leading-tight">
                  {partnerDisplayName}
                </h3>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-amber-200/90 mt-0.5">
                <span className="font-mono font-semibold">#{booking.bookingCode}</span>
                <span>•</span>
                <span className="truncate">{booking.status}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Percakapan"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer shrink-0 active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Operational Security Notice */}
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-4 py-1.5 text-[10px] text-amber-900 flex items-center justify-between shrink-0">
          <span>Obrolan operasional terkait reservasi <strong>#{booking.bookingCode}</strong></span>
          <span className="text-[9px] uppercase font-bold text-[#082A4F]">{partnerRoleLabel}</span>
        </div>

        {/* Compact Notification Permission Prompt (Section 6) */}
        {notifPermission === 'default' && !isNotifBannerDismissed && (
          <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2 flex items-center justify-between text-xs text-amber-900 shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="truncate">Aktifkan notifikasi pesan agar tidak terlewat.</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <button
                type="button"
                onClick={handleEnableNotifications}
                className="px-2.5 py-1 bg-[#082A4F] text-[#FDF3CD] font-bold rounded-lg text-[11px] shadow-2xs hover:bg-[#0d3866] transition cursor-pointer active:scale-95"
              >
                Aktifkan
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsNotifBannerDismissed(true);
                  try {
                    localStorage.setItem('senzu_chat_notif_dismissed', 'true');
                  } catch {}
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                title="Nanti Saja"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Permission Denied Informative Hint (Section 6) */}
        {notifPermission === 'denied' && !isNotifBannerDismissed && (
          <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between text-xs text-slate-700 shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">Notifikasi browser dinonaktifkan. Anda dapat mengaktifkannya via Pengaturan Situs.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsNotifBannerDismissed(true);
                try {
                  localStorage.setItem('senzu_chat_notif_dismissed', 'true');
                } catch {}
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer ml-2 shrink-0"
              title="Tutup"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Message Area (Section 5, 6) */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F9F9F8] min-h-0"
        >
          {isInitializing ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#082A4F]" />
              <span className="text-xs">Memuat percakapan...</span>
            </div>
          ) : errorMessage && messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
              <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm">Gagal Memuat Percakapan</h4>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setRetryCount((c) => c + 1);
                }}
                className="px-4 py-2 bg-[#082A4F] text-[#FDF3CD] hover:bg-[#061d37] rounded-xl text-xs font-bold transition shadow-xs active:scale-95 cursor-pointer"
              >
                Coba Lagi
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                <User className="w-6 h-6 text-[#082A4F]" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm">Belum Ada Pesan</h4>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                {currentUserRole === 'customer'
                  ? `Mulai obrolan dengan ${partnerDisplayName} untuk koordinasi kedatangan atau patokan rumah.`
                  : `Mulai obrolan dengan ${partnerDisplayName} untuk konfirmasi titik lokasi atau kedatangan.`}
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              // System Message Bubble
              if (msg.senderType === 'SYSTEM' || msg.messageType === 'SYSTEM') {
                return (
                  <div key={msg.id} className="flex justify-center my-2">
                    <div className="bg-slate-100 border border-slate-200/80 rounded-full px-3.5 py-1 text-[11px] text-slate-600 flex items-center gap-1.5 shadow-2xs text-center max-w-[90%]">
                      <Info className="w-3.5 h-3.5 text-[#082A4F] shrink-0" />
                      <span>{msg.text}</span>
                    </div>
                  </div>
                );
              }

              const isOutgoing =
                (currentUserRole === 'customer' && msg.senderType === 'CUSTOMER') ||
                (currentUserRole === 'therapist' && msg.senderType === 'THERAPIST');

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'} space-y-0.5`}
                >
                  <div
                    className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed break-words shadow-xs ${
                      isOutgoing
                        ? 'bg-[#082A4F] text-white rounded-tr-xs'
                        : 'bg-white border border-slate-200 text-slate-900 rounded-tl-xs'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    <div
                      className={`flex items-center justify-end gap-1 mt-1 text-[9px] font-mono ${
                        isOutgoing ? 'text-blue-200' : 'text-slate-400'
                      }`}
                    >
                      <span>
                        {msg.createdAt
                          ? new Date(msg.createdAt).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                      {isOutgoing && (
                        <span>
                          {msg.readAt ? (
                            <span title="Dibaca">
                              <CheckCheck className="w-3.5 h-3.5 text-emerald-300" />
                            </span>
                          ) : (
                            <span title="Terkirim">
                              <Check className="w-3.5 h-3.5 text-blue-200" />
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Message Suggestions (Section 7) */}
        {eligibility.canSend && (
          <div className="bg-white border-t border-slate-100 px-3 py-2 overflow-x-auto no-scrollbar flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] uppercase font-bold text-slate-600 shrink-0">
              Pesan Cepat:
            </span>
            {quickReplies.map((qr, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(qr)}
                disabled={isSending}
                className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-slate-100 hover:bg-amber-50 text-slate-700 hover:text-[#082A4F] border border-slate-200 transition cursor-pointer active:scale-95 disabled:opacity-50"
              >
                {qr}
              </button>
            ))}
          </div>
        )}

        {/* Error / Retry Bar */}
        {errorMessage && (
          <div className="bg-rose-50 border-t border-rose-200 px-4 py-2 text-xs text-rose-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span className="truncate">{errorMessage}</span>
            </div>
            {failedMessage && (
              <button
                type="button"
                onClick={() => handleSendMessage(failedMessage)}
                className="text-[11px] font-bold text-rose-700 underline ml-2 shrink-0 cursor-pointer"
              >
                Coba Lagi
              </button>
            )}
          </div>
        )}

        {/* Terminal/Closed Status Banner or Input Composer (Section 5, 21) */}
        {!eligibility.canSend ? (
          <div className="bg-slate-100 border-t border-slate-200 p-4 text-center text-xs text-slate-600 space-y-1 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <p className="font-semibold text-slate-800">
              {eligibility.reason || 'Pesanan telah selesai. Percakapan ini sudah ditutup.'}
            </p>
            <p className="text-[11px] text-slate-500">
              Riwayat obrolan tetap dapat dilihat untuk kebutuhan verifikasi operasional.
            </p>
          </div>
        ) : (
          <div className="bg-white border-t border-slate-200 p-3 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef as any}
                  rows={1}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ketik pesan ke ${partnerDisplayName}...`}
                  maxLength={MAX_CHAT_MESSAGE_LENGTH}
                  className="w-full resize-none max-h-24 px-3.5 py-2.5 bg-slate-50 focus:bg-white border border-slate-300 rounded-2xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#082A4F] focus:border-[#082A4F] transition shadow-inner"
                />
              </div>
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={isSending || !inputText.trim()}
                className="w-10 h-10 rounded-2xl bg-[#082A4F] hover:bg-[#0D3866] text-[#FDF3CD] flex items-center justify-center transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shrink-0"
                aria-label="Kirim Pesan"
              >
                {isSending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="flex justify-between items-center px-1 mt-1 text-[10px] text-slate-400">
              <span>Enter untuk kirim • Shift+Enter baris baru</span>
              <span>{inputText.length}/{MAX_CHAT_MESSAGE_LENGTH}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
