# Senzu Home — Pencatatan Xendit Live ke Accurate

## Perbaikan pembaca akun — 22 Oktober 2026

Patch **SenzuHome-Accurate-Mapping-Fix.zip** berisi **3 file**: src/server/accurateSyncProvider.ts, tests/accurateSync.test.mjs, dan docs/ACCURATE-SYNC.md. Source terbaru dibaca dari main commit 447d5e3 sebelum patch dibuat.

Pratinjau publik menampilkan ACCURATE_ITEM_ACCOUNTS_UNVERIFIED. Pembaca versi awal belum mendukung kolom akun item yang didokumentasikan Accurate sebagai salesGlAccountNo dan salesDiscountGlAccountNo, serta bentuk objek salesGlAccount / salesDiscountGlAccount. Patch menambahkan pembacaan kolom tersebut dan tetap memeriksa nomor 400005/400004; kolom yang kosong, salah, atau bertentangan tetap ditolak. Pemeriksaan pajak juga mencakup tax4 dan usePpn.

Unggah ketiga file sesuai folder, merge, Pull Changes, lalu Republish. Tidak ada Secret baru, penggantian token, pengubahan akun master, perluasan hak akses, atau aktivasi pengiriman yang diperlukan. Setelah publikasi, ulangi Pratinjau Tanpa Mencatat untuk booking SH-261021-DLJNW. Pratinjau publik sesudah patch dan pembuatan dokumen akuntansi belum terbukti oleh hasil tes lokal.

Validasi patch: 136/136 grup pengujian lokal, pemeriksaan tipe, build, dan impor modul backend native pada Node.js 22.23.4. Ringkasan 132 pengujian di bawah adalah hasil paket awal 13 file.

Basis paket awal 13 file: `origin/main` commit `2c3742e` (22 Oktober 2026). Database Accurate yang diperbolehkan untuk pengiriman: **2974047 — PT KSBONE UNTUK KITA**. Aplikasi: **Senzu Home**, App Key `212b755a-ada6-428c-8243-dd2e3874b66b`.

## Apa yang ditambahkan

Panel **Manager → Master Data → Operational Settings → Accurate Online — Pencatatan Transaksi**. Default belum aktif. Pratinjau dan status tidak membuat dokumen akuntansi. Panel pemeriksaan koneksi sebelumnya tetap tersedia.

Setelah pengiriman diizinkan di server dan diaktifkan oleh Manager:

1. Hanya booking yang dibuat **sesudah waktu aktivasi pertama**, dengan sesi Xendit Live yang juga dibuat setelah waktu tersebut, dapat masuk antrean. Aktivasi ulang tidak menggeser batas waktu pertama.
2. Status lunas harus diverifikasi melalui API Xendit yang sudah ada, baik dipicu webhook maupun pemeriksaan status. Antrean dibuat dalam transaksi Firestore yang sama dengan perubahan pertama menjadi lunas.
3. Pelanggan Accurate dibuat dengan kode stabil berbasis identitas akun pelanggan, nama dari booking pertama, serta akun piutang dan uang muka yang ditentukan. Tidak ada pencocokan pelanggan hanya berdasarkan nomor telepon. Nama pelanggan lama tidak ditimpa.
4. Pembayaran penuh dicatat sebagai **Uang Muka Penjualan**, dilanjutkan **Penerimaan Penjualan** ke akun Saldo Xendit.
5. Setelah booking benar-benar berstatus Completed, dibuat **Faktur Penjualan** yang memakai uang muka tersebut sebesar pembayaran penuh. Tidak dibuat penerimaan kedua.

| Kode | Penggunaan |
| --- | --- |
| 110103 | Saldo Xendit – Senzu Home, penerimaan bruto IDR |
| 110301 | Piutang Usaha IDR |
| 210102 | Uang Muka Penjualan IDR, mempertahankan jenis akun yang ada |
| 400005 | Pendapatan Jasa Senzu Home, termasuk biaya kunjungan |
| 400004 | Diskon Penjualan, menggunakan discountAmount total yang sudah dikunci |
| 600031 | Beban Administrasi Xendit; belum dipakai otomatis karena fee aktual belum diverifikasi |

