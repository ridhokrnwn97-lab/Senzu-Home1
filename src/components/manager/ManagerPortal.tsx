import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Database,
  BarChart3,
  History,
  Building2,
  Sparkles,
  MapPin,
  CreditCard,
  Users,
  UserCheck,
  Sliders,
  Bell,
  Shield,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  Award,
  ChevronRight,
  ExternalLink,
  UserMinus,
  FolderTree,
} from 'lucide-react';
import {
  AppSettings,
  ServiceItem,
  StaffUser,
  CompanySettings,
  Branch,
  BusinessSettings,
  AdminAuditLog,
  Booking,
  CustomerCRM,
  Therapist,
} from '../../types';
import {
  getCompanySettings,
  getBranches,
  getBusinessSettings,
  getAdminAuditLogs,
  ensureMasterCategoriesAndSkillsInitialized,
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_BRANCH_PALEMBANG,
  DEFAULT_BUSINESS_SETTINGS,
} from '../../lib/masterDataService';
import { CompanySettingsCard } from '../admin/CompanySettingsCard';
import { BranchSettingsCard } from '../admin/BranchSettingsCard';
import { ServiceMasterCard } from '../admin/ServiceMasterCard';
import { BusinessSettingsCard } from '../admin/BusinessSettingsCard';
import { MetaAdsSettingsCard } from '../admin/MetaAdsSettingsCard';
import { XenditSandboxCard } from '../admin/XenditSandboxCard';
import { XenditLiveCard } from '../admin/XenditLiveCard';
import { AccurateConnectionCard } from '../admin/AccurateConnectionCard';
import { AccurateSyncCard } from '../admin/AccurateSyncCard';
import { AreaMasterCard } from './AreaMasterCard';
import { PaymentMasterCard } from './PaymentMasterCard';
import { StaffMasterCard } from './StaffMasterCard';
import { TherapistMasterCard } from './TherapistMasterCard';
import { ServiceCategoryMasterCard } from './ServiceCategoryMasterCard';
import { TherapistSkillMasterCard } from './TherapistSkillMasterCard';
import { OperationalSettingsCard } from './OperationalSettingsCard';
import { NotificationMasterCard } from './NotificationMasterCard';
import { DemoCleanupCard } from './DemoCleanupCard';
import { ErrorBoundary } from '../ErrorBoundary';
import { ManagementDashboard } from '../ManagementDashboard';
import { ManagerCaseGovernance } from './ManagerCaseGovernance';
import { formatRupiah, formatDateIndo } from '../../lib/utils';
import { formatWhatsAppDisplay } from '../../lib/masterDataUtils';

interface ManagerPortalProps {
  settings: AppSettings;
  services: ServiceItem[];
  currentUser: StaffUser;
  bookings: Booking[];
  customers: CustomerCRM[];
  therapists: Therapist[];
  onRefresh: () => void;
  initialSection?: 'dashboard' | 'cases' | 'master_data' | 'reports' | 'audit_log';
  initialMasterSubTab?: MasterDataSubTab;
}

export type ManagerMainSection = 'dashboard' | 'cases' | 'master_data' | 'reports' | 'audit_log';

export type MasterDataSubTab =
  | 'company_branch'
  | 'service_categories'
  | 'services'
  | 'therapist_skills'
  | 'area'
  | 'payment'
  | 'staff'
  | 'therapist'
  | 'operational'
  | 'notifications'
  | 'demo_cleanup';

