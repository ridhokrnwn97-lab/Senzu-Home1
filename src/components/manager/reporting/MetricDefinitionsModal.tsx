import React from 'react';
import { X, HelpCircle, BookOpen, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface MetricDefinitionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MetricDefinitionsModal: React.FC<MetricDefinitionsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const definitions = [
    {
      term: 'Omzet Terealisasi (Realized Revenue)',
      formula: 'Σ (Total Nilai Transaksi) untuk Booking Selesai (Completed) & Pembayaran Lunas (Paid)',
      desc: 'Hanya menghitung rupiah dari layanan yang telah benar-benar tuntas dikerjakan dan pembayaran bukti transfer / QRIS telah diverifikasi lunas oleh CSS/Sistem. Tidak menghitung pesanan yang belum selesai, belum bayar, atau dibatalkan. Ini adalah omzet bruto terealisasi, bukan laba bersih (net profit).',
      badge: 'Definisi Finansial Otoritatif',
    },
    {
      term: 'Nilai Reservasi (Booking Value)',
      formula: 'Σ (Total Nilai Transaksi) seluruh reservasi aktif (Non-Cancelled)',
      desc: 'Estimasi nilai kotor dari seluruh pesanan yang masuk dan dikonfirmasi, terlepas apakah sudah selesai atau masih dalam proses antrian hari ini.',
      badge: 'Pipeline Nilai Kotor',
    },
    {
      term: 'Average Order Value (AOV)',
      formula: 'Omzet Terealisasi ÷ Jumlah Booking Selesai Lunas',
      desc: 'Nilai rata-rata pembelanjaan pelanggan per pesanan lunas yang telah selesai dilaksanakan. Jika belum ada booking selesai lunas, nilai aman adalah Rp 0 (menghindari error pembagian nol).',
      badge: 'Rata-rata Keranjang',
    },
    {
      term: 'Repeat Rate (Tingkat Pelanggan Berulang)',
      formula: '(Pelanggan dengan ≥ 2 Booking Selesai ÷ Total Pelanggan dengan ≥ 1 Booking Selesai) × 100%',
      desc: 'Mengukur loyalitas pelanggan. Dihitung secara tegas menggunakan penyebut pelanggan yang pernah menyelesaikan minimal 1 kali treatment agar persentase akurat dan tidak bias oleh akun baru yang belum pernah booking.',
      badge: 'Retensi CRM',
    },
    {
      term: 'Utilisasi Terapis (Therapist Utilization)',
      formula: '(Menit Treatment Aktif ÷ Menit Jam Kerja Terjadwal Roster) × 100%',
      desc: 'Mengukur persentase waktu terapis bertugas melayani pelanggan dibandingkan jam shift kerja resmi dari Roster Terjadwal (dikurangi jam istirahat). Jika data roster pada tanggal terkait belum lengkap, sistem secara aman menampilkan label "Data roster belum lengkap" untuk menghindari kesimpulan keliru.',
      badge: 'Kapasitas Operasional',
    },
    {
      term: 'On-Time Arrival Rate (Tingkat Ketepatan Tiba)',
      formula: '(Jumlah Tiba Tepat Waktu ÷ Total Kedatangan Terlacak) × 100%',
      desc: 'Menghitung ketepatan waktu terapis tiba di alamat pelanggan dibandingkan jam reservasi yang disepakati, dengan toleransi keterlambatan sesuai Pengaturan Operasional (default 15 menit). Hanya dihitung dari booking yang memiliki data catatan waktu tiba (arrivedAt) resmi.',
      badge: 'SLA Layanan',
    },
    {
      term: 'Cancellation Rate (Tingkat Pembatalan)',
      formula: '(Jumlah Booking Dibatalkan ÷ Total Seluruh Booking Masuk) × 100%',
      desc: 'Mengukur proporsi reservasi yang dibatalkan oleh pelanggan maupun operasional di periode terpilih.',
      badge: 'Kontrol Risiko',
    },
    {
      term: 'SLA Verifikasi Pembayaran CSS',
      formula: 'Waktu Pembayaran Lunas (verifiedAt) - Waktu Bukti Diunggah (proofUploadedAt)',
      desc: 'Mengukur kecepatan Customer Service Officer dalam memverifikasi keabsahan bukti bayar transfer/QRIS pelanggan dibandingkan target batas SLA yang ditetapkan di Pengaturan Operasional (default 120 menit).',
      badge: 'Kinerja CS',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#082A4F] text-white border-b border-[#D4AF37]/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                Kamus &amp; Definisi Metrik Manajemen Senzu Home
              </h2>
              <p className="text-xs text-slate-300">
                Standar perhitungan analitik &amp; laporan resmi manajemen
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm bg-slate-50/50">
          <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              Semua metrik menggunakan <strong>snapshot data pada saat booking</strong> untuk menjamin integritas histori keuangan saat harga master data berubah di masa depan. Seluruh waktu disinkronkan ke zona waktu <strong>Asia/Jakarta (WIB)</strong>.
            </p>
          </div>

          <div className="space-y-3">
            {(definitions || []).map((d, idx) => (
              <div
                key={idx}
                className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-[#D4AF37]/50 transition"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="font-bold text-[#082A4F] text-sm flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 text-xs flex items-center justify-center font-semibold">
                      {idx + 1}
                    </span>
                    {d.term}
                  </h3>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#082A4F]/10 text-[#082A4F] whitespace-nowrap">
                    {d.badge}
                  </span>
                </div>
                <div className="text-xs font-mono bg-slate-100/80 px-2.5 py-1.5 rounded-lg text-slate-700 mb-2 border border-slate-200/80">
                  <span className="text-slate-400 mr-1.5">Rumus:</span>
                  {d.formula}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {d.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#082A4F] hover:bg-[#082A4F]/90 text-white text-xs font-semibold rounded-xl transition shadow-xs"
          >
            Tutup Definisi
          </button>
        </div>
      </div>
    </div>
  );
};
