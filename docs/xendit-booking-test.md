# Checkout booking Xendit — pengujian internal

Perubahan ini disiapkan dari `main` commit
`2b820181aa977cdac88e3f119b40d0a14b69bc39`. Modul simulasi Rp10.000 sudah
ada; formulir booking sebelumnya hanya menawarkan QRIS dan transfer manual.

## Perilaku yang ditambahkan

- Manager/Admin melihat pilihan **Xendit — Mode Tes** pada formulir booking.
- Pilihan tersebut membuka panel **Uji Checkout Booking**. Tombol pembuatan
  checkout mengirim 100% nominal pada ringkasan ke sesi Xendit Test.
- Harga layanan dibaca ulang dari katalog `services` oleh server. Biaya kunjungan
  dihitung dengan fungsi tier jarak yang sama dengan formulir. Selisih terhadap
  total form ditolak sebelum intent atau sesi dibuat.
- Jarak dan nilai diskon adalah **input simulasi internal**. Pengujian ini tidak
  memvalidasi atau menebus hak voucher/poin dan tidak menjadi dasar harga Live.
  Diskon hanya menjadi potongan simulasi pada snapshot; saldo/kuota tetap utuh.
- Snapshot nama layanan, harga, jarak, biaya kunjungan, diskon dan total dikunci
  pada catatan Test. Nominal sesi tersimpan ditampilkan terpisah dari total form
  saat ini agar perubahan form tidak terlihat mengubah checkout yang sudah dibuat.
- Pengajuan booking asli, termasuk submit melalui Enter atau script, diblokir
  selama opsi Test dipilih. Pilihan Test dipulihkan setelah refresh, tanpa
  mengirim ulang permintaan pembuatan checkout.

Pelanggan umum tetap memakai empat metode manual yang ada. Otorisasi server
tetap menggunakan identitas Manager/Admin aktif dari Staff Master, bukan peran
yang dikirim browser. Secret Live dan environment Live tetap ditolak.

## Batas data dan callback

Handler hanya menulis `xendit_test_sessions` dan `xendit_test_webhook_events`.
Pembuatan preview membaca katalog layanan selain data otorisasi. Tidak ada akses
ke penulisan booking/payment pelanggan, dispatch, notifikasi, loyalty, atau
Accurate. Profil, alamat, nomor telepon dan nama pelanggan tidak dikirim ke Xendit.

Endpoint dan token webhook yang sudah terpasang tetap digunakan:

`https://senzu-home.ai.studio/api/integrations/xendit/test/webhook`

Callback Completed/Expired harus cocok dengan nominal snapshot intent tersebut,
referensi, merchant, mata uang, negara, tipe PAY dan sesi dari GET canonical API.
Webhook terlambat tetap memperbarui sesi lama tanpa mengganti pointer sesi baru.
Sesi Rp10.000 lama dan mekanisme pemulihan Recovery tetap didukung.

Refresh/`Muat Ulang` hanya membaca konfigurasi dan catatan sesi tersimpan. Tombol
`Periksa Status Xendit` melakukan pemeriksaan API eksplisit. Webhook yang diterima
memanggil API untuk validasi lalu memperbarui catatan Test; timestamp webhook
tetap dibedakan dari pemeriksaan manual.

## Penerapan dan pengujian publik

1. Merge perubahan, Pull Changes di AI Studio, lalu Publish/Republish.
2. Pertahankan Secret API Key Test, token webhook, dan
   `XENDIT_TEST_RETURN_URL=https://senzu-home.ai.studio/?xendit_test=returned`.
   Tidak ada secret baru atau perubahan Rules yang diperlukan.
3. Masuk sebagai Manager/Admin, buka formulir pemesanan pada Tampilan Customer,
   pilih layanan/jarak dan **Xendit — Mode Tes**.
4. Periksa ringkasan, kemudian tekan **Buat Checkout Test sesuai Ringkasan** sekali.
   Jika ada percobaan aktif/belum pasti, pulihkan percobaan tersebut lebih dahulu.
5. Buka checkout dan selesaikan fasilitas simulasi Test Xendit tanpa transfer asli.
   Refresh aplikasi dan cocokkan status, referensi, nominal serta log webhook.

Hasil pengujian publik Rp10.000 yang telah diberikan pengguna berlaku untuk
versi sebelum perubahan ini. Perubahan checkout berdasarkan ringkasan form harus
diuji lagi setelah diterapkan. Kunjungan ke return URL saja tidak membuktikan
pembayaran atau pengiriman webhook.

## Verifikasi lokal

```sh
node --import tsx --test tests/xenditSandbox.test.mjs tests/loyalty/loyaltyEarning.test.ts
npm run lint
npm run build
```

Pengujian browser membutuhkan paket Playwright dan Chromium lokal. Runtime Work
Mode dapat memakai `CODEX_PRIMARY_RUNTIME_NODE_MODULES`; lingkungan lain dapat
memasang Playwright sebagai dependensi QA lokal. Binary Chromium alternatif dapat
ditentukan melalui `XENDIT_CHROMIUM_EXECUTABLE`.

```sh
node --test tests/xenditBookingUi.test.mjs
```

Pengujian browser menjalankan komponen BookingForm, panel Xendit dan helper request
yang sebenarnya. Firebase, pembuatan booking, pengiriman Meta dan respons Xendit
diganti fixture; semua akses jaringan selain server fixture lokal diblokir.
Empat skenario mencakup pemblokiran submit asli, tidak ada event Meta dari Test,
refresh tanpa POST ulang, pemulihan uncertain, checkout manual pelanggan,
dan perpindahan Manager dari Test kembali ke manual beserta pemicu Meta booking
yang tetap berjalan hanya pada pengajuan booking manual.

Hasil saat penyiapan: 38 grup pengujian Xendit dan 10 pengujian loyalty lulus di
Node.js 22; import backend dengan native TypeScript stripping, pemeriksaan tipe
dan build lulus. Empat pengujian browser juga lulus; tampilan panel diperiksa
secara visual pada lebar desktop dan ponsel.
Pengujian ini tidak mengakses API Xendit dengan secret pengguna, tidak menguji
delivery langsung Meta Test Events, dan tidak menjalankan suite emulator pembayaran.

Checkout Live pelanggan dan pencatatan Accurate belum diaktifkan. Tahap Live
memerlukan total booking yang otoritatif dan validasi diskon/jarak pelanggan,
serta transisi pembayaran booking/dispatch yang terpisah dari modul simulasi ini.
