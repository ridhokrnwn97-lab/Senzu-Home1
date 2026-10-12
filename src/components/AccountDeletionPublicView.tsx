import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Mail,
  Phone,
  FileText,
  Loader2,
  Lock,
  ExternalLink,
  HelpCircle,
  Clock,
  Info
} from 'lucide-react';
import { SenzuLogo } from './SenzuLogo';
import { useCustomerServiceWhatsApp } from '../lib/supportWhatsApp';

interface AccountDeletionPublicViewProps {
  onBack?: () => void;
}

export const AccountDeletionPublicView: React.FC<AccountDeletionPublicViewProps> = ({ onBack }) => {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [reasonCategory, setReasonCategory] = useState('Pindah domisili');
  const [customReason, setCustomReason] = useState('');
  const [isAgreed, setIsAgreed] = useState(false);
  const [honeypot, setHoneypot] = useState(''); // Anti-bot honeypot field

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedData, setSubmittedData] = useState<{
    referenceCode: string;
    submittedAt: string;
  } | null>(null);

  const { isAvailable, getWhatsAppUrl, displayWhatsApp } = useCustomerServiceWhatsApp();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Basic frontend validations
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim().replace(/[^0-9+]/g, '');

    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setErrorMessage('Harap masukkan alamat email valid yang terdaftar pada akun Senzu Home Anda.');
      return;
    }

    if (!cleanPhone || cleanPhone.length < 9 || cleanPhone.length > 16) {
      setErrorMessage('Harap masukkan nomor WhatsApp / Handphone aktif yang terdaftar (minimal 9 digit).');
      return;
    }

    if (!isAgreed) {
      setErrorMessage('Harap centang kotak persetujuan pemahaman prosedur penghapusan akun.');
      return;
    }

    setIsSubmitting(true);

    try {
      const fullReason = reasonCategory === 'Lainnya' 
        ? (customReason.trim() || 'Lainnya')
        : (customReason.trim() ? `${reasonCategory} - ${customReason.trim()}` : reasonCategory);

      const response = await fetch('/api/account-deletion/public-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: cleanEmail,
          phone: cleanPhone,
          reason: fullReason,
          website: honeypot, // Honeypot trap
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || result.error || 'Gagal mengajukan permintaan. Silakan coba kembali.');
      }

      setSubmittedData({
        referenceCode: result.referenceCode || `DEL-${Date.now().toString().slice(-6)}`,
        submittedAt: new Date().toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi gangguan koneksi saat mengajukan permintaan. Silakan hubungi Customer Service kami.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnHome = () => {
    if (onBack) {
      onBack();
    } else {
      window.location.href = '/';
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
                  Privasi & Akun
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/kebijakan-privasi"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/kebijakan-privasi');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="hidden sm:inline-flex px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Kebijakan Privasi</span>
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

      {/* 2. Main Body */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {submittedData ? (
          /* SUCCESS STATE */
          <div className="bg-white rounded-3xl p-6 sm:p-8 border border-emerald-200 shadow-sm space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200/60 shadow-xs">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="text-center space-y-2 max-w-lg mx-auto">
              <span className="px-3 py-1 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-bold uppercase tracking-wider">
                Permintaan Diterima
              </span>
              <h2 className="font-serif font-bold text-xl sm:text-2xl text-[#082A4F]">
                Pengajuan Penghapusan Akun Berhasil
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Permintaan penghapusan akun <strong>Senzu Home</strong> Anda telah tercatat dalam sistem kepatuhan data kami.
              </p>
            </div>

            {/* Reference Box */}
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Nomor Referensi Tiket:</span>
                <span className="font-mono font-bold text-slate-800">{submittedData.referenceCode}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                <span className="text-slate-500">Waktu Pengajuan:</span>
                <span className="text-slate-700 font-medium">{submittedData.submittedAt}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-slate-500">Status Permintaan:</span>
                <span className="text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                  Menunggu Verifikasi Kepemilikan
                </span>
              </div>
            </div>

            {/* Next Steps Information */}
            <div className="p-4 bg-blue-50/80 rounded-2xl border border-blue-200/80 text-blue-900 space-y-2 text-xs leading-relaxed">
              <h4 className="font-bold flex items-center gap-1.5 text-blue-950">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                Langkah Selanjutnya untuk Keamanan Akun Anda:
              </h4>
              <ul className="list-disc list-inside space-y-1.5 text-blue-800 pl-1">
                <li>
                  Untuk melindungi Anda dari permintaan penghapusan tidak sah, Customer Service Senzu Home akan mengirimkan pesan konfirmasi/verifikasi ke email atau WhatsApp yang Anda daftarkan.
                </li>
                <li>
                  Setelah verifikasi kepemilikan terkonfirmasi, data profil, kredensial login, dan alamat tersimpan Anda akan dihapus secara permanen.
                </li>
                <li>
                  Arsip bukti transaksi historis yang telah selesai tetap disimpan secara aman sesuai batas waktu wajib simpan dokumen berdasarkan ketentuan perundang-undangan akuntansi dan perpajakan di Indonesia.
                </li>
              </ul>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleReturnHome}
                className="flex-1 py-3 rounded-xl bg-[#082A4F] hover:bg-[#0D3866] text-white text-xs sm:text-sm font-bold transition shadow-sm cursor-pointer"
              >
                Kembali ke Beranda Senzu Home
              </button>
              {isAvailable && (
                <a
                  href={getWhatsAppUrl('Halo CS Senzu Home, saya baru saja mengajukan permohonan hapus akun dengan kode ' + submittedData.referenceCode)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-3 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4 text-emerald-600" />
                  Hubungi CS via WhatsApp
                </a>
              )}
            </div>
          </div>
        ) : (
          /* FORM & DISCLOSURE STATE */
          <div className="space-y-6 sm:space-y-8">
            {/* Title Section */}
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#082A4F]/10 text-[#082A4F] text-xs font-bold">
                <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>Google Play Data Safety & Privacy Compliance</span>
              </div>
              <h1 className="font-serif font-bold text-2xl sm:text-3xl text-[#082A4F] tracking-tight">
                Pengajuan Penghapusan Akun Senzu Home
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Halaman resmi bagi pelanggan <strong>Senzu Home (Senzu Reflexology and Family Massage)</strong> untuk mengajukan penutupan akun dan penghapusan data pribadi Anda secara aman tanpa perlu masuk atau menginstal ulang aplikasi.
              </p>
            </div>

            {/* Regulatory Transparency & Legal Disclosure Notice */}
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-5">
              {/* Identity Verification Procedure */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-800 text-xs sm:text-sm">
                  <Lock className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>Prosedur & Verifikasi Identitas</span>
                </div>
                <p className="text-slate-600 leading-relaxed text-[11px] sm:text-xs">
                  Demi mencegah pihak ketiga menghapus akun tanpa izin, setiap pengajuan penghapusan akun Senzu Home akan melalui verifikasi identitas pemilik sah terlebih dahulu (melalui nomor WhatsApp atau email terdaftar) sebelum data diproses untuk dihapus.
                </p>
              </div>

              {/* Data yang Dihapus dan Data yang Tetap Disimpan */}
              <div className="space-y-4 pt-1">
                <div className="border-b border-slate-100 pb-2.5">
                  <h2 className="font-serif font-bold text-base sm:text-lg text-[#082A4F] flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#D4AF37]" />
                    Data yang Dihapus dan Data yang Tetap Disimpan
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Rincian transparansi pengelolaan data akun pelanggan sesuai kepatuhan Google Play dan regulasi perlindungan data.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* A. DATA DELETED AFTER SUCCESSFUL IDENTITY VERIFICATION */}
                  <div className="p-4 bg-rose-50/50 rounded-2xl border border-rose-100 space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 font-bold text-rose-950">
                        <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>A. Data yang Dihapus Setelah Verifikasi Berhasil</span>
                      </div>
                      <p className="text-slate-600 leading-relaxed text-[11px] sm:text-xs">
                        Setelah proses verifikasi identitas pemilik akun berhasil diselesaikan, data berikut akan dihapus secara permanen:
                      </p>
                      <ul className="list-disc list-inside space-y-1.5 text-slate-700 pl-1 text-[11px] sm:text-xs leading-relaxed">
                        <li>
                          <strong>Akun dan profil pelanggan:</strong> Nama lengkap, data identitas diri, dan informasi kontak akun.
                        </li>
                        <li>
                          <strong>Data login:</strong> Akun otentikasi login email dan kata sandi terenkripsi.
                        </li>
                        <li>
                          <strong>Alamat tersimpan:</strong> Seluruh daftar alamat rumah/lokasi home service tersimpan dan catatan patokan.
                        </li>
                        <li>
                          <strong>Preferensi komunikasi:</strong> Pengaturan notifikasi, preferensi layanan, dan riwayat kontak operasional.
                        </li>
                        <li>
                          <strong>Personalisasi akun:</strong> Data preferensi kenyamanan dan catatan preferensi non-wajib lainnya.
                        </li>
                        <li>
                          <strong>Data loyalitas:</strong> Saldo poin Senzu Rewards, tingkatan loyalty tier, dan voucher promo aktif yang tidak diwajibkan secara hukum untuk disimpan.
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* B. DATA THAT MAY BE RETAINED */}
                  <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200/70 space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 font-bold text-amber-950">
                        <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>B. Data yang Tetap Disimpan Terbatas</span>
                      </div>
                      <p className="text-slate-600 leading-relaxed text-[11px] sm:text-xs">
                        Hanya catatan terbatas yang dapat tetap disimpan oleh Senzu Home apabila diperlukan untuk:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-slate-700 pl-1 text-[11px] sm:text-xs leading-relaxed">
                        <li>Kewajiban hukum dan peraturan perundang-undangan yang berlaku.</li>
                        <li>Kewajiban pembukuan akuntansi dan pelaporan perpajakan resmi.</li>
                        <li>Pencegahan penipuan (fraud prevention) dan keamanan sistem.</li>
                        <li>Penyelesaian sengketa transaksi atau pengaduan layanan.</li>
                        <li>Integritas catatan audit keamanan operasional.</li>
                      </ul>
                      <div className="pt-2 border-t border-amber-200/60 text-[11px] text-slate-700 space-y-1">
                        <span className="font-semibold text-amber-950 block">Contoh data yang dapat disimpan:</span>
                        <ul className="list-disc list-inside space-y-1 pl-1 text-slate-600">
                          <li>Catatan transaksi reservasi (booking) yang telah selesai.</li>
                          <li>Bukti dan data audit verifikasi pembayaran.</li>
                          <li>Faktur, kuitansi, atau catatan pembukuan akuntansi.</li>
                          <li>Log audit transaksi untuk kepatuhan hukum dan keamanan.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RETENTION PERIOD DISCLOSURE */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-[#082A4F]">
                    <Info className="w-4 h-4 text-[#082A4F] shrink-0" />
                    <span>Kebijakan & Periode Retensi Data</span>
                  </div>
                  <p className="text-slate-700 leading-relaxed text-[11px] sm:text-xs italic bg-white p-3 rounded-xl border border-slate-200">
                    “Data tertentu yang wajib dipertahankan karena kewajiban hukum, perpajakan, akuntansi, keamanan, pencegahan penipuan, atau penyelesaian sengketa hanya akan disimpan selama periode yang diwajibkan atau diizinkan berdasarkan ketentuan yang berlaku, kemudian dihapus atau dianonimkan apabila tidak lagi diperlukan.”
                  </p>
                  <p className="text-slate-600 leading-relaxed text-[11px] sm:text-xs">
                    Durasi retensi spesifik yang berlaku dapat berbeda bergantung pada jenis catatan dan kewajiban hukum yang relevan (seperti ketentuan pembukuan dan perpajakan di Republik Indonesia). Senzu Home tidak menyimpan data pribadi Anda tanpa batas waktu (data tidak dipertahankan melebihi periode yang dibutuhkan untuk tujuan sah tersebut).
                  </p>
                </div>
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Public Deletion Request Form */}
            <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-5 sm:p-8 border border-slate-200 shadow-sm space-y-5">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="font-serif font-bold text-base text-[#082A4F]">
                  Formulir Permintaan Penghapusan
                </h3>
                <p className="text-xs text-slate-500">
                  Masukkan informasi yang sesuai dengan data saat Anda mendaftarkan akun Senzu Home.
                </p>
              </div>

              {/* Honeypot field (hidden for bots) */}
              <div style={{ display: 'none' }} aria-hidden="true">
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </div>

              <div className="space-y-4 text-xs">
                {/* Email Field */}
                <div>
                  <label htmlFor="input-del-email" className="block font-bold text-slate-700 mb-1.5">
                    Alamat Email Terdaftar <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-del-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nama@email.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]/20 focus:border-[#082A4F]"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Email yang Anda gunakan saat login akun pelanggan Senzu Home.
                  </p>
                </div>

                {/* WhatsApp / Phone Field */}
                <div>
                  <label htmlFor="input-del-phone" className="block font-bold text-slate-700 mb-1.5">
                    Nomor WhatsApp / HP Terdaftar <span className="text-rose-600">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-del-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="contoh: 081234567890"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]/20 focus:border-[#082A4F]"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Digunakan untuk mengirimkan pesan konfirmasi verifikasi kepemilikan akun.
                  </p>
                </div>

                {/* Reason Category */}
                <div>
                  <label htmlFor="select-del-reason" className="block font-bold text-slate-700 mb-1.5">
                    Alasan Pengajuan (Opsional)
                  </label>
                  <select
                    id="select-del-reason"
                    value={reasonCategory}
                    onChange={(e) => setReasonCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]/20 focus:border-[#082A4F]"
                  >
                    <option value="Pindah domisili">Sudah pindah domisili dari Kota Palembang</option>
                    <option value="Jarang menggunakan layanan">Jarang menggunakan layanan home service</option>
                    <option value="Privasi data pribadi">Alasan privasi atau keamanan data pribadi</option>
                    <option value="Ingin membuat akun baru">Ingin membuat akun baru dengan kontak lain</option>
                    <option value="Lainnya">Alasan Lainnya</option>
                  </select>
                </div>

                {/* Additional Notes */}
                <div>
                  <label htmlFor="input-del-custom-reason" className="block font-bold text-slate-700 mb-1.5">
                    Catatan Tambahan (Opsional)
                  </label>
                  <textarea
                    id="input-del-custom-reason"
                    rows={2}
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Tuliskan masukan atau catatan khusus bagi tim kami..."
                    maxLength={300}
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-[#082A4F]/20 focus:border-[#082A4F]"
                  />
                </div>

                {/* Agreement Checkbox */}
                <div className="pt-2">
                  <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer select-none">
                    <input
                      id="checkbox-del-agree"
                      type="checkbox"
                      checked={isAgreed}
                      onChange={(e) => setIsAgreed(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-[#082A4F] focus:ring-[#082A4F]"
                    />
                    <span className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                      Saya memahami bahwa setelah verifikasi identitas berhasil diselesaikan, data profil, alamat tersimpan, dan poin reward akan dihapus permanen. Saya juga memahami bahwa catatan transaksi keuangan tertentu dapat tetap disimpan secara terbatas selama periode yang diwajibkan oleh hukum sebelum dihapus atau dianonimkan.
                    </span>
                  </label>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-3">
                <button
                  type="submit"
                  id="btn-submit-account-deletion"
                  disabled={isSubmitting}
                  className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs sm:text-sm font-bold transition shadow-sm cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Memproses Pengajuan...</span>
                    </>
                  ) : (
                    <span>Kirim Pengajuan Hapus Akun</span>
                  )}
                </button>
              </div>
            </form>

            {/* Assistance Section */}
            <div className="p-4 rounded-2xl bg-slate-100/70 border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-slate-600">
                <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
                <span>Butuh bantuan atau pembatalan pengajuan? Hubungi Customer Service resmi kami.</span>
              </div>
              {isAvailable && (
                <a
                  href={getWhatsAppUrl('Halo CS Senzu Home, saya ingin bertanya mengenai status penghapusan akun pelanggan.')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#082A4F] font-bold hover:underline flex items-center gap-1 shrink-0"
                >
                  <span>WhatsApp CS ({displayWhatsApp})</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}
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
              className="text-rose-700 font-bold"
            >
              Pengajuan Penghapusan Akun
            </a>
            <span>•</span>
            <a
              href="/kebijakan-privasi"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/kebijakan-privasi');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="hover:text-[#082A4F] hover:underline cursor-pointer"
            >
              Kebijakan Privasi
            </a>
          </div>
          <p className="font-medium text-slate-700">
            PT KSBONE UNTUK KITA — Senzu Reflexology & Family Massage Palembang
          </p>
          <p className="text-[11px] text-slate-400">
            Wellness Comes to You • Layanan Home Service Terpercaya & Higienis di Kota Palembang
          </p>
        </div>
      </footer>
    </div>
  );
};
