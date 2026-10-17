import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Clock,
  MapPin,
  Calendar,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  QrCode,
  Banknote,
  Copy,
  ExternalLink,
  ChevronRight,
  HeartHandshake,
  Info,
  Check,
  ArrowRight,
  Phone,
  User,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import {
  ServiceItem,
  AppSettings,
  GenderPreference,
  PaymentMethod,
  PALEMBANG_AREAS,
  Booking,
  CustomerLoyaltyAccount,
  CustomerVoucher,
  Voucher,
  MembershipTier,
  LoyaltySettings,
  ServiceArea,
} from '../types';
import { formatRupiah } from '../lib/utils';
import { createBooking, calculateHomeServiceFee } from '../lib/dbService';
import { formatDistanceDisplay, SENZU_BASE_LOCATION } from '../lib/distanceFeeService';
import { AddressAutocompleteMap } from './AddressAutocompleteMap';
import { CustomerPaymentPage } from './CustomerPaymentPage';
import { calculateBookingPrice } from '../lib/pricingService';
import { getServiceAreas } from '../lib/masterDataService';
import {
  getLoyaltySettings,
  getMembershipTiers,
  getLoyaltyAccountByCustomerId,
  getCustomerVouchers,
  validateReferralCode,
  getVoucherByCode,
  validatePromoCodeForBooking,
} from '../lib/loyaltyService';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { auth } from '../lib/firebase';
import { getCustomerSavedAddresses } from '../lib/crmService';
import { CustomerSavedAddress } from '../types/crm';
import { trackMetaAdsAction } from '../lib/metaPixel';
import { Gift, Coins, Tag, Ticket, Users, Sparkles as SparklesIcon } from 'lucide-react';

interface BookingFormProps {
  services: ServiceItem[];
  settings: AppSettings;
  onBookingSuccess: (booking: Booking) => void;
  onOpenTracking?: (code: string) => void;
  repeatData?: Partial<Booking> | null;
  onClearRepeatData?: () => void;
  initialServiceId?: string;
  initialPromoCode?: string;
}

