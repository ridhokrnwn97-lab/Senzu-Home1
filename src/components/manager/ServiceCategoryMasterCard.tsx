import React, { useState, useEffect } from 'react';
import {
  FolderTree,
  Plus,
  Edit2,
  Power,
  Search,
  CheckCircle2,
  AlertCircle,
  Save,
  X,
  Layers,
  Sparkles,
  ArrowUpDown,
  Tag,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { ServiceCategory, ServiceItem, StaffUser } from '../../types';
import {
  getServiceCategories,
  saveServiceCategory,
  toggleServiceCategoryStatus,
  getMasterServices,
} from '../../lib/masterDataService';

interface ServiceCategoryMasterCardProps {
  currentUser: StaffUser;
  onRefresh?: () => void;
  isReadOnly?: boolean;
}

export const ServiceCategoryMasterCard: React.FC<ServiceCategoryMasterCardProps> = ({
  currentUser,
  onRefresh,
  isReadOnly = false,
}) => {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<number>(1);
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Status toggle confirmation modal
  const [toggleConfirmCat, setToggleConfirmCat] = useState<ServiceCategory | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [catList, srvList] = await Promise.all([
        getServiceCategories(),
        getMasterServices(),
      ]);
      setCategories(catList);
      setServices(srvList);
    } catch (err) {
      console.warn('Failed to load categories:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenAdd = () => {
    if (isReadOnly) return;
    setEditingCategory(null);
    setName('');
    setCode(`CAT-${(categories.length + 1).toString().padStart(2, '0')}`);
    setDescription('');
    setSortOrder(categories.length + 1);
    setIsActive(true);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (cat: ServiceCategory) => {
    if (isReadOnly) return;
    setEditingCategory(cat);
    setName(cat.categoryName);
    setCode(cat.categoryCode || '');
    setDescription(cat.description || '');
    setSortOrder(cat.sortOrder ?? 1);
    setIsActive(cat.isActive);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('Nama kategori wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      await saveServiceCategory(
        {
          id: editingCategory?.id,
          categoryName: name.trim(),
          categoryCode: code.trim().toUpperCase(),
          description: description.trim(),
          sortOrder: Number(sortOrder),
          isActive,
          activeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
          createdAt: editingCategory?.createdAt,
        },
        !editingCategory,
        {
          id: (currentUser as any)?.id || currentUser?.uid || 'manager',
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );

      setSuccessMsg(
        editingCategory
          ? `Kategori "${name}" berhasil diperbarui.`
          : `Kategori baru "${name}" berhasil ditambahkan.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setIsModalOpen(false);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan kategori layanan.');
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteToggle = async () => {
    if (!toggleConfirmCat) return;
    setSaving(true);
    try {
      const updatedState = await toggleServiceCategoryStatus(toggleConfirmCat, {
        id: (currentUser as any)?.id || currentUser?.uid || 'manager',
        name: currentUser.name,
        role: currentUser.role as any,
      });

      setSuccessMsg(
        `Kategori "${toggleConfirmCat.categoryName}" berhasil ${
          updatedState ? 'diaktifkan' : 'dinonaktifkan'
        }.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setToggleConfirmCat(null);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memperbarui status kategori.');
    } finally {
      setSaving(false);
    }
  };

  // Helper to count services under this category
  const getLinkedServicesCount = (cat: ServiceCategory): number => {
    return services.filter(
      (s) =>
        s.categoryId === cat.id ||
        (s.category && (s.category || '').toLowerCase() === (cat.categoryName || '').toLowerCase())
    ).length;
  };

  // Filtering
  const filteredCategories = categories.filter((c) => {
    const q = (searchTerm || '').toLowerCase();
    const matchesSearch =
      (c.categoryName || '').toLowerCase().includes(q) ||
      (c.categoryCode && c.categoryCode.toLowerCase().includes(q)) ||
      (c.description && c.description.toLowerCase().includes(q));

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && c.isActive) ||
      (statusFilter === 'INACTIVE' && !c.isActive);

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-50 text-amber-700">
                <FolderTree className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Master Kategori Layanan
                </h3>
                <p className="text-xs text-slate-500">
                  Kelola taksonomi kategori resmi Senzu Home. Kategori ini muncul di formulir Service Master dan filter katalog pelanggan.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenAdd}
              disabled={isReadOnly}
              className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                isReadOnly
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs cursor-pointer active:scale-95'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Kategori Baru</span>
            </button>
          </div>
        </div>

        {/* Informational Single Source of Truth Card */}
        <div className="mt-4 p-4 rounded-xl bg-amber-50/60 border border-amber-200/60 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700 leading-relaxed">
            <span className="font-bold text-slate-900">Aturan Integritas Master Data:</span>{' '}
            Setiap layanan mengacu pada stable ID kategori ini. Kategori yang dinonaktifkan tidak akan muncul pada dropdown layanan baru, namun layanan eksisting yang memakainya tetap aman dan tidak akan hilang.
          </div>
        </div>

        {/* Success Alert */}
        {successMsg && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span className="font-semibold">{successMsg}</span>
          </div>
        )}
      </div>

      {/* Filter and Table Container */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari kategori atau kode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            >
              <option value="ALL">Semua Status</option>
              <option value="ACTIVE">Aktif Saja</option>
              <option value="INACTIVE">Non-Aktif Saja</option>
            </select>
          </div>
        </div>

        {/* Categories Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 w-16 text-center">Urutan</th>
                <th className="py-3 px-4">Nama &amp; Kode Kategori</th>
                <th className="py-3 px-4">Deskripsi</th>
                <th className="py-3 px-4 text-center">Layanan Terkait</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
                      <span>Memuat data kategori layanan...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    Tidak ada kategori yang sesuai dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                (filteredCategories || []).map((cat) => {
                  const linkedCount = getLinkedServicesCount(cat);
                  return (
                    <tr
                      key={cat.id}
                      className={`hover:bg-amber-50/30 transition ${
                        !cat.isActive ? 'bg-slate-50/60 opacity-75' : ''
                      }`}
                    >
                      {/* Sort Order */}
                      <td className="py-3.5 px-4 text-center font-bold text-slate-500">
                        #{cat.sortOrder ?? '-'}
                      </td>

                      {/* Name & Code */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{cat.categoryName}</span>
                          {cat.categoryCode && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {cat.categoryCode}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">{cat.id}</span>
                      </td>

                      {/* Description */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-slate-600 line-clamp-2">
                          {cat.description || <span className="text-slate-400 italic">Tanpa deskripsi</span>}
                        </p>
                      </td>

                      {/* Linked Services */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs ${
                            linkedCount > 0
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          <Layers className="w-3 h-3" />
                          {linkedCount} Layanan
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            cat.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {cat.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(cat)}
                            disabled={isReadOnly}
                            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                              isReadOnly
                                ? 'text-slate-300 cursor-not-allowed'
                                : 'text-slate-700 hover:text-amber-800 hover:bg-slate-100 cursor-pointer'
                            }`}
                            title="Edit Kategori"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setToggleConfirmCat(cat)}
                            disabled={isReadOnly}
                            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                              isReadOnly
                                ? 'text-slate-300 cursor-not-allowed'
                                : cat.isActive
                                ? 'text-rose-600 hover:bg-rose-50 cursor-pointer'
                                : 'text-emerald-600 hover:bg-emerald-50 cursor-pointer'
                            }`}
                            title={cat.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">{cat.isActive ? 'Nonaktif' : 'Aktif'}</span>
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

      {/* Add / Edit Category Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-amber-600" />
                <span>{editingCategory ? 'Edit Kategori Layanan' : 'Tambah Kategori Layanan Baru'}</span>
              </h4>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Kategori <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Contoh: Signature Treatment"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Kategori</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="Contoh: CAT-SIG"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-800 uppercase"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Urutan Tampilan</label>
                  <input
                    type="number"
                    min={1}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 text-center"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Singkat</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Penjelasan ringkas peruntukan kategori layanan..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                />
              </div>

              {/* Active Toggle Switch */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">Status Kategori</span>
                  <span className="text-[11px] text-slate-500">
                    {isActive
                      ? 'Aktif dan dapat dipilih pada formulir Service Master'
                      : 'Nonaktif (disembunyikan dari pilihan layanan baru)'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {saving ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{editingCategory ? 'Simpan Perubahan' : 'Simpan Kategori'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Status Toggle */}
      {toggleConfirmCat && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
              <Power className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-base font-bold text-slate-900">
                {toggleConfirmCat.isActive ? 'Nonaktifkan Kategori?' : 'Aktifkan Kategori?'}
              </h4>
              <p className="text-xs text-slate-600">
                {toggleConfirmCat.isActive
                  ? `Kategori "${toggleConfirmCat.categoryName}" akan dinonaktifkan. Layanan yang sudah memakai kategori ini tetap aman dan tidak akan terhapus.`
                  : `Kategori "${toggleConfirmCat.categoryName}" akan diaktifkan kembali dan dapat dipilih di formulir Service Master.`}
              </p>
            </div>

            <div className="pt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setToggleConfirmCat(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleExecuteToggle}
                className={`px-4 py-2 rounded-xl text-white font-bold text-xs shadow-xs transition cursor-pointer ${
                  toggleConfirmCat.isActive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {saving ? 'Memproses...' : toggleConfirmCat.isActive ? 'Ya, Nonaktifkan' : 'Ya, Aktifkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
