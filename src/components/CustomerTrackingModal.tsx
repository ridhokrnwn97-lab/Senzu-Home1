import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Search,
  CheckCircle2,
  Clock,
  User,
  Phone,
  MapPin,
  Calendar,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  CreditCard,
  QrCode,
  Check,
  Navigation,
  Repeat,
  Star,
  Share2,
  Copy,
  Printer,
  FileText,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  HeartHandshake,
  RefreshCw,
  Flame,
  Volume2
} from 'lucide-react';
import { Booking, BookingStatus, BookingStatusHistory, AppSettings } from '../types';
import {
  trackBookingByCodeAndPhone,
  getBookingByCode,
  getBookingStatusHistory,
  subscribeToBookingById,
  subscribeToBookingStatusHistory
} from '../lib/dbService';
import { getReviewByBookingId } from '../lib/crmService';
import { CustomerReview } from '../types/crm';
import { PendingPaymentCard } from './customer/PendingPaymentCard';
import { CustomerReviewModal } from './CustomerReviewModal';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { CustomerLiveMap } from './CustomerLiveMap';
import { getPaymentStatusBadgeStyle } from '../lib/paymentService';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { auth } from '../lib/firebase';
import { BookingChatModal } from './chat/BookingChatModal';
import { ChatButtonWithBadge } from './chat/ChatButtonWithBadge';

interface CustomerTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  initialCode?: string;
  onRepeatBooking?: (booking: Booking) => void;
  onOpenPayment?: (booking: Booking) => void;
  allBookings?: Booking[];
}

export function mapBookingStatusToDisplay(status: BookingStatus): {
  label: string;
  sublabel: string;
  badgeClass: string;
  stageIndex: number;
} {
  switch (status) {
    case 'Menunggu Pembayaran':
      return {
        label: 'Menunggu Pembayaran',
        sublabel: 'Silakan selesaikan pembayaran non-tunai & upload bukti transfer',
        badgeClass: 'bg-amber-400/20 text-amber-300 border border-amber-400/50',
        stageIndex: 0,
      };
    case 'Pembayaran Terverifikasi':
      return {
        label: 'Pembayaran Terverifikasi',
        sublabel: 'Pembayaran dicek CSS Senzu. Supervisor akan menugaskan terapis.',
        badgeClass: 'bg-blue-400/20 text-blue-300 border border-blue-400/50',
        stageIndex: 1,
      };
    case 'Confirmed':
      return {
        label: 'Booking Dikonfirmasi',
        sublabel: 'Reservasi Anda telah dijadwalkan secara resmi oleh Senzu Home',
        badgeClass: 'bg-indigo-400/20 text-indigo-300 border border-indigo-400/50',
        stageIndex: 1,
      };
    case 'Therapist Assigned':
      return {
        label: 'Terapis Ditugaskan',
        sublabel: 'Terapis profesional Senzu telah ditugaskan untuk pesanan Anda',
        badgeClass: 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/50',
        stageIndex: 1,
      };
    case 'Accepted':
      return {
        label: 'Terapis Bersiap',
        sublabel: 'Terapis menerima jadwal dan menyiapkan peralatan steril',
        badgeClass: 'bg-amber-400/20 text-amber-200 border border-amber-400/50',
        stageIndex: 1,
      };
    case 'On The Way':
      return {
        label: 'Terapis Menuju Lokasi',
        sublabel: 'Terapis sedang berkendara ke alamat Anda • Live GPS Aktif',
        badgeClass: 'bg-[#D4AF37] text-[#082A4F] font-bold border border-amber-300 shadow-sm',
        stageIndex: 2,
      };
    case 'Arrived':
      return {
        label: 'Terapis Telah Tiba',
        sublabel: 'Terapis sudah sampai di lokasi Anda • Siap memulai treatment',
        badgeClass: 'bg-teal-500/20 text-teal-300 border border-teal-400/50',
        stageIndex: 3,
      };
    case 'Treatment':
      return {
        label: 'Treatment Berlangsung',
        sublabel: 'Sesi pijat & relaksasi sedang berlangsung • Waktu berjalan',
        badgeClass: 'bg-purple-500/20 text-purple-200 border border-purple-400/50',
        stageIndex: 4,
      };
    case 'Completed':
      return {
        label: 'Treatment Selesai',
        sublabel: 'Layanan telah selesai • Terima kasih atas kepercayaan Anda',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50',
        stageIndex: 5,
      };
    case 'Cancelled':
      return {
        label: 'Pesanan Dibatalkan',
        sublabel: 'Reservasi ini telah dibatalkan',
        badgeClass: 'bg-rose-500/20 text-rose-300 border border-rose-400/50',
        stageIndex: -1,
      };
    case 'Rescheduled':
      return {
        label: 'Jadwal Diubah',
        sublabel: 'Jadwal kunjungan telah disesuaikan ulang oleh Supervisor',
        badgeClass: 'bg-sky-500/20 text-sky-300 border border-sky-400/50',
        stageIndex: 1,
      };
    default:
      return {
        label: status,
        sublabel: 'Sedang diproses oleh sistem Senzu Home',
        badgeClass: 'bg-[#D4AF37] text-[#082A4F] font-bold',
        stageIndex: 0,
      };
  }
}

const MILESTONE_STEPS = [
  { id: 'pay', title: 'Pembayaran', desc: 'Verifikasi' },
  { id: 'confirm', title: 'Konfirmasi', desc: 'Terapis Siap' },
  { id: 'otw', title: 'Menuju Lokasi', desc: 'Live GPS' },
  { id: 'arrived', title: 'Telah Tiba', desc: 'Penyambutan' },
  { id: 'treatment', title: 'Treatment', desc: 'Sesi Aktif' },
  { id: 'done', title: 'Selesai', desc: 'Review & Repeat' },
];

