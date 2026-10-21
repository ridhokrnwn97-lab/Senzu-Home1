# Senzu Home — checkout pelanggan Xendit Live

Pembaruan disiapkan dari `main` commit `25b4583` pada 21 Oktober 2026.
Pembaruan ini belum diunggah atau dipublikasikan secara otomatis.
Kode baru tetap menonaktifkan pilihan Live sampai konfigurasi server diaktifkan.

## Langkah pertama

Unggah seluruh berkas pembaruan ke repository `ridhokrnwn97-lab/Senzu-Home1`
dengan mempertahankan susunan folder, lalu merge perubahan. Jangan menimpa
atau mengganti Secrets Test yang sudah bekerja.

Setelah merge, lakukan Pull Changes dan Publish di AI Studio dengan
`XENDIT_LIVE_ENABLED` belum disetel atau bernilai `false`. Panel Manager baru
akan muncul di Master Data → Operational Settings → **Xendit — Pembayaran
Pelanggan**. Pembayaran manual dan panel Xendit Mode Tes tetap tersedia.

## Berkas dan perilaku

- Pilihan pelanggan **Bayar Online — Xendit** hanya muncul ketika konfigurasi
  Live tersedia. Pembayaran manual tetap menjadi pilihan awal.
- Pemesan harus masuk ke akun pelanggan. Booking dan harga bersih dihitung
  melalui transaksi server, termasuk diskon/voucher/poin yang berlaku dan
  jarak berkendara Google Routes. Jarak atau nominal dari browser tidak
  menjadi dasar tagihan. Total yang didukung Rp10.000–Rp10.000.000.
- Pelanggan menekan **Siapkan Pembayaran Xendit**, kemudian **Lanjut ke
  Pembayaran Xendit**. Kanal yang diminta: QRIS, VA BNI, BRI, dan Mandiri.
  Tagihan sebesar 100% total bersih pesanan.
- Satu booking memiliki satu intent pembayaran. Klik berulang, respons
  terputus, dan refresh tidak otomatis membuat checkout pengganti.
- Sesi berlaku paling lama 30 menit dan tidak melewati batas pembayaran
  booking, yaitu 60 menit dari waktu pembuatan Firestore. Sesi baru ditolak
  jika sisa waktu tidak lebih dari 11 menit agar memenuhi minimum expiry
  Xendit berikut toleransi waktu jaringan.
- Status lunas hanya ditulis setelah API server Xendit mengembalikan sesi
  yang cocok: merchant, referensi, ID sesi, mata uang, nominal, mode PAY,
  dan ID pembayaran. Redirect browser tidak menjadi bukti pembayaran.
- Webhook sah mengubah payment milik booking tersebut menjadi `paid` dan
  booking menjadi `PAID`/`Confirmed`. Penugasan dan keberangkatan terapis
  tetap melalui alur operasional aplikasi.
- Pembayaran yang tiba setelah pembatalan atau konflik harga ditandai untuk
  pemeriksaan. Sistem tidak menghidupkan kembali booking yang ditutup.
  Perubahan harga/jadwal/alamat pada booking Live yang sudah disegel tidak
  didukung melalui edit klien; kelanjutan kasus perlu ditinjau Customer Service.
- Verifikasi, penolakan, kedaluwarsa, koreksi, dan unggah bukti **manual**
  tidak dapat menimpa pembayaran gateway. Refund Xendit otomatis belum dibuat.
- Sesi Test tetap terpisah dari booking/pembayaran pelanggan. Tidak ada
  trigger Meta Purchase atau trigger konversi baru. Event booking yang sudah
  ada dipertahankan untuk booking pelanggan; simulasi Test tidak mengirimnya.
- Accurate Online belum diintegrasikan.

## Aturan Firebase wajib dipublikasikan sebelum mengaktifkan Live

**Publish AI Studio tidak dianggap sebagai bukti bahwa Firestore Rules ikut
terpasang.** Gunakan Firebase Console pada project yang sama dengan
`firebase-applet-config.json`, buka Firestore Database → Rules, lalu
publikasikan isi lengkap `firestore.rules` dari paket ini. Alternatif bagi
pengembang yang sudah memiliki akses Firebase CLI:

