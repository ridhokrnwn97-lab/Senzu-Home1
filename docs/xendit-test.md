# Senzu Home — Xendit Test, tahap 1

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
dashboard; **tidak ada tombol reset yang otomatis membuat tagihan pengganti**.
Jangan menghapus ledger/lock untuk memaksa retry tanpa memeriksa sesi Xendit dulu.
Penolakan create yang pasti (HTTP 400/401/403/404/422) mengizinkan percobaan baru
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

17 grup test server/client/HTTP terisolasi lulus. Suite memuat callback otorisasi
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
Modul baru juga berhasil di-import dan seluruh 17 test lulus pada Node.js 22
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
