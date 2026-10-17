import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Clock,
  Coffee,
  Plus,
  Trash2,
  CheckCircle2,
  X,
  Users,
  Calendar,
  AlertTriangle,
  Edit2,
} from 'lucide-react';
import {
  Therapist,
  ShiftTemplate,
  RosterShiftStatus,
  RosterBreakPeriod,
} from '../../../types';
import {
  getRosterTemplates,
  saveRosterTemplate,
  deleteRosterTemplate,
  bulkApplyRosterSchedule,
  timeToMinutes,
} from '../../../lib/rosterService';

interface ShiftTemplatesAndBulkModalProps {
  isOpen: boolean;
  mode?: 'templates' | 'bulk_apply';
  initialMode?: 'templates' | 'bulk_apply';
  therapists: Therapist[];
  bookings?: any[];
  defaultDate?: string;
  selectedDate?: string;
  actorName?: string;
  onClose: () => void;
  onSuccess: (message: string) => Promise<void> | void;
  onOpenAssignModal?: (booking: any) => void;
}

export const ShiftTemplatesAndBulkModal: React.FC<ShiftTemplatesAndBulkModalProps> = ({
  isOpen,
  mode: propMode,
  initialMode,
  therapists = [],
  bookings = [],
  defaultDate,
  selectedDate,
  actorName = 'Supervisor Operasional',
  onClose,
  onSuccess,
  onOpenAssignModal,
}) => {
  if (!isOpen) return null;

  const mode = propMode || initialMode || 'templates';
  const todayStr = selectedDate || defaultDate || new Date().toISOString().split('T')[0];

  // Templates state
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState<boolean>(true);

  // Template editor modal state
  const [isEditingTemplate, setIsEditingTemplate] = useState<boolean>(false);
  const [editingTemplateData, setEditingTemplateData] = useState<ShiftTemplate>({
    id: '',
    name: '',
    shiftStart: '10:00',
    shiftEnd: '21:00',
    hasBreak: true,
    breakStart: '13:00',
    breakEnd: '14:00',
    isActive: true,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  });

  // Bulk apply state
  const [selectedTherapistIds, setSelectedTherapistIds] = useState<string[]>([]);
  const [bulkStartDate, setBulkStartDate] = useState<string>(todayStr);
  const [bulkEndDate, setBulkEndDate] = useState<string>(todayStr);
  const [bulkShiftStart, setBulkShiftStart] = useState<string>('10:00');
  const [bulkShiftEnd, setBulkShiftEnd] = useState<string>('21:00');
  const [bulkStatus, setBulkStatus] = useState<RosterShiftStatus>('scheduled');
  const [bulkHasBreak, setBulkHasBreak] = useState<boolean>(true);
  const [bulkBreakStart, setBulkBreakStart] = useState<string>('13:00');
  const [bulkBreakEnd, setBulkBreakEnd] = useState<string>('14:00');
  const [bulkUnavailableReason, setBulkUnavailableReason] = useState<string>('');
  const [bulkNote, setBulkNote] = useState<string>('Penerapan Shift Massal');

  // Confirmation state
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Load templates on open
  useEffect(() => {
    setIsLoadingTemplates(true);
    getRosterTemplates()
      .then((data) => {
        setTemplates(data);
        setIsLoadingTemplates(false);
      })
      .catch((err) => {
        console.warn('Error fetching templates:', err);
        setIsLoadingTemplates(false);
      });
  }, [isOpen]);

  // Handle template selection in bulk apply
  const handleSelectTemplateForBulk = (tpl: ShiftTemplate) => {
    setBulkShiftStart(tpl.shiftStart);
    setBulkShiftEnd(tpl.shiftEnd);
    setBulkHasBreak(tpl.hasBreak);
    if (tpl.breakStart) setBulkBreakStart(tpl.breakStart);
    if (tpl.breakEnd) setBulkBreakEnd(tpl.breakEnd);
  };

  const handleToggleTherapist = (id: string) => {
    setSelectedTherapistIds((prev) =>
      (prev || []).includes(id) ? (prev || []).filter((i) => i !== id) : [...(prev || []), id]
    );
  };

  const handleSelectAllTherapists = () => {
    const list = therapists || [];
    if (selectedTherapistIds.length === list.length) {
      setSelectedTherapistIds([]);
    } else {
      setSelectedTherapistIds((list || []).map((t) => t.id));
    }
  };

  // Save template handler
  const handleSaveTemplate = async () => {
    if (!editingTemplateData.name.trim()) {
      setErrorMessage('Nama template wajib diisi.');
      return;
    }

    const startMin = timeToMinutes(editingTemplateData.shiftStart);
    const endMin = timeToMinutes(editingTemplateData.shiftEnd);
    if (startMin >= endMin) {
      setErrorMessage('Jam masuk harus sebelum jam pulang.');
      return;
    }

    try {
      setIsSubmitting(true);
      const templateToSave: ShiftTemplate = {
        ...editingTemplateData,
        id: editingTemplateData.id || `tpl_${Date.now()}`,
        createdAt: editingTemplateData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: actorName,
      };

      await saveRosterTemplate(templateToSave, actorName);
      const refreshed = await getRosterTemplates();
      setTemplates(refreshed);
      setIsEditingTemplate(false);
      setErrorMessage('');
    } catch (err: any) {
      console.error('Save template error:', err);
      setErrorMessage('Gagal menyimpan template: ' + (err.message || 'Error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete template handler
  const handleDeleteTemplate = async (template: ShiftTemplate) => {
    if (!window.confirm(`Hapus template "${template.name}"?`)) return;
    try {
      await deleteRosterTemplate(template.id, template.name, actorName);
      const refreshed = await getRosterTemplates();
      setTemplates(refreshed);
    } catch (err) {
      console.error('Delete template error:', err);
    }
  };

  // Bulk apply execution
  const handleExecuteBulkApply = async () => {
    if (selectedTherapistIds.length === 0) {
      setErrorMessage('Pilih minimal satu terapis.');
      return;
    }
    if (bulkStartDate > bulkEndDate) {
      setErrorMessage('Tanggal mulai tidak boleh melebihi tanggal selesai.');
      return;
    }

    const startMin = timeToMinutes(bulkShiftStart);
    const endMin = timeToMinutes(bulkShiftEnd);
    if (bulkStatus === 'scheduled' && startMin >= endMin) {
      setErrorMessage('Jam shift masuk harus lebih awal dari jam shift pulang.');
      return;
    }

    const breaks: RosterBreakPeriod[] =
      bulkHasBreak && bulkStatus === 'scheduled'
        ? [
            {
              id: `brk-bulk-1`,
              start: bulkBreakStart,
              end: bulkBreakEnd,
              note: 'Istirahat Terjadwal',
            },
          ]
        : [];

    try {
      setIsSubmitting(true);
      const count = await bulkApplyRosterSchedule(
        selectedTherapistIds,
        therapists,
        bulkStartDate,
        bulkEndDate,
        bulkShiftStart,
        bulkShiftEnd,
        bulkStatus,
        breaks,
        bulkUnavailableReason,
        actorName,
        bulkNote
      );

      setShowConfirmModal(false);
      onSuccess(`Berhasil menerapkan jadwal ke ${selectedTherapistIds.length} terapis (${count} shift tersimpan)!`);
      onClose();
    } catch (err: any) {
      console.error('Bulk apply error:', err);
      setErrorMessage('Gagal menerapkan jadwal massal: ' + (err.message || 'Error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#082A4F] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 text-[#D4AF37]">
              {mode === 'templates' ? (
                <Sparkles className="w-5 h-5" />
              ) : (
                <Users className="w-5 h-5" />
              )}
            </div>
            <div>
              <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                {mode === 'templates' ? 'Shift Master' : 'Operasional Armada'}
              </span>
              <h2 className="text-base sm:text-lg font-bold font-serif text-white mt-0.5">
                {mode === 'templates'
                  ? 'Kelola Template Shift Terapis'
                  : 'Terapkan Jadwal Massal ke Terapis'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {mode === 'templates' ? (
            /* TEMPLATES VIEW */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-slate-600">
                  Daftar pola shift standar operasional. Template dapat digunakan untuk mengisi cepat shift harian atau jadwal massal.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTemplateData({
                      id: '',
                      name: '',
                      shiftStart: '10:00',
                      shiftEnd: '21:00',
                      hasBreak: true,
                      breakStart: '13:00',
                      breakEnd: '14:00',
                      isActive: true,
                      createdAt: '',
                      updatedAt: '',
                      updatedBy: '',
                    });
                    setErrorMessage('');
                    setIsEditingTemplate(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>Tambah Template</span>
                </button>
              </div>

              {/* Template List */}
              {isLoadingTemplates ? (
                <div className="text-center py-8 text-slate-400">Memuat template...</div>
              ) : templates.length === 0 ? (
                <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 space-y-2">
                  <Sparkles className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="font-semibold">Belum ada template shift yang dibuat.</p>
                  <p className="text-[11px] text-slate-400">
                    Klik tombol "Tambah Template" untuk membuat pola shift baru seperti Shift Pagi atau Shift Siang.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(templates || []).map((tpl) => (
                    <div
                      key={tpl.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-[#D4AF37] transition shadow-2xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 text-sm">{tpl.name}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTemplateData({ ...tpl });
                              setErrorMessage('');
                              setIsEditingTemplate(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            title="Edit Template"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTemplate(tpl)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Hapus Template"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-slate-600 text-[11px]">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                          <span>Shift: <strong>{tpl.shiftStart} - {tpl.shiftEnd} WIB</strong></span>
                        </div>
                        {tpl.hasBreak && tpl.breakStart && (
                          <div className="flex items-center gap-1">
                            <Coffee className="w-3.5 h-3.5 text-amber-500" />
                            <span>Break: {tpl.breakStart} - {tpl.breakEnd}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* BULK APPLY VIEW */
            <div className="space-y-4">
              {/* Step 1: Therapist Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-bold text-slate-700 block">
                    Pilih Terapis ({selectedTherapistIds.length} dari {therapists.length} dipilih):
                  </label>
                  <button
                    type="button"
                    onClick={handleSelectAllTherapists}
                    className="text-[#082A4F] hover:underline font-bold text-[11px] cursor-pointer"
                  >
                    {selectedTherapistIds.length === therapists.length
                      ? 'Batal Pilih Semua'
                      : 'Pilih Semua Terapis'}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-40 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
                  {(therapists || []).map((th) => {
                    const isChecked = selectedTherapistIds.includes(th.id);
                    return (
                      <label
                        key={th.id}
                        className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-2 cursor-pointer transition ${
                          isChecked
                            ? 'bg-[#082A4F] text-white border-[#082A4F]'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTherapist(th.id)}
                          className="w-3.5 h-3.5 rounded text-[#D4AF37] accent-[#D4AF37]"
                        />
                        <span className="truncate">{th.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Date Range */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Mulai Tanggal:</label>
                  <input
                    type="date"
                    value={bulkStartDate}
                    onChange={(e) => setBulkStartDate(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Sampai Tanggal:</label>
                  <input
                    type="date"
                    value={bulkEndDate}
                    onChange={(e) => setBulkEndDate(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                  />
                </div>
              </div>

              {/* Quick Template Picker */}
              {templates.length > 0 && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1.5">
                    Gunakan Template Shift Siap Pakai:
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(templates || []).map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => handleSelectTemplateForBulk(tpl)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-[#082A4F] hover:text-white border border-slate-200 font-semibold transition cursor-pointer text-[11px]"
                      >
                        {tpl.name} ({tpl.shiftStart}-{tpl.shiftEnd})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Status & Shift Hours */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Status Shift:</label>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as RosterShiftStatus)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    <option value="scheduled">Kerja (Scheduled)</option>
                    <option value="off">Off Duty (Libur)</option>
                    <option value="leave">Izin / Cuti</option>
                    <option value="unavailable">Unavailable (Kendala)</option>
                  </select>
                </div>

                {bulkStatus === 'scheduled' && (
                  <>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Jam Masuk:</label>
                      <input
                        type="time"
                        value={bulkShiftStart}
                        onChange={(e) => setBulkShiftStart(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">Jam Pulang:</label>
                      <input
                        type="time"
                        value={bulkShiftEnd}
                        onChange={(e) => setBulkShiftEnd(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-white"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Break Configuration */}
              {bulkStatus === 'scheduled' && (
                <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-200 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={bulkHasBreak}
                      onChange={(e) => setBulkHasBreak(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-amber-500 accent-amber-500"
                    />
                    <Coffee className="w-3.5 h-3.5 text-amber-600" />
                    <span>Sertakan Waktu Break:</span>
                  </label>

                  {bulkHasBreak && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={bulkBreakStart}
                        onChange={(e) => setBulkBreakStart(e.target.value)}
                        className="px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs bg-white"
                      />
                      <span>s/d</span>
                      <input
                        type="time"
                        value={bulkBreakEnd}
                        onChange={(e) => setBulkBreakEnd(e.target.value)}
                        className="px-2 py-1 rounded-lg border border-slate-300 font-mono text-xs bg-white"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Reason if not scheduled */}
              {bulkStatus !== 'scheduled' && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Alasan Tidak Bertugas:</label>
                  <input
                    type="text"
                    placeholder="cth: Libur Bersama, Pelatihan Internal, dsb."
                    value={bulkUnavailableReason}
                    onChange={(e) => setBulkUnavailableReason(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
          >
            Tutup
          </button>

          {mode === 'bulk_apply' && (
            <button
              type="button"
              onClick={() => {
                if (selectedTherapistIds.length === 0) {
                  setErrorMessage('Pilih minimal satu terapis.');
                  return;
                }
                setShowConfirmModal(true);
              }}
              className="px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
              <span>Lanjut Terapkan ({selectedTherapistIds.length} Terapis)</span>
            </button>
          )}
        </div>
      </div>

      {/* Template Editor Modal */}
      {isEditingTemplate && (
        <div className="fixed inset-0 z-70 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 text-xs">
            <h3 className="text-base font-bold text-[#082A4F]">
              {editingTemplateData.id ? 'Edit Template Shift' : 'Tambah Template Shift Baru'}
            </h3>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Nama Template:</label>
              <input
                type="text"
                placeholder="cth: Shift Pagi, Shift Siang 12-22, dsb."
                value={editingTemplateData.name ?? ''}
                onChange={(e) =>
                  setEditingTemplateData({ ...editingTemplateData, name: e.target.value })
                }
                className="w-full p-2.5 rounded-xl border border-slate-300 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Jam Masuk:</label>
                <input
                  type="time"
                  value={editingTemplateData.shiftStart ?? '10:00'}
                  onChange={(e) =>
                    setEditingTemplateData({ ...editingTemplateData, shiftStart: e.target.value })
                  }
                  className="w-full p-2 rounded-xl border border-slate-300 font-mono text-xs"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Jam Pulang:</label>
                <input
                  type="time"
                  value={editingTemplateData.shiftEnd ?? '22:00'}
                  onChange={(e) =>
                    setEditingTemplateData({ ...editingTemplateData, shiftEnd: e.target.value })
                  }
                  className="w-full p-2 rounded-xl border border-slate-300 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(editingTemplateData.hasBreak)}
                  onChange={(e) =>
                    setEditingTemplateData({
                      ...editingTemplateData,
                      hasBreak: e.target.checked,
                    })
                  }
                  className="w-3.5 h-3.5 rounded text-amber-500 accent-amber-500"
                />
                <span>Ada Waktu Istirahat (Break)</span>
              </label>

              {editingTemplateData.hasBreak && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-slate-600 block mb-1">Mulai Break:</label>
                    <input
                      type="time"
                      value={editingTemplateData.breakStart || '13:00'}
                      onChange={(e) =>
                        setEditingTemplateData({
                          ...editingTemplateData,
                          breakStart: e.target.value,
                        })
                      }
                      className="w-full p-2 rounded-xl border border-slate-300 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-slate-600 block mb-1">Selesai Break:</label>
                    <input
                      type="time"
                      value={editingTemplateData.breakEnd || '14:00'}
                      onChange={(e) =>
                        setEditingTemplateData({
                          ...editingTemplateData,
                          breakEnd: e.target.value,
                        })
                      }
                      className="w-full p-2 rounded-xl border border-slate-300 font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsEditingTemplate(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={isSubmitting}
                className="px-4 py-1.5 rounded-xl bg-[#082A4F] text-white font-bold hover:bg-[#0E3D73] disabled:opacity-50"
              >
                Simpan Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal before Bulk Save */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-80 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500 text-white shadow-xs">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Konfirmasi Perubahan Jadwal Massal
                </h3>
                <p className="text-slate-600 mt-1">
                  Anda akan menerapkan jadwal berikut ke <strong>{selectedTherapistIds.length} terapis</strong> terpilih:
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-slate-700">
              <div>
                Rentang Tanggal: <strong>{bulkStartDate}</strong> s/d <strong>{bulkEndDate}</strong>
              </div>
              <div>
                Status: <strong>{bulkStatus.toUpperCase()}</strong>
              </div>
              {bulkStatus === 'scheduled' && (
                <div>
                  Jam Kerja: <strong>{bulkShiftStart} - {bulkShiftEnd} WIB</strong>
                </div>
              )}
              {bulkStatus === 'scheduled' && bulkHasBreak && (
                <div>
                  Waktu Break: <strong>{bulkBreakStart} - {bulkBreakEnd} WIB</strong>
                </div>
              )}
            </div>

            <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
              Setiap terapis yang bersangkutan akan menerima notifikasi jadwal kerja baru di aplikasi mereka.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteBulkApply}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white font-bold flex items-center gap-2 shadow-xs disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
                <span>{isSubmitting ? 'Menerapkan...' : 'Ya, Terapkan Sekarang'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
