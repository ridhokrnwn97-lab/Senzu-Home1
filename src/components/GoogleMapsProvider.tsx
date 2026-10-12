import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AlertTriangle, Copy, Check, ExternalLink, X, ShieldAlert, Navigation } from 'lucide-react';

interface GoogleMapsContextValue {
  apiKey: string;
  isKeyProvided: boolean;
  hasAuthError: boolean;
  authErrorMessage: string;
  forceFallback: boolean;
  setForceFallback: (v: boolean) => void;
  currentDomainPattern: string;
  baseLocation: {
    name: string;
    lat: number;
    lng: number;
  };
}

const GoogleMapsContext = createContext<GoogleMapsContextValue>({
  apiKey: '',
  isKeyProvided: false,
  hasAuthError: false,
  authErrorMessage: '',
  forceFallback: false,
  setForceFallback: () => {},
  currentDomainPattern: '',
  baseLocation: {
    name: 'Senzu Home (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)',
    lat: -2.9859024,
    lng: 104.7385997,
  },
});

export const useGoogleMaps = () => useContext(GoogleMapsContext);

interface GoogleMapsProviderProps {
  children: ReactNode;
  baseLocation?: {
    name: string;
    lat: number;
    lng: number;
  };
}

export const GoogleMapsProvider: React.FC<GoogleMapsProviderProps> = ({
  children,
  baseLocation = {
    name: 'Senzu Home (Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan)',
    lat: -2.9859024,
    lng: 104.7385997,
  },
}) => {
  const apiKey = (((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string) || '').trim();
  const isKeyProvided = Boolean(apiKey && apiKey.length > 5);

  const [hasAuthError, setHasAuthError] = useState(() =>
    typeof window !== 'undefined' ? Boolean((window as any).__gmp_auth_failed) : false
  );
  const [authErrorMessage, setAuthErrorMessage] = useState(() =>
    typeof window !== 'undefined' && (window as any).__gmp_auth_failed ? 'RefererNotAllowedMapError' : ''
  );
  const [forceFallback, setForceFallback] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Compute wildcard domain for Google Cloud Console HTTP Referrers whitelist
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ais-dev-*.run.app';
  const currentDomainPattern = `${origin}/*`;

  useEffect(() => {
    const handleAuthFailure = (event: any) => {
      console.warn('Google Maps auth error detected via event:', event?.detail);
      setHasAuthError(true);
      setAuthErrorMessage('RefererNotAllowedMapError');
    };
    window.addEventListener('gmp-auth-failure', handleAuthFailure);

    // Intercept Google Maps global gm_authFailure callback safely without calling alert()
    const previousHandler = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      console.warn('Google Maps Platform: gm_authFailure intercepted (RefererNotAllowedMapError or billing restriction)');
      setHasAuthError(true);
      setAuthErrorMessage('RefererNotAllowedMapError');
    };

    // Catch window error event for RefererNotAllowedMapError
    const errorHandler = (event: ErrorEvent) => {
      const msg = event.message || '';
      const filename = event.filename || '';
      if (
        msg.includes('RefererNotAllowedMapError') ||
        (msg.includes('Google Maps JavaScript API error') && filename.includes('maps.googleapis.com'))
      ) {
        console.warn('Google Maps auth error detected:', msg);
        setHasAuthError(true);
        setAuthErrorMessage('RefererNotAllowedMapError');
      }
    };

    window.addEventListener('error', errorHandler);

    return () => {
      window.removeEventListener('gmp-auth-failure', handleAuthFailure);
      (window as any).gm_authFailure = previousHandler;
      window.removeEventListener('error', errorHandler);
    };
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(currentDomainPattern);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const contextValue: GoogleMapsContextValue = {
    apiKey,
    isKeyProvided,
    hasAuthError,
    authErrorMessage,
    forceFallback,
    setForceFallback,
    currentDomainPattern,
    baseLocation,
  };

  return (
    <GoogleMapsContext.Provider value={contextValue}>
      {/* Banner for RefererNotAllowedMapError / Domain Whitelist instruction */}
      {hasAuthError && !isDismissed && (
        <div className="bg-gradient-to-r from-amber-500 via-amber-600 to-rose-600 text-white p-3.5 sm:p-4 text-xs shadow-md border-b border-amber-600 relative z-50 animate-fade-in">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-100 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold flex items-center gap-2 text-sm text-white">
                  <span>Google Maps: Domain Belum Diizinkan di Google Cloud Console</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider">
                    RefererNotAllowedMapError
                  </span>
                </div>
                <p className="text-amber-100 leading-relaxed text-xs max-w-2xl">
                  Kunci API Anda memiliki pembatasan HTTP Referrer. Tambahkan URL domain preview ini ke daftar <strong>Website restrictions</strong> di Google Cloud Console agar peta Google Maps satelit dapat tampil:
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <code className="bg-black/40 px-2.5 py-1 rounded-md text-[11px] font-mono text-emerald-200 select-all border border-white/10">
                    {currentDomainPattern}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white text-slate-800 hover:bg-amber-100 text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Tersalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-600" />
                        <span>Salin URL</span>
                      </>
                    )}
                  </button>
                  <a
                    href="https://console.cloud.google.com/google/maps-apis/credentials?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-white hover:text-amber-200 underline font-medium text-xs ml-1"
                  >
                    <span>Buka Google Cloud Credentials</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-center flex-shrink-0">
              <button
                type="button"
                onClick={() => setForceFallback(!forceFallback)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  forceFallback
                    ? 'bg-emerald-700 text-white'
                    : 'bg-white/20 hover:bg-white/30 text-white'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>{forceFallback ? 'Mode Cadangan Aktif' : 'Pakai Mode Offline/GPS Pin'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsDismissed(true)}
                className="p-1.5 rounded-lg bg-black/20 hover:bg-black/30 text-white/80 hover:text-white transition"
                title="Tutup Notifikasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {isKeyProvided && !forceFallback ? (
        <APIProvider
          apiKey={apiKey}
          libraries={['places', 'routes', 'geometry', 'marker']}
          authReferrerPolicy="origin"
          onError={(err) => {
            console.warn('Google Maps APIProvider error:', err);
            setHasAuthError(true);
            setAuthErrorMessage('RefererNotAllowedMapError');
          }}
        >
          {children}
        </APIProvider>
      ) : (
        children
      )}
    </GoogleMapsContext.Provider>
  );
};
