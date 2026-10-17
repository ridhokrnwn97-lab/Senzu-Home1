import React, { useState, useEffect } from 'react';
import {
  MapPin,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Save,
  Shield,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Search,
  HelpCircle,
  Sliders,
  Compass,
  Navigation,
} from 'lucide-react';
import {
  ServiceArea,
  ServiceAreaStatus,
  AreaMasterConfig,
  ServiceRadiusTier,
  StaffUser,
} from '../../types';
import {
  getServiceAreas,
  saveServiceArea,
  toggleServiceAreaStatus,
  deleteServiceArea,
  getAreaMasterConfig,
  saveAreaMasterConfig,
} from '../../lib/masterDataService';
import { formatRupiah } from '../../lib/utils';

interface AreaMasterCardProps {
  currentUser: StaffUser;
  onRefresh: () => void;
  isReadOnly?: boolean;
}

export const AreaMasterCard: React.FC<AreaMasterCardProps> = ({
  currentUser,
  onRefresh,
  isReadOnly = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [savingArea, setSavingArea] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Service Areas Data
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Fallback distance tiers and base coordinates
  const [activeTab, setActiveTab] = useState<'areas' | 'radius_tiers'>('areas');
  const [areaConfig, setAreaConfig] = useState<AreaMasterConfig>({
    id: 'area_config',
    baseLocationName: 'Senzu Reflexology Palembang (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang)',
    baseLatitude: -2.9859024,
    baseLongitude: 104.7385997,
    fallbackHomeServiceFee: 50000,
    supportedAreas: [],
  });
  const [radiusTiers, setRadiusTiers] = useState<ServiceRadiusTier[]>([]);

  // Modal State for Add / Edit Service Area
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<ServiceArea | null>(null);
  const [modalForm, setModalForm] = useState<{
    id: string;
    name: string;
    kecamatan: string;
    city: string;
    province: string;
    branchId: string;
    branchName: string;
    status: ServiceAreaStatus;
    homeServiceEnabled: boolean;
    homeServiceFeeInput: string; // string for input control, converted to number
    minimumOrderInput: string;
    maximumDistanceInput: string;
    centerLatitudeInput: string;
    centerLongitudeInput: string;
    radiusKmInput: string;
    sortOrder: number;
    internalNote: string;
  }>({
    id: '',
    name: '',
    kecamatan: '',
    city: 'PALEMBANG',
    province: 'SUMATERA SELATAN',
    branchId: 'PLG001',
    branchName: 'Senzu Reflexology & Family Massage Palembang',
    status: 'ACTIVE',
    homeServiceEnabled: true,
    homeServiceFeeInput: '25000',
    minimumOrderInput: '',
    maximumDistanceInput: '',
    centerLatitudeInput: '',
    centerLongitudeInput: '',
    radiusKmInput: '',
    sortOrder: 1,
    internalNote: '',
  });

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [areaList, configData] = await Promise.all([
        getServiceAreas(),
        getAreaMasterConfig(),
      ]);
      setAreas(areaList);
      setAreaConfig(configData.areaConfig);
      setRadiusTiers(configData.radiusTiers);
    } catch (err) {
      console.error('Failed to load area master data:', err);
      setErrorMsg('Gagal memuat data master area.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    const nextSort = areas.length + 1;
    const generatedId = `AREA-${Date.now().toString().slice(-6)}`;
    setEditingArea(null);
    setModalForm({
      id: generatedId,
      name: '',
      kecamatan: '',
      city: 'PALEMBANG',
      province: 'SUMATERA SELATAN',
      branchId: 'PLG001',
      branchName: 'Senzu Reflexology & Family Massage Palembang',
      status: 'ACTIVE',
      homeServiceEnabled: true,
      homeServiceFeeInput: '25000',
      minimumOrderInput: '',
      maximumDistanceInput: '',
      centerLatitudeInput: '',
      centerLongitudeInput: '',
      radiusKmInput: '',
      sortOrder: nextSort,
      internalNote: '',
    });
    setIsModalOpen(true);
    setErrorMsg('');
  };

  const handleOpenEdit = (area: ServiceArea) => {
    setEditingArea(area);
    setModalForm({
      id: area.id,
      name: area.name,
      kecamatan: area.kecamatan,
      city: area.city || 'PALEMBANG',
      province: area.province || 'SUMATERA SELATAN',
      branchId: area.branchId || 'PLG001',
      branchName: area.branchName || 'Senzu Reflexology & Family Massage Palembang',
      status: area.status,
      homeServiceEnabled: area.homeServiceEnabled !== false,
      homeServiceFeeInput: area.homeServiceFee !== undefined ? String(area.homeServiceFee) : '',
      minimumOrderInput: area.minimumOrderAmount !== undefined ? String(area.minimumOrderAmount) : '',
      maximumDistanceInput: area.maximumDistanceKm !== undefined ? String(area.maximumDistanceKm) : '',
      centerLatitudeInput: area.centerLatitude !== undefined ? String(area.centerLatitude) : '',
      centerLongitudeInput: area.centerLongitude !== undefined ? String(area.centerLongitude) : '',
      radiusKmInput: area.radiusKm !== undefined ? String(area.radiusKm) : '',
      sortOrder: area.sortOrder || 1,
      internalNote: area.internalNote || '',
    });
    setIsModalOpen(true);
    setErrorMsg('');
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;

    if (!modalForm.name.trim()) {
      setErrorMsg('Nama Area wajib diisi.');
      return;
    }
    if (!modalForm.kecamatan.trim()) {
      setErrorMsg('Kecamatan wajib diisi.');
      return;
    }

    setSavingArea(true);
    setErrorMsg('');

    try {
      const parsedFee = modalForm.homeServiceFeeInput.trim() !== ''
        ? Math.max(0, parseInt(modalForm.homeServiceFeeInput.replace(/\D/g, ''), 10) || 0)
        : undefined;

      const parsedMinOrder = modalForm.minimumOrderInput.trim() !== ''
        ? Math.max(0, parseInt(modalForm.minimumOrderInput.replace(/\D/g, ''), 10) || 0)
        : undefined;

      const parsedMaxDist = modalForm.maximumDistanceInput.trim() !== ''
        ? Math.max(0, parseFloat(modalForm.maximumDistanceInput) || 0)
        : undefined;

      const parsedLat = modalForm.centerLatitudeInput.trim() !== ''
        ? parseFloat(modalForm.centerLatitudeInput)
        : undefined;

      const parsedLng = modalForm.centerLongitudeInput.trim() !== ''
        ? parseFloat(modalForm.centerLongitudeInput)
        : undefined;

      const parsedRadius = modalForm.radiusKmInput.trim() !== ''
        ? Math.max(0, parseFloat(modalForm.radiusKmInput) || 0)
        : undefined;

      const payload: ServiceArea = {
        id: modalForm.id.trim(),
        name: modalForm.name.trim(),
        kecamatan: modalForm.kecamatan.trim(),
        city: modalForm.city.trim().toUpperCase(),
        province: modalForm.province.trim().toUpperCase(),
        branchId: modalForm.branchId,
        branchName: modalForm.branchName,
        status: modalForm.status,
        homeServiceEnabled: modalForm.homeServiceEnabled,
        homeServiceFee: parsedFee,
        minimumOrderAmount: parsedMinOrder,
        maximumDistanceKm: parsedMaxDist,
        centerLatitude: parsedLat,
        centerLongitude: parsedLng,
        radiusKm: parsedRadius,
        sortOrder: Number(modalForm.sortOrder) || 1,
        internalNote: modalForm.internalNote.trim() || undefined,
        createdAt: editingArea?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      };

      await saveServiceArea(payload, !editingArea, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });

      setSuccessMsg(`Area "${payload.name}" berhasil ${editingArea ? 'diperbarui' : 'ditambahkan'}.`);
      setIsModalOpen(false);
      await loadAllData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Save area error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan data area.');
    } finally {
      setSavingArea(false);
    }
  };

  const handleToggleStatus = async (area: ServiceArea) => {
    if (isReadOnly) return;
    try {
      const newStatus = await toggleServiceAreaStatus(area, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg(`Status area "${area.name}" diubah menjadi ${newStatus}.`);
      await loadAllData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengubah status area.');
    }
  };

  const handleDelete = async (area: ServiceArea) => {
    if (isReadOnly) return;
    const confirm = window.confirm(
      `Apakah Anda yakin ingin menghapus Area "${area.name}" (${area.kecamatan})? Tindakan ini tidak dapat dibatalkan.`
    );
    if (!confirm) return;

    try {
      await deleteServiceArea(area.id, area.name, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg(`Area "${area.name}" berhasil dihapus.`);
      await loadAllData();
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus area.');
    }
  };

  // Tier Distance handlers
  const handleUpdateTierFee = (index: number, newFee: number) => {
    const updated = [...radiusTiers];
    updated[index] = { ...updated[index], fee: Math.max(0, newFee) };
    setRadiusTiers(updated);
  };

  const handleToggleConfirmation = (index: number) => {
    const updated = [...radiusTiers];
    updated[index] = {
      ...updated[index],
      requiresConfirmation: !updated[index].requiresConfirmation,
    };
    setRadiusTiers(updated);
  };

  const handleSaveTierConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setSavingConfig(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await saveAreaMasterConfig(areaConfig, radiusTiers, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg('Konfigurasi radius & tarif cadangan berhasil disimpan.');
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi radius.');
    } finally {
      setSavingConfig(false);
    }
  };

  // Filtered areas
  const filteredAreas = areas.filter((a) => {
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        (a.name || '').toLowerCase().includes(q) ||
        (a.kecamatan || '').toLowerCase().includes(q) ||
        (a.city && a.city.toLowerCase().includes(q))
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
        <div className="inline-block animate-spin w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full mb-2"></div>
        <p className="text-sm font-medium">Memuat Master Data Area Layanan & Tarif...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/40 via-white to-slate-50/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-700 flex items-center justify-center font-bold">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-slate-900">Master Data Area Layanan & Home Service</h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                Palembang Hub
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Kelola wilayah jangkauan resmi, kecamatan, status layanan, dan tarif biaya Home Service
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" />
            Manager Master Authority
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 bg-slate-50/50 px-6">
        <button
          type="button"
          onClick={() => setActiveTab('areas')}
          className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'areas'
              ? 'border-amber-600 text-amber-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Daftar Area Layanan ({areas.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('radius_tiers')}
          className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'radius_tiers'
              ? 'border-amber-600 text-amber-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Compass className="w-4 h-4" />
          Tarif Berdasarkan Radius GPS & Titik Hub
        </button>
      </div>

      {/* Success / Error Messages */}
      {successMsg && (
        <div className="m-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="m-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* TAB 1: AREA MASTER LIST */}
      {activeTab === 'areas' && (
        <div className="p-6">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari nama area atau kecamatan..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50/50"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="text-xs py-2 px-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">Semua Status</option>
                <option value="ACTIVE">Hanya Aktif</option>
                <option value="INACTIVE">Hanya Nonaktif</option>
              </select>
            </div>

            {!isReadOnly && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm transition cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Tambah Area
              </button>
            )}
          </div>

          {/* Empty State when no areas exist */}
          {areas.length === 0 ? (
            <div className="text-center py-16 px-4 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3">
                <MapPin className="w-7 h-7 opacity-80" />
              </div>
              <h4 className="text-base font-bold text-slate-900 mb-1">Belum ada area layanan.</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-5">
                Manager dapat mendaftarkan wilayah layanan resmi Senzu Home secara manual beserta tarif Home Service untuk setiap area.
              </p>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs inline-flex items-center gap-2 shadow-sm transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Tambah Area
                </button>
              )}
            </div>
          ) : filteredAreas.length === 0 ? (
            <div className="text-center py-12 text-slate-500 bg-slate-50 rounded-xl">
              <p className="text-xs">Tidak ditemukan area layanan yang cocok dengan pencarian.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Area & ID</th>
                    <th className="py-3 px-4">Kecamatan</th>
                    <th className="py-3 px-4">Kota & Provinsi</th>
                    <th className="py-3 px-4">Biaya Home Service</th>
                    <th className="py-3 px-4">Status Layanan</th>
                    <th className="py-3 px-4">Terakhir Diperbarui</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(filteredAreas || []).map((area) => {
                    const feeDisplay = area.homeServiceFee !== undefined
                      ? (area.homeServiceFee === 0
                          ? 'Gratis (Rp0)'
                          : `Rp ${area.homeServiceFee.toLocaleString('id-ID')}`)
                      : 'Biaya Home Service belum diatur.';

                    return (
                      <tr
                        key={area.id}
                        className={`hover:bg-slate-50/80 transition ${
                          area.status === 'INACTIVE' ? 'opacity-60 bg-slate-50/40' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 text-sm">{area.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">ID: {area.id}</div>
                          {area.internalNote && (
                            <div className="text-[11px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                              Catatan: {area.internalNote}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-800">{area.kecamatan}</span>
                        </td>

                        <td className="py-3 px-4">
                          <div className="text-slate-700 font-medium">{area.city || 'PALEMBANG'}</div>
                          <div className="text-[10px] text-slate-400">{area.province || 'SUMATERA SELATAN'}</div>
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`font-bold px-2 py-0.5 rounded text-xs inline-block ${
                              area.homeServiceFee === 0
                                ? 'bg-emerald-100 text-emerald-800'
                                : area.homeServiceFee !== undefined
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-slate-100 text-slate-600 font-normal italic'
                            }`}
                          >
                            {feeDisplay}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1">
                            <span
                              className={`inline-flex items-center gap-1 font-bold text-[11px] px-2 py-0.5 rounded-full w-fit ${
                                area.status === 'ACTIVE'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  area.status === 'ACTIVE' ? 'bg-emerald-600' : 'bg-slate-400'
                                }`}
                              />
                              {area.status === 'ACTIVE' ? 'AKTIF' : 'NONAKTIF'}
                            </span>
                            {area.homeServiceEnabled ? (
                              <span className="text-[10px] text-emerald-600 font-medium">
                                ✓ Home Service Aktif
                              </span>
                            ) : (
                              <span className="text-[10px] text-red-500 font-medium">
                                ✗ Home Service Tutup
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="text-slate-600">
                            {area.updatedAt
                              ? new Date(area.updatedAt).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : '-'}
                          </div>
                          <div className="text-[10px] text-slate-400">Oleh: {area.updatedBy || 'Manager'}</div>
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!isReadOnly ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleStatus(area)}
                                  title={area.status === 'ACTIVE' ? 'Nonaktifkan Area' : 'Aktifkan Area'}
                                  className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                                    area.status === 'ACTIVE'
                                      ? 'border-slate-200 text-slate-600 hover:bg-slate-100'
                                      : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  }`}
                                >
                                  {area.status === 'ACTIVE' ? (
                                    <>
                                      <ToggleRight className="w-4 h-4 text-emerald-600" />
                                      <span className="hidden lg:inline">Nonaktifkan</span>
                                    </>
                                  ) : (
                                    <>
                                      <ToggleLeft className="w-4 h-4 text-slate-400" />
                                      <span className="hidden lg:inline">Aktifkan</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(area)}
                                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                                  title="Edit Area"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  <span className="hidden lg:inline">Edit</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDelete(area)}
                                  className="p-1.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50 text-xs transition cursor-pointer"
                                  title="Hapus Area"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">Hanya Lihat</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RADIUS TIERS & BASE COORDINATES */}
      {activeTab === 'radius_tiers' && (
        <form onSubmit={handleSaveTierConfig} className="p-6 space-y-6">
          <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200/80 flex items-start gap-3">
            <Compass className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-bold">Skema Penentuan Tarif Home Service:</p>
              <p>
                1. Jika alamat pemesanan cocok dengan <strong>Master Data Area</strong> di tab sebelah, tarif area tersebut akan langsung digunakan.
              </p>
              <p>
                2. Jika alamat belum terdaftar di Master Area, sistem menggunakan <strong>Jarak Radius GPS</strong> dari titik pusat Senzu Palembang di bawah ini.
              </p>
            </div>
          </div>

          {/* Base Hub Location */}
          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-amber-600" />
              Titik Pusat Hub Operasional (Base Location)
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="sm:col-span-3">
                <label className="block text-xs font-bold text-slate-700 mb-1">Nama Lokasi Titik Pusat</label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={areaConfig.baseLocationName ?? ''}
                  onChange={(e) => setAreaConfig({ ...areaConfig, baseLocationName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  disabled={isReadOnly}
                  value={areaConfig.baseLatitude ?? 0}
                  onChange={(e) => setAreaConfig({ ...areaConfig, baseLatitude: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  disabled={isReadOnly}
                  value={areaConfig.baseLongitude ?? 0}
                  onChange={(e) => setAreaConfig({ ...areaConfig, baseLongitude: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tarif Standar Cadangan (Rp)</label>
                <input
                  type="number"
                  step="5000"
                  disabled={isReadOnly}
                  value={areaConfig.fallbackHomeServiceFee ?? 0}
                  onChange={(e) => setAreaConfig({ ...areaConfig, fallbackHomeServiceFee: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-amber-900 disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Tier Radius Table */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-amber-600" />
              Tingkat Radius Jarak (Radius Tiers)
            </h4>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px]">
                    <th className="py-2.5 px-4">Nama Zona Jarak</th>
                    <th className="py-2.5 px-4">Jarak Min (km)</th>
                    <th className="py-2.5 px-4">Jarak Max (km)</th>
                    <th className="py-2.5 px-4">Tarif Tambahan (Rp)</th>
                    <th className="py-2.5 px-4 text-center">Wajib Konfirmasi CS?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(radiusTiers || []).map((tier, idx) => (
                    <tr key={tier.id || idx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-bold text-slate-800">{tier.label || (tier as any).name}</td>
                      <td className="py-2.5 px-4 font-mono">{tier.minKm} km</td>
                      <td className="py-2.5 px-4 font-mono">{tier.maxKm ? `${tier.maxKm} km` : 'Tanpa Batas'}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 text-xs">Rp</span>
                          <input
                            type="number"
                            step="5000"
                            disabled={isReadOnly}
                            value={tier.fee ?? 0}
                            onChange={(e) => handleUpdateTierFee(idx, parseInt(e.target.value, 10) || 0)}
                            className="w-28 px-2 py-1 rounded border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                          />
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <input
                          type="checkbox"
                          disabled={isReadOnly}
                          checked={tier.requiresConfirmation || false}
                          onChange={() => handleToggleConfirmation(idx)}
                          className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!isReadOnly && (
            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={savingConfig}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                {savingConfig ? 'Menyimpan Pengaturan...' : 'Simpan Pengaturan Radius'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* Modal Add / Edit Service Area */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 my-8">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                  <MapPin className="w-4 h-4" />
                </div>
                <h4 className="text-base font-bold text-slate-900">
                  {editingArea ? 'Edit Master Area Layanan' : 'Tambah Master Area Layanan Baru'}
                </h4>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                {modalForm.id}
              </span>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nama Area / Wilayah <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Ilir Barat I / Demang Daun"
                    value={modalForm.name ?? ''}
                    onChange={(e) => setModalForm({ ...modalForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Kecamatan <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Ilir Barat I"
                    value={modalForm.kecamatan ?? ''}
                    onChange={(e) => setModalForm({ ...modalForm, kecamatan: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Kota</label>
                  <input
                    type="text"
                    required
                    value={modalForm.city ?? ''}
                    onChange={(e) => setModalForm({ ...modalForm, city: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Provinsi</label>
                  <input
                    type="text"
                    required
                    value={modalForm.province ?? ''}
                    onChange={(e) => setModalForm({ ...modalForm, province: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none uppercase"
                  />
                </div>
              </div>

              {/* Home Service Fee & Status */}
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Pengaturan Biaya Home Service</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(modalForm.homeServiceEnabled)}
                      onChange={(e) => setModalForm({ ...modalForm, homeServiceEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                    <span className="ml-2 text-xs font-semibold text-slate-700">
                      {modalForm.homeServiceEnabled ? 'Layanan Tersedia' : 'Layanan Ditutup'}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Biaya Home Service (Rupiah Angka)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                        Rp
                      </span>
                      <input
                        type="text"
                        placeholder="Contoh: 25000 (Kosongkan jika belum diatur)"
                        value={modalForm.homeServiceFeeInput ?? ''}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '');
                          setModalForm({ ...modalForm, homeServiceFeeInput: clean });
                        }}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Ketik <strong>0</strong> untuk Gratis (Rp0). Kosongkan jika biaya belum diatur.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Status Area</label>
                    <select
                      value={modalForm.status || 'ACTIVE'}
                      onChange={(e) => setModalForm({ ...modalForm, status: e.target.value as ServiceAreaStatus })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    >
                      <option value="ACTIVE">ACTIVE (Dapat Dipilih Pelanggan)</option>
                      <option value="INACTIVE">INACTIVE (Nonaktif Sementara)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Optional Parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Minimal Order (Rp, opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: 100000"
                    value={modalForm.minimumOrderInput ?? ''}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '');
                      setModalForm({ ...modalForm, minimumOrderInput: clean });
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Maksimal Jarak (km, opsional)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Contoh: 15"
                    value={modalForm.maximumDistanceInput ?? ''}
                    onChange={(e) => setModalForm({ ...modalForm, maximumDistanceInput: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Urutan Tampil (Sort Order)</label>
                  <input
                    type="number"
                    value={modalForm.sortOrder ?? 1}
                    onChange={(e) => setModalForm({ ...modalForm, sortOrder: parseInt(e.target.value, 10) || 1 })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Catatan Internal (Opsional)</label>
                <textarea
                  rows={2}
                  placeholder="Contoh: Akses via Jembatan Musi IV, jalan sering padat sore hari..."
                  value={modalForm.internalNote ?? ''}
                  onChange={(e) => setModalForm({ ...modalForm, internalNote: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingArea}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingArea ? 'Menyimpan...' : 'Simpan Area'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
