# Senzu Home — Pencatatan Xendit Live ke Accurate

## Perbaikan validasi dan pesan pratinjau neto — 22 Oktober 2026

Paket **SenzuHome-Xendit-Neto-Validation.zip** berisi **6 file**. Basis source terbaru main commit `33fa1a1313125d9140a3ab1d46606bdb0eecad6a`, setelah paket 8 file pratinjau neto digabung.

1. src/server/xenditNetPreview.ts
2. src/lib/accurateSyncContracts.ts
3. src/components/admin/AccurateSyncCard.tsx
4. tests/accurateSync.test.mjs
5. tests/accurateSyncUi.test.mjs
6. docs/ACCURATE-SYNC.md

### Temuan pada aplikasi publik

Versi pratinjau sudah terlihat pada `https://senzuhome.com/`. Pembacaan pertama melaporkan akses Transaction Read ditolak. Penambahan **Transaction → Read** pada key **SenzuHomeLive** disetujui pengguna dan diselesaikan dengan verifikasi authenticator. Dashboard Xendit kemudian menampilkan **Read only: Transaction**. Tidak dibuat key pengganti dan tidak dibaca nilai Secret.

Pembacaan ulang untuk **SH-261022-NUOUN** tidak lagi menampilkan penolakan izin, tetapi menghasilkan pesan umum **Identitas, nominal, atau rincian transaksi Xendit belum cocok**. Raw respons API tidak diambil. Karena versi sebelumnya menyatukan beberapa pemeriksaan ke pesan tersebut, field penyebab kasus publik **belum diketahui** dan pembacaan neto belum dinyatakan berhasil.

### Perubahan

Pembaca lama mewajibkan `links` kosong. Versi ini menggunakan penanda eksplisit `has_more === false` dan tepat satu hasil sebagai pemeriksaan akhir daftar. Array navigasi boleh berisi tautan; isinya tidak dipakai, tidak dikembalikan ke browser dan tidak diikuti. `has_more` hilang/salah tipe/true, format daftar salah dan lebih dari satu hasil tetap ditolak. Ini membenahi pembatasan navigasi pada kode; **belum membuktikan navigasi merupakan penyebab penolakan kasus publik**.

Pesan pemeriksaan kini membedakan format daftar, paginasi, hasil ganda, Business ID, reference ID, product/payment ID, bruto, mata uang, status/arah dana, biaya transaksi, PPN biaya, withholding, perhitungan neto, serta metadata transaksi. Pesan berasal dari daftar tetap pada kode. Nilai yang bertentangan, payload mentah, nomor rekening, data pelanggan, URL navigasi dan kredensial tidak ditampilkan/disimpan. Field biaya yang kosong tetap tidak dianggap nol. Withholding bukan nol tetap memerlukan Finance.

Kegagalan baca Xendit yang sudah dikenali sekarang mempertahankan tampilan status Accurate yang sebelumnya sudah dimuat. Ia tidak menampilkan formulir aktivasi seolah-olah pengiriman Accurate kehilangan aktivasi. Logout, pergantian akun, kegagalan autentikasi atau respons status yang tidak valid tetap mengosongkan data terkait. Tidak ada perubahan pengaturan aktivasi, cutoff, antrean, bukti operasi atau dokumen Accurate di server.

### Pemasangan dan pemeriksaan berikutnya

1. Ekstrak dan unggah **6 file** sesuai foldernya ke GitHub, merge, **Pull Changes**, lalu **Republish**. Tinjau diff bila main sudah berubah. Tidak perlu Secret baru, mengulang aktivasi atau membuat pembayaran baru.
2. Buka **Manager → Master Data → Operational Settings → Accurate Online — Pencatatan Transaksi**. Masukkan **SH-261022-NUOUN**, klik **Pratinjau Biaya & Neto Xendit** sekali, dan periksa hasilnya.
3. Jika hasil belum cocok, pesan spesifik menunjukkan bagian yang ditahan. Pemeriksaan lanjutan harus berdasarkan pesan dan data yang benar, tanpa mengubah nominal/identitas agar lolos dan tanpa menganggap data kosong nol. Tidak perlu mengeklik Proses Antrean atau Periksa Ulang Booking untuk membaca neto.
4. Hasil sukses tetap hanya membuktikan neto satu pembayaran Xendit. Processing fee harian, perlakuan pajak, pencairan aktual dan mutasi bank memerlukan rekonsiliasi terpisah. Tidak ada pencatatan biaya/pajak/pencairan otomatis pada paket ini.