Layanan yang dipetakan: SH-SIG-030 (Signature Treatment, 30 menit, harga dasar 160.000), SH-SIG-060 (225.000), SH-SIG-090 (325.000), SH-SIG-120 (425.000). Jumlah yang dikirim berasal dari harga booking yang sudah dikunci dan dicocokkan dengan pembayaran, bukan dari formulir Manager.

Biaya kunjungan ditulis sebagai biaya lainnya pada faktur dengan akun 400005. Promo/voucher/penukaran poin yang sudah tercakup dalam `discountAmount` ditulis satu kali sebagai diskon faktur; tidak dijumlahkan ulang. Finance harus memastikan perlakuan diskon ini sesuai kebijakan perusahaan sebelum aktivasi.

Versi ini hanya mendukung pencatatan **tanpa tambahan pajak**, dengan konfirmasi Finance pada panel. Pengaturan master yang menunjukkan pajak atau pemetaan akun yang tidak bisa dibuktikan akan menahan proses. Versi ini tidak menentukan kewajiban pajak perusahaan. Jika transaksi memerlukan PPN/PPh/PBJT atau pemisahan kewajiban poin, siapkan pemetaan tersebut sebelum aktivasi.

## 13 file dalam paket awal

1. server.ts
2. src/server/xenditLive.ts
3. src/server/accurateSync.ts
4. src/server/accurateSyncProvider.ts
5. src/lib/accurateSyncContracts.ts
6. src/lib/accurateSyncService.ts
7. src/components/admin/AccurateSyncCard.tsx
8. src/components/admin/AccurateConnectionCard.tsx
9. src/components/manager/ManagerPortal.tsx
10. tests/accurateSync.test.mjs
11. tests/accurateSyncUi.test.mjs
12. tests/accurateConnectionUi.test.mjs
13. docs/ACCURATE-SYNC.md

Tidak ada perubahan dependency, package-lock, Firebase Admin, Meta Pixel, checkout pelanggan, harga booking, pembayaran manual, atau Firestore rules. Hook kecil Xendit Live menambahkan penyimpanan antrean; verifikasi API dan aturan status pembayarannya tetap mengikuti modul yang sudah ada.

## Pemasangan tahap pertama: pratinjau

1. Unggah 13 file dengan struktur foldernya ke GitHub, merge, lalu **Pull Changes** di AI Studio. Baca dan selesaikan konflik bila source setelah commit basis sudah berubah; jangan menimpa file baru tanpa meninjau diff.
2. Pertahankan ACCURATE_API_TOKEN dan ACCURATE_SIGNATURE_SECRET yang sudah berhasil diuji. Tambahkan **ACCURATE_DATABASE_ID=2974047** untuk mengunci pula panel koneksi lama ke database yang sama.
3. Pada tahap ini **ACCURATE_SYNC_WRITES_ENABLED belum perlu dipasang**. Publish/Republish dan tunggu selesai.
4. Buka panel Pencatatan Transaksi di aplikasi publik. Status harus Belum aktif dan antrean kosong.
5. Masukkan **SH-261021-DLJNW**, lalu klik **Pratinjau Tanpa Mencatat**. Ini membaca transaksi Rp160.000 yang sudah ada dan memeriksa pemetaan API. Hasil harus menunjukkan booking historis, tanpa dokumen atau antrean baru. Kode ini boleh diganti dengan booking Xendit Live berbayar yang sah untuk pemeriksaan saja.
6. Jika pratinjau melaporkan akun, currency, tax, atau bentuk respons yang belum dapat diverifikasi, periksa hasil terlebih dahulu. Tidak perlu melakukan pembayaran baru atau mengubah status booking lama untuk menguji pratinjau.

## Aktivasi setelah pratinjau dan kebijakan Finance disetujui

