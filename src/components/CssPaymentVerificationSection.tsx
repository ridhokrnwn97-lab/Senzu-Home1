import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  AlertCircle,
  FileText,
  DollarSign,
  User,
  Calendar,
  AlertTriangle,
  Send,
  X,
  ShieldCheck,
  Building,
} from 'lucide-react';
import { Booking, PaymentRecord } from '../types';
import {
  subscribeToPendingPayments,
  cssVerifyPaymentTransaction,
  cssRejectPaymentTransaction,
  getPaymentStatusBadgeStyle,
} from '../lib/paymentService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { reportClientError } from '../lib/clientTelemetry';

interface CssPaymentVerificationSectionProps {
  bookings: Booking[];
  onRefresh?: () => void;
}

export const REJECTION_REASONS = [
  'Nominal tidak sesuai',
  'Pembayaran belum ditemukan',
  'Bukti pembayaran tidak jelas',
  'Bukti pembayaran duplikat',
  'Rekening tujuan salah',
  'Pembayaran gagal',
  'Lainnya',
];

export const CssPaymentVerificationSection: React.FC<CssPaymentVerificationSectionProps> = ({
  bookings,
}) => {
  const { currentUser } = useAuth();
  const [pendingPayments, setPendingPayments] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals state
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [activeModal, setActiveModal] = useState<'proof' | 'verify' | 'reject' | null>(null);

  // Reject modal fields
  const [selectedReason, setSelectedReason] = useState(REJECTION_REASONS[0]);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Processing protection
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Real-time subscription to pending payments
  useEffect(() => {
    const unsub = subscribeToPendingPayments((list) => {
      setPendingPayments(list);
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  const findBookingForPayment = (payment: PaymentRecord): Booking | undefined => {
    return bookings.find(
      (b) =>
        (payment.bookingId && b.id === payment.bookingId) ||
        (payment.bookingCode && b.bookingCode === payment.bookingCode)
    );
  };

  // Safe separation: actionable pending payments must have a matching valid booking
  const actionablePayments = React.useMemo(() => {
    if (bookings.length === 0) {
      return pendingPayments.filter((p) => Boolean(p.bookingId || p.bookingCode));
    }
    return pendingPayments.filter((p) => findBookingForPayment(p) !== undefined);
  }, [pendingPayments, bookings]);

  // Orphan payments: pending payments where the referenced booking does not exist
  const orphanPayments = React.useMemo(() => {
    if (bookings.length === 0) {
      return pendingPayments.filter((p) => !p.bookingId && !p.bookingCode);
    }
    return pendingPayments.filter((p) => findBookingForPayment(p) === undefined);
  }, [pendingPayments, bookings]);

  // Log sanitized telemetry if an orphan payment is encountered in the operational queue
  const loggedOrphanIdsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (bookings.length === 0 || orphanPayments.length === 0) return;

    const unloggedOrphans = orphanPayments.filter((p) => !loggedOrphanIdsRef.current.has(p.id));
    if (unloggedOrphans.length > 0) {
      unloggedOrphans.forEach((p) => loggedOrphanIdsRef.current.add(p.id));

      console.warn('[Payment Observability] payment_orphan_detected:', {
        count: unloggedOrphans.length,
        orphanPaymentIds: unloggedOrphans.map((p) => p.id),
      });

      reportClientError({
        event: 'payment_orphan_detected',
        messageSafe: `payment_orphan_detected: ${unloggedOrphans.length} payment(s) excluded from CSS queue due to missing booking`,
        category: 'PAYMENT',
        severity: 'WARNING',
        role: 'css',
      });
    }
  }, [orphanPayments, bookings]);

  const handleOpenVerify = (payment: PaymentRecord) => {
    setSelectedPayment(payment);
    setActiveModal('verify');
  };

  const handleOpenReject = (payment: PaymentRecord) => {
    setSelectedPayment(payment);
    setSelectedReason(REJECTION_REASONS[0]);
    setRejectNote('');
    setRejectError('');
    setActiveModal('reject');
  };

  const handleOpenProof = (payment: PaymentRecord) => {
    setSelectedPayment(payment);
    setActiveModal('proof');
  };

  const handleConfirmVerify = async () => {
    if (!selectedPayment || isProcessing) return;
    const booking = findBookingForPayment(selectedPayment);
    if (!booking) {
      setActionNotice({ type: 'error', message: 'Data booking tidak ditemukan.' });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await cssVerifyPaymentTransaction(
        selectedPayment,
        booking,
        (currentUser as any)?.id || currentUser?.uid || 'css-staff',
        currentUser?.name || 'CSS Admin',
        'Pembayaran diverifikasi oleh CSS'
      );

      if (res.success) {
        setActionNotice({
          type: 'success',
          message: `Pembayaran ${selectedPayment.bookingCode} berhasil diverifikasi (Lunas)!`,
        });
        setActiveModal(null);
        setSelectedPayment(null);
      } else {
        setActionNotice({ type: 'error', message: res.error || 'Gagal memverifikasi pembayaran.' });
      }
    } catch {
      setActionNotice({ type: 'error', message: 'Terjadi kesalahan sistem saat memverifikasi.' });
    } finally {
      setIsProcessing(false);
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  const handleConfirmReject = async () => {
    if (!selectedPayment || isProcessing) return;
    if (selectedReason === 'Lainnya' && !rejectNote.trim()) {
      setRejectError('Catatan wajib diisi jika memilih alasan "Lainnya".');
      return;
    }

    const booking = findBookingForPayment(selectedPayment);
    if (!booking) {
      setActionNotice({ type: 'error', message: 'Data booking tidak ditemukan.' });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await cssRejectPaymentTransaction(
        selectedPayment,
        booking,
        (currentUser as any)?.id || currentUser?.uid || 'css-staff',
        currentUser?.name || 'CSS Admin',
        selectedReason,
        rejectNote.trim()
      );

      if (res.success) {
        setActionNotice({
          type: 'success',
          message: `Pembayaran ${selectedPayment.bookingCode} telah ditolak dengan alasan: ${selectedReason}.`,
        });
        setActiveModal(null);
        setSelectedPayment(null);
      } else {
        setActionNotice({ type: 'error', message: res.error || 'Gagal menolak pembayaran.' });
      }
    } catch {
      setActionNotice({ type: 'error', message: 'Terjadi kesalahan sistem saat menolak pembayaran.' });
    } finally {
      setIsProcessing(false);
      setTimeout(() => setActionNotice(null), 4000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Alert Notice */}
      {actionNotice && (
        <div
          className={`p-4 rounded-2xl border text-xs sm:text-sm font-semibold flex items-center gap-2.5 animate-in fade-in ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {actionNotice.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          )}
          <span>{actionNotice.message}</span>
        </div>
      )}

      {/* Orphan Notice Banner (if any orphan payments exist in database) */}
      {orphanPayments.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              <strong>Pemberitahuan Sistem:</strong> Terdeteksi {orphanPayments.length} catatan pembayaran tanpa reservasi aktif. Catatan ini diamankan untuk pemeriksaan Manager dan dialihkan dari antrean verifikasi CSS.
            </span>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-serif font-bold text-base text-[#082A4F] flex items-center gap-2">
              Pembayaran Menunggu Verifikasi
              <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-xs font-bold shadow-sm">
                {actionablePayments.length}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Periksa bukti transfer dan mutasi bank resmi sebelum melakukan verifikasi.
            </p>
          </div>
        </div>
      </div>

      {/* Pending Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF9F6] border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">Kode Booking</th>
                <th className="px-4 py-3">Pelanggan</th>
                <th className="px-4 py-3">Jadwal Treatment</th>
                <th className="px-4 py-3">Treatment</th>
                <th className="px-4 py-3 text-right">Total Tagihan</th>
                <th className="px-4 py-3">Metode Bayar</th>
                <th className="px-4 py-3">Bukti</th>
                <th className="px-4 py-3">Waktu Unggah</th>
                <th className="px-4 py-3 text-center">Aksi Verifikasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {actionablePayments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                    <span>Tidak ada pembayaran yang menunggu verifikasi saat ini.</span>
                  </td>
                </tr>
              ) : (
                (actionablePayments || []).map((payment) => {
                  const booking = findBookingForPayment(payment);
                  return (
                    <tr key={payment.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3 font-mono font-bold text-[#082A4F]">
                        {payment.bookingCode}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{payment.customerName}</div>
                        <div className="text-[11px] text-slate-500">{payment.customerWhatsApp}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {booking ? (
                          <>
                            <div>{booking.scheduleDate}</div>
                            <div className="text-[11px] text-slate-500">{booking.scheduleTime} WIB</div>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {booking?.serviceName || 'Refleksi'}
                      </td>
                      <td className="px-4 py-3 text-right font-serif font-bold text-[#082A4F]">
                        {formatRupiah(payment.amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 font-semibold text-[11px] border border-blue-200">
                          {payment.paymentMethod}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {payment.paymentProofUrl ? (
                          <button
                            type="button"
                            onClick={() => handleOpenProof(payment)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold transition"
                          >
                            <Eye className="w-3 h-3 text-[#082A4F]" />
                            <span>Lihat Bukti</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">Belum ada</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-500">
                        {payment.paymentProofUploadedAt
                          ? new Date(payment.paymentProofUploadedAt).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenVerify(payment)}
                            className="px-3 py-1.5 min-h-[36px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition active:scale-95"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verifikasi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenReject(payment)}
                            className="px-3 py-1.5 min-h-[36px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition active:scale-95"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Tolak</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Lihat Bukti */}
      {activeModal === 'proof' && selectedPayment && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 relative">
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h4 className="font-serif font-bold text-[#082A4F] text-base">
                Bukti Pembayaran Reservasi
              </h4>
              <p className="text-xs text-slate-500 font-mono">
                {selectedPayment.bookingCode} • Total: {formatRupiah(selectedPayment.amount)}
              </p>
            </div>

            {selectedPayment.paymentProofMimeType === 'application/pdf' ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <FileText className="w-12 h-12 text-blue-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">
                  {selectedPayment.paymentProofFileName || 'Dokumen PDF Bukti Transfer'}
                </p>
                <a
                  href={selectedPayment.paymentProofUrl}
                  download={selectedPayment.paymentProofFileName || 'bukti-transfer.pdf'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#082A4F] text-white text-xs font-bold"
                >
                  <Eye className="w-4 h-4" />
                  <span>Buka Dokumen PDF</span>
                </a>
              </div>
            ) : (
              <div className="p-2 bg-slate-100 rounded-2xl border border-slate-200 text-center">
                <img
                  src={selectedPayment.paymentProofUrl}
                  alt="Bukti Transfer"
                  className="max-h-[60vh] mx-auto object-contain rounded-lg"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setActiveModal('verify');
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition"
              >
                Lanjut ke Verifikasi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verifikasi Pembayaran (Double-click Protected) */}
      {activeModal === 'verify' && selectedPayment && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 relative">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h4 className="font-serif font-bold text-lg text-[#082A4F]">
                Konfirmasi Verifikasi Pembayaran
              </h4>
              <p className="text-xs text-slate-500">
                Kode Booking: <span className="font-mono font-bold text-[#082A4F]">{selectedPayment.bookingCode}</span>
              </p>
            </div>

            <div className="bg-[#FAF9F6] p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Pelanggan:</span>
                <span className="font-bold text-slate-900">{selectedPayment.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Metode Bayar:</span>
                <span className="font-semibold text-slate-900">{selectedPayment.paymentMethod}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200">
                <span className="text-slate-700 font-bold">Total Nominal:</span>
                <span className="font-serif font-bold text-base text-[#082A4F]">
                  {formatRupiah(selectedPayment.amount)}
                </span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span>
                Pastikan nominal <strong>{formatRupiah(selectedPayment.amount)}</strong> telah masuk pada mutasi rekening resmi PT KSBONE UNTUK KITA / settlement QRIS.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setActiveModal(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConfirmVerify}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Ya, Verifikasi Pembayaran</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Tolak Pembayaran */}
      {activeModal === 'reject' && selectedPayment && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full space-y-4 relative">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setActiveModal(null)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-2">
                <XCircle className="w-6 h-6" />
              </div>
              <h4 className="font-serif font-bold text-lg text-rose-900">
                Tolak Pembayaran Reservasi
              </h4>
              <p className="text-xs text-slate-500">
                Kode: <span className="font-mono font-bold text-slate-800">{selectedPayment.bookingCode}</span>
              </p>
            </div>

            {rejectError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {rejectError}
              </div>
            )}

            {/* Radio Reasons List */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Pilih Alasan Penolakan (Wajib):
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {REJECTION_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                      selectedReason === reason
                        ? 'border-rose-300 bg-rose-50/60 font-semibold text-rose-900'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="rejectionReason"
                      value={reason}
                      checked={selectedReason === reason}
                      onChange={() => setSelectedReason(reason)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Rejection Note */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Catatan Tambahan untuk Pelanggan:
                {selectedReason === 'Lainnya' && <span className="text-rose-600 ml-1">*Wajib</span>}
              </label>
              <textarea
                rows={2}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Misal: Mutasi transfer atas nama Budi belum masuk ke rekening BNI Senzu."
                className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => setActiveModal(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleConfirmReject}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Menolak...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Konfirmasi Tolak</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
