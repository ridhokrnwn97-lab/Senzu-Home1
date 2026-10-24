import React from 'react';
import { Home, Calendar, Sparkles, Award, User } from 'lucide-react';

export type CustomerTabType = 'home' | 'orders' | 'booking' | 'rewards' | 'account';
export interface MobileBottomNavProps {
  activeTab: CustomerTabType;
  onChangeTab: (tab: CustomerTabType) => void;
  activeOrdersCount?: number;
}

const tabs = [
  { id: 'home', label: 'Beranda', ariaLabel: 'Beranda', icon: Home },
  { id: 'orders', label: 'Pesanan', ariaLabel: 'Pesanan Saya', icon: Calendar },
  { id: 'booking', label: 'Pesan', ariaLabel: 'Pesan Layanan Sekarang', icon: Sparkles },
  { id: 'rewards', label: 'Rewards', ariaLabel: 'Rewards & Loyalty', icon: Award },
  { id: 'account', label: 'Akun', ariaLabel: 'Akun Saya', icon: User },
] as const;

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeTab, onChangeTab, activeOrdersCount = 0 }) => (
  <nav className="senzu-bottom-nav fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl select-none lg:hidden"
    style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }} aria-label="Navigasi Utama Mobile">
    <div className="mx-auto flex h-[72px] max-w-lg items-center justify-between px-2">
      {tabs.map(({ id, label, ariaLabel, icon: Icon }) => {
        const active = activeTab === id;
        const booking = id === 'booking';
        return <button key={id} type="button" onClick={() => onChangeTab(id)} aria-label={ariaLabel}
          aria-current={active ? 'page' : undefined}
          className={`relative flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl py-1 text-center transition active:scale-95 ${active ? 'text-senzu-brand' : 'text-slate-500'}`}>
          <span className={`relative flex items-center justify-center ${booking ? 'h-11 w-14 -mt-3 rounded-2xl bg-senzu-brand text-white shadow-sm' : active ? 'h-7 w-12 rounded-full bg-senzu-cream' : 'h-7 w-12'}`}>
            <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.6} aria-hidden="true" />
            {id === 'orders' && activeOrdersCount > 0 && <span className="absolute -right-0.5 -top-1 flex min-w-4 items-center justify-center rounded-full bg-senzu-brand px-1 text-[9px] font-bold leading-4 text-white">{activeOrdersCount > 9 ? '9+' : activeOrdersCount}</span>}
          </span>
          <span className={`text-[10px] leading-none ${active || booking ? 'font-bold' : 'font-medium'}`}>{label}</span>
        </button>;
      })}
    </div>
  </nav>
);
