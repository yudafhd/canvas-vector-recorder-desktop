# Uji fixture diagonal kuning–putih

Saat uji awal dibuat, gambar kuning–putih yang dikirim di chat belum tersedia sebagai file asli di workspace. Sesuai pilihan pengguna, uji ini menggunakan **fixture prosedural yang menyerupai gambar tersebut**, bukan pixel salinan persis. JPEG asli kemudian tersedia di [`RND/aset_jpg`](../aset_jpg/5a03e635edf18aeeea8d449da76ab4e0.jpg); ia tidak boleh disamakan piksel per piksel dengan fixture. Dua PNG dibuat: [32×32](phase8/diagonal-yellow-white-32.png) untuk inspeksi kecil dan [353×353](phase8/diagonal-yellow-white-353.png) untuk ukuran mendekati tampilan chat. Keduanya RGB tanpa transparansi, dengan warna kuning `(255,193,7)` dan putih `(255,255,255)`; aturan raster `kuning iff x+y < ukuran-1` menghasilkan batas tangga diagonal yang deterministik tanpa antialias.

| Ukuran | Kuning | Putih | Transisi horizontal | Transisi vertikal | Panjang batas internal pada kisi |
|---|---:|---:|---:|---:|---:|
| 32×32 | 496 | 528 | 31 | 31 | 62 sisi |
| 353×353 | 62.128 | 62.481 | 352 | 352 | 704 sisi |

Pada batas internal, referensi aturan lokal [tahap 7](phase7-findings.md) memeriksa 61 node untuk ukuran 32 dan 703 node untuk ukuran 353. Setiap node tersebut menghasilkan tepat **satu kandidat arah** untuk region kuning dan satu untuk region putih; tidak ada node ambigu. Ini membuktikan fixture cocok untuk memeriksa urutan langkah diagonal dan interaksi dengan tepi gambar, tetapi **tidak menguji pemilihan arah pada junction**. Batas kuning–putih bertemu tepi gambar; kontur region lengkap tetap tertutup melalui tepi gambar, bukan kurva terbuka mandiri.

Artefak [skrip uji](scripts/phase8_diagonal_test.py) menghasilkan PNG dan [hasil terukur](phase8/diagonal-test.json), termasuk SHA-256 kedua PNG. Skrip membaca tabel arah dari binary macOS 1.21, namun hanya menjalankan referensi Python untuk kandidat lokal. Gambar keluaran diperiksa secara visual dan bentuk diagonalnya sesuai fixture yang dimaksud. Reproduksi:

```sh
python3 -B RND/vector-magic-analysis/scripts/phase8_diagonal_test.py
```

## SVG yang terdeteksi, asal belum terverifikasi

Saat Vector Magic berjalan, [pemantau](scripts/monitor_vector_magic.py) melihat prosesnya aktif dan mencatat sebuah [SVG](phase8/diagonal-yellow-white-353-vm.svg) baru pada 2026-09-28 07:45:33 UTC, berukuran 2.613 byte dan SHA-256 `270d208fb92e7a2a0243001b43349d9e6383231903afbd0756227753369638d0`. **Koreksi penting:** pengguna kemudian menjelaskan bahwa aplikasi berbayar tidak mengizinkan penyimpanan SVG secara langsung. Karena itu asal SVG tersebut belum terverifikasi; kemunculannya saat proses aktif tidak membuktikan bahwa ia dibuat oleh Vector Magic. Pengukuran di bawah berlaku untuk *berkas SVG tersebut*, bukan keluaran engine yang terkonfirmasi.

[Catatan peristiwa](phase8/runtime-monitor.jsonl) dan [log macOS](phase8/vector-magic-system.log) membuktikan waktu kemunculan berkas dan keberadaan proses, **bukan** hubungan sebab-akibat atau jejak panggilan fungsi engine. Log macOS yang terekam berisi aktivitas layanan sistem dan tidak memuat pesan eksplisit tentang segmentasi, smoothing, atau fitting Bézier. Selang waktu dari monitor mulai hingga SVG muncul tidak dapat dipakai sebagai durasi komputasi karena mencakup operasi manual pengguna.

SVG memiliki kanvas keluaran `3873×3873` dengan transformasi artwork; koordinat dua bidang diagonal tetap dinyatakan dalam satuan lokal `353×353`. Berkas ini juga berisi path persegi panjang hitam dan path putih degenerat, sehingga perbandingan fixture memakai `shape-5` (kuning) dan `shape-6` (putih), bukan seluruh kanvas. Pengaturan preset, kemungkinan pekerjaan lain di kanvas, dan tindakan UI tidak terekam oleh pemantau.

| Ukuran dari dua bidang utama | Hasil |
|---|---:|
| Segmen Bézier kubik kuning / putih | 4 / 6 |
| Luas kuning / putih dalam koordinat lokal | 62.001,862 / 62.607,138 px² |
| Jumlah luas kedua bidang | 124.609 px² = 353² |
| Selisih luas kuning terhadap 62.128 piksel raster | −126,138 px² (≈−0,203%) |
| Deviasi batas panjang dari `x+y=352` | +0,136 hingga +0,167 px lokal |
| Warna kuning hasil / input | `#fcc101` / `#ffc107` |

Kedua path utama menggunakan koordinat yang sama pada batas diagonal dengan arah berlawanan; jumlah luasnya tepat sama dengan luas fixture. Ini menunjukkan bahwa *dua path pada SVG itu* berbagi batas tanpa celah geometris dalam koordinat lokal. Warna kuning pada berkas bergeser sedikit: kanal RGB `(252,193,1)` dibanding input `(255,193,7)`. Luas berbeda sedikit dari hitungan piksel, tetapi asal proses pembuatnya belum diketahui. Perhitungan tersimpan di [JSON pembandingan](phase8/diagonal-yellow-white-353-vm-comparison.json) dan bisa diulang dengan [skrip pembandingan](scripts/compare_diagonal_svg.py). [Inspeksi struktur SVG](phase8/diagonal-yellow-white-353-vm-inspection.json) dibuat oleh [skrip inspeksi](scripts/inspect_vector_magic_svg.py).

Uji SVG ini **belum memvalidasi keluaran Vector Magic** dan belum mengungkap ambang keputusan merge/swap atau kesetaraan implementasi Tauri. [Pemantauan call stack berikutnya](phase8/runtime-sampling-findings.md) berhasil membuktikan eksekusi tahap segmentasi, smoothing, dan fitting Bézier tanpa ekspor, tetapi belum menunjukkan nilai biaya dan ambangnya. Percobaan otomasi jendela melalui `System Events` ditolak macOS dengan `osascript is not allowed assistive access (-25211)`; pemantauan call stack tidak memerlukan akses tersebut.
