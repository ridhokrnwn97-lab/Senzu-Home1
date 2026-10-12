import React, { useState } from 'react';
import {
  X,
  UserCheck,
  Mail,
  Lock,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  Eye,
  EyeOff,
  Send,
  Info,
} from 'lucide-react';
import { StaffUser } from '../../types';
import {
  provisionStaffAuthAccount,
  validatePasswordStrength,
  generateSecureTempPassword,
} from '../../lib/staffAuthService';

interface ProvisionAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffUser | null;
  actor: StaffUser;
  onSuccess: () => void;
}

export const ProvisionAccountModal: React.FC<ProvisionAccountModalProps> = ({
  isOpen,
  onClose,
  staff,
  actor,
  onSuccess,
}) => {
  if (!isOpen || !staff) return null;

  const [mode, setMode] = useState<'INVITE_LINK' | 'TEMP_PASSWORD'>('INVITE_LINK');
  const [tempPassword, setTempPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const hasEmail = Boolean(staff.email && staff.email.includes('@'));
  const validation = mode === 'TEMP_PASSWORD' ? validatePasswordStrength(tempPassword) : { isValid: true, errors: [] };

  const handleGenerateRandom = () => {
    const generated = generateSecureTempPassword();
    setTempPassword(generated);
    setShowPassword(true);
  };

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!hasEmail) {
      setErrorMsg('Staf ini belum memiliki alamat email valid. Silakan edit profil staf dan tambahkan email terlebih dahulu.');
      return;
    }

    if (mode === 'TEMP_PASSWORD' && !validation.isValid) {
      setErrorMsg(validation.errors[0]);
      return;
    }

    setLoading(true);
    try {
      const res = await provisionStaffAuthAccount({
        staff,
        mode,
        tempPassword: mode === 'TEMP_PASSWORD' ? tempPassword : undefined,
        actor: {
          id: actor.uid,
          name: actor.name,
          role: actor.role as 'admin' | 'manager',
        },
      });

      setSuccessMsg(res.message);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses pembuatan akun login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-[#082A4F] text-white p-6 border-b border-[#D4AF37]/30 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-[#D4AF37]">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-white">
                Buat Akun Login Staf
              </h3>
              <p className="text-xs text-slate-300">
                Otentikasi Resmi Firebase Auth • Master Data Staff
              </p>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleProvision} className="p-6 space-y-5">
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

          {/* Staff Info Card */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="font-bold text-slate-800 text-sm">{staff.name}</div>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Kode Staf</span>
                <span className="font-mono font-semibold text-slate-800">{staff.employeeCode || '-'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Peran (Role)</span>
                <span className="font-semibold uppercase text-[#082A4F]">{staff.role}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Email Login</span>
                <span className={`font-mono ${hasEmail ? 'text-slate-800 font-medium' : 'text-red-600 font-bold'}`}>
                  {staff.email || 'Belum ada email terdaftar!'}
                </span>
              </div>
            </div>
          </div>

          {/* Provisioning Mode Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">
              Pilih Metode Pembuatan Akun:
            </label>

            <div className="grid grid-cols-1 gap-2.5">
              {/* Option A: Invite Link (Recommended) */}
              <label
                className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-start gap-3 ${
                  mode === 'INVITE_LINK'
                    ? 'border-[#082A4F] bg-[#082A4F]/5 ring-1 ring-[#082A4F]'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="provisionMode"
                  checked={mode === 'INVITE_LINK'}
                  onChange={() => setMode('INVITE_LINK')}
                  className="mt-1 text-[#082A4F]"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Opsi A: Kirim Link Atur Kata Sandi ke Email</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      Direkomendasikan
                    </span>
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">
                    Sistem membuat akun secara aman dan mengirimkan link resmi ke email staf. Staf menetapkan kata sandi pribadi mereka sendiri.
                  </p>
                </div>
              </label>

              {/* Option B: Temporary Password */}
              <label
                className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-start gap-3 ${
                  mode === 'TEMP_PASSWORD'
                    ? 'border-[#082A4F] bg-[#082A4F]/5 ring-1 ring-[#082A4F]'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="provisionMode"
                  checked={mode === 'TEMP_PASSWORD'}
                  onChange={() => setMode('TEMP_PASSWORD')}
                  className="mt-1 text-[#082A4F]"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-800">
                    Opsi B: Buat Kata Sandi Sementara (Wajib Ganti Saat Login)
                  </div>
                  <p className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">
                    Manager menentukan kata sandi awal untuk diberikan kepada staf. Staf diwajibkan mengganti kata sandi pada saat pertama kali login.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Option B Input Fields */}
          {mode === 'TEMP_PASSWORD' && (
            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  Kata Sandi Sementara:
                </label>
                <button
                  type="button"
                  onClick={handleGenerateRandom}
                  className="text-[11px] font-bold text-[#082A4F] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>Generate Acak Aman</span>
                </button>
              </div>

              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="Min. 12 karakter, huruf besar, kecil, angka, simbol"
                  className="w-full pl-10 pr-10 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#082A4F]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-amber-200 text-[11px] text-slate-600 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Keamanan:</strong> Salin dan berikan kata sandi ini langsung kepada staf. Sesuai aturan keamanan, sistem <strong>tidak pernah menyimpan</strong> kata sandi ini di database dan tidak dapat dilihat lagi setelah jendela ini ditutup.
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading || !hasEmail || (mode === 'TEMP_PASSWORD' && !validation.isValid)}
              className="px-6 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0A335F] text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <UserCheck className="w-4 h-4" />
              <span>{loading ? 'Memproses Akun...' : 'Aktifkan Akun Login'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
