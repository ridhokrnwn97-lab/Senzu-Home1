# Senzu Home — jurnal biaya Xendit otomatis

Paket berdasarkan source GitHub main b3efbe55ec9e2adbb76ee8c3cc6ab45c434a6499 (22 Oktober 2026). Seluruh 246 file source lokal dicocokkan dengan blob tree main sebelum perubahan.

## Hasil perubahan

Keputusan Finance: biaya transaksi Xendit dan PPN atas biaya dibebankan ke akun 600031; bukan PPN Masukan. Untuk pembayaran baru yang masuk cakupan aktivasi biaya:

- Pembayaran bruto tetap masuk ke Saldo Xendit 110103 melalui dokumen uang muka dan penerimaan yang sudah ada.
- Saat treatment selesai, faktur layanan tetap memakai nilai bruto dan uang muka seperti sebelumnya.
- Setelah biaya COMPLETED dan settlement SETTLED terverifikasi dari Transaction API Xendit, dibuat Journal Voucher SHXF-<24 karakter hash booking>: debit 600031 dan kredit 110103 sebesar biaya aktual + PPN biaya.
- Tidak ada tarif biaya yang dipatok menurut kanal. Nilai dari Xendit diperiksa terhadap bisnis, referensi, payment/product ID, nominal, mata uang, status sukses, arah dana, dan persamaan neto. Withholding atau rincian tidak cocok diarahkan ke pemeriksaan.
- Biaya belum final tidak menahan penerbitan faktur layanan. Status biaya ditampilkan terpisah. Nilai nol eksplisit disimpan sebagai bukti tanpa jurnal nol.
- Tanggal jurnal adalah tanggal pembayaran WIB yang sudah diverifikasi oleh alur existing; bukan tanggal saat worker mengulang pemeriksaan. Pembayaran yang melintasi tanggal WIB masih memerlukan pemeriksaan sesuai perlindungan existing.

Contoh saja: bruto Rp160.000 - biaya Rp9.000 - PPN biaya Rp990 = neto Rp150.010. Kanal lain mengikuti nilai aktual, bukan contoh ini.

## Cakupan dan pencegahan duplikasi

Fitur TIDAK langsung aktif saat republish. Manager/Admin mengaktifkan jurnal biaya di panel Accurate. Batas aktivasi biaya disimpan terpisah dari aktivasi pencatatan bruto.

Hanya job yang dibentuk melalui event pembayaran Live terverifikasi, dengan booking DAN sesi dibuat sesudah batas aktivasi biaya, mendapatkan kebijakan biaya. Job lama tidak diubah/dimasukkan ulang. Ini mengecualikan booking SH-261022-NUOUN yang jurnal SHXF-nya sudah dibuat manual, serta transaksi sebelum aktivasi.

Jeda biaya menghentikan pengiriman biaya; job baru dalam cakupan tetap menyimpan antrean biaya. Melanjutkan pengiriman tidak menggeser batas aktivasi. Jeda seluruh pengiriman Accurate juga menghentikan jurnal biaya.

Nomor jurnal stabil; sebelum create worker membaca dokumen dengan nomor yang sama. Dokumen yang ada harus cocok tepat pada nomor, tanggal, deskripsi pengikat booking/payment/transaksi Xendit, dua baris akun, arah, nominal, dan mata uang. Dokumen manual atau berbeda yang memakai nomor sama memerlukan pemeriksaan; tidak diedit atau dibuat penggantinya.

Sebelum POST, disimpan operation receipt durable. Respons terputus atau hasil belum pasti hanya direkonsiliasi melalui pembacaan nomor yang sama. Ketiadaan dokumen setelah hasil belum pasti bukan izin untuk POST ulang. Jangan menghapus/reset operation receipt untuk memaksa percobaan baru. Hasil penolakan izin setelah POST juga diperlakukan konservatif; periksa status/dokumen sebelum menentukan pemulihan bersama Finance.

Bukti biaya yang sudah dipakai dikunci dengan fingerprint. Perubahan rincian pada pemeriksaan berikutnya memerlukan review; tidak otomatis mengubah jurnal lama. Tidak ada pemindaian ulang seluruh transaksi selesai untuk penyesuaian biaya yang muncul belakangan. Rekonsiliasi laporan periodik tetap diperlukan.

Selama otomatisasi aktif, hindari membuat jurnal biaya terpisah untuk job baru yang sedang diproses. Jurnal manual dengan nomor berbeda tidak dapat dideteksi hanya dengan pencarian nomor stabil.

## Pemasangan — 9 file

Unggah file ke path yang sama, jangan mengunggah ZIP sebagai source:

1. src/server/accurateFeePosting.ts (baru)
2. src/server/accurateSync.ts
3. src/server/accurateSyncProvider.ts
4. src/lib/accurateSyncContracts.ts
5. src/lib/accurateSyncService.ts
6. src/components/admin/AccurateSyncCard.tsx
7. tests/accurateSync.test.mjs
8. tests/accurateSyncUi.test.mjs
9. README-XENDIT-FEES.md

Merge di GitHub → Pull Changes di Google AI Studio → Publish/Republish. Tidak ada dependency atau secret baru.

Di aplikasi publik: Manager → Master Data → Operational Settings → Accurate Online — Pencatatan Transaksi → Jurnal biaya Xendit otomatis. Baca cakupan, centang persetujuan Finance, lalu Aktifkan Jurnal Biaya Xendit. Pengiriman bruto dan konfigurasi server harus tetap aktif.

Aktivasi memeriksa master dan akses baca Journal Voucher tanpa membuat jurnal percobaan. Izin yang dibutuhkan pada aplikasi/token Accurate adalah journal_voucher_view dan journal_voucher_save. Jangan kirim token atau signature secret ke chat. Jika izin belum tersedia, sesuaikan melalui pengaturan aplikasi Accurate dengan pemilik akun; jangan membuat transaksi contoh untuk menguji izin tulis. Pemeriksaan baca tidak membuktikan izin tulis.

Pemicu berkala existing tetap memakai endpoint /api/integrations/accurate/sync/scheduled. Tidak diperlukan job Scheduler kedua. Keberhasilan Force Run saja belum membuktikan posting transaksi baru end-to-end.

## Verifikasi setelah publikasi

1. Buka status, pastikan jurnal biaya belum aktif sampai aktivasi Manager selesai. Pastikan booking lama menampilkan di luar cakupan aktivasi biaya.
2. Aktifkan sekali, catat batas waktunya. Jangan mengulangi pembayaran pelanggan lama atau membuat booking fiktif.
3. Untuk pembayaran Live sah berikutnya dari booking/sesi yang sama-sama dibuat setelah aktivasi: periksa bukti webhook, dokumen penerimaan bruto, serta biaya dan settlement aktual Xendit.
4. Setelah worker terjadwal berjalan, cocokkan SHXF di Accurate: dua baris tepat, debit 600031/kredit 110103, biaya aktual + PPN. Periksa saldo clearing turun dari bruto sebesar biaya sekali saja. Periksa ID dan referensi pada keterangan.
5. Periksa ulang antrean; jumlah jurnal tidak bertambah. Status terverifikasi harus berasal dari pembacaan kembali dokumen Accurate, bukan hanya respons POST.
6. Verifikasi transaksi normal tidak mengubah perilaku pembayaran manual atau event konversi Meta. Tes lokal memeriksa panel tidak menembakkan event Meta; Meta Test Events langsung belum diuji oleh paket ini.

Processing fee harian + PPN-nya, saldo lama, pencairan ke bank, refund, pembatalan dan penyesuaian tidak diposting otomatis oleh fitur ini. Settlement di Xendit bukan bukti kredit rekening bank. PPN biaya menjadi beban tidak mengubah kebijakan pajak penjualan; keputusan pajak layanan tetap perlu pemeriksaan Finance secara terpisah.

## Bukti pengujian

Tes memakai fixture lokal, bukan key/akun produksi. Seluruh suite backend dan panel React dijalankan di Node.js 22.23.4, pemeriksaan TypeScript serta build. Hasil: 192 grup pengujian lulus (0 gagal), pemeriksaan tipe lulus, build lulus. Build masih memberi peringatan ukuran bundle besar yang juga ada pada versi sebelumnya. Tes mencakup cutoff booking+sesi, pengecualian job lama, tarif kanal/desimal, biaya pending/nol, snapshot berubah, lost response, dokumen tabrakan, dua worker, jeda/resume, reotorisasi Manager dan pergantian akun di panel.

Ini BUKAN bukti bahwa jurnal biaya otomatis sudah berhasil melalui API Accurate produksi. Uji end-to-end otomatis dilakukan sesudah publikasi/aktivasi dengan pembayaran normal yang sah. Jurnal manual sebelumnya merupakan bukti terpisah.

## Referensi teknis resmi

Schema Accurate diambil 22 Oktober 2026: https://account.accurate.id/open-api/json.do
- POST /api/journal-voucher/save.do: transDate; detailJournalVoucher dengan accountNo, amount, amountType DEBIT/CREDIT; number untuk penomoran manual.
- GET /api/journal-voucher/list.do dan detail.do: pencocokan nomor dan pembacaan ulang dokumen.

Tidak ada endpoint delete/update/transfer/payout baru yang digunakan.
