# Ruas lurus barong — area lidah bawah gigi

Sumber asli ditemukan di Downloads dengan nama yang sama seperti screenshot. SHA dan decode dicatat dalam source-manifest.json. Gambar 4000×4000 diturunkan ke 1024×1024 menggunakan sips. Settings mengikuti screenshot: 15 warna, tolerance 0,8, minArea 24, smoothing aktif. Decoder berbeda dari browser: hasil offline 8 warna/60 kontur, sedangkan screenshot 6 warna/57 kontur. Karena itu ini reproduksi sumber yang sama, bukan rekonstruksi byte-identik tampilan screenshot.

## Perbaikan

`straightSpans` mencari ruas monotone sepanjang ≥48 piksel proses dengan jarak seluruh sampel kontur ke chord ≤min(0,35; tolerance/2). Ruas tidak boleh melewati sudut terlindungi atau titik pembagi loop. Kandidat diekspor sebagai SVG `L`, bukan cubic yang mengikuti variasi tangen lokal. Ujung menjadi batas fitting; arah tangen pada ruas kurva tetangga mengikuti garis. Sudut eksplisit tetap boleh tajam.

Ini **adaptasi geometri**, bukan keputusan line/curve Vector Magic yang sudah dipulihkan. Kurva yang sangat dangkal masih bisa didekati garis dalam toleransi; bukan classifier semantik bentuk lurus. Metode ini menilai jarak titik-ke-chord, bukan objective raster akhir. Dua sisi shared boundary tetap memakai geometri sama.

## Hasil

Lima ruas lurus dikenali. Kontur tetap 60, segmen 1246→1249; penambahan pembatas fitting dapat menambah segmen sekitar sambungan meskipun ruas tertentu digabung menjadi garis.

Pada dua sisi celah lidah di y=530…590 piksel proses, pengukuran independen x(y) terhadap garis regresi menunjukkan RMS kiri 0,04024→<1e-12 px dan kanan 0,04074→<1e-12 px. Ini **kelurusan keluaran**, bukan error terhadap sumber. Script `measure-lines.py` memeriksa SVG merah dan meratakan cubic dengan 256 langkah. Tidak mengklaim seluruh pinggir lidah lurus: sisi luar dan ujung bulat tetap dapat berupa kurva.

Galat RGB global 0.571154→0.572512; tepi 8.114681→8.149731 (naik sekitar 0,43%). Tujuan perbaikan ini keteraturan garis; fidelity raster tidak meningkat di semua ukuran.

Regresi shipping: 44 ruas lurus, galat tepi 16.195914→16.551834. Jadi regularisasi garis juga punya kompromi pada gambar lain. Timing satu run tidak dibandingkan karena pekerjaan berlangsung bersamaan.

Tes mencakup garis panjang bergetar, proteksi corner, ruas pendek, lingkaran/kurva, pembalikan arah, kontinuitas lingkaran dan detail tipis. 55 tes frontend, TypeScript compile dan build lulus. Pendekatan tetap terbatas resolusi proses 1024; tidak mengembalikan detail yang hilang saat downscale.

## Reproduksi

```sh
node tests/tracing-local-quality.mjs RND/tracing-quality/barong-lines-v10/source.bmp RND/tracing-quality/barong-lines-v10 RND/tracing-quality/before-straight-spans.ts RND/tracing-quality/barong-lines-v10/settings.json
python3 RND/tracing-quality/barong-lines-v10/measure-lines.py
```

[Perbandingan, langsung zoom ke lidah](comparison.html) · [SVG hasil](after.svg) · [Kelurusan](line-metrics.json) · [Metrik raster](metrics.json)
