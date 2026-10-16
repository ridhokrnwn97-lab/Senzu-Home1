import React, { useState, useEffect } from 'react';
import {
  Building2,
  MapPin,
  Sparkles,
  Sliders,
  History,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { AppSettings, ServiceItem, StaffUser, CompanySettings, Branch, BusinessSettings, AdminAuditLog } from '../types';
import {
  getCompanySettings,
  getBranches,
  getBusinessSettings,
  getAdminAuditLogs,
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_BRANCH_PALEMBANG,
  DEFAULT_BUSINESS_SETTINGS,
} from '../lib/masterDataService';
import { CompanySettingsCard } from './admin/CompanySettingsCard';
import { BranchSettingsCard } from './admin/BranchSettingsCard';
import { ServiceMasterCard } from './admin/ServiceMasterCard';
import { BusinessSettingsCard } from './admin/BusinessSettingsCard';
import { AdminAuditLogDrawer } from './admin/AdminAuditLogDrawer';
import { MetaAdsSettingsCard } from './admin/MetaAdsSettingsCard';

interface AdminSettingsViewProps {
  settings: AppSettings;
  services: ServiceItem[];
  currentUser: StaffUser;
  onRefresh: () => void;
}

type AdminTab = 'company' | 'branch' | 'service' | 'business' | 'audit';

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  settings,
  services,
  currentUser,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('company');
  const [loading, setLoading] = useState(true);

  // Master Data state
  const [company, setCompany] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
  const [branches, setBranches] = useState<Branch[]>([DEFAULT_BRANCH_PALEMBANG]);
  const [businessSettings, setBusinessSettings] = useState<BusinessSettings>(DEFAULT_BUSINESS_SETTINGS);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  const isReadOnly = currentUser.role === 'supervisor';

  const loadAllMasterData = async () => {
    setLoading(true);
    try {
      const [compData, branchData, bizData, logsData] = await Promise.all([
        getCompanySettings(),
        getBranches(),
        getBusinessSettings(),
        getAdminAuditLogs(50),
      ]);
      setCompany(compData);
      setBranches(branchData);
      setBusinessSettings(bizData);
      setAuditLogs(logsData);
    } catch (err) {
      console.warn('Error loading master data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllMasterData();
  }, []);

  const handleFullRefresh = () => {
    loadAllMasterData();
    onRefresh();
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 space-y-6 pb-24">
      {/* Top Header & Context Banner */}
      <div className="bg-gradient-to-r from-[#082A4F] via-[#0A335F] to-[#082A4F] rounded-2xl p-5 sm:p-7 text-white shadow-md border border-[#D4AF37]/30 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-extrabold uppercase tracking-widest bg-[#D4AF37]/20 text-[#FDF3CD] border border-[#D4AF37]/40 px-2.5 py-0.5 rounded-full">
              Senzu Admin &amp; Master Data
            </span>
            <span className="text-[10px] font-semibold text-slate-300">
              Role: <strong className="text-white uppercase">{currentUser.role}</strong> ({currentUser.name})
            </span>
          </div>
          <h2 className="font-serif text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-white">
            Pusat Pengaturan &amp; Data Induk
          </h2>
          <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
            Kelola legalitas PT KSBONE UNTUK KITA, cabang operasional Palembang, katalog tarif layanan resmi, serta konfigurasi operasional bisnis Senzu Home.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={handleFullRefresh}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 border border-white/15 transition active:scale-95 cursor-pointer"
            title="Muat Ulang Seluruh Master Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#D4AF37] ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Menyinkronkan...' : 'Segarkan Data'}</span>
          </button>
        </div>
      </div>

      {/* Role Banner if Supervisor */}
      {isReadOnly && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Perhatian:</strong> Anda sedang melihat modul Admin &amp; Master Data dalam mode <strong>Lihat Saja (Read-Only)</strong> sebagai <strong>Supervisor</strong>. Tombol pengubahan dan penghapusan dinonaktifkan.
            </span>
          </div>
          <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
            SUPERVISOR READ-ONLY
          </span>
        </div>
      )}

      {/* Modern Tab Bar Navigation */}
      <div className="flex items-center gap-1 sm:gap-2 p-1.5 rounded-2xl bg-slate-200/80 border border-slate-300/60 overflow-x-auto no-scrollbar shadow-xs">
        <button
          type="button"
          onClick={() => setActiveTab('company')}
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'company'
              ? 'bg-[#082A4F] text-white shadow-sm ring-1 ring-[#D4AF37]/50'
              : 'text-slate-700 hover:text-[#082A4F] hover:bg-white/60'
          }`}
        >
          <Building2 className={`w-4 h-4 ${activeTab === 'company' ? 'text-[#D4AF37]' : 'text-slate-500'}`} />
          <span>Profil Perusahaan</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('branch')}
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'branch'
              ? 'bg-[#082A4F] text-white shadow-sm ring-1 ring-[#D4AF37]/50'
              : 'text-slate-700 hover:text-[#082A4F] hover:bg-white/60'
          }`}
        >
          <MapPin className={`w-4 h-4 ${activeTab === 'branch' ? 'text-[#D4AF37]' : 'text-slate-500'}`} />
          <span>Cabang Operasional</span>
          <span className="text-[10px] bg-slate-300/60 text-slate-800 px-1.5 py-0.2 rounded-full font-mono">
            {branches.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('service')}
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'service'
              ? 'bg-[#082A4F] text-white shadow-sm ring-1 ring-[#D4AF37]/50'
              : 'text-slate-700 hover:text-[#082A4F] hover:bg-white/60'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${activeTab === 'service' ? 'text-[#D4AF37]' : 'text-slate-500'}`} />
          <span>Master Layanan</span>
          <span className="text-[10px] bg-slate-300/60 text-slate-800 px-1.5 py-0.2 rounded-full font-mono">
            {services.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('business')}
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'business'
              ? 'bg-[#082A4F] text-white shadow-sm ring-1 ring-[#D4AF37]/50'
              : 'text-slate-700 hover:text-[#082A4F] hover:bg-white/60'
          }`}
        >
          <Sliders className={`w-4 h-4 ${activeTab === 'business' ? 'text-[#D4AF37]' : 'text-slate-500'}`} />
          <span>Konfigurasi Bisnis</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-[#082A4F] text-white shadow-sm ring-1 ring-[#D4AF37]/50'
              : 'text-slate-700 hover:text-[#082A4F] hover:bg-white/60'
          }`}
        >
          <History className={`w-4 h-4 ${activeTab === 'audit' ? 'text-[#D4AF37]' : 'text-slate-500'}`} />
          <span>Log Audit Master Data</span>
          {auditLogs.length > 0 && (
            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full font-mono">
              {auditLogs.length}
            </span>
          )}
        </button>
      </div>

      {/* Main Tab Views */}
      <div className="transition-all duration-200">
        {activeTab === 'company' && (
          <CompanySettingsCard
            company={company}
            currentUser={currentUser}
            onRefresh={handleFullRefresh}
          />
        )}

        {activeTab === 'branch' && (
          <BranchSettingsCard
            branches={branches}
            currentUser={currentUser}
            onRefresh={handleFullRefresh}
          />
        )}

        {activeTab === 'service' && (
          <ServiceMasterCard
            services={services}
            currentUser={currentUser}
            onRefresh={handleFullRefresh}
          />
        )}

        {activeTab === 'business' && (
          <div className="space-y-6">
          <BusinessSettingsCard
            businessSettings={businessSettings}
            branches={branches}
            appSettings={settings}
            currentUser={currentUser}
            onRefresh={handleFullRefresh}
          />
          <MetaAdsSettingsCard currentUser={currentUser} />
          </div>
        )}

        {activeTab === 'audit' && (
          <AdminAuditLogDrawer
            logs={auditLogs}
            onRefresh={handleFullRefresh}
          />
        )}
      </div>
    </div>
  );
};
