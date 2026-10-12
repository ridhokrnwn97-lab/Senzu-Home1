import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  Lock,
  FileText,
  UserX
} from 'lucide-react';
import { useCustomerAuth } from '../context/CustomerAuthContext';

interface CustomerAccountDeletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CustomerAccountDeletionModal: React.FC<CustomerAccountDeletionModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { currentCustomer, firebaseUser, logoutCustomer } = useCustomerAuth();

  const [reasonCategory, setReasonCategory] = useState('Pindah domisili');
  const [customReason, setCustomReason] = useState('');
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isAgreed, setIsAgreed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setReasonCategory('Pindah domisili');
      setCustomReason('');
      setConfirmationInput('');
      setIsAgreed(false);
      setStatusMessage(null);
      setIsCompleted(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isConfirmed = isAgreed && confirmationInput.trim().toUpperCase() === 'HAPUS';

  const handleRequestDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed) {
      setStatusMessage({
        type: 'error',
        text: 'Silakan ketik kata "HAPUS" dan centang kotak persetujuan untuk mengonfirmasi.',
      });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      // 1. Get current customer Firebase ID token for trusted authentication
      let idToken = '';
      if (firebaseUser) {
        idToken = await firebaseUser.getIdToken(true);
      }

      const fullReason = reasonCategory === 'Lainnya'
        ? (customReason.trim() || 'Lainnya')
        : (customReason.trim() ? `${reasonCategory} - ${customReason.trim()}` : reasonCategory);

      // 2. Submit to server-authoritative authenticated endpoint
      const response = await fetch('/api/account-deletion/authenticated-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          customerId: currentCustomer?.id,
          reason: fullReason,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || result.error || 'Gagal memproses permintaan hapus akun.');
      }

      setIsCompleted(true);

      // Automatically sign out customer after recording request
      setTimeout(async () => {
        try {
          await logoutCustomer();
          if (onSuccess) onSuccess();
        } catch (err) {
          console.warn('Post-deletion logout notice:', err);
        }
      }, 3000);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Terjadi kesalahan sistem. Silakan coba kembali atau hubungi Customer Service.',
      });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl border border-rose-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-rose-900 to-[#082A4F] text-white flex items-center justify-between border-b border-rose-800/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <ShieldAlert className="w-5 h-5 text-rose-300" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg text-white">
                Hapus Akun Senzu Home
              </h3>
              <p className="text-[11px] text-rose-200">
                Pengajuan Penutupan Akun & Penghapusan Data Pribadi
              </p>
            </div>
          </div>

          {!isSubmitting && !isCompleted && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
              aria-label="Tutup"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
          {isCompleted ? (
            <div className="text-center space-y-4 py-4 animate-in fade-in">
              <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <h4 className="font-serif font-bold text-lg text-[#082A4F]">
                  Permintaan Berhasil Diajukan
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
                  Permintaan penghapusan akun <strong>{currentCustomer?.email}</strong> telah dicatat. Sesi aktif Anda akan ditutup secara otomatis dalam beberapa detik.
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-[11px] text-slate-500">
                Data pribadi Anda akan diproses sesuai ketentuan privasi Senzu Home. Terima kasih telah mempercayai layanan kami.
              </div>
            </div>
          ) : (
            <form onSubmit={handleRequestDeletion} className="space-y-4">
              {/* Customer Account Identifier Summary */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-500 font-medium">Akun Pelanggan:</span>
                  <span className="font-bold text-slate-800">{currentCustomer?.name || 'Pelanggan Senzu'}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-500 font-medium">Email:</span>
                  <span className="font-mono text-slate-700">{currentCustomer?.email}</span>
                </div>
                {currentCustomer?.phone && (
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-500 font-medium">Nomor WhatsApp:</span>
                    <span className="font-mono text-slate-700">{currentCustomer.phone}</span>
                  </div>
                )}
              </div>

              {/* Consequence Notice */}
              <div className="p-3.5 bg-amber-50/80 rounded-2xl border border-amber-200 text-amber-900 space-y-2 text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5 font-bold text-amber-950">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Informasi Data yang Dihapus & Retensi yang Berlaku:</span>
                </div>
                <ul className="list-disc list-inside space-y-1.5 pl-1 text-amber-900">
                  <li>
                    <strong>Data yang Dihapus:</strong> Akun profil, kredensial login, seluruh alamat hunian tersimpan, preferensi komunikasi, personalisasi, serta saldo poin loyalitas dan voucher promo akan dihapus permanen.
                  </li>
                  <li>
                    <strong>Data yang Tetap Disimpan Terbatas:</strong> Catatan transaksi booking yang telah selesai, bukti verifikasi pembayaran, dan faktur pembukuan akuntansi tetap disimpan secara terbatas apabila diperlukan untuk kewajiban hukum, perpajakan, akuntansi, pencegahan penipuan, penyelesaian sengketa, atau integritas audit.
                  </li>
                  <li>
                    <strong>Kebijakan Retensi:</strong> Data yang wajib dipertahankan hanya disimpan selama periode yang diwajibkan atau diizinkan berdasarkan ketentuan hukum yang berlaku, kemudian dihapus atau dianonimkan apabila tidak lagi diperlukan (tidak disimpan tanpa batas waktu).
                  </li>
                </ul>
              </div>

              {/* Status feedback */}
              {statusMessage && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    statusMessage.type === 'error'
                      ? 'bg-rose-50 border border-rose-200 text-rose-800'
                      : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{statusMessage.text}</span>
                </div>
              )}

              {/* Reason selection */}
              <div>
                <label htmlFor="modal-del-reason" className="block font-bold text-slate-700 mb-1">
                  Alasan Penghapusan Akun (Opsional)
                </label>
                <select
                  id="modal-del-reason"
                  value={reasonCategory}
                  onChange={(e) => setReasonCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                >
                  <option value="Pindah domisili">Sudah pindah domisili dari Kota Palembang</option>
                  <option value="Jarang menggunakan layanan">Jarang menggunakan layanan home service</option>
                  <option value="Privasi data pribadi">Alasan privasi atau keamanan data pribadi</option>
                  <option value="Ingin membuat akun baru">Ingin membuat akun baru</option>
                  <option value="Lainnya">Alasan Lainnya</option>
                </select>
              </div>

              {/* Custom reason note */}
              {reasonCategory === 'Lainnya' && (
                <div>
                  <label htmlFor="modal-del-custom" className="block font-bold text-slate-700 mb-1">
                    Tuliskan Catatan Tambahan
                  </label>
                  <input
                    id="modal-del-custom"
                    type="text"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Alasan Anda..."
                    maxLength={150}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  />
                </div>
              )}

              {/* Agreement checkbox */}
              <div>
                <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAgreed}
                    onChange={(e) => setIsAgreed(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="text-[11px] text-slate-600 leading-relaxed">
                    Saya mengerti dan menyetujui bahwa penghapusan akun bersifat permanen dan tidak dapat dibatalkan setelah diproses.
                  </span>
                </label>
              </div>

              {/* Confirmation word input */}
              <div>
                <label htmlFor="modal-del-confirm-word" className="block font-bold text-slate-700 mb-1">
                  Ketik kata <span className="font-mono text-rose-600 font-extrabold uppercase">HAPUS</span> untuk konfirmasi:
                </label>
                <input
                  id="modal-del-confirm-word"
                  type="text"
                  value={confirmationInput}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  placeholder="Ketik HAPUS di sini"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>

              {/* Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  Batalkan
                </button>
                <button
                  type="submit"
                  disabled={!isConfirmed || isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs transition shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Mengajukan...</span>
                    </>
                  ) : (
                    <>
                      <UserX className="w-3.5 h-3.5" />
                      <span>Konfirmasi Hapus Akun</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
