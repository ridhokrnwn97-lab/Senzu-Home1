import React, { useState } from 'react';
import { X, ShieldCheck, FileText, Lock, ChevronRight, Check } from 'lucide-react';
import { SenzuLogo } from './SenzuLogo';

interface TermsAndPrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'terms' | 'privacy';
}

export const TermsAndPrivacyModal: React.FC<TermsAndPrivacyModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'terms',
}) => {
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy'>(defaultTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-[#D4AF37]/30 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#8B5A36] to-[#94603B] text-white flex items-center justify-between border-b border-[#D4AF37]/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <ShieldCheck className="w-5 h-5 text-[#D4AF37]" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base sm:text-lg text-white">
                Kebijakan & Ketentuan Layanan
              </h3>
              <p className="text-[11px] text-slate-300">
                Senzu Reflexology and Family Massage Palembang
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-200 bg-slate-50 shrink-0 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('terms')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'terms'
                ? 'bg-white text-[#4B2B18] shadow-xs border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Syarat & Ketentuan Layanan</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('privacy')}
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'privacy'
                ? 'bg-white text-[#4B2B18] shadow-xs border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>Kebijakan Privasi</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs sm:text-sm text-slate-700 leading-relaxed">
          {activeTab === 'terms' ? (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">1. Ruang Lingkup Layanan Home Service</h4>
                <p className="text-slate-600">
                  Senzu Home menyediakan layanan pijat keluarga dan refleksi profesional berstandar kenyamanan hotel langsung ke rumah, apartemen, atau lokasi hunian pelanggan di seluruh wilayah Kota Palembang. Layanan ini adalah murni layanan kesehatan keluarga (health, wellness, & family massage).
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">2. Ketertiban & Keamanan Terapis</h4>
                <p className="text-slate-600">
                  Senzu Home menerapkan standar <strong>Zero Tolerance</strong> terhadap segala bentuk pelecehan seksual, kekerasan fisik, perkataan tidak sopan, atau permintaan di luar cakupan treatment resmi Senzu. Pelanggan wajib menyediakan lingkungan yang aman dan layak selama sesi treatment.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">3. Kebijakan Pembayaran</h4>
                <p className="text-slate-600">
                  Pembayaran resmi dilakukan non-tunai melalui QRIS Statis Senzu atau Transfer ke rekening resmi Bank Senzu Home (BNI, Mandiri, BRI). Terapis tidak diperkenankan menerima pembayaran cash di luar ketentuan yang tercatat pada sistem. Bukti pembayaran harus diunggah untuk verifikasi.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">4. Pembatalan & Penjadwalan Ulang (Reschedule)</h4>
                <p className="text-slate-600">
                  Permohonan perubahan jadwal (reschedule) atau pembatalan wajib disampaikan paling lambat 2 jam sebelum jadwal keberangkatan terapis melalui Customer Service resmi Senzu Home WhatsApp.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">5. Higienitas & Alat Peraga</h4>
                <p className="text-slate-600">
                  Terapis Senzu Home selalu dilengkapi dengan peralatan sanitasi, alas bersih sekali pakai / higienis, minyak aroma terapi food-grade berkualitas, dan seragam resmi Senzu.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">1. Pengumpulan Data Pribadi</h4>
                <p className="text-slate-600">
                  Kami mengumpulkan data pribadi yang Anda berikan secara sukarela saat melakukan reservasi atau pendaftaran akun, meliputi: Nama Lengkap, Nomor WhatsApp, Alamat Lengkap Hunian, Patokan Lokasi, dan Alamat Email.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">2. Penggunaan Informasi</h4>
                <p className="text-slate-600">
                  Informasi Anda digunakan semata-mata untuk:
                </p>
                <ul className="list-disc list-inside space-y-1 mt-1 text-slate-600">
                  <li>Mengkoordinasikan penugasan dan navigasi terapis ke lokasi Anda.</li>
                  <li>Mengirimkan notifikasi status booking, verifikasi pembayaran, dan pengingat jadwal.</li>
                  <li>Mengelola poin Senzu Rewards dan voucher diskon yang Anda miliki.</li>
                  <li>Pelayanan bantuan darurat dan Customer Service resmi.</li>
                </ul>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">3. Perlindungan & Kerahasiaan Kata Sandi</h4>
                <p className="text-slate-600">
                  Kata sandi akun pelanggan dienkripsi secara aman melalui Firebase Authentication. Kami tidak pernah meminta, melihat, atau menyimpan kata sandi Anda dalam format teks terbuka (plain text).
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">4. Tidak Menjual Data ke Pihak Ketiga</h4>
                <p className="text-slate-600">
                  Senzu Home menjamin bahwa data pribadi Anda tidak akan pernah dijual, disewakan, atau dibagikan kepada pihak ketiga untuk kepentingan komersial yang tidak terkait dengan operasional layanan Senzu.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-[#4B2B18] text-sm mb-1">5. Hak Pelanggan & Penghapusan Akun</h4>
                <p className="text-slate-600 leading-relaxed">
                  Pelanggan berhak memperbarui data profil, mengubah kata sandi, atau mengajukan permohonan penutupan akun dan penghapusan data pribadi kapan saja. Pengajuan dapat dilakukan langsung melalui menu Akun di aplikasi atau melalui halaman web resmi:{' '}
                  <a
                    href="/hapus-akun"
                    onClick={(e) => {
                      e.preventDefault();
                      onClose();
                      window.history.pushState({}, '', '/hapus-akun');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="text-[#4B2B18] font-bold underline hover:text-rose-600"
                  >
                    https://senzuhome.com/hapus-akun
                  </a>.
                </p>
                <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1.5">
                  <p>
                    <strong>Data yang Dihapus:</strong> Setelah verifikasi identitas berhasil diselesaikan, seluruh data profil pelanggan, kredensial login, alamat tersimpan, preferensi komunikasi, personalisasi, dan poin loyalitas akan dihapus secara permanen.
                  </p>
                  <p>
                    <strong>Data yang Tetap Disimpan Terbatas:</strong> Catatan terbatas (seperti riwayat transaksi booking yang telah selesai, bukti verifikasi pembayaran, dan faktur akuntansi) dapat tetap disimpan semata-mata untuk mematuhi kewajiban hukum, perpajakan, akuntansi, pencegahan penipuan, penyelesaian sengketa, dan integritas audit.
                  </p>
                  <p className="italic text-slate-500 text-[11px] pt-1 border-t border-slate-200/60">
                    “Data tertentu yang wajib dipertahankan karena kewajiban hukum, perpajakan, akuntansi, keamanan, pencegahan penipuan, atau penyelesaian sengketa hanya akan disimpan selama periode yang diwajibkan atau diizinkan berdasarkan ketentuan yang berlaku, kemudian dihapus atau dianonimkan apabila tidak lagi diperlukan.” Data tidak disimpan lebih lama dari periode yang diwajibkan atau diizinkan untuk tujuan tersebut.
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 pt-1">
                  Kebijakan Privasi lengkap dan kepatuhan Google Play Data Safety dapat diakses pada halaman web publik:{' '}
                  <a
                    href="/kebijakan-privasi"
                    onClick={(e) => {
                      e.preventDefault();
                      onClose();
                      window.history.pushState({}, '', '/kebijakan-privasi');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="text-[#4B2B18] font-bold underline hover:text-blue-700"
                  >
                    https://senzuhome.com/kebijakan-privasi
                  </a>.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#8B5A36] hover:bg-[#94603B] text-white text-xs font-bold transition cursor-pointer"
          >
            Saya Mengerti
          </button>
        </div>
      </div>
    </div>
  );
};
