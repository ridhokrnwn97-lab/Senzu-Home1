import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Sparkles,
  ShieldCheck,
  Clock,
  MapPin,
  Heart,
  Search,
  UserCheck,
  ChevronDown,
  Phone,
  CheckCircle2,
  Calendar,
  Layers,
  HelpCircle,
  Info
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CustomerAuthProvider, useCustomerAuth } from './context/CustomerAuthContext';
import { CustomerLoginModal } from './components/CustomerLoginModal';
import { CustomerRegisterModal } from './components/CustomerRegisterModal';
import { Navbar } from './components/Navbar';
import { BookingForm } from './components/BookingForm';
import { XenditLiveReturn } from './components/customer/XenditLiveReturn';
import { CustomerTrackingModal } from './components/CustomerTrackingModal';
import { StaffLoginModal } from './components/StaffLoginModal';
import { CssAdminDashboard } from './components/CssAdminDashboard';
import { SupervisorControlRoom } from './components/SupervisorControlRoom';
import { TherapistDashboard } from './components/TherapistDashboard';
import { ExcelReportView } from './components/ExcelReportView';
import { ManagementDashboard } from './components/ManagementDashboard';
import { CustomerCrmView } from './components/CustomerCrmView';
import { LoyaltyAdminView } from './components/LoyaltyAdminView';
import { AdminSettingsView } from './components/AdminSettingsView';
import { ManagerPortal } from './components/manager/ManagerPortal';
import { PaymentReconciliationView } from './components/PaymentReconciliationView';
import { GoogleMapsProvider } from './components/GoogleMapsProvider';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { CustomerPortalModal } from './components/CustomerPortalModal';
import { ForcedPasswordChangeModal } from './components/ForcedPasswordChangeModal';
import { MobileHomeView } from './components/MobileHomeView';
import { CustomerOrdersView } from './components/CustomerOrdersView';
import { CustomerRewardsView } from './components/CustomerRewardsView';
import { CustomerAccountView } from './components/CustomerAccountView';
import { InitialManagerSetupView } from './components/InitialManagerSetupView';
import { AccountDeletionPublicView } from './components/AccountDeletionPublicView';
import { PrivacyPolicyPublicView } from './components/PrivacyPolicyPublicView';
import { MobileBottomNav, CustomerTabType } from './components/MobileBottomNav';
import { SenzuLogo } from './components/SenzuLogo';
import { SenzuSplashScreen } from './components/SenzuSplashScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useCustomerServiceWhatsApp } from './lib/supportWhatsApp';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  Booking,
  ServiceItem,
  AppSettings,
  Therapist,
  CustomerCRM
} from './types';
import {
  initializeSeedData,
  getServices,
  getSettings,
  getTherapists,
  subscribeToAllBookings,
  subscribeToCustomerBookings,
  subscribeToTherapistBookings,
  getAllCustomers,
  DEFAULT_SERVICES,
  DEFAULT_SETTINGS,
  DEFAULT_THERAPISTS,
} from './lib/dbService';
import {
  subscribeToRoleNotifications,
  subscribeToCustomerNotifications,
} from './lib/notificationService';
import { ChatNotificationBanner, ChatNotificationItem } from './components/chat/ChatNotificationBanner';
import { BookingChatModal } from './components/chat/BookingChatModal';
import {
  subscribeToChatBannerNotifications,
  subscribeToActiveBookingsChatNotifications,
  unregisterNotificationDevice,
} from './lib/chatNotificationManager';
import { isChatEligibleForBooking } from './lib/chatService';
import { db, auth } from './lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

