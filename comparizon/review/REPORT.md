# Perapian tracing ikon

Perubahan engine menggabungkan hingga delapan cubic yang bersambung halus. Setiap kandidat dibandingkan dengan seluruh segmen asli dalam dua arah, sehingga penyimpangan tidak menumpuk. Garis dan sudut yang dilindungi tetap menjadi batas penggabungan. Refit akhir mencoba kandidat yang mempertahankan garis lurus, bersama refit bebas; keduanya dinilai terhadap cakupan raster sebelum dipilih.

## Pengujian sumber

JPG pengguna 2400×1792 didekode dengan Chrome Canvas pada 2048×1529. Kedua versi engine menerima byte raster yang sama dan pengaturan yang sama: 2 warna, tolerance 0.2, minArea 12, smoothing aktif, hapus semua putih. `before.svg` dibuat ulang dengan engine sebelum perubahan ini. Jumlah 6.809 segmen baseline tersebut berbeda dari file `../our_program.svg` (9.214 segmen); pengaturan ekspor file lama tidak diketahui, sehingga pengurangan di bawah dihitung terhadap baseline yang direproduksi.

| Ukuran | Sebelum | Sesudah |
|---|---:|---:|
| Path | 103 | 103 |
| Kontur | 378 | 378 |
| Segmen | 6.809 | 6.706 |
| Byte SVG | 329.286 | 324.023 |
| Perintah garis L | 281 | 285 |
| IoU area hitam terhadap JPG | 97,1399% | 97,1379% |
| Area hitam dibanding sumber | 100,0753% | 100,0706% |
| Galat grayscale rata-rata (0–255) | 2,93246 | 2,93179 |
| Galat grayscale dekat tepi sumber | 10,88258 | 10,87930 |

Segmen berkurang 1,51% dan ukuran SVG 1,60%. Ketepatan bentuk serta ketebalan tetap hampir sama. Ini perbaikan konservatif; jumlah segmen masih lebih tinggi daripada geometri isi Vector Magic (3.887).

IoU dihitung setelah batas artwork setiap SVG disamakan dengan batas area hitam JPG, pada 2000×1465 piksel dan ambang hitam 128. Ini ukuran tumpang tindih, bukan skor kualitas umum. Waktu satu kali run sekitar 56,1 detik sebelum dan 58,2 detik sesudah; bukan benchmark waktu yang terkontrol.

## Verifikasi

- TypeScript compile dan build produksi lulus.
- 46 tes tracing dan scene lulus, termasuk penggabungan beberapa segmen, batas penyimpangan, sudut terlindungi, arah terbalik, lubang, dan detail kecil.
- Suite frontend: 131 dari 133 tes lulus. Dua kegagalan berada di pengujian startup yang tidak memakai engine tracing: assertion logo PNG/durasi landing yang sudah tidak sesuai HTML, serta import `recorder-loader` yang belum di-resolve oleh harness navigation.

`comparison.html` menampilkan sumber, sebelum, dan sesudah. `altar.png`, `sombrero.png`, `flower.png`, dan `hand.png` memperlihatkan detail. File SVG awal pengguna tidak diubah.
