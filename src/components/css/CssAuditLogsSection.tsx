import React, { useState, useEffect } from 'react';
import {
  History,
  ShieldCheck,
  Search,
  Filter,
  User,
  Calendar,
  Clock,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { OperationalAuditLog } from '../../types';
import { subscribeToOperationalAuditLogs } from '../../lib/dbService';

export const CssAuditLogsSection: React.FC = () => {
  const [logs, setLogs] = useState<OperationalAuditLog[]>([]);
  const [filterAction, setFilterAction] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToOperationalAuditLogs((data) => {
      setLogs(data);
      setIsLoading(false);
    }, 100);
    return () => unsub();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filterAction !== 'ALL' && log.action !== filterAction) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        (log.bookingCode && log.bookingCode.toLowerCase().includes(q)) ||
        (log.actorName && log.actorName.toLowerCase().includes(q)) ||
        (log.reason && log.reason.toLowerCase().includes(q)) ||
        (log.note && log.note.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'payment_verified':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">Verifikasi Bayar</span>;
      case 'payment_rejected':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800">Tolak Bayar</span>;
      case 'reschedule':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">Reschedule</span>;
      case 'address_change':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">Ubah Alamat</span>;
      case 'cancel':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">Pembatalan</span>;
      case 'escalate_supervisor':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">Eskalasi Supervisor</span>;
      case 'customer_unreachable':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800">Tidak Merespon</span>;
      case 'claim_task':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">Ambil Tugas</span>;
      case 'internal_note':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800">Catatan Internal</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">{action}</span>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setFilterAction('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterAction === 'ALL'
                ? 'bg-[#8B5A36] text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            Semua Aksi ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterAction('payment_verified')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterAction === 'payment_verified'
                ? 'bg-teal-600 text-white'
                : 'bg-teal-50 hover:bg-teal-100 text-teal-800'
            }`}
          >
            Verif Bayar
          </button>
          <button
            type="button"
            onClick={() => setFilterAction('reschedule')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterAction === 'reschedule'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800'
            }`}
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={() => setFilterAction('address_change')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterAction === 'address_change'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 hover:bg-blue-100 text-blue-800'
            }`}
          >
            Ganti Alamat
          </button>
          <button
            type="button"
            onClick={() => setFilterAction('escalate_supervisor')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              filterAction === 'escalate_supervisor'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-800'
            }`}
          >
            Eskalasi
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Cari kode, staf, alasan..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#8B5A36] bg-slate-50/50"
          />
        </div>
      </div>

      {/* Log Feed */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            Memuat catatan audit operasional...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            Tidak ada rekaman audit yang sesuai dengan filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {(filteredLogs || []).map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-50/80 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getActionBadge(log.action)}
                    {log.bookingCode && (
                      <span className="font-mono font-bold text-[#4B2B18] bg-slate-100 px-2 py-0.5 rounded">
                        {log.bookingCode}
                      </span>
                    )}
                    <span className="text-slate-400 font-mono text-[11px]">
                      {log.formattedWIB || new Date(log.timestamp).toLocaleString('id-ID')} WIB
                    </span>
                  </div>

                  <div className="text-slate-700 font-medium pt-0.5">
                    {log.reason || log.note || 'Tindakan operasional tercatat.'}
                  </div>

                  {log.oldValue && log.newValue && (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                      <span className="line-through text-slate-400">{log.oldValue}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span className="text-slate-800 font-semibold">{log.newValue}</span>
                    </div>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="font-semibold text-slate-800">{log.actorName}</div>
                  <div className="text-[10px] text-slate-400 uppercase font-mono">
                    Peran: {log.actorRole}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
