import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Home,
  Headphones,
  Sliders,
  UserCheck,
  CreditCard,
  FileSpreadsheet,
  Settings,
  Users,
  Award,
} from 'lucide-react';
import { StaffUser } from '../types';

interface StaffNavigationBarProps {
  currentUser: StaffUser;
  activeStaffTab: string;
  setActiveStaffTab: (tab: string) => void;
}

interface NavTabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
}

const ALL_STAFF_TABS: NavTabItem[] = [
  {
    id: 'home',
    label: 'Tampilan Customer',
    icon: Home,
    roles: ['manager', 'admin', 'supervisor', 'css', 'therapist', 'staff'],
  },
  {
    id: 'css',
    label: 'Dashboard CSS',
    icon: Headphones,
    roles: ['manager', 'admin', 'css'],
  },
  {
    id: 'supervisor',
    label: 'Control Room',
    icon: Sliders,
    roles: ['manager', 'admin', 'supervisor'],
  },
  {
    id: 'therapist',
    label: 'Terapis Portal',
    icon: UserCheck,
    roles: ['manager', 'admin', 'therapist'],
  },
  {
    id: 'reconciliation',
    label: 'Rekonsiliasi Pembayaran',
    icon: CreditCard,
    roles: ['manager', 'admin', 'css'],
  },
  {
    id: 'report',
    label: 'Laporan Excel',
    icon: FileSpreadsheet,
    roles: ['manager', 'admin', 'css'],
  },
  {
    id: 'management',
    label: 'Portal Manager & Master Data',
    icon: Settings,
    roles: ['manager', 'admin'],
  },
  {
    id: 'crm',
    label: 'CRM Pelanggan',
    icon: Users,
    roles: ['manager', 'admin', 'css'],
  },
  {
    id: 'loyalty',
    label: 'Loyalty & Rewards',
    icon: Award,
    roles: ['manager', 'admin', 'css'],
  },
];

export const StaffNavigationBar: React.FC<StaffNavigationBarProps> = ({
  currentUser,
  activeStaffTab,
  setActiveStaffTab,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const userRole = (currentUser.role || 'staff').toLowerCase().trim();

  // Filter tabs accessible to current staff member's role
  const visibleTabs = ALL_STAFF_TABS.filter((tab) => {
    if (userRole === 'manager' || userRole === 'admin') return true;
    return tab.roles.includes(userRole);
  });

  // Check scroll position to update gradient and arrow visibility
  const checkScrollability = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    // Buffer of 3px for subpixel precision
    setCanScrollLeft(scrollLeft > 3);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 3);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    checkScrollability();

    el.addEventListener('scroll', checkScrollability, { passive: true });
    window.addEventListener('resize', checkScrollability, { passive: true });

    // Use ResizeObserver for precise container boundary checks
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        checkScrollability();
      });
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', checkScrollability);
      window.removeEventListener('resize', checkScrollability);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [checkScrollability, visibleTabs.length]);

  // Auto-scroll active tab into view when activeStaffTab changes
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const activeBtn = el.querySelector<HTMLButtonElement>(`[data-tab-id="${activeStaffTab}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [activeStaffTab]);

  const handleScroll = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollAmount = direction === 'left' ? -220 : 220;
    el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  return (
    <nav
      aria-label="Navigasi Portal Staf"
      className="relative w-full border-t border-white/10 bg-[#3D2315]/70 backdrop-blur-xs select-none"
    >
      <div className="relative flex items-center w-full">
        {/* Left Scroll Button (visible on scrollable viewports) */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => handleScroll('left')}
            aria-label="Scroll tab navigasi ke kiri"
            title="Scroll ke kiri"
            className="absolute left-0 z-20 flex items-center justify-center w-8 h-full bg-gradient-to-r from-[#5B351F] via-[#5B351F]/90 to-transparent text-[#D4AF37] hover:text-white transition cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            <ChevronLeft className="w-5 h-5 drop-shadow-sm" />
          </button>
        )}

        {/* Scrollable Tabs Track */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-2 px-3 sm:px-4 w-full scroll-smooth touch-pan-x"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {visibleTabs.map((tab) => {
            const isActive =
              activeStaffTab === tab.id ||
              (tab.id === 'management' && activeStaffTab === 'settings');
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                id={`tab-btn-${tab.id}`}
                data-tab-id={tab.id}
                type="button"
                onClick={() => setActiveStaffTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`group relative flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 sm:py-2 min-h-[38px] sm:min-h-[40px] rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition active:scale-95 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                  isActive
                    ? 'bg-gradient-to-r from-[#D4AF37] to-[#B89628] text-[#4B2B18] font-bold shadow-md shadow-amber-950/20 ring-1 ring-[#FDF3CD]/50'
                    : 'bg-white/5 text-slate-200 hover:text-white hover:bg-white/15 border border-white/5'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 transition-transform ${
                    isActive
                      ? 'text-[#4B2B18]'
                      : 'text-amber-300/80 group-hover:text-[#D4AF37]'
                  }`}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}

          {/* Role Mode Tag (Right end of the track) */}
          <div className="hidden xl:flex items-center text-[11px] text-amber-200/70 gap-1 pl-3 pr-2 ml-auto shrink-0 border-l border-white/10">
            <span className="uppercase tracking-wider font-semibold">
              Mode: {currentUser.role || 'STAFF'}
            </span>
          </div>
        </div>

        {/* Right Scroll Button (visible on scrollable viewports) */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => handleScroll('right')}
            aria-label="Scroll tab navigasi ke kanan"
            title="Scroll ke kanan"
            className="absolute right-0 z-20 flex items-center justify-center w-8 h-full bg-gradient-to-l from-[#5B351F] via-[#5B351F]/90 to-transparent text-[#D4AF37] hover:text-white transition cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
          >
            <ChevronRight className="w-5 h-5 drop-shadow-sm" />
          </button>
        )}
      </div>
    </nav>
  );
};
