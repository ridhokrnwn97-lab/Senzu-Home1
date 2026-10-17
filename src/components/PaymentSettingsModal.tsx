import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  CreditCard,
  QrCode,
  Save,
  Check,
  Building,
  Upload,
  AlertCircle,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { PaymentSettings, BankAccountSetting, QrisSetting } from '../types';
import {
  getPaymentSettings,
  updatePaymentSettings,
  DEFAULT_PAYMENT_SETTINGS,
} from '../lib/paymentService';
import { optimizeFileForFirestore } from '../lib/imageOptimizer';

interface PaymentSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const PaymentSettingsModal: React.FC<PaymentSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [settings, setSettings] = useState<PaymentSettings>(DEFAULT_PAYMENT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const qrisFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const data = await getPaymentSettings();
        setSettings(data);
      } catch {
        setSettings(DEFAULT_PAYMENT_SETTINGS);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBankChange = (
    index: number,
    field: keyof BankAccountSetting,
    value: string | boolean
  ) => {
    const updatedBanks = [...settings.bankAccounts];
    updatedBanks[index] = {
      ...updatedBanks[index],
      [field]: value,
    };
    setSettings({ ...settings, bankAccounts: updatedBanks });
  };

  const handleQrisChange = (field: keyof QrisSetting, value: string | boolean) => {
    setSettings({
      ...settings,
      qris: {
        ...settings.qris,
        [field]: value,
      },
    });
  };

  const handleQrisImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 15 * 1024 * 1024) {
        setErrorMsg('Ukuran file QRIS maksimal 15 MB.');
        return;
      }
      try {
        const optimized = await optimizeFileForFirestore(file, {
          maxDimension: 1000,
          initialQuality: 0.8,
          maxOutputSizeBytes: 300 * 1024,
        });
        handleQrisChange('imageUrl', optimized.dataUrl);
        setSuccessMsg('Gambar QRIS resmi berhasil dioptimasi & diunggah.');
        setTimeout(() => setSuccessMsg(''), 3000);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Gagal memproses gambar QRIS.');
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg('');
    try {
      await updatePaymentSettings(settings);
      setSuccessMsg('Pengaturan pembayaran berhasil disimpan.');
      if (onSaved) onSaved();
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 1500);
    } catch {
      setErrorMsg('Gagal menyimpan pengaturan.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-slate-100 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 text-[#082A4F] text-xs font-bold mb-1">
            <CreditCard className="w-3.5 h-3.5 text-[#B89628]" />
            Pengaturan Master Pembayaran
          </div>
          <h3 className="font-serif font-bold text-xl text-[#082A4F]">
            Konfigurasi Rekening Bank & QRIS Senzu
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Database-driven settings untuk seluruh kanal pembayaran resmi Senzu Home.
          </p>
        </div>

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-xs text-slate-400">Memuat pengaturan...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* QRIS Settings */}
            <div className="p-5 rounded-2xl bg-[#FAF9F6] border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="font-serif font-bold text-sm text-[#082A4F] flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-[#B89628]" />
                  Konfigurasi QRIS Senzu (Statis)
                </h4>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.qris?.enabled)}
                    onChange={(e) => handleQrisChange('enabled', e.target.checked)}
                    className="rounded text-[#082A4F] focus:ring-[#082A4F]"
                  />
                  <span>Aktif</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Nama Merchant:</label>
                  <input
                    type="text"
                    value={settings.qris?.merchantName ?? ''}
                    onChange={(e) => handleQrisChange('merchantName', e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-medium text-slate-800 focus:ring-2 focus:ring-[#082A4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">NMID Resmi:</label>
                  <input
                    type="text"
                    value={settings.qris?.nmid ?? ''}
                    onChange={(e) => handleQrisChange('nmid', e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono font-medium text-slate-800 focus:ring-2 focus:ring-[#082A4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Atas Nama Rekening:</label>
                  <input
                    type="text"
                    value={settings.qris?.accountHolder ?? ''}
                    onChange={(e) => handleQrisChange('accountHolder', e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-medium text-slate-800 focus:ring-2 focus:ring-[#082A4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Acquirer / Bank:</label>
                  <input
                    type="text"
                    value={settings.qris?.acquirer ?? ''}
                    onChange={(e) => handleQrisChange('acquirer', e.target.value)}
                    required
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-medium text-slate-800 focus:ring-2 focus:ring-[#082A4F] focus:outline-none"
                  />
                </div>
              </div>

              {/* Upload QRIS Image File */}
              <div className="pt-2 border-t border-slate-200">
                <label className="block text-slate-700 font-bold text-xs mb-1.5">
                  File Gambar QRIS Resmi (IMG_8421 / JPG / PNG):
                </label>
                <div className="flex items-center gap-3">
                  <input
                    ref={qrisFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/jpg"
                    onChange={handleQrisImageUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => qrisFileInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File QRIS Resmi</span>
                  </button>
                  {(settings.qris.imageUrl || true) && (
                    <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      File QRIS Resmi Aktif (/assets/payment/qris-senzu.jpg)
                    </span>
                  )}
                </div>
                <div className="mt-2 p-2 bg-white rounded-xl border border-slate-200 inline-block">
                  <img
                    src={settings.qris.imageUrl || '/assets/payment/qris-senzu.jpg'}
                    alt="Pratinjau QRIS Resmi"
                    className="w-40 h-auto object-contain rounded"
                  />
                </div>
              </div>
            </div>

            {/* Bank Accounts Settings */}
            <div className="space-y-3">
              <h4 className="font-serif font-bold text-sm text-[#082A4F] flex items-center gap-2">
                <Building className="w-4 h-4 text-[#B89628]" />
                Rekening Bank Resmi Senzu Home
              </h4>

              {(settings.bankAccounts || []).filter(Boolean).map((bank, idx) => (
                <div
                  key={bank.bankCode || idx}
                  className="p-4 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-[#082A4F]">
                      Bank {bank.bankName || bank.bankCode || 'Bank'} ({bank.bankCode || 'BANK'})
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={bank.enabled !== false}
                        onChange={(e) => handleBankChange(idx, 'enabled', e.target.checked)}
                        className="rounded text-[#082A4F]"
                      />
                      <span>Tampilkan</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-500 mb-1">Nomor Rekening:</label>
                      <input
                        type="text"
                        value={bank.accountNumber || ''}
                        onChange={(e) => handleBankChange(idx, 'accountNumber', e.target.value)}
                        className="w-full p-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-500 mb-1">Atas Nama (Holder):</label>
                      <input
                        type="text"
                        value={bank.accountHolder || ''}
                        onChange={(e) => handleBankChange(idx, 'accountHolder', e.target.value)}
                        className="w-full p-2 rounded-xl border border-slate-300 font-medium text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0D3866] text-white text-xs font-bold flex items-center gap-2 shadow-md transition cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <Save className="w-4 h-4 text-[#D4AF37]" />
                <span>{isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
