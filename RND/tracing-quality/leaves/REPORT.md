# Uji tracing dua daun — 28 September 2026

Status: **uji berhasil dijalankan; kualitas visual belum lolos**.

Sumber: `RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png`, 830 × 584 piksel. Screenshot ini diproses pada ukuran aslinya tanpa downsampling. Ini pengujian engine lokal kita, bukan perbandingan dengan output Vector Magic.

## Metode

- `before`: snapshot engine sebelum perbaikan fitting.
- `balanced`: engine saat ini. Keduanya memakai 6 warna, toleransi 0,8 piksel, minArea 4, smoothing aktif, putih dipertahankan.
- `detail`: toleransi 0,35 dan minArea 0; mengubah dua pengaturan, sehingga bukan perbandingan fitting saja.
- `simple`: toleransi 1,6 dan minArea 4.
- Decoding PNG dan render SVG: Chrome headless. Mesin tracing TypeScript yang sama dengan worker dimuat di Node. Waktu di JSON hanya durasi satu eksekusi tracing, bukan benchmark atau waktu UI lengkap.

## Hasil

| Varian | Kontur | Segmen | Ukuran SVG (byte) | Piksel interior alpha < 250 |
|---|---:|---:|---:|---:|
| before | 1,102 | 12,408 | 122,649 | 11,162 |
| balanced | 1,102 | 6,412 | 156,763 | 13,777 |
| detail | 4,317 | 24,110 | 543,080 | 12,448 |
| simple | 1,102 | 6,284 | 150,817 | 13,717 |

Jumlah segmen mencakup kemunculan kurva bersama pada kedua bidang. Cubic menyimpan lebih banyak koordinat daripada garis, sehingga pengurangan segmen tidak otomatis mengecilkan ukuran SVG.

## Pemeriksaan visual

- Siluet dua daun dan batang utama masih terlihat; ujung lancip dan lobus membulat dapat dibandingkan pada `original-vs-balanced.png`.
- Urat halus tampak pucat/terputus di beberapa bagian. Menaikkan detail menghasilkan jauh lebih banyak kontur, tetapi belum menyelesaikan masalah tersebut.
- Segmentasi tetap menghasilkan banyak bidang kecil. Perubahan fitter tidak mengubah label warna dan jumlah kontur pada pengaturan yang sama.
- Ada piksel semi-transparan di batas antarbidang meskipun sumber opak. Ini konsisten dengan celah antialias saat bidang bersebelahan dirender secara terpisah. Metrik alpha bukan bukti bahwa graph kontur terputus; jumlah piksel interior yang sepenuhnya transparan pada pengujian ini adalah nol.
- Tidak ada ground truth vektor untuk screenshot ini; belum ada klaim kesetaraan bentuk subpiksel atau pelestarian seluruh urat.

## Perbaikan yang diuji dan batasnya

Fitter sekarang berbagi arah tangen pada pemisahan kurva dan sambungan penutupan halus, memproyeksikan ulang parameter sampel, serta memvalidasi kandidat sudut pada lingkungan lebih lebar. Tes regresi tambahan memeriksa kontinuitas tangen pada lingkaran beserta galat radial, ujung lancip, dan cabang sempit. Seluruh delapan tes engine dan TypeScript lulus. Tes sintetis tersebut tidak menggantikan penilaian visual screenshot ini.

Prioritas berikutnya: pemilahan piksel transisi yang memperhitungkan warna tetangga dan pelestarian garis tipis, lalu penanganan celah antialias pada penyusunan SVG. Menambah smoothing saja tidak cukup.

## Artefak dan reproduksi

- `comparison.html`: sumber dan empat varian; tombol Fit / original size.
- `original-vs-balanced.png`: perbandingan sumber dengan engine saat ini.
- `before.svg`, `balanced.svg`, `detail.svg`, `simple.svg`: hasil vektor.
- `metrics.json`: pengaturan, hash, dan metrik.
- `../baseline-engine.ts`: snapshot pembanding agar hasil dapat diulang.

Jalankan dari root proyek (Chrome CDP pada port 9337):

```sh
node tests/tracing-quality.mjs 'RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png' RND/tracing-quality/leaves RND/tracing-quality/baseline-engine.ts
```
