import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  Lock,
  Clock,
  MapPin,
  Calendar,
  Sparkles,
  ShieldAlert,
  HelpCircle,
  AlertTriangle,
  Car,
  Heart,
  Check,
  Shield,
  Coffee,
} from 'lucide-react';
import { Booking, Therapist, TherapistRoster, AppSettings, ServiceItem } from '../../types';
import { isPaymentPaid } from '../../lib/paymentService';
import { supervisorAssignTherapist, supervisorReassignTherapist, getCustomerByWhatsApp } from '../../lib/dbService';
import { getDailyRosters, ensureDailyRosters } from '../../lib/rosterService';
import { rankTherapistsForBooking, TherapistEligibilityResult } from '../../lib/schedulingEngine';
import { useAuth } from '../../context/AuthContext';

interface SupervisorAssignmentModalProps {
  booking: Booking | null;
  therapists: Therapist[];
  services?: ServiceItem[];
  allBookings: Booking[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  settings?: AppSettings;
  rosters?: TherapistRoster[];
}

const REASSIGNMENT_REASONS = [
  'Terapis Tidak Merespons / Terlambat Konfirmasi',
  'Terapis Sakit / Berhalangan Hadir Mendadak',
  'Jadwal Bentrok Operasional Lapangan',
  'Kendala Perjalanan / Masalah Kendaraan',
  'Permintaan Khusus Pelanggan',
  'Penyesuaian Beban Kerja Armada',
  'Alasan Lainnya',
];

export const SupervisorAssignmentModal: React.FC<SupervisorAssignmentModalProps> = ({
  booking,
  therapists,
  services,
  allBookings,
  isOpen,
  onClose,
  onSuccess,
  settings,
  rosters: initialRosters,
}) => {
  const { currentUser } = useAuth();
  const [selectedTherapistId, setSelectedTherapistId] = useState<string>('');
  const [reassignmentReason, setReassignmentReason] = useState<string>(REASSIGNMENT_REASONS[0]);
  const [internalNote, setInternalNote] = useState<string>('');
  const [overrideWarningConfirmed, setOverrideWarningConfirmed] = useState<boolean>(false);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [dailyRosters, setDailyRosters] = useState<TherapistRoster[]>(initialRosters || []);
  const [favoriteTherapistId, setFavoriteTherapistId] = useState<string | undefined>(undefined);
  const [crmGender, setCrmGender] = useState<string | undefined>(undefined);
  const [isLoadingRosters, setIsLoadingRosters] = useState<boolean>(false);

  // Load rosters and CRM customer preferences when booking changes
  useEffect(() => {
    if (!booking) return;

    setSelectedTherapistId(booking.therapistId || '');
    setReassignmentReason(REASSIGNMENT_REASONS[0]);
    setInternalNote('');
    setErrorMsg('');
    setOverrideWarningConfirmed(false);
    setOverrideReason('');

    // Load customer favorite therapist
    if (booking.customerWhatsApp) {
      getCustomerByWhatsApp(booking.customerWhatsApp).then((c) => {
        if (c?.favoriteTherapistId) {
          setFavoriteTherapistId(c.favoriteTherapistId);
        }
        if (c?.gender) setCrmGender(c.gender);
      }).catch(() => {});
    }

    // Ensure daily rosters are loaded for this booking date
    setIsLoadingRosters(true);
    ensureDailyRosters(therapists, booking.scheduleDate, currentUser?.name || 'Supervisor')
      .then((rosters) => {
        setDailyRosters(rosters);
      })
      .catch((err) => {
        console.warn('Load rosters for assignment modal notice:', err);
      })
      .finally(() => {
        setIsLoadingRosters(false);
      });
  }, [booking, therapists, currentUser]);

  const isPaid = booking ? isPaymentPaid(booking.paymentStatus) : false;
  const isReassign = !!booking?.therapistId;

  // Run Smart Scheduling Engine ranking
  const ranked = useMemo(() => {
    if (!booking) {
      return {
        recommended: [],
        available: [],
        warning: [],
        ineligible: [],
        allScored: [],
      };
    }
    return rankTherapistsForBooking(
      therapists,
      booking,
      allBookings,
      dailyRosters,
      favoriteTherapistId,
      settings,
      undefined,
      services
    );
  }, [therapists, booking, allBookings, dailyRosters, favoriteTherapistId, settings, services]);

  const selectedEvaluation = useMemo(() => {
    return ranked.allScored.find((st) => st.therapist.id === selectedTherapistId);
  }, [ranked, selectedTherapistId]);

  if (!isOpen || !booking) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPaid) {
      setErrorMsg('Booking belum diverifikasi lunas. Penugasan hanya dapat dilakukan setelah pembayaran berstatus PAID.');
      return;
    }

