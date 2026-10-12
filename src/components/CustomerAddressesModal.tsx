import React, { useState, useEffect } from 'react';
import {
  X,
  MapPin,
  Plus,
  Trash2,
  Edit2,
  Check,
  Star,
  Home,
  Building,
  Briefcase,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { CustomerSavedAddress } from '../types/crm';
import {
  getCustomerSavedAddresses,
  saveCustomerAddress,
  updateCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
} from '../lib/crmService';
import { PALEMBANG_AREAS } from '../types';

interface CustomerAddressesModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  onSelectAddress?: (addr: CustomerSavedAddress) => void;
}

export const CustomerAddressesModal: React.FC<CustomerAddressesModalProps> = ({
  isOpen,
  onClose,
  customerId,
  onSelectAddress,
}) => {
  const [addresses, setAddresses] = useState<CustomerSavedAddress[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingAddr, setEditingAddr] = useState<CustomerSavedAddress | null>(null);

  // Form State
  const [label, setLabel] = useState<'Rumah' | 'Kantor' | 'Apartemen' | 'Lainnya'>('Rumah');
  const [addressText, setAddressText] = useState('');
  const [area, setArea] = useState<string>(PALEMBANG_AREAS[0]);
  const [addressNotes, setAddressNotes] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchAddresses = async () => {
    if (!customerId) return;
    setIsLoading(true);
    try {
      const list = await getCustomerSavedAddresses(customerId);
      setAddresses(list);
    } catch (err) {
      console.error('Error fetching addresses:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && customerId) {
      fetchAddresses();
      setIsFormOpen(false);
      setEditingAddr(null);
      setFormError(null);
    }
  }, [isOpen, customerId]);

  if (!isOpen) return null;

  const handleOpenAdd = () => {
    setEditingAddr(null);
    setLabel('Rumah');
    setAddressText('');
    setArea(PALEMBANG_AREAS[0]);
    setAddressNotes('');
    setIsDefault(addresses.length === 0);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (addr: CustomerSavedAddress) => {
    setEditingAddr(addr);
    setLabel((addr.label as any) || 'Rumah');
    setAddressText(addr.address);
    setArea(addr.area || PALEMBANG_AREAS[0]);
    setAddressNotes(addr.addressNotes || '');
    setIsDefault(addr.isDefault);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressText.trim() || addressText.trim().length < 5) {
      setFormError('Masukkan detail alamat yang lengkap (minimal 5 karakter).');
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (editingAddr) {
        await updateCustomerAddress(editingAddr.id, {
          label,
          address: addressText.trim(),
          area,
          addressNotes: addressNotes.trim(),
        });
        if (isDefault && !editingAddr.isDefault) {
          await setDefaultCustomerAddress(customerId, editingAddr.id);
        }
      } else {
        await saveCustomerAddress({
          customerId,
          label,
          address: addressText.trim(),
          area,
          addressNotes: addressNotes.trim(),
          isDefault,
        });
      }

      await fetchAddresses();
      setIsFormOpen(false);
      setEditingAddr(null);
    } catch (err: any) {
      console.error('Error saving address:', err);
      setFormError(err.message || 'Gagal menyimpan alamat. Silakan coba lagi.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefault = async (addrId: string) => {
    try {
      await setDefaultCustomerAddress(customerId, addrId);
      await fetchAddresses();
    } catch (err) {
      console.error('Error setting default address:', err);
    }
  };

  const handleDelete = async (addrId: string) => {
    if (!window.confirm('Hapus alamat ini dari daftar tersimpan?')) return;
    try {
      await deleteCustomerAddress(addrId);
      await fetchAddresses();
    } catch (err) {
      console.error('Error deleting address:', err);
    }
  };

  const getLabelIcon = (l: string) => {
    switch (l?.toLowerCase()) {
      case 'rumah':
        return <Home className="w-4 h-4 text-[#B89628]" />;
      case 'kantor':
        return <Briefcase className="w-4 h-4 text-blue-600" />;
      case 'apartemen':
        return <Building className="w-4 h-4 text-purple-600" />;
      default:
        return <MapPin className="w-4 h-4 text-emerald-600" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-[#D4AF37]/35 overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-[#082A4F] via-[#0B3564] to-[#0D3866] text-white flex items-center justify-between border-b border-[#D4AF37]/30 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shadow-xs">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg text-white leading-tight">
                Alamat Tersimpan
              </h3>
              <p className="text-[11px] text-slate-300">
                Pilih atau simpan alamat untuk kemudahan booking
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
        <div className="p-5 overflow-y-auto space-y-4">
          {isFormOpen ? (
            <form onSubmit={handleSaveForm} className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="font-serif font-bold text-sm text-[#082A4F]">
                  {editingAddr ? 'Ubah Alamat' : 'Tambah Alamat Baru'}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 transition"
                >
                  Batal
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Label Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#082A4F]">Label Alamat</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['Rumah', 'Kantor', 'Apartemen', 'Lainnya'] as const).map((lbl) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setLabel(lbl)}
                      className={`py-2 px-1 text-xs rounded-xl font-bold border text-center transition flex flex-col items-center gap-1 cursor-pointer ${
                        label === lbl
                          ? 'bg-[#082A4F] text-white border-[#082A4F] shadow-xs'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-white'
                      }`}
                    >
                      <span>{lbl}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail Alamat Lengkap */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#082A4F]">Alamat Lengkap</label>
                <textarea
                  required
                  rows={3}
                  value={addressText}
                  onChange={(e) => setAddressText(e.target.value)}
                  placeholder="Nama jalan, nomor rumah, RT/RW, blok, atau nama komplek..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition resize-none"
                />
              </div>

              {/* Kecamatan / Area */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#082A4F]">Kecamatan / Area (Kota Palembang)</label>
                <select
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
                >
                  {PALEMBANG_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              {/* Patokan / Catatan */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">
                  Patokan / Petunjuk Lokasi <span className="text-[10px] text-slate-400 font-normal">(Opsional)</span>
                </label>
                <input
                  type="text"
                  value={addressNotes}
                  onChange={(e) => setAddressNotes(e.target.value)}
                  placeholder="Contoh: Pagar hitam depan masjid, masuk gang samping indomaret"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm bg-slate-50/60 focus:bg-white focus:border-[#082A4F] outline-none transition"
                />
              </div>

              {/* Default Checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer pt-1 select-none">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded text-[#082A4F] focus:ring-[#D4AF37] border-slate-300"
                />
                <span className="text-xs font-semibold text-slate-700">
                  Jadikan sebagai alamat utama
                </span>
              </label>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
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
                    <span>Simpan Alamat</span>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Add Button */}
              <button
                type="button"
                onClick={handleOpenAdd}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-[#D4AF37]/50 hover:border-[#D4AF37] bg-amber-50/40 hover:bg-amber-50/80 text-[#082A4F] text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4 text-[#B89628]" />
                <span>Tambah Alamat Baru</span>
              </button>

              {/* List */}
              {isLoading ? (
                <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-[#082A4F]" />
                  <span>Memuat daftar alamat...</span>
                </div>
              ) : addresses.length === 0 ? (
                <div className="py-10 text-center text-slate-400 space-y-2">
                  <MapPin className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-xs font-semibold">Belum ada alamat tersimpan.</p>
                  <p className="text-[11px] text-slate-400">
                    Tambahkan alamat rumah atau kantor Anda untuk mempercepat pemesanan berikutnya.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(addresses || []).map((addr) => (
                    <div
                      key={addr.id}
                      className={`p-4 rounded-2xl border transition relative space-y-2.5 ${
                        addr.isDefault
                          ? 'bg-amber-50/40 border-[#D4AF37]/50 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-2xs">
                            {getLabelIcon(addr.label)}
                          </div>
                          <span className="font-bold text-xs sm:text-sm text-[#082A4F]">
                            {addr.label}
                          </span>
                          {addr.isDefault && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Utama
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(addr)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#082A4F] hover:bg-slate-100 transition cursor-pointer"
                            title="Ubah"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(addr.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="Hapus"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="text-xs text-slate-600 space-y-0.5">
                        <p className="font-medium text-slate-800">{addr.address}</p>
                        <p className="text-[11px] text-slate-500">Kecamatan: {addr.area}</p>
                        {addr.addressNotes && (
                          <p className="text-[11px] text-amber-800 italic bg-amber-50/80 px-2 py-1 rounded-lg mt-1">
                            Patokan: {addr.addressNotes}
                          </p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        {!addr.isDefault && (
                          <button
                            type="button"
                            onClick={() => handleSetDefault(addr.id)}
                            className="text-[11px] font-semibold text-[#082A4F] hover:text-[#D4AF37] underline transition cursor-pointer"
                          >
                            Jadikan Alamat Utama
                          </button>
                        )}

                        {onSelectAddress && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectAddress(addr);
                              onClose();
                            }}
                            className="ml-auto px-3 py-1.5 rounded-xl bg-[#082A4F] text-white text-[11px] font-bold hover:bg-[#0D3866] transition cursor-pointer flex items-center gap-1"
                          >
                            <Check className="w-3 h-3 text-[#D4AF37]" />
                            <span>Pilih Alamat Ini</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
