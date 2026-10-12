import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Plus,
  Edit2,
  Power,
  Search,
  CheckCircle2,
  AlertCircle,
  Save,
  X,
  Users,
  Layers,
  Award,
  Info,
} from 'lucide-react';
import { TherapistSkill, Therapist, ServiceItem, StaffUser } from '../../types';
import {
  getTherapistSkills,
  saveTherapistSkill,
  toggleTherapistSkillStatus,
  getMasterServices,
  getTherapistMasterList,
} from '../../lib/masterDataService';

interface TherapistSkillMasterCardProps {
  currentUser: StaffUser;
  onRefresh?: () => void;
  isReadOnly?: boolean;
}

export const TherapistSkillMasterCard: React.FC<TherapistSkillMasterCardProps> = ({
  currentUser,
  onRefresh,
  isReadOnly = false,
}) => {
  const [skills, setSkills] = useState<TherapistSkill[]>([]);
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<TherapistSkill | null>(null);

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
  const [toggleConfirmSkill, setToggleConfirmSkill] = useState<TherapistSkill | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [skillList, srvList, trpList] = await Promise.all([
        getTherapistSkills(),
        getMasterServices(),
        getTherapistMasterList(),
      ]);
      setSkills(skillList);
      setServices(srvList);
      setTherapists(trpList);
    } catch (err) {
      console.warn('Failed to load therapist skills:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenAdd = () => {
    if (isReadOnly) return;
    setEditingSkill(null);
    setName('');
    setCode(`SKL-${(skills.length + 1).toString().padStart(2, '0')}`);
    setDescription('');
    setSortOrder(skills.length + 1);
    setIsActive(true);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (skl: TherapistSkill) => {
    if (isReadOnly) return;
    setEditingSkill(skl);
    setName(skl.skillName);
    setCode(skl.skillCode || '');
    setDescription(skl.description || '');
    setSortOrder(skl.sortOrder ?? 1);
    setIsActive(skl.isActive);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!name.trim()) {
      setErrorMsg('Nama keahlian wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      await saveTherapistSkill(
        {
          id: editingSkill?.id,
          skillName: name.trim(),
          skillCode: code.trim().toUpperCase(),
          description: description.trim(),
          sortOrder: Number(sortOrder),
          isActive,
          activeStatus: isActive ? 'ACTIVE' : 'INACTIVE',
          createdAt: editingSkill?.createdAt,
        },
        !editingSkill,
        {
          id: (currentUser as any)?.id || currentUser?.uid || 'system',
          name: currentUser.name,
          role: currentUser.role as any,
        }
      );

      setSuccessMsg(
        editingSkill
          ? `Keahlian "${name}" berhasil diperbarui.`
          : `Keahlian baru "${name}" berhasil ditambahkan.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setIsModalOpen(false);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan keahlian terapis.');
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteToggle = async () => {
    if (!toggleConfirmSkill) return;
    setSaving(true);
    try {
      const updatedState = await toggleTherapistSkillStatus(toggleConfirmSkill, {
        id: (currentUser as any)?.id || currentUser?.uid || 'system',
        name: currentUser.name,
        role: currentUser.role as any,
      });

      setSuccessMsg(
        `Keahlian "${toggleConfirmSkill.skillName}" berhasil ${
          updatedState ? 'diaktifkan' : 'dinonaktifkan'
        }.`
      );
      setTimeout(() => setSuccessMsg(''), 4000);
      setToggleConfirmSkill(null);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memperbarui status keahlian.');
    } finally {
      setSaving(false);
    }
  };

  // Count therapists with this skill
  const getTherapistCountWithSkill = (skill: TherapistSkill): number => {
    return therapists.filter(
      (t) =>
        (t.skillIds && t.skillIds.includes(skill.id)) ||
        (t.specialties &&
          t.specialties.some((sp) => (sp || '').toLowerCase().includes((skill.skillName || '').toLowerCase())))
    ).length;
  };

  // Count services that require this skill
  const getServiceCountRequiringSkill = (skill: TherapistSkill): number => {
    return services.filter(
      (s) => s.requiredSkillIds && s.requiredSkillIds.includes(skill.id)
    ).length;
  };

  // Filtering
  const filteredSkills = skills.filter((s) => {
    const q = (searchTerm || '').toLowerCase();
    const matchesSearch =
      (s.skillName || '').toLowerCase().includes(q) ||
      (s.skillCode && s.skillCode.toLowerCase().includes(q)) ||
      (s.description && s.description.toLowerCase().includes(q));

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && s.isActive) ||
      (statusFilter === 'INACTIVE' && !s.isActive);

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
                <Award className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Master Keahlian Terapis
                </h3>
                <p className="text-xs text-slate-500">
                  Kelola matriks keahlian terpusat. Keahlian ini menghubungkan Service Master (Required Skills) dan Therapist Master (Keahlian Terapis) untuk Assignment Engine Prompt 14.
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
              <span>Tambah Keahlian Baru</span>
            </button>
          </div>
        </div>

        {/* Informational Card */}
        <div className="mt-4 p-4 rounded-xl bg-amber-50/60 border border-amber-200/60 flex items-start gap-3">
          <Info className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-700 leading-relaxed">
            <span className="font-bold text-slate-900">Integritas Penugasan :</span>{' '}
            Saat pesanan masuk, sistem secara cerdas mencocokkan keahlian wajib pada layanan dengan keahlian yang dimiliki terapis. Jika keahlian dinonaktifkan, riwayat dan penugasan terapis tetap aman namun keahlian tidak muncul untuk layanan baru.
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
              placeholder="Cari keahlian atau kode..."
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

        {/* Skills Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/80 text-slate-700 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 w-16 text-center">Urutan</th>
                <th className="py-3 px-4">Nama &amp; Kode Keahlian</th>
                <th className="py-3 px-4">Deskripsi Kompetensi</th>
                <th className="py-3 px-4 text-center">Terapis Tersertifikasi</th>
                <th className="py-3 px-4 text-center">Layanan Membutuhkan</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
                      <span>Memuat data keahlian terapis...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredSkills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Tidak ada keahlian yang sesuai dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                (filteredSkills || []).map((skl) => {
                  const therapistCount = getTherapistCountWithSkill(skl);
                  const serviceCount = getServiceCountRequiringSkill(skl);

                  return (
                    <tr
                      key={skl.id}
                      className={`hover:bg-amber-50/30 transition ${
                        !skl.isActive ? 'bg-slate-50/60 opacity-75' : ''
                      }`}
                    >
                      {/* Sort Order */}
                      <td className="py-3.5 px-4 text-center font-bold text-slate-500">
                        #{skl.sortOrder ?? '-'}
                      </td>

                      {/* Name & Code */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{skl.skillName}</span>
                          {skl.skillCode && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                              {skl.skillCode}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">{skl.id}</span>
                      </td>

                      {/* Description */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-slate-600 line-clamp-2">
                          {skl.description || <span className="text-slate-400 italic">Tanpa deskripsi</span>}
                        </p>
                      </td>

                      {/* Certified Therapists */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs ${
                            therapistCount > 0
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          <Users className="w-3 h-3" />
                          {therapistCount} Terapis
                        </span>
                      </td>

                      {/* Requiring Services */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-bold text-xs ${
                            serviceCount > 0
                              ? 'bg-blue-50 text-blue-800 border border-blue-200'
                              : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          <Layers className="w-3 h-3" />
                          {serviceCount} Layanan
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            skl.isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {skl.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(skl)}
                            disabled={isReadOnly}
                            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                              isReadOnly
                                ? 'text-slate-300 cursor-not-allowed'
                                : 'text-slate-700 hover:text-amber-800 hover:bg-slate-100 cursor-pointer'
                            }`}
                            title="Edit Keahlian"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setToggleConfirmSkill(skl)}
                            disabled={isReadOnly}
                            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                              isReadOnly
                                ? 'text-slate-300 cursor-not-allowed'
                                : skl.isActive
                                ? 'text-rose-600 hover:bg-rose-50 cursor-pointer'
                                : 'text-emerald-600 hover:bg-emerald-50 cursor-pointer'
                            }`}
                            title={skl.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">{skl.isActive ? 'Nonaktif' : 'Aktif'}</span>
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

      {/* Add / Edit Skill Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-600" />
                <span>{editingSkill ? 'Edit Keahlian Terapis' : 'Tambah Keahlian Baru'}</span>
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
                  Nama Keahlian / Kualifikasi <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Contoh: Hot Stone Therapy"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Keahlian</label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="Contoh: SKL-HOT"
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
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Kompetensi</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Teknik pijat, sertifikasi, atau alat yang digunakan..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-slate-800"
                />
              </div>

              {/* Active Toggle Switch */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block text-xs">Status Keahlian</span>
                  <span className="text-[11px] text-slate-500">
                    {isActive
                      ? 'Aktif dan dapat dipilih pada Service Master & Therapist Master'
                      : 'Nonaktif (disembunyikan dari penugasan baru)'}
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
                  <span>{editingSkill ? 'Simpan Perubahan' : 'Simpan Keahlian'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Status Toggle */}
      {toggleConfirmSkill && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
              <Power className="w-5 h-5" />
            </div>

            <div className="text-center space-y-1">
              <h4 className="text-base font-bold text-slate-900">
                {toggleConfirmSkill.isActive ? 'Nonaktifkan Keahlian?' : 'Aktifkan Keahlian?'}
              </h4>
              <p className="text-xs text-slate-600">
                {toggleConfirmSkill.isActive
                  ? `Keahlian "${toggleConfirmSkill.skillName}" akan dinonaktifkan. Terapis atau layanan yang sudah terhubung tetap memiliki data ini, namun keahlian tidak muncul untuk pilihan baru.`
                  : `Keahlian "${toggleConfirmSkill.skillName}" akan diaktifkan kembali.`}
              </p>
            </div>

            <div className="pt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setToggleConfirmSkill(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-xs cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleExecuteToggle}
                className={`px-4 py-2 rounded-xl text-white font-bold text-xs shadow-xs transition cursor-pointer ${
                  toggleConfirmSkill.isActive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {saving ? 'Memproses...' : toggleConfirmSkill.isActive ? 'Ya, Nonaktifkan' : 'Ya, Aktifkan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
