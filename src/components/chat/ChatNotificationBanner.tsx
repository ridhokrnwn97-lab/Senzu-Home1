import React, { useEffect, useState } from 'react';
import { MessageCircle, X, ChevronRight } from 'lucide-react';

export interface ChatNotificationItem {
  id: string;
  messageId: string;
  bookingId: string;
  bookingCode?: string;
  title: string;
  body: string;
  senderRole: 'customer' | 'therapist';
  senderName?: string;
  timestamp: number;
}

interface ChatNotificationBannerProps {
  notification: ChatNotificationItem | null;
  onOpenChat: (bookingId: string) => void;
  onDismiss: () => void;
}

export const ChatNotificationBanner: React.FC<ChatNotificationBannerProps> = ({
  notification,
  onOpenChat,
  onDismiss,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (notification) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300);
      }, 5000);

      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [notification, onDismiss]);

  if (!notification) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md transition-all duration-300 transform ${
        isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
      }`}
    >
      <div className="bg-[#082A4F] text-white rounded-2xl p-3.5 shadow-xl border border-[#D4AF37]/30 flex items-center justify-between gap-3">
        {/* Clickable Area to Open Chat */}
        <button
          type="button"
          onClick={() => {
            setIsVisible(false);
            onOpenChat(notification.bookingId);
            onDismiss();
          }}
          className="flex items-center gap-3 text-left flex-1 min-w-0 cursor-pointer group"
        >
          <div className="relative w-10 h-10 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0 text-[#D4AF37] group-hover:scale-105 transition">
            <MessageCircle className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-[#082A4F]" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#FDF3CD] tracking-wide">
                {notification.title}
              </span>
              {notification.bookingCode && (
                <span className="text-[10px] font-mono text-slate-300 bg-white/10 px-1.5 py-0.5 rounded">
                  #{notification.bookingCode}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-200 truncate mt-0.5 font-medium">
              {notification.body}
            </p>
          </div>

          <div className="flex items-center text-[#D4AF37] text-xs font-semibold shrink-0 group-hover:translate-x-0.5 transition">
            <span>Buka</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>

        {/* Dismiss Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsVisible(false);
            setTimeout(onDismiss, 200);
          }}
          className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center shrink-0 transition active:scale-95 cursor-pointer"
          title="Tutup Notifikasi"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
