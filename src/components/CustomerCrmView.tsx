import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Search,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Sparkles,
  Award,
  DollarSign,
  Heart,
  ExternalLink,
  Filter,
  Download,
  RefreshCw,
  Clock,
  Star,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  Repeat,
  Plus,
  MessageSquare,
  ShieldCheck,
  CheckSquare,
  Square,
  ChevronRight,
  TrendingUp,
  UserCheck,
  Tag,
  UserX,
  FileText,
  Send,
  Zap,
  Coins
} from 'lucide-react';
import { Booking, User as AuthUser } from '../types';
import {
  CustomerCRM,
  CustomerSegment,
  CustomerStatus,
  CustomerReview,
  CustomerNote,
  CustomerNoteCategory,
  CustomerSavedAddress,
  CrmTask,
  CrmTaskPriority,
  CrmTaskStatus,
  CUSTOMER_SEGMENT_LABELS,
  CUSTOMER_SEGMENT_COLORS,
} from '../types/crm';
import { CustomerLoyaltyAccount } from '../types/loyalty';
import { getLoyaltyAccountByCustomerId } from '../lib/loyaltyService';
import { formatRupiah, formatDateIndo } from '../lib/utils';
import {
  getCustomerNotes,
  addCustomerNote,
  getCrmTasks,
  createCrmTask,
  updateCrmTaskStatus,
  getCustomerReviews,
  getLowRatingReviews,
  backfillAndRecomputeAllCustomers,
  toggleCustomerVipStatus,
  updateCustomerStatus,
  getCustomerSavedAddresses,
} from '../lib/crmService';

interface CustomerCrmViewProps {
  customers: CustomerCRM[];
  bookings?: Booking[];
  currentUser?: AuthUser | null;
  onRefreshCustomers?: () => void;
  onRepeatBooking?: (booking: Partial<Booking>) => void;
}

