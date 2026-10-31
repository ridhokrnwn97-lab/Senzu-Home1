import React, { useMemo, useState, useEffect } from 'react';
import {
  Sparkles,
  ShieldCheck,
  Clock,
  MapPin,
  Heart,
  Search,
  ChevronRight,
  Phone,
  RotateCcw,
  Gift,
  Ticket,
  Award,
  ArrowRight,
  CheckCircle2,
  Star,
  Users,
  Calendar,
  Navigation,
  ExternalLink,
  ChevronDown,
  CreditCard
} from 'lucide-react';
import { ServiceItem, Booking, AppSettings } from '../types';
import { CustomerCRM, CustomerSavedAddress } from '../types/crm';
import { CustomerLoyaltyAccount, Voucher } from '../types/loyalty';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { findCustomerByPhoneOrEmail, getCustomerSavedAddresses } from '../lib/crmService';
import { getLoyaltyAccountByCustomerId, getCustomerVouchers, getAllVouchers } from '../lib/loyaltyService';
import { useCustomerServiceWhatsApp, DEFAULT_CS_MESSAGE } from '../lib/supportWhatsApp';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { filterCustomerBookings, getActiveBooking, reconcileCustomerBookingsInFirestore } from '../lib/bookingPersistenceService';
import { PendingPaymentCard } from './customer/PendingPaymentCard';
import { ChatButtonWithBadge } from './chat/ChatButtonWithBadge';
import { getCustomerServices } from '../lib/customerServices';

export interface MobileHomeViewProps {
  services: ServiceItem[];
  bookings: Booking[];
  settings: AppSettings;
  onStartBooking: (serviceId?: string, promoCode?: string) => void;
  onOpenTracking: (code?: string) => void;
  onRepeatBooking: (booking: Partial<Booking>) => void;
  onOpenRewards: () => void;
  onOpenOrders: () => void;
  onOpenAccount?: () => void;
  onOpenPayment?: (booking: Booking) => void;
  onOpenChat?: (booking: Booking) => void;
}

