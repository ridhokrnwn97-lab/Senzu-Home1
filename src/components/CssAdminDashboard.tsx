import React, { useState, useEffect, useMemo } from 'react';
import {
  DollarSign,
  ShoppingBag,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  Check,
  Calendar,
  Eye,
  X,
  Send,
  UserCheck,
  CreditCard,
  MessageSquare,
  AlertTriangle,
  Settings,
  ShieldCheck,
  Sparkles,
  Phone,
  RefreshCw,
  MapPin,
  ShieldAlert,
  ArrowUpRight,
  Filter,
  Layers,
  History,
  Activity,
  FileCheck,
} from 'lucide-react';
import { Booking, BookingStatusHistory, PaymentRecord } from '../types';
import {
  cssVerifyPayment,
  cssConfirmBooking,
  cssRescheduleBooking,
  cssCancelBooking,
  getBookingStatusHistory,
} from '../lib/dbService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { CssPaymentVerificationSection } from './CssPaymentVerificationSection';
import { PaymentReconciliationView } from './PaymentReconciliationView';
import { RoleAlertBanners } from './RoleAlertBanners';
import {
  subscribeToPendingPayments,
  getPaymentStatusBadgeStyle,
  getPaymentStatusLabel,
} from '../lib/paymentService';
import { CssWorkQueueSection } from './css/CssWorkQueueSection';
import { CssTodayBookingsSection } from './css/CssTodayBookingsSection';
import { CssCustomerFollowupSection } from './css/CssCustomerFollowupSection';
import { CssBookingDetailDrawer } from './css/CssBookingDetailDrawer';
import { CssEscalateModal } from './css/CssEscalateModal';
import { CssAuditLogsSection } from './css/CssAuditLogsSection';
import { CssCaseManagement } from './css/CssCaseManagement';
import {
  computeCssWorkQueue,
  generateWhatsAppMessage,
  getWhatsAppDeepLink,
  CssWorkItem,
} from './css/cssHelpers';

interface CssAdminDashboardProps {
  bookings: Booking[];
  onRefresh?: () => void;
}

