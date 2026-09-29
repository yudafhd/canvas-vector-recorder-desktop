# Tracing raster lokal

Halaman Tracing tersedia sebagai tab terpisah di dalam studio setelah lisensi aplikasi aktif. Recorder dan target tetap memiliki halaman sendiri. Tracing tidak memerlukan Vector Magic, binary pihak ketiga, unggahan server, atau hasil ekspor dari aplikasi lain.

## Alur penggunaan

1. Buka tab **Tracing**, pilih atau tarik PNG/JPG/WebP (maksimum 20 MB, 64 megapiksel).
2. Pilih maksimum 2–16 warna, detail, pembersihan bintik, dan resolusi proses 512/1024 piksel pada sisi terpanjang. Gambar kecil tidak diperbesar. Saat pembersihan aktif, warna yang sangat mirip dan warna transisi tanpa dukungan interior dapat digabung.
3. Tekan **Mulai tracing**. Worker menampilkan tahapan proses dan dapat dihentikan dengan **Batalkan**.
4. Bandingkan gambar asli dan SVG menggunakan zoom. Perubahan pengaturan membatalkan hasil lama agar yang diunduh sesuai pengaturan terakhir yang diproses.
5. **Simpan SVG** menulis ke Downloads lewat `save_tracing_svg` pada Tauri; di browser menggunakan unduhan Blob. Nama berkas memakai nama input dengan akhiran `-traced.svg`, dan backend memakai penamaan unik bila sudah ada berkas tersebut.

## Hubungan dengan riset

Implementasi mengikuti pipeline pembentukan palet → region → kontur → kurva. Kernel fitting endpoint tetap, biaya per cabang sampel, classifier corner, keputusan merge/swap dan rumus jadwal ambang hasil riset sekarang dipakai oleh engine produksi. Peta bukti per tahap dan seluruh adaptasi tersedia di [TRACING-RESEARCH-MAP.md](TRACING-RESEARCH-MAP.md). Segmentasi, model raster, fungsi objektif kontur lengkap, serta state/sampling pipeline Vector Magic belum direproduksi. Jadwal ambang memakai rumus yang dipulihkan, dengan pemetaan detail UI aplikasi sendiri; bukan parameter runtime VM untuk input tertentu.

- Warna: histogram RGB 5-bit per kanal, seed deterministik berbobot frekuensi, dan maksimum 12 iterasi k-means pada histogram. Alpha di bawah 128 transparan; alpha lainnya menjadi opak.
- Region: saat pembersihan aktif, pusat palet berjarak RGB ≤18 digabung ke pusat yang lebih dominan. Warna tanpa dukungan interior yang dekat dengan warna stabil (jarak RGB ≤96) dapat dibuang; warna interior dan detail berkontras tinggi dipertahankan. Piksel transisi yang kurang didukung warna tetangga kemudian diperiksa terhadap model campuran dua warna lokal. Alpha tidak diubah. Komponen 4-connected di bawah luas yang dipilih digabung ke tetangga menurut panjang batas dan kedekatan warna. Pembersihan Mati menonaktifkan koreksi label ini. Ini heuristik mandiri, bukan biaya segmentasi dari binary.
- Batas: semua sisi grid dengan label berbeda masuk graph bersama. Setiap rantai antarsimpul percabangan difit satu kali. Pemilihan lokal memakai urutan barat/selatan/timur/utara dan konteks sel sisi pertama dari riset tahap 7. Penutupan loop dan kunjungan sisi berarah tetap memakai state aplikasi sendiri.
- Kontur: smoothing awal dibatasi pergeseran 0,75 piksel; guard sudut raster melindungi ujung sebelum smoothing. Posisi batas subpiksel diestimasi dari campuran RGB dua piksel jika modelnya cukup sesuai. Optimizer mandiri menjalankan 60 langkah untuk menekan residual midpoint dan prior quadratic khusus langkah seragam, dengan anchor ke hasil awal dan batas pergeseran node 0,85 piksel dari grid. Sudut, percabangan, dan batas kanvas dikunci; rantai sangat pendek tidak dioptimasi. Classifier tujuh titik hasil riset kemudian menambah anchor corner. Optimizer/model RGB dan placement satu pass ini tetap pendekatan terhadap ContourSmoother VM.
- Fitting: unit fragments dan cache cost memakai fitting endpoint tetap dengan parameter chord tetap. Cabang n=0/1/2/3/≥4, ridge 1e-5, serta biaya cabang pendek mengikuti riset tahap 4. Merge menerima Δcost di bawah ambang; swap −1 lalu +1 harus menurunkan biaya. Ada 20 scan dengan jadwal geometrik hasil riset. Pemetaan detail ke kompleksitas 1…12 dan veto maksimum galat sampel adalah adaptasi aplikasi. Kandidat output fixed-end yang tidak sesuai arah tangen bersama di-refit oleh adapter mandiri yang melakukan reparameterisasi/split. Biaya merge tetap berasal dari kernel hasil riset; penalti tangent/Hessian tidak ditambahkan ke biaya itu. Diagnostics merekam penggunaan mekanisme dan adapter.
- SVG: path per region disusun dari bentuk luar yang besar ke detail di dalamnya. Lubang yang hanya berisi warna lain diisi oleh lapisan dasar, lalu region anak digambar di atasnya untuk mengurangi celah antialias. Lubang yang mengandung komponen transparan tetap memakai `fill-rule="evenodd"`, termasuk transparansi di dalam region anak. Kurva bersama dipakai terbalik pada bidang sebelah. `paths` menghitung elemen path, sedangkan jumlah warna memakai `colors.length`. `width`/`height` mempertahankan dimensi input, sedangkan `viewBox` memakai raster proses yang dibatasi. Tidak ada bitmap tertanam.

