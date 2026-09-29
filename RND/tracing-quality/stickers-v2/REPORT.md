# Tracing lembar stiker: koreksi region dan lapisan

Sumber: `/Users/yuda/Downloads/download (2)/motivational_sticker_sheet.jpg`. Dimensi asli 2000 × 1200, raster proses 1024 × 614.

## Perubahan dan hasil

Piksel transisi tepi diperiksa terhadap campuran dua warna yang didukung tetangga; bidang kecil dibersihkan sesuai minArea. Region bertingkat digambar di atas warna dasarnya. Lubang yang memuat transparansi tetap dipertahankan pada semua lapisan induk. Keluaran tetap berupa SVG path yang bisa diedit.

`before` adalah engine tepat sebelum perubahan region/lapisan, sesudah perbaikan tangen pada tahap sebelumnya. `balanced` memakai engine produksi saat ini dengan **pengaturan yang sama**: enam warna, toleransi 0,8, minArea 4, smoothing aktif, putih dipertahankan.

| Varian | Kontur yang diekspor | Segmen yang diekspor | Byte SVG | Piksel interior alpha < 250 | Galat RGB tepi pada putih |
|---|---:|---:|---:|---:|---:|
| before | 901 | 6,156 | 225,257 | 44,457 | 27.939 |
| balanced | 308 | 2,495 | 116,243 | 0 | 24.906 |
| detail | 7,239 | 32,414 | 921,935 | 0 | 20.585 |
| simple | 308 | 2,105 | 99,265 | 0 | 32.754 |
| transparent | 322 | 2,612 | 118,071 | 360,412 | 25.733 |

Pada `balanced`, kontur turun dari 901 menjadi 308, segmen dari 6,156 menjadi 2,495, dan ukuran SVG dari 225,257 menjadi 116,243 byte. Piksel interior semi-transparan di render opak turun dari 44,457 menjadi 0. Galat RGB tepi membaik dari 27.939 menjadi 24.906.

Pengurangan kontur/segmen mencakup koreksi label dan penghilangan batas lubang warna yang tidak lagi perlu diekspor karena region anak menutupinya. Ini bukan ukuran langsung akurasi bentuk. `paths` sekarang menghitung region/lapisan, sehingga bisa lebih banyak daripada jumlah warna walaupun SVG mengecil.

## Pemeriksaan visual dan batas

`before-vs-balanced.png` menampilkan pembanding lama dan baru. `original-vs-balanced.png` membandingkan raster sumber dengan hasil baru. Garis luar lebih bersih dan serpihan warna berkurang.

Huruf dan garis tepi lebih bersih. Enam warna belum mewakili seluruh warna asli: mint/hijau, merah/pink, biru/ungu, dan krem/putih sebagian digabung. Perbaikan ini memusatkan diri pada tepi dan lapisan, bukan reproduksi palet sumber lengkap. Gambar diperkecil ke raster proses; huruf kecil tetap dibatasi resolusi.

Varian `detail` memakai minArea 0, sehingga koreksi label dan pembersihan komponen mati; jumlah kontur meningkat. Varian `simple` mengurangi segmen tetapi galat tepi lebih besar, sehingga Seimbang tetap pilihan awal. Varian `transparent` menghapus semua hampir putih termasuk detail putih di dalam gambar; alpha rendah pada latarnya diharapkan.

Galat RGB diukur setelah komposit pada putih. Piksel tepi dipilih dari source menggunakan beda RGB kuadrat terhadap tetangga kanan/bawah >1024; nilai adalah rata-rata galat absolut per kanal (0–255). Metrik ini mengukur kedekatan raster, bukan kesetaraan dengan ground truth vektor. Durasi JSON adalah satu eksekusi tracing, bukan benchmark. Hasil ini tidak diklaim identik dengan Vector Magic.

## Validasi dan reproduksi

Tes engine mencakup raster acak dengan lubang/kontak diagonal/transparansi, tangen lingkaran, ujung lancip dan cabang sempit, transparansi dalam beberapa lapisan warna bertingkat, serta piksel campuran di tepi yang berdekatan dengan bidang warna asli dan garis tipis. Snapshot sebelum perubahan berada di `../before-region-layers.ts`. Hash input dan engine tercatat di `metrics.json`.

Jalankan `tests/tracing-quality.mjs` dari root proyek dengan path sumber, direktori output, dan `RND/tracing-quality/before-region-layers.ts` sebagai argumen ketiga. Chrome CDP harus tersedia di port 9337. Pengujian tidak mengaktifkan lisensi produksi atau mengakses runtime Vector Magic.

Verifikasi akhir: `npm test` lulus (39 tes frontend, termasuk 10 tes engine, dan 24 tes Rust). `npm run build` lulus. Smoke test browser pada halaman terisolasi lulus untuk empat JPG: diagonal, segitiga, lingkaran, apel; worker, CSP, preview, unduhan, payload simpan native, navigasi, invalidasi, dan pembatalan diperiksa. Payload simpan native memakai mock IPC; tes Rust memeriksa validator ekspor. Belum ada uji UI native lintas platform pada tahap ini.
