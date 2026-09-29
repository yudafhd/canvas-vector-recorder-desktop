# Audit kurva seluruh barong dan penyederhanaan konservatif

## Acuan

SVG pada path yang pengguna berikan sudah berubah dari putaran sebelumnya. Versi terbaru disalin ke `ui-before.svg`, hash `f8cf8fa4ea872ad0843c779e6ef7dbacb858aeca88166fd2fcd54490e53e7d92`. Versi ini memiliki 60 path/loop dan 1535 segmen; tidak dicampur dengan laporan UI sebelumnya yang 57 path/1833 segmen. Engine snapshot dan hash tersedia dalam manifest.json. File Downloads asli tidak diubah.

## Temuan audit

- 255 sambungan mempunyai selisih arah tangen >2°. Sebanyak 245 di antaranya >10° dan banyak bertepatan dengan ujung/titik balik ornamen. Angka sudut sendiri tidak membuktikan adanya cacat.
- Sepuluh sambungan ringan 2…10° ditandai dalam `review-joins.svg` untuk inspeksi, bukan otomatis dihaluskan. Tidak ada bukti raster sumber yang cukup untuk memutuskan seluruhnya salah.
- Ada 20 segmen dengan chord <1 piksel proses. Segmen kecil tidak otomatis dihapus: bisa diperlukan oleh fitur tajam.
- Audit dan perbandingan terpisah mencakup mata, lidah, taring dan ornamen. Bentuk utama tampak sama pada inspeksi dua panel; perubahan bersifat kecil.

## Perbaikan kode

`compactSmoothCurves` menambahkan pass akhir pada shared chain sebelum ekspor. Hanya dua cubic bertetangga dengan endpoint sama, arah tangen hampir sama (dot ≥0,9995) dan tanpa corner terlindungi yang dicoba digabung. Garis `L` tidak disentuh. Pasangan yang hampir menutup kembali (chord <2 px) juga ditolak. Kandidat memakai fitter bertangen yang sudah ada dan harus memenuhi jarak tersampling dua arah ≤0,08 px terhadap geometri lama. Jumlah sampel dibatasi untuk menjaga biaya proses. Satu pass pasangan, tanpa penggabungan berulang yang menumpuk galat.

Ini **adaptasi ekspor**, bukan temuan tambahan tentang biaya merge/swap Vector Magic. Kernel biaya hasil riset tidak diubah. Kandidat memakai endpoint dan arah tangen luar yang sama; besar kelengkungan/continuity C2 tidak dijamin. Guard tersampling bukan sertifikat Hausdorff kontinu atau bukti bebas self-intersection pada semua input. Produksi menjalankannya sekali pada shared chain sehingga batas dua warna tetap memakai geometri sama. Corner explicit produksi tetap menjadi penghalang.

## Dua validasi yang berbeda

**Geometri SVG UI aktual:** fungsi diuji langsung pada loop SVG ekspor. Segmen 1535→1469 (66 dihapus), loop dan warna tetap. Pemeriksaan independen 96 sampel per cubic mendapatkan deviasi dua arah maksimum 0,078311 px. Semua 22 perintah garis dan 245 sambungan >10° tetap; perubahan sudut sambungan tajam <0,1°. Jumlah sambungan >2° tetap 255. Jadi tidak mengklaim semua benjolan/sudut kecil sudah diperbaiki. Kandidat ini adalah percobaan pada ekspor, bukan tracing ulang dari piksel UI dan bukan hasil produksi baru.

Renderer independen membandingkan kedua SVG, dengan flattening 0,04 px dan supersampling 4×4: 808 dari 1.048.576 piksel berubah; MAE perubahan RGBA 0,005325 pada skala 0…255. Pada mata 123 piksel berubah, lidah 29, taring 14. Ini besarnya perubahan dari baseline, bukan peningkatan fidelity terhadap sumber.

**Pipeline penuh dari raster offline:** barong 1249→1235 segmen, kontur tetap 60. MAE RGB 0,576056→0,576392; MAE tepi 8,217551→8,219302. Regresi shipping 960→959 segmen, kontur tetap 117; MAE tepi 17,433526→17,433931. Penambahan galat kecil tetap dicatat. Perbedaan jumlah merge dengan kandidat SVG disebabkan pass produksi memakai shared chain, corner state dan koordinat sebelum pembulatan. Raster offline berasal dari sips, bukan piksel Canvas; tidak dianggap bukti identitas UI.

## Validasi dan artefak

59 tes frontend, compile TypeScript dan build produksi lulus. Tes baru memeriksa penggabungan dua bagian cubic, endpoint/tangen, proteksi corner, line dan bentuk hampir tertutup. Tes yang sudah ada memeriksa kelurusan lidah dari SVG UI, lingkaran dan fitur tipis. Tidak ada perubahan Rust. Statistik `compactedCurvePairs` menghitung pasangan shared-chain digabung, bukan selalu penurunan segmen SVG (rantai bisa dipakai oleh beberapa bidang).

```sh
python3 RND/tracing-quality/barong-curves-v12/audit.py
node tests/tracing-ui-curve-audit.mjs
python3 RND/tracing-quality/barong-curves-v12/validate.py
node tests/tracing-ui-render-audit.mjs
node tests/tracing-local-quality.mjs RND/tracing-quality/barong-lines-v10/source.bmp RND/tracing-quality/barong-curves-v12/offline RND/tracing-quality/before-curve-audit.ts RND/tracing-quality/barong-lines-v10/settings.json
```

[Perbandingan interaktif per area](comparison.html) · [Sambungan untuk inspeksi](review-joins.svg) · [Validasi geometri](validation.json) · [Metrik perubahan render](raster-change.json) · [Pipeline offline](offline/metrics.json)
