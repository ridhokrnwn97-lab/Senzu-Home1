import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  QrCode,
  CreditCard,
  Copy,
  CheckCircle2,
  Clock,
  MapPin,
  Calendar,
  User,
  ShieldCheck,
  AlertCircle,
  FileText,
  Upload,
  Eye,
  X,
  Check,
  ArrowLeft,
  Phone,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import {
  Booking,
  PaymentRecord,
  PaymentSettings,
} from '../types';
import { formatDistanceDisplay } from '../lib/distanceFeeService';
import {
  getPaymentSettings,
  createOrGetPaymentForBooking,
  uploadPaymentProof,
  expirePaymentIfEligible,
  subscribeToPaymentByBookingId,
  getPaymentStatusLabel,
  getPaymentStatusBadgeStyle,
  isPaymentPaid,
} from '../lib/paymentService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';
import { CustomerRegisterModal } from './CustomerRegisterModal';
import { CustomerLoginModal } from './CustomerLoginModal';
import { trackMetaAdsAction } from '../lib/metaPixel';

import { XenditLivePaymentPage } from './customer/XenditLivePaymentPage';

interface CustomerPaymentPageProps {
  booking: Booking;
  onBackToBooking?: () => void;
  onOpenTracking?: (code: string) => void;
}

export const CustomerPaymentPage: React.FC<CustomerPaymentPageProps> = props => props.booking.paymentMethod === 'Xendit'
  ? <XenditLivePaymentPage {...props} /> : <ManualCustomerPaymentPage {...props} />;

