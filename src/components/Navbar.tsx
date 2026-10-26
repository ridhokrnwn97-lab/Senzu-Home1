import React, { useState, useEffect, useMemo } from 'react';
import {
  Home,
  Sparkles,
  Search,
  UserCheck,
  LogOut,
  ChevronRight,
  ChevronDown,
  Bell,
  User,
  MapPin,
  ShieldCheck,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { Booking } from '../types';
import { SenzuLogo } from './SenzuLogo';
import { StaffNavigationBar } from './StaffNavigationBar';

interface NavbarProps {
  onGoHome?: () => void;
  onOpenTracking: () => void;
  onOpenCustomerPortal?: () => void;
  onOpenAccount?: () => void;
  onOpenLogin: () => void;
  activeStaffTab: string;
  setActiveStaffTab: (tab: string) => void;
  onOpenNotifications: () => void;
  unreadNotificationCount?: number;
  customerTab?: string;
  isTrackingOpen?: boolean;
  bookings?: Booking[];
}

export const Navbar: React.FC<NavbarProps> = ({
  onGoHome,
  onOpenTracking,
  onOpenCustomerPortal,
  onOpenAccount,
  onOpenLogin,
  activeStaffTab,
  setActiveStaffTab,
  onOpenNotifications,
  unreadNotificationCount = 0,
  customerTab = 'home',
  isTrackingOpen = false,
  bookings = [],
}) => {
  const { currentUser, logout } = useAuth();
  const { currentCustomer, isCustomerAuthenticated } = useCustomerAuth();
  const [isStaffAccountMenuOpen, setIsStaffAccountMenuOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLogoutConfirmOpen && !isLoggingOut) {
          setIsLogoutConfirmOpen(false);
        } else if (isStaffAccountMenuOpen) {
          setIsStaffAccountMenuOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLogoutConfirmOpen, isStaffAccountMenuOpen, isLoggingOut]);

  // Role metadata helper
  const roleMeta = useMemo(() => {
    switch (currentUser?.role) {
      case 'css':
        return {
          label: 'CSS',
          title: 'Customer Service & Admin',
          badge: 'CSS Admin',
          tab: 'css',
        };
      case 'supervisor':
        return {
          label: 'SPV',
          title: 'Supervisor Operasional',
          badge: 'Supervisor',
          tab: 'supervisor',
        };
      case 'therapist':
        return {
          label: 'Terapis',
          title: 'Portal Terapis',
          badge: 'Terapis Senzu',
          tab: 'therapist',
        };
      case 'manager':
        return {
          label: 'Manager',
          title: 'Branch Manager',
          badge: 'Branch Manager',
          tab: 'management',
        };
      case 'admin':
        return {
          label: 'Admin',
          title: 'Administrator',
          badge: 'Admin',
          tab: 'management',
        };
      default:
        return {
          label: (currentUser as any)?.role ? String((currentUser as any).role).toUpperCase() : 'Staff',
          title: 'Portal Staff',
          badge: (currentUser as any)?.role ? String((currentUser as any).role).toUpperCase() : 'Staff',
          tab: 'home',
        };
    }
  }, [currentUser]);

  // Check if therapist currently has an active order (On The Way or Treatment)
  const activeTherapistJob = useMemo(() => {
    if (currentUser?.role === 'therapist' && bookings && bookings.length > 0) {
      const thId = currentUser.therapistId || currentUser.uid;
      return bookings.find(
        (b) =>
          (b.therapistId === thId || b.therapistId === currentUser.therapistId) &&
          (b.status === 'On The Way' || b.status === 'Treatment')
      );
    }
    return null;
  }, [currentUser, bookings]);

  // Safe logout executor
  const handlePerformLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      // 1. Therapist GPS Safety: Detach active browser geolocation watch and release wakeLock
      if (typeof window !== 'undefined') {
        const win = window as any;
        if (win.__senzuTherapistWatchId !== undefined && navigator.geolocation) {
          try {
            navigator.geolocation.clearWatch(win.__senzuTherapistWatchId);
          } catch (e) {
            console.warn('GPS clearWatch notice:', e);
          }
          delete win.__senzuTherapistWatchId;
        }
        if (win.__senzuTherapistIntervalId !== undefined) {
          clearInterval(win.__senzuTherapistIntervalId);
          delete win.__senzuTherapistIntervalId;
        }
        if (win.__senzuWakeLock) {
          try {
            win.__senzuWakeLock.release();
          } catch (e) {
            // Safe fallback
          }
          delete win.__senzuWakeLock;
        }
      }

      // 2. Close active staff menus
      setIsLogoutConfirmOpen(false);
      setIsStaffAccountMenuOpen(false);

      // 3. Real authentication logout
      await logout();

      // 4. Redirect safely to Staff Login
      setActiveStaffTab('home');
      if (onOpenLogin) {
        onOpenLogin();
      }
    } catch (err) {
      console.error('Logout error:', err);
      alert('Gagal keluar. Silakan coba lagi.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleHomeClick = () => {
    if (onGoHome) {
      onGoHome();
    } else {
      setActiveStaffTab('home');
    }
  };

  const isHomeActive = activeStaffTab === 'home' && customerTab === 'home' && !isTrackingOpen;
  const isOrdersActive = activeStaffTab === 'home' && customerTab === 'orders' && !isTrackingOpen;
  const isTrackingActive = !!isTrackingOpen;

  return (
    <>
    <header className="sticky top-0 z-40 bg-[#5B351F]/95 text-white shadow-md border-b border-[#D4AF37]/30 backdrop-blur-md transition-all">
      {/* Top Banner / Announcement - Hidden on mobile to save vertical viewport */}
      <div className="hidden sm:flex bg-[#3D2315] text-[11px] sm:text-xs py-1 px-3 sm:px-4 text-center border-b border-white/5 text-slate-300 items-center justify-center gap-1.5 sm:gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span className="truncate">Home Service Senzu Reflexology & Massage Palembang</span>
        <span className="hidden md:inline text-[#D4AF37] font-medium">• Hadirkan Home Massage & Refleksi di Rumah Anda</span>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 md:h-18">
          {/* Brand Logo & Palembang Service Area Indicator */}
          <div className="flex items-center gap-2 sm:gap-3 select-none py-1">
            <button
              type="button"
              id="btn-nav-logo"
              onClick={handleHomeClick}
              aria-label="Kembali ke Beranda Senzu"
              title="Kembali ke Beranda Senzu"
              className="flex items-center cursor-pointer active:opacity-80 hover:opacity-95 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] rounded-lg p-0.5"
            >
              <SenzuLogo
                variant="light"
                size="medium"
                className="senzu-navbar-logo h-8 sm:h-10 md:h-12 lg:h-14 max-h-[44px] sm:max-h-[52px] md:max-h-[58px] w-auto max-w-[135px] sm:max-w-[170px] md:max-w-[210px]"
              />
            </button>

            {/* Compact Location Chip: Palembang - hidden on tablet to preserve space for navigation */}
            <div className="hidden min-[1120px]:flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] sm:text-[11px] text-slate-200 shrink-0">
              <MapPin className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-[#D4AF37] shrink-0" />
              <span className="font-semibold tracking-wide">Palembang</span>
            </div>
          </div>

          {/* RIGHT ACTIONS - MOBILE COMPACT (Target 56-72px, uncluttered) */}
          <div className="flex md:hidden items-center gap-1.5">
            {/* Notification Bell with Realtime Badge */}
            <button
              id="btn-mobile-nav-notif"
              type="button"
              onClick={onOpenNotifications}
              className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 active:bg-white/20 text-white border border-white/15 transition active:scale-95 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              aria-label="Pusat Notifikasi"
              title="Notifikasi"
            >
              <Bell className="w-4 h-4 text-[#D4AF37]" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-extrabold text-white shadow-sm border border-[#5B351F] animate-pulse">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>

            {/* Profile / Akun Button */}
            {currentUser ? (
              <div className="relative">
                <button
                  id="btn-mobile-staff-account"
                  type="button"
                  onClick={() => setIsStaffAccountMenuOpen((prev) => !prev)}
                  aria-expanded={isStaffAccountMenuOpen}
                  aria-haspopup="true"
                  aria-label="Menu akun staff"
                  title="Menu Akun Staff"
                  className="flex items-center gap-1.5 px-2.5 h-10 rounded-xl bg-amber-500/20 active:bg-amber-500/30 text-[#FDF3CD] border border-[#D4AF37]/50 text-xs font-bold transition active:scale-95 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
                >
                  <ShieldCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
                  <span className="uppercase text-[10px] font-bold tracking-wider">
                    {currentUser.role?.toUpperCase() || 'STAFF'}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#D4AF37]/80 shrink-0 transition-transform duration-200 ${
                      isStaffAccountMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Mobile Dropdown Popover (iPhone & Android optimized) */}
                {isStaffAccountMenuOpen && (
                  <>
                    {/* Invisible backdrop for outside tap dismissal */}
                    <div
                      className="fixed inset-0 z-40 bg-transparent"
                      onClick={() => setIsStaffAccountMenuOpen(false)}
                      aria-hidden="true"
                    />

                    {/* Popover Dropdown Card */}
                    <div
                      id="mobile-staff-account-dropdown"
                      className="absolute right-0 top-full mt-2 w-60 max-w-[calc(100vw-1.5rem)] bg-white text-slate-800 rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden z-50 animate-fade-in"
                      role="menu"
                      aria-orientation="vertical"
                      aria-labelledby="btn-mobile-staff-account"
                    >
                      {/* Current Staff Info */}
                      <div className="p-3.5 bg-gradient-to-br from-[#5B351F] to-[#70442A] text-white border-b border-[#D4AF37]/30">
                        <p id="mobile-staff-name" className="font-bold text-xs text-white truncate leading-tight">
                          {currentUser.name || 'Staff Senzu'}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            id="mobile-staff-role-badge"
                            className="inline-block text-[9px] font-extrabold uppercase tracking-wider text-[#FDF3CD] bg-[#D4AF37]/25 px-1.5 py-0.5 rounded border border-[#D4AF37]/40"
                          >
                            {currentUser.role?.toUpperCase() || 'STAFF'}
                          </span>
                          {roleMeta.title && (
                            <span className="text-[10px] text-slate-300 truncate">
                              {roleMeta.title}
                            </span>
                          )}
                        </div>
                        {currentUser.email && (
                          <p className="text-[10px] text-slate-300/80 truncate mt-1.5 font-mono">
                            {currentUser.email}
                          </p>
                        )}
                      </div>

                      {/* Dropdown Action: Keluar dari Akun */}
                      <div className="p-2 bg-white">
                        <button
                          id="btn-mobile-menu-logout"
                          type="button"
                          onClick={() => {
                            setIsStaffAccountMenuOpen(false);
                            if (activeTherapistJob) {
                              setIsLogoutConfirmOpen(true);
                            } else {
                              handlePerformLogout();
                            }
                          }}
                          disabled={isLoggingOut}
                          aria-label="Keluar dari Akun"
                          className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200/80 text-xs font-bold flex items-center justify-start gap-2.5 transition active:scale-[0.98] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:opacity-50"
                        >
                          {isLoggingOut ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-rose-600 shrink-0" />
                              <span>Sedang keluar...</span>
                            </>
                          ) : (
                            <>
                              <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
                              <span>Keluar dari Akun</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : isCustomerAuthenticated && currentCustomer ? (
              <button
                id="btn-mobile-nav-customer-account"
                type="button"
                onClick={() => {
                  if (onOpenAccount) onOpenAccount();
                  else if (onOpenCustomerPortal) onOpenCustomerPortal();
                }}
                className="flex items-center gap-1.5 px-2.5 h-10 rounded-xl bg-amber-500/20 active:bg-amber-500/30 text-[#FDF3CD] border border-[#D4AF37]/60 text-xs font-bold transition active:scale-95 cursor-pointer"
                aria-label="Akun Pelanggan"
                title={`Akun: ${currentCustomer.displayName || currentCustomer.name}`}
              >
                <div className="w-5 h-5 rounded-full bg-[#D4AF37] text-[#4B2B18] flex items-center justify-center text-[10px] font-extrabold">
                  {(currentCustomer.displayName || currentCustomer.name || 'M').charAt(0).toUpperCase()}
                </div>
                <span className="text-[11px] truncate max-w-[70px]">
                  {currentCustomer.nickname || currentCustomer.displayName || 'Member'}
                </span>
              </button>
            ) : (
              <button
                id="btn-mobile-nav-account"
                type="button"
                onClick={() => {
                  if (onOpenAccount) onOpenAccount();
                  else if (onOpenCustomerPortal) onOpenCustomerPortal();
                }}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 active:bg-white/20 text-white border border-white/15 transition active:scale-95 cursor-pointer"
                aria-label="Akun Saya"
                title="Akun Saya"
              >
                <User className="w-4 h-4 text-[#D4AF37]" />
              </button>
            )}
          </div>

          {/* RIGHT ACTIONS - DESKTOP & TABLET FULL (>= 768px) */}
          <div className="hidden md:flex items-center gap-1.5 md:gap-2 lg:gap-2.5 shrink-0">
            {/* 1. Beranda */}
            <button
              id="btn-nav-beranda"
              type="button"
              onClick={handleHomeClick}
              className={`flex items-center justify-center gap-1.5 px-2.5 md:px-3 lg:px-3.5 min-h-[40px] md:min-h-[44px] text-xs sm:text-sm rounded-xl border transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                isHomeActive
                  ? 'bg-[#D4AF37]/20 text-[#FDF3CD] border-[#D4AF37]/60 font-semibold shadow-sm ring-1 ring-[#D4AF37]/30'
                  : 'bg-white/10 hover:bg-white/15 active:bg-white/20 text-white/90 hover:text-white border-white/20 font-medium'
              }`}
              aria-label="Beranda"
              title="Beranda"
            >
              <Home className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span>Beranda</span>
            </button>

            {/* 2. Pesanan Saya */}
            {onOpenCustomerPortal && (
              <button
                id="btn-nav-portal"
                type="button"
                onClick={onOpenCustomerPortal}
                className={`flex items-center justify-center gap-1.5 px-2.5 md:px-3 lg:px-3.5 min-h-[40px] md:min-h-[44px] text-xs sm:text-sm rounded-xl border transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                  isOrdersActive
                    ? 'bg-[#D4AF37]/20 text-[#FDF3CD] border-[#D4AF37]/60 font-semibold shadow-sm ring-1 ring-[#D4AF37]/30'
                    : 'bg-white/10 hover:bg-white/15 active:bg-white/20 text-white/90 hover:text-white border-white/20 font-medium'
                }`}
                aria-label="Akun & Riwayat Treatment"
                title="Akun & Riwayat Treatment"
              >
                <User className="w-4 h-4 text-[#D4AF37] shrink-0" />
                <span>Pesanan Saya</span>
              </button>
            )}

            {/* 3. Lacak */}
            <button
              id="btn-nav-lacak"
              type="button"
              onClick={onOpenTracking}
              className={`flex items-center justify-center gap-1.5 px-2.5 md:px-3 lg:px-3.5 min-h-[40px] md:min-h-[44px] text-xs sm:text-sm rounded-xl border transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                isTrackingActive
                  ? 'bg-[#D4AF37]/20 text-[#FDF3CD] border-[#D4AF37]/60 font-semibold shadow-sm ring-1 ring-[#D4AF37]/30'
                  : 'bg-white/10 hover:bg-white/15 active:bg-white/20 text-white/90 hover:text-white border-white/20 font-medium'
              }`}
              aria-label="Lacak Status Pesanan"
              title="Lacak Status Pesanan"
            >
              <Search className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span>Lacak</span>
            </button>

            {/* 3. Customer Account Button for Desktop */}
            {!currentUser && (
              <button
                id="btn-nav-customer-account"
                type="button"
                onClick={() => {
                  if (onOpenAccount) onOpenAccount();
                  else if (onOpenCustomerPortal) onOpenCustomerPortal();
                }}
                className={`flex items-center gap-1.5 px-3 min-h-[40px] md:min-h-[44px] text-xs sm:text-sm rounded-xl border transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 ${
                  customerTab === 'account'
                    ? 'bg-[#D4AF37]/20 text-[#FDF3CD] border-[#D4AF37]/60 font-semibold shadow-sm ring-1 ring-[#D4AF37]/30'
                    : 'bg-white/10 hover:bg-white/15 active:bg-white/20 text-white/90 hover:text-white border-white/20 font-medium'
                }`}
                aria-label="Akun Pelanggan"
                title="Akun Pelanggan"
              >
                {isCustomerAuthenticated && currentCustomer ? (
                  <>
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#B89628] text-[#4B2B18] flex items-center justify-center font-bold text-[10px]">
                      {(currentCustomer.displayName || currentCustomer.name || 'M').charAt(0).toUpperCase()}
                    </div>
                    <span>{currentCustomer.nickname || currentCustomer.displayName || 'Akun Saya'}</span>
                  </>
                ) : (
                  <>
                    <User className="w-4 h-4 text-[#D4AF37] shrink-0" />
                    <span>Akun</span>
                  </>
                )}
              </button>
            )}

            {/* 4. Notification Bell with Realtime Badge */}
            <button
              id="btn-nav-notif"
              type="button"
              onClick={onOpenNotifications}
              className="relative flex items-center justify-center p-2.5 min-h-[40px] md:min-h-[44px] min-w-[40px] md:min-w-[44px] rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white border border-white/20 transition active:scale-95 cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              aria-label="Pusat Notifikasi"
              title="Pusat Notifikasi"
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-[#D4AF37]" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] font-extrabold text-white shadow-md border-2 border-[#5B351F] animate-pulse">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>

            {/* 5. Staff Login / Staff Profile */}
            {currentUser ? (
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden lg:flex flex-col text-right">
                  <span className="text-xs font-semibold text-white leading-tight">
                    {currentUser?.name || 'Staff Senzu'}
                  </span>
                  <span className="text-[10px] text-[#D4AF37] uppercase font-bold tracking-wider">
                    {currentUser.role === 'css'
                      ? 'CSS / Admin'
                      : currentUser.role === 'supervisor'
                      ? 'Supervisor'
                      : currentUser.role === 'therapist'
                      ? 'Terapis'
                      : 'Management'}
                  </span>
                </div>

                <button
                  id="btn-nav-logout"
                  type="button"
                  onClick={() => setIsLogoutConfirmOpen(true)}
                  title="Keluar Akun Staff"
                  aria-label="Keluar dari Senzu Home"
                  className="px-2.5 md:px-3 min-h-[40px] md:min-h-[44px] text-xs font-medium rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/30 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Keluar</span>
                </button>
              </div>
            ) : (
              <button
                id="btn-nav-login"
                type="button"
                onClick={onOpenLogin}
                className="flex items-center justify-center gap-1.5 px-3 md:px-4 min-h-[40px] md:min-h-[44px] text-xs sm:text-sm font-semibold rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#4B2B18] shadow-sm transition active:scale-95 cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5B351F]"
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Staff Login</span>
              </button>
            )}
          </div>
        </div>

        {/* Staff Role Navigation Bar (When Staff Logged In) */}
        {currentUser && (
          <StaffNavigationBar
            currentUser={currentUser}
            activeStaffTab={activeStaffTab}
            setActiveStaffTab={setActiveStaffTab}
          />
        )}
      </div>

    </header>

    {/* ========================================================================= */}
    {/* LOGOUT CONFIRMATION MODAL (outside navbar so `fixed` is viewport-anchored) */}
    {/* ========================================================================= */}
    {isLogoutConfirmOpen && (
        <div
          id="modal-logout-confirm"
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-dialog-title"
        >
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 p-5 sm:p-6 space-y-4 animate-fade-in text-center">
            {/* Header Icon */}
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 id="logout-dialog-title" className="text-base sm:text-lg font-bold text-slate-900">
                Keluar dari Senzu Home?
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Anda perlu login kembali untuk mengakses portal staff.
              </p>
            </div>

            {/* Therapist Active Job Warning if applicable */}
            {activeTherapistJob && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-left space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Anda masih memiliki pekerjaan aktif</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  Pesanan <strong>{activeTherapistJob.bookingCode}</strong> ({activeTherapistJob.customerName}) saat ini berstatus <strong>{activeTherapistJob.status}</strong>.
                </p>
                <p className="text-[10px] text-amber-700 bg-amber-100/80 p-2 rounded-lg font-medium leading-relaxed">
                  ⚠️ Pelacakan GPS dari perangkat ini akan berhenti setelah Anda keluar. Status pesanan di sistem tidak akan diubah secara otomatis.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsLogoutConfirmOpen(false)}
                disabled={isLoggingOut}
                className="flex-1 min-h-[48px] py-3 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold text-xs sm:text-sm transition cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                id="btn-confirm-logout"
                type="button"
                onClick={handlePerformLogout}
                disabled={isLoggingOut}
                aria-label="Keluar dari Senzu Home"
                className="flex-1 min-h-[48px] py-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs sm:text-sm transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isLoggingOut ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Keluar...</span>
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span>Keluar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
