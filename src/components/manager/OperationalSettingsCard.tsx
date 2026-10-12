import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Clock,
  Compass,
  AlertTriangle,
  Bell,
  CheckCircle2,
  AlertCircle,
  Save,
  Shield,
  RotateCcw,
  Info,
  Navigation,
  Activity,
  Flame,
  Star,
  DollarSign,
  Tag,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { OperationalSettings, StaffUser } from '../../types';
import {
  getOperationalSettings,
  updateOperationalSettings,
  DEFAULT_OPERATIONAL_SETTINGS,
} from '../../lib/masterDataService';
import { isValidTimeFormat } from '../../lib/masterDataUtils';
import { formatRupiah } from '../../lib/utils';

interface OperationalSettingsCardProps {
  currentUser: StaffUser;
  onRefresh?: () => void;
  isReadOnly?: boolean;
}

type SettingsSection = 'booking' | 'assignment' | 'tracking' | 'sla' | 'notifications';

export const OperationalSettingsCard: React.FC<OperationalSettingsCardProps> = ({
  currentUser,
  onRefresh,
  isReadOnly = false,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SettingsSection>('booking');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [settings, setSettings] = useState<OperationalSettings>(DEFAULT_OPERATIONAL_SETTINGS);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getOperationalSettings();
      setSettings(data);
    } catch (err: any) {
      console.error('Gagal memuat operational settings:', err);
      setErrorMsg('Gagal memuat konfigurasi operasional dari server.');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = <K extends keyof OperationalSettings>(
    key: K,
    value: OperationalSettings[K]
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setErrorMsg('');
    setSuccessMsg('');

    // Validations
    if (!isValidTimeFormat(settings.operatingHoursStart) || !isValidTimeFormat(settings.operatingHoursEnd)) {
      setErrorMsg('Jam operasional harus berformat HH:mm (contoh: 10:00 - 22:00).');
      return;
    }

    setSaving(true);
    try {
      await updateOperationalSettings(settings, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });

      setSuccessMsg('Konfigurasi operasional berhasil disimpan & disinkronkan ke seluruh sistem!');
      if (onRefresh) onRefresh();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error('Error updateOperationalSettings:', err);
      setErrorMsg(err.message || 'Gagal menyimpan konfigurasi operasional.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = () => {
    if (isReadOnly) return;
    if (window.confirm('Kembalikan seluruh parameter operasional ke standar operasional Senzu Home Palembang?')) {
      setSettings({
        ...DEFAULT_OPERATIONAL_SETTINGS,
      });
      setSuccessMsg('Formulir direset ke standar operasional Senzu. Klik "Simpan Perubahan" untuk menerapkan.');
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-12 text-center shadow-sm">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mb-3" />
        <p className="text-stone-600 text-sm">Memuat konfigurasi operasional Senzu Home...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
      {/* Header Banner */}
      <div className="p-6 bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
              Manager Master Data
            </span>
            {isReadOnly ? (
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Read-Only
              </span>
            ) : (
              <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Manager Control (RW)
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold mt-1 text-white flex items-center gap-2">
            <Sliders className="w-5 h-5 text-amber-400" />
            Operational & Business Settings
          </h2>
          <p className="text-stone-300 text-xs mt-1 max-w-2xl">
            Pusat kendali seluruh aturan bisnis, ambang batas GPS & tracking, parameter SLA alert Supervisor,
            serta otomatisasi notifikasi operasional layanan Senzu Home.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isReadOnly && (
            <button
              type="button"
              onClick={handleResetToDefaults}
              className="px-3 py-2 text-xs font-medium text-stone-300 bg-stone-800/80 hover:bg-stone-700 hover:text-white rounded-lg border border-stone-700 transition-colors flex items-center gap-1.5"
              title="Kembalikan ke standar default"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Default
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || isReadOnly}
            className={`px-4 py-2 text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2 ${
              isReadOnly
                ? 'bg-stone-700 text-stone-400 cursor-not-allowed'
                : saving
                ? 'bg-amber-700 text-white cursor-wait'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>

      {/* Alert Notices */}
      {successMsg && (
        <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm flex items-center gap-2 animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {isReadOnly && (
        <div className="mx-6 mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Mode Baca Saja (Read-Only) — Konfigurasi operasional dikelola terpusat oleh Manager. Supervisor, CSS, dan Terapis mengonsumsi parameter ini secara langsung.
          </span>
        </div>
      )}

      {/* Navigation Subtabs */}
      <div className="border-b border-stone-200 px-6 bg-stone-50/50 flex flex-wrap gap-1 pt-3">
        <button
          type="button"
          onClick={() => setActiveSubTab('booking')}
          className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
            activeSubTab === 'booking'
              ? 'bg-white border-amber-600 text-amber-900 shadow-sm'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          Aturan Booking & Slot
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('assignment')}
          className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
            activeSubTab === 'assignment'
              ? 'bg-white border-amber-600 text-amber-900 shadow-sm'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-amber-600" />
          Penugasan & Perjalanan
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('tracking')}
          className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
            activeSubTab === 'tracking'
              ? 'bg-white border-amber-600 text-amber-900 shadow-sm'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
          }`}
        >
          <Navigation className="w-3.5 h-3.5 text-amber-600" />
          GPS & Pelacakan Lapangan
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('sla')}
          className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
            activeSubTab === 'sla'
              ? 'bg-white border-amber-600 text-amber-900 shadow-sm'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
          }`}
        >
          <Flame className="w-3.5 h-3.5 text-amber-600" />
          SLA & Supervisor Alerts
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('notifications')}
          className={`px-3.5 py-2.5 text-xs font-semibold rounded-t-lg transition-all flex items-center gap-2 border-b-2 ${
            activeSubTab === 'notifications'
              ? 'bg-white border-amber-600 text-amber-900 shadow-sm'
              : 'border-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100/60'
          }`}
        >
          <Bell className="w-3.5 h-3.5 text-amber-600" />
          Aturan Notifikasi
        </button>
      </div>

      {/* Tab Content */}
      <form onSubmit={handleSave} className="p-6">
        {/* SUBTAB 1: BOOKING RULES */}
        {activeSubTab === 'booking' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                Ketentuan Jam Layanan & Interval Slot Reservasi
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Konfigurasi batas jam layanan, interval waktu antar slot pemesanan, dan batas hari reservasi ke depan.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Jam Buka Operasional (WIB)
                </label>
                <input
                  type="time"
                  disabled={isReadOnly}
                  value={settings.operatingHoursStart}
                  onChange={(e) => handleFieldChange('operatingHoursStart', e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-stone-100"
                  required
                />
                <span className="text-[10px] text-stone-400 mt-1 block">Standar Senzu: 10:00</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Jam Tutup Operasional (WIB)
                </label>
                <input
                  type="time"
                  disabled={isReadOnly}
                  value={settings.operatingHoursEnd}
                  onChange={(e) => handleFieldChange('operatingHoursEnd', e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-stone-100"
                  required
                />
                <span className="text-[10px] text-stone-400 mt-1 block">Standar Senzu: 22:00</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Interval Pembagian Jam Slot
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={15}
                    disabled={isReadOnly}
                    value={settings.slotIntervalMinutes ?? ''}
                    onChange={(e) => handleFieldChange('slotIntervalMinutes', parseInt(e.target.value, 10) || 30)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Jarak antar pilihan slot waktu reservasi pelanggan (default 30 mnt).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Minimum Waktu Pemesanan (Lead Time)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={360}
                    step={5}
                    disabled={isReadOnly}
                    value={settings.leadTimeMinutes ?? ''}
                    onChange={(e) => handleFieldChange('leadTimeMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Lead time sebelum sesi dimulai (default 60 mnt).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Maksimal Hari Pemesanan ke Depan
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    disabled={isReadOnly}
                    value={settings.maxAdvanceDays ?? ''}
                    onChange={(e) => handleFieldChange('maxAdvanceDays', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Hari</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Batas kalender booking yang dapat dipilih pelanggan (default 14 hari).
                </span>
              </div>
            </div>

            {/* Optional Business Rules: Cancellation Cutoff, Min/Max Order */}
            <div className="pt-2 border-t border-stone-100 space-y-3">
              <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-amber-600" />
                Ketentuan Khusus & Pembatasan Order (Opsional)
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Cancellation Cutoff Hours */}
                <div className="bg-stone-50 p-3 rounded-lg border border-stone-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-stone-700">
                      Batas Tenggat Pembatalan
                    </label>
                    {settings.cancellationCutoffHours != null ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                        Aktif
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-200 text-stone-600">
                        Belum Diatur
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={48}
                      disabled={isReadOnly}
                      placeholder="Belum Diatur"
                      value={settings.cancellationCutoffHours ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                        handleFieldChange('cancellationCutoffHours', val);
                      }}
                      className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Jam</span>
                  </div>
                  <span className="text-[10px] text-stone-400 mt-1 block">
                    Batas minimal pembatalan sebelum jadwal dimulai (kosongkan jika belum ada aturan).
                  </span>
                </div>

                {/* Min Order Amount */}
                <div className="bg-stone-50 p-3 rounded-lg border border-stone-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-stone-700">
                      Minimum Transaksi per Order
                    </label>
                    {settings.minOrderAmount != null && settings.minOrderAmount > 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                        {formatRupiah(settings.minOrderAmount)}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-200 text-stone-600">
                        Belum Diatur
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={10000}
                      disabled={isReadOnly}
                      placeholder="Belum Diatur"
                      value={settings.minOrderAmount ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                        handleFieldChange('minOrderAmount', val);
                      }}
                      className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Rp</span>
                  </div>
                  <span className="text-[10px] text-stone-400 mt-1 block">
                    Batas minimum pembelanjaan paket (kosongkan jika tanpa minimum order).
                  </span>
                </div>

                {/* Max Order Amount */}
                <div className="bg-stone-50 p-3 rounded-lg border border-stone-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-stone-700">
                      Maksimum Transaksi per Order
                    </label>
                    {settings.maxOrderAmount != null && settings.maxOrderAmount > 0 ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                        {formatRupiah(settings.maxOrderAmount)}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-200 text-stone-600">
                        Belum Diatur
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      step={100000}
                      disabled={isReadOnly}
                      placeholder="Belum Diatur"
                      value={settings.maxOrderAmount ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                        handleFieldChange('maxOrderAmount', val);
                      }}
                      className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                    />
                    <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Rp</span>
                  </div>
                  <span className="text-[10px] text-stone-400 mt-1 block">
                    Batas atas total nominal transaksi (kosongkan jika tanpa limit).
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: ASSIGNMENT & TRANSIT */}
        {activeSubTab === 'assignment' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Compass className="w-4 h-4 text-amber-600" />
                Aturan Penugasan, Buffer Perjalanan, & Ketepatan Jadwal
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Konfigurasi ini dikonsumsi langsung oleh Roster Scheduling Engine dan Rekomendasi Terapis saat pesanan dialokasikan.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Buffer Perjalanan Minimum Antar Pesanan
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={5}
                    disabled={isReadOnly}
                    value={settings.travelBufferMinutes ?? ''}
                    onChange={(e) => handleFieldChange('travelBufferMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Waktu minimal jeda istirahat/perjalanan antar 2 order berturut-turut (default 15 mnt).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Kecepatan Rata-rata Transit Urban
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={10}
                    max={60}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.transitSpeedKmH ?? ''}
                    onChange={(e) => handleFieldChange('transitSpeedKmH', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">km/jam</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Estimasi kecepatan berkendara di Kota Palembang (default 25 km/jam).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Buffer Parkir & Persiapan Masuk
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.parkingStagingBufferMinutes ?? ''}
                    onChange={(e) => handleFieldChange('parkingStagingBufferMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Waktu tambahan untuk mencari alamat, parkir, dan registrasi rumah (default 10 mnt).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Alert Order Lunas Belum Ditugaskan
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={360}
                    step={15}
                    disabled={isReadOnly}
                    value={settings.unassignedAlertMinutes ?? ''}
                    onChange={(e) => handleFieldChange('unassignedAlertMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Alert Supervisor jika pesanan lunas belum memiliki terapis saat waktu menuju jadwal &le; batas ini (default 90 mnt).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Batas Waktu Konfirmasi Terapis
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={2}
                    max={60}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.therapistAcceptanceTimeoutMinutes ?? ''}
                    onChange={(e) => handleFieldChange('therapistAcceptanceTimeoutMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Waktu toleransi terapis untuk menekan tombol terima penugasan (default 10 mnt).
                </span>
              </div>

              <div className="bg-stone-50 p-3 rounded-lg border border-stone-200">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-stone-700">
                    Auto Reassign Timeout
                  </label>
                  {settings.autoReassignTimeoutMinutes != null && settings.autoReassignTimeoutMinutes > 0 ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                      {settings.autoReassignTimeoutMinutes} mnt
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-200 text-stone-600">
                      Belum Diatur
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={5}
                    disabled={isReadOnly}
                    placeholder="Belum Diatur"
                    value={settings.autoReassignTimeoutMinutes ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                      handleFieldChange('autoReassignTimeoutMinutes', val);
                    }}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-400 mt-1 block">
                  Alihkan otomatis ke terapis cadangan jika tidak ada konfirmasi (kosongkan jika manual).
                </span>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 3: GPS & TRACKING */}
        {activeSubTab === 'tracking' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-amber-600" />
                Ambang Batas GPS, Tracking Lapangan, & Radius Kedatangan
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Mengatur frekuensi pembaharuan lokasi terapis, deteksi kehilangan sinyal GPS di Supervisor Control Room, dan deteksi "Terapis Mendekat" di Live Map Pelanggan.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Interval Broadcast Lokasi GPS Terapis
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={5}
                    max={120}
                    step={5}
                    disabled={isReadOnly}
                    value={settings.locationUpdateIntervalSeconds ?? ''}
                    onChange={(e) => handleFieldChange('locationUpdateIntervalSeconds', parseInt(e.target.value, 10) || 15)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Detik</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Frekuensi pengiriman koordinat terapis ke server saat menuju lokasi customer (default 15s).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Ambang GPS Warning (Stale GPS)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={15}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.gpsStaleMinutes ?? ''}
                    onChange={(e) => handleFieldChange('gpsStaleMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Peringatan kuning di Control Room jika GPS terhenti sejenak (default 3 mnt).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Ambang Kritis GPS Hilang Sinyal (Critical GPS)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={3}
                    max={30}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.gpsCriticalStaleMinutes ?? ''}
                    onChange={(e) => handleFieldChange('gpsCriticalStaleMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold text-rose-600"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Alert merah darurat di Control Room jika sinyal GPS terputus total (default 8 mnt).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Radius Geofence "Terapis Mendekat"
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0.2}
                    max={5.0}
                    step={0.1}
                    disabled={isReadOnly}
                    value={settings.nearbyDistanceKm ?? ''}
                    onChange={(e) => handleFieldChange('nearbyDistanceKm', parseFloat(e.target.value) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">km</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Jarak radius untuk memicu status "Terapis Mendekat" di Live Map Pelanggan (default 1.0 km).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Estimasi Waktu Tempuh Status Mendekat (ETA Nearby)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.nearbyEtaMinutes ?? ''}
                    onChange={(e) => handleFieldChange('nearbyEtaMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Batas estimasi menit rute untuk memicu status dekat di aplikasi (default 5 mnt).
                </span>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 4: SLA & SUPERVISOR ALERTS */}
        {activeSubTab === 'sla' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-600" />
                Ambang Batas SLA Operasional, Antrean CSS, & Alerts
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Mengatur batas eskalasi pembayaran, antrean customer tak merespon, pemulihan komplain rating rendah, dan toleransi keterlambatan.
              </p>
            </div>

            {/* Global Alert Toggle */}
            <div className="bg-amber-50/70 p-3.5 rounded-lg border border-amber-200 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-amber-600" />
                  Sistem Real-Time Alert Supervisor Control Room
                </h4>
                <p className="text-[11px] text-stone-600 mt-0.5">
                  Aktifkan pemindaian otomatis status keterlambatan, GPS hilang, pembayaran mendesak, dan kendala darurat lapangan.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isReadOnly}
                  checked={settings.supervisorAlertsEnabled}
                  onChange={(e) => handleFieldChange('supervisorAlertsEnabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  SLA Verifikasi Pembayaran (Warning Window)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={240}
                    step={15}
                    disabled={isReadOnly}
                    value={settings.paymentVerificationSlaMinutes ?? ''}
                    onChange={(e) => handleFieldChange('paymentVerificationSlaMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Pesanan belum bayar mendekati jadwal (default 120 mnt / 2 jam sebelum sesi).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  SLA Kritis Pembayaran (Critical Expire)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={10}
                    max={60}
                    step={5}
                    disabled={isReadOnly}
                    value={settings.paymentUrgentSlaMinutes ?? ''}
                    onChange={(e) => handleFieldChange('paymentUrgentSlaMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Prioritas CRITICAL di antrean CSS agar slot terapis dapat segera dibebaskan (default 30 mnt).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Toleransi Terlambat Berangkat (Late Departure Buffer)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={5}
                    disabled={isReadOnly}
                    value={settings.lateDepartureBufferMinutes ?? ''}
                    onChange={(e) => handleFieldChange('lateDepartureBufferMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Ambang batas jika terapis belum menekan "Berangkat" sebelum jadwal dikurangi waktu tempuh (default 35 mnt).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Toleransi Overrun Durasi Treatment
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={5}
                    max={45}
                    step={5}
                    disabled={isReadOnly}
                    value={settings.treatmentOvertimeBufferMinutes ?? ''}
                    onChange={(e) => handleFieldChange('treatmentOvertimeBufferMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Alert jika sesi pijat belum diselesaikan setelah durasi pesanan + toleransi habis (default 15 mnt).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-stone-100">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  Ambang Ulasan Rendah (Service Recovery)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={4}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.lowRatingThreshold ?? ''}
                    onChange={(e) => handleFieldChange('lowRatingThreshold', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100 font-semibold"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Bintang</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Ulasan dengan nilai &le; batas ini otomatis masuk antrean pemulihan kepuasan CSS (default &le; 2 bintang).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Maksimal Percobaan Kontak Pelanggan
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    disabled={isReadOnly}
                    value={settings.maxUnreachableAttempts ?? ''}
                    onChange={(e) => handleFieldChange('maxUnreachableAttempts', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Kali</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Batas percobaan sebelum status ditingkatkan menjadi "Customer Tidak Merespon Kritis" (default 3x).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Jeda Percobaan Kontak Ulang
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={180}
                    step={15}
                    disabled={isReadOnly}
                    value={settings.unreachableRetryIntervalMinutes ?? ''}
                    onChange={(e) => handleFieldChange('unreachableRetryIntervalMinutes', parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Jarak jeda waktu sebelum CSS mengontak ulang pelanggan yang tak merespon (default 60 mnt).
                </span>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 5: NOTIFICATION RULES */}
        {activeSubTab === 'notifications' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-600" />
                Matriks Pemicu Notifikasi Otomatis (Lifecycle Triggers)
              </h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Konfigurasi pemicu sistem otomatis yang mengirimkan notifikasi WhatsApp / Dashboard saat status operasional berubah.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Pengingat Otomatis Sebelum Sesi (Reminder)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={15}
                    max={360}
                    step={15}
                    disabled={isReadOnly}
                    value={settings.reminderMinutesBeforeSchedule ?? ''}
                    onChange={(e) => handleFieldChange('reminderMinutesBeforeSchedule', parseInt(e.target.value, 10) || 60)}
                    className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none pr-14 disabled:bg-stone-100"
                  />
                  <span className="absolute right-3 top-2 text-xs text-stone-400 font-medium">Menit</span>
                </div>
                <span className="text-[10px] text-stone-500 mt-1 block">
                  Kirim pengingat WhatsApp ke customer sebelum terapis meluncur (default 60 mnt).
                </span>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-stone-900">
                    Kirim Notifikasi ke Pelanggan (Global)
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Mengizinkan sistem mengirim status WhatsApp ke nomor pelanggan.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={settings.customerNotificationsEnabled}
                    onChange={(e) => handleFieldChange('customerNotificationsEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-stone-100">
              <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-stone-900">
                    Notifikasi Konfirmasi Reservasi Diterima
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Kirim konfirmasi reservasi & instruksi pembayaran saat pesanan baru berhasil dibuat.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={settings.whatsappConfirmationEnabled}
                    onChange={(e) => handleFieldChange('whatsappConfirmationEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-stone-900">
                    Notifikasi Terapis Meluncur (On The Way) & Link Live Map
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Kirim notifikasi estimasi tiba dan tautan pelacakan GPS langsung ke WhatsApp pelanggan.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={settings.whatsappOnTheWayEnabled}
                    onChange={(e) => handleFieldChange('whatsappOnTheWayEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-stone-900">
                    Notifikasi Terapis Sudah Dekat Lokasi (&le; {settings.nearbyDistanceKm} km)
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Beri tahu pelanggan untuk bersiap karena terapis berada dalam radius dekat kedatangan.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={settings.whatsappNearbyEnabled}
                    onChange={(e) => handleFieldChange('whatsappNearbyEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-stone-900">
                    Notifikasi Layanan Selesai & Permintaan Ulasan (Feedback)
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Kirim ucapan terima kasih dan tautan pemberian rating setelah treatment selesai dikerjakan.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isReadOnly}
                    checked={settings.whatsappCompletedEnabled}
                    onChange={(e) => handleFieldChange('whatsappCompletedEnabled', e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Action Footer */}
        <div className="mt-8 pt-4 border-t border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-stone-500">
            Terakhir diperbarui:{' '}
            <span className="font-medium text-stone-700">
              {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString('id-ID') : 'Belum Pernah Disimpan'}
            </span>
            {settings.updatedBy && (
              <span> oleh <strong className="text-stone-800">{settings.updatedBy}</strong></span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleResetToDefaults}
                className="px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg border border-stone-300 transition-colors w-full sm:w-auto"
              >
                Reset Default
              </button>
            )}
            <button
              type="submit"
              disabled={saving || isReadOnly}
              className={`px-5 py-2 text-xs font-bold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 w-full sm:w-auto ${
                isReadOnly
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  : saving
                  ? 'bg-amber-700 text-white cursor-wait'
                  : 'bg-amber-600 hover:bg-amber-700 text-white'
              }`}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan...' : 'Simpan Seluruh Pengaturan Operasional'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
