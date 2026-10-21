# Senzu Home — Xendit Booking Test

Paket ini berisi delapan file dari source terbaru repositori
ridhokrnwn97-lab/Senzu-Home1. Dasar: main commit
2b820181aa977cdac88e3f119b40d0a14b69bc39.
Commit lokal hasil perbaikan: d7b9a7ebdf862caa06d14101eb4d3c0030d5ec73.

## Isi dan penerapan

Lima file yang diperbarui:
- src/components/BookingForm.tsx
- src/components/admin/XenditSandboxCard.tsx
- src/lib/xenditSandboxService.ts
- src/server/xenditSandbox.ts
- tests/xenditSandbox.test.mjs

Tiga file baru:
- src/lib/xenditBookingPreview.ts
- tests/xenditBookingUi.test.mjs
- docs/xendit-booking-test.md

Terapkan delapan file di lokasi yang sama pada repositori. README ini hanya
petunjuk dan tidak perlu diunggah. Jika main telah berubah sejak commit dasar,
tinjau dan gabungkan perubahan, jangan menimpa source terbaru begitu saja.
Setelah merge: Pull Changes di AI Studio, lalu Publish/Republish.
Tidak ada perubahan secret, dependency, Firestore Rules, server.ts, atau
konfigurasi Meta Pixel yang diperlukan.

## Perilaku dan batas pengujian

Manager/Admin dapat memilih Xendit — Mode Tes pada formulir booking untuk
menguji 100% total ringkasan. Sesi hanya ditulis pada koleksi Test yang sudah
ada. Pengajuan booking asli diblokir ketika opsi Test dipilih; simulasi tidak
mengirim event konversi Meta. Metode manual pelanggan tetap tersedia.

Harga layanan dibaca ulang dari server. Jarak dan diskon adalah input simulasi
internal, bukan validasi kelayakan diskon/jarak untuk pelanggan Live. Tidak ada
pemakaian voucher/poin atau perubahan booking pelanggan selama simulasi.

Checkout Live pelanggan dan integrasi Accurate belum diaktifkan.

## Hasil verifikasi

52 pengujian lokal lulus di Node.js 22: 38 Xendit, 10 loyalty, 4 browser.
Pemeriksaan tipe, build, dan import backend Node.js 22 juga lulus.
Pengujian memakai fixture lokal, bukan pembayaran end-to-end pada kode baru.
Tidak ada panggilan API Xendit memakai secret pengguna atau Meta Test Events.
Tes publik sebelumnya berlaku pada versi sebelum paket ini.

Unggahan otomatis melalui koneksi GitHub ditolak HTTP 403:
Resource not accessible by integration. Belum ada commit/PR remote atau
publikasi aplikasi dari paket ini. Setelah diterapkan, lakukan satu simulasi
Test baru dan cocokkan sesi, nominal, dan log webhook sebelum tahap Live.

Lihat docs/xendit-booking-test.md untuk rincian teknis dan langkah pengujian.