export const CustomerCrmView: React.FC<CustomerCrmViewProps> = ({
  customers = [],
  bookings = [],
  currentUser,
  onRefreshCustomers,
  onRepeatBooking,
}) => {
  // Main view navigation: 'directory' | 'retention' | 'service_recovery'
  const [activeMainView, setActiveMainView] = useState<'directory' | 'retention' | 'service_recovery'>('directory');

  // Search & Filtering
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSegment, setSelectedSegment] = useState<string>('ALL');
  const [selectedArea, setSelectedArea] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'spend' | 'bookings' | 'last_booking' | 'name'>('spend');

  // Selected Customer for Profile Detail Slide-over
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerCRM | null>(null);
  const [profileTab, setProfileTab] = useState<'history' | 'reviews' | 'notes' | 'tasks' | 'addresses'>('history');

  // Customer sub-data state for selected profile
  const [customerNotesList, setCustomerNotesList] = useState<CustomerNote[]>([]);
  const [customerTasksList, setCustomerTasksList] = useState<CrmTask[]>([]);
  const [customerReviewsList, setCustomerReviewsList] = useState<CustomerReview[]>([]);
  const [customerAddressesList, setCustomerAddressesList] = useState<CustomerSavedAddress[]>([]);
  const [isSubDataLoading, setIsSubDataLoading] = useState(false);

  // Form states for adding note & task
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState<CustomerNoteCategory>('preference');
  const [isAddingNote, setIsAddingNote] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  });
  const [newTaskPriority, setNewTaskPriority] = useState<CrmTaskPriority>('medium');
  const [isAddingTask, setIsAddingTask] = useState(false);

  // Recovery Queue State
  const [recoveryReviews, setRecoveryReviews] = useState<CustomerReview[]>([]);
  const [isRecoveryLoading, setIsRecoveryLoading] = useState(false);

  // Loyalty account state for selected customer
  const [selectedLoyaltyAccount, setSelectedLoyaltyAccount] = useState<CustomerLoyaltyAccount | null>(null);

  // Backfill sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // Extract unique areas from customers
  const uniqueAreas = useMemo(() => {
    const areas = new Set<string>();
    customers.forEach((c) => {
      if (c.area) areas.add(c.area);
    });
    return Array.from(areas).sort();
  }, [customers]);

  // Load customer subdata when profile is opened
  useEffect(() => {
    if (selectedCustomer) {
      loadCustomerSubData(selectedCustomer.id);
    }
  }, [selectedCustomer?.id]);

  // Load service recovery reviews when recovery tab is active
  useEffect(() => {
    if (activeMainView === 'service_recovery') {
      loadRecoveryReviews();
    }
  }, [activeMainView]);

  const loadCustomerSubData = async (customerId: string) => {
    setIsSubDataLoading(true);
    try {
      const [notes, tasks, reviews, addrs, loyalty] = await Promise.all([
        getCustomerNotes(customerId),
        getCrmTasks(customerId),
        getCustomerReviews(customerId),
        getCustomerSavedAddresses(customerId),
        getLoyaltyAccountByCustomerId(customerId),
      ]);
      setCustomerNotesList(notes);
      setCustomerTasksList(tasks);
      setCustomerReviewsList(reviews);
      setCustomerAddressesList(addrs);
      setSelectedLoyaltyAccount(loyalty);
    } catch (err) {
      console.error('Failed to load customer subdata:', err);
    } finally {
      setIsSubDataLoading(false);
    }
  };

  const loadRecoveryReviews = async () => {
    setIsRecoveryLoading(true);
    try {
      const revs = await getLowRatingReviews();
      setRecoveryReviews(revs);
    } catch (err) {
      console.error('Failed to load low rating reviews:', err);
    } finally {
      setIsRecoveryLoading(false);
    }
  };

  // Metrics summary
  const metrics = useMemo(() => {
    const total = customers.length;
    let active = 0;
    let repeat = 0;
    let highValue = 0;
    let atRisk = 0;
    let inactive = 0;
    let vip = 0;
    let totalSpend = 0;

    customers.forEach((c) => {
      totalSpend += c.totalSpend || 0;
      if (c.customerSegment === 'ACTIVE') active++;
      else if (c.customerSegment === 'REPEAT') repeat++;
      else if (c.customerSegment === 'HIGH_VALUE') highValue++;
      else if (c.customerSegment === 'AT_RISK') atRisk++;
      else if (c.customerSegment === 'INACTIVE') inactive++;
      else if (c.customerSegment === 'VIP') vip++;
    });

    const repeatRate = total > 0 ? Math.round(((repeat + highValue + vip) / total) * 100) : 0;
    const avgSpend = total > 0 ? Math.round(totalSpend / total) : 0;

    return { total, active, repeat, highValue, atRisk, inactive, vip, totalSpend, repeatRate, avgSpend };
  }, [customers]);

  // Filtered and sorted customers
  const filteredCustomers = useMemo(() => {
    return customers
      .filter((c) => {
        // Search filter
        const term = searchTerm.toLowerCase();
        const matchesSearch =
          !term ||
          (c.name || '').toLowerCase().includes(term) ||
          (c.whatsapp || c.phone || '').includes(term) ||
          (c.area || '').toLowerCase().includes(term) ||
          (c.email || '').toLowerCase().includes(term);

        // Segment filter
        const matchesSegment =
          selectedSegment === 'ALL' || c.customerSegment === selectedSegment;

        // Area filter
        const matchesArea = selectedArea === 'ALL' || c.area === selectedArea;

        return matchesSearch && matchesSegment && matchesArea;
      })
      .sort((a, b) => {
        if (sortBy === 'spend') return (b.totalSpend || 0) - (a.totalSpend || 0);
        if (sortBy === 'bookings') return (b.totalBooking || b.completedBookings || 0) - (a.totalBooking || a.completedBookings || 0);
        if (sortBy === 'last_booking') {
          const tA = a.lastCompletedTreatmentAt ? new Date(a.lastCompletedTreatmentAt).getTime() : 0;
          const tB = b.lastCompletedTreatmentAt ? new Date(b.lastCompletedTreatmentAt).getTime() : 0;
          return tB - tA;
        }
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [customers, searchTerm, selectedSegment, selectedArea, sortBy]);

  // Filtered Bookings for selected customer
  const customerBookings = useMemo(() => {
    if (!selectedCustomer) return [];
    const cleanPhone = (selectedCustomer.whatsapp || selectedCustomer.phone || '').replace(/[^0-9]/g, '');
    return bookings.filter((b) => {
      const bPhone = (b.customerWhatsApp || '').replace(/[^0-9]/g, '');
      return (
        b.customerId === selectedCustomer.id ||
        (cleanPhone.length >= 8 && (bPhone.includes(cleanPhone) || cleanPhone.includes(bPhone)))
      );
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedCustomer, bookings]);

  // Safe Backfill Handler
  const handleTriggerSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncToast('Sinkronisasi data transaksi booking ke profil CRM...');
    try {
      const result = await backfillAndRecomputeAllCustomers();
      setSyncToast(
        `Sukses! Memproses ${result.processedBookings} transaksi. Diperbarui ${result.syncedCustomers} profil pelanggan.`
      );
      if (onRefreshCustomers) onRefreshCustomers();
      setTimeout(() => setSyncToast(null), 5000);
    } catch (err: any) {
      console.error('Backfill error:', err);
      setSyncToast('Gagal sinkronisasi: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // Add Note Handler
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !newNoteText.trim()) return;

    setIsAddingNote(true);
    try {
      const note = await addCustomerNote({
        customerId: selectedCustomer.id,
        category: newNoteCategory,
        noteType: newNoteCategory,
        content: newNoteText.trim(),
        note: newNoteText.trim(),
        authorName: currentUser?.name || 'Staff CSS',
        authorRole: currentUser?.role || 'css',
        createdBy: currentUser?.name || 'Staff CSS',
        createdByRole: currentUser?.role || 'css',
        visibility: 'operational',
        isPinned: newNoteCategory === 'medical_allergy_alert',
      });
      setCustomerNotesList([note, ...customerNotesList]);
      setNewNoteText('');
    } catch (err) {
      console.error('Add note error:', err);
    } finally {
      setIsAddingNote(false);
    }
  };

  // Add Task Handler
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !newTaskTitle.trim()) return;

    setIsAddingTask(true);
    try {
      const task = await createCrmTask({
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.whatsapp || selectedCustomer.phone,
        taskType: 'periodic_rebooking_reminder',
        title: newTaskTitle.trim(),
        priority: newTaskPriority,
        dueDate: newTaskDueDate,
        dueAt: newTaskDueDate,
        status: 'open',
        createdByName: currentUser?.name || 'Staff CSS',
        assignedToName: currentUser?.name || 'Tim CSS',
      });
      setCustomerTasksList([task, ...customerTasksList]);
      setNewTaskTitle('');
    } catch (err) {
      console.error('Add task error:', err);
    } finally {
      setIsAddingTask(false);
    }
  };

  // Toggle Task Status
  const handleToggleTask = async (taskId: string, currentStatus: CrmTaskStatus) => {
    const newStatus: CrmTaskStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    try {
      await updateCrmTaskStatus(taskId, newStatus, currentUser?.name || 'Staff');
      setCustomerTasksList(
        (customerTasksList || []).map((t) =>
          t.id === taskId
            ? { ...t, status: newStatus, completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined }
            : t
        )
      );
    } catch (err) {
      console.error('Update task error:', err);
    }
  };

  // Toggle VIP Handler
  const handleToggleVip = async () => {
    if (!selectedCustomer) return;
    const isCurrentlyVip = selectedCustomer.customerSegment === 'VIP' || selectedCustomer.isVip;
    try {
      await toggleCustomerVipStatus(
        selectedCustomer.id,
        !isCurrentlyVip,
        currentUser?.name || 'Admin',
        !isCurrentlyVip ? 'Promosi VIP Manual oleh Manajemen' : 'Pencabutan status VIP manual'
      );
      const updatedCustomer: CustomerCRM = {
        ...selectedCustomer,
        customerSegment: !isCurrentlyVip ? 'VIP' : 'REPEAT',
        isVip: !isCurrentlyVip,
      };
      setSelectedCustomer(updatedCustomer);
      if (onRefreshCustomers) onRefreshCustomers();
    } catch (err) {
      console.error('Toggle VIP error:', err);
    }
  };

  // Update Status Handler (Active / Blocked / Do Not Contact)
  const handleUpdateStatus = async (newStatus: CustomerStatus) => {
    if (!selectedCustomer) return;
    try {
      await updateCustomerStatus(
        selectedCustomer.id,
        newStatus,
        currentUser?.name || 'Admin',
        `Perubahan status menjadi ${newStatus}`
      );
      setSelectedCustomer({ ...selectedCustomer, customerStatus: newStatus });
      if (onRefreshCustomers) onRefreshCustomers();
    } catch (err) {
      console.error('Update status error:', err);
    }
  };

  // Export CSV Handler
  const handleExportCsv = () => {
    const headers = [
      'ID',
      'Nama',
      'WhatsApp',
      'Email',
      'Segment',
      'Status',
      'Area',
      'Total Bookings',
      'Completed Bookings',
      'Total Spend (Rp)',
      'AOV (Rp)',
      'Layanan Favorit',
      'Terapis Favorit',
      'Kunjungan Terakhir',
    ];

    const rows = (filteredCustomers || []).map((c) => [
      c.id,
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${c.whatsapp || c.phone || ''}"`,
      `"${c.email || ''}"`,
      c.customerSegment || 'NEW',
      c.customerStatus || 'active',
      `"${(c.area || '').replace(/"/g, '""')}"`,
      c.totalBooking || c.totalBookings || 0,
      c.completedBooking || c.completedBookings || 0,
      c.totalSpend || 0,
      c.averageOrderValue || 0,
      `"${(c.favoriteServiceName || c.favoriteTreatment || '').replace(/"/g, '""')}"`,
      `"${(c.favoriteTherapistName || c.favoriteTherapist || '').replace(/"/g, '""')}"`,
      c.lastCompletedTreatmentAt || c.lastBooking || '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...(rows || []).map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `senzu_crm_customers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {syncToast && (
        <div className="fixed bottom-5 right-5 z-50 p-4 rounded-xl bg-[#082A4F] text-white shadow-2xl border border-[#D4AF37] flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5">
          <Sparkles className="w-5 h-5 text-[#D4AF37] shrink-0" />
          <span className="text-xs font-medium">{syncToast}</span>
          <button
            type="button"
            onClick={() => setSyncToast(null)}
            className="text-slate-400 hover:text-white ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Main Views Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 bg-[#D4AF37]/15 border border-[#D4AF37]/30 px-3 py-0.5 rounded-full text-[11px] font-semibold text-[#8B6B14] mb-1">
            <Users className="w-3.5 h-3.5 text-[#B89628]" />
            Customer Relationship Management
          </div>
          <h2 className="text-xl sm:text-2xl font-bold font-serif text-[#082A4F]">
            Master Database & CRM Pelanggan
          </h2>
          <p className="text-xs text-slate-500">
            Pusat data pelanggan, riwayat treatment, repeat order, dan retensi berbasis nomor WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Safe Sync Button */}
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={isSyncing}
            className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition disabled:opacity-50 cursor-pointer"
            title="Sinkronisasi ulang agregasi dari data transaksi booking"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#082A4F] ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Sinkronisasi...' : 'Sinkronkan CRM'}</span>
          </button>

          {/* Export CSV Button */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
            Total Pelanggan
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold font-serif text-[#082A4F]">
              {metrics.total}
            </span>
            <Users className="w-4 h-4 text-slate-300" />
          </div>
          <span className="text-[10px] text-slate-500">Database aktif</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
            Pelanggan VIP
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold font-serif text-[#B89628]">
              {metrics.vip}
            </span>
            <Award className="w-4 h-4 text-[#D4AF37]" />
          </div>
          <span className="text-[10px] text-amber-700 font-medium">Prioritas layanan</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
            Repeat Customers
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold font-serif text-emerald-700">
              {metrics.repeat + metrics.highValue}
            </span>
            <Repeat className="w-4 h-4 text-emerald-500" />
          </div>
          <span className="text-[10px] text-emerald-600 font-medium">
            {metrics.repeatRate}% Repeat Rate
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
            At-Risk (30-60hr)
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold font-serif text-amber-600">
              {metrics.atRisk}
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-[10px] text-amber-600">Perlu re-engagement</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
            Tidak Aktif (&gt;60hr)
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold font-serif text-rose-600">
              {metrics.inactive}
            </span>
            <UserX className="w-4 h-4 text-rose-400" />
          </div>
          <span className="text-[10px] text-slate-400">Dormant</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-1">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
            Rata-rata Spend (LTV)
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold font-serif text-slate-800 truncate">
              {formatRupiah(metrics.avgSpend)}
            </span>
            <TrendingUp className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          <span className="text-[10px] text-slate-500">Per customer</span>
        </div>
      </div>

      {/* Main View Mode Selector Tabs */}
      <div className="flex border-b border-slate-200 gap-6 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveMainView('directory')}
          className={`pb-3 transition border-b-2 flex items-center gap-2 cursor-pointer ${
            activeMainView === 'directory'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Direktori Master Pelanggan ({filteredCustomers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainView('retention')}
          className={`pb-3 transition border-b-2 flex items-center gap-2 cursor-pointer ${
            activeMainView === 'retention'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Zap className="w-4 h-4 text-amber-500" />
          <span>Retensi & Re-engagement ({metrics.atRisk + metrics.inactive})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMainView('service_recovery')}
          className={`pb-3 transition border-b-2 flex items-center gap-2 cursor-pointer ${
            activeMainView === 'service_recovery'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <AlertCircle className="w-4 h-4 text-rose-500" />
          <span>Antrean Service Recovery (Rating ≤ 2★)</span>
        </button>
      </div>

      {/* VIEW 1: DIRECTORY MASTER */}
      {activeMainView === 'directory' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Cari nama pelanggan, nomor WhatsApp, email, kecamatan..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#082A4F] bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Segment filter */}
              <div className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={selectedSegment}
                  onChange={(e) => setSelectedSegment(e.target.value)}
                  className="p-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-700"
                >
                  <option value="ALL">Semua Segmen</option>
                  <option value="VIP">VIP</option>
                  <option value="HIGH_VALUE">High Value</option>
                  <option value="REPEAT">Repeat</option>
                  <option value="ACTIVE">Active</option>
                  <option value="NEW">New</option>
                  <option value="AT_RISK">At Risk</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </div>

              {/* Area filter */}
              <select
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value)}
                className="p-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-700"
              >
                <option value="ALL">Semua Kecamatan</option>
                {(uniqueAreas || []).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              {/* Sorting */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="p-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-700"
              >
                <option value="spend">Urutkan: Total Spend (Tertinggi)</option>
                <option value="bookings">Urutkan: Total Treatment</option>
                <option value="last_booking">Urutkan: Booking Terbaru</option>
                <option value="name">Urutkan: Nama (A-Z)</option>
              </select>
            </div>
          </div>

          {/* Customer Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#082A4F] text-white uppercase text-[10px] font-semibold tracking-wider">
                  <tr>
                    <th className="py-3.5 px-4">Nama Pelanggan</th>
                    <th className="py-3.5 px-4">WhatsApp / Kontak</th>
                    <th className="py-3.5 px-4">Area & Lokasi</th>
                    <th className="py-3.5 px-4 text-center">Segmen</th>
                    <th className="py-3.5 px-4 text-center">Selesai</th>
                    <th className="py-3.5 px-4">Total Spend</th>
                    <th className="py-3.5 px-4">Favorit (Layanan & Terapis)</th>
                    <th className="py-3.5 px-4">Treatment Terakhir</th>
                    <th className="py-3.5 px-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Tidak ada pelanggan yang sesuai kriteria pencarian.
                      </td>
                    </tr>
                  ) : (
                    (filteredCustomers || []).map((c) => {
                      const segColor = CUSTOMER_SEGMENT_COLORS[c.customerSegment || 'NEW'] || CUSTOMER_SEGMENT_COLORS.NEW;
                      const segLabel = CUSTOMER_SEGMENT_LABELS[c.customerSegment || 'NEW'] || 'New';
                      const cleanPhone = (c.whatsapp || c.phone || '').replace(/[^0-9]/g, '');

                      return (
                        <tr
                          key={c.id}
                          onClick={() => setSelectedCustomer(c)}
                          className="hover:bg-slate-50/80 transition cursor-pointer"
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{c.name}</span>
                              {c.customerSegment === 'VIP' && (
                                <span className="px-1.5 py-0.5 rounded-full bg-[#D4AF37] text-[#082A4F] text-[9px] font-bold">
                                  VIP
                                </span>
                              )}
                            </div>
                            {c.email && <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{c.email}</div>}
                          </td>

                          <td className="py-3.5 px-4 font-mono font-medium text-slate-800" onClick={(e) => e.stopPropagation()}>
                            <a
                              href={`https://wa.me/${cleanPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-emerald-700 flex items-center gap-1"
                              title="Kirim pesan WhatsApp"
                            >
                              <Phone className="w-3 h-3 text-emerald-600" />
                              <span>{c.whatsapp || c.phone}</span>
                            </a>
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-800">{c.area || 'Palembang'}</div>
                            <div className="text-[10px] text-slate-400 max-w-xs truncate">{c.address}</div>
                          </td>

                          <td className="py-3.5 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${segColor.bg} ${segColor.text} ${segColor.border}`}>
                              {segLabel}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-center font-bold text-emerald-700">
                            {c.completedBooking || c.completedBookings || 0}
                          </td>

                          <td className="py-3.5 px-4 font-bold text-slate-900">
                            {formatRupiah(c.totalSpend || 0)}
                          </td>

                          <td className="py-3.5 px-4 text-[11px]">
                            <span className="font-medium text-slate-800 block truncate max-w-[140px]">
                              {c.favoriteServiceName || c.favoriteTreatment || '-'}
                            </span>
                            <span className="text-slate-400 text-[10px] block truncate max-w-[140px]">
                              Terapis: {c.favoriteTherapistName || c.favoriteTherapist || '-'}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-slate-500 text-[11px] whitespace-nowrap">
                            {c.lastCompletedTreatmentAt
                              ? formatDateIndo(c.lastCompletedTreatmentAt.split('T')[0])
                              : c.lastBooking || '-'}
                          </td>

                          <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setSelectedCustomer(c)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-[#082A4F] hover:text-white text-slate-700 text-xs font-semibold transition cursor-pointer"
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: RETENTION & RE-ENGAGEMENT */}
      {activeMainView === 'retention' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-amber-800">
              <Zap className="w-4 h-4 text-amber-600" />
              Strategi Retensi & Customer Re-engagement Senzu Home
            </div>
            <p className="text-[11px] leading-relaxed">
              Daftar pelanggan yang sudah lama tidak memesan treatment (30–60 hari = At-Risk, &gt;60 hari = Inactive). Hubungi mereka dengan sapaan hangat dan tawarkan kembali kenyamanan pijat refleksi langsung ke rumah.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {customers
              .filter((c) => c.customerSegment === 'AT_RISK' || c.customerSegment === 'INACTIVE')
              .map((c) => {
                const cleanPhone = (c.whatsapp || c.phone || '').replace(/[^0-9]/g, '');
                const waMessage = encodeURIComponent(
                  `Halo Kak ${c.name}, salam hangat dari Senzu Home Palembang! 😊\n\nSemoga Kakak sekeluarga selalu sehat. Sudah cukup lama sejak treatment ${c.favoriteServiceName || 'Refleksi'} terakhir Kakak. Apakah badan mulai terasa pegal atau lelah?\n\nTerapis profesional kami siap hadir kembali ke rumah Kakak dengan protokol higienis steril. Ingin kami jadwalkan sesi relaksasi minggu ini?`
                );

                return (
                  <div
                    key={c.id}
                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 hover:border-slate-300 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">{c.name}</h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              c.customerSegment === 'AT_RISK'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {c.customerSegment === 'AT_RISK' ? 'At Risk (30-60hr)' : 'Inactive (>60hr)'}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 block font-mono mt-0.5">
                          {c.whatsapp || c.phone} • {c.area || 'Palembang'}
                        </span>
                      </div>

                      <div className="text-right text-xs">
                        <span className="font-bold text-[#082A4F]">
                          {c.completedBooking || c.completedBookings || 0}x Treatment
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {formatRupiah(c.totalSpend || 0)}
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-600 flex items-center justify-between">
                      <div>
                        <span className="text-slate-400 text-[10px] block">Layanan Terakhir</span>
                        <span className="font-semibold text-slate-800">
                          {c.favoriteServiceName || 'Family Massage'}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 text-[10px] block">Tanggal Terakhir</span>
                        <span>
                          {c.lastCompletedTreatmentAt
                            ? formatDateIndo(c.lastCompletedTreatmentAt.split('T')[0])
                            : '-'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomer(c)}
                        className="text-xs text-[#082A4F] font-semibold hover:underline"
                      >
                        Buka Profil
                      </button>

                      <a
                        href={`https://wa.me/${cleanPhone}?text=${waMessage}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Sapa via WhatsApp</span>
                      </a>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* VIEW 3: SERVICE RECOVERY QUEUE */}
      {activeMainView === 'service_recovery' && (
        <div className="space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-900 text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              Antrean Tindak Lanjut Ulasan &lt;= 2 Bintang (Service Recovery)
            </div>
            <p className="text-[11px] leading-relaxed">
              Ulasan rendah otomatis masuk ke antrean ini agar Supervisor / Quality Control dapat segera menghubungi pelanggan, mengevaluasi terapis yang bertugas, dan memberikan solusi pemulihan kepuasan.
            </p>
          </div>

          {isRecoveryLoading ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
              <span>Memuat antrean ulasan...</span>
            </div>
          ) : recoveryReviews.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="font-bold text-slate-800 text-sm">Tidak Ada Ulasan Rendah</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Semua ulasan pelanggan saat ini berada pada rating memuaskan (&gt; 2 bintang). Pertahankan standar kualitas prima!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {(recoveryReviews || []).map((rev) => (
                <div
                  key={rev.id}
                  className="bg-white rounded-2xl border border-rose-200 p-4 sm:p-5 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          {rev.customerName || 'Pelanggan'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold">
                          Rating: {rev.overallRating}★
                        </span>
                      </div>
                      <span className="text-xs text-slate-500 block font-mono mt-0.5">
                        Kode Booking: {rev.bookingCode} • Layanan: {rev.serviceName}
                      </span>
                    </div>

                    <span className="text-[11px] text-slate-400">
                      {rev.createdAt ? formatDateIndo(rev.createdAt.split('T')[0]) : '-'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-700">
                    <span className="font-bold text-slate-500 block text-[10px] uppercase mb-1">
                      Komentar / Keluhan Pelanggan:
                    </span>
                    <p className="italic">
                      "{rev.comment || 'Tidak ada komentar teks yang disertakan.'}"
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-600 bg-slate-50/50 p-2.5 rounded-xl">
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase">Terapis Bertugas</span>
                      <span className="font-semibold text-slate-800">{rev.therapistName || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase">Kualitas Pijat</span>
                      <span>{rev.serviceRating || rev.overallRating}★</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase">Sikap Terapis</span>
                      <span>{rev.professionalismRating || rev.overallRating}★</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase">Ketepatan Waktu</span>
                      <span>{rev.punctualityRating || rev.overallRating}★</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <span className="text-xs font-semibold text-amber-700 mr-auto">
                      Status Recovery: {rev.recoveryStatus || 'pending_followup'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* CUSTOMER PROFILE DETAIL MODAL / SLIDE-OVER */}
      {/* ========================================================================= */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-4xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-[#082A4F] via-[#0C3866] to-[#082A4F] text-white p-5 sm:p-6 flex items-start justify-between shrink-0">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shrink-0 font-serif font-bold text-lg">
                  {selectedCustomer.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-serif font-bold text-lg sm:text-xl text-white">
                      {selectedCustomer.name}
                    </h3>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                        CUSTOMER_SEGMENT_COLORS[selectedCustomer.customerSegment || 'NEW']?.bg
                      } ${
                        CUSTOMER_SEGMENT_COLORS[selectedCustomer.customerSegment || 'NEW']?.text
                      } ${
                        CUSTOMER_SEGMENT_COLORS[selectedCustomer.customerSegment || 'NEW']?.border
                      }`}
                    >
                      {CUSTOMER_SEGMENT_LABELS[selectedCustomer.customerSegment || 'NEW']}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 mt-1">
                    <a
                      href={`https://wa.me/${(selectedCustomer.whatsapp || selectedCustomer.phone).replace(/[^0-9]/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-emerald-400 flex items-center gap-1 font-mono text-emerald-300"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>{selectedCustomer.whatsapp || selectedCustomer.phone}</span>
                    </a>
                    {selectedCustomer.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{selectedCustomer.email}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span>{selectedCustomer.area || 'Palembang'}</span>
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Action Toolbar */}
            <div className="bg-slate-50 border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-semibold">Status:</span>
                <select
                  value={selectedCustomer.customerStatus || 'active'}
                  onChange={(e) => handleUpdateStatus(e.target.value as CustomerStatus)}
                  className="p-1 px-2 rounded-lg border border-slate-200 bg-white font-medium text-slate-700"
                >
                  <option value="active">🟢 Active</option>
                  <option value="blocked">🔴 Blocked</option>
                  <option value="do_not_contact">⚪ Do Not Contact</option>
                  <option value="archived">📁 Archived</option>
                </select>

                <button
                  type="button"
                  onClick={handleToggleVip}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer ${
                    selectedCustomer.customerSegment === 'VIP'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-amber-50'
                  }`}
                >
                  <Award className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>{selectedCustomer.customerSegment === 'VIP' ? 'VIP Aktif' : 'Set VIP'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Buatkan Repeat Booking */}
                {onRepeatBooking && customerBookings[0] && (
                  <button
                    type="button"
                    onClick={() => {
                      onRepeatBooking(customerBookings[0]);
                      setSelectedCustomer(null);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-[#082A4F] hover:bg-[#0C3866] text-white font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Repeat className="w-3.5 h-3.5 text-[#D4AF37]" />
                    <span>Buatkan Repeat Booking</span>
                  </button>
                )}

                {/* Direct WhatsApp button */}
                <a
                  href={`https://wa.me/${(selectedCustomer.whatsapp || selectedCustomer.phone).replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center gap-1.5 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Chat WhatsApp</span>
                </a>
              </div>
            </div>

            {/* Metrics KPI Header inside Profile */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-4 bg-slate-50/50 border-b border-slate-200 shrink-0 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-slate-400 text-[10px] block uppercase font-semibold">Total Selesai</span>
                <span className="text-base font-bold text-emerald-700">
                  {selectedCustomer.completedBooking || selectedCustomer.completedBookings || 0}x Treatment
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-slate-400 text-[10px] block uppercase font-semibold">Total Nilai (Spend)</span>
                <span className="text-base font-bold text-[#082A4F]">
                  {formatRupiah(selectedCustomer.totalSpend || 0)}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-slate-400 text-[10px] block uppercase font-semibold">Layanan Favorit</span>
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {selectedCustomer.favoriteServiceName || selectedCustomer.favoriteTreatment || '-'}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                <span className="text-slate-400 text-[10px] block uppercase font-semibold">Terapis Favorit</span>
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {selectedCustomer.favoriteTherapistName || selectedCustomer.favoriteTherapist || '-'}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 col-span-2 sm:col-span-1">
                <span className="text-amber-800 text-[10px] block uppercase font-bold flex items-center gap-1">
                  <Award className="w-3 h-3 text-[#D4AF37]" />
                  <span>Loyalty & Tier</span>
                </span>
                <div className="flex items-center justify-between mt-1">
                  <span className="px-1.5 py-0.5 rounded bg-[#082A4F] text-white text-[10px] font-bold uppercase">
                    {selectedLoyaltyAccount?.currentTierId || 'Member'}
                  </span>
                  <span className="font-mono font-black text-amber-700 text-xs flex items-center gap-1">
                    <Coins className="w-3.5 h-3.5 text-amber-500" />
                    <span>{selectedLoyaltyAccount?.pointsBalance || 0} Poin</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Profile Detail Tabs */}
            <div className="flex border-b border-slate-200 px-5 gap-6 text-xs font-semibold shrink-0">
              <button
                type="button"
                onClick={() => setProfileTab('history')}
                className={`py-3 transition border-b-2 cursor-pointer ${
                  profileTab === 'history'
                    ? 'border-[#082A4F] text-[#082A4F]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Riwayat Treatment ({customerBookings.length})
              </button>

              <button
                type="button"
                onClick={() => setProfileTab('notes')}
                className={`py-3 transition border-b-2 cursor-pointer ${
                  profileTab === 'notes'
                    ? 'border-[#082A4F] text-[#082A4F]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Catatan CRM ({customerNotesList.length})
              </button>

              <button
                type="button"
                onClick={() => setProfileTab('tasks')}
                className={`py-3 transition border-b-2 cursor-pointer ${
                  profileTab === 'tasks'
                    ? 'border-[#082A4F] text-[#082A4F]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Tugas Follow-up ({customerTasksList.length})
              </button>

              <button
                type="button"
                onClick={() => setProfileTab('reviews')}
                className={`py-3 transition border-b-2 cursor-pointer ${
                  profileTab === 'reviews'
                    ? 'border-[#082A4F] text-[#082A4F]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Rating & Ulasan ({customerReviewsList.length})
              </button>

              <button
                type="button"
                onClick={() => setProfileTab('addresses')}
                className={`py-3 transition border-b-2 cursor-pointer ${
                  profileTab === 'addresses'
                    ? 'border-[#082A4F] text-[#082A4F]'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Alamat ({customerAddressesList.length})
              </button>
            </div>

            {/* Profile Tab Content */}
            <div className="overflow-y-auto p-5 flex-1 space-y-4">
              {/* TAB: HISTORY */}
              {profileTab === 'history' && (
                <div className="space-y-3">
                  {customerBookings.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs">
                      Belum ada catatan riwayat reservasi untuk pelanggan ini.
                    </div>
                  ) : (
                    (customerBookings || []).map((b) => (
                      <div
                        key={b.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-[#082A4F]">
                                {b.bookingCode}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  b.status === 'Completed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : b.status === 'Cancelled'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {b.status}
                              </span>
                            </div>
                            <h5 className="font-bold text-slate-800 text-sm mt-0.5">
                              {b.serviceName}
                            </h5>
                          </div>

                          <div className="text-right">
                            <span className="font-serif font-bold text-sm text-[#082A4F]">
                              {formatRupiah(b.totalAmount)}
                            </span>
                            <span className="block text-[10px] text-slate-400 font-medium">
                              {b.paymentStatus} ({b.paymentMethod})
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg">
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase">Jadwal</span>
                            <span>{formatDateIndo(b.scheduleDate)} • {b.scheduleTime} WIB</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase">Terapis</span>
                            <span>{b.therapistName || 'Belum ditugaskan'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase">Durasi</span>
                            <span>{b.serviceDuration} Menit</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase">Alamat</span>
                            <span className="truncate block">{b.area}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB: NOTES */}
              {profileTab === 'notes' && (
                <div className="space-y-4">
                  {/* Add Note Form */}
                  <form onSubmit={handleAddNote} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5 text-xs">
                    <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#082A4F]" />
                      Tambah Catatan Operasional CRM
                    </h5>
                    <div className="flex gap-2">
                      <select
                        value={newNoteCategory}
                        onChange={(e) => setNewNoteCategory(e.target.value as CustomerNoteCategory)}
                        className="p-2 rounded-lg border border-slate-200 bg-white"
                      >
                        <option value="preference">Preferensi Treatment</option>
                        <option value="operational">Operasional / Akses Rumah</option>
                        <option value="medical_allergy_alert">Peringatan Alergi Minyak</option>
                        <option value="complaint">Komplain / Catatan Khusus</option>
                        <option value="general">Umum</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Contoh: Suka tekanan sedang, alergi minyak lavender, pagar warna hitam..."
                        value={newNoteText}
                        onChange={(e) => setNewNoteText(e.target.value)}
                        className="flex-1 p-2 rounded-lg border border-slate-200 bg-white"
                        required
                      />
                      <button
                        type="submit"
                        disabled={isAddingNote}
                        className="px-4 py-2 bg-[#082A4F] text-white rounded-lg font-bold hover:bg-[#0C3866] transition disabled:opacity-50"
                      >
                        {isAddingNote ? 'Menyimpan...' : 'Tambah'}
                      </button>
                    </div>
                  </form>

                  {/* Notes List */}
                  {customerNotesList.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Belum ada catatan CRM untuk pelanggan ini.
                    </div>
                  ) : (
                    (customerNotesList || []).map((note) => (
                      <div
                        key={note.id}
                        className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                          note.category === 'medical_allergy_alert'
                            ? 'bg-amber-50 border-amber-200 text-amber-900'
                            : 'bg-white border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase ${
                              note.category === 'medical_allergy_alert'
                                ? 'bg-amber-200 text-amber-900'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {note.category}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatDateIndo(note.createdAt.split('T')[0])} oleh {note.authorName} ({note.authorRole})
                          </span>
                        </div>
                        <p className="leading-relaxed font-medium">{note.content}</p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB: TASKS */}
              {profileTab === 'tasks' && (
                <div className="space-y-4">
                  {/* Add Task Form */}
                  <form onSubmit={handleAddTask} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5 text-xs">
                    <h5 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5 text-[#082A4F]" />
                      Tambah Tugas / Reminder Follow-up
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input
                        type="text"
                        placeholder="Judul tugas follow-up..."
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        className="col-span-2 p-2 rounded-lg border border-slate-200 bg-white"
                        required
                      />
                      <input
                        type="date"
                        value={newTaskDueDate}
                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                        className="p-2 rounded-lg border border-slate-200 bg-white"
                        required
                      />
                      <button
                        type="submit"
                        disabled={isAddingTask}
                        className="p-2 bg-[#082A4F] text-white rounded-lg font-bold hover:bg-[#0C3866] transition disabled:opacity-50"
                      >
                        {isAddingTask ? 'Menyimpan...' : 'Simpan Tugas'}
                      </button>
                    </div>
                  </form>

                  {/* Tasks List */}
                  {customerTasksList.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Tidak ada tugas aktif untuk pelanggan ini.
                    </div>
                  ) : (
                    (customerTasksList || []).map((task) => (
                      <div
                        key={task.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => handleToggleTask(task.id, task.status)}
                            className="mt-0.5 text-[#082A4F] hover:opacity-80"
                          >
                            {task.status === 'completed' ? (
                              <CheckSquare className="w-5 h-5 text-emerald-600" />
                            ) : (
                              <Square className="w-5 h-5 text-slate-400" />
                            )}
                          </button>
                          <div>
                            <span
                              className={`font-semibold block ${
                                task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-800'
                              }`}
                            >
                              {task.title}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Jatuh tempo: {formatDateIndo(task.dueDate)} • Dibuat oleh: {task.createdByName}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            task.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {task.status === 'completed' ? 'Selesai' : 'Pending'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB: REVIEWS */}
              {profileTab === 'reviews' && (
                <div className="space-y-3">
                  {customerReviewsList.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Pelanggan ini belum pernah memberikan ulasan.
                    </div>
                  ) : (
                    (customerReviewsList || []).map((rev) => (
                      <div
                        key={rev.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-800">{rev.serviceName}</span>
                            <span className="block text-[10px] text-slate-400 font-mono">
                              Kode: {rev.bookingCode} • Terapis: {rev.therapistName || '-'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-amber-500 font-bold">
                            <Star className="w-4 h-4 fill-amber-400" />
                            <span>{rev.overallRating}.0★</span>
                          </div>
                        </div>

                        {rev.comment && (
                          <p className="text-slate-700 bg-slate-50 p-2 rounded-lg italic">
                            "{rev.comment}"
                          </p>
                        )}

                        {rev.tags && rev.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {(rev.tags || []).map((t) => (
                              <span
                                key={t}
                                className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB: ADDRESSES */}
              {profileTab === 'addresses' && (
                <div className="space-y-3">
                  {customerAddressesList.length === 0 ? (
                    <div className="text-center py-6 text-slate-400 text-xs">
                      Belum ada alamat tersimpan di luar alamat reservasi.
                    </div>
                  ) : (
                    (customerAddressesList || []).map((addr) => (
                      <div
                        key={addr.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-white text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#082A4F] flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-[#D4AF37]" />
                            {addr.label}
                          </span>
                          <span className="text-slate-400 text-[10px]">{addr.area}</span>
                        </div>
                        <p className="text-slate-700">{addr.address}</p>
                        {addr.addressNotes && (
                          <p className="text-[11px] text-slate-500 italic">
                            Patokan: {addr.addressNotes}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="px-6 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
