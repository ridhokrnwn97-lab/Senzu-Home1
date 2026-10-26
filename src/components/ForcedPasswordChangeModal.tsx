import React, { useState } from 'react';
import {
  ShieldAlert,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  LogOut,
  Sparkles,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { changeStaffFirstPassword, validatePasswordStrength } from '../lib/staffAuthService';
import { SenzuLogo } from './SenzuLogo';

export const ForcedPasswordChangeModal: React.FC = () => {
  const { currentUser, isPasswordChangeRequired, clearPasswordChangeRequirement, logout } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isPasswordChangeRequired || !currentUser) {
    return null;
  }

  const validation = validatePasswordStrength(newPassword);
  const isMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid = validation.isValid && isMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!isFormValid) {
      if (!validation.isValid) {
        setErrorMsg(validation.errors[0]);
      } else if (!isMatch) {
        setErrorMsg('Konfirmasi kata sandi tidak cocok.');
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await changeStaffFirstPassword(newPassword, currentUser);
      setSuccessMsg(res.message || 'Kata sandi baru berhasil disimpan dan akun staf Anda telah aktif.');
      setTimeout(() => {
        clearPasswordChangeRequirement(res.staff);
      }, 800);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengubah kata sandi.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header with Senzu Home Official Branding */}
        <div className="bg-[#8B5A36] text-white p-6 border-b border-[#D4AF37]/30 text-center relative">
          <div className="w-[180px] sm:w-[220px] mx-auto mb-2">
            <SenzuLogo variant="light" size="medium" className="w-full h-auto max-h-[50px]" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-semibold mt-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Keamanan Akun: Wajib Ganti Password Pertama Kali</span>
          </div>
          <h3 className="font-serif text-lg font-bold text-white mt-2">
            Amankan Akun Staf Anda
          </h3>
          <p className="text-xs text-slate-300 max-w-sm mx-auto mt-1">
            Halo, <strong>{currentUser.name}</strong> ({currentUser.role.toUpperCase()}). Sesuai standar keamanan Senzu Home, Anda diwajibkan membuat kata sandi pribadi baru sebelum dapat mengakses portal operasional.
          </p>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* New Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Kata Sandi Baru
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Masukkan kata sandi baru minimal 12 karakter"
                disabled={isSubmitting}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#8B5A36] focus:border-transparent transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Konfirmasi Kata Sandi Baru
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ulangi kata sandi baru persis sama"
                disabled={isSubmitting}
                className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-2 focus:ring-[#8B5A36] transition ${
                  confirmPassword && !isMatch
                    ? 'border-red-300 bg-red-50/30'
                    : 'border-slate-300'
                }`}
              />
            </div>
            {confirmPassword && !isMatch && (
              <p className="text-[11px] text-red-600 mt-1">Konfirmasi kata sandi belum cocok.</p>
            )}
          </div>

          {/* Password Policy Checklist */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
            <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
              Ketentuan Kata Sandi Aman:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px]">
              <div className={`flex items-center gap-1.5 ${newPassword.length >= 12 ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${newPassword.length >= 12 ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Minimal 12 karakter</span>
              </div>
              <div className={`flex items-center gap-1.5 ${/[A-Z]/.test(newPassword) ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${/[A-Z]/.test(newPassword) ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Huruf besar (A-Z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${/[a-z]/.test(newPassword) ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${/[a-z]/.test(newPassword) ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Huruf kecil (a-z)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${/[0-9]/.test(newPassword) ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${/[0-9]/.test(newPassword) ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Angka (0-9)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword) ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword) ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Karakter khusus (!@#$ dll)</span>
              </div>
              <div className={`flex items-center gap-1.5 ${isMatch ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${isMatch ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Konfirmasi cocok</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={logout}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition"
            >
              <LogOut className="w-4 h-4 text-slate-500" />
              <span>Batal &amp; Keluar</span>
            </button>
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="flex-1 px-6 py-2.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-md cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{isSubmitting ? 'Menyimpan Kata Sandi...' : 'Simpan Kata Sandi & Masuk'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