Paket hanya mengubah pembaca pratinjau, pesan, tampilan kegagalan dan pengujiannya. Checkout pelanggan, verifikasi Payment Session/webhook, pembayaran manual, Meta Pixel dan worker Accurate tidak diubah. Semua tes menggunakan fixture lokal; paket ini belum diterbitkan ketika disiapkan. Keberhasilan pembacaan API publik tetap perlu diverifikasi setelah Republish.

Validasi lokal pada Node.js **22.23.4**: **160/160 grup pengujian lulus**, pemeriksaan TypeScript, build dan impor native backend lulus. Regresi tambahan memeriksa tautan navigasi yang tidak diikuti dengan satu hasil final, penolakan hasil ganda/penanda halaman hilang, respons JSON salah, alasan pemeriksaan spesifik tanpa nilai mentah, serta status antrean aktif yang tetap terlihat setelah kegagalan baca Xendit. Pemeriksaan akses dan pencocokan finansial sebelumnya tetap dijalankan.

## Pratinjau biaya dan neto Xendit — 22 Oktober 2026

Paket **SenzuHome-Xendit-Neto-Preview.zip** berisi **8 file**. Basis source terbaru: main commit `c95d84972cd109e3c7460be31db0e88d583bd6d3`, setelah Customer Fix digabung. Ini menambah pemeriksaan baca saja pada panel pencatatan yang sudah ada; bukan aktivasi pencatatan biaya/pajak/pencairan.

1. src/server/xenditNetPreview.ts — pembaca Transaction API Xendit.
2. src/server/accurateSync.ts — endpoint Manager, validasi sumber dan pemeriksaan ulang akses/sumber setelah pembacaan.
3. src/lib/accurateSyncContracts.ts — kontrak hasil, uang IDR, identitas dan pesan aman.
4. src/lib/accurateSyncService.ts — pemanggil dan pemeriksa respons panel.
5. src/components/admin/AccurateSyncCard.tsx — tombol dan rincian biaya/neto.
6. tests/accurateSync.test.mjs — fixture backend dan regresi pencatatan sebelumnya.
7. tests/accurateSyncUi.test.mjs — fixture panel, akun berubah dan tidak ada event Meta.
8. docs/ACCURATE-SYNC.md — petunjuk ini.

### Pemasangan dan pemakaian

1. Unggah **8 file** sesuai struktur folder ke GitHub, merge, **Pull Changes**, kemudian **Publish/Republish**. Tunggu selesai. Bila main sudah berubah dari basis di atas, tinjau konflik/diff sebelum mengganti file. Tidak ada dependency atau Secret baru.
2. Buka `https://senzuhome.com/`, lalu **Manager → Master Data → Operational Settings → Accurate Online — Pencatatan Transaksi**. Masukkan kode booking yang sudah dibayar melalui Xendit Live, misalnya **SH-261022-NUOUN**.
3. Klik **Pratinjau Biaya & Neto Xendit**. Tombol ini hanya membaca transaksi. Tombol **Periksa Ulang Booking dalam Antrean** dan **Proses Antrean Sekarang** menjalankan pencatatan yang sudah ada; keduanya tidak diperlukan untuk pratinjau neto.
4. Cocokkan bruto, biaya transaksi, PPN biaya dan neto dengan transaksi yang sama pada dashboard Xendit. Panel menunjukkan waktu pemeriksaan dan referensi transaksi. Untuk contoh bruto Rp160.000, fee Rp9.000 dan PPN fee Rp990, hasil perhitungan adalah Rp150.010. Nilai berasal dari API, bukan tarif Mandiri yang ditanam dalam kode.
5. Jika Xendit menolak akses, periksa **Transaction Read** pada key Live yang sudah digunakan server dan akun bisnisnya. Penolakan izin ditampilkan tersendiri; paket tidak menambah izin atau mengganti key. Jangan kirim Secret ke chat. Biaya belum final, settlement belum selesai, data hilang atau tidak cocok menahan hasil neto; data kosong tidak dianggap biaya nol.

### Arti hasil dan batas pencatatan

Neto ini adalah **neto satu pembayaran di Xendit**, belum bukti dana diterima rekening bank dan belum rekonsiliasi seluruh saldo akun 110103. Processing fee Xendit dipotong sebagai akumulasi harian, termasuk percobaan pembayaran yang relevan menurut kebijakan Xendit. Potongan processing dan PPN-nya harus dicocokkan terpisah dengan ledger/laporan Billing; paket ini tidak membagi satu potongan harian ke booking tertentu. Pencairan ke bank perlu dicocokkan dengan laporan withdrawal dan mutasi bank asli.

