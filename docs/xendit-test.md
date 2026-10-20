# Senzu Home — Xendit Test, tahap 1

## Paket pemulihan percobaan macet — 20 Oktober 2026

Baseline paket pemulihan: GitHub `main` commit
`10e2498` (merge PR #7). Paket pembaruan ini berisi **5 file**:

1. `src/server/xenditSandbox.ts`
2. `src/lib/xenditSandboxService.ts`
3. `src/components/admin/XenditSandboxCard.tsx`
4. `tests/xenditSandbox.test.mjs`
5. `docs/xendit-test.md`

Jangan unggah ulang `server.ts`, `firebaseAdmin.ts`, `ManagerPortal.tsx`, App,
Rules, package/lockfile, dist, Secrets atau cadangan dari paket lama. Struktur
folder kelima file ini harus tetap sama. Ini pembaruan sebagian; jangan hapus
repository. Unggah pada branch baru, tinjau tepat lima file tersebut, merge dan
Pull Changes. Publikasi aplikasi tetap dilakukan oleh pemilik saat siap.

### Yang diperbaiki

- Setiap percobaan baru memakai `customer.reference_id` sintetis yang unik
  berdasarkan referensi percobaan, bukan referensi tetap per Manager.
- HTTP 409 dengan kode resmi `DUPLICATE_ERROR` dari POST /sessions dikenali
  sebagai penolakan pasti. 409 tidak dikenal, timeout, 5xx dan respons hilang
  tetap belum pasti; tidak otomatis dikirim ulang.
- Kode error resmi yang diizinkan dan HTTP status disimpan untuk diagnosis,
  tanpa menyimpan/mengirim pesan gateway mentah, API key atau token.
- Bila respons create memuat ID sesi tetapi validasi/persist gagal, ID kandidat
  disimpan bila memungkinkan. Tombol Periksa Status mengambil ulang sesi itu
  melalui GET dengan Test key dan memvalidasi seluruh linkage.
- Tanpa ID, tombol Periksa Status memberi instruksi pemulihan yang jelas;
  tidak lagi mengembalikan status lama seolah pemeriksaan ke Xendit sudah terjadi.
- Jika create gagal atau respons hilang, panel memuat intent terbaru agar
  tidak terus menampilkan sesi lama yang kedaluwarsa.

### Memulihkan percobaan lama yang terlanjur belum pasti

1. Pada aplikasi publik yang sudah memuat patch, buka panel Xendit Mode Tes,
   klik **Muat Ulang**. Gunakan referensi percobaan yang tampil.
2. Cari referensi itu di Xendit **Mode Tes → Terima Pembayaran → Tautan
   Pembayaran**. Periksa filter/paginasi dan detail sesi yang cocok.
3. **Jika sesi ditemukan**, salin Payment Session ID (`ps-...`) dari detailnya
   ke panel pemulihan, lalu klik **Cocokkan Sesi Xendit**. ID hanya petunjuk
   pencarian, bukan bukti kepemilikan. Server GET /sessions/{session_id}, lalu
   mencocokkan ref, merchant, PAY, nominal Rp10.000, IDR, country, checkout Test,
   kepemilikan dan role Manager terkini sebelum menyimpan hasil. Ini tidak
   membuat sesi baru dan tidak membatalkan sesi Xendit.
4. **Jika pemeriksaan manual tidak menemukan sesi**, centang pernyataan
   pemeriksaan pada referensi yang tampil, lalu klik **Tutup Percobaan yang
   Tidak Ditemukan**. Server mensyaratkan pemilik Manager/Admin aktif yang
   sama, pointer percobaan terkini, hasil belum pasti/tahap creating tanpa ID
   atau ID kandidat, dan usia minimal dua menit.
5. Penutupan menambahkan `manualReview` (UID pemeriksa, waktu server, ref,
   keadaan sebelumnya, keputusan dan sumber pemeriksaan) serta state
   `review_closed`. Tidak ada ledger/lock yang dihapus, tidak ada status
   EXPIRED/FAILED/CANCELED/PAID yang dikarang, dan tidak ada API create/cancel
   yang dikirim. Sesudah itu **Buat Percobaan Test Baru** adalah tindakan
   terpisah yang hanya berjalan jika pengguna menekannya.

Pemeriksaan dashboard oleh Manager **bukan bukti mesin bahwa sesi tidak ada**.
API resmi yang diverifikasi mendokumentasikan GET berdasarkan session ID;
paket ini tidak mengarang endpoint pencarian berdasarkan reference_id. Karena
itu, jangan menutup catatan hanya untuk melewati pengaman tanpa memeriksa
dashboard. Penutupan ini khusus simulasi terisolasi dan **tidak boleh dijadikan
pola retry untuk pembayaran pelanggan/live**. Apabila ada keraguan atau filter
dashboard tidak jelas, pertahankan percobaan dan minta pemeriksaan Xendit.

Webhook terlambat tetap dapat memperbarui intent lama setelah review. Review
tetap disimpan; callback lama tidak memindahkan pointer ke percobaan terbaru.
Penutupan berulang idempoten dan tidak menambah tulisan. Konflik dengan
pemulihan ID/callback ditangani transaksi; sesi yang sudah terverifikasi tidak
dapat ditimpa menjadi review_closed. Pembayaran asli, booking, dispatch,
Accurate dan kode Meta Pixel tidak digunakan oleh jalur pemulihan ini.

Endpoint tambahan: POST `/api/integrations/xendit/test/review-close`;
Bearer Manager/Admin, ref milik sendiri, konfirmasi ref yang identik serta
`checkedTestDashboard: true` wajib. Ini pernyataan manusia yang diaudit,
bukan klaim server telah mencari seluruh sesi Xendit. Tidak menerima actor
atau status keuangan dari browser. Semua akses tetap lewat Admin SDK yang ada.

Pengujian paket ini menggunakan fixture terisolasi dan HTTP loopback; tidak
mengakses Xendit/Firebase dengan secret asli. Tidak ada deploy/publish, push,
merge, perubahan credentials, mutasi produksi atau transaksi baru oleh patcher.
Verifikasi aktual: 31 grup server/client/HTTP lulus; panel React aktual lulus
uji JSDOM terisolasi (konfirmasi review, cegah double click, pemulihan ID,
muat intent baru saat create gagal, logout/pergantian akun, dan respons lambat).
Seluruh 31 grup juga lulus dengan Node.js 22.23.2 native TypeScript stripping,
tanpa memulai server aplikasi yang dapat mengakses Firebase produksi.
`tsc --noEmit` dan build Vite produksi lulus. Suite ini bukan Firestore Emulator
atau browser E2E dan tidak membuktikan hasil panggilan merchant nyata.
Tes merchant nyata tetap perlu setelah pemasangan. Penyebab respons create
percobaan lama tidak dapat dibuktikan dari record lama yang belum menyimpan
kode error; referensi duplikat dan misklasifikasi 409 adalah cacat source yang
diperbaiki, bukan klaim hasil pemeriksaan log gateway produksi.

---

Dokumentasi di bawah menjelaskan paket Stage 1 awal dan koreksi webhook yang
sudah terpasang; daftar tujuh/tiga file di bagian tersebut adalah riwayat paket.

Tanggal: 20 Oktober 2026. Baseline GitHub `main`:
`ebdae602d264c1767f38064a25faf7df8f712f05`.

## Hasil tahap ini

Panel **Manager → Master Data → Operational Settings → Xendit — Mode Tes**
membuat Hosted Checkout Xendit untuk simulasi tetap **Rp10.000**.
Hanya Manager/Admin aktif yang lolos pemeriksaan UID, Staff Master dan staff_roles
saat ini yang dapat membuat/membaca sesi Test miliknya. Identitas tidak diambil
dari email, nama, UID di body, role frontend, atau cache.

Pembayaran pelanggan tetap memakai alur manual yang sudah ada. Tahap ini **belum
mengaktifkan checkout Xendit untuk booking pelanggan**, belum memberi izin terapis
berangkat berdasarkan gateway, dan belum mengintegrasikan Accurate Online.
Tidak ada status booking/payment produksi yang berubah akibat simulasi.
Label COMPLETED dalam panel berarti sesi Test selesai, bukan bukti uang nyata.

## Isi paket — pertahankan struktur folder

Lima file kode:

1. `server.ts` — import + pendaftaran modul baru; kebijakan Manager Stage 7D dipakai ulang.
2. `src/server/xenditSandbox.ts` — backend Test dan webhook, tanpa inisialisasi Firebase baru.
3. `src/lib/xenditSandboxService.ts` — client API dengan token, pemeriksaan sesi dan validasi respons.
4. `src/components/admin/XenditSandboxCard.tsx` — panel simulasi Manager/Admin.
5. `src/components/manager/ManagerPortal.tsx` — menampilkan panel pada menu yang sudah ada.

Dua file pendukung:

6. `tests/xenditSandbox.test.mjs` — pengujian terisolasi, tidak mengakses Firebase/Xendit live.
7. `docs/xendit-test.md` — petunjuk ini.

Paket ini merupakan **pembaruan sebagian**, bukan source aplikasi lengkap. Jangan
menghapus repository/aplikasi yang berjalan dan jangan mengunggah ZIP sebagai satu
file ke source. Ekstrak, lalu unggah isinya dengan path `src/...`, `tests/...`, dan
`docs/...` tetap utuh di root repository. File baru harus berada di folder yang tepat.
Gunakan branch baru, periksa diff, baru merge/pull pada AI Studio. Jika source
target sudah berbeda dari baseline, cocokkan diff dahulu; jangan menimpa perbaikan
baru dengan salinan file lama. `src/App.tsx`/patch footer tidak termasuk paket ini.

## Secrets server

Dua secret yang sudah dipasang:

- `XENDIT_SECRET_KEY` — Secret API key **Mode Tes**, format `xnd_development_...`.
- `XENDIT_WEBHOOK_TOKEN` — token verifikasi callback dari dashboard **Mode Tes**.

Tambahan opsional, tidak perlu diisi untuk konfigurasi awal:

- `XENDIT_ENVIRONMENT=test` — default `test`; nilai lain ditolak, termasuk `live`.
- `XENDIT_TEST_RETURN_URL` — HTTPS; default `https://senzuhome.com/?xendit_test=returned`.
- `XENDIT_BUSINESS_ID` — bila diisi, harus cocok dengan merchant pada respons API.
  Tanpa ini, business_id terikat pada respons create yang diambil dengan secret
  server dan dicocokkan pada pembacaan/webhook berikutnya.

Tidak ada API key/token di browser, settings Firestore publik, source, ZIP atau log.
Tidak perlu menambah dependency, mengganti package/lockfile, atau deploy Rules/index.
Periksa status panel; tulisan “Secret Test tersedia” hanya pemeriksaan konfigurasi,
bukan konfirmasi bahwa izin Payment Sessions merchant sudah aktif.

## Urutan pemasangan dan uji nyata berikutnya

1. Backup/checkpoint aplikasi yang saat ini berjalan.
2. Masukkan isi paket melalui branch GitHub, tinjau diff lima file kode di atas,
   merge, lalu Pull Changes di AI Studio. Jangan unggah `node_modules`, build `dist`,
   file credential atau ZIP cadangan. Jalankan lint/build sebelum publish.
3. Buka panel Xendit pada Manager, klik **Muat Ulang**. Pastikan konfigurasi siap.
4. Publikasikan hanya saat siap menguji endpoint yang bisa diakses Xendit.
   Salin URL webhook dari panel yang dibuka pada domain target tersebut.
   URL preview dan domain live dapat menuju server/secrets berbeda: pastikan domain
   webhook melayani revisi kode dan dua Secrets Mode Tes yang sama.
5. Di Xendit **Mode Tes**, pengaturan webhook Payment Sessions versi baru, arahkan
   **Payment Session Completed** dan **Payment Session Expired** ke URL yang sama:
   `https://DOMAIN-YANG-MELAYANI-BACKEND/api/integrations/xendit/test/webhook`.
   Placeholder DOMAIN harus diganti dengan domain yang benar; jangan gunakan URL
   contoh secara literal. Aktifkan automatic webhook retry. Endpoint ini tidak
   menerima topik invoice/payment lama atau sekadar request GET pada address bar.
6. Klik **Buat Checkout Test Rp10.000**. Setelah berhasil, klik **Buka Checkout Test**.
   Pilih VA pada checkout Test dan gunakan mekanisme simulasi Xendit, **tanpa
   transfer uang nyata**. Kanal tahap ini dibatasi BNI/BRI/Mandiri/Permata VA.
7. Kembali ke panel, klik **Periksa Status Xendit**. Periksa sesi selesai dan
   webhook diterima. Redirect sukses tidak mengubah status apa pun.
8. Uji expired, webhook retry, reload dan logout/login. Jika lulus dengan akun
   merchant nyata dalam Mode Tes, barulah rancang sambungan pembayaran booking
   pelanggan dan guard dispatch dengan checkpoint terpisah.

Setelah dipasang, belum ada webhook yang otomatis dikonfigurasi di dashboard.
Kami tidak melakukan push/merge, publish/deploy atau request Xendit menggunakan
credential asli dalam pengerjaan paket ini.

## Isolasi, konkurensi dan batasan

Penulisan baru hanya pada `xendit_test_sessions` dan `xendit_test_webhook_events`.
Keduanya tertutup oleh default-deny pada Firestore Rules baseline. Browser tidak
membaca/menulis koleksi tersebut langsung; seluruh akses melalui backend.
Tidak ada penulisan ke bookings, payments, status history keuangan produksi,
Staff Master, notifikasi, settlement atau Accurate.

Sebelum API create, transaksi menyimpan intent deterministik berdasarkan verified
UID + attemptId dan satu pointer percobaan aktif per UID. API tidak dipanggil di
dalam callback transaksi. Percobaan yang sama tidak mengirim POST /sessions lagi;
percobaan berbeda ditolak selama hasil sebelumnya belum pasti/masih aktif.
Tidak mengasumsikan dukungan header idempotency yang tidak tercantum pada kontrak
Payment Sessions. Ini mencegah retry otomatis menggandakan sesi saat timeout.

Jika respons create hilang, Muat Ulang memulihkan referensi dari server. Webhook
valid bisa memulihkan sesi dari intent yang telah tersimpan. Jika belum ada sessionId
dan webhook tidak pernah datang, percobaan dikunci untuk pemeriksaan manual di
dashboard. Paket pemulihan di atas menambahkan pencocokan ID dan penutupan
catatan berdasarkan review Manager; **tidak ada reset yang otomatis membuat tagihan pengganti**.
Jangan menghapus ledger/lock untuk memaksa retry tanpa memeriksa sesi Xendit dulu.
Penolakan create yang pasti (HTTP 400/401/403/404/422, atau 409 DUPLICATE_ERROR) mengizinkan percobaan baru
secara eksplisit; hasil ambigu tetap dikunci. Status expired dikonfirmasi API,
bukan berdasarkan jam browser.

Token webhook dibandingkan secara timing-safe. Payload dicocokkan terhadap intent,
nominal, currency, country, tipe PAY, mode dan merchant. Backend selalu GET sesi
dengan Test key sendiri sebelum menerima hasil. API yang masih ACTIVE saat callback
completed datang menghasilkan 503 agar Xendit retry. Event dicatat deterministik
per session+event; callback berulang tidak menambah event kedua. COMPLETED tidak
diturunkan oleh observasi lama ACTIVE/EXPIRED. Sesi hanya berisi data pelanggan
sintetis, bukan nama/email/telepon pelanggan sungguhan.

Tahap ini belum memiliki scheduler/worker rekonsiliasi, refund gateway, settlement,
checkout nominal booking aktual, akuntansi, atau payment capture verification untuk
otorisasi layanan nyata. Rate limit bersifat per-instance sebagai pembatas tambahan;
lock persisten Firestore adalah pengaman duplikasi lintas instance.

## Verifikasi lokal yang dijalankan

```sh
npm run lint
npm run build
node --test tests/xenditSandbox.test.mjs
```

20 grup test server/client/HTTP terisolasi lulus. Suite memuat callback otorisasi
aktual dari server.ts dan validator Manager Stage 7D aktual melalui TypeScript AST.
Fixture memeriksa transaksi read-before-write, rollback, retry callback, dua request
bersamaan, role nonaktif/konflik/duplikat, token invalid, timeout, ownership asing,
webhook palsu/berulang, respons API berbeda dan pergantian sesi client.

Panel React aktual juga diuji terpisah dengan JSDOM: load, URL webhook, double-click,
tautan Test, cleanup logout, pemulihan latest session dan pembatasan role CSS.
Ini simulasi DOM lokal, **bukan** browser E2E atau pengujian perangkat fisik.

Lint/build lulus. Build QA diletakkan di luar repository supaya dist yang sudah
ada tidak tertimpa. Tidak ada perubahan package.json, lockfile, Rules, Admin SDK,
autentikasi, booking/payment workflow, Meta Pixel, chat atau notifikasi.
Modul baru juga berhasil di-import dan seluruh 20 test lulus pada Node.js 22
dengan native TypeScript stripping, sesuai cara backend dijalankan saat ini.

Belum dijalankan: koneksi Xendit memakai secret asli, webhook dashboard nyata,
Firestore Emulator contention, browser produksi/TWA, transaksi uang nyata,
deployment aplikasi/Rules, dan Accurate Online.

## Referensi kontrak resmi

- https://docs.xendit.co/apidocs/create-session
- https://docs.xendit.co/apidocs/get-session
- https://docs.xendit.co/apidocs/webhook-notification-sent-defined-webhook-url-updates-payment-session
- https://docs.xendit.co/docs/payment-1
- https://docs.xendit.co/docs/authorization-and-capture-flow-manual-capture
- https://help.xendit.co/hc/id/articles/360038072991-Bagaimana-cara-melakukan-validasi-bahwa-webhook-berasal-dari-Xendit

Payment Session dibuat dengan PAY + AUTOMATIC, bukan SAVE atau MANUAL authorization.
Hasil simulasi tidak dipakai sebagai bukti dana nyata atau otorisasi dispatch.

## Koreksi kompatibilitas contoh webhook dashboard — 20 Oktober 2026

Payload bawaan “Tes dan simpan” yang diamati pada dashboard menggunakan
`data.id`, `reference_id: test_session`, `session_type: SAVE`, nominal 100000 dan
identitas merchant contoh. Itu bukan sesi PAY Rp10.000 milik percobaan Senzu Home.
Backend kini mengenali alias `data.id` bila `data.payment_session_id` tidak ada;
dua alias yang konflik tetap ditolak. Setelah validasi token callback, payload
berstruktur valid untuk referensi di luar namespace Senzu diakui HTTP 200 dengan
`ignored: true`, **tanpa DB read/write, tanpa API call, tanpa memperbarui status**.
Referensi yang menyerupai Senzu tetapi malformed (`szt_...` tidak valid) tetap
ditolak. Callback untuk intent Senzu tetap wajib lolos seluruh pemeriksaan PAY,
nominal 10000, merchant, linkage dan GET canonical session.

Ini hanya mengatasi kompatibilitas payload contoh. **Tidak memperbaiki DNS,
akses cookie/login preview, atau membuat URL preview menjadi endpoint publik.**
Alamat ais-dev yang dicek anonim pada 20 Oktober menampilkan HTML “Cookie check”
untuk GET health, sehingga akses callback dari server Xendit belum terbukti.
ENOTFOUND pada dashboard berarti pengiriman gagal sebelum mencapai handler.
Gunakan backend Test yang dipublikasikan dan dapat dijangkau server tanpa cookie
browser; verifikasi deployment/configuration terlebih dahulu. Jangan menganggap
domain produksi sudah memuat modul ini hanya karena /api/health memberi 200.
Jangan mengganti URL menjadi senzuhome.com secara buta, mengubah DNS/IAM atau
melemahkan token validation untuk mengatasi masalah jaringan.

Paket koreksi ini berisi **3 file saja**: src/server/xenditSandbox.ts,
tests/xenditSandbox.test.mjs, docs/xendit-test.md. Terapkan setelah paket Stage 1;
ini bukan pengganti tujuh file awal dan tidak mengubah keempat file kode lainnya.
Pengakuan 200 pada probe dashboard hanya membuktikan token dan jalur callback
berfungsi; keberhasilan transaksi tetap harus diuji dengan sesi PAY nyata Mode Tes.