## Batas versi awal

Cocok untuk logo, ikon, dan ilustrasi warna datar. JPEG berisik bisa menghasilkan banyak kontur kecil; foto/gradasi akan menjadi bidang warna diskret. Penghapusan putih berlaku untuk **semua** region hampir putih (masing-masing kanal ≥242), termasuk detail putih di dalam gambar. Transparansi parsial tidak dipertahankan. Kurva dapat mengubah detail sangat tipis; batas galat diukur terhadap sampel kontur yang sudah dihaluskan, bukan sertifikasi topologi kurva kontinu. Jika graph melebihi 250.000 sisi, proses berhenti dengan saran mengurangi resolusi/warna. Pengujian topologi eksak berlaku pada mode tanpa smoothing dengan toleransi kecil.

## Validasi

`npm test` menjalankan pemeriksaan TypeScript, tes frontend termasuk tracing, serta tes Rust. Tes engine memakai rasterisasi point-in-polygon yang independen untuk memeriksa keluaran pada region acak, kontak diagonal, lubang, bidang terpisah, transparansi, penyederhanaan diagonal, kurva lingkaran, dan pembersihan bintik. Rust memeriksa SVG path yang sah dan menolak konten aktif/referensi eksternal sebelum penyimpanan.

`tests/tracing-browser.mjs` adalah smoke test opsional terhadap Vite di port 1420 dan Chrome CDP di port 9337 (Node yang mendukung WebSocket global). Ia menggunakan mock IPC hanya di halaman pengujian untuk status lisensi dan payload simpan; worker, decoding JPG, preview, dan unduhan browser benar-benar dijalankan. Tidak ada mock lisensi dalam aplikasi produksi. Empat JPG dari `RND/aset_jpg` diproses; navigasi, pembatalan, invalidasi hasil, CSP produksi, dan payload simpan diperiksa. Artefak disimpan di `/private/tmp/cvr-tracing-smoke`. Pengujian ini tidak menggantikan uji UI native Tauri pada setiap platform.

Perubahan pendukung: command simpan hanya tersedia di capability studio; HTML5 drag-and-drop di window utama diaktifkan dengan menonaktifkan intersepsi drop native Tauri. Tidak ada dependensi engine tambahan.

## Uji kualitas gambar daun

`tests/tracing-quality.mjs` menerima path gambar, direktori keluaran, dan snapshot engine lama opsional. Chrome CDP pada port 9337 digunakan untuk decoding dan pemeriksaan render SVG; perhitungan tracing memakai modul produksi. Tidak perlu menjalankan UI aplikasi atau mock lisensi. Contoh:

```sh
node tests/tracing-quality.mjs 'RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png' RND/tracing-quality/leaves RND/tracing-quality/baseline-engine.ts
```

Hasil mencakup SVG, perbandingan HTML dengan tampilan ukuran asli, screenshot, hash input/engine, pengaturan, dan metrik alpha rasterisasi. Baca `RND/tracing-quality/leaves/REPORT.md` untuk temuan awal. Berkurangnya segmen bukan bukti kualitas visual. Perbaikan pemilahan warna transisi dan penyusunan lapisan telah diuji kembali pada `RND/tracing-quality/leaves-v2/REPORT.md` serta `stickers-v2/REPORT.md`.

Perbandingan sesudah perbaikan region/lapisan:

```sh
node tests/tracing-quality.mjs 'RND/aset_jpg/Screenshot 2026-09-28 at 20.23.02.png' RND/tracing-quality/leaves-v2 RND/tracing-quality/before-region-layers.ts
```

Uji ini menyertakan varian hapus putih. Metrik alpha yang besar pada varian tersebut memang diharapkan karena latar transparan. Galat RGB dihitung setelah komposit pada putih; galat tepi memakai piksel sumber dengan beda RGB kuadrat terhadap tetangga kanan/bawah lebih dari 1024. Angka ini mengukur kesesuaian terhadap raster, bukan ground truth vektor. Koreksi piksel transisi dapat menyederhanakan warna kecil yang menyerupai campuran dua warna tetangganya; pilih pembersihan Mati untuk mempertahankannya. Detail sangat tipis tetap memiliki batas resolusi dan toleransi.

