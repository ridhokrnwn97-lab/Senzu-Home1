import React, { useState, useEffect, useRef, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import {
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary
} from '@vis.gl/react-google-maps';
import {
  Navigation,
  MapPin,
  Clock,
  RefreshCw,
  Car,
  Home,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  ExternalLink,
  MessageCircle,
  Copy,
  Check,
  Phone
} from 'lucide-react';
import { Booking, TherapistLocation, AppSettings, OperationalSettings } from '../types';
import { subscribeToTherapistLocation, calculateDistanceKm } from '../lib/dbService';
import { emitEvent } from '../lib/notificationService';
import { useGoogleMaps } from './GoogleMapsProvider';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';

interface CustomerLiveMapProps {
  booking: Booking;
  settings?: AppSettings;
  operationalSettings?: Partial<OperationalSettings>;
  onNearbyChange?: (isNearby: boolean) => void;
}

class CustomerMapErrorBoundary extends Component<
  { children: ReactNode; onErrorFallback: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('CustomerLiveMap internal boundary caught an error:', error, info);
    this.props.onErrorFallback();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

// Validators untuk respons Routes API (didefinisikan di luar komponen agar identitas stabil).
// Seluruh titik harus valid: lat -90..90, lng -180..180, minimal 2 titik.
// Jangan gunakan filter() — tolak keseluruhan path jika ada titik invalid.
function isValidRoutePoint(p: unknown): p is { lat: number; lng: number } {
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return false;
  const { lat, lng } = p as { lat: unknown; lng: unknown };
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function isValidRoutePath(path: unknown): path is { lat: number; lng: number }[] {
  if (!Array.isArray(path) || path.length < 2) return false;
  return path.every(isValidRoutePoint);
}

function isValidRouteMetrics(meters: unknown, millis: unknown): boolean {
  return (
    typeof meters === 'number' &&
    Number.isFinite(meters) &&
    meters > 0 &&
    typeof millis === 'number' &&
    Number.isFinite(millis) &&
    millis > 0
  );
}

// Inner live route polyline component using Google Maps Routes JavaScript SDK (Route.computeRoutes).
// Gambar geometri jalan nyata dari routes[0].path; tidak mengganti rute dengan garis lurus dua titik.
function LiveRoutePolyline({
  origin,
  destination,
  onRouteCalculated,
  onRouteStatus,
}: {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  onRouteCalculated: (result: { distanceText: string; durationText: string; distanceMeters: number } | null) => void;
  onRouteStatus: (status: 'available' | 'stale' | 'unavailable' | null) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  const [routePath, setRoutePath] = useState<{ lat: number; lng: number }[] | null>(null);

  // Rute terakhir yang berhasil dihitung, kunci hanya untuk destination yang sama.
  const lastGoodRouteRef = useRef<{
    path: { lat: number; lng: number }[];
    meters: number;
    millis: number;
    destination: { lat: number; lng: number };
  } | null>(null);

  // Ref koordinat terbaru agar penjadwalan trailing selalu menggunakan koordinat
  // paling baru, bukan tangkapan yang sudah ketinggalan waktu.
  const originRef = useRef(origin);
  const destinationRef = useRef(destination);
  originRef.current = origin;
  destinationRef.current = destination;

  // Throttling + trailing scheduling agar perubahan koordinat yang dilewati
  // karena interval minimum tetap diproses setelah jeda tercapai.
  const routeRequestSeqRef = useRef<number>(0);
  const lastRouteRequestAtRef = useRef<number>(0);
  const routeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ROUTE_REQUEST_MIN_INTERVAL_MS = 30000;

  const clearRouteTimeout = useCallback(() => {
    if (routeTimeoutRef.current) {
      clearTimeout(routeTimeoutRef.current);
      routeTimeoutRef.current = null;
    }
  }, []);

  const fireCompute = useCallback(
    (seq: number, org: { lat: number; lng: number }, dst: { lat: number; lng: number }) => {
      const RouteClass = (routesLib as any).Route;
      if (typeof RouteClass?.computeRoutes !== 'function') return;

      lastRouteRequestAtRef.current = Date.now();

      // 1. Bentuk request sesuai dokumentasi SDK: origin/destination berupa
      // LatLngLiteral {lat, lng}, tidak nested location.latLng.
      RouteClass.computeRoutes({
        origin: { lat: org.lat, lng: org.lng },
        destination: { lat: dst.lat, lng: dst.lng },
        travelMode: 'DRIVING',
        fields: ['path', 'distanceMeters', 'durationMillis'],
      })
        .then((response: any) => {
          // 10. Cegah respons API yang terlambat menimpa rute dari koordinat yang lebih baru.
          if (seq !== routeRequestSeqRef.current) return;

          const firstRoute = response?.routes?.[0];
          const rawPath = firstRoute?.path;
          const pathValid = isValidRoutePath(rawPath);
          const meters = firstRoute?.distanceMeters;
          const millis = firstRoute?.durationMillis;
          const hasSameDestinationRoute =
            lastGoodRouteRef.current &&
            lastGoodRouteRef.current.destination.lat === dst.lat &&
            lastGoodRouteRef.current.destination.lng === dst.lng;

          // 4. Validasi data API: seluruh titik path wajib valid (minimal 2),
          // metrik harus angka valid dan positif. Tolak keseluruhan path jika ada titik invalid.
          // Jangan anggap nol/data tidak valid sebagai sukses.
          if (pathValid && isValidRouteMetrics(meters, millis)) {
            const path = rawPath as { lat: number; lng: number }[];
            setRoutePath(path);
            lastGoodRouteRef.current = { path, meters, millis, destination: dst };
            onRouteStatus?.('available');

            const distText = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
            const mins = Math.max(1, Math.round(millis / 60000));
            onRouteCalculated({
              distanceText: distText,
              durationText: `${mins} mnt`,
              distanceMeters: meters,
            });
          } else if (hasSameDestinationRoute) {
            // Pembaruan gagal untuk destination yang sama: pertahankan rute terakhir,
            // tetapi bedakan dengan status sukses segar.
            onRouteStatus?.('stale');
          } else {
            onRouteStatus?.('unavailable');
          }
        })
        .catch(() => {
          if (seq !== routeRequestSeqRef.current) return;

          const hasSameDestinationRoute =
            lastGoodRouteRef.current &&
            lastGoodRouteRef.current.destination.lat === destination.lat &&
            lastGoodRouteRef.current.destination.lng === destination.lng;

          if (hasSameDestinationRoute) {
            onRouteStatus?.('stale');
          } else {
            onRouteStatus?.('unavailable');
          }
        });
    },
    [destination.lat, destination.lng, onRouteCalculated, onRouteStatus]
  );

  const compute = useCallback(() => {
    const now = Date.now();
    const seq = ++routeRequestSeqRef.current;
    const elapsed = now - lastRouteRequestAtRef.current;

    if (elapsed < ROUTE_REQUEST_MIN_INTERVAL_MS) {
      // 2. Jeda throttle belum tercapai: jangan batalkan request yang sedang
      // berjalan, jadwalkan eksekusi trailing dengan koordinat terbaru.
      clearRouteTimeout();
      routeTimeoutRef.current = setTimeout(() => {
        // 5. Reset referensi timer setelah callback dijalankan.
        routeTimeoutRef.current = null;
        lastRouteRequestAtRef.current = Date.now();
        fireCompute(seq, originRef.current, destinationRef.current);
      }, ROUTE_REQUEST_MIN_INTERVAL_MS - elapsed);
      return;
    }

    lastRouteRequestAtRef.current = now;
    fireCompute(seq, originRef.current, destinationRef.current);
  }, [fireCompute, clearRouteTimeout]);

  useEffect(() => {
    if (!map || !routesLib) return;
    const RouteClass = (routesLib as any).Route;
    if (typeof RouteClass?.computeRoutes !== 'function') return;

    compute();
    return () => {
      // 2. Bersihkan timer trailing saat komponen dilepas.
      clearRouteTimeout();
    };
  }, [map, routesLib, origin.lat, origin.lng, destination.lat, destination.lng, compute]);

  // 3. Jika destination booking berubah, reset routePath, lastGoodRouteRef,
  // routeStatus, dan routeInfo. Data booking lama tidak boleh tampil pada booking baru.
  useEffect(() => {
    lastGoodRouteRef.current = null;
    setRoutePath(null);
    onRouteStatus?.(null);
    onRouteCalculated?.(null);
  }, [destination.lat, destination.lng, onRouteStatus, onRouteCalculated]);

  // 5. Lifecycle polyline:
  // - Buat objek saat map tersedia (hanya sekali).
  // - Pertahankan objek yang sama selama lifecycle map.
  // - Perbarui geometri dengan setPath(), jangan buat ulang setiap routePath berubah.
  // - Bersihkan dengan setMap(null) hanya pada unmount.
  useEffect(() => {
    if (!map) return;
    if (typeof window === 'undefined' || !(window as any).google?.maps?.Polyline) return;
    if (polylineRef.current) return;

    const Polyline = (window as any).google.maps.Polyline;
    polylineRef.current = new Polyline({
      path: routePath ? routePath : [],
      map,
      geodesic: true,
      strokeColor: '#8B5A36',
      strokeWeight: 4,
      strokeOpacity: 0.85,
    });
  }, [map]);

  useEffect(() => {
    if (!polylineRef.current) return;
    polylineRef.current.setPath(routePath ? routePath : []);
    polylineRef.current.setMap(map ? map : null);
  }, [map, routePath]);

  useEffect(() => {
    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, []);

  return null;
}

export const CustomerLiveMap: React.FC<CustomerLiveMapProps> = ({ booking, settings, operationalSettings, onNearbyChange }) => {
  const { isKeyProvided, hasAuthError, forceFallback, currentDomainPattern } = useGoogleMaps();
  const [mapRenderError, setMapRenderError] = useState(false);
  const shouldUseGoogleMaps = isKeyProvided && !hasAuthError && !forceFallback && !mapRenderError;

  const nearbyDistanceKm = operationalSettings?.nearbyDistanceKm ?? 1.0;
  const nearbyDistanceMeters = nearbyDistanceKm * 1000;

  const [therapistLoc, setTherapistLoc] = useState<TherapistLocation | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    distanceText: string;
    durationText: string;
    distanceMeters: number;
  } | null>(null);
  const [routeStatus, setRouteStatus] = useState<'available' | 'stale' | 'unavailable' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const hasEmittedNearbyRef = useRef<boolean>(false);

  const isOnTheWay = booking.status === 'On The Way';
  const isPostOnTheWay = ['Arrived', 'Treatment', 'Completed'].includes(booking.status);

  // Customer Target Coordinates
  const hasCustomerCoords = booking.latitude != null && booking.longitude != null;
  const customerPos = {
    lat: booking.latitude ?? -2.976074,
    lng: booking.longitude ?? 104.757305,
  };

  // Subscribe to therapist realtime location updates
  useEffect(() => {
    if (!booking.id || !isOnTheWay) return;

    const unsubscribe = subscribeToTherapistLocation(booking.id, (loc) => {
      if (loc) {
        setTherapistLoc(loc);
        setLastRefreshedAt(new Date().toLocaleTimeString('id-ID'));
      }
    });

    return () => unsubscribe();
  }, [booking.id, isOnTheWay]);

  // Fallback therapist starting point if not yet emitted
  const effectiveTherapistPos = therapistLoc
    ? { lat: therapistLoc.latitude, lng: therapistLoc.longitude }
    : {
        lat: (settings?.baseLatitude ?? -2.976074) + 0.008,
        lng: (settings?.baseLongitude ?? 104.757305) - 0.005,
      };

  const mapCenter = hasCustomerCoords ? customerPos : effectiveTherapistPos;

  // Direct distance calculation
  const straightDistKm = hasCustomerCoords
    ? calculateDistanceKm(
        effectiveTherapistPos.lat,
        effectiveTherapistPos.lng,
        customerPos.lat,
        customerPos.lng
      )
    : 0;

  // Nearby condition: straight distance <= nearbyDistanceKm or route distance <= nearbyDistanceMeters or duration <= 5 mins
  const isNearby = isOnTheWay && (
    straightDistKm <= nearbyDistanceKm ||
    (routeInfo != null && (routeInfo.distanceMeters <= nearbyDistanceMeters || routeInfo.durationText.includes('1 ') || routeInfo.durationText.includes('2 ') || routeInfo.durationText.includes('3 ') || routeInfo.durationText.includes('4 ') || routeInfo.durationText.includes('5 ')))
  );

  useEffect(() => {
    if (onNearbyChange) {
      onNearbyChange(isNearby);
    }
    if (isNearby && !hasEmittedNearbyRef.current && booking.id) {
      hasEmittedNearbyRef.current = true;
      emitEvent('therapist.nearby', {
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        customerId: booking.customerId,
        customerName: booking.customerName,
        customerWhatsApp: booking.customerWhatsApp,
        serviceName: booking.serviceName,
        therapistId: booking.therapistId,
        therapistName: booking.therapistName || 'Terapis Senzu',
        area: booking.area,
      }, { id: booking.therapistId || 'system', role: 'therapist' }).catch(() => {});
    }
  }, [isNearby, booking, onNearbyChange]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastRefreshedAt(new Date().toLocaleTimeString('id-ID'));
    }, 600);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentDomainPattern);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const externalMapsUrl = hasCustomerCoords
    ? `https://www.google.com/maps/dir/?api=1&origin=${effectiveTherapistPos.lat},${effectiveTherapistPos.lng}&destination=${customerPos.lat},${customerPos.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.address + ' Palembang')}`;

  const {
    isAvailable: isCsAvailable,
    getWhatsAppUrl: getCsWhatsAppUrl,
    unavailableNotice: csUnavailableNotice,
  } = useCustomerServiceWhatsApp();

  const conciergeWaUrl = getCsWhatsAppUrl(
    `Halo Senzu Home, saya ingin menanyakan posisi terapis untuk booking ${booking.bookingCode}.`
  );

  return (
    <div className="space-y-3">
      {/* Dynamic Status Header */}
      {isOnTheWay ? (
        <div className="bg-gradient-to-r from-[#8B5A36] to-[#94603B] text-white p-4 rounded-2xl border border-[#D4AF37]/50 shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                Live GPS Aktif
              </span>
            </div>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="text-[11px] bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition active:scale-95 cursor-pointer font-medium"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Memperbarui...' : lastRefreshedAt ? `Update: ${lastRefreshedAt}` : 'Refresh'}</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
            <div>
              <h4 className="text-base font-bold text-white flex items-center gap-2">
                <span>Terapis Sedang Menuju Lokasi</span>
                {isNearby && (
                  <span className="bg-[#D4AF37] text-[#4B2B18] text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full">
                    Hampir Tiba
                  </span>
                )}
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                {booking.therapistName ? `${booking.therapistName} sedang berkendara menuju alamat Anda.` : 'Terapis sedang dalam perjalanan.'}
              </p>
            </div>

            <div className="bg-white/10 px-3 py-1.5 rounded-xl border border-white/15 flex items-center gap-3">
              <div>
                <span className="text-[10px] text-slate-300 block uppercase">Estimasi Tiba</span>
                <span className="text-sm font-bold text-[#FDF3CD]">
                  {routeInfo?.durationText || (routeStatus === 'unavailable' ? 'Tidak tersedia' : '–')}
                </span>
              </div>
              <div className="border-l border-white/20 pl-3">
                <span className="text-[10px] text-slate-300 block uppercase">Jarak Tempuh</span>
                <span className="text-sm font-bold text-white">
                  {routeInfo?.distanceText || (routeStatus === 'unavailable' ? 'Tidak tersedia' : '–')}
                </span>
              </div>
            </div>
          </div>

          {/* Nearby Warning Box */}
          {isNearby && (
            <div className="bg-[#D4AF37] text-[#4B2B18] p-2.5 rounded-xl flex items-center gap-2 text-xs font-bold shadow-sm">
              <Sparkles className="w-4 h-4 text-[#4B2B18] flex-shrink-0 animate-spin" />
              <span>Terapis Senzu sudah sangat dekat (±1 km). Silakan bersiap menyambut terapis di depan rumah/lobi.</span>
            </div>
          )}
        </div>
      ) : isPostOnTheWay ? (
        <div className="bg-emerald-50 border border-emerald-300 p-4 rounded-2xl flex items-center gap-3 text-emerald-900 shadow-xs">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-sm block">
              {booking.status === 'Arrived'
                ? 'Terapis Telah Tiba di Lokasi Anda'
                : booking.status === 'Treatment'
                ? 'Sesi Treatment Sedang Berlangsung'
                : 'Layanan Senzu Telah Selesai'}
            </span>
            <span className="text-slate-600 text-[11px]">
              Live GPS otomatis dinonaktifkan demi menjaga privasi dan efisiensi baterai.
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex items-center gap-3 text-slate-700">
          <Clock className="w-5 h-5 text-[#4B2B18] flex-shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-slate-900 block">Terapis Belum Berangkat</span>
            <span className="text-slate-500 text-[11px]">
              Peta live tracking dan estimasi perjalanan realtime akan otomatis aktif setelah terapis memulai perjalanan.
            </span>
          </div>
        </div>
      )}

      {/* RefererNotAllowed Notice if detected */}
      {hasAuthError && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start justify-between gap-2">
          <div className="space-y-1">
            <strong className="block font-bold text-amber-950">Google Maps Domain Whitelist Diperlukan:</strong>
            <p className="text-[11px] text-amber-800">
              Tambahkan <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[10px]">{currentDomainPattern}</code> di Google Cloud Console untuk menampilkan peta satelit.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex-shrink-0 px-2.5 py-1 bg-white border border-amber-300 rounded-lg text-[11px] font-semibold text-slate-800 hover:bg-amber-100 flex items-center gap-1 shadow-2xs cursor-pointer"
          >
            {isCopied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-slate-600" />}
            <span>{isCopied ? 'Tersalin' : 'Salin URL'}</span>
          </button>
        </div>
      )}

      {/* Interactive Map or Visual Route Status */}
      {shouldUseGoogleMaps ? (
        <CustomerMapErrorBoundary onErrorFallback={() => setMapRenderError(true)}>
          <div className="relative w-full h-64 sm:h-72 rounded-2xl overflow-hidden border border-slate-200 shadow-inner">
            <Map
              defaultCenter={mapCenter}
              defaultZoom={13}
              gestureHandling="cooperative"
              disableDefaultUI={false}
              mapId="DEMO_MAP_ID"
              className="w-full h-full"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            >
              {/* Customer Location Pin */}
              {hasCustomerCoords && (
                <AdvancedMarker
                  position={customerPos}
                  title={`Lokasi Anda: ${booking.address}`}
                >
                  <div className="relative flex flex-col items-center justify-center -translate-y-8 select-none">
                    <div className="w-8 h-8 rounded-full bg-rose-600 border-2 border-white shadow-md flex items-center justify-center text-white">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="w-2 h-2 bg-rose-600 border-r-2 border-b-2 border-white rotate-45 -mt-1" />
                  </div>
                </AdvancedMarker>
              )}

              {/* Therapist Realtime Moving Pin (When On The Way) */}
              {isOnTheWay && (
                <AdvancedMarker
                  position={effectiveTherapistPos}
                  title={`Posisi Terapis (${booking.therapistName || 'Terapis'})`}
                >
                  <div className="relative flex flex-col items-center justify-center -translate-y-8 select-none animate-bounce">
                    <div className="w-9 h-9 rounded-full bg-[#8B5A36] border-2 border-[#D4AF37] shadow-lg flex items-center justify-center text-[#D4AF37]">
                      <Car className="w-5 h-5" />
                    </div>
                    <div className="w-2.5 h-2.5 bg-[#8B5A36] border-r-2 border-b-2 border-[#D4AF37] rotate-45 -mt-1" />
                  </div>
                </AdvancedMarker>
              )}

              {/* Live Driving Route Polyline */}
              {isOnTheWay && hasCustomerCoords && (
                <LiveRoutePolyline
                  origin={effectiveTherapistPos}
                  destination={customerPos}
                  onRouteCalculated={setRouteInfo}
                  onRouteStatus={setRouteStatus}
                />
              )}
            </Map>

            {/* Status rute jalan */}
            {isOnTheWay && hasCustomerCoords && routeStatus === 'unavailable' && (
              <div className="mt-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl text-center max-w-xs mx-auto">
                Data rute jalan tidak tersedia untuk tujuan ini.
              </div>
            )}
            {isOnTheWay && hasCustomerCoords && routeStatus === 'stale' && (
              <div className="mt-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl text-center max-w-xs mx-auto">
                Menampilkan rute dari pembaruan terakhir (data tidak terbaru).
              </div>
            )}

            {/* Floating Map Legend Overlay */}
            <div className="absolute bottom-2.5 left-2.5 bg-white/95 backdrop-blur-xs px-3 py-1.5 rounded-xl shadow-md border border-slate-200 text-[10px] text-slate-700 flex items-center gap-3 pointer-events-none">
              <span className="flex items-center gap-1 font-semibold text-rose-700">
                <MapPin className="w-3 h-3 text-rose-600" />
                Alamat Customer
              </span>
              {isOnTheWay && (
                <span className="flex items-center gap-1 font-semibold text-[#4B2B18]">
                  <Navigation className="w-3 h-3 text-[#4B2B18]" />
                  Terapis (Live)
                </span>
              )}
            </div>
          </div>
        </CustomerMapErrorBoundary>
      ) : (
        /* Fallback Visual Route Tracking Card when maps is restricted */
        <div className="w-full rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 shadow-inner space-y-4">
          <div className="flex items-center justify-between text-xs border-b border-slate-200 pb-3">
            <span className="font-bold text-[#4B2B18] flex items-center gap-1.5">
              <Navigation className="w-4 h-4 text-[#B89628]" />
              Navigasi Perjalanan Terapis
            </span>
            <span className="text-[11px] font-medium text-slate-500">
              Jarak Langsung: <strong className="text-slate-800">{straightDistKm} KM</strong>
            </span>
          </div>

          <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-300">
            {/* Origin Step */}
            <div className="relative flex items-start gap-2">
              <span className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-[#8B5A36] text-white flex items-center justify-center text-[9px] font-bold ring-4 ring-white">
                T
              </span>
              <div>
                <div className="text-xs font-bold text-slate-900">
                  {booking.therapistName || 'Terapis Senzu'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  Koordinat: {effectiveTherapistPos.lat.toFixed(4)}, {effectiveTherapistPos.lng.toFixed(4)}
                </div>
              </div>
            </div>

            {/* Destination Step */}
            <div className="relative flex items-start gap-2">
              <span className="absolute -left-6 top-0.5 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[9px] font-bold ring-4 ring-white">
                C
              </span>
              <div>
                <div className="text-xs font-bold text-slate-900">
                  {booking.customerName} ({booking.area})
                </div>
                <div className="text-[11px] text-slate-500">
                  {booking.address}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Action Button to Open in Google Maps */}
          <div className="pt-2 flex flex-wrap gap-2">
            <a
              href={externalMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#8B5A36] text-white hover:bg-[#94603B] text-xs font-semibold shadow-xs transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Buka Rute di Google Maps App</span>
            </a>
          </div>
        </div>
      )}

      {/* Address & Note Breakdown */}
      <div className="bg-[#FAF9F6] border border-slate-200 rounded-xl p-3 text-xs space-y-1.5">
        <div className="flex items-start gap-1.5">
          <MapPin className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
          <div className="text-slate-700">
            <span className="font-bold text-slate-900">{booking.area}: </span>
            <span>{booking.address}</span>
          </div>
        </div>
        {booking.addressNotes && (
          <p className="text-[11px] text-slate-500 pl-5">
            <strong className="text-slate-700">Patokan Alamat:</strong> {booking.addressNotes}
          </p>
        )}
      </div>
    </div>
  );
};
