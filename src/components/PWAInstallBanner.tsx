import React, { useState } from 'react';
import { Download, Share, X, Smartphone, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { usePWAInstall } from '../lib/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const {
    isInstallable,
    canPromptDirectly,
    isInstalled,
    isIOS,
    isDismissed,
    hasUpdate,
    applyUpdate,
    dismissUpdate,
    install,
    dismiss,
  } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  const handleInstallClick = async () => {
    if (canPromptDirectly) {
      await install();
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  const showInstallBanner = !isInstalled && !isDismissed && isInstallable;

  // If no update and no install prompt to show, return null
  if (!hasUpdate && !showInstallBanner) {
    return null;
  }

  return (
    <>
      {/* Controlled PWA Update Prompt (Prompt 19A Part 5) */}
      {hasUpdate && (
        <aside
          id="pwa-update-prompt"
          aria-label="Pembaruan Aplikasi Tersedia"
          className="w-full bg-[#082A4F] text-white border-b-2 border-[#D4AF37] px-4 py-2.5 shadow-lg flex items-center justify-between text-xs sm:text-sm z-50 transition-all"
        >
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-[#D4AF37]/20 p-1 flex-shrink-0 flex items-center justify-center border border-[#D4AF37]/40">
              <RefreshCw className="w-4 h-4 text-[#D4AF37] animate-spin" />
            </div>
            <div className="truncate">
              <p className="font-bold text-white truncate">Versi baru Senzu Home tersedia.</p>
              <p className="text-[11px] text-slate-300 truncate hidden sm:block">
                Pembaruan performa &amp; stabilitas sistem siap digunakan.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              id="btn-pwa-apply-update"
              type="button"
              onClick={applyUpdate}
              className="px-3.5 py-1.5 bg-[#D4AF37] hover:bg-[#c49f2e] text-[#082A4F] font-bold text-xs rounded-lg transition active:scale-95 flex items-center gap-1.5 cursor-pointer shadow"
            >
              <span>Perbarui</span>
            </button>
            <button
              type="button"
              onClick={dismissUpdate}
              aria-label="Tutup pemberitahuan pembaruan"
              className="p-1.5 text-slate-400 hover:text-white rounded-md transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* Standard Install Banner */}
      {showInstallBanner && (
        <aside
          aria-label="Pemberitahuan Instalasi Aplikasi"
          className="w-full bg-[#082A4F] text-white border-b border-[#082A4F]/20 px-4 py-2.5 shadow-md flex items-center justify-between text-xs sm:text-sm z-30 transition-all"
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-white/10 p-1 flex-shrink-0 flex items-center justify-center border border-white/15">
              <img
                src="/assets/brand/senzu-app-icon.svg"
                alt="Senzu Icon"
                className="w-6 h-6 object-contain"
              />
            </div>
            <div className="truncate">
              <p className="font-semibold text-white truncate">Instal Senzu Home</p>
              <p className="text-[11px] text-slate-300 truncate hidden sm:block">
                Akses cepat tanpa browser &amp; notifikasi terapis langsung di ponsel Anda.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-3 py-1.5 bg-[#D4AF37] hover:bg-[#c49f2e] text-[#082A4F] font-bold text-xs rounded-lg transition active:scale-95 flex items-center gap-1.5 cursor-pointer shadow"
            >
              {isIOS ? (
                <>
                  <Share className="w-3.5 h-3.5" />
                  <span>Petunjuk</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Instal</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Tutup pemberitahuan instalasi"
              className="p-1.5 text-slate-400 hover:text-white rounded-md transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* iOS Safari Installation Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-slate-800 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-[#082A4F]" />
                <h3 className="font-bold text-[#082A4F] text-base">Instal di iPhone / iPad</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Untuk memasang Senzu Home sebagai aplikasi di layar utama iOS Anda:
            </p>

            <ol className="space-y-3 text-xs text-slate-700">
              <li className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-full bg-[#082A4F] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                  1
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Ketuk Ikon Bagikan (Share)</p>
                  <p className="text-slate-500 text-[11px] mt-0.5 flex items-center gap-1">
                    Ketuk tombol <Share className="w-3 h-3 text-[#082A4F] inline" /> di bilah navigasi Safari bawah atau atas.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="w-6 h-6 rounded-full bg-[#082A4F] text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                  2
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Pilih Tambah ke Layar Utama</p>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Gulir opsi ke bawah lalu ketuk <strong>"Tambah ke Layar Utama" (Add to Home Screen)</strong>.
                  </p>
                </div>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full py-3 bg-[#082A4F] text-white rounded-xl font-bold text-xs hover:bg-[#0c3968] transition"
            >
              Mengerti &amp; Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const PWAInstallActionItem: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isInstallable, canPromptDirectly, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  if (isInstalled) {
    return (
      <div className={`flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 ${className}`}>
        <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        <span>Aplikasi Senzu Home telah terpasang di perangkat ini (PWA).</span>
      </div>
    );
  }

  const handleClick = async () => {
    if (canPromptDirectly) {
      await install();
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`w-full flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl transition cursor-pointer text-left ${className}`}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#082A4F] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Download className="w-4 h-4 text-[#D4AF37]" />
          </div>
          <div>
            <p className="text-xs font-bold text-[#082A4F]">Instal Aplikasi Senzu Home</p>
            <p className="text-[11px] text-slate-500">Pasang di layar utama untuk akses instan</p>
          </div>
        </div>
        <ExternalLink className="w-4 h-4 text-slate-400" />
      </button>

      {showIOSModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-[#082A4F] text-base">Instal di iOS (Safari)</h3>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Ketuk ikon <Share className="w-3.5 h-3.5 inline text-[#082A4F]" /> <strong>Bagikan</strong> di Safari, lalu pilih <strong>"Tambah ke Layar Utama" (Add to Home Screen)</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 bg-[#082A4F] text-white rounded-xl font-bold text-xs"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
};
