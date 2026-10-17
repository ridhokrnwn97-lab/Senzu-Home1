import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  QrCode,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Save,
  Shield,
  Edit2,
  Ban,
  Building,
  FileText,
  Copy,
  Info,
  ExternalLink,
} from 'lucide-react';
import { PaymentSettings, BankAccountConfig, StaffUser } from '../../types';
import { getPaymentMasterConfig, savePaymentMasterConfig } from '../../lib/masterDataService';

interface PaymentMasterCardProps {
  currentUser: StaffUser;
  onRefresh: () => void;
  isReadOnly?: boolean;
}

export const PaymentMasterCard: React.FC<PaymentMasterCardProps> = ({
  currentUser,
  onRefresh,
  isReadOnly = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedBank, setCopiedBank] = useState<string | null>(null);

  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);

  // Modal State for Adding / Editing Bank Account
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [editingBankIndex, setEditingBankIndex] = useState<number | null>(null);
  const [bankFormData, setBankFormData] = useState<BankAccountConfig>({
    id: '',
    bankCode: 'BNI',
    bankName: 'Bank Negara Indonesia (BNI)',
    accountNumber: '',
    accountHolder: 'PT KSBONE UNTUK KITA',
    enabled: true,
    sortOrder: 1,
    instruction: '',
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getPaymentMasterConfig();
      // Ensure official defaults exist if array is empty
      if (!data.bankAccounts || data.bankAccounts.length === 0) {
        data.bankAccounts = [
          {
            id: 'bank_bni',
            bankCode: 'BNI',
            bankName: 'Bank Negara Indonesia (BNI)',
            accountNumber: '7009999772',
            accountHolder: 'PT KSBONE UNTUK KITA',
            enabled: true,
            sortOrder: 1,
          },
          {
            id: 'bank_mandiri',
            bankCode: 'MANDIRI',
            bankName: 'Bank Mandiri',
            accountNumber: '1120025626768',
            accountHolder: 'PT KSBONE UNTUK KITA',
            enabled: true,
            sortOrder: 2,
          },
          {
            id: 'bank_bri',
            bankCode: 'BRI',
            bankName: 'Bank Rakyat Indonesia (BRI)',
            accountNumber: '005901003894560',
            accountHolder: 'PT KSBONE UNTUK KITA',
            enabled: true,
            sortOrder: 3,
          },
        ];
      }
      setPaymentSettings(data);
    } catch (err) {
      console.error(err);
      setErrorMsg('Gagal memuat master pembayaran.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyNumber = (num: string, label: string) => {
    navigator.clipboard.writeText(num);
    setCopiedBank(label);
    setTimeout(() => setCopiedBank(null), 2500);
  };

  const handleToggleBank = (index: number) => {
    if (!paymentSettings || isReadOnly) return;
    const updated = [...paymentSettings.bankAccounts];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setPaymentSettings({ ...paymentSettings, bankAccounts: updated });
  };

  const handleOpenAddBank = () => {
    setEditingBankIndex(null);
    setBankFormData({
      id: `bank_${Date.now()}`,
      bankCode: 'BNI',
      bankName: 'Bank Negara Indonesia (BNI)',
      accountNumber: '',
      accountHolder: 'PT KSBONE UNTUK KITA',
      enabled: true,
      sortOrder: (paymentSettings?.bankAccounts?.length || 0) + 1,
      instruction: '',
    });
    setIsBankModalOpen(true);
  };

  const handleOpenEditBank = (index: number) => {
    if (!paymentSettings) return;
    setEditingBankIndex(index);
    setBankFormData({ ...paymentSettings.bankAccounts[index] });
    setIsBankModalOpen(true);
  };

  const handleSaveBankForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentSettings) return;

    if (!bankFormData.accountNumber.trim()) {
      alert('Nomor rekening tidak boleh kosong.');
      return;
    }

    // Preserve strictly as string to prevent loss of leading zero (e.g. 005901003894560)
    const cleanAccountNum = bankFormData.accountNumber.replace(/[^0-9]/g, '');

    const updatedBanks = [...paymentSettings.bankAccounts];
    const updatedItem: BankAccountConfig = {
      ...bankFormData,
      accountNumber: cleanAccountNum,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.name,
    };

    if (editingBankIndex !== null) {
      updatedBanks[editingBankIndex] = updatedItem;
    } else {
      updatedBanks.push(updatedItem);
    }

    setPaymentSettings({ ...paymentSettings, bankAccounts: updatedBanks });
    setIsBankModalOpen(false);
  };

  const handleDeleteBank = (index: number) => {
    if (!paymentSettings || isReadOnly) return;
    const currentBankAccounts = paymentSettings.bankAccounts || [];
    if (currentBankAccounts.length <= 1) {
      alert('Harus tersisa minimal satu rekening bank untuk opsi Transfer.');
      return;
    }
    const acc = currentBankAccounts[index];
    if (!acc) return;
    const confirm = window.confirm(`Hapus rekening ${acc.bankName} (${acc.accountNumber})?`);
    if (!confirm) return;

    const updated = currentBankAccounts.filter((_, i) => i !== index);
    setPaymentSettings({ ...paymentSettings, bankAccounts: updated });
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentSettings || isReadOnly) return;
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await savePaymentMasterConfig(paymentSettings, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg('Master Data Akun, QRIS, & Metode Pembayaran berhasil disimpan.');
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan pembayaran.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !paymentSettings) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
        <div className="inline-block animate-spin w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full mb-2"></div>
        <p className="text-sm font-medium">Memuat Master Data Pembayaran...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/40 via-white to-slate-50/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-700 flex items-center justify-center font-bold">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">Master Data Akun & Metode Pembayaran</h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                PT KSBONE UNTUK KITA
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Pengaturan rekening transfer resmi, QRIS statis merchant, dan panduan transfer pelanggan
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" />
            Manager Master Authority
          </span>
        </div>
      </div>

      {/* STRICT NO CASH POLICY BANNER */}
      <div className="mx-6 mt-6 p-4 rounded-xl bg-red-50/90 border border-red-200 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0 mt-0.5">
          <Ban className="w-4 h-4" />
        </div>
        <div className="text-xs text-red-900 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-[11px] text-red-800">
              Kebijakan Mutlak: Pembayaran Non-Tunai (Strict No Cash)
            </span>
            <span className="px-2 py-0.5 rounded-full bg-red-200/80 text-red-900 text-[10px] font-bold">
              Tunai Dinonaktifkan Permanen
            </span>
          </div>
          <p className="text-red-800 leading-relaxed">
            Senzu Home menerapkan kebijakan non-tunai demi transparansi keuangan, keamanan terapis di lapangan, dan kepastian reservasi. Pelanggan hanya dapat membayar melalui <strong>QRIS Resmi Senzu</strong> atau <strong>Transfer Bank Resmi PT KSBONE UNTUK KITA</strong> sebelum jadwal layanan dikonfirmasi.
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="mx-6 mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mx-6 mt-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSaveAll} className="p-6 space-y-8">
        {/* Section 1: Official Bank Accounts */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building className="w-4 h-4 text-amber-600" />
                Rekening Bank Transfer Resmi (PT KSBONE UNTUK KITA)
              </h4>
              <p className="text-xs text-slate-500">
                Nomor rekening ini ditampilkan pada halaman pembayaran customer dengan tombol salin otomatis
              </p>
            </div>

            {!isReadOnly && (
              <button
                type="button"
                onClick={handleOpenAddBank}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1 transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Tambah Rekening
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(paymentSettings.bankAccounts || []).filter(Boolean).map((acc, idx) => (
              <div
                key={acc.id || idx}
                className={`p-4 rounded-xl border transition relative flex flex-col justify-between ${
                  acc.enabled
                    ? 'border-slate-200 bg-white shadow-2xs hover:border-amber-300'
                    : 'border-dashed border-slate-200 bg-slate-50 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wider mb-1">
                        {acc.bankCode || 'BANK'}
                      </span>
                      <h5 className="font-bold text-slate-900 text-sm">
                        {acc.bankName || acc.bankCode || 'Bank Transfer'}
                      </h5>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={isReadOnly}
                        checked={acc.enabled}
                        onChange={() => handleToggleBank(idx)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-1 mb-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">No. Rekening:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900 tracking-wider">
                          {acc.accountNumber || '-'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyNumber(acc.accountNumber, acc.bankCode)}
                          className="text-slate-400 hover:text-amber-600 transition"
                          title="Salin nomor"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {copiedBank === acc.bankCode && (
                      <div className="text-[10px] text-emerald-600 text-right font-semibold">
                        Tersalin ke clipboard!
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">A.N:</span>
                      <span className="font-semibold text-slate-800 text-[11px] truncate max-w-[140px]" title={acc.accountHolder}>
                        {acc.accountHolder || 'PT KSBONE UNTUK KITA'}
                      </span>
                    </div>
                  </div>
                </div>

                {!isReadOnly && (
                  <div className="flex items-center justify-end gap-2 text-xs pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => handleOpenEditBank(idx)}
                      className="px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded font-medium flex items-center gap-1 transition cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Ubah
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBank(idx)}
                      className="px-2.5 py-1 text-red-600 hover:bg-red-50 rounded font-medium flex items-center gap-1 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Hapus
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: QRIS Merchant Settings */}
        <div className="pt-6 border-t border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <QrCode className="w-4 h-4 text-amber-600" />
                Konfigurasi QRIS Statis Merchant Resmi
              </h4>
              <p className="text-xs text-slate-500">
                Pindai barcode QRIS otomatis untuk kemudahan pembayaran langsung oleh seluruh aplikasi e-wallet & mobile banking
              </p>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={isReadOnly}
                checked={Boolean(paymentSettings.qris?.enabled)}
                onChange={() =>
                  setPaymentSettings({
                    ...paymentSettings,
                    qris: { ...paymentSettings.qris, enabled: !paymentSettings.qris?.enabled },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              <span className="ml-2 text-xs font-bold text-slate-700">
                {paymentSettings.qris?.enabled ? 'QRIS Aktif' : 'QRIS Nonaktif'}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 p-5 rounded-xl border border-slate-200/80">
            {/* QR Preview Column */}
            <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-slate-200 text-center">
              {paymentSettings.qris?.staticQrImageUrl || paymentSettings.qris?.imageUrl ? (
                <img
                  src={paymentSettings.qris?.staticQrImageUrl || paymentSettings.qris?.imageUrl}
                  alt="QRIS Preview"
                  className="w-44 h-44 object-contain rounded-lg border border-slate-200 mb-2 p-1 bg-white"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Fallback to local asset if external image fails
                    (e.target as HTMLImageElement).src = '/assets/payment/qris-senzu.jpg';
                  }}
                />
              ) : (
                <div className="w-44 h-44 bg-slate-100 rounded-lg flex flex-col items-center justify-center text-slate-400 mb-2">
                  <QrCode className="w-12 h-12 mb-1 opacity-50" />
                  <span className="text-[11px]">Belum Ada Gambar</span>
                </div>
              )}
              <span className="text-xs font-bold text-slate-800">
                {paymentSettings.qris?.merchantName || 'SENZU REFLEXOLOGY & FAMILY MASSAGE'}
              </span>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                NMID: {paymentSettings.qris?.nmid || 'ID1025449341847'}
              </span>
              <span className="text-[10px] text-emerald-700 font-semibold mt-1">
                A.N: {paymentSettings.qris?.accountHolder || 'PT KSBONE UNTUK KITA'}
              </span>
            </div>

            {/* QR Config Fields */}
            <div className="md:col-span-2 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nama Merchant QRIS</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={paymentSettings.qris?.merchantName ?? ''}
                    onChange={(e) =>
                      setPaymentSettings({
                        ...paymentSettings,
                        qris: { ...paymentSettings.qris, merchantName: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100 font-semibold"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    NMID (National Merchant ID)
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={paymentSettings.qris?.nmid ?? ''}
                    onChange={(e) =>
                      setPaymentSettings({
                        ...paymentSettings,
                        qris: { ...paymentSettings.qris, nmid: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Penyedia Acquirer</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={paymentSettings.qris?.acquirer ?? ''}
                    onChange={(e) =>
                      setPaymentSettings({
                        ...paymentSettings,
                        qris: { ...paymentSettings.qris, acquirer: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                    placeholder="Contoh: Bank BNI / Nobu"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nama Akun Settlement</label>
                  <input
                    type="text"
                    disabled={isReadOnly}
                    value={paymentSettings.qris?.accountHolder ?? ''}
                    onChange={(e) =>
                      setPaymentSettings({
                        ...paymentSettings,
                        qris: { ...paymentSettings.qris, accountHolder: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100 font-semibold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  URL / Path Gambar QR Code Statis
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={paymentSettings.qris?.staticQrImageUrl ?? paymentSettings.qris?.imageUrl ?? ''}
                  onChange={(e) =>
                    setPaymentSettings({
                      ...paymentSettings,
                      qris: { ...paymentSettings.qris, staticQrImageUrl: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100 font-mono"
                  placeholder="/assets/payment/qris-senzu.jpg"
                  required
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Gunakan URL gambar publik atau path internal <code>/assets/payment/qris-senzu.jpg</code>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Petunjuk Pembayaran QRIS Pelanggan</label>
                <textarea
                  rows={2}
                  disabled={isReadOnly}
                  value={paymentSettings.qris?.instruction ?? ''}
                  onChange={(e) =>
                    setPaymentSettings({
                      ...paymentSettings,
                      qris: { ...paymentSettings.qris, instruction: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                  placeholder="Buka aplikasi perbankan atau e-wallet Anda, pilih fitur Scan QRIS, lalu unggah bukti pembayaran..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Customer Instructions Configuration */}
        <div className="pt-6 border-t border-slate-200">
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-amber-600" />
            Konfigurasi Teks Petunjuk Pembayaran ke Pelanggan
          </h4>
          <p className="text-xs text-slate-500 mb-4">
            Sesuaikan teks instruksi yang dibaca pelanggan pada halaman pembayaran dan konfirmasi WhatsApp CS
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Petunjuk Transfer Bank
              </label>
              <textarea
                rows={3}
                disabled={isReadOnly}
                value={paymentSettings.instructions?.bankTransferInstruction || 'Silakan transfer sesuai total tagihan ke salah satu rekening resmi PT KSBONE UNTUK KITA di atas. Pastikan nominal sesuai hingga 3 digit terakhir jika ada kode unik.'}
                onChange={(e) =>
                  setPaymentSettings({
                    ...paymentSettings,
                    instructions: {
                      qrisInstruction: paymentSettings.instructions?.qrisInstruction || '',
                      bankTransferInstruction: e.target.value,
                      paymentProofInstruction: paymentSettings.instructions?.paymentProofInstruction || '',
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Petunjuk Bukti Pembayaran
              </label>
              <textarea
                rows={3}
                disabled={isReadOnly}
                value={paymentSettings.instructions?.paymentProofInstruction || 'Setelah transfer berhasil, unggah screenshot resi atau foto struk bukti pembayaran. Tim Customer Service Senzu akan memverifikasi reservasi Anda dalam 5-15 menit.'}
                onChange={(e) =>
                  setPaymentSettings({
                    ...paymentSettings,
                    instructions: {
                      qrisInstruction: paymentSettings.instructions?.qrisInstruction || '',
                      bankTransferInstruction: paymentSettings.instructions?.bankTransferInstruction || '',
                      paymentProofInstruction: e.target.value,
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Action Button */}
        {!isReadOnly && (
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan Perubahan...' : 'Simpan Master Pembayaran'}
            </button>
          </div>
        )}
      </form>

      {/* Modal Add / Edit Bank */}
      {isBankModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h4 className="text-base font-bold text-slate-900">
                {editingBankIndex !== null ? 'Ubah Rekening Bank' : 'Tambah Rekening Bank Baru'}
              </h4>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                PT KSBONE UNTUK KITA
              </span>
            </div>

            <form onSubmit={handleSaveBankForm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Pilihan Bank</label>
                <select
                  value={bankFormData.bankCode ?? 'BNI'}
                  onChange={(e) => {
                    const code = e.target.value;
                    let defaultName = `Bank ${code}`;
                    if (code === 'BNI') defaultName = 'Bank Negara Indonesia (BNI)';
                    if (code === 'MANDIRI') defaultName = 'Bank Mandiri';
                    if (code === 'BRI') defaultName = 'Bank Rakyat Indonesia (BRI)';
                    if (code === 'BCA') defaultName = 'Bank Central Asia (BCA)';
                    setBankFormData({
                      ...bankFormData,
                      bankCode: code,
                      bankName: defaultName,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none font-semibold"
                >
                  <option value="BNI">BNI (Bank Negara Indonesia)</option>
                  <option value="MANDIRI">MANDIRI (Bank Mandiri)</option>
                  <option value="BRI">BRI (Bank Rakyat Indonesia)</option>
                  <option value="BCA">BCA (Bank Central Asia)</option>
                  <option value="SUMSEL_BABEL">Bank Sumsel Babel</option>
                  <option value="BSI">BSI (Bank Syariah Indonesia)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nama Tampilan Bank</label>
                <input
                  type="text"
                  value={bankFormData.bankName ?? ''}
                  onChange={(e) => setBankFormData({ ...bankFormData, bankName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nomor Rekening <span className="text-amber-600 font-normal">(Disimpan persis sebagai teks)</span>
                </label>
                <input
                  type="text"
                  value={bankFormData.accountNumber ?? ''}
                  onChange={(e) => setBankFormData({ ...bankFormData, accountNumber: e.target.value })}
                  placeholder="Contoh: 005901003894560 atau 7009999772"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold tracking-wider focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Pastikan angka 0 di depan (seperti pada rekening BRI) tidak terhapus.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Atas Nama Rekening</label>
                <input
                  type="text"
                  value={bankFormData.accountHolder ?? ''}
                  onChange={(e) => setBankFormData({ ...bankFormData, accountHolder: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="bankEnabledModal"
                  checked={Boolean(bankFormData.enabled)}
                  onChange={(e) => setBankFormData({ ...bankFormData, enabled: e.target.checked })}
                  className="w-4 h-4 text-amber-600 rounded border-slate-300"
                />
                <label htmlFor="bankEnabledModal" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Aktifkan rekening ini untuk opsi pembayaran pelanggan
                </label>
              </div>

              <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBankModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition cursor-pointer"
                >
                  Simpan Rekening
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