```sh
firebase deploy --only firestore:rules --project PROJECT_ID_YANG_SUDAH_DIVERIFIKASI
```

Rules baru menolak pembuatan booking Live langsung oleh klien, mengunci
harga/kepemilikan/status keuangan booking Live, dan memeriksa payment server
yang benar-benar lunas sebelum mengizinkan progres layanan. Rules juga
memblokir progres ulang dari booking Live yang sudah ditutup.

Evaluasi Staff Master pada update booking disatukan menjadi satu pemeriksaan
otorisasi agar tidak melewati batas evaluasi Rules. Cakupan peran lama tetap
dipertahankan. Collections `xendit_live_sessions` dan
`xendit_live_webhook_events` hanya dapat diakses server.

## Konfigurasi server terpisah

Masukkan nilainya langsung di Secrets/konfigurasi server AI Studio. Jangan
mengirim secret/token melalui chat atau memasukkannya ke GitHub.

| Nama | Nilai/kegunaan |
| --- | --- |
| `XENDIT_LIVE_SECRET_KEY` | Secret API Key **Live**, awalan `xnd_production_`. Buat key tersendiri untuk Senzu Home dengan Money In Write; akses lain None. |
| `XENDIT_LIVE_WEBHOOK_TOKEN` | Token verifikasi callback yang berlaku pada konfigurasi webhook **Live** akun Xendit tersebut. |
| `XENDIT_LIVE_BUSINESS_ID` | Business ID akun Xendit yang benar, bukan nama usaha atau nama legal. Harus cocok dengan `business_id` sesi API. |
| `XENDIT_LIVE_ENABLED` | Awalnya `false`. Ubah menjadi string `true` hanya setelah kode, Firestore Rules, kredensial, dan kedua webhook Live siap. |
| `XENDIT_LIVE_RETURN_URL` | Opsional; default `https://senzu-home.ai.studio/?xendit=returned`. |
| `GOOGLE_MAPS_SERVER_API_KEY` | Opsional bila `VITE_GOOGLE_MAPS_API_KEY` yang ada sudah tersedia untuk server dan diizinkan memakai Routes API. Jika memakai key server terpisah, simpan dengan nama ini. |

Kehadiran key belum membuktikan key diterima Xendit atau Google Routes.
Panel Manager hanya menampilkan keberadaan konfigurasi, bukan nilainya.
Jika tidak ada key untuk verifikasi jarak server, pilihan Live disembunyikan.
Kegagalan Google Routes menghentikan booking Live sebelum booking atau
pemakaian benefit ditulis; sistem tidak menganggap ongkos perjalanan gratis.

Pertahankan `XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN`,
`XENDIT_TEST_RETURN_URL`, dan pengaturan lingkungan Test yang sudah ada.
Jangan mengubah `XENDIT_ENVIRONMENT` menjadi Live untuk mengaktifkan modul baru.

## Webhook Live

Pada Dashboard Xendit **Live Mode**, pasang URL berikut untuk **Payment
Session Completed** dan **Payment Session Expired**:

```text
https://senzu-home.ai.studio/api/integrations/xendit/live/webhook
```

URL Test lama tetap:

```text
https://senzu-home.ai.studio/api/integrations/xendit/test/webhook
```

Simpan token callback Live yang sesuai pada secret Live. Jangan mengganti
token atau URL Test untuk memasang modul ini. Payload contoh yang tidak
memiliki referensi Live aplikasi akan dijawab dengan `ignored: true`.
Keberhasilan **Tes dan simpan** hanya membuktikan penerimaan endpoint.

## Bukti pembayaran Live end-to-end yang masih harus dilakukan

1. Setelah konfigurasi/rules/webhook siap, aktifkan flag Live dan publikasikan.
2. Gunakan satu pesanan layanan nyata yang disepakati pelanggan. Jangan
   membuat booking pelanggan fiktif atau menggunakan fasilitas simulasi Test
   pada checkout Live. Pembayar menyelesaikan sendiri pembayaran nyata.
3. Catat ID booking, referensi sesi, dan nominal dari pesanan tersebut.
4. Setelah dibayar, muat ulang tampilan pembayaran/hasil return. Jangan
   menekan **Periksa ke Xendit** lebih dahulu jika sedang membuktikan webhook.
