import React, { useState } from 'react';
import {
  X,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Sparkles,
  ChevronRight,
  Loader2,
  CheckCircle2,
  KeyRound,
  ArrowLeft,
} from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';

interface CustomerLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToRegister: () => void;
  onOpenStaffLogin?: () => void;
  onSuccess?: () => void;
}

export const CustomerLoginModal: React.FC<CustomerLoginModalProps> = ({
  isOpen,
  onClose,
  onSwitchToRegister,
  onOpenStaffLogin,
  onSuccess,
}) => {
  const { loginCustomer, sendPasswordReset } = useCustomerAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Mode: 'login' or 'forgot_password'
  const [mode, setMode] = useState<'login' | 'forgot_password'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setResetSuccessMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Masukkan alamat email yang valid.');
      return;
    }
    if (!password) {
      setErrorMessage('Masukkan kata sandi Anda.');
      return;
    }

    setIsSubmitting(true);
    try {
      await loginCustomer(cleanEmail, password);
      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err: any) {
      console.error('Customer login error:', err);
      let msg = err.message || 'Gagal masuk. Periksa kembali email dan kata sandi Anda.';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        msg = 'Email atau kata sandi tidak cocok. Silakan periksa kembali atau pilih Lupa Kata Sandi.';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Terlalu banyak percobaan gagal. Silakan tunggu beberapa saat atau reset kata sandi Anda.';
      }
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setResetSuccessMessage(null);

    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Masukkan alamat email yang valid.');
      return;
    }

    setIsSubmitting(true);
    try {
      await sendPasswordReset(cleanEmail);
      setResetSuccessMessage(
        `Link pemulihan kata sandi telah dikirim ke ${cleanEmail}. Silakan periksa kotak masuk atau spam email Anda.`
      );
    } catch (err: any) {
      console.error('Password reset error:', err);
      let msg = err.message || 'Gagal mengirim link reset kata sandi.';
      if (err.code === 'auth/user-not-found') {
        msg = 'Alamat email ini tidak terdaftar sebagai akun pelanggan Senzu Home.';
      }
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl border border-[#D4AF37]/35 overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-[#082A4F] via-[#0B3564] to-[#0D3866] text-white flex items-center justify-between border-b border-[#D4AF37]/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shadow-xs">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg text-white leading-tight">
                {mode === 'login' ? 'Masuk Akun Pelanggan' : 'Reset Kata Sandi'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {mode === 'login'
                  ? 'Senzu Reflexology & Family Massage'
                  : 'Pulihkan akses akun pelanggan Anda'}
              </p>
            </div>
          </div>

          <button
            type="button"
            id="btn-close-customer-login"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1.5 flex-1">
                <p className="font-semibold">{errorMessage}</p>
                {errorMessage.includes('Akun Staf') && onOpenStaffLogin && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenStaffLogin();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#082A4F] text-white text-[11px] font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>Buka Portal Staf</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#D4AF37]" />
                  </button>
                )}
              </div>
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#082A4F]">
                  Alamat Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[#082A4F]">
                    Kata Sandi
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(email);
                      setMode('forgot_password');
                      setErrorMessage(null);
                    }}
                    className="text-[11px] font-semibold text-[#082A4F] hover:text-[#D4AF37] underline transition cursor-pointer"
                  >
                    Lupa Kata Sandi?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi Anda"
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
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

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  id="btn-submit-customer-login"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#082A4F] to-[#0D3866] hover:from-[#0B3564] hover:to-[#10447C] text-white text-xs sm:text-sm font-bold shadow-md transition active:scale-98 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                      <span>Sedang Masuk...</span>
                    </>
                  ) : (
                    <>
                      <span>Masuk ke Akun Senzu</span>
                      <ChevronRight className="w-4 h-4 text-[#D4AF37]" />
                    </>
                  )}
                </button>
              </div>

              {/* Switch to register */}
              <div className="text-center pt-3 border-t border-slate-100 space-y-2">
                <p className="text-xs text-slate-500">
                  Belum memiliki akun pelanggan?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSwitchToRegister();
                    }}
                    className="font-bold text-[#082A4F] hover:text-[#D4AF37] underline transition cursor-pointer ml-1"
                  >
                    Daftar di sini
                  </button>
                </p>

                {onOpenStaffLogin && (
                  <p className="text-[11px] text-slate-400 pt-1">
                    Staf Senzu Home?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenStaffLogin();
                      }}
                      className="font-semibold text-slate-600 hover:text-[#082A4F] underline transition cursor-pointer ml-0.5"
                    >
                      Masuk Portal Staf
                    </button>
                  </p>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              {resetSuccessMessage ? (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-3">
                  <div className="flex items-center gap-2 font-bold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Email Pemulihan Terkirim</span>
                  </div>
                  <p className="leading-relaxed">{resetSuccessMessage}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setResetSuccessMessage(null);
                    }}
                    className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold transition text-xs cursor-pointer"
                  >
                    Kembali ke Halaman Masuk
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Masukkan alamat email yang terdaftar pada akun pelanggan Anda. Kami akan mengirimkan tautan untuk mengatur ulang kata sandi.
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-[#082A4F]">
                      Alamat Email Terdaftar
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="nama@email.com"
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 rounded-2xl bg-[#082A4F] hover:bg-[#0B3564] text-white text-xs font-bold transition active:scale-98 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                        <span>Mengirim Tautan...</span>
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-4 h-4 text-[#D4AF37]" />
                        <span>Kirim Link Reset Kata Sandi</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setErrorMessage(null);
                    }}
                    className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Batal dan kembali ke Masuk</span>
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
