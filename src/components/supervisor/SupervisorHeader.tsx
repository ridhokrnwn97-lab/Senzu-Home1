import React, { useState, useEffect } from 'react';
import {
  Clock,
  ShieldCheck,
  RefreshCw,
  Bell,
  Map as MapIcon,
  ListFilter,
  Users,
  History,
  AlertTriangle,
  Calendar,
  ShieldAlert,
} from 'lucide-react';
import { formatDateTimeWIB } from '../../lib/utils';
import { UserRole } from '../../types';

interface SupervisorHeaderProps {
  userName?: string;
  userRole?: UserRole;
  activeView: 'BOARD' | 'MAP' | 'ROSTER' | 'THERAPISTS' | 'AUDIT' | 'CASES';
  onViewChange: (view: 'BOARD' | 'MAP' | 'ROSTER' | 'THERAPISTS' | 'AUDIT' | 'CASES') => void;
  alertCount: number;
  criticalAlertCount: number;
  onAlertBellClick: () => void;
  onManualRefresh?: () => void;
  isRefreshing?: boolean;
}

export const SupervisorHeader: React.FC<SupervisorHeaderProps> = ({
  userName = 'Supervisor Operasional',
  userRole = 'supervisor',
  activeView,
  onViewChange,
  alertCount,
  criticalAlertCount,
  onAlertBellClick,
  onManualRefresh,
  isRefreshing = false,
}) => {
  const [currentWibTime, setCurrentWibTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Format: "Rabu, 09 Sep 2026 • 14:15:30 WIB"
      const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      
      const dayName = days[now.getDay()];
      const day = String(now.getDate()).padStart(2, '0');
      const month = months[now.getMonth()];
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');

      setCurrentWibTime(`${dayName}, ${day} ${month} ${year} • ${hours}:${mins}:${secs} WIB`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Top row: Brand + Live Clock + Profile */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 rounded-md bg-[#082A4F] text-[#D4AF37] font-mono text-[11px] font-bold tracking-wider uppercase">
              OPERATIONS HQ
            </span>
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Sistem Realtime Aktif</span>
            </div>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#082A4F] mt-1">
            Senzu Supervisor Control Room
          </h1>
          <p className="text-xs text-slate-500">
            Pusat Komando Operasional & Pemantauan Armada Home Service Kota Palembang
          </p>
        </div>

        {/* Right side: Live Clock & Supervisor badge */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Live WIB Clock */}
          <div className="bg-[#FAF9F6] border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-[#082A4F] font-mono font-bold shadow-2xs">
            <Clock className="w-3.5 h-3.5 text-[#D4AF37] animate-pulse" />
            <span>{currentWibTime || 'Memuat Waktu WIB...'}</span>
          </div>

          {/* Alert Bell */}
          <button
            type="button"
            onClick={onAlertBellClick}
            className={`relative p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-center ${
              criticalAlertCount > 0
                ? 'bg-rose-50 border-rose-300 text-rose-700 animate-bounce'
                : alertCount > 0
                ? 'bg-amber-50 border-amber-300 text-amber-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
            title="Peringatan Operasional"
          >
            <Bell className="w-4 h-4" />
            {alertCount > 0 && (
              <span
                className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white shadow-xs ${
                  criticalAlertCount > 0 ? 'bg-rose-600' : 'bg-amber-600'
                }`}
              >
                {alertCount}
              </span>
            )}
          </button>

          {/* Refresh Button */}
          {onManualRefresh && (
            <button
              type="button"
              onClick={onManualRefresh}
              disabled={isRefreshing}
              className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition cursor-pointer"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-[#082A4F]' : ''}`} />
            </button>
          )}

          {/* Supervisor User Badge */}
          <div className="flex items-center gap-2 bg-[#082A4F] text-white px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs">
            <ShieldCheck className="w-4 h-4 text-[#D4AF37]" />
            <div className="leading-tight">
              <div className="font-bold text-[11px] truncate max-w-[120px] sm:max-w-[150px]">
                {userName}
              </div>
              <div className="text-[9px] text-amber-200/80 uppercase tracking-wider">
                {userRole}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => onViewChange('BOARD')}
            className={`min-h-[38px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeView === 'BOARD'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <ListFilter className="w-4 h-4 text-[#D4AF37]" />
            <span>Papan Operasi Hari Ini</span>
          </button>

          <button
            type="button"
            onClick={() => onViewChange('MAP')}
            className={`min-h-[38px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeView === 'MAP'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <MapIcon className="w-4 h-4 text-[#D4AF37]" />
            <span>Peta Live Armada</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>

          <button
            type="button"
            onClick={() => onViewChange('ROSTER')}
            className={`min-h-[38px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeView === 'ROSTER'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <Calendar className="w-4 h-4 text-[#D4AF37]" />
            <span>Jadwal & Shift Terapis</span>
          </button>

          <button
            type="button"
            onClick={() => onViewChange('THERAPISTS')}
            className={`min-h-[38px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeView === 'THERAPISTS'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <Users className="w-4 h-4 text-[#D4AF37]" />
            <span>Monitoring Terapis</span>
          </button>

          <button
            type="button"
            onClick={() => onViewChange('CASES')}
            className={`min-h-[38px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeView === 'CASES'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Insiden & Komplain</span>
          </button>

          <button
            type="button"
            onClick={() => onViewChange('AUDIT')}
            className={`min-h-[38px] px-3 sm:px-4 py-2 rounded-lg flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
              activeView === 'AUDIT'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <History className="w-4 h-4 text-[#D4AF37]" />
            <span>Audit Trail Operasional</span>
          </button>
        </div>

        {/* Operational Status Briefing */}
        <div className="text-[11px] text-slate-500 font-medium hidden md:flex items-center gap-2">
          <span>Palembang Service Radius: <strong>15 KM</strong></span>
          <span>•</span>
          <span>Base: <strong>Jl. Riau No.3</strong></span>
        </div>
      </div>
    </div>
  );
};