1. Finance memeriksa akun, diskon, perlakuan pajak, unit Paket, cabang Accurate yang dipakai, dan duplikasi pencatatan manual. Versi ini menggunakan cabang default akun API; tidak membuat atau mengubah cabang.
2. Pasang **ACCURATE_SYNC_WRITES_ENABLED=true** di Secrets server. Ini mengizinkan pengiriman; belum mengaktifkan kontrol Manager.
3. Siapkan token acak khusus untuk **ACCURATE_SYNC_WORKER_TOKEN**, minimal 43 karakter dari huruf/angka/underscore/tanda hubung. Contoh pembuatan di terminal pribadi: `openssl rand -hex 32`. Simpan langsung di Secrets; jangan kirim nilainya ke chat, GitHub, atau dokumen ini.
4. Republish. Pastikan semua instance sudah menggunakan versi yang sama sebelum aktivasi Manager.
5. Jalankan pratinjau lagi, lalu baca dan centang dua konfirmasi pada panel. Manager mengklik **Aktifkan Pencatatan Booking Baru**. Aktivasi ini mulai membuat dokumen akuntansi untuk transaksi baru yang memenuhi syarat.
6. Verifikasi satu booking baru yang sah saat pelanggan memang melakukan pembayaran. Tidak perlu membuat pesanan palsu atau pembayaran nyata tambahan hanya demi pengujian. Periksa uang muka, penerimaan, dan jurnal di Accurate, lalu faktur yang memakai uang muka setelah treatment benar-benar selesai. Pembayaran pelanggan lama Rp160.000 tidak diimpor otomatis.

## Pemicu berkala untuk Cloud Run / AI Studio

Antrean dan bukti percobaan tersimpan di Firestore. Timer proses dan pemicu setelah pembayaran Xendit Live terverifikasi mempercepat pemrosesan, tetapi **bukan jaminan saat Cloud Run menghentikan CPU background atau scale-to-zero**. Permintaan Xendit Test dan pembayaran manual tidak memanggil pemicu pembayaran Accurate.

Untuk pemrosesan dan retry tanpa aktivitas aplikasi, konfigurasi pemicu HTTP berkala, misalnya Google Cloud Scheduler, dari project yang menghosting aplikasi:

- Frekuensi: `* * * * *`, timezone Asia/Jakarta.
- Metode: POST.
- URL publik: `https://senzuhome.com/api/integrations/accurate/sync/scheduled`.
- Body: `{}`.
- Header Content-Type: application/json.
- Header **X-Accurate-Worker-Token**: nilai rahasia yang sama dengan ACCURATE_SYNC_WORKER_TOKEN, dimasukkan langsung pada pengaturan scheduler.
- Jangan kirim header Authorization lain pada endpoint ini. Gunakan koneksi HTTPS.
- Deadline permintaan minimal 70 detik; retry pengiriman scheduler aman karena worker memakai lease dan bukti operasi yang persisten.

Keberadaan token di panel **tidak membuktikan scheduler sudah terpasang atau berjalan**. Verifikasi eksekusi scheduler serta catatan antreannya. Konfigurasi atau biaya layanan GCP tidak dibuat/diaktifkan oleh paket kode ini.

## Duplikasi, gangguan, dan pemulihan

