import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, Server, ShieldAlert } from 'lucide-react';
import { auth } from '../../lib/firebase';
import type { AccurateConfiguration, AccurateConnectionCheck } from '../../lib/accurateContracts';
import type { AccurateManualConfig } from '../../lib/accurateSyncContracts';

// FAT read-only status projection: only the fields the endpoint actually returns.
type FatSyncJob = { id: string; bookingCode: string; amount: number | null; amountValid: boolean; state: string; createdAt: string; updatedAt: string };
type FatSyncStatus = { mode: 'posting_v1'; databaseId: number; writesConfigured: boolean; schedulerConfigured: boolean; manual?: AccurateManualConfig | null; active: boolean; jobs: FatSyncJob[] };

async function postFat<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(`${json?.message || json?.error || 'Gagal memuat data Accurate (read-only).'} (HTTP ${res.status}).`);
  }
  return json as T;
}

const StatePill: React.FC<{ ok?: boolean; label: string }> = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ok === false ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
    {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
    {label}
  </span>
);

export const FatAccountingTab: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AccurateConfiguration | null>(null);
  const [connection, setConnection] = useState<AccurateConnectionCheck | null>(null);
  const [sync, setSync] = useState<FatSyncStatus | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      postFat<AccurateConfiguration>('/api/integrations/accurate/fat/configuration', {}),
      postFat<AccurateConnectionCheck>('/api/integrations/accurate/fat/check', {}),
      postFat<FatSyncStatus>('/api/integrations/accurate/fat/sync/status', {}),
    ]);
    const [cfgRes, connRes, syncRes] = results;
    const errs: string[] = [];
    if (cfgRes.status === 'fulfilled') setConfig(cfgRes.value); else errs.push(`Konfigurasi: ${cfgRes.reason?.message || 'tidak tersedia'}`);
    if (connRes.status === 'fulfilled') setConnection(connRes.value); else errs.push(`Koneksi: ${connRes.reason?.message || 'tidak tersedia'}`);
    if (syncRes.status === 'fulfilled') setSync(syncRes.value); else errs.push(`Status sync: ${syncRes.reason?.message || 'tidak tersedia'}`);
    if (errs.length && results.every(r => r.status === 'rejected')) setError(errs.join(' | '));
    else if (errs.length) setError(`Sebagian data tidak tersedia (read-only): ${errs.join(' | ')}`);
    setLastUpdated(new Date().toLocaleString('id-ID'));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex gap-3">
        <ShieldAlert className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900 space-y-1">
          <p className="font-semibold">Accounting monitoring read-only</p>
          <p>Monitoring integrasi Accurate menggunakan endpoint baca-saja berotorisasi (FAT/Manager/Admin sesuai izin endpoint). Peran FAT tidak memiliki kontrol mutasi: tidak ada activate/pause/retry/post/manual run.</p>
          <p className="text-xs text-blue-800 flex gap-1.5 items-start"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span><strong>Pembedaan:</strong> status <em>writes/scheduler configured</em> atau <em>connected</em> menggambarkan konfigurasi/kesiapan sistem, <strong>bukan</strong> izin FAT untuk mengubah atau menjalankan sinkronisasi.</span></p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">Pembaruan terakhir: {lastUpdated || '-'}</div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Muat ulang
        </button>
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
          <p className="font-semibold">Status ketersediaan</p>
          <p className="mt-1">{error}</p>
          <p className="mt-1 text-xs text-amber-800">Jika data sebagian/tidak tersedia, pastikan sesi FAT aktif & valid. Fitur tidak diperluas menjadi akses tulis.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2 text-[#4B2B18] font-bold"><Server className="w-4 h-4" /> Koneksi Accurate</div>
          {loading && !connection && !config ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memuat status koneksi...</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <StatePill ok={Boolean(config?.configured ?? (config as any)?.apiTokenPresent)} label={`Konfigurasi sistem: ${(config?.configured ?? (config as any)?.apiTokenPresent) ? 'Terdeteksi' : 'Belum/Tidak diketahui'}`} />
                <StatePill ok={connection?.connected} label={`Koneksi: ${connection?.connected ? 'Terhubung' : 'Tidak terhubung/Tidak terverifikasi'}`} />
                <StatePill ok={connection?.writesEnabled === false} label="Write channel: dinonaktifkan (sistem)" />
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-slate-500">Mode</dt><dd className="font-medium text-slate-800">{connection?.mode || config?.mode || '-'}</dd></div>
                <div><dt className="text-slate-500">Company</dt><dd className="font-medium text-slate-800">{connection?.companyName || (config as any)?.companyName || '-'}</dd></div>
                <div><dt className="text-slate-500">Database ID</dt><dd className="font-medium text-slate-800">{String(connection?.databaseId ?? (config as any)?.databaseId ?? '-')}</dd></div>
                <div><dt className="text-slate-500">Izin peran FAT</dt><dd className="font-medium text-slate-800">Read-only (tanpa mutasi/sync)</dd></div>
                <div className="sm:col-span-2"><dt className="text-slate-500">Diperiksa</dt><dd className="font-medium text-slate-800">{connection?.checkedAt ? new Date(connection.checkedAt).toLocaleString('id-ID') : '-'}</dd></div>
              </dl>
              {Array.isArray(connection?.checks) && connection!.checks.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Master checks (read-only)</p>
                  <div className="space-y-1.5">
                    {connection!.checks.map((c, i) => (
                      <div key={`${c.kind}-${c.code}-${i}`} className="flex items-center justify-between gap-2 text-xs border border-slate-200 rounded-lg px-3 py-2">
                        <span className="text-slate-700">{c.kind}: {c.name || c.code}</span>
                        <span className={`font-semibold ${c.status === 'match' ? 'text-emerald-700' : c.status === 'mismatch' ? 'text-red-700' : 'text-amber-700'}`}>{c.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2 text-[#4B2B18] font-bold"><Server className="w-4 h-4" /> Status Sync Accurate</div>
          {loading && !sync ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memuat status sync...</div>
          ) : sync ? (
            <>
              <div className="flex flex-wrap gap-2">
                <StatePill ok={sync.writesConfigured} label={`Writes configured (sistem): ${sync.writesConfigured ? 'Ya' : 'Tidak'}`} />
                <StatePill ok={sync.schedulerConfigured} label={`Scheduler configured (sistem): ${sync.schedulerConfigured ? 'Ya' : 'Tidak'}`} />
                <StatePill ok={Boolean(sync.active)} label={`Active (sistem): ${sync.active ? 'Ya' : 'Tidak/Tidak diketahui'}`} />
              </div>
              <p className="text-[11px] text-slate-500">Indikator di atas adalah status konfigurasi/operasional sistem, bukan hak akses FAT untuk menjalankan sinkronisasi.</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-slate-500">Mode</dt><dd className="font-medium text-slate-800">{sync.mode}</dd></div>
                <div><dt className="text-slate-500">Database ID</dt><dd className="font-medium text-slate-800">{String(sync.databaseId)}</dd></div>
                <div><dt className="text-slate-500">Jobs dimuat</dt><dd className="font-medium text-slate-800">{Array.isArray(sync.jobs) ? sync.jobs.length : 0}</dd></div>
                <div><dt className="text-slate-500">Manual config (sistem)</dt><dd className="font-medium text-slate-800">{sync.manual ? (sync.manual.enabled ? 'Aktif' : 'Ada (nonaktif)') : 'Tidak ada'}</dd></div>
              </dl>
              {Array.isArray(sync.jobs) && sync.jobs.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Job terbaru (ringkasan read-only, detail dibatasi)</p>
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {sync.jobs.map((j) => (
                      <div key={j.id} className="border border-slate-200 rounded-xl p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-800">{j.bookingCode || j.id}</span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">{j.state}</span>
                        </div>
                        <div className="mt-1 text-slate-600">Nominal: {j.amountValid && j.amount !== null ? `Rp ${j.amount.toLocaleString('id-ID')}` : 'Tidak valid'}</div>
                        {j.updatedAt && <div className="mt-1 text-slate-400">Diperbarui: {new Date(j.updatedAt).toLocaleString('id-ID')}</div>}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">Catatan/detail internal job tidak ditampilkan untuk meminimalkan eksposur informasi operasional; gunakan kanal berwenang bila diperlukan.</p>
                </div>
              ) : (
                <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl p-4">Belum ada job sync yang dapat ditampilkan.</div>
              )}
              <p className="text-[11px] text-slate-500">Monitoring ini tidak menyediakan tombol retry/process/activate/pause/post. Kontrol tetap berada di kanal Manager/Admin yang berwenang.</p>
            </>
          ) : (
            <div className="text-sm text-slate-500">Status sync belum tersedia untuk ditampilkan.</div>
          )}
        </div>
      </div>
    </div>
  );
};
