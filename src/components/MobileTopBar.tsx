import React from 'react';
import { MapPin, Search, Bell, User, ShieldCheck, ChevronDown } from 'lucide-react';
import { SenzuLogo } from './SenzuLogo';
import { useAuth } from '../context/AuthContext';

export interface MobileTopBarProps {
  onOpenTracking: () => void;
  onOpenNotifications: () => void;
  onSelectTab: (tab: string) => void;
  unreadNotificationCount?: number;
  currentCustomerName?: string;
  activeStaffTab: string;
}

export const MobileTopBar: React.FC<MobileTopBarProps> = ({
  onOpenTracking,
  onOpenNotifications,
  onSelectTab,
  unreadNotificationCount = 0,
  currentCustomerName,
  activeStaffTab,
}) => {
  const { currentUser } = useAuth();

  return (
    <header className="sticky top-0 z-40 bg-[#082A4F]/95 text-white shadow-md border-b border-[#D4AF37]/30 backdrop-blur-md transition-all pt-safe">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2">
          {/* Logo & Area Selector */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => onSelectTab('home')}
              className="flex items-center gap-2 cursor-pointer select-none active:opacity-80 transition text-left shrink-0"
              aria-label="Kembali ke Beranda"
            >
              <SenzuLogo variant="light" size="small" className="h-8 sm:h-9 w-auto max-w-[150px] sm:max-w-[180px]" />
            </button>

            {/* Location Indicator (Kota Palembang) */}
            <div className="hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] text-slate-200">
              <MapPin className="w-3 h-3 text-[#D4AF37] shrink-0" />
              <span className="font-semibold truncate max-w-[120px] sm:max-w-[160px]">
                Kota Palembang
              </span>
            </div>
          </div>

          {/* Right Action Icons */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Lacak Button */}
            <button
              type="button"
              onClick={onOpenTracking}
              className="flex items-center justify-center gap-1 px-2.5 sm:px-3 h-9 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white border border-white/15 text-xs font-semibold transition active:scale-95 cursor-pointer"
              title="Lacak Status Pesanan"
            >
              <Search className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span className="hidden sm:inline">Lacak</span>
            </button>

            {/* Notification Bell with Badge */}
            <button
              type="button"
              onClick={onOpenNotifications}
              className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white border border-white/15 transition active:scale-95 cursor-pointer"
              aria-label="Pusat Notifikasi"
              title="Notifikasi"
            >
              <Bell className="w-4 h-4 text-[#D4AF37]" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-extrabold text-white shadow-md border border-[#082A4F] animate-pulse">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>

            {/* Account / Staff Avatar */}
            {currentUser ? (
              <button
                type="button"
                onClick={() => onSelectTab(currentUser.role === 'css' ? 'css' : currentUser.role === 'supervisor' ? 'supervisor' : currentUser.role === 'therapist' ? 'therapist' : 'management')}
                className="flex items-center gap-1.5 px-2 sm:px-2.5 h-9 rounded-xl bg-amber-500/20 text-[#FDF3CD] border border-[#D4AF37]/50 text-xs font-bold transition active:scale-95 cursor-pointer"
                title="Buka Portal Staff"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span className="hidden sm:inline uppercase text-[10px]">
                  {currentUser.role}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectTab('account')}
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#082A4F] shadow-sm transition active:scale-95 cursor-pointer"
                aria-label="Akun & Profil Saya"
                title="Akun Saya"
              >
                <User className="w-4 h-4 text-[#082A4F]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