export const ManagerPortal: React.FC<ManagerPortalProps> = ({
  settings,
  services,
  currentUser,
  bookings,
  customers,
  therapists,
  onRefresh,
  initialSection = 'dashboard',
  initialMasterSubTab = 'company_branch',
}) => {
  const [activeSection, setActiveSection] = useState<ManagerMainSection>(initialSection);
  const [activeMasterSubTab, setActiveMasterSubTab] = useState<MasterDataSubTab>(initialMasterSubTab);

  // Master Data state
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [branches, setBranches] = useState<Branch[]>([DEFAULT_BRANCH_PALEMBANG]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(DEFAULT_BUSINESS_SETTINGS);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState<string>('ALL');

  const isManagerOrAdmin = currentUser.role === 'manager' || currentUser.role === 'admin';

  useEffect(() => {
    loadMasterData();
  }, []);

  const loadMasterData = async () => {
    setLoading(true);
    try {
      // Ensure Master Categories and Skills are initialized once idempotently
      await ensureMasterCategoriesAndSkillsInitialized().catch((e) =>
        console.warn('Init master categories/skills error:', e)
      );

      const [compData, branchData, bizData, logsData] = await Promise.all([
        getCompanySettings(),
        getBranches(),
        getBusinessSettings(),
        getAdminAuditLogs(100),
      ]);
      setCompany(compData);
      setBranches(branchData);
      setBusinessSettings(bizData);
      setAuditLogs(logsData);
    } catch (err) {
      console.error('Failed to load Manager Portal master data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGlobalRefresh = () => {
    loadMasterData();
    onRefresh();
  };

  // Master Data Sub-items definition according to 
  const masterDataNavItems: { id: MasterDataSubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'company_branch', label: 'Company & Branch', icon: Building2 },
    { id: 'service_categories', label: 'Kategori Layanan', icon: FolderTree },
    { id: 'services', label: 'Services', icon: Sparkles },
    { id: 'therapist_skills', label: 'Keahlian Terapis', icon: Award },
    { id: 'therapist', label: 'Therapist Master', icon: UserCheck },
    { id: 'area', label: 'Area & Home Service', icon: MapPin },
    { id: 'payment', label: 'Payment', icon: CreditCard },
    { id: 'staff', label: 'Staff Master', icon: Users },
    { id: 'operational', label: 'Operational Settings', icon: Sliders },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'demo_cleanup', label: 'Migrasi & Demo Cleanup', icon: UserMinus },
  ];

  // If user is not manager/admin, show strict access restriction
  if (!isManagerOrAdmin) {
    return (
      <div className="max-w-4xl mx-auto my-12 p-8 bg-white rounded-3xl border border-red-200 shadow-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Akses Terbatas: Manager Portal</h2>
        <p className="text-sm text-slate-600 max-w-lg mx-auto mb-6">
          Sesuai aturan kepemilikan <strong>Master Data Ownership Rule</strong>, hanya peran <strong>Branch Manager</strong> dan <strong>Admin</strong> yang berwenang untuk mengelola, menambah, mengubah, mengaktifkan, dan menonaktifkan Master Data operasional Senzu Home.
        </p>
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500 max-w-md mx-auto">
          Peran Anda saat ini: <strong className="uppercase text-slate-800">{currentUser.role}</strong> ({currentUser.name}).
          Supervisor, CSS, dan Terapis beroperasi menggunakan data baca (read-only) yang telah ditetapkan Manager.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Manager Portal Header */}
      <div className="bg-gradient-to-r from-[#8B5A36] to-[#94603B] rounded-3xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 bg-[#D4AF37]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 text-[#D4AF37] text-xs font-bold uppercase tracking-wider mb-2">
              <Shield className="w-3.5 h-3.5" />
              Senzu Home • Manager Portal
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Portal Otoritas &amp; Master Data Bisnis
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Pusat kendali Branch Manager untuk konfigurasi tunggal Master Data (Single Source of Truth), evaluasi KPI eksekutif, dan audit log kepatuhan SOP Palembang.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-center">
            <button
              type="button"
              onClick={handleGlobalRefresh}
              disabled={loading}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition cursor-pointer border border-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sinkronkan Data
            </button>
          </div>
        </div>

        {/* Manager Portal Primary Navigation Tabs */}
        <div className="flex items-center gap-2 mt-8 pt-6 border-t border-white/10 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeSection === 'dashboard'
                ? 'bg-[#D4AF37] text-[#4B2B18] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('cases')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeSection === 'cases'
                ? 'bg-[#D4AF37] text-[#4B2B18] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            Komplain & Recovery
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('master_data')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeSection === 'master_data'
                ? 'bg-[#D4AF37] text-[#4B2B18] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Database className="w-4 h-4" />
            Master Data
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
              8 Modul
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('reports')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeSection === 'reports'
                ? 'bg-[#D4AF37] text-[#4B2B18] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Reports / KPI
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('audit_log')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeSection === 'audit_log'
                ? 'bg-[#D4AF37] text-[#4B2B18] shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <History className="w-4 h-4" />
            Audit Log
            {auditLogs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
                {auditLogs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* SECTION 1: DASHBOARD */}
      {activeSection === 'dashboard' && (
        <div className="space-y-6">
          {/* Executive KPI Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-semibold">Total Pendapatan Terbayar</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  Rp
                </div>
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900">
                {formatRupiah(
                  bookings
                    .filter((b) => b.paymentStatus === 'paid' || (b.paymentStatus as any) === 'PAID')
                    .reduce((sum, b) => sum + (b.totalAmount || (b as any).totalPrice || (b as any).price || 0), 0)
                )}
              </div>
              <div className="text-[11px] text-emerald-600 font-semibold mt-1">
                Akumulasi seluruh pesanan lunas
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-semibold">Total Pesanan Masuk</span>
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900">{bookings.length}</div>
              <div className="text-[11px] text-blue-600 font-semibold mt-1">
                {bookings.filter((b) => b.status === 'Completed' || (b.status as any) === 'completed').length} Selesai •{' '}
                {bookings.filter((b) => ['On The Way', 'Arrived', 'Treatment'].includes(b.status) || (b.status as any) === 'in_progress').length} Berjalan
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-semibold">Kapasitas Terapis</span>
                <UserCheck className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900">
                {therapists.filter((t) => t.isActive !== false).length}
                <span className="text-xs text-slate-400 font-normal ml-1">
                  / {therapists.length} Terapis
                </span>
              </div>
              <div className="text-[11px] text-amber-600 font-semibold mt-1">
                {therapists.filter((t) => t.status === 'available').length} Standby di Palembang Hub
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-semibold">Layanan Aktif</span>
                <Sparkles className="w-5 h-5 text-purple-600" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900">
                {services.filter((s) => s.isActive !== false).length}
                <span className="text-xs text-slate-400 font-normal ml-1">
                  / {services.length} Treatment
                </span>
              </div>
              <div className="text-[11px] text-purple-600 font-semibold mt-1">
                Master katalog Senzu Home
              </div>
            </div>
          </div>

          {/* Single Source of Truth System Health */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2 mb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  Status Integritas Master Data (Single Source of Truth)
                </h3>
                <p className="text-xs text-slate-500">
                  Seluruh portal operasional (Supervisor, CSS, Therapist, Customer) membaca data yang sama dari konfigurasi ini.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold self-start sm:self-center">
                Tersinkronisasi 100%
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-slate-400 font-bold uppercase text-[10px]">WhatsApp Resmi Customer Service:</span>
                <div className="font-bold text-slate-900 text-sm">
                  {formatWhatsAppDisplay(company.customerServiceWhatsApp)}
                </div>
                <p className="text-[11px] text-slate-500">
                  Tersinkronisasi ke invoice, floating WA pelanggan, dan notifikasi tracking.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Pusat Cabang Operasional:</span>
                <div className="font-bold text-slate-900 text-sm">
                  {branches[0]?.name || 'Senzu Palembang Riau'}
                </div>
                <p className="text-[11px] text-slate-500">
                  Jam buka {businessSettings.operatingHoursStart} - {businessSettings.operatingHoursEnd} WIB ({businessSettings.defaultTimezone})
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Entitas Legal PT:</span>
                <div className="font-bold text-slate-900 text-sm">
                  {company.companyLegalName || 'PT KSBONE UNTUK KITA'}
                </div>
                <p className="text-[11px] text-slate-500">
                  Rekening settlement penerimaan dana &amp; QRIS Statis Merchant resmi.
                </p>
              </div>
            </div>
          </div>

          {/* Quick Access to Master Data Modules */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Modul Master Data Bisnis</h3>
                <p className="text-xs text-slate-500">
                  Pilih modul untuk mengelola konfigurasi operasional
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(masterDataNavItems || []).map((item, idx) => {
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id || `master-nav-${idx}`}
                    type="button"
                    onClick={() => {
                      setActiveMasterSubTab(item.id);
                      setActiveSection('master_data');
                    }}
                    className="p-5 rounded-2xl bg-white border border-slate-200 hover:border-amber-500 hover:shadow-sm transition text-left cursor-pointer group flex flex-col justify-between"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-3 group-hover:bg-amber-600 group-hover:text-white transition">
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm group-hover:text-amber-700 transition">
                        {item.label}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {item.id === 'company_branch' && 'Legalitas PT, cabang Palembang, & timezone'}
                        {item.id === 'service_categories' && 'Kelola kategori layanan master, kode kategori, & urutan tampil'}
                        {item.id === 'services' && 'Katalog pijat, tarif, durasi, dan spesialisasi'}
                        {item.id === 'therapist_skills' && 'Matriks keahlian & sertifikasi standar SOP terapis'}
                        {item.id === 'area' && 'Hub Palembang, radius tier transport, & kecamatan'}
                        {item.id === 'payment' && 'Rekening BNI/Mandiri/BRI/BCA & QRIS Merchant'}
                        {item.id === 'staff' && 'Akun staf, peran, & otorisasi hak login'}
                        {item.id === 'therapist' && 'Master terapis terpusat & kelayakan tugas'}
                        {item.id === 'operational' && 'Jam operasional, lead time, & buffer antar order'}
                        {item.id === 'notifications' && 'Nomor WhatsApp CS resmi & template pesan'}
                        {item.id === 'demo_cleanup' && 'Status transisi akun produksi & pembersihan bertahap demo'}
                      </p>
                    </div>

                    <div className="flex items-center text-xs font-bold text-amber-700 mt-4 group-hover:translate-x-1 transition">
                      <span>Buka Master Data</span>
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: MASTER DATA (9 Sub-modules) */}
      {activeSection === 'master_data' && (
        <div className="space-y-6">
          {/* Sub-Navigation for the Master Data Modules */}
          <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto flex items-center gap-1.5">
            {(masterDataNavItems || []).map((item, idx) => {
              const IconComponent = item.icon;
              const isActive = activeMasterSubTab === item.id;
              return (
                <button
                  key={item.id || `master-subtab-${idx}`}
                  type="button"
                  onClick={() => setActiveMasterSubTab(item.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <IconComponent className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Sub-module 1: Company & Branch */}
          {activeMasterSubTab === 'company_branch' && (
            <div className="space-y-6">
              <CompanySettingsCard
                company={company}
                currentUser={currentUser}
                onRefresh={handleGlobalRefresh}
              />
              <BranchSettingsCard
                branches={branches}
                currentUser={currentUser}
                onRefresh={handleGlobalRefresh}
              />
            </div>
          )}

          {/* Sub-module: Service Categories  */}
          {activeMasterSubTab === 'service_categories' && (
            <ServiceCategoryMasterCard
              currentUser={currentUser}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 2: Services */}
          {activeMasterSubTab === 'services' && (
            <ServiceMasterCard
              services={services}
              currentUser={currentUser}
              onRefresh={handleGlobalRefresh}
            />
          )}

          {/* Sub-module: Therapist Skills */}
          {activeMasterSubTab === 'therapist_skills' && (
            <TherapistSkillMasterCard
              currentUser={currentUser}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 3: Area & Home Service */}
          {activeMasterSubTab === 'area' && (
            <AreaMasterCard
              currentUser={currentUser}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 4: Payment */}
          {activeMasterSubTab === 'payment' && (
            <PaymentMasterCard
              currentUser={currentUser}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 5: Staff */}
          {activeMasterSubTab === 'staff' && (
            <StaffMasterCard
              currentUser={currentUser}
              branches={branches}
              bookings={bookings}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 6: Therapist */}
          {activeMasterSubTab === 'therapist' && (
            <TherapistMasterCard
              currentUser={currentUser}
              services={services}
              branches={branches}
              bookings={bookings}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 7: Operational Settings */}
          {activeMasterSubTab === 'operational' && (
            <div className="space-y-6">
              <OperationalSettingsCard
                currentUser={currentUser}
                onRefresh={handleGlobalRefresh}
                isReadOnly={!isManagerOrAdmin}
              />
              <MetaAdsSettingsCard currentUser={currentUser} />
              <XenditSandboxCard currentUser={currentUser} />
              <XenditLiveCard currentUser={currentUser} />
              <AccurateConnectionCard currentUser={currentUser} />
              <AccurateSyncCard currentUser={currentUser} />
            </div>
          )}

          {/* Sub-module 8: Notifications */}
          {activeMasterSubTab === 'notifications' && (
            <NotificationMasterCard
              currentUser={currentUser}
              onRefresh={handleGlobalRefresh}
              isReadOnly={!isManagerOrAdmin}
            />
          )}

          {/* Sub-module 9: Demo Cleanup & Production Migration */}
          {activeMasterSubTab === 'demo_cleanup' && (
            <ErrorBoundary
              scopeName="DemoCleanupCard"
              fallbackTitle="Terjadi kendala saat membuka Migrasi & Demo Cleanup."
              fallbackMessage="Halaman audit migrasi akun demo mengalami kendala saat memuat data. Silakan coba lagi atau kembali ke portal manager."
              onRetry={handleGlobalRefresh}
              onBack={() => setActiveMasterSubTab('company_branch')}
              backButtonLabel="Kembali ke Portal Manager"
            >
              <DemoCleanupCard
                currentUser={currentUser}
                bookings={bookings || []}
                onRefresh={handleGlobalRefresh}
                onOpenStaffMaster={() => setActiveMasterSubTab('staff')}
                isReadOnly={!isManagerOrAdmin}
              />
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* SECTION 3: REPORTS / KPI */}
      {activeSection === 'reports' && (
        <div className="space-y-6">
          <ManagementDashboard
            bookings={bookings}
            customers={customers}
            therapists={therapists}
          />
        </div>
      )}

      {/* SECTION 4: AUDIT LOG */}
      {activeSection === 'audit_log' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/40 to-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-700 flex items-center justify-center font-bold">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Audit Trail Perubahan Master Data</h3>
                <p className="text-xs text-slate-500">
                  Jejak rekam transparan setiap perubahan Master Data oleh Manager dan Admin
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value="ALL">Semua Entitas</option>
                <option value="COMPANY_SETTINGS">Company Settings</option>
                <option value="BRANCH">Cabang (Branch)</option>
                <option value="SERVICE_MASTER">Master Layanan</option>
                <option value="AREA_MASTER">Area &amp; Home Service</option>
                <option value="PAYMENT_SETTINGS">Akun Pembayaran</option>
                <option value="STAFF_MASTER">Staf &amp; Akses</option>
                <option value="THERAPIST_MASTER">Master Terapis</option>
                <option value="BUSINESS_SETTINGS">Pengaturan Operasional</option>
                <option value="NOTIFICATION_MASTER">Notifikasi &amp; WhatsApp</option>
              </select>
            </div>
          </div>

          <div className="p-6">
            {auditLogs.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <History className="w-12 h-12 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-semibold text-slate-600">Belum ada riwayat audit log</p>
                <p className="text-xs">Setiap perubahan Master Data akan tercatat otomatis di sini.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {auditLogs
                  .filter((log) => auditFilter === 'ALL' || log.entityType === auditFilter)
                  .map((log, idx) => (
                    <div
                      key={log.id || `audit-log-${log.timestamp || idx}-${idx}`}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 uppercase">
                            {log.entityType}
                          </span>
                          <span className="font-bold text-slate-900">{log.action}</span>
                          <span className="text-slate-400">•</span>
                          <span className="text-slate-600">ID: {log.entityId}</span>
                        </div>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {formatDateIndo(log.timestamp)}
                        </span>
                      </div>

                      <div className="text-slate-800 font-medium">{log.summary}</div>

                      <div className="text-[11px] text-slate-500 flex items-center gap-2 pt-1 border-t border-slate-200/60 mt-1">
                        <span>Oleh:</span>
                        <strong className="text-slate-700">{log.actorName}</strong>
                        <span className="text-slate-400">({log.actorRole})</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION: CASES & RECOVERY GOVERNANCE */}
      {activeSection === 'cases' && (
        <ManagerCaseGovernance
          currentUser={{
            id: (currentUser as any)?.id || currentUser?.uid || 'manager',
            name: currentUser.name,
            role: currentUser.role,
          }}
        />
      )}
    </div>
  );
};
