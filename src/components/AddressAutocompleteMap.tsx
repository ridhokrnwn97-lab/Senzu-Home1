import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  Search,
  Crosshair,
  Info,
  CheckCircle2,
  AlertTriangle,
  Move,
  Building2,
  Compass,
  Loader2,
  X
} from 'lucide-react';
import {
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
  useApiIsLoaded
} from '@vis.gl/react-google-maps';
import { ServiceRadiusTier, PALEMBANG_AREAS } from '../types';
import { calculateDistanceKm } from '../lib/dbService';
import {
  calculateHomeServiceFee,
  formatDistanceDisplay,
  fetchDrivingRouteDistanceAndFee,
  SENZU_BASE_LOCATION,
} from '../lib/distanceFeeService';
import { formatRupiah } from '../lib/utils';
import { useGoogleMaps } from './GoogleMapsProvider';

interface AddressAutocompleteMapProps {
  address: string;
  setAddress: (v: string) => void;
  latitude: number;
  setLatitude: (v: number) => void;
  longitude: number;
  setLongitude: (v: number) => void;
  placeId: string;
  setPlaceId: (v: string) => void;
  area: string;
  setArea: (v: string) => void;
  addressNotes: string;
  setAddressNotes: (v: string) => void;
  distanceKm: number;
  setDistanceKm: (v: number) => void;
  distanceMeters?: number;
  setDistanceMeters?: (v: number) => void;
  isCalculatingRoute?: boolean;
  setIsCalculatingRoute?: (v: boolean) => void;
  routeError?: string | null;
  setRouteError?: (v: string | null) => void;
  radiusTiers?: ServiceRadiusTier[];
  baseLocation?: {
    name: string;
    lat: number;
    lng: number;
  };
}

