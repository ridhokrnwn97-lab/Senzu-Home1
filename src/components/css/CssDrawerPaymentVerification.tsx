import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  ExternalLink,
  MessageCircle,
  AlertTriangle,
  AlertCircle,
  RotateCcw,
  FileText,
  X,
  CreditCard,
  Building2,
  QrCode,
  DollarSign,
  User,
  Info,
} from 'lucide-react';
import { Booking, PaymentRecord } from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  cssVerifyPaymentTransaction,
  cssRejectPaymentTransaction,
  subscribeToPaymentForBooking,
  getPaymentStatusBadgeStyle,
} from '../../lib/paymentService';
import { formatDateTimeWIB, formatRupiah } from '../../lib/utils';
import { getWhatsAppDeepLink } from './cssHelpers';

interface CssDrawerPaymentVerificationProps {
  booking: Booking;
  currentUserId: string;
  currentUserName: string;
  onRefresh: () => void;
  onWhatsAppClick?: () => void;
}

const REJECTION_REASONS = [
  'Nominal tidak sesuai',
  'Bukti tidak terbaca / tidak jelas',
  'Rekening tujuan tidak sesuai',
  'Transaksi belum ditemukan',
  'Bukti bukan transaksi terkait',
  'Lainnya',
];

export const CssDrawerPaymentVerification: React.FC<CssDrawerPaymentVerificationProps> = ({
  booking,
  currentUserId,
  currentUserName,
  onRefresh,
  onWhatsAppClick,
}) => {
  const { hasRole } = useAuth();
  const canVerify = hasRole(['css', 'manager', 'admin']);

  const [paymentRecord, setPaymentRecord] = useState<PaymentRecord | null>(null);
  const [isLoadingPayment, setIsLoadingPayment] = useState(true);

  // Modal states
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);

  // Form states
  const [verificationNote, setVerificationNote] = useState('');
  const [selectedRejectReason, setSelectedRejectReason] = useState('');
  const [rejectCustomerNote, setRejectCustomerNote] = useState('');
  const [rejectInternalNote, setRejectInternalNote] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Processing & Feedback states
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [imageError, setImageError] = useState(false);

  // Subscribe to payment record in real-time
  useEffect(() => {
    setIsLoadingPayment(true);
    setImageError(false);
    setPaymentNotice(null);

    const unsubscribe = subscribeToPaymentForBooking(
      booking.id,
      booking.bookingCode,
      (payment) => {
        setPaymentRecord(payment);
        setIsLoadingPayment(false);
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [booking.id, booking.bookingCode]);

  // Status flags
  const isPaymentPaid =
    booking.paymentStatus === 'paid' || paymentRecord?.status === 'paid';

  const isPaymentRejected =
    booking.paymentStatus === 'payment_rejected' ||
    paymentRecord?.status === 'payment_rejected';

  const isPaymentExpired =
    booking.paymentStatus === 'expired' || paymentRecord?.status === 'expired';

  const isPendingVerification =
    !isPaymentPaid &&
    !isPaymentExpired &&
    (booking.paymentStatus === 'pending_manual_verification' ||
      paymentRecord?.status === 'pending_manual_verification');

  const hasProof = !!paymentRecord?.paymentProofUrl;
  const isPdfProof =
    paymentRecord?.paymentProofMimeType === 'application/pdf' ||
    paymentRecord?.paymentProofUrl?.startsWith('data:application/pdf') ||
    paymentRecord?.paymentProofUrl?.toLowerCase().endsWith('.pdf');

  // Amount comparison (Item 25)
  const expectedAmount = booking.totalAmount;
  const uploadedAmount = paymentRecord?.amount ?? booking.totalAmount;
  const isAmountMatch = expectedAmount === uploadedAmount;

  // Handle WhatsApp Link
  const handleOpenWhatsApp = () => {
    if (onWhatsAppClick) {
      onWhatsAppClick();
    } else {
      const msg = `Halo Kak ${booking.customerName}, kami dari Customer Support Senzu Home Services terkait pemesanan ${booking.bookingCode} (${formatRupiah(booking.totalAmount)}). Mohon konfirmasi mengenai bukti pembayaran. Terima kasih.`;
      const link = getWhatsAppDeepLink(booking.customerWhatsApp, msg);
      window.open(link, '_blank');
    }
  };

  // Handle Verify Confirmation
  const handleConfirmVerify = async () => {
    if (!paymentRecord || isProcessing || !canVerify) return;
    setIsProcessing(true);
    setPaymentNotice(null);

    try {
      const res = await cssVerifyPaymentTransaction(
        paymentRecord,
        booking,
        currentUserId,
        currentUserName,
        verificationNote.trim() || undefined
      );

      if (res.success) {
        setPaymentNotice({
          type: 'success',
          message: `Pembayaran ${formatRupiah(uploadedAmount)} untuk ${booking.bookingCode} berhasil diverifikasi! Booking otomatis dikonfirmasi & masuk antrean Supervisor.`,
        });
        setIsVerifyModalOpen(false);
        setVerificationNote('');
        onRefresh();
      } else {
        setPaymentNotice({
          type: 'error',
          message: res.error || 'Gagal memverifikasi pembayaran.',
        });
      }
    } catch (err) {
      console.error('Failed to verify payment:', err);
      setPaymentNotice({
        type: 'error',
        message: 'Terjadi kesalahan sistem saat memverifikasi pembayaran.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle Reject Confirmation
  const handleConfirmReject = async () => {
    if (!paymentRecord || isProcessing || !canVerify) return;

    if (!selectedRejectReason) {
      setRejectError('Pilih alasan penolakan pembayaran.');
      return;
    }
    if (selectedRejectReason === 'Lainnya' && !rejectCustomerNote.trim()) {
      setRejectError('Catatan untuk pelanggan wajib diisi jika memilih alasan Lainnya.');
      return;
    }

    setIsProcessing(true);
    setRejectError('');
    setPaymentNotice(null);

    try {
      const combinedNote = rejectCustomerNote.trim()
        ? rejectInternalNote.trim()
          ? `${rejectCustomerNote.trim()} | Internal: ${rejectInternalNote.trim()}`
          : rejectCustomerNote.trim()
        : rejectInternalNote.trim() || undefined;

      const res = await cssRejectPaymentTransaction(
        paymentRecord,
        booking,
        currentUserId,
        currentUserName,
        selectedRejectReason,
        combinedNote
      );

      if (res.success) {
        setPaymentNotice({
          type: 'success',
          message: `Bukti pembayaran untuk ${booking.bookingCode} telah ditolak (${selectedRejectReason}). Pelanggan dapat mengunggah bukti baru.`,
        });
        setIsRejectModalOpen(false);
        setSelectedRejectReason('');
        setRejectCustomerNote('');
        setRejectInternalNote('');
        onRefresh();
      } else {
        setRejectError(res.error || 'Gagal menolak pembayaran.');
      }
    } catch (err) {
      console.error('Failed to reject payment:', err);
      setRejectError('Terjadi kesalahan sistem saat menolak pembayaran.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast Notice */}
      {paymentNotice && (
        <div
          className={`p-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold shadow-sm animate-in fade-in duration-200 ${
            paymentNotice.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-rose-600 text-white'
          }`}
        >
          <div className="flex items-center gap-2">
            {paymentNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-white" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-white" />
            )}
            <span>{paymentNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setPaymentNotice(null)}
            className="p-1 hover:bg-white/20 rounded-lg text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Verification Card */}
      <div className="bg-white rounded-2xl border-2 border-teal-600/30 shadow-sm overflow-hidden">
        {/* Card Header */}
        <div className="bg-gradient-to-r from-[#8B5A36] to-[#94603B] text-white p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm tracking-tight text-white uppercase">
                  VERIFIKASI PEMBAYARAN
                </h4>
                {isPendingVerification && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/20 text-teal-200 border border-teal-400/40">
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
                    <span>Perlu Tindakan</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300">
                Pemeriksaan bukti transfer & mutasi bank resmi PT KSBONE UNTUK KITA
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div>
            {isPaymentPaid ? (
              <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500 text-white shadow-xs flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Lunas / Terverifikasi</span>
              </span>
            ) : isPaymentRejected ? (
              <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-rose-500 text-white shadow-xs flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" />
                <span>Pembayaran Ditolak</span>
              </span>
            ) : isPendingVerification ? (
              <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-amber-400 text-slate-900 shadow-xs flex items-center gap-1 animate-pulse">
                <Clock className="w-3.5 h-3.5 text-slate-900" />
                <span>Menunggu Verifikasi</span>
              </span>
            ) : isPaymentExpired ? (
              <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 shadow-xs flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
                <span>Waktu Pembayaran Berakhir</span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700">
                {booking.paymentStatus || 'Belum Bayar'}
              </span>
            )}
          </div>
        </div>

        {/* Card Body */}
        <div className="p-4 space-y-4 text-xs">
          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            {/* Row 1: Kode & Pelanggan */}
            <div>
              <span className="text-slate-400 font-medium block">Kode Reservasi:</span>
              <span className="font-mono font-bold text-slate-900 text-sm">
                {booking.bookingCode}
              </span>
            </div>
            <div>
              <span className="text-slate-400 font-medium block">Pelanggan:</span>
              <span className="font-bold text-slate-900">{booking.customerName}</span>
              <span className="text-slate-500 font-mono ml-1.5">
                ({booking.customerWhatsApp})
              </span>
            </div>

            {/* Row 2: Metode Bayar & Rekening Tujuan */}
            <div>
              <span className="text-slate-400 font-medium block">Metode Pembayaran:</span>
              <div className="font-bold text-slate-800 flex items-center gap-1.5 mt-0.5">
                <CreditCard className="w-3.5 h-3.5 text-teal-600" />
                <span>{paymentRecord?.paymentMethod || booking.paymentMethod || 'Manual Transfer'}</span>
              </div>
            </div>
            <div>
              <span className="text-slate-400 font-medium block">Rekening / Tujuan Resmi:</span>
              <span className="font-medium text-slate-700">
                PT KSBONE UNTUK KITA
                {booking.paymentMethod?.toLowerCase().includes('mandiri')
                  ? ' • Mandiri 1120025626768'
                  : booking.paymentMethod?.toLowerCase().includes('bni')
                  ? ' • BNI 1988899881'
                  : booking.paymentMethod?.toLowerCase().includes('bri')
                  ? ' • BRI 034101000789300'
                  : ' • QRIS Senzu'}
              </span>
            </div>

            {/* Row 3: Nominal Tagihan vs Nominal Bukti */}
            <div className="sm:col-span-2 pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-slate-400 font-medium block">Total Tagihan (Expected):</span>
                <span className="font-mono font-black text-slate-900 text-base">
                  {formatRupiah(expectedAmount)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Nominal Bukti (Uploaded):</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-black text-teal-800 text-base">
                    {formatRupiah(uploadedAmount)}
                  </span>
                  {isAmountMatch ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Nominal Sesuai</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                      <span>Nominal Berbeda!</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Row 4: Waktu Upload & Pengunggah */}
            <div className="sm:col-span-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500 flex-wrap gap-2">
              <div>
                Waktu Unggah Bukti:{' '}
                <strong className="text-slate-700">
                  {paymentRecord?.paymentProofUploadedAt
                    ? formatDateTimeWIB(paymentRecord.paymentProofUploadedAt)
                    : '-'}
                </strong>
              </div>
              <div>
                Diupload Oleh:{' '}
                <strong className="text-slate-700">
                  {paymentRecord?.paymentProofUploadedBy || booking.customerName}
                </strong>
              </div>
            </div>
          </div>

          {/* Payment Proof Preview Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700 uppercase tracking-wide text-[11px] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-teal-600" />
                <span>Bukti Transfer Masuk:</span>
              </span>
              {hasProof && !isPdfProof && (
                <button
                  type="button"
                  onClick={() => setIsProofModalOpen(true)}
                  className="text-[11px] font-bold text-teal-700 hover:text-teal-900 flex items-center gap-1 transition"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Perbesar / Zoom Bukti</span>
                </button>
              )}
            </div>

            {isLoadingPayment ? (
              <div className="p-6 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center text-slate-400">
                <Clock className="w-5 h-5 mx-auto mb-1 animate-spin text-slate-400" />
                <span>Memuat data pembayaran...</span>
              </div>
            ) : hasProof ? (
              isPdfProof ? (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center font-bold text-xs">
                      PDF
                    </div>
                    <div>
                      <div className="font-bold text-slate-800 text-xs truncate max-w-[200px] sm:max-w-sm">
                        {paymentRecord?.paymentProofFileName || 'bukti-transfer.pdf'}
                      </div>
                      <div className="text-[11px] text-slate-400">Dokumen Bukti Pembayaran Resmi</div>
                    </div>
                  </div>
                  <a
                    href={paymentRecord?.paymentProofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs flex items-center gap-1 transition shadow-xs"
                  >
                    <span>Buka PDF</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : imageError ? (
                <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center space-y-2">
                  <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
                  <p className="text-slate-600">Bukti pembayaran belum dapat ditampilkan.</p>
                  <button
                    type="button"
                    onClick={() => setImageError(false)}
                    className="px-3 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold text-xs inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Coba Muat Ulang</span>
                  </button>
                </div>
              ) : (
                <div className="relative group bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center p-2 max-h-64">
                  <img
                    src={paymentRecord?.paymentProofUrl}
                    alt={`Bukti Transfer ${booking.bookingCode}`}
                    onError={() => setImageError(true)}
                    onClick={() => setIsProofModalOpen(true)}
                    className="max-h-60 max-w-full rounded-lg object-contain cursor-pointer transition hover:opacity-95"
                  />
                  <button
                    type="button"
                    onClick={() => setIsProofModalOpen(true)}
                    className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white font-bold text-xs flex items-center gap-1.5 backdrop-blur-xs transition shadow-md"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Perbesar</span>
                  </button>
                </div>
              )
            ) : (
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-center space-y-1">
                <AlertTriangle className="w-5 h-5 text-amber-600 mx-auto" />
                <div className="font-semibold">Belum ada file bukti pembayaran yang diunggah.</div>
                <div className="text-[11px] text-amber-700">
                  Pelanggan belum mengirimkan bukti atau pembayaran dilakukan secara instan.
                </div>
              </div>
            )}
          </div>

          {/* If Already Verified: State Completed Banner (Item 28) */}
          {isPaymentPaid && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1.5 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>✓ Pembayaran Sudah Terverifikasi</span>
              </div>
              <div className="text-xs text-emerald-700">
                Diverifikasi oleh:{' '}
                <strong>{paymentRecord?.verifiedByName || 'CSS Staff'}</strong>
                {paymentRecord?.verifiedAt &&
                  ` pada ${formatDateTimeWIB(paymentRecord.verifiedAt)}`}
              </div>
              <div className="text-[11px] text-emerald-600 leading-relaxed">
                Status pesanan telah <strong>Terkonfirmasi</strong> dan otomatis masuk antrean
                Supervisor di Control Room untuk penugasan terapis.
              </div>
            </div>
          )}

          {/* If Expired Without Proof (Prompt Requirement 10) */}
          {isPaymentExpired && !hasProof && (
            <div className="p-4 rounded-xl bg-slate-100 border border-slate-300 text-slate-800 space-y-1.5 animate-in fade-in duration-200">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-800">
                <AlertCircle className="w-5 h-5 text-slate-600 shrink-0" />
                <span>Waktu Pembayaran Telah Berakhir</span>
              </div>
              <div className="text-xs text-slate-600 leading-relaxed">
                Batas waktu pembayaran 60 menit telah berakhir tanpa bukti pembayaran yang diunggah.
                Pesanan ini tidak memerlukan tindakan verifikasi dari staf CSS.
              </div>
            </div>
          )}

          {/* If Still Pending Verification: Actions Bar */}
          {isPendingVerification && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              {/* Permission check */}
              {!canVerify ? (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs">
                  <strong>Akses Terbatas:</strong> Anda login sebagai pengguna non-operasional.
                  Hanya staf CSS, Manager, atau Admin yang dapat memverifikasi pembayaran.
                </div>
              ) : (
                <>
                  {/* Optional CSS Internal Note Input (Item 21) */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                      Catatan Internal CSS (Opsional — Tercatat di Audit Log):
                    </label>
                    <input
                      type="text"
                      placeholder="Contoh: Sudah dicek mutasi Mandiri rek. 1120025626768 an Ummi..."
                      value={verificationNote}
                      onChange={(e) => setVerificationNote(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-teal-600 focus:outline-none"
                    />
                  </div>

                  {/* Primary Action Buttons (Item 7, 8, 9, 27) */}
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {/* Verifikasi / Terima */}
                    <button
                      type="button"
                      onClick={() => setIsVerifyModalOpen(true)}
                      disabled={isProcessing}
                      className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs shadow-md shadow-emerald-200 flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <Clock className="w-4 h-4 animate-spin" />
                          <span>Memverifikasi...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Verifikasi Pembayaran</span>
                        </>
                      )}
                    </button>

                    {/* Tolak Bukti */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRejectReason('');
                        setRejectCustomerNote('');
                        setRejectInternalNote('');
                        setRejectError('');
                        setIsRejectModalOpen(true);
                      }}
                      disabled={isProcessing}
                      className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs shadow-md shadow-rose-200 flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Tolak Bukti</span>
                    </button>

                    {/* Hubungi WhatsApp Pelanggan */}
                    <button
                      type="button"
                      onClick={handleOpenWhatsApp}
                      className="px-3.5 py-2.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                      title="Hubungi Pelanggan via WhatsApp"
                    >
                      <MessageCircle className="w-4 h-4 text-emerald-600" />
                      <span>Chat Pelanggan</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: KONFIRMASI VERIFIKASI PEMBAYARAN (Item 8) */}
      {isVerifyModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">
                    Konfirmasi Pembayaran
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Konfirmasi pembayaran ini untuk melanjutkan ke Supervisor
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsVerifyModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Details */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Pelanggan:</span>
                <span className="font-bold text-slate-800">{booking.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kode Booking:</span>
                <span className="font-mono font-bold text-slate-900">{booking.bookingCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Metode Bayar:</span>
                <span className="font-medium text-slate-800">
                  {paymentRecord?.paymentMethod || booking.paymentMethod}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 text-sm">
                <span className="text-slate-700 font-bold">Nominal Transfer:</span>
                <span className="font-mono font-black text-emerald-700 text-base">
                  {formatRupiah(uploadedAmount)}
                </span>
              </div>
            </div>

            {/* Advisory / Reminder */}
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-blue-900 text-[11px] flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                Pastikan dana telah masuk di rekening resmi <strong>PT KSBONE UNTUK KITA</strong> / settlement QRIS sebelum verifikasi.
              </div>
            </div>

            {/* Confirmation Buttons */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsVerifyModalOpen(false)}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmVerify}
                disabled={isProcessing}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Memverifikasi...</span>
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

      {/* MODAL 2: TOLAK BUKTI PEMBAYARAN (Item 18) */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">
                    Tolak Bukti Pembayaran
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Kode: <strong className="font-mono">{booking.bookingCode}</strong> • {booking.customerName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {rejectError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold">
                {rejectError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              {/* Radio List of Reasons */}
              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  Pilih Alasan Penolakan (Wajib):
                </label>
                <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  {REJECTION_REASONS.map((reason) => (
                    <label
                      key={reason}
                      className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer transition"
                    >
                      <input
                        type="radio"
                        name="rejectReason"
                        value={reason}
                        checked={selectedRejectReason === reason}
                        onChange={() => {
                          setSelectedRejectReason(reason);
                          setRejectError('');
                        }}
                        className="text-rose-600 focus:ring-rose-500"
                      />
                      <span className="text-slate-800 font-medium">{reason}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Catatan untuk Pelanggan */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Catatan Tambahan untuk Pelanggan{' '}
                  {selectedRejectReason === 'Lainnya' ? (
                    <span className="text-rose-600">*</span>
                  ) : (
                    <span className="text-slate-400 font-normal">(Opsional)</span>
                  )}
                  :
                </label>
                <textarea
                  rows={2}
                  placeholder="Pesan ini akan terlihat oleh pelanggan saat diminta unggah ulang..."
                  value={rejectCustomerNote}
                  onChange={(e) => setRejectCustomerNote(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>

              {/* Catatan Internal CSS */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Catatan Internal CSS <span className="text-slate-400 font-normal">(Opsional)</span>:
                </label>
                <input
                  type="text"
                  placeholder="Catatan tim CSS (tidak terlihat pelanggan)..."
                  value={rejectInternalNote}
                  onChange={(e) => setRejectInternalNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-rose-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsRejectModalOpen(false)}
                disabled={isProcessing}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={isProcessing}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md flex items-center gap-1.5 transition disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Memproses...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Tolak & Minta Upload Ulang</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: FULL PROOF PREVIEW (Item 6) */}
      {isProofModalOpen && paymentRecord?.paymentProofUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="relative bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-700">
            <div className="p-4 bg-slate-800 text-white flex items-center justify-between border-b border-slate-700">
              <div>
                <h4 className="font-bold text-sm">
                  Bukti Pembayaran #{booking.bookingCode}
                </h4>
                <p className="text-[11px] text-slate-400">
                  {booking.customerName} • {formatRupiah(uploadedAmount)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={paymentRecord.paymentProofUrl}
                  download={paymentRecord.paymentProofFileName || `bukti-${booking.bookingCode}.jpg`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-xs flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Buka Tab Baru</span>
                </a>
                <button
                  type="button"
                  onClick={() => setIsProofModalOpen(false)}
                  className="p-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/40">
              <img
                src={paymentRecord.paymentProofUrl}
                alt="Bukti Transfer Full"
                className="max-h-[70vh] max-w-full rounded-xl object-contain shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
