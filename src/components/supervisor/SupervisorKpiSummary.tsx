import React from 'react';
import {
  Calendar,
  AlertCircle,
  Clock,
  Car,
  Sparkles,
  CheckCircle2,
  Users,
  CreditCard,
  Check,
} from 'lucide-react';
import { Booking, Therapist } from '../../types';
import { isPaymentPaid } from '../../lib/paymentService';

export type OperationsFilterType =
  | 'ALL'
  | 'TODAY'
  | 'ACTIVE'
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'OTW'
  | 'TREATMENT'
  | 'COMPLETED'
  | 'UNPAID'
  | 'RISK';

interface SupervisorKpiSummaryProps {
  bookings: Booking[];
  therapists: Therapist[];
  activeFilter: OperationsFilterType;
  onFilterSelect: (filter: OperationsFilterType) => void;
}

export const SupervisorKpiSummary: React.FC<SupervisorKpiSummaryProps> = ({
  bookings = [],
  therapists = [],
  activeFilter,
  onFilterSelect,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const safeBookings = bookings || [];
  const safeTherapists = therapists || [];

  const todayBookings = safeBookings.filter((b) => b?.scheduleDate === todayStr);
  const activeOrders = safeBookings.filter(
    (b) => b?.status && !['Completed', 'Cancelled'].includes(b.status)
  );

  const unassignedPaid = safeBookings.filter(
    (b) =>
      b &&
      !b.therapistId &&
      isPaymentPaid(b.paymentStatus) &&
      !['Completed', 'Cancelled'].includes(b.status)
  );

  const assignedOrAccepted = safeBookings.filter((b) =>
    b?.status && ['Therapist Assigned', 'Accepted'].includes(b.status)
  );

  const onTheWayOrders = safeBookings.filter((b) => b?.status === 'On The Way');
  const inTreatmentOrders = safeBookings.filter((b) => b?.status && ['Arrived', 'Treatment'].includes(b.status));
  const completedToday = todayBookings.filter((b) => b?.status === 'Completed');
  const unpaidOrders = safeBookings.filter(
    (b) => b?.status && !isPaymentPaid(b.paymentStatus) && !['Completed', 'Cancelled'].includes(b.status)
  );

  const availableTherapists = safeTherapists.filter((t) => t?.status === 'available');
  const onDutyTherapists = safeTherapists.filter((t) => t?.status === 'on_duty');

  const kpis = [
    {
      id: 'TODAY' as OperationsFilterType,
      title: 'Jadwal Hari Ini',
      count: todayBookings.length,
      icon: Calendar,
      accent: 'text-[#4B2B18] bg-blue-50 border-blue-200',
      activeClass: 'ring-2 ring-[#8B5A36] bg-blue-50/50',
      subtitle: `${completedToday.length} selesai`,
    },
    {
      id: 'UNASSIGNED' as OperationsFilterType,
      title: 'Belum Ditugaskan',
      count: unassignedPaid.length,
      icon: AlertCircle,
      accent: unassignedPaid.length > 0 ? 'text-amber-700 bg-amber-50 border-amber-300' : 'text-slate-600 bg-slate-50 border-slate-200',
      activeClass: 'ring-2 ring-amber-600 bg-amber-50/70',
      subtitle: 'Siap assign (Lunas)',
      urgent: unassignedPaid.length > 0,
    },
    {
      id: 'ASSIGNED' as OperationsFilterType,
      title: 'Terapis Ditugaskan',
      count: assignedOrAccepted.length,
      icon: Users,
      accent: 'text-indigo-700 bg-indigo-50 border-indigo-200',
      activeClass: 'ring-2 ring-indigo-600 bg-indigo-50/60',
      subtitle: 'Menunggu berangkat',
    },
    {
      id: 'OTW' as OperationsFilterType,
      title: 'Sedang Meluncur',
      count: onTheWayOrders.length,
      icon: Car,
      accent: 'text-amber-800 bg-amber-100/70 border-amber-300',
      activeClass: 'ring-2 ring-amber-700 bg-amber-100/80',
      subtitle: 'Live GPS aktif',
    },
    {
      id: 'TREATMENT' as OperationsFilterType,
      title: 'Dalam Treatment',
      count: inTreatmentOrders.length,
      icon: Sparkles,
      accent: 'text-teal-800 bg-teal-50 border-teal-200',
      activeClass: 'ring-2 ring-teal-700 bg-teal-50/70',
      subtitle: 'Layanan berlangsung',
    },
    {
      id: 'COMPLETED' as OperationsFilterType,
      title: 'Selesai Hari Ini',
      count: completedToday.length,
      icon: CheckCircle2,
      accent: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      activeClass: 'ring-2 ring-emerald-600 bg-emerald-50/60',
      subtitle: 'Order sukses',
    },
    {
      id: 'ACTIVE' as OperationsFilterType,
      title: 'Total Order Aktif',
      count: activeOrders.length,
      icon: Clock,
      accent: 'text-purple-700 bg-purple-50 border-purple-200',
      activeClass: 'ring-2 ring-purple-600 bg-purple-50/60',
      subtitle: `${onDutyTherapists.length} terapis bertugas`,
    },
    {
      id: 'UNPAID' as OperationsFilterType,
      title: 'Menunggu Bayar / Verif',
      count: unpaidOrders.length,
      icon: CreditCard,
      accent: 'text-slate-700 bg-slate-100 border-slate-200',
      activeClass: 'ring-2 ring-slate-700 bg-slate-100',
      subtitle: 'Lock assignment',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500 font-medium px-1">
        <span>Ringkasan Operasional Realtime (Klik kartu untuk memfilter tabel)</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Standby: <strong>{availableTherapists.length}</strong></span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span>Bertugas: <strong>{onDutyTherapists.length}</strong></span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3">
        {(kpis || []).map((kpi) => {
          const Icon = kpi.icon;
          const isSelected = activeFilter === kpi.id;

          return (
            <button
              key={kpi.id}
              type="button"
              onClick={() => onFilterSelect(isSelected ? 'ALL' : kpi.id)}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer relative flex flex-col justify-between bg-white shadow-xs hover:shadow-sm ${
                isSelected ? kpi.activeClass : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {kpi.urgent && (
                <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500"></span>
                </span>
              )}

              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-semibold text-slate-600 line-clamp-1 leading-tight">
                  {kpi.title}
                </span>
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 ${kpi.accent}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="text-xl sm:text-2xl font-bold font-mono text-[#4B2B18] tracking-tight">
                  {kpi.count}
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                  {kpi.subtitle}
                </div>
              </div>

              {isSelected && (
                <div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-[#4B2B18] uppercase tracking-wider">
                  <Check className="w-2.5 h-2.5" />
                  <span>Filter Aktif</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