- Satu booking mempunyai satu ID antrean dan nomor dokumen stabil SHDP-, SHRC-, SHIV-. Dua instance memakai lease yang sama di Firestore. Lease kedaluwarsa bisa dipulihkan setelah restart.
- Sebelum setiap pembuatan, server mencari dokumen berdasarkan nomor persis dan memverifikasi target, pelanggan, nominal, deskripsi penanda, tanggal, dan rincian yang relevan.
- Bukti `sending` disimpan sebelum POST. Jika respons terputus atau hasilnya belum pasti, sistem hanya mencari dan mencocokkan nomor tersebut. **Tidak adanya dokumen pada satu pemeriksaan bukan izin untuk mengirim ulang POST.**
- Tombol **Periksa Ulang Booking dalam Antrean** tidak menghapus atau mengosongkan bukti sending. Ia dapat menyelesaikan pencocokan jika respons terlambat dan dokumen muncul kemudian.
- Bila pembuatan ditolak atau dokumen tidak ditemukan setelah percobaan yang hasilnya belum pasti, Finance memeriksa dashboard dan log, lalu developer menyiapkan pemulihan yang dapat ditinjau. Versi ini sengaja tidak menyediakan tombol untuk menghapus bukti atau mengulang pembuatan secara paksa.
- Dokumen yang berbeda isi atau sudah diubah di Accurate tidak ditimpa. Booking batal/refund/koreksi staf/perubahan rincian ditahan untuk pemeriksaan; dokumen yang sudah ada tetap tersimpan. Tidak ada retur, refund, jurnal pembalik, penghapusan, atau perubahan dokumen otomatis.
- `paidAt` aplikasi adalah waktu pertama verifikasi API berhasil. Bila pembuatan sesi dan konfirmasi tersebut berbeda tanggal WIB, tanggal pembayaran sebenarnya belum terbukti; transaksi ditahan agar Finance memeriksa tanggal pada Xendit. Retry yang terjadi pada hari berikutnya tetap menggunakan tanggal pembayaran yang sudah disimpan, bukan tanggal retry.
- **Jeda Pengiriman Accurate** menghentikan pengiriman berikutnya. Booking baru setelah batas aktivasi tetap masuk antrean ketika dijeda. Matikan juga ACCURATE_SYNC_WRITES_ENABLED sebagai penghentian pengiriman dari server bila diperlukan. Permintaan yang sudah diterima Accurate mungkin tetap selesai; periksa nomor dokumennya.
- `paidSource` Xendit tetap membedakan webhook dan tombol pemeriksaan. Status akuntansi tidak mengubah status bayar, pesanan, keberangkatan terapis, loyalty, atau Meta.

## Penyimpanan dan akses

Collection baru: accurate_sync_private, accurate_sync_jobs, accurate_sync_operations. Tidak dibaca atau ditulis langsung dari browser. Akses melalui endpoint server dengan identitas Staff Master Manager/Admin aktif, atau token pemicu yang terbatas pada menjalankan antrean.

Source rules saat paket dibuat sudah memiliki default deny untuk collection yang tidak dikenali, sehingga tidak perlu memperluas hak akses client. Token Accurate dan Signature Secret tetap hanya di Secrets server. Respons dan log tidak menyimpan raw error provider atau kredensial.

## Validasi dan batas bukti

- Pengujian backend dan UI menggunakan fixture lokal, bukan API Accurate sungguhan. Meliputi integrasi transaksi Xendit paid/outbox, sumber webhook vs pemeriksaan, rollback, antrean historis, lease antar-instance, restart, timeout, respons hilang, nomor dokumen bentrok, perubahan sumber, cutoff aktivasi, hak akses, serta tidak adanya event Meta dari panel.
- Jalankan suite Accurate + regresi Xendit, TypeScript dan build dengan Node.js 22. Browser UI fixture menggunakan Chromium lokal melalui XENDIT_CHROMIUM_EXECUTABLE bila diperlukan.
- Hasil lokal paket ini: **132/132 grup pengujian lulus** pada Node.js **22.23.4**, pemeriksaan tipe dan build lulus. Modul backend baru juga berhasil diimpor langsung oleh Node.js 22, sesuai perintah start aplikasi yang memakai TypeScript native.
- Koneksi API read-only Accurate ke database 2974047 telah berhasil pada aplikasi publik sebelum paket ini dibuat. **Pembuatan dokumen akuntansi dan pemicu scheduler pada aplikasi publik belum diuji oleh hasil lokal ini.**

Rujukan primer: OpenAPI Accurate `https://account.accurate.id/open-api/json.do`, API Token guide yang ditautkan Developer Area, serta panduan Accurate untuk Uang Muka Penjualan dan Faktur Penjualan dipotong uang muka: `https://help.accurate.id/product/accurate-online/fitur-aol/penjualan/faktur-penjualan/membuat-faktur-penjualan-dipotong-uang-muka-penjualan/`.
