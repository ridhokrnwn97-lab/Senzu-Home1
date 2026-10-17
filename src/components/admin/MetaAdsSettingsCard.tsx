import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, RefreshCw, Radio } from 'lucide-react';
import type { StaffUser } from '../../types';
import { getMetaAdsSettings, saveMetaAdsSettings } from '../../lib/metaAdsService';
import { defaultMetaAdsSettings, META_ADS_TRIGGERS, META_STANDARD_EVENTS, type MetaAdsSettings, type MetaAdsPixel, type MetaAdsEvent } from '../../lib/metaAdsSettings';

const inputClass = 'w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-[#082A4F] hover:bg-slate-50 disabled:opacity-50';

export function MetaAdsSettingsCard({ currentUser }: { currentUser: StaffUser }) {
  const [draft, setDraft] = useState<MetaAdsSettings>(defaultMetaAdsSettings);
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const readOnly = !['manager', 'admin'].includes(currentUser.role);
  const disabled = readOnly || loading || saving || !loaded;

  useEffect(() => {
    let active = true;
    setLoading(true); setLoaded(false); setError(''); setMessage('');
    getMetaAdsSettings().then(value => {
      if (active) { setDraft(value); setLoaded(true); }
    }).catch(() => {
      if (active) setError('Pengaturan Meta Pixel belum dapat dimuat. Klik Muat Ulang untuk mencoba lagi.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [currentUser.uid, reload]);

  const updatePixel = (id: string, patch: Partial<MetaAdsPixel>) => {
    setMessage(''); setDraft(value => ({ ...value, pixels: value.pixels.map(pixel => pixel.id === id ? { ...pixel, ...patch } : pixel) }));
  };
  const updateEvent = (id: string, patch: Partial<MetaAdsEvent>) => {
    setMessage(''); setDraft(value => ({ ...value, events: value.events.map(event => event.id === id ? { ...event, ...patch } : event) }));
  };
  const removePixel = (id: string) => {
    setMessage(''); setDraft(value => {
      const pixels = value.pixels.filter(pixel => pixel.id !== id);
      return { ...value, pixels, enabled: value.enabled && pixels.length > 0,
        events: value.events.map(event => ({ ...event, pixelIds: event.pixelIds === 'all' ? 'all' : event.pixelIds.filter(target => target !== id) })) };
    });
  };
  const addPixel = () => {
    try {
      const id = `pixel_${crypto.randomUUID()}`;
      setMessage(''); setDraft(value => ({ ...value, pixels: [...value.pixels, { id, name: `Pixel ${value.pixels.length + 1}`, pixelId: '', enabled: true }] }));
    } catch { setError('Browser belum dapat membuat pengaturan baru. Silakan muat ulang halaman.'); }
  };
  const addEvent = () => {
    try {
      const id = `event_${crypto.randomUUID()}`;
      setMessage(''); setDraft(value => ({ ...value, events: [...value.events, { id, trigger: 'booking_submitted', kind: 'custom', eventName: 'SenzuEvent', pixelIds: 'all', enabled: true }] }));
    } catch { setError('Browser belum dapat membuat peristiwa baru. Silakan muat ulang halaman.'); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const saved = await saveMetaAdsSettings(draft);
      setDraft(saved); setMessage('Pengaturan Meta Pixel berhasil disimpan.');
    } catch (problem: any) {
      setError(problem?.code === 'permission-denied' ? 'Hanya Manager atau Admin aktif yang dapat menyimpan pengaturan.' : problem?.message || 'Pengaturan belum berhasil disimpan.');
    } finally { setSaving(false); }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="meta-ads-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
        <div className="flex items-center gap-3"><Radio className="h-6 w-6 text-[#082A4F]" /><div>
          <h3 id="meta-ads-heading" className="font-serif text-lg font-bold text-[#082A4F]">Meta Ads &amp; Pixel</h3>
          <p className="mt-1 text-xs text-slate-500">Kelola Pixel ID dan peristiwa konversi pelanggan.</p>
        </div></div>
        <button type="button" className={buttonClass} disabled={loading || saving} onClick={() => setReload(value => value + 1)}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Muat Ulang</button>
      </div>
      <form onSubmit={save} className="space-y-6 p-5 sm:p-6">
        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        {loading && <p role="status" className="text-sm text-slate-500">Memuat pengaturan Meta Pixel...</p>}
        {readOnly && <p className="text-xs text-amber-700">Mode lihat saja. Pengaturan dapat diubah oleh Manager atau Admin aktif.</p>}
        <fieldset disabled={disabled} className="min-w-0 space-y-6">
          <label className="flex items-center gap-3 text-sm font-semibold text-[#082A4F]"><input type="checkbox" checked={Boolean(draft.enabled)} onChange={event => { setMessage(''); setDraft(value => ({ ...value, enabled: event.target.checked })); }} /> Aktifkan Meta Pixel</label>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold text-[#082A4F]">Daftar Pixel</h4><button type="button" className={buttonClass} onClick={addPixel} disabled={disabled || draft.pixels.length >= 10}><Plus className="h-4 w-4" /> Tambah Pixel</button></div>
            {!draft.pixels.length && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">Belum ada Pixel. Tambahkan Pixel ID dari Meta Events Manager.</p>}
            {draft.pixels.map((pixel, index) => (
              <div key={pixel.id} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={Boolean(pixel.enabled)} onChange={event => updatePixel(pixel.id, { enabled: event.target.checked })} /> Pixel {index + 1} aktif</label>
                  <button type="button" className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => removePixel(pixel.id)} aria-label={`Hapus Pixel ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs font-semibold text-slate-600">Nama Pixel<input className={inputClass} value={pixel.name ?? ''} maxLength={80} onChange={event => updatePixel(pixel.id, { name: event.target.value })} placeholder="Contoh: Senzu Home Utama" /></label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">Pixel ID<input className={inputClass} value={pixel.pixelId ?? ''} inputMode="numeric" maxLength={30} onChange={event => updatePixel(pixel.id, { pixelId: event.target.value.trim() })} placeholder="Masukkan ID angka dari Meta" /></label>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold text-[#082A4F]">Peristiwa Pixel</h4><button type="button" className={buttonClass} onClick={addEvent} disabled={disabled || draft.events.length >= 30}><Plus className="h-4 w-4" /> Tambah Peristiwa</button></div>
            {!draft.events.length && <p className="text-sm text-slate-500">Belum ada peristiwa yang dikonfigurasi.</p>}
            {draft.events.map((rule, index) => (
              <div key={rule.id} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={Boolean(rule.enabled)} onChange={event => updateEvent(rule.id, { enabled: event.target.checked })} /> Peristiwa {index + 1} aktif</label>
                  <button type="button" className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { setMessage(''); setDraft(value => ({ ...value, events: value.events.filter(item => item.id !== rule.id) })); }} aria-label={`Hapus Peristiwa ${index + 1}`}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs font-semibold text-slate-600">Pemicu<select className={inputClass} value={rule.trigger || 'booking_submitted'} onChange={event => updateEvent(rule.id, { trigger: event.target.value as MetaAdsEvent['trigger'] })}>{Object.entries(META_ADS_TRIGGERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">Jenis Peristiwa<select className={inputClass} value={rule.kind || 'standard'} onChange={event => updateEvent(rule.id, { kind: event.target.value as 'standard' | 'custom', eventName: event.target.value === 'standard' ? 'AddToCart' : 'SenzuEvent' })}><option value="standard">Standard Meta</option><option value="custom">Custom</option></select></label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">Nama Peristiwa{rule.kind === 'standard'
                    ? <select className={inputClass} value={rule.eventName ?? 'AddToCart'} onChange={event => updateEvent(rule.id, { eventName: event.target.value })}>{META_STANDARD_EVENTS.map(name => <option key={name} value={name}>{name}</option>)}</select>
                    : <input className={inputClass} value={rule.eventName ?? ''} maxLength={40} onChange={event => updateEvent(rule.id, { eventName: event.target.value })} placeholder="Contoh: BookingInterest" />}</label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">Target Pixel<select className={inputClass} value={rule.pixelIds === 'all' ? 'all' : rule.pixelIds[0] || ''} onChange={event => updateEvent(rule.id, { pixelIds: event.target.value === 'all' ? 'all' : event.target.value ? [event.target.value] : [] })}><option value="all">Semua Pixel aktif</option><option value="">Tanpa target</option>{draft.pixels.map(pixel => <option key={pixel.id} value={pixel.id}>{pixel.name || 'Pixel tanpa nama'}</option>)}</select></label>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">Perubahan berlaku setelah disimpan. AddToCart awalnya dipicu oleh booking yang berhasil diajukan; Lead oleh konfirmasi via WA atau bukti pembayaran yang berhasil dikirim. Kedua pemicu Lead awal dihitung sekali per booking dan target Pixel pada browser ini.</p>
          <button type="submit" disabled={disabled} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#082A4F] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Menyimpan...' : 'Simpan Pengaturan Meta Pixel'}</button>
        </fieldset>
      </form>
    </section>
  );
}