export const CustomerTrackingModal: React.FC<CustomerTrackingModalProps> = ({
  isOpen,
  onClose,
  settings,
  initialCode = '',
  onRepeatBooking,
  onOpenPayment,
  allBookings = [],
}) => {
  const { firebaseUser, currentCustomer, isCustomerAuthenticated, isCustomerPreviewMode } = useCustomerAuth();

  const activeAuthUid = useMemo(() => {
    if (isCustomerPreviewMode || !isCustomerAuthenticated || !firebaseUser) return '';
    const uid = typeof firebaseUser.uid === 'string' ? firebaseUser.uid.trim() : '';
    if (!uid || firebaseUser.uid !== uid || uid.includes('/') || /[\x00-\x1F\x7F\s]/.test(uid)) {
      return '';
    }
    const liveAuthUser = auth?.currentUser;
    if (liveAuthUser !== null && liveAuthUser !== undefined) {
      const liveUid = typeof liveAuthUser.uid === 'string' ? liveAuthUser.uid.trim() : '';
      if (!liveUid || liveUid !== uid) {
        return '';
      }
    }
    if (
      currentCustomer?.authUserId &&
      currentCustomer.authUserId.trim() !== '' &&
      currentCustomer.authUserId.trim() !== uid
    ) {
      return '';
    }
    const acctStatus =
      typeof (currentCustomer as any)?.accountStatus === 'string'
        ? String((currentCustomer as any).accountStatus).trim().toUpperCase()
        : '';
    const profStatus =
      typeof (currentCustomer as any)?.status === 'string'
        ? String((currentCustomer as any).status).trim().toUpperCase()
        : '';
    if (
      acctStatus === 'DISABLED' ||
      acctStatus === 'INACTIVE' ||
      acctStatus === 'NOT_REGISTERED' ||
      [
        'DISABLED',
        'INACTIVE',
        'ARCHIVED',
        'BLOCKED',
        'DELETED',
        'DELETION_REQUESTED',
      ].includes(profStatus)
    ) {
      return '';
    }
    return uid;
  }, [
    isCustomerPreviewMode,
    isCustomerAuthenticated,
    firebaseUser,
    currentCustomer,
  ]);

  const normalizeModalTrackingPhone = (raw: unknown): string => {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (trimmed.length < 8 || trimmed.length > 30) return '';
    if (!/^\+?[0-9][0-9\s\-]{6,28}[0-9]$/.test(trimmed)) return '';
    if (/--/.test(trimmed)) return '';
    const hasLeadingPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/^\+/, '').replace(/[\s\-]/g, '');
    if (!/^[0-9]{8,20}$/.test(digits)) return '';
    if (hasLeadingPlus) {
      if (digits.startsWith('0')) return '';
      return digits;
    }
    if (digits.startsWith('00')) return '';
    if (digits.startsWith('0')) {
      return `62${digits.slice(1)}`;
    }
    if (digits.startsWith('8')) {
      return `62${digits}`;
    }
    return digits;
  };

  const doesBookingBelongToUid = (booking: Booking | null | undefined, uid: string): boolean => {
    if (!booking || !uid) return false;
    const rawBooking = booking as unknown as Record<string, unknown>;
    for (const rawField of [
      rawBooking.customerAuthUid,
      rawBooking.authUserId,
      rawBooking.customerUid,
      rawBooking.userId,
      rawBooking.uid,
    ]) {
      if (rawField !== undefined && rawField !== null && rawField !== '') {
        if (typeof rawField !== 'string' || rawField.trim() !== rawField || rawField !== uid) {
          return false;
        }
      }
    }
    const custAuthUid =
      typeof booking.customerAuthUid === 'string' ? booking.customerAuthUid.trim() : '';
    const authUserId =
      typeof booking.authUserId === 'string' ? booking.authUserId.trim() : '';
    if (custAuthUid !== uid && authUserId !== uid) return false;

    const rawCustId = rawBooking.customerId;
    if (rawCustId !== undefined && rawCustId !== null && rawCustId !== '') {
      if (typeof rawCustId !== 'string' || rawCustId.trim() !== rawCustId) return false;
      if (
        rawCustId.startsWith('cust_u_') &&
        rawCustId !== `cust_u_${uid}` &&
        rawCustId !== `cust_u_${uid.slice(0, 10)}`
      ) {
        return false;
      }
    }
    return true;
  };

  const sanitizeOwnerRealtimeBooking = (
    rawBooking: Booking,
    expectedId: string,
    expectedCode: string
  ): Booking => {
    const clone: Record<string, any> = { ...(rawBooking as unknown as Record<string, any>) };
    delete clone.internalNotes;
    delete clone.escalation;
    delete clone.cssOwnerId;
    delete clone.cssOwnerName;
    delete clone.unreachableCount;
    delete clone.lastContactAttemptAt;
    delete clone.nextFollowUpAt;
    delete clone.guestAccessTokenHash;
    delete clone.issueReport;
    delete clone.requiresAdminConfirmation;
    delete clone.isReassigned;
    delete clone.reassignedFromTherapistId;
    delete clone.referredByCustomerId;
    delete clone.referralCodeUsed;
    clone.id = expectedId;
    clone.bookingCode = expectedCode;
    return clone as Booking;
  };

  const [bookingCode, setBookingCode] = useState(initialCode);
  const [phone, setPhone] = useState(() => {
    if (isCustomerPreviewMode || !isCustomerAuthenticated) return '';
    return currentCustomer?.phone || '';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isNearby, setIsNearby] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const [trackingData, setTrackingData] = useState<{
    booking: Booking;
    history: BookingStatusHistory[];
    accessLevel?: 'staff' | 'therapist' | 'owner' | 'guest';
  } | null>(null);

  const [existingReview, setExistingReview] = useState<CustomerReview | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [isChatModalOpen, setIsChatModalOpen] = useState<boolean>(false);

  // Active treatment elapsed timer (seconds)
  const [treatmentTimerTick, setTreatmentTimerTick] = useState<number>(0);

  // Centralized Official Senzu Customer Service WhatsApp (Must be called unconditionally before early return)
  const {
    isAvailable: isCsAvailable,
    getWhatsAppUrl: getCsWhatsAppUrl,
    unavailableNotice: csUnavailableNotice,
  } = useCustomerServiceWhatsApp();

  // Realtime Subscriptions, Generation & Session Continuity Refs
  const unsubBookingRef = useRef<(() => void) | null>(null);
  const unsubHistoryRef = useRef<(() => void) | null>(null);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const requestGenRef = useRef<number>(0);
  const trackedSessionKeyRef = useRef<string>('');
  const trackedBookingIdRef = useRef<string>('');
  const verifiedPhoneRef = useRef<string>('');
  const activeAuthUidRef = useRef<string>(activeAuthUid);
  const isOpenRef = useRef<boolean>(isOpen);
  const isPreviewModeRef = useRef<boolean>(isCustomerPreviewMode);

  activeAuthUidRef.current = activeAuthUid;
  isOpenRef.current = isOpen;
  isPreviewModeRef.current = isCustomerPreviewMode;

  const isCurrentSessionMatching = (expectedUid: string): boolean => {
    if (!isOpenRef.current || isPreviewModeRef.current) return false;
    if (activeAuthUidRef.current !== expectedUid) return false;
    const liveUid =
      auth?.currentUser && typeof auth.currentUser.uid === 'string'
        ? auth.currentUser.uid.trim()
        : '';
    if (expectedUid) {
      return !auth?.currentUser || liveUid === expectedUid;
    }
    return liveUid === '';
  };

  // Cleanup subscriptions and in-flight requests on unmount or when modal closes
  const cleanupSubscriptions = () => {
    if (lookupAbortRef.current) {
      lookupAbortRef.current.abort();
      lookupAbortRef.current = null;
    }
    if (unsubBookingRef.current) {
      unsubBookingRef.current();
      unsubBookingRef.current = null;
    }
    if (unsubHistoryRef.current) {
      unsubHistoryRef.current();
      unsubHistoryRef.current = null;
    }
  };

  const resetActiveTrackingState = () => {
    requestGenRef.current += 1;
    cleanupSubscriptions();
    trackedSessionKeyRef.current = '';
    trackedBookingIdRef.current = '';
    verifiedPhoneRef.current = '';
    setTrackingData(null);
    setExistingReview(null);
    setIsReviewModalOpen(false);
    setIsChatModalOpen(false);
    setShowReceipt(false);
  };

  useEffect(() => {
    return () => {
      requestGenRef.current += 1;
      cleanupSubscriptions();
    };
  }, []);

  // Session & preview-mode guard: immediately purge tracking state if auth UID or preview mode changes
  useEffect(() => {
    if (!isOpen) {
      resetActiveTrackingState();
      setIsLoading(false);
      setErrorMsg('');
      if (!activeAuthUid) {
        setPhone('');
      }
      return;
    }
    if (isCustomerPreviewMode) {
      resetActiveTrackingState();
      setIsLoading(false);
      setPhone('');
      return;
    }
    const currentSessionKey = activeAuthUid ? `uid:${activeAuthUid}` : 'guest';
    if (
      trackedSessionKeyRef.current &&
      trackedSessionKeyRef.current !== currentSessionKey
    ) {
      resetActiveTrackingState();
      setIsLoading(false);
      if (!activeAuthUid) {
        setPhone('');
      }
      setShowManualSearch(true);
      return;
    }
    if (
      trackingData &&
      trackingData.accessLevel === 'owner' &&
      (!activeAuthUid || !doesBookingBelongToUid(trackingData.booking, activeAuthUid))
    ) {
      resetActiveTrackingState();
      setShowManualSearch(true);
      return;
    }
    if (
      trackingData &&
      trackingData.accessLevel === 'guest' &&
      (Boolean(activeAuthUid) || !verifiedPhoneRef.current)
    ) {
      resetActiveTrackingState();
      setShowManualSearch(true);
    }
  }, [isOpen, isCustomerPreviewMode, activeAuthUid, trackingData]);

  // Update code when initialCode prop changes
  useEffect(() => {
    if (initialCode) {
      setBookingCode(initialCode);
      setShowManualSearch(false);
    }
  }, [initialCode]);

  // Automatic Loading effect when modal opens with initialCode
  useEffect(() => {
    if (!isOpen) {
      cleanupSubscriptions();
      return;
    }

    if (isCustomerPreviewMode) {
      resetActiveTrackingState();
      setShowManualSearch(true);
      return;
    }

    const targetCode = (initialCode || bookingCode || '').trim().toUpperCase();
    if (!targetCode || /^BK_/i.test(targetCode) || !/^[A-Z0-9_-]{3,64}$/.test(targetCode)) {
      setShowManualSearch(true);
      return;
    }

    const sessionUidSnapshot = activeAuthUid;
    if (!sessionUidSnapshot) {
      // Unauthenticated guests must explicitly submit booking code + WhatsApp number in the manual search form
      setShowManualSearch(true);
      return;
    }

    const myGen = ++requestGenRef.current;
    if (lookupAbortRef.current) {
      lookupAbortRef.current.abort();
    }
    const controller = new AbortController();
    lookupAbortRef.current = controller;

    const isStillCurrent = () =>
      requestGenRef.current === myGen &&
      !controller.signal.aborted &&
      isCurrentSessionMatching(sessionUidSnapshot);

    const autoFetch = async () => {
      setIsLoading(true);
      setErrorMsg('');

      try {
        const matchedBooking = allBookings.find(
          (b) =>
            b.bookingCode.toUpperCase() === targetCode &&
            doesBookingBelongToUid(b, sessionUidSnapshot)
        );

        // Always verify access via authoritative backend read (never trust client allBookings alone)
        const verifiedBooking = await getBookingByCode(targetCode, {
          ...(matchedBooking?.id ? { bookingId: matchedBooking.id } : {}),
          signal: controller.signal,
        });
        if (!isStillCurrent()) return;

        if (verifiedBooking && doesBookingBelongToUid(verifiedBooking, sessionUidSnapshot)) {
          const initialHist = await getBookingStatusHistory(verifiedBooking.bookingCode, {
            bookingId: verifiedBooking.id,
            signal: controller.signal,
          });
          if (!isStillCurrent()) return;
          setupRealtimeListeners(verifiedBooking, initialHist, 'owner', '', myGen);
          return;
        }

        const ownerPhone = normalizeModalTrackingPhone(currentCustomer?.phone || phone);
        if (ownerPhone) {
          const result = await trackBookingByCodeAndPhone(targetCode, ownerPhone, {
            signal: controller.signal,
          });
          if (!isStillCurrent()) return;
          if (
            result &&
            result.accessLevel === 'owner' &&
            doesBookingBelongToUid(result.booking, sessionUidSnapshot)
          ) {
            setupRealtimeListeners(
              result.booking,
              result.history,
              'owner',
              ownerPhone,
              myGen
            );
            return;
          }
        }

        if (isStillCurrent()) {
          setShowManualSearch(true);
        }
      } catch (err) {
        if (isStillCurrent()) {
          console.warn('Auto tracking lookup notice:', err);
          setShowManualSearch(true);
        }
      } finally {
        if (requestGenRef.current === myGen) {
          setIsLoading(false);
        }
      }
    };

    void autoFetch();

    return () => {
      controller.abort();
    };
  }, [isOpen, initialCode, activeAuthUid, isCustomerPreviewMode]);

  // Setup real-time listeners for booking & history
  const setupRealtimeListeners = (
    initialBooking: Booking,
    initialHist: BookingStatusHistory[] = [],
    accessMode?: 'staff' | 'therapist' | 'owner' | 'guest',
    verifiedPhone = '',
    callerGen?: number
  ) => {
    cleanupSubscriptions();

    const activeGen =
      typeof callerGen === 'number' && callerGen === requestGenRef.current
        ? callerGen
        : ++requestGenRef.current;

    const currentUid = activeAuthUidRef.current;
    const cleanPhone = normalizeModalTrackingPhone(verifiedPhone);

    const isOwnerSession = Boolean(
      currentUid &&
        isCurrentSessionMatching(currentUid) &&
        accessMode === 'owner' &&
        doesBookingBelongToUid(initialBooking, currentUid)
    );
    const isGuestSession = Boolean(
      !currentUid &&
        isCurrentSessionMatching('') &&
        accessMode === 'guest' &&
        cleanPhone
    );

    if (!isOwnerSession && !isGuestSession) {
      resetActiveTrackingState();
      setShowManualSearch(true);
      return;
    }

    const resolvedAccessLevel: 'owner' | 'guest' = isOwnerSession ? 'owner' : 'guest';
    const sessionKey = isOwnerSession ? `uid:${currentUid}` : 'guest';
    const expectedUid = isOwnerSession ? currentUid : '';
    const bookingIdSnapshot = initialBooking.id;
    const bookingCodeSnapshot = initialBooking.bookingCode;

    trackedSessionKeyRef.current = sessionKey;
    trackedBookingIdRef.current = bookingIdSnapshot;
    verifiedPhoneRef.current = isGuestSession ? cleanPhone : '';
    setExistingReview(null);

    const safeInitialBooking = isOwnerSession
      ? sanitizeOwnerRealtimeBooking(initialBooking, bookingIdSnapshot, bookingCodeSnapshot)
      : initialBooking;

    setTrackingData({
      booking: safeInitialBooking,
      history: initialHist,
      accessLevel: resolvedAccessLevel,
    });
    setShowManualSearch(false);

    const isSubscriptionStillValid = () =>
      requestGenRef.current === activeGen &&
      trackedSessionKeyRef.current === sessionKey &&
      trackedBookingIdRef.current === bookingIdSnapshot &&
      isCurrentSessionMatching(expectedUid);

    // Only authenticated customer owners may read customer_reviews or open direct Firestore booking doc listener
    if (isOwnerSession && safeInitialBooking.status === 'Completed') {
      getReviewByBookingId(bookingIdSnapshot)
        .then((rev) => {
          if (isSubscriptionStillValid()) {
            setExistingReview(rev);
          }
        })
        .catch(() => {});
    }

    if (isOwnerSession) {
      unsubBookingRef.current = subscribeToBookingById(bookingIdSnapshot, (updatedBooking) => {
        if (!isSubscriptionStillValid()) {
          cleanupSubscriptions();
          return;
        }
        if (
          !updatedBooking ||
          (updatedBooking.id && updatedBooking.id !== bookingIdSnapshot) ||
          (updatedBooking.bookingCode &&
            String(updatedBooking.bookingCode).trim().toUpperCase() !==
              bookingCodeSnapshot.trim().toUpperCase()) ||
          !doesBookingBelongToUid(updatedBooking, expectedUid)
        ) {
          resetActiveTrackingState();
          setShowManualSearch(true);
          setErrorMsg('Sesi akses pesanan telah berakhir. Silakan lacak kembali reservasi Anda.');
          return;
        }
        const safeUpdated = sanitizeOwnerRealtimeBooking(
          updatedBooking,
          bookingIdSnapshot,
          bookingCodeSnapshot
        );
        setTrackingData((prev) =>
          prev && isSubscriptionStillValid()
            ? { ...prev, booking: safeUpdated, accessLevel: 'owner' }
            : prev
        );

        if (safeUpdated.status === 'Completed') {
          getReviewByBookingId(bookingIdSnapshot)
            .then((rev) => {
              if (isSubscriptionStillValid()) {
                setExistingReview(rev);
              }
            })
            .catch(() => {});
        }
      });
    }

    // Subscribe to authoritative status history updates (and guest booking updates when unauthenticated)
    unsubHistoryRef.current = subscribeToBookingStatusHistory(
      bookingCodeSnapshot,
      (updatedHistory) => {
        if (!isSubscriptionStillValid()) return;
        setTrackingData((prev) =>
          prev && isSubscriptionStillValid() ? { ...prev, history: updatedHistory } : prev
        );
      },
      {
        bookingId: bookingIdSnapshot,
        phone: resolvedAccessLevel === 'guest' ? cleanPhone : undefined,
        onBookingUpdate:
          resolvedAccessLevel === 'guest'
            ? (updatedGuestBooking) => {
                if (!isSubscriptionStillValid()) return;
                if (
                  updatedGuestBooking.id !== bookingIdSnapshot ||
                  String(updatedGuestBooking.bookingCode || '').trim().toUpperCase() !==
                    bookingCodeSnapshot.trim().toUpperCase()
                ) {
                  resetActiveTrackingState();
                  setShowManualSearch(true);
                  return;
                }
                setTrackingData((prev) =>
                  prev && isSubscriptionStillValid()
                    ? { ...prev, booking: updatedGuestBooking, accessLevel: 'guest' }
                    : prev
                );
              }
            : undefined,
        onError: (err) => {
          if (!isSubscriptionStillValid()) return;
          if (err.status === 401 || err.status === 403 || err.status === 404 || err.status === 409) {
            resetActiveTrackingState();
            setShowManualSearch(true);
            setErrorMsg(
              err.message ||
                'Sesi pelacakan berakhir atau akses ditolak. Silakan masukkan kembali data reservasi Anda.'
            );
          }
        },
      }
    );
  };

  // Treatment Timer Heartbeat (1s interval)
  useEffect(() => {
    if (!isOpen || !trackingData || trackingData.booking.status !== 'Treatment') {
      return;
    }

    const timer = setInterval(() => {
      setTreatmentTimerTick((t) => t + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, trackingData?.booking.status]);

  if (!isOpen) return null;

  // Calculate Treatment Elapsed & Remaining
  const treatmentMetrics = (() => {
    if (!trackingData || trackingData.booking.status !== 'Treatment') return null;

    const treatmentHistoryEntry = (trackingData.history || []).find(
      (h) => h.status === 'Treatment'
    );
    const startTimeIso =
      treatmentHistoryEntry?.timestamp ||
      trackingData.booking.updatedAt ||
      new Date().toISOString();

    const startMs = new Date(startTimeIso).getTime();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    const elapsedMin = Math.floor(elapsedSec / 60);
    const totalMin = trackingData.booking.serviceDuration || 90;
    const remainingMin = Math.max(0, totalMin - elapsedMin);
    const progressPct = Math.min(100, Math.round((elapsedMin / totalMin) * 100));

    const elapsedFormatted = `${String(elapsedMin).padStart(2, '0')}:${String(
      elapsedSec % 60
    ).padStart(2, '0')}`;

    return {
      startTimeFormatted: new Date(startTimeIso).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      elapsedFormatted,
      elapsedMin,
      totalMin,
      remainingMin,
      progressPct,
    };
  })();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    resetActiveTrackingState();

    const trimmedCode = bookingCode.trim();
    const cleanCode = trimmedCode.toUpperCase();
    const canonicalPhone = normalizeModalTrackingPhone(phone);

    if (
      !cleanCode ||
      /^BK_/i.test(cleanCode) ||
      cleanCode.length < 3 ||
      cleanCode.length > 64 ||
      !/^[A-Z0-9_-]+$/.test(cleanCode)
    ) {
      setErrorMsg('Masukkan Kode Booking Anda yang valid (contoh: SH-260907-XXXXX)');
      return;
    }
    if (!canonicalPhone) {
      setErrorMsg('Masukkan minimal 8 digit Nomor WhatsApp valid yang Anda gunakan saat pemesanan.');
      return;
    }

    const sessionUidSnapshot = activeAuthUid;
    if (!isCurrentSessionMatching(sessionUidSnapshot)) {
      setErrorMsg('Sesi autentikasi sedang diperbarui. Silakan coba kembali.');
      return;
    }

    const myGen = ++requestGenRef.current;
    const controller = new AbortController();
    lookupAbortRef.current = controller;

    const isStillCurrent = () =>
      requestGenRef.current === myGen &&
      !controller.signal.aborted &&
      isCurrentSessionMatching(sessionUidSnapshot);

    setIsLoading(true);
    try {
      let backendErrorMessage = '';
      const result = await trackBookingByCodeAndPhone(cleanCode, phone.trim(), {
        signal: controller.signal,
        onError: (err) => {
          if (!sessionUidSnapshot) {
            if (err.status === 429 || err.status === 503 || err.status === 400) {
              backendErrorMessage = err.message;
            } else {
              backendErrorMessage =
                'Data reservasi tidak ditemukan. Pastikan Kode Booking dan Nomor WhatsApp sesuai.';
            }
          } else if (err.message) {
            backendErrorMessage = err.message;
          }
        },
      });

      if (!isStillCurrent()) return;

      if (!result) {
        setErrorMsg(
          backendErrorMessage ||
            'Data reservasi tidak ditemukan. Pastikan Kode Booking dan Nomor WhatsApp sesuai.'
        );
        return;
      }

      if (sessionUidSnapshot) {
        if (
          result.accessLevel !== 'owner' ||
          !doesBookingBelongToUid(result.booking, sessionUidSnapshot)
        ) {
          setErrorMsg(
            'Akses ke pesanan ini ditolak. Pastikan Anda menggunakan akun pemilik pesanan.'
          );
          return;
        }
        if (!isCustomerPreviewMode) {
          localStorage.setItem('senzu_last_booking_code', cleanCode);
        }
        setupRealtimeListeners(result.booking, result.history, 'owner', canonicalPhone, myGen);
      } else {
        if (result.accessLevel !== 'guest') {
          setErrorMsg(
            'Data reservasi tidak ditemukan. Pastikan Kode Booking dan Nomor WhatsApp sesuai.'
          );
          return;
        }
        setupRealtimeListeners(result.booking, result.history, 'guest', canonicalPhone, myGen);
      }
    } catch (err) {
      if (!isStillCurrent()) return;
      console.error('Tracking query error:', err);
      setErrorMsg('Gagal memuat status. Silakan periksa koneksi internet Anda dan coba kembali.');
    } finally {
      if (requestGenRef.current === myGen) {
        setIsLoading(false);
      }
    }
  };

  const isAuthorizedCustomerOwner = Boolean(
    trackingData &&
      activeAuthUid &&
      trackingData.accessLevel === 'owner' &&
      doesBookingBelongToUid(trackingData.booking, activeAuthUid)
  );

  const handleCopyBookingCode = () => {
    if (!trackingData?.booking.bookingCode) return;
    navigator.clipboard.writeText(trackingData.booking.bookingCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleShareTracking = () => {
    if (!trackingData?.booking.bookingCode) return;
    const text = `Lacak Reservasi Senzu Home saya: ${trackingData.booking.bookingCode} (${trackingData.booking.serviceName})`;
    if (navigator.share) {
      navigator.share({
        title: 'Lacak Reservasi Senzu Home',
        text,
        url: window.location.href,
      }).catch(() => {});
    } else {
      handleCopyBookingCode();
    }
  };

  const displayMeta = trackingData
    ? mapBookingStatusToDisplay(trackingData.booking.status)
    : null;

  // Concierge WhatsApp message and action
  const csMessage = trackingData
    ? `Halo Senzu Home, saya pelanggan dengan kode booking ${trackingData.booking.bookingCode} (${trackingData.booking.customerName}).`
    : `Halo Senzu Home, saya ingin menanyakan status reservasi saya.`;

  const conciergeWaUrl = getCsWhatsAppUrl(csMessage);

  const handleOpenConciergeWa = (e: React.MouseEvent) => {
    if (!isCsAvailable || !conciergeWaUrl) {
      e.preventDefault();
      alert(csUnavailableNotice);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-2xl sm:rounded-3xl shadow-2xl border-0 sm:border border-slate-200 overflow-hidden flex flex-col h-full sm:h-auto sm:max-h-[92vh] animate-fade-in">
        
        {/* Header: Senzu Deep Navy & Gold */}
        <div className="bg-gradient-to-r from-[#082A4F] via-[#0B3461] to-[#082A4F] text-white p-4 sm:p-5 flex items-center justify-between border-b border-[#D4AF37]/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center flex-shrink-0">
              <Navigation className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#D4AF37] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Senzu Live Tracking</span>
              </div>
              <h3 className="font-serif text-base sm:text-lg font-bold text-white leading-tight flex items-center gap-2">
                <span>Pelacakan Reservasi</span>
                {trackingData && (
                  <span className="font-mono text-xs text-[#FDF3CD] font-normal bg-white/10 px-2 py-0.5 rounded-md border border-white/15">
                    {trackingData.booking.bookingCode}
                  </span>
                )}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {trackingData && (
              <button
                type="button"
                onClick={handleShareTracking}
                title="Bagikan / Salin Kode"
                className="w-10 h-10 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center transition cursor-pointer"
                aria-label="Bagikan Kode"
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-11 h-11 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center transition cursor-pointer"
              aria-label="Tutup Tracking"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 pb-24 sm:pb-6">

          {/* Manual Search Form (Shown when no tracking data or user clicks 'Cari Reservasi Lain') */}
          {(showManualSearch || !trackingData) && (
            <div className="bg-[#FAF9F6] border border-slate-200 rounded-3xl p-5 space-y-4 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-[#082A4F]" />
                  <h4 className="text-xs sm:text-sm font-bold text-[#082A4F]">
                    Cari Status Reservasi Anda
                  </h4>
                </div>
                {trackingData && (
                  <button
                    type="button"
                    onClick={() => setShowManualSearch(false)}
                    className="text-xs text-slate-500 hover:text-slate-800 underline font-medium cursor-pointer"
                  >
                    Kembali ke Status Aktif
                  </button>
                )}
              </div>

              <form onSubmit={handleSearch} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Kode Booking:
                    </label>
                    <input
                      id="input-track-code"
                      type="text"
                      placeholder="Contoh: SH-260907-XXXXX"
                      value={bookingCode}
                      onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
                      required
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white font-medium shadow-2xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nomor WhatsApp Pemesan:
                    </label>
                    <input
                      id="input-track-phone"
                      type="tel"
                      placeholder="Contoh: 0812xxxxxxxx"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white font-medium shadow-2xs"
                    />
                  </div>
                </div>

                <button
                  id="btn-track-submit"
                  type="submit"
                  disabled={isLoading}
                  className="w-full min-h-[46px] py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0B3766] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {isLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Menghubungkan ke Sistem...</span>
                    </div>
                  ) : (
                    <>
                      <Search className="w-4 h-4 text-[#D4AF37]" />
                      <span>Lacak Status Reservasi</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Active Tracking Content View */}
          {trackingData && (
            <div className="space-y-5 animate-fade-in">
              
              {/* Top Hero Status Banner */}
              <div className="bg-gradient-to-br from-[#082A4F] via-[#0D3A6E] to-[#082A4F] text-white p-5 sm:p-6 rounded-3xl border border-[#D4AF37]/40 shadow-lg relative overflow-hidden">
                <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#D4AF37] font-extrabold uppercase tracking-wider bg-[#D4AF37]/15 px-2 py-0.5 rounded-md border border-[#D4AF37]/30">
                        {displayMeta?.label || trackingData.booking.status}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyBookingCode}
                        className="text-[11px] text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer transition"
                      >
                        <span className="font-mono font-bold text-[#FDF3CD]">
                          {trackingData.booking.bookingCode}
                        </span>
                        {isCopied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-slate-300" />
                        )}
                      </button>
                    </div>

                    <h4 className="text-lg sm:text-xl font-bold font-serif text-white mt-1.5">
                      {trackingData.booking.serviceName}
                    </h4>

                    <p className="text-xs text-slate-200 mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[#D4AF37] font-semibold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                        {trackingData.booking.serviceDuration} Menit
                      </span>
                      <span>•</span>
                      <span>{formatDateIndo(trackingData.booking.scheduleDate)}</span>
                      <span>•</span>
                      <span className="font-semibold text-white">
                        {trackingData.booking.scheduleTime} WIB
                      </span>
                    </p>

                    <p className="text-[11px] text-slate-300 mt-2 font-medium">
                      {displayMeta?.sublabel}
                    </p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 border-white/10 pt-3 sm:pt-0">
                    <span className="text-[10px] text-slate-300">Total Biaya:</span>
                    <span className="text-base sm:text-lg font-serif font-bold text-[#FDF3CD]">
                      {formatRupiah(trackingData.booking.totalAmount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowReceipt(!showReceipt)}
                      className="text-[11px] text-[#D4AF37] hover:underline font-semibold flex items-center gap-1 mt-1 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{showReceipt ? 'Tutup Rincian' : 'Lihat Rincian'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Receipt / Order Breakdown Collapsible */}
              {showReceipt && (
                <div className="bg-[#FAF9F6] border border-slate-200 rounded-3xl p-5 text-xs space-y-3 shadow-inner">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-[#082A4F] text-sm">
                      Ringkasan Reservasi & Pembayaran
                    </span>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1 text-[11px] font-semibold cursor-pointer shadow-2xs"
                    >
                      <Printer className="w-3 h-3" />
                      <span>Cetak</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1 text-slate-600">
                      <div><strong className="text-slate-900">Pelanggan:</strong> {trackingData.booking.customerName}</div>
                      <div><strong className="text-slate-900">WhatsApp:</strong> {trackingData.booking.customerWhatsApp}</div>
                      <div>
                        <strong className="text-slate-900">Alamat:</strong> {trackingData.booking.address}
                        {trackingData.booking.area &&
                        !String(trackingData.booking.address || '').includes(trackingData.booking.area)
                          ? ` (${trackingData.booking.area})`
                          : ''}
                      </div>
                      {isAuthorizedCustomerOwner && trackingData.booking.addressNotes && (
                        <div><strong className="text-slate-900">Patokan:</strong> {trackingData.booking.addressNotes}</div>
                      )}
                    </div>
                    <div className="space-y-1 text-slate-600">
                      <div><strong className="text-slate-900">Preferensi:</strong> {trackingData.booking.genderPreference}</div>
                      <div><strong className="text-slate-900">Metode Bayar:</strong> {trackingData.booking.paymentMethod}</div>
                      <div><strong className="text-slate-900">Status Pembayaran:</strong> <span className="font-bold text-[#082A4F]">{trackingData.booking.paymentStatus}</span></div>
                      <div><strong className="text-slate-900">Terapis Ditugaskan:</strong> {trackingData.booking.therapistName || 'Belum ditugaskan'}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Stepper Progress Bar (6 Milestones) */}
              {trackingData.booking.status !== 'Cancelled' && (
                <div className="bg-[#FAF9F6] border border-slate-200 rounded-3xl p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-[#082A4F] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                      Perjalanan Reservasi Anda
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">Real-time WIB</span>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {MILESTONE_STEPS.map((step, idx) => {
                      const currentIdx = displayMeta ? displayMeta.stageIndex : 0;
                      const isCompleted = idx < currentIdx;
                      const isCurrent = idx === currentIdx;

                      return (
                        <div
                          key={step.id}
                          className={`flex flex-col items-center text-center p-2 rounded-2xl transition ${
                            isCurrent
                              ? 'bg-[#082A4F] text-white shadow-md scale-[1.02]'
                              : isCompleted
                              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                              : 'bg-white text-slate-400 border border-slate-100'
                          }`}
                        >
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mb-1 ${
                              isCurrent
                                ? 'bg-[#D4AF37] text-[#082A4F]'
                                : isCompleted
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : idx + 1}
                          </div>
                          <span className={`text-[10px] leading-tight font-bold ${isCurrent ? 'text-[#FDF3CD]' : ''}`}>
                            {step.title}
                          </span>
                          <span className={`text-[9px] mt-0.5 leading-none ${isCurrent ? 'text-slate-200' : 'text-slate-400'}`}>
                            {step.desc}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PHASE 1: Menunggu Pembayaran & Menunggu Verifikasi */}
              {/* ------------------------------------------------------------- */}
              {(trackingData.booking.status === 'Menunggu Pembayaran' ||
                trackingData.booking.status === 'Pembayaran Terverifikasi') && (
                <div className="bg-amber-50/80 border border-amber-300 rounded-3xl p-5 space-y-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-[#082A4F]">
                        {trackingData.booking.status === 'Menunggu Pembayaran'
                          ? 'Menunggu Penyelesaian Pembayaran Non-Tunai'
                          : 'Pembayaran Telah Dikonfirmasi'}
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Senzu Home beroperasi dengan <strong>100% Non-Tunai (No Cash)</strong>. Pembayaran melalui QRIS Resmi Senzu atau Transfer Bank (BNI, Mandiri, BRI a.n PT KSBONE UNTUK KITA).
                      </p>
                    </div>
                  </div>

                  {isAuthorizedCustomerOwner &&
                  trackingData.booking.status === 'Menunggu Pembayaran' ? (
                    <div className="pt-2">
                      <PendingPaymentCard
                        booking={trackingData.booking}
                        variant="card"
                        onPaymentSuccess={() => {
                          // Realtime listener will automatically update trackingData
                        }}
                      />
                    </div>
                  ) : (
                    <div className="bg-white p-4 rounded-2xl border border-amber-200 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">Metode Terpilih:</span>
                        <span className="font-bold text-[#082A4F]">{trackingData.booking.paymentMethod}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">Total Pembayaran:</span>
                        <strong className="text-sm font-serif text-[#082A4F]">
                          {formatRupiah(trackingData.booking.totalAmount)}
                        </strong>
                      </div>
                    </div>
                  )}

                  {trackingData.booking.status === 'Pembayaran Terverifikasi' && (
                    <div className="p-3 bg-emerald-100/70 border border-emerald-300 rounded-2xl flex items-center gap-2 text-xs text-emerald-900 font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                      <span>Bukti bayar Anda telah diverifikasi! Supervisor kami sedang mengalokasikan terapis terbaik.</span>
                    </div>
                  )}
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PHASE 2: Confirmed & Therapist Assigned / Accepted */}
              {/* ------------------------------------------------------------- */}
              {(trackingData.booking.status === 'Confirmed' ||
                trackingData.booking.status === 'Therapist Assigned' ||
                trackingData.booking.status === 'Accepted') && (
                <div className="space-y-4">
                  {/* Assigned Therapist Card */}
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50/60 border border-amber-200 rounded-3xl p-5 shadow-xs">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-full bg-[#082A4F] text-[#D4AF37] font-serif font-bold text-xl flex items-center justify-center flex-shrink-0 ring-4 ring-[#D4AF37]/30 shadow-md">
                        {trackingData.booking.therapistName
                          ? trackingData.booking.therapistName.charAt(0)
                          : 'S'}
                      </div>
                      <div className="flex-1">
                        <div className="inline-flex items-center gap-1 text-[10px] text-emerald-800 font-extrabold uppercase tracking-wider bg-emerald-100 px-2 py-0.5 rounded-full">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Terapis Bersertifikasi Senzu</span>
                        </div>
                        <h4 className="text-base font-bold text-[#082A4F] mt-1">
                          {trackingData.booking.therapistName || 'Terapis Berlisensi Senzu Palembang'}
                        </h4>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Terapis telah lolos uji keahlian & etika layanan Senzu. Siap dengan perlengkapan steril & kain bersih.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600">
                        Preferensi Terapis: <strong className="text-slate-900">{trackingData.booking.genderPreference}</strong>
                      </span>
                      <div className="flex items-center gap-2">
                        {isAuthorizedCustomerOwner && (
                          <ChatButtonWithBadge
                            booking={trackingData.booking}
                            userRole="customer"
                            onOpenChat={() => setIsChatModalOpen(true)}
                            variant="button"
                            label="Chat Terapis"
                          />
                        )}
                        <a
                          href={conciergeWaUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={handleOpenConciergeWa}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#082A4F] text-white hover:bg-[#0E3D73] font-semibold text-[11px] transition shadow-2xs cursor-pointer"
                        >
                          <Phone className="w-3.5 h-3.5 text-[#D4AF37]" />
                          <span>Chat Konfirmasi Jadwal</span>
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Customer Home Preparation Checklist */}
                  <div className="bg-[#FAF9F6] border border-slate-200 rounded-3xl p-5 space-y-3">
                    <h5 className="text-xs font-bold text-[#082A4F] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                      Panduan Persiapan Nyaman di Rumah
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-700">
                      <div className="p-3 bg-white rounded-2xl border border-slate-100 flex items-start gap-2.5">
                        <span className="text-lg leading-none">🛋️</span>
                        <div>
                          <strong className="block text-slate-900">Area Bersih & Tenang</strong>
                          <span className="text-[11px] text-slate-500">Tempat tidur, matras empuk, atau sofa yang nyaman.</span>
                        </div>
                      </div>

                      <div className="p-3 bg-white rounded-2xl border border-slate-100 flex items-start gap-2.5">
                        <span className="text-lg leading-none">❄️</span>
                        <div>
                          <strong className="block text-slate-900">Suhu Ruangan Sejuk</strong>
                          <span className="text-[11px] text-slate-500">Atur AC atau kipas angin agar sirkulasi udara sejuk optimal.</span>
                        </div>
                      </div>

                      <div className="p-3 bg-white rounded-2xl border border-slate-100 flex items-start gap-2.5">
                        <span className="text-lg leading-none">🔌</span>
                        <div>
                          <strong className="block text-slate-900">Stopkontak Listrik</strong>
                          <span className="text-[11px] text-slate-500">Jika layanan memerlukan alat pemanas atau difuser aroma.</span>
                        </div>
                      </div>

                      <div className="p-3 bg-white rounded-2xl border border-slate-100 flex items-start gap-2.5">
                        <span className="text-lg leading-none">💧</span>
                        <div>
                          <strong className="block text-slate-900">Segelas Air Putih</strong>
                          <span className="text-[11px] text-slate-500">Minum air putih setelah pijat untuk melancarkan sirkulasi.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PHASE 3: On The Way (Live Map Tracking) */}
              {/* ------------------------------------------------------------- */}
              {trackingData.booking.status === 'On The Way' && (
                <div className="space-y-4">
                  {isAuthorizedCustomerOwner ? (
                    <CustomerLiveMap
                      booking={trackingData.booking}
                      settings={settings}
                      onNearbyChange={(near) => setIsNearby(near)}
                    />
                  ) : (
                    <div className="bg-[#FAF9F6] border border-slate-200 rounded-3xl p-4 text-xs text-slate-600 flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-[#082A4F] flex-shrink-0" />
                      <span>
                        Demi privasi lokasi pelanggan, peta GPS langsung hanya ditampilkan pada sesi akun pemilik pesanan. Status perjalanan terapis tetap diperbarui secara otomatis.
                      </span>
                    </div>
                  )}

                  {/* Therapist Driver Info Card */}
                  <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 flex items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-[#082A4F] text-[#D4AF37] font-bold text-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                        {trackingData.booking.therapistName ? trackingData.booking.therapistName.charAt(0) : 'T'}
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                          Terapis Dalam Perjalanan:
                        </div>
                        <div className="text-sm font-bold text-[#082A4F]">
                          {trackingData.booking.therapistName || 'Terapis Senzu'}
                        </div>
                        <div className="text-xs text-slate-500">
                          Membawa seragam resmi, ID Card & perlengkapan steril
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isAuthorizedCustomerOwner && (
                        <ChatButtonWithBadge
                          booking={trackingData.booking}
                          userRole="customer"
                          onOpenChat={() => setIsChatModalOpen(true)}
                          variant="button"
                          label="Chat Terapis"
                        />
                      )}
                      <a
                        href={conciergeWaUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={handleOpenConciergeWa}
                        className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Hubungi</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PHASE 4: Arrived (Telah Tiba) */}
              {/* ------------------------------------------------------------- */}
              {trackingData.booking.status === 'Arrived' && (
                <div className="bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50 border border-teal-300 rounded-3xl p-6 space-y-4 text-center shadow-md">
                  <div className="w-14 h-14 rounded-full bg-teal-600 text-white mx-auto flex items-center justify-center shadow-lg animate-bounce">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>

                  <div>
                    <h4 className="text-base sm:text-lg font-bold text-[#082A4F]">
                      Terapis Telah Sampai di Lokasi Anda!
                    </h4>
                    <p className="text-xs sm:text-sm text-teal-900 mt-1 max-w-md mx-auto">
                      Terapis Senzu telah tiba di alamat tujuan. Silakan sambut terapis di pintu masuk atau lobi rumah/apartemen Anda.
                    </p>
                  </div>

                  <div className="bg-white/80 backdrop-blur-xs p-4 rounded-2xl border border-teal-200 text-xs text-slate-700 space-y-2 max-w-md mx-auto text-left">
                    <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Ciri-ciri Terapis Resmi Senzu:</span>
                    </div>
                    <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-600">
                      <li>Mengenakan seragam polo / kemeja resmi Senzu Home</li>
                      <li>Membawa tas perlengkapan & ID Card bertuliskan Senzu</li>
                      <li>Menjalankan protokol kebersihan sebelum memulai treatment</li>
                    </ul>
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 pt-1">
                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                    <span>Live GPS otomatis dinonaktifkan demi privasi pelanggan & efisiensi baterai terapis.</span>
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PHASE 5: Treatment (Sesi Berlangsung) */}
              {/* ------------------------------------------------------------- */}
              {trackingData.booking.status === 'Treatment' && (
                <div className="bg-gradient-to-br from-[#082A4F] via-[#0E3D73] to-[#082A4F] text-white rounded-3xl p-6 space-y-5 shadow-xl border border-[#D4AF37]/50 relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-purple-400 animate-ping"></span>
                      <span className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                        Sesi Aktif Berlangsung
                      </span>
                    </div>
                    <span className="text-xs bg-white/10 px-2.5 py-1 rounded-full text-slate-300 font-medium">
                      Dimulai pk {treatmentMetrics?.startTimeFormatted || 'WIB'}
                    </span>
                  </div>

                  <div className="text-center py-2 space-y-2">
                    <span className="text-xs text-slate-300 block uppercase tracking-widest font-semibold">
                      Waktu Treatment Berjalan
                    </span>
                    <div className="font-mono text-4xl sm:text-5xl font-extrabold text-[#FDF3CD] tracking-tight">
                      {treatmentMetrics?.elapsedFormatted || '00:00'}
                    </div>
                    <p className="text-xs text-slate-300">
                      Target Durasi: <strong className="text-white">{treatmentMetrics?.totalMin} Menit</strong> ({treatmentMetrics?.remainingMin} Menit Tersisa)
                    </p>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1.5">
                    <div className="w-full bg-white/20 h-2.5 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-[#D4AF37] to-amber-300 h-full rounded-full transition-all duration-1000"
                        style={{ width: `${treatmentMetrics?.progressPct || 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-300">
                      <span>Mulai</span>
                      <span>{treatmentMetrics?.progressPct}% Selesai</span>
                      <span>Selesai</span>
                    </div>
                  </div>

                  {/* Ambient Care Notice */}
                  <div className="bg-white/10 rounded-2xl p-3.5 border border-white/15 text-xs space-y-1 text-slate-200">
                    <div className="font-bold text-[#FDF3CD] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                      Kenyamanan Maksimal Anda Adalah Prioritas Kami
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Mohon sampaikan kepada terapis bila tekanan pijatan ingin disesuaikan (kurang/lebih keras) atau ada area otot tertentu yang perlu fokus ekstra.
                    </p>
                  </div>

                  <div className="flex justify-center pt-1">
                    <a
                      href={conciergeWaUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={handleOpenConciergeWa}
                      className="text-xs text-slate-300 hover:text-white underline flex items-center gap-1 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Butuh bantuan darurat / Concierge Senzu?</span>
                    </a>
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PHASE 6: Completed (Selesai - Rating & Repeat Order) */}
              {/* ------------------------------------------------------------- */}
              {trackingData.booking.status === 'Completed' && (
                <div className="bg-gradient-to-r from-amber-50 via-orange-50/50 to-amber-50 p-5 rounded-3xl border border-amber-300/80 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-[#B89628]" />
                      <h4 className="font-bold text-sm text-[#082A4F]">
                        Sesi Treatment Telah Selesai
                      </h4>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full border border-emerald-300">
                      Layanan Tuntas
                    </span>
                  </div>

                  <p className="text-xs text-slate-600">
                    Terima kasih telah mempercayakan waktu relaksasi Anda bersama Senzu Home. Semoga tubuh Anda kembali bugar dan segar!
                  </p>

                  {isAuthorizedCustomerOwner && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                      {/* Repeat Order Button */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onRepeatBooking) {
                            onRepeatBooking(trackingData.booking);
                            onClose();
                          }
                        }}
                        className="flex-1 px-4 py-3 min-h-[44px] rounded-2xl bg-[#082A4F] hover:bg-[#0C3866] text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-95"
                      >
                        <Repeat className="w-4 h-4 text-[#D4AF37]" />
                        <span>Pesan Ulang (Repeat Order)</span>
                      </button>

                      {/* Review Rating Button */}
                      {existingReview ? (
                        <div className="px-4 py-3 rounded-2xl bg-white border border-amber-200 text-xs font-bold text-amber-900 flex items-center justify-center gap-1.5 shadow-2xs">
                          <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                          <span>Rating Anda: {existingReview.overallRating}.0★</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsReviewModalOpen(true)}
                          className="px-4 py-3 min-h-[44px] rounded-2xl bg-gradient-to-r from-[#D4AF37] to-[#B89628] hover:from-[#E5C158] hover:to-[#C9A432] text-[#082A4F] text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer active:scale-95"
                        >
                          <Star className="w-4 h-4 fill-[#082A4F] text-[#082A4F]" />
                          <span>Beri Ulasan Terapis (1-5★)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Booking Status Audit Trail / History */}
              <div className="bg-[#FAF9F6] border border-slate-200 rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#082A4F]" />
                    Riwayat Perubahan Status (WIB)
                  </h5>
                  <button
                    type="button"
                    onClick={() => setShowManualSearch(true)}
                    className="text-[11px] text-[#082A4F] hover:underline font-semibold cursor-pointer"
                  >
                    Lacak Booking Lain
                  </button>
                </div>

                <div className="border-l-2 border-[#082A4F]/20 ml-2 pl-4 space-y-4 pt-1">
                  {(!trackingData.history || trackingData.history.length === 0) ? (
                    <p className="text-xs text-slate-400">Belum ada catatan riwayat status.</p>
                  ) : (
                    (trackingData.history || []).map((hist) => (
                      <div key={hist.id} className="relative">
                        <div className="absolute -left-[23px] top-1 w-3 h-3 rounded-full bg-[#082A4F] border-2 border-white ring-2 ring-[#082A4F]/20" />
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#082A4F]">{hist.status}</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {hist.formattedWIB}
                          </span>
                        </div>
                        {hist.note && (
                          <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                            {hist.note}
                          </p>
                        )}
                        <span className="text-[10px] text-slate-400">
                          Petugas: {hist.updatedByName} ({hist.updatedByRole})
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#FAF9F6] border-t border-slate-200 flex items-center justify-between flex-shrink-0 pb-safe">
          <a
            href={conciergeWaUrl}
            target="_blank"
            rel="noreferrer"
            onClick={handleOpenConciergeWa}
            className="text-xs text-[#082A4F] font-semibold hover:underline flex items-center gap-1.5 cursor-pointer"
          >
            <Phone className="w-3.5 h-3.5 text-emerald-600" />
            <span>Customer Care Senzu</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 min-h-[44px] rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition active:scale-95 cursor-pointer shadow-2xs"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Customer Review Modal */}
      {isAuthorizedCustomerOwner && isReviewModalOpen && trackingData?.booking && (
        <CustomerReviewModal
          isOpen={true}
          onClose={() => setIsReviewModalOpen(false)}
          booking={trackingData.booking}
          existingReview={existingReview}
          onReviewSubmitted={(newRev) => {
            setExistingReview(newRev);
            setIsReviewModalOpen(false);
          }}
        />
      )}

      {/* Realtime Booking Chat Modal */}
      {isAuthorizedCustomerOwner && isChatModalOpen && trackingData?.booking && activeAuthUid && (
        <BookingChatModal
          isOpen={true}
          onClose={() => setIsChatModalOpen(false)}
          booking={trackingData.booking}
          currentUserRole="customer"
          currentAuthUid={activeAuthUid}
          currentDisplayName={trackingData.booking.customerName || 'Customer'}
        />
      )}
    </div>
  );
};
