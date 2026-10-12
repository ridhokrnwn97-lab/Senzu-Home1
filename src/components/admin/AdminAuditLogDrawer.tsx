import React, { useState } from 'react';
import {
  History,
  ShieldCheck,
  User,
  Clock,
  Search,
  Filter,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AdminAuditLog } from '../../types';

interface AdminAuditLogDrawerProps {
  logs: AdminAuditLog[];
  onRefresh: () => void;
}

export const AdminAuditLogDrawer: React.FC<AdminAuditLogDrawerProps> = ({
  logs,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredLogs = logs.filter((log) => {
    const q = (searchTerm || '').toLowerCase();
    const matchesSearch =
      (log.summary || '').toLowerCase().includes(q) ||
      (log.actorName || '').toLowerCase().includes(q) ||
      (log.action || '').toLowerCase().includes(q);
    const matchesEntity = entityFilter === 'ALL' || log.entityType === entityFilter;
    return matchesSearch && matchesEntity;
  });

  const getActionBadgeColor = (action: string) => {
    if (action.includes('created') || action.includes('activated')) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-300';
    }
    if (action.includes('deactivated') || action.includes('deleted')) {
      return 'bg-red-50 text-red-700 border-red-300';
    }
    return 'bg-blue-50 text-blue-700 border-blue-300';
  };

  const getEntityLabel = (entity: string) => {
    switch (entity) {
      case 'company':
        return 'Perusahaan';
      case 'branch':
        return 'Cabang';
      case 'service':
        return 'Layanan Master';
      case 'business_settings':
        return 'Konfigurasi Bisnis';
      default:
        return entity;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#082A4F] via-[#0A335F] to-[#082A4F] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D4AF37]/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
            <History className="w-6 h-6 text-[#D4AF37]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-lg sm:text-xl font-bold text-white tracking-tight">
                Log Audit &amp; Jejak Perubahan Master Data
              </h3>
              <span className="text-[10px] font-bold bg-[#D4AF37]/20 text-[#FDF3CD] border border-[#D4AF37]/40 px-2.5 py-0.5 rounded-full">
                {logs.length} Aktivitas Tercatat
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Riwayat kronologis modifikasi data legalitas, cabang, tarif layanan, dan pengaturan bisnis
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition border border-white/20"
        >
          Muat Ulang
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-grow">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari aktivitas audit, nama staff, atau kata kunci..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs"
          />
        </div>

        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white text-slate-700"
        >
          <option value="ALL">Semua Modul</option>
          <option value="company">Perusahaan</option>
          <option value="branch">Cabang</option>
          <option value="service">Layanan Master</option>
          <option value="business_settings">Konfigurasi Bisnis</option>
        </select>
      </div>

      {/* Logs List */}
      <div className="p-4 sm:p-6 space-y-3">
        {filteredLogs.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            Belum ada catatan aktivitas audit master data.
          </div>
        ) : (
          (filteredLogs || []).map((log) => {
            const isExpanded = expandedId === log.id;
            return (
              <div
                key={log.id}
                className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition text-xs space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-[#082A4F]" />
                      {log.actorName}
                    </span>
                    <span className="font-mono text-[10px] uppercase bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-bold">
                      {log.actorRole}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${getActionBadgeColor(
                        log.action
                      )}`}
                    >
                      {log.action}
                    </span>
                    <span className="text-[10px] bg-amber-50 text-amber-900 border border-amber-200 px-2 py-0.5 rounded font-medium">
                      {getEntityLabel(log.entityType)}
                    </span>
                  </div>

                  <span className="text-[11px] text-slate-400 flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {log.formattedWIB || new Date(log.timestamp).toLocaleString('id-ID')}
                  </span>
                </div>

                <p className="text-slate-700 font-medium leading-relaxed">{log.summary}</p>

                {(log.oldValue || log.newValue) && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className="text-[11px] text-[#082A4F] font-semibold hover:underline flex items-center gap-1"
                    >
                      <span>{isExpanded ? 'Sembunyikan Nilai Teknis' : 'Lihat Detail Perubahan'}</span>
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 font-mono text-[10px]">
                        {log.oldValue && (
                          <div>
                            <span className="text-slate-400 block font-bold uppercase">Nilai Sebelum:</span>
                            <pre className="text-slate-600 bg-white p-2 rounded border border-slate-200 overflow-x-auto whitespace-pre-wrap">
                              {log.oldValue}
                            </pre>
                          </div>
                        )}
                        {log.newValue && (
                          <div>
                            <span className="text-slate-400 block font-bold uppercase">Nilai Baru:</span>
                            <pre className="text-emerald-800 bg-emerald-50/50 p-2 rounded border border-emerald-200 overflow-x-auto whitespace-pre-wrap">
                              {log.newValue}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