export const CssAdminDashboard: React.FC<CssAdminDashboardProps> = ({
  bookings,
  onRefresh = () => {},
}) => {
  const { currentUser } = useAuth();

  // Navigation State: default to the proactive Work Queue ("Perlu Tindakan")
  const [activeTab, setActiveTab] = useState<
    'workQueue' | 'today' | 'pending_verification' | 'reconciliation' | 'customerFollowup' | 'cases' | 'all' | 'auditLogs'
  >('workQueue');

  // Search & Filter for "Semua Reservasi" tab
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Pending Payments real-time state
  const [pendingPayments, setPendingPayments] = useState<PaymentRecord[]>([]);

  // Modals & Drawers state
  const [drawerBooking, setDrawerBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const [escalateBooking, setEscalateBooking] = useState<Booking | null>(null);
  const [isEscalateOpen, setIsEscalateOpen] = useState(false);

  const [rescheduleBookingTarget, setRescheduleBookingTarget] = useState<Booking | null>(null);
  const [isRescheduleOpen, setIsRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [rescheduleNote, setRescheduleNote] = useState('');

  const [cancelBookingTarget, setCancelBookingTarget] = useState<Booking | null>(null);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Real-time WIB Clock State
  const [currentTimeWIB, setCurrentTimeWIB] = useState(() => {
    return new Date().toLocaleTimeString('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  });

  const currentDateWIB = useMemo(() => {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());
  }, [currentTimeWIB]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeWIB(
        new Date().toLocaleTimeString('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-time pending payments subscription
  useEffect(() => {
    const unsub = subscribeToPendingPayments((list) => {
      setPendingPayments(list);
    });
    return () => unsub();
  }, []);

  // Actionable pending payments (only those with valid matching bookings)
  const actionablePendingCount = useMemo(() => {
    if (bookings.length === 0) return pendingPayments.length;
    return pendingPayments.filter((p) =>
      bookings.some(
        (b) =>
          (p.bookingId && b.id === p.bookingId) ||
          (p.bookingCode && b.bookingCode === p.bookingCode)
      )
    ).length;
  }, [pendingPayments, bookings]);

  // Compute Work Queue Items
  const workItems = useMemo(() => {
    return computeCssWorkQueue(bookings, pendingPayments);
  }, [bookings, pendingPayments]);

  // Operational metrics
  const criticalCount = useMemo(() => {
    return workItems.filter((i) => i.priority === 'CRITICAL').length;
  }, [workItems]);

  const todayStr = useMemo(() => {
    const now = new Date();
    const wibOffset = 7 * 60;
    const localOffset = now.getTimezoneOffset();
    const wibDate = new Date(now.getTime() + (wibOffset + localOffset) * 60000);
    return wibDate.toISOString().split('T')[0];
  }, [currentTimeWIB]);

  const todayBookingsCount = useMemo(() => {
    return bookings.filter((b) => b.scheduleDate === todayStr).length;
  }, [bookings, todayStr]);

  const unpaidCount = useMemo(() => {
    return bookings.filter(
      (b) =>
        (b.paymentStatus === 'unpaid' || b.paymentStatus === 'UNPAID') &&
        !['Completed', 'Cancelled'].includes(b.status)
    ).length;
  }, [bookings]);

  const unassignedCount = useMemo(() => {
    return bookings.filter(
      (b) =>
        !b.therapistId &&
        ['Confirmed', 'Pembayaran Terverifikasi'].includes(b.status)
    ).length;
  }, [bookings]);

  const issuesCount = useMemo(() => {
    return bookings.filter(
      (b) =>
        (b.unreachableCount || 0) > 0 ||
        (b.escalation && b.escalation.status !== 'resolved') ||
        (b.issueReport && (b.issueReport as any).status !== 'resolved')
    ).length;
  }, [bookings]);

  // Filtered bookings for "Semua Reservasi"
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const q = (searchTerm || '').toLowerCase();
      const matchSearch =
        (b.bookingCode || '').toLowerCase().includes(q) ||
        (b.customerName || '').toLowerCase().includes(q) ||
        (b.customerWhatsApp || '').includes(searchTerm || '') ||
        (b.area || '').toLowerCase().includes(q);

      const matchStatus = statusFilter === 'ALL' || b.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [bookings, searchTerm, statusFilter]);

  // Handlers for Drawer & Modals
  const handleOpenDrawer = (booking: Booking) => {
    setDrawerBooking(booking);
    setIsDrawerOpen(true);
  };

  const handleOpenEscalate = (booking: Booking) => {
    setEscalateBooking(booking);
    setIsEscalateOpen(true);
  };

  const handleOpenReschedule = (booking: Booking) => {
    setRescheduleBookingTarget(booking);
    setNewDate(booking.scheduleDate || '');
    setNewTime(booking.scheduleTime || '');
    setRescheduleNote('');
    setIsRescheduleOpen(true);
  };

  const handleOpenCancel = (booking: Booking) => {
    setCancelBookingTarget(booking);
    setCancelReason('');
    setIsCancelOpen(true);
  };

  const handleOpenWhatsAppDirect = (booking: Booking, templateKey: any = 'confirm_payment_details') => {
    const text = generateWhatsAppMessage(templateKey, booking);
    const link = getWhatsAppDeepLink(booking.customerWhatsApp, text);
    window.open(link, '_blank');
  };

  const handleVerifyPaymentDirect = async (booking: Booking) => {
    try {
      await cssVerifyPayment(
        booking,
        currentUser?.name || 'CSS Staff',
        'Pembayaran diverifikasi oleh CSS'
      );
      setActionSuccess(`Pembayaran untuk ${booking.bookingCode} berhasil diverifikasi!`);
      setTimeout(() => setActionSuccess(''), 3500);
      onRefresh();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleConfirmDirect = async (booking: Booking) => {
    try {
      await cssConfirmBooking(
        booking,
        currentUser?.name || 'CSS Staff',
        'Pesanan dikonfirmasi oleh CSS dan diteruskan ke Supervisor'
      );
      setActionSuccess(`Pesanan ${booking.bookingCode} telah berstatus Confirmed!`);
      setTimeout(() => setActionSuccess(''), 3500);
      onRefresh();
    } catch (err: any) {
      console.error(err);
    }
  };

  const submitReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleBookingTarget || !newDate || !newTime) return;

    try {
      await cssRescheduleBooking(
        rescheduleBookingTarget,
        newDate,
        newTime,
        currentUser?.name || 'CSS Staff',
        rescheduleNote
      );
      setIsRescheduleOpen(false);
      setActionSuccess(`Jadwal ${rescheduleBookingTarget.bookingCode} berhasil diubah!`);
      setTimeout(() => setActionSuccess(''), 3500);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const submitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelBookingTarget) return;

    try {
      await cssCancelBooking(
        cancelBookingTarget,
        currentUser?.name || 'CSS Staff',
        cancelReason || 'Dibatalkan oleh CSS'
      );
      setIsCancelOpen(false);
      setActionSuccess(`Pesanan ${cancelBookingTarget.bookingCode} telah dibatalkan.`);
      setTimeout(() => setActionSuccess(''), 3500);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert Banners (Broadcast, Emergency, Out-of-area) */}
      <RoleAlertBanners
        role="css"
        counts={{
          pendingPaymentVerification: pendingPayments.length,
          criticalAlerts: criticalCount,
        }}
        onActionClick={(filterKey) => {
          if (filterKey === 'pending_verification') {
            if (pendingPayments.length === 1) {
              const singlePayment = pendingPayments[0];
              const targetBooking = bookings.find(
                (b) =>
                  b.id === singlePayment.bookingId ||
                  b.bookingCode === singlePayment.bookingCode
              );
              if (targetBooking) {
                setDrawerBooking(targetBooking);
                setIsDrawerOpen(true);
                return;
              }
            }
            setActiveTab('pending_verification');
          }
        }}
      />

      {/* Success Notification Toast */}
      {actionSuccess && (
        <div className="p-3.5 bg-emerald-600 text-white rounded-2xl shadow-lg flex items-center justify-between text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess('')}
            className="p-1 hover:bg-white/20 rounded-lg text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Operational Header Bar */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full bg-[#8B5A36] text-white text-[10px] font-bold uppercase tracking-wider">
              SENZU CSS Operations
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Shift Siaga • Aktif</span>
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black font-serif text-[#4B2B18] tracking-tight">
            Pusat Operasional CSS
          </h1>
          <p className="text-xs text-slate-500">
            Operator: <strong className="text-slate-800">{currentUser?.name || 'CSS Staff'}</strong> • Melayani konfirmasi reservasi, verifikasi pembayaran, & koordinasi pelanggan.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto flex-wrap">
          {/* Live WIB Clock */}
          <div className="bg-slate-50 border border-slate-200 px-3.5 py-2 rounded-2xl flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-[#4B2B18]" />
            <div>
              <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                {currentDateWIB}
              </div>
              <div className="font-mono text-sm sm:text-base font-black text-[#4B2B18]">
                {currentTimeWIB} <span className="text-[10px] font-normal text-slate-500">WIB</span>
              </div>
            </div>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={onRefresh}
            className="p-2.5 min-h-[42px] rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center transition active:scale-95"
            title="Muat Ulang Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* KPI Command Cards (Interactive Quick Filters) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Perlu Tindakan */}
        <div
          onClick={() => setActiveTab('workQueue')}
          className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm relative overflow-hidden ${
            activeTab === 'workQueue'
              ? 'bg-[#8B5A36] text-white border-[#8B5A36] ring-2 ring-[#8B5A36]/20'
              : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${activeTab === 'workQueue' ? 'text-amber-300' : 'text-slate-400'}`}>
              Perlu Tindakan
            </span>
            {criticalCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            )}
          </div>
          <div className="text-2xl font-black mt-1 flex items-baseline gap-1.5">
            <span>{workItems.length}</span>
            {criticalCount > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${activeTab === 'workQueue' ? 'bg-red-500/30 text-red-200' : 'bg-red-100 text-red-700'}`}>
                {criticalCount} Kritis
              </span>
            )}
          </div>
          <div className={`text-[10px] mt-0.5 ${activeTab === 'workQueue' ? 'text-slate-300' : 'text-slate-400'}`}>
            Antrean utama CSS
          </div>
        </div>

        {/* Card 2: Booking Hari Ini */}
        <div
          onClick={() => setActiveTab('today')}
          className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
            activeTab === 'today'
              ? 'bg-[#8B5A36] text-white border-[#8B5A36] ring-2 ring-[#8B5A36]/20'
              : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className={`text-[10px] font-bold uppercase tracking-wider ${activeTab === 'today' ? 'text-amber-300' : 'text-slate-400'}`}>
            Booking Hari Ini
          </div>
          <div className="text-2xl font-black mt-1">
            {todayBookingsCount}
          </div>
          <div className={`text-[10px] mt-0.5 ${activeTab === 'today' ? 'text-slate-300' : 'text-slate-400'}`}>
            Jadwal operasional
          </div>
        </div>

        {/* Card 3: Menunggu Verifikasi Bayar */}
        <div
          onClick={() => setActiveTab('pending_verification')}
          className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
            activeTab === 'pending_verification'
              ? 'bg-teal-700 text-white border-teal-700 ring-2 ring-teal-600/20'
              : 'bg-white hover:bg-teal-50/50 border-slate-200 text-slate-800'
          }`}
        >
          <div className={`text-[10px] font-bold uppercase tracking-wider ${activeTab === 'pending_verification' ? 'text-teal-200' : 'text-teal-600'}`}>
            Verifikasi Bayar
          </div>
          <div className="text-2xl font-black mt-1 text-teal-600">
            <span className={activeTab === 'pending_verification' ? 'text-white' : ''}>
              {pendingPayments.length}
            </span>
          </div>
          <div className={`text-[10px] mt-0.5 ${activeTab === 'pending_verification' ? 'text-teal-200' : 'text-slate-400'}`}>
            Bukti transfer masuk
          </div>
        </div>

        {/* Card 4: Belum Lunas */}
        <div
          onClick={() => {
            setActiveTab('today');
          }}
          className="p-4 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 transition cursor-pointer shadow-sm"
        >
          <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">
            Belum Lunas
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {unpaidCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Perlu follow-up transfer
          </div>
        </div>

        {/* Card 5: Antre di Supervisor (Unassigned) */}
        <div
          onClick={() => setActiveTab('all')}
          className="p-4 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 transition cursor-pointer shadow-sm"
        >
          <div className="text-[10px] text-purple-600 font-bold uppercase tracking-wider">
            Antre di Spv
          </div>
          <div className="text-2xl font-black text-purple-600 mt-1">
            {unassignedCount}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Lunas, belum assign
          </div>
        </div>

        {/* Card 6: Kendala & Eskalasi */}
        <div
          onClick={() => setActiveTab('customerFollowup')}
          className={`p-4 rounded-2xl border transition cursor-pointer shadow-sm ${
            activeTab === 'customerFollowup'
              ? 'bg-red-700 text-white border-red-700 ring-2 ring-red-600/20'
              : 'bg-white hover:bg-red-50/50 border-slate-200 text-slate-800'
          }`}
        >
          <div className={`text-[10px] font-bold uppercase tracking-wider ${activeTab === 'customerFollowup' ? 'text-red-200' : 'text-red-600'}`}>
            Kendala & Eskalasi
          </div>
          <div className="text-2xl font-black mt-1 text-red-600">
            <span className={activeTab === 'customerFollowup' ? 'text-white' : ''}>
              {issuesCount}
            </span>
          </div>
          <div className={`text-[10px] mt-0.5 ${activeTab === 'customerFollowup' ? 'text-red-200' : 'text-slate-400'}`}>
            No respon / komplain
          </div>
        </div>
      </div>

      {/* Main Operational Tabs Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-1.5 shadow-sm flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab('workQueue')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'workQueue'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Perlu Tindakan (Work Queue)</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'workQueue' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {workItems.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('today')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'today'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Booking Hari Ini</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'today' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {todayBookingsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('pending_verification')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'pending_verification'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4 text-teal-500" />
          <span>Verifikasi Pembayaran</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${actionablePendingCount > 0 ? 'bg-teal-500 text-white font-bold' : 'bg-slate-200 text-slate-700'}`}>
            {actionablePendingCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'reconciliation'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <FileCheck className="w-4 h-4 text-[#D4AF37]" />
          <span>Rekonsiliasi Bank & QRIS</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('customerFollowup')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'customerFollowup'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Phone className="w-4 h-4 text-amber-500" />
          <span>Follow-up & Kendala</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'customerFollowup' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {issuesCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('cases')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'cases'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          <span>Komplain & Kasus</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'all'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Semua Reservasi</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] ${activeTab === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
            {bookings.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('auditLogs')}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-2 ${
            activeTab === 'auditLogs'
              ? 'bg-[#8B5A36] text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Audit Log</span>
        </button>
      </div>

      {/* Tab Content 1: Perlu Tindakan (Work Queue) */}
      {activeTab === 'workQueue' && (
        <CssWorkQueueSection
          workItems={workItems}
          bookings={bookings}
          currentUserId={(currentUser as any)?.id || currentUser?.uid || 'css_user'}
          currentUserName={currentUser?.name || 'CSS Staff'}
          onSelectBooking={handleOpenDrawer}
          onOpenVerifyPayment={(bookingId) => {
            const b = bookings.find((item) => item.id === bookingId);
            if (b) handleOpenDrawer(b);
            else setActiveTab('pending_verification');
          }}
          onOpenReschedule={handleOpenReschedule}
          onOpenAddressChange={handleOpenDrawer}
          onOpenEscalate={handleOpenEscalate}
          onOpenWhatsApp={handleOpenWhatsAppDirect}
          onRefresh={onRefresh}
        />
      )}

      {/* Tab Content 2: Booking Hari Ini */}
      {activeTab === 'today' && (
        <CssTodayBookingsSection
          bookings={bookings}
          onSelectBooking={handleOpenDrawer}
          onOpenReschedule={handleOpenReschedule}
          onOpenCancel={handleOpenCancel}
          onOpenWhatsApp={handleOpenWhatsAppDirect}
          onRefresh={onRefresh}
        />
      )}

      {/* Tab Content 3: Verifikasi Pembayaran */}
      {activeTab === 'pending_verification' && (
        <CssPaymentVerificationSection
          bookings={bookings}
          onRefresh={onRefresh}
        />
      )}

      {/* Tab Content 4: Rekonsiliasi */}
      {activeTab === 'reconciliation' && (
        <PaymentReconciliationView
          bookings={bookings}
          onRefresh={onRefresh}
        />
      )}

      {/* Tab Content 5: Follow-up & Kendala */}
      {activeTab === 'customerFollowup' && (
        <CssCustomerFollowupSection
          bookings={bookings}
          currentUserName={currentUser?.name || 'CSS Staff'}
          onSelectBooking={handleOpenDrawer}
          onOpenWhatsApp={handleOpenWhatsAppDirect}
          onOpenEscalate={handleOpenEscalate}
          onRefresh={onRefresh}
        />
      )}

      {/* Tab Content: Manajemen Kasus & Komplain Terpadu */}
      {activeTab === 'cases' && (
        <CssCaseManagement
          bookings={bookings}
          currentUser={{
            id: (currentUser as any)?.id || currentUser?.uid || 'css_user',
            name: currentUser?.name || 'CSS Staff',
            role: 'CSS',
          }}
        />
      )}

      {/* Tab Content 6: Semua Reservasi (Legacy Rich Table) */}
      {activeTab === 'all' && (
        <div className="space-y-4">
          {/* Filter & Search Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Cari kode, nama, nomor WA, area..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8B5A36]"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Filter Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#8B5A36] bg-slate-50 font-medium"
              >
                <option value="ALL">Semua Status</option>
                <option value="Menunggu Pembayaran">Menunggu Pembayaran</option>
                <option value="Pembayaran Terverifikasi">Pembayaran Terverifikasi</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Therapist Assigned">Therapist Assigned</option>
                <option value="Accepted">Accepted</option>
                <option value="On The Way">On The Way</option>
                <option value="Treatment">Treatment</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Rescheduled">Rescheduled</option>
              </select>
            </div>
          </div>

          {/* Bookings Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#8B5A36] text-white uppercase text-[11px] font-semibold tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Kode Booking</th>
                    <th className="py-3.5 px-4">Customer & WA</th>
                    <th className="py-3.5 px-4">Treatment</th>
                    <th className="py-3.5 px-4">Jadwal (WIB)</th>
                    <th className="py-3.5 px-4">Total</th>
                    <th className="py-3.5 px-4">Payment</th>
                    <th className="py-3.5 px-4">Status Booking</th>
                    <th className="py-3.5 px-4">Therapist</th>
                    <th className="py-3.5 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Tidak ada pesanan yang sesuai dengan filter.
                      </td>
                    </tr>
                  ) : (
                    (filteredBookings || []).map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => handleOpenDrawer(b)}
                        className="hover:bg-slate-50/80 transition cursor-pointer"
                      >
                        <td className="py-3.5 px-4 font-mono font-bold text-[#4B2B18]">
                          {b.bookingCode}
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{b.customerName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {b.customerWhatsApp}
                          </div>
                          <div className="text-[10px] text-slate-400">{b.area}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-800">{b.serviceName}</div>
                          <div className="text-[10px] text-slate-500">{b.serviceDuration} Menit</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#4B2B18]">{b.scheduleDate}</div>
                          <div className="text-[11px] text-slate-500">{b.scheduleTime} WIB</div>
                        </td>

                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          {formatRupiah(b.totalAmount)}
                        </td>

                        <td className="py-3.5 px-4">
                          {(() => {
                            const style = getPaymentStatusBadgeStyle(b.paymentStatus);
                            return (
                              <span
                                className={`inline-block px-2.5 py-1 rounded-lg text-[10px] border font-bold ${style.bg} ${style.text} ${style.border}`}
                              >
                                {style.label}
                              </span>
                            );
                          })()}
                          <div className="text-[10px] text-slate-400 mt-0.5">{b.paymentMethod}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${
                              b.status === 'Completed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : b.status === 'Cancelled'
                                ? 'bg-red-100 text-red-800'
                                : b.status === 'Confirmed'
                                ? 'bg-blue-100 text-blue-800'
                                : b.status === 'Pembayaran Terverifikasi'
                                ? 'bg-teal-100 text-teal-800'
                                : b.status === 'Therapist Assigned'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          {b.therapistName ? (
                            <div className="font-semibold text-slate-800">{b.therapistName}</div>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">Belum Assigned</span>
                          )}
                        </td>

                        <td
                          className="py-3.5 px-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {/* Quick Action: Verify Payment */}
                            {b.status === 'Menunggu Pembayaran' && (
                              <button
                                type="button"
                                onClick={() => handleVerifyPaymentDirect(b)}
                                title="Verifikasi Bayar"
                                className="px-2 py-1 rounded bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold transition"
                              >
                                Verif Bayar
                              </button>
                            )}

                            {/* Quick Action: Confirm Booking */}
                            {b.status === 'Pembayaran Terverifikasi' && (
                              <button
                                type="button"
                                onClick={() => handleConfirmDirect(b)}
                                title="Konfirmasi Booking"
                                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition"
                              >
                                Confirm
                              </button>
                            )}

                            {/* Detail Drawer */}
                            <button
                              type="button"
                              onClick={() => handleOpenDrawer(b)}
                              title="Lihat Detail & Riwayat"
                              className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Reschedule */}
                            {b.status !== 'Completed' && b.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleOpenReschedule(b)}
                                title="Ubah Jadwal (Reschedule)"
                                className="p-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 transition"
                              >
                                <Calendar className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Cancel */}
                            {b.status !== 'Completed' && b.status !== 'Cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleOpenCancel(b)}
                                title="Batalkan Booking"
                                className="p-1 rounded bg-red-50 hover:bg-red-100 text-red-600 transition"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content 7: Audit Log */}
      {activeTab === 'auditLogs' && <CssAuditLogsSection />}

      {/* Booking Detail Drawer (Customer 360, WhatsApp, Internal Notes, History) */}
      <CssBookingDetailDrawer
        isOpen={isDrawerOpen}
        booking={drawerBooking}
        onClose={() => {
          setIsDrawerOpen(false);
          setDrawerBooking(null);
        }}
        onRefresh={onRefresh}
        currentUserId={(currentUser as any)?.id || currentUser?.uid || 'css_user'}
        currentUserName={currentUser?.name || 'CSS Staff'}
        onOpenVerifyPayment={(bookingId) => {
          setIsDrawerOpen(false);
          setActiveTab('pending_verification');
        }}
        onOpenReschedule={(b) => {
          setIsDrawerOpen(false);
          handleOpenReschedule(b);
        }}
        onOpenCancel={(b) => {
          setIsDrawerOpen(false);
          handleOpenCancel(b);
        }}
        onOpenEscalate={(b) => {
          setIsDrawerOpen(false);
          handleOpenEscalate(b);
        }}
      />

      {/* Supervisor Escalation Modal */}
      <CssEscalateModal
        isOpen={isEscalateOpen}
        booking={escalateBooking}
        onClose={() => {
          setIsEscalateOpen(false);
          setEscalateBooking(null);
        }}
        onSuccess={() => {
          setActionSuccess(`Eskalasi untuk ${escalateBooking?.bookingCode} telah diteruskan ke Supervisor Control Room!`);
          setTimeout(() => setActionSuccess(''), 4000);
          onRefresh();
        }}
        cssStaffName={currentUser?.name || 'CSS Staff'}
        cssStaffId={(currentUser as any)?.id || currentUser?.uid || 'css_user'}
      />

      {/* Reschedule Modal */}
      {isRescheduleOpen && rescheduleBookingTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-[#8B5A36] text-white p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-[#D4AF37] font-semibold uppercase">Reschedule Jadwal</span>
                <h4 className="font-mono text-lg font-bold">{rescheduleBookingTarget.bookingCode}</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsRescheduleOpen(false)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitReschedule} className="p-6 space-y-4 text-xs">
              {rescheduleBookingTarget.therapistName && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <strong>Perhatian:</strong> Terapis <em>{rescheduleBookingTarget.therapistName}</em> sudah ditugaskan. Supervisor akan menerima notifikasi bahwa jadwal berubah.
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tanggal Baru:</label>
                <input
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jam Baru (WIB):</label>
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Alasan / Catatan:</label>
                <textarea
                  rows={2}
                  placeholder="Permintaan customer diundur 1 jam..."
                  value={rescheduleNote}
                  onChange={(e) => setRescheduleNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-[#8B5A36]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsRescheduleOpen(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#8B5A36] hover:bg-[#94603B] text-white font-bold"
                >
                  Simpan Jadwal Baru
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {isCancelOpen && cancelBookingTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-red-700 text-white p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-semibold">Konfirmasi Pembatalan</span>
                <h4 className="font-mono text-lg font-bold">{cancelBookingTarget.bookingCode}</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsCancelOpen(false)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitCancel} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600">
                Apakah Anda yakin ingin membatalkan pesanan untuk pelanggan{' '}
                <strong>{cancelBookingTarget.customerName}</strong>?
              </p>

              {cancelBookingTarget.pointsRedeemed && cancelBookingTarget.pointsRedeemed > 0 && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-blue-900">
                  Pelanggan menggunakan {cancelBookingTarget.pointsRedeemed} poin Senzu. Poin akan otomatis dikembalikan ke akun pelanggan.
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Alasan Pembatalan:
                </label>
                <textarea
                  rows={3}
                  placeholder="Pelanggan membatalkan janji, jadwal tidak cocok..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-red-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCancelOpen(false)}
                  className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
                >
                  Kembali
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold"
                >
                  Ya, Batalkan Pesanan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
