# Tahap 10 — model cakupan raster dan prior angular

Pemeriksaan statis; aplikasi target tidak dijalankan pada tahap ini. Delapan fungsi diekstrak ulang dengan batas `LC_FUNCTION_STARTS`, bukan sekadar sampai label berikutnya. [Manifest](phase10/manifest.json) mencatat hash slice x86-64 dan alamat. Reproduksi: `python3 RND/vector-magic-analysis/scripts/extract_phase10.py` (memerlukan hasil unpack lokal seperti pada skrip).

## Bukti dan batas rekonstruksi

`computePixelColor` dan `findPotential` mendukung temuan sebelumnya: warna prediksi adalah penjumlahan cakupan × warna empat kanal yang dinormalisasi /255; energi pengukuran adalah setengah jumlah residual kuadrat. Lihat [computePixelColor](phase10/GenerativeModel-computePixelColor.annotated.txt) dan [findPotential](phase10/GenerativeModel-findPotential.annotated.txt). Identitas kanal, preprocessing alpha, traversal breadcrumb, serta penutupan seluruh kasus piksel belum dipulihkan penuh.

Temuan helper yang lebih terlokalisasi: [computePartialGradients](phase10/GenerativeModel-computePartialGradients.annotated.txt), `0x1000ef480–0x1000ef500`. Untuk sumbu k=0/1, j=1−k, tiga pointer input p,a,b: t=(p[j]−b[j])/(a[j]−b[j]); q=−(a[k]−b[k])/(a[j]−b[j]). Dua keluaran berisi komponen (k:t, j:tq) dan (k:1−t, j:(1−t)q). Ini mendukung turunan interpolasi perpotongan sisi; helper tidak punya guard pembagi nol di rentang tersebut. Syarat pemanggilan dan keseluruhan `findPixelGradient` belum divalidasi. Implementasi aplikasi tidak mengklaim menyalin helper ini.

[Angular potential](phase10/ContourSmoother-findAngularPriorPotential.annotated.txt) mempertahankan rumus tahap 3: sqrt(2−2 dot(unit(u),unit(v))+0,001) + w (|v|/h2−|u|/h1)^2. Gradient implementasi diturunkan dari rumus tersebut dan diuji finite differences; ini belum differential test terhadap eksekusi `findAngularPriorGradient` milik target.

## Penerapan dan adaptasi eksplisit

- `polygonPixelArea`: clipping polygon ke sel piksel adalah implementasi mandiri dari luas cakupan.
- `coverageObjective`: perpindahan shared edge memberi signed swept area × (warna kiri−kanan). Sisi diproses sekali. Turunan boundary integral diuji untuk loop tertutup dan node interior dengan endpoint tetap. Patch hanya valid untuk batas perpindahan <1 piksel yang diterapkan optimizer.
- `angularPrior`: rumus potential hasil riset, h=1 untuk grid unit aplikasi. Segmen runtuh ditolak dengan guard mandiri.
- `refineCoverage`: projected descent maksimum 12 iterasi, backtracking, bobot angular 0,3 dan length 0,25. Ini bukan tiga fase global `doCG`. Langkah harus menurunkan total objective serta tidak menaikkan energi raster.
- Loop tertutup dengan luas kisi ≤7 memakai penalti 5(A−Aref)^2. Batas loop/area referensi merupakan adaptasi; flag small-region, region berlubang dan counts asli belum dipulihkan. Guard proyeksi sisi bukan jaminan bebas self-intersection global.
- Warna host menggunakan premultiplied RGBA, sedangkan palet tetap opaque/binary alpha seperti pipeline lama. Mode hapus putih melewati refinement agar tidak mengoptimalkan terhadap target yang salah. Jalur Gaussian dan residual midpoint lama menjadi warm start, masih berlabel pendekatan.

Lihat [peta seluruh tahap](../../docs/TRACING-RESEARCH-MAP.md) dan [hasil uji daun](../tracing-quality/leaves-raster-v5/REPORT.md). Peningkatan terukur kecil; belum ada pembuktian kesetaraan hasil atau parameter dengan Vector Magic.
