import React, { useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Clock,
  Car,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Phone,
  UserCheck,
  MapPin,
  X,
} from 'lucide-react';
import { OperationalAlert } from '../../types';

interface SupervisorAlertBarProps {
  alerts: OperationalAlert[];
  onActionClick: (alert: OperationalAlert) => void;
  onAcknowledgeAlert: (alertId: string) => void;
}

export const SupervisorAlertBar: React.FC<SupervisorAlertBarProps> = ({
  alerts = [],
  onActionClick,
  onAcknowledgeAlert,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedPriority, setSelectedPriority] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'NORMAL'>('ALL');

  const safeAlerts = alerts || [];

  if (safeAlerts.length === 0) {
    return null;
  }

  const criticalCount = safeAlerts.filter((a) => a.priority === 'CRITICAL').length;
  const highCount = safeAlerts.filter((a) => a.priority === 'HIGH').length;
  const normalCount = safeAlerts.filter((a) => a.priority === 'NORMAL').length;

  const filteredAlerts = safeAlerts.filter((a) => {
    if (selectedPriority === 'ALL') return true;
    return a.priority === selectedPriority;
  });

  const getPriorityStyle = (priority: OperationalAlert['priority']) => {
    switch (priority) {
      case 'CRITICAL':
        return {
          cardBg: 'bg-rose-50/90 border-rose-300 text-rose-950',
          badgeBg: 'bg-rose-600 text-white',
          btnBg: 'bg-rose-700 hover:bg-rose-800 text-white',
          icon: AlertTriangle,
          iconColor: 'text-rose-600',
        };
      case 'HIGH':
        return {
          cardBg: 'bg-amber-50/90 border-amber-300 text-amber-950',
          badgeBg: 'bg-amber-600 text-white',
          btnBg: 'bg-amber-700 hover:bg-amber-800 text-white',
          icon: AlertCircle,
          iconColor: 'text-amber-600',
        };
      case 'NORMAL':
        return {
          cardBg: 'bg-blue-50/80 border-blue-200 text-blue-950',
          badgeBg: 'bg-blue-600 text-white',
          btnBg: 'bg-blue-700 hover:bg-blue-800 text-white',
          icon: Clock,
          iconColor: 'text-blue-600',
        };
      case 'LOW':
      default:
        return {
          cardBg: 'bg-slate-50 border-slate-200 text-slate-800',
          badgeBg: 'bg-slate-600 text-white',
          btnBg: 'bg-slate-700 hover:bg-slate-800 text-white',
          icon: Sparkles,
          iconColor: 'text-slate-500',
        };
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in">
      {/* Alert Header Bar */}
      <div
        className={`px-4 py-3 flex items-center justify-between transition cursor-pointer ${
          criticalCount > 0
            ? 'bg-rose-600 text-white'
            : highCount > 0
            ? 'bg-amber-600 text-white'
            : 'bg-[#8B5A36] text-white'
        }`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-[#D4AF37] animate-bounce" />
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">
              Perlu Tindakan Operasional ({alerts.length})
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-bold">
              {criticalCount > 0 && (
                <span className="bg-white text-rose-700 px-2 py-0.5 rounded-full shadow-2xs">
                  {criticalCount} Kritis
                </span>
              )}
              {highCount > 0 && (
                <span className="bg-white/90 text-amber-800 px-2 py-0.5 rounded-full shadow-2xs">
                  {highCount} Tinggi
                </span>
              )}
              {normalCount > 0 && (
                <span className="bg-white/80 text-blue-800 px-2 py-0.5 rounded-full shadow-2xs">
                  {normalCount} Normal
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold">
          <span>{isExpanded ? 'Tutup Peringatan' : 'Buka Peringatan'}</span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 space-y-3 bg-[#FCFBFA]">
          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 text-xs font-semibold overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedPriority('ALL')}
              className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                selectedPriority === 'ALL'
                  ? 'bg-[#8B5A36] text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Semua ({alerts.length})
            </button>
            {criticalCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedPriority('CRITICAL')}
                className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                  selectedPriority === 'CRITICAL'
                    ? 'bg-rose-700 text-white'
                    : 'bg-white border border-rose-200 text-rose-700 hover:bg-rose-50'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span>Kritis ({criticalCount})</span>
              </button>
            )}
            {highCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedPriority('HIGH')}
                className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                  selectedPriority === 'HIGH'
                    ? 'bg-amber-700 text-white'
                    : 'bg-white border border-amber-200 text-amber-700 hover:bg-amber-50'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>Tinggi ({highCount})</span>
              </button>
            )}
            {normalCount > 0 && (
              <button
                type="button"
                onClick={() => setSelectedPriority('NORMAL')}
                className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                  selectedPriority === 'NORMAL'
                    ? 'bg-blue-700 text-white'
                    : 'bg-white border border-blue-200 text-blue-700 hover:bg-blue-50'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span>Normal ({normalCount})</span>
              </button>
            )}
          </div>

          {/* Alert Cards List */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(filteredAlerts || []).map((alert) => {
              const style = getPriorityStyle(alert.priority);
              const Icon = style.icon;

              return (
                <div
                  key={alert.id}
                  className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 shadow-2xs transition hover:shadow-xs ${style.cardBg}`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${style.badgeBg}`}
                        >
                          {alert.priority}
                        </span>
                        {alert.bookingCode && (
                          <span className="text-[11px] font-mono font-bold text-slate-800">
                            {alert.bookingCode}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition cursor-pointer"
                        title="Tandai Sudah Ditinjau"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="font-bold text-xs text-slate-900 leading-snug flex items-center gap-1.5">
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${style.iconColor}`} />
                      <span>{alert.title}</span>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {alert.message}
                    </p>
                  </div>

                  {/* Actions row */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-black/5">
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 transition cursor-pointer underline"
                    >
                      Abaikan / Ditinjau
                    </button>

                    <button
                      type="button"
                      onClick={() => onActionClick(alert)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs ${style.btnBg}`}
                    >
                      <span>{alert.actionLabel}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
