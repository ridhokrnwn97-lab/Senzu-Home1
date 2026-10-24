import React, { useState, useEffect, useRef } from 'react';
import {
  CreditCard,
  QrCode,
  Copy,
  Check,
  Upload,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Eye,
  X,
  Phone,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Maximize2
} from 'lucide-react';
import { Booking, PaymentRecord, PaymentSettings } from '../../types';
import {
  getPaymentSettings,
  createOrGetPaymentForBooking,
  uploadPaymentProof,
  expirePaymentIfEligible,
  subscribeToPaymentByBookingId,
  isPaymentPaid,
  OFFICIAL_SENZU_BANK_ACCOUNTS,
  OFFICIAL_SENZU_QRIS,
} from '../../lib/paymentService';
import { formatRupiah, formatDateIndo } from '../../lib/utils';
import { useCustomerServiceWhatsApp } from '../../lib/supportWhatsApp';

import { XenditLivePaymentPage } from './XenditLivePaymentPage';

export interface PendingPaymentCardProps {
  booking: Booking;
  variant?: 'card' | 'compact' | 'modal';
  onPaymentSuccess?: () => void;
  onOpenTracking?: (code: string) => void;
  onClose?: () => void;
}

export const PendingPaymentCard: React.FC<PendingPaymentCardProps> = props => {
  if (props.booking.paymentMethod !== 'Xendit') return <ManualPendingPaymentCard {...props} />;
  const card = <XenditLivePaymentPage booking={props.booking} onOpenTracking={props.onOpenTracking} />;
  return props.variant === 'modal' ? <div role="dialog" aria-modal="true" aria-label="Pembayaran pesanan" className="fixed inset-0 z-[90] overflow-y-auto bg-slate-900/70 p-4">
    <div className="mx-auto my-8 max-w-2xl rounded-3xl bg-white p-4"><div className="flex justify-end"><button type="button" onClick={props.onClose} className="min-h-[44px] px-4 font-semibold">Tutup</button></div>{card}</div>
  </div> : card;
};