// Comprehensive directory of Palembang landmarks, hubs, roads, and districts for instant search and offline/non-GCP fallback
export const PALEMBANG_DIRECTORY = [
  // Commercial & Wellness Hubs
  { name: 'Palembang Icon Mall', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.977465, lng: 104.747120, category: 'Mall & Pusat Perbelanjaan' },
  { name: 'Palembang Square Mall (PS Mall)', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.976800, lng: 104.744100, category: 'Mall & Pusat Perbelanjaan' },
  { name: 'Palembang Indah Mall (PIM)', area: 'Bukit Kecil', lat: -2.986600, lng: 104.756200, category: 'Mall & Pusat Perbelanjaan' },
  { name: 'PTC Mall (Palembang Trade Center)', area: 'Ilir Timur III (8-9 Ilir, Duku)', lat: -2.952920, lng: 104.767180, category: 'Mall & Pusat Perbelanjaan' },
  { name: 'Soma Veteran (Social Market)', area: 'Ilir Timur II (1-3 Ilir, Lawang Kidul)', lat: -2.970140, lng: 104.764520, category: 'Lifestyle Hub & Kuliner' },
  { name: 'OPI Mall Jakabaring', area: 'Jakabaring / Jakabaring Sport City', lat: -3.042100, lng: 104.789500, category: 'Mall & Rekreasi' },
  { name: 'Jakabaring Sport City (JSC)', area: 'Jakabaring / Jakabaring Sport City', lat: -3.021540, lng: 104.793210, category: 'Kompleks Olahraga' },
  { name: 'Benteng Kuto Besak (BKB) & Jembatan Ampera', area: 'Bukit Kecil', lat: -2.991200, lng: 104.760100, category: 'Landmark Kota' },
  { name: 'Bandara Internasional Sultan Mahmud Badaruddin II', area: 'Sukarami / KM 9-12', lat: -2.898400, lng: 104.700300, category: 'Bandara' },
  { name: 'RS RK Charitas Palembang', area: 'Ilir Timur I (Sudirman, Mayor Ruslan, Veteran)', lat: -2.974900, lng: 104.752500, category: 'Rumah Sakit' },
  { name: 'RS Siloam Sriwijaya Palembang', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.976500, lng: 104.743500, category: 'Rumah Sakit' },
  { name: 'Jl. Riau No. 3 (Senzu Reflexology Base)', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.9859024, lng: 104.7385997, category: 'Senzu Base Branch' },
  { name: 'Jl. Demang Lebar Daun', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.969185, lng: 104.738210, category: 'Jalan Protokol / Residensial' },
  { name: 'Jl. Angkatan 45', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.972300, lng: 104.741200, category: 'Kawasan Bisnis' },
  { name: 'Jl. Jenderal Sudirman', area: 'Ilir Timur I (Sudirman, Mayor Ruslan, Veteran)', lat: -2.979000, lng: 104.754000, category: 'Jalan Utama Kota' },
  { name: 'Jl. Veteran & Rajawali', area: 'Ilir Timur II (1-3 Ilir, Lawang Kidul)', lat: -2.972000, lng: 104.762000, category: 'Kawasan Kuliner & Bisnis' },
  { name: 'Jl. Basuki Rahmat', area: 'Kemuning (Sekip, Pipa Reja, Ario Kemuning)', lat: -2.956000, lng: 104.746000, category: 'Jalan Protokol' },
  { name: 'Jl. Kolonel H. Burlian (KM 5 - KM 9)', area: 'Sukarami / KM 9-12', lat: -2.932000, lng: 104.725000, category: 'Jalan Utama' },
  { name: 'Jl. MP Mangkunegara (Kenten)', area: 'Sako (Kenten, Sako, Sukamaju)', lat: -2.943000, lng: 104.778000, category: 'Kawasan Residensial' },
  { name: 'Jl. Residen Abdul Rozak', area: 'Kalidoni (Sei Selayur, Kalidoni)', lat: -2.958000, lng: 104.786000, category: 'Jalan Utama' },
  { name: 'Komp. CitraGrand City Palembang', area: 'Alang-Alang Lebar (Talang Kelapa)', lat: -2.903000, lng: 104.685000, category: 'Perumahan' },

  // Semua 18 Kecamatan Kota Palembang
  { name: 'Kecamatan Ilir Barat I', area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)', lat: -2.975000, lng: 104.735000, category: 'Kecamatan' },
  { name: 'Kecamatan Ilir Barat II', area: 'Ilir Barat II (30 Ilir, Tangga Buntung)', lat: -2.998000, lng: 104.743000, category: 'Kecamatan' },
  { name: 'Kecamatan Bukit Kecil', area: 'Bukit Kecil', lat: -2.987000, lng: 104.752000, category: 'Kecamatan' },
  { name: 'Kecamatan Ilir Timur I', area: 'Ilir Timur I (Sudirman, Mayor Ruslan, Veteran)', lat: -2.973000, lng: 104.757000, category: 'Kecamatan' },
  { name: 'Kecamatan Ilir Timur II', area: 'Ilir Timur II (1-3 Ilir, Lawang Kidul)', lat: -2.968000, lng: 104.771000, category: 'Kecamatan' },
  { name: 'Kecamatan Ilir Timur III', area: 'Ilir Timur III (8-9 Ilir, Duku)', lat: -2.956000, lng: 104.764000, category: 'Kecamatan' },
  { name: 'Kecamatan Kemuning', area: 'Kemuning (Sekip, Pipa Reja, Ario Kemuning)', lat: -2.951000, lng: 104.749000, category: 'Kecamatan' },
  { name: 'Kecamatan Alang-Alang Lebar', area: 'Alang-Alang Lebar (Talang Kelapa)', lat: -2.915000, lng: 104.698000, category: 'Kecamatan' },
  { name: 'Kecamatan Sukarami', area: 'Sukarami / KM 9-12', lat: -2.923000, lng: 104.718000, category: 'Kecamatan' },
  { name: 'Kecamatan Sako', area: 'Sako (Kenten, Sako, Sukamaju)', lat: -2.935000, lng: 104.782000, category: 'Kecamatan' },
  { name: 'Kecamatan Sematang Borang', area: 'Sematang Borang', lat: -2.928000, lng: 104.810000, category: 'Kecamatan' },
  { name: 'Kecamatan Kalidoni', area: 'Kalidoni (Sei Selayur, Kalidoni)', lat: -2.961000, lng: 104.795000, category: 'Kecamatan' },
  { name: 'Kecamatan Jakabaring', area: 'Jakabaring / Jakabaring Sport City', lat: -3.024000, lng: 104.788000, category: 'Kecamatan' },
  { name: 'Kecamatan Seberang Ulu I', area: 'Seberang Ulu I (1-7 Ulu)', lat: -3.003000, lng: 104.765000, category: 'Kecamatan' },
  { name: 'Kecamatan Seberang Ulu II', area: 'Seberang Ulu II (11-16 Ulu)', lat: -2.998000, lng: 104.782000, category: 'Kecamatan' },
  { name: 'Kecamatan Plaju', area: 'Plaju (Bagus Kuning, Komperta)', lat: -3.011000, lng: 104.812000, category: 'Kecamatan' },
  { name: 'Kecamatan Kertapati', area: 'Kertapati (Kemang Agung, Karya Jaya)', lat: -3.025000, lng: 104.745000, category: 'Kecamatan' },
  { name: 'Kecamatan Gandus', area: 'Gandus (Pulokerto, Karang Anyar)', lat: -2.995000, lng: 104.708000, category: 'Kecamatan' },
];

// Popular Palembang wellness hub shortcuts for fast testing or instant pin-drop
const PALEMBANG_SHORTCUTS = [
  { name: 'Palembang Icon Mall (Ilir Barat I)', lat: -2.977465, lng: 104.747120, area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)' },
  { name: 'Demang Lebar Daun (Jl. Angkatan 45)', lat: -2.969185, lng: 104.738210, area: 'Ilir Barat I (Demang Lebar Daun, Lorok Pakjo)' },
  { name: 'PTC Mall (R. Sukamto, 8 Ilir)', lat: -2.952920, lng: 104.767180, area: 'Ilir Timur III (8-9 Ilir, Duku)' },
  { name: 'Soma Veteran (Ilir Timur II)', lat: -2.970140, lng: 104.764520, area: 'Ilir Timur II (1-3 Ilir, Lawang Kidul)' },
  { name: 'Jakabaring Sport City', lat: -3.021540, lng: 104.793210, area: 'Jakabaring / Jakabaring Sport City' },
];

