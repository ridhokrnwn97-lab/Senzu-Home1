import React, { useState, useEffect, useMemo } from 'react';
import {
  Booking,
  Therapist,
  AppSettings,
  TherapistLocation,
  OperationalAlert,
  ServiceItem,
  OperationalSettings,
} from '../types';
import { useAuth } from '../context/AuthContext';
import { subscribeToActiveTherapistLocations, DEFAULT_SERVICES } from '../lib/dbService';
import { computeOperationalAlerts } from '../lib/supervisorAlerts';
import { getOperationalSettings } from '../lib/masterDataService';
import { SupervisorHeader } from './supervisor/SupervisorHeader';
import { SupervisorKpiSummary, OperationsFilterType } from './supervisor/SupervisorKpiSummary';
import { SupervisorAlertBar } from './supervisor/SupervisorAlertBar';
import { SupervisorOperationsTable } from './supervisor/SupervisorOperationsTable';
import { SupervisorTherapistBoard } from './supervisor/SupervisorTherapistBoard';
import { SupervisorRosterCalendarView } from './supervisor/SupervisorRosterCalendarView';
import { SupervisorAssignmentModal } from './supervisor/SupervisorAssignmentModal';
import { SupervisorOverrideModal } from './supervisor/SupervisorOverrideModal';
import { SupervisorDetailDrawer } from './supervisor/SupervisorDetailDrawer';
import { SupervisorAuditLogView } from './supervisor/SupervisorAuditLogView';
import { SupervisorCaseManagement } from './supervisor/SupervisorCaseManagement';
import { SupervisorLiveMap } from './SupervisorLiveMap';
import { CheckCircle2 } from 'lucide-react';

interface SupervisorControlRoomProps {
  bookings: Booking[];
  therapists: Therapist[];
  services?: ServiceItem[];
  settings?: AppSettings;
  onRefresh?: () => void;
}

