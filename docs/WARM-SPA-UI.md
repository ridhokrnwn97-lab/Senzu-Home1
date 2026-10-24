# Senzu Home — nuansa spa hangat

Palet mengikuti arah visual krem, cokelat dan karamel pada referensi brand.
Warna dikelola sebagai token Tailwind di `src/index.css`: canvas #F8F3EC,
paper #FFFCF7, brand #754C31, espresso #4F3222, caramel #E5C6A4,
gold #EBD2B5, cream #F5E7D6. Font memakai Plus Jakarta Sans dan Playfair Display
yang sebelumnya sudah dimuat oleh halaman. Warna status tetap semantik.

Beranda memiliki hierarki baru, CTA booking/tracking terpisah, penjelasan tiga
langkah termasuk pembayaran 100% sebelum keberangkatan, kartu layanan yang
dapat dipilih melalui keyboard, dan navigasi bawah yang menunjukkan tab aktif.
Menu ringkas berlaku hingga lebar tablet; menu desktop mulai 1024px. Safe area
dan ruang bawah footer mencegah navigasi menutupi konten terakhir.

Tema diterapkan pada beranda, booking, halaman pembayaran manual/Live,
pesanan, tracking, akun, login/registrasi pelanggan, rewards, splash screen,
navbar/footer dan warna instalasi PWA. Navigasi staf ikut memakai warna brand;
tata letak dashboard operasional tidak didesain ulang. Netral slate di tema
dibuat hangat sehingga komponen bersama tidak berwarna kebiruan.

Source layanan, harga, identitas pengguna, kalkulasi booking, upload bukti,
Xendit, Accurate dan pemicu Meta tidak diubah. Empat belas file yang hanya
mengganti styling diperiksa dengan perbandingan AST setelah mengabaikan atribut
className serta menormalkan nama warna. Perubahan perilaku UI terbatas pada
kartu layanan yang dapat diakses dengan keyboard dan aria-current navigasi.

## Verifikasi lokal

- TypeScript (`npm run lint`), build produksi, dan pemeriksaan whitespace lulus.
- Node.js 22.23.4: 23 grup lulus, terdiri dari 4 pengujian tema/beranda,
  12 regresi UI booking/pembayaran, dan 7 pengujian Meta paid Lead.
- Lebar 320, 390, 768, 1024, 1280 dan 1440px diperiksa tanpa overflow.
- Pemilihan layanan lewat keyboard/kartu, callback booking/tracking, lima tab
  navigasi, target sentuh utama minimal 44px, teks diperbesar dan reduced motion
  diperiksa pada komponen asli dengan data fixture.
- Semua koneksi eksternal diblokir pada fixture UI. Hasil tersebut bukan bukti
  transaksi Xendit nyata atau penerimaan event Meta.

Jalankan setelah build:
`node --test tests/warmThemeUi.test.mjs tests/xenditBookingUi.test.mjs tests/xenditLiveUi.test.mjs tests/metaPaidLead.test.mjs`.
Browser Chromium lokal dapat ditentukan melalui `XENDIT_CHROMIUM_EXECUTABLE`.
`SENZU_UI_SCREENSHOTS` menyimpan pratinjau desktop/mobile dengan label Data contoh.
Pratinjau tidak mengubah harga katalog pada database.

## Penerapan

Tinjau PR, lalu merge → Pull Changes di AI Studio → Republish. Periksa beranda,
booking, pembayaran, pesanan dan akun di HP. Pembaruan ini tidak mengaktifkan
Pixel yang belum memiliki ID dan tidak mengubah pengaturan integrasi tersimpan.
Ikon aplikasi resmi tetap dipertahankan.
