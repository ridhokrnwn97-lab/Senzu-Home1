import React from 'react';
import { Home, Calendar, Sparkles, Award, User } from 'lucide-react';

export type CustomerTabType = 'home' | 'orders' | 'booking' | 'rewards' | 'account';

export interface MobileBottomNavProps {
  activeTab: CustomerTabType;
  onChangeTab: (tab: CustomerTabType) => void;
  activeOrdersCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onChangeTab,
  activeOrdersCount = 0,
}) => {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#082A4F]/98 border-t border-[#D4AF37]/35 backdrop-blur-xl shadow-[0_-8px_24px_rgba(0,0,0,0.35)] text-white select-none md:hidden"
      style={{
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
      }}
      aria-label="Navigasi Utama Mobile"
    >
      <div className="max-w-md mx-auto px-2 sm:px-4 h-[68px] flex items-center justify-between relative">
        {/* 1. Beranda */}
        <button
          type="button"
          onClick={() => onChangeTab('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-center transition active:scale-95 cursor-pointer relative min-h-[44px] ${
            activeTab === 'home' ? 'text-[#D4AF37]' : 'text-slate-300 hover:text-white'
          }`}
          aria-label="Beranda"
        >
          <div className="relative flex items-center justify-center">
            <Home
              className={`w-5 h-5 transition-transform ${
                activeTab === 'home' ? 'scale-110 text-[#D4AF37]' : 'text-slate-300'
              }`}
            />
            {activeTab === 'home' && (
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#D4AF37] shadow-[0_0_6px_#D4AF37]" />
            )}
          </div>
          <span
            className={`text-[11px] mt-1.5 leading-none transition-colors ${
              activeTab === 'home' ? 'font-bold text-[#FDF3CD]' : 'font-medium text-slate-300'
            }`}
          >
            Beranda
          </span>
        </button>

        {/* 2. Pesanan Saya */}
        <button
          type="button"
          onClick={() => onChangeTab('orders')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-center transition active:scale-95 cursor-pointer relative min-h-[44px] ${
            activeTab === 'orders' ? 'text-[#D4AF37]' : 'text-slate-300 hover:text-white'
          }`}
          aria-label="Pesanan Saya"
        >
          <div className="relative flex items-center justify-center">
            <Calendar
              className={`w-5 h-5 transition-transform ${
                activeTab === 'orders' ? 'scale-110 text-[#D4AF37]' : 'text-slate-300'
              }`}
            />
            {activeOrdersCount > 0 && (
              <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-red-600 text-[9px] font-black text-white shadow-md border-2 border-[#082A4F] animate-pulse">
                {activeOrdersCount}
              </span>
            )}
            {activeTab === 'orders' && (
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#D4AF37] shadow-[0_0_6px_#D4AF37]" />
            )}
          </div>
          <span
            className={`text-[11px] mt-1.5 leading-none transition-colors ${
              activeTab === 'orders' ? 'font-bold text-[#FDF3CD]' : 'font-medium text-slate-300'
            }`}
          >
            Pesanan
          </span>
        </button>

        {/* 3. Center CTA: Pesan (Prominent Golden Highlight Button) */}
        <div className="flex-1 flex items-center justify-center -mt-6">
          <button
            type="button"
            onClick={() => onChangeTab('booking')}
            className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#D4AF37] via-[#FDF3CD] to-[#B89628] p-0.5 shadow-xl hover:shadow-[#D4AF37]/40 transition transform active:scale-90 flex items-center justify-center cursor-pointer group"
            aria-label="Pesan Layanan Sekarang"
          >
            <div
              className={`w-full h-full rounded-full flex flex-col items-center justify-center transition ${
                activeTab === 'booking'
                  ? 'bg-[#0B3461] text-[#FDF3CD]'
                  : 'bg-[#082A4F] text-[#FDF3CD] group-hover:bg-[#0B3461]'
              }`}
            >
              <Sparkles className="w-5 h-5 text-[#D4AF37] animate-pulse" />
              <span className="text-[9px] font-black uppercase tracking-wider text-[#FDF3CD] mt-0.5">
                PESAN
              </span>
            </div>
          </button>
        </div>

        {/* 4. Rewards & Loyalty */}
        <button
          type="button"
          onClick={() => onChangeTab('rewards')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-center transition active:scale-95 cursor-pointer relative min-h-[44px] ${
            activeTab === 'rewards' ? 'text-[#D4AF37]' : 'text-slate-300 hover:text-white'
          }`}
          aria-label="Rewards & Loyalty"
        >
          <div className="relative flex items-center justify-center">
            <Award
              className={`w-5 h-5 transition-transform ${
                activeTab === 'rewards' ? 'scale-110 text-[#D4AF37]' : 'text-slate-300'
              }`}
            />
            {activeTab === 'rewards' && (
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#D4AF37] shadow-[0_0_6px_#D4AF37]" />
            )}
          </div>
          <span
            className={`text-[11px] mt-1.5 leading-none transition-colors ${
              activeTab === 'rewards' ? 'font-bold text-[#FDF3CD]' : 'font-medium text-slate-300'
            }`}
          >
            Rewards
          </span>
        </button>

        {/* 5. Akun */}
        <button
          type="button"
          onClick={() => onChangeTab('account')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-center transition active:scale-95 cursor-pointer relative min-h-[44px] ${
            activeTab === 'account' ? 'text-[#D4AF37]' : 'text-slate-300 hover:text-white'
          }`}
          aria-label="Akun Saya"
        >
          <div className="relative flex items-center justify-center">
            <User
              className={`w-5 h-5 transition-transform ${
                activeTab === 'account' ? 'scale-110 text-[#D4AF37]' : 'text-slate-300'
              }`}
            />
            {activeTab === 'account' && (
              <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#D4AF37] shadow-[0_0_6px_#D4AF37]" />
            )}
          </div>
          <span
            className={`text-[11px] mt-1.5 leading-none transition-colors ${
              activeTab === 'account' ? 'font-bold text-[#FDF3CD]' : 'font-medium text-slate-300'
            }`}
          >
            Akun
          </span>
        </button>
      </div>
    </nav>
  );
};