export const MobileHomeView: React.FC<MobileHomeViewProps> = ({
  services = [],
  bookings = [],
  settings,
  onStartBooking,
  onOpenTracking,
  onRepeatBooking,
  onOpenRewards,
  onOpenOrders,
  onOpenAccount,
  onOpenPayment,
  onOpenChat,
}) => {
  const safeServices = useMemo(() => getCustomerServices(services), [services]);
  const { currentCustomer, isCustomerAuthenticated, firebaseUser, isCustomerPreviewMode } = useCustomerAuth();
  // Asynchronously loaded CRM & Loyalty state
  const [crmCustomer, setCrmCustomer] = useState<CustomerCRM | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<CustomerSavedAddress[]>([]);
  const [loyaltyAccount, setLoyaltyAccount] = useState<CustomerLoyaltyAccount | null>(null);
  const [activeVoucherCount, setActiveVoucherCount] = useState<number>(0);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [activePromos, setActivePromos] = useState<Voucher[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Centralized Official Senzu Customer Service WhatsApp
  const { isAvailable, getWhatsAppUrl, unavailableNotice } = useCustomerServiceWhatsApp();
  const csWhatsAppUrl = getWhatsAppUrl(DEFAULT_CS_MESSAGE);

  // Reconcile customer bookings in Firestore if authenticated (Disabled in Staff Customer Preview)
  useEffect(() => {
    if (isCustomerPreviewMode) return;
    if (isCustomerAuthenticated && currentCustomer?.id) {
      reconcileCustomerBookingsInFirestore(currentCustomer, firebaseUser?.uid).catch((err) =>
        console.warn('Reconcile customer bookings error in MobileHomeView:', err)
      );
    }
  }, [isCustomerPreviewMode, isCustomerAuthenticated, currentCustomer, firebaseUser]);

  // Load active promos from Firestore
  useEffect(() => {
    getAllVouchers()
      .then((list) => {
        setActivePromos(list.filter((v) => v.enabled));
      })
      .catch((e) => console.warn('Could not fetch promos in MobileHomeView:', e));
  }, []);

  const handleCopyCode = (code: string) => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    });
  };

  // Load customer phone / name from localStorage or active state (Strictly disabled in Staff Customer Preview)
  const customerPhone = useMemo(() => {
    if (isCustomerPreviewMode) return '';
    return (isCustomerAuthenticated ? currentCustomer?.phone : '') || localStorage.getItem('senzu_customer_phone') || '';
  }, [isCustomerPreviewMode, isCustomerAuthenticated, currentCustomer?.phone]);

  const localCustomerName = useMemo(() => {
    if (isCustomerPreviewMode) return '';
    return currentCustomer?.displayName || currentCustomer?.name || localStorage.getItem('senzu_customer_name') || '';
  }, [isCustomerPreviewMode, currentCustomer]);

  // Fetch CRM Profile and Loyalty Data if phone exists (Disabled in Staff Customer Preview)
  useEffect(() => {
    let isMounted = true;
    if (isCustomerPreviewMode || !customerPhone) {
      setCrmCustomer(null);
      setSavedAddresses([]);
      setLoyaltyAccount(null);
      setActiveVoucherCount(0);
      return;
    }

    const loadCustomerData = async () => {
      try {
        const profile = await findCustomerByPhoneOrEmail(customerPhone);
        if (!isMounted) return;

        if (profile) {
          setCrmCustomer(profile);
          if (profile.name && !localStorage.getItem('senzu_customer_name')) {
            localStorage.setItem('senzu_customer_name', profile.name);
          }

          // Fetch Saved Addresses
          try {
            const addrs = await getCustomerSavedAddresses(profile.id);
            if (isMounted) setSavedAddresses(addrs);
          } catch (e) {
            console.warn('Could not fetch saved addresses:', e);
          }

          // Fetch Loyalty Account & Vouchers
          try {
            const loyalty = await getLoyaltyAccountByCustomerId(profile.id);
            if (isMounted && loyalty) {
              setLoyaltyAccount(loyalty);
              const vouchers = await getCustomerVouchers(profile.id);
              if (isMounted) {
                setActiveVoucherCount(vouchers.filter((v) => v.status === 'available').length);
              }
            }
          } catch (e) {
            console.warn('Could not fetch loyalty account:', e);
          }
        }
      } catch (err) {
        console.warn('Error loading CRM data in MobileHomeView:', err);
      }
    };

    loadCustomerData();
    return () => {
      isMounted = false;
    };
  }, [isCustomerPreviewMode, customerPhone]);

  // SINGLE SOURCE OF TRUTH: Authoritative Customer Bookings (Strictly isolated in Staff Customer Preview)
  const customerBookings = useMemo(() => {
    if (isCustomerPreviewMode) return [];
    if (isCustomerAuthenticated && currentCustomer) {
      return filterCustomerBookings(bookings, currentCustomer, null);
    }
    return filterCustomerBookings(bookings, null, customerPhone);
  }, [bookings, isCustomerPreviewMode, isCustomerAuthenticated, currentCustomer, customerPhone]);

  // 1. ACTIVE BOOKING (Highest Priority - Suppressed in Staff Customer Preview)
  const activeBooking = useMemo(() => {
    if (isCustomerPreviewMode) return null;
    const savedCode = typeof window !== 'undefined' ? localStorage.getItem('senzu_last_booking_code') : null;
    return getActiveBooking(customerBookings, savedCode);
  }, [isCustomerPreviewMode, customerBookings]);

  // 2. RECENT COMPLETED BOOKING (For Repeat Order - Suppressed in Staff Customer Preview)
  const recentCompletedBooking = useMemo(() => {
    if (isCustomerPreviewMode) return null;
    return (
      customerBookings
        .filter((b) => b.status === 'Completed' || (b.status as any) === 'completed')
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null
    );
  }, [isCustomerPreviewMode, customerBookings]);

  // 3. CUSTOMER'S RECENT ORDERS (Max 3, strictly aligned with Orders view)
  const recentCustomerBookings = useMemo(() => {
    if (isCustomerPreviewMode) return [];
    return customerBookings.slice(0, 3);
  }, [isCustomerPreviewMode, customerBookings]);

  // 4. FAVORITE SERVICE (From CRM or most booked)
  const favoriteService = useMemo(() => {
    if (isCustomerPreviewMode) return null;
    const list = safeServices;
    if (crmCustomer?.favoriteServiceId) {
      const found = list.find((s) => s.id === crmCustomer.favoriteServiceId);
      if (found) return found;
    }
    if (recentCompletedBooking) {
      return list.find((s) => s.id === recentCompletedBooking.serviceId) || null;
    }
    return null;
  }, [isCustomerPreviewMode, crmCustomer, recentCompletedBooking, safeServices]);

  // Greeting name derivation (Strictly neutral in Staff Customer Preview)
  const greetingName = useMemo(() => {
    if (isCustomerPreviewMode) return '';
    const rawName = (isCustomerAuthenticated && currentCustomer ? (currentCustomer.displayName || currentCustomer.name) : '') || crmCustomer?.name || localCustomerName || '';
    if (!rawName) return '';
    const first = rawName.trim().split(' ')[0] || '';
    if (!first) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }, [isCustomerPreviewMode, isCustomerAuthenticated, currentCustomer, crmCustomer, localCustomerName]);

  // Status visual configuration (Exact mapping required)
  const getStatusVisual = (status: string) => {
    switch (status) {
      case 'pending_payment':
      case 'awaiting_payment':
        return {
          label: 'Menunggu Pembayaran',
          badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
          dotClass: 'bg-amber-500',
        };
      case 'pending_verification':
        return {
          label: 'Verifikasi Pembayaran',
          badgeClass: 'bg-amber-50 text-amber-900 border-amber-300',
          dotClass: 'bg-amber-500',
        };
      case 'confirmed':
        return {
          label: 'Booking Dikonfirmasi',
          badgeClass: 'bg-blue-50 text-[#4B2B18] border-[#D4AF37]/50',
          dotClass: 'bg-[#D4AF37]',
        };
      case 'assigned':
      case 'therapist_assigned':
        return {
          label: 'Terapis Ditugaskan',
          badgeClass: 'bg-sky-50 text-[#4B2B18] border-sky-300',
          dotClass: 'bg-sky-600',
        };
      case 'on_the_way':
        return {
          label: 'Terapis Menuju Lokasi',
          badgeClass: 'bg-[#FDF3CD] text-[#4B2B18] border-[#D4AF37] font-bold',
          dotClass: 'bg-[#D4AF37] animate-ping',
        };
      case 'arrived':
        return {
          label: 'Terapis Tiba di Lokasi',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
          dotClass: 'bg-emerald-600',
        };
      case 'in_progress':
        return {
          label: 'Sedang Treatment',
          badgeClass: 'bg-[#8B5A36] text-[#FDF3CD] border-[#D4AF37]',
          dotClass: 'bg-[#D4AF37] animate-pulse',
        };
      case 'completed':
        return {
          label: 'Selesai',
          badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          dotClass: 'bg-emerald-500',
        };
      case 'cancelled':
        return {
          label: 'Dibatalkan',
          badgeClass: 'bg-red-50 text-red-800 border-red-200',
          dotClass: 'bg-red-500',
        };
      default:
        return {
          label: 'Diproses',
          badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
          dotClass: 'bg-slate-400',
        };
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6 pb-28 max-w-2xl mx-auto px-1 sm:px-0">
      {/* 1. GREETING & LOCATION SECTION */}
      <section className="space-y-2 px-1 pt-1">
        {isCustomerPreviewMode && (
          <div
            id="badge-customer-preview-mode"
            className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[#4B2B18]"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-semibold text-[#4B2B18]">
                Mode Pratinjau Tampilan Publik
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#8B5A36] text-[#FDF3CD]">
              Sesi Staf Aktif
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[#4B2B18] truncate tracking-tight">
              {greetingName ? `Halo, ${greetingName}` : 'Selamat datang di Senzu'}
            </h1>
            <p className="text-xs text-slate-500 truncate">
              Home Service Reflexology & Family Massage Palembang
            </p>
          </div>

          {/* Location Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/90 border border-slate-200/80 text-[11px] font-semibold text-[#4B2B18] shrink-0">
            <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Kota Palembang</span>
          </div>
        </div>
      </section>

      {/* 2. ACTIVE BOOKING CARD (TOP PRIORITY - Highest hierarchy if active) */}
      {activeBooking && (
        <section
          id="active-booking-card"
          className="rounded-2xl sm:rounded-3xl p-4 sm:p-5 bg-gradient-to-br from-[#5B351F] via-[#70442A] to-[#3D2315] text-white border-2 border-[#D4AF37]/50 shadow-xl space-y-3 relative overflow-hidden transition"
        >
          {/* Subtle Background Glow */}
          <div className="absolute top-0 right-0 w-36 h-36 bg-[#D4AF37]/10 rounded-full blur-2xl pointer-events-none" />

          {/* Top Row: Code & Status */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4AF37] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#D4AF37]"></span>
              </span>
              <span className="text-[11px] font-mono font-bold tracking-wider text-[#FDF3CD] uppercase">
                Pesanan Aktif • #{activeBooking.bookingCode}
              </span>
            </div>

            {/* Status Badge */}
            {(() => {
              const statusCfg = getStatusVisual(activeBooking.status);
              return (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold border shadow-xs ${statusCfg.badgeClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotClass}`} />
                  <span>{statusCfg.label}</span>
                </span>
              );
            })()}
          </div>

          {/* Booking Info: Service Name & Schedule */}
          <div>
            <h3 className="font-serif font-bold text-base sm:text-lg text-white leading-snug">
              {activeBooking.serviceName}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 mt-1">
              <span className="flex items-center gap-1 font-medium">
                <Calendar className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{formatDateIndo(activeBooking.scheduleDate)}</span>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono font-semibold">
                <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{activeBooking.scheduleTime} WIB</span>
              </span>
              {activeBooking.therapistName && (
                <>
                  <span>•</span>
                  <span className="text-[#FDF3CD] font-medium">
                    Terapis: {activeBooking.therapistName}
                  </span>
                </>
              )}
            </div>

            {(activeBooking.status === 'On The Way' || (activeBooking.status as any) === 'on_the_way') && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 text-[#FDF3CD] border border-[#D4AF37]/40 text-xs font-semibold">
                <Navigation className="w-3.5 h-3.5 text-[#D4AF37] animate-pulse" />
                <span>Terapis Sedang Menuju Lokasi Anda</span>
              </div>
            )}

            {/* If waiting payment, highlight amount & payment action */}
            {activeBooking.status === 'Menunggu Pembayaran' && (
              <div className="mt-2.5 p-3 rounded-2xl bg-black/25 border border-amber-300/30 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Total Tagihan:</span>
                  <span className="font-mono font-bold text-sm text-[#FDF3CD]">
                    {formatRupiah(activeBooking.totalAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-300 text-[11px]">
                  <span>Metode:</span>
                  <span className="font-medium text-white">{activeBooking.paymentMethod}</span>
                </div>
              </div>
            )}
          </div>

          {/* Action CTAs */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            {activeBooking.status === 'Menunggu Pembayaran' && (
              <button
                id="btn-active-pay"
                type="button"
                onClick={() => {
                  if (onOpenPayment) onOpenPayment(activeBooking);
                  else setPayingBooking(activeBooking);
                }}
                className="w-full py-2.5 min-h-[44px] rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-[#4B2B18] font-bold text-xs sm:text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CreditCard className="w-4 h-4 text-[#4B2B18]" />
                <span>Lanjutkan Pembayaran Sekarang</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                id="btn-active-track"
                type="button"
                onClick={() => onOpenTracking(activeBooking.bookingCode)}
                className={`px-3.5 py-2.5 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${
                  activeBooking.status === 'Menunggu Pembayaran'
                    ? 'bg-white/15 hover:bg-white/20 text-white border border-white/20'
                    : 'bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#4B2B18]'
                }`}
              >
                <Search className="w-4 h-4" />
                <span>Lacak Pesanan</span>
              </button>

              <button
                id="btn-active-detail"
                type="button"
                onClick={() => {
                  if (onOpenOrders) onOpenOrders();
                  else onOpenTracking(activeBooking.bookingCode);
                }}
                className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white font-semibold text-xs sm:text-sm border border-white/20 transition active:scale-95 flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>Detail Order</span>
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </button>
            </div>

            {/* Contextual In-App Chat Terapis CTA when therapist assigned */}
            {onOpenChat && (
              <div className="pt-1">
                <ChatButtonWithBadge
                  booking={activeBooking}
                  userRole="customer"
                  onOpenChat={onOpenChat}
                  variant="compact"
                  label="Chat Terapis"
                  className="w-full justify-center py-2"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. PRIMARY HERO / BOOKING CTA (Compact & Focused) */}
      <section
        id="hero-booking-cta"
        className="relative rounded-2xl sm:rounded-3xl overflow-hidden bg-gradient-to-br from-[#5B351F] via-[#70442A] to-[#3D2315] text-white p-5 sm:p-6 shadow-md border border-[#D4AF37]/35"
      >
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-1.5 bg-[#D4AF37]/15 border border-[#D4AF37]/35 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-[#FDF3CD]">
            <Sparkles className="w-3 h-3 text-[#D4AF37]" />
            <span>Reflexology & Family Massage</span>
          </div>

          <div>
            <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-white leading-tight">
              Wellness Senzu,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FDF3CD] via-[#D4AF37] to-[#B89628]">
                langsung ke rumah.
              </span>
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed mt-1 max-w-md">
              Reflexology & Family Massage dengan terapis profesional di Kota Palembang.
            </p>
          </div>

          {/* Dual Action CTAs */}
          <div className="pt-1.5 grid grid-cols-2 gap-2.5">
            <button
              id="btn-hero-order-now"
              type="button"
              onClick={() => onStartBooking()}
              className="px-4 py-3 min-h-[46px] rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#4B2B18] font-bold text-xs sm:text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-[#4B2B18]" />
              <span>Pesan Sekarang</span>
            </button>

            <button
              id="btn-hero-track-booking"
              type="button"
              onClick={() => onOpenTracking()}
              className="px-4 py-3 min-h-[46px] rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 text-white font-semibold text-xs sm:text-sm border border-white/20 transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Search className="w-4 h-4 text-[#D4AF37]" />
              <span>Lacak Booking</span>
            </button>
          </div>
        </div>
      </section>

      {/* 4. QUICK SERVICES ("Layanan Senzu") */}
      <section id="services-section" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="font-serif font-bold text-base sm:text-lg text-[#4B2B18] flex items-center gap-1.5">
              <span>Layanan Senzu</span>
              <span className="text-[10px] font-sans font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                Home Service
              </span>
            </h2>
            <p className="text-[11px] text-slate-500">
              Pilih treatment untuk langsung reservasi ke lokasi Anda
            </p>
          </div>

          <button
            type="button"
            onClick={() => onStartBooking()}
            className="text-xs font-bold text-[#4B2B18] hover:text-[#D4AF37] flex items-center gap-0.5 cursor-pointer select-none"
          >
            <span>Semua</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Services Cards Grid (Clean, Touch-Friendly, Tapping selects service) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(safeServices || []).slice(0, 4).map((srv) => (
            <div
              key={srv.id}
              onClick={() => onStartBooking(srv.id)}
              className="bg-white p-4 rounded-2xl border border-slate-200/90 hover:border-[#D4AF37] shadow-sm hover:shadow-md transition active:scale-[0.99] cursor-pointer flex flex-col justify-between relative group"
            >
              {srv.isPopular && (
                <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[9px] font-black uppercase tracking-wider shadow-xs flex items-center gap-1">
                  <Star className="w-2.5 h-2.5 fill-white" />
                  <span>Favorit</span>
                </span>
              )}

              <div>
                <div className="flex items-center gap-2.5 mb-1.5">
                  <div className="w-8 h-8 rounded-xl bg-[#8B5A36]/10 text-[#4B2B18] flex items-center justify-center font-serif font-bold text-sm shrink-0">
                    {srv.name.charAt(0)}
                  </div>
                  <div className="min-w-0 pr-12">
                    <h3 className="font-bold text-xs sm:text-sm text-[#4B2B18] group-hover:text-[#633C24] transition truncate">
                      {srv.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                      <Clock className="w-3 h-3 text-[#D4AF37]" />
                      <span>{srv.duration} Menit</span>
                      <span>•</span>
                      <span>Home Service</span>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed mt-1">
                  {srv.description || 'Pijat relaksasi & refleksi profesional langsung ke hunian Anda.'}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-slate-400 uppercase font-semibold block">Tarif</span>
                  <span className="font-mono font-bold text-sm text-[#4B2B18]">
                    {formatRupiah(srv.price)}
                  </span>
                </div>

                <button
                  type="button"
                  className="px-3 py-1.5 rounded-xl bg-slate-100 group-hover:bg-[#8B5A36] text-slate-700 group-hover:text-white text-xs font-bold transition flex items-center gap-1 min-h-[36px]"
                >
                  <span>Pilih</span>
                  <ChevronRight className="w-3.5 h-3.5 text-[#D4AF37]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. REPEAT ORDER ("Pesan Lagi" - shown if customer has past completed treatment) */}
      {recentCompletedBooking && (
        <section
          id="repeat-order-section"
          className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 shadow-xs"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#8B5A36] text-[#D4AF37] flex items-center justify-center shrink-0 shadow-xs">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
                  Pesan Lagi
                </span>
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                  {recentCompletedBooking.serviceName}
                </p>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600 mt-0.5">
                  <span>Terakhir: {formatDateIndo(recentCompletedBooking.scheduleDate)}</span>
                  {recentCompletedBooking.therapistName && (
                    <>
                      <span>•</span>
                      <span>Terapis: {recentCompletedBooking.therapistName}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              id="btn-repeat-order"
              type="button"
              onClick={() => onRepeatBooking(recentCompletedBooking)}
              className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-[#FDF3CD] text-xs font-bold flex items-center gap-1.5 shrink-0 transition active:scale-95 cursor-pointer shadow-xs"
            >
              <span>Pesan Lagi</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#D4AF37]" />
            </button>
          </div>
        </section>
      )}

      {/* 6. FAVORITE TREATMENT (If customer has favorite service identified) */}
      {favoriteService && (
        <section
          id="favorite-treatment-section"
          className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/15 text-[#B89628] flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 fill-[#D4AF37] text-[#D4AF37]" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#4B2B18] block">
                Treatment Favorit Anda
              </span>
              <p className="text-xs sm:text-sm font-bold text-slate-800 truncate">
                {favoriteService.name}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {favoriteService.duration} Menit • {formatRupiah(favoriteService.price)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onStartBooking(favoriteService.id)}
            className="px-3 py-2 min-h-[40px] rounded-xl bg-slate-100 hover:bg-[#8B5A36] text-slate-800 hover:text-white text-xs font-bold flex items-center gap-1 shrink-0 transition active:scale-95 cursor-pointer"
          >
            <span>Pesan</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#D4AF37]" />
          </button>
        </section>
      )}

      {/* 7. SAVED ADDRESS QUICK ACCESS ("Lokasi Anda") */}
      {savedAddresses.length > 0 && (
        <section id="saved-address-section" className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-serif font-bold text-xs sm:text-sm text-[#4B2B18] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Lokasi Tersimpan Anda</span>
            </h2>
            {onOpenAccount && (
              <button
                type="button"
                onClick={onOpenAccount}
                className="text-[11px] font-bold text-[#4B2B18] hover:text-[#D4AF37] cursor-pointer"
              >
                Kelola Alamat
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(savedAddresses || []).slice(0, 2).map((addr) => (
              <div
                key={addr.id}
                onClick={() => onStartBooking()}
                className="p-3 rounded-xl bg-slate-50 border border-slate-200/90 hover:border-[#D4AF37]/60 transition cursor-pointer flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[#4B2B18]">{addr.label}</span>
                    {addr.isDefault && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800">
                        Utama
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">
                    {addr.address || addr.area}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 8. REWARDS SUMMARY (Displayed if customer has loyalty account) */}
      {loyaltyAccount && (
        <section
          id="rewards-summary-section"
          className="rounded-2xl p-4 bg-gradient-to-br from-[#8B5A36] to-[#94603B] text-white border border-[#D4AF37]/40 shadow-sm flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[#FDF3CD]">
                  Senzu Rewards
                </span>
                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-[#D4AF37] text-[#4B2B18]">
                  {loyaltyAccount.currentTierName}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="font-mono font-bold text-sm sm:text-base text-white">
                  {loyaltyAccount.pointsBalance.toLocaleString('id-ID')} Poin
                </span>
                {activeVoucherCount > 0 && (
                  <span className="text-[10px] text-amber-200">
                    • {activeVoucherCount} Voucher Siap Pakai
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            id="btn-view-rewards"
            type="button"
            onClick={onOpenRewards}
            className="px-3 py-2 min-h-[40px] rounded-xl bg-white/15 hover:bg-white/20 active:bg-white/25 text-[#FDF3CD] text-xs font-bold flex items-center gap-1 shrink-0 transition active:scale-95 cursor-pointer border border-white/20"
          >
            <span>Rewards</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#D4AF37]" />
          </button>
        </section>
      )}

      {/* 9. PROMO SECTION (Carousel / Compact Cards) */}
      <section id="promo-section" className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-serif font-bold text-xs sm:text-sm text-[#4B2B18] flex items-center gap-1.5">
            <Gift className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Promo & Penawaran Spesial</span>
          </h2>
          <button
            type="button"
            onClick={onOpenRewards}
            className="text-[11px] font-bold text-[#4B2B18] hover:text-[#D4AF37] flex items-center gap-0.5 cursor-pointer"
          >
            <span>Katalog</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-2 px-2 sm:mx-0 sm:px-0">
          {/* Dynamic Active Promos from Firestore */}
          {activePromos.length > 0 ? (
            activePromos.map((promo) => (
              <div
                key={promo.id || promo.code}
                className="min-w-[260px] sm:min-w-[280px] p-3.5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-amber-400/15 to-orange-500/10 border border-amber-300/80 shrink-0 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1 text-amber-800 text-[10px] font-extrabold uppercase tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <Ticket className="w-3.5 h-3.5 text-amber-600" />
                      <span>{promo.name || 'Promo Spesial'}</span>
                    </span>
                    {promo.firstOrderOnly && (
                      <span className="bg-amber-200/80 text-amber-900 text-[9px] px-1.5 py-0.5 rounded font-bold">
                        Order Pertama
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="font-bold text-xs text-[#4B2B18]">Kode: {promo.code}</p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyCode(promo.code || '');
                      }}
                      className="text-[10px] font-bold text-amber-900 bg-amber-200/70 hover:bg-amber-200 px-2 py-0.5 rounded-md cursor-pointer transition active:scale-95"
                    >
                      {copiedCode === promo.code ? 'Tersalin!' : 'Salin'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                    {promo.description ||
                      (promo.voucherType === 'percentage_discount' || promo.voucherType === 'percentage'
                        ? `Diskon ${promo.value}% (Maks. ${formatRupiah(promo.maximumDiscount || 0)})`
                        : `Potongan ${formatRupiah(promo.value)}`)}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-amber-200/60 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-medium">
                    {promo.minimumSpend ? `Min. ${formatRupiah(promo.minimumSpend)}` : 'Tanpa Minimum'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onStartBooking(undefined, promo.code)}
                    className="text-[11px] font-bold text-[#4B2B18] hover:text-[#D4AF37] flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Gunakan</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            /* Fallback Promo Card: New User Discount */
            <div
              onClick={() => onStartBooking(undefined, 'SENZUWELCOME')}
              className="min-w-[240px] sm:min-w-[260px] p-3.5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-amber-400/15 to-orange-500/10 border border-amber-300/80 cursor-pointer active:scale-95 transition shrink-0"
            >
              <div className="flex items-center gap-1.5 mb-1 text-amber-800 text-[10px] font-extrabold uppercase tracking-wide">
                <Ticket className="w-3.5 h-3.5 text-amber-600" />
                <span>Diskon Pengguna Baru</span>
              </div>
              <p className="font-bold text-xs text-[#4B2B18]">Kode: SENZUWELCOME</p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Potongan Rp 20.000 untuk treatment pertama Anda di Kota Palembang.
              </p>
            </div>
          )}

          {/* Promo Card 2: Referral */}
          <div
            onClick={onOpenRewards}
            className="min-w-[240px] sm:min-w-[260px] p-3.5 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-indigo-400/15 to-purple-500/10 border border-indigo-300/80 cursor-pointer active:scale-95 transition shrink-0"
          >
            <div className="flex items-center gap-1.5 mb-1 text-indigo-800 text-[10px] font-extrabold uppercase tracking-wide">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span>Ajak Teman (Referral)</span>
            </div>
            <p className="font-bold text-xs text-[#4B2B18]">Dapatkan 200 Poin</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Bagikan kode referral Anda dan raih saldo poin setiap teman selesai treatment.
            </p>
          </div>

          {/* Promo Card 3: Membership Tiers */}
          <div
            onClick={onOpenRewards}
            className="min-w-[240px] sm:min-w-[260px] p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-emerald-400/15 to-teal-500/10 border border-emerald-300/80 cursor-pointer active:scale-95 transition shrink-0"
          >
            <div className="flex items-center gap-1.5 mb-1 text-emerald-800 text-[10px] font-extrabold uppercase tracking-wide">
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              <span>Keuntungan Member</span>
            </div>
            <p className="font-bold text-xs text-[#4B2B18]">Cashback Poin Hingga 1.5x</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Nikmati diskon eksklusif dan prioritas terapis di level Silver, Gold & Platinum.
            </p>
          </div>
        </div>
      </section>

      {/* 10. RECENT ORDERS ("Pesanan Terakhir") */}
      <section id="recent-orders-section" className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="font-serif font-bold text-sm sm:text-base text-[#4B2B18]">
            Pesanan Terakhir
          </h2>
          {recentCustomerBookings.length > 0 && (
            <button
              type="button"
              onClick={onOpenOrders}
              className="text-xs font-bold text-[#4B2B18] hover:text-[#D4AF37] flex items-center gap-0.5 cursor-pointer"
            >
              <span>Riwayat</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {recentCustomerBookings.length > 0 ? (
          <div className="space-y-2.5">
            {(recentCustomerBookings || []).map((b) => {
              const statusCfg = getStatusVisual(b.status);
              return (
                <div
                  key={b.id || b.bookingCode}
                  className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#4B2B18] truncate">
                        {b.serviceName}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${statusCfg.badgeClass}`}
                      >
                        <span className={`w-1 h-1 rounded-full ${statusCfg.dotClass}`} />
                        <span>{statusCfg.label}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{formatDateIndo(b.scheduleDate)}</span>
                      <span>•</span>
                      <span className="font-mono">{b.scheduleTime} WIB</span>
                      <span>•</span>
                      <span className="font-mono font-semibold text-slate-700">
                        {formatRupiah(b.totalAmount || (b as any).price || 0)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenTracking(b.bookingCode)}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#4B2B18] text-xs font-semibold transition active:scale-95 cursor-pointer min-h-[36px]"
                    >
                      Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => onRepeatBooking(b)}
                      className="px-2.5 py-1.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-[#FDF3CD] text-xs font-bold transition active:scale-95 cursor-pointer min-h-[36px]"
                    >
                      Pesan Lagi
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-5 text-center space-y-2">
            <p className="text-xs text-slate-500">Belum ada riwayat pesanan.</p>
            <button
              type="button"
              onClick={() => onStartBooking()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#8B5A36] text-[#FDF3CD] text-xs font-bold shadow-xs hover:bg-[#94603B] transition cursor-pointer min-h-[40px]"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Pesan Treatment Pertama Anda</span>
            </button>
          </div>
        )}
      </section>

      {/* 11. WHY SENZU (Trust & Safety Section) */}
      <section id="why-senzu-section" className="space-y-3">
        <h2 className="font-serif font-bold text-sm sm:text-base text-[#4B2B18] px-1">
          Kenyamanan & Standar Senzu Home
        </h2>

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
            <div className="w-7 h-7 rounded-lg bg-[#8B5A36]/10 text-[#4B2B18] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-[#4B2B18]" />
            </div>
            <h3 className="font-bold text-slate-800 text-[11px] sm:text-xs">Terapis Terlatih</h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              Terverifikasi identitas, SOP spa higienis & bersertifikasi resmi.
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-[#B89628] flex items-center justify-center">
              <Navigation className="w-4 h-4 text-[#B89628]" />
            </div>
            <h3 className="font-bold text-slate-800 text-[11px] sm:text-xs">Tracking Pesanan</h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              Pantau estimasi waktu kedatangan terapis secara transparan.
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
            <div className="w-7 h-7 rounded-lg bg-[#F5E9DE] text-[#8B5A36] flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-[#8B5A36]" />
            </div>
            <h3 className="font-bold text-slate-800 text-[11px] sm:text-xs">Pembayaran Resmi</h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              Cashless aman via QRIS dinamis, BNI, Mandiri & BRI terverifikasi.
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-emerald-600" />
            </div>
            <h3 className="font-bold text-slate-800 text-[11px] sm:text-xs">Home Service Palembang</h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              Layanan langsung ke rumah, apartemen & hotel se-Kota Palembang.
            </p>
          </div>
        </div>
      </section>

      {/* 12. CUSTOMER SUPPORT CARD */}
      <section
        id="support-section"
        className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-2xs"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Phone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-xs sm:text-sm text-emerald-950">
              Butuh Bantuan?
            </h3>
            <p className="text-[10px] sm:text-[11px] text-emerald-800">
              Hubungi Customer Service Senzu untuk konsultasi treatment atau reservasi khusus.
            </p>
          </div>
        </div>

        {isAvailable && csWhatsAppUrl ? (
          <a
            id="btn-contact-cs"
            href={csWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs transition active:scale-95"
          >
            <span>Hubungi CS</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </a>
        ) : (
          <button
            id="btn-contact-cs"
            type="button"
            onClick={() => alert(unavailableNotice)}
            className="px-3.5 py-2.5 min-h-[44px] rounded-xl bg-emerald-600/80 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
            title={unavailableNotice}
          >
            <span>Hubungi CS</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </section>

      {/* Standalone Modal for Pending Payment */}
      {payingBooking && (
        <PendingPaymentCard
          booking={payingBooking}
          variant="modal"
          onClose={() => setPayingBooking(null)}
          onOpenTracking={(code) => {
            setPayingBooking(null);
            onOpenTracking(code);
          }}
        />
      )}
    </div>
  );
};