5. Di panel Manager, isi ID booking lalu tekan **Lihat Status Tersimpan**.
   Tombol ini hanya membaca database aplikasi. Periksa status, nominal,
   **Konfirmasi lunas pertama**, **Webhook terverifikasi terakhir**, dan
   **Pemeriksaan API terakhir**. Bukti sumber webhook adalah konfirmasi lunas
   pertama `Webhook`; waktu API check tetap kosong bila belum digunakan.
6. Jika pemulihan diperlukan, cocokkan ID sesi yang benar dari Dashboard
   Xendit dengan **Cocokkan Sesi Live**. Ini menjalankan GET ke API Xendit,
   mencatat sumber `Pencocokan sesi oleh Manager`, dan tidak membuat checkout.
7. Cocokkan pembayaran dengan riwayat Xendit dan payment milik booking yang
   sama. Pastikan booking lain dan data Test tidak berubah. Pemeriksaan lokal
   tidak menggantikan pembuktian ini.

Customer Service tidak boleh menyuruh pelanggan membayar ulang hanya karena
respons checkout tidak pasti. Periksa pesanan/sesi yang sama terlebih dahulu.
Jangan mengubah pesanan Xendit menjadi metode manual atau memaksa status lunas.

## Menonaktifkan pembuatan checkout baru

Setel `XENDIT_LIVE_ENABLED=false`, lalu publikasikan. Jangan hapus key/token
atau webhook saat masih ada sesi Live tertunda: callback dan pemeriksaan
untuk sesi yang sudah ada tetap diperlukan. Pembayaran manual tetap berjalan.

## Validasi lokal

Pengujian backend memakai respons API Xendit/Google yang dikendalikan secara
lokal. Pengujian browser menggunakan komponen React nyata dengan fixture
identitas/API; tidak masuk ke akun atau membayar di Xendit. Pengujian Rules
memakai Firestore Emulator, termasuk transaksi Admin dan webhook lokal.
Hasil rinci versi paket tercantum pada petunjuk dalam ZIP.

Hasil pengujian lokal versi paket ini:

| Pemeriksaan | Hasil |
| --- | --- |
| Backend Live | 30 tes lulus |
| Regresi backend Xendit Test | 38 tes lulus |
| Regresi loyalty | 10 tes lulus |
| Browser: BookingForm/manual/Test/Live, return, Manager | 12 tes lulus |
| Firestore Emulator: pembayaran manual | 12 tes lulus |
| Firestore Emulator: Rules dan transaksi Live | 7 tes lulus |
| TypeScript tanpa emit | Lulus |
| Build produksi Vite dengan Node.js 22 | Lulus |
| Import backend Live dengan Node.js 22 tanpa tsx | Lulus |

Total **109 tes lokal lulus**. Tidak ada transaksi Live yang dibuat atau
dibayar, tidak ada permintaan API ke akun Xendit nyata dalam rangkaian tes
tersebut, dan pengujian Meta Test Events langsung belum dilakukan.

Paket berisi 24 berkas pembaruan: 18 berkas aplikasi/rules, 5 berkas pengujian,
dan panduan ini. `package.json`, lockfile, konfigurasi Firebase Admin, footer,
dan berkas implementasi Meta Pixel tidak diubah.

Jalankan backend dan UI dengan Node.js 22. Untuk Rules/manual, pasang
dependensi pengujian yang dipisahkan dari dependensi aplikasi:

```sh
npm install --prefix tests/payment --ignore-scripts --package-lock=false
```

Jalankan Firestore Emulator dan test dalam proses/lingkungan jaringan lokal
yang sama, port `8187`, project demo; tes menolak host selain emulator lokal.
Jangan gunakan project produksi untuk menjalankan pengujian ini.

## Rujukan API resmi

- [Create Session](https://docs.xendit.co/apidocs/create-session)
- [Get Session](https://docs.xendit.co/apidocs/get-session)
- [Pre-integration checklist](https://docs.xendit.co/docs/payments-integration-setup)
- [Pembuatan API Key](https://help.xendit.co/hc/id/articles/16516398053273-Apa-itu-API-Key-dan-Bagaimana-Cara-Membuatnya)