export const SupervisorControlRoom: React.FC<SupervisorControlRoomProps> = ({
  bookings,
  therapists,
  services,
  settings,
  onRefresh,
}) => {
  const { currentUser } = useAuth();

  // Control Room Navigation
  const [activeView, setActiveView] = useState<'BOARD' | 'MAP' | 'ROSTER' | 'THERAPISTS' | 'AUDIT' | 'CASES'>('BOARD');
  const [activeFilter, setActiveFilter] = useState<OperationsFilterType>('TODAY');
  
  // Real-time Therapist Locations
  const [activeLocations, setActiveLocations] = useState<Record<string, TherapistLocation>>({});
  
  // Acknowledged Alerts
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<Set<string>>(new Set());

  // Modals & Drawers
  const [selectedBookingForDetail, setSelectedBookingForDetail] = useState<Booking | null>(null);
  const [selectedBookingForAssign, setSelectedBookingForAssign] = useState<Booking | null>(null);
  const [selectedBookingForOverride, setSelectedBookingForOverride] = useState<Booking | null>(null);

  // Success Feedback
  const [successNotice, setSuccessNotice] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [opSettings, setOpSettings] = useState<OperationalSettings | null>(null);

  // Load operational settings for live dynamic thresholds
  useEffect(() => {
    getOperationalSettings().then(setOpSettings).catch(() => {});
  }, []);

  // Real-time listener for active therapist locations
  useEffect(() => {
    const unsubscribe = subscribeToActiveTherapistLocations((locations) => {
      const locMap: Record<string, TherapistLocation> = {};
      if (Array.isArray(locations)) {
        locations.forEach((loc) => {
          if (loc && loc.therapistId) {
            locMap[loc.therapistId] = loc;
          }
        });
      }
      setActiveLocations(locMap);
    });
    return () => unsubscribe();
  }, []);

  // Compute dynamic operational alerts
  const alerts = useMemo(() => {
    return computeOperationalAlerts(bookings, therapists, activeLocations, acknowledgedAlertIds, opSettings || undefined);
  }, [bookings, therapists, activeLocations, acknowledgedAlertIds, opSettings]);

  const criticalAlertCount = alerts.filter((a) => a.priority === 'CRITICAL').length;

  const handleAcknowledgeAlert = (alertId: string) => {
    setAcknowledgedAlertIds((prev) => {
      const next = new Set(prev);
      next.add(alertId);
      return next;
    });
  };

  const handleAlertAction = (alert: OperationalAlert) => {
    const targetBooking = bookings.find((b) => b.id === alert.bookingId);
    if (!targetBooking) return;

    if (alert.actionType === 'assign' || alert.actionType === 'reassign') {
      setSelectedBookingForAssign(targetBooking);
    } else if (alert.actionType === 'view_tracking') {
      setActiveView('MAP');
    } else {
      setSelectedBookingForDetail(targetBooking);
    }
  };

  const handleManualRefresh = () => {
    if (onRefresh) {
      setIsRefreshing(true);
      onRefresh();
      setTimeout(() => setIsRefreshing(false), 800);
    }
  };

  const showSuccessFeedback = (msg: string) => {
    setSuccessNotice(msg);
    setTimeout(() => setSuccessNotice(''), 4500);
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Control Room Master Header */}
      <SupervisorHeader
        userName={currentUser?.name || 'Supervisor Operasional'}
        userRole={currentUser?.role || 'supervisor'}
        activeView={activeView}
        onViewChange={setActiveView}
        alertCount={alerts.length}
        criticalAlertCount={criticalAlertCount}
        onAlertBellClick={() => {
          setActiveView('BOARD');
        }}
        onManualRefresh={onRefresh ? handleManualRefresh : undefined}
        isRefreshing={isRefreshing}
      />

      {/* Global Success Notification */}
      {successNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs sm:text-sm flex items-center gap-2.5 animate-fade-in font-semibold shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Dynamic Actionable Alert Bar (Always visible across operations if alerts exist) */}
      {alerts.length > 0 && activeView === 'BOARD' && (
        <SupervisorAlertBar
          alerts={alerts}
          onActionClick={handleAlertAction}
          onAcknowledgeAlert={handleAcknowledgeAlert}
        />
      )}

      {/* VIEW 1: Operations Board (Papan Operasi Hari Ini) */}
      {activeView === 'BOARD' && (
        <div className="space-y-4">
          {/* KPI Cards Summary */}
          <SupervisorKpiSummary
            bookings={bookings}
            therapists={therapists}
            activeFilter={activeFilter}
            onFilterSelect={setActiveFilter}
          />

          {/* Central Operations Table & Cards */}
          <SupervisorOperationsTable
            bookings={bookings}
            therapists={therapists}
            activeLocations={activeLocations}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onOpenBookingDetail={setSelectedBookingForDetail}
            onOpenAssignModal={setSelectedBookingForAssign}
            onOpenOverrideModal={setSelectedBookingForOverride}
          />
        </div>
      )}

      {/* VIEW 2: Live Operations Map (Peta Live Armada) */}
      {activeView === 'MAP' && (
        <div className="space-y-4">
          <div className="p-3 bg-white rounded-2xl border border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold text-[#4B2B18]">
              Live GPS Tracking Armada Terapis Kota Palembang (Radius 15 KM)
            </span>
            <span className="text-[11px] text-slate-400">
              Pembaruan realtime setiap 10 detik via Firestore
            </span>
          </div>

          <SupervisorLiveMap
            bookings={bookings}
            therapists={therapists}
            settings={settings}
          />
        </div>
      )}

      {/* VIEW 3: Therapist Roster & Operational Calendar */}
      {activeView === 'ROSTER' && (
        <SupervisorRosterCalendarView
          therapists={therapists}
          bookings={bookings}
          services={services || DEFAULT_SERVICES}
          settings={settings}
          onSelectBooking={setSelectedBookingForDetail}
          onOpenAssignModal={setSelectedBookingForAssign}
        />
      )}

      {/* VIEW 4: Therapist Fleet Monitoring */}
      {activeView === 'THERAPISTS' && (
        <SupervisorTherapistBoard
          therapists={therapists}
          bookings={bookings}
          activeLocations={activeLocations}
          onAssignTherapist={(th) => {
            // Find first unassigned paid booking
            const unassigned = bookings.find(
              (b) => !b.therapistId && !['Completed', 'Cancelled'].includes(b.status)
            );
            if (unassigned) {
              setSelectedBookingForAssign(unassigned);
            } else {
              showSuccessFeedback(`Tidak ada booking yang membutuhkan penugasan saat ini.`);
            }
          }}
          onOpenMapForTherapist={(thId) => {
            setActiveView('MAP');
          }}
        />
      )}

      {/* VIEW 5: Audit Trail Operasional */}
      {activeView === 'AUDIT' && (
        <SupervisorAuditLogView />
      )}

      {/* VIEW 6: Insiden & Manajemen Kasus Operasional */}
      {activeView === 'CASES' && (
        <SupervisorCaseManagement
          bookings={bookings}
          therapists={therapists}
          currentUser={{
            id: (currentUser as any)?.id || currentUser?.uid || 'supervisor_user',
            name: currentUser?.name || 'Supervisor Operasional',
            role: 'supervisor',
          }}
        />
      )}

      {/* MODAL 1: Assignment & Reassignment Modal */}
      {selectedBookingForAssign && (
        <SupervisorAssignmentModal
          booking={selectedBookingForAssign}
          therapists={therapists}
          services={services}
          allBookings={bookings}
          isOpen={!!selectedBookingForAssign}
          settings={settings}
          onClose={() => setSelectedBookingForAssign(null)}
          onSuccess={(msg) => {
            showSuccessFeedback(msg);
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* MODAL 2: Operational Override Modal */}
      {selectedBookingForOverride && (
        <SupervisorOverrideModal
          booking={selectedBookingForOverride}
          isOpen={!!selectedBookingForOverride}
          onClose={() => setSelectedBookingForOverride(null)}
          onSuccess={(msg) => {
            showSuccessFeedback(msg);
            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* DRAWER: Booking Details & History Drawer */}
      {selectedBookingForDetail && (
        <SupervisorDetailDrawer
          booking={selectedBookingForDetail}
          isOpen={!!selectedBookingForDetail}
          onClose={() => setSelectedBookingForDetail(null)}
          onOpenAssign={(b) => {
            setSelectedBookingForDetail(null);
            setSelectedBookingForAssign(b);
          }}
          onOpenOverride={(b) => {
            setSelectedBookingForDetail(null);
            setSelectedBookingForOverride(b);
          }}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};
