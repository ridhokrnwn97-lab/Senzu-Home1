import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Phone,
  Calendar,
  Clock,
  MapPin,
  Star,
  Repeat,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Heart,
  Plus,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Coins,
  Gift,
  Tag,
  Ticket,
  Award,
  Users,
  Share2,
  Copy,
  Check,
  Zap
} from 'lucide-react';
import {
  Booking,
  CustomerLoyaltyAccount,
  CustomerVoucher,
  LoyaltyTransaction,
  MembershipTier,
  LoyaltySettings,
} from '../types';
import {
  CustomerCRM,
  CustomerReview,
  CustomerSavedAddress,
} from '../types/crm';
import {
  findCustomerByPhoneOrEmail,
  getCustomerSavedAddresses,
  saveCustomerAddress,
  getCustomerReviews,
  getReviewByBookingId,
} from '../lib/crmService';
import {
  getLoyaltyAccountByCustomerId,
  getOrCreateLoyaltyAccount,
  getLoyaltyTransactions,
  getCustomerVouchers,
  getMembershipTiers,
  getLoyaltySettings,
  checkAndIssueBirthdayReward,
} from '../lib/loyaltyService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { CustomerReviewModal } from './CustomerReviewModal';
import { CustomerComplaintModal } from './customer/CustomerComplaintModal';
import { HelpCircle } from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { filterCustomerBookings } from '../lib/bookingPersistenceService';

interface CustomerPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookings: Booking[];
  onRepeatBooking: (booking: Booking) => void;
  onOpenTracking: (bookingCode: string) => void;
}

