import React, { useState } from 'react';
import {
  X,
  User,
  Phone,
  Mail,
  Lock,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { GenderPreference } from '../types/crm';

interface CustomerProfileEditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerProfileEditModal: React.FC<CustomerProfileEditModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    currentCustomer,
    updateCustomerProfile,
    updateCustomerPassword,
  } = useCustomerAuth();

  // Profile fields
  const [name, setName] = useState(currentCustomer?.name || '');
  const [nickname, setNickname] = useState(currentCustomer?.nickname || '');
  const [phone, setPhone] = useState(currentCustomer?.phone || '');
  const [genderPreference, setGenderPreference] = useState<GenderPreference | undefined>(
    currentCustomer?.genderPreference
  );
  const [birthDate, setBirthDate] = useState(currentCustomer?.birthDate || '');
  const [gender, setGender] = useState<'Laki-laki' | 'Perempuan' | undefined>(currentCustomer?.gender);

  // Password fields
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    if (isOpen && currentCustomer) {
      setName(currentCustomer.name || '');
      setNickname(currentCustomer.nickname || '');
      setPhone(currentCustomer.phone || '');
      setGenderPreference(currentCustomer.genderPreference);
      setBirthDate(currentCustomer.birthDate || '');
      setGender(currentCustomer.gender);
      setIsChangingPassword(false);
      setNewPassword('');
      setConfirmPassword('');
      setStatusMessage(null);
    }
  }, [isOpen, currentCustomer]);

  if (!isOpen || !currentCustomer) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (!name.trim() || name.trim().length < 2) {
      setStatusMessage({ type: 'error', text: 'Nama lengkap minimal 2 karakter.' });
      return;
    }

    if (isChangingPassword) {
      if (!newPassword || newPassword.length < 8) {
        setStatusMessage({ type: 'error', text: 'Kata sandi baru minimal 8 karakter.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        setStatusMessage({ type: 'error', text: 'Konfirmasi kata sandi baru tidak cocok.' });
        return;
      }
    }

    setIsSaving(true);
    try {
      // 1. Update profile
      await updateCustomerProfile({
        name: name.trim(),
        displayName: (nickname || name).trim(),
        nickname: nickname.trim(),
        phone: phone.trim(),
        genderPreference,
        gender,
        birthDate: birthDate || undefined,
      });

      // 2. Update password if toggled
      if (isChangingPassword && newPassword) {
        await updateCustomerPassword(newPassword);
        setIsChangingPassword(false);
        setNewPassword('');
        setConfirmPassword('');
      }

      setStatusMessage({ type: 'success', text: 'Profil Anda berhasil diperbarui.' });
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Update profile error:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Gagal memperbarui profil. Silakan coba lagi.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl border border-[#D4AF37]/35 overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-[#082A4F] via-[#0B3564] to-[#0D3866] text-white flex items-center justify-between border-b border-[#D4AF37]/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shadow-xs">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg text-white leading-tight">
                Pengaturan Profil Akun
              </h3>
              <p className="text-[11px] text-slate-300">
                Perbarui data pribadi dan kata sandi akun
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
          {statusMessage && (
            <div
              className={`p-3.5 rounded-2xl text-xs flex items-center gap-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span className="font-semibold">{statusMessage.text}</span>
            </div>
          )}

          {/* Email (Read-only) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Email Akun</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                disabled
                value={currentCustomer.email || ''}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-100 text-slate-500 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Nama Lengkap */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#082A4F]">Nama Lengkap</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama lengkap Anda"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
              />
            </div>
          </div>

          {/* Nama Panggilan */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#082A4F]">Nama Panggilan / Nickname</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Contoh: Rina"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
            />
          </div>

          {/* WhatsApp */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#082A4F]">Nomor WhatsApp</label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="081272902321"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition font-mono"
              />
            </div>
          </div>

          {/* Preferensi Gender Terapis */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#082A4F]">Preferensi Terapis Favorit</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: undefined, label: 'Bebas' },
                { id: 'wanita' as GenderPreference, label: 'Wanita' },
                { id: 'pria' as GenderPreference, label: 'Pria' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setGenderPreference(opt.id)}
                  className={`py-2 text-xs font-bold rounded-xl border text-center transition cursor-pointer ${
                    genderPreference === opt.id
                      ? 'bg-[#082A4F] text-white border-[#082A4F]'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Gender Pelanggan (dasar penugasan terapis) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#082A4F]">Gender Anda</label>
            <div className="grid grid-cols-2 gap-2">
              {(['Laki-laki', 'Perempuan'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`py-2 text-xs font-bold rounded-xl border text-center transition cursor-pointer ${
                    gender === g
                      ? 'bg-[#082A4F] text-white border-[#082A4F]'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-white'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">
              Digunakan agar terapis ditugaskan sesuai gender Anda.
            </p>
          </div>

          {/* Tanggal Lahir */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#082A4F]">
              Tanggal Lahir <span className="text-[10px] text-slate-400 font-normal">(Untuk hadiah promo ulang tahun)</span>
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
              />
            </div>
          </div>

          {/* Section: Ubah Kata Sandi */}
          <div className="pt-2 border-t border-slate-100">
            {!isChangingPassword ? (
              <button
                type="button"
                onClick={() => setIsChangingPassword(true)}
                className="w-full py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#B89628]" />
                <span>Ganti Kata Sandi</span>
              </button>
            ) : (
              <div className="space-y-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#082A4F]">Ganti Kata Sandi Baru</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingPassword(false);
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                    className="text-[11px] text-slate-400 hover:text-slate-600"
                  >
                    Batal
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Kata Sandi Baru</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 8 karakter"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:border-[#082A4F] outline-none transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-600">Konfirmasi Kata Sandi Baru</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi kata sandi baru"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:border-[#082A4F] outline-none transition"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-3 rounded-xl bg-[#082A4F] hover:bg-[#0D3866] text-white text-xs font-bold transition shadow-sm cursor-pointer flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#D4AF37]" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <span>Simpan Perubahan</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
