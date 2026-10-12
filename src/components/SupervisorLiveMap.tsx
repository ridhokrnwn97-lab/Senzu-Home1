import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap
} from '@vis.gl/react-google-maps';
import {
  ShieldCheck,
  Navigation,
  MapPin,
  User,
  Clock,
  Car,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Compass,
  SlidersHorizontal,
  Phone,
  Copy,
  Check,
  ExternalLink
} from 'lucide-react';
import {
  Booking,
  Therapist,
  TherapistLocation,
  AppSettings
} from '../types';
import {
  subscribeToActiveTherapistLocations,
  supervisorOverrideArrival,
  calculateDistanceKm
} from '../lib/dbService';
import { useAuth } from '../context/AuthContext';
import { useGoogleMaps } from './GoogleMapsProvider';

interface SupervisorLiveMapProps {
  bookings: Booking[];
  therapists: Therapist[];
  settings?: AppSettings;
}

class SupervisorMapErrorBoundary extends Component<
  { children: ReactNode; onErrorFallback: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('SupervisorLiveMap internal boundary caught an error:', error, info);
    this.props.onErrorFallback();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

type TherapistFilter = 'ALL' | 'ON_DUTY' | 'IDLE';

export const SupervisorLiveMap: React.FC<SupervisorLiveMapProps> = ({
  bookings = [],
  therapists = [],
  settings,
}) => {
  const { currentUser } = useAuth();
  const { isKeyProvided, hasAuthError, forceFallback, currentDomainPattern } = useGoogleMaps();
  const [mapRenderError, setMapRenderError] = useState(false);
  const shouldUseGoogleMaps = isKeyProvided && !hasAuthError && !forceFallback && !mapRenderError;

  const [activeLocations, setActiveLocations] = useState<Record<string, TherapistLocation>>({});
  const [filter, setFilter] = useState<TherapistFilter>('ALL');
  const [selectedEntity, setSelectedEntity] = useState<{
    type: 'therapist' | 'booking';
    data: any;
  } | null>(null);
  const [isOverriding, setIsOverriding] = useState(false);
  const [overrideNotice, setOverrideNotice] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const baseCenter = {
    lat: settings?.baseLatitude ?? -2.976074,
    lng: settings?.baseLongitude ?? 104.757305,
  };

  // Real-time listener for therapist locations
  useEffect(() => {
    const unsubscribe = subscribeToActiveTherapistLocations((locations) => {
      const map: Record<string, TherapistLocation> = {};
      locations.forEach((loc) => {
        if (loc.therapistId) {
          map[loc.therapistId] = loc;
        }
      });
      setActiveLocations(map);
    });

    return () => unsubscribe();
  }, []);

  // Filter therapists
  const filteredTherapists = therapists
    .filter((th) => {
      if (filter === 'ALL') return true;
      if (filter === 'ON_DUTY') return th.status === 'on_duty';
      if (filter === 'IDLE') return (th.status as any) === 'available' || (th.status as any) === 'off_duty' || th.status === 'off';
      return true;
    })
    .map((th) => {
      const live = activeLocations[th.id];
      const activeBooking = bookings.find(
        (b) =>
          b.therapistId === th.id &&
          ['Therapist Assigned', 'On The Way', 'Arrived', 'Treatment'].includes(b.status)
      );

      const lat = live?.latitude ?? baseCenter.lat + (Math.sin(th.id.charCodeAt(0) || 1) * 0.015);
      const lng = live?.longitude ?? baseCenter.lng + (Math.cos(th.id.charCodeAt(0) || 1) * 0.015);

      const statusType =
        activeBooking?.status === 'On The Way'
          ? 'on_the_way'
          : activeBooking?.status === 'Treatment' || activeBooking?.status === 'Arrived'
          ? 'at_location'
          : 'idle';

      return {
        therapist: th,
        latitude: lat,
        longitude: lng,
        liveGps: live,
        currentBooking: activeBooking,
        statusType,
      };
    });

  // Active bookings with coordinates
  const activeBookings = bookings.filter((b) =>
    ['Therapist Assigned', 'On The Way', 'Arrived', 'Treatment'].includes(b.status)
  );

  const handleOverrideArrival = async (booking: Booking) => {
    const reason = window.prompt(
      `Konfirmasi Override Kedatangan untuk Booking ${booking.bookingCode}?\n\n` +
      `Gunakan ini jika terapis ${booking.therapistName || ''} sudah tiba namun GPS terhalang sinyal.\n` +
      `Masukkan alasan override (opsional):`,
      'Verifikasi manual oleh Supervisor'
    );

    if (reason === null) return; // User cancelled

    setIsOverriding(true);
    try {
      await supervisorOverrideArrival(
        booking,
        currentUser?.name || 'Supervisor',
        reason || 'Override manual via Supervisor Live Operations Map'
      );
      setOverrideNotice(`Status booking ${booking.bookingCode} berhasil di-override ke "Arrived".`);
      setTimeout(() => setOverrideNotice(''), 5000);
      setSelectedEntity(null);
    } catch (err: any) {
      alert(`Gagal melakukan override: ${err.message || err}`);
    } finally {
      setIsOverriding(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentDomainPattern);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  return (
    <div className="space-y-4">
      {/* Top Filter & Counter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-[#082A4F] text-[#D4AF37] flex items-center justify-center">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#082A4F]">Peta Operasional Armada Palembang</h3>
            <p className="text-[11px] text-slate-500">
              Hub: {settings?.baseLocationName || 'Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan'}
            </p>
          </div>
        </div>

        {/* Filter Toggle */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
              filter === 'ALL'
                ? 'bg-[#082A4F] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Semua ({therapists.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('ON_DUTY')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              filter === 'ON_DUTY'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>Bertugas ({therapists.filter((t) => t.status === 'on_duty').length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('IDLE')}
            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
              filter === 'IDLE'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>Standby</span>
          </button>
        </div>
      </div>

      {/* Override Notice Banner */}
      {overrideNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fade-in shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{overrideNotice}</span>
        </div>
      )}

      {/* RefererNotAllowedMapError Notification / Guidance Box */}
      {hasAuthError && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-xs text-amber-950 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-bold text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>Otorisasi HTTP Referrer Google Maps Diperlukan</span>
            </div>
            <a
              href="https://console.cloud.google.com/google/maps-apis/credentials?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
              target="_blank"
              rel="noreferrer"
              className="text-amber-800 hover:underline flex items-center gap-1 text-[11px] font-semibold"
            >
              <span>Buka Google Cloud Console</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <p className="text-amber-850 text-xs leading-relaxed">
            Peta satelit Google Maps membutuhkan domain preview ini diizinkan pada pengaturan <strong>Website restrictions (HTTP Referrers)</strong> pada API Key Google Maps Anda:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="bg-amber-100/90 text-amber-950 px-2.5 py-1 rounded-lg font-mono text-[11px] border border-amber-300 select-all">
              {currentDomainPattern}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1 bg-[#082A4F] text-white hover:bg-[#0E3D73] rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? 'Tersalin!' : 'Salin Domain Referrer'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Map Container or Operations Dashboard Grid */}
      {shouldUseGoogleMaps ? (
        <SupervisorMapErrorBoundary onErrorFallback={() => setMapRenderError(true)}>
          <div className="relative w-full h-[400px] sm:h-[480px] rounded-2xl overflow-hidden border border-slate-200 shadow-inner">
            <Map
              defaultCenter={baseCenter}
              defaultZoom={12}
              gestureHandling="cooperative"
              disableDefaultUI={false}
              mapId="DEMO_MAP_ID"
              className="w-full h-full"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            >
              {/* Base Hub Marker */}
              <AdvancedMarker
                position={baseCenter}
                title={settings?.baseLocationName || 'Senzu Wellness Hub Palembang'}
              >
                <div className="relative flex flex-col items-center justify-center -translate-y-8 select-none">
                  <div className="w-9 h-9 rounded-full bg-[#082A4F] border-2 border-[#D4AF37] shadow-lg flex items-center justify-center text-[#D4AF37]">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="w-2.5 h-2.5 bg-[#082A4F] border-r-2 border-b-2 border-[#D4AF37] rotate-45 -mt-1" />
                </div>
              </AdvancedMarker>

              {/* Therapist Markers */}
              {(filteredTherapists || []).map((item) => {
                const pos = { lat: item.latitude, lng: item.longitude };
                const isOTW = item.statusType === 'on_the_way';
                const isAtLoc = item.statusType === 'at_location';
                const pinBg = isOTW ? 'bg-amber-600 border-amber-300' : isAtLoc ? 'bg-emerald-600 border-emerald-300' : 'bg-slate-600 border-slate-300';

                return (
                  <AdvancedMarker
                    key={item.therapist.id}
                    position={pos}
                    title={`${item.therapist.name} (${item.statusType})`}
                    onClick={() => setSelectedEntity({ type: 'therapist', data: item })}
                  >
                    <div className={`relative flex flex-col items-center justify-center -translate-y-7 select-none cursor-pointer transition-transform hover:scale-110`}>
                      <div className={`w-8 h-8 rounded-full ${pinBg} border-2 shadow-md flex items-center justify-center text-white`}>
                        <Car className="w-4 h-4" />
                      </div>
                      <div className={`w-2 h-2 ${pinBg.split(' ')[0]} border-r-2 border-b-2 border-white rotate-45 -mt-1`} />
                    </div>
                  </AdvancedMarker>
                );
              })}

              {/* Customer Booking Markers */}
              {(activeBookings || []).map((b) => {
                if (b.latitude == null || b.longitude == null) return null;
                return (
                  <AdvancedMarker
                    key={b.id}
                    position={{ lat: b.latitude, lng: b.longitude }}
                    title={`Order: ${b.customerName} (${b.status})`}
                    onClick={() => setSelectedEntity({ type: 'booking', data: b })}
                  >
                    <div className="relative flex flex-col items-center justify-center -translate-y-6 select-none cursor-pointer transition-transform hover:scale-110">
                      <div className="w-7 h-7 rounded-full bg-rose-600 border-2 border-white shadow-md flex items-center justify-center text-white">
                        <MapPin className="w-3.5 h-3.5" />
                      </div>
                      <div className="w-2 h-2 bg-rose-600 border-r-2 border-b-2 border-white rotate-45 -mt-1" />
                    </div>
                  </AdvancedMarker>
                );
              })}

              {/* Info Window for Selected Entity */}
              {selectedEntity && (
                <InfoWindow
                position={
                  selectedEntity.type === 'therapist'
                    ? { lat: selectedEntity.data.latitude, lng: selectedEntity.data.longitude }
                    : { lat: selectedEntity.data.latitude, lng: selectedEntity.data.longitude }
                }
                onCloseClick={() => setSelectedEntity(null)}
              >
                <div className="p-2 max-w-[260px] text-slate-800 space-y-2">
                  {selectedEntity.type === 'therapist' ? (
                    <div>
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1.5">
                        <span className="font-bold text-sm text-[#082A4F]">
                          {selectedEntity.data.therapist.name}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            selectedEntity.data.statusType === 'on_the_way'
                              ? 'bg-amber-100 text-amber-800'
                              : selectedEntity.data.statusType === 'at_location'
                              ? 'bg-teal-100 text-teal-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {selectedEntity.data.statusType === 'on_the_way'
                            ? 'On The Way'
                            : selectedEntity.data.statusType === 'at_location'
                            ? 'At Location'
                            : 'Standby / Idle'}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-600 mt-1.5 space-y-1">
                        <div>Gender: <strong>{selectedEntity.data.therapist.gender}</strong></div>
                        <div>Rating: <strong>★ {selectedEntity.data.therapist.rating}</strong></div>
                        {selectedEntity.data.liveGps && (
                          <div className="text-emerald-700 font-mono">
                            Live GPS: Akurasi ±{selectedEntity.data.liveGps.accuracy}m
                          </div>
                        )}
                      </div>

                      {selectedEntity.data.currentBooking ? (
                        <div className="mt-2 p-2 bg-[#FAF9F6] rounded-xl border border-slate-200 text-[11px] space-y-1">
                          <div className="font-bold text-[#082A4F]">
                            Order: {selectedEntity.data.currentBooking.bookingCode}
                          </div>
                          <div className="text-slate-700 truncate">
                            Cust: {selectedEntity.data.currentBooking.customerName}
                          </div>
                          <div className="text-slate-500 truncate">
                            {selectedEntity.data.currentBooking.area}
                          </div>

                          {selectedEntity.data.currentBooking.status === 'On The Way' && (
                            <button
                              type="button"
                              onClick={() => handleOverrideArrival(selectedEntity.data.currentBooking)}
                              disabled={isOverriding}
                              className="w-full mt-2 py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-xs"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              <span>{isOverriding ? 'Memproses...' : 'Override Kedatangan (Arrived)'}</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] text-slate-400 italic">
                          Siap menerima penugasan baru.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="font-bold text-sm text-[#082A4F]">
                        {selectedEntity.data.customerName}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {selectedEntity.data.bookingCode} • {selectedEntity.data.status}
                      </div>
                      <div className="text-[11px] text-slate-700 mt-1">
                        <strong>Alamat:</strong> {selectedEntity.data.address} ({selectedEntity.data.area})
                      </div>
                      {selectedEntity.data.status === 'On The Way' && (
                        <button
                          type="button"
                          onClick={() => handleOverrideArrival(selectedEntity.data)}
                          disabled={isOverriding}
                          className="w-full mt-2 py-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer shadow-xs"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>Override Kedatangan (Arrived)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </InfoWindow>
            )}
          </Map>

          {/* Legend Overlay */}
          <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xs p-2.5 rounded-2xl shadow-md border border-slate-200 text-[10px] space-y-1 text-slate-700 pointer-events-none">
            <div className="font-bold text-slate-900 border-b border-slate-100 pb-1">
              Status Armada
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Standby / Siap Bertugas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <span>On The Way (Perjalanan)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-600"></span>
              <span>Treatment / Sedang Melayani</span>
            </div>
          </div>
        </div>
      </SupervisorMapErrorBoundary>
    ) : (
        /* Fallback Operational Table & Fleet Roster */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-bold text-[#082A4F]">Status Tracking Armada Realtime</h4>
              <p className="text-[11px] text-slate-500">
                Mode fallback operasional aktif (GPS coordinates update via Firestore)
              </p>
            </div>
            <span className="px-2.5 py-1 bg-slate-100 rounded-lg text-[11px] font-semibold text-slate-700">
              {filteredTherapists.length} Terapis Terdata
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(filteredTherapists || []).map((item) => {
              const live = item.liveGps;
              const current = item.currentBooking;
              return (
                <div
                  key={item.therapist.id}
                  className="p-4 rounded-2xl border border-slate-200 bg-[#FAF9F6] space-y-3 hover:border-[#082A4F]/30 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-sm text-[#082A4F] flex items-center gap-1.5">
                        <User className="w-4 h-4 text-[#B89628]" />
                        <span>{item.therapist.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {item.therapist.gender === 'Perempuan' || (item.therapist.gender as any) === 'female' ? 'Wanita' : 'Pria'} • Rating ★ {item.therapist.rating}
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                        item.statusType === 'on_the_way'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : item.statusType === 'at_location'
                          ? 'bg-teal-100 text-teal-900 border border-teal-300'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {item.statusType === 'on_the_way'
                        ? 'On The Way'
                        : item.statusType === 'at_location'
                        ? 'Di Lokasi'
                        : 'Standby'}
                    </span>
                  </div>

                  {/* Booking Information */}
                  {current ? (
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-bold text-[#082A4F]">
                        <span>Kode: {current.bookingCode}</span>
                        <span className="text-amber-700 text-[11px]">{current.status}</span>
                      </div>
                      <div className="text-slate-700">
                        Customer: <strong>{current.customerName}</strong> ({current.area})
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        Alamat: {current.address}
                      </div>

                      {/* Override Button for Supervisors */}
                      {current.status === 'On The Way' && (
                        <button
                          type="button"
                          onClick={() => handleOverrideArrival(current)}
                          disabled={isOverriding}
                          className="w-full mt-2 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>{isOverriding ? 'Memproses Override...' : 'Override Kedatangan (Tiba di Lokasi)'}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 italic bg-white p-2.5 rounded-xl border border-slate-100">
                      Terapis standby di Hub / siap menerima order booking berikutnya.
                    </div>
                  )}

                  {/* Live GPS Coordinates Info */}
                  <div className="text-[11px] font-mono text-slate-600 flex items-center justify-between border-t border-slate-200/60 pt-2">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-rose-500" />
                      <span>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</span>
                    </span>
                    {live?.accuracy && (
                      <span className="text-emerald-700 font-semibold">
                        Akurasi ±{live.accuracy}m
                      </span>
                    )}
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
