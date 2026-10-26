import React, { useState } from 'react';
import {
  MapPin,
  Clock,
  Phone,
  Mail,
  Edit2,
  CheckCircle2,
  Power,
  Plus,
  Navigation,
  ExternalLink,
  ShieldAlert,
  AlertCircle,
  Save,
  X,
  Compass,
} from 'lucide-react';
import { Branch, StaffUser } from '../../types';
import { saveBranch, toggleBranchStatus } from '../../lib/masterDataService';
import {
  formatWhatsAppDisplay,
  isValidEmail,
  isValidWhatsApp,
  isValidTimeFormat,
  SUPPORTED_TIMEZONES,
} from '../../lib/masterDataUtils';
import { getWaMeTarget } from '../../lib/supportWhatsApp';

interface BranchSettingsCardProps {
  branches: Branch[];
  currentUser: StaffUser;
  onRefresh: () => void;
}

export const BranchSettingsCard: React.FC<BranchSettingsCardProps> = ({
  branches = [],
  currentUser,
  onRefresh,
}) => {
  const isReadOnly = currentUser.role !== 'manager' && currentUser.role !== 'admin';
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewBranch, setIsNewBranch] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);

  // Form states
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [latitude, setLatitude] = useState<number>(-2.9859024);
  const [longitude, setLongitude] = useState<number>(104.7385997);
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [openingTime, setOpeningTime] = useState('10:00');
  const [closingTime, setClosingTime] = useState('22:00');
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [isDefault, setIsDefault] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Status toggle confirmation
  const [toggleConfirmBranch, setToggleConfirmBranch] = useState<Branch | null>(null);

  const handleOpenEdit = (branch: Branch) => {
    if (isReadOnly) return;
    setSelectedBranch(branch);
    setIsNewBranch(false);
    setCode(branch.code);
    setName(branch.name);
    setAddress(branch.address);
    setCity(branch.city);
    setProvince(branch.province);
    setPostalCode(branch.postalCode || '');
    setLatitude(branch.latitude);
    setLongitude(branch.longitude);
    setWhatsapp(branch.customerServiceWhatsApp);
    setEmail(branch.officialEmail);
    setOpeningTime(branch.openingTime);
    setClosingTime(branch.closingTime);
    setTimezone(branch.timezone);
    setStatus(branch.status);
    setIsDefault(Boolean(branch.isDefault));
    setErrorMsg('');
    setIsEditing(true);
  };

  const handleOpenNew = () => {
    if (isReadOnly) return;
    const newId = `branch_${Date.now().toString(36)}`;
    setSelectedBranch({
      id: newId,
      code: '',
      name: '',
      companyId: 'PT KSBONE UNTUK KITA',
      brandName: 'SENZU REFLEXOLOGY & FAMILY MASSAGE',
      address: '',
      city: 'PALEMBANG',
      province: 'SUMATERA SELATAN',
      latitude: -2.9859024,
      longitude: 104.7385997,
      customerServiceWhatsApp: '+6289654623347',
      officialEmail: 'senzureflexology@gmail.com',
      openingTime: '10:00',
      closingTime: '22:00',
      timezone: 'Asia/Jakarta',
      status: 'ACTIVE',
    });
    setIsNewBranch(true);
    setCode('');
    setName('');
    setAddress('');
    setCity('PALEMBANG');
    setProvince('SUMATERA SELATAN');
    setPostalCode('');
    setLatitude(-2.9859024);
    setLongitude(104.7385997);
    setWhatsapp('+6289654623347');
    setEmail('senzureflexology@gmail.com');
    setOpeningTime('10:00');
    setClosingTime('22:00');
    setTimezone('Asia/Jakarta');
    setStatus('ACTIVE');
    setIsDefault(false);
    setErrorMsg('');
    setIsEditing(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!code.trim()) {
      setErrorMsg('Kode Cabang (Branch Code) wajib diisi.');
      return;
    }
    if (!name.trim()) {
      setErrorMsg('Nama Cabang wajib diisi.');
      return;
    }
    if (!address.trim()) {
      setErrorMsg('Alamat Cabang wajib diisi.');
      return;
    }
    if (!isValidTimeFormat(openingTime) || !isValidTimeFormat(closingTime)) {
      setErrorMsg('Format jam operasional tidak valid (gunakan format HH:mm, contoh 10:00 atau 22:00).');
      return;
    }
    if (!isValidWhatsApp(whatsapp)) {
      setErrorMsg('Nomor WhatsApp tidak valid. Format: +628xxxxxxxxxx.');
      return;
    }
    if (!isValidEmail(email)) {
      setErrorMsg('Format email tidak valid.');
      return;
    }

    setSaving(true);
    try {
      const branchId = selectedBranch?.id || code.toUpperCase().trim();
      await saveBranch(
        {
          id: branchId,
          code: code.toUpperCase().trim(),
          name: name.trim(),
          companyId: 'PT KSBONE UNTUK KITA',
          brandName: 'SENZU REFLEXOLOGY & FAMILY MASSAGE',
          address: address.trim(),
          city: city.trim().toUpperCase(),
          province: province.trim().toUpperCase(),
          postalCode: postalCode.trim() || undefined,
          latitude: Number(latitude),
          longitude: Number(longitude),
          customerServiceWhatsApp: whatsapp.trim(),
          officialEmail: email.trim().toLowerCase(),
          openingTime: openingTime.trim(),
          closingTime: closingTime.trim(),
          timezone,
          status,
          isDefault,
        },
        isNewBranch,
        {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );

      setSuccessMsg(`Cabang "${name}" berhasil disimpan ke database.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      setIsEditing(false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan cabang.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!toggleConfirmBranch || isReadOnly) return;
    try {
      const newStatus = await toggleBranchStatus(toggleConfirmBranch, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as any,
      });
      setSuccessMsg(
        `Status cabang "${toggleConfirmBranch.name}" berhasil diubah menjadi ${newStatus}.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setToggleConfirmBranch(null);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengubah status cabang.');
    }
  };

  const handleResetToPalembangCoords = () => {
    setLatitude(-2.9859024);
    setLongitude(104.7385997);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#8B5A36] via-[#94603B] to-[#8B5A36] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D4AF37]/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
            <MapPin className="w-6 h-6 text-[#D4AF37]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-lg sm:text-xl font-bold text-white tracking-tight">
                Master Cabang Operasional (Branch)
              </h3>
              <span className="text-[10px] font-bold bg-[#D4AF37]/20 text-[#FDF3CD] border border-[#D4AF37]/40 px-2.5 py-0.5 rounded-full">
                {branches.length} Cabang Terdaftar
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Hub operasional home service, koordinat base, jam layanan, dan kontak cabang
            </p>
          </div>
        </div>

        {!isEditing && !isReadOnly && (
          <button
            type="button"
            onClick={handleOpenNew}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#4B2B18] text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Cabang</span>
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

      {isReadOnly && (
        <div className="mx-5 mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Mode Lihat Saja (Supervisor):</strong> Akses modifikasi atau aktivasi cabang operasional dibatasi hanya untuk Admin &amp; Manager.
          </span>
        </div>
      )}

      {/* Branches List Cards */}
      {!isEditing && (
        <div className="p-5 sm:p-6 space-y-4">
          {(branches || []).map((b) => {
            const isActive = b.status === 'ACTIVE';
            return (
              <div
                key={b.id}
                className={`rounded-2xl border transition-all p-5 sm:p-6 ${
                  isActive
                    ? 'border-slate-200 bg-white hover:border-[#D4AF37]/50 shadow-sm'
                    : 'border-slate-200/60 bg-slate-50/70 opacity-80'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  {/* Branch Main Identity */}
                  <div className="space-y-3 flex-grow">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-[#4B2B18] bg-[#8B5A36]/10 px-2.5 py-1 rounded-lg border border-[#8B5A36]/20">
                        {b.code}
                      </span>
                      <h4 className="text-base font-bold text-[#4B2B18]">{b.name}</h4>
                      {b.isDefault && (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full">
                          Cabang Utama
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : 'bg-slate-200 text-slate-700 border-slate-300'
                        }`}
                      >
                        {isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 flex items-start gap-2 leading-relaxed">
                      <MapPin className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                      <span>
                        {b.address}, {b.city}, {b.province} {b.postalCode ? `(${b.postalCode})` : ''}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>
                          Jam Operasional: <strong>{b.openingTime} - {b.closingTime}</strong> ({b.timezone})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-slate-600">
                        <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                        <a
                          href={`https://wa.me/${getWaMeTarget(b.customerServiceWhatsApp)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-emerald-700 hover:underline"
                        >
                          {formatWhatsAppDisplay(b.customerServiceWhatsApp)}
                        </a>
                      </div>

                      <div className="flex items-center gap-2 text-slate-600">
                        <Mail className="w-4 h-4 text-slate-400 shrink-0" />
                        <a href={`mailto:${b.officialEmail}`} className="hover:underline">
                          {b.officialEmail}
                        </a>
                      </div>
                    </div>

                    {/* Coordinates & Map Link */}
                    <div className="pt-2 border-t border-slate-100 flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
                      <span className="font-mono bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
                        GPS: {b.latitude.toFixed(6)}, {b.longitude.toFixed(6)}
                      </span>
                      <a
                        href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#4B2B18] font-semibold hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>Buka di Google Maps</span>
                      </a>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex lg:flex-col items-center gap-2 shrink-0 pt-2 lg:pt-0">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(b)}
                      disabled={isReadOnly}
                      className={`w-full px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${
                        isReadOnly
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-[#8B5A36] hover:bg-[#94603B] text-white cursor-pointer active:scale-95'
                      }`}
                    >
                      <Edit2 className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Edit Cabang</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setToggleConfirmBranch(b)}
                      disabled={isReadOnly}
                      className={`w-full px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border transition ${
                        isReadOnly
                          ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                          : isActive
                          ? 'border-red-200 bg-red-50 hover:bg-red-100 text-red-700 active:scale-95 cursor-pointer'
                          : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 active:scale-95 cursor-pointer'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{isActive ? 'Nonaktifkan' : 'Aktifkan'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit / New Branch Form Modal */}
      {isEditing && (
        <div className="p-5 sm:p-6 border-t border-slate-200 bg-slate-50/50">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
            <h4 className="text-sm font-bold text-[#4B2B18]">
              {isNewBranch ? 'Tambah Cabang Operasional Baru' : `Edit Cabang: ${name}`}
            </h4>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveBranch} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kode Cabang (Code) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  placeholder="Contoh: PLG001"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-[#4B2B18] uppercase focus:ring-2 focus:ring-[#8B5A36]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Cabang Resmi <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Senzu Reflexology & Family Massage Palembang"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-[#4B2B18] focus:ring-2 focus:ring-[#8B5A36]"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Alamat Lengkap Cabang <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                placeholder="Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#8B5A36]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kota <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value.toUpperCase())}
                  required
                  placeholder="PALEMBANG"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Provinsi <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={province}
                  onChange={(e) => setProvince(e.target.value.toUpperCase())}
                  required
                  placeholder="SUMATERA SELATAN"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kode Pos (Opsional)</label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="30134"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                />
              </div>
            </div>

            {/* GPS Coordinates Section with Map Picker */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#4B2B18] flex items-center gap-1.5">
                  <Navigation className="w-4 h-4 text-[#D4AF37]" />
                  Titik Koordinat Base Hub (GPS Cabang)
                </span>
                <button
                  type="button"
                  onClick={handleResetToPalembangCoords}
                  className="text-[11px] text-[#4B2B18] font-semibold hover:underline flex items-center gap-1"
                >
                  <Compass className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>Preset Senzu Palembang (Jl. Riau No.3)</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5 font-medium">Latitude:</label>
                  <input
                    type="number"
                    step="any"
                    value={latitude}
                    onChange={(e) => setLatitude(Number(e.target.value))}
                    required
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-0.5 font-medium">Longitude:</label>
                  <input
                    type="number"
                    step="any"
                    value={longitude}
                    onChange={(e) => setLongitude(Number(e.target.value))}
                    required
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs"
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400">
                Koordinat digunakan sebagai titik acuan perhitungan tier jarak radius home service (0-5 km, 5-10 km, dll).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  WhatsApp Operasional Cabang <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  required
                  placeholder="+6289654623347"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-semibold text-emerald-700"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Email Operasional Cabang <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="senzureflexology@gmail.com"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jam Buka (Opening) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={openingTime}
                  onChange={(e) => setOpeningTime(e.target.value)}
                  required
                  placeholder="10:00"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-center"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jam Tutup (Closing) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={closingTime}
                  onChange={(e) => setClosingTime(e.target.value)}
                  required
                  placeholder="22:00"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-center"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Zona Waktu <span className="text-red-500">*</span></label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                >
                  {SUPPORTED_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 text-[#4B2B18] rounded border-slate-300 focus:ring-[#8B5A36]"
                />
                <span className="font-semibold text-slate-700">Jadikan Cabang Default</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={status === 'ACTIVE'}
                  onChange={(e) => setStatus(e.target.checked ? 'ACTIVE' : 'INACTIVE')}
                  className="w-4 h-4 text-[#4B2B18] rounded border-slate-300 focus:ring-[#8B5A36]"
                />
                <span className="font-semibold text-slate-700">Cabang Aktif Beroperasi</span>
              </label>
            </div>

            <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={saving}
                className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white font-bold flex items-center gap-2 transition disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-[#D4AF37]" />
                <span>{saving ? 'Menyimpan...' : 'Simpan Cabang'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Modal for Toggle Status */}
      {toggleConfirmBranch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl p-6 shadow-2xl space-y-4 text-xs">
            <h4 className="text-sm font-bold text-[#4B2B18]">
              Konfirmasi {toggleConfirmBranch.status === 'ACTIVE' ? 'Penonaktifan' : 'Pengaktifan'} Cabang
            </h4>
            <p className="text-slate-600 leading-relaxed">
              Apakah Anda yakin ingin {toggleConfirmBranch.status === 'ACTIVE' ? 'menonaktifkan' : 'mengaktifkan'} cabang <strong>{toggleConfirmBranch.name} ({toggleConfirmBranch.code})</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setToggleConfirmBranch(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmToggleStatus}
                className={`px-4 py-2 rounded-xl font-bold text-white ${
                  toggleConfirmBranch.status === 'ACTIVE'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
