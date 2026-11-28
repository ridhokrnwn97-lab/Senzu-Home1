import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clock, History, Layers, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Tag,
} from 'lucide-react';
import { catalogApi, type CatalogAuditRow, type CatalogCategory, type CatalogService, type CatalogSession } from '../../lib/catalogClient';
import { catalogControls, catalogPermissionsFrom, type CatalogPermissions } from '../../lib/catalogPermissions';
import { formatRupiah } from '../../lib/utils';

type SubTab = 'services' | 'categories' | 'history';

const ServiceForm: React.FC<{
  service?: CatalogService; categories: CatalogCategory[]; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<void>;
}> = ({ service, categories, onCancel, onSave }) => {
  const [name, setName] = useState(service?.name || '');
  const [categoryId, setCategoryId] = useState(service?.categoryId || '');
  const [description, setDescription] = useState(service?.description || '');
  const [price, setPrice] = useState(String(service?.price ?? ''));
  const [duration, setDuration] = useState(String(service?.duration ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = Number(price);
    const parsedDuration = Number(duration);
    if (!name.trim() || !categoryId || !Number.isInteger(parsedPrice) || parsedPrice < 0 ||
        !Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
      setError('Lengkapi nama, kategori, harga bilangan bulat, dan durasi 1–1440 menit.');
      return;
    }
    setSaving(true); setError('');
    try {
      await onSave({ name: name.trim(), categoryId, description: description.trim(), price: parsedPrice, duration: parsedDuration });
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
      <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3 shadow-xl border border-slate-200">
        <h3 className="font-bold text-[#4B2B18]">{service ? 'Ubah Informasi Layanan' : 'Tambah Layanan Baru'}</h3>
        {error && <p className="bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl p-2.5">{error}</p>}
        <label className="block text-xs text-slate-600">Nama layanan
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">Kategori
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="">Pilih kategori</option>
            {categories.filter(c => c.isActive !== false).map(c => <option key={c.id} value={c.id}>{c.categoryName || c.name || c.id}</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-600">Deskripsi
          <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-600">Harga (Rp)
            <input type="number" min={0} step={1} value={price} onChange={e => setPrice(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs text-slate-600">Durasi (menit)
            <input type="number" min={1} max={1440} step={1} value={duration} onChange={e => setDuration(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer">Batal</button>
          <button type="submit" disabled={saving} className="px-3 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </form>
    </div>
  );
};

const CategoryForm: React.FC<{
  category?: CatalogCategory; canToggle: boolean; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<void>;
}> = ({ category, canToggle, onCancel, onSave }) => {
  const [name, setName] = useState(category?.categoryName || '');
  const [code, setCode] = useState(category?.categoryCode || '');
  const [description, setDescription] = useState(category?.description || '');
  const [isActive, setIsActive] = useState(category?.isActive !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Nama kategori wajib diisi.'); return; }
    if (canToggle && category && !isActive && category.isActive !== false &&
        !window.confirm(`Nonaktifkan kategori "${category.categoryName || category.id}"?`)) return;
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = { categoryName: name.trim(), categoryCode: code.trim(), description: description.trim() };
      if (canToggle && category) body.isActive = isActive;
      await onSave(body);
    } catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
      <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3 shadow-xl border border-slate-200">
        <h3 className="font-bold text-[#4B2B18]">{category ? 'Ubah Kategori' : 'Tambah Kategori'}</h3>
        {error && <p className="bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl p-2.5">{error}</p>}
        <label className="block text-xs text-slate-600">Nama kategori
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">Kode kategori
          <input value={code} onChange={e => setCode(e.target.value)} maxLength={40} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">Deskripsi
          <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </label>
        {canToggle && category && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /> Kategori aktif
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer">Batal</button>
          <button type="submit" disabled={saving} className="px-3 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold cursor-pointer disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const FatCatalogTab: React.FC = () => {
  const [session, setSession] = useState<CatalogSession | null>(null);
  const [perms, setPerms] = useState<CatalogPermissions | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);
  const [subTab, setSubTab] = useState<SubTab>('services');
  const [services, setServices] = useState<CatalogService[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [history, setHistory] = useState<CatalogAuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sort, setSort] = useState('name');
  const [serviceForm, setServiceForm] = useState<CatalogService | 'new' | null>(null);
  const [categoryForm, setCategoryForm] = useState<CatalogCategory | 'new' | null>(null);

  useEffect(() => {
    let live = true;
    catalogApi.session().then(s => {
      if (!live) return;
      setSession(s); setPerms(catalogPermissionsFrom(s.permissions));
    }).catch((e: any) => {
      if (live) setSessionError(e?.status === 403 ? 'Permission katalog tidak tersedia untuk akun ini.' : (e as Error).message);
    }).finally(() => { if (live) setLoadingSession(false); });
    return () => { live = false; };
  }, []);

  const controls = useMemo(() => catalogControls(perms || catalogPermissionsFrom({})), [perms]);

  const loadCatalog = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [svc, cat] = await Promise.all([catalogApi.services(), catalogApi.categories()]);
      setServices(svc); setCategories(cat);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true); setError('');
    try { setHistory(await catalogApi.audit()); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!controls.canView || loadingSession) return;
    if (subTab === 'history') void loadHistory();
    else void loadCatalog();
  }, [controls.canView, loadingSession, subTab, loadCatalog, loadHistory]);

  const visibleServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = services.filter(s => {
      const matchQ = !q || [s.name, s.shortDescription, s.description, s.category, s.id]
        .some(v => String(v || '').toLowerCase().includes(q));
      return matchQ && (categoryFilter === 'ALL' || s.categoryId === categoryFilter) &&
        (statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? s.isActive !== false : s.isActive === false));
    });
    return [...rows].sort((a, b) => sort === 'price' ? Number(a.price || 0) - Number(b.price || 0)
      : sort === 'duration' ? Number(a.duration || 0) - Number(b.duration || 0)
      : String(a.name || '').localeCompare(String(b.name || '')));
  }, [services, search, categoryFilter, statusFilter, sort]);

  const serviceCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of services) map.set(s.categoryId || '', (map.get(s.categoryId || '') || 0) + 1);
    return map;
  }, [services]);

  const afterMutation = async (message: string) => {
    setNotice(message); setError('');
    if (subTab === 'history') await loadHistory(); else await loadCatalog();
  };

  const saveService = async (body: Record<string, unknown>) => {
    if (serviceForm === 'new') await catalogApi.createService(body);
    else await catalogApi.updateService((serviceForm as CatalogService).id, body);
    setServiceForm(null);
    await afterMutation('Perubahan layanan tersimpan.');
  };
  const saveCategory = async (body: Record<string, unknown>) => {
    if (categoryForm === 'new') await catalogApi.createCategory(body);
    else await catalogApi.updateCategory((categoryForm as CatalogCategory).id, body);
    setCategoryForm(null);
    await afterMutation('Perubahan kategori tersimpan.');
  };
  const patchService = async (service: CatalogService, body: Record<string, unknown>, message: string) => {
    setError(''); setNotice('');
    try { await catalogApi.updateService(service.id, body); await afterMutation(message); }
    catch (e) { setNotice(''); setError((e as Error).message); }
  };

  if (loadingSession) return <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-5 h-5 animate-spin" /> Memuat permission katalog...</div>;
  if (sessionError || !controls.canView) return (
    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 flex gap-3 text-sm text-rose-800">
      <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
      <div><p className="font-bold">Katalog tidak tersedia</p><p className="mt-1">{sessionError || 'Akun ini tidak memiliki permission view katalog. Hubungi Manager/Admin.'}</p></div>
    </div>
  );

  const subtabs: { id: SubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'services', label: 'Layanan', icon: Layers },
    { id: 'categories', label: 'Kategori', icon: Tag },
    { id: 'history', label: 'Riwayat Perubahan', icon: History },
  ];

  return (
    <section className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div>
          <h2 className="font-bold text-[#4B2B18] flex items-center gap-2"><Layers className="w-4 h-4" /> Manajemen Katalog</h2>
          <p className="text-[11px] text-slate-500">Login: {session?.name || session?.uid} · permission dari server, bukan dari browser.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {subtabs.map(s => { const Icon = s.icon; return (
            <button key={s.id} type="button" onClick={() => { setSubTab(s.id); setError(''); setNotice(''); }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border ${subTab === s.id ? 'bg-[#8B5A36] text-white border-[#8B5A36]' : 'bg-white text-[#4B2B18] border-slate-200'}`}>
              <Icon className="w-3.5 h-3.5" />{s.label}
            </button>
          ); })}
          <button type="button" onClick={() => void (subTab === 'history' ? loadHistory() : loadCatalog())}
            title="Muat ulang dari server" className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-800 flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</p>}
      {notice && !error && <p className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />{notice}</p>}
      {loading && <div className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin" /> Memuat data katalog...</div>}

      {!loading && subTab === 'services' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-2 md:items-center justify-between">
            <div className="text-xs text-slate-600">Jumlah layanan: <span className="font-bold text-[#4B2B18]">{visibleServices.length}</span> dari {services.length}</div>
            {controls.canCreate && <button type="button" onClick={() => setServiceForm('new')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold cursor-pointer"><Plus className="w-3.5 h-3.5" /> Tambah Layanan</button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <div className="relative"><Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari layanan..." className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs" />
            </div>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white">
              <option value="ALL">Semua kategori</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.categoryName || c.name || c.id}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white">
              <option value="ALL">Semua status</option><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option>
            </select>
            <select value={sort} onChange={e => setSort(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-xs bg-white">
              <option value="name">Urut: Nama</option><option value="price">Urut: Harga</option><option value="duration">Urut: Durasi</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[880px]">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 px-2">Layanan</th><th className="py-2 px-2">Kategori</th><th className="py-2 px-2">Harga</th><th className="py-2 px-2">Durasi</th><th className="py-2 px-2">Status</th><th className="py-2 px-2">Aksi</th>
              </tr></thead>
              <tbody>
                {visibleServices.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Tidak ada layanan yang sesuai.</td></tr>}
                {visibleServices.map(s => <tr key={s.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 px-2"><div className="font-semibold text-[#4B2B18]">{s.name || s.id}</div>
                    <div className="text-[11px] text-slate-500">{s.shortDescription || s.description || '-'}</div></td>
                  <td className="py-2 px-2">{s.category || categories.find(c => c.id === s.categoryId)?.categoryName || s.categoryId || '-'}</td>
                  <td className="py-2 px-2 font-semibold">{formatRupiah(Number(s.price || 0))}
                    {controls.canEditPrice && <PriceEditor service={s} onSave={body => patchService(s, body, 'Harga layanan diperbarui.')} />}</td>
                  <td className="py-2 px-2">{s.duration ?? '-'} menit
                    {controls.canEditDuration && <DurationEditor service={s} onSave={body => patchService(s, body, 'Durasi layanan diperbarui.')} />}</td>
                  <td className="py-2 px-2"><span className={s.isActive !== false ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{s.isActive !== false ? 'AKTIF' : 'NONAKTIF'}</span></td>
                  <td className="py-2 px-2 space-x-1">
                    {controls.canEditInfo && <button type="button" onClick={() => setServiceForm(s)} title="Ubah informasi layanan" className="p-1.5 rounded-lg border border-slate-200 text-amber-800 hover:bg-amber-50 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>}
                    {controls.canToggleStatus && <button type="button" onClick={() => {
                      if (window.confirm(`${s.isActive !== false ? 'Nonaktifkan' : 'Aktifkan'} layanan "${s.name || s.id}"?`))
                        void patchService(s, { isActive: s.isActive === false }, s.isActive === false ? 'Layanan diaktifkan.' : 'Layanan dinonaktifkan.');
                    }} title="Ubah status" className="p-1.5 rounded-lg border border-slate-200 text-blue-700 hover:bg-blue-50 cursor-pointer"><Clock className="w-3.5 h-3.5" /></button>}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && subTab === 'categories' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-600">Jumlah kategori: <span className="font-bold text-[#4B2B18]">{categories.length}</span></div>
            {controls.canManageCategories && <button type="button" onClick={() => setCategoryForm('new')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold cursor-pointer"><Plus className="w-3.5 h-3.5" /> Tambah Kategori</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="py-2 px-2">Kategori</th><th className="py-2 px-2">Deskripsi</th><th className="py-2 px-2">Layanan</th><th className="py-2 px-2">Status</th><th className="py-2 px-2">Aksi</th></tr></thead>
              <tbody>
                {categories.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Belum ada kategori.</td></tr>}
                {categories.map(c => <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-2 px-2 font-semibold text-[#4B2B18]">{c.categoryName || c.name || c.id}<div className="text-[10px] text-slate-400 font-mono">{c.categoryCode || c.id}</div></td>
                  <td className="py-2 px-2 text-slate-500">{c.description || '-'}</td>
                  <td className="py-2 px-2">{serviceCountByCategory.get(c.id) || 0}</td>
                  <td className="py-2 px-2"><span className={c.isActive !== false ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>{c.isActive !== false ? 'AKTIF' : 'NONAKTIF'}</span></td>
                  <td className="py-2 px-2">{controls.canManageCategories && <button type="button" onClick={() => setCategoryForm(c)} title="Ubah kategori" className="p-1.5 rounded-lg border border-slate-200 text-amber-800 hover:bg-amber-50 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400">Hard delete tidak tersedia. Kategori dengan layanan aktif tidak dapat dinonaktifkan (backend menolak).</p>
        </div>
      )}

      {!loading && subTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 overflow-x-auto">
          <table className="w-full text-xs min-w-[860px]">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 px-2">Waktu</th><th className="py-2 px-2">Actor</th><th className="py-2 px-2">Entitas</th><th className="py-2 px-2">Target</th><th className="py-2 px-2">Aksi</th><th className="py-2 px-2">Perubahan</th>
            </tr></thead>
            <tbody>
              {history.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-400">Belum ada riwayat perubahan katalog.</td></tr>}
              {history.map((h, i) => <tr key={`${h.timestamp}-${h.entityId}-${i}`} className="border-b border-slate-100 align-top">
                <td className="py-2 px-2 whitespace-nowrap">{h.timestamp ? new Date(h.timestamp).toLocaleString('id-ID') : '-'}</td>
                <td className="py-2 px-2">{h.actorName || h.actorRole || '-'}<div className="text-[10px] text-slate-400">{h.actorRole || ''}</div></td>
                <td className="py-2 px-2">{h.entityType || '-'}</td>
                <td className="py-2 px-2">{h.targetName || h.entityId || '-'}</td>
                <td className="py-2 px-2 font-mono text-[11px]">{h.action || '-'}</td>
                <td className="py-2 px-2">{(h.changedFields || []).map(f => <div key={f} className="text-[11px]"><span className="font-semibold">{f}</span>: {String(h.oldValues?.[f] ?? '—')} → {String(h.newValues?.[f] ?? '—')}</div>)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}

      {serviceForm && <ServiceForm service={serviceForm === 'new' ? undefined : serviceForm} categories={categories} onCancel={() => setServiceForm(null)} onSave={saveService} />}
      {categoryForm && <CategoryForm category={categoryForm === 'new' ? undefined : categoryForm} canToggle={controls.canToggleStatus} onCancel={() => setCategoryForm(null)} onSave={saveCategory} />}
    </section>
  );
};

const PriceEditor: React.FC<{ service: CatalogService; onSave: (body: Record<string, unknown>) => Promise<void> }> = ({ service, onSave }) => {
  const [value, setValue] = useState(String(service.price ?? ''));
  const [busy, setBusy] = useState(false);
  return <div className="mt-1 flex items-center gap-1">
    <input type="number" min={0} step={1} value={value} onChange={e => setValue(e.target.value)} className="w-24 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px]" />
    <button type="button" disabled={busy} onClick={() => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) return;
      setBusy(true);
      void onSave({ price: n }).finally(() => setBusy(false));
    }} className="px-1.5 py-1 rounded-lg border border-amber-200 text-amber-800 text-[10px] cursor-pointer disabled:opacity-50">Simpan</button>
  </div>;
};

const DurationEditor: React.FC<{ service: CatalogService; onSave: (body: Record<string, unknown>) => Promise<void> }> = ({ service, onSave }) => {
  const [value, setValue] = useState(String(service.duration ?? ''));
  const [busy, setBusy] = useState(false);
  return <div className="mt-1 flex items-center gap-1">
    <input type="number" min={1} max={1440} step={1} value={value} onChange={e => setValue(e.target.value)} className="w-20 border border-slate-200 rounded-lg px-1.5 py-1 text-[11px]" />
    <button type="button" disabled={busy} onClick={() => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 1440) return;
      setBusy(true);
      void onSave({ duration: n }).finally(() => setBusy(false));
    }} className="px-1.5 py-1 rounded-lg border border-amber-200 text-amber-800 text-[10px] cursor-pointer disabled:opacity-50">Simpan</button>
  </div>;
};
