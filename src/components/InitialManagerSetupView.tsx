import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  User,
  Mail,
  Phone,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Building2,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldAlert,
  Sparkles,
  HelpCircle,
  Wrench,
  ArrowLeft,
} from 'lucide-react';
import { SenzuLogo } from './SenzuLogo';

interface InitialManagerSetupViewProps {
  onComplete: (managerEmail: string) => void;
  onGoToLogin: () => void;
}

interface BootstrapStatus {
  canBootstrap: boolean;
  status: 'COMPLETED' | 'INCOMPLETE_AUTH' | 'READY_FOR_BOOTSTRAP' | 'CONFLICT' | string;
  message?: string;
  managerName?: string;
  managerEmail?: string;
  rawEmail?: string;
  staffId?: string;
  role?: string;
  needsReconciliation?: boolean;
}

export const InitialManagerSetupView: React.FC<InitialManagerSetupViewProps> = ({
  onComplete,
  onGoToLogin,
}) => {
  // Loading & bootstrap status
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus | null>(null);

  // Reconciliation mode
  const [isReconcileMode, setIsReconcileMode] = useState(false);

  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');

  // UI helpers
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSetupKey, setShowSetupKey] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successData, setSuccessData] = useState<any | null>(null);

  // Check setup status on mount
  const fetchStatus = async () => {
    setCheckingStatus(true);
    try {
      const res = await fetch('/api/bootstrap/status');
      if (res.ok) {
        const data: BootstrapStatus = await res.json();
        setBootstrapStatus(data);
      } else {
        setBootstrapStatus({
          canBootstrap: true,
          status: 'READY_FOR_BOOTSTRAP',
          message: 'Inisialisasi siap dilakukan.',
        });
      }
    } catch {
      setBootstrapStatus({
        canBootstrap: true,
        status: 'READY_FOR_BOOTSTRAP',
        message: 'Inisialisasi siap dilakukan.',
      });
    } finally {
      setCheckingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Password criteria calculations
  const hasMinLength = password.length >= 12;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isPasswordValid =
    hasMinLength && hasUpper && hasLower && hasNumber && hasSpecial && passwordsMatch;

  // Handle reconciliation submit
  const handleReconcileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!isPasswordValid) {
      setErrorMessage('Password tidak memenuhi syarat keamanan yang ditentukan (minimal 12 karakter kombinasi).');
      return;
    }

    if (!setupKey.trim()) {
      setErrorMessage('One-Time Setup Key wajib dimasukkan.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/bootstrap/reconcile-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupKey: setupKey.trim(),
          password,
          confirmPassword,
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        if (result.code === 'INVALID_SETUP_KEY') {
          setErrorMessage('Setup key tidak valid. Silakan periksa kunci rahasia server.');
        } else if (result.code === 'OPERATION_NOT_ALLOWED') {
          setErrorMessage('Login Email & Password belum diaktifkan pada konfigurasi Firebase. Aktifkan provider Email/Password di Firebase Console.');
        } else {
          setErrorMessage(result.message || 'Gagal merekonsiliasi akun Manager.');
        }
        setIsSubmitting(false);
        return;
      }

      setSuccessData(result.data);
      setBootstrapStatus({
        canBootstrap: false,
        status: 'COMPLETED',
        message: 'INITIAL SETUP ALREADY COMPLETED',
        managerName: result.data.name,
        managerEmail: result.data.email,
      });
    } catch {
      setErrorMessage('Terjadi gangguan koneksi ke server. Silakan pastikan server backend berjalan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle initial creation submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    // Pre-checks
    if (!fullName.trim() || fullName.trim().length < 3) {
      setErrorMessage('Nama lengkap harus diisi minimal 3 karakter.');
      return;
    }

    if (!email.trim() || !email.includes('@') || !email.includes('.')) {
      setErrorMessage('Format email login tidak valid.');
      return;
    }

    if (!phone.trim() || phone.replace(/[^0-9]/g, '').length < 8) {
      setErrorMessage('Nomor WhatsApp minimal 8 digit angka.');
      return;
    }

    if (!isPasswordValid) {
      setErrorMessage('Password tidak memenuhi syarat keamanan yang ditentukan.');
      return;
    }

    if (!setupKey.trim()) {
      setErrorMessage('One-Time Setup Key wajib dimasukkan.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/bootstrap/initial-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          password,
          confirmPassword,
          setupKey: setupKey.trim(),
        }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        if (result.code === 'ALREADY_COMPLETED') {
          setErrorMessage('Akun Manager sudah tersedia. Inisialisasi awal telah dinonaktifkan.');
          setBootstrapStatus({
            canBootstrap: false,
            status: 'COMPLETED',
            message: 'INITIAL SETUP ALREADY COMPLETED',
          });
        } else if (result.code === 'INCOMPLETE_AUTH') {
          setErrorMessage('Profil Manager sudah ada tetapi memerlukan rekonsiliasi akun login.');
          setBootstrapStatus({
            canBootstrap: false,
            status: 'INCOMPLETE_AUTH',
            message: 'Profil Manager ditemukan, tetapi akun login belum selesai dibuat.',
          });
        } else if (result.code === 'INVALID_SETUP_KEY') {
          setErrorMessage('Setup key tidak valid. Silakan periksa kunci rahasia server.');
        } else if (result.code === 'EMAIL_ALREADY_EXISTS') {
          setErrorMessage('Email sudah digunakan oleh akun lain. Gunakan email yang berbeda atau rekonsiliasi.');
        } else if (result.code === 'PASSWORD_REQUIREMENTS_NOT_MET' || result.code === 'PASSWORD_TOO_SHORT') {
          setErrorMessage('Password tidak memenuhi syarat keamanan (minimal 12 karakter kombinasi).');
        } else if (result.code === 'OPERATION_NOT_ALLOWED') {
          setErrorMessage('Login Email & Password belum diaktifkan pada konfigurasi Firebase.');
        } else {
          setErrorMessage(result.message || 'Gagal membuat akun Manager. Silakan coba kembali.');
        }
        setIsSubmitting(false);
        return;
      }

      // Success
      setSuccessData(result.data);
      setBootstrapStatus({
        canBootstrap: false,
        status: 'COMPLETED',
        message: 'INITIAL SETUP ALREADY COMPLETED',
        managerName: result.data.name,
        managerEmail: result.data.email,
      });
    } catch {
      setErrorMessage('Terjadi gangguan koneksi ke server. Silakan pastikan server backend berjalan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between selection:bg-[#D4AF37] selection:text-[#082A4F]">
      {/* Header Bar */}
      <header className="border-b border-white/10 bg-[#082A4F]/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SenzuLogo variant="light" size="small" className="h-8 w-auto" />
            <span className="text-xs text-white/40 hidden sm:inline">•</span>
            <span className="text-xs font-semibold tracking-wider text-[#D4AF37] uppercase hidden sm:inline">
              Production Setup
            </span>
          </div>
          <button
            type="button"
            onClick={onGoToLogin}
            className="text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 transition cursor-pointer px-3 py-1.5 rounded-lg hover:bg-white/5 border border-white/10"
          >
            <span>Ke Login Staff</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-6">
        <div className="w-full max-w-xl">
          {checkingStatus ? (
            /* Loading State */
            <div className="bg-slate-800/80 border border-white/10 rounded-3xl p-10 text-center space-y-4 shadow-xl">
              <div className="w-10 h-10 border-3 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-300">Memeriksa status inisialisasi Manager Senzu Home...</p>
            </div>
          ) : successData ? (
            /* SUCCESS STATE */
            <div className="bg-slate-800/90 border border-emerald-500/40 rounded-3xl p-8 sm:p-10 space-y-6 shadow-2xl">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div className="text-center space-y-2">
                <h2 className="text-xl sm:text-2xl font-bold text-white font-serif tracking-tight">
                  Akun Manager Berhasil Dikonfigurasi!
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
                  Akun Manager produksi Senzu Home telah terdaftar secara resmi dan terhubung langsung ke Firebase Authentication serta Master Data Staff.
                </p>
              </div>

              <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Nama Lengkap:</span>
                  <span className="font-bold text-white">{successData.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Email Login:</span>
                  <span className="font-mono text-[#D4AF37] font-semibold">{successData.email}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Peran Sistem:</span>
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold uppercase text-[10px]">
                    MANAGER (Full Operational Authority)
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/5">
                  <span className="text-slate-400">Cabang Penugasan:</span>
                  <span className="text-slate-200">Senzu Home Palembang R-01</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Status Otentikasi:</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Aktif & Terhubung (Firebase Auth)
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onComplete(successData.email)}
                className="w-full py-3.5 px-6 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2e] text-[#082A4F] font-bold text-xs tracking-wide uppercase transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Lanjut ke Login Staff</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : bootstrapStatus?.status === 'INCOMPLETE_AUTH' && !isReconcileMode ? (
            /* CASE B: Incomplete Initialization Banner & Action */
            <div className="bg-slate-800/90 border border-amber-500/30 rounded-3xl p-8 sm:p-10 space-y-6 shadow-2xl text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <Wrench className="w-9 h-9" />
              </div>

              <div className="space-y-2">
                <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold uppercase tracking-wider">
                  Rekonsiliasi Otentikasi Diperlukan
                </span>
                <h2 className="text-xl sm:text-2xl font-bold text-white font-serif tracking-tight mt-2">
                  Profil Manager Ditemukan
                </h2>
                <p className="text-xs text-amber-200/90 leading-relaxed max-w-md mx-auto">
                  Profil Manager ditemukan, tetapi akun login belum selesai dibuat di sistem Firebase Authentication.
                </p>
              </div>

              {bootstrapStatus.managerName && (
                <div className="bg-slate-900/80 border border-white/5 rounded-2xl p-4 text-xs text-slate-300 space-y-2 text-left">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nama Manager:</span>
                    <strong className="text-white">{bootstrapStatus.managerName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Email Resmi:</span>
                    <span className="font-mono text-[#D4AF37]">{bootstrapStatus.managerEmail || bootstrapStatus.rawEmail}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Peran:</span>
                    <span className="text-blue-300 font-semibold uppercase">MANAGER</span>
                  </div>
                </div>
              )}

              <div className="pt-2 space-y-3">
                <button
                  type="button"
                  onClick={() => setIsReconcileMode(true)}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2e] text-[#082A4F] font-bold text-xs tracking-wide uppercase transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Wrench className="w-4 h-4" />
                  <span>Perbaiki Akun Login Manager</span>
                </button>

                <button
                  type="button"
                  onClick={onGoToLogin}
                  className="w-full py-2.5 px-4 rounded-xl border border-white/10 hover:bg-white/5 text-slate-300 text-xs transition cursor-pointer"
                >
                  Kembali ke Login Staff
                </button>
              </div>
            </div>
          ) : isReconcileMode ? (
            /* RECONCILIATION FORM */
            <div className="bg-slate-800/90 border border-amber-500/30 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center">
                    <Wrench className="w-4 h-4" />
                  </div>
                  <div>
                    <h1 className="text-base sm:text-lg font-bold text-white font-serif">
                      Perbaiki Akun Login Manager
                    </h1>
                    <p className="text-[11px] text-slate-400">
                      Hubungkan profil Staff Master yang ada ke Firebase Authentication
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsReconcileMode(false)}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Batal</span>
                </button>
              </div>

              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              )}

              {/* Target Manager Details (Read-only) */}
              <div className="p-3.5 bg-slate-900/70 border border-white/5 rounded-2xl text-xs space-y-1.5">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                  Profil Manager yang Direkonsiliasi:
                </span>
                <div className="flex justify-between">
                  <span className="text-slate-300">Nama:</span>
                  <span className="text-white font-bold">{bootstrapStatus?.managerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Email:</span>
                  <span className="font-mono text-[#D4AF37] font-semibold">{bootstrapStatus?.rawEmail || bootstrapStatus?.managerEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Cabang:</span>
                  <span className="text-slate-200">Senzu Home Palembang R-01</span>
                </div>
              </div>

              <form onSubmit={handleReconcileSubmit} className="space-y-4">
                {/* Password Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Buat Password Baru Manager <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Minimal 12 karakter kombinasi"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Konfirmasi Password Baru <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Ketik ulang password baru"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Password Criteria List */}
                <div className="p-3 bg-slate-900/80 border border-white/5 rounded-xl space-y-1.5 text-[11px]">
                  <span className="font-semibold text-slate-300 block mb-1">
                    Kriteria Keamanan Password:
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    <span className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Min. 12 karakter
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Huruf besar (A-Z)
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Huruf kecil (a-z)
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Angka (0-9)
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasSpecial ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Simbol unik (!@#$)
                    </span>
                    <span className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Password cocok
                    </span>
                  </div>
                </div>

                {/* One-Time Setup Key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      One-Time Setup Key <span className="text-red-400">*</span>
                    </label>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <input
                      type={showSetupKey ? 'text' : 'password'}
                      value={setupKey}
                      onChange={(e) => setSetupKey(e.target.value)}
                      required
                      placeholder="Masukkan kunci setup server"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-900/90 border border-amber-500/40 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSetupKey(!showSetupKey)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showSetupKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSubmitting || !isPasswordValid || !setupKey.trim()}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2e] text-[#082A4F] font-bold text-xs tracking-wide uppercase transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-[#082A4F] border-t-transparent rounded-full animate-spin" />
                      <span>Menghubungkan Akun...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Selesaikan Rekonsiliasi Akun Manager</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : bootstrapStatus && !bootstrapStatus.canBootstrap ? (
            /* LOCKED STATE: Already initialized & fully configured (Case A) */
            <div className="bg-slate-800/90 border border-white/10 rounded-3xl p-8 sm:p-10 space-y-6 shadow-2xl text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-9 h-9" />
              </div>

              <div className="space-y-2">
                <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-bold uppercase tracking-wider">
                  Inisialisasi Selesai • Terkunci
                </span>
                <h2 className="text-xl sm:text-2xl font-bold text-white font-serif tracking-tight mt-2">
                  INITIAL SETUP ALREADY COMPLETED
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed max-w-md mx-auto">
                  Akun Manager produksi Senzu Home sudah dibuat dan aktif di sistem. Sesuai protokol keamanan operasional, halaman inisialisasi awal ini dinonaktifkan secara permanen.
                </p>
              </div>

              {bootstrapStatus.managerName && (
                <div className="bg-slate-900/80 border border-white/5 rounded-2xl p-4 text-xs text-slate-300 space-y-1">
                  <div>
                    Manager Terdaftar: <strong className="text-white">{bootstrapStatus.managerName}</strong>
                  </div>
                  {bootstrapStatus.managerEmail && (
                    <div className="text-slate-400 text-[11px]">
                      Email: <span className="font-mono text-[#D4AF37]">{bootstrapStatus.managerEmail}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  onClick={onGoToLogin}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#082A4F] hover:bg-[#0a3563] text-white border border-[#D4AF37]/50 font-bold text-xs tracking-wide uppercase transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Buka Halaman Login Staff</span>
                  <ArrowRight className="w-4 h-4 text-[#D4AF37]" />
                </button>
              </div>
            </div>
          ) : (
            /* BOOTSTRAP SETUP FORM (When no production manager exists yet) */
            <div className="bg-slate-800/90 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-xl">
              {/* Form Title & Notice */}
              <div className="text-center space-y-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#082A4F] border border-[#D4AF37]/40 text-[#D4AF37] text-[11px] font-bold tracking-wider uppercase">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Satu Kali Inisialisasi</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-white font-serif tracking-tight">
                  Setup Manager Pertama
                </h1>
                <p className="text-xs text-slate-300">
                  Inisialisasi akun Manager produksi Senzu Home
                </p>
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200/90 text-xs text-left flex items-start gap-2.5 mt-3">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    <strong>Pemberitahuan Keamanan:</strong> Halaman ini hanya dapat digunakan satu kali untuk membuat akun Manager resmi. Setelah akun pertama terdaftar, halaman ini akan otomatis terkunci permanen.
                  </span>
                </div>
              </div>

              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Fixed Role & Branch Badge */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-900/70 border border-white/5 rounded-2xl text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                      Peran Otoritas:
                    </span>
                    <span className="font-bold text-[#D4AF37] flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      MANAGER (Cabang)
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                      Cabang Penugasan:
                    </span>
                    <span className="font-medium text-slate-200">
                      Senzu Home Palembang R-01 (PLG001)
                    </span>
                  </div>
                </div>

                {/* Full Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nama Lengkap Pemilik / Manager <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      placeholder="Contoh: Ridho Kurniawan"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Email Resmi Akun Manager <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="Contoh: manager.palembang@senzuhome.com"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Nomor WhatsApp Staf <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Phone className="w-4 h-4" />
                    </div>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      placeholder="Contoh: 081272902321"
                      className="w-full pl-9 pr-3 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Password Akun Manager <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Minimal 12 karakter kombinasi"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Konfirmasi Password <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="Ketik ulang password"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Password Criteria List */}
                <div className="p-3 bg-slate-900/80 border border-white/5 rounded-xl space-y-1.5 text-[11px]">
                  <span className="font-semibold text-slate-300 block mb-1">
                    Kriteria Keamanan Password:
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    <span className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Min. 12 karakter
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasUpper ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Huruf besar (A-Z)
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasLower ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Huruf kecil (a-z)
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Angka (0-9)
                    </span>
                    <span className={`flex items-center gap-1.5 ${hasSpecial ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Simbol unik (!@#$)
                    </span>
                    <span className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-400' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Password cocok
                    </span>
                  </div>
                </div>

                {/* One-Time Setup Key */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-slate-300">
                      One-Time Setup Key <span className="text-red-400">*</span>
                    </label>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <KeyRound className="w-4 h-4" />
                    </div>
                    <input
                      type={showSetupKey ? 'text' : 'password'}
                      value={setupKey}
                      onChange={(e) => setSetupKey(e.target.value)}
                      required
                      placeholder="Masukkan kunci setup server"
                      className="w-full pl-9 pr-10 py-2.5 bg-slate-900/90 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/50 focus:border-[#D4AF37]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSetupKey(!showSetupKey)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showSetupKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSubmitting || !isPasswordValid || !setupKey.trim()}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2e] text-[#082A4F] font-bold text-xs tracking-wide uppercase transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-[#082A4F] border-t-transparent rounded-full animate-spin" />
                      <span>Memproses Inisialisasi...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Buat Akun Manager Resmi</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>

      {/* Footer Bar */}
      <footer className="border-t border-white/10 py-4 bg-[#082A4F]/60 text-center text-slate-400 text-xs">
        <p>© 2026 Senzu Home Palembang. Safe One-Time Production Manager Setup.</p>
      </footer>
    </div>
  );
};
