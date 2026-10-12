import React from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft, ShieldAlert } from 'lucide-react';
import { reportClientError } from '../lib/clientTelemetry';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onRetry?: () => void;
  onBack?: () => void;
  backButtonLabel?: string;
  scopeName?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`ErrorBoundary caught error [${this.props.scopeName || 'Global'}]:`, error, errorInfo);
    this.setState({ errorInfo });
    try {
      reportClientError({
        event: 'error_boundary_catch',
        error,
        category: 'SERVER',
        route: typeof window !== 'undefined' ? window.location.pathname : '/',
        messageSafe: `[${this.props.scopeName || 'Global'}] ${error?.message || 'Component render failed'}`,
      });
    } catch (_) {}
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  private handleBack = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onBack) {
      this.props.onBack();
    }
  };

  public render(): React.ReactNode {
    if (this.state.hasError) {
      const isCustomScope = Boolean(this.props.fallbackTitle || this.props.onBack);

      if (isCustomScope) {
        return (
          <div className="bg-white p-6 sm:p-8 rounded-3xl border border-rose-200 shadow-sm max-w-2xl mx-auto my-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-lg sm:text-xl">
                {this.props.fallbackTitle || 'Terjadi kendala saat memuat halaman'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
                {this.props.fallbackMessage ||
                  'Terjadi kendala teknis saat memproses tampilan ini. Anda dapat mencoba memuat ulang atau kembali ke menu sebelumnya.'}
              </p>
              {this.state.error && (
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-left font-mono text-[11px] text-rose-700 max-h-24 overflow-y-auto">
                  {this.state.error.message || String(this.state.error)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="px-4 py-2.5 rounded-xl bg-[#082A4F] text-white hover:bg-[#0A3866] text-xs font-bold flex items-center gap-2 cursor-pointer transition shadow-xs"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Coba Lagi</span>
              </button>
              {this.props.onBack && (
                <button
                  type="button"
                  onClick={this.handleBack}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-2 cursor-pointer transition"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>{this.props.backButtonLabel || 'Kembali ke Portal Manager'}</span>
                </button>
              )}
            </div>
          </div>
        );
      }

      // Global App Fallback
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-3xl border border-rose-200 shadow-md max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Terjadi Kendala Sistem</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Aplikasi mengalami kendala tak terduga saat memproses tampilan. Tim teknis Senzu Home telah mencatat kendala ini.
            </p>
            {this.state.error && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-left font-mono text-[11px] text-rose-600 overflow-x-auto max-h-24">
                {this.state.error.message}
              </div>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 rounded-xl bg-[#082A4F] hover:bg-[#0A3866] text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-xs"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Muat Ulang Halaman</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
