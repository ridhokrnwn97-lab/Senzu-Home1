# Senzu Home — Pemeriksaan koneksi Accurate Online

Tanggal paket: 22 Oktober 2026. Dibuat dari source GitHub main
`4a95e2e94372edc2e1f1acae5bdc287fea3e7d5c`.

## Hasil yang tersedia dalam paket ini

Panel baru berada di **Manager → Master Data → Operational Settings →
Accurate Online — Koneksi**, di bawah panel Xendit.

- Hanya Manager/Admin aktif yang lolos pemeriksaan Staff Master server.
- Memeriksa API Token, Signature Secret, aplikasi Senzu Home, dan identitas
  data usaha PT KSBONE UNTUK KITA.
- Memeriksa empat akun (termasuk akun uang muka yang sudah ada) serta empat
  layanan Senzu Home. Akun diperiksa berdasarkan kode, nama dan jenis.
  Layanan diperiksa berdasarkan kode, nama, jenis Service dan harga dasar.
- Tidak memanggil API simpan/hapus Accurate, tidak menulis Firestore,
  dan tidak membuat faktur, penerimaan penjualan atau jurnal.
- Tidak mengubah pembayaran manual, Xendit Test/Live, webhook, status booking,
  maupun pemanggilan Meta Pixel. Hasil pemeriksaan tidak memicu event Meta.

**Koneksi berhasil belum berarti sinkronisasi transaksi aktif.** Paket ini
adalah tahap verifikasi koneksi dan master sebelum modul pencatatan keuangan.

## Isi ZIP: 9 file

Pertahankan lokasi folder, dengan akar ZIP sama seperti akar repository:

1. `server.ts` — menambahkan pendaftaran endpoint pemeriksaan Accurate.
2. `src/server/accurateConnection.ts` — koneksi API khusus baca.
3. `src/lib/accurateContracts.ts` — identitas aplikasi dan master yang diperiksa.
4. `src/lib/accurateConnectionService.ts` — pemanggilan panel ke server.
5. `src/components/admin/AccurateConnectionCard.tsx` — panel Manager/Admin.
6. `src/components/manager/ManagerPortal.tsx` — menampilkan panel baru.
7. `tests/accurateConnection.test.mjs` — pengujian backend lokal.
8. `tests/accurateConnectionUi.test.mjs` — pengujian panel dengan fixture lokal.
9. `docs/ACCURATE-CONNECTION.md` — panduan ini.

Tidak ada file `.env`, secret, perubahan dependency atau perubahan rules Firebase.

## Pemasangan dan Secrets

1. Unggah sembilan file ke branch GitHub dengan folder yang sesuai, lalu merge.
   Jika main sudah berubah dari commit dasar di atas, tinjau diff sebelum
   mengganti `server.ts` dan `ManagerPortal.tsx`.
2. Lakukan **Pull Changes** di Google AI Studio.
3. Tambahkan dua Secrets server berikut pada aplikasi Senzu Home:

   | Nama Secret | Sumber nilai |
   | --- | --- |
   | `ACCURATE_API_TOKEN` | Accurate: Pengaturan/Setting → Accurate Store → API Token → token aplikasi **Senzu Home** untuk **PT KSBONE UNTUK KITA** |
   | `ACCURATE_SIGNATURE_SECRET` | Accurate Developer Area → aplikasi **Senzu Home** → API Token → **Signature Secret** |

   API Token dan Signature Secret adalah dua nilai berbeda. App Key adalah
   identitas aplikasi dan **bukan** pengganti kedua nilai tersebut.
   Simpan nilai langsung melalui Secrets AI Studio; jangan kirim ke chat,
   commit GitHub, nama variabel `VITE_`, formulir pelanggan atau screenshot.
   Jangan mengganti Secrets Xendit yang sudah bekerja.
4. **Publish/Republish** aplikasi dan tunggu selesai.
5. Buka **https://senzuhome.com** dengan akun Manager/Admin, lalu buka panel
   Accurate. Klik **Muat Ulang Konfigurasi Accurate**, kemudian
   **Periksa Koneksi dan Master**.

## Kriteria verifikasi API yang sebenarnya

Pada aplikasi publik, hasil yang diharapkan:

- Koneksi berhasil dan identitas data usaha benar.
- ID database Accurate ditampilkan; simpan nomor ini untuk penguncian database
  pada tahap pencatatan keuangan berikutnya.
- Delapan baris pemeriksaan cocok:

