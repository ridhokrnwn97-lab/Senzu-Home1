import React, { useState, useEffect, useMemo } from 'react';
import {
  Award,
  Coins,
  Ticket,
  Users,
  Search,
  Filter,
  RefreshCw,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Gift,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Settings,
  DollarSign,
  TrendingUp,
  FileText,
  X,
  Check,
  Percent,
  Sliders,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { Booking, User as AuthUser } from '../types';
import { CustomerCRM } from '../types/crm';
import {
  CustomerLoyaltyAccount,
  LoyaltyTransaction,
  MembershipTier,
  Voucher,
  ReferralRecord,
  LoyaltySettings,
  DEFAULT_LOYALTY_SETTINGS,
  DEFAULT_MEMBERSHIP_TIERS
} from '../types/loyalty';
import {
  getAllLoyaltyAccounts,
  getMembershipTiers,
  updateMembershipTier,
  getLoyaltySettings,
  updateLoyaltySettings,
  getAllVouchers,
  createVoucher,
  updateVoucher,
  getAllReferrals,
  getAllLoyaltyTransactions,
  getLoyaltyTransactions,
  adminManualPointAdjustment,
  backfillAndSyncAllLoyaltyAccounts
} from '../lib/loyaltyService';
import { formatRupiah, formatDateIndo } from '../lib/utils';

interface LoyaltyAdminViewProps {
  bookings: Booking[];
  customers: CustomerCRM[];
  currentUser?: AuthUser | null;
}

export const LoyaltyAdminView: React.FC<LoyaltyAdminViewProps> = ({
  bookings,
  customers,
  currentUser,
}) => {
  const [activeTab, setActiveTab] = useState<'members' | 'vouchers' | 'tiers' | 'referrals' | 'settings'>('members');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // Core Data
  const [accounts, setAccounts] = useState<CustomerLoyaltyAccount[]>([]);
  const [tiers, setTiers] = useState<MembershipTier[]>(DEFAULT_MEMBERSHIP_TIERS);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [settings, setSettings] = useState<LoyaltySettings>(DEFAULT_LOYALTY_SETTINGS);

  // Search & Filter state for members
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState<string>('all');

  // Manual adjustment modal state
  const [adjustingAccount, setAdjustingAccount] = useState<CustomerLoyaltyAccount | null>(null);
  const [adjustmentDelta, setAdjustmentDelta] = useState<number>(50);
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'deduct'>('add');
  const [adjustmentReason, setAdjustmentReason] = useState<string>('Bonus apresiasi loyalitas pelanggan');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Customer Ledger Modal state
  const [ledgerAccount, setLedgerAccount] = useState<CustomerLoyaltyAccount | null>(null);
  const [customerLedger, setCustomerLedger] = useState<LoyaltyTransaction[]>([]);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);

  // Create Voucher Modal state
  const [isCreateVoucherOpen, setIsCreateVoucherOpen] = useState(false);
  const [voucherForm, setVoucherForm] = useState({
    code: '',
    name: '',
    description: '',
    voucherType: 'fixed_discount' as 'fixed_discount' | 'percentage_discount',
    value: 20000,
    minimumSpend: 100000,
    maximumDiscount: 50000,
    usageLimitTotal: 100,
    usageLimitPerCustomer: 1,
    validFrom: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    enabled: true,
  });

  // Edit Tier Modal state
  const [editingTier, setEditingTier] = useState<MembershipTier | null>(null);

  // Settings form
  const [settingsForm, setSettingsForm] = useState<LoyaltySettings>(DEFAULT_LOYALTY_SETTINGS);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [accs, trs, vchs, refs, stgs] = await Promise.all([
        getAllLoyaltyAccounts(),
        getMembershipTiers(),
        getAllVouchers(),
        getAllReferrals(),
        getLoyaltySettings(),
      ]);
      setAccounts(accs);
      setTiers(trs);
      setVouchers(vchs);
      setReferrals(refs);
      setSettings(stgs);
      setSettingsForm(stgs);
    } catch (err) {
      console.error('Error loading loyalty admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Handle Sync / Backfill
  const handleSyncAccounts = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await backfillAndSyncAllLoyaltyAccounts(bookings, customers);
      await loadAllData();
      setSyncFeedback(`Sinkronisasi berhasil! ${res.totalAccountsSynced} akun pelanggan diperbarui.`);
      setTimeout(() => setSyncFeedback(null), 5000);
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncFeedback('Sinkronisasi gagal, silakan coba beberapa saat lagi.');
    } finally {
      setIsSyncing(false);
    }
  };

  // KPIs
  const totalMembers = accounts.length;
  const totalPointsCirculating = useMemo(() => {
    return accounts.reduce((sum, a) => sum + (a.pointsBalance || 0), 0);
  }, [accounts]);
  const pointsLiabilityRp = totalPointsCirculating * (settings.pointValueInRupiah || 100);

  const totalPointsEarned = useMemo(() => {
    return accounts.reduce((sum, a) => sum + (a.lifetimePointsEarned || 0), 0);
  }, [accounts]);

  const totalPointsRedeemed = useMemo(() => {
    return accounts.reduce((sum, a) => sum + (a.lifetimePointsRedeemed || 0), 0);
  }, [accounts]);

  const activeVouchersCount = vouchers.filter((v) => v.enabled).length;
  const qualifiedReferralsCount = referrals.filter((r) => r.status === 'rewarded' || r.status === 'qualified').length;

  // Filtered Accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesTier = selectedTierFilter === 'all' || acc.currentTierId === selectedTierFilter;
      const q = memberSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (acc.customerName && acc.customerName.toLowerCase().includes(q)) ||
        (acc.customerPhone && acc.customerPhone.includes(q)) ||
        (acc.memberNumber && acc.memberNumber.toLowerCase().includes(q)) ||
        (acc.referralCode && acc.referralCode.toLowerCase().includes(q));
      return matchesTier && matchesSearch;
    });
  }, [accounts, selectedTierFilter, memberSearch]);

  // Open Ledger
  const handleOpenLedger = async (account: CustomerLoyaltyAccount) => {
    setLedgerAccount(account);
    setIsLoadingLedger(true);
    try {
      const txs = await getLoyaltyTransactions(account.customerId);
      setCustomerLedger(txs);
    } catch (err) {
      console.error('Failed to load ledger:', err);
    } finally {
      setIsLoadingLedger(false);
    }
  };

  // Submit Manual Adjustment
  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingAccount) return;
    if (adjustmentDelta <= 0) {
      setAdjustError('Nilai penyesuaian poin harus lebih dari 0.');
      return;
    }
    if (!adjustmentReason.trim()) {
      setAdjustError('Alasan penyesuaian wajib diisi untuk audit log.');
      return;
    }

    setIsAdjusting(true);
    setAdjustError(null);
    try {
      const delta = adjustmentType === 'add' ? adjustmentDelta : -adjustmentDelta;
      await adminManualPointAdjustment({
        customerId: adjustingAccount.customerId,
        pointsDelta: delta,
        reason: adjustmentReason.trim(),
        adminName: currentUser?.name || 'CSS / Admin Senzu',
      });

      // Reload accounts & close
      await loadAllData();
      setAdjustingAccount(null);
      setAdjustmentReason('Bonus apresiasi loyalitas pelanggan');
    } catch (err: any) {
      setAdjustError(err.message || 'Gagal melakukan penyesuaian poin.');
    } finally {
      setIsAdjusting(false);
    }
  };

  // Submit Create Voucher
  const handleCreateVoucherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voucherForm.code.trim() || !voucherForm.name.trim()) return;

    try {
      await createVoucher({
        code: voucherForm.code.trim().toUpperCase(),
        name: voucherForm.name.trim(),
        description: voucherForm.description.trim(),
        voucherType: voucherForm.voucherType,
        value: Number(voucherForm.value),
        minimumSpend: Number(voucherForm.minimumSpend),
        maximumDiscount: Number(voucherForm.maximumDiscount),
        usageLimitTotal: Number(voucherForm.usageLimitTotal),
        usageLimitPerCustomer: Number(voucherForm.usageLimitPerCustomer),
        validFrom: new Date(voucherForm.validFrom).toISOString(),
        validUntil: new Date(voucherForm.validUntil).toISOString(),
        enabled: voucherForm.enabled,
        stackable: false,
      });
      setIsCreateVoucherOpen(false);
      await loadAllData();
    } catch (err) {
      console.error('Create voucher error:', err);
    }
  };

  // Toggle Voucher
  const handleToggleVoucher = async (v: Voucher) => {
    try {
      await updateVoucher(v.id, { enabled: !v.enabled });
      setVouchers((prev) =>
        (prev || []).map((item) => (item.id === v.id ? { ...item, enabled: !item.enabled } : item))
      );
    } catch (err) {
      console.error('Toggle voucher error:', err);
    }
  };

  // Save Tier
  const handleSaveTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTier) return;
    try {
      await updateMembershipTier(editingTier);
      setTiers((prev) => (prev || []).map((t) => (t.id === editingTier.id ? editingTier : t)));
      setEditingTier(null);
    } catch (err) {
      console.error('Save tier error:', err);
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsFeedback(null);
    try {
      const updated = await updateLoyaltySettings(settingsForm, currentUser?.name || 'Admin');
      setSettings(updated);
      setSettingsFeedback('Pengaturan program loyalitas berhasil diperbarui!');
      setTimeout(() => setSettingsFeedback(null), 4000);
    } catch (err) {
      console.error('Save settings error:', err);
      setSettingsFeedback('Gagal menyimpan pengaturan.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#082A4F] text-[#D4AF37] flex items-center justify-center shadow-md">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif font-bold text-xl text-[#082A4F]">
                Loyalty, Membership & Rewards
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-[#D4AF37]/20 text-[#082A4F] text-[10px] font-bold">
                PROMPT 8
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Kelola saldo poin pelanggan, tier keanggotaan, voucher promo, referral & audit mutasi.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncAccounts}
            disabled={isSyncing}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
            title="Sinkronkan data spend & bookings pelanggan dari database reservasi"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-[#082A4F]' : ''}`} />
            <span>{isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Akun CRM'}</span>
          </button>
        </div>
      </div>

      {syncFeedback && (
        <div className="p-3 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{syncFeedback}</span>
        </div>
      )}

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Total Member Aktif</span>
            <Users className="w-4 h-4 text-[#082A4F]" />
          </div>
          <div className="font-serif font-bold text-2xl text-[#082A4F]">{totalMembers}</div>
          <div className="text-[11px] text-slate-500">
            {accounts.filter((a) => a.currentTierId !== 'member').length} Tier Premium (Silver+)
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Poin Beredar (Liabilitas)</span>
            <Coins className="w-4 h-4 text-[#D4AF37]" />
          </div>
          <div className="font-serif font-bold text-2xl text-amber-600">
            {totalPointsCirculating.toLocaleString('id-ID')}{' '}
            <span className="text-xs font-sans text-slate-400">Poin</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Nilai klaim: <strong className="text-slate-800">{formatRupiah(pointsLiabilityRp)}</strong>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Poin Diberikan / Digunakan</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="font-serif font-bold text-lg text-slate-800 flex items-center gap-2">
            <span className="text-emerald-700">+{totalPointsEarned}</span>
            <span className="text-slate-300">/</span>
            <span className="text-rose-600">-{totalPointsRedeemed}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Rasio klaim poin:{' '}
            {totalPointsEarned > 0
              ? `${Math.round((totalPointsRedeemed / totalPointsEarned) * 100)}%`
              : '0%'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Voucher & Referral</span>
            <Ticket className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="font-serif font-bold text-2xl text-[#082A4F]">
            {activeVouchersCount}{' '}
            <span className="text-xs font-sans text-slate-400">Aktif</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {qualifiedReferralsCount} konversi teman berhasil
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-6 text-xs font-bold overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          className={`pb-3 border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'members'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Akun Member & Saldo Poin ({accounts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('vouchers')}
          className={`pb-3 border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'vouchers'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Ticket className="w-4 h-4" />
          <span>Manajemen Voucher & Promo ({vouchers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tiers')}
          className={`pb-3 border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'tiers'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Award className="w-4 h-4" />
          <span>Tingkat Membership ({tiers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('referrals')}
          className={`pb-3 border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'referrals'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Program Referral ({referrals.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`pb-3 border-b-2 flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            activeTab === 'settings'
              ? 'border-[#082A4F] text-[#082A4F]'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Aturan & Konfigurasi Poin</span>
        </button>
      </div>

      {/* ----------------- TAB 1: MEMBERS & POINTS ----------------- */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Cari nama, WhatsApp, No. Member, Referral..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-[#082A4F] bg-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs text-slate-500 shrink-0">Filter Tier:</span>
              <select
                value={selectedTierFilter}
                onChange={(e) => setSelectedTierFilter(e.target.value)}
                className="p-2 text-xs rounded-xl border border-slate-200 bg-white"
              >
                <option value="all">Semua Tier ({accounts.length})</option>
                {(tiers || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    Tier {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Members Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="p-3.5">No. Member & Pelanggan</th>
                    <th className="p-3.5">Tier Saat Ini</th>
                    <th className="p-3.5 text-right">Belanja Kualifikasi</th>
                    <th className="p-3.5 text-center">Treatment</th>
                    <th className="p-3.5 text-right">Saldo Poin</th>
                    <th className="p-3.5">Kode Referral</th>
                    <th className="p-3.5 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        Tidak ada akun member yang sesuai filter.
                      </td>
                    </tr>
                  ) : (
                    (filteredAccounts || []).map((acc) => {
                      const tier = tiers.find((t) => t.id === acc.currentTierId) || tiers[0];
                      return (
                        <tr key={acc.id} className="hover:bg-slate-50/80 transition">
                          <td className="p-3.5">
                            <div className="font-bold text-[#082A4F]">{acc.customerName}</div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                              <span>{acc.customerPhone}</span>
                              <span className="px-1.5 py-0.2 rounded bg-slate-100 text-[#082A4F] font-bold">
                                {acc.memberNumber}
                              </span>
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                                acc.currentTierId === 'platinum'
                                  ? 'bg-purple-100 text-purple-900 border border-purple-200'
                                  : acc.currentTierId === 'gold'
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : acc.currentTierId === 'silver'
                                  ? 'bg-slate-200 text-slate-800'
                                  : 'bg-amber-800/10 text-amber-900'
                              }`}
                            >
                              ★ {tier?.name || 'Member'}
                            </span>
                          </td>
                          <td className="p-3.5 text-right font-mono font-semibold text-slate-700">
                            {formatRupiah(acc.qualifiedSpend || 0)}
                          </td>
                          <td className="p-3.5 text-center font-semibold text-slate-700">
                            {acc.qualifiedBookings || 0} sesi
                          </td>
                          <td className="p-3.5 text-right">
                            <span className="font-mono font-bold text-sm text-amber-600">
                              {acc.pointsBalance || 0}
                            </span>{' '}
                            <span className="text-[10px] text-slate-400">Poin</span>
                            <div className="text-[10px] text-slate-400">
                              ≈ {formatRupiah((acc.pointsBalance || 0) * (settings.pointValueInRupiah || 100))}
                            </div>
                          </td>
                          <td className="p-3.5">
                            <span className="font-mono text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                              {acc.referralCode}
                            </span>
                            <div className="text-[10px] text-slate-400">
                              {acc.referralCount || 0} referral
                            </div>
                          </td>
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenLedger(acc)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                                title="Lihat Mutasi Ledger Poin"
                              >
                                <FileText className="w-3.5 h-3.5 text-[#082A4F]" />
                                <span>Ledger</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setAdjustingAccount(acc);
                                  setAdjustmentDelta(50);
                                  setAdjustmentType('add');
                                  setAdjustmentReason('Bonus apresiasi loyalitas pelanggan');
                                  setAdjustError(null);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold flex items-center gap-1 transition border border-amber-200 cursor-pointer"
                                title="Koreksi / Tambah Poin Manual"
                              >
                                <Coins className="w-3.5 h-3.5 text-amber-600" />
                                <span>Sesuaikan</span>
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
        </div>
      )}

      {/* ----------------- TAB 2: VOUCHERS & PROMOS ----------------- */}
      {activeTab === 'vouchers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Buat dan aktifkan voucher diskon, promo musiman, atau kode diskon khusus pelanggan.
            </p>
            <button
              type="button"
              onClick={() => setIsCreateVoucherOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-[#082A4F] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm hover:bg-[#0D3866] transition cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#D4AF37]" />
              <span>Buat Voucher Baru</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vouchers.length === 0 ? (
              <div className="col-span-full p-8 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200 text-xs">
                Belum ada voucher atau promo code yang dibuat.
              </div>
            ) : (
              (vouchers || []).map((v) => {
                const isExpired = v.validUntil && new Date(v.validUntil) < new Date();

                return (
                  <div
                    key={v.id}
                    className={`bg-white p-4 rounded-2xl border transition shadow-sm space-y-3 ${
                      !v.enabled || isExpired
                        ? 'border-slate-200 opacity-60 bg-slate-50/50'
                        : 'border-emerald-200/80 hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-sm font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-lg border border-emerald-200">
                          {v.code}
                        </span>
                        <h4 className="font-bold text-slate-900 text-xs mt-1.5">{v.name}</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleVoucher(v)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase transition cursor-pointer ${
                          v.enabled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {v.enabled ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {v.description || 'Voucher diskon treatment Senzu Home.'}
                    </p>

                    <div className="p-2.5 rounded-xl bg-slate-50 space-y-1 text-[11px] text-slate-600 font-mono">
                      <div className="flex justify-between">
                        <span>Nilai Diskon:</span>
                        <strong className="text-emerald-700">
                          {v.voucherType === 'percentage' || (v.voucherType as any) === 'percentage_discount'
                            ? `${v.value}% (Maks ${formatRupiah(v.maximumDiscount || 50000)})`
                            : formatRupiah(v.value)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Min. Belanja:</span>
                        <span>{formatRupiah(v.minimumSpend || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pemakaian:</span>
                        <span>
                          {v.currentUsageCount || 0} / {v.usageLimitTotal || '∞'} kuota
                        </span>
                      </div>
                      {v.validUntil && (
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>Berlaku s/d:</span>
                          <span>{formatDateIndo(v.validUntil)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ----------------- TAB 3: MEMBERSHIP TIERS ----------------- */}
      {activeTab === 'tiers' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Aturan peningkatan level keanggotaan berdasarkan riwayat belanja dan jumlah booking yang telah selesai & terbayar.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(tiers || []).map((tier) => (
              <div
                key={tier.id}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 relative"
              >
                <div className="flex items-center justify-between">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
                    style={{ backgroundColor: `${tier.badgeColor || '#082A4F'}15`, color: tier.badgeColor || '#082A4F' }}
                  >
                    <Award className="w-5 h-5" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingTier(tier)}
                    className="text-[11px] text-[#082A4F] font-bold hover:underline cursor-pointer"
                  >
                    Edit Aturan
                  </button>
                </div>

                <div>
                  <h4 className="font-serif font-bold text-base text-[#082A4F]">Tier {tier.name}</h4>
                  <p className="text-[11px] text-slate-500">{tier.description}</p>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Syarat Belanja:</span>
                    <strong className="font-mono text-[#082A4F]">{formatRupiah(tier.minimumSpend)}</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Syarat Booking:</span>
                    <strong className="font-mono text-[#082A4F]">{tier.minimumBookings} sesi</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Diskon Treatment:</span>
                    <strong className="font-mono text-emerald-700">{tier.discountPercentage}%</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Pengali Poin:</span>
                    <strong className="font-mono text-amber-600">{tier.pointMultiplier}x</strong>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Bonus Ulang Tahun:</span>
                    <strong className="font-mono text-pink-700">{tier.birthdayBonusPoints} Poin</strong>
                  </div>
                </div>

                {tier.perks && tier.perks.length > 0 && (
                  <div className="border-t border-slate-100 pt-3 space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Keuntungan:</span>
                    <ul className="text-[11px] text-slate-600 space-y-1">
                      {(tier.perks || []).map((p, idx) => (
                        <li key={idx} className="flex items-center gap-1.5">
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ----------------- TAB 4: REFERRALS ----------------- */}
      {activeTab === 'referrals' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-serif font-bold text-sm text-[#082A4F]">
                  Daftar Konversi Referral Teman
                </h4>
                <p className="text-xs text-slate-500">
                  Riwayat pemakaian kode referral teman beserta status pemberian reward poin.
                </p>
              </div>
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-100">
                {referrals.length} Total Undangan
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Pengajak (Referrer)</th>
                    <th className="p-3">Teman yang Diajak (Referred)</th>
                    <th className="p-3">Kode Digunakan</th>
                    <th className="p-3">Booking Pertama</th>
                    <th className="p-3">Status Reward</th>
                    <th className="p-3 text-right">Bonus Poin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {referrals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        Belum ada data referral tercatat.
                      </td>
                    </tr>
                  ) : (
                    (referrals || []).map((ref) => (
                      <tr key={ref.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-[#082A4F]">
                          {ref.referrerName}
                          <span className="block text-[10px] text-slate-400 font-mono">
                            {ref.referrerPhone}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="font-semibold text-slate-800">{ref.referredCustomerName}</span>
                          <span className="block text-[10px] text-slate-400 font-mono">
                            {ref.referredCustomerPhone}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-bold text-indigo-700">
                          {ref.referralCode}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-slate-600">
                          {ref.firstBookingCode || '-'}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              ref.status === 'rewarded'
                                ? 'bg-emerald-100 text-emerald-800'
                                : ref.status === 'qualified'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {ref.status}
                          </span>
                        </td>
                        <td className="p-3 text-right font-bold text-emerald-600 font-mono">
                          +{ref.referrerRewardPoints || 50} Poin
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

      {/* ----------------- TAB 5: GLOBAL SETTINGS ----------------- */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6 max-w-2xl">
          <div>
            <h4 className="font-serif font-bold text-base text-[#082A4F]">Konfigurasi Nilai & Aturan Poin</h4>
            <p className="text-xs text-slate-500">
              Ubah rasio perolehan poin per pembelanjaan, konversi nilai Rupiah, dan batas penukaran.
            </p>
          </div>

          {settingsFeedback && (
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{settingsFeedback}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Belanja per 1 Poin (Rupiah):
              </label>
              <input
                type="number"
                value={settingsForm.spendPerPoint}
                onChange={(e) => setSettingsForm({ ...settingsForm, spendPerPoint: Number(e.target.value) })}
                className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-400">Contoh: Rp 10.000 = 1 Poin</span>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Nilai 1 Poin dalam Rupiah:
              </label>
              <input
                type="number"
                value={settingsForm.pointValueInRupiah}
                onChange={(e) => setSettingsForm({ ...settingsForm, pointValueInRupiah: Number(e.target.value) })}
                className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-400">Contoh: 1 Poin = Rp 100 diskon</span>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Maksimal Potongan Poin (% dari Total):
              </label>
              <input
                type="number"
                value={settingsForm.maxRedeemDiscountPercent}
                onChange={(e) => setSettingsForm({ ...settingsForm, maxRedeemDiscountPercent: Number(e.target.value) })}
                className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-400">Default: 30% dari subtotal</span>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Minimal Poin untuk Ditukarkan:
              </label>
              <input
                type="number"
                value={settingsForm.minPointsToRedeem}
                onChange={(e) => setSettingsForm({ ...settingsForm, minPointsToRedeem: Number(e.target.value) })}
                className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-400">Default: 50 Poin (Rp 5.000)</span>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Masa Berlaku Poin (Hari):
              </label>
              <input
                type="number"
                value={settingsForm.pointsValidityDays}
                onChange={(e) => setSettingsForm({ ...settingsForm, pointsValidityDays: Number(e.target.value) })}
                className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-400">Default: 365 hari (12 bulan)</span>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">
                Bonus Poin Referral untuk Pengajak:
              </label>
              <input
                type="number"
                value={settingsForm.referrerRewardPoints}
                onChange={(e) => setSettingsForm({ ...settingsForm, referrerRewardPoints: Number(e.target.value) })}
                className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
              />
              <span className="text-[10px] text-slate-400">Default: +50 Poin</span>
            </div>
          </div>

          <div className="flex justify-end pt-3">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="px-6 py-2.5 bg-[#082A4F] text-white text-xs font-bold rounded-xl hover:bg-[#0D3866] transition disabled:opacity-50 cursor-pointer"
            >
              {isSavingSettings ? 'Menyimpan...' : 'Simpan Perubahan Aturan'}
            </button>
          </div>
        </form>
      )}

      {/* ----------------- MODAL: MANUAL ADJUSTMENT ----------------- */}
      {adjustingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-[#082A4F] flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                <span>Penyesuaian Poin Manual (Audit Log)</span>
              </h4>
              <button
                type="button"
                onClick={() => setAdjustingAccount(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl space-y-1 text-xs">
              <div className="font-bold text-[#082A4F]">{adjustingAccount.customerName}</div>
              <div className="text-slate-500 font-mono">{adjustingAccount.customerPhone} • {adjustingAccount.memberNumber}</div>
              <div className="text-slate-700">
                Saldo Poin Saat Ini:{' '}
                <strong className="text-amber-700 font-bold">{adjustingAccount.pointsBalance} Poin</strong>
              </div>
            </div>

            {adjustError && (
              <div className="p-2.5 bg-rose-50 text-rose-800 rounded-xl border border-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{adjustError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitAdjustment} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Jenis Penyesuaian:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustmentType('add')}
                    className={`py-2 rounded-xl font-bold border transition flex items-center justify-center gap-1 cursor-pointer ${
                      adjustmentType === 'add'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                    <span>Tambah (+)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustmentType('deduct')}
                    className={`py-2 rounded-xl font-bold border transition flex items-center justify-center gap-1 cursor-pointer ${
                      adjustmentType === 'deduct'
                        ? 'bg-rose-50 border-rose-500 text-rose-800'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    <ArrowDownRight className="w-4 h-4 text-rose-600" />
                    <span>Kurangi (-)</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Jumlah Poin:</label>
                <input
                  type="number"
                  min="1"
                  value={adjustmentDelta}
                  onChange={(e) => setAdjustmentDelta(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono font-bold text-[#082A4F]"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">
                  Alasan Wajib (Dicatat pada Ledger):
                </label>
                <textarea
                  rows={2}
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Misal: Kompensasi keterlambatan terapis / Bonus program khusus..."
                  className="w-full p-2.5 rounded-xl border border-slate-200"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustingAccount(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isAdjusting}
                  className="px-5 py-2 rounded-xl bg-[#082A4F] text-white font-bold hover:bg-[#0D3866] transition disabled:opacity-50 cursor-pointer"
                >
                  {isAdjusting ? 'Menyimpan...' : 'Simpan Penyesuaian'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: CUSTOMER LEDGER ----------------- */}
      {ledgerAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div>
                <h4 className="font-bold text-sm text-[#082A4F] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#D4AF37]" />
                  <span>Buku Mutasi Poin (Ledger)</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  {ledgerAccount.customerName} ({ledgerAccount.memberNumber}) • Saldo:{' '}
                  <strong className="text-amber-700">{ledgerAccount.pointsBalance} Poin</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLedgerAccount(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-2 pr-1 text-xs">
              {isLoadingLedger ? (
                <div className="py-8 text-center text-slate-400">Memuat catatan ledger...</div>
              ) : customerLedger.length === 0 ? (
                <div className="py-8 text-center text-slate-400">Belum ada mutasi poin tercatat.</div>
              ) : (
                (customerLedger || []).map((tx) => {
                  const isPositive = tx.points > 0;
                  return (
                    <div
                      key={tx.id}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-800">{tx.reason}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {formatDateIndo(tx.createdAt)} • Jenis: {tx.transactionType}
                          {tx.bookingCode && ` • Booking: ${tx.bookingCode}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-mono font-bold text-sm ${
                            isPositive ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isPositive ? `+${tx.points}` : tx.points}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          Saldo: {tx.balanceAfter} Poin
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => setLedgerAccount(null)}
                className="px-5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: CREATE VOUCHER ----------------- */}
      {isCreateVoucherOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-[#082A4F] flex items-center gap-2">
                <Ticket className="w-4 h-4 text-emerald-600" />
                <span>Buat Voucher / Kode Promo Baru</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsCreateVoucherOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateVoucherSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Kode Promo (Caps):</label>
                  <input
                    type="text"
                    value={voucherForm.code}
                    onChange={(e) => setVoucherForm({ ...voucherForm, code: e.target.value.toUpperCase() })}
                    placeholder="SENZUHEMAT20"
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono font-bold uppercase"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Nama Voucher:</label>
                  <input
                    type="text"
                    value={voucherForm.name}
                    onChange={(e) => setVoucherForm({ ...voucherForm, name: e.target.value })}
                    placeholder="Diskon Pembukaan Palembang"
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-semibold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Tipe Diskon:</label>
                  <select
                    value={voucherForm.voucherType}
                    onChange={(e) => setVoucherForm({ ...voucherForm, voucherType: e.target.value as any })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 bg-white"
                  >
                    <option value="fixed_discount">Potongan Nominal (Rp)</option>
                    <option value="percentage_discount">Persentase (%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">
                    Nilai ({voucherForm.voucherType === 'percentage_discount' ? '%' : 'Rp'}):
                  </label>
                  <input
                    type="number"
                    value={voucherForm.value}
                    onChange={(e) => setVoucherForm({ ...voucherForm, value: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Minimal Belanja (Rp):</label>
                  <input
                    type="number"
                    value={voucherForm.minimumSpend}
                    onChange={(e) => setVoucherForm({ ...voucherForm, minimumSpend: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Maksimal Diskon (Rp):</label>
                  <input
                    type="number"
                    value={voucherForm.maximumDiscount}
                    onChange={(e) => setVoucherForm({ ...voucherForm, maximumDiscount: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Total Kuota Penggunaan:</label>
                  <input
                    type="number"
                    value={voucherForm.usageLimitTotal}
                    onChange={(e) => setVoucherForm({ ...voucherForm, usageLimitTotal: Number(e.target.value) })}
                    className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Berlaku Sampai Tanggal:</label>
                  <input
                    type="date"
                    value={voucherForm.validUntil}
                    onChange={(e) => setVoucherForm({ ...voucherForm, validUntil: e.target.value })}
                    className="w-full p-2.5 rounded-xl border border-slate-200"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsCreateVoucherOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#082A4F] text-white font-bold hover:bg-[#0D3866] transition cursor-pointer"
                >
                  Simpan & Rilis Voucher
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ----------------- MODAL: EDIT TIER ----------------- */}
      {editingTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="font-bold text-sm text-[#082A4F]">
                Edit Parameter Tier: {editingTier.name}
              </h4>
              <button
                type="button"
                onClick={() => setEditingTier(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTier} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Syarat Belanja Minimum (Rp):</label>
                <input
                  type="number"
                  value={editingTier.minimumSpend}
                  onChange={(e) => setEditingTier({ ...editingTier, minimumSpend: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Syarat Booking Selesai (Sesi):</label>
                <input
                  type="number"
                  value={editingTier.minimumBookings}
                  onChange={(e) => setEditingTier({ ...editingTier, minimumBookings: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Diskon Otomatis (%):</label>
                <input
                  type="number"
                  value={editingTier.discountPercentage}
                  onChange={(e) => setEditingTier({ ...editingTier, discountPercentage: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Pengali Poin (Multiplier):</label>
                <input
                  type="number"
                  step="0.1"
                  value={editingTier.pointMultiplier}
                  onChange={(e) => setEditingTier({ ...editingTier, pointMultiplier: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Bonus Poin Ulang Tahun:</label>
                <input
                  type="number"
                  value={editingTier.birthdayBonusPoints}
                  onChange={(e) => setEditingTier({ ...editingTier, birthdayBonusPoints: Number(e.target.value) })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingTier(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#082A4F] text-white font-bold hover:bg-[#0D3866] transition cursor-pointer"
                >
                  Simpan Tier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
