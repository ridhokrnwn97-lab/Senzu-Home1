import React, { useState, useEffect } from 'react';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Award,
  ShieldCheck,
  Headphones,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  LogOut,
  Sparkles,
  Plus,
  Trash2,
  Lock,
  CheckCircle2,
  AlertCircle,
  Edit3,
  FileText,
  Bookmark,
  Send,
  Loader2,
  UserX,
} from 'lucide-react';
import { CustomerSavedAddress } from '../types/crm';
import { getCustomerSavedAddresses } from '../lib/crmService';
import { useAuth } from '../context/AuthContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { PWAInstallActionItem } from './PWAInstallBanner';
import { SenzuLogo } from './SenzuLogo';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';
import { CustomerProfileEditModal } from './CustomerProfileEditModal';
import { CustomerAddressesModal } from './CustomerAddressesModal';
import { TermsAndPrivacyModal } from './TermsAndPrivacyModal';
import { CustomerLoginModal } from './CustomerLoginModal';
import { CustomerRegisterModal } from './CustomerRegisterModal';
import { CustomerAccountDeletionModal } from './CustomerAccountDeletionModal';

export interface CustomerAccountViewProps {
  onOpenOrders: () => void;
  onOpenRewards: () => void;
  onOpenLogin: () => void; // Staff login
  onOpenTracking: () => void;
  contactWhatsApp: string;
  onOpenCustomerLogin?: () => void;
  onOpenCustomerRegister?: () => void;
}