Status PKP PT KSBONE belum dipastikan. Pratinjau menampilkan PPN atas biaya sebagaimana dilaporkan Xendit tanpa menentukan apakah dicatat sebagai Pajak Masukan atau beban. Pajak dipotong/withholding yang bukan nol ditahan untuk pemeriksaan Finance. **Belum ada POST biaya, pajak, jurnal atau transfer bank ke Accurate**, dan tidak ada penarikan dana dari Xendit. Uang muka serta penerimaan bruto yang sudah tercatat tetap mengikuti integrasi sebelumnya.

Endpoint `POST /api/integrations/accurate/sync/netPreview` menerima hanya `bookingId` dengan Firebase ID token Manager/Admin aktif. Permintaan keluar hanya **GET `https://api.xendit.co/transactions`**, difilter referensi booking yang tersimpan, PAYMENT, IDR, limit 2. Key Test ditolak. Key Live dan business ID dibaca hanya dari konfigurasi server. Penghentian checkout baru tidak melarang pemeriksaan transaksi lama.

Respons harus tepat satu transaksi, tanpa halaman berikutnya, dengan business ID, reference ID, payment/product ID, nominal, mata uang, arus masuk, status SUCCESS, biaya COMPLETED dan settlement SETTLED yang cocok. Product ID boleh sama dengan payment ID lengkap, atau UUID tanpa awalan `py-` hanya untuk pasangan UUID yang sama. Prefiks lain atau ketidakcocokan ditolak. Empat komponen fee wajib berupa angka lengkap; versi ini memverifikasi neto ketika kedua withholding nol dan bruto dikurangi fee serta PPN tepat sama dengan neto. Perhitungan IDR mendukung dua angka desimal dengan pembandingan integer minor units.

Panel tidak membaca Xendit saat baru dibuka; pembacaan dilakukan ketika tombol diklik, maksimal tiga kali per menit per Manager per instance. Akses Manager dan seluruh sumber booking/pembayaran/sesi/quote diperiksa lagi setelah GET sebelum hasil dikembalikan. Hasil terlambat setelah pergantian akun/logout dibuang. Error mentah, kredensial dan data pelanggan dari provider tidak ditampilkan atau disimpan.

Jalur baru tidak menulis Firestore, membuat/menghapus antrean atau bukti operasi, menggeser cutoff, menghubungi Accurate, memeriksa ulang status pembayaran melalui Payment Session API, mengubah sumber webhook/status, atau memicu Meta. Booking historis boleh dibaca tanpa dimasukkan ke antrean. Checkout pelanggan, pembayaran manual dan Meta Pixel tidak diubah.

**Batas bukti:** pengujian paket ini menggunakan fixture lokal, bukan key produksi. Pembacaan Transaction API dari aplikasi publik masih perlu dibuktikan setelah Republish; tampilan dashboard Xendit sebelumnya tidak menggantikan pemeriksaan API tersebut. Keberhasilan uang muka/penerimaan versi Customer Fix yang sudah diperiksa secara native di Accurate adalah bukti terpisah, bukan bukti pencatatan fee/neto/pencairan otomatis.

Validasi lokal paket ini pada Node.js 22.23.4: **156/156 grup pengujian lulus**, termasuk backend Accurate, panel, koneksi Accurate dan regresi Xendit Test/Live. Pemeriksaan TypeScript, build dan impor native backend juga lulus. Regresi baru mencakup biaya pecahan IDR/biaya nol eksplisit, field fee hilang, status pending, withholding, respons ganda/paginasi, identitas berbeda, izin API, pembatalan/pergantian akun, sumber berubah saat membaca, dan tidak adanya POST keuangan atau event Meta pada jalur pratinjau.