export const AddressAutocompleteMap: React.FC<AddressAutocompleteMapProps> = ({
  address,
  setAddress,
  latitude,
  setLatitude,
  longitude,
  setLongitude,
  placeId,
  setPlaceId,
  area,
  setArea,
  addressNotes,
  setAddressNotes,
  distanceKm,
  setDistanceKm,
  distanceMeters,
  setDistanceMeters,
  isCalculatingRoute: externalIsCalculating,
  setIsCalculatingRoute: externalSetIsCalculating,
  routeError: externalRouteError,
  setRouteError: externalSetRouteError,
  radiusTiers,
  baseLocation = {
    name: 'Senzu Reflexology Palembang (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)',
    lat: -2.9859024,
    lng: 104.7385997,
  },
}) => {
  const { isKeyProvided, forceFallback, hasAuthError } = useGoogleMaps();
  const [mapRenderError, setMapRenderError] = useState(false);
  const shouldUseGoogleMaps = isKeyProvided && !forceFallback && !hasAuthError && !mapRenderError;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const [mapZoom, setMapZoom] = useState(14);

  const [internalIsCalculating, setInternalIsCalculating] = useState(false);
  const [internalRouteError, setInternalRouteError] = useState<string | null>(null);

  const isCalculatingRoute = externalIsCalculating !== undefined ? externalIsCalculating : internalIsCalculating;
  const setIsCalculatingRoute = externalSetIsCalculating || setInternalIsCalculating;

  const routeError = externalRouteError !== undefined ? externalRouteError : internalRouteError;
  const setRouteError = externalSetRouteError || setInternalRouteError;

  // Recalculate driving route distance whenever customer coordinates change
  useEffect(() => {
    let isCancelled = false;

    async function updateRoute() {
      if (latitude && longitude && baseLocation.lat && baseLocation.lng) {
        setIsCalculatingRoute(true);
        setRouteError(null);

        try {
          const res = await fetchDrivingRouteDistanceAndFee(latitude, longitude);
          if (isCancelled) return;

          if (res.success && typeof res.distanceKm === 'number') {
            setDistanceKm(res.distanceKm);
            if (setDistanceMeters && typeof res.distanceMeters === 'number') {
              setDistanceMeters(res.distanceMeters);
            }
            setRouteError(null);
          } else {
            // Safe message on failure. DO NOT silently assume Rp0 or confirm booking.
            setRouteError(res.error || 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.');
          }
        } catch (err: any) {
          if (isCancelled) return;
          console.warn('[AddressMap] Route calculation error:', err);
          setRouteError('Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.');
        } finally {
          if (!isCancelled) {
            setIsCalculatingRoute(false);
          }
        }
      }
    }

    updateRoute();

    return () => {
      isCancelled = true;
    };
  }, [latitude, longitude, baseLocation.lat, baseLocation.lng, setDistanceKm, setDistanceMeters]);

  const feeCalc = calculateHomeServiceFee(distanceKm);

  // Use browser Geolocation API
  const handleDetectCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocateError('Geolocation tidak didukung oleh browser Anda.');
      return;
    }

    setIsLocating(true);
    setLocateError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);
        setMapZoom(16);

        // If address is empty, provide a descriptive default
        if (!address.trim()) {
          setAddress(`Lokasi GPS Presisi (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        }

        setIsLocating(false);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setIsLocating(false);
        setLocateError('Tidak dapat mengakses lokasi perangkat. Pastikan izin lokasi diizinkan.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleShortcutClick = (sc: typeof PALEMBANG_SHORTCUTS[0]) => {
    setAddress(sc.name);
    setLatitude(sc.lat);
    setLongitude(sc.lng);
    setArea(sc.area);
    setPlaceId(`sc_${(sc.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`);
    setMapZoom(15);
  };

  return (
    <div className="space-y-4">
      {/* Address Input & Places Autocomplete */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-[#4B2B18] uppercase tracking-wider">
            Alamat Lengkap & Titik Peta Google Maps <span className="text-red-500">*</span>
          </label>
          <button
            type="button"
            onClick={handleDetectCurrentLocation}
            disabled={isLocating}
            className="text-[11px] font-medium text-[#4B2B18] hover:text-[#B89628] flex items-center gap-1 transition-colors px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200"
          >
            <Crosshair className={`w-3 h-3 ${isLocating ? 'animate-spin text-[#B89628]' : ''}`} />
            <span>{isLocating ? 'Mendeteksi...' : 'Pakai GPS Saya'}</span>
          </button>
        </div>

        {/* Places API (New) Programmatic Autocomplete when Google Maps is available */}
        {shouldUseGoogleMaps ? (
          <AutocompleteGoogleInput
            address={address}
            setAddress={setAddress}
            setLatitude={setLatitude}
            setLongitude={setLongitude}
            setPlaceId={setPlaceId}
            setArea={setArea}
            setMapZoom={setMapZoom}
          />
        ) : (
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <MapPin className="w-4 h-4 text-[#B89628]" />
            </div>
            <input
              ref={inputRef}
              type="text"
              required
              value={address ?? ''}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ketik nama jalan, perumahan, atau gedung di Palembang..."
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/20 focus:border-[#8B5A36] text-slate-800 transition-all shadow-sm"
            />
          </div>
        )}

        {locateError && (
          <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>{locateError}</span>
          </p>
        )}

        {/* Quick Palembang Shortcut Chips */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
          <span className="text-slate-600 flex-shrink-0 font-medium text-[10px] uppercase">
            Pilihan Cepat:
          </span>
          {PALEMBANG_SHORTCUTS.map((sc, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleShortcutClick(sc)}
              className="flex-shrink-0 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-slate-700 hover:text-[#4B2B18] transition-all"
            >
              {sc.name.split(' (')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Kecamatan / Area Selection */}
      <div>
        <label className="block text-xs font-semibold text-[#4B2B18] uppercase tracking-wider mb-1.5">
          Wilayah / Kecamatan Palembang <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <select
            value={area || PALEMBANG_AREAS[0]}
            onChange={(e) => setArea(e.target.value)}
            className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/20 focus:border-[#8B5A36] text-slate-800 shadow-sm appearance-none cursor-pointer"
          >
            {PALEMBANG_AREAS.map((ar) => (
              <option key={ar} value={ar}>
                {ar}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
            <Compass className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Interactive Map View with AdvancedMarker & Dragging */}
      <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50">
        <div className="p-3 bg-white border-b border-slate-100 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-medium text-[#4B2B18]">
            <Move className="w-3.5 h-3.5 text-[#B89628]" />
            <span>Geser pin atau klik peta untuk presisi lokasi</span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {latitude.toFixed(4)}, {longitude.toFixed(4)}
          </span>
        </div>

        <div className="h-60 w-full relative">
          {shouldUseGoogleMaps ? (
            <MapErrorBoundary
              onError={() => setMapRenderError(true)}
              fallback={
                <FallbackSimulatedMap
                  latitude={latitude}
                  longitude={longitude}
                  setLatitude={setLatitude}
                  setLongitude={setLongitude}
                  baseLocation={baseLocation}
                />
              }
            >
              <InteractiveGoogleMap
                latitude={latitude}
                longitude={longitude}
                setLatitude={setLatitude}
                setLongitude={setLongitude}
                zoom={mapZoom}
                baseLocation={baseLocation}
              />
            </MapErrorBoundary>
          ) : (
            <FallbackSimulatedMap
              latitude={latitude}
              longitude={longitude}
              setLatitude={setLatitude}
              setLongitude={setLongitude}
              baseLocation={baseLocation}
            />
          )}
        </div>
      </div>

      {/* Patokan / Catatan Alamat (addressNotes) */}
      <div>
        <label className="block text-xs font-semibold text-[#4B2B18] uppercase tracking-wider mb-1.5">
          Patokan Alamat / Landmark Kedatangan <span className="text-slate-400 font-normal">(Sangat Disarankan)</span>
        </label>
        <input
          type="text"
          value={addressNotes ?? ''}
          onChange={(e) => setAddressNotes(e.target.value)}
          placeholder="Contoh: Seberang Indomaret, rumah pagar hitam no. 12, ada pohon mangga"
          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/20 focus:border-[#8B5A36] text-slate-800 placeholder:text-slate-400 shadow-sm"
        />
        <p className="text-[11px] text-slate-600 mt-1">
          Membantu terapis menemukan lokasi Anda dengan cepat dan tepat waktu.
        </p>
      </div>

      {/* Realtime Driving Distance & Home Service Fee Breakdown */}
      {isCalculatingRoute ? (
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 text-[#B89628] animate-spin shrink-0" />
            <div>
              <span className="text-xs font-semibold text-[#4B2B18] block">
                Menghitung rute berkendara dari Senzu Base...
              </span>
              <span className="text-[11px] text-slate-500">
                Pusat operasional: {baseLocation.name}
              </span>
            </div>
          </div>
          <span className="text-xs text-slate-400 font-medium italic">Rute Aktif...</span>
        </div>
      ) : routeError ? (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 flex items-start gap-2.5 text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <p className="font-semibold text-rose-800">{routeError}</p>
            <p className="text-[11px] text-amber-700">
              Pastikan titik pin berada di area daratan Palembang yang dapat diakses kendaraan.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-amber-50/40 border border-[#D4AF37]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-[#4B2B18] uppercase tracking-wider block">
              Jarak dari Senzu Base
            </span>
            <div className="text-lg font-bold text-[#4B2B18]">
              {formatDistanceDisplay(distanceKm)}
            </div>
            <p className="text-[11px] text-slate-500">
              Pusat operasional: {baseLocation.name}
            </p>
          </div>

          <div className="text-left sm:text-right space-y-0.5">
            <span className="text-xs font-semibold text-[#4B2B18] uppercase tracking-wider block">
              Biaya Home Service
            </span>
            <div className={`text-lg font-bold ${feeCalc.isFree ? 'text-emerald-700 font-bold' : 'text-[#4B2B18]'}`}>
              {feeCalc.isFree ? 'GRATIS' : formatRupiah(feeCalc.fee)}
            </div>
            {!feeCalc.isFree && (
              <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-medium text-[10px] border border-amber-300">
                {feeCalc.tierLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Helper to match address components or formatted address to predefined Palembang kecamatan list
 */
const matchPalembangArea = (
  addressComponents?: any[] | null,
  formattedAddress?: string
): string | null => {
  // 1. Try matching from address components
  if (addressComponents && Array.isArray(addressComponents)) {
    for (const comp of addressComponents) {
      const rawText = (
        comp.longText ||
        comp.long_name ||
        comp.shortText ||
        comp.short_name ||
        ''
      )
        .toString()
        .trim();

      if (!rawText) continue;

      const cleanText = rawText
        .replace(/^(kecamatan|kelurahan|desa|kota|kabupaten)\s+/i, '')
        .trim()
        .toLowerCase();

      if (cleanText.length < 3) continue;

      for (const area of PALEMBANG_AREAS) {
        const areaLower = area.toLowerCase();
        if (areaLower.includes(cleanText) || cleanText.includes(areaLower.split(' ')[0].toLowerCase())) {
          return area;
        }
      }
    }
  }

  // 2. Try matching from formatted address string
  if (formattedAddress) {
    const addrLower = formattedAddress.toLowerCase();
    for (const area of PALEMBANG_AREAS) {
      const mainName = area.split('(')[0].trim().toLowerCase();
      if (addrLower.includes(mainName)) {
        return area;
      }
      const subAreas = area.match(/\((.*?)\)/)?.[1]?.split(',').map((s) => s.trim().toLowerCase()) || [];
      for (const sub of subAreas) {
        if (sub && addrLower.includes(sub)) {
          return area;
        }
      }
    }
  }

  return null;
};

/**
 * Autocomplete Input using Google Places API (New) Data API Programmatically
 * AutocompleteSuggestion.fetchAutocompleteSuggestions + AutocompleteSessionToken
 */
interface AutocompleteGoogleInputProps {
  address: string;
  setAddress: (v: string) => void;
  setLatitude: (v: number) => void;
  setLongitude: (v: number) => void;
  setPlaceId: (v: string) => void;
  setArea: (v: string) => void;
  setMapZoom?: (v: number) => void;
}

const AutocompleteGoogleInput: React.FC<AutocompleteGoogleInputProps> = ({
  address,
  setAddress,
  setLatitude,
  setLongitude,
  setPlaceId,
  setArea,
  setMapZoom,
}) => {
  // Requirement 9: State wajib
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState<boolean>(false);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState<boolean>(false);
  const [sessionToken, setSessionToken] = useState<any>(null);
  const [placesApiNewDisabled, setPlacesApiNewDisabled] = useState<boolean>(false);

  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionTokenRef = useRef<any>(null);
  const debounceTimerRef = useRef<any>(null);
  const isSelectedByClickRef = useRef<boolean>(false);
  const placesLib = useMapsLibrary('places');

  const updateSessionToken = (token: any) => {
    sessionTokenRef.current = token;
    setSessionToken(token);
  };

  // Helper untuk import library places Google Maps API (New)
  const getPlacesClasses = async () => {
    let places = placesLib;
    if (
      (!places?.AutocompleteSuggestion || !places?.AutocompleteSessionToken) &&
      typeof window !== 'undefined' &&
      (window as any).google?.maps?.importLibrary
    ) {
      try {
        places = (await (window as any).google.maps.importLibrary('places')) as google.maps.PlacesLibrary;
      } catch (err) {
        console.warn('Info importLibrary("places"):', err);
      }
    }
    return {
      AutocompleteSuggestion: places?.AutocompleteSuggestion || (window as any).google?.maps?.places?.AutocompleteSuggestion,
      AutocompleteSessionToken: places?.AutocompleteSessionToken || (window as any).google?.maps?.places?.AutocompleteSessionToken,
    };
  };

  // Fetch suggestions menggunakan Places API (New) AutocompleteSuggestion
  // Jika Places API (New) belum aktif di Google Cloud Console, otomatis fallback ke direktori Palembang & peta interaktif
  // TANPA pernah memanggil legacy API (AutocompleteService/Geocoder) yang diblokir oleh Google
  const fetchSuggestions = async (query: string) => {
    try {
      setAutocompleteLoading(true);
      setAutocompleteError(null);

      let fetchedSuggestions: any[] = [];

      // 1. Coba Places API (New) jika belum terdeteksi nonaktif
      if (!placesApiNewDisabled) {
        try {
          const { AutocompleteSuggestion, AutocompleteSessionToken } = await getPlacesClasses();

          if (AutocompleteSuggestion) {
            // Requirement 4: Buat token baru ketika sesi pencarian dimulai
            let token = sessionTokenRef.current;
            if (!token && AutocompleteSessionToken) {
              token = new AutocompleteSessionToken();
              updateSessionToken(token);
            }

            // Requirement 3: Parameter request Places API (New)
            const request: any = {
              input: query,
              includedRegionCodes: ['id'],
              locationBias: {
                center: {
                  lat: -2.976073,
                  lng: 104.775431,
                },
                radius: 30000,
              },
              language: 'id',
              region: 'id',
            };

            if (token) {
              request.sessionToken = token;
            }

            const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
            const rawList = response?.suggestions || [];
            fetchedSuggestions = rawList.slice(0, 5).map((sug: any) => ({
              id: sug.placePrediction?.placeId,
              source: 'new' as const,
              raw: sug,
            }));
          }
        } catch (newApiErr: any) {
          const errMsg = String(newApiErr?.message || newApiErr || '');
          if (errMsg.includes('Places API (New) has not been used') || errMsg.includes('disabled') || errMsg.includes('LegacyApiNotActivatedMapError')) {
            setPlacesApiNewDisabled(true);
          }
          // Jangan panggil legacy API, gunakan fallback direktori Palembang
        }
      }

      // 2. Fallback cerdas ke Direktori Wilayah & Landmark Palembang
      // Tanpa memanggil API legacy yang dilarang Google Maps
      if (fetchedSuggestions.length === 0) {
        const q = (query || '').toLowerCase().trim();
        const matchedLocal = PALEMBANG_DIRECTORY.filter((loc) =>
          (loc.name || '').toLowerCase().includes(q) ||
          (loc.area || '').toLowerCase().includes(q) ||
          (loc.category && (loc.category || '').toLowerCase().includes(q))
        ).slice(0, 6);

        if (matchedLocal.length > 0) {
          fetchedSuggestions = matchedLocal.map((item, idx) => ({
            id: `plb-${(item.name || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${idx}`,
            source: 'local' as const,
            raw: item,
          }));
        }
      }

      setSuggestions(fetchedSuggestions);
      setIsSuggestionOpen(fetchedSuggestions.length > 0);
      setSelectedIndex(-1);

      if (fetchedSuggestions.length === 0 && placesApiNewDisabled) {
        setAutocompleteError(
          'Pencarian Places API (New) belum aktif di Google Cloud. Silakan tentukan pin langsung pada peta atau pilih dari saran Palembang.'
        );
      }
    } catch (err: any) {
      setAutocompleteError(
        'Pencarian sedang tidak tersedia. Anda tetap dapat menentukan lokasi secara akurat melalui peta.'
      );
      setSuggestions([]);
      setIsSuggestionOpen(false);
    } finally {
      setAutocompleteLoading(false);
    }
  };

  // Requirement 2 & 13: Debounce 300 ms, minimal 2 karakter
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (isSelectedByClickRef.current) {
      isSelectedByClickRef.current = false;
      return;
    }

    const trimmed = address ? address.trim() : '';
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsSuggestionOpen(false);
      setAutocompleteLoading(false);
      return;
    }

    setAutocompleteLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      fetchSuggestions(trimmed);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [address, placesApiNewDisabled]);

  // Requirement 12: Tutup dropdown jika klik di luar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsSuggestionOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Helper untuk mendapatkan teks suggestion (Requirement 5)
  const getSuggestionDisplay = (suggestion: any) => {
    if (suggestion?.source === 'local') {
      const item = suggestion.raw;
      return {
        mainText: item.name,
        secondaryText: item.category ? `${item.category} • ${item.area}` : item.area,
        fullText: `${item.name}, ${item.area}`,
      };
    }

    const pred = suggestion?.raw?.placePrediction;
    if (!pred) {
      return { mainText: '', secondaryText: '', fullText: '' };
    }

    const parseStr = (val: any): string => {
      if (!val) return '';
      if (typeof val === 'string') return val;
      if (typeof val.text === 'string') return val.text;
      if (typeof val.toString === 'function') {
        const s = val.toString();
        return s !== '[object Object]' ? s : '';
      }
      return '';
    };

    const mainText = parseStr(pred.mainText);
    const secondaryText = parseStr(pred.secondaryText);
    const fullText = parseStr(pred.text) || mainText;

    return { mainText, secondaryText, fullText };
  };

  // Requirement 6: Saat customer memilih suggestion
  const handleSelectSuggestion = async (suggestion: any) => {
    try {
      setAutocompleteLoading(true);
      isSelectedByClickRef.current = true;
      setIsSuggestionOpen(false);
      setSuggestions([]);

      if (suggestion.source === 'local') {
        // Pemilihan dari Direktori Palembang (Tanpa panggil legacy API)
        const item = suggestion.raw;
        setAddress(item.name);
        setLatitude(item.lat);
        setLongitude(item.lng);
        setPlaceId(suggestion.id);
        setArea(item.area);
        if (setMapZoom) {
          setMapZoom(16);
        }
      } else if (suggestion.source === 'new') {
        // Pemilihan dari Places API (New)
        const prediction = suggestion.raw?.placePrediction;
        if (!prediction) return;

        const place = prediction.toPlace();

        await place.fetchFields({
          fields: [
            'displayName',
            'formattedAddress',
            'location',
            'addressComponents',
          ],
        });

        // Update address
        const formattedAddress =
          place.formattedAddress ||
          (typeof place.displayName === 'string'
            ? place.displayName
            : (place.displayName as any)?.text) ||
          prediction.text?.text ||
          (prediction.text as any)?.toString?.() ||
          '';

        if (formattedAddress) {
          setAddress(formattedAddress);
        }

        // Update latitude & longitude
        if (place.location) {
          const lat =
            typeof place.location.lat === 'function'
              ? place.location.lat()
            : place.location.lat;
          const lng =
            typeof place.location.lng === 'function'
              ? place.location.lng()
              : place.location.lng;
          setLatitude(lat);
          setLongitude(lng);
        }

        // Update placeId
        if (place.id) {
          setPlaceId(place.id);
        }

        // Update area/kecamatan
        const matchedArea = matchPalembangArea(place.addressComponents, formattedAddress);
        if (matchedArea) {
          setArea(matchedArea);
        }

        if (setMapZoom) {
          setMapZoom(16);
        }

        // Requirement 4: Buat session token baru untuk pencarian berikutnya
        const { AutocompleteSessionToken } = await getPlacesClasses();
        if (AutocompleteSessionToken) {
          updateSessionToken(new AutocompleteSessionToken());
        } else {
          updateSessionToken(null);
        }
      }
    } catch (err) {
      console.warn('Error fetching selected place details:', err);
    } finally {
      setAutocompleteLoading(false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSuggestionOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault();
        setIsSuggestionOpen(true);
        setSelectedIndex(0);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        handleSelectSuggestion(suggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsSuggestionOpen(false);
    }
  };

  const handleClearAddress = () => {
    setAddress('');
    setSuggestions([]);
    setIsSuggestionOpen(false);
    setAutocompleteError(null);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* Input Senzu Home */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
          <MapPin className="w-4 h-4 text-[#B89628]" />
        </div>

        <input
          ref={inputRef}
          type="text"
          required
          value={address ?? ''}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setIsSuggestionOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ketik nama jalan, perumahan, atau gedung di Palembang..."
          className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5A36]/20 focus:border-[#8B5A36] text-slate-800 transition-all shadow-sm placeholder:text-slate-400"
        />

        <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center gap-1.5">
          {autocompleteLoading && (
            <Loader2 className="w-4 h-4 text-[#B89628] animate-spin" />
          )}
          {address && !autocompleteLoading && (
            <button
              type="button"
              onClick={handleClearAddress}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
              title="Hapus teks alamat"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Info aktivasi Places API (New) jika belum diaktifkan di GCP Project */}
      {placesApiNewDisabled && (
        <div className="mt-2 px-3 py-2 bg-amber-50/90 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 leading-snug">
            <span className="font-semibold">Places API (New) belum aktif di Google Cloud.</span>{' '}
            <span>Sistem saat ini menggunakan pencarian direktori area Palembang & pin peta interaktif.</span>{' '}
            <a
              href="https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=366506494041"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-bold text-amber-950 hover:text-black inline-block mt-0.5"
            >
              Aktifkan Places API (New) di GCP &rarr;
            </a>
          </div>
        </div>
      )}

      {/* Requirement 10: Tampilkan pesan kecil jika semua request Google gagal */}
      {autocompleteError && !placesApiNewDisabled && (
        <p className="text-[11px] text-amber-700 mt-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
          <span>Pencarian alamat Google sedang tidak tersedia. Anda tetap dapat menentukan lokasi melalui peta.</span>
        </p>
      )}

      {/* Requirement 11: Dropdown Custom Suggestions React */}
      {isSuggestionOpen && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden max-h-64 overflow-y-auto divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1 duration-150"
          role="listbox"
        >
          {(suggestions || []).map((sug, idx) => {
            const { mainText, secondaryText, fullText } = getSuggestionDisplay(sug);
            const isSelected = selectedIndex === idx;

            return (
              <button
                key={sug?.id || idx}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseDown={(e) => {
                  e.preventDefault(); // Mencegah input blur sebelum klik selesai
                  handleSelectSuggestion(sug);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                  isSelected ? 'bg-slate-100/90 text-[#4B2B18]' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="mt-0.5 p-1.5 rounded-lg bg-[#8B5A36]/5 text-[#B89628] flex-shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {mainText || fullText || 'Alamat Palembang'}
                  </div>
                  {(secondaryText || (mainText && fullText && fullText !== mainText)) && (
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {secondaryText || fullText}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          <div className="px-4 py-1.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
            <span>{placesApiNewDisabled ? 'Direktori Area & Landmark • Palembang' : 'Places API (New) • Palembang'}</span>
            <span className="text-[9px] uppercase tracking-wider font-mono">Palembang</span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Localized Error Boundary for Google Map rendering
 */
class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; onError?: () => void },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('Google Maps rendering fallback triggered:', error);
    if (this.props.onError) {
      this.props.onError();
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Interactive Google Map with Draggable Pin using modern AdvancedMarker with custom styled SVG pins
 */
const InteractiveGoogleMap: React.FC<{
  latitude: number;
  longitude: number;
  setLatitude: (v: number) => void;
  setLongitude: (v: number) => void;
  zoom: number;
  baseLocation: { name: string; lat: number; lng: number };
}> = ({ latitude, longitude, setLatitude, setLongitude, zoom, baseLocation }) => {
  const map = useMap();

  useEffect(() => {
    try {
      if (map && latitude && longitude) {
        map.panTo({ lat: latitude, lng: longitude });
      }
    } catch (e) {
      console.warn('Map panTo error:', e);
    }
  }, [map, latitude, longitude]);

  const handleMapClick = (e: any) => {
    try {
      if (e.detail?.latLng) {
        setLatitude(Number(e.detail.latLng.lat.toFixed(6)));
        setLongitude(Number(e.detail.latLng.lng.toFixed(6)));
      }
    } catch (err) {
      console.warn('Error handling map click:', err);
    }
  };

  const handleMarkerDragEnd = (e: any) => {
    try {
      const lat =
        typeof e?.latLng?.lat === 'function'
          ? e.latLng.lat()
          : e?.latLng?.lat ?? e?.detail?.latLng?.lat;
      const lng =
        typeof e?.latLng?.lng === 'function'
          ? e.latLng.lng()
          : e?.latLng?.lng ?? e?.detail?.latLng?.lng;

      if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
        setLatitude(Number(lat.toFixed(6)));
        setLongitude(Number(lng.toFixed(6)));
      }
    } catch (err) {
      console.warn('Error handling marker drag end:', err);
    }
  };

  return (
    <Map
      center={{ lat: latitude, lng: longitude }}
      zoom={zoom}
      onClick={handleMapClick}
      gestureHandling="greedy"
      disableDefaultUI={false}
      mapId="DEMO_MAP_ID"
      className="w-full h-full"
      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
    >
      {/* Customer Location Marker */}
      <AdvancedMarker
        position={{ lat: latitude, lng: longitude }}
        draggable={true}
        onDragEnd={handleMarkerDragEnd}
        title="Lokasi Anda (Geser untuk menyesuaikan)"
      >
        <div className="relative flex flex-col items-center justify-center -translate-y-8 cursor-grab active:cursor-grabbing group select-none">
          <div className="w-9 h-9 rounded-full bg-[#8B5A36] border-2 border-[#D4AF37] shadow-lg flex items-center justify-center text-white transition-transform group-hover:scale-110">
            <MapPin className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div className="w-2.5 h-2.5 bg-[#8B5A36] border-r-2 border-b-2 border-[#D4AF37] rotate-45 -mt-1 shadow-xs" />
          <div className="mt-1 px-2 py-0.5 rounded bg-slate-900/90 text-[#D4AF37] text-[10px] font-bold whitespace-nowrap shadow-md pointer-events-none">
            Titik Anda
          </div>
        </div>
      </AdvancedMarker>

      {/* Base Location Marker */}
      <AdvancedMarker
        position={{ lat: baseLocation.lat, lng: baseLocation.lng }}
        title={baseLocation.name}
      >
        <div className="relative flex flex-col items-center justify-center -translate-y-8 pointer-events-none select-none">
          <div className="w-8 h-8 rounded-full bg-[#D4AF37] border-2 border-[#8B5A36] shadow-md flex items-center justify-center text-[#4B2B18]">
            <Compass className="w-4 h-4" />
          </div>
          <div className="w-2 h-2 bg-[#D4AF37] border-r-2 border-b-2 border-[#8B5A36] rotate-45 -mt-1" />
          <div className="mt-0.5 px-1.5 py-0.5 rounded bg-[#8B5A36] text-[#D4AF37] text-[9px] font-bold whitespace-nowrap shadow-xs">
            Hub Senzu
          </div>
        </div>
      </AdvancedMarker>
    </Map>
  );
};

/**
 * Fallback Simulated Map when API Key is pending or in preview mode.
 * Allows interactive dragging, clicking, and full distance calculation.
 */
const FallbackSimulatedMap: React.FC<{
  latitude: number;
  longitude: number;
  setLatitude: (v: number) => void;
  setLongitude: (v: number) => void;
  baseLocation: { name: string; lat: number; lng: number };
}> = ({ latitude, longitude, setLatitude, setLongitude, baseLocation }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Approximate Palembang bounding box for grid projection
  const minLat = -3.05, maxLat = -2.90;
  const minLng = 104.68, maxLng = 104.83;

  const toPercent = (lat: number, lng: number) => {
    const x = Math.max(5, Math.min(95, ((lng - minLng) / (maxLng - minLng)) * 100));
    const y = Math.max(5, Math.min(95, ((maxLat - lat) / (maxLat - minLat)) * 100));
    return { x, y };
  };

  const toCoords = (percentX: number, percentY: number) => {
    const lng = minLng + (percentX / 100) * (maxLng - minLng);
    const lat = maxLat - (percentY / 100) * (maxLat - minLat);
    return { lat, lng };
  };

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    const { lat, lng } = toCoords(px, py);
    setLatitude(Number(lat.toFixed(6)));
    setLongitude(Number(lng.toFixed(6)));
  };

  const custPos = toPercent(latitude, longitude);
  const basePos = toPercent(baseLocation.lat, baseLocation.lng);

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className="w-full h-full relative cursor-crosshair select-none overflow-hidden bg-[#e8ecef]"
      style={{
        backgroundImage: `
          radial-gradient(#cbd5e1 1.5px, transparent 1.5px),
          linear-gradient(to right, #f1f5f9 1px, transparent 1px),
          linear-gradient(to bottom, #f1f5f9 1px, transparent 1px)
        `,
        backgroundSize: '24px 24px, 48px 48px, 48px 48px',
      }}
    >
      {/* Sungai Musi vector stylized path */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40" preserveAspectRatio="none" viewBox="0 0 100 100">
        <path
          d="M 0,35 Q 25,48 50,42 T 100,55"
          fill="none"
          stroke="#93c5fd"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Connection line between Base and Customer */}
        <line
          x1={basePos.x}
          y1={basePos.y}
          x2={custPos.x}
          y2={custPos.y}
          stroke="#B89628"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      </svg>

      {/* Base Location Marker */}
      <div
        className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
        style={{ left: `${basePos.x}%`, top: `${basePos.y}%` }}
      >
        <div className="flex flex-col items-center">
          <div className="w-6 h-6 rounded-full bg-[#D4AF37] border-2 border-white shadow-md flex items-center justify-center text-[#4B2B18] text-[10px] font-bold">
            S
          </div>
          <span className="bg-[#8B5A36] text-white text-[9px] px-1.5 py-0.5 rounded shadow whitespace-nowrap mt-0.5">
            Senzu Base
          </span>
        </div>
      </div>

      {/* Customer Pin Marker */}
      <div
        className="absolute transform -translate-x-1/2 -translate-y-full pointer-events-none z-20"
        style={{ left: `${custPos.x}%`, top: `${custPos.y}%` }}
      >
        <div className="flex flex-col items-center animate-bounce">
          <div className="w-8 h-8 rounded-full bg-[#8B5A36] border-2 border-[#D4AF37] shadow-xl flex items-center justify-center text-[#D4AF37]">
            <MapPin className="w-4 h-4 fill-current" />
          </div>
          <div className="w-2 h-1 rounded-full bg-black/30 mt-0.5"></div>
          <span className="bg-[#8B5A36] text-[#D4AF37] font-semibold text-[9px] px-2 py-0.5 rounded-full shadow border border-[#D4AF37]/50 whitespace-nowrap mt-0.5">
            Titik Anda
          </span>
        </div>
      </div>

      {/* Watermark notice */}
      <div className="absolute bottom-2 left-2 bg-white/90 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-200 text-[10px] text-slate-500 shadow-sm flex items-center gap-1.5 pointer-events-none">
        <MapPin className="w-3 h-3 text-[#B89628]" />
        <span>Peta Interaktif Palembang (Klik di mana saja untuk memindah pin)</span>
      </div>
    </div>
  );
};
