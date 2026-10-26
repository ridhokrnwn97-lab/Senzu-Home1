import React, { useState, useEffect } from 'react';
import { MessageCircle } from 'lucide-react';
import { Booking } from '../../types';
import { isChatEligibleForBooking, subscribeToUnreadChatCount } from '../../lib/chatService';

interface ChatButtonWithBadgeProps {
  booking: Booking;
  userRole: 'customer' | 'therapist';
  onOpenChat: (booking: Booking) => void;
  className?: string;
  variant?: 'button' | 'icon' | 'compact';
  label?: string;
}

export const ChatButtonWithBadge: React.FC<ChatButtonWithBadgeProps> = ({
  booking,
  userRole,
  onOpenChat,
  className = '',
  variant = 'button',
  label,
}) => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const eligibility = isChatEligibleForBooking(booking);

  useEffect(() => {
    if (!booking?.id || !eligibility.eligible || eligibility.isTerminal) {
      setUnreadCount(0);
      return;
    }

    const unsub = subscribeToUnreadChatCount(booking.id, userRole, (count) => {
      setUnreadCount(count);
    });

    return () => {
      unsub();
    };
  }, [booking?.id, userRole, eligibility.eligible, eligibility.isTerminal]);

  if (!eligibility.eligible || eligibility.isTerminal) return null;

  const buttonText = label || (userRole === 'customer' ? 'Chat Terapis' : 'Chat Customer');

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={() => onOpenChat(booking)}
        className={`relative w-10 h-10 rounded-xl bg-slate-50 border border-slate-300 text-slate-700 hover:text-[#4B2B18] hover:bg-slate-100 flex items-center justify-center transition active:scale-95 shadow-2xs cursor-pointer ${className}`}
        title={buttonText}
      >
        <MessageCircle className="w-4 h-4 text-[#4B2B18]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white font-bold text-[10px] rounded-full flex items-center justify-center shadow-xs border-2 border-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => onOpenChat(booking)}
        className={`relative px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-900 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer ${className}`}
      >
        <MessageCircle className="w-3.5 h-3.5 text-indigo-600" />
        <span>{buttonText}</span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.2 bg-rose-600 text-white font-bold text-[9px] rounded-full">
            {unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenChat(booking)}
      className={`relative px-3.5 py-1.5 rounded-xl bg-white border border-[#8B5A36] text-[#4B2B18] hover:bg-[#8B5A36] hover:text-[#FDF3CD] font-bold text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-2xs ${className}`}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      <span>{buttonText}</span>
      {unreadCount > 0 && (
        <span className="px-1.5 py-0.2 bg-rose-600 text-white font-bold text-[9px] rounded-full animate-pulse shadow-xs">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
};
