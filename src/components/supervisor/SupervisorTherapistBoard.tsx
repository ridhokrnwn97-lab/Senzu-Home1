import React, { useState } from 'react';
import {
  Users,
  MapPin,
  Phone,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Calendar,
  Search,
  SlidersHorizontal,
  Car,
  MessageCircle,
  Coffee,
  PowerOff,
  UserCheck,
} from 'lucide-react';
import { Therapist, Booking, TherapistLocation } from '../../types';
import { supervisorUpdateTherapistShiftStatus } from '../../lib/dbService';
import { useAuth } from '../../context/AuthContext';

interface SupervisorTherapistBoardProps {
  therapists: Therapist[];
  bookings: Booking[];
  activeLocations: Record<string, TherapistLocation>;
  onAssignTherapist?: (therapist: Therapist) => void;
  onOpenMapForTherapist?: (therapistId: string) => void;
}

export const SupervisorTherapistBoard: React.FC<SupervisorTherapistBoardProps> = ({
  therapists = [],
  bookings = [],
  activeLocations = {},
  onAssignTherapist,
  onOpenMapForTherapist,
}) => {
  const { currentUser } = useAuth();
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'ON_DUTY' | 'BREAK' | 'OFF'>('ALL');
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const nowMillis = Date.now();

  const safeTherapists = therapists || [];
  const safeBookings = bookings || [];
  const safeLocations = activeLocations || {};

  const handleStatusChange = async (
    therapist: Therapist,
    newStatus: 'available' | 'on_duty' | 'off' | 'busy' | 'break'
  ) => {
    setUpdatingId(therapist.id);
    try {
      await supervisorUpdateTherapistShiftStatus(
        therapist.id,
        therapist.name,
        newStatus,
        currentUser?.name || 'Supervisor',
        `Pembaruan shift operasional oleh Supervisor`
      );
      setFeedback(`Status ${therapist.name} berhasil diubah ke ${newStatus}.`);
      setTimeout(() => setFeedback(''), 3000);
    } catch (err: any) {
      alert(`Gagal mengubah status shift: ${err.message || err}`);
    } finally {
      setUpdatingId(null);
    }
  };

  // Enhance therapists with real-time operational state
  const therapistList = safeTherapists
    .filter((th) => {
      if (!th) return false;
      if (filter === 'AVAILABLE' && th.status !== 'available') return false;
      if (filter === 'ON_DUTY' && th.status !== 'on_duty') return false;
      if (filter === 'BREAK' && th.status !== 'break') return false;
      if (filter === 'OFF' && th.status !== 'off') return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          (th.name || '').toLowerCase().includes(q) ||
          (th.phone || '').toLowerCase().includes(q) ||
          (th.gender || '').toLowerCase().includes(q)
        );
      }
      return true;
    })
    .map((th) => {
      // Find today's bookings
      const todayJobs = safeBookings.filter(
        (b) => b && b.therapistId === th.id && b.scheduleDate === todayStr && b.status !== 'Cancelled'
      );

      // Current active booking
      const activeBooking = todayJobs.find((b) =>
        b?.status && ['Therapist Assigned', 'Accepted', 'On The Way', 'Arrived', 'Treatment'].includes(b.status)
      );

      // Completed today
      const completedToday = todayJobs.filter((b) => b?.status === 'Completed').length;

      // Next scheduled today
      const upcomingJobs = todayJobs.filter((b) =>
        b?.status && ['Confirmed', 'Therapist Assigned'].includes(b.status) && b.id !== activeBooking?.id
      );

      // Live GPS
      const liveLoc = safeLocations[th.id];
      let gpsAgeMinutes = 999;
      if (liveLoc) {
        gpsAgeMinutes = Math.round((nowMillis - (liveLoc.updatedAtMillis || new Date(liveLoc.timestamp).getTime())) / 60000);
      }

      const isGpsStale = activeBooking?.status === 'On The Way' && gpsAgeMinutes >= 3;

      return {
        ...th,
        todayJobsCount: todayJobs.length,
        completedToday,
        activeBooking,
        upcomingJobs,
        liveLoc,
        gpsAgeMinutes,
        isGpsStale,
      };
    });

  const getStatusBadge = (status: Therapist['status']) => {
    switch (status) {
      case 'available':
        return { label: 'Standby / Siap Bertugas', bg: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'on_duty':
        return { label: 'Sedang Bertugas (On Duty)', bg: 'bg-amber-100 text-amber-800 border-amber-300' };
      case 'break':
        return { label: 'Istirahat (Break)', bg: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'off':
      default:
        return { label: 'Off Duty (Libur)', bg: 'bg-slate-100 text-slate-700 border-slate-300' };
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
      {/* Top Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base sm:text-lg font-bold font-serif text-[#082A4F] flex items-center gap-2">
            <Users className="w-5 h-5 text-[#D4AF37]" />
            <span>Monitoring Armada Terapis Palembang</span>
          </h3>
          <p className="text-xs text-slate-500">
            Status shift harian, beban kerja, dan pemantauan sinyal GPS armada
          </p>
        </div>

        {/* Status Filters */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              filter === 'ALL' ? 'bg-[#082A4F] text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Semua ({therapists.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('AVAILABLE')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1 ${
              filter === 'AVAILABLE' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Standby ({safeTherapists.filter((t) => t?.status === 'available').length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('ON_DUTY')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1 ${
              filter === 'ON_DUTY' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>Bertugas ({safeTherapists.filter((t) => t?.status === 'on_duty').length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('BREAK')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              filter === 'BREAK' ? 'bg-blue-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Break ({safeTherapists.filter((t) => t?.status === 'break').length})
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Grid of Therapist Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(therapistList || []).map((item) => {
          const badge = getStatusBadge(item.status);

          return (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border transition shadow-xs flex flex-col justify-between gap-3.5 bg-white ${
                item.isGpsStale ? 'border-amber-400 bg-amber-50/20' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* Top Row: Avatar + Name + Rating */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#082A4F] text-[#D4AF37] font-serif font-bold text-lg flex items-center justify-center shadow-xs">
                      {item.name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#082A4F] flex items-center gap-1.5">
                        <span>{item.name}</span>
                        <span className="text-[11px] font-normal text-slate-500">
                          ({item.gender === 'Perempuan' ? 'P' : 'L'})
                        </span>
                      </h4>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                        <span className="text-amber-500 font-bold">★ {item.rating}</span>
                        <span>•</span>
                        <span>{item.totalCompleted} order selesai</span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Specialties tags */}
                {item.specialties && item.specialties.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(item.specialties || []).map((s, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Active Booking Box */}
                {item.activeBooking ? (
                  <div className="p-3 rounded-xl bg-[#FAF9F6] border border-amber-200/80 text-xs space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#082A4F]">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
                        <span>Order Aktif: {item.activeBooking.bookingCode}</span>
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                        {item.activeBooking.status}
                      </span>
                    </div>
                    <div className="text-slate-700">
                      Pelanggan: <strong>{item.activeBooking.customerName}</strong>
                    </div>
                    <div className="text-slate-500 truncate">
                      Area: {item.activeBooking.area}
                    </div>

                    {/* GPS Status */}
                    {item.liveLoc && (
                      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200">
                        <span className="flex items-center gap-1 text-emerald-700 font-semibold font-mono">
                          <MapPin className="w-3 h-3" />
                          <span>Akurasi ±{item.liveLoc.accuracy}m</span>
                        </span>
                        <span
                          className={`text-[10px] ${
                            item.isGpsStale ? 'text-rose-600 font-bold' : 'text-slate-400'
                          }`}
                        >
                          {item.gpsAgeMinutes <= 0 ? 'Baru saja' : `${item.gpsAgeMinutes} mnt lalu`}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between font-medium">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Tidak ada tugas aktif saat ini</span>
                    </span>
                    <span className="text-[10px] text-emerald-700 font-bold">Siap Bertugas</span>
                  </div>
                )}

                {/* Workload Summary Today (STRICTLY NO SALARY/FINANCIAL COMPENSATION) */}
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500 font-medium">Tugas Hari Ini</div>
                    <div className="font-bold text-sm text-[#082A4F] font-mono">
                      {item.todayJobsCount}
                    </div>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[10px] text-slate-500 font-medium">Selesai Hari Ini</div>
                    <div className="font-bold text-sm text-emerald-700 font-mono">
                      {item.completedToday}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {/* Shift Selector */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-500 font-medium">Status Shift:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleStatusChange(item, 'available')}
                      disabled={updatingId === item.id || item.status === 'available'}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        item.status === 'available'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
                      }`}
                      title="Set Standby"
                    >
                      Standby
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStatusChange(item, 'break')}
                      disabled={updatingId === item.id || item.status === 'break'}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        item.status === 'break'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700'
                      }`}
                      title="Set Istirahat"
                    >
                      Break
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStatusChange(item, 'off')}
                      disabled={updatingId === item.id || item.status === 'off'}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        item.status === 'off'
                          ? 'bg-slate-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                      title="Set Off"
                    >
                      Off
                    </button>
                  </div>
                </div>

                {/* Contact & Map links */}
                <div className="flex items-center gap-2">
                  <a
                    href={`https://wa.me/${item.phone.replace(/\D/g, '')}?text=Halo%20${encodeURIComponent(item.name)},%20pesan%20dari%20Supervisor%20Operasional%20Senzu`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 px-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>WhatsApp</span>
                  </a>

                  {onOpenMapForTherapist && (
                    <button
                      type="button"
                      onClick={() => onOpenMapForTherapist(item.id)}
                      className="py-1.5 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      title="Lihat Posisi di Peta"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#082A4F]" />
                      <span>Peta</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