export const CustomerAccountView: React.FC<CustomerAccountViewProps> = ({
  onOpenOrders,
  onOpenRewards,
  onOpenLogin,
  onOpenTracking,
  contactWhatsApp,
  onOpenCustomerLogin,
  onOpenCustomerRegister,
}) => {
  const { currentUser, logout: logoutStaff } = useAuth();
  const {
    currentCustomer,
    firebaseUser,
    isCustomerAuthenticated,
    isCustomerPreviewMode,
    logoutCustomer,
    resendVerificationEmail,
  } = useCustomerAuth();

  const isStaffPreview = Boolean(currentUser || isCustomerPreviewMode);

  // Local fallback storage for guest users (strictly disabled in Staff Preview Mode)
  const [guestPhone, setGuestPhone] = useState(() => {
    if (isStaffPreview) return '';
    return localStorage.getItem('senzu_customer_phone') || '';
  });
  const [guestName, setGuestName] = useState(() => {
    if (isStaffPreview) return 'Tamu Senzu';
    return localStorage.getItem('senzu_customer_name') || 'Tamu Senzu';
  });

  const [savedAddresses, setSavedAddresses] = useState<CustomerSavedAddress[]>([]);
  const [isAddressesModalOpen, setIsAddressesModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [termsModalTab, setTermsModalTab] = useState<'terms' | 'privacy'>('terms');

  // Internal modals if callbacks not provided
  const [isCustomerLoginOpen, setIsCustomerLoginOpen] = useState(false);
  const [isCustomerRegisterOpen, setIsCustomerRegisterOpen] = useState(false);

  // Email verification feedback
  const [isResendingEmail, setIsResendingEmail] = useState(false);
  const [emailSentNotice, setEmailSentNotice] = useState<string | null>(null);

  // Logout confirm modal state
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  // Account deletion modal state (Google Play Compliance)
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);

  // Centralized Official Senzu Customer Service WhatsApp
  const { isAvailable, getWhatsAppUrl, displayWhatsApp, unavailableNotice } =
    useCustomerServiceWhatsApp();
  const csWhatsAppUrl = getWhatsAppUrl('Halo Senzu Home, saya butuh bantuan');

  // Fetch addresses when customer ID changes (disabled in staff preview)
  const activeCustomerId = isStaffPreview
    ? null
    : currentCustomer?.id || (guestPhone ? `cust_${guestPhone.replace(/[^0-9]/g, '')}` : null);

  useEffect(() => {
    if (isStaffPreview) {
      setSavedAddresses([]);
      setGuestPhone('');
      setGuestName('Tamu Senzu');
      return;
    }
    if (activeCustomerId) {
      getCustomerSavedAddresses(activeCustomerId)
        .then(setSavedAddresses)
        .catch(() => {});
    } else {
      setSavedAddresses([]);
    }
  }, [isStaffPreview, activeCustomerId, isAddressesModalOpen]);

  const handleOpenLogin = () => {
    if (onOpenCustomerLogin) {
      onOpenCustomerLogin();
    } else {
      setIsCustomerLoginOpen(true);
    }
  };

  const handleOpenRegister = () => {
    if (onOpenCustomerRegister) {
      onOpenCustomerRegister();
    } else {
      setIsCustomerRegisterOpen(true);
    }
  };

  const handleResendEmail = async () => {
    setIsResendingEmail(true);
    setEmailSentNotice(null);
    try {
      await resendVerificationEmail();
      setEmailSentNotice('Link verifikasi telah dikirimkan ke email Anda. Silakan periksa inbox atau spam.');
    } catch (err: any) {
      setEmailSentNotice('Gagal mengirim link verifikasi: ' + (err.message || 'Coba lagi nanti.'));
    } finally {
      setIsResendingEmail(false);
    }
  };

  const handleConfirmCustomerLogout = async () => {
    await logoutCustomer();
    setIsLogoutConfirmOpen(false);
  };

  const handleClearGuestSession = () => {
    if (window.confirm('Hapus sesi nomor telepon tersimpan di perangkat ini?')) {
      localStorage.removeItem('senzu_customer_phone');
      localStorage.removeItem('senzu_customer_name');
      localStorage.removeItem('senzu_last_booking_code');
      setGuestPhone('');
      setGuestName('Tamu Senzu');
      setSavedAddresses([]);
    }
  };

  const displayName = currentCustomer?.displayName || currentCustomer?.name || guestName;
  const displayPhone = currentCustomer?.phone || guestPhone;

  return (
    <div className="space-y-4 pb-24 max-w-3xl mx-auto">
      {isStaffPreview && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[#4B2B18]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
            <span className="text-xs font-semibold text-[#4B2B18]">
              Mode Pratinjau Tampilan Akun Pelanggan
            </span>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#8B5A36] text-[#FDF3CD]">
            Staf: {currentUser?.name || 'Aktif'}
          </span>
        </div>
      )}

      {/* 1. MEMBERSHIP / GUEST HEADER CARD */}
      {isCustomerAuthenticated && currentCustomer ? (
        // Authenticated Customer Membership Card
        <div className="bg-gradient-to-br from-[#FAF7F2] via-[#F5EFEB] to-[#EAE2D8] rounded-3xl p-5 sm:p-6 border border-[#D4AF37]/45 shadow-md space-y-4 relative overflow-hidden">
          {/* Subtle Zen Watermark */}
          <div className="absolute -right-10 -bottom-10 w-44 h-44 rounded-full border-2 border-[#D4AF37]/20 pointer-events-none" />
          <div className="absolute right-6 top-5 opacity-20 pointer-events-none hidden sm:block">
            <SenzuLogo variant="dark" size="small" className="h-8 w-auto max-w-[160px]" />
          </div>

          <div className="flex items-center justify-between relative z-10">
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#8B5A36] to-[#94603B] text-[#D4AF37] border-2 border-[#D4AF37]/60 flex items-center justify-center font-serif text-xl font-bold shadow-md">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-serif font-bold text-lg text-[#4B2B18]">
                    {displayName}
                  </h1>
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-[#8B5A36] text-[#FDF3CD] border border-[#D4AF37]/40 shadow-xs">
                    {currentCustomer.customerSegment === 'VIP' ? 'VIP Member' : 'Senzu Member'}
                  </span>
                </div>
                {currentCustomer.nickname && (
                  <p className="text-xs text-slate-500 font-medium">
                    Sapaan: {currentCustomer.nickname}
                  </p>
                )}
                <p className="text-xs text-[#5C4A3C] font-mono mt-0.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  {displayPhone ? `+62 ${displayPhone.replace(/^(\+62|62|0)/, '')}` : currentCustomer.email}
                </p>
              </div>
            </div>

            <button
              type="button"
              id="btn-edit-customer-profile"
              onClick={() => setIsProfileModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-white/90 hover:bg-white text-[#4B2B18] border border-[#D4AF37]/35 text-xs font-bold cursor-pointer transition shadow-xs flex items-center gap-1.5"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#B89628]" />
              <span>Ubah Profil</span>
            </button>
          </div>

          {/* Email verification alert if unverified */}
          {firebaseUser && !firebaseUser.emailVerified && (
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Email <strong>{firebaseUser.email}</strong> belum diverifikasi.
                </span>
              </div>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={isResendingEmail}
                className="px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-[11px] transition shrink-0 cursor-pointer disabled:opacity-50"
              >
                {isResendingEmail ? 'Mengirim...' : 'Kirim Ulang Email Verifikasi'}
              </button>
            </div>
          )}

          {emailSentNotice && (
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{emailSentNotice}</span>
            </div>
          )}

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#D4AF37]/25 text-center">
            <div className="p-2 rounded-xl bg-white/50 border border-white/60">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Total Treatment</p>
              <p className="font-serif font-bold text-sm sm:text-base text-[#4B2B18]">
                {currentCustomer.completedBookings || 0} Sesi
              </p>
            </div>
            <div className="p-2 rounded-xl bg-white/50 border border-white/60">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Alamat</p>
              <p className="font-serif font-bold text-sm sm:text-base text-[#4B2B18]">
                {savedAddresses.length} Tersimpan
              </p>
            </div>
            <div className="p-2 rounded-xl bg-white/50 border border-white/60">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Status Akun</p>
              <p className="font-serif font-bold text-xs sm:text-sm text-emerald-700 flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-600 inline" />
                <span>Aktif</span>
              </p>
            </div>
          </div>
        </div>
      ) : (
        // Unauthenticated / Guest Welcome Hero Card
        <div className="bg-gradient-to-br from-[#FAF7F2] via-[#F5EFEB] to-[#EAE2D8] rounded-3xl p-5 sm:p-6 border border-[#D4AF37]/45 shadow-md space-y-4 relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="space-y-1 max-w-lg">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100/80 border border-amber-300 text-[#5C4A3C] text-[10px] font-bold">
                <Sparkles className="w-3 h-3 text-[#B89628]" />
                <span>Pendaftaran Akun Opsional (Guest-First)</span>
              </div>
              <h2 className="font-serif font-bold text-lg sm:text-xl text-[#4B2B18]">
                Akun Pelanggan Senzu Home
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Anda tetap dapat memesan sebagai Tamu tanpa akun. Namun dengan mendaftarkan akun, Anda dapat menyimpan riwayat treatment, kelola alamat favorit, dan kumpulkan poin Senzu Rewards.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-[#D4AF37]/25">
            <button
              type="button"
              id="btn-open-customer-login"
              onClick={handleOpenLogin}
              className="w-full py-3 px-4 rounded-2xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs sm:text-sm font-bold shadow-md transition cursor-pointer flex items-center justify-center gap-2"
            >
              <User className="w-4 h-4 text-[#D4AF37]" />
              <span>Masuk ke Akun Saya</span>
            </button>

            <button
              type="button"
              id="btn-open-customer-register"
              onClick={handleOpenRegister}
              className="w-full py-3 px-4 rounded-2xl bg-white hover:bg-amber-50/60 text-[#4B2B18] border border-[#D4AF37]/60 text-xs sm:text-sm font-bold shadow-xs transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-[#B89628]" />
              <span>Daftar Akun Baru</span>
            </button>
          </div>

          {guestPhone && (
            <div className="pt-2 text-[11px] text-slate-500 flex items-center justify-between">
              <span>Sesi tamu aktif: +62 {guestPhone.replace(/^0/, '')}</span>
              <button
                type="button"
                onClick={handleClearGuestSession}
                className="text-slate-400 hover:text-rose-600 underline cursor-pointer"
              >
                Ganti nomor
              </button>
            </div>
          )}
        </div>
      )}

      {/* 2. MAIN MENU NAVIGATION */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
        {/* PWA Install Option */}
        <div className="p-3 bg-slate-50/50">
          <PWAInstallActionItem />
        </div>

        {/* Pesanan Saya */}
        <button
          type="button"
          id="btn-menu-orders"
          onClick={onOpenOrders}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#F5E9DE] text-[#8B5A36] flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-[#4B2B18]">Pesanan Saya</h4>
              <p className="text-[11px] text-slate-500">Lihat riwayat dan status booking aktif</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Alamat Tersimpan */}
        <button
          type="button"
          id="btn-menu-addresses"
          onClick={() => setIsAddressesModalOpen(true)}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-[#B89628] flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-xs sm:text-sm text-[#4B2B18]">Alamat Saya</h4>
                {savedAddresses.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                    {savedAddresses.length} Alamat
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {savedAddresses.find((a) => a.isDefault)?.address || 'Kelola alamat rumah dan kantor untuk pemesanan cepat'}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Rewards & Membership */}
        <button
          type="button"
          id="btn-menu-rewards"
          onClick={onOpenRewards}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-[#4B2B18]">Rewards & Membership</h4>
              <p className="text-[11px] text-slate-500">Saldo poin loyalty, tier level, dan voucher diskon</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Lacak Status Booking */}
        <button
          type="button"
          id="btn-menu-tracking"
          onClick={onOpenTracking}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-[#4B2B18]">Lacak Status Booking</h4>
              <p className="text-[11px] text-slate-500">Cek posisi terapis dan estimasi tiba realtime</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Customer Service WhatsApp */}
        {isAvailable && csWhatsAppUrl ? (
          <a
            id="btn-account-cs"
            href={csWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <Headphones className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-xs sm:text-sm text-emerald-950">Customer Service WhatsApp</h4>
                <p className="text-[11px] text-emerald-700">
                  Hubungi CS: {displayWhatsApp} (Konsultasi & Bantuan)
                </p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-emerald-600" />
          </a>
        ) : (
          <button
            id="btn-account-cs"
            type="button"
            onClick={() => alert(unavailableNotice)}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
                <Headphones className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-xs sm:text-sm text-slate-800">Customer Service WhatsApp</h4>
                <p className="text-[11px] text-amber-700">{unavailableNotice}</p>
              </div>
            </div>
            <ExternalLink className="w-4 h-4 text-slate-400" />
          </button>
        )}

        {/* Syarat & Ketentuan serta Kebijakan Privasi */}
        <button
          type="button"
          id="btn-menu-terms"
          onClick={() => {
            setTermsModalTab('terms');
            setIsTermsModalOpen(true);
          }}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-[#4B2B18]">
                Syarat & Ketentuan Layanan
              </h4>
              <p className="text-[11px] text-slate-500">
                Ketentuan home service, higienitas, dan operasional layanan
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Kebijakan Privasi (Google Play Compliance) */}
        <button
          type="button"
          id="btn-menu-privacy-policy"
          onClick={() => {
            window.history.pushState({}, '', '/kebijakan-privasi');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="w-full p-4 flex items-center justify-between hover:bg-slate-50/80 transition text-left cursor-pointer border-t border-slate-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-[#4B2B18]">
                Kebijakan Privasi
              </h4>
              <p className="text-[11px] text-slate-500">
                Transparansi pengumpulan data pribadi & kepatuhan Google Play
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>

        {/* Hapus Akun & Privasi Data (Google Play Compliance) */}
        <button
          type="button"
          id="btn-menu-delete-account"
          onClick={() => {
            if (isCustomerAuthenticated) {
              setIsDeleteAccountModalOpen(true);
            } else {
              window.history.pushState({}, '', '/hapus-akun');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          }}
          className="w-full p-4 flex items-center justify-between hover:bg-rose-50/50 transition text-left cursor-pointer border-t border-slate-100"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <UserX className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-slate-800">
                Hapus Akun & Privasi Data
              </h4>
              <p className="text-[11px] text-slate-500">
                Pengajuan penutupan akun dan penghapusan data pribadi Anda
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* 3. LOGOUT BUTTON FOR AUTHENTICATED CUSTOMER */}
      {isCustomerAuthenticated && (
        <div className="p-4 bg-white rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <h4 className="font-bold text-xs text-[#4B2B18]">Sesi Akun Pelanggan</h4>
            <p className="text-[11px] text-slate-500">
              Masuk sebagai {currentCustomer?.email}
            </p>
          </div>
          <button
            type="button"
            id="btn-logout-customer"
            onClick={() => setIsLogoutConfirmOpen(true)}
            className="px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Akun</span>
          </button>
        </div>
      )}

      {/* 4. SEPARATE STAFF PORTAL ACCESS */}
      <div className="bg-slate-50/80 rounded-3xl p-4 border border-slate-200 shadow-xs">
        {currentUser ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-800 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-xs text-[#4B2B18]">Staff: {currentUser.name}</p>
                <p className="text-[10px] text-[#D4AF37] uppercase font-bold tracking-wider">
                  Role: {currentUser.role}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={logoutStaff}
              className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition cursor-pointer"
            >
              Logout Staff
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-xs text-[#4B2B18]">Portal Khusus Staff</h4>
                <p className="text-[10px] text-slate-500">CSS, Supervisor, Terapis & Manajemen</p>
              </div>
            </div>

            <button
              type="button"
              id="btn-staff-login"
              onClick={onOpenLogin}
              className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-[#4B2B18] border border-slate-200 text-xs font-bold transition cursor-pointer shadow-2xs"
            >
              Login Staff
            </button>
          </div>
        )}
      </div>

      {/* MODALS */}
      {/* 1. Saved Addresses Modal */}
      {activeCustomerId && (
        <CustomerAddressesModal
          isOpen={isAddressesModalOpen}
          onClose={() => setIsAddressesModalOpen(false)}
          customerId={activeCustomerId}
        />
      )}

      {/* 2. Customer Profile Edit Modal */}
      {isCustomerAuthenticated && (
        <CustomerProfileEditModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      )}

      {/* 3. Terms & Privacy Modal */}
      <TermsAndPrivacyModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        defaultTab={termsModalTab}
      />

      {/* 4. Internal Customer Login Modal */}
      <CustomerLoginModal
        isOpen={isCustomerLoginOpen}
        onClose={() => setIsCustomerLoginOpen(false)}
        onSwitchToRegister={() => {
          setIsCustomerLoginOpen(false);
          setIsCustomerRegisterOpen(true);
        }}
        onOpenStaffLogin={() => {
          setIsCustomerLoginOpen(false);
          onOpenLogin();
        }}
      />

      {/* 5. Internal Customer Register Modal */}
      <CustomerRegisterModal
        isOpen={isCustomerRegisterOpen}
        onClose={() => setIsCustomerRegisterOpen(false)}
        onSwitchToLogin={() => {
          setIsCustomerRegisterOpen(false);
          setIsCustomerLoginOpen(true);
        }}
        initialName={guestName !== 'Tamu Senzu' ? guestName : ''}
        initialWhatsApp={guestPhone}
      />

      {/* 6. Customer Logout Confirmation Modal */}
      {isLogoutConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-serif font-bold text-base text-[#4B2B18]">
                Keluar dari Akun?
              </h3>
              <p className="text-xs text-slate-500">
                Anda akan keluar dari akun pelanggan Senzu Home di perangkat ini. Anda dapat masuk kembali kapan saja.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsLogoutConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmCustomerLogout}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-sm cursor-pointer"
              >
                Ya, Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Customer Account Deletion Modal (Google Play Compliance) */}
      {isCustomerAuthenticated && (
        <CustomerAccountDeletionModal
          isOpen={isDeleteAccountModalOpen}
          onClose={() => setIsDeleteAccountModalOpen(false)}
          onSuccess={() => {
            setIsDeleteAccountModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
