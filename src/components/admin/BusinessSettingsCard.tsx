import React, { useState } from 'react';
import {
  Sliders,
  Clock,
  Phone,
  Mail,
  Building2,
  Calendar,
  Save,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  QrCode,
  ShieldAlert,
} from 'lucide-react';
import { BusinessSettings, Branch, AppSettings, StaffUser } from '../../types';
import { updateBusinessSettings } from '../../lib/masterDataService';
import { updateSettings } from '../../lib/dbService';
import {
  formatWhatsAppDisplay,
  isValidEmail,
  isValidWhatsApp,
  isValidTimeFormat,
  SUPPORTED_TIMEZONES,
} from '../../lib/masterDataUtils';

interface BusinessSettingsCardProps {
  businessSettings: BusinessSettings;
  branches?: Branch[];
  appSettings?: AppSettings;
  currentUser: StaffUser;
  onRefresh: () => void;
}

export const BusinessSettingsCard: React.FC<BusinessSettingsCardProps> = ({
  businessSettings,
  branches = [],
  appSettings,
  currentUser,
  onRefresh,
}) => {
  const isReadOnly = currentUser.role !== 'manager' && currentUser.role !== 'admin';
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Business config fields
  const [defaultBranchId, setDefaultBranchId] = useState(
    businessSettings?.defaultBranchId || 'PLG001'
  );
  const [timezone, setTimezone] = useState(businessSettings?.defaultTimezone || 'Asia/Jakarta');
  const [startTime, setStartTime] = useState(businessSettings?.operatingHoursStart || '10:00');
  const [endTime, setEndTime] = useState(businessSettings?.operatingHoursEnd || '22:00');
  const [supportWhatsApp, setSupportWhatsApp] = useState(
    businessSettings?.customerSupportWhatsApp || '+6289654623347'
  );
  const [supportEmail, setSupportEmail] = useState(
    businessSettings?.officialEmail || 'senzureflexology@gmail.com'
  );
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number>(
    businessSettings?.leadTimeMinutes || 60
  );
  const [maxAdvanceDays, setMaxAdvanceDays] = useState<number>(
    businessSettings?.maxAdvanceDays || 14
  );

  // Bank & Payment info (integrated from general settings)
  const [bankName, setBankName] = useState(appSettings?.bankName || 'BCA (Bank Central Asia)');
  const [bankAccount, setBankAccount] = useState(appSettings?.bankAccount || '021-8899-721');
  const [bankHolder, setBankHolder] = useState(appSettings?.bankHolder || 'PT KSBONE UNTUK KITA');
  const [qrisInstruction, setQrisInstruction] = useState(
    appSettings?.qrisInstruction || 'Scan QRIS Senzu Home melalui BCA Mobile, Livin, GoPay, OVO, ShopeePay, atau DANA.'
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setErrorMsg('');

    if (!isValidTimeFormat(startTime) || !isValidTimeFormat(endTime)) {
      setErrorMsg('Jam operasional harus berformat HH:mm (contoh: 10:00 - 22:00).');
      return;
    }
    if (!isValidWhatsApp(supportWhatsApp)) {
      setErrorMsg('Nomor WhatsApp support tidak valid. Format: +628xxxxxxxxxx.');
      return;
    }
    if (!isValidEmail(supportEmail)) {
      setErrorMsg('Email support tidak valid.');
      return;
    }

    setSaving(true);
    try {
      const selectedBranch = (branches || []).find((b) => b.id === defaultBranchId);

      // 1. Update Business Settings
      await updateBusinessSettings(
        {
          defaultBranchId,
          defaultBranchName: selectedBranch ? selectedBranch.name : 'Senzu Reflexology Palembang',
          defaultTimezone: timezone,
          operatingHoursStart: startTime.trim(),
          operatingHoursEnd: endTime.trim(),
          customerSupportWhatsApp: supportWhatsApp.trim(),
          officialEmail: supportEmail.trim().toLowerCase(),
          leadTimeMinutes: Number(leadTimeMinutes),
          maxAdvanceDays: Number(maxAdvanceDays),
        },
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );

      // 2. Synchronize Bank and General Settings
      await updateSettings({
        ...(appSettings || {}),
        bankName: bankName.trim(),
        bankAccount: bankAccount.trim(),
        bankHolder: bankHolder.trim(),
        qrisInstruction: qrisInstruction.trim(),
        contactWhatsApp: supportWhatsApp.trim(),
      });

      setSuccessMsg('Konfigurasi operasional bisnis & rekening berhasil diperbarui.');
      setTimeout(() => setSuccessMsg(''), 4000);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan konfigurasi bisnis.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#8B5A36] via-[#94603B] to-[#8B5A36] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D4AF37]/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
            <Sliders className="w-6 h-6 text-[#D4AF37]" />
          </div>
          <div>
            <h3 className="font-serif text-lg sm:text-xl font-bold text-white tracking-tight">
              Konfigurasi Bisnis &amp; Operasional
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Jam operasional pemesanan, lead time booking, kontak bantuan, dan rekening transfer
            </p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="m-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="m-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isReadOnly && (
        <div className="mx-5 mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Mode Lihat Saja (Supervisor):</strong> Hanya Admin &amp; Manager yang memiliki wewenang mengubah konfigurasi operasional dan rekening bank.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-6 text-xs">
        {/* Section 1: Cabang Default & Waktu */}
        <div className="space-y-4">
          <h4 className="font-bold text-[#4B2B18] text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#D4AF37]" />
            Cabang Default &amp; Zona Waktu Sistem
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Cabang Default Operasi:
              </label>
              <select
                value={defaultBranchId}
                onChange={(e) => setDefaultBranchId(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold text-[#4B2B18] disabled:bg-slate-100"
              >
                {(branches || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} - {b.name} ({b.city})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Zona Waktu Baku Aplikasi:
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white disabled:bg-slate-100"
              >
                {SUPPORTED_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Jam Layanan & Lead Time */}
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <h4 className="font-bold text-[#4B2B18] text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#D4AF37]" />
            Jam Operasional &amp; Batas Reservasi
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Jam Buka (Start):</label>
              <input
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={isReadOnly}
                placeholder="10:00"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-center text-[#4B2B18] disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Jam Tutup (End):</label>
              <input
                type="text"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={isReadOnly}
                placeholder="22:00"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-center text-[#4B2B18] disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Lead Time (Menit Sebelum):
              </label>
              <input
                type="number"
                min={15}
                step={15}
                value={leadTimeMinutes}
                onChange={(e) => setLeadTimeMinutes(Number(e.target.value))}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-center disabled:bg-slate-100"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Jeda minimum antara jam pesan dengan jam kedatangan terapis.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Maksimal Hari ke Depan:
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={maxAdvanceDays}
                onChange={(e) => setMaxAdvanceDays(Number(e.target.value))}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-center disabled:bg-slate-100"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Batas maksimal hari kalender booking masa depan (default 14 hari).
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: Kontak Support & Bantuan */}
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <h4 className="font-bold text-[#4B2B18] text-sm flex items-center gap-2">
            <Phone className="w-4 h-4 text-[#D4AF37]" />
            Kontak Resmi Customer Support &amp; Bantuan
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                WhatsApp Customer Service:
              </label>
              <input
                type="text"
                value={supportWhatsApp}
                onChange={(e) => setSupportWhatsApp(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-emerald-700 disabled:bg-slate-100"
                placeholder="+6289654623347"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Ditampilkan pada floating bantuan pelanggan dan konfirmasi invoice booking.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Email Customer Support:
              </label>
              <input
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono disabled:bg-slate-100"
                placeholder="senzureflexology@gmail.com"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Rekening Pembayaran Resmi (a.n PT KSBONE UNTUK KITA) */}
        <div className="pt-4 border-t border-slate-200 space-y-4">
          <h4 className="font-bold text-[#4B2B18] text-sm flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[#D4AF37]" />
            Rekening Pembayaran &amp; QRIS Senzu
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nama Bank:</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold disabled:bg-slate-100"
                placeholder="BCA / Mandiri / BNI / BRI"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nomor Rekening:</label>
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-[#4B2B18] disabled:bg-slate-100"
                placeholder="021-8899-721"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Pemilik Rekening (Atas Nama):
              </label>
              <input
                type="text"
                value={bankHolder}
                onChange={(e) => setBankHolder(e.target.value)}
                disabled={isReadOnly}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-[#4B2B18] disabled:bg-slate-100"
                placeholder="PT KSBONE UNTUK KITA"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Instruksi QRIS:</label>
            <textarea
              rows={2}
              value={qrisInstruction}
              onChange={(e) => setQrisInstruction(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs disabled:bg-slate-100"
            />
          </div>
        </div>

        {/* Submit Actions */}
        {!isReadOnly && (
          <div className="flex justify-end pt-4 border-t border-slate-200">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 shadow-sm cursor-pointer active:scale-95"
            >
              <Save className="w-4 h-4 text-[#D4AF37]" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Konfigurasi Bisnis'}</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