## Uji kontur subpiksel dan palet apel

`tests/tracing-local-quality.mjs` membandingkan engine lama dan baru tanpa browser/aplikasi native. Input berupa BMP hasil decode `sips`; SVG dirasterisasi oleh scanline renderer independen dengan 4 × 4 sampel per piksel. Artefak, pengaturan, metrik, batas pengukuran, dan perintah reproduksi tersedia di `RND/tracing-quality/apple-v3/REPORT.md`. Kontur apel lebih teratur dan warna transisi berkurang, sementara galat terhadap raster JPEG sedikit meningkat. Ini bukan benchmark kesetaraan Vector Magic. Pembersihan palet juga dapat menggabungkan detail tipis berkontras rendah.

Uji setelah integrasi mekanisme riset memakai gambar daun dan snapshot sebelum perubahan. Artefak tahap fitting tersedia di [laporan leaves-research-v4](../RND/tracing-quality/leaves-research-v4/REPORT.md). Tes kernel memakai golden vectors dari interpreter disassembly dan solver dense independen; generator referensi hanya dibutuhkan ketika memperbarui fixture, bukan untuk menjalankan `npm test`.

Lanjutan model cakupan piksel dan prior angular: [laporan leaves-raster-v5](../RND/tracing-quality/leaves-raster-v5/REPORT.md). Galat tepi daun turun sekitar 0,97%, dengan waktu proses lokal meningkat dari 1,2 ke 6 detik. Optimizer, bobot dan constraint luas tetap adaptasi yang dijelaskan dalam peta riset.

Optimasi cakupan berikutnya mempertahankan SVG dan diagnostik identik pada uji daun. Median empat run turun 5,17 → 2,84 detik (45% lebih singkat); lihat [laporan performa v6](../RND/tracing-quality/leaves-performance-v6/REPORT.md). Angka ini memakai pengukuran berpasangan baru, sehingga tidak langsung disamakan dengan timing satu run v5.

Guard fitting Bézier v7 mengecek penyimpangan di antara sampel lalu melakukan refit lokal bila membaik. Uji offline menurunkan galat tepi daun 13,32% dan apel 21,33%, dengan segmen bertambah (daun 1470→1959, apel 57→79). Lihat [daun](../RND/tracing-quality/leaves-bezier-v7/comparison.html) dan [apel](../RND/tracing-quality/apple-bezier-v7/comparison.html). Mekanisme guard merupakan adaptasi aplikasi, bukan hasil rekonstruksi tambahan VM.

Pembersihan region v8 menambahkan pemeriksaan campuran warna lokal setelah cleanup. Pada shipping doodle 1024×252, 29 piksel direklasifikasi, kontur 135→128 dan segmen 1128→1096; galat sedikit turun. Lihat [hasil dan batasnya](../RND/tracing-quality/shipping-regions-v8/REPORT.md). Ambang pass ini merupakan adaptasi aplikasi.

Koreksi palet interior v9 memulihkan hijau shipping doodle dari `#79827b` ke `#86986e`, tanpa mengubah merah pita dan biru kotak. Kontur 128→117, MAE keseluruhan turun 1,16%, MAE tepi naik 0,045%. [Perbandingan dan batas pengujian](../RND/tracing-quality/shipping-palette-v9/REPORT.md). SVG daun dan apel tetap identik dengan baseline v8.

Deteksi ruas lurus v10 mengurangi gelombang pada ruas panjang seperti celah lidah barong. [Perbandingan zoom lidah](../RND/tracing-quality/barong-lines-v10/comparison.html). Batas deviasi dan proteksi corner tetap berlaku; garis lebih teratur dengan sedikit kenaikan galat raster.

Perbaikan detektor garis v11 diuji pada sampel dari SVG barong yang benar-benar diekspor UI. Ruas panjang dengan gelombang subpiksel diberi toleransi terbatas; lengkungan koheren tetap ditolak. [Diagnosis dan batas validasi](../RND/tracing-quality/barong-ui-v11/REPORT.md). Hasil UI setelah tracing ulang belum divalidasi oleh tes sampel ini.

Pass ekspor v12 menyederhanakan pasangan cubic yang sudah halus dengan guard geometri 0,08 px, mempertahankan line dan corner. [Audit mata, lidah, taring dan ornamen](../RND/tracing-quality/barong-curves-v12/comparison.html). Kandidat geometri ekspor UI mengurangi 66 segmen; pipeline offline mengurangi 14 segmen barong, dengan galat raster naik sangat kecil. Ini bukan klaim output Tauri terbaru sudah diuji ulang.

Regularisasi cekungan v13 merapikan lekukan dangkal pada bidang tertutup hampir cembung, sambil menjaga corner yang dilindungi. [Perbandingan gigi barong](../RND/tracing-quality/barong-teeth-v13/comparison.html). Uji offline menunjukkan cekungan berkurang dengan sedikit kenaikan galat raster; belum validasi tracing ulang UI.
