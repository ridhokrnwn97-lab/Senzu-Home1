import React, { useState } from 'react';
import {
  Building2,
  Mail,
  Phone,
  Clock,
  CheckCircle2,
  Edit3,
  Save,
  X,
  AlertCircle,
  FileText,
  MapPin,
  ShieldAlert,
} from 'lucide-react';
import { CompanySettings, StaffUser } from '../../types';
import { updateCompanySettings } from '../../lib/masterDataService';
import {
  formatWhatsAppDisplay,
  isValidEmail,
  isValidWhatsApp,
  SUPPORTED_TIMEZONES,
} from '../../lib/masterDataUtils';
import { getWaMeTarget } from '../../lib/supportWhatsApp';

interface CompanySettingsCardProps {
  company: CompanySettings;
  currentUser: StaffUser;
  onRefresh: () => void;
}

export const CompanySettingsCard: React.FC<CompanySettingsCardProps> = ({
  company,
  currentUser,
  onRefresh,
}) => {
  const isReadOnly = currentUser.role !== 'manager' && currentUser.role !== 'admin';
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form fields
  const [legalName, setLegalName] = useState(company.companyLegalName);
  const [brandName, setBrandName] = useState(company.brandName);
  const [email, setEmail] = useState(company.officialEmail);
  const [whatsapp, setWhatsapp] = useState(company.customerServiceWhatsApp);
  const [timezone, setTimezone] = useState(company.timezone);
  const [status, setStatus] = useState(company.status);
  const [address, setAddress] = useState(company.address || '');
  const [taxId, setTaxId] = useState(company.taxId || '');
  const [nib, setNib] = useState(company.businessRegistrationNumber || '');
  const [notes, setNotes] = useState(company.notes || '');

  const handleStartEdit = () => {
    if (isReadOnly) return;
    setLegalName(company.companyLegalName);
    setBrandName(company.brandName);
    setEmail(company.officialEmail);
    setWhatsapp(company.customerServiceWhatsApp);
    setTimezone(company.timezone);
    setStatus(company.status);
    setAddress(company.address || '');
    setTaxId(company.taxId || '');
    setNib(company.businessRegistrationNumber || '');
    setNotes(company.notes || '');
    setErrorMsg('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setErrorMsg('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!legalName.trim()) {
      setErrorMsg('Nama Legal Perusahaan wajib diisi.');
      return;
    }
    if (!brandName.trim()) {
      setErrorMsg('Nama Brand / Merk Dagang wajib diisi.');
      return;
    }
    if (!isValidEmail(email)) {
      setErrorMsg('Format email tidak valid (contoh: senzureflexology@gmail.com).');
      return;
    }
    if (!isValidWhatsApp(whatsapp)) {
      setErrorMsg('Nomor WhatsApp tidak valid. Format: +628xxxxxxxxxx.');
      return;
    }

    setSaving(true);
    try {
      await updateCompanySettings(
        {
          companyLegalName: legalName.trim(),
          brandName: brandName.trim(),
          officialEmail: email.trim().toLowerCase(),
          customerServiceWhatsApp: whatsapp.trim(),
          timezone,
          status,
          address: address.trim(),
          taxId: taxId.trim(),
          businessRegistrationNumber: nib.trim(),
          notes: notes.trim(),
        },
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );

      setSuccessMsg('Profil perusahaan berhasil diperbarui dan dicatat ke audit log.');
      setTimeout(() => setSuccessMsg(''), 4000);
      setIsEditing(false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan profil perusahaan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#082A4F] via-[#0A335F] to-[#082A4F] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D4AF37]/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-[#D4AF37]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-lg sm:text-xl font-bold text-white tracking-tight">
                Profil &amp; Legalitas Perusahaan
              </h3>
              <span
                className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                  company.status === 'ACTIVE'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                    : 'bg-slate-500/20 text-slate-300 border-slate-400/30'
                }`}
              >
                {company.status === 'ACTIVE' ? 'Aktif (Operasional)' : 'Nonaktif'}
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Master data entitas hukum, kontak resmi pusat, dan zona waktu operasional
            </p>
          </div>
        </div>

        {!isEditing && (
          <button
            type="button"
            onClick={handleStartEdit}
            disabled={isReadOnly}
            className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              isReadOnly
                ? 'bg-white/10 text-slate-400 cursor-not-allowed border border-white/10'
                : 'bg-[#D4AF37] hover:bg-[#E5C158] text-[#082A4F] font-bold shadow-sm active:scale-95 cursor-pointer'
            }`}
            title={isReadOnly ? 'Hanya Admin/Manager yang dapat mengedit' : 'Edit Pengaturan Perusahaan'}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isReadOnly ? 'Lihat Saja' : 'Edit Profil'}</span>
          </button>
        )}
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

      {isReadOnly && !isEditing && (
        <div className="mx-5 mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Akses Terbatas:</strong> Anda masuk sebagai <strong>Supervisor</strong> (Read-Only). Perubahan data legal perusahaan hanya dapat dilakukan oleh role <strong>Admin</strong> atau <strong>Manager</strong>.
          </span>
        </div>
      )}

      {/* Content: View Mode vs Edit Mode */}
      {!isEditing ? (
        <div className="p-5 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
            {/* Primary Details */}
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Entitas Bisnis
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Nama Legal Perusahaan:</span>
                  <span className="text-sm font-bold text-[#082A4F] block">
                    {company.companyLegalName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Nama Merk / Brand:</span>
                  <span className="text-xs font-semibold text-slate-800 block">
                    {company.brandName}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Status Perusahaan:</span>
                  <span className="font-semibold text-emerald-700 flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    {company.status === 'ACTIVE' ? 'Aktif Beroperasi' : 'Tidak Aktif'}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Legalitas &amp; Dokumen
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-500 block text-[11px]">NPWP Perusahaan:</span>
                    <span className="font-mono text-slate-700 font-medium">
                      {company.taxId || 'Tercatat di Pusat'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Nomor Induk Berusaha:</span>
                    <span className="font-mono text-slate-700 font-medium">
                      {company.businessRegistrationNumber || 'Tercatat di OSS'}
                    </span>
                  </div>
                </div>
                {company.notes && (
                  <div className="pt-2 border-t border-slate-200 text-slate-600 text-[11px]">
                    <span className="font-semibold block text-slate-700">Catatan Internal:</span>
                    {company.notes}
                  </div>
                )}
              </div>
            </div>

            {/* Communication & Timezone */}
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Saluran Komunikasi Resmi
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Email Resmi Perusahaan:</span>
                  <a
                    href={`mailto:${company.officialEmail}`}
                    className="font-semibold text-[#082A4F] hover:underline inline-flex items-center gap-1.5 mt-0.5"
                  >
                    <Mail className="w-3.5 h-3.5 text-[#D4AF37]" />
                    <span>{company.officialEmail}</span>
                  </a>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">WhatsApp Customer Service:</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <a
                      href={`https://wa.me/${getWaMeTarget(company.customerServiceWhatsApp)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-emerald-700 hover:text-emerald-800 hover:underline inline-flex items-center gap-1.5"
                    >
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{formatWhatsAppDisplay(company.customerServiceWhatsApp)}</span>
                    </a>
                    <span className="font-mono text-[10px] text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200">
                      Normalized: {company.customerServiceWhatsApp}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Zona Waktu Standar:</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{company.timezone} (WIB)</span>
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Alamat Kantor Pusat
                </div>
                <div className="flex items-start gap-2 text-slate-700 leading-relaxed">
                  <MapPin className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                  <span>{company.address || 'Palembang, Sumatera Selatan'}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 text-[10px] text-slate-400 flex items-center justify-between">
                  <span>Terakhir diperbarui: {company.updatedAt ? new Date(company.updatedAt).toLocaleString('id-ID') : '-'}</span>
                  <span>Oleh: {company.updatedBy || 'Sistem'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Edit Form Mode */
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Nama Legal Perusahaan (PT / Badan Usaha) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs font-bold text-[#082A4F]"
                placeholder="Contoh: PT KSBONE UNTUK KITA"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Harus sesuai akta pendirian resmi perusahaan.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Nama Brand / Merk Dagang <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs font-semibold"
                placeholder="Contoh: SENZU REFLEXOLOGY & FAMILY MASSAGE"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Email Resmi Perusahaan <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs font-mono"
                  placeholder="senzureflexology@gmail.com"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Disimpan dalam format huruf kecil (lowercase).
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                WhatsApp Customer Service <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs font-mono font-bold text-emerald-700"
                  placeholder="+6289654623347"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Disimpan dengan normalisasi otomatis format internasional (+628...).
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Zona Waktu Operasional <span className="text-red-500">*</span>
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs bg-white"
              >
                {SUPPORTED_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Status Perusahaan <span className="text-red-500">*</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs bg-white font-semibold"
              >
                <option value="ACTIVE">ACTIVE (Operasional Aktif)</option>
                <option value="INACTIVE">INACTIVE (Nonaktif)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Alamat Lengkap Kantor Pusat:
            </label>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs"
              placeholder="Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                NPWP (Nomor Pokok Wajib Pajak):
              </label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                placeholder="00.000.000.0-000.000 (Opsional)"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                NIB (Nomor Induk Berusaha):
              </label>
              <input
                type="text"
                value={nib}
                onChange={(e) => setNib(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                placeholder="Contoh: 1234567890123 (Opsional)"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Catatan Tambahan:</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
              placeholder="Catatan regulasi, perizinan, atau instruksi internal..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0A335F] text-white text-xs font-bold flex items-center gap-2 transition disabled:opacity-50 shadow-sm"
            >
              <Save className="w-4 h-4 text-[#D4AF37]" />
              <span>{saving ? 'Menyimpan ke Cloud...' : 'Simpan Profil Perusahaan'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
