import React, { useState } from 'react';
import {
  X,
  User,
  Phone,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { SenzuLogo } from './SenzuLogo';
import { TermsAndPrivacyModal } from './TermsAndPrivacyModal';

interface CustomerRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
  onSuccess?: () => void;
  initialName?: string;
  initialWhatsApp?: string;
  initialEmail?: string;
  initialAddress?: string;
  initialArea?: string;
  currentBookingCode?: string;
}

export const CustomerRegisterModal: React.FC<CustomerRegisterModalProps> = ({
  isOpen,
  onClose,
  onSwitchToLogin,
  onSuccess,
  initialName = '',
  initialWhatsApp = '',
  initialEmail = '',
  initialAddress = '',
  initialArea = '',
  currentBookingCode,
}) => {
  const { registerCustomer } = useCustomerAuth();

  const [name, setName] = useState(initialName);
  const [nickname, setNickname] = useState('');
  const [whatsapp, setWhatsapp] = useState(initialWhatsApp);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);

  // Sync initial props when opened
  React.useEffect(() => {
    if (isOpen) {
      if (initialName && !name) setName(initialName);
      if (initialWhatsApp && !whatsapp) setWhatsapp(initialWhatsApp);
      if (initialEmail && !email) setEmail(initialEmail);
      setErrorMessage(null);
    }
  }, [isOpen, initialName, initialWhatsApp, initialEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Client-side validations
    if (!name.trim() || name.trim().length < 2) {
      setErrorMessage('Masukkan nama lengkap Anda (minimal 2 karakter).');
      return;
    }
    const cleanPhone = whatsapp.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 9) {
      setErrorMessage('Masukkan nomor WhatsApp yang valid (minimal 9 digit).');
      return;
    }
    if (!email.trim() || !email.includes('@') || !email.includes('.')) {
      setErrorMessage('Masukkan alamat email yang valid.');
      return;
    }
    if (!password || password.length < 8) {
      setErrorMessage('Kata sandi harus minimal 8 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    if (!termsAccepted) {
      setErrorMessage('Anda wajib menyetujui Syarat & Ketentuan dan Kebijakan Privasi Senzu Home.');
      return;
    }

    setIsSubmitting(true);
    try {
      await registerCustomer({
        name: name.trim(),
        displayName: (nickname || name).trim(),
        nickname: nickname.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        termsAccepted,
        marketingConsent,
        defaultAddress: initialAddress,
        defaultArea: initialArea,
        currentBookingCode,
      });

      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err: any) {
      console.error('Registration error:', err);
      let msg = err.message || 'Terjadi kendala saat mendaftarkan akun. Silakan coba lagi.';
      if (err.code === 'auth/email-already-in-use') {
        msg = 'Email ini sudah terdaftar. Silakan masuk menggunakan kata sandi Anda atau pilih Lupa Kata Sandi.';
      } else if (err.code === 'auth/invalid-email') {
        msg = 'Format alamat email tidak valid.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Kata sandi terlalu mudah ditebak. Gunakan minimal 8 karakter kombinasi huruf dan angka.';
      }
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
        <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-[#D4AF37]/35 overflow-hidden">
          {/* Header */}
          <div className="p-5 bg-gradient-to-r from-[#5B351F] via-[#70442A] to-[#70442A] text-white flex items-center justify-between border-b border-[#D4AF37]/30 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shadow-xs">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-serif font-bold text-base sm:text-lg text-white leading-tight">
                  Daftar Akun Senzu Home
                </h3>
                <p className="text-[11px] text-slate-300">
                  {currentBookingCode
                    ? `Simpan pesanan #${currentBookingCode} ke akun Anda`
                    : 'Akses riwayat treatment, alamat, dan Senzu Rewards'}
                </p>
              </div>
            </div>

            <button
              type="button"
              id="btn-close-customer-register"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
              aria-label="Tutup"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body Form */}
          <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
            {/* Error banner */}
            {errorMessage && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">{errorMessage}</p>
                  {errorMessage.includes('sudah terdaftar') && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSwitchToLogin();
                      }}
                      className="text-xs font-bold text-[#4B2B18] underline cursor-pointer"
                    >
                      Masuk sekarang →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Context Notice for Post-Booking */}
            {currentBookingCode && (
              <div className="p-3 rounded-2xl bg-amber-50/80 border border-[#D4AF37]/40 text-[#5C4A3C] text-xs flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#B89628] shrink-0 mt-0.5" />
                <p>
                  Nama dan nomor WhatsApp telah disesuaikan dengan data booking Anda. Cukup buat kata sandi untuk mengaktifkan akun.
                </p>
              </div>
            )}

            {/* Nama Lengkap */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#4B2B18] flex items-center justify-between">
                <span>Nama Lengkap <span className="text-rose-500">*</span></span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Rina Maharani"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#5B351F] outline-none transition"
                />
              </div>
            </div>

            {/* Nama Panggilan / Nickname (Opsional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center justify-between">
                <span>Nama Panggilan <span className="text-[10px] text-slate-400 font-normal">(Opsional, untuk sapaan hangat terapis)</span></span>
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Contoh: Rina"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#5B351F] outline-none transition"
              />
            </div>

            {/* WhatsApp */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#4B2B18] flex items-center justify-between">
                <span>Nomor WhatsApp <span className="text-rose-500">*</span></span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  required
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="081272902321"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#5B351F] outline-none transition font-mono"
                />
              </div>
              <p className="text-[10px] text-slate-400">
                Digunakan untuk konfirmasi kedatangan terapis dan notifikasi layanan.
              </p>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#4B2B18] flex items-center justify-between">
                <span>Alamat Email <span className="text-rose-500">*</span></span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@email.com"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#5B351F] outline-none transition"
                />
              </div>
            </div>

            {/* Kata Sandi */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#4B2B18] flex items-center justify-between">
                <span>Kata Sandi <span className="text-rose-500">*</span></span>
                <span className="text-[10px] text-slate-400 font-normal">Minimal 8 karakter</span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#5B351F] outline-none transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Konfirmasi Kata Sandi */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#4B2B18] flex items-center justify-between">
                <span>Konfirmasi Kata Sandi <span className="text-rose-500">*</span></span>
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi kata sandi Anda"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#5B351F] outline-none transition"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Checkboxes */}
            <div className="pt-2 space-y-3 border-t border-slate-100">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  required
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded text-[#4B2B18] focus:ring-[#D4AF37] border-slate-300"
                />
                <span className="text-xs text-slate-600 leading-snug">
                  Saya menyetujui{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setIsTermsModalOpen(true);
                    }}
                    className="text-[#4B2B18] font-bold underline hover:text-[#D4AF37] transition"
                  >
                    Syarat & Ketentuan
                  </button>{' '}
                  dan{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setIsTermsModalOpen(true);
                    }}
                    className="text-[#4B2B18] font-bold underline hover:text-[#D4AF37] transition"
                  >
                    Kebijakan Privasi
                  </button>{' '}
                  Senzu Home.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-[#4B2B18] focus:ring-[#D4AF37] border-slate-300"
                />
                <span className="text-xs text-slate-500 leading-snug">
                  Saya bersedia menerima info promo diskon eksklusif dan voucher treatment Senzu Home.
                </span>
              </label>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                id="btn-submit-customer-register"
                disabled={isSubmitting}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#5B351F] to-[#70442A] hover:from-[#70442A] hover:to-[#70442A] text-white text-xs sm:text-sm font-bold shadow-md transition active:scale-98 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                    <span>Mendaftarkan Akun Anda...</span>
                  </>
                ) : (
                  <>
                    <span>Buat Akun Senzu Home</span>
                    <ChevronRight className="w-4 h-4 text-[#D4AF37]" />
                  </>
                )}
              </button>
            </div>

            {/* Switch to login */}
            <div className="text-center pt-2 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                Sudah memiliki akun pelanggan?{' '}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSwitchToLogin();
                  }}
                  className="font-bold text-[#4B2B18] hover:text-[#D4AF37] underline transition cursor-pointer ml-1"
                >
                  Masuk di sini
                </button>
              </p>
            </div>
          </form>
        </div>
      </div>

      {/* Terms & Privacy modal */}
      <TermsAndPrivacyModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
      />
    </>
  );
};