function MainApp() {
  const { currentUser, isPasswordChangeRequired } = useAuth();
  const { currentCustomer, firebaseUser } = useCustomerAuth();

  const [activeStaffTab, setActiveStaffTab] = useState<string>('home');
  const [customerTab, setCustomerTab] = useState<CustomerTabType>('home');
  const [preselectedServiceId, setPreselectedServiceId] = useState<string>('');
  const [preselectedPromoCode, setPreselectedPromoCode] = useState<string>('');
  const [isTrackingOpen, setIsTrackingOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isCustomerPortalOpen, setIsCustomerPortalOpen] = useState(false);
  const [isCustomerLoginOpen, setIsCustomerLoginOpen] = useState(false);
  const [isCustomerRegisterOpen, setIsCustomerRegisterOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [initialTrackCode, setInitialTrackCode] = useState('');
  const [initialTherapistBookingId, setInitialTherapistBookingId] = useState('');
  const [repeatBookingData, setRepeatBookingData] = useState<Partial<Booking> | null>(null);
  const [showSplash, setShowSplash] = useState(true);

  // In-App Chat Notification Banner & Modal States (Prompt Sections 1, 3, 4, 10, 11)
  const [activeChatBanner, setActiveChatBanner] = useState<ChatNotificationItem | null>(null);
  const [modalChatBooking, setModalChatBooking] = useState<Booking | null>(null);
  const [chatNoticeToast, setChatNoticeToast] = useState<string | null>(null);

  // Initial Manager Setup route listener (/initial-manager-setup)
  const [isInitialSetupRoute, setIsInitialSetupRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    const hash = window.location.hash;
    const search = window.location.search;
    return (
      path === '/initial-manager-setup' ||
      hash === '#initial-manager-setup' ||
      search.includes('route=initial-manager-setup')
    );
  });
  const [initialLoginEmail, setInitialLoginEmail] = useState<string>('');

  // Public Account Deletion route listener (/hapus-akun) - Google Play Compliance
  const checkIsHapusAkunRoute = () => {
    if (typeof window === 'undefined') return false;
    const rawPath = window.location.pathname;
    const path = rawPath.replace(/\/+$/, '') || '/';
    const hash = window.location.hash.replace(/\/+$/, '');
    const search = window.location.search;
    return (
      path === '/hapus-akun' ||
      path === '/delete-account' ||
      hash === '#hapus-akun' ||
      hash === '#/hapus-akun' ||
      hash === '#delete-account' ||
      hash === '#/delete-account' ||
      search.includes('route=hapus-akun') ||
      search.includes('route=delete-account')
    );
  };
  const [isHapusAkunRoute, setIsHapusAkunRoute] = useState<boolean>(checkIsHapusAkunRoute);

  // Public Privacy Policy route listener (/kebijakan-privasi) - Google Play Compliance
  const checkIsKebijakanPrivasiRoute = () => {
    if (typeof window === 'undefined') return false;
    const rawPath = window.location.pathname;
    const path = rawPath.replace(/\/+$/, '') || '/';
    const hash = window.location.hash.replace(/\/+$/, '');
    const search = window.location.search;
    return (
      path === '/kebijakan-privasi' ||
      path === '/privacy-policy' ||
      path === '/privacy' ||
      hash === '#kebijakan-privasi' ||
      hash === '#/kebijakan-privasi' ||
      hash === '#privacy-policy' ||
      hash === '#/privacy-policy' ||
      hash === '#privacy' ||
      hash === '#/privacy' ||
      search.includes('route=kebijakan-privasi') ||
      search.includes('route=privacy-policy') ||
      search.includes('route=privacy')
    );
  };
  const [isKebijakanPrivasiRoute, setIsKebijakanPrivasiRoute] = useState<boolean>(checkIsKebijakanPrivasiRoute);

  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      const search = window.location.search;
      setIsInitialSetupRoute(
        path === '/initial-manager-setup' ||
        hash === '#initial-manager-setup' ||
        search.includes('route=initial-manager-setup')
      );
      setIsHapusAkunRoute(checkIsHapusAkunRoute());
      setIsKebijakanPrivasiRoute(checkIsKebijakanPrivasiRoute());
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  // Data state initialized with reliable defaults to prevent uninitialized access
  const [services, setServices] = useState<ServiceItem[]>(DEFAULT_SERVICES);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [therapists, setTherapists] = useState<Therapist[]>(DEFAULT_THERAPISTS);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [customers, setCustomers] = useState<CustomerCRM[]>([]);

  // Centralized Official Senzu Customer Service WhatsApp Hook
  const {
    isAvailable: isCsAvailable,
    getWhatsAppUrl: getCsWhatsAppUrl,
    unavailableNotice: csUnavailableNotice,
    whatsAppNumber: officialCsWhatsApp,
  } = useCustomerServiceWhatsApp();

  // Active orders count badge for bottom nav (customer-specific if phone/last booking known)
  const activeOrdersCount = useMemo(() => {
    if (firebaseUser || currentCustomer) {
      const authUid = firebaseUser?.uid || currentCustomer?.authUserId;
      return bookings.filter((b) => {
        const matchesCustomer =
          (authUid && (b.customerAuthUid === authUid || (b as any).authUserId === authUid)) ||
          (currentCustomer?.id && b.customerId === currentCustomer.id);
        const s = (b.status || '').toLowerCase();
        return matchesCustomer && !['completed', 'cancelled', 'rejected', 'refunded', 'expired'].includes(s);
      }).length;
    }
    const savedPhone = localStorage.getItem('senzu_customer_phone');
    const savedCode = localStorage.getItem('senzu_last_booking_code');
    if (savedPhone) {
      const cleanPhone = savedPhone.replace(/[^0-9]/g, '');
      return bookings.filter(
        (b) =>
          b.customerWhatsApp.replace(/[^0-9]/g, '').includes(cleanPhone) &&
          !['completed', 'cancelled', 'rejected', 'refunded', 'expired'].includes((b.status || '').toLowerCase())
      ).length;
    }
    if (savedCode) {
      const found = bookings.find((b) => b.bookingCode === savedCode);
      if (found && !['completed', 'cancelled', 'rejected', 'refunded', 'expired'].includes((found.status || '').toLowerCase())) {
        return 1;
      }
    }
    return 0;
  }, [bookings, firebaseUser, currentCustomer]);

  // Realtime notification badge listener
  useEffect(() => {
    const session = auth.currentUser;
    const uid = session?.uid;
    let live = true;
    setUnreadNotifCount(0);
    if (!uid) return;
    const receive = (notifs: any[]) => {
      if (live && auth.currentUser === session && auth.currentUser?.uid === uid) setUnreadNotifCount(notifs.filter(n => !n.read).length);
    };
    const unsubscribe = currentUser
      ? subscribeToRoleNotifications(currentUser.role as any, currentUser.uid || uid, receive)
      : subscribeToCustomerNotifications({ customerAuthUid: uid }, receive);
    return () => { live = false; unsubscribe(); setUnreadNotifCount(0); };
  }, [currentUser, firebaseUser?.uid, currentCustomer?.id]);

  // Load initial data and subscriptions with Phase 6 & Phase 7 Privacy & Data Minimization
  useEffect(() => {
    let unsubscribeBookings: (() => void) | undefined;

    const loadData = async () => {
      try {
        await initializeSeedData();
      } catch {}

      const srv = await getServices();
      setServices(srv.length > 0 ? srv : DEFAULT_SERVICES);
      const stg = await getSettings();
      setSettings(stg || DEFAULT_SETTINGS);
      const th = await getTherapists();
      setTherapists(th.length > 0 ? th : DEFAULT_THERAPISTS);

      // Phase 6 & 7: Operational data loading is strictly scoped by role
      if (currentUser && ['css', 'supervisor', 'manager', 'admin'].includes(currentUser.role)) {
        // Operational staff: Load customer CRM and operational bookings
        const cust = await getAllCustomers();
        setCustomers(cust);

        unsubscribeBookings = subscribeToAllBookings((updatedBookings) => {
          setBookings(updatedBookings);
        });
      } else if (currentUser && currentUser.role === 'therapist') {
        // Therapist: Only subscribe to jobs assigned to this therapist (never full company bookings)
        const thId = (currentUser as any).therapistId || currentUser.uid;
        unsubscribeBookings = subscribeToTherapistBookings(thId, (thBookings) => {
          setBookings(thBookings);
        });
        setCustomers([]);
      } else if (firebaseUser || currentCustomer) {
        // Authenticated Customer: Authoritative subscription scoped to own reservations
        const authUid = firebaseUser?.uid || currentCustomer?.authUserId;
        unsubscribeBookings = subscribeToCustomerBookings({
          authUid,
          customerId: currentCustomer?.id,
          customerWhatsApp: currentCustomer?.phone || currentCustomer?.whatsapp,
          onSuccess: (custBookings) => {
            setBookings(custBookings);
          },
          onError: (err) => {
            console.warn('[Customer Bookings] Subscription notice:', err?.message);
          },
        });
        setCustomers([]);
      } else {
        // Public visitor / guest: Never dump full company bookings or CRM customers
        setBookings([]);
        setCustomers([]);
      }
    };

    loadData();

    return () => {
      if (unsubscribeBookings) unsubscribeBookings();
    };
  }, [currentUser, currentCustomer, firebaseUser]);

  // When staff logs in (and completes required password change), automatically show their relevant role dashboard once
  const lastNavigatedUserUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentUser && !isPasswordChangeRequired && lastNavigatedUserUidRef.current !== currentUser.uid) {
      lastNavigatedUserUidRef.current = currentUser.uid;
      const normRole = (currentUser.role || '').toLowerCase().trim();
      if (normRole === 'css') setActiveStaffTab('css');
      else if (normRole === 'supervisor') setActiveStaffTab('supervisor');
      else if (normRole === 'therapist') setActiveStaffTab('therapist');
      else if (normRole === 'manager' || normRole === 'admin') setActiveStaffTab('management');
    }
  }, [currentUser, isPasswordChangeRequired]);

  // Clean URL openChat parameter safely
  const cleanOpenChatUrl = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('openChat')) {
        url.searchParams.delete('openChat');
        const newUrl =
          url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') + url.hash;
        window.history.replaceState({}, '', newUrl);
      }
    } catch {}
  }, []);

  // Authoritatively open chat modal from in-app banner or system notification tap (Section 10, 11)
  const handleOpenChatByBookingId = useCallback(
    (bookingId: string) => {
      if (!bookingId) return;

      const targetBooking = bookings.find((b) => b.id === bookingId || b.bookingCode === bookingId);
      if (targetBooking) {
        const eligibility = isChatEligibleForBooking(targetBooking);
        if (eligibility.isTerminal) {
          setChatNoticeToast('Percakapan ini sudah ditutup.');
          setTimeout(() => setChatNoticeToast(null), 4000);
          cleanOpenChatUrl();
          return;
        }
        setModalChatBooking(targetBooking);
      } else {
        getDoc(doc(db, 'bookings', bookingId))
          .then((snap) => {
            if (snap.exists()) {
              const bData = { id: snap.id, ...snap.data() } as Booking;
              const eligibility = isChatEligibleForBooking(bData);
              if (eligibility.isTerminal) {
                setChatNoticeToast('Percakapan ini sudah ditutup.');
                setTimeout(() => setChatNoticeToast(null), 4000);
                cleanOpenChatUrl();
                return;
              }
              setModalChatBooking(bData);
            } else {
              setChatNoticeToast('Data pesanan tidak ditemukan.');
              setTimeout(() => setChatNoticeToast(null), 4000);
              cleanOpenChatUrl();
            }
          })
          .catch(() => {
            cleanOpenChatUrl();
          });
      }
    },
    [bookings, cleanOpenChatUrl]
  );

  // URL query parameter (?openChat=...) and popstate listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkUrlForChat = () => {
      const params = new URLSearchParams(window.location.search);
      const openChatId = params.get('openChat');
      if (openChatId) {
        handleOpenChatByBookingId(openChatId);
      }
    };
    checkUrlForChat();
    window.addEventListener('popstate', checkUrlForChat);
    return () => {
      window.removeEventListener('popstate', checkUrlForChat);
    };
  }, [handleOpenChatByBookingId]);

  // Service Worker background notification tap postMessage listener (Section 10)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleSwMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'OPEN_BOOKING_CHAT' && e.data.bookingId) {
        handleOpenChatByBookingId(e.data.bookingId);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [handleOpenChatByBookingId]);

  // Subscribe to in-app notification banner listener (Section 4)
  useEffect(() => {
    const unsub = subscribeToChatBannerNotifications((item) => {
      setActiveChatBanner(item);
    });
    return () => unsub();
  }, []);

  // Realtime foreground chat notifications across active bookings
  useEffect(() => {
    const userRole = currentUser?.role === 'therapist' ? 'therapist' : 'customer';
    const userId = currentUser?.uid || firebaseUser?.uid || currentCustomer?.id || '';
    const unsub = subscribeToActiveBookingsChatNotifications(bookings, userRole, userId);
    return () => unsub();
  }, [bookings, currentUser, firebaseUser, currentCustomer]);

  // Session / Route guard: When staff logs out, reset active tab and open Staff Login modal
  const prevUserRef = useRef(currentUser);
  useEffect(() => {
    if (prevUserRef.current && !currentUser) {
      if (prevUserRef.current.uid) {
        unregisterNotificationDevice(prevUserRef.current.uid);
      }
      lastNavigatedUserUidRef.current = null;
      if (activeStaffTab !== 'home') {
        setActiveStaffTab('home');
      }
      setIsLoginOpen(true);
    }
    prevUserRef.current = currentUser;
  }, [currentUser, activeStaffTab]);

  // Customer device unregistration on logout or account switch (Section 7)
  const prevCustomerRef = useRef(currentCustomer);
  useEffect(() => {
    if (prevCustomerRef.current && !currentCustomer) {
      const custId = prevCustomerRef.current.authUserId || prevCustomerRef.current.id;
      if (custId) {
        unregisterNotificationDevice(custId);
      }
    }
    prevCustomerRef.current = currentCustomer;
  }, [currentCustomer]);

  const handleBookingCreated = (newBooking: Booking) => {
    setInitialTrackCode(newBooking.bookingCode);
    if (!currentUser) {
      localStorage.setItem('senzu_last_booking_code', newBooking.bookingCode);
      if (newBooking.customerWhatsApp) {
        localStorage.setItem('senzu_customer_phone', newBooking.customerWhatsApp);
      }
      if (newBooking.customerName) {
        localStorage.setItem('senzu_customer_name', newBooking.customerName);
      }
    }
    // Refresh customers list
    getAllCustomers().then(setCustomers);
  };

  const handleOpenTrackingWithCode = (code: string) => {
    setInitialTrackCode(code);
    setIsTrackingOpen(true);
  };

  const handleRefreshSettings = async () => {
    const srv = await getServices();
    setServices(srv);
    const stg = await getSettings();
    setSettings(stg);
  };

  const handleRefreshCustomers = async () => {
    const cust = await getAllCustomers();
    setCustomers(cust);
  };

  const handleRepeatBooking = (booking: Partial<Booking>) => {
    setRepeatBookingData(booking);
    setPreselectedServiceId('');
    setActiveStaffTab('home');
    setCustomerTab('booking');
    setTimeout(() => {
      const formEl = document.getElementById('booking-section');
      if (formEl) {
        formEl.scrollIntoView({ behavior: 'smooth' });
      }
    }, 150);
  };

  const handleGoHome = () => {
    setActiveStaffTab('home');
    setCustomerTab('home');
    setIsTrackingOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isHapusAkunRoute) {
    return (
      <AccountDeletionPublicView
        onBack={() => {
          setIsHapusAkunRoute(false);
          window.history.pushState({}, '', '/');
        }}
      />
    );
  }

  if (isKebijakanPrivasiRoute) {
    return (
      <PrivacyPolicyPublicView
        onBack={() => {
          setIsKebijakanPrivasiRoute(false);
          window.history.pushState({}, '', '/');
        }}
        onGoToHapusAkun={() => {
          setIsKebijakanPrivasiRoute(false);
          setIsHapusAkunRoute(true);
          window.history.pushState({}, '', '/hapus-akun');
        }}
      />
    );
  }

  if (isInitialSetupRoute) {
    return (
      <div className="min-h-screen bg-slate-900">
        <InitialManagerSetupView
          onComplete={(managerEmail) => {
            setIsInitialSetupRoute(false);
            window.history.pushState({}, '', '/');
            setInitialLoginEmail(managerEmail);
            setIsLoginOpen(true);
          }}
          onGoToLogin={() => {
            setIsInitialSetupRoute(false);
            window.history.pushState({}, '', '/');
            setIsLoginOpen(true);
          }}
        />
        <StaffLoginModal
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          onLoginSuccess={(staff) => {
            if (staff.role === 'css') setActiveStaffTab('css');
            else if (staff.role === 'supervisor') setActiveStaffTab('supervisor');
            else if (staff.role === 'therapist') setActiveStaffTab('therapist');
            else if (staff.role === 'manager' || staff.role === 'admin') setActiveStaffTab('management');
          }}
          initialEmail={initialLoginEmail}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <PWAInstallBanner />
      <OfflineIndicator />
      {/* Navbar */}
      <Navbar
        onGoHome={handleGoHome}
        customerTab={customerTab}
        isTrackingOpen={isTrackingOpen}
        onOpenTracking={() => {
          setInitialTrackCode('');
          setIsTrackingOpen(true);
        }}
        onOpenCustomerPortal={() => {
          setActiveStaffTab('home');
          setCustomerTab('orders');
          setIsTrackingOpen(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenAccount={() => {
          setActiveStaffTab('home');
          setCustomerTab('account');
          setIsTrackingOpen(false);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenLogin={() => setIsLoginOpen(true)}
        activeStaffTab={activeStaffTab}
        setActiveStaffTab={setActiveStaffTab}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        unreadNotificationCount={unreadNotifCount}
        bookings={bookings}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* CUSTOMER VIEWS */}
        {activeStaffTab === 'home' && (
          <div className="space-y-6">
            {/* 1. Beranda */}
            {customerTab === 'home' && (
              <MobileHomeView
                services={services}
                bookings={bookings}
                settings={settings}
                onStartBooking={(serviceId, promoCode) => {
                  setPreselectedServiceId(serviceId || '');
                  if (promoCode) setPreselectedPromoCode(promoCode);
                  setCustomerTab('booking');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onOpenTracking={(code) => {
                  setInitialTrackCode(code || '');
                  setIsTrackingOpen(true);
                }}
                onRepeatBooking={handleRepeatBooking}
                onOpenRewards={() => {
                  setCustomerTab('rewards');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onOpenOrders={() => {
                  setCustomerTab('orders');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onOpenAccount={() => {
                  setCustomerTab('account');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onOpenChat={(b) => setModalChatBooking(b)}
              />
            )}

            {/* 2. Pesanan Saya */}
            {customerTab === 'orders' && (
              <CustomerOrdersView
                bookings={bookings}
                onOpenTracking={(code) => {
                  setInitialTrackCode(code);
                  setIsTrackingOpen(true);
                }}
                onRepeatBooking={handleRepeatBooking}
                onStartBooking={() => {
                  setPreselectedServiceId('');
                  setCustomerTab('booking');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            )}

            {/* 3. Booking Form */}
            {customerTab === 'booking' && (
              <div id="booking-section" className="space-y-4 pb-20">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => setCustomerTab('home')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#4B2B18] hover:text-[#D4AF37] cursor-pointer"
                  >
                    <span>← Kembali ke Beranda</span>
                  </button>
                  <span className="text-[11px] text-slate-500 font-medium">Reservasi Online Palembang</span>
                </div>

                <ErrorBoundary
                  scopeName="BookingForm"
                  fallbackTitle="Kendala Memuat Formulir Reservasi"
                  fallbackMessage="Terjadi kendala teknis saat memuat formulir booking. Silakan coba lagi atau kembali ke beranda."
                  onBack={() => setCustomerTab('home')}
                  backButtonLabel="Kembali ke Beranda"
                >
                  <BookingForm
                    services={services}
                    settings={settings}
                    onBookingSuccess={(b) => {
                      setPreselectedPromoCode('');
                      setPreselectedServiceId('');
                      handleBookingCreated(b);
                    }}
                    onOpenTracking={handleOpenTrackingWithCode}
                    repeatData={repeatBookingData}
                    onClearRepeatData={() => setRepeatBookingData(null)}
                    initialServiceId={preselectedServiceId}
                    initialPromoCode={preselectedPromoCode}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* 4. Rewards & Loyalty */}
            {customerTab === 'rewards' && (
              <ErrorBoundary
                scopeName="CustomerRewards"
                onBack={() => setCustomerTab('home')}
                backButtonLabel="Kembali ke Beranda"
              >
                <CustomerRewardsView
                  onStartBooking={() => {
                    setPreselectedServiceId('');
                    setCustomerTab('booking');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onRequestLogin={() => setIsCustomerLoginOpen(true)}
                  onRequestRegister={() => setIsCustomerRegisterOpen(true)}
                />
              </ErrorBoundary>
            )}

            {/* 5. Akun & Profil */}
            {customerTab === 'account' && (
              <CustomerAccountView
                onOpenOrders={() => {
                  setCustomerTab('orders');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onOpenRewards={() => {
                  setCustomerTab('rewards');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onOpenLogin={() => setIsLoginOpen(true)}
                onOpenTracking={() => {
                  setInitialTrackCode('');
                  setIsTrackingOpen(true);
                }}
                contactWhatsApp={officialCsWhatsApp || settings.contactWhatsApp}
                onOpenCustomerLogin={() => setIsCustomerLoginOpen(true)}
                onOpenCustomerRegister={() => setIsCustomerRegisterOpen(true)}
              />
            )}
          </div>
        )}

        {/* CSS ADMIN DASHBOARD */}
        {activeStaffTab === 'css' && (
          currentUser && ['admin', 'css', 'manager'].includes(currentUser.role) ? (
            <CssAdminDashboard bookings={bookings} />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Akses Dibatasi</h3>
              <p className="text-xs text-slate-500">
                Halaman ini khusus untuk tim Customer Service & Admin Senzu Home. Silakan login dengan akun yang memiliki akses.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl"
              >
                Login Staff
              </button>
            </div>
          )
        )}

        {/* REKONSILIASI PEMBAYARAN */}
        {activeStaffTab === 'reconciliation' && (
          currentUser && ['admin', 'manager', 'css'].includes(currentUser.role) ? (
            <PaymentReconciliationView bookings={bookings} />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Akses Rekonsiliasi Dibatasi</h3>
              <p className="text-xs text-slate-500">
                Halaman rekonsiliasi dan verifikasi mutasi bank khusus untuk tim keuangan & admin Senzu Home.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl"
              >
                Login Staff
              </button>
            </div>
          )
        )}

        {/* SUPERVISOR CONTROL ROOM */}
        {activeStaffTab === 'supervisor' && (
          currentUser && ['admin', 'supervisor', 'manager'].includes(currentUser.role) ? (
            <SupervisorControlRoom bookings={bookings} therapists={therapists} services={services} settings={settings} />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Akses Dibatasi</h3>
              <p className="text-xs text-slate-500">
                Halaman ini khusus untuk Supervisor Operasional Senzu Home.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl"
              >
                Login Staff
              </button>
            </div>
          )
        )}

        {/* THERAPIST PORTAL */}
        {activeStaffTab === 'therapist' && (
          currentUser && ['admin', 'therapist'].includes(currentUser.role) ? (
            <TherapistDashboard
              bookings={bookings}
              therapists={therapists}
              initialBookingId={initialTherapistBookingId}
            />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Portal Terapis Senzu</h3>
              <p className="text-xs text-slate-500">
                Silakan login menggunakan akun Terapis Anda untuk melihat daftar pesanan yang ditugaskan kepada Anda.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl"
              >
                Login Terapis
              </button>
            </div>
          )
        )}

        {/* EXCEL REPORTING */}
        {activeStaffTab === 'report' && (
          currentUser && ['admin', 'manager', 'css'].includes(currentUser.role) ? (
            <ExcelReportView
              bookings={bookings}
              services={services}
              therapists={therapists}
            />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Akses Laporan Terbatas</h3>
              <p className="text-xs text-slate-500">
                Hanya staf manajemen dan admin yang memiliki otoritas melihat dan mengekspor laporan keuangan.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl"
              >
                Login Staff
              </button>
            </div>
          )
        )}

        {/* MANAGER PORTAL & MASTER DATA */}
        {(activeStaffTab === 'management' || activeStaffTab === 'settings') && (
          currentUser && ['admin', 'manager'].includes(currentUser.role) ? (
            <ManagerPortal
              settings={settings}
              services={services}
              currentUser={currentUser}
              bookings={bookings}
              customers={customers}
              therapists={therapists}
              onRefresh={handleRefreshSettings}
              initialSection={activeStaffTab === 'settings' ? 'master_data' : 'dashboard'}
            />
          ) : (
            <div className="bg-white p-8 rounded-3xl border border-red-200 text-center space-y-4 max-w-md mx-auto my-12 shadow-sm">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Portal Manager &amp; Master Data</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Sesuai <strong>Master Data Ownership Rule</strong>, seluruh Master Data bisnis dan Portal Manager hanya dapat diakses oleh <strong>Branch Manager</strong> dan <strong>Admin</strong>. Staf operasional (Supervisor, CSS, Terapis) beroperasi menggunakan data operasional yang telah ditetapkan.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-5 py-2.5 bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold rounded-xl cursor-pointer transition shadow-xs"
              >
                Login Akun Manager
              </button>
            </div>
          )
        )}

        {/* CRM PELANGGAN */}
        {activeStaffTab === 'crm' && (
          currentUser && ['admin', 'manager', 'css'].includes(currentUser.role) ? (
            <CustomerCrmView
              customers={customers}
              bookings={bookings}
              currentUser={currentUser}
              onRefreshCustomers={handleRefreshCustomers}
              onRepeatBooking={handleRepeatBooking}
            />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Database CRM Pelanggan</h3>
              <p className="text-xs text-slate-500">
                Akses database pelanggan memerlukan otorisasi tim admin atau CSS.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl"
              >
                Login Staff
              </button>
            </div>
          )
        )}

        {/* LOYALTY & REWARDS ADMIN */}
        {activeStaffTab === 'loyalty' && (
          currentUser && ['admin', 'manager', 'css'].includes(currentUser.role) ? (
            <LoyaltyAdminView
              bookings={bookings}
              customers={customers}
              currentUser={currentUser}
            />
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center space-y-4 max-w-md mx-auto my-12">
              <ShieldCheck className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="font-bold text-[#4B2B18] text-lg">Akses Program Loyalitas Dibatasi</h3>
              <p className="text-xs text-slate-500">
                Pengelolaan poin loyalitas, voucher, dan membership khusus untuk staf admin &amp; CSS Senzu Home.
              </p>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="px-4 py-2 bg-[#8B5A36] text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Login Staff
              </button>
            </div>
          )
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#5B351F] text-white border-t border-[#D4AF37]/30 mt-12 pb-28 sm:pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-white/10 pb-6">
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left">
              <button
                type="button"
                onClick={handleGoHome}
                aria-label="Kembali ke Beranda Senzu"
                title="Kembali ke Beranda Senzu"
                className="cursor-pointer hover:opacity-90 transition p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] rounded"
              >
                <SenzuLogo
                  variant="light"
                  size="small"
                  className="h-9 sm:h-10 w-auto max-w-[170px] sm:max-w-[200px]"
                />
              </button>
              <span className="text-xs text-slate-400 font-medium hidden sm:inline">•</span>
              <span className="text-xs text-[#D4AF37] font-medium tracking-wide">
                Home Service Palembang
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <button
                type="button"
                onClick={handleGoHome}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                Beranda
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => {
                  setInitialTrackCode('');
                  setIsTrackingOpen(true);
                }}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                Lacak Booking
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => setIsLoginOpen(true)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                Staff Portal
              </button>
              <span>•</span>
              {isCsAvailable ? (
                <a
                  href={getCsWhatsAppUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#D4AF37] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Phone className="w-3 h-3" />
                  <span>CS WhatsApp</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => alert(csUnavailableNotice)}
                  className="text-slate-400 hover:text-slate-300 font-semibold flex items-center gap-1 cursor-pointer"
                  title={csUnavailableNotice}
                >
                  <Phone className="w-3 h-3" />
                  <span>CS WhatsApp</span>
                </button>
              )}
            </div>
          </div>

          <p className="text-xs leading-relaxed text-slate-300 text-center sm:text-left">
            Senzu Home merupakan layanan pijat dan refleksi panggilan di Palembang yang dikelola oleh{' '}
            <span className="font-semibold text-white">PT KSBONE UNTUK KITA</span>.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-2">
            <div>
              © {new Date().getFullYear()} Senzu Reflexology & Family Massage Palembang. Seluruh Hak Cipta Dilindungi.
            </div>
            <div>Palembang, Sumatera Selatan (WIB) • Layanan Home Service Resmi</div>
          </div>
        </div>
      </footer>

      {/* Customer Mobile-First Bottom Navigation */}
      {activeStaffTab === 'home' && (
        <MobileBottomNav
          activeTab={customerTab}
          onChangeTab={(tab) => {
            setCustomerTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          activeOrdersCount={activeOrdersCount}
        />
      )}

      {/* Customer Tracking Modal */}
      <CustomerTrackingModal
        isOpen={isTrackingOpen}
        onClose={() => setIsTrackingOpen(false)}
        settings={settings}
        initialCode={initialTrackCode}
        onRepeatBooking={handleRepeatBooking}
        allBookings={bookings}
      />

      {/* Customer Portal Modal (Pesanan & Riwayat Saya) */}
      <CustomerPortalModal
        isOpen={isCustomerPortalOpen}
        onClose={() => setIsCustomerPortalOpen(false)}
        bookings={bookings}
        onRepeatBooking={handleRepeatBooking}
        onOpenTracking={(code) => {
          setInitialTrackCode(code);
          setIsTrackingOpen(true);
        }}
      />

      {/* Staff Login Modal */}
      <StaffLoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        initialEmail={initialLoginEmail}
        onOpenInitialSetup={() => {
          setIsInitialSetupRoute(true);
          window.history.pushState({}, '', '/initial-manager-setup');
        }}
        onLoginSuccess={(staff) => {
          if (staff.role === 'css') setActiveStaffTab('css');
          else if (staff.role === 'supervisor') setActiveStaffTab('supervisor');
          else if (staff.role === 'therapist') setActiveStaffTab('therapist');
          else if (staff.role === 'manager' || staff.role === 'admin') setActiveStaffTab('management');

          // Check pending chat target after staff login (Section 10)
          try {
            const pendingChatBookingId = sessionStorage.getItem('senzu_pending_chat_booking_id');
            if (pendingChatBookingId) {
              sessionStorage.removeItem('senzu_pending_chat_booking_id');
              handleOpenChatByBookingId(pendingChatBookingId);
            }
          } catch {}
        }}
      />

      {/* Mandatory Password Change Modal on First Login / Temporary Password (Prompt 15E) */}
      <ForcedPasswordChangeModal />

      {/* Notification Center Modal */}
      <NotificationCenterModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        currentUserRole={(currentUser?.role as any) || 'customer'}
        currentUserId={
          currentUser
            ? currentUser.role === 'therapist'
              ? currentUser.therapistId || (currentUser as any)?.staffUserId || (currentUser as any)?.id || currentUser.uid
              : (currentUser as any)?.id || (currentUser as any)?.staffUserId || currentUser.uid
            : currentCustomer?.id || firebaseUser?.uid
        }
        therapistId={
          currentUser?.role === 'therapist'
            ? currentUser.therapistId || (currentUser as any)?.staffUserId || (currentUser as any)?.id || currentUser.uid
            : undefined
        }
        customerId={!currentUser ? currentCustomer?.id || firebaseUser?.uid : undefined}
        customerAuthUid={!currentUser ? firebaseUser?.uid || undefined : undefined}
        customerBookingCode={initialTrackCode}
        onNavigateToAction={(actionUrl) => {
          if (actionUrl.startsWith('/track/')) {
            const code = actionUrl.replace('/track/', '');
            setInitialTrackCode(code);
            setIsTrackingOpen(true);
          } else if (actionUrl.includes('css')) {
            setActiveStaffTab('css');
          } else if (actionUrl.includes('supervisor')) {
            setActiveStaffTab('supervisor');
          } else if (actionUrl.includes('reconciliation')) {
            setActiveStaffTab('reconciliation');
          } else if (actionUrl.includes('crm')) {
            setActiveStaffTab('crm');
          } else if (actionUrl.includes('loyalty')) {
            setActiveStaffTab('loyalty');
          } else if (actionUrl.includes('report')) {
            setActiveStaffTab('report');
          } else if (actionUrl.includes('management') || actionUrl.includes('settings')) {
            setActiveStaffTab('management');
          } else if (actionUrl.includes('therapist')) {
            setActiveStaffTab('therapist');
            const match = actionUrl.match(/booking[=_/]([A-Za-z0-9-]+)/) || actionUrl.match(/(SH-[0-9-]+)/);
            if (match && match[1]) {
              setInitialTherapistBookingId(match[1]);
            }
          }
        }}
      />

      {/* Customer Login Modal (Prompt 17B) */}
      <CustomerLoginModal
        isOpen={isCustomerLoginOpen}
        onClose={() => setIsCustomerLoginOpen(false)}
        onSwitchToRegister={() => {
          setIsCustomerLoginOpen(false);
          setIsCustomerRegisterOpen(true);
        }}
        onOpenStaffLogin={() => {
          setIsCustomerLoginOpen(false);
          setIsLoginOpen(true);
        }}
        onSuccess={() => {
          try {
            const pendingChatBookingId = sessionStorage.getItem('senzu_pending_chat_booking_id');
            if (pendingChatBookingId) {
              sessionStorage.removeItem('senzu_pending_chat_booking_id');
              handleOpenChatByBookingId(pendingChatBookingId);
            }
          } catch {}
        }}
      />

      {/* Customer Register Modal (Prompt 17B) */}
      <CustomerRegisterModal
        isOpen={isCustomerRegisterOpen}
        onClose={() => setIsCustomerRegisterOpen(false)}
        onSwitchToLogin={() => {
          setIsCustomerRegisterOpen(false);
          setIsCustomerLoginOpen(true);
        }}
      />

      {/* Realtime In-App Chat Notification Banner (Section 1, 3, 4) */}
      <ChatNotificationBanner
        notification={activeChatBanner}
        onOpenChat={(bookingId) => handleOpenChatByBookingId(bookingId)}
        onDismiss={() => setActiveChatBanner(null)}
      />

      {/* Realtime Contextual Booking Chat Modal (Section 10, 11) */}
      {modalChatBooking && (
        <BookingChatModal
          isOpen={Boolean(modalChatBooking)}
          onClose={() => {
            setModalChatBooking(null);
            cleanOpenChatUrl();
          }}
          booking={modalChatBooking}
          currentUserRole={currentUser?.role === 'therapist' ? 'therapist' : 'customer'}
          currentAuthUid={currentUser?.authUserId || currentUser?.uid || firebaseUser?.uid || currentCustomer?.authUserId || currentCustomer?.id || ''}
          currentDisplayName={currentUser?.name || currentCustomer?.displayName || currentCustomer?.name || 'User'}
        />
      )}

      {/* Chat Operational Notice Toast (Section 11) */}
      {chatNoticeToast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#8B5A36] text-[#FDF3CD] border border-[#D4AF37]/40 px-4 py-2.5 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2 animate-bounce pointer-events-none"
        >
          <Info className="w-4 h-4 text-[#D4AF37]" />
          <span>{chatNoticeToast}</span>
        </div>
      )}

      {/* Branded Senzu Splash Screen */}
      {showSplash && <SenzuSplashScreen onFinish={() => setShowSplash(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary scopeName="GlobalApp">
      <AuthProvider>
        <CustomerAuthProvider>
          <GoogleMapsProvider>
            <MainApp />
            <XenditLiveReturn />
          </GoogleMapsProvider>
        </CustomerAuthProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
