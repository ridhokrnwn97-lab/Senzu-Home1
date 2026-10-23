# Meta Lead setelah pembayaran Xendit Live

Event standard Meta bernama `Lead` (bukan `Leads`). Semua aturan standard Lead,
termasuk konfigurasi lama di `settings/meta_ads`, dinormalisasi saat dibaca dan
disimpan ke pemicu `xendit_live_paid`. Pixel ID, target Pixel, revision dan
status aktif/nonaktif dipertahankan. Event selain Lead tidak dipindahkan.

Pemicu berasal dari respons endpoint pelanggan Xendit Live `status`, `refresh`
atau `checkout` yang telah diautentikasi. Harus sesuai booking, environment Live,
IDR, referensi Live dan ID sesi, creationState ready, sessionStatus COMPLETED,
paymentStatus paid, paidSource terverifikasi, reconciliationRequired false.
Endpoint server tetap menentukan hak akses dan kebenaran pembayaran melalui
validasi Xendit yang sudah ada. Tidak ada perubahan pada webhook/settlement.

Klik WA, unggah bukti bayar, redirect kembali, Mode Tes, Manager inspect dan
Manager recover tidak mengirim Lead. Pembayaran hasil recovery hanya memenuhi
syarat ketika dibaca kembali dari halaman pelanggan. Pembayaran terverifikasi
melalui webhook maupun pemeriksaan API memenuhi syarat yang sama.

Pixel berjalan di browser ketika halaman pembayaran pelanggan terbuka dan
membaca status server. Ini bukan pengiriman server melalui Conversions API:
menutup browser atau memblokir SDK dapat menyebabkan event tidak terkirim.
Membuka kembali booking Live yang telah lunas dapat mengirim Lead pertama pada
browser tersebut. Tidak ada backfill otomatis untuk seluruh booking.

Deduplikasi memakai hash Pixel, jenis/nama event, pemicu, booking; disimpan di
memori dan localStorage (500 event terakhir). Namespace pembayaran terverifikasi
terpisah dari Lead lama yang berasal dari bukti/WA, sehingga percobaan Lead lama
tidak menekan konversi lunas pertama. Event ID stabil dikirim ke SDK. Pencegahan
lokal tidak menjamin deduplikasi lintas browser/perangkat atau storage dihapus.
Tidak ada nama, telepon, alamat atau detail treatment dalam parameter event.
Kegagalan analitik tidak menghalangi halaman pembayaran atau mengubah statusnya.

## Penerapan

1. Merge PR, Pull Changes di Google AI Studio, lalu Publish/Republish.
2. Manager → Master Data → Operational Settings → Meta Ads & Pixel: pastikan
   Pixel ID yang benar terisi, Pixel dan aturan Lead aktif, lalu simpan.
   Pemicu Lead terkunci pada pembayaran Xendit Live terverifikasi.
3. Periksa Meta Events Manager → Test Events pada transaksi pelanggan berikutnya
   yang memang dilakukan pelanggan. Jangan membuat pembayaran nyata hanya untuk
   pengujian ini dan jangan memakai booking lama untuk menguji event produksi.
4. Pastikan tidak ada Lead saat booking/WA/bukti/redirect/pending, kemudian satu
   Lead setelah server menyatakan paid. Refresh/poll tidak mengirim ulang pada
   browser yang sama. Status server dan penerimaan Meta adalah bukti berbeda.

## Pengujian lokal

`node --test tests/metaPaidLead.test.mjs tests/xenditLive.test.mjs`

Suite Meta memakai source HTTP client, normalisasi settings dan Pixel asli
dengan fixture identitas, respons HTTP dan SDK. Tidak menghubungi Meta, Firebase
atau Xendit. Suite UI Live tetap memakai konfigurasi Pixel nonaktif seperti
sebelumnya. Jalankan juga `tests/xenditLiveUi.test.mjs`, `npm run lint`, dan
`npm run build`. Hasil fixture bukan bukti penerimaan Meta Test Events.
