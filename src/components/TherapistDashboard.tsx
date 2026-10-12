import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Clock,
  Phone,
  MapPin,
  Calendar,
  CheckCircle2,
  Navigation,
  Check,
  User,
  ShieldCheck,
  ExternalLink,
  MessageCircle,
  Radio,
  AlertTriangle,
  X,
  Compass,
  Flame,
  Coffee,
  Power,
  LogOut,
  ChevronRight,
  Briefcase,
  History,
  AlertCircle,
  HelpCircle,
  Share2,
  Loader2,
  FileText,
} from 'lucide-react';
import { Booking, BookingStatus, Therapist, TherapistRoster } from '../types';
import {
  therapistUpdateStatus,
  therapistAcceptOrderAtomic,
  saveTherapistLocation,
  stopTherapistTracking,
  calculateDistanceMeters,
  updateTherapistStatus
} from '../lib/dbService';
import { getTherapistRoster, setTherapistRosterStatus, deriveOperationalShiftStatus } from '../lib/rosterService';
import { useAuth } from '../context/AuthContext';
import { formatDateTimeWIB, maskCustomerName } from '../lib/utils';
import { RoleAlertBanners } from './RoleAlertBanners';
import { TherapistTreatmentTimer } from './TherapistTreatmentTimer';
import { TherapistIssueModal } from './TherapistIssueModal';
import { TherapistJobDetailDrawer } from './TherapistJobDetailDrawer';
import { ChatButtonWithBadge } from './chat/ChatButtonWithBadge';
import { BookingChatModal } from './chat/BookingChatModal';
import { auth } from '../lib/firebase';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';
import { PWAInstallActionItem } from './PWAInstallBanner';

interface TherapistDashboardProps {
  bookings: Booking[];
  therapists: Therapist[];
  onRefresh?: () => void;
  initialBookingId?: string;
}

