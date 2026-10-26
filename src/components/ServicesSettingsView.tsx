import React, { useState } from 'react';
import { Settings, Save, CheckCircle2, DollarSign, Plus, Edit2, Sparkles, Shield } from 'lucide-react';
import { AppSettings, ServiceItem } from '../types';
import { updateSettings, saveService } from '../lib/dbService';
import { formatRupiah } from '../lib/utils';

interface ServicesSettingsViewProps {
  settings?: AppSettings;
  services: ServiceItem[];
  onRefresh: () => void;
}

export const ServicesSettingsView: React.FC<ServicesSettingsViewProps> = ({
  settings,
  services = [],
  onRefresh,
}) => {
  const [fee, setFee] = useState(settings?.homeServiceFee || 50000);
  const [baseLocationName, setBaseLocationName] = useState(
    settings?.baseLocationName || 'Senzu Reflexology Palembang (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)'
  );
  const [baseLatitude, setBaseLatitude] = useState(settings?.baseLatitude ?? -2.9859024);
  const [baseLongitude, setBaseLongitude] = useState(settings?.baseLongitude ?? 104.7385997);
  const [bankName, setBankName] = useState(settings?.bankName || 'BCA (Bank Central Asia)');
  const [bankAccount, setBankAccount] = useState(settings?.bankAccount || '021-8899-721');
  const [bankHolder, setBankHolder] = useState(settings?.bankHolder || 'PT SENZU WELLNESS PALEMBANG');
  const [qrisInstruction, setQrisInstruction] = useState(
    settings?.qrisInstruction ||
      'Scan QRIS Senzu Home melalui BCA Mobile, Livin, GoPay, OVO, ShopeePay, atau DANA.'
  );

  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Edit service modal/state
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  const [editPrice, setEditPrice] = useState<number>(0);
  const [editDuration, setEditDuration] = useState<number>(0);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await updateSettings({
        homeServiceFee: Number(fee),
        baseLocationName,
        baseLatitude: Number(baseLatitude),
        baseLongitude: Number(baseLongitude),
        bankName,
        bankAccount,
        bankHolder,
        qrisInstruction,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleOpenEditService = (srv: ServiceItem) => {
    setEditingService(srv);
    setEditPrice(srv.price);
    setEditDuration(srv.duration);
  };

  const handleSaveEditedService = async () => {
    if (!editingService) return;
    try {
      await saveService({
        ...editingService,
        price: Number(editPrice),
        duration: Number(editDuration),
      });
      setEditingService(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold font-serif text-[#4B2B18] flex items-center gap-2">
          <Settings className="w-6 h-6 text-[#B89628]" />
          Pengaturan Tarif & Layanan
        </h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Konfigurasi Home Service Fee Palembang, rekening pembayaran, dan katalog layanan
        </p>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs sm:text-sm flex items-center gap-2 animate-fade-in font-medium">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>Pengaturan sistem berhasil disimpan ke Cloud Database!</span>
        </div>
      )}

      {/* Grid Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General Home Service Fee & Banking */}
        <form
          onSubmit={handleSaveSettings}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4 text-xs"
        >
          <div className="text-sm font-bold text-[#4B2B18] border-b border-slate-100 pb-2">
            Konfigurasi Biaya & Pembayaran
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Home Service Fee (Dasar / Tier 1: 0 - 5 km):
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-400 font-bold">Rp</span>
              <input
                type="number"
                value={fee}
                onChange={(e) => setFee(Number(e.target.value))}
                required
                className="w-full pl-10 pr-3 py-2 rounded-xl border border-slate-300 text-sm font-bold text-[#4B2B18] focus:ring-2 focus:ring-[#8B5A36]"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Biaya dasar perjalanan terapis & kit higienis dalam radius 5 km dari hub operasional.
            </p>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="font-bold text-[#4B2B18] text-xs">
              Pusat Operasional Palembang (Base Hub):
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-0.5">Nama Hub:</label>
              <input
                type="text"
                value={baseLocationName}
                onChange={(e) => setBaseLocationName(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-medium text-slate-500">Latitude Hub:</label>
                <input
                  type="number"
                  step="any"
                  value={baseLatitude}
                  onChange={(e) => setBaseLatitude(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-500">Longitude Hub:</label>
                <input
                  type="number"
                  step="any"
                  value={baseLongitude}
                  onChange={(e) => setBaseLongitude(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                />
              </div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200">
              <span className="font-semibold text-slate-700">Skema Tier Radius Palembang:</span>
              <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                <li>0 - 5 km: Biaya Normal (Rp 50.000)</li>
                <li>5 - 10 km: +Rp 15.000 (Rp 65.000)</li>
                <li>10 - 15 km: +Rp 35.000 (Rp 85.000)</li>
                <li>&gt; 15 km: +Rp 70.000 (Perlu Konfirmasi Admin)</li>
              </ul>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nama Bank:</label>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#8B5A36]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nomor Rekening:</label>
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold focus:ring-2 focus:ring-[#8B5A36]"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Atas Nama (Holder):</label>
              <input
                type="text"
                value={bankHolder}
                onChange={(e) => setBankHolder(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#8B5A36]"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Instruksi QRIS:</label>
            <textarea
              rows={2}
              value={qrisInstruction}
              onChange={(e) => setQrisInstruction(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:ring-2 focus:ring-[#8B5A36]"
            />
          </div>

          <button
            type="submit"
            disabled={savingSettings}
            className="w-full py-2.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4 text-[#D4AF37]" />
            <span>{savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
          </button>
        </form>

        {/* Services List Management */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="text-sm font-bold text-[#4B2B18] border-b border-slate-100 pb-2 flex items-center justify-between">
            <span>Katalog Layanan & Harga</span>
            <span className="text-xs text-slate-400 font-normal">Database Firestore</span>
          </div>

          <div className="space-y-3">
            {(services || []).map((srv) => (
              <div
                key={srv.id}
                className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between hover:border-[#8B5A36]/30 transition"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-800">{srv.name}</span>
                    {srv.isPopular && (
                      <span className="text-[9px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5 rounded">
                        Terfavorit
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Durasi: {srv.duration} Menit • Tarif:{' '}
                    <strong className="text-[#4B2B18]">{formatRupiah(srv.price)}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenEditService(srv)}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-[#8B5A36] hover:text-white text-slate-700 text-xs transition"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {editingService && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-300 space-y-3 text-xs">
              <div className="font-bold text-[#4B2B18]">
                Edit: {editingService.name}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">Durasi (Menit):</label>
                  <input
                    type="number"
                    value={editDuration}
                    onChange={(e) => setEditDuration(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-slate-600 mb-1">Tarif (Rp):</label>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingService(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditedService}
                  className="px-3 py-1.5 rounded-lg bg-[#8B5A36] text-white font-bold"
                >
                  Simpan Perubahan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