    if (!selectedTherapistId) {
      setErrorMsg('Pilih terapis terlebih dahulu.');
      return;
    }

    const chosen = therapists.find((t) => t.id === selectedTherapistId);
    if (!chosen) {
      setErrorMsg('Terapis tidak valid.');
      return;
    }

    // Hard conflict validation
    if (selectedEvaluation?.status === 'INELIGIBLE') {
      setErrorMsg(
        `Terapis ${chosen.name} tidak dapat ditugaskan: ${selectedEvaluation.hardConflicts[0]?.message || 'Konflik jadwal keras'}`
      );
      return;
    }

    // Soft warning check - require supervisor confirmation & reason
    if (selectedEvaluation?.status === 'WARNING' && !overrideWarningConfirmed) {
      setErrorMsg(
        'Terapis ini memiliki peringatan operasional (warning). Beri centang persetujuan override dan masukkan catatan supervisor.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const fullNote = [
        internalNote,
        selectedEvaluation?.status === 'WARNING' ? `[SUPERVISOR OVERRIDE: ${overrideReason || 'Diizinkan supervisor'}]` : '',
      ]
        .filter(Boolean)
        .join(' ');

      if (isReassign) {
        await supervisorReassignTherapist(
          booking,
          chosen,
          currentUser?.name || 'Supervisor',
          reassignmentReason,
          fullNote
        );
        onSuccess(`Terapis untuk order ${booking.bookingCode} berhasil dialihkan ke ${chosen.name}.`);
      } else {
        await supervisorAssignTherapist(
          booking,
          chosen,
          currentUser?.name || 'Supervisor'
        );
        onSuccess(`Terapis ${chosen.name} berhasil ditugaskan untuk order ${booking.bookingCode}.`);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan penugasan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderTherapistCard = (result: TherapistEligibilityResult) => {
    const { therapist, roster, status, hardConflicts, softWarnings, isGenderMatch, isSkillMatch, isFavoriteForCustomer, sameDayJobCount, estimatedTravelMinutes, travelContext } = result;
    const isSelected = selectedTherapistId === therapist.id;
    const isCurrent = booking.therapistId === therapist.id;
    const isIneligible = status === 'INELIGIBLE';
    const isWarning = status === 'WARNING';
    const isEligible = status === 'ELIGIBLE';

    return (
      <div
        key={therapist.id}
        onClick={() => {
          if (!isIneligible && isPaid) {
            setSelectedTherapistId(therapist.id);
            setOverrideWarningConfirmed(false);
          }
        }}
        className={`p-3.5 rounded-2xl border transition relative ${
          isIneligible
            ? 'opacity-60 bg-slate-50 border-slate-200 cursor-not-allowed'
            : isSelected
            ? 'border-[#082A4F] bg-[#082A4F]/5 ring-2 ring-[#082A4F] cursor-pointer'
            : isCurrent
            ? 'border-indigo-300 bg-indigo-50/50 cursor-pointer'
            : 'border-slate-200 hover:border-slate-300 bg-white cursor-pointer'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="therapist"
              value={therapist.id}
              checked={isSelected}
              disabled={isIneligible || !isPaid}
              onChange={() => {
                if (!isIneligible && isPaid) {
                  setSelectedTherapistId(therapist.id);
                  setOverrideWarningConfirmed(false);
                }
              }}
              className="mt-1 accent-[#082A4F] cursor-pointer"
            />

            <div className="space-y-1">
              {/* Header: Name + Gender + Badges */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-xs text-slate-900">{therapist.name}</span>
                <span className="text-[11px] text-slate-500">({therapist.gender})</span>

                {isFavoriteForCustomer && (
                  <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[9px] font-bold flex items-center gap-1 border border-rose-200">
                    <Heart className="w-2.5 h-2.5 fill-current" />
                    <span>Favorit Pelanggan</span>
                  </span>
                )}

                {isCurrent && (
                  <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[9px] font-bold">
                    Terapis Saat Ini
                  </span>
                )}

                {isEligible && (
                  <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                    Siap Ditugaskan
                  </span>
                )}

                {isWarning && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[9px] font-bold flex items-center gap-0.5">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    <span>Perlu Konfirmasi</span>
                  </span>
                )}

                {isIneligible && (
                  <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[9px] font-bold">
                    Tidak Memenuhi Syarat
                  </span>
                )}
              </div>

              {/* Shift & Workload Metrics */}
              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                <span className="text-amber-500 font-bold">★ {therapist.rating}</span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>Shift: {roster ? `${roster.shiftStart}-${roster.shiftEnd}` : '10:00-21:00'} WIB</span>
                </span>
                <span>•</span>
                <span>{sameDayJobCount} order hari ini</span>
                {travelContext && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Car className="w-3 h-3 text-slate-400" />
                      <span>~{estimatedTravelMinutes}m ({travelContext})</span>
                    </span>
                  </>
                )}
              </div>

              {/* Hard Conflict notices */}
              {hardConflicts.length > 0 && (
                <div className="space-y-1 mt-1.5">
                  {(hardConflicts || []).map((c, idx) => (
                    <div
                      key={idx}
                      className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-600 flex-shrink-0"></span>
                      <span>{c.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Soft Warning notices */}
              {softWarnings.length > 0 && (
                <div className="space-y-1 mt-1.5">
                  {(softWarnings || []).map((w, idx) => (
                    <div
                      key={idx}
                      className="text-[10px] font-medium text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg flex items-center gap-1.5"
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right badge */}
          <div className="text-right text-xs flex-shrink-0">
            {isEligible && (
              <span className="text-emerald-700 font-bold flex items-center gap-1 text-[11px] bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Eligible</span>
              </span>
            )}
            {isWarning && (
              <span className="text-amber-800 font-bold text-[10px] bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                Warning ({softWarnings.length})
              </span>
            )}
            {isIneligible && (
              <span className="text-rose-700 font-bold text-[10px] bg-rose-50 px-2 py-1 rounded-lg border border-rose-200">
                Terkunci
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-3xl border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-[#082A4F] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-[#D4AF37]">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg">
                {isReassign ? 'Ganti Terapis (Reassignment)' : 'Penugasan Terapis (Smart Scheduling)'}
              </h3>
              <p className="text-xs text-slate-300 font-mono">
                Order #{booking.bookingCode} • {booking.serviceName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Unpaid Warning Banner */}
          {!isPaid && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1.5 flex items-start gap-3">
              <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold text-sm text-amber-900">
                  Pembayaran Belum Diverifikasi Lunas
                </strong>
                <p className="text-amber-850 leading-relaxed">
                  Sesuai SOP Senzu Home Palembang, penugasan terapis hanya dapat dikonfirmasi setelah pembayaran berstatus <strong>PAID</strong> melalui verifikasi CSS.
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Booking Summary Card */}
          <div className="p-4 rounded-2xl bg-[#FAF9F6] border border-slate-200 text-xs space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Jadwal</span>
                <strong className="text-slate-800 font-mono">{booking.scheduleDate}</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Waktu Sesi</span>
                <strong className="text-[#082A4F] font-mono">{booking.scheduleTime} WIB</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Durasi Layanan</span>
                <strong className="text-slate-800">{booking.serviceDuration} Menit</strong>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Pref. Gender</span>
                <span
                  className={`inline-block font-bold px-2 py-0.5 rounded text-[10px] ${
                    booking.genderPreference === 'Perempuan'
                      ? 'bg-rose-100 text-rose-800'
                      : booking.genderPreference === 'Laki-laki'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {booking.genderPreference || 'Bebas'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
              <div>
                Pelanggan: <strong>{booking.customerName}</strong> ({booking.customerWhatsApp})
              </div>
              <div className="truncate">
                Area: <strong>{booking.area}</strong>
              </div>
            </div>
            <div className="text-slate-700">
              Gender Pelanggan:{' '}
              <strong
                className={`inline-block font-bold px-2 py-0.5 rounded text-[10px] ${
                  (booking.customerGender || crmGender) === 'Perempuan'
                    ? 'bg-rose-100 text-rose-800'
                    : (booking.customerGender || crmGender) === 'Laki-laki'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {booking.customerGender || crmGender || '—'}
              </strong>
              <span className="text-[10px] text-slate-400"> (dasar penugasan terapis)</span>
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              Alamat: {booking.address}
            </div>
          </div>

          {/* Reassignment Reason Required */}
          {isReassign && (
            <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-indigo-700" />
                  <span>Alasan Penggantian Terapis (Wajib Dicatat):</span>
                </label>
                <span className="text-[10px] font-semibold text-indigo-700">Audit Trail</span>
              </div>

              <select
                value={reassignmentReason}
                onChange={(e) => setReassignmentReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-indigo-200 bg-white text-xs font-medium focus:ring-2 focus:ring-indigo-600"
              >
                {REASSIGNMENT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <div>
                <input
                  type="text"
                  placeholder="Catatan internal tambahan supervisor..."
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-indigo-200 bg-white text-xs font-medium placeholder-slate-400 focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            </div>
          )}

          {/* Therapist Selection Engine Lists */}
          <div className="space-y-4">
            {/* 1. Recommended */}
            {ranked.recommended.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#D4AF37]" />
                  <h4 className="text-xs font-bold text-[#082A4F] uppercase tracking-wider">
                    Rekomendasi Terbaik (Optimal Match)
                  </h4>
                </div>
                <div className="space-y-2">
                  {(ranked?.recommended || []).map(renderTherapistCard)}
                </div>
              </div>
            )}

            {/* 2. Available */}
            {(ranked?.available || []).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Terapis Tersedia Lainnya</span>
                </h4>
                <div className="space-y-2">
                  {(ranked?.available || []).map(renderTherapistCard)}
                </div>
              </div>
            )}

            {/* 3. Warning (Requires Supervisor Override) */}
            {(ranked?.warning || []).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Perlu Konfirmasi Override ({(ranked?.warning || []).length})</span>
                </h4>
                <div className="space-y-2">
                  {(ranked?.warning || []).map(renderTherapistCard)}
                </div>
              </div>
            )}

            {/* 4. Ineligible (Hard Conflict / Blocked) */}
            {(ranked?.ineligible || []).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Tidak Memenuhi Syarat Jadwal ({(ranked?.ineligible || []).length})</span>
                </h4>
                <div className="space-y-2">
                  {(ranked?.ineligible || []).map(renderTherapistCard)}
                </div>
              </div>
            )}
          </div>

          {/* Supervisor Override Confirmation Box if selected therapist has WARNING */}
          {selectedEvaluation?.status === 'WARNING' && (
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-400 space-y-3 animate-fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-950 space-y-1">
                  <strong className="font-bold">Konfirmasi Supervisor Override Diperlukan</strong>
                  <p className="text-slate-700">
                    Terapis ini memiliki peringatan jadwal (contoh: istirahat atau estimasi perjalanan ketat). Sebagai Supervisor, Anda memiliki wewenang untuk menyetujui penugasan ini dengan mencatat alasan operasional.
                  </p>
                </div>
              </div>

              <input
                type="text"
                placeholder="Tuliskan alasan override (cth: Customer setuju waktu treatment digeser 10 menit / terapis siap lembur)..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-amber-300 bg-white text-xs font-medium placeholder-slate-400 focus:ring-2 focus:ring-amber-500"
              />

              <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-amber-900">
                <input
                  type="checkbox"
                  checked={overrideWarningConfirmed}
                  onChange={(e) => setOverrideWarningConfirmed(e.target.checked)}
                  className="w-4 h-4 rounded text-[#082A4F] accent-[#082A4F]"
                />
                <span>Saya menyetujui override penugasan ini dan bertanggung jawab atas kelancaran jadwal.</span>
              </label>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
          >
            Batal
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              !isPaid ||
              !selectedTherapistId ||
              selectedEvaluation?.status === 'INELIGIBLE' ||
              (selectedEvaluation?.status === 'WARNING' && !overrideWarningConfirmed) ||
              isSubmitting
            }
            className="px-5 py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0E3D73] text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <UserCheck className="w-4 h-4 text-[#D4AF37]" />
            <span>
              {isSubmitting
                ? 'Memproses Penugasan...'
                : isReassign
                ? 'Konfirmasi Ganti Terapis'
                : 'Tugaskan Terapis Sekarang'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
