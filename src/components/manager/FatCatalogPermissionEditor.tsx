import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import type { StaffUser } from '../../types';
import { catalogApi, type StaffCatalogPermissions } from '../../lib/catalogClient';
import { CATALOG_PERMISSION_INFO, catalogPermissionsFrom } from '../../lib/catalogPermissions';

interface Props {
  staff: StaffUser;
  onClose: () => void;
  onSuccess?: () => void;
}

export const FatCatalogPermissionEditor: React.FC<Props> = ({ staff, onClose, onSuccess }) => {
  const [target, setTarget] = useState<StaffCatalogPermissions | null>(null);
  const [draft, setDraft] = useState(() => catalogPermissionsFrom(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    catalogApi.staffPermissions().then(rows => {
      if (!live) return;
      const found = rows.find(r => r.staffId === staff.uid || r.staffId === staff.id || r.authUid === staff.authUserId) || null;
      setTarget(found);
      if (found) setDraft(catalogPermissionsFrom(found.permissions));
      else setError('Akun FAT ini tidak memiliki akun login aktif yang dapat diatur permission-nya.');
    }).catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [staff.uid, staff.id, staff.authUserId]);

  const save = async () => {
    if (!target) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await catalogApi.updateStaffPermissions(target.staffId, draft);
      setDraft(catalogPermissionsFrom(updated.permissions));
      setNotice('Permission katalog FAT tersimpan dan tercatat di audit log.');
      onSuccess?.();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-700" /> Permission Katalog FAT</h3>
            <p className="text-xs text-slate-500 mt-0.5">{staff.name} · {staff.employeeCode || staff.uid}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {loading && <div className="py-6 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="w-4 h-4 animate-spin" /> Memuat permission dari server...</div>}
        {error && <p className="mt-3 bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}</p>}
        {notice && !error && <p className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 flex gap-2"><CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />{notice}</p>}

        {!loading && target && (
          <>
            <p className="mt-3 text-[11px] text-slate-400">Nilai awal berasal dari server. Permission yang belum ada dianggap tidak diberikan.</p>
            <div className="mt-2 space-y-1.5">
              {CATALOG_PERMISSION_INFO.map(info => (
                <label key={info.key} className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50/60 cursor-pointer">
                  <input type="checkbox" checked={draft[info.key] === true}
                    onChange={e => setDraft(prev => ({ ...prev, [info.key]: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 accent-[#8B5A36]" />
                  <span className="text-xs">
                    <span className="font-bold text-slate-800 block">{info.label}</span>
                    <span className="text-slate-500">{info.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer">Tutup</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="px-3 py-2 rounded-xl bg-[#8B5A36] text-white text-xs font-bold cursor-pointer disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan Permission'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
