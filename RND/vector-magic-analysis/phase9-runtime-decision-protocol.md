# Tahap berikutnya: keputusan merge/swap saat runtime

[Sampel call stack 120 detik](phase8/vectorization-stack-sample-live.txt) membuktikan `BezierFitter::computeMergeMetric`, `computeSwapMetric`, dan `considerMergeAndSwap` dijalankan, tetapi sampel agregat tidak memuat angka biaya, ambang, atau keputusan tiap kandidat. [Analisis statis tahap 3](phase3-findings.md) sudah menunjukkan aturan `Δmerge < T` untuk merge dan `Δswap < 0` untuk swap. Target tahap ini adalah **mengukur nilai aktual** dan mencocokkannya dengan hasil keputusan pada satu gambar yang diketahui.

## Percobaan yang dapat ditinjau

1. Buka **satu** JPEG dari [`RND/aset_jpg`](../aset_jpg/), mulai dari diagonal 353×353 (`5a03e635edf18aeeea8d449da76ab4e0.jpg`), lalu catat preset/pengaturan yang tampak. Ulangi terpisah untuk lingkaran, segitiga, dan apel; jangan mencampur beberapa input dalam satu rekaman jika ingin atribusi per gambar.
2. Ambil sampel call stack singkat untuk mengonfirmasi jalur fitting muncul pada run itu. Catat waktu mulai dan selesai manual serta hash input.
3. Bila debugger macOS dapat attach tanpa mengganggu aplikasi, amati titik pembandingan pada `BezierFitter::considerMergeAndSwap`. Pada instruksi merge, `xmm0` memuat hasil `computeMergeMetric` dan `xmm1` memuat ambang aktif `T` dari `BezierFitter+0x70`; catat keduanya beserta alamat fragmen (`rbx`) dan hasil cabang. Pada dua pembandingan swap, bandingkan metric dengan nol. Batasi jumlah event agar breakpoint tidak menahan aplikasi terlalu lama, lalu detach.
4. Verifikasi setiap baris dengan aturan statis: merge diterima hanya jika metric finite dan `< T`; jika merge ditolak, swap -1 dicoba dahulu, lalu +1. Laporkan distribusi nilai menurut gambar/preset, bukan hanya satu contoh.

## Pemetaan alamat untuk proses yang tersampel

Sampel runtime menyebut load address `0x103ca2000`; Mach-O hasil analisis statis memakai basis `0x100000000`, sehingga slide sesi itu `0x3ca2000`. Alamat berikut **hanya valid untuk proses/sesi tersebut** dan perlu dihitung ulang setelah aplikasi diluncurkan kembali.

| Peristiwa | Alamat statis | Alamat runtime sesi sampel |
|---|---:|---:|
| Panggilan merge metric | `0x1000bbfd4` | `0x103d5dfd4` |
| Muat ambang dari `+0x70` | `0x1000bbfd9` | `0x103d5dfd9` |
| Bandingkan metric merge dengan ambang | `0x1000bbfdf` | `0x103d5dfdf` |
| Cabang terima/tolak merge | `0x1000bbfe3` | `0x103d5dfe3` |
| Bandingkan swap -1 dengan nol | `0x1000bc011` | `0x103d5e011` |
| Bandingkan swap +1 dengan nol | `0x1000bc056` | `0x103d5e056` |

Pemetaan cocok dengan frame runtime `BezierFitter::considerMergeAndSwap +25` pada `0x103d5dfd9` di sampel. Detail instruksi ada di [`BezierFitter-considerMergeAndSwap.asm.txt`](phase3/BezierFitter-considerMergeAndSwap.asm.txt). Sebelum mengamati register, validasi kembali disassembly dan PID proses aktif. Debugger dapat memperlambat atau menghentikan sementara UI; jika attach ditolak macOS, lanjutkan dengan sampel call stack per gambar dan pratinjau tanpa mencoba menembus pembatasan ekspor/lisensi.

## Hasil uji debugger dan jalur yang dipakai

Pada 2026-09-28, LLDB gagal attach ke proses Vector Magic (`pid 78389`) sebelum breakpoint dipasang. Log `debugserver` menunjukkan `task_for_pid(78389)` ditolak dengan `0x00000005 ((os/kern) failure)`. Aplikasi bertanda tangan dengan Hardened Runtime (`codesign` flags `0x10000(runtime)`). Penyebab kebijakan spesifik tidak dapat dipastikan hanya dari log ini, tetapi sesi tersebut tidak mengizinkan pembacaan register lewat debugger. Jangan mengubah signature aplikasi atau menonaktifkan perlindungan macOS untuk uji ini.

Alternatif yang sedang dijalankan adalah sampel call stack untuk **satu input per sesi** dan inspeksi pratinjau yang tersedia tanpa ekspor. Ini dapat menghubungkan jalur fungsi dengan input serta membandingkan hasil visual, tetapi tidak memberi nilai `xmm0`/`xmm1` atau ambang aktif. Jika akses debugger yang sah tersedia kelak, ulangi prosedur register di atas; sampai itu terjadi, laporkan nilai threshold runtime sebagai belum terukur.

## Hasil sesi JPEG diagonal

Pengguna diminta memproses hanya JPEG diagonal `RND/aset_jpg/5a03e635edf18aeeea8d449da76ab4e0.jpg` selama [rekaman call stack 120 detik](phase8/diagonal-jpeg-stack-sample.txt). Preset tidak diketahui. Sampel memuat `ClassifyImageThread`, `SegmentationThread`, `ContourSmoothingThread`, `BezierFittingThread`, dan `VectorRenderThread`. Dalam fitting, `BezierFitter::considerMergeAndSwap` memanggil `computeMergeMetric` dan `computeSwapMetric`. Ini memperkuat pemetaan jalur untuk sesi yang diarahkan pada satu input, tetapi sampel tidak menyimpan nama file yang dibuka; atribusi ke JPEG diagonal berasal dari instruksi dan laporan pengguna, bukan dari call stack itu sendiri.

Percobaan tangkapan layar menghasilkan desktop/Code tanpa jendela Vector Magic, sehingga gambar tersebut tidak dipakai untuk penilaian pratinjau. Tidak ada nilai metric atau threshold runtime yang diperoleh. Langkah berikut yang benar-benar menambah data adalah akses debugging yang diizinkan sistem, atau dokumentasi pratinjau/preset langsung dari aplikasi; mengulang `sample` yang sama tidak akan menghasilkan nilai register.
