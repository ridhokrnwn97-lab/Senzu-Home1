import React, { useState, useEffect } from 'react';
import {
  History,
  ShieldCheck,
  Search,
  Filter,
  Clock,
  UserCheck,
  SlidersHorizontal,
  FileText,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { OperationalAuditLog } from '../../types';
import { subscribeToOperationalAuditLogs } from '../../lib/dbService';

export const SupervisorAuditLogView: React.FC = () => {
  const [logs, setLogs] = useState<OperationalAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');

  useEffect(() => {
    const unsubscribe = subscribeToOperationalAuditLogs((newLogs) => {
      setLogs(newLogs);
      setLoading(false);
    }, 50);

    return () => unsubscribe();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        log.actorName?.toLowerCase().includes(q) ||
        log.bookingCode?.toLowerCase().includes(q) ||
        log.reason?.toLowerCase().includes(q) ||
        log.action?.toLowerCase().includes(q) ||
        log.note?.toLowerCase().includes(q) ||
        log.newValue?.toLowerCase().includes(q) ||
        log.oldValue?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getActionBadge = (type: OperationalAuditLog['action']) => {
    switch (type) {
      case 'reassign':
        return { label: 'Reassign Terapis', bg: 'bg-rose-100 text-rose-800 border-rose-300' };
      case 'assign':
        return { label: 'Penugasan Terapis', bg: 'bg-indigo-100 text-indigo-800 border-indigo-300' };
      case 'override_status':
        return { label: 'Status Override', bg: 'bg-amber-100 text-amber-800 border-amber-300' };
      case 'override_arrival':
        return { label: 'Arrival Override', bg: 'bg-cyan-100 text-cyan-800 border-cyan-300' };
      case 'resolve_issue':
        return { label: 'Selesaikan Kendala', bg: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'shift_change':
        return { label: 'Ubah Shift Terapis', bg: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'internal_note':
        return { label: 'Catatan Internal', bg: 'bg-slate-100 text-slate-800 border-slate-300' };
      default:
        return { label: type, bg: 'bg-slate-100 text-slate-700 border-slate-200' };
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base sm:text-lg font-bold font-serif text-[#4B2B18] flex items-center gap-2">
            <History className="w-5 h-5 text-[#D4AF37]" />
            <span>Audit Trail Operasional Supervisor</span>
          </h3>
          <p className="text-xs text-slate-500">
            Catatan permanen seluruh tindakan manajerial, penugasan ulang, override, dan catatan operasional
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari audit log..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:ring-2 focus:ring-[#8B5A36]"
            />
          </div>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium bg-white focus:ring-2 focus:ring-[#8B5A36]"
          >
            <option value="ALL">Semua Tindakan</option>
            <option value="reassign">Reassign Terapis</option>
            <option value="assign">Penugasan Terapis</option>
            <option value="override_status">Status Override</option>
            <option value="override_arrival">Arrival Override</option>
            <option value="resolve_issue">Selesaikan Kendala</option>
            <option value="shift_change">Ubah Shift</option>
            <option value="internal_note">Catatan Internal</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-xs">
          Memuat audit log operasional...
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-xs">
          Tidak ada catatan audit yang sesuai kriteria.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#8B5A36] text-white uppercase text-[11px] font-semibold">
              <tr>
                <th className="py-3 px-4">Waktu (WIB)</th>
                <th className="py-3 px-4">Tindakan</th>
                <th className="py-3 px-4">Order / Target</th>
                <th className="py-3 px-4">Petugas Supervisor</th>
                <th className="py-3 px-4">Perubahan & Alasan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(filteredLogs || []).map((log) => {
                const badge = getActionBadge(log.action);

                return (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                      {log.formattedWIB || log.timestamp}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badge.bg}`}
                      >
                        {badge.label}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      {log.bookingCode ? (
                        <span className="font-mono font-bold text-[#4B2B18]">
                          {log.bookingCode}
                        </span>
                      ) : log.therapistName ? (
                        <span className="font-semibold text-slate-800">
                          {log.therapistName}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{log.actorName}</div>
                      <div className="text-[10px] text-slate-400 capitalize">{log.actorRole}</div>
                    </td>

                    <td className="py-3 px-4">
                      {log.oldValue && log.newValue && (
                        <div className="text-slate-700 font-medium">
                          {log.oldValue} &rarr; <strong className="text-slate-900">{log.newValue}</strong>
                        </div>
                      )}
                      {log.reason && (
                        <div className="text-[11px] text-slate-600 italic">
                          Alasan: {log.reason}
                        </div>
                      )}
                      {log.note && (
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Catatan: {log.note}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