Rujukan primer: [List Transactions](https://docs.xendit.co/apidocs/list-transactions), [Transaction fees](https://docs.xendit.co/v1/docs/transaction-fees), [Balance report](https://docs.xendit.co/docs/balance-report), [Reports overview](https://docs.xendit.co/docs/reports-overview). Bagian-bagian versi sebelumnya di bawah adalah catatan historis.

## Perbaikan pembaca nomor pelanggan — 22 Oktober 2026

Patch **SenzuHome-Accurate-Customer-Fix.zip** berisi **4 file**:

1. src/server/accurateSyncProvider.ts
2. src/server/accurateSync.ts
3. tests/accurateSync.test.mjs
4. docs/ACCURATE-SYNC.md

Basis source terbaru: main commit `d8e270c7fd35717a33045b6b8b1909b6489b6471`, sesudah paket Mapping Fix digabung. Pada pemeriksaan publik, pembayaran booking baru sudah terverifikasi melalui webhook Xendit, tetapi antrean Accurate tertahan dengan ACCURATE_DOCUMENT_COLLISION. Pelanggan berkode SHC- sudah ditemukan di Accurate dengan penanda kepemilikan dan akun yang sesuai. Pencarian nomor uang muka dan penerimaan milik antrean tersebut belum menemukan dokumen. Temuan ini menunjukkan proses belum dapat dianggap berhasil mencatat pembayaran di Accurate.

Pembaca lama menyamakan nama filter pelanggan dengan nama kolom respons: `no`. Patch memisahkan filter `filter.no` dari proyeksi respons `customerNo`. Identitas pada daftar dan detail harus tetap cocok dengan nomor yang dicari dan ID hasil daftar. Bentuk lama `no` tetap dapat dibaca; jika respons menyediakan keduanya, semua nilai harus sama. Nilai kosong, null, salah tipe, berbeda, hasil ganda, atau ID detail berbeda tetap ditolak. Referensi pelanggan pada uang muka, penerimaan, dan faktur juga membaca `customer.customerNo`, dengan pemeriksaan seluruh alias yang disediakan.

Payload pembuatan, nomor pelanggan/dokumen, fingerprint, penanda kepemilikan, akun, cutoff aktivasi, dan bukti operasi lama dipertahankan. Bukti `sending` tidak dihapus atau direset. Pelanggan yang sudah tersimpan harus ditemukan dan diverifikasi; bila tidak ditemukan setelah percobaan terdahulu, POST tidak diulang. Pemeriksaan penanda kepemilikan dan akun piutang/uang muka tetap berlaku.

Pemasangan dan pemulihan:

1. Unggah **keempat file** sesuai foldernya ke GitHub, merge, **Pull Changes**, lalu **Republish**. Tunggu publikasi selesai. Tidak diperlukan Secret baru atau aktivasi ulang.
2. Muat ulang panel **Accurate Online — Pencatatan Transaksi** dan periksa booking yang tertahan beserta nomor dokumennya. Periksa kembali dokumen di Accurate sebelum memilih pemulihan, terutama jika ada pencatatan manual selama penanganan.
3. Setelah versi baru terpasang dan transaksi cocok, gunakan **Periksa Ulang Booking dalam Antrean** satu kali untuk booking tersebut. Tombol ini dapat membuat uang muka dan penerimaan yang belum pernah dicoba, sehingga merupakan tindakan pencatatan. Ia tidak mengulang POST yang mempunyai bukti percobaan lama. Jangan menghapus catatan antrean/operasi atau membuat pembayaran pengganti.
4. Cocokkan hasil nyata di Accurate: pelanggan yang sama, satu uang muka, satu penerimaan ke akun 110103, jumlah dan tanggal yang benar. Faktur baru dibuat setelah treatment benar-benar selesai; status booking tidak diubah untuk pengujian.

Validasi patch: **142/142 grup pengujian lokal lulus**, TypeScript, build, dan impor backend native pada **Node.js 22.23.4** lulus. Fixture utama memakai respons pelanggan `customerNo` dan referensi dokumen `customer.customerNo`, tanpa mengandalkan pantulan payload POST sebagai bukti identitas. Regresi mencakup pemulihan setelah restart dengan bukti sending lama, respons pelanggan hilang, pelanggan tidak ditemukan tanpa POST ulang, alias bertentangan, penanda/akun salah, serta pembuatan dokumen paling banyak sekali. Suite juga memeriksa regresi Xendit Test/Live dan UI.

**Batas bukti:** tes menggunakan fixture lokal. Raw respons API pelanggan dari aplikasi publik belum diambil; inspeksi Accurate dilakukan melalui antarmuka pengguna. Keberhasilan pemulihan dan dokumen keuangan setelah patch tetap harus diverifikasi sesudah publikasi. Hasil paket sebelumnya di bawah adalah catatan historis, bukan pengganti pemeriksaan tersebut.

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