export const BookingForm: React.FC<BookingFormProps> = ({
  services = [],
  settings,
  onBookingSuccess,
  onOpenTracking,
  repeatData,
  onClearRepeatData,
  initialServiceId,
  initialPromoCode,
}) => {
  const safeServices = services || [];

  // Form State
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    initialServiceId || safeServices.find((s) => s.isPopular)?.id || safeServices[0]?.id || ''
  );

  // Sync selected service when services list loads or updates
  useEffect(() => {
    if (initialServiceId && safeServices.some((s) => s.id === initialServiceId)) {
      setSelectedServiceId(initialServiceId);
    } else if (safeServices.length > 0) {
      if (!selectedServiceId || !safeServices.some((s) => s.id === selectedServiceId)) {
        const popular = safeServices.find((s) => s.isPopular);
        setSelectedServiceId(popular ? popular.id : safeServices[0]?.id || '');
      }
    }
  }, [services, selectedServiceId, initialServiceId]);

  const [customerName, setCustomerName] = useState('');
  const [customerWhatsApp, setCustomerWhatsApp] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [selectedArea, setSelectedArea] = useState<string>(PALEMBANG_AREAS[0] || '');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<number>(settings?.baseLatitude ?? -2.976074);
  const [longitude, setLongitude] = useState<number>(settings?.baseLongitude ?? 104.757305);
  const [placeId, setPlaceId] = useState<string>('');
  const [addressNotes, setAddressNotes] = useState<string>('');
  const [distanceKm, setDistanceKm] = useState<number>(3.5);
  const [distanceMeters, setDistanceMeters] = useState<number>(3500);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [scheduleDate, setScheduleDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [genderPreference, setGenderPreference] = useState<GenderPreference>('Bebas');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('QRIS');
  const [customerNotes, setCustomerNotes] = useState('');

  // Loyalty & Rewards State
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
  const [membershipTiers, setMembershipTiers] = useState<MembershipTier[]>([]);
  const [customerLoyalty, setCustomerLoyalty] = useState<CustomerLoyaltyAccount | null>(null);
  const [customerVouchersList, setCustomerVouchersList] = useState<CustomerVoucher[]>([]);
  const [promoInput, setPromoInput] = useState(initialPromoCode || '');
  const [appliedPromo, setAppliedPromo] = useState<Voucher | null>(null);
  const [promoError, setPromoError] = useState('');

  useEffect(() => {
    if (initialPromoCode) {
      setPromoInput(initialPromoCode);
    }
  }, [initialPromoCode]);
  const [selectedCustomerVoucher, setSelectedCustomerVoucher] = useState<CustomerVoucher | null>(null);
  const [pointsToRedeem, setPointsToRedeem] = useState<number>(0);
  const [isRedeemingPoints, setIsRedeemingPoints] = useState<boolean>(false);
  const [referralInput, setReferralInput] = useState('');
  const [referralMsg, setReferralMsg] = useState<{ valid: boolean; message: string; referrerAccount?: CustomerLoyaltyAccount } | null>(null);
  const [isCheckingReferral, setIsCheckingReferral] = useState(false);

  // Load Loyalty Settings & Tiers
  useEffect(() => {
    getLoyaltySettings().then(setLoyaltySettings).catch(() => {});
    getMembershipTiers().then(setMembershipTiers).catch(() => {});
    getServiceAreas().then(setServiceAreas).catch(() => {});
  }, []);

  // Manager Master Data Areas (Prompt 15B)
  const [serviceAreas, setServiceAreas] = useState<ServiceArea[]>([]);

  const { currentCustomer, firebaseUser } = useCustomerAuth();
  // An editable contact number cannot select somebody else's membership or vouchers.
  useEffect(() => {
    let cancelled = false;
    const uid = auth.currentUser?.uid;
    const custId = uid && currentCustomer?.authUserId === uid ? (currentCustomer?.id || '') : '';
    setCustomerLoyalty(null);
    setCustomerVouchersList([]);
    if (!uid || !custId) return;
    getLoyaltyAccountByCustomerId(custId).then(acc => {
      if (!cancelled && auth.currentUser?.uid === uid) setCustomerLoyalty(acc);
    }).catch(() => {});
    getCustomerVouchers(custId).then(vouchers => {
      if (!cancelled && auth.currentUser?.uid === uid) setCustomerVouchersList(vouchers.filter(v => v.status === 'available'));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentCustomer?.id, currentCustomer?.authUserId, firebaseUser?.uid]);

  // Handle Repeat Booking prefill (services, address, notes, gender preference, but NOT dates/time)
  useEffect(() => {
    if (repeatData) {
      if (repeatData.serviceId && services.some((s) => s.id === repeatData.serviceId)) {
        setSelectedServiceId(repeatData.serviceId);
      }
      if (repeatData.customerName) setCustomerName(repeatData.customerName);
      if (repeatData.customerWhatsApp) setCustomerWhatsApp(repeatData.customerWhatsApp);
      if (repeatData.customerEmail) setCustomerEmail(repeatData.customerEmail);
      if (repeatData.area) setSelectedArea(repeatData.area);
      if (repeatData.address) setAddress(repeatData.address);
      if (repeatData.latitude != null) setLatitude(repeatData.latitude);
      if (repeatData.longitude != null) setLongitude(repeatData.longitude);
      if (repeatData.placeId) setPlaceId(repeatData.placeId);
      if (repeatData.addressNotes) setAddressNotes(repeatData.addressNotes);
      if (repeatData.genderPreference) setGenderPreference(repeatData.genderPreference);
      if (repeatData.therapistName) {
        setCustomerNotes(
          (prev) =>
            prev ? prev : `Preferensi terapis sebelumnya: ${repeatData.therapistName}`
        );
      }
    }
  }, [repeatData, services]);

  const [savedCustomerAddresses, setSavedCustomerAddresses] = useState<CustomerSavedAddress[]>([]);

  // Customer Account Auto-Prefill (Prompt 17B: Guest booking remains optional, but if logged in, prefill)
  useEffect(() => {
    if (currentCustomer) {
      if (!repeatData) {
        if (currentCustomer.displayName || currentCustomer.name) {
          setCustomerName((prev) => prev || currentCustomer.displayName || currentCustomer.name || '');
        }
        if (currentCustomer.phone) {
          setCustomerWhatsApp((prev) => prev || currentCustomer.phone || '');
        }
        if (currentCustomer.email) {
          setCustomerEmail((prev) => prev || currentCustomer.email || '');
        }
      }
      getCustomerSavedAddresses(currentCustomer.id)
        .then((addrs) => {
          setSavedCustomerAddresses(addrs);
          if (!repeatData && addrs.length > 0) {
            const defaultAddr = addrs.find((a) => a.isDefault) || addrs[0];
            if (defaultAddr) {
              if (defaultAddr.address) setAddress((prev) => prev || defaultAddr.address || '');
              if (defaultAddr.area) setSelectedArea((prev) => prev || defaultAddr.area || '');
              const noteVal = defaultAddr.addressNotes || defaultAddr.notes;
              if (noteVal) setAddressNotes((prev) => prev || noteVal || '');
              if (defaultAddr.latitude != null) setLatitude((prev) => prev ?? defaultAddr.latitude);
              if (defaultAddr.longitude != null) setLongitude((prev) => prev ?? defaultAddr.longitude);
              if (defaultAddr.placeId) setPlaceId((prev) => prev || defaultAddr.placeId);
            }
          }
        })
        .catch(() => {});
    }
  }, [currentCustomer, repeatData]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = React.useRef(false);
  const checkoutAttemptRef = React.useRef<{ fingerprint: string; attemptId: string } | null>(null);
  const currentCheckoutUidRef = React.useRef(auth.currentUser?.uid || '');
  const previewSequenceRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [submittedBooking, setSubmittedBooking] = useState<Booking | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0] || null;
  const servicePrice = selectedService ? selectedService.price : 0;
  
  // Match area from Manager Master Data (Prompt 15B)
  const activeAreas = serviceAreas.filter((a) => (a.status === 'ACTIVE' || (a.status as any) === 'active') && a.homeServiceEnabled !== false);

  const matchedArea = React.useMemo(() => {
    if (activeAreas.length === 0) return null;
    const searchLower = `${address} ${selectedArea}`.toLowerCase();

    // 1. Direct name / kecamatan match
    for (const a of activeAreas) {
      if (a.name && searchLower.includes(a.name.toLowerCase())) return a;
      if (a.kecamatan && searchLower.includes(a.kecamatan.toLowerCase())) return a;
      if (Array.isArray(a.kelurahan) && a.kelurahan.some((k) => k && searchLower.includes(String(k).toLowerCase()))) return a;
    }

    // 2. Coordinate radius matching if defined
    if (latitude && longitude) {
      for (const a of activeAreas) {
        if (a.centerLatitude && a.centerLongitude && a.radiusKm) {
          const d = Math.sqrt(
            Math.pow((a.centerLatitude - latitude) * 111, 2) +
            Math.pow((a.centerLongitude - longitude) * 111 * Math.cos(latitude * (Math.PI / 180)), 2)
          );
          if (d <= a.radiusKm) return a;
        }
      }
    }

    return null;
  }, [activeAreas, address, selectedArea, latitude, longitude]);

  // Authoritative distance-based home service fee calculation (Prompt: Single source of truth)
  const feeCalc = calculateHomeServiceFee(distanceKm);
  const homeServiceFee = feeCalc.fee; // 0 for <=10, 30000 for <=15, 60000 for <=20, 75000 for >20
  const homeServiceFeeStatus: 'set' | 'free' = feeCalc.isFree ? 'free' : 'set';
  const homeServiceFeeLabel = feeCalc.isFree ? 'Gratis Biaya Home Service' : `Biaya Home Service: ${formatRupiah(homeServiceFee)}`;
  const requiresAdminConfirmation = false;
  const areaNotice: string | null = null;
  const currentCustomerTier = membershipTiers.find((t) => t.id === customerLoyalty?.currentTierId) || membershipTiers[0] || null;

  const pricingBreakdown = calculateBookingPrice({
    servicePrice,
    homeServiceFee,
    promoVoucher: appliedPromo,
    customerVoucher: selectedCustomerVoucher,
    pointsToRedeem: isRedeemingPoints ? pointsToRedeem : 0,
    customerTier: currentCustomerTier,
    settings: loyaltySettings,
  });

  const totalAmount = pricingBreakdown.finalAmount;

  const phoneDigitsForCheckout = customerWhatsApp.replace(/[^0-9]/g, '');
  const normalizedCheckoutPhone = phoneDigitsForCheckout.startsWith('0') ? `62${phoneDigitsForCheckout.slice(1)}`
    : (phoneDigitsForCheckout.startsWith('62') ? phoneDigitsForCheckout : `62${phoneDigitsForCheckout}`);
  const checkoutFingerprint = JSON.stringify({
    uid: auth.currentUser?.uid || '', customerId: currentCustomer?.id || '', customerName: customerName.trim(),
    phone: normalizedCheckoutPhone, customerEmail: customerEmail.trim(), serviceId: selectedService?.id || '',
    scheduleDate, scheduleTime, genderPreference, paymentMethod, address: address.trim(), latitude, longitude,
    placeId, addressNotes: addressNotes.trim(), distanceKm, distanceMeters, selectedArea,
    areaId: matchedArea?.id || '', areaName: matchedArea?.name || selectedArea,
    customerNotes: customerNotes.trim(), promoId: appliedPromo?.id || '', promoCode: appliedPromo?.code || '',
    customerVoucherId: selectedCustomerVoucher?.id || '', requestedPoints: isRedeemingPoints ? pointsToRedeem : 0,
    referredBy: referralMsg?.valid ? referralMsg.referrerAccount?.customerId || '' : '',
    referralCode: referralMsg?.valid ? referralInput.trim().toUpperCase() : '',
  });
  const latestCheckoutContextRef = React.useRef(checkoutFingerprint);
  latestCheckoutContextRef.current = checkoutFingerprint;

  // Read-only recovery after refresh: an uncommitted draft can never be submitted automatically.
  React.useEffect(() => {
    const uid = auth.currentUser?.uid || '';
    let cancelled = false;
    let pending: any = null;
    try { pending = JSON.parse(globalThis.sessionStorage?.getItem(`senzu:voucher-checkout:${uid}`) || 'null'); } catch {}
    if (!uid || pending?.uid !== uid || !pending?.draft || submittingRef.current) return;
    // Automatic profile/address prefill is not a new user intent. Explicit interaction cancels this recovery result.
    let edited = false;
    const markEdited = () => { edited = true; };
    const stopWatching = () => {
      if (typeof window !== 'undefined') for (const event of ['input', 'change', 'click']) window.removeEventListener(event, markEdited, true);
    };
    if (typeof window !== 'undefined') for (const event of ['input', 'change', 'click']) window.addEventListener(event, markEdited, true);
    submittingRef.current = true;
    setIsSubmitting(true);
    createBooking({...pending.draft, voucherRecoveryOnly: true}).then(booking => {
      if (cancelled || edited || !mountedRef.current || auth.currentUser?.uid !== uid) return;
      checkoutAttemptRef.current = null;
      try { globalThis.sessionStorage?.removeItem(`senzu:voucher-checkout:${uid}`); } catch {}
      void trackMetaAdsAction('booking_submitted', { entityId: booking.id, value: booking.totalAmount });
      setSubmittedBooking(booking);
      onBookingSuccess(booking);
    }).catch(err => {
      if (cancelled || edited || auth.currentUser?.uid !== uid) return;
      if (err?.code === 'CHECKOUT_NOT_COMMITTED') {
        setErrorMsg('Checkout sebelumnya belum tersimpan. Silakan lengkapi dan kirim pesanan kembali.');
      } else if (err?.code !== 'SESSION_CHANGED') {
        setErrorMsg(err?.message || 'Pemulihan checkout belum berhasil. Silakan coba kembali.');
      }
    }).finally(() => {
      stopWatching();
      submittingRef.current = false;
      if (!cancelled && mountedRef.current) setIsSubmitting(false);
    });
    return () => { cancelled = true; stopWatching(); };
  }, [firebaseUser?.uid]);

  React.useEffect(() => {
    const uid = auth.currentUser?.uid || '';
    if (currentCheckoutUidRef.current && currentCheckoutUidRef.current !== uid) {
      try { globalThis.sessionStorage?.removeItem(`senzu:voucher-checkout:${currentCheckoutUidRef.current}`); } catch {}
    }
    currentCheckoutUidRef.current = uid;
    checkoutAttemptRef.current = null;
    previewSequenceRef.current++;
    setAppliedPromo(null);
    setSelectedCustomerVoucher(null);
    setSubmittedBooking(null);
  }, [firebaseUser?.uid]);

  const handleApplyPromo = async (overrideCode?: string) => {
    setPromoError('');
    const codeToTest = (typeof overrideCode === 'string' ? overrideCode : promoInput).trim();
    if (!codeToTest) {
      setPromoError('Harap masukkan kode promo.');
      return;
    }
    const custId = currentCustomer?.id || (customerWhatsApp ? `cust_${customerWhatsApp.replace(/[^0-9]/g, '')}` : undefined);
    const activeAuthUid = auth.currentUser?.uid;
    const requestSequence = ++previewSequenceRef.current;
    const requestContext = latestCheckoutContextRef.current;
    const result = await validatePromoCodeForBooking({
      promoCode: codeToTest,
      servicePrice,
      serviceId: selectedService?.id,
      serviceCategory: selectedService?.category,
      serviceCategoryId: selectedService?.categoryId,
      serviceDuration: selectedService?.duration,
      customerId: custId,
      customerAuthUid: activeAuthUid,
      customerWhatsApp: customerWhatsApp.trim(),
      customerEmail: customerEmail.trim(),
      homeServiceFee,
      latitude,
      longitude,
      distanceKm,
      customerVoucherId: selectedCustomerVoucher?.id,
      pointsToRedeem: isRedeemingPoints ? pointsToRedeem : 0,
    });

    if (!mountedRef.current || requestSequence !== previewSequenceRef.current
      || requestContext !== latestCheckoutContextRef.current || auth.currentUser?.uid !== activeAuthUid) return;
    if (!result.valid || !result.voucher) {
      setPromoError(result.errorMessage || 'Kode promo tidak valid atau tidak dapat digunakan.');
      setAppliedPromo(null);
      checkoutAttemptRef.current = null;
    } else {
      setAppliedPromo(result.voucher);
      setPromoInput('');
      checkoutAttemptRef.current = null;
    }
  };

  // Revalidate active promo when customer identity, session, service, or fee changes to prevent bypass or stale success
  React.useEffect(() => {
    if (!appliedPromo || submittingRef.current || checkoutAttemptRef.current) return;
    const requestContext = latestCheckoutContextRef.current;
    const requestSequence = ++previewSequenceRef.current;
    const activeAuthUid = auth.currentUser?.uid;
    if (!activeAuthUid) {
      setAppliedPromo(null);
      setPromoError('Silakan login ke akun pelanggan terlebih dahulu untuk menggunakan voucher promo.');
      checkoutAttemptRef.current = null;
      return;
    }

    const phoneDigits = customerWhatsApp.replace(/[^0-9]/g, '');
    const timer = setTimeout(async () => {
      if (submittingRef.current) return;
      const custId = currentCustomer?.id || (phoneDigits ? `cust_${phoneDigits}` : undefined);
      const res = await validatePromoCodeForBooking({
        promoCode: appliedPromo.code || '',
        servicePrice,
        serviceId: selectedService?.id,
        serviceCategory: selectedService?.category,
        serviceCategoryId: selectedService?.categoryId,
        serviceDuration: selectedService?.duration,
        customerId: custId,
        customerAuthUid: activeAuthUid,
        customerWhatsApp: customerWhatsApp.trim(),
        customerEmail: customerEmail.trim(),
        homeServiceFee,
        latitude,
        longitude,
        distanceKm,
        customerVoucherId: selectedCustomerVoucher?.id,
        pointsToRedeem: isRedeemingPoints ? pointsToRedeem : 0,
      });

      if (!mountedRef.current || requestSequence !== previewSequenceRef.current
        || requestContext !== latestCheckoutContextRef.current || auth.currentUser?.uid !== activeAuthUid
        || submittingRef.current || checkoutAttemptRef.current) return;
      if (!res.valid && !(res as any).retryable) {
        setAppliedPromo(null);
        setPromoError(res.errorMessage || 'Voucher tidak berlaku untuk akun/layanan ini.');
        checkoutAttemptRef.current = null;
      }
    }, 500);

    return () => { clearTimeout(timer); previewSequenceRef.current++; };
  }, [
    customerWhatsApp,
    customerEmail,
    currentCustomer?.id,
    currentCustomer?.authUserId,
    firebaseUser?.uid,
    appliedPromo?.code,
    selectedService?.id,
    servicePrice,
    homeServiceFee,
    latitude,
    longitude,
    distanceKm,
    selectedCustomerVoucher?.id,
    isRedeemingPoints,
    pointsToRedeem,
  ]);

  const handleCheckReferral = async () => {
    if (!referralInput.trim()) return;
    setIsCheckingReferral(true);
    const custId = `cust_${customerWhatsApp.replace(/[^0-9]/g, '')}`;
    const res = await validateReferralCode(referralInput, custId, customerWhatsApp);
    setReferralMsg(res);
    setIsCheckingReferral(false);
  };

  const TIME_SLOTS = [
    '09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00'
  ];

  // Visual step progress calculations
  const isStep1Done = Boolean(selectedService);
  const isStep2Done = Boolean(scheduleDate && scheduleTime);
  const isStep3Done = Boolean(customerName.trim() && customerWhatsApp.trim() && address.trim());
  const isStep4Done = Boolean(paymentMethod);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || isSubmitting) return;
    setErrorMsg('');

    if (!selectedService) {
      setErrorMsg('Harap pilih salah satu layanan treatment yang diinginkan.');
      return;
    }

    if (!customerName.trim()) {
      setErrorMsg('Harap masukkan nama lengkap Anda.');
      return;
    }
    if (!customerWhatsApp.trim()) {
      setErrorMsg('Harap masukkan nomor WhatsApp aktif Anda.');
      return;
    }
    if (!address.trim()) {
      setErrorMsg('Harap masukkan alamat lengkap untuk kedatangan terapis.');
      return;
    }

    if (isCalculatingRoute) {
      setErrorMsg('Sedang menghitung rute lokasi Anda. Mohon tunggu...');
      return;
    }

    if (routeError) {
      setErrorMsg(routeError || 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.');
      return;
    }

    const canonicalAuthUid = auth.currentUser?.uid || undefined;
    const requestContext = latestCheckoutContextRef.current;
    const isCurrentSubmission = () => mountedRef.current
      && (auth.currentUser?.uid || '') === (canonicalAuthUid || '')
      && latestCheckoutContextRef.current === requestContext;
    const usesServerCheckout = Boolean(appliedPromo || selectedCustomerVoucher || pricingBreakdown.pointsRedeemed > 0);
    if (usesServerCheckout && !canonicalAuthUid) {
      const authErrMsg = 'Silakan login ke akun pelanggan terlebih dahulu untuk menggunakan voucher promo.';
      setPromoError(authErrMsg);
      setAppliedPromo(null);
      setSelectedCustomerVoucher(null);
      checkoutAttemptRef.current = null;
      setErrorMsg(authErrMsg);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const targetCustomerId = currentCustomer ? currentCustomer.id : `cust_${customerWhatsApp.replace(/[^0-9]/g, '')}`;

      let checkoutAttemptId: string | undefined = undefined;
      let isRetryingExistingAttempt = false;
      if (usesServerCheckout) {
        if (checkoutAttemptRef.current && checkoutAttemptRef.current.fingerprint === checkoutFingerprint) {
          isRetryingExistingAttempt = true;
        } else {
          checkoutAttemptRef.current = {
            fingerprint: checkoutFingerprint,
            attemptId: `chk_${globalThis.crypto.randomUUID()}`,
          };
        }
        checkoutAttemptId = checkoutAttemptRef.current.attemptId;
      } else {
        checkoutAttemptRef.current = null;
      }

      // Pre-flight authoritative voucher revalidation on fresh attempts to block stale promos
      if (appliedPromo && !isRetryingExistingAttempt) {
        const recheck = await validatePromoCodeForBooking({
          promoCode: appliedPromo.code || '',
          servicePrice,
          serviceId: selectedService.id,
          serviceCategory: selectedService.category,
          serviceCategoryId: selectedService.categoryId,
          serviceDuration: selectedService.duration,
          customerId: targetCustomerId,
          customerAuthUid: canonicalAuthUid,
          customerWhatsApp: customerWhatsApp.trim(),
          customerEmail: customerEmail.trim(),
          homeServiceFee,
          latitude,
          longitude,
          distanceKm,
          customerVoucherId: selectedCustomerVoucher?.id,
          pointsToRedeem: isRedeemingPoints ? pointsToRedeem : 0,
          checkoutAttemptId,
        });

        if (!isCurrentSubmission()) return;
        if (!recheck.valid || !recheck.voucher) {
          if ((recheck as any).retryable) {
            setErrorMsg(recheck.errorMessage || 'Gagal memvalidasi voucher. Silakan coba kirim kembali.');
            return;
          }
          setPromoError(recheck.errorMessage || 'Voucher promo sudah tidak dapat digunakan.');
          setAppliedPromo(null);
          checkoutAttemptRef.current = null;
          setErrorMsg(recheck.errorMessage || 'Voucher tidak lagi memenuhi syarat. Total pembayaran telah diperbarui.');
          return;
        }
      }

      const newBooking = await createBooking({
        checkoutAttemptId,
        customerVoucherId: selectedCustomerVoucher ? selectedCustomerVoucher.id : undefined,
        customerId: targetCustomerId,
        customerAuthUid: canonicalAuthUid,
        authUserId: canonicalAuthUid,
        customerName: customerName.trim(),
        customerWhatsApp: customerWhatsApp.trim(),
        customerEmail: customerEmail.trim() || '',
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        serviceDuration: selectedService.duration,
        scheduleDate,
        scheduleTime,
        scheduleAt: `${scheduleDate} ${scheduleTime}`,
        genderPreference,
        address: address.trim(),
        latitude,
        longitude,
        placeId: placeId || '',
        addressNotes: addressNotes.trim() || '',
        distanceKm,
        distanceMeters,
        requiresAdminConfirmation,
        area: selectedArea,
        servicePrice,
        homeServiceFee,
        // Historical snapshots to protect past bookings from future Master Data edits (Prompt 15B)
        servicePriceSnapshot: servicePrice,
        serviceNameSnapshot: selectedService.name,
        durationMinutesSnapshot: selectedService.duration,
        homeServiceFeeSnapshot: homeServiceFee,
        homeServiceFeeTier: feeCalc.tier,
        baseLocationId: SENZU_BASE_LOCATION.id,
        baseLocationName: SENZU_BASE_LOCATION.name,
        baseLatitude: SENZU_BASE_LOCATION.lat,
        baseLongitude: SENZU_BASE_LOCATION.lng,
        customerLat: latitude,
        customerLng: longitude,
        areaIdSnapshot: matchedArea?.id,
        areaNameSnapshot: matchedArea?.name || selectedArea,
        discountAmount: pricingBreakdown.totalDiscount,
        voucherId: selectedCustomerVoucher ? selectedCustomerVoucher.id : (appliedPromo ? appliedPromo.id : undefined),
        voucherCode: selectedCustomerVoucher ? selectedCustomerVoucher.voucherCode : (appliedPromo ? appliedPromo.code : undefined),
        voucherDiscount: pricingBreakdown.voucherDiscountAmount,
        promoId: appliedPromo ? appliedPromo.id : undefined,
        promoCode: appliedPromo ? appliedPromo.code : undefined,
        promoCodeSnapshot: appliedPromo ? appliedPromo.code : undefined,
        promoNameSnapshot: appliedPromo ? appliedPromo.name : undefined,
        discountTypeSnapshot: appliedPromo ? appliedPromo.voucherType : undefined,
        discountValueSnapshot: appliedPromo ? appliedPromo.value : undefined,
        promoDiscount: pricingBreakdown.promoDiscountAmount,
        pointsRedeemed: pricingBreakdown.pointsRedeemed,
        pointsDiscount: pricingBreakdown.pointsDiscountAmount,
        pointsEarned: pricingBreakdown.estimatedPointsEarned,
        referredByCustomerId: referralMsg?.valid ? referralMsg.referrerAccount?.customerId : undefined,
        referralCodeUsed: referralMsg?.valid ? referralInput.trim().toUpperCase() : undefined,
        membershipTierAtBooking: currentCustomerTier?.name || 'Member',
        totalAmount,
        paymentMethod,
        customerNotes: customerNotes.trim(),
      });

      if (!isCurrentSubmission()) return;
      checkoutAttemptRef.current = null;
      void trackMetaAdsAction('booking_submitted', { entityId: newBooking.id, value: newBooking.totalAmount });
      setSubmittedBooking(newBooking);
      onBookingSuccess(newBooking);
    } catch (err: any) {
      if (!isCurrentSubmission()) return;
      console.error('Error creating booking:', err);
      const msg = err?.message || '';
      const errCode = typeof err?.code === 'string' ? err.code : '';
      const isTransientError =
        errCode === 'NETWORK_ERROR' ||
        errCode === 'MALFORMED_RESPONSE' ||
        errCode === 'VOUCHER_REDEMPTION_UNAVAILABLE' ||
        errCode === 'VOUCHER_CHECKOUT_UNAVAILABLE' ||
        errCode === 'VOUCHER_VALIDATION_UNAVAILABLE' ||
        errCode === 'AUTH_SERVICE_UNAVAILABLE' ||
        err?.status === 503 ||
        err?.status === 502 ||
        err?.status === 504;

      if (isTransientError) {
        setErrorMsg(msg || 'Gagal membuat pesanan. Pastikan koneksi internet Anda stabil.');
      } else {
        checkoutAttemptRef.current = null;

        if (
          errCode.startsWith('VOUCHER_') ||
          errCode.startsWith('CUSTOMER_VOUCHER_') ||
          errCode === 'PRICE_MISMATCH' ||
          errCode === 'DISCOUNT_MISMATCH' ||
          errCode === 'HOME_SERVICE_FEE_MISMATCH' ||
          errCode === 'AUTH_REQUIRED' ||
          errCode === 'SESSION_CHANGED' ||
          msg.includes('sudah pernah digunakan') ||
          msg.includes('Voucher') ||
          msg.includes('voucher') ||
          msg.includes('promo') ||
          msg.includes('diskon')
        ) {
          setPromoError(msg || 'Voucher tidak dapat digunakan pada pesanan ini.');
          if (errCode.startsWith('CUSTOMER_VOUCHER_') || (!appliedPromo && selectedCustomerVoucher)) {
            setSelectedCustomerVoucher(null);
          } else {
            setAppliedPromo(null);
          }
          setErrorMsg(msg || 'Voucher tidak lagi memenuhi syarat. Total pembayaran telah diperbarui.');
        } else {
          setErrorMsg(msg || 'Gagal membuat pesanan. Pastikan koneksi internet Anda stabil.');
        }
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  // Serene empty state if services are empty
  if (services.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center max-w-xl mx-auto shadow-sm my-8">
        <div className="w-14 h-14 rounded-2xl bg-[#082A4F]/10 text-[#082A4F] flex items-center justify-center mx-auto mb-4">
          <Clock className="w-7 h-7 text-[#082A4F]" />
        </div>
        <h3 className="font-serif text-xl font-bold text-[#082A4F]">Menyiapkan Menu Treatment</h3>
        <p className="text-xs text-slate-500 mt-2">
          Layanan home service Senzu sedang disinkronkan. Mohon tunggu sebentar.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-[#D4AF37] animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Success / Customer Payment Flow */}
      {submittedBooking ? (
        <CustomerPaymentPage
          booking={submittedBooking}
          onBackToBooking={() => {
            setSubmittedBooking(null);
            setCustomerName('');
            setCustomerWhatsApp('');
            setCustomerEmail('');
            setAddress('');
            setCustomerNotes('');
          }}
          onOpenTracking={onOpenTracking}
        />
      ) : (
        /* Booking Form */
        <form
          id="booking-form"
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden relative"
        >
          {/* Repeat Order Indicator Banner */}
          {repeatData && (
            <div className="bg-gradient-to-r from-amber-500/15 via-amber-400/20 to-amber-500/15 border-b border-amber-300 p-4 px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#082A4F] text-[#D4AF37] flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-[#082A4F] block">
                    Mode Repeat Order: {repeatData.serviceName || 'Layanan Sebelumnya'}
                  </span>
                  <span className="text-slate-600 text-[11px]">
                    Alamat, kontak, dan catatan telah terisi otomatis. Silakan pilih tanggal & jam kedatangan baru.
                  </span>
                </div>
              </div>
              {onClearRepeatData && (
                <button
                  type="button"
                  onClick={onClearRepeatData}
                  className="text-slate-500 hover:text-slate-800 underline text-[11px] font-semibold cursor-pointer shrink-0"
                >
                  Reset / Pesan Baru
                </button>
              )}
            </div>
          )}

          {/* Header Card */}
          <div className="bg-gradient-to-r from-[#082A4F] via-[#0B3461] to-[#082A4F] text-white p-5 sm:p-8 border-b border-[#D4AF37]/30">
            <div className="inline-flex items-center gap-2 bg-[#D4AF37]/20 border border-[#D4AF37]/40 px-3 py-1 rounded-full text-[11px] font-semibold text-[#FDF3CD] mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
              Reservasi Home Service Palembang
            </div>
            <h2 className="font-serif text-xl sm:text-3xl font-bold tracking-tight text-white">
              Form Reservasi Pijat & Refleksi
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-xl leading-relaxed">
              Terapis berlisensi kami hadir ke rumah, apartemen, atau hotel dengan membawa perlengkapan higienis steril.
            </p>

            {/* Visual Step Progress Indicator */}
            <div className="mt-6 pt-4 border-t border-white/10 grid grid-cols-4 gap-1 sm:gap-2">
              {[
                { step: 1, title: 'Layanan', done: isStep1Done },
                { step: 2, title: 'Jadwal', done: isStep2Done },
                { step: 3, title: 'Lokasi', done: isStep3Done },
                { step: 4, title: 'Bayar', done: isStep4Done },
              ].map((s) => (
                <div key={s.step} className="flex flex-col items-center text-center">
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      s.done
                        ? 'bg-[#D4AF37] text-[#082A4F] shadow-sm'
                        : 'bg-white/10 text-slate-300 border border-white/20'
                    }`}
                  >
                    {s.done ? <Check className="w-4 h-4 stroke-[3]" /> : s.step}
                  </div>
                  <span className="text-[10px] sm:text-xs text-slate-200 mt-1 font-medium truncate w-full">
                    {s.title}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-5 sm:p-8 space-y-8">
            {errorMsg && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-center gap-2.5">
                <Info className="w-5 h-5 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Step 1: Pilih Layanan Treatment */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm sm:text-base font-bold text-[#082A4F] flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#082A4F] text-white text-xs flex items-center justify-center font-sans font-bold">
                    1
                  </span>
                  Pilih Layanan Treatment
                </label>
                <span className="text-[11px] text-slate-500">Durasi & Tarif Resmi</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {(safeServices || []).map((srv) => {
                  const isSelected = srv.id === selectedServiceId;
                  return (
                    <div
                      key={srv.id}
                      onClick={() => setSelectedServiceId(srv.id)}
                      className={`relative rounded-2xl p-4 cursor-pointer transition border-2 flex flex-col justify-between active:scale-[0.99] min-h-[140px] ${
                        isSelected
                          ? 'border-[#082A4F] bg-[#082A4F]/5 shadow-md ring-2 ring-[#082A4F]/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      {srv.isPopular && (
                        <span className="absolute -top-2.5 right-3 bg-gradient-to-r from-[#D4AF37] to-[#B89628] text-[#082A4F] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                          Terfavorit
                        </span>
                      )}

                      <div>
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm text-[#082A4F]">{srv.name}</h4>
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 font-semibold bg-slate-100 px-2 py-0.5 rounded-md">
                            <Clock className="w-3 h-3 text-[#B89628]" />
                            {srv.duration}m
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2 line-clamp-3 leading-relaxed">
                          {srv.description}
                        </p>
                      </div>

                      <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Tarif Layanan:</span>
                        <span className="text-sm font-bold text-[#082A4F]">
                          {formatRupiah(srv.price)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Jadwal & Preferensi Terapis */}
            <div className="space-y-4">
              <label className="text-sm sm:text-base font-bold text-[#082A4F] flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#082A4F] text-white text-xs flex items-center justify-center font-sans font-bold">
                  2
                </span>
                Jadwal Kedatangan & Preferensi Terapis
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-[#082A4F]" />
                    Pilih Tanggal Kedatangan:
                  </label>
                  <input
                    id="input-booking-date"
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    required
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-[#082A4F]" />
                    Pilih Jam Mulai (WIB):
                  </label>
                  <select
                    id="select-booking-time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot} WIB
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Quick Time Slot Chips (Large Touch Targets 44px) */}
              <div>
                <span className="text-[11px] font-semibold text-slate-500 mb-2 block">
                  Pilihan Slot Waktu Cepat:
                </span>
                <div className="flex flex-wrap gap-2">
                  {TIME_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setScheduleTime(slot)}
                      className={`px-3 py-2 min-h-[44px] text-xs rounded-xl font-medium border transition cursor-pointer active:scale-95 ${
                        scheduleTime === slot
                          ? 'bg-[#082A4F] text-white border-[#082A4F] font-bold shadow-sm'
                          : 'bg-[#FAF9F6] hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preferensi Gender Terapis */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  <HeartHandshake className="w-3.5 h-3.5 text-[#082A4F]" />
                  Preferensi Gender Terapis:
                </label>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {(['Bebas', 'Perempuan', 'Laki-laki'] as GenderPreference[]).map((pref) => (
                    <button
                      key={pref}
                      type="button"
                      onClick={() => setGenderPreference(pref)}
                      className={`min-h-[44px] py-2.5 px-3 text-xs font-semibold rounded-xl border transition text-center cursor-pointer active:scale-95 ${
                        genderPreference === pref
                          ? 'bg-[#082A4F] text-white border-[#082A4F] shadow-sm'
                          : 'bg-[#FAF9F6] text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {pref === 'Bebas' ? '✨ Bebas (Tersedia)' : pref}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Supervisor kami akan menugaskan terapis profesional sesuai preferensi kenyamanan Anda.
                </p>
              </div>
            </div>

            {/* Step 3: Alamat & Kontak Pelanggan */}
            <div className="space-y-4">
              <label className="text-sm sm:text-base font-bold text-[#082A4F] flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#082A4F] text-white text-xs flex items-center justify-center font-sans font-bold">
                  3
                </span>
                Data Pemesan & Alamat di Kota Palembang
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-[#082A4F]" />
                    Nama Lengkap: <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="input-customer-name"
                    type="text"
                    placeholder="Contoh: Ibu Amanda / Bpk. David"
                    value={customerName ?? ''}
                    onChange={(e) => setCustomerName(e.target.value)}
                    required
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#082A4F]" />
                    Nomor WhatsApp: <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="input-customer-wa"
                    type="tel"
                    placeholder="Contoh: 08965462xxxx"
                    value={customerWhatsApp ?? ''}
                    onChange={(e) => setCustomerWhatsApp(e.target.value)}
                    required
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white font-medium"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Digunakan untuk konfirmasi & melacak kedatangan terapis.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email (Opsional):
                  </label>
                  <input
                    id="input-customer-email"
                    type="email"
                    placeholder="email@domain.com"
                    value={customerEmail ?? ''}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white"
                  />
                </div>
              </div>

              {/* Quick Saved Addresses Selection for Authenticated Customer */}
              {savedCustomerAddresses.length > 0 && (
                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#082A4F] flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#B89628]" />
                      <span>Gunakan Alamat Tersimpan:</span>
                    </span>
                    <span className="text-[10px] text-slate-500">Pilih untuk isi otomatis</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(savedCustomerAddresses || []).map((addr) => {
                      const isCurrent = address === addr.address;
                      return (
                        <button
                          key={addr.id}
                          type="button"
                          onClick={() => {
                            setAddress(addr.address);
                            if (addr.area) setSelectedArea(addr.area);
                            if (addr.notes) setAddressNotes(addr.notes);
                            if (addr.latitude != null) setLatitude(addr.latitude);
                            if (addr.longitude != null) setLongitude(addr.longitude);
                            if (addr.placeId) setPlaceId(addr.placeId);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                            isCurrent
                              ? 'bg-[#082A4F] text-white border-[#082A4F] shadow-xs'
                              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                          }`}
                        >
                          <span>{addr.label}</span>
                          {addr.isDefault && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-200/80 text-amber-900 font-bold">
                              Utama
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Google Places Address Autocomplete & Interactive Pin Map */}
              <AddressAutocompleteMap
                address={address}
                setAddress={setAddress}
                latitude={latitude}
                setLatitude={setLatitude}
                longitude={longitude}
                setLongitude={setLongitude}
                placeId={placeId}
                setPlaceId={setPlaceId}
                area={selectedArea}
                setArea={setSelectedArea}
                addressNotes={addressNotes}
                setAddressNotes={setAddressNotes}
                distanceKm={distanceKm}
                setDistanceKm={setDistanceKm}
                distanceMeters={distanceMeters}
                setDistanceMeters={setDistanceMeters}
                isCalculatingRoute={isCalculatingRoute}
                setIsCalculatingRoute={setIsCalculatingRoute}
                routeError={routeError}
                setRouteError={setRouteError}
                radiusTiers={settings?.radiusTiers}
                baseLocation={{
                  name: SENZU_BASE_LOCATION.name,
                  lat: SENZU_BASE_LOCATION.lat,
                  lng: SENZU_BASE_LOCATION.lng,
                }}
              />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan Khusus / Keluhan Tubuh (Opsional):
                </label>
                <textarea
                  id="textarea-customer-notes"
                  rows={2}
                  placeholder="Contoh: Fokus pada leher kaku dan betis pegal, hindari tekanan terlalu keras pada pinggang"
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#082A4F] bg-white"
                />
                {repeatData?.therapistName && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 mt-2 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#B89628]" />
                    <span>
                      Permintaan terapis (<strong>{repeatData.therapistName}</strong>) akan disesuaikan dengan ketersediaan jadwal. Supervisor tetap menentukan penugasan final.
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* Step 4: Metode Pembayaran */}
            <div className="space-y-3">
              <label className="text-sm sm:text-base font-bold text-[#082A4F] flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#082A4F] text-white text-xs flex items-center justify-center font-sans font-bold">
                  4
                </span>
                Pilih Metode Pembayaran
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    id: 'QRIS',
                    name: 'QRIS Senzu',
                    desc: 'Scan semua E-Wallet & Mobile Banking',
                    icon: QrCode,
                  },
                  {
                    id: 'Transfer BNI',
                    name: 'Transfer BNI',
                    desc: 'Rekening Resmi PT KSBONE',
                    icon: CreditCard,
                  },
                  {
                    id: 'Transfer Bank Mandiri',
                    name: 'Transfer Bank Mandiri',
                    desc: 'Rekening Resmi PT KSBONE',
                    icon: CreditCard,
                  },
                  {
                    id: 'Transfer BRI',
                    name: 'Transfer BRI',
                    desc: 'Rekening Resmi PT KSBONE',
                    icon: CreditCard,
                  },
                ].map((pm) => {
                  const isSelected = paymentMethod === pm.id;
                  const Icon = pm.icon;
                  return (
                    <div
                      key={pm.id}
                      onClick={() => setPaymentMethod(pm.id as PaymentMethod)}
                      className={`p-3.5 min-h-[64px] rounded-2xl border-2 cursor-pointer transition flex items-center gap-3 active:scale-[0.98] ${
                        isSelected
                          ? 'border-[#082A4F] bg-[#082A4F]/5 shadow-sm ring-1 ring-[#082A4F]'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-[#082A4F] text-white' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[#082A4F]">{pm.name}</div>
                        <div className="text-[11px] text-slate-500">{pm.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Official Non-Cash Policy Notice */}
              <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-2xl text-xs text-blue-900 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#082A4F] flex-shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Kebijakan Pembayaran:</strong> Senzu Home hanya menerima pembayaran non-tunai melalui QRIS Resmi Senzu atau Transfer Bank (BNI, Mandiri, BRI) sebelum jadwal dikonfirmasi.
                </p>
              </div>
            </div>

            {/* Loyalty, Voucher, Points & Referral Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                    <Gift className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#082A4F]">
                      Voucher, Poin & Promo
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Gunakan voucher reward atau tukarkan Senzu Points Anda
                    </p>
                  </div>
                </div>
                {customerLoyalty && (
                  <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#082A4F] text-white flex items-center gap-1">
                    <Coins className="w-3 h-3 text-[#D4AF37]" />
                    {customerLoyalty.pointsBalance} Poin
                  </span>
                )}
              </div>

              {/* Promo Code Input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-600">Kode Promo / Kupon</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                      placeholder="Contoh: SENZUWELCOME"
                      className="w-full pl-9 pr-3 py-2 text-xs uppercase font-mono tracking-wider border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#082A4F] focus:border-[#082A4F] outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyPromo()}
                    className="px-4 py-2 bg-[#082A4F] hover:bg-[#0B3461] text-white text-xs font-semibold rounded-xl transition cursor-pointer"
                  >
                    Terapkan
                  </button>
                </div>
                {promoError && (
                  <p className="text-[11px] text-rose-600 font-medium">{promoError}</p>
                )}
                {appliedPromo && (
                  <div className="flex items-center justify-between p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Promo aktif: <strong>{appliedPromo.code || appliedPromo.name}</strong> ({appliedPromo.voucherType === 'percentage_discount' ? `${appliedPromo.value}%` : formatRupiah(appliedPromo.value)})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedPromo(null);
                        setPromoError('');
                        checkoutAttemptRef.current = null;
                      }}
                      className="text-slate-400 hover:text-slate-600 text-xs underline cursor-pointer"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>

              {/* Customer Vouchers (if any available) */}
              {customerVouchersList.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <label className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                    <Ticket className="w-3.5 h-3.5 text-amber-600" />
                    Voucher Saya ({customerVouchersList.length})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(customerVouchersList || []).map((cv) => {
                      const isSelected = selectedCustomerVoucher?.id === cv.id;
                      return (
                        <div
                          key={cv.id}
                          onClick={() => {
                            setSelectedCustomerVoucher(isSelected ? null : cv);
                            setPromoError('');
                            checkoutAttemptRef.current = null;
                          }}
                          className={`p-2.5 rounded-xl border cursor-pointer transition text-xs flex items-center justify-between ${
                            isSelected
                              ? 'border-[#082A4F] bg-[#082A4F]/5 text-[#082A4F] ring-1 ring-[#082A4F]'
                              : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                          }`}
                        >
                          <div>
                            <div className="font-bold">{cv.voucherName}</div>
                            <div className="text-[10px] text-slate-500">
                              Min. transaksi {formatRupiah(cv.minimumSpend)}
                            </div>
                          </div>
                          <span className="font-bold text-[#082A4F]">
                            {cv.voucherType === 'percentage_discount' ? `${cv.value}%` : formatRupiah(cv.value)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Points Redemption Slider / Checkbox */}
              {customerLoyalty && customerLoyalty.pointsBalance >= (loyaltySettings?.minimumPointsToRedeem || 50) && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                      <Coins className="w-4 h-4 text-amber-500" />
                      Tukarkan Senzu Points
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">
                        Maks. 30% dari transaksi
                      </span>
                      <input
                        type="checkbox"
                        checked={Boolean(isRedeemingPoints)}
                        onChange={(e) => {
                          setIsRedeemingPoints(e.target.checked);
                          if (e.target.checked) {
                            setPointsToRedeem(customerLoyalty.pointsBalance || 0);
                          } else {
                            setPointsToRedeem(0);
                          }
                        }}
                        className="rounded text-[#082A4F] focus:ring-[#082A4F] w-4 h-4 cursor-pointer"
                      />
                    </div>
                  </div>
                  {isRedeemingPoints && (
                    <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-amber-900 font-medium">Poin Ditukarkan: {pricingBreakdown.pointsRedeemed} Poin</span>
                        <span className="font-bold text-amber-800">
                          - {formatRupiah(pricingBreakdown.pointsDiscountAmount)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={loyaltySettings?.minimumPointsToRedeem || 50}
                        max={customerLoyalty.pointsBalance || 0}
                        step={10}
                        value={pointsToRedeem ?? 0}
                        onChange={(e) => setPointsToRedeem(Number(e.target.value))}
                        className="w-full accent-[#082A4F] cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Min: {loyaltySettings?.minimumPointsToRedeem || 50} Poin</span>
                        <span>Maks Tersedia: {customerLoyalty.pointsBalance} Poin</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Referral Code (Only if customer is not yet a frequent repeat client or enters code) */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <label className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  Punya Kode Referral Teman?
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={referralInput}
                    onChange={(e) => {
                      setReferralInput(e.target.value.toUpperCase());
                      setReferralMsg(null);
                    }}
                    placeholder="Contoh: SENZU-ALEX89"
                    className="flex-1 px-3 py-2 text-xs uppercase font-mono tracking-wider border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#082A4F] focus:border-[#082A4F] outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCheckReferral}
                    disabled={isCheckingReferral || !referralInput.trim()}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer disabled:opacity-50"
                  >
                    {isCheckingReferral ? 'Cek...' : 'Validasi'}
                  </button>
                </div>
                {referralMsg && (
                  <p className={`text-[11px] font-medium ${referralMsg.valid ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {referralMsg.message}
                  </p>
                )}
              </div>
            </div>

            {/* Rincian Biaya & Total */}
            <div className="bg-[#FAF9F6] border border-slate-200 rounded-2xl p-5 space-y-2.5">
              <div className="text-xs uppercase tracking-wider font-bold text-slate-500">
                Rincian Biaya Layanan
              </div>

              <div className="flex justify-between text-xs sm:text-sm text-slate-700">
                <span>Subtotal Layanan</span>
                <span className="font-semibold text-slate-900">{formatRupiah(servicePrice)}</span>
              </div>

              {/* Home Service Fee according to Authoritative Route Distance Rules */}
              <div className="flex justify-between text-xs sm:text-sm text-slate-700 items-center">
                <span>Biaya Home Service</span>
                <span className={`font-semibold ${feeCalc.isFree ? 'text-emerald-700 font-bold' : 'text-[#082A4F]'}`}>
                  {feeCalc.isFree ? 'GRATIS' : formatRupiah(homeServiceFee)}
                </span>
              </div>

              {routeError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p>{routeError}</p>
                </div>
              )}

              {pricingBreakdown.totalDiscount > 0 && (
                <div className="flex justify-between text-xs sm:text-sm text-emerald-700 font-medium">
                  <span>Diskon</span>
                  <span>- {formatRupiah(pricingBreakdown.totalDiscount)}</span>
                </div>
              )}

              {/* Point Earning Estimate Badge */}
              <div className="p-2.5 bg-gradient-to-r from-amber-50 to-amber-100/50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900">
                <span className="flex items-center gap-1.5 font-medium">
                  <SparklesIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  Estimasi Poin yang Didapat:
                </span>
                <span className="font-bold text-[#082A4F]">
                  +{pricingBreakdown.estimatedPointsEarned} Senzu Points
                </span>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                <div>
                  <span className="text-sm sm:text-base font-bold text-[#082A4F]">
                    Total Pembayaran:
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Termasuk minyak aromaterapi & perlengkapan higienis
                  </p>
                </div>
                <span className="text-xl sm:text-2xl font-bold font-serif text-[#082A4F]">
                  {formatRupiah(totalAmount)}
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              id="btn-submit-booking"
              type="submit"
              disabled={isSubmitting || isCalculatingRoute || Boolean(routeError)}
              className="w-full min-h-[52px] py-3.5 rounded-2xl bg-gradient-to-r from-[#082A4F] via-[#0E3D73] to-[#082A4F] hover:from-[#0B3461] hover:to-[#0B3461] text-white font-semibold text-base shadow-lg shadow-[#082A4F]/20 flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Sedang Memproses Reservasi...</span>
                </div>
              ) : isCalculatingRoute ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 text-[#D4AF37] animate-spin" />
                  <span>Menghitung Rute Berkendara...</span>
                </div>
              ) : routeError ? (
                <div className="flex items-center gap-2 text-amber-200">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  <span>Pilih Titik Lokasi Valid</span>
                </div>
              ) : (
                <>
                  <span>Konfirmasi & Ajukan Booking Senzu</span>
                  <ChevronRight className="w-5 h-5 text-[#D4AF37]" />
                </>
              )}
            </button>

            <div className="text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5 pb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Privasi aman. Kode booking otomatis tercatat dan dapat dilacak kapan saja.</span>
            </div>
          </div>

          {/* Mobile Sticky Summary Bar (lg:hidden) */}
          <div className="sticky bottom-0 left-0 right-0 z-30 lg:hidden bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 pb-safe shadow-lg flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] text-slate-500 truncate max-w-[150px]">
                {selectedService?.name || 'Senzu Home'}
              </div>
              <div className="text-base font-bold font-serif text-[#082A4F]">
                {formatRupiah(totalAmount)}
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting || isCalculatingRoute || Boolean(routeError)}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0B3461] text-white text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <span>Memproses...</span>
              ) : isCalculatingRoute ? (
                <span>Menghitung...</span>
              ) : routeError ? (
                <span>Lokasi Belum Valid</span>
              ) : (
                <>
                  <span>Pesan Sekarang</span>
                  <ArrowRight className="w-4 h-4 text-[#D4AF37]" />
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