const ManualPendingPaymentCard: React.FC<PendingPaymentCardProps> = ({
  booking,
  variant = 'card',
  onPaymentSuccess,
  onOpenTracking,
  onClose,
}) => {
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [activePayment, setActivePayment] = useState<PaymentRecord | null>(null);
  const [isLoadingPayment, setIsLoadingPayment] = useState(true);

  // Method selection (qris, bni, mandiri, bri)
  const initialMethod = (() => {
    const raw = (booking.paymentMethod || '').toLowerCase();
    if (raw.includes('mandiri')) return 'mandiri';
    if (raw.includes('bri')) return 'bri';
    if (raw.includes('bni')) return 'bni';
    return 'qris';
  })();
  const [selectedMethod, setSelectedMethod] = useState<'qris' | 'bni' | 'mandiri' | 'bri'>(initialMethod);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Copy feedback state
  const [copiedType, setCopiedType] = useState<'account' | 'amount' | null>(null);
  const [isFullscreenQr, setIsFullscreenQr] = useState(false);
  const [isPreviewProof, setIsPreviewProof] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Safely lock body scroll while modal is active
  useEffect(() => {
    if (variant === 'modal') {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [variant]);

  // Scroll the internal payment scroll container to top whenever modal opens or booking changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [booking.id, booking.bookingCode, variant]);

  // Support closing modal with Escape key
  useEffect(() => {
    if (variant !== 'modal' || !onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [variant, onClose]);

  // Returning from banking app / browser focus: prevent negative or distorted scroll offsets
  useEffect(() => {
    const handleWindowFocus = () => {
      if (scrollContainerRef.current && scrollContainerRef.current.scrollTop < 0) {
        scrollContainerRef.current.scrollTop = 0;
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, []);

  // CS WhatsApp helper
  const { getWhatsAppUrl } = useCustomerServiceWhatsApp();
  const csMessage = `Halo Senzu Home, saya ingin menanyakan pembayaran untuk pesanan #${booking.bookingCode} sebesar ${formatRupiah(booking.totalAmount)}.`;
  const csWhatsAppUrl = getWhatsAppUrl(csMessage);

  // 1. Load payment settings and initialize/subscribe to payment record
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isMounted = true;

    const init = async () => {
      try {
        setIsLoadingPayment(true);
        const settings = await getPaymentSettings();
        if (isMounted) setPaymentSettings(settings);

        // Fetch or create authoritative payment record matching selected method
        const payment = await createOrGetPaymentForBooking(booking, {
          methodType: selectedMethod,
        });

        if (isMounted) {
          setActivePayment(payment);
          setIsLoadingPayment(false);
        }

        // Subscribe to realtime updates on this payment
        unsubscribe = subscribeToPaymentByBookingId(booking.id, (updated) => {
          if (isMounted && updated) {
            setActivePayment(updated);
            if (isPaymentPaid(updated.status) && onPaymentSuccess) {
              onPaymentSuccess();
            }
          }
        });
      } catch (err) {
        console.warn('Payment init notice:', err);
        if (isMounted) setIsLoadingPayment(false);
      }
    };

    init();

    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [booking.id, booking.bookingCode, selectedMethod]);

  // 2. Handle switching payment method
  const handleSelectMethod = async (method: 'qris' | 'bni' | 'mandiri' | 'bri') => {
    setSelectedMethod(method);
    // If customer was scrolled deep down, smoothly ensure bank details remain in view
    if (scrollContainerRef.current && scrollContainerRef.current.scrollTop > 120) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    try {
      const updated = await createOrGetPaymentForBooking(booking, {
        methodType: method,
      });
      setActivePayment(updated);
    } catch (e) {
      console.warn('Could not switch payment method:', e);
    }
  };

  // 3. Handle Copy
  const handleCopy = (text: string, type: 'account' | 'amount') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => {
      setCopiedType((prev) => (prev === type ? null : prev));
    }, 2500);
  };

  // 4. File selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError('');
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
      if (!validTypes.includes((file.type || '').toLowerCase())) {
        setUploadError('Format tidak didukung. Harap pilih gambar (JPG, PNG) atau file PDF.');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setUploadError('Ukuran file maksimal 15 MB.');
        return;
      }
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFilePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setFilePreview(null);
      }
    }
  };

  // 5. Upload proof submit
  const handleUploadSubmit = async () => {
    if (isUploading) return; // Prevent double click / duplicate uploads
    if (!selectedFile) {
      setUploadError('Pilih file bukti pembayaran terlebih dahulu.');
      return;
    }
    if (!activePayment) {
      setUploadError('Data pembayaran belum siap. Silakan muat ulang.');
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      const res = await uploadPaymentProof(
        activePayment.id,
        booking.id,
        selectedFile,
        booking.customerName || 'Pelanggan'
      );

      if (res.success) {
        setUploadSuccess(true);
        // Immediately update activePayment state to pending_manual_verification ("Menunggu Verifikasi Pembayaran")
        setActivePayment((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: 'pending_manual_verification',
            paymentProofUrl: filePreview || prev.paymentProofUrl,
            paymentProofFileName: selectedFile.name,
            paymentProofUploadedAt: new Date().toISOString(),
          };
        });
        setSelectedFile(null);
        setFilePreview(null);
        if (onPaymentSuccess) onPaymentSuccess();
      } else {
        setUploadError(res.error || 'Bukti pembayaran gagal dikirim. Silakan coba kembali.');
      }
    } catch {
      setUploadError('Bukti pembayaran gagal dikirim. Silakan coba kembali.');
    } finally {
      setIsUploading(false);
    }
  };

  // Helper to determine destination bank or QRIS details
  const activeBank = (() => {
    if (selectedMethod === 'qris') return null;
    const safeBanks = paymentSettings?.bankAccounts || OFFICIAL_SENZU_BANK_ACCOUNTS;
    const match = (safeBanks || []).find((b) => (b?.bankCode || '').toLowerCase() === (selectedMethod || '').toLowerCase());
    return match || safeBanks[0];
  })();

  const qrisData = paymentSettings?.qris || OFFICIAL_SENZU_QRIS;

  // Determine current payment verification state
  const isPaid = isPaymentPaid(activePayment?.status) || (booking.status || '').toLowerCase().includes('pembayaran_terverifikasi');
  const isProofUploaded =
    activePayment?.status === 'pending_manual_verification' ||
    Boolean(activePayment?.paymentProofUrl) ||
    Boolean(booking.paymentProofUrl);

  // Authoritative persisted deadline: preserve existing behavior for legacy records without paymentDeadline
  const deadlineIso = activePayment?.paymentDeadline || booking.paymentDeadline || null;

  const [timeLeftMs, setTimeLeftMs] = useState<number>(() => {
    if (!deadlineIso) return -1;
    return Math.max(0, new Date(deadlineIso).getTime() - Date.now());
  });

  const isExpired =
    activePayment?.status === 'expired' ||
    (booking.paymentStatus as string) === 'expired'; // Countdown alone cannot expire a payment.

  useEffect(() => {
    if (!deadlineIso || isProofUploaded || isPaid) return;

    let checkingExpiry = false;
    let cancelled = false;
    const tick = () => {
      const remaining = Math.max(0, new Date(deadlineIso).getTime() - Date.now());
      setTimeLeftMs(remaining);

      if (remaining <= 0 && !checkingExpiry && !isProofUploaded && activePayment?.id && activePayment.status !== 'expired') {
        checkingExpiry = true;
        expirePaymentIfEligible(activePayment.id, booking.id).then((res) => {
          if (!cancelled && res.expired) {
            setActivePayment((prev) => (prev ? { ...prev, status: 'expired' } : prev));
          }
        }).finally(() => { checkingExpiry = false; });
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [deadlineIso, isProofUploaded, isPaid, activePayment?.id, activePayment?.status, booking.id]);

  const formatCountdown = (ms: number): string => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const isWarningState = timeLeftMs > 0 && timeLeftMs < 10 * 60 * 1000;

  const isModal = variant === 'modal';

  const containerClasses =
    variant === 'compact'
      ? 'bg-amber-50/70 border border-amber-300/80 rounded-2xl p-3.5 space-y-3'
      : 'bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4';

  const headerElement = (
    <div className={`flex items-center justify-between border-b border-slate-100 ${
      isModal ? 'px-4 sm:px-5 pt-3.5 pb-3 flex-shrink-0 bg-white z-10' : 'pb-3'
    }`}>
      <div>
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
          Pembayaran Non-Tunai Resmi
        </span>
        <div className="flex items-center gap-2">
          <h3 className="font-serif font-bold text-sm sm:text-base text-senzu-brand">
            Reservasi #{booking.bookingCode}
          </h3>
          {isPaid ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              <span>Pembayaran Terverifikasi</span>
            </span>
          ) : isProofUploaded ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-600 animate-spin" />
              <span>Pembayaran Sedang Diverifikasi</span>
            </span>
          ) : isExpired ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-slate-500" />
              <span>Waktu Pembayaran Berakhir</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-700" />
              <span>Menunggu Pembayaran</span>
            </span>
          )}
        </div>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition cursor-pointer"
          aria-label="Tutup"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const paymentBody = (
    <div
      ref={scrollContainerRef}
      className={
        isModal
          ? 'flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 overscroll-contain'
          : 'space-y-4'
      }
    >

      {/* Total Amount Card */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-senzu-brand to-senzu-brand-hover text-white flex items-center justify-between gap-3 shadow-sm">
        <div>
          <span className="text-[10px] text-slate-300 block uppercase font-medium">Total Pembayaran</span>
          <div className="font-mono font-bold text-lg sm:text-xl text-senzu-cream">
            {formatRupiah(booking.totalAmount)}
          </div>
          <span className="text-[11px] text-slate-300 block">
            {booking.serviceName} ({booking.serviceDuration} mnt)
          </span>
        </div>

        <button
          type="button"
          onClick={() => handleCopy(booking.totalAmount.toString(), 'amount')}
          className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer text-senzu-cream"
        >
          {copiedType === 'amount' ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Disalin</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Salin Nominal</span>
            </>
          )}
        </button>
      </div>

      {/* 60-Minute Payment Deadline Countdown (Prompt Requirements 1 & 2) */}
      {!isProofUploaded && !isPaid && !isExpired && (
        <div
          className={`p-3 sm:p-3.5 rounded-2xl border-2 transition-all ${
            isWarningState
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-950'
              : 'bg-senzu-canvas border-senzu-gold/40 text-senzu-brand'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-1.5">
                <Clock
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isWarningState ? 'text-amber-600 animate-pulse' : 'text-senzu-caramel'
                  }`}
                />
                <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600 truncate">
                  Batas Waktu Pembayaran
                </span>
                {isWarningState && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                    Kurang dari 10 Menit
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 truncate">
                Selesaikan pembayaran dan unggah bukti sebelum waktu berakhir.
              </p>
            </div>
            <div className="text-right shrink-0">
              <div
                className={`font-mono font-extrabold text-base sm:text-lg tracking-wider ${
                  isWarningState ? 'text-amber-600' : 'text-senzu-brand'
                }`}
              >
                {formatCountdown(timeLeftMs)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expired State Banner (Prompt Requirement 4) */}
      {isExpired && !isProofUploaded && !isPaid && (
        <div className="p-3.5 rounded-2xl bg-slate-100 border border-slate-300 text-slate-800 space-y-1">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-slate-600 shrink-0" />
            <h4 className="font-bold text-xs text-slate-900">Waktu pembayaran telah berakhir.</h4>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Silakan lakukan pemesanan kembali atau hubungi Customer Service Senzu jika memerlukan bantuan.
          </p>
        </div>
      )}

      {/* If already paid, display verified status */}
      {isPaid ? (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <h4 className="font-bold text-sm text-emerald-900">Pembayaran Terverifikasi</h4>
          <p className="text-xs text-emerald-700">
            Terima kasih! Pembayaran Anda telah diterima dan pesanan Anda telah dikonfirmasi. Terapis profesional Senzu akan melayani Anda sesuai jadwal.
          </p>
          {onOpenTracking && (
            <button
              type="button"
              onClick={() => onOpenTracking(booking.bookingCode)}
              className="mt-2 px-4 py-2 rounded-xl bg-senzu-brand text-white text-xs font-bold hover:bg-senzu-brand-hover transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Lacak Status Pesanan</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Payment Method Selector Tabs */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-senzu-brand block">Pilih Metode Pembayaran:</span>
            <div className="grid grid-cols-4 gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => handleSelectMethod('qris')}
                className={`py-2 px-1 rounded-xl border transition flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'qris'
                    ? 'border-senzu-brand bg-senzu-brand text-senzu-cream shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <QrCode className="w-4 h-4" />
                <span className="text-[11px]">QRIS</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectMethod('mandiri')}
                className={`py-2 px-1 rounded-xl border transition flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'mandiri'
                    ? 'border-senzu-brand bg-senzu-brand text-senzu-cream shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span className="text-[11px]">Mandiri</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectMethod('bni')}
                className={`py-2 px-1 rounded-xl border transition flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'bni'
                    ? 'border-senzu-brand bg-senzu-brand text-senzu-cream shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span className="text-[11px]">BNI</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectMethod('bri')}
                className={`py-2 px-1 rounded-xl border transition flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'bri'
                    ? 'border-senzu-brand bg-senzu-brand text-senzu-cream shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span className="text-[11px]">BRI</span>
              </button>
            </div>
          </div>

          {/* Payment Destination Details */}
          {selectedMethod === 'qris' ? (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-center">
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold block">Merchant QRIS Resmi</span>
                <h4 className="font-bold text-xs sm:text-sm text-senzu-brand">{qrisData.merchantName}</h4>
                <p className="text-[11px] font-mono text-slate-500">NMID: {qrisData.nmid}</p>
              </div>

              {/* QR Image */}
              <div className="relative inline-block mx-auto bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
                <img
                  src={qrisData.imageUrl}
                  alt="QRIS Senzu Home"
                  className="w-48 h-48 object-contain mx-auto rounded-lg"
                  referrerPolicy="no-referrer"
                />
                <button
                  type="button"
                  onClick={() => setIsFullscreenQr(true)}
                  className="absolute bottom-4 right-4 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white transition cursor-pointer"
                  title="Perbesar QRIS"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                Bisa di-scan menggunakan seluruh aplikasi mobile banking (BCA, Mandiri Livin', BRImo, BNI) dan dompet digital (GoPay, OVO, Dana, ShopeePay).
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Tujuan Transfer Bank</span>
                  <h4 className="font-bold text-sm text-senzu-brand">{activeBank?.bankName}</h4>
                </div>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800">
                  PT KSBONE UNTUK KITA
                </span>
              </div>

              {/* Account Number Box */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold">Nomor Rekening</span>
                  <span className="font-mono font-bold text-base sm:text-lg text-senzu-brand tracking-wider">
                    {activeBank?.accountNumber}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    a.n. <strong>{activeBank?.accountHolder}</strong>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy(activeBank?.accountNumber || '', 'account')}
                  className="px-3.5 py-2 rounded-xl bg-senzu-brand hover:bg-senzu-brand-hover text-white text-xs font-bold transition flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-xs"
                >
                  {copiedType === 'account' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Disalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-senzu-gold" />
                      <span>Salin Rekening</span>
                    </>
                  )}
                </button>
              </div>

              {/* Instructions */}
              <div className="text-[11px] text-slate-600 space-y-1 bg-amber-50/50 p-2.5 rounded-xl border border-amber-200/50">
                <p className="font-semibold text-amber-900">Petunjuk Pembayaran:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-slate-700">
                  <li>Buka aplikasi m-banking atau ATM bank Anda</li>
                  <li>Transfer tepat sejumlah <strong>{formatRupiah(booking.totalAmount)}</strong> ke rekening di atas</li>
                  <li>Simpan struk / screenshot bukti transfer dan unggah di bawah</li>
                </ol>
              </div>
            </div>
          )}

          {/* Upload Bukti Pembayaran Section */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-xs text-senzu-brand">Unggah Bukti Transfer</h4>
                <p className="text-[11px] text-slate-500">Format JPG, PNG, atau PDF (maks. 15MB)</p>
              </div>
              {isProofUploaded && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-blue-600" />
                  <span>Bukti Terunggah</span>
                </span>
              )}
            </div>

            {/* Proof Status Banner if already uploaded */}
            {isProofUploaded && (
              <div className="p-3 rounded-xl bg-blue-50/80 border border-blue-200 text-xs text-blue-900 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-700 animate-spin" />
                    <span>Bukti pembayaran sedang diverifikasi tim CSS</span>
                  </span>
                  {activePayment?.paymentProofUploadedAt && (
                    <span className="text-[10px] text-blue-600">
                      {formatDateIndo(activePayment.paymentProofUploadedAt)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-blue-700">
                  Tim kami biasanya memverifikasi dalam kurun 5-15 menit. Anda dapat memperbarui bukti jika salah mengirim file.
                </p>
                {activePayment?.paymentProofUrl && (
                  <button
                    type="button"
                    onClick={() => setIsPreviewProof(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-senzu-brand hover:underline pt-0.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Lihat Bukti Yang Telah Diunggah</span>
                  </button>
                )}
              </div>
            )}

            {/* Upload form */}
            {isExpired && !isProofUploaded ? (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-center space-y-1.5">
                <Clock className="w-6 h-6 text-slate-400 mx-auto" />
                <h4 className="font-bold text-xs text-slate-800">Waktu Pembayaran Telah Berakhir</h4>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Silakan lakukan pemesanan kembali atau hubungi Customer Service Senzu jika memerlukan bantuan.
                </p>
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-600 mt-1">
                  Upload Bukti Dinonaktifkan
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* Drop / Select Area */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-senzu-brand rounded-2xl p-3 text-center cursor-pointer transition bg-slate-50 hover:bg-slate-100/80 flex flex-col items-center justify-center gap-1.5"
                >
                  <Upload className="w-5 h-5 text-slate-400" />
                  <span className="text-xs font-semibold text-senzu-brand">
                    {selectedFile ? selectedFile.name : 'Pilih File Bukti Transfer'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Klik untuk mencari di galeri / dokumen perangkat Anda
                  </span>
                </div>

                {/* Selected preview */}
                {filePreview && (
                  <div className="relative inline-block w-full text-center">
                    <img
                      src={filePreview}
                      alt="Preview Bukti"
                      className="max-h-36 mx-auto rounded-xl border border-slate-200 object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setFilePreview(null);
                      }}
                      className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 text-xs cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {uploadError && (
                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {uploadSuccess && (
                  <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Bukti pembayaran berhasil dikirim dan sedang menunggu verifikasi.</span>
                  </div>
                )}

                {/* Submit Button */}
                {selectedFile && (
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={handleUploadSubmit}
                    className="w-full py-2.5 rounded-xl bg-senzu-brand hover:bg-senzu-brand-hover text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm"
                  >
                    {isUploading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-senzu-gold" />
                        <span>Mengirim bukti...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-senzu-gold" />
                        <span>Kirim Bukti Pembayaran</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  const footerElement = (
    <div className={`space-y-2.5 w-full ${
      isModal ? 'px-4 sm:px-5 py-3 border-t border-slate-100 flex-shrink-0 bg-slate-50/95 backdrop-blur-xs z-10' : 'pt-2 border-t border-slate-100'
    }`}>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs w-full">
        <a
          href={csWhatsAppUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800 font-semibold py-1 cursor-pointer"
        >
          <Phone className="w-3.5 h-3.5" />
          <span>Butuh Bantuan? Hubungi CS Senzu</span>
        </a>

        {onOpenTracking && (
          <button
            type="button"
            onClick={() => onOpenTracking(booking.bookingCode)}
            className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition cursor-pointer"
          >
            Lacak Status Pesanan →
          </button>
        )}
      </div>

      {/* Requirements 6 & 7: Post-Proof Upload Success Message */}
      {(isProofUploaded || uploadSuccess) && !isPaid && (
        <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl text-left space-y-1 shadow-2xs animate-in fade-in slide-in-from-top-1">
          <p className="text-[11px] font-bold text-emerald-950 leading-snug whitespace-pre-line">
            ✅ Bukti pembayaran berhasil dikirim.
            {'\n'}Mohon ditunggu. Tim kami sedang memeriksa bukti pembayaran Anda.
          </p>
          <p className="text-[10px] text-emerald-800 leading-normal">
            Status pesanan akan diperbarui setelah pembayaran selesai diverifikasi.
          </p>
        </div>
      )}
    </div>
  );

  const subModals = (
    <>
      {/* Fullscreen QR Modal */}
      {isFullscreenQr && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsFullscreenQr(false);
          }}
        >
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full text-center space-y-3 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-2">
              <span className="font-bold text-xs text-senzu-brand">QRIS Senzu Home</span>
              <button
                type="button"
                onClick={() => setIsFullscreenQr(false)}
                className="p-1 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={qrisData.imageUrl}
              alt="QRIS Senzu Home"
              className="w-full h-auto rounded-xl object-contain mx-auto"
              referrerPolicy="no-referrer"
            />
            <div className="font-mono font-bold text-base text-senzu-brand">
              {formatRupiah(booking.totalAmount)}
            </div>
            <p className="text-[11px] text-slate-500">
              NMID: {qrisData.nmid} • {qrisData.merchantName}
            </p>
          </div>
        </div>
      )}

      {/* Preview Uploaded Proof Modal */}
      {isPreviewProof && activePayment?.paymentProofUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsPreviewProof(false);
          }}
        >
          <div className="bg-white rounded-3xl p-5 max-w-md w-full text-center space-y-3 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-2">
              <span className="font-bold text-xs text-senzu-brand">Bukti Pembayaran Tersimpan</span>
              <button
                type="button"
                onClick={() => setIsPreviewProof(false)}
                className="p-1 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {activePayment.paymentProofMimeType === 'application/pdf' ? (
              <div className="p-8 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
                <FileText className="w-12 h-12 text-senzu-brand mx-auto" />
                <p className="text-xs font-semibold text-slate-700">{activePayment.paymentProofFileName || 'Dokumen Bukti Transfer (PDF)'}</p>
              </div>
            ) : (
              <img
                src={activePayment.paymentProofUrl}
                alt="Bukti Transfer"
                className="max-h-[60vh] w-auto mx-auto rounded-xl object-contain border border-slate-200"
              />
            )}
            <p className="text-[11px] text-slate-500">
              Diunggah pada: {formatDateIndo(activePayment.paymentProofUploadedAt || '')}
            </p>
          </div>
        </div>
      )}
    </>
  );

  if (isModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/65 backdrop-blur-sm p-0 sm:p-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))] overflow-hidden"
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        <div
          className="bg-white w-full sm:max-w-lg h-[calc(100dvh-max(24px,env(safe-area-inset-top)+env(safe-area-inset-bottom)))] sm:h-auto max-h-[calc(100dvh-max(24px,env(safe-area-inset-top)+env(safe-area-inset-bottom)))] sm:max-h-[min(90dvh,860px)] rounded-t-3xl sm:rounded-3xl shadow-2xl border-t sm:border border-slate-200 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2 sm:zoom-in-95 duration-200"
        >
          {headerElement}
          {paymentBody}
          {footerElement}
        </div>
        {subModals}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {headerElement}
      {paymentBody}
      {footerElement}
      {subModals}
    </div>
  );
};
