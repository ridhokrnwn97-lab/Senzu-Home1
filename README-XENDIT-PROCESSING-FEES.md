# Processing fee Xendit dan PPN biaya

Perbaikan ini menambahkan pencatatan debit processing fee harian yang terpisah dari biaya metode pembayaran pada booking. Source dasar: main 07a37dc370cf9ffb8f86ad67859c6a0accd4d9e0. Tidak mengubah checkout, pembayaran manual, status lunas pelanggan, atau Meta Pixel.

## Penyebab selisih

Modul neto booking hanya membaca `GET /transactions` dengan `types=PAYMENT`. Processing fee dan PPN-nya adalah debit saldo terpisah, dengan tipe `PROCESSING_FEE_DEDUCTION` dan `PROCESSING_FEE_VAT_DEDUCTION`. Keduanya tidak boleh dihitung ulang dari jumlah booking lunas atau dikurangkan lagi dari penerimaan bruto. Processing fee dapat mencakup percobaan, payout, atau refund, dan ditagih agregat harian.

Dokumentasi resmi: https://docs.xendit.co/docs/transaction-fees dan https://docs.xendit.co/apidocs/list-transactions. Daftar enum dokumentasi API belum mencantumkan kedua tipe debit tersebut. Karena itu aktivasi wajib membuktikan ID potongan yang diketahui dari dashboard benar-benar ditemukan melalui API tanpa filter tipe. Jika API tidak menyediakannya atau bentuknya berbeda, modul menolak aktivasi; jangan melonggarkan validasi tanpa memeriksa bukti aktual.

## Jurnal

Setiap ID potongan aktual mempunyai satu nomor `SHPF-<hash bisnis dan ID transaksi>`:

| Akun | Debit | Kredit |
|---|---:|---:|
| 600031 Beban Administrasi Xendit - Senzu Home | nominal potongan | 0 |
| 110103 Saldo Xendit – Senzu Home | 0 | nominal potongan |

Processing fee dan PPN diposting sebagai dua jurnal terpisah mengikuti dua ID potongan. PPN biaya dibebankan sesuai keputusan Finance. Tanggal jurnal adalah tanggal debit dibuat dalam WIB, bukan tanggal pembayaran atau waktu retry. Tidak ada PPN Masukan, perkiraan tarif, perubahan penjualan, ataupun transfer ke rekening bank.

## Penerapan

1. Merge PR, Pull Changes di AI Studio, lalu Publish/Republish. Tidak perlu secret, dependency, atau job scheduler tambahan.
2. Masuk Manager → Operational Settings → Accurate Online — Pencatatan Transaksi → Processing fee harian Xendit.
3. Tentukan tanggal awal potongan yang belum dijurnal. Pratinjau maksimal 31 hari. Cocokkan ID, tipe, nominal dan tanggalnya dengan Balance/Transactions Xendit.
4. Masukkan satu atau lebih **Transaction ID** potongan contoh yang muncul pada pratinjau, bukan Reference/Product ID.
5. Konfirmasi Finance bahwa potongan sejak tanggal awal belum dijurnal manual dengan nomor lain; aktifkan. Aktivasi membaca API dan memeriksa master Accurate, tetapi tidak membuat jurnal.
6. Scheduler `senzu-accurate-sync` yang sudah ada melakukan pemindaian dan posting bertahap. Tombol proses manual dapat dipakai untuk investigasi, tetapi hasilnya bukan bukti scheduler otomatis.
7. Muat ulang status. Pastikan jurnal berstatus terverifikasi, lalu cocokkan di General Ledger → Journal Voucher/Account History Accurate. Tanda terverifikasi hanya diberikan setelah detail jurnal dibaca kembali.

Jangan menjurnal manual potongan yang termasuk cakupan otomatis dengan nomor berbeda: pencarian nomor tetap tidak dapat mendeteksi semua jurnal manual bebas. Pencatatan biaya booking `SHXF` yang sudah ada tetap dipertahankan. Saldo atau booking sebelum aktivasi gross tidak dibackfill oleh fitur ini.

## Ketahanan dan cakupan

- Endpoint Manager memakai autentikasi Firebase dan pemeriksaan Staff Master yang sudah ada. Request tidak menerima override nominal, akun, kredensial, host, atau payload jurnal.
- Pembacaan Xendit hanya GET pada host tetap, kunci Live server, ID bisnis yang cocok, IDR, status berhasil dan settled, arah MONEY_OUT, nominal positif/neto yang sama. Tidak membaca atau mengirim token ke browser.
- Pagination maksimum 10 halaman/1.000 transaksi per rentang. Tidak mengikuti URL dari provider. Pemindaian tidak lengkap, baris duplikat, atau data tidak valid menghentikan pencatatan; tidak memilih sebagian hasil sebagai bukti lengkap.
- Worker memakai lease Firestore yang sama dengan gross. Pemindaian dan posting dipisah antar-run. Cakupan awal dipindai per tujuh hari; setelah mencapai hari ini, 31 hari terakhir dipindai ulang bertahap setiap siklus. Perubahan terlambat di luar 31 hari perlu pemeriksaan per tanggal; modul tidak mengklaim telah merekonsiliasi seluruh saldo sepanjang masa.
- Ledger operasi disimpan sebelum POST. Hasil POST yang belum pasti tidak pernah dikirim ulang. Tombol Cocokkan Jurnal Tersimpan hanya membaca Accurate; tidak menghapus receipt operasi atau membuat jurnal pengganti.
- Bukti/nominal berubah atau nomor bertabrakan ditahan untuk review. Jeda global menghentikan pengiriman, jeda processing fee terpisah dari biaya booking.
- Saldo awal lama, debit jenis lain, refund, penyesuaian, minimum/monthly fee, dan pencairan bank memerlukan rekonsiliasi tersendiri. Saldo total baru boleh dinyatakan cocok setelah seluruh komponen tersebut diperiksa.

## Validasi

Pengujian lokal memakai fixture, bukan kredensial atau transaksi nyata. Pengujian mencakup fee/PPN terpisah, tanggal WIB, nominal berubah/tidak valid, pagination, pembacaan tanpa write, persetujuan/ID contoh, lease lintas worker, pemindaian ulang, hasil POST ambigu, pencocokan tanpa POST ulang, akun/date/detail jurnal, jeda, akses Manager, pergantian akun dan panel React. Build dan TypeScript harus lulus.

Keberhasilan lokal tidak membuktikan API Live menyediakan potongan ataupun jurnal baru berhasil dibuat. Bukti produksi berikutnya wajib berupa pratinjau API yang cocok dengan dashboard, status jurnal terverifikasi, pemeriksaan native Accurate, dan pelaksanaan scheduler tanpa tombol proses manual.