const ManualCustomerPaymentPage: React.FC<CustomerPaymentPageProps> = ({
  booking,
  onBackToBooking,
  onOpenTracking,
}) => {
  const { currentUser } = useAuth();
  const { currentCustomer, isCustomerAuthenticated } = useCustomerAuth();
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const getInitialMethod = (): 'qris' | 'bni' | 'mandiri' | 'bri' => {
    const raw = (booking.paymentMethod || '').toLowerCase();
    if (raw.includes('mandiri')) return 'mandiri';
    if (raw.includes('bri')) return 'bri';
    if (raw.includes('bni')) return 'bni';
    return 'qris';
  };
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null);
  const [activePayment, setActivePayment] = useState<PaymentRecord | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'qris' | 'bni' | 'mandiri' | 'bri'>(getInitialMethod);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Fullscreen modals
  const [isFullscreenQrOpen, setIsFullscreenQrOpen] = useState(false);
  const [isPreviewProofOpen, setIsPreviewProofOpen] = useState(false);

  // Copy toast states
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Centralized Official Senzu Customer Service WhatsApp
  const {
    isAvailable: isCsAvailable,
    getWhatsAppUrl: getCsWhatsAppUrl,
    unavailableNotice: csUnavailableNotice,
  } = useCustomerServiceWhatsApp();

  // Authoritative amount calculation
  const authoritativeTotal = booking.totalAmount || ((booking.servicePrice || 0) + (booking.homeServiceFee || 0) - (booking.discountAmount || 0));

  // Load payment settings and initialize payment record
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    let cancelled = false;
    const init = async () => {
      const settings = await getPaymentSettings();
      setPaymentSettings(settings);

      // Create or fetch existing payment record with preferred method
      const preferred = getInitialMethod();
      const payment = await createOrGetPaymentForBooking(booking, {
        methodType: preferred,
      });
      if (cancelled) return;
      setActivePayment(payment);
      setSelectedMethod(preferred);

      // Realtime subscription for customer page
      unsubscribe = subscribeToPaymentByBookingId(booking.id, (updatedPayment) => {
        if (!cancelled) setActivePayment(updatedPayment);
      });
    };

    init().catch(error => {
      if (!cancelled) setUploadError(error?.message || 'Data pembayaran gagal dimuat.');
    });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [booking.id]);

  // Handle switching payment method
  const handleSelectMethod = async (method: 'qris' | 'bni' | 'mandiri' | 'bri') => {
    if (activePayment && activePayment.status !== 'paid') {
      try {
        const updated = await createOrGetPaymentForBooking(booking, { methodType: method });
        setActivePayment(updated);
        setSelectedMethod(method);
      } catch (error: any) {
        setToastMessage(error?.message || 'Metode pembayaran gagal diperbarui.');
      }
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} berhasil disalin.`);
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError('');
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      // Type check
      const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowed.includes((file.type || '').toLowerCase())) {
        setUploadError('Format file harus berupa JPG, PNG, WebP, atau PDF.');
        return;
      }

      // PDF specific size check (PDF cannot be compressed via canvas)
      if (file.type === 'application/pdf' && file.size > 500 * 1024) {
        setUploadError('Ukuran file PDF maksimal 500 KB. Disarankan menggunakan foto/screenshot (JPG/PNG) agar otomatis dioptimasi.');
        return;
      }

      // Raw image size check (max 15MB)
      if (file.size > 15 * 1024 * 1024) {
        setUploadError('Ukuran file foto bukti pembayaran maksimal 15 MB.');
        return;
      }

      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setFilePreview(previewUrl);
      } else {
        setFilePreview(null);
      }
    }
  };

  // Submit proof
  const handleUploadProof = async () => {
    if (isUploading) return; // Prevent double click / duplicate uploads
    if (!selectedFile || !activePayment) return;
    if (isPaymentPaid(activePayment.status)) {
      setUploadError('Booking ini sudah dibayar dan diverifikasi.');
      return;
    }

    setIsUploading(true);
    setUploadError('');

    try {
      const result = await uploadPaymentProof(
        activePayment.id,
        booking.id,
        selectedFile,
        booking.customerName
      );

      if (result.success) {
        setUploadSuccess(true);
        // Update customer booking/payment UI immediately to: Menunggu Verifikasi Pembayaran
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
        showToast('Bukti pembayaran berhasil dikirim dan sedang menunggu verifikasi.');
      } else {
        setUploadError(result.error || 'Bukti pembayaran gagal dikirim. Silakan coba kembali.');
      }
    } catch {
      setUploadError('Bukti pembayaran gagal dikirim. Silakan coba kembali.');
    } finally {
      setIsUploading(false);
    }
  };

  const currentStatus = activePayment?.status || (booking.paymentStatus as string) || 'unpaid';
  const isPaid = isPaymentPaid(currentStatus);
  const isWaitingVerification = currentStatus === 'pending_manual_verification';
  const isRejected = currentStatus === 'payment_rejected';

  // Rule 5: VERY IMPORTANT — DO NOT EXPIRE AFTER PROOF UPLOAD
  const isProofUploaded =
    isWaitingVerification ||
    Boolean(activePayment?.paymentProofUrl) ||
    Boolean(booking.paymentProofUrl);

  // Authoritative persisted deadline: preserve existing behavior for legacy records without paymentDeadline
  const deadlineIso = activePayment?.paymentDeadline || booking.paymentDeadline || null;

  const [timeLeftMs, setTimeLeftMs] = useState<number>(() => {
    if (!deadlineIso) return -1;
    return Math.max(0, new Date(deadlineIso).getTime() - Date.now());
  });

  const isExpired =
    currentStatus === 'expired' ||
    (booking.paymentStatus as string) === 'expired'; // Countdown alone cannot expire a payment.

  const statusStyle = getPaymentStatusBadgeStyle(isExpired && !isPaid && !isProofUploaded ? 'expired' : currentStatus);

  // 60-Minute Countdown Interval: continues accurately across refreshes, tab switches, and route reopens
  useEffect(() => {
    if (!deadlineIso || isProofUploaded || isPaid) return;

    let checkingExpiry = false;
    let cancelled = false;
    const tick = () => {
      const remaining = Math.max(0, new Date(deadlineIso).getTime() - Date.now());
      setTimeLeftMs(remaining);

      // Trigger authoritative expiry when timer expires without proof
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

  // Bank accounts config
  const defaultBankAccounts = [
    { bankCode: 'BNI', bankName: 'BNI', accountNumber: '7009999772', accountHolder: 'PT KSBONE UNTUK KITA', enabled: true },
    { bankCode: 'MANDIRI', bankName: 'Bank Mandiri', accountNumber: '1120025626768', accountHolder: 'PT KSBONE UNTUK KITA', enabled: true },
    { bankCode: 'BRI', bankName: 'BRI', accountNumber: '005901003894560', accountHolder: 'PT KSBONE UNTUK KITA', enabled: true },
  ];

  const bankAccounts = (Array.isArray(paymentSettings?.bankAccounts) && paymentSettings.bankAccounts.length > 0)
    ? paymentSettings.bankAccounts.filter(Boolean)
    : defaultBankAccounts;

  const currentBankAccount = bankAccounts.find(
    (b) => b?.bankCode && b.bankCode.toLowerCase() === (selectedMethod || '').toLowerCase()
  ) || bankAccounts[0] || defaultBankAccounts[0];

  const qrisConfig = paymentSettings?.qris || {
    merchantName: 'SENZU REFLEXOLOGY AND FAMILY MASSAGE QR',
    nmid: 'ID1025449341847',
    accountHolder: 'PT KSBONE UNTUK KITA',
    acquirer: 'BNI Merchant',
    imageUrl: '/assets/payment/qris-senzu.jpg',
  };

  // QRIS candidate URLs in order of preference
  const qrisCandidates = [
    '/assets/payment/qris-senzu.jpg',
    qrisConfig.imageUrl,
    '/assets/payment/qris-senzu.jpeg',
    '/assets/payment/qris-senzu.png',
  ].filter(Boolean) as string[];

  const [qrisCandidateIndex, setQrisCandidateIndex] = useState(0);
  const [isQrisNotFound, setIsQrisNotFound] = useState(false);

  const currentQrisSrc = qrisCandidates[qrisCandidateIndex] || '';

  const handleQrisImgError = () => {
    if (qrisCandidateIndex < qrisCandidates.length - 1) {
      setQrisCandidateIndex((prev) => prev + 1);
    } else {
      setIsQrisNotFound(true);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 px-2 sm:px-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#8B5A36] text-white px-5 py-3 rounded-2xl shadow-2xl border border-[#D4AF37]/50 flex items-center gap-2.5 text-xs sm:text-sm font-semibold animate-in fade-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5 text-[#D4AF37]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation & Status */}
      <div className="flex items-center justify-between">
        {onBackToBooking && (
          <button
            type="button"
            onClick={onBackToBooking}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#4B2B18] transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Beranda</span>
          </button>
        )}
        {onOpenTracking && (
          <button
            type="button"
            onClick={() => onOpenTracking(booking.bookingCode)}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-[#4B2B18] hover:underline"
          >
            <span>Lacak Reservasi</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Header Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-[#8B5A36] via-[#94603B] to-[#8B5A36] text-white p-6 sm:p-8 shadow-xl border border-[#D4AF37]/30 relative overflow-hidden">
        <div className="absolute -right-16 -bottom-16 w-60 h-60 rounded-full bg-[#D4AF37]/10 blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#D4AF37]/20 border border-[#D4AF37]/40 px-3 py-1 rounded-full text-[11px] font-semibold text-[#FDF3CD] mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
              Pembayaran Senzu Home Palembang
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Selesaikan Pembayaran
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm mt-1">
              Kode Booking:{' '}
              <span className="font-mono font-bold text-white bg-white/10 px-2 py-0.5 rounded-lg border border-white/20">
                {booking.bookingCode}
              </span>
            </p>
          </div>

          {/* Current Payment Status Banner */}
          <div className="flex flex-col sm:items-end">
            <span className="text-[11px] text-slate-300 mb-1">Status Pembayaran:</span>
            <div
              className={`px-4 py-2 rounded-2xl border text-xs sm:text-sm flex items-center gap-2 shadow-sm ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
            >
              {isPaid ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : isWaitingVerification ? (
                <Clock className="w-4 h-4 text-blue-600 animate-spin" />
              ) : isRejected ? (
                <AlertCircle className="w-4 h-4 text-rose-600" />
              ) : isExpired ? (
                <AlertCircle className="w-4 h-4 text-slate-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
              <span>{statusStyle.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 60-Minute Payment Deadline Countdown (Prompt Requirements 1 & 2) */}
      {!isProofUploaded && !isPaid && !isExpired && (
        <div
          className={`p-4 sm:p-5 rounded-3xl border-2 transition-all ${
            isWarningState
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-950 shadow-sm'
              : 'bg-[#FAF9F6] border-[#D4AF37]/40 text-[#4B2B18] shadow-sm'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Clock
                  className={`w-4 h-4 ${
                    isWarningState ? 'text-amber-600 animate-pulse' : 'text-[#B89628]'
                  }`}
                />
                <span className="text-xs uppercase tracking-wider font-bold text-slate-600">
                  Batas Waktu Pembayaran
                </span>
                {isWarningState && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
                    Kurang dari 10 Menit
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                Selesaikan pembayaran dan unggah bukti pembayaran sebelum waktu berakhir.
              </p>
            </div>
            <div className="sm:text-right shrink-0">
              <div
                className={`font-mono font-extrabold text-2xl sm:text-3xl tracking-wider ${
                  isWarningState ? 'text-amber-600' : 'text-[#4B2B18]'
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
        <div className="p-5 rounded-3xl bg-slate-100 border-2 border-slate-300 text-slate-800 shadow-sm space-y-2">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-slate-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-base text-slate-900">Waktu pembayaran telah berakhir.</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Silakan lakukan pemesanan kembali atau hubungi Customer Service Senzu jika memerlukan bantuan.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Status Notifications */}
      {isPaid && (
        <div className="p-5 rounded-3xl bg-emerald-50 border-2 border-emerald-300 text-emerald-900 shadow-sm flex items-start gap-3.5">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-emerald-900">Pembayaran Berhasil Diverifikasi (Lunas)</h4>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Terima kasih! Pembayaran Anda telah kami terima dan reservasi Anda telah resmi dikonfirmasi. Terapis Senzu akan hadir sesuai jadwal.
            </p>
          </div>
        </div>
      )}

      {isWaitingVerification && (
        <div className="p-5 rounded-3xl bg-blue-50 border-2 border-blue-200 text-blue-900 shadow-sm flex items-start gap-3.5">
          <Clock className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-blue-900">Menunggu Verifikasi Tim CSS</h4>
            <p className="text-xs text-blue-800 leading-relaxed">
              Bukti pembayaran Anda telah kami terima. Tim Customer Service Senzu Home sedang memverifikasi transaksi Anda. Halaman ini akan terupdate otomatis begitu pembayaran diverifikasi.
            </p>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="p-5 rounded-3xl bg-rose-50 border-2 border-rose-300 text-rose-900 shadow-sm space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm text-rose-900">Pembayaran Belum Dapat Diverifikasi</h4>
              <p className="text-xs text-rose-800 mt-0.5">
                Alasan penolakan: <strong>{activePayment?.rejectionReason || 'Nominal tidak sesuai'}</strong>
              </p>
              {activePayment?.rejectionNote && (
                <p className="text-xs text-rose-700 mt-1 italic bg-white/60 p-2 rounded-lg border border-rose-200">
                  Catatan CSS: &ldquo;{activePayment.rejectionNote}&rdquo;
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-700">
            Silakan periksa kembali transfer Anda dan unggah ulang bukti pembayaran yang valid di bawah ini.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Payment Methods & Actions (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card: Payment Methods Selection */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-serif font-bold text-base text-[#4B2B18] flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#B89628]" />
                Pilih Metode Pembayaran
              </h3>
              <span className="text-[11px] text-slate-500 font-medium">Resmi PT KSBONE</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* QRIS Card */}
              <button
                type="button"
                onClick={() => handleSelectMethod('qris')}
                className={`p-3.5 rounded-2xl border-2 transition flex flex-col items-center text-center gap-1.5 min-h-[90px] justify-center cursor-pointer ${
                  selectedMethod === 'qris'
                    ? 'border-[#8B5A36] bg-[#8B5A36]/5 ring-2 ring-[#8B5A36]/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <QrCode
                  className={`w-6 h-6 ${
                    selectedMethod === 'qris' ? 'text-[#4B2B18]' : 'text-slate-500'
                  }`}
                />
                <span className="font-bold text-xs text-[#4B2B18]">QRIS Senzu</span>
                <span className="text-[10px] text-slate-400">Scan Semua E-Wallet</span>
              </button>

              {/* BNI Card */}
              <button
                type="button"
                onClick={() => handleSelectMethod('bni')}
                className={`p-3.5 rounded-2xl border-2 transition flex flex-col items-center text-center gap-1.5 min-h-[90px] justify-center cursor-pointer ${
                  selectedMethod === 'bni'
                    ? 'border-[#8B5A36] bg-[#8B5A36]/5 ring-2 ring-[#8B5A36]/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-emerald-700 text-white text-[10px] font-extrabold flex items-center justify-center">
                  BNI
                </div>
                <span className="font-bold text-xs text-[#4B2B18]">Bank BNI</span>
                <span className="text-[10px] text-slate-400">Transfer Bank</span>
              </button>

              {/* Mandiri Card */}
              <button
                type="button"
                onClick={() => handleSelectMethod('mandiri')}
                className={`p-3.5 rounded-2xl border-2 transition flex flex-col items-center text-center gap-1.5 min-h-[90px] justify-center cursor-pointer ${
                  selectedMethod === 'mandiri'
                    ? 'border-[#8B5A36] bg-[#8B5A36]/5 ring-2 ring-[#8B5A36]/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-blue-700 text-white text-[9px] font-extrabold flex items-center justify-center">
                  MDR
                </div>
                <span className="font-bold text-xs text-[#4B2B18]">Bank Mandiri</span>
                <span className="text-[10px] text-slate-400">Transfer Bank</span>
              </button>

              {/* BRI Card */}
              <button
                type="button"
                onClick={() => handleSelectMethod('bri')}
                className={`p-3.5 rounded-2xl border-2 transition flex flex-col items-center text-center gap-1.5 min-h-[90px] justify-center cursor-pointer ${
                  selectedMethod === 'bri'
                    ? 'border-[#8B5A36] bg-[#8B5A36]/5 ring-2 ring-[#8B5A36]/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="w-6 h-6 rounded-full bg-blue-900 text-white text-[9px] font-extrabold flex items-center justify-center">
                  BRI
                </div>
                <span className="font-bold text-xs text-[#4B2B18]">Bank BRI</span>
                <span className="text-[10px] text-slate-400">Transfer Bank</span>
              </button>
            </div>

            {/* METHOD DETAILS SECTION */}
            {selectedMethod === 'qris' ? (
              /* QRIS CUSTOMER UI */
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                <div className="bg-[#FAF9F6] p-4 sm:p-5 rounded-2xl border border-slate-200 text-center space-y-4">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-[#B89628] uppercase tracking-wider">
                      QRIS STATIS RESMI
                    </span>
                    <h4 className="font-serif font-bold text-base sm:text-lg text-[#4B2B18]">
                      SENZU REFLEXOLOGY & FAMILY MASSAGE QR
                    </h4>
                    <p className="text-[11px] text-slate-500 font-mono">
                      NMID: {qrisConfig.nmid} • Acquirer: {qrisConfig.acquirer}
                    </p>
                  </div>

                  {/* QRIS Image Display: width 100%, max-width 420px, height auto, object-fit contain */}
                  <div className="w-full max-w-[420px] mx-auto">
                    {isQrisNotFound ? (
                      <div className="p-6 rounded-2xl bg-rose-50 border-2 border-rose-200 text-center space-y-2">
                        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
                        <div className="font-bold text-sm text-rose-900">
                          File QRIS resmi belum ditemukan.
                        </div>
                        <p className="text-xs text-rose-700 leading-relaxed">
                          File QRIS resmi Senzu belum terpasang di aset aplikasi. Silakan letakkan file <code>qris-senzu.png</code> di <code>/public/assets/payment/</code> atau unggah melalui menu <strong>Pengaturan Pembayaran</strong> (Admin/CSS).
                        </p>
                      </div>
                    ) : (
                      <div className="p-2 sm:p-3 bg-white rounded-2xl border-2 border-slate-200 shadow-sm flex items-center justify-center">
                        <img
                          src={currentQrisSrc}
                          alt="Official QRIS Senzu Reflexology"
                          className="w-full max-w-[420px] h-auto object-contain mx-auto rounded-xl"
                          onError={handleQrisImgError}
                        />
                      </div>
                    )}
                  </div>

                  {/* Action Buttons: Fullscreen & Copy */}
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isQrisNotFound}
                      onClick={() => setIsFullscreenQrOpen(true)}
                      className="px-4 py-2 min-h-[40px] rounded-xl bg-[#8B5A36] text-white text-xs font-semibold hover:bg-[#94603B] disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Lihat QRIS Ukuran Penuh</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(authoritativeTotal.toString(), 'Nominal pembayaran')}
                      className="px-4 py-2 min-h-[40px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-slate-600" />
                      <span>Salin Nominal</span>
                    </button>
                  </div>

                  {/* NOMINAL PEMBAYARAN - Sangat Jelas */}
                  <div className="bg-emerald-50/90 border-2 border-emerald-300 p-4 rounded-2xl text-center space-y-1.5 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-900 block">
                      TOTAL YANG HARUS DIBAYAR
                    </span>
                    <div className="text-2xl sm:text-3xl font-extrabold text-[#4B2B18] tracking-tight">
                      {formatRupiah(authoritativeTotal)}
                    </div>
                    <p className="text-xs text-amber-800 font-semibold pt-1">
                      ⚠️ Pastikan nominal pembayaran sesuai dengan total booking.
                    </p>
                    <div className="pt-1.5">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(authoritativeTotal.toString(), 'Nominal pembayaran')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-900 text-xs font-bold transition shadow-sm cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Salin Nominal ({formatRupiah(authoritativeTotal)})</span>
                      </button>
                    </div>
                  </div>

                  {/* PETUNJUK PEMBAYARAN QRIS */}
                  <div className="text-left bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-2.5 text-xs shadow-sm">
                    <h5 className="font-bold text-sm text-[#4B2B18]">Petunjuk Pembayaran QRIS</h5>
                    <ol className="list-decimal list-inside space-y-1.5 text-slate-700 leading-relaxed text-xs">
                      <li>Buka aplikasi mobile banking atau e-wallet.</li>
                      <li>Pilih menu <strong>Scan QRIS</strong>.</li>
                      <li>Scan QRIS resmi Senzu di atas.</li>
                      <li>Masukkan nominal sesuai <strong>Total Pembayaran</strong>.</li>
                      <li>Pastikan merchant yang muncul adalah <strong>SENZU REFLEXOLOGY AND FAMILY MASSAGE QR</strong>.</li>
                      <li>Selesaikan pembayaran.</li>
                      <li>Simpan bukti transaksi.</li>
                      <li>Upload bukti pembayaran pada aplikasi Senzu Home.</li>
                    </ol>
                  </div>
                </div>
              </div>
            ) : (
              /* BANK TRANSFER CUSTOMER UI */
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                <div className="bg-[#FAF9F6] p-5 rounded-2xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        Transfer Rekening Resmi
                      </span>
                      <h4 className="font-serif font-bold text-lg text-[#4B2B18]">
                        {currentBankAccount?.bankName || 'Bank Transfer'}
                      </h4>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                      Online 24 Jam
                    </span>
                  </div>

                  {/* Account Number Box */}
                  <div className="bg-white p-4 rounded-2xl border-2 border-[#8B5A36]/20 space-y-1">
                    <span className="text-[11px] text-slate-500">Nomor Rekening Tujuan:</span>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-lg sm:text-xl text-[#4B2B18] tracking-wider">
                        {currentBankAccount?.accountNumber || '-'}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(currentBankAccount?.accountNumber || '', 'Nomor rekening')}
                        className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Copy className="w-3.5 h-3.5 text-slate-600" />
                        <span>Salin No. Rek</span>
                      </button>
                    </div>
                    <div className="text-xs text-slate-600 pt-1">
                      Atas Nama: <strong className="text-slate-900">{currentBankAccount?.accountHolder || 'PT KSBONE UNTUK KITA'}</strong>
                    </div>
                  </div>

                  {/* Amount to transfer */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-slate-500 block">Nominal yang Harus Ditransfer:</span>
                      <span className="font-serif font-bold text-lg text-[#4B2B18]">
                        {formatRupiah(authoritativeTotal)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(authoritativeTotal.toString(), 'Nominal pembayaran')}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5 text-slate-600" />
                      <span>Salin Nominal</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Card: Payment Proof Upload */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-serif font-bold text-base text-[#4B2B18] flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#B89628]" />
                Upload Bukti Pembayaran
              </h3>
              <span className="text-[11px] text-slate-400">JPG, PNG, PDF (Maks. 5 MB)</span>
            </div>

            {isPaid ? (
              <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-200 text-center space-y-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                <h4 className="font-bold text-sm text-emerald-900">Booking Ini Sudah Dibayar</h4>
                <p className="text-xs text-emerald-800">
                  Pembayaran Anda telah diverifikasi oleh tim CSS. Tidak perlu mengunggah bukti pembayaran lagi.
                </p>
                {activePayment?.paymentProofUrl && (
                  <button
                    type="button"
                    onClick={() => setIsPreviewProofOpen(true)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800 hover:underline cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Lihat Bukti yang Pernah Diunggah</span>
                  </button>
                )}
              </div>
            ) : isExpired && !isProofUploaded ? (
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 text-center space-y-2.5">
                <Clock className="w-10 h-10 text-slate-400 mx-auto" />
                <h4 className="font-bold text-sm text-slate-800">Waktu Pembayaran Telah Berakhir</h4>
                <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                  Silakan lakukan pemesanan kembali atau hubungi Customer Service Senzu jika memerlukan bantuan.
                </p>
                <div className="pt-2">
                  <span className="inline-block px-3 py-1 rounded-full text-[11px] font-semibold bg-slate-200 text-slate-600">
                    Upload Bukti Dinonaktifkan
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Existing uploaded proof notice */}
                {activePayment?.paymentProofUrl && (
                  <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2 text-blue-900">
                      <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <div className="truncate">
                        <span className="font-semibold block truncate">
                          {activePayment.paymentProofFileName || 'Bukti Pembayaran Tersimpan'}
                        </span>
                        <span className="text-[10px] text-blue-700">
                          Status: {getPaymentStatusLabel(activePayment.status)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPreviewProofOpen(true)}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1 transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Lihat Bukti</span>
                    </button>
                  </div>
                )}

                {/* Upload File Input Area */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
                    selectedFile
                      ? 'border-[#8B5A36] bg-[#8B5A36]/5'
                      : 'border-slate-300 hover:border-[#8B5A36] bg-[#FAF9F6]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/jpg,image/webp,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Upload className="w-8 h-8 text-[#4B2B18] mx-auto mb-2" />
                  <p className="text-xs font-bold text-[#4B2B18]">
                    {selectedFile ? selectedFile.name : 'Klik atau Tarik File Bukti Pembayaran ke Sini'}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(1)} KB (Otomatis dioptimasi)`
                      : 'Mendukung tangkapan layar e-wallet / m-banking (JPG, PNG, WebP foto resolusi tinggi otomatis dioptimasi; PDF maks. 500 KB)'}
                  </p>
                </div>

                {/* File Image Preview if image */}
                {filePreview && (
                  <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                    <span className="text-[11px] text-slate-500 block mb-1">Pratinjau File yang Dipilih:</span>
                    <img
                      src={filePreview}
                      alt="Preview Bukti Bayar"
                      className="max-h-48 rounded-lg object-contain mx-auto border border-slate-200"
                    />
                  </div>
                )}

                {uploadError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {uploadSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                    <div>
                      <span className="font-bold block">Bukti pembayaran berhasil dikirim dan sedang menunggu verifikasi.</span>
                      <span className="text-[11px] text-emerald-700">
                        Tim Senzu akan melakukan verifikasi pembayaran Anda.
                      </span>
                    </div>
                  </div>
                )}

                {/* Upload Button */}
                <button
                  type="button"
                  disabled={!selectedFile || isUploading}
                  onClick={handleUploadProof}
                  className={`w-full py-3.5 min-h-[48px] rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition active:scale-95 shadow-md ${
                    !selectedFile || isUploading
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#4B2B18] cursor-pointer'
                  }`}
                >
                  {isUploading ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin text-[#4B2B18]" />
                      <span>Mengirim bukti...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Kirim Bukti Pembayaran</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Official Safety Notice */}
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-amber-950">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              Keamanan Pembayaran Senzu
            </div>
            <p className="text-[11px] leading-relaxed text-amber-800">
              Pastikan pembayaran hanya dilakukan ke rekening resmi atas nama <strong>PT KSBONE UNTUK KITA</strong> atau QRIS resmi Senzu yang ditampilkan pada aplikasi ini. Senzu Home tidak pernah meminta transfer ke rekening pribadi perorangan.
            </p>
          </div>
        </div>

        {/* RIGHT COLUMN: Booking Summary & Details (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-5 sticky top-24">
            <div className="border-b border-slate-100 pb-3">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Rincian Tagihan
              </span>
              <h3 className="font-serif font-bold text-lg text-[#4B2B18]">
                Ringkasan Reservasi
              </h3>
            </div>

            {/* Itemized Price Calculation */}
            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between items-center">
                <span>Subtotal Layanan</span>
                <span className="font-semibold text-slate-900">
                  {formatRupiah(booking.servicePrice || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Biaya Home Service</span>
                <span className={`font-semibold ${booking.homeServiceFee === 0 ? 'text-emerald-700 font-bold' : 'text-slate-900'}`}>
                  {booking.homeServiceFee === 0 ? 'GRATIS' : formatRupiah(booking.homeServiceFee || 0)}
                </span>
              </div>
              {Boolean(booking.discountAmount) ? (
                <div className="flex justify-between items-center text-emerald-700">
                  <span>Diskon</span>
                  <span>-{formatRupiah(booking.discountAmount || 0)}</span>
                </div>
              ) : null}

              <div className="pt-3 border-t-2 border-slate-100 flex justify-between items-center text-sm font-bold text-[#4B2B18]">
                <span>Total Pembayaran</span>
                <span className="font-serif text-lg text-[#4B2B18]">
                  {formatRupiah(authoritativeTotal)}
                </span>
              </div>
            </div>

            {/* Booking Details List */}
            <div className="bg-[#FAF9F6] p-4 rounded-2xl border border-slate-200 space-y-3 text-xs">
              <div className="flex items-start gap-2">
                <User className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-slate-400 text-[10px] block uppercase font-semibold">Nama Pelanggan</span>
                  <span className="font-bold text-slate-800">{booking.customerName}</span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-slate-400 text-[10px] block uppercase font-semibold">Jadwal Treatment</span>
                  <span className="font-bold text-slate-800">
                    {formatDateIndo(booking.scheduleDate)} • {booking.scheduleTime} WIB
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-slate-400 text-[10px] block uppercase font-semibold">Durasi Layanan</span>
                  <span className="font-bold text-slate-800">{booking.serviceDuration} Menit</span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-slate-400 text-[10px] block uppercase font-semibold">Alamat Tujuan</span>
                  <span className="font-medium text-slate-700 leading-relaxed">
                    {booking.area} — {booking.address}
                  </span>
                  {booking.addressNotes && (
                    <span className="text-[11px] text-slate-500 block italic mt-0.5">
                      Patokan: {booking.addressNotes}
                    </span>
                  )}
                </div>
              </div>

              {booking.therapistName && (
                <div className="flex items-start gap-2 pt-1 border-t border-slate-200">
                  <Sparkles className="w-4 h-4 text-[#B89628] mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-slate-400 text-[10px] block uppercase font-semibold">Terapis Ditugaskan</span>
                    <span className="font-bold text-[#4B2B18]">{booking.therapistName}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Post-Booking Customer Registration Banner (Prompt 17B) */}
            {!isCustomerAuthenticated ? (
              <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[#FAF7F2] to-[#F5EFEB] border border-[#D4AF37]/40 shadow-xs space-y-2">
                <div className="flex items-start gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#8B5A36] text-[#D4AF37] flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="font-serif font-bold text-xs text-[#4B2B18]">
                      Simpan Booking ke Akun Senzu
                    </h4>
                    <p className="text-[10px] text-slate-600 leading-snug">
                      Daftar akun gratis agar mudah melacak terapis, simpan alamat favorit, dan kumpulkan poin reward.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  id="btn-payment-create-account"
                  onClick={() => setIsRegisterModalOpen(true)}
                  className="w-full py-2 px-3 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs cursor-pointer active:scale-95"
                >
                  <User className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>Daftar Akun dengan Data Booking Ini</span>
                </button>
              </div>
            ) : (
              <div className="p-2.5 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>
                  Booking terhubung ke akun Anda: <strong>{currentCustomer?.email}</strong>
                </span>
              </div>
            )}

            {/* Quick WhatsApp Support & Post-Upload Reminder */}
            <div className="pt-2 space-y-3">
              {isCsAvailable ? (
                <a
                  id="btn-payment-cs"
                  onClick={() => { void trackMetaAdsAction('payment_confirmation_clicked', { entityId: booking.id, value: booking.totalAmount }); }}
                  href={getCsWhatsAppUrl(
                    `Halo Senzu Home, saya ingin konfirmasi pembayaran untuk Kode Booking: ${booking.bookingCode}`
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer shadow-sm"
                >
                  <Phone className="w-4 h-4" />
                  <span>Bantuan / Konfirmasi via WA</span>
                </a>
              ) : (
                <button
                  id="btn-payment-cs"
                  type="button"
                  onClick={() => alert(csUnavailableNotice)}
                  className="w-full py-3 min-h-[44px] rounded-xl bg-slate-200 text-slate-600 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  title={csUnavailableNotice}
                >
                  <Phone className="w-4 h-4" />
                  <span>Bantuan / Konfirmasi via WA ({csUnavailableNotice})</span>
                </button>
              )}

              {/* Requirements 6 & 7: Post-Proof Upload Success Message */}
              {(isWaitingVerification || uploadSuccess || Boolean(activePayment?.paymentProofUrl)) && !isPaid && (
                <div className="p-3.5 bg-emerald-50/90 border border-emerald-200 rounded-2xl text-left space-y-1.5 shadow-2xs animate-in fade-in slide-in-from-top-1">
                  <p className="text-xs font-bold text-emerald-950 leading-relaxed">
                    ✅ Bukti pembayaran berhasil dikirim.
                    <br />
                    Mohon ditunggu. Tim kami sedang memeriksa bukti pembayaran Anda.
                  </p>
                  <p className="text-[11px] text-emerald-800 leading-normal">
                    Status pesanan akan diperbarui setelah pembayaran selesai diverifikasi.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: Fullscreen QRIS Image */}
      {isFullscreenQrOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-lg w-full max-h-[92vh] overflow-y-auto space-y-4 relative text-center shadow-2xl">
            <button
              type="button"
              onClick={() => setIsFullscreenQrOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1 pt-2">
              <span className="text-[11px] font-bold text-[#B89628] tracking-widest uppercase">
                QRIS STATIS RESMI
              </span>
              <h3 className="font-serif font-bold text-lg text-[#4B2B18]">
                SENZU REFLEXOLOGY AND FAMILY MASSAGE QR
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                NMID: {qrisConfig.nmid} • Acquirer: {qrisConfig.acquirer}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center">
              {isQrisNotFound ? (
                <div className="py-12 text-center text-xs text-rose-600 font-bold">
                  File QRIS resmi belum ditemukan.
                </div>
              ) : (
                <img
                  src={currentQrisSrc}
                  alt="QRIS Senzu Fullscreen"
                  className="w-full max-w-[420px] max-h-[70vh] h-auto object-contain mx-auto rounded-lg"
                />
              )}
            </div>

            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 text-xs text-emerald-900 font-medium">
              Total yang Harus Dibayar: <strong>{formatRupiah(authoritativeTotal)}</strong>
            </div>

            <button
              type="button"
              onClick={() => setIsFullscreenQrOpen(false)}
              className="w-full py-3 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold transition cursor-pointer"
            >
              Tutup QRIS
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Preview Uploaded Proof */}
      {isPreviewProofOpen && activePayment?.paymentProofUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-4 relative">
            <button
              type="button"
              onClick={() => setIsPreviewProofOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-bold text-[#4B2B18] text-base">
                Bukti Pembayaran yang Telah Diunggah
              </h3>
              <p className="text-xs text-slate-500">
                {activePayment.paymentProofFileName} • {activePayment.paymentProofUploadedAt ? new Date(activePayment.paymentProofUploadedAt).toLocaleString('id-ID') : '-'}
              </p>
            </div>

            {activePayment.paymentProofMimeType === 'application/pdf' ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <FileText className="w-12 h-12 text-blue-600 mx-auto" />
                <p className="text-xs font-semibold text-slate-700">Dokumen Bukti Transfer (PDF)</p>
                <a
                  href={activePayment.paymentProofUrl}
                  download={activePayment.paymentProofFileName || 'bukti-transfer.pdf'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold"
                >
                  <Eye className="w-4 h-4" />
                  <span>Buka / Unduh File PDF</span>
                </a>
              </div>
            ) : (
              <div className="p-2 bg-slate-100 rounded-2xl border border-slate-200 text-center">
                <img
                  src={activePayment.paymentProofUrl}
                  alt="Bukti Transfer"
                  className="max-h-[60vh] mx-auto object-contain rounded-lg"
                />
              </div>
            )}

            <div className="text-xs text-slate-500 flex justify-between items-center pt-2">
              <span>Status Verifikasi:</span>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusStyle.bg} ${statusStyle.text}`}>
                {statusStyle.label}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Customer Registration Modal (Post-Booking pre-filled) */}
      <CustomerRegisterModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onSwitchToLogin={() => {
          setIsRegisterModalOpen(false);
          setIsLoginModalOpen(true);
        }}
        initialName={booking.customerName}
        initialWhatsApp={booking.customerWhatsApp}
        initialEmail={booking.customerEmail}
        initialAddress={booking.address}
        initialArea={booking.area}
        currentBookingCode={booking.bookingCode}
      />

      {/* Customer Login Modal */}
      <CustomerLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSwitchToRegister={() => {
          setIsLoginModalOpen(false);
          setIsRegisterModalOpen(true);
        }}
      />
    </div>
  );
};
