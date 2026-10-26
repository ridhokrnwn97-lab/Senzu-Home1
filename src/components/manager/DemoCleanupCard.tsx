import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  UserX,
  UserCheck,
  RefreshCw,
  Search,
  Users,
  Info,
  ExternalLink,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { StaffUser, Booking } from '../../types';
import {
  analyzeDemoAccounts,
  disableStaffLoginAccount,
  enableStaffLoginAccount,
  DemoCleanupAuditReport,
} from '../../lib/staffAuthService';
import { getStaffMasterUsers } from '../../lib/masterDataService';

interface DemoCleanupCardProps {
  staffList?: StaffUser[];
  bookings?: Booking[];
  currentUser: StaffUser;
  onRefresh?: () => void;
  onOpenStaffMaster?: () => void;
  isReadOnly?: boolean;
}

const DEFAULT_METRICS = {
  totalAccounts: 0,
  realAccountsCount: 0,
  demoAccountsRemaining: 0,
  disabledDemoCount: 0,
  managerReady: false,
  supervisorReady: false,
  cssReady: false,
  activeTherapistsReadyCount: 0,
  totalTherapistsCount: 0,
  isSystemMigrationReady: false,
};

export const DemoCleanupCard: React.FC<DemoCleanupCardProps> = ({
  staffList,
  bookings = [],
  currentUser,
  onRefresh,
  onOpenStaffMaster,
  isReadOnly = false,
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Self-loading state when staffList is not provided via props
  const [internalStaffList, setInternalStaffList] = useState<StaffUser[]>(
    Array.isArray(staffList) ? staffList : []
  );
  const [loadingStaff, setLoadingStaff] = useState<boolean>(
    !staffList || staffList.length === 0
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStaffData = async () => {
    setLoadingStaff(true);
    setLoadError(null);
    try {
      const users = await getStaffMasterUsers();
      setInternalStaffList(Array.isArray(users) ? users : []);
    } catch (err: any) {
      console.error('Error loading staff for demo cleanup:', err);
      setLoadError(err?.message || 'Gagal memuat data staf untuk analisis demo.');
    } finally {
      setLoadingStaff(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (staffList && staffList.length > 0) {
      setInternalStaffList(staffList);
      setLoadingStaff(false);
      return;
    }

    const initLoad = async () => {
      setLoadingStaff(true);
      setLoadError(null);
      try {
        const users = await getStaffMasterUsers();
        if (isMounted) {
          setInternalStaffList(Array.isArray(users) ? users : []);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading staff for demo cleanup:', err);
          setLoadError(err?.message || 'Gagal memuat data staf.');
        }
      } finally {
        if (isMounted) {
          setLoadingStaff(false);
        }
      }
    };

    initLoad();
    return () => {
      isMounted = false;
    };
  }, [staffList]);

  // Guaranteed safe lists
  const effectiveStaffList = useMemo(() => {
    if (staffList && staffList.length > 0) return staffList;
    return Array.isArray(internalStaffList) ? internalStaffList : [];
  }, [staffList, internalStaffList]);

  const effectiveBookings = useMemo(() => {
    return Array.isArray(bookings) ? bookings : [];
  }, [bookings]);

  // Analyze demo accounts vs production accounts safely
  const report: DemoCleanupAuditReport = useMemo(() => {
    try {
      const res = analyzeDemoAccounts(effectiveStaffList, effectiveBookings);
      return {
        items: Array.isArray(res?.items) ? res.items : [],
        metrics: res?.metrics || DEFAULT_METRICS,
      };
    } catch (err) {
      console.error('Failed to analyze demo accounts:', err);
      return {
        items: [],
        metrics: DEFAULT_METRICS,
      };
    }
  }, [effectiveStaffList, effectiveBookings]);

  const filteredItems = useMemo(() => {
    const rawItems = Array.isArray(report?.items) ? report.items : [];
    return rawItems.filter((item) => {
      if (!item || !item.staff) return false;
      if (filterCategory !== 'ALL' && item.category !== filterCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (item.staff.name || '').toLowerCase().includes(q);
        const matchEmail = (item.staff.email || '').toLowerCase().includes(q);
        const matchRole = (item.staff.role || '').toLowerCase().includes(q);
        const matchCode = (item.staff.employeeCode || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchRole && !matchCode) return false;
      }
      return true;
    });
  }, [report, filterCategory, searchQuery]);

  const handleToggleDisable = async (staff: StaffUser, currentDisabled: boolean) => {
    if (isReadOnly) return;
    setActionLoadingId(staff.uid);
    setFeedbackMsg(null);

    try {
      if (currentDisabled) {
        // Re-enable
        const res = await enableStaffLoginAccount(staff, {
          id: currentUser.uid,
          name: currentUser.name,
          role: currentUser.role as 'admin' | 'manager',
        });
        setFeedbackMsg({ text: res.message, type: 'success' });
      } else {
        // Safe disable
        const res = await disableStaffLoginAccount(
          staff,
          {
            id: currentUser.uid,
            name: currentUser.name,
            role: currentUser.role as 'admin' | 'manager',
          },
          effectiveStaffList,
          effectiveBookings
        );
        setFeedbackMsg({ text: res.message, type: 'success' });
      }

      if (onRefresh) {
        onRefresh();
      }
      await loadStaffData();
    } catch (err: any) {
      setFeedbackMsg({ text: err.message || 'Gagal mengubah status akun.', type: 'error' });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRefreshClick = () => {
    if (onRefresh) {
      onRefresh();
    }
    loadStaffData();
  };

  const handleOpenStaffClick = () => {
    if (typeof onOpenStaffMaster === 'function') {
      onOpenStaffMaster();
    }
  };

  const metrics = report?.metrics || DEFAULT_METRICS;

  return (
    <div className="space-y-6">
      {/* Top Banner & Context */}
      <div className="bg-gradient-to-br from-[#8B5A36] to-[#94603B] text-white p-6 rounded-3xl shadow-md border border-[#D4AF37]/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 text-[#D4AF37] text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Prompt 15E • Production Migration &amp; Phased Demo Cleanup</span>
            </div>
            <h2 className="font-serif text-xl font-bold text-white">
              Migrasi Akun Produksi &amp; Pembersihan Akun Demo
            </h2>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Pantau kesiapan migrasi staf ke akun resmi Firebase Auth dan nonaktifkan akun demo secara bertahap dan aman tanpa menghapus riwayat transaksi operasional.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenStaffMaster && (
              <button
                type="button"
                onClick={handleOpenStaffClick}
                className="px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#c49f2e] text-[#4B2B18] text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow-xs"
              >
                <Users className="w-4 h-4" />
                <span>Buka Master Data Staff</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={loadingStaff}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer transition disabled:opacity-50"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loadingStaff ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Migration Readiness Checklist */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Checklist Kesiapan Migrasi Sistem Produksi
          </h3>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              metrics.isSystemMigrationReady
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                : 'bg-amber-100 text-amber-800 border border-amber-200'
            }`}
          >
            {metrics.isSystemMigrationReady ? 'Sistem Siap Produksi' : 'Migrasi Berlangsung'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* Manager */}
          <div className={`p-3.5 rounded-2xl border ${metrics.managerReady ? 'bg-emerald-50/60 border-emerald-200' : 'bg-amber-50/60 border-amber-200'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Akun Manager</span>
              {metrics.managerReady ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {metrics.managerReady ? 'Telah memiliki akun produksi terverifikasi' : 'Belum ada akun produksi manager'}
            </p>
          </div>

          {/* Supervisor */}
          <div className={`p-3.5 rounded-2xl border ${metrics.supervisorReady ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Supervisor</span>
              {metrics.supervisorReady ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded text-slate-700 font-semibold">Demo</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {metrics.supervisorReady ? 'Akun produksi aktif' : 'Masih menggunakan akun demo SPV001'}
            </p>
          </div>

          {/* CSS Admin */}
          <div className={`p-3.5 rounded-2xl border ${metrics.cssReady ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">CSS Admin</span>
              {metrics.cssReady ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <span className="text-[10px] bg-slate-200 px-2 py-0.5 rounded text-slate-700 font-semibold">Demo</span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {metrics.cssReady ? 'Akun produksi aktif' : 'Masih menggunakan akun demo CSS001'}
            </p>
          </div>

          {/* Therapists */}
          <div className="p-3.5 rounded-2xl border bg-slate-50 border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Terapis Resmi</span>
              <span className="text-[11px] font-mono font-bold text-[#4B2B18]">
                {metrics.activeTherapistsReadyCount} / {metrics.totalTherapistsCount}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {metrics.activeTherapistsReadyCount > 0 ? `${metrics.activeTherapistsReadyCount} terapis telah terverifikasi` : 'Semua terapis berstatus awal'}
            </p>
          </div>

          {/* Demo Accounts Remaining */}
          <div className="p-3.5 rounded-2xl border bg-slate-50 border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">Sisa Akun Demo</span>
              <span className="text-[11px] font-mono font-bold text-amber-600">
                {metrics.demoAccountsRemaining} Akun
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {metrics.disabledDemoCount} akun demo telah dinonaktifkan
            </p>
          </div>
        </div>
      </div>

      {/* Loading indicator if fetching staff list */}
      {loadingStaff && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[#4B2B18]" />
          <span>Memuat data audit akun &amp; kesiapan migrasi...</span>
        </div>
      )}

      {/* Load error message if any */}
      {loadError && (
        <div className="p-4 rounded-2xl text-xs bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadStaffData}
            className="px-3 py-1 rounded-xl bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold text-[11px] cursor-pointer"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* Feedback Alert */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center gap-2.5 ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {feedbackMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      {/* Accounts Inspection Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Filter & Search Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama, email, role..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-[#8B5A36]"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
              Filter Kategori:
            </span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="text-xs py-1.5 px-3 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B5A36]"
            >
              <option value="ALL">Semua Kategori ({(report.items || []).length})</option>
              <option value="SAFE_TO_DISABLE">Aman Dinonaktifkan</option>
              <option value="HAS_ACTIVE_REFERENCES">Memiliki Transaksi Berjalan</option>
              <option value="ALREADY_DISABLED">Sudah Dinonaktifkan</option>
              <option value="REAL_PRODUCTION">Akun Produksi Resmi</option>
            </select>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">Staf &amp; Akun</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status Akun Login</th>
                <th className="py-3 px-4">Kategori Audit</th>
                <th className="py-3 px-4">Riwayat Pesanan</th>
                <th className="py-3 px-4">Rekomendasi Tindakan</th>
                <th className="py-3 px-4 text-right">Aksi Aman</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 px-4 text-center">
                    <div className="max-w-sm mx-auto space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="font-semibold text-slate-700 text-xs">
                        {loadingStaff
                          ? 'Memuat data akun staf...'
                          : 'Tidak ada data akun yang sesuai kriteria.'}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {searchQuery
                          ? 'Coba ubah kata kunci pencarian atau reset filter kategori.'
                          : 'Seluruh akun telah terdaftar atau telah difilter.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {(filteredItems || []).map((item) => {
                const { staff, isDemo, category, totalBookings, activeBookings, recommendation } = item;
                const isCurrentlyDisabled = staff.isActive === false || staff.loginAccountStatus === 'DINONAKTIFKAN';
                const isLoading = actionLoadingId === staff.uid;

                return (
                  <tr key={staff.uid} className="hover:bg-slate-50/80 transition">
                    {/* Name & Code */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800">{staff.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {staff.email} • {staff.employeeCode || staff.uid}
                      </div>
                    </td>

                    {/* Role */}
                    <td className="py-3.5 px-4">
                      <span className="font-semibold uppercase text-[#4B2B18]">
                        {staff.role}
                      </span>
                    </td>

                    {/* Login Status */}
                    <td className="py-3.5 px-4">
                      {isCurrentlyDisabled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold">
                          <XCircle className="w-3 h-3" />
                          <span>Dinonaktifkan</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{staff.loginAccountStatus || 'Aktif'}</span>
                        </span>
                      )}
                    </td>

                    {/* Category Badge */}
                    <td className="py-3.5 px-4">
                      {category === 'REAL_PRODUCTION' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-[10px] font-bold">
                          Produksi Resmi
                        </span>
                      )}
                      {category === 'SAFE_TO_DISABLE' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold">
                          Aman Dinonaktifkan
                        </span>
                      )}
                      {category === 'HAS_ACTIVE_REFERENCES' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-50 border border-purple-200 text-purple-800 text-[10px] font-bold">
                          Ada Transaksi Aktif
                        </span>
                      )}
                      {category === 'ALREADY_DISABLED' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-bold">
                          Sudah Nonaktif
                        </span>
                      )}
                    </td>

                    {/* Booking References */}
                    <td className="py-3.5 px-4 text-[11px]">
                      <div>Total: <strong>{totalBookings}</strong> pesanan</div>
                      {activeBookings > 0 && (
                        <div className="text-purple-700 font-semibold">
                          {activeBookings} pesanan aktif
                        </div>
                      )}
                    </td>

                    {/* Recommendation */}
                    <td className="py-3.5 px-4 text-[11px] text-slate-600 max-w-xs">
                      {recommendation}
                    </td>

                    {/* Safe Action */}
                    <td className="py-3.5 px-4 text-right">
                      {category === 'REAL_PRODUCTION' ? (
                        <span className="text-[10px] text-slate-400 italic">Akun Utama</span>
                      ) : isCurrentlyDisabled ? (
                        <button
                          type="button"
                          onClick={() => handleToggleDisable(staff, true)}
                          disabled={isLoading || isReadOnly}
                          className="px-3 py-1.5 rounded-xl border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-[11px] font-bold cursor-pointer transition disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>{isLoading ? '...' : 'Aktifkan'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleDisable(staff, false)}
                          disabled={isLoading || activeBookings > 0 || isReadOnly}
                          title={activeBookings > 0 ? 'Tidak dapat menonaktifkan akun yang memiliki pesanan aktif' : 'Nonaktifkan akun demo'}
                          className="px-3 py-1.5 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-[11px] font-bold cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          <span>{isLoading ? '...' : 'Nonaktifkan'}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
