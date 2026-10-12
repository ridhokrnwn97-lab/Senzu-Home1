import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Clock,
  Tag,
  Plus,
  Edit2,
  Power,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertCircle,
  Save,
  X,
  ShieldAlert,
  Info,
  Layers,
  Check,
  FolderTree,
  Award,
} from 'lucide-react';
import { ServiceItem, StaffUser, ServiceCategory, TherapistSkill } from '../../types';
import { formatRupiah } from '../../lib/utils';
import {
  saveMasterService,
  toggleMasterServiceStatus,
  getServiceCategories,
  getTherapistSkills,
  saveServiceCategory,
  saveTherapistSkill,
} from '../../lib/masterDataService';

interface ServiceMasterCardProps {
  services: ServiceItem[];
  currentUser: StaffUser;
  onRefresh: () => void;
}

export const ServiceMasterCard: React.FC<ServiceMasterCardProps> = ({
  services = [],
  currentUser,
  onRefresh,
}) => {
  const isReadOnly = currentUser.role !== 'manager' && currentUser.role !== 'admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Dynamic Master Data State (Prompt 17A)
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [skills, setSkills] = useState<TherapistSkill[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);

  // Quick Add State (Inline Category or Skill Creation)
  const [showQuickAddCategory, setShowQuickAddCategory] = useState(false);
  const [quickCategoryName, setQuickCategoryName] = useState('');
  const [quickCategorySaving, setQuickCategorySaving] = useState(false);

  const [showQuickAddSkill, setShowQuickAddSkill] = useState(false);
  const [quickSkillName, setQuickSkillName] = useState('');
  const [quickSkillSaving, setQuickSkillSaving] = useState(false);

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentServiceId, setCurrentServiceId] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [category, setCategory] = useState('');
  const [duration, setDuration] = useState<number>(90);
  const [price, setPrice] = useState<number>(150000);
  const [description, setDescription] = useState('');
  const [serviceType, setServiceType] = useState<'HOME_SERVICE' | 'OUTLET' | 'BOTH'>('HOME_SERVICE');
  const [requiredSkillIds, setRequiredSkillIds] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<number>(1);
  const [isPopular, setIsPopular] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Status toggle confirmation
  const [toggleConfirmItem, setToggleConfirmItem] = useState<ServiceItem | null>(null);

  const loadDynamicMasters = async () => {
    setLoadingMaster(true);
    try {
      const [cats, skls] = await Promise.all([
        getServiceCategories(),
        getTherapistSkills(),
      ]);
      setCategories(cats);
      setSkills(skls);
    } catch (err) {
      console.warn('Failed to load dynamic master categories or skills:', err);
    } finally {
      setLoadingMaster(false);
    }
  };

  useEffect(() => {
    loadDynamicMasters();
  }, []);

  const handleOpenNew = () => {
    if (isReadOnly) return;
    setIsEditing(false);
    setCurrentServiceId(`SRV-${Date.now().toString(36).toUpperCase()}`);
    setName('');

    const defaultCat = categories.find((c) => c.isActive) || categories[0];
    setCategoryId(defaultCat?.id || 'cat-reflexology');
    setCategory(defaultCat?.categoryName || 'Reflexology');

    setDuration(90);
    setPrice(150000);
    setDescription('');
    setServiceType('HOME_SERVICE');

    const defaultSkill = skills.find((s) => s.isActive) || skills[0];
    setRequiredSkillIds(defaultSkill ? [defaultSkill.id] : ['reflexology']);

    setSortOrder(services.length + 1);
    setIsPopular(false);
    setIsActive(true);
    setErrorMsg('');
    setShowQuickAddCategory(false);
    setShowQuickAddSkill(false);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (srv: ServiceItem) => {
    if (isReadOnly) return;
    setIsEditing(true);
    setCurrentServiceId(srv.id);
    setName(srv.name);

    // Resolve stable categoryId
    const matchedCat = categories.find(
      (c) =>
        c.id === srv.categoryId ||
        (c.categoryName || '').toLowerCase() === (srv.category || '').toLowerCase()
    );
    const catId = srv.categoryId || matchedCat?.id || (categories[0]?.id || 'cat-reflexology');
    const catName = srv.category || matchedCat?.categoryName || 'Reflexology';

    setCategoryId(catId);
    setCategory(catName);

    setDuration(srv.duration);
    setPrice(srv.price);
    setDescription(srv.description || '');
    setServiceType(srv.serviceType || 'HOME_SERVICE');
    setRequiredSkillIds(srv.requiredSkillIds || ['reflexology']);
    setSortOrder(srv.sortOrder ?? 1);
    setIsPopular(Boolean(srv.isPopular));
    setIsActive(srv.isActive);
    setErrorMsg('');
    setShowQuickAddCategory(false);
    setShowQuickAddSkill(false);
    setIsModalOpen(true);
  };

  const handleCategorySelect = (selectedId: string) => {
    setCategoryId(selectedId);
    const found = categories.find((c) => c.id === selectedId);
    if (found) {
      setCategory(found.categoryName);
    }
  };

  const handleQuickAddCategorySubmit = async () => {
    const trimmed = quickCategoryName.trim();
    if (!trimmed) return;
    setQuickCategorySaving(true);
    try {
      const newCat = await saveServiceCategory(
        {
          categoryName: trimmed,
          sortOrder: categories.length + 1,
          isActive: true,
        },
        true,
        {
          id: (currentUser as any)?.id || currentUser?.uid || 'admin',
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );
      await loadDynamicMasters();
      setCategoryId(newCat.id);
      setCategory(newCat.categoryName);
      setQuickCategoryName('');
      setShowQuickAddCategory(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menambahkan kategori baru.');
    } finally {
      setQuickCategorySaving(false);
    }
  };

  const handleQuickAddSkillSubmit = async () => {
    const trimmed = quickSkillName.trim();
    if (!trimmed) return;
    setQuickSkillSaving(true);
    try {
      const newSkill = await saveTherapistSkill(
        {
          skillName: trimmed,
          sortOrder: skills.length + 1,
          isActive: true,
        },
        true,
        {
          id: (currentUser as any)?.id || currentUser?.uid || 'admin',
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );
      await loadDynamicMasters();
      setRequiredSkillIds((prev) => [...prev, newSkill.id]);
      setQuickSkillName('');
      setShowQuickAddSkill(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menambahkan keahlian baru.');
    } finally {
      setQuickSkillSaving(false);
    }
  };

  const handleToggleSkill = (skillId: string) => {
    setRequiredSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('Nama layanan wajib diisi.');
      return;
    }
    if (duration <= 0) {
      setErrorMsg('Durasi layanan harus lebih dari 0 menit.');
      return;
    }
    if (price < 0) {
      setErrorMsg('Tarif layanan tidak boleh negatif.');
      return;
    }

    setSaving(true);
    try {
      // Find latest category name for snapshot
      const activeCat = categories.find((c) => c.id === categoryId);
      const resolvedCategoryName = activeCat?.categoryName || category || 'Reflexology';

      const itemToSave: ServiceItem = {
        id: currentServiceId,
        name: name.trim(),
        categoryId,
        category: resolvedCategoryName,
        duration: Number(duration),
        price: Number(price),
        description: description.trim(),
        serviceType,
        requiredSkillIds,
        sortOrder: Number(sortOrder),
        isPopular,
        isActive,
      };

      await saveMasterService(itemToSave, !isEditing, {
        id: (currentUser as any)?.id || currentUser?.uid || 'admin',
        name: currentUser.name,
        role: currentUser.role as any,
      });

      setSuccessMsg(
        isEditing
          ? `Layanan "${name}" berhasil diperbarui.`
          : `Layanan baru "${name}" berhasil ditambahkan.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setIsModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menyimpan layanan master.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmToggle = async () => {
    if (!toggleConfirmItem || isReadOnly) return;
    try {
      const newStatus = await toggleMasterServiceStatus(toggleConfirmItem, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as any,
      });
      setSuccessMsg(
        `Status layanan "${toggleConfirmItem.name}" berhasil diubah menjadi ${
          newStatus ? 'Aktif' : 'Nonaktif'
        }.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setToggleConfirmItem(null);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengubah status layanan.');
    }
  };

  // Filter services
  const filteredServices = services.filter((s) => {
    const q = (searchTerm || '').toLowerCase();
    const matchesSearch =
      (s.name || '').toLowerCase().includes(q) ||
      (s.category && s.category.toLowerCase().includes(q)) ||
      (s.id || '').toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'ALL' || s.category === categoryFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && s.isActive) ||
      (statusFilter === 'INACTIVE' && !s.isActive);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#082A4F] via-[#0A335F] to-[#082A4F] text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#D4AF37]/30">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-6 h-6 text-[#D4AF37]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif text-lg sm:text-xl font-bold text-white tracking-tight">
                Master Data Layanan Treatment
              </h3>
              <span className="text-[10px] font-bold bg-[#D4AF37]/20 text-[#FDF3CD] border border-[#D4AF37]/40 px-2.5 py-0.5 rounded-full">
                {services.length} Layanan Terdaftar
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Katalog resmi paket reflexology, durasi standar, tarif Rupiah, dan matriks keahlian
            </p>
          </div>
        </div>

        {!isReadOnly && (
          <button
            type="button"
            onClick={handleOpenNew}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#082A4F] text-xs font-bold transition active:scale-95 cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Layanan</span>
          </button>
        )}
      </div>

      {/* Historical Price Protection Notice */}
      <div className="bg-blue-50/80 border-b border-blue-200 px-5 sm:px-6 py-3 flex items-start sm:items-center gap-2.5 text-xs text-blue-900">
        <ShieldCheck className="w-4 h-4 text-[#082A4F] shrink-0 mt-0.5 sm:mt-0" />
        <span className="leading-relaxed">
          <strong>Perlindungan Riwayat Booking:</strong> Setiap pemesanan pelanggan menyimpan snapshot tarif, nama, dan durasi saat transaksi dibuat. Perubahan harga atau durasi master data di sini <strong>tidak akan</strong> mengubah riwayat booking yang sudah tersimpan sebelumnya.
        </span>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="m-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="m-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isReadOnly && (
        <div className="mx-5 mt-5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Mode Lihat Saja (Supervisor):</strong> Penambahan atau pengeditan master layanan memerlukan hak akses Admin atau Manager.
          </span>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col md:flex-row gap-3">
        <div className="relative flex-grow">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari layanan berdasarkan nama, kategori, atau ID..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#082A4F] text-xs"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white text-slate-700"
          >
            <option value="ALL">Semua Kategori</option>
            {(categories || []).map((cat) => (
              <option key={cat.id} value={cat.categoryName}>
                {cat.categoryName} {!cat.isActive ? '(Nonaktif)' : ''}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white text-slate-700"
          >
            <option value="ALL">Semua Status</option>
            <option value="ACTIVE">Hanya Aktif</option>
            <option value="INACTIVE">Hanya Nonaktif</option>
          </select>
        </div>
      </div>

      {/* Services List / Empty State */}
      <div className="p-5 sm:p-6">
        {services.length === 0 ? (
          /* Strictly compliant Empty State */
          <div className="py-12 px-4 rounded-2xl border-2 border-dashed border-slate-200 text-center space-y-4 max-w-md mx-auto">
            <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
              <Layers className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-800">Belum ada data layanan.</h4>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Katalog master layanan belum dibuat. Pemilik atau Admin dapat memasukkan data treatment resmi Senzu secara manual di sini.
              </p>
            </div>
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleOpenNew}
                className="px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0A335F] text-white text-xs font-bold inline-flex items-center gap-2 transition active:scale-95 shadow-sm"
              >
                <Plus className="w-4 h-4 text-[#D4AF37]" />
                <span>Tambah Layanan</span>
              </button>
            )}
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Tidak ada layanan yang sesuai dengan pencarian atau filter Anda.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(filteredServices || []).map((srv) => (
              <div
                key={srv.id}
                className={`rounded-2xl border transition-all p-4 flex flex-col justify-between ${
                  srv.isActive
                    ? 'border-slate-200 bg-white hover:border-[#082A4F]/40 shadow-sm'
                    : 'border-slate-200/60 bg-slate-50 opacity-70'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded uppercase flex items-center gap-1">
                      <FolderTree className="w-3 h-3 text-slate-400" />
                      {srv.category || 'Treatment'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {srv.isPopular && (
                        <span className="text-[10px] font-bold bg-[#D4AF37]/20 text-[#082A4F] border border-[#D4AF37]/40 px-2 py-0.5 rounded-full">
                          Favorit
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          srv.isActive
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {srv.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-[#082A4F] leading-snug">{srv.name}</h4>

                  <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-2 leading-relaxed">
                    {srv.description || 'Layanan massage & reflexology resmi Senzu.'}
                  </p>

                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1 text-slate-600">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-semibold">{srv.duration} Menit</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-600">
                      <Tag className="w-3.5 h-3.5 text-[#D4AF37]" />
                      <span className="font-bold text-[#082A4F]">{formatRupiah(srv.price)}</span>
                    </div>
                  </div>

                  {srv.requiredSkillIds && srv.requiredSkillIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {(srv.requiredSkillIds || []).map((sk) => {
                        const tag = skills.find((t) => t.id === sk);
                        return (
                          <span
                            key={sk}
                            className="text-[9px] font-medium bg-blue-50 text-blue-800 border border-blue-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                          >
                            <Award className="w-2.5 h-2.5 text-blue-500" />
                            {tag?.skillName || sk}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer Controls */}
                <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-slate-100">
                  <span className="font-mono text-[10px] text-slate-400">{srv.id}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(srv)}
                      disabled={isReadOnly}
                      className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                        isReadOnly
                          ? 'text-slate-300 cursor-not-allowed'
                          : 'text-[#082A4F] hover:bg-slate-100 cursor-pointer active:scale-95'
                      }`}
                      title="Edit Layanan"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Edit</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setToggleConfirmItem(srv)}
                      disabled={isReadOnly}
                      className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                        isReadOnly
                          ? 'text-slate-300 cursor-not-allowed'
                          : srv.isActive
                          ? 'text-red-600 hover:bg-red-50 cursor-pointer'
                          : 'text-emerald-600 hover:bg-emerald-50 cursor-pointer'
                      }`}
                      title={srv.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span className="text-[11px]">{srv.isActive ? 'Nonaktif' : 'Aktif'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Service Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white max-w-lg w-full rounded-2xl p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h4 className="text-base font-bold text-[#082A4F]">
                {isEditing ? 'Edit Layanan Master' : 'Tambah Layanan Master Baru'}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    ID Layanan (Unik) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={currentServiceId}
                    onChange={(e) => setCurrentServiceId(e.target.value.toUpperCase())}
                    required
                    disabled={isEditing}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold text-[#082A4F] uppercase disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block font-semibold text-slate-700">
                      Kategori Layanan <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowQuickAddCategory(!showQuickAddCategory)}
                      className="text-[10px] text-amber-700 hover:text-amber-800 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      {showQuickAddCategory ? 'Batal' : 'Kategori Baru'}
                    </button>
                  </div>

                  {showQuickAddCategory ? (
                    <div className="p-2.5 rounded-xl bg-amber-50/80 border border-amber-200 mb-2 space-y-2">
                      <div className="text-[10px] font-bold text-amber-900">Tambah Kategori Master Cepat</div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={quickCategoryName}
                          onChange={(e) => setQuickCategoryName(e.target.value)}
                          placeholder="Nama Kategori..."
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-amber-300 text-xs bg-white"
                        />
                        <button
                          type="button"
                          onClick={handleQuickAddCategorySubmit}
                          disabled={quickCategorySaving || !quickCategoryName.trim()}
                          className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-bold hover:bg-amber-800 disabled:opacity-50 cursor-pointer"
                        >
                          {quickCategorySaving ? '...' : 'Simpan'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <select
                    value={categoryId}
                    onChange={(e) => handleCategorySelect(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    {(categories || []).map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.categoryName} {!cat.isActive ? '(Nonaktif)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Layanan Resmi <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Contoh: Signature Reflexology & Relaksasi"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-[#082A4F] focus:ring-2 focus:ring-[#082A4F]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Durasi (Menit) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-[#082A4F]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tarif Layanan (Rp) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={5000}
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-[#082A4F]"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Format: {formatRupiah(price || 0)}
                  </p>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Deskripsi &amp; Manfaat Layanan:
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Fokus pada titik meridian kaki, betis, dan relaksasi pundak..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tipe Layanan:</label>
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="HOME_SERVICE">Home Service (Panggilan)</option>
                    <option value="OUTLET">Outlet / In-Store</option>
                    <option value="BOTH">Keduanya (Home &amp; Outlet)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Urutan Tampilan:</label>
                  <input
                    type="number"
                    min={1}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-center"
                  />
                </div>
              </div>

              {/* Dynamic Skill Matrix Linkage (Prompt 17A) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-slate-700">
                    Keahlian Terapis yang Diwajibkan (Skill Matrix):
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowQuickAddSkill(!showQuickAddSkill)}
                    className="text-[10px] text-blue-700 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    {showQuickAddSkill ? 'Batal' : 'Keahlian Baru'}
                  </button>
                </div>

                {showQuickAddSkill ? (
                  <div className="p-2.5 rounded-xl bg-blue-50/80 border border-blue-200 mb-2 space-y-2">
                    <div className="text-[10px] font-bold text-blue-900">Tambah Keahlian Master Cepat</div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={quickSkillName}
                        onChange={(e) => setQuickSkillName(e.target.value)}
                        placeholder="Nama Keahlian Terapis..."
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-blue-300 text-xs bg-white"
                      />
                      <button
                        type="button"
                        onClick={handleQuickAddSkillSubmit}
                        disabled={quickSkillSaving || !quickSkillName.trim()}
                        className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-bold hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                      >
                        {quickSkillSaving ? '...' : 'Simpan'}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 max-h-40 overflow-y-auto">
                  {(!skills || skills.length === 0) ? (
                    <div className="col-span-2 text-center py-2 text-slate-400 text-xs">
                      Belum ada master keahlian terapis terdaftar.
                    </div>
                  ) : (
                    (skills || []).map((skill) => {
                      const isSelected = requiredSkillIds.includes(skill.id);
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => handleToggleSkill(skill.id)}
                          className={`p-2 rounded-lg text-left flex items-center justify-between transition border cursor-pointer ${
                            isSelected
                              ? 'bg-blue-50 border-blue-400 text-blue-900 font-semibold'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <span className="text-[11px] leading-tight">
                            {skill.skillName} {!skill.isActive ? '(Nonaktif)' : ''}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPopular}
                    onChange={(e) => setIsPopular(e.target.checked)}
                    className="w-4 h-4 text-[#082A4F] rounded border-slate-300"
                  />
                  <span className="font-semibold text-slate-700">Tandai sebagai Favorit</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="w-4 h-4 text-[#082A4F] rounded border-slate-300"
                  />
                  <span className="font-semibold text-slate-700">Layanan Aktif</span>
                </label>
              </div>

              <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-[#082A4F] hover:bg-[#0A335F] text-white font-bold flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Save className="w-4 h-4 text-[#D4AF37]" />
                  <span>{saving ? 'Menyimpan...' : 'Simpan Layanan'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Toggle Status */}
      {toggleConfirmItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl p-6 shadow-2xl space-y-4 text-xs">
            <h4 className="text-sm font-bold text-[#082A4F]">
              Konfirmasi {toggleConfirmItem.isActive ? 'Penonaktifan' : 'Pengaktifan'} Layanan
            </h4>
            <p className="text-slate-600 leading-relaxed">
              Apakah Anda yakin ingin {toggleConfirmItem.isActive ? 'menonaktifkan' : 'mengaktifkan'} layanan <strong>"{toggleConfirmItem.name}"</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setToggleConfirmItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmToggle}
                className={`px-4 py-2 rounded-xl font-bold text-white ${
                  toggleConfirmItem.isActive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