export const TherapistDashboard: React.FC<TherapistDashboardProps> = ({
  bookings = [],
  therapists = [],
  onRefresh,
  initialBookingId,
}) => {
  const { currentUser, logout } = useAuth();
  const [mobileTab, setMobileTab] = useState<'beranda' | 'pekerjaan' | 'riwayat' | 'akun'>('beranda');
  const [jobsSubFilter, setJobsSubFilter] = useState<'all' | 'assigned' | 'in_progress'>('all');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [localStatusOverrides, setLocalStatusOverrides] = useState<Record<string, { status: BookingStatus; updatedAt: string }>>({});
  const [actionAlert, setActionAlert] = useState('');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Active Job Detail Drawer & Selection
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(initialBookingId || null);
  const [drawerBooking, setDrawerBooking] = useState<Booking | null>(null);
  const [isOpeningTask, setIsOpeningTask] = useState(false);
  const [highlightedBookingId, setHighlightedBookingId] = useState<string | null>(null);

  // Modals state
  const [chatBooking, setChatBooking] = useState<Booking | null>(null);
  const [issueBooking, setIssueBooking] = useState<Booking | null>(null);
  const [confirmStartTreatmentBooking, setConfirmStartTreatmentBooking] = useState<Booking | null>(null);
  const [arrivalValidationModal, setArrivalValidationModal] = useState<{
    booking: Booking;
    distanceMeters: number;
    currentLat: number;
    currentLng: number;
  } | null>(null);

  // Live tracking state
  const [liveLocation, setLiveLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    lastSentTime: string;
  } | null>(null);

  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [todayRoster, setTodayRoster] = useState<TherapistRoster | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Centralized Official Senzu Customer Service / Supervisor WhatsApp
  const {
    isAvailable: isCsAvailable,
    getWhatsAppUrl: getCsWhatsAppUrl,
    unavailableNotice: csUnavailableNotice,
  } = useCustomerServiceWhatsApp();

  // Online / Offline listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Determine therapist identity from currentUser (AuthContext) and canonical master data
  const therapistInfo = useMemo(() => {
    if (!currentUser) return undefined;
    return therapists.find(
      (t) =>
        (currentUser.therapistId && t.id === currentUser.therapistId) ||
        (currentUser.therapistId && t.staffId === currentUser.therapistId) ||
        t.id === currentUser.uid ||
        t.staffId === currentUser.uid ||
        t.id === (currentUser as any)?.id ||
        (t.employeeCode && currentUser.employeeCode && t.employeeCode === currentUser.employeeCode) ||
        (currentUser.name && t.name && t.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase())
    );
  }, [currentUser, therapists]);

  const currentTherapistId = useMemo(() => {
    return currentUser?.therapistId || therapistInfo?.id || therapistInfo?.staffId || currentUser?.uid;
  }, [currentUser, therapistInfo]);

  // Helper to check if a booking belongs to current authenticated therapist
  const isBookingOwnedByCurrentTherapist = useCallback(
    (b: Booking | null | undefined): boolean => {
      if (!b || !currentUser) return false;
      if (currentTherapistId && b.therapistId === currentTherapistId) return true;
      if (therapistInfo?.id && b.therapistId === therapistInfo.id) return true;
      if (therapistInfo?.staffId && b.therapistId === therapistInfo.staffId) return true;
      if (currentUser.uid && b.therapistId === currentUser.uid) return true;
      if (currentUser.therapistId && b.therapistId === currentUser.therapistId) return true;
      if ((currentUser as any)?.id && b.therapistId === (currentUser as any)?.id) return true;
      if ((currentUser as any)?.staffId && b.therapistId === (currentUser as any)?.staffId) return true;
      if (
        therapistInfo?.employeeCode &&
        currentUser.employeeCode &&
        therapistInfo.employeeCode === currentUser.employeeCode &&
        b.therapistId === therapistInfo.id
      ) {
        return true;
      }
      if (
        therapistInfo?.name &&
        b.therapistName &&
        therapistInfo.name.trim().toLowerCase() === b.therapistName.trim().toLowerCase()
      ) {
        return true;
      }
      if (
        currentUser.name &&
        b.therapistName &&
        currentUser.name.trim().toLowerCase() === b.therapistName.trim().toLowerCase()
      ) {
        return true;
      }
      if (
        currentUser.displayName &&
        b.therapistName &&
        currentUser.displayName.trim().toLowerCase() === b.therapistName.trim().toLowerCase()
      ) {
        return true;
      }
      return false;
    },
    [currentUser, currentTherapistId, therapistInfo]
  );

  const isAssignedStatus = useCallback((status: string) => {
    const s = (status || '').trim().toLowerCase();
    return s === 'therapist assigned' || s === 'assigned' || s === 'therapist_assigned';
  }, []);

  // Load today's operational roster for therapist
  useEffect(() => {
    if (!currentTherapistId) return;
    const todayStr = new Date().toISOString().split('T')[0];
    getTherapistRoster(currentTherapistId, todayStr)
      .then((r) => {
        if (r) setTodayRoster(r);
      })
      .catch((err) => console.warn('Load today roster notice:', err));
  }, [currentTherapistId]);

  // Therapist strictly and only sees bookings assigned to their specific identity
  const myBookings = useMemo(() => {
    if (!currentUser) return [];
    return bookings
      .filter((b) => isBookingOwnedByCurrentTherapist(b))
      .map((b) => {
        const override = localStatusOverrides[b.id];
        if (override && override.status) {
          return { ...b, status: override.status };
        }
        return b;
      });
  }, [bookings, currentUser, isBookingOwnedByCurrentTherapist, localStatusOverrides]);

  // Active orders (in progress or assigned)
  const activeOrders = useMemo(() => {
    return myBookings.filter((b) => {
      const s = (b.status || '').toLowerCase();
      return s !== 'completed' && s !== 'cancelled' && s !== 'selesai' && s !== 'batal';
    });
  }, [myBookings]);

  // Completed orders
  const completedOrders = useMemo(() => {
    return myBookings.filter((b) => {
      const s = (b.status || '').toLowerCase();
      return s === 'completed' || s === 'selesai';
    });
  }, [myBookings]);

  // Priority Current Job: first job that is actively in progress or needs acceptance
  // Preference: Treatment > Arrived > On The Way > Accepted > Assigned
  const currentJob = useMemo(() => {
    if (selectedBookingId) {
      const explicit = activeOrders.find(
        (b) => b.id === selectedBookingId || b.bookingCode === selectedBookingId
      );
      if (explicit) return explicit;
    }

    const orderPriority = [
      'Treatment',
      'Arrived',
      'On The Way',
      'Accepted',
      'Therapist Assigned',
      'Assigned',
    ];
    for (const st of orderPriority) {
      const found = activeOrders.find(
        (b) => b.status === st || (st === 'Assigned' && isAssignedStatus(b.status))
      );
      if (found) return found;
    }
    return activeOrders[0] || null;
  }, [activeOrders, selectedBookingId, isAssignedStatus]);

  // Open task detail directly (works from Beranda alert, Pekerjaan card, or notification)
  const handleOpenBookingDetail = useCallback(
    (booking: Booking) => {
      if (!isBookingOwnedByCurrentTherapist(booking)) {
        setActionAlert('Akses Ditolak: Tugas ini tidak ditugaskan kepada akun Anda.');
        return;
      }
      setSelectedBookingId(booking.id);
      setDrawerBooking(booking);
      setHighlightedBookingId(booking.id);
      setTimeout(() => setHighlightedBookingId(null), 3000);
    },
    [isBookingOwnedByCurrentTherapist]
  );

  // Live synchronization of drawerBooking with live Firestore bookings
  useEffect(() => {
    if (!drawerBooking) return;
    const live = bookings.find((b) => b.id === drawerBooking.id);
    if (live) {
      if (!isBookingOwnedByCurrentTherapist(live)) {
        setDrawerBooking(null);
        setActionAlert('Tugas ini telah diperbarui oleh Supervisor.');
        return;
      }
      if (live.status !== drawerBooking.status || live.updatedAt !== drawerBooking.updatedAt) {
        setDrawerBooking(live);
      }
    }
  }, [bookings, drawerBooking, isBookingOwnedByCurrentTherapist]);

  // Auto-focus and open initialBookingId if provided
  useEffect(() => {
    if (initialBookingId) {
      const matched = bookings.find(
        (b) => b.id === initialBookingId || b.bookingCode === initialBookingId
      );
      if (matched && isBookingOwnedByCurrentTherapist(matched)) {
        setSelectedBookingId(matched.id);
        setDrawerBooking(matched);
      }
    }
  }, [initialBookingId, bookings, isBookingOwnedByCurrentTherapist]);

  // Action click handler for "Buka Tugas" button in RoleAlertBanners
  const handleBukaTugas = useCallback(() => {
    setIsOpeningTask(true);

    const pendingAssigned = activeOrders.filter((b) => isAssignedStatus(b.status));

    if (pendingAssigned.length === 0) {
      if (activeOrders.length > 0) {
        const target = currentJob || activeOrders[0];
        handleOpenBookingDetail(target);
        setMobileTab('beranda');
        setTimeout(() => {
          const el = document.getElementById('current-job-card');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      } else {
        setActionAlert('Tidak ada tugas baru yang perlu dikonfirmasi saat ini.');
        onRefresh?.();
      }
      setIsOpeningTask(false);
      return;
    }

    // Exactly 1 new/active assigned task: open that task detail directly
    if (pendingAssigned.length === 1) {
      const target = pendingAssigned[0];
      handleOpenBookingDetail(target);
      setMobileTab('beranda');
      setActionAlert(`Membuka tugas ${target.bookingCode}...`);
      setTimeout(() => {
        const el = document.getElementById('current-job-card');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    } else {
      // Multiple assigned tasks: open Pekerjaan with assigned sub-filter
      setJobsSubFilter('assigned');
      setMobileTab('pekerjaan');
      setActionAlert(`Terdapat ${pendingAssigned.length} tugas baru. Silakan pilih tugas.`);
    }

    setIsOpeningTask(false);
  }, [activeOrders, currentJob, handleOpenBookingDetail, isAssignedStatus, onRefresh]);

  // Operational Shift Status derived dynamically from roster and active bookings
  const operationalShiftStatus = useMemo(() => {
    if (!therapistInfo) return null;
    return deriveOperationalShiftStatus(therapistInfo, todayRoster, currentJob);
  }, [therapistInfo, todayRoster, currentJob]);

  // Upcoming jobs: active bookings after currentJob
  const upcomingJobs = useMemo(() => {
    if (!currentJob) return [];
    return activeOrders.filter((b) => b.id !== currentJob.id);
  }, [activeOrders, currentJob]);

  // Active ongoing job check for logout confirmation warning (Requirement 15: ASSIGNED, ON_THE_WAY, ARRIVED, TREATMENT)
  const activeOngoingJob = useMemo(() => {
    return myBookings.find((b) =>
      ['Therapist Assigned', 'Accepted', 'On The Way', 'Arrived', 'Treatment'].includes(b.status) ||
      isAssignedStatus(b.status)
    );
  }, [myBookings, isAssignedStatus]);

  // Safe therapist logout flow (Requirements 2, 3, 4, 7, 8, 14, 25, 26, 27, 34)
  const handleConfirmLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      // 1. Safe GPS & tracking cleanup: detach active browser geolocation watch and release wakeLock (Requirement 14 & 34)
      try {
        if (typeof window !== 'undefined') {
          const win = window as any;
          if (win.__senzuTherapistWatchId !== undefined && navigator.geolocation) {
            try {
              navigator.geolocation.clearWatch(win.__senzuTherapistWatchId);
            } catch (e) {
              console.warn('GPS clearWatch notice:', e);
            }
            delete win.__senzuTherapistWatchId;
          }
          if (win.__senzuTherapistIntervalId !== undefined) {
            clearInterval(win.__senzuTherapistIntervalId);
            delete win.__senzuTherapistIntervalId;
          }
        }
        stopTherapistTracking(currentJob?.id || '');
        releaseWakeLock();
      } catch (cleanupErr) {
        console.warn('Non-blocking cleanup notice during logout:', cleanupErr);
      }

      // 2. Real async Firebase signOut and session state clear using shared Auth instance (Requirements 2, 3, 4, 7)
      await logout();

      // 3. Close modal on success
      setIsLogoutModalOpen(false);
    } catch (err: any) {
      console.error('Therapist logout error:', err);
      // Requirement 25 & 26: User-friendly error without raw Firebase error code; keep session intact
      setLogoutError('Gagal keluar dari akun. Silakan coba lagi.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Wake lock management during On The Way
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        if (typeof window !== 'undefined') {
          (window as any).__senzuWakeLock = wakeLockRef.current;
        }
      } catch {
        // Safe fallback if unsupported or rejected
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch {
        // Safe fallback
      }
    }
    if (typeof window !== 'undefined') {
      delete (window as any).__senzuWakeLock;
    }
  };

  // Realtime therapist GPS tracking hook when an order is "On The Way"
  useEffect(() => {
    if (!currentJob || currentJob.status !== 'On The Way' || !navigator.geolocation) {
      releaseWakeLock();
      return;
    }

    requestWakeLock();
    const bookingId = currentJob.id;
    const bookingCode = currentJob.bookingCode;
    const therapistName = therapistInfo?.name || currentUser?.name || 'Terapis Senzu';

    let lastLat = 0;
    let lastLng = 0;
    let lastSentMillis = 0;

    const sendCurrentPosition = (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy, heading, speed } = pos.coords;

      // Filter out invalid/bad GPS points (0,0 or undefined)
      if (!latitude || !longitude || (latitude === 0 && longitude === 0)) {
        return;
      }

      const now = Date.now();
      // Update local visual state immediately for responsiveness
      const nowStr = new Date().toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      setLiveLocation({
        lat: latitude,
        lng: longitude,
        accuracy: Math.round(accuracy),
        lastSentTime: nowStr,
      });

      // Throttle Firestore writes: Require at least 40 seconds between writes,
      // or at least 25 seconds if significant movement (> 50m) occurred
      const distanceMoved = lastLat && lastLng ? calculateDistanceMeters(lastLat, lastLng, latitude, longitude) : 999;
      const minInterval = distanceMoved > 50 ? 25000 : 45000;
      if (now - lastSentMillis < minInterval) {
        return;
      }

      lastLat = latitude;
      lastLng = longitude;
      lastSentMillis = now;

      saveTherapistLocation({
        therapistId: currentTherapistId || 'th-active',
        therapistName,
        bookingId,
        bookingCode,
        latitude,
        longitude,
        accuracy: Math.round(accuracy),
        heading: heading ?? null,
        speed: speed ?? null,
        timestamp: new Date().toISOString(),
        updatedAtMillis: Date.now(),
        isTrackingActive: true,
      });
    };

    const watchId = navigator.geolocation.watchPosition(
      sendCurrentPosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLocationPermissionDenied(true);
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
    );

    const intervalId = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        sendCurrentPosition,
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
      );
    }, 60000);

    if (typeof window !== 'undefined') {
      (window as any).__senzuTherapistWatchId = watchId;
      (window as any).__senzuTherapistIntervalId = intervalId;
    }

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        delete (window as any).__senzuTherapistWatchId;
        delete (window as any).__senzuTherapistIntervalId;
      }
      releaseWakeLock();
    };
  }, [currentJob, currentTherapistId, therapistInfo, currentUser]);

  // Handle next status transition
  const handleNextStatus = async (
    booking: Booking,
    nextStatus: BookingStatus,
    bypassDistanceCheck = false
  ) => {
    // Idempotency check: Wrong therapist protection
    if (!isBookingOwnedByCurrentTherapist(booking)) {
      alert('Anda tidak memiliki otorisasi untuk mengubah pesanan yang ditugaskan ke terapis lain.');
      return;
    }

    // High-Performance Atomic Order Acceptance (Prompt 19 & 19A)
    if (nextStatus === 'Accepted') {
      // PART 10: Double click & rapid tap protection
      if (updatingId === booking.id) {
        return;
      }

      // PART 27: Offline acceptance check
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        alert('Koneksi diperlukan untuk menerima pesanan.');
        return;
      }

      // PART 15: Immediate Button Feedback (<100ms)
      setUpdatingId(booking.id);

      // Presentation-only optimistic UI update
      const optimisticTimestamp = new Date().toISOString();
      setLocalStatusOverrides((prev) => ({
        ...prev,
        [booking.id]: { status: 'Accepted', updatedAt: optimisticTimestamp },
      }));
      setDrawerBooking((prev) => (prev && prev.id === booking.id ? { ...prev, status: 'Accepted' } : prev));

      // PART 29: Optional haptic feedback on mobile
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(50); } catch {}
      }

      try {
        const result = await therapistAcceptOrderAtomic(
          booking.id,
          currentTherapistId || 'th-active',
          therapistInfo?.name || currentUser?.name || 'Terapis Senzu'
        );

        if (result.success && result.booking) {
          // PART 7 (Step 13): Client commits accepted state
          setLocalStatusOverrides((prev) => ({
            ...prev,
            [booking.id]: { status: 'Accepted', updatedAt: result.booking.updatedAt || optimisticTimestamp },
          }));
          setDrawerBooking((prev) => (prev && prev.id === booking.id ? { ...prev, status: 'Accepted' } : prev));

          setActionAlert(`Pesanan ${booking.bookingCode} berhasil diterima. Siap memulai perjalanan.`);
          setTimeout(() => setActionAlert(''), 4000);
        }
      } catch (err: any) {
        console.error('Failed to accept order:', err);

        // PART 7 (Step 14): If backend fails, optimistic state MUST rollback immediately!
        setLocalStatusOverrides((prev) => {
          const next = { ...prev };
          delete next[booking.id];
          return next;
        });
        setDrawerBooking((prev) => (prev && prev.id === booking.id ? { ...prev, status: booking.status } : prev));

        // PART 26: Friendly error messages
        const code = err?.code || err?.message || '';
        let message = 'Pesanan belum dapat diterima. Silakan coba kembali.';

        if (code === 'OFFLINE_CONNECTION_REQUIRED' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          message = 'Koneksi diperlukan untuk menerima pesanan.';
        } else if (code === 'REASSIGNED_TO_OTHER' || code.includes('dialihkan')) {
          message = 'Pesanan sudah dialihkan ke terapis lain.';
        } else if (code === 'ALREADY_CANCELLED' || code.includes('dibatalkan')) {
          message = 'Pesanan telah dibatalkan.';
        } else if (code === 'ALREADY_ACCEPTED' || code.includes('sudah diterima')) {
          message = 'Pesanan ini sudah diterima.';
        } else if (code === 'ACCOUNT_DISABLED' || code === 'AUTH_REQUIRED' || code.includes('Akses') || code.includes('permission')) {
          message = 'Akses untuk menerima pesanan ini tidak tersedia.';
        } else if (code === 'CONNECTION_ERROR' || code.includes('Koneksi terputus') || code.includes('Failed to fetch') || code.includes('NetworkError')) {
          message = 'Koneksi terputus. Silakan coba kembali.';
        } else if (err?.message && !err.message.includes('object') && !err.message.includes('Error:')) {
          message = err.message;
        }

        alert(message);
      } finally {
        setUpdatingId(null);
      }
      return;
    }

    // GPS Permission Pre-check before starting 'On The Way'
    if (nextStatus === 'On The Way') {
      if (!navigator.geolocation) {
        alert('Perangkat Anda tidak mendukung fitur GPS Geolocation. Mohon hubungi Supervisor.');
        return;
      }
      setUpdatingId(booking.id);
      try {
        const initialPos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });
        setLocationPermissionDenied(false);
        const { latitude, longitude, accuracy } = initialPos.coords;
        await saveTherapistLocation({
          therapistId: currentTherapistId || 'th-active',
          therapistName: therapistInfo?.name || currentUser?.name || 'Terapis Senzu',
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          latitude,
          longitude,
          accuracy: Math.round(accuracy),
          timestamp: new Date().toISOString(),
          updatedAtMillis: Date.now(),
          isTrackingActive: true,
        });
      } catch (err: any) {
        setUpdatingId(null);
        setLocationPermissionDenied(true);
        alert(
          'Izin lokasi diperlukan agar customer dapat memantau kedatangan Anda. Mohon aktifkan GPS perangkat Anda dan izinkan akses lokasi di browser.'
        );
        return;
      }
    }

    // Arrival Validation Check (Distance check: max 300 meters)
    if (
      nextStatus === 'Arrived' &&
      !bypassDistanceCheck &&
      booking.latitude != null &&
      booking.longitude != null
    ) {
      setUpdatingId(booking.id);
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Geolocation tidak tersedia'));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          });
        });

        const currentLat = position.coords.latitude;
        const currentLng = position.coords.longitude;
        const distanceMeters = calculateDistanceMeters(
          currentLat,
          currentLng,
          booking.latitude,
          booking.longitude
        );

        if (distanceMeters > 300) {
          setUpdatingId(null);
          setArrivalValidationModal({
            booking,
            distanceMeters,
            currentLat,
            currentLng,
          });
          return;
        }
      } catch (err: any) {
        console.warn('Arrival GPS check notice:', err);
        setUpdatingId(null);
        setArrivalValidationModal({
          booking,
          distanceMeters: 999,
          currentLat: booking.latitude,
          currentLng: booking.longitude,
        });
        return;
      }
    }

    setUpdatingId(booking.id);
    try {
      await therapistUpdateStatus(
        booking,
        nextStatus,
        therapistInfo?.name || currentUser?.name || 'Terapis Senzu'
      );

      setLocalStatusOverrides((prev) => ({
        ...prev,
        [booking.id]: { status: nextStatus, updatedAt: new Date().toISOString() },
      }));

      setDrawerBooking((prev) => (prev && prev.id === booking.id ? { ...prev, status: nextStatus } : prev));

      // Stop tracking if arrived or completed
      if (['Arrived', 'Completed', 'Cancelled'].includes(nextStatus)) {
        await stopTherapistTracking(booking.id);
        releaseWakeLock();
      }

      setActionAlert(`Status ${booking.bookingCode} berhasil diperbarui ke: ${nextStatus}`);
      setTimeout(() => setActionAlert(''), 4000);
    } catch (err) {
      console.error('Failed to update therapist status:', err);
      alert('Perubahan status belum tersimpan karena kendala jaringan. Mohon coba lagi.');
    } finally {
      setUpdatingId(null);
    }
  };

  // Availability control
  const handleAvailabilityChange = async (newStatus: 'available' | 'break' | 'off') => {
    if (!currentTherapistId) return;
    try {
      await updateTherapistStatus(currentTherapistId, newStatus);

      // Sync with today's roster
      const todayStr = new Date().toISOString().split('T')[0];
      const rosterStatus = newStatus === 'available' ? 'scheduled' : newStatus === 'break' ? 'break' : 'off';
      const therapistDisplayName = therapistInfo?.name || currentUser?.name || 'Terapis';
      const unavailableReason = newStatus === 'break' ? 'Istirahat Mandiri' : newStatus === 'off' ? 'Selesai Shift' : '';
      const statusNote =
        newStatus === 'break'
          ? 'Terapis sedang istirahat mandiri'
          : newStatus === 'off'
          ? 'Terapis selesai shift'
          : 'Terapis aktif dan siap menerima booking';

      await setTherapistRosterStatus(
        currentTherapistId,
        therapistDisplayName,
        todayStr,
        rosterStatus,
        unavailableReason,
        statusNote,
        therapistDisplayName
      );

      // Refresh today's roster state
      const updatedR = await getTherapistRoster(currentTherapistId, todayStr);
      if (updatedR) setTodayRoster(updatedR);

      setActionAlert(`Status ketersediaan Anda diubah ke: ${newStatus === 'available' ? 'Tersedia' : newStatus === 'break' ? 'Istirahat' : 'Offline'}`);
      setTimeout(() => setActionAlert(''), 3500);
    } catch (err) {
      console.error('Failed to update availability:', err);
    }
  };

  // Render navigation links (Google Maps primary, Apple Maps, Waze)
  const getMapsUrl = (b: Booking) => {
    if (b.latitude != null && b.longitude != null) {
      return `https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      b.address + ', ' + b.area + ', Palembang'
    )}`;
  };

  const getWazeUrl = (b: Booking) => {
    if (b.latitude != null && b.longitude != null) {
      return `https://waze.com/ul?ll=${b.latitude},${b.longitude}&navigate=yes`;
    }
    return null;
  };

  const getAppleMapsUrl = (b: Booking) => {
    if (b.latitude != null && b.longitude != null) {
      return `https://maps.apple.com/?daddr=${b.latitude},${b.longitude}&dirflg=d`;
    }
    return null;
  };

  // Filtered history list
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return completedOrders;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (historyFilter === 'today') {
      return completedOrders.filter(
        (b) => b.scheduleDate === todayStr || (b.completedAt && b.completedAt.slice(0, 10) === todayStr)
      );
    }

    if (historyFilter === '7days') {
      const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return completedOrders.filter(
        (b) => b.scheduleDate >= past7 || (b.completedAt && b.completedAt.slice(0, 10) >= past7)
      );
    }

    if (historyFilter === '30days') {
      const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return completedOrders.filter(
        (b) => b.scheduleDate >= past30 || (b.completedAt && b.completedAt.slice(0, 10) >= past30)
      );
    }

    return completedOrders;
  }, [completedOrders, historyFilter]);

  return (
    <div className="pb-[max(7.5rem,calc(6rem+env(safe-area-inset-bottom)))] max-w-lg sm:max-w-xl md:max-w-2xl mx-auto px-3 sm:px-4 font-sans antialiased text-slate-800 select-none">
      {/* Offline Status Warning Banner */}
      {!isOnline && (
        <div className="sticky top-0 z-40 bg-rose-600 text-white p-3 text-xs font-bold text-center flex items-center justify-center gap-2 shadow-md">
          <AlertTriangle className="w-4 h-4" />
          <span>Anda sedang offline. Perubahan status memerlukan koneksi internet.</span>
        </div>
      )}

      {/* Therapist App Header */}
      <div className="bg-gradient-to-r from-[#082A4F] via-[#0E3D73] to-[#082A4F] text-white p-5 rounded-3xl shadow-xl border border-[#D4AF37]/40 mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#D4AF37] text-[#082A4F] font-serif font-bold text-xl flex items-center justify-center shadow-md shrink-0">
              {therapistInfo ? therapistInfo.name.charAt(0) : 'T'}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-[#D4AF37] font-extrabold">
                  SENZU THERAPIST
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
              <h1 className="text-lg sm:text-xl font-serif font-bold text-white leading-tight">
                {therapistInfo?.name || currentUser?.name || 'Terapis Senzu'}
              </h1>
              <p className="text-[11px] text-slate-300 font-mono">
                ID: {currentTherapistId || 'Staff'}
              </p>
            </div>
          </div>

          {/* Current Availability Status Badge */}
          <div className="text-right">
            <span
              className={`inline-block px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wide ${
                therapistInfo?.status === 'on_duty' || currentJob
                  ? 'bg-amber-400 text-amber-950'
                  : therapistInfo?.status === 'break'
                  ? 'bg-blue-400 text-blue-950'
                  : 'bg-emerald-400 text-emerald-950'
              }`}
            >
              {therapistInfo?.status === 'on_duty' || currentJob
                ? 'ON DUTY'
                : therapistInfo?.status === 'break'
                ? 'ISTIRAHAT'
                : 'TERSEDIA'}
            </span>
          </div>
        </div>

        {/* Operational Shift & Break Info (Prompt 14A: Read-only for therapist) */}
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Shift: <strong className="text-white font-mono">{todayRoster?.shiftStart || therapistInfo?.defaultShift?.start || '10:00'}-{todayRoster?.shiftEnd || therapistInfo?.defaultShift?.end || '21:00'} WIB</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Coffee className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {todayRoster?.breaks && todayRoster.breaks.length > 0
                  ? `Break: ${todayRoster.breaks[0].start}-${todayRoster.breaks[0].end}`
                  : 'Break Fleksibel'}
              </span>
            </div>
          </div>

          {/* Operational Shift Status Pill & Next Booking summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/10">
            {operationalShiftStatus && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${operationalShiftStatus.badgeColor} ${operationalShiftStatus.textColor}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                <span>Jadwal: {operationalShiftStatus.status}</span>
              </span>
            )}

            {(currentJob || upcomingJobs[0]) ? (
              <div className="text-[10px] text-slate-300 flex items-center gap-1">
                <span>Pesanan Berikutnya:</span>
                <strong className="text-[#D4AF37] font-mono">
                  {(currentJob || upcomingJobs[0]).bookingCode} ({(currentJob || upcomingJobs[0]).scheduleTime} WIB)
                </strong>
              </div>
            ) : (
              <div className="text-[10px] text-slate-400 italic">
                Belum ada pesanan terjadwal berikutnya
              </div>
            )}
          </div>
        </div>

        {/* Quick Availability Selector if no active job is running */}
        {!currentJob && (
          <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-300 text-[11px] font-medium">Status Tugas:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleAvailabilityChange('available')}
                className={`px-3 py-1.5 rounded-xl font-bold transition text-[11px] ${
                  therapistInfo?.status === 'available' || !therapistInfo?.status
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                Tersedia
              </button>
              <button
                type="button"
                onClick={() => handleAvailabilityChange('break')}
                className={`px-3 py-1.5 rounded-xl font-bold transition text-[11px] ${
                  therapistInfo?.status === 'break'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                Istirahat
              </button>
              <button
                type="button"
                onClick={() => handleAvailabilityChange('off')}
                className={`px-3 py-1.5 rounded-xl font-bold transition text-[11px] ${
                  therapistInfo?.status === 'off'
                    ? 'bg-slate-600 text-white shadow-xs'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                Selesai
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Role Alert Banner (e.g. New unaccepted assignment) */}
      <RoleAlertBanners
        role="therapist"
        counts={{
          pendingTherapistAcceptance: activeOrders.filter((b) => isAssignedStatus(b.status)).length,
        }}
        onActionClick={handleBukaTugas}
      />

      {/* Action Feedback Notification */}
      {actionAlert && (
        <div className="mb-4 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2.5 animate-fade-in font-semibold shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionAlert}</span>
        </div>
      )}

      {/* Location Permission Denied Warning */}
      {locationPermissionDenied && (
        <div className="mb-4 p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs space-y-2 animate-fade-in">
          <div className="flex items-center gap-2 font-bold text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Izin Akses Lokasi (GPS) Ditolak</span>
          </div>
          <p className="text-[11px] text-rose-700 leading-relaxed">
            Izin lokasi sangat penting agar customer dapat memantau kedatangan Anda. Mohon buka pengaturan browser atau izinkan akses lokasi untuk situs ini.
          </p>
          <button
            type="button"
            onClick={() => {
              if (currentJob) handleNextStatus(currentJob, 'On The Way');
            }}
            className="w-full min-h-[44px] py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition"
          >
            Coba Minta Izin Lokasi Lagi
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 1: BERANDA (HOME) */}
      {/* ========================================================================= */}
      {mobileTab === 'beranda' && (
        <div className="space-y-4">
          {/* CURRENT ACTIVE JOB (TOP PRIORITY) */}
          {currentJob ? (
            <div id="current-job-card" className="space-y-4">
              {/* Job Status Banner */}
              <div
                className={`p-4 rounded-3xl text-white shadow-lg flex items-center justify-between gap-3 ${
                  currentJob.status === 'Therapist Assigned'
                    ? 'bg-gradient-to-r from-purple-700 to-purple-900 border border-purple-400'
                    : currentJob.status === 'Accepted'
                    ? 'bg-gradient-to-r from-blue-700 to-blue-900 border border-blue-400'
                    : currentJob.status === 'On The Way'
                    ? 'bg-gradient-to-r from-amber-600 to-amber-800 border border-amber-400'
                    : currentJob.status === 'Arrived'
                    ? 'bg-gradient-to-r from-teal-700 to-teal-900 border border-teal-400'
                    : 'bg-gradient-to-r from-emerald-700 to-emerald-900 border border-emerald-400'
                }`}
              >
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[#D4AF37] font-bold block">
                    PEKERJAAN SAAT INI
                  </span>
                  <div className="font-serif font-bold text-lg leading-tight mt-0.5">
                    {currentJob.status === 'Therapist Assigned'
                      ? 'Pesanan Baru Ditugaskan'
                      : currentJob.status === 'Accepted'
                      ? 'Pesanan Diterima (Siap Berangkat)'
                      : currentJob.status === 'On The Way'
                      ? 'Menuju Lokasi Customer'
                      : currentJob.status === 'Arrived'
                      ? 'Anda Telah Tiba di Lokasi'
                      : 'Treatment Berlangsung'}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-mono font-bold bg-white/20 px-2.5 py-1 rounded-xl">
                    {currentJob.bookingCode}
                  </span>
                </div>
              </div>

              {/* Special View: Live Treatment Timer */}
              {currentJob.status === 'Treatment' && currentJob.treatmentStartedAt && (
                <TherapistTreatmentTimer
                  startedAt={currentJob.treatmentStartedAt}
                  durationMinutes={currentJob.serviceDuration}
                  serviceName={currentJob.serviceName}
                  onComplete={() => handleNextStatus(currentJob, 'Completed')}
                  isProcessing={updatingId === currentJob.id}
                />
              )}

              {/* Special Notice for On The Way (PWA Background Limitation & WakeLock) */}
              {currentJob.status === 'On The Way' && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3 shadow-xs">
                  <Navigation className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <strong className="block text-xs font-bold text-amber-950">
                      Tracking GPS Aktif
                    </strong>
                    <p className="mt-0.5 text-amber-800 leading-relaxed text-[11px]">
                      Untuk tracking optimal, biarkan layar Senzu Home tetap menyala saat berkendara.
                      {liveLocation ? ` Sinyal: ±${liveLocation.accuracy}m (${liveLocation.lastSentTime})` : ' Mendeteksi titik GPS...'}
                    </p>
                  </div>
                </div>
              )}

              {/* Main Job Details Card */}
              <div
                id="current-job-card"
                className={`bg-white rounded-3xl border ${
                  highlightedBookingId === currentJob.id
                    ? 'border-amber-400 ring-4 ring-amber-300/50 shadow-lg'
                    : 'border-slate-200 shadow-sm'
                } p-5 space-y-4 transition-all duration-300`}
              >
                {/* Treatment Header */}
                <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-[#082A4F] text-base leading-tight">
                      {currentJob.serviceName}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-slate-500 text-xs font-medium">
                      <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>{currentJob.serviceDuration} Menit Durasi</span>
                      <span>•</span>
                      <Calendar className="w-3.5 h-3.5 text-[#082A4F]" />
                      <span>{currentJob.scheduleDate}, {currentJob.scheduleTime} WIB</span>
                    </div>
                  </div>

                  <button
                    id="btn-open-full-detail"
                    type="button"
                    onClick={() => handleOpenBookingDetail(currentJob)}
                    className="text-xs font-bold text-[#082A4F] bg-slate-100 hover:bg-slate-200 active:scale-95 px-3 py-1.5 rounded-xl flex items-center gap-1 transition cursor-pointer shrink-0"
                    title="Buka Lembar Detail Tugas"
                  >
                    <span>Detail Lengkap</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Customer Info & Contact */}
                <div className="bg-[#FAF9F6] p-3.5 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#082A4F]/10 flex items-center justify-center text-[#082A4F] font-bold text-xs">
                        {(currentJob.customerName || 'P').charAt(0)}
                      </div>
                      <div>
                        <span className="font-bold text-slate-900 text-sm block">
                          {currentJob.customerName || 'Pelanggan'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {currentJob.customerWhatsApp || '-'}
                        </span>
                      </div>
                    </div>

                    {/* Quick Call, WhatsApp CTA, and In-App Customer Chat */}
                    <div className="flex items-center gap-1.5">
                      <ChatButtonWithBadge
                        booking={currentJob}
                        userRole="therapist"
                        onOpenChat={(b) => setChatBooking(b)}
                        variant="compact"
                        label="Chat Customer"
                      />
                      {currentJob.customerWhatsApp && (
                        <>
                          <a
                            href={`tel:${currentJob.customerWhatsApp.replace(/[^0-9+]/g, '')}`}
                            className="w-9 h-9 rounded-xl bg-white border border-slate-300 text-slate-700 flex items-center justify-center hover:bg-slate-50 transition active:scale-95 shadow-xs"
                            title="Telepon Customer"
                          >
                            <Phone className="w-4 h-4 text-emerald-600" />
                          </a>
                          <a
                            href={`https://wa.me/${currentJob.customerWhatsApp.replace(/[^0-9]/g, '')}?text=Halo%20${encodeURIComponent(
                              currentJob.customerName || 'Pelanggan'
                            )}%2C%20saya%20${encodeURIComponent(therapistInfo?.name || 'Terapis')}%20dari%20Senzu%20Home.`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700 transition active:scale-95 shadow-xs"
                            title="Chat WhatsApp Customer"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Customer Address & Area */}
                  <div className="pt-2 border-t border-slate-200/80 text-xs text-slate-700 space-y-1">
                    <div className="flex items-start gap-1.5">
                      <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <div className="leading-relaxed">
                        <span className="font-bold text-slate-900">{currentJob.area}: </span>
                        <span>{currentJob.address}</span>
                      </div>
                    </div>

                    {currentJob.addressNotes && (
                      <div className="ml-5 text-[11px] text-slate-600 bg-white p-2 rounded-xl border border-slate-200">
                        <strong className="text-slate-800">Patokan / Landmark: </strong>
                        {currentJob.addressNotes}
                      </div>
                    )}
                  </div>

                  {/* Navigation Deep-links (Google Maps / Waze / Apple Maps) */}
                  <div className="pt-2 flex flex-wrap gap-2">
                    <a
                      href={getMapsUrl(currentJob)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 text-xs font-bold text-[#082A4F] bg-white border-2 border-[#082A4F]/20 hover:border-[#082A4F] px-3.5 py-2 rounded-xl transition shadow-xs active:scale-95"
                    >
                      <Navigation className="w-4 h-4 text-[#D4AF37]" />
                      <span>Buka Google Maps</span>
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </a>

                    {getWazeUrl(currentJob) && (
                      <a
                        href={getWazeUrl(currentJob)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 shadow-xs hover:bg-slate-50"
                      >
                        <span>Waze</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Customer Wellness Notes & Preferences */}
                {currentJob.customerNotes && (
                  <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900">
                    <strong className="block font-bold">Catatan Khusus Pelanggan:</strong>
                    <p className="mt-0.5 text-[11px] leading-relaxed">{currentJob.customerNotes}</p>
                  </div>
                )}

                {/* Operational Payment Status Notice (100% No Cash Policy) */}
                <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-bold text-emerald-900">Pembayaran Lunas Non-Tunai</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full font-semibold">
                    Dilarang Terima Uang Tunai
                  </span>
                </div>

                {/* Emergency & Issue Reporting Links */}
                <div className="pt-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIssueBooking(currentJob)}
                    className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 font-bold cursor-pointer min-h-[36px] px-2"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Laporkan Kendala</span>
                  </button>

                  {isCsAvailable ? (
                    <a
                      href={getCsWhatsAppUrl(
                        'Halo Supervisor / CS Senzu, saya butuh bantuan operasional'
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#082A4F] hover:text-[#0E3D73] font-bold min-h-[36px] px-2 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>Hubungi CS / SPV</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => alert(csUnavailableNotice)}
                      className="inline-flex items-center gap-1 text-slate-500 font-bold min-h-[36px] px-2 cursor-pointer"
                      title={csUnavailableNotice}
                    >
                      <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                      <span>Hubungi CS / SPV</span>
                    </button>
                  )}
                </div>

                {/* PRIMARY TRANSITION ACTION (56px touch target for mobile thumb) */}
                <div className="pt-2">
                  {(currentJob.status === 'Therapist Assigned' || isAssignedStatus(currentJob.status)) && (
                    <button
                      id="btn-terima-pesanan"
                      type="button"
                      disabled={updatingId === currentJob.id}
                      onClick={() => handleNextStatus(currentJob, 'Accepted')}
                      className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-purple-900/30 cursor-pointer disabled:opacity-50"
                    >
                      {updatingId === currentJob.id ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin text-purple-200" />
                          <span>Menerima Pesanan...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-5 h-5 text-purple-200" />
                          <span>TERIMA PESANAN</span>
                        </>
                      )}
                    </button>
                  )}

                  {currentJob.status === 'Accepted' && (
                    <button
                      type="button"
                      disabled={updatingId === currentJob.id}
                      onClick={() => handleNextStatus(currentJob, 'On The Way')}
                      className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-amber-900/30 cursor-pointer disabled:opacity-50"
                    >
                      <Navigation className="w-5 h-5 text-amber-200" />
                      <span>{updatingId === currentJob.id ? 'Memeriksa GPS...' : 'MULAI PERJALANAN (ON THE WAY)'}</span>
                    </button>
                  )}

                  {currentJob.status === 'On The Way' && (
                    <button
                      type="button"
                      disabled={updatingId === currentJob.id}
                      onClick={() => handleNextStatus(currentJob, 'Arrived')}
                      className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-teal-900/30 cursor-pointer disabled:opacity-50"
                    >
                      <MapPin className="w-5 h-5 text-teal-200" />
                      <span>{updatingId === currentJob.id ? 'Validasi Lokasi...' : 'SAYA SUDAH TIBA'}</span>
                    </button>
                  )}

                  {currentJob.status === 'Arrived' && (
                    <button
                      type="button"
                      disabled={updatingId === currentJob.id}
                      onClick={() => setConfirmStartTreatmentBooking(currentJob)}
                      className="w-full min-h-[56px] py-4 px-6 rounded-2xl bg-[#082A4F] hover:bg-[#0E3D73] text-white font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 transition active:scale-98 shadow-lg shadow-[#082A4F]/30 cursor-pointer disabled:opacity-50"
                    >
                      <Clock className="w-5 h-5 text-[#D4AF37]" />
                      <span>MULAI TREATMENT</span>
                    </button>
                  )}

                  {/* Treatment completion is handled inside TherapistTreatmentTimer component */}
                </div>
              </div>
            </div>
          ) : (
            /* Empty State when no active job */
            <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-[#082A4F]/10 text-[#082A4F] flex items-center justify-center mx-auto">
                <Sparkles className="w-7 h-7 text-[#082A4F]" />
              </div>
              <h3 className="font-bold text-slate-800 text-base">Tidak Ada Tugas Aktif</h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                Anda saat ini siap bertugas. Pesanan yang ditugaskan oleh Supervisor akan otomatis tampil di layar ini secara real-time.
              </p>
            </div>
          )}

          {/* UPCOMING JOBS CARD (IF NEXT ASSIGNMENT EXISTS) */}
          {upcomingJobs.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold text-slate-800">Booking Berikutnya</span>
                <span className="text-[11px] font-bold text-[#082A4F] bg-slate-100 px-2 py-0.5 rounded-full">
                  {upcomingJobs.length} Menunggu
                </span>
              </div>

              <div className="space-y-2">
                {(upcomingJobs || []).map((uj) => (
                  <div
                    key={uj.id}
                    id={`upcoming-job-${uj.bookingCode}`}
                    onClick={() => handleOpenBookingDetail(uj)}
                    className="p-3 bg-[#FAF9F6] hover:bg-amber-50/70 active:scale-98 transition rounded-2xl border border-slate-200 flex items-center justify-between text-xs cursor-pointer group"
                    title="Ketuk untuk melihat detail tugas"
                  >
                    <div>
                      <span className="font-bold text-slate-900 block group-hover:text-[#082A4F]">{uj.serviceName} ({uj.serviceDuration}m)</span>
                      <span className="text-[11px] text-slate-500">
                        {uj.scheduleDate} • {uj.scheduleTime} WIB ({uj.area})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-2.5 py-1 rounded-xl font-bold text-[10px] bg-purple-100 text-purple-800">
                        {uj.status}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#082A4F]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: PEKERJAAN (JOBS LIST) */}
      {/* ========================================================================= */}
      {mobileTab === 'pekerjaan' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-2xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setJobsSubFilter('all')}
              className={`flex-1 py-2 rounded-xl transition ${
                jobsSubFilter === 'all' ? 'bg-white text-[#082A4F] shadow-xs' : 'text-slate-600'
              }`}
            >
              Semua ({activeOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setJobsSubFilter('assigned')}
              className={`flex-1 py-2 rounded-xl transition ${
                jobsSubFilter === 'assigned' ? 'bg-white text-[#082A4F] shadow-xs' : 'text-slate-600'
              }`}
            >
              Perlu Diterima ({activeOrders.filter((b) => isAssignedStatus(b.status)).length})
            </button>
            <button
              type="button"
              onClick={() => setJobsSubFilter('in_progress')}
              className={`flex-1 py-2 rounded-xl transition ${
                jobsSubFilter === 'in_progress' ? 'bg-white text-[#082A4F] shadow-xs' : 'text-slate-600'
              }`}
            >
              Berjalan ({activeOrders.filter((b) => ['Accepted', 'On The Way', 'Arrived', 'Treatment'].includes(b.status)).length})
            </button>
          </div>

          {activeOrders.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm text-xs text-slate-400">
              Tidak ada order yang sedang aktif untuk akun Anda.
            </div>
          ) : (
            <div className="space-y-3">
              {activeOrders
                .filter((b) => {
                  if (jobsSubFilter === 'assigned') return isAssignedStatus(b.status);
                  if (jobsSubFilter === 'in_progress')
                    return ['Accepted', 'On The Way', 'Arrived', 'Treatment'].includes(b.status);
                  return true;
                })
                .map((b) => (
                  <div
                    key={b.id}
                    id={`job-card-${b.bookingCode}`}
                    onClick={() => handleOpenBookingDetail(b)}
                    className="bg-white hover:bg-slate-50/80 transition rounded-3xl border border-slate-200 p-4 shadow-sm space-y-3 cursor-pointer"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="font-mono font-bold text-[#082A4F] text-xs">
                        {b.bookingCode}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isAssignedStatus(b.status)
                            ? 'bg-purple-100 text-purple-800'
                            : b.status === 'Accepted'
                            ? 'bg-blue-100 text-blue-800'
                            : b.status === 'On The Way'
                            ? 'bg-amber-100 text-amber-800'
                            : b.status === 'Arrived'
                            ? 'bg-teal-100 text-teal-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {b.status}
                      </span>
                    </div>

                    <div className="text-xs space-y-1">
                      <div className="font-bold text-slate-900 text-sm">
                        {b.serviceName} ({b.serviceDuration} Menit)
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Customer: <strong>{b.customerName}</strong>
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Jadwal: {b.scheduleDate} • {b.scheduleTime} WIB ({b.area})
                      </div>
                      <div className="text-slate-600 text-[11px] truncate">
                        Alamat: {b.address}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        id={`btn-open-job-${b.bookingCode}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBookingDetail(b);
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#082A4F] text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Buka Detail</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBookingDetail(b);
                          setMobileTab('beranda');
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <span>Kerjakan di Beranda</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: RIWAYAT (JOB HISTORY) */}
      {/* ========================================================================= */}
      {mobileTab === 'riwayat' && (
        <div className="space-y-4">
          {/* History Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setHistoryFilter('all')}
              className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition ${
                historyFilter === 'all' ? 'bg-[#082A4F] text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              Semua ({completedOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setHistoryFilter('today')}
              className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition ${
                historyFilter === 'today' ? 'bg-[#082A4F] text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              Hari Ini
            </button>
            <button
              type="button"
              onClick={() => setHistoryFilter('7days')}
              className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition ${
                historyFilter === '7days' ? 'bg-[#082A4F] text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              7 Hari Terakhir
            </button>
            <button
              type="button"
              onClick={() => setHistoryFilter('30days')}
              className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition ${
                historyFilter === '30days' ? 'bg-[#082A4F] text-white' : 'bg-white border border-slate-200 text-slate-600'
              }`}
            >
              30 Hari
            </button>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 text-center border border-slate-200 shadow-sm text-xs text-slate-400">
              Belum ada riwayat pekerjaan selesai pada filter yang dipilih.
            </div>
          ) : (
            <div className="space-y-3">
              {(filteredHistory || []).map((b) => (
                <div
                  key={b.id}
                  className="bg-white rounded-3xl border border-slate-200 p-4 shadow-sm text-xs space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="font-mono font-bold text-[#082A4F]">
                      {b.bookingCode}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      Selesai
                    </span>
                  </div>

                  <div>
                    <span className="font-bold text-slate-900 block text-sm">
                      {b.serviceName} ({b.serviceDuration}m)
                    </span>
                    <span className="text-slate-500 text-[11px] block mt-0.5">
                      Pelanggan: {maskCustomerName(b.customerName)} • {b.area}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                    <span>Jadwal: {b.scheduleDate}, {b.scheduleTime} WIB</span>
                    <span className="font-bold text-emerald-700">LUNAS</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 4: AKUN & PROFIL (PROFILE) */}
      {/* ========================================================================= */}
      {mobileTab === 'akun' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm text-center space-y-4">
            <div className="w-20 h-20 rounded-3xl bg-[#082A4F] text-[#D4AF37] font-serif font-bold text-3xl flex items-center justify-center mx-auto shadow-md border-2 border-[#D4AF37]">
              {therapistInfo ? therapistInfo.name.charAt(0) : 'T'}
            </div>

            <div>
              <h3 className="font-serif font-bold text-lg text-[#082A4F]">
                {therapistInfo?.name || currentUser?.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Terapis Berlisensi Resmi • ID: {currentTherapistId || 'Staff'}
              </p>
            </div>

            {/* Performance Stats */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-[#FAF9F6] p-3 rounded-2xl border border-slate-200">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                  Total Treatment Selesai
                </span>
                <span className="font-bold text-base text-[#082A4F]">
                  {therapistInfo?.totalCompleted || completedOrders.length} Sesi
                </span>
              </div>
              <div className="bg-[#FAF9F6] p-3 rounded-2xl border border-slate-200">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                  Rating Kepuasan
                </span>
                <span className="font-bold text-base text-amber-500">
                  ★ {therapistInfo?.rating || '4.9'}
                </span>
              </div>
            </div>

            {/* Availability Control */}
            <div className="pt-2 text-left space-y-2 border-t border-slate-100">
              <span className="text-xs font-bold text-slate-700 block">
                Pengaturan Status Ketersediaan:
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleAvailabilityChange('available')}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition ${
                    therapistInfo?.status === 'available' || !therapistInfo?.status
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Tersedia
                </button>
                <button
                  type="button"
                  onClick={() => handleAvailabilityChange('break')}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition ${
                    therapistInfo?.status === 'break'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Istirahat
                </button>
                <button
                  type="button"
                  onClick={() => handleAvailabilityChange('off')}
                  className={`py-2 px-1 rounded-xl text-xs font-bold transition ${
                    therapistInfo?.status === 'off'
                      ? 'bg-slate-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Selesai
                </button>
              </div>
            </div>

            {/* PWA Install Affordance */}
            <div className="pt-2">
              <PWAInstallActionItem />
            </div>

            {/* Logout Button */}
            <div className="pt-4 border-t border-slate-100">
              <button
                id="btn-therapist-logout"
                type="button"
                disabled={isLoggingOut}
                onClick={() => {
                  setLogoutError(null);
                  setIsLogoutModalOpen(true);
                }}
                className="w-full min-h-[48px] py-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer border border-rose-200 active:scale-98 disabled:opacity-50"
              >
                <LogOut className="w-4 h-4 text-rose-600" />
                <span>Keluar Akun Terapis</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MOBILE STICKY BOTTOM NAVIGATION BAR (PORTAL SPECIFIC) */}
      {/* ========================================================================= */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="max-w-lg sm:max-w-xl md:max-w-2xl mx-auto flex items-center justify-around">
          <button
            type="button"
            onClick={() => setMobileTab('beranda')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition cursor-pointer ${
              mobileTab === 'beranda' ? 'text-[#082A4F] font-bold' : 'text-slate-400 hover:text-slate-600 font-medium'
            }`}
          >
            <Sparkles className={`w-5 h-5 ${mobileTab === 'beranda' ? 'text-[#D4AF37]' : ''}`} />
            <span className="text-[10px]">Beranda</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('pekerjaan')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition cursor-pointer relative ${
              mobileTab === 'pekerjaan' ? 'text-[#082A4F] font-bold' : 'text-slate-400 hover:text-slate-600 font-medium'
            }`}
          >
            <Briefcase className={`w-5 h-5 ${mobileTab === 'pekerjaan' ? 'text-[#082A4F]' : ''}`} />
            <span className="text-[10px]">Pekerjaan</span>
            {activeOrders.length > 0 && (
              <span className="absolute top-0 right-2 w-2 h-2 rounded-full bg-amber-500"></span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('riwayat')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition cursor-pointer ${
              mobileTab === 'riwayat' ? 'text-[#082A4F] font-bold' : 'text-slate-400 hover:text-slate-600 font-medium'
            }`}
          >
            <History className={`w-5 h-5 ${mobileTab === 'riwayat' ? 'text-[#082A4F]' : ''}`} />
            <span className="text-[10px]">Riwayat</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('akun')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition cursor-pointer ${
              mobileTab === 'akun' ? 'text-[#082A4F] font-bold' : 'text-slate-400 hover:text-slate-600 font-medium'
            }`}
          >
            <User className={`w-5 h-5 ${mobileTab === 'akun' ? 'text-[#082A4F]' : ''}`} />
            <span className="text-[10px]">Akun</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL: START TREATMENT CONFIRMATION */}
      {/* ========================================================================= */}
      {confirmStartTreatmentBooking && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-slate-900 shadow-2xl border border-slate-200 text-center space-y-4 animate-scale-in">
            <div className="w-12 h-12 rounded-2xl bg-[#082A4F]/10 text-[#082A4F] flex items-center justify-center mx-auto">
              <Clock className="w-7 h-7 text-[#D4AF37]" />
            </div>
            <div>
              <h4 className="text-base font-bold text-[#082A4F]">Mulai Treatment Sekarang?</h4>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Timer layanan {confirmStartTreatmentBooking.serviceDuration} menit akan segera dimulai. Pastikan customer telah siap dan rileks.
              </p>
            </div>
            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={updatingId === confirmStartTreatmentBooking.id}
                onClick={() => {
                  const b = confirmStartTreatmentBooking;
                  setConfirmStartTreatmentBooking(null);
                  handleNextStatus(b, 'Treatment');
                }}
                className="w-full min-h-[48px] py-3 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold transition active:scale-95 cursor-pointer shadow-md shadow-[#082A4F]/20"
              >
                Mulai Treatment
              </button>
              <button
                type="button"
                onClick={() => setConfirmStartTreatmentBooking(null)}
                className="w-full min-h-[44px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ARRIVAL DISTANCE VALIDATION (Max 300m anti-fraud check) */}
      {/* ========================================================================= */}
      {arrivalValidationModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-amber-300 animate-scale-in text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-amber-600" />
            </div>

            <div>
              <span className="text-[10px] uppercase tracking-wider font-bold text-amber-800 bg-amber-100 px-3 py-1 rounded-full">
                Validasi Kedatangan
              </span>
              <h3 className="text-base font-serif font-bold text-[#082A4F] mt-2">
                Anda Belum Berada di Lokasi Customer
              </h3>
            </div>

            <div className="bg-amber-50 rounded-2xl p-4 text-xs text-left space-y-2 border border-amber-200">
              <div className="flex justify-between items-center text-slate-700">
                <span>Jarak GPS Anda:</span>
                <span className="font-bold text-rose-600 font-mono text-sm">
                  ±{arrivalValidationModal.distanceMeters} Meter
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span>Radius Wajar:</span>
                <span className="font-bold text-slate-800 font-mono">300 Meter</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed pt-1 border-t border-amber-200">
                Apakah Anda yakin sudah sampai di depan rumah/lokasi pelanggan?
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  const b = arrivalValidationModal.booking;
                  setArrivalValidationModal(null);
                  handleNextStatus(b, 'Arrived', true);
                }}
                className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition active:scale-95 shadow-sm"
              >
                Tetap Tandai Tiba (Saya Sudah di Lokasi)
              </button>

              <button
                type="button"
                onClick={() => setArrivalValidationModal(null)}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 cursor-pointer"
              >
                Kembali ke Navigasi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REPORT ISSUE */}
      {/* ========================================================================= */}
      {issueBooking && (
        <TherapistIssueModal
          booking={issueBooking}
          therapistId={currentTherapistId || 'th-staff'}
          therapistName={therapistInfo?.name || currentUser?.name || 'Terapis Senzu'}
          onClose={() => setIssueBooking(null)}
          onSuccess={(msg) => {
            setActionAlert(msg);
            setTimeout(() => setActionAlert(''), 4000);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL: THERAPIST LOGOUT CONFIRMATION (ACTIVE JOB OR STANDARD) */}
      {/* ========================================================================= */}
      {isLogoutModalOpen && (
        <div
          id="modal-therapist-logout-backdrop"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            id="modal-therapist-logout-content"
            className="bg-white rounded-3xl max-w-sm w-full p-6 text-slate-900 shadow-2xl border border-slate-200 text-center space-y-4 animate-scale-in"
          >
            {activeOngoingJob ? (
              // CASE 1: ACTIVE JOB WARNING (Requirement 15)
              <>
                <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
                  <AlertTriangle className="w-7 h-7 text-amber-600" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-[#082A4F]">
                    Anda masih memiliki pekerjaan aktif.
                  </h4>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                    Jika keluar, pembaruan lokasi dari perangkat ini akan berhenti.
                  </p>
                </div>
                <div className="bg-amber-50 rounded-2xl p-3 text-left border border-amber-200 text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-amber-900">
                    <span>Order #{activeOngoingJob.bookingCode}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                      {activeOngoingJob.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    Pelanggan: {maskCustomerName(activeOngoingJob.customerName)} • {activeOngoingJob.area}
                  </p>
                </div>
              </>
            ) : (
              // CASE 2: NO ACTIVE JOB (Requirement 16)
              <>
                <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-200">
                  <LogOut className="w-7 h-7 text-rose-600" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-[#082A4F]">
                    Keluar dari akun Senzu Home?
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Anda harus login kembali untuk mengakses jadwal dan pekerjaan terapis.
                  </p>
                </div>
              </>
            )}

            {/* Error Message if logout fails (Requirement 25 & 26) */}
            {logoutError && (
              <div
                id="therapist-logout-error-alert"
                className="bg-rose-50 text-rose-700 text-xs p-3 rounded-xl border border-rose-200 flex items-center gap-2 text-left"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{logoutError}</span>
              </div>
            )}

            {/* Actions Buttons (Requirement 15, 16, 27) */}
            <div className="space-y-2 pt-2">
              <button
                id="btn-confirm-therapist-logout"
                type="button"
                disabled={isLoggingOut}
                onClick={handleConfirmLogout}
                className={`w-full min-h-[48px] py-3 rounded-xl text-white text-xs font-bold transition active:scale-95 cursor-pointer shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  activeOngoingJob
                    ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                }`}
              >
                {isLoggingOut ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Keluar...</span>
                  </>
                ) : activeOngoingJob ? (
                  <span>Tetap Keluar</span>
                ) : (
                  <span>Keluar</span>
                )}
              </button>

              <button
                id="btn-cancel-therapist-logout"
                type="button"
                disabled={isLoggingOut}
                onClick={() => {
                  if (!isLoggingOut) {
                    setIsLogoutModalOpen(false);
                    setLogoutError(null);
                  }
                }}
                className="w-full min-h-[44px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition active:scale-95 cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DRAWER: DETAILED JOB / TASK VIEW */}
      {/* ========================================================================= */}
      <TherapistJobDetailDrawer
        isOpen={Boolean(drawerBooking)}
        booking={drawerBooking}
        isUpdating={updatingId === drawerBooking?.id}
        therapistName={therapistInfo?.name || currentUser?.name || 'Terapis Senzu'}
        onOpenChat={(b) => setChatBooking(b)}
        onClose={() => setDrawerBooking(null)}
        onNextStatus={async (booking, nextStatus) => {
          await handleNextStatus(booking, nextStatus);
        }}
        onReportIssue={(booking) => {
          setDrawerBooking(null);
          setIssueBooking(booking);
        }}
        onConfirmStartTreatment={(booking) => {
          setConfirmStartTreatmentBooking(booking);
        }}
        isCsAvailable={isCsAvailable}
        getCsWhatsAppUrl={getCsWhatsAppUrl}
        csUnavailableNotice={csUnavailableNotice}
        liveLocation={
          liveLocation
            ? {
                latitude: liveLocation.lat,
                longitude: liveLocation.lng,
                accuracy: liveLocation.accuracy,
                lastSentTime: liveLocation.lastSentTime,
              }
            : null
        }
      />

      {/* Contextual In-App Chat Customer Modal */}
      {chatBooking && (
        <BookingChatModal
          isOpen={Boolean(chatBooking)}
          onClose={() => setChatBooking(null)}
          booking={chatBooking}
          currentUserRole="therapist"
          currentAuthUid={currentUser?.authUserId || currentUser?.uid || auth.currentUser?.uid || ''}
          currentDisplayName={therapistInfo?.name || currentUser?.displayName || currentUser?.name || 'Terapis'}
        />
      )}
    </div>
  );
};