export const CustomerPortalModal: React.FC<CustomerPortalModalProps> = ({
  isOpen,
  onClose,
  bookings = [],
  onRepeatBooking,
  onOpenTracking,
}) => {
  const { currentCustomer, isCustomerAuthenticated, isCustomerPreviewMode } = useCustomerAuth();
  const [phoneInput, setPhoneInput] = useState<string>(() => {
    if (isCustomerPreviewMode) return '';
    return currentCustomer?.phone || localStorage.getItem('senzu_customer_phone') || '';
  });
  const [customer, setCustomer] = useState<CustomerCRM | null>(null);
  const [customerBookings, setCustomerBookings] = useState<Booking[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<CustomerSavedAddress[]>([]);
  const [customerReviews, setCustomerReviews] = useState<CustomerReview[]>([]);
  const [activeTab, setActiveTab] = useState<'bookings' | 'wallet' | 'addresses' | 'reviews'>('bookings');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSearched, setIsSearched] = useState<boolean>(false);

  // Loyalty & Rewards State
  const [customerLoyalty, setCustomerLoyalty] = useState<CustomerLoyaltyAccount | null>(null);
  const [loyaltyTransactions, setLoyaltyTransactions] = useState<LoyaltyTransaction[]>([]);
  const [customerVouchers, setCustomerVouchers] = useState<CustomerVoucher[]>([]);
  const [membershipTiers, setMembershipTiers] = useState<MembershipTier[]>([]);
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
  const [copiedReferral, setCopiedReferral] = useState<boolean>(false);
  const [birthDateInput, setBirthDateInput] = useState<string>('');
  const [birthdayClaimStatus, setBirthdayClaimStatus] = useState<string | null>(null);

  // Review modal trigger
  const [selectedBookingForReview, setSelectedBookingForReview] = useState<Booking | null>(null);
  const [selectedBookingForComplaint, setSelectedBookingForComplaint] = useState<Booking | null>(null);
  const [reviewBookingMap, setReviewBookingMap] = useState<Record<string, CustomerReview>>({});

  // Add address modal / toggle
  const [showAddAddress, setShowAddAddress] = useState<boolean>(false);
  const [newLabel, setNewLabel] = useState<string>('Rumah');
  const [newAddress, setNewAddress] = useState<string>('');
  const [newArea, setNewArea] = useState<string>('Ilir Barat I');
  const [newNotes, setNewNotes] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      if (isCustomerPreviewMode && !phoneInput) return;
      const activePhone = currentCustomer?.phone || phoneInput;
      if (activePhone.trim().length >= 8) {
        handleLookupPhone(activePhone);
      }
    }
  }, [isOpen, currentCustomer?.id, isCustomerPreviewMode]);

  if (!isOpen) return null;

  const handleLookupPhone = async (phoneToLookup: string) => {
    if (!phoneToLookup.trim()) return;
    setIsLoading(true);
    setIsSearched(true);
    try {
      const cleanInput = phoneToLookup.replace(/[^0-9]/g, '');
      if (!isCustomerPreviewMode && cleanInput.length >= 8) {
        localStorage.setItem('senzu_customer_phone', cleanInput);
      }

      // Match bookings authoritatively using customer record and/or phone
      const matched = filterCustomerBookings(bookings, currentCustomer, cleanInput);
      setCustomerBookings(matched);

      // Fetch customer CRM record
      const custData = currentCustomer || (await findCustomerByPhoneOrEmail(phoneToLookup));
      setCustomer(custData);

      if (custData) {
        // Fetch addresses
        const addrs = await getCustomerSavedAddresses(custData.id);
        setSavedAddresses(addrs);

        // Fetch reviews
        const revs = await getCustomerReviews(custData.id);
        setCustomerReviews(revs);

        const revMap: Record<string, CustomerReview> = {};
        for (const r of revs) {
          revMap[r.bookingId] = r;
        }
        setReviewBookingMap(revMap);
      }

      // Fetch or auto-init loyalty account
      const custId = custData ? custData.id : `cust_${cleanInput}`;
      let loyaltyAcc = await getLoyaltyAccountByCustomerId(custId);
      if (!loyaltyAcc && (custData || matched.length > 0)) {
        loyaltyAcc = await getOrCreateLoyaltyAccount({
          id: custId,
          name: custData?.name || matched[0]?.customerName || 'Pelanggan Senzu',
          phone: phoneToLookup,
          whatsapp: phoneToLookup,
          email: custData?.email || matched[0]?.customerEmail,
        });
      }
      setCustomerLoyalty(loyaltyAcc);

      if (loyaltyAcc) {
        const [txs, vchs, tiers, settings] = await Promise.all([
          getLoyaltyTransactions(loyaltyAcc.customerId),
          getCustomerVouchers(loyaltyAcc.customerId),
          getMembershipTiers(),
          getLoyaltySettings(),
        ]);
        setLoyaltyTransactions(txs);
        setCustomerVouchers(vchs);
        setMembershipTiers(tiers);
        setLoyaltySettings(settings);
      }
    } catch (err) {
      console.error('Customer portal error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveNewAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !newAddress.trim()) return;

    try {
      const saved = await saveCustomerAddress({
        customerId: customer.id,
        label: newLabel,
        address: newAddress.trim(),
        area: newArea,
        addressNotes: newNotes.trim(),
        isDefault: savedAddresses.length === 0,
      });
      setSavedAddresses([saved, ...savedAddresses]);
      setShowAddAddress(false);
      setNewAddress('');
      setNewNotes('');
    } catch (err) {
      console.error('Save address error:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#8B5A36] to-[#94603B] text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg">Akun & Riwayat Treatment</h3>
              <p className="text-xs text-slate-300">
                Senzu Home Reflexology & Massage Palembang
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search or Switch WhatsApp Phone Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLookupPhone(phoneInput);
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="tel"
                placeholder="Masukkan Nomor WhatsApp Anda (contoh: 081272902321)"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#8B5A36] focus:border-transparent bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-[#8B5A36] text-white rounded-xl text-xs font-semibold hover:bg-[#94603B] transition disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? 'Mencari...' : 'Buka Akun'}
            </button>
          </form>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-5 flex-1">
          {isLoading ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <div className="w-8 h-8 border-2 border-[#8B5A36] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <span>Memuat data riwayat pelanggan...</span>
            </div>
          ) : !isSearched ? (
            <div className="text-center py-10 space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Search className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">Cari Riwayat Treatment Anda</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Ketik nomor WhatsApp yang Anda gunakan saat pemesanan untuk melihat riwayat treatment,
                melakukan repeat order dalam 1 klik, dan melihat ulasan.
              </p>
            </div>
          ) : customerBookings.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">Belum Ada Riwayat Pemesanan</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Nomor WhatsApp ini belum memiliki riwayat reservasi di Senzu Home Palembang.
              </p>
            </div>
          ) : (
            <>
              {/* Profile Card Summary */}
              <div className="bg-gradient-to-br from-[#8B5A36] via-[#94603B] to-[#94603B] rounded-2xl p-4 sm:p-5 text-white shadow-md relative overflow-hidden">
                <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-serif font-bold text-base sm:text-lg">
                        {customer?.name || customerBookings[0]?.customerName || 'Pelanggan Senzu'}
                      </h4>
                      {customerLoyalty?.currentTierName ? (
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          customerLoyalty.currentTierId === 'platinum'
                            ? 'bg-gradient-to-r from-purple-400 to-indigo-300 text-slate-900 shadow-sm'
                            : customerLoyalty.currentTierId === 'gold'
                            ? 'bg-[#D4AF37] text-[#4B2B18] shadow-sm font-black'
                            : customerLoyalty.currentTierId === 'silver'
                            ? 'bg-slate-200 text-slate-800'
                            : 'bg-amber-800/60 text-amber-200 border border-amber-500/30'
                        }`}>
                          ★ {customerLoyalty.currentTierName} TIER
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[10px]">
                          MEMBER SENZU
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-300 font-mono">
                      <span>{customer?.phone || phoneInput}</span>
                      {customerLoyalty?.memberNumber && (
                        <span className="px-1.5 py-0.5 rounded bg-white/10 text-[11px] text-amber-200">
                          {customerLoyalty.memberNumber}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-4 border-t sm:border-t-0 border-white/10 pt-2 sm:pt-0 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-300 block uppercase">Saldo Poin</span>
                      <span className="font-bold text-base text-[#D4AF37] flex items-center gap-1">
                        <Coins className="w-4 h-4 text-[#D4AF37]" />
                        {customerLoyalty?.pointsBalance || 0} Poin
                      </span>
                      <span className="text-[10px] text-slate-300 block">
                        ≈ {formatRupiah((customerLoyalty?.pointsBalance || 0) * (loyaltySettings?.pointValueInRupiah || loyaltySettings?.pointsPerCurrencyUnit || 100))}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-300 block uppercase">Total Treatment</span>
                      <span className="font-bold text-base text-white">
                        {customerBookings.filter((b) => b.status === 'Completed').length} Selesai
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-slate-200 gap-4 text-xs font-semibold overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setActiveTab('bookings')}
                  className={`pb-2.5 transition border-b-2 whitespace-nowrap cursor-pointer ${
                    activeTab === 'bookings'
                      ? 'border-[#8B5A36] text-[#4B2B18]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Riwayat Treatment ({customerBookings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('wallet')}
                  className={`pb-2.5 transition border-b-2 whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                    activeTab === 'wallet'
                      ? 'border-[#8B5A36] text-[#4B2B18]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Coins className="w-3.5 h-3.5 text-amber-500" />
                  <span>Poin & Rewards</span>
                  {customerLoyalty && (
                    <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                      {customerLoyalty.pointsBalance}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('addresses')}
                  className={`pb-2.5 transition border-b-2 whitespace-nowrap cursor-pointer ${
                    activeTab === 'addresses'
                      ? 'border-[#8B5A36] text-[#4B2B18]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Alamat Tersimpan ({savedAddresses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('reviews')}
                  className={`pb-2.5 transition border-b-2 whitespace-nowrap cursor-pointer ${
                    activeTab === 'reviews'
                      ? 'border-[#8B5A36] text-[#4B2B18]'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Ulasan Saya ({customerReviews.length})
                </button>
              </div>

              {/* TAB 1: BOOKINGS LIST */}
              {activeTab === 'bookings' && (
                <div className="space-y-3">
                  {(customerBookings || []).map((b) => {
                    const isCompleted = b.status === 'Completed';
                    const hasReview = !!reviewBookingMap[b.id];

                    return (
                      <div
                        key={b.id}
                        className="p-4 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition shadow-sm space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[#4B2B18]">
                                {b.bookingCode}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  b.status === 'Completed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : b.status === 'Cancelled'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {b.status}
                              </span>
                            </div>
                            <h5 className="font-bold text-slate-900 text-sm mt-1">
                              {b.serviceName}
                            </h5>
                          </div>

                          <div className="text-right">
                            <span className="font-serif font-bold text-sm text-[#4B2B18]">
                              {formatRupiah(b.totalAmount)}
                            </span>
                            <span className="block text-[10px] text-slate-400">
                              {b.paymentMethod}
                            </span>
                          </div>
                        </div>

                        {/* Booking Meta */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg">
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase">Jadwal</span>
                            <span>{formatDateIndo(b.scheduleDate)} • {b.scheduleTime} WIB</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase">Terapis</span>
                            <span>{b.therapistName || 'Belum Ditugaskan'}</span>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <span className="text-slate-400 block text-[9px] uppercase">Lokasi</span>
                            <span className="truncate block">{b.area}</span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenTracking(b.bookingCode);
                              onClose();
                            }}
                            className="text-xs text-[#4B2B18] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span>Lihat Detail & Tracking</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>

                          <div className="flex items-center gap-2">
                            {/* Pay Now Button if Unpaid */}
                            {b.status === 'Menunggu Pembayaran' && (
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenTracking(b.bookingCode);
                                  onClose();
                                }}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition flex items-center gap-1 cursor-pointer shadow-xs"
                              >
                                <span>Bayar Sekarang</span>
                              </button>
                            )}

                            {/* Rating Button if Completed */}
                            {isCompleted && (
                              hasReview ? (
                                <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-semibold">
                                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                  <span>{reviewBookingMap[b.id].overallRating}★ Telah Dinilai</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setSelectedBookingForReview(b)}
                                  className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                                >
                                  <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                                  <span>Beri Rating</span>
                                </button>
                              )
                            )}

                            {/* Complaint / Help Button */}
                            <button
                              type="button"
                              onClick={() => setSelectedBookingForComplaint(b)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                              title="Laporkan kendala atau minta bantuan untuk pesanan ini"
                            >
                              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                              <span>Bantuan</span>
                            </button>

                            {/* Repeat Order Button */}
                            {isCompleted && (
                              <button
                                type="button"
                                onClick={() => {
                                  onRepeatBooking(b);
                                  onClose();
                                }}
                                className="px-3.5 py-1.5 rounded-lg bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                              >
                                <Repeat className="w-3.5 h-3.5 text-[#D4AF37]" />
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

              {/* TAB 2: LOYALTY & REWARDS WALLET */}
              {activeTab === 'wallet' && (
                <div className="space-y-5 text-xs">
                  {/* Tier Overview & Progress Card */}
                  {(() => {
                    const currentTier = membershipTiers.find((t) => t.id === customerLoyalty?.currentTierId) || membershipTiers[0];
                    const currentIndex = membershipTiers.findIndex((t) => t.id === currentTier?.id);
                    const nextTier = currentIndex >= 0 && currentIndex < membershipTiers.length - 1 ? membershipTiers[currentIndex + 1] : null;

                    const spend = customerLoyalty?.qualifiedSpend || 0;
                    const bookingsCount = customerLoyalty?.qualifiedBookings || 0;

                    let spendPercent = 100;
                    let bookingsPercent = 100;
                    if (nextTier) {
                      spendPercent = Math.min(100, Math.round((spend / (nextTier.minimumSpend || 1)) * 100));
                      bookingsPercent = Math.min(100, Math.round((bookingsCount / (nextTier.minimumBookings || 1)) * 100));
                    }
                    const progressPercent = nextTier ? Math.max(spendPercent, bookingsPercent) : 100;

                    return (
                      <div className="p-4 rounded-2xl border border-[#D4AF37]/30 bg-gradient-to-r from-amber-50/70 to-orange-50/50 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-[#8B5A36] text-[#D4AF37] flex items-center justify-center font-bold">
                              <Award className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-bold text-[#4B2B18] text-sm flex items-center gap-1.5">
                                <span>Level Keanggotaan: {currentTier?.name || 'Member'}</span>
                                {currentTier?.discountPercentage ? (
                                  <span className="px-1.5 py-0.2 rounded bg-[#8B5A36] text-white text-[10px] font-mono">
                                    Diskon {currentTier.discountPercentage}%
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-[11px] text-slate-500">
                                {currentTier?.pointMultiplier && currentTier.pointMultiplier > 1
                                  ? `Pengali Poin ${currentTier.pointMultiplier}x • `
                                  : ''}
                                {currentTier?.birthdayBonusPoints
                                  ? `Bonus Ulang Tahun ${currentTier.birthdayBonusPoints} Poin`
                                  : 'Nikmati keuntungan setiap treatment'}
                              </p>
                            </div>
                          </div>
                          {customerLoyalty?.memberNumber && (
                            <span className="font-mono text-[11px] font-bold text-slate-500 bg-white/80 px-2 py-1 rounded-lg border border-slate-200">
                              {customerLoyalty.memberNumber}
                            </span>
                          )}
                        </div>

                        {/* Progress Bar to Next Tier */}
                        {nextTier ? (
                          <div className="bg-white/80 p-3 rounded-xl border border-amber-200/60 space-y-1.5">
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="text-slate-600 font-medium">
                                Progres ke Tier <strong className="text-[#4B2B18]">{nextTier.name}</strong>
                              </span>
                              <span className="font-bold text-[#4B2B18]">{progressPercent}%</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-amber-400 to-[#D4AF37] transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-slate-500 pt-0.5">
                              <span>
                                Belanja: {formatRupiah(spend)} / {formatRupiah(nextTier.minimumSpend)}
                              </span>
                              <span>
                                Pesanan: {bookingsCount} / {nextTier.minimumBookings} sesi
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="p-2.5 rounded-xl bg-purple-50 text-purple-900 text-[11px] font-semibold flex items-center gap-2 border border-purple-200">
                            <Sparkles className="w-4 h-4 text-purple-600 shrink-0" />
                            <span>Selamat! Anda berada di tingkat keanggotaan tertinggi Senzu Home.</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Poin Balance & Benefit Guide */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 text-[11px] font-medium">Saldo Poin Anda</span>
                        <Coins className="w-4 h-4 text-[#D4AF37]" />
                      </div>
                      <div className="font-serif font-black text-2xl text-[#4B2B18]">
                        {customerLoyalty?.pointsBalance || 0}{' '}
                        <span className="text-xs font-sans font-bold text-amber-600">Poin</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Setara dengan potongan{' '}
                        <strong className="text-emerald-700 font-bold">
                          {formatRupiah((customerLoyalty?.pointsBalance || 0) * (loyaltySettings?.pointValueInRupiah || loyaltySettings?.pointsPerCurrencyUnit || 100))}
                        </strong>{' '}
                        pada pemesanan treatment berikutnya.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                      <span className="text-slate-700 font-bold flex items-center gap-1.5 text-xs">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        Cara Menggunakan Poin:
                      </span>
                      <ul className="text-[11px] text-slate-500 space-y-1 list-disc pl-4">
                        <li>1 Poin = Potongan Rp {loyaltySettings?.pointValueInRupiah || loyaltySettings?.pointsPerCurrencyUnit || 100} langsung.</li>
                        <li>Dapat ditukarkan di halaman formulir booking online.</li>
                        <li>Maksimal penukaran hingga 30% dari total tagihan sesi.</li>
                        <li>Poin berlaku aktif selama 12 bulan sejak didapatkan.</li>
                      </ul>
                    </div>
                  </div>

                  {/* VOUCHER REWARDS */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h5 className="font-bold text-[#4B2B18] flex items-center gap-1.5 text-xs">
                        <Ticket className="w-4 h-4 text-emerald-600" />
                        Voucher Reward Saya ({customerVouchers.length})
                      </h5>
                    </div>

                    {customerVouchers.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-slate-400 text-xs">
                        Belum ada voucher aktif di akun Anda. Ikuti promo atau kumpulkan poin untuk mendapatkan voucher reward spesial.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {(customerVouchers || []).map((cv) => {
                          const isAvailable = cv.status === 'available';
                          const isUsed = cv.status === 'used';

                          return (
                            <div
                              key={cv.id}
                              className={`p-3 rounded-xl border transition space-y-2 ${
                                isAvailable
                                  ? 'bg-emerald-50/40 border-emerald-200 hover:border-emerald-300'
                                  : 'bg-slate-50 border-slate-200 opacity-70'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="font-bold text-slate-800 text-xs">{cv.voucherName}</div>
                                  <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200">
                                    {cv.voucherCode || 'AUTO'}
                                  </span>
                                </div>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                    isAvailable
                                      ? 'bg-emerald-600 text-white'
                                      : isUsed
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {isAvailable ? 'Tersedia' : isUsed ? 'Digunakan' : 'Kedaluwarsa'}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-600 space-y-0.5">
                                <div>
                                  Diskon:{' '}
                                  <strong className="text-emerald-700 font-bold">
                                    {cv.voucherType === 'percentage' || (cv.voucherType as any) === 'percentage_discount'
                                      ? `${cv.value}% (Maks ${formatRupiah(cv.maximumDiscount || 50000)})`
                                      : formatRupiah(cv.value)}
                                  </strong>
                                </div>
                                {cv.minimumSpend && cv.minimumSpend > 0 && (
                                  <div>Min. Transaksi: {formatRupiah(cv.minimumSpend)}</div>
                                )}
                                {cv.expiredAt && (
                                  <div className="text-[10px] text-slate-400">
                                    Berlaku s/d: {formatDateIndo(cv.expiredAt)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* REFERRAL PROGRAM */}
                  <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/60 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                          <Users className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="font-bold text-indigo-950 text-xs">Program Ajak Teman (Referral)</div>
                          <p className="text-[11px] text-indigo-700">
                            Bagikan kode referral Anda ke teman atau keluarga
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-indigo-900 bg-white/90 px-2 py-0.5 rounded-lg border border-indigo-200">
                        {customerLoyalty?.referralCount || 0} Teman Diundang
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-xl border border-indigo-200 flex items-center justify-between gap-2">
                      <div className="font-mono text-xs font-bold text-indigo-900 tracking-wider">
                        {customerLoyalty?.referralCode || 'SENZU-MEMBER'}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (customerLoyalty?.referralCode) {
                              navigator.clipboard.writeText(customerLoyalty.referralCode);
                              setCopiedReferral(true);
                              setTimeout(() => setCopiedReferral(false), 2000);
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                        >
                          {copiedReferral ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Tersalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Salin</span>
                            </>
                          )}
                        </button>
                        <a
                          href={`https://wa.me/?text=${encodeURIComponent(
                            `Halo! Dapatkan potongan diskon treatment refleksi & massage di Senzu Home Palembang dengan menggunakan kode referral saya: ${customerLoyalty?.referralCode || ''}. Pesan langsung di Senzu Home!`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1 transition shadow-sm"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </a>
                      </div>
                    </div>

                    <p className="text-[10px] text-indigo-800/80 leading-relaxed">
                      ★ Teman yang memakai kode Anda mendapatkan potongan <strong className="font-bold">Rp 20.000</strong> pada reservasi pertamanya. Anda otomatis menerima <strong className="font-bold">+50 Poin</strong> begitu treatment teman Anda selesai!
                    </p>
                  </div>

                  {/* BIRTHDAY BENEFIT */}
                  <div className="p-3.5 rounded-xl border border-pink-200 bg-pink-50/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Gift className="w-4 h-4 text-pink-600" />
                        <span className="font-bold text-pink-950 text-xs">Hadiah Ulang Tahun Spesial</span>
                      </div>
                      {customerLoyalty?.birthDate && (
                        <span className="text-[10px] text-pink-800 bg-white px-2 py-0.5 rounded border border-pink-200">
                          Tgl Lahir: {customerLoyalty.birthDate}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-pink-900/80">
                      Dapatkan bonus poin atau voucher treatment spesial di bulan ulang tahun Anda. Data tanggal lahir bersifat opsional dan dijaga kerahasiaannya.
                    </p>

                    {!customerLoyalty?.birthDate ? (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="date"
                          value={birthDateInput}
                          onChange={(e) => setBirthDateInput(e.target.value)}
                          className="p-1.5 bg-white border border-pink-200 rounded-lg text-xs text-slate-700"
                        />
                        <button
                          type="button"
                          disabled={!birthDateInput}
                          onClick={async () => {
                            if (!customerLoyalty || !birthDateInput) return;
                            const res = await checkAndIssueBirthdayReward(customerLoyalty.customerId, birthDateInput);
                            if (res) {
                              setBirthdayClaimStatus('Selamat! Hadiah bonus ulang tahun telah masuk ke saldo poin Anda.');
                              const acc = await getLoyaltyAccountByCustomerId(customerLoyalty.customerId);
                              if (acc) setCustomerLoyalty(acc);
                            } else {
                              setBirthdayClaimStatus('Tanggal lahir tersimpan! Hadiah otomatis diberikan saat bulan ulang tahun Anda tiba.');
                            }
                          }}
                          className="px-3 py-1.5 bg-pink-600 hover:bg-pink-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          Simpan Tanggal Lahir
                        </button>
                      </div>
                    ) : (
                      birthdayClaimStatus && (
                        <p className="text-[11px] text-emerald-800 font-semibold bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                          {birthdayClaimStatus}
                        </p>
                      )
                    )}
                  </div>

                  {/* TRANSACTION LEDGER */}
                  <div className="space-y-2">
                    <h5 className="font-bold text-[#4B2B18] text-xs flex items-center justify-between">
                      <span>Buku Mutasi Poin (Ledger)</span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        {loyaltyTransactions.length} transaksi tercatat
                      </span>
                    </h5>

                    {loyaltyTransactions.length === 0 ? (
                      <p className="text-[11px] text-slate-400 py-3 text-center border border-dashed border-slate-200 rounded-xl">
                        Belum ada mutasi poin di akun Anda.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {(loyaltyTransactions || []).map((tx) => {
                          const isPositive = tx.points > 0;
                          return (
                            <div
                              key={tx.id}
                              className="p-2.5 rounded-xl border border-slate-100 bg-white hover:border-slate-200 transition flex items-center justify-between text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-800 text-[11px]">{tx.reason}</div>
                                <div className="text-[10px] text-slate-400">
                                  {formatDateIndo(tx.createdAt)}
                                  {tx.bookingCode && ` • Kode: ${tx.bookingCode}`}
                                </div>
                              </div>
                              <div className="text-right">
                                <div
                                  className={`font-mono font-bold text-xs ${
                                    isPositive ? 'text-emerald-600' : 'text-rose-600'
                                  }`}
                                >
                                  {isPositive ? `+${tx.points}` : tx.points} Poin
                                </div>
                                <div className="text-[9px] text-slate-400 font-mono">
                                  Sisa: {tx.balanceAfter} Poin
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: SAVED ADDRESSES */}
              {activeTab === 'addresses' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">
                      Daftar Alamat Tersimpan Anda
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddAddress(!showAddAddress)}
                      className="px-3 py-1.5 rounded-lg bg-[#8B5A36] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Alamat</span>
                    </button>
                  </div>

                  {showAddAddress && (
                    <form onSubmit={handleSaveNewAddress} className="p-4 rounded-xl border border-[#8B5A36]/20 bg-slate-50 space-y-3">
                      <h5 className="text-xs font-bold text-[#4B2B18]">Form Tambah Alamat Baru</h5>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="block text-slate-600 mb-1">Label Alamat:</label>
                          <select
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                          >
                            <option value="Rumah">Rumah</option>
                            <option value="Kantor">Kantor</option>
                            <option value="Apartemen">Apartemen</option>
                            <option value="Kost">Kost</option>
                            <option value="Lainnya">Lainnya</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-600 mb-1">Kecamatan:</label>
                          <input
                            type="text"
                            value={newArea}
                            onChange={(e) => setNewArea(e.target.value)}
                            placeholder="Kecamatan di Palembang"
                            className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                          />
                        </div>
                      </div>

                      <div className="text-xs">
                        <label className="block text-slate-600 mb-1">Alamat Lengkap:</label>
                        <textarea
                          rows={2}
                          value={newAddress}
                          onChange={(e) => setNewAddress(e.target.value)}
                          placeholder="Jalan, nomor rumah, RT/RW, kelurahan..."
                          className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                          required
                        />
                      </div>

                      <div className="text-xs">
                        <label className="block text-slate-600 mb-1">Patokan / Catatan Akses:</label>
                        <input
                          type="text"
                          value={newNotes}
                          onChange={(e) => setNewNotes(e.target.value)}
                          placeholder="Dekat masjid, pagar hitam, lantai 2..."
                          className="w-full p-2 rounded-lg border border-slate-200 bg-white"
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setShowAddAddress(false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-1.5 rounded-lg bg-[#8B5A36] text-white text-xs font-bold"
                        >
                          Simpan Alamat
                        </button>
                      </div>
                    </form>
                  )}

                  {savedAddresses.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      Belum ada alamat tersimpan. Alamat akan otomatis tersimpan saat Anda melakukan booking.
                    </p>
                  ) : (
                    (savedAddresses || []).map((addr) => (
                      <div
                        key={addr.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#4B2B18] flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
                            {addr.label}
                            {addr.isDefault && (
                              <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                Utama
                              </span>
                            )}
                          </span>
                          <span className="text-slate-400 text-[10px]">{addr.area}</span>
                        </div>
                        <p className="text-slate-700 leading-relaxed">{addr.address}</p>
                        {addr.addressNotes && (
                          <p className="text-[11px] text-slate-500 italic">
                            Patokan: {addr.addressNotes}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 3: REVIEWS */}
              {activeTab === 'reviews' && (
                <div className="space-y-3">
                  {customerReviews.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Anda belum memberikan ulasan. Ulasan dapat diberikan pada treatment yang telah selesai.
                    </div>
                  ) : (
                    (customerReviews || []).map((rev) => (
                      <div
                        key={rev.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-800">{rev.serviceName}</span>
                            <span className="block text-[10px] text-slate-400 font-mono">
                              Kode: {rev.bookingCode}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-amber-500 font-bold">
                            <Star className="w-4 h-4 fill-amber-400" />
                            <span>{rev.overallRating}.0</span>
                          </div>
                        </div>

                        {rev.comment && (
                          <p className="text-slate-600 bg-slate-50 p-2 rounded-lg text-xs italic">
                            "{rev.comment}"
                          </p>
                        )}

                        {rev.tags && rev.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {(rev.tags || []).map((t) => (
                              <span
                                key={t}
                                className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Review Modal if triggered */}
      {selectedBookingForReview && (
        <CustomerReviewModal
          isOpen={true}
          onClose={() => setSelectedBookingForReview(null)}
          booking={selectedBookingForReview}
          onReviewSubmitted={(newRev) => {
            setReviewBookingMap((prev) => ({ ...prev, [newRev.bookingId]: newRev }));
            setCustomerReviews((prev) => [newRev, ...prev]);
            setSelectedBookingForReview(null);
          }}
        />
      )}

      {/* Complaint / Help Modal if triggered */}
      {selectedBookingForComplaint && (
        <CustomerComplaintModal
          booking={selectedBookingForComplaint}
          customerWhatsApp={phoneInput}
          onClose={() => setSelectedBookingForComplaint(null)}
        />
      )}
    </div>
  );
};
