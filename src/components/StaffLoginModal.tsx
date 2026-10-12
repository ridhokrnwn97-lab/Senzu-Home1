import React, { useState } from 'react';
import { X, UserCheck, ShieldCheck, Lock, Mail, ChevronRight, Sparkles, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth, SAMPLE_STAFF_USERS } from '../context/AuthContext';
import { StaffUser } from '../types';
import { SenzuLogo } from './SenzuLogo';
import { sendStaffPasswordReset } from '../lib/staffAuthService';
import { getStaffMasterUsers } from '../lib/masterDataService';

interface StaffLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (staff: StaffUser) => void;
  initialEmail?: string;
  onOpenInitialSetup?: () => void;
}

export const StaffLoginModal: React.FC<StaffLoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  initialEmail,
  onOpenInitialSetup,
}) => {
  const { loginAs, loginWithCredentials, staffUsers, currentUser } = useAuth();
  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const [bootstrapCompleted, setBootstrapCompleted] = useState<boolean>(true);

  React.useEffect(() => {
    let active = true;
    fetch('/api/bootstrap/status')
      .then((res) => res.json())
      .then((data) => {
        if (active && data) {
          setBootstrapCompleted(!data.canBootstrap || data.status === 'COMPLETED');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  if (!isOpen) return null;

  // Only display active demo accounts
  const activeDemoStaff = (staffUsers.length > 0 ? staffUsers : SAMPLE_STAFF_USERS).filter(
    (s) => s.isDemoAccount && s.isActive !== false && s.loginAccountStatus !== 'DINONAKTIFKAN'
  );

  const handleManualLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    const res = await loginWithCredentials(email, password);
    setIsLoading(false);

    if (res.success) {
      const user = res.staff || currentUser;
      if (user) onLoginSuccess(user);
      onClose();
    } else {
      setErrorMsg(res.message || 'Login gagal.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setErrorMsg('Masukkan alamat email staf yang valid.');
      return;
    }

    setIsLoading(true);
    try {
      // Look up staff in local state, or query canonical Master Data if needed
      let matchedStaff = staffUsers.find((u) => (u.email || '').toLowerCase() === trimmed);
      if (!matchedStaff) {
        try {
          const liveUsers = await getStaffMasterUsers();
          matchedStaff = liveUsers.find((u) => (u.email || '').toLowerCase() === trimmed);
        } catch {
          // ignore lookup failure
        }
      }

      if (!matchedStaff) {
        setErrorMsg('Email staf tidak ditemukan dalam Master Data Staff Senzu Home.');
        setIsLoading(false);
        return;
      }

      // Check if staff account is active (Requirement 13 & 14)
      if (
        matchedStaff.isActive === false ||
        matchedStaff.status === 'INACTIVE' ||
        matchedStaff.loginAccountStatus === 'DINONAKTIFKAN'
      ) {
        setErrorMsg('Akun staff tidak aktif. Hubungi Manager.');
        setIsLoading(false);
        return;
      }

      const res = await sendStaffPasswordReset(matchedStaff);
      setSuccessMsg(res.message);
      setTimeout(() => {
        setIsResetMode(false);
      }, 3500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengirim link reset kata sandi.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickLogin = (staff: StaffUser) => {
    const res = loginAs(staff);
    if (res.success) {
      onLoginSuccess(staff);
      onClose();
    } else {
      setErrorMsg(res.message || 'Gagal masuk.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Official Corporate Header */}
        <div className="bg-[#082A4F] text-white p-6 border-b border-[#D4AF37]/30 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-[200px] sm:w-[240px] flex justify-center py-1">
              <SenzuLogo
                variant="light"
                size="medium"
                className="w-full h-auto max-h-[56px]"
              />
            </div>
            <div>
              <h3 className="font-serif text-base sm:text-lg font-bold tracking-tight text-white mt-1">
                Portal Operasional Staf
              </h3>
              <p className="text-xs text-[#D4AF37] font-semibold tracking-wider uppercase mt-0.5">
                CSS • Supervisor • Therapist • Manager
              </p>
              <p className="text-[10px] text-slate-300 font-mono mt-0.5">
                Official Staff Authentication &amp; Operations
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {isResetMode ? (
            /* Reset Password Form */
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="text-xs text-slate-600">
                Masukkan email staf yang terdaftar di Master Data. Kami akan mengirimkan tautan resmi Firebase Auth untuk menyetel ulang kata sandi Anda.
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Staf Terdaftar:
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    placeholder="nama@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(false);
                    setErrorMsg('');
                  }}
                  className="text-xs text-slate-600 hover:text-slate-800 font-semibold cursor-pointer"
                >
                  Kembali ke Login
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl bg-[#082A4F] text-white text-xs font-bold hover:bg-[#0A335F] cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {isLoading ? 'Mengirim...' : 'Kirim Tautan Reset'}
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Form Manual Login */}
              <form onSubmit={handleManualLogin} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Staf:</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      placeholder="nama@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">Kata Sandi:</label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsResetMode(true);
                        setErrorMsg('');
                        setSuccessMsg('');
                      }}
                      className="text-[11px] text-[#082A4F] hover:underline font-semibold cursor-pointer"
                    >
                      Lupa Kata Sandi?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0A335F] text-white text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer shadow-sm"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{isLoading ? 'Memverifikasi akses staf...' : 'Masuk ke Portal Operasional'}</span>
                </button>
              </form>

              {/* Quick Demo Role Selector (for Development / Preview) */}
              {activeDemoStaff.length > 0 && (
                <div className="pt-2">
                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-200"></div>
                    <span className="flex-shrink mx-3 text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                      Akun Demo Pengujian ({activeDemoStaff.length})
                    </span>
                    <div className="flex-grow border-t border-slate-200"></div>
                  </div>

                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {(activeDemoStaff || []).map((staff) => (
                      <button
                        key={staff.uid}
                        type="button"
                        onClick={() => handleQuickLogin(staff)}
                        className="w-full p-2 rounded-xl border border-slate-200 hover:border-[#082A4F] hover:bg-[#082A4F]/5 transition text-left flex items-center justify-between group cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-[#082A4F] group-hover:text-white text-slate-700 flex items-center justify-center text-xs font-bold transition">
                            {staff.name.charAt(0)}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-800 group-hover:text-[#082A4F]">
                              {staff.name}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {staff.employeeCode || staff.email} •{' '}
                              <span className="font-semibold uppercase text-[#082A4F]">
                                {staff.role}
                              </span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#082A4F] transition" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!bootstrapCompleted && onOpenInitialSetup ? (
                <div className="pt-2 text-center border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenInitialSetup();
                    }}
                    className="text-[11px] text-slate-500 hover:text-[#082A4F] hover:underline font-medium transition cursor-pointer flex items-center justify-center gap-1 mx-auto"
                  >
                    <KeyRound className="w-3 h-3 text-[#D4AF37]" />
                    <span>Inisialisasi Pertama? Setup Manager Produksi</span>
                  </button>
                </div>
              ) : (
                <div className="pt-2 text-center border-t border-slate-100">
                  <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-500" />
                    <span>Sistem Terotentikasi • Hubungi Branch Manager untuk akses staf</span>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