| Kode | Akun / layanan | Jenis / harga |
| --- | --- | --- |
| 110103 | Saldo Xendit – Senzu Home | Cash & Bank |
| 400005 | Pendapatan Jasa Senzu Home | Revenue |
| 600031 | Beban Administrasi Xendit - Senzu Home | Expense |
| 210102 | Uang Muka Penjualan IDR | Account Payable; menggunakan akun yang sudah ada |
| SH-SIG-030 | Senzu Home - Signature Treatment 30 Menit | Service, Rp160.000 |
| SH-SIG-060 | Senzu Home Signature 60 Menit | Service, Rp225.000 |
| SH-SIG-090 | Senzu Home Signature 90 Menit | Service, Rp325.000 |
| SH-SIG-120 | Senzu Home Signature 120 Menit | Service, Rp425.000 |

Jika hasil tidak cocok, catat kode dan pesan baris; panel tidak memperbaiki
atau membuat master secara otomatis. Jangan membuat ulang token atau akun
hanya untuk mengulangi pemeriksaan.

Service di Accurate tidak menampilkan kolom Sales Return pada tab akun.
Paket ini tidak memaksakan pemetaan retur dan tidak membuat transaksi retur.
Pemeriksaan ini belum memvalidasi setiap pemetaan akun penjualan pada item,
status pajak, rekening settlement, biaya Xendit atau dokumen transaksi.

Opsional untuk memperketat pemeriksaan berikutnya: setelah ID database
terverifikasi, simpan nomor itu sebagai `ACCURATE_DATABASE_ID` di Secrets server.
Jika diisi, token ke ID database berbeda akan ditolak. Nama Secret ini tidak
membuka pencatatan keuangan dan tidak wajib untuk pemeriksaan awal.

## Batas hasil pengujian

- Validasi paket: **87/87 kelompok tes lulus pada Node.js 22.23.4**
  (15 backend Accurate, 4 panel Accurate, 68 regresi Xendit).
  Pemeriksaan tipe TypeScript dan build produksi lulus.
- **Lokal:** pengujian backend dan panel memakai fixture, tanpa kredensial nyata
  dan tanpa panggilan ke Accurate, Xendit atau Firebase publik.
- **API Accurate:** baru terbukti setelah tombol pemeriksaan pada aplikasi
  publik berhasil menggunakan Secrets yang benar.
- **Pencatatan end-to-end:** belum tersedia. Belum ada bukti pembayaran booking
  menghasilkan dokumen Accurate. Modul pencatatan perlu antrean tahan-gagal,
  kunci idempotensi, penguncian ID database serta verifikasi transaksi yang sama
  agar webhook berulang tidak membuat dokumen ganda.

Pembayaran diterima sebelum layanan harus dipisahkan dari pengakuan pendapatan
saat layanan selesai. Mapping akun uang muka tersedia, tetapi paket ini belum
menjalankan skema jurnal tersebut. Nominal biaya dan rekening pencairan Xendit
harus diverifikasi dari settlement sebelum pencatatan biaya/pencairan otomatis.
Booking Live lama tidak diimpor otomatis.

## Menjalankan pemeriksaan kode

```bash
node --import tsx --test tests/accurateConnection.test.mjs
node --import tsx --test tests/accurateConnectionUi.test.mjs
node --import tsx --test tests/xenditLive.test.mjs tests/xenditSandbox.test.mjs
npm run lint
npm run build
```

Tes UI membutuhkan Playwright/Chromium pada lingkungan pengembangan, mengikuti
mekanisme fixture tes UI Xendit yang sudah ada. `XENDIT_CHROMIUM_EXECUTABLE`
dapat menunjuk Chromium pengujian lokal. Tidak menambahkan dependency produksi.

Kontrak API mengacu ke panduan API Token 1.0.3 resmi dari halaman Developer
Accurate serta OpenAPI Accurate yang dibaca pada 22 Oktober 2026:

- https://accurate.id/api-integration/oauth/
- https://drive.google.com/file/d/1_EKt6DE6U-6vkmv4M_vizmC-27wXjXa0/view
- https://account.accurate.id/open-api/json.do

Endpoint eksternal dibatasi ke introspeksi token dan detail master berdasarkan
kode tetap. Pindah host hanya mengikuti HTTP 308 ke cloud Accurate yang sah,
dengan path dan query yang sama. Tidak ada URL tujuan yang diterima dari panel.
