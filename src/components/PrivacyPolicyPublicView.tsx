import React from 'react';
import {
  ShieldCheck,
  Lock,
  FileText,
  ArrowLeft,
  ExternalLink,
  MapPin,
  CreditCard,
  Database,
  Trash2,
  Phone,
  Mail,
  Building2,
  Server,
  EyeOff,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { SenzuLogo } from './SenzuLogo';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';

interface PrivacyPolicyPublicViewProps {
  onBack?: () => void;
  onGoToHapusAkun?: () => void;
}

export const PrivacyPolicyPublicView: React.FC<PrivacyPolicyPublicViewProps> = ({
  onBack,
  onGoToHapusAkun,
}) => {
  const { isAvailable, getWhatsAppUrl, displayWhatsApp } = useCustomerServiceWhatsApp();

  React.useEffect(() => {
    window.scrollTo(0, 0);
    const originalTitle = document.title;
    document.title = 'Kebijakan Privasi — Senzu Home (PT KSBONE UNTUK KITA)';
    return () => {
      document.title = originalTitle;
    };
  }, []);

  const handleReturnHome = () => {
    if (onBack) {
      onBack();
    } else {
      window.location.href = '/';
    }
  };

  const handleNavigateHapusAkun = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onGoToHapusAkun) {
      onGoToHapusAkun();
    } else {
      window.history.pushState({}, '', '/hapus-akun');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between selection:bg-[#D4AF37]/20 selection:text-[#082A4F]">
      {/* 1. Header Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReturnHome}
              className="p-2 -ml-2 rounded-xl text-slate-600 hover:text-[#082A4F] hover:bg-slate-100 transition cursor-pointer"
              title="Kembali ke Beranda"
              aria-label="Kembali"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <SenzuLogo className="w-8 h-8" />
              <div>
                <span className="font-serif font-bold text-base sm:text-lg text-[#082A4F] tracking-tight block leading-tight">
                  Senzu Home
                </span>
                <span className="text-[10px] text-[#D4AF37] font-semibold tracking-wider uppercase block">
                  Kebijakan Privasi
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/hapus-akun"
              onClick={handleNavigateHapusAkun}
              className="hidden sm:inline-flex px-3.5 py-1.5 rounded-xl border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition cursor-pointer items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus Akun</span>
            </a>
            <button
              type="button"
              onClick={handleReturnHome}
              className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              Ke Beranda
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 sm:space-y-8">
        {/* Title Section */}
        <div className="space-y-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#082A4F]/10 text-[#082A4F] text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Google Play Privacy Policy & Data Safety</span>
          </div>
          <h1 className="font-serif font-bold text-2xl sm:text-3xl text-[#082A4F] tracking-tight">
            Kebijakan Privasi Senzu Home
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">
            Kebijakan Privasi ini menjelaskan bagaimana <strong>Senzu Home</strong> (layanan pijat dan refleksi keluarga profesional) yang dioperasikan secara resmi oleh <strong>PT KSBONE UNTUK KITA</strong> mengumpulkan, menggunakan, menyimpan, melindungi, dan menghapus data pribadi pengguna saat mengakses aplikasi dan layanan home service kami di Kota Palembang.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-500">
            <span>Berlaku efektif: Januari 2026</span>
            <span>•</span>
            <span>Terakhir diperbarui: September 2026</span>
            <span>•</span>
            <span className="text-[#082A4F] font-medium">PT KSBONE UNTUK KITA</span>
          </div>
        </div>

        {/* Company Identity Banner */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#082A4F] to-[#0D3866] text-white rounded-3xl shadow-sm border border-[#D4AF37]/30 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Building2 className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-sm sm:text-base text-white">
                Identitas Pengelola Layanan
              </h2>
              <p className="text-[11px] text-slate-300">
                PT KSBONE UNTUK KITA — Senzu Reflexology and Family Massage Palembang
              </p>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-200 leading-relaxed pt-1">
            Layanan home service <strong>Senzu Home</strong> diselenggarakan oleh badan hukum resmi <strong>PT KSBONE UNTUK KITA</strong> yang berkedudukan di Kota Palembang, Sumatera Selatan. Kami berkomitmen penuh untuk melindungi privasi pelanggan dan mematuhi seluruh peraturan perundang-undangan perlindungan data pribadi serta pedoman keselamatan data (Data Safety) Google Play.
          </p>
        </div>

        {/* Section 1: Kategori Data Pribadi yang Dikumpulkan */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                1. Kategori Data Pribadi yang Kami Kumpulkan
              </h2>
              <p className="text-xs text-slate-500">
                Data yang diberikan langsung oleh pengguna secara sukarela saat pendaftaran atau reservasi
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs leading-relaxed">
            {/* A. Data Akun & Otentikasi */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                <Lock className="w-4 h-4 text-[#D4AF37]" />
                <span>A. Data Akun & Otentikasi</span>
              </div>
              <p className="text-slate-600">
                Meliputi nama lengkap pelanggan, alamat email, dan kredensial kata sandi yang dienkripsi secara aman melalui Firebase Authentication. Kami tidak pernah melihat atau menyimpan kata sandi dalam bentuk teks terbuka (plain text).
              </p>
            </div>

            {/* B. Data Kontak & Komunikasi */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                <Phone className="w-4 h-4 text-[#D4AF37]" />
                <span>B. Data Kontak & Komunikasi</span>
              </div>
              <p className="text-slate-600">
                Nomor telepon seluler dan nomor WhatsApp aktif yang digunakan untuk konfirmasi status reservasi, pengiriman informasi kedatangan terapis, dan saluran komunikasi bantuan resmi.
              </p>
            </div>

            {/* C. Data Alamat & Geolokasi */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                <MapPin className="w-4 h-4 text-[#D4AF37]" />
                <span>C. Data Alamat & Geolokasi</span>
              </div>
              <p className="text-slate-600">
                Alamat lengkap tempat tinggal/hunian pelanggan (rumah, apartemen, penginapan), patokan lokasi, dan koordinat GPS lokasi pemesanan yang digunakan semata-mata untuk verifikasi radius jangkauan layanan Palembang dan panduan navigasi kedatangan terapis.
              </p>
            </div>

            {/* D. Data Reservasi & Transaksi */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                <Clock className="w-4 h-4 text-[#D4AF37]" />
                <span>D. Data Reservasi & Transaksi</span>
              </div>
              <p className="text-slate-600">
                Paket treatment wellness/massage yang dipilih, durasi layanan, tanggal dan jam pesanan, catatan kenyamanan treatment, riwayat booking, serta poin loyalitas Senzu Rewards.
              </p>
            </div>

            {/* E. Bukti Pembayaran Non-Tunai */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 md:col-span-2">
              <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                <CreditCard className="w-4 h-4 text-[#D4AF37]" />
                <span>E. Bukti Pembayaran (Transfer Bank & QRIS)</span>
              </div>
              <p className="text-slate-600">
                Senzu Home beroperasi dengan kebijakan 100% non-tunai (cashless). Unggahan bukti transfer bank resmi (ke rekening atas nama PT KSBONE UNTUK KITA di BNI, Mandiri, atau BRI) atau bukti pembayaran QRIS Resmi Senzu digunakan oleh Customer Support Specialist (CSS) untuk memverifikasi kecocokan transaksi sebelum terapis ditugaskan ke lokasi.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Mengapa Data Dikumpulkan dan Digunakan */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                2. Mengapa Data Dikumpulkan dan Digunakan
              </h2>
              <p className="text-xs text-slate-500">
                Tujuan spesifik pemrosesan data untuk kelancaran layanan home service
              </p>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
            Data pribadi Anda digunakan semata-mata untuk tujuan operasional sah berikut:
          </p>

          <ul className="space-y-2.5 text-xs sm:text-sm text-slate-600 pl-1">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                ✓
              </span>
              <span>
                <strong>Koordinasi Layanan Home Service:</strong> Mengkoordinasikan penugasan terapis resmi Senzu Home dan memandu navigasi terapis menuju lokasi hunian Anda secara tepat waktu.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                ✓
              </span>
              <span>
                <strong>Notifikasi & Pembaruan Pesanan:</strong> Mengirimkan status konfirmasi reservasi, verifikasi pembayaran, pengingat jadwal, serta notifikasi keberangkatan terapis.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                ✓
              </span>
              <span>
                <strong>Pengelolaan Reward & Voucher:</strong> Menghitung dan mengelola perolehan poin Senzu Rewards, tingkatan loyalty tier, dan penerapan voucher diskon.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                ✓
              </span>
              <span>
                <strong>Bantuan Pelanggan & Respons Darurat:</strong> Memberikan dukungan melalui Customer Service resmi WhatsApp untuk perubahan jadwal, bantuan transaksi, dan penanganan keluhan.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                ✓
              </span>
              <span>
                <strong>Keamanan, Kepatuhan & Pencegahan Penipuan:</strong> Menjaga integritas sistem, mencegah manipulasi transaksi, dan memenuhi kewajiban hukum pembukuan serta pelaporan pajak.
              </span>
            </li>
          </ul>
        </section>

        {/* Section 3: Penggunaan Alamat, Peta & Geolokasi */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                3. Kebijakan Alamat & Penggunaan Geolokasi
              </h2>
              <p className="text-xs text-slate-500">
                Penggunaan lokasi hunian dan koordinat geolokasi pelanggan
              </p>
            </div>
          </div>

          <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-3">
            <p>
              Karena Senzu Home adalah layanan home service (terapis berkunjung ke lokasi hunian pelanggan di Kota Palembang), data alamat hunian dan titik koordinat GPS sangat diperlukan untuk:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1">
                <span className="font-bold text-[#082A4F] block">Verifikasi Jangkauan Area</span>
                <p className="text-slate-600">
                  Memastikan alamat pemesanan berada dalam radius operasional cabang Senzu Home Palembang (Kecamatan Ilir Barat, Ilir Timur, Sukarami, Alang-Alang Lebar, Sako, Kemuning, Plaju, dll).
                </p>
              </div>
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-1">
                <span className="font-bold text-[#082A4F] block">Navigasi Kedatangan Terapis</span>
                <p className="text-slate-600">
                  Memberikan rute navigasi akurat bagi terapis berlisensi resmi Senzu agar dapat tiba tepat waktu sesuai jadwal yang telah Anda tentukan.
                </p>
              </div>
            </div>
            <p className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl text-[11px] sm:text-xs text-amber-900 leading-relaxed">
              <strong>Catatan Privasi:</strong> Izin akses geolokasi hanya diminta saat Anda menentukan lokasi booking di aplikasi. Senzu Home <strong>tidak melakukan pelacakan lokasi latar belakang (background location tracking)</strong> secara berkelanjutan tanpa sepengetahuan Anda.
            </p>
          </div>
        </section>

        {/* Section 4: Keamanan Data & Perlindungan Kata Sandi */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                4. Keamanan, Transmisi & Perlindungan Sandi
              </h2>
              <p className="text-xs text-slate-500">
                Standar enkripsi teknis dan kontrol akses berlapis
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <p>
              Kami menerapkan standar keamanan teknis dan organisasional yang ketat untuk melindungi data pribadi Anda dari akses, pengubahan, pengungkapan, atau pemusnahan yang tidak sah:
            </p>
            <ul className="list-disc list-inside space-y-1.5 pl-1 text-slate-700">
              <li>
                <strong>Enkripsi Saat Transit (TLS/HTTPS):</strong> Seluruh transmisi data antara aplikasi perangkat Anda dan server Senzu Home dilindungi dengan protokol enkripsi modern (HTTPS/TLS).
              </li>
              <li>
                <strong>Kerahasiaan Kata Sandi:</strong> Kata sandi akun pelanggan dienkripsi secara aman melalui Firebase Authentication. Staf, terapis, maupun manajemen Senzu Home tidak memiliki akses untuk melihat kata sandi Anda.
              </li>
              <li>
                <strong>Kontrol Akses Berbasis Peran (RBAC):</strong> Hak akses data dibatasi secara ketat berdasarkan prinsip hak istimewa terkecil (least privilege). Terapis hanya melihat data operasional yang relevan dengan tugas treatment yang ditugaskan kepada mereka.
              </li>
              <li>
                <strong>Proteksi Bukti Pembayaran:</strong> Berkas verifikasi pembayaran disimpan dalam repositori awan terlindung dan hanya dapat diakses oleh tim Customer Support Specialist (CSS) yang berwenang.
              </li>
            </ul>
          </div>
        </section>

        {/* Section 5: Layanan Pihak Ketiga & Jaminan Tidak Menjual Data */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                5. Layanan Pihak Ketiga & Komitmen Perlindungan
              </h2>
              <p className="text-xs text-slate-500">
                Penyedia infrastruktur teknologi resmi dan penegasan privasi
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <p>
              Untuk menyediakan layanan aplikasi yang aman dan andal, Senzu Home menggunakan infrastruktur pihak ketiga terkemuka:
            </p>

            <div className="space-y-2.5">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                <span className="font-bold text-[#082A4F] block">Google Firebase (Google LLC)</span>
                <p className="text-slate-600">
                  Digunakan untuk otentikasi akun aman (Firebase Authentication), penyimpanan basis data terenkripsi untuk pesanan dan profil (Cloud Firestore), serta penyimpanan dokumen bukti transfer (Firebase Storage).
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1">
                <span className="font-bold text-[#082A4F] block">Google Maps Platform (Google LLC)</span>
                <p className="text-slate-600">
                  Digunakan untuk layanan geocoding alamat hunian, penentuan radius jangkauan layanan Palembang, dan navigasi terapis.
                </p>
              </div>
            </div>

            {/* Anti-Selling Commitment */}
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-start gap-3">
              <EyeOff className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs sm:text-sm">
                <strong className="text-emerald-950 block">Jaminan: Tidak Menjual Data ke Pihak Ketiga</strong>
                <p className="text-emerald-900 leading-relaxed">
                  Senzu Home dan PT KSBONE UNTUK KITA <strong>tidak pernah dan tidak akan pernah menjual, menyewakan, atau memperdagangkan data pribadi Anda kepada pihak ketiga</strong> untuk keperluan periklanan bertarget, broker data, atau tujuan komersial di luar penyediaan layanan Senzu Home. Aplikasi ini tidak memuat jaringan iklan pihak ketiga.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 6: Praktik & Periode Retensi Data */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
              <Clock className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                6. Praktik & Kebijakan Retensi Data
              </h2>
              <p className="text-xs text-slate-500">
                Penyimpanan data proporsional sesuai ketentuan hukum yang berlaku
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <p>
              Kami menyimpan data pribadi Anda selama akun Anda aktif untuk memberikan pengalaman layanan home service yang berkelanjutan, memelihara saldo Senzu Rewards, dan memudahkan pemesanan ulang.
            </p>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <span className="font-semibold text-slate-800 block text-xs">Ketentuan Retensi Wajib Simpan:</span>
              <p className="text-slate-700 italic bg-white p-3 rounded-xl border border-slate-200 text-xs sm:text-sm">
                “Data tertentu yang wajib dipertahankan karena kewajiban hukum, perpajakan, akuntansi, keamanan, pencegahan penipuan, atau penyelesaian sengketa hanya akan disimpan selama periode yang diwajibkan atau diizinkan berdasarkan ketentuan yang berlaku, kemudian dihapus atau dianonimkan apabila tidak lagi diperlukan.”
              </p>
              <p className="text-slate-600 text-[11px] sm:text-xs leading-relaxed">
                Durasi retensi spesifik yang berlaku dapat berbeda bergantung pada jenis catatan dan kewajiban hukum yang relevan (seperti peraturan pembukuan dan perpajakan di Republik Indonesia). Senzu Home tidak menyimpan data pribadi Anda tanpa batas waktu (data tidak dipertahankan melebihi periode yang dibutuhkan untuk tujuan sah tersebut).
              </p>
            </div>
          </div>
        </section>

        {/* Section 7: Hak Pelanggan & Prosedur Penghapusan Akun */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                7. Hak Pelanggan & Penghapusan Akun (Google Play Compliance)
              </h2>
              <p className="text-xs text-slate-500">
                Prosedur penutupan akun dan penghapusan data secara mandiri
              </p>
            </div>
          </div>

          <div className="space-y-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <p>
              Pelanggan berhak memperbarui data profil, mengubah kata sandi, atau mengajukan permohonan penutupan akun dan penghapusan data pribadi kapan saja. Pengajuan dapat dilakukan langsung melalui menu <strong>Akun</strong> di dalam aplikasi, atau melalui halaman web resmi yang dapat diakses publik tanpa perlu masuk akun:
            </p>

            <div className="p-4 bg-rose-50/60 rounded-2xl border border-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold text-rose-950 text-xs sm:text-sm block">
                  Halaman Web Resmi Penghapusan Akun:
                </span>
                <a
                  href="/hapus-akun"
                  onClick={handleNavigateHapusAkun}
                  className="text-[#082A4F] font-bold text-xs sm:text-sm underline hover:text-rose-600 break-all"
                >
                  https://senzuhome.com/hapus-akun
                </a>
              </div>
              <a
                href="/hapus-akun"
                onClick={handleNavigateHapusAkun}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 shrink-0"
              >
                <span>Buka Formulir Hapus Akun</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Grid data dihapus vs data disimpan */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-xs">
              <div className="p-4 bg-rose-50/40 rounded-2xl border border-rose-100 space-y-2">
                <span className="font-bold text-rose-950 block">Data yang Dihapus Secara Permanen:</span>
                <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1 text-[11px] sm:text-xs">
                  <li>Nama lengkap, data profil, dan info identitas akun</li>
                  <li>Akun otentikasi login email dan kata sandi</li>
                  <li>Daftar alamat rumah dan patokan tersimpan</li>
                  <li>Preferensi komunikasi dan pengaturan notifikasi</li>
                  <li>Saldo poin Senzu Rewards dan voucher aktif</li>
                </ul>
              </div>

              <div className="p-4 bg-amber-50/40 rounded-2xl border border-amber-200/70 space-y-2">
                <span className="font-bold text-amber-950 block">Data yang Tetap Disimpan Terbatas:</span>
                <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1 text-[11px] sm:text-xs">
                  <li>Catatan transaksi booking yang telah selesai</li>
                  <li>Bukti verifikasi pembayaran transfer/QRIS</li>
                  <li>Faktur akuntansi untuk kepatuhan pajak</li>
                  <li>Log audit keamanan untuk pencegahan penipuan</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Section 8: Kontak Resmi & Saluran Bantuan Privasi */}
        <section className="bg-white rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F]">
                8. Saluran Kontak & Layanan Pelanggan
              </h2>
              <p className="text-xs text-slate-500">
                Informasi kontak resmi untuk pertanyaan seputar kebijakan privasi dan data
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <p>
              Apabila Anda memiliki pertanyaan, saran, pengaduan, atau permohonan pembaruan terkait Kebijakan Privasi ini, silakan hubungi saluran resmi kami:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                  <Building2 className="w-4 h-4 text-[#D4AF37]" />
                  <span>Pengelola Resmi</span>
                </div>
                <p className="text-slate-800 font-semibold">PT KSBONE UNTUK KITA</p>
                <p className="text-slate-500 text-[11px]">Senzu Reflexology & Family Massage</p>
                <p className="text-slate-600 text-[11px]">
                  Jl. Riau No.3, 26 Ilir D. I, Kec. Ilir Bar. I, Kota Palembang, Sumatera Selatan
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                  <Mail className="w-4 h-4 text-[#D4AF37]" />
                  <span>Kontak Komunikasi</span>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-700">
                    Email: <a href="mailto:senzureflexology@gmail.com" className="text-[#082A4F] font-semibold hover:underline">senzureflexology@gmail.com</a>
                  </p>
                  {isAvailable && (
                    <p className="text-slate-700">
                      WhatsApp CS:{' '}
                      <a
                        href={getWhatsAppUrl('Halo CS Senzu Home, saya ingin bertanya mengenai Kebijakan Privasi data pengguna.')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 font-bold hover:underline"
                      >
                        {displayWhatsApp}
                      </a>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {isAvailable && (
              <div className="pt-2">
                <a
                  href={getWhatsAppUrl('Halo CS Senzu Home, saya ingin bertanya mengenai Kebijakan Privasi data pengguna.')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-xs"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Hubungi Customer Service WhatsApp Resmi</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* 3. Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 mt-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center text-xs text-slate-500 space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-slate-600">
            <button
              type="button"
              onClick={handleReturnHome}
              className="hover:text-[#082A4F] hover:underline cursor-pointer"
            >
              Beranda Senzu Home
            </button>
            <span>•</span>
            <a
              href="/hapus-akun"
              onClick={handleNavigateHapusAkun}
              className="hover:text-rose-700 hover:underline cursor-pointer"
            >
              Pengajuan Penghapusan Akun
            </a>
            <span>•</span>
            <a
              href="/kebijakan-privasi"
              className="text-[#082A4F] font-bold"
            >
              Kebijakan Privasi
            </a>
          </div>
          <p className="font-medium text-slate-700">
            PT KSBONE UNTUK KITA — Senzu Reflexology & Family Massage Palembang
          </p>
          <p className="text-[11px] text-slate-400">
            Wellness Comes to You • Layanan Home Service Terpercaya, Higienis & Profesional di Kota Palembang
          </p>
        </div>
      </footer>
    </div>
  );
};
