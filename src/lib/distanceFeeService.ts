/**
 * Distance & Home Service Fee Service for Senzu Home
 * Single Authoritative Source of Truth for Route Distance & Fee Calculations
 */

export interface OperationalBaseLocation {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string;
  province: string;
}

/**
 * Authoritative operational base location for Senzu Reflexology & Family Massage
 * Preserved from existing project master data & branch configuration (PLG001)
 */
export const SENZU_BASE_LOCATION: OperationalBaseLocation = {
  id: 'PLG001',
  name: 'Senzu Reflexology Palembang (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)',
  address: 'Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan',
  lat: -2.9859024,
  lng: 104.7385997,
  city: 'PALEMBANG',
  province: 'SUMATERA SELATAN',
};

export interface HomeServiceFeeCalculation {
  distanceKm: number;
  fee: number;
  tier: 'tier-1' | 'tier-2' | 'tier-3' | 'tier-4';
  tierLabel: string;
  isFree: boolean;
  formattedFee: string;
  requiresConfirmation: boolean;
}

/**
 * Authoritative single source of truth for Senzu Home Service Fee.
 *
 * Exact fee tiers:
 * - distance <= 10 km        -> Rp 0 (label: "Gratis")
 * - > 10 km AND <= 15 km     -> Rp 30.000
 * - > 15 km AND <= 20 km     -> Rp 60.000
 * - > 20 km                  -> Rp 75.000
 *
 * Evaluated on the precise numeric distanceKm, NOT on the rounded display.
 * This is one Home Service Fee per booking/order (never multiplied by guests or services).
 */
export function calculateHomeServiceFee(distanceKm: number): HomeServiceFeeCalculation {
  const safeDistance = Math.max(0, typeof distanceKm === 'number' && !isNaN(distanceKm) ? distanceKm : 0);

  if (safeDistance <= 10) {
    return {
      distanceKm: safeDistance,
      fee: 0,
      tier: 'tier-1',
      tierLabel: '<= 10 KM (Gratis)',
      isFree: true,
      formattedFee: 'GRATIS',
      requiresConfirmation: false,
    };
  } else if (safeDistance <= 15) {
    return {
      distanceKm: safeDistance,
      fee: 30000,
      tier: 'tier-2',
      tierLabel: '>10 – 15 KM',
      isFree: false,
      formattedFee: 'Rp 30.000',
      requiresConfirmation: false,
    };
  } else if (safeDistance <= 20) {
    return {
      distanceKm: safeDistance,
      fee: 60000,
      tier: 'tier-3',
      tierLabel: '>15 – 20 KM',
      isFree: false,
      formattedFee: 'Rp 60.000',
      requiresConfirmation: false,
    };
  } else {
    return {
      distanceKm: safeDistance,
      fee: 75000,
      tier: 'tier-4',
      tierLabel: '> 20 KM',
      isFree: false,
      formattedFee: 'Rp 75.000',
      requiresConfirmation: false,
    };
  }
}

/**
 * Formats distance for display (rounded to 1 decimal place)
 * e.g. 12.36 km -> "12.4 KM"
 */
export function formatDistanceDisplay(distanceKm?: number | null): string {
  if (distanceKm == null || isNaN(distanceKm)) return '-';
  const safeDistance = Math.max(0, distanceKm);
  const rounded = Math.round(safeDistance * 10) / 10;
  return `${rounded.toFixed(1)} KM`;
}

export interface RouteCalculationResponse {
  success: boolean;
  distanceKm?: number;
  distanceMeters?: number;
  durationText?: string;
  feeCalculation?: HomeServiceFeeCalculation;
  error?: string;
  baseLocation?: {
    id: string;
    name: string;
    lat: number;
    lng: number;
  };
}

/**
 * Calculates driving route distance and authoritative fee from Senzu Base to customer location.
 * Uses server endpoint /api/routes/calculate-fee which calls Google Routes API with referer.
 *
 * On route failure, returns success: false with safe error message.
 * DO NOT silently assume Rp0.
 */
export async function fetchDrivingRouteDistanceAndFee(
  customerLat: number,
  customerLng: number
): Promise<RouteCalculationResponse> {
  if (
    typeof customerLat !== 'number' ||
    typeof customerLng !== 'number' ||
    isNaN(customerLat) ||
    isNaN(customerLng)
  ) {
    return {
      success: false,
      error: 'Titik koordinat lokasi tidak valid.',
    };
  }

  try {
    const res = await fetch('/api/routes/calculate-fee', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude: customerLat,
        longitude: customerLng,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.',
      };
    }

    const distanceKm = data.distanceKm;
    const feeCalculation = calculateHomeServiceFee(distanceKm);

    return {
      success: true,
      distanceKm: data.distanceKm,
      distanceMeters: data.distanceMeters,
      durationText: data.durationText || data.duration,
      feeCalculation,
      baseLocation: data.baseLocation || {
        id: SENZU_BASE_LOCATION.id,
        name: SENZU_BASE_LOCATION.name,
        lat: SENZU_BASE_LOCATION.lat,
        lng: SENZU_BASE_LOCATION.lng,
      },
    };
  } catch (err: any) {
    console.warn('[DistanceFeeService] Route fetch error:', err);
    return {
      success: false,
      error: 'Jarak lokasi belum dapat dihitung. Silakan periksa titik lokasi Anda atau coba kembali.',
    };
  }
}
