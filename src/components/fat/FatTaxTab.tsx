import React from 'react';
import { AlertTriangle, FileCheck2, Info, ShieldCheck } from 'lucide-react';

export const FatTaxTab: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
        <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          <p className="font-semibold">Tax status (read-only, tanpa perhitungan asumtif)</p>
          <p className="mt-0.5">Halaman ini menampilkan status ketersediaan informasi pajak berdasarkan evidence yang terkonfirmasi di sistem saat ini. Tidak ada modul PPN/PPh, kalkulasi, atau laporan pajak yang dihasilkan tanpa aturan terkonfirmasi.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <h2 className="font-bold text-[#4B2B18] flex items-center gap-2"><FileCheck2 className="w-4 h-4" /> Status modul pajak</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-slate-800">Modul Pajak/PPN/PPh khusus: tidak teridentifikasi</p>
                <p className="text-slate-600 mt-0.5">Tidak ditemukan modul manajemen pajak, perhitungan PPN/PPh, atau pelaporan pajak khusus di aplikasi untuk ditampilkan sebagai fitur aktif.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-slate-800">Kebijakan pajak Accurate (informasi terbatas)</p>
                <p className="text-slate-600 mt-0.5">Dokumentasi/kontrak sync Accurate saat ini mengindikasikan kebijakan validasi seperti <code className="px-1 py-0.5 bg-slate-100 rounded">taxPolicy: 'no_extra_tax'</code> pada alur posting yang didukung. Ini adalah sinyal konfigurasi/validasi integrasi, <strong>bukan</strong> modul pengelolaan pajak atau bukti kepatuhan pajak.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
          <h2 className="font-bold text-[#4B2B18] flex items-center gap-2"><Info className="w-4 h-4" /> Batasan & langkah aman</h2>
          <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5">
            <li>Tidak ada kalkulasi PPN/PPh otomatis, tarif pajak, atau penentuan kewajiban pajak di dashboard ini.</li>
            <li>Tidak ada pembuatan/ekspor laporan pajak karena rule dan sumber data pajak terkonfirmasi belum tersedia di aplikasi.</li>
            <li>Untuk kebutuhan pajak operasional, gunakan proses dan sistem pajak resmi yang ditetapkan perusahaan; dashboard ini hanya monitoring status ketersediaan informasi.</li>
            <li>Jika modul/rule pajak ditambahkan di masa depan, tab ini dapat diperluas dengan sumber data dan perhitungan yang tervalidasi.</li>
          </ul>
        </div>
      </div>

      <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-4 sm:p-5">
        <p className="text-sm font-medium text-slate-700">Ringkasan status</p>
        <p className="text-sm text-slate-600 mt-1">Fitur pajak pada dashboard FAT saat ini: <span className="font-semibold">status/informasi ketersediaan saja</span>. Perhitungan dan pelaporan pajak: <span className="font-semibold">belum tersedia</span> (sesuai evidence sistem saat ini).</p>
      </div>
    </div>
  );
};
