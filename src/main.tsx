import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initGlobalErrorHandlers } from './lib/clientTelemetry';

// Filter benign Firestore idle stream disconnect notices and handle Google Maps authorization notices
if (typeof window !== 'undefined') {
  initGlobalErrorHandlers();

  // Intercept Google Maps global gm_authFailure early at module root
  (window as any).gm_authFailure = function () {
    (window as any).__gmp_auth_failed = true;
    window.dispatchEvent(
      new CustomEvent('gmp-auth-failure', {
        detail: { type: 'gm_authFailure', origin: window.location.origin }
      })
    );
    console.warn(
      `[Google Maps Platform] Authorization notice: RefererNotAllowedMapError or key restriction. Authorize "${window.location.origin}/*" in Google Cloud Console.`
    );
  };

  const origConsoleError = console.error;
  console.error = function (...args: any[]) {
    const fullMsg = args
      .map((a) => (typeof a === 'string' ? a : typeof a?.message === 'string' ? a.message : ''))
      .join(' ');

    if (
      fullMsg.includes('Disconnecting idle stream') ||
      fullMsg.includes('Timed out waiting for new targets') ||
      (fullMsg.includes('@firebase/firestore') && fullMsg.includes('CANCELLED'))
    ) {
      // Normal gRPC listen stream teardown when all snapshot listeners unmount or idle
      return;
    }

    if (
      fullMsg.includes('RefererNotAllowedMapError') ||
      fullMsg.includes('Google Maps JavaScript API error') ||
      fullMsg.includes('ApiNotActivatedMapError')
    ) {
      (window as any).__gmp_auth_failed = true;
      window.dispatchEvent(
        new CustomEvent('gmp-auth-failure', {
          detail: { type: 'RefererNotAllowedMapError', message: fullMsg, origin: window.location.origin }
        })
      );
      console.warn(
        `[Google Maps Platform] Referrer restriction detected. Please authorize "${window.location.origin}/*" in Google Cloud Console under API key Website restrictions. Falling back to internal interactive GPS map.`
      );
      return;
    }

    origConsoleError.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

