import React, { useState, useEffect } from 'react';
import { Bell, MessageSquare, Mail, Phone, CheckCircle2, AlertCircle, Save, Shield, Smartphone } from 'lucide-react';
import { MasterNotificationConfig, StaffUser } from '../../types';
import { getMasterNotificationConfig, saveMasterNotificationConfig } from '../../lib/masterDataService';
import { getWaMeTarget, formatWhatsAppDisplay } from '../../lib/masterDataUtils';

interface NotificationMasterCardProps {
  currentUser: StaffUser;
  onRefresh: () => void;
  isReadOnly?: boolean;
}

export const NotificationMasterCard: React.FC<NotificationMasterCardProps> = ({
  currentUser,
  onRefresh,
  isReadOnly = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<MasterNotificationConfig | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('BOOKING_CONFIRMED');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await getMasterNotificationConfig();
      setConfig(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateChange = (key: string, value: string) => {
    if (!config) return;
    setConfig({
      ...config,
      templates: {
        ...config.templates,
        [key]: value,
      },
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || isReadOnly) return;
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await saveMasterNotificationConfig(config, {
        id: currentUser.uid,
        name: currentUser.name,
        role: currentUser.role as 'admin' | 'manager' | 'supervisor',
      });
      setSuccessMsg(
        `Konfigurasi Notifikasi & WhatsApp Resmi (${config.customerServiceWhatsApp}) berhasil disimpan dan disinkronkan ke seluruh portal aplikasi.`
      );
      onRefresh();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi notifikasi.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
        <div className="inline-block animate-spin w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full mb-2"></div>
        <p className="text-sm">Memuat Master Data Notifikasi...</p>
      </div>
    );
  }

  const templateDefinitions = [
    {
      key: 'BOOKING_CONFIRMED',
      title: 'Booking Terkonfirmasi',
      desc: 'Dikirim saat pembayaran diverifikasi CSS / otomatis terkonfirmasi',
    },
    {
      key: 'THERAPIST_ASSIGNED',
      title: 'Terapis Ditugaskan',
      desc: 'Dikirim saat Supervisor menetapkan terapis untuk pesanan',
    },
    {
      key: 'ON_THE_WAY',
      title: 'Terapis Menuju Lokasi (OTW)',
      desc: 'Dikirim saat terapis menekan tombol OTW dengan tautan live tracking',
    },
    {
      key: 'TREATMENT_STARTED',
      title: 'Treatment Dimulai',
      desc: 'Notifikasi saat terapis memulai durasi timer pijat',
    },
    {
      key: 'COMPLETED',
      title: 'Treatment Selesai',
      desc: 'Ucapan terima kasih dan tautan ulasan kepuasan pelanggan',
    },
    {
      key: 'CANCELLED',
      title: 'Pesanan Dibatalkan',
      desc: 'Pemberitahuan pembatalan pesanan dan kontak layanan bantuan',
    },
  ];

  const currentTemplateText = config.templates[selectedTemplateKey] || '';

  // Render a sample preview with mock variables
  const samplePreviewText = currentTemplateText
    .replace('{customerName}', 'Budi Pratama')
    .replace('{bookingCode}', 'SNZ-240901')
    .replace('{serviceName}', 'Senzu Signature Massage 90 Menit')
    .replace('{scheduleDate}', '12 September 2026')
    .replace('{scheduleTime}', '14:00')
    .replace('{therapistName}', 'Rina Anggraini')
    .replace('{address}', 'Jl. Rajawali No. 45, Ilir Timur II, Palembang')
    .replace('{csWhatsApp}', config.customerServiceWhatsApp);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-amber-50/50 to-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-600/10 text-amber-700 flex items-center justify-center font-bold">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Master Data Notifikasi &amp; WhatsApp CS</h3>
            <p className="text-xs text-slate-500">
              Pengaturan nomor WhatsApp Customer Service resmi dan format template pesan otomatis
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

      <form onSubmit={handleSave} className="p-6 space-y-8">
        {/* Section 1: Official CS Contact */}
        <div className="bg-slate-50 p-5 rounded-xl border border-slate-200/80 space-y-4">
          <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
            <Phone className="w-4 h-4 text-emerald-600" />
            <span>Kontak Resmi Customer Service (Single Source of Truth)</span>
          </div>

          <p className="text-xs text-slate-500">
            Perubahan nomor WhatsApp di sini akan secara otomatis memperbarui tombol CS di Portal Customer, invoice pembayaran, notifikasi pelacakan terapis, dan seluruh tautan bantuan.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Nomor WhatsApp Customer Service Resmi
              </label>
              <div className="relative">
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={config.customerServiceWhatsApp ?? ''}
                  onChange={(e) => setConfig({ ...config, customerServiceWhatsApp: e.target.value })}
                  placeholder="+6289654623347"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100 font-semibold"
                  required
                />
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                <span>Format Tampilan:</span>
                <span className="font-semibold text-slate-800">
                  {formatWhatsAppDisplay(config.customerServiceWhatsApp)}
                </span>
                <span>• Link wa.me:</span>
                <span className="font-mono text-[11px] text-emerald-700">
                  wa.me/{getWaMeTarget(config.customerServiceWhatsApp)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Email Resmi Customer Service &amp; Notifikasi
              </label>
              <input
                type="email"
                disabled={isReadOnly}
                value={config.officialEmail ?? ''}
                onChange={(e) => setConfig({ ...config, officialEmail: e.target.value })}
                placeholder="senzureflexology@gmail.com"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100"
                required
              />
            </div>
          </div>
        </div>

        {/* Section 2: Automated Notification Templates */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-amber-600" />
                Template Pesan Notifikasi Otomatis
              </h4>
              <p className="text-xs text-slate-500">
                Kustomisasi teks WhatsApp yang dikirimkan pada setiap tahap status layanan
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Template Selector List */}
            <div className="lg:col-span-4 space-y-2">
              {(templateDefinitions || []).map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => setSelectedTemplateKey(tpl.key)}
                  className={`w-full text-left p-3 rounded-xl border transition cursor-pointer ${
                    selectedTemplateKey === tpl.key
                      ? 'border-amber-500 bg-amber-50/70 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">{tpl.title}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">{tpl.desc}</div>
                </button>
              ))}
            </div>

            {/* Template Editor & Preview */}
            <div className="lg:col-span-8 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Format Template Pesan ({selectedTemplateKey})
                  </label>
                  <span className="text-[10px] text-slate-400">
                    Variabel: {'{customerName}'}, {'{bookingCode}'}, {'{serviceName}'}, {'{therapistName}'}
                  </span>
                </div>
                <textarea
                  rows={4}
                  disabled={isReadOnly}
                  value={currentTemplateText}
                  onChange={(e) => handleTemplateChange(selectedTemplateKey, e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:bg-slate-100 font-sans"
                  required
                />
              </div>

              {/* Interactive WhatsApp Bubble Preview */}
              <div className="bg-[#EFEAE2] p-4 rounded-xl border border-slate-300">
                <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-600">
                  <Smartphone className="w-4 h-4 text-emerald-700" />
                  <span>Simulasi Tampilan di WhatsApp Pelanggan</span>
                </div>
                <div className="max-w-md bg-white p-3.5 rounded-xl rounded-tl-none shadow-xs border border-slate-200 text-slate-800 text-xs leading-relaxed">
                  <div className="whitespace-pre-line">{samplePreviewText}</div>
                  <div className="text-right text-[10px] text-slate-400 mt-1">14:02 WIB • Terkirim ✓✓</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        {!isReadOnly && (
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm flex items-center gap-2 shadow-sm transition disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan Perubahan...' : 'Simpan Master Notifikasi'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
