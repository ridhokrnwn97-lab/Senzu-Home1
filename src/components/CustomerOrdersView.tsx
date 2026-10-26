import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  Search,
  RotateCcw,
  ChevronRight,
  ExternalLink,
  Phone,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileText,
  User,
  ShieldCheck,
  Check,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { Booking } from '../types';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import {
  filterCustomerBookings,
  phonesMatch,
  normalizePhoneDigits,
  reconcileCustomerBookingsInFirestore,
} from '../lib/bookingPersistenceService';
import {
  fetchCustomerBookingsAuthoritative,
  subscribeToCustomerBookings
} from '../lib/dbService';
import { formatDistanceDisplay } from '../lib/distanceFeeService';
import { PendingPaymentCard } from './customer/PendingPaymentCard';
import { BookingChatModal } from './chat/BookingChatModal';
import { ChatButtonWithBadge } from './chat/ChatButtonWithBadge';

export interface CustomerOrdersViewProps {
  bookings: Booking[];
  onOpenTracking: (code: string) => void;
  onRepeatBooking: (booking: Partial<Booking>) => void;
  onStartBooking: () => void;
  onOpenPayment?: (booking: Booking) => void;
}

export const CustomerOrdersView: React.FC<CustomerOrdersViewProps> = ({
  bookings = [],
  onOpenTracking,
  onRepeatBooking,
  onStartBooking,
  onOpenPayment,
}) => {
  const { currentCustomer, isCustomerAuthenticated, firebaseUser, isCustomerPreviewMode, isLoading: isAuthLoading } = useCustomerAuth();

  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'all'>('active');
  const [selectedBookingForDetail, setSelectedBookingForDetail] = useState<Booking | null>(null);
  const [payingBooking, setPayingBooking] = useState<Booking | null>(null);
  const [activeChatBooking, setActiveChatBooking] = useState<Booking | null>(null);

  const [localBookings, setLocalBookings] = useState<Booking[]>(bookings);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Authoritative current identity ref to safeguard against React closure stale values during account switching
  const currentAuthUidRef = useRef<string | undefined>(firebaseUser?.uid);
  useEffect(() => {
    currentAuthUidRef.current = firebaseUser?.uid;
  }, [firebaseUser?.uid]);

  // Sync props bookings into local state safely
  useEffect(() => {
    if (bookings && bookings.length > 0) {
      setLocalBookings((prev) => {
        const map = new Map<string, Booking>();
        prev.forEach((b) => map.set(b.id || b.bookingCode, b));
        bookings.forEach((b) => map.set(b.id || b.bookingCode, b));
        const merged = Array.from(map.values());
        merged.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        return merged;
      });
    }
  }, [bookings]);

  // Authoritative fetch function with explicit error state
  const loadAuthoritative = useCallback(async (isSilent = false) => {
    if (!firebaseUser && !isCustomerAuthenticated) return;
    const requestUid = firebaseUser?.uid;
    if (!isSilent) {
      setIsFetching(true);
      setFetchError(null);
    }
    try {
      const res = await fetchCustomerBookingsAuthoritative();
      // Guard against race condition: ignore stale response if user switched accounts or logged out
      if (!requestUid || requestUid !== currentAuthUidRef.current) return;
      if (res.success) {
        setLocalBookings(res.bookings || []);
        setFetchError(null);
      } else {
        if (!isSilent && localBookings.length === 0) {
          setFetchError(res.error || 'Riwayat pesanan belum dapat dimuat. Silakan coba lagi.');
        }
      }
    } catch (err: any) {
      if (!requestUid || requestUid !== currentAuthUidRef.current) return;
      if (!isSilent && localBookings.length === 0) {
        setFetchError('Riwayat pesanan belum dapat dimuat. Silakan coba lagi.');
      }
    } finally {
      if (requestUid && requestUid === currentAuthUidRef.current && !isSilent) {
        setIsFetching(false);
      }
    }
  }, [firebaseUser?.uid, isCustomerAuthenticated, localBookings.length]);

  // Realtime subscription & reconciliation hook (Phase 6 / Bug Fix 01)
  useEffect(() => {
    if (isCustomerPreviewMode) return;

    if (!firebaseUser && !isCustomerAuthenticated) {
      setLocalBookings([]);
      setFetchError(null);
      setIsFetching(false);
      return;
    }

    // Proactive authoritative fetch
    loadAuthoritative(false);

    // Scoped realtime listener with proper cleanup
    const authUid = firebaseUser?.uid || currentCustomer?.authUserId;
    const unsub = subscribeToCustomerBookings({
      authUid,
      customerId: currentCustomer?.id,
      customerWhatsApp: currentCustomer?.phone || currentCustomer?.whatsapp,
      onSuccess: (updated) => {
        // Discard update if account switched during realtime stream
        if (!authUid || authUid !== currentAuthUidRef.current) return;
        if (Array.isArray(updated)) {
          setLocalBookings(updated);
          setFetchError(null);
        }
      },
      onError: (err) => {
        if (!authUid || authUid !== currentAuthUidRef.current) return;
        console.warn('[CustomerOrdersView] Realtime subscription notice:', err?.message);
        if (localBookings.length === 0) {
          setFetchError('Riwayat pesanan belum dapat dimuat. Silakan periksa koneksi dan coba lagi.');
        }
      },
    });

    return () => {
      if (unsub) unsub();
      // Instantly clear state on account switch or logout to avoid leaking state
      setLocalBookings([]);
    };
  }, [firebaseUser?.uid, currentCustomer?.id, isCustomerAuthenticated, isCustomerPreviewMode, loadAuthoritative]);

  // Helper to categorize active vs historical booking
  const isActiveBooking = useCallback((b: Booking) => {
    const s = (b.status || '').toLowerCase().trim();
    const ps = (b.paymentStatus || '').toLowerCase().trim();
    const isExp = ps === 'expired' || s === 'expired';
    if (isExp) return false;
    if (['completed', 'cancelled', 'rejected', 'refunded', 'selesai', 'batal'].includes(s)) return false;
    if (['payment_rejected', 'refunded'].includes(ps)) return false;
    return true;
  }, []);

  const isHistoryBooking = useCallback((b: Booking) => !isActiveBooking(b), [isActiveBooking]);

  // Combined authoritative bookings strictly scoped to verified identity
  const customerBookings = useMemo(() => {
    if (isCustomerPreviewMode) {
      return [];
    }
    const pool = localBookings.length > 0 ? localBookings : bookings;
    if (isCustomerAuthenticated || firebaseUser) {
      return filterCustomerBookings(pool, currentCustomer, null, firebaseUser?.uid);
    }
    return [];
  }, [localBookings, bookings, isCustomerPreviewMode, isCustomerAuthenticated, firebaseUser, currentCustomer]);

  const activeList = useMemo(() => customerBookings.filter(isActiveBooking), [customerBookings, isActiveBooking]);
  const historyList = useMemo(() => customerBookings.filter(isHistoryBooking), [customerBookings, isHistoryBooking]);
  const allList = customerBookings;

  const filteredBookings = useMemo(() => {
    if (activeTab === 'active') return activeList;
    if (activeTab === 'history') return historyList;
    return allList;
  }, [activeTab, activeList, historyList, allList]);

  // Status badge styling and text (Prompt Requirement 8)
  const getStatusBadge = (status: string, paymentStatus?: string) => {
    const ps = (paymentStatus || '').toLowerCase();
    if (ps === 'pending_manual_verification') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
          <Clock className="w-3 h-3 text-blue-600 animate-pulse" />
          <span>Pembayaran Sedang Diverifikasi</span>
        </span>
      );
    }
    if (ps === 'paid') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
          <Check className="w-3 h-3 text-emerald-600" />
          <span>Pembayaran Terverifikasi</span>
        </span>
      );
    }
    if (ps === 'payment_rejected') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-rose-600" />
          <span>Bukti Pembayaran Ditolak</span>
        </span>
      );
    }
    if (ps === 'expired' || (status || '').toLowerCase() === 'expired') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-slate-500" />
          <span>Waktu Pembayaran Berakhir</span>
        </span>
      );
    }

    const s = (status || '').toLowerCase().replace(/\s+/g, '_');
    if (s === 'completed') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Treatment Selesai</span>
        </span>
      );
    }
    if (s === 'cancelled') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
          <XCircle className="w-3 h-3 text-rose-600" />
          <span>Dibatalkan</span>
        </span>
      );
    }
    if (s === 'on_the_way') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 animate-pulse flex items-center gap-1">
          <Clock className="w-3 h-3 text-amber-700" />
          <span>Terapis Menuju Lokasi</span>
        </span>
      );
    }
    if (s === 'arrived') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-teal-100 text-teal-900 border border-teal-300 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-teal-700" />
          <span>Terapis Tiba</span>
        </span>
      );
    }
    if (s === 'treatment' || s === 'in_progress') {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-200 animate-pulse flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-purple-700" />
          <span>Sedang Treatment</span>
        </span>
      );
    }
    if (s.includes('menunggu_pembayaran') || s.includes('unpaid')) {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 flex items-center gap-1">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>Menunggu Pembayaran</span>
        </span>
      );
    }
    if (s.includes('pembayaran_terverifikasi') || s.includes('paid')) {
      return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
          <Check className="w-3 h-3 text-blue-600" />
          <span>Pembayaran Terverifikasi</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#8B5A36]/10 text-[#4B2B18] border border-[#8B5A36]/20">
        {status}
      </span>
    );
  };

  const handleStartPay = (b: Booking) => {
    if (onOpenPayment) {
      onOpenPayment(b);
    } else {
      setPayingBooking(b);
    }
  };

  return (
    <div className="space-y-4 pb-24 max-w-3xl mx-auto">
      {/* Header Card */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-3">
        {isCustomerPreviewMode && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[#4B2B18]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-semibold text-[#4B2B18]">
                Mode Pratinjau Pesanan Pelanggan
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#8B5A36] text-[#FDF3CD]">
              Sesi Staf Aktif
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif font-bold text-lg sm:text-xl text-[#4B2B18]">
              Pesanan Saya
            </h1>
            <p className="text-xs text-slate-500">
              Riwayat reservasi dan status pengerjaan terapis Senzu Home
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadAuthoritative(false)}
              disabled={isFetching}
              title="Segarkan riwayat pesanan"
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs transition active:scale-95 cursor-pointer disabled:opacity-50 flex items-center gap-1 font-semibold"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-[#4B2B18]' : ''}`} />
              <span className="hidden sm:inline text-[11px]">Segarkan</span>
            </button>
            <button
              type="button"
              onClick={onStartBooking}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] text-[#4B2B18] text-xs font-bold shadow-2xs hover:shadow-sm transition active:scale-95 cursor-pointer"
            >
              Pesan Baru
            </button>
          </div>
        </div>

        {/* Authenticated Customer Profile Notice or Guest Security Notice */}
        {isCustomerAuthenticated && currentCustomer ? (
          <div className="p-3 rounded-2xl bg-[#8B5A36]/5 border border-[#8B5A36]/15 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#8B5A36] text-[#FDF3CD] flex items-center justify-center font-bold text-xs shrink-0">
                {currentCustomer.name ? currentCustomer.name.slice(0, 2).toUpperCase() : 'SH'}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-[#4B2B18] truncate">
                    {currentCustomer.name}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-800">
                    Terverifikasi
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 block truncate font-mono">
                  WhatsApp: {currentCustomer.phone}
                </span>
              </div>
            </div>
          </div>
        ) : !isCustomerAuthenticated ? (
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-[#4B2B18] shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold text-slate-800">Privasi & Keamanan Riwayat Pesanan</p>
                <p className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">
                  Untuk melihat riwayat lengkap pesanan Anda, silakan masuk ke akun Senzu Home. Untuk melacak status pesanan tertentu tanpa login, gunakan Kode Booking melalui fitur Lacak Pesanan.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Canonical Filter Tabs: AKTIF, RIWAYAT, SEMUA (Requirement 5) */}
        <div className="flex border-b border-slate-100 gap-2 text-xs font-semibold overflow-x-auto no-scrollbar pt-1">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`pb-2.5 px-3 border-b-2 transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'active'
                ? 'border-[#8B5A36] text-[#4B2B18] font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span>AKTIF</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'active' ? 'bg-[#8B5A36] text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {activeList.length}
            </span>
            {activeList.some((b) => !['completed', 'cancelled'].includes((b.status || '').toLowerCase())) && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`pb-2.5 px-3 border-b-2 transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'history'
                ? 'border-[#8B5A36] text-[#4B2B18] font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span>RIWAYAT</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'history' ? 'bg-[#8B5A36] text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {historyList.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`pb-2.5 px-3 border-b-2 transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'all'
                ? 'border-[#8B5A36] text-[#4B2B18] font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <span>SEMUA</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeTab === 'all' ? 'bg-[#8B5A36] text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {customerBookings.length}
            </span>
          </button>
        </div>
      </div>

      {/* Loading State (Requirement 9: Differentiate LOADING, ERROR, EMPTY) */}
      {(isAuthLoading || (isFetching && customerBookings.length === 0)) ? (
        <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-3 shadow-2xs my-4 animate-in fade-in duration-200">
          <Loader2 className="w-8 h-8 text-[#4B2B18] animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Memuat riwayat pesanan Anda...</p>
        </div>
      ) : fetchError && customerBookings.length === 0 ? (
        /* Error State (Requirement 9) */
        <div className="bg-white rounded-3xl p-8 border border-rose-200 text-center space-y-3 shadow-2xs my-4 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="font-serif font-bold text-base text-[#4B2B18]">
            Riwayat Pesanan Belum Dapat Dimuat
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {fetchError}
          </p>
          <button
            type="button"
            onClick={() => loadAuthoritative(false)}
            className="px-5 py-2.5 rounded-2xl bg-[#8B5A36] text-white text-xs font-bold hover:bg-[#94603B] transition active:scale-95 shadow-sm inline-flex items-center gap-2 cursor-pointer mt-2"
          >
            <RotateCcw className="w-4 h-4 text-[#D4AF37]" />
            <span>Coba Lagi</span>
          </button>
        </div>
      ) : filteredBookings.length === 0 ? (
        /* Empty State (Requirement 9) */
        <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-3 shadow-2xs my-4 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="font-serif font-bold text-base text-[#4B2B18]">
            {activeTab === 'active'
              ? 'Belum Ada Pesanan Aktif'
              : activeTab === 'history'
              ? 'Belum Ada Riwayat Selesai'
              : 'Belum ada riwayat pemesanan.'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {isCustomerAuthenticated
              ? activeTab === 'active'
                ? 'Saat ini tidak ada pesanan aktif yang sedang berjalan. Jadwalkan treatment refleksi & massage keluarga sekarang!'
                : activeTab === 'history'
                ? 'Belum ada pesanan yang telah selesai atau dibatalkan.'
                : 'Belum ada riwayat pemesanan pada akun Anda. Jadwalkan treatment refleksi & massage keluarga sekarang!'
              : 'Silakan masuk ke akun Senzu Home Anda untuk melihat riwayat pesanan.'}
          </p>
          <button
            type="button"
            onClick={onStartBooking}
            className="px-5 py-2.5 rounded-2xl bg-[#8B5A36] text-white text-xs font-bold hover:bg-[#94603B] transition active:scale-95 shadow-sm inline-flex items-center gap-2 cursor-pointer mt-2"
          >
            <Sparkles className="w-4 h-4 text-[#D4AF37]" />
            <span>Pesan Treatment Sekarang</span>
          </button>
        </div>
      ) : (
        /* Booking Cards List */
        <div className="space-y-3">
          {(filteredBookings || []).map((b) => {
            const s = (b.status || '').toLowerCase();
            const psLower = (b.paymentStatus || '').toLowerCase();
            const isCompleted = s === 'completed';
            const isCancelled = s === 'cancelled';
            const isBookingExpired = psLower === 'expired' || s === 'expired';
            const isActive = !isCompleted && !isCancelled && !isBookingExpired;
            const isAwaitingPayment =
              !isBookingExpired &&
              (s.includes('menunggu_pembayaran') ||
                psLower === 'unpaid' ||
                psLower === 'pending') &&
              psLower !== 'pending_manual_verification' &&
              psLower !== 'paid';

            return (
              <div
                key={b.id}
                className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:border-[#D4AF37]/60 transition space-y-3"
              >
                {/* Top Row: Code & Status */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-[#4B2B18]">
                      {b.bookingCode}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {formatDateIndo(b.createdAt)}
                    </span>
                  </div>
                  <div>{getStatusBadge(b.status, isBookingExpired ? 'expired' : b.paymentStatus)}</div>
                </div>

                {/* Treatment Details */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <h3 className="font-bold text-sm text-[#4B2B18] truncate">
                      {b.serviceName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>{formatDateIndo(b.scheduleDate)}</span>
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>{b.scheduleTime} WIB</span>
                      </span>
                      <span>({b.serviceDuration} Menit)</span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-slate-500 truncate pt-0.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{b.area} — {b.address}</span>
                    </div>

                    {b.therapistName && (
                      <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md mt-1">
                        <User className="w-3 h-3 text-indigo-500" />
                        <span>Terapis: {b.therapistName}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-slate-400 block uppercase font-semibold">Total</span>
                    <span className="font-mono font-bold text-sm text-[#4B2B18]">
                      {formatRupiah(b.totalAmount)}
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate max-w-[120px]">
                      {b.paymentMethod}
                    </span>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedBookingForDetail(b)}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                  >
                    Detail
                  </button>

                  <div className="flex items-center gap-2">
                    {/* If awaiting payment, offer prominent Pay Now button */}
                    {isAwaitingPayment && (
                      <button
                        type="button"
                        onClick={() => handleStartPay(b)}
                        className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        <span>Bayar Sekarang</span>
                      </button>
                    )}

                    {isBookingExpired && (
                      <span className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-500 font-semibold text-[11px] border border-slate-200">
                        Waktu Pembayaran Berakhir
                      </span>
                    )}

                    {/* Chat Terapis Button (with live unread badge) */}
                    <ChatButtonWithBadge
                      booking={b}
                      userRole="customer"
                      onOpenChat={(booking) => setActiveChatBooking(booking)}
                    />

                    {isActive && (
                      <button
                        type="button"
                        onClick={() => onOpenTracking(b.bookingCode)}
                        className="px-3.5 py-1.5 rounded-xl bg-[#8B5A36] text-[#FDF3CD] hover:bg-[#94603B] font-bold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs"
                      >
                        <span>Lacak Pesanan</span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#D4AF37]" />
                      </button>
                    )}

                    {isCompleted && (
                      <button
                        type="button"
                        onClick={() => onRepeatBooking(b)}
                        className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] text-[#4B2B18] font-bold flex items-center gap-1 transition active:scale-95 cursor-pointer shadow-2xs"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#4B2B18]" />
                        <span>Pesan Lagi</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Booking Detail Modal */}
      {selectedBookingForDetail && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))] overflow-y-auto">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border-t sm:border border-slate-200 p-4 sm:p-5 space-y-4 max-h-[calc(100dvh-max(24px,env(safe-area-inset-top)+env(safe-area-inset-bottom)))] overflow-y-auto animate-in fade-in slide-in-from-bottom-2 sm:zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Detail Reservasi</span>
                <h4 className="font-mono font-bold text-sm text-[#4B2B18]">
                  #{selectedBookingForDetail.bookingCode}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBookingForDetail(null)}
                className="p-1.5 rounded-xl bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* If waiting payment, allow paying directly in detail modal */}
            {selectedBookingForDetail.status === 'Menunggu Pembayaran' ? (
              <div className="space-y-3">
                <PendingPaymentCard
                  booking={selectedBookingForDetail}
                  variant="card"
                  onOpenTracking={(code) => {
                    setSelectedBookingForDetail(null);
                    onOpenTracking(code);
                  }}
                />
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Layanan</span>
                  <p className="font-bold text-sm text-[#4B2B18]">
                    {selectedBookingForDetail.serviceName} ({selectedBookingForDetail.serviceDuration} Menit)
                  </p>
                  <p className="text-slate-600 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#D4AF37]" />
                    <span>
                      {formatDateIndo(selectedBookingForDetail.scheduleDate)} • {selectedBookingForDetail.scheduleTime} WIB
                    </span>
                  </p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Lokasi Layanan</span>
                  <p className="font-semibold text-slate-800">
                    {selectedBookingForDetail.address}
                  </p>
                  <p className="text-slate-500">
                    Kecamatan: <strong>{selectedBookingForDetail.area}</strong>
                  </p>
                  {selectedBookingForDetail.addressNotes && (
                    <p className="text-slate-500 italic">
                      Patokan: "{selectedBookingForDetail.addressNotes}"
                    </p>
                  )}
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Rincian Pembayaran</span>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tarif Treatment</span>
                    <span className="font-mono">{formatRupiah(selectedBookingForDetail.servicePrice || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      Home Service Fee {selectedBookingForDetail.distanceKm !== undefined ? `(${formatDistanceDisplay(selectedBookingForDetail.distanceKm)})` : ''}
                    </span>
                    <span className={`font-mono ${selectedBookingForDetail.homeServiceFee === 0 ? 'text-emerald-700 font-bold' : ''}`}>
                      {selectedBookingForDetail.homeServiceFee === 0 ? 'GRATIS' : formatRupiah(selectedBookingForDetail.homeServiceFee || 0)}
                    </span>
                  </div>
                  {selectedBookingForDetail.discountAmount ? (
                    <div className="flex justify-between text-emerald-600">
                      <span>Diskon / Promo</span>
                      <span className="font-mono">-{formatRupiah(selectedBookingForDetail.discountAmount)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-sm text-[#4B2B18]">
                    <span>Total Pembayaran</span>
                    <span className="font-mono">{formatRupiah(selectedBookingForDetail.totalAmount)}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 pt-1">
                    Metode: <strong>{selectedBookingForDetail.paymentMethod}</strong> • Status: {getStatusBadge(selectedBookingForDetail.status, selectedBookingForDetail.paymentStatus)}
                  </p>
                </div>
              </div>
            )}

            <div className="pt-2 flex flex-col sm:flex-row gap-2">
              <ChatButtonWithBadge
                booking={selectedBookingForDetail}
                userRole="customer"
                onOpenChat={(booking) => setActiveChatBooking(booking)}
                className="justify-center py-2.5"
              />
              <button
                type="button"
                onClick={() => {
                  const code = selectedBookingForDetail.bookingCode;
                  setSelectedBookingForDetail(null);
                  onOpenTracking(code);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#8B5A36] text-white text-xs font-bold hover:bg-[#94603B] transition cursor-pointer"
              >
                Lacak Status Pesanan
              </button>
              <button
                type="button"
                onClick={() => setSelectedBookingForDetail(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Realtime Booking Chat Modal (Section 5) */}
      {activeChatBooking && (
        <BookingChatModal
          isOpen={Boolean(activeChatBooking)}
          onClose={() => setActiveChatBooking(null)}
          booking={activeChatBooking}
          currentUserRole="customer"
          currentAuthUid={firebaseUser?.uid || currentCustomer?.authUserId || currentCustomer?.id || ''}
          currentDisplayName={currentCustomer?.displayName || currentCustomer?.name || 'Customer'}
        />
      )}

      {/* Standalone Paying Modal */}
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
