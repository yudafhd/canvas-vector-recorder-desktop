# Diagnosis SVG aktual dari UI

File yang diberikan pengguna dibaca dari path Downloads yang disebut eksplisit, lalu disalin ke `ui.svg` untuk reproduksi. SHA-256 `52aacd48b28f0650a81f147a967cf717855a4868b1a11bb8a54dc8cbeca42465`. Dokumen 4000×4000, viewBox 1024×1024, 57 path, 36 perintah L dan 1805 C (1841 segmen). Ini cocok dengan jumlah segmen screenshot. Dengan demikian gelombang memang tersimpan di geometri, bukan hanya masalah tampilan.

## Bukti lokal

Pengukuran pada batas merah celah lidah, y=530…590 dalam viewBox: residual horizontal terhadap garis regresi RMS kiri 0,26304 px, kanan 0,29038 px; deviasi maksimum kiri 0,47016 px, kanan 0,48965 px. Script `measure-lines.py` membaca SVG aktual dan menyimpan sampel serta angka ke `line-metrics.json`.

Detektor lama membatasi jarak ke chord min(0,35; tolerance/2). Pada Detail tinggi (tolerance 0,35), batasnya 0,175 px. Sampel UI tidak lolos baik pada detail tinggi maupun seimbang. Deviasi maksimum ke chord endpoint sampel mencapai sekitar 0,565/0,604 px; nilai ini berbeda dari residual garis regresi karena garis regresi tidak dikunci di endpoint.

## Perbaikan yang diterapkan

Deteksi kandidat panjang ≥48 px kini memakai batas chord 0,65 px. Bila melampaui batas lama, kandidat wajib menunjukkan noise berosilasi: setelah regresi normal terhadap arah ruas, RMS ≤0,32 px dan sedikitnya tiga pergantian tanda residual, mengabaikan residual ≤0,05 px. Ruas tetap harus monotone dan tidak melintasi sudut terlindungi. Lengkungan dangkal yang konsisten tidak mendapat kelonggaran tersebut. Endpoint tidak digeser.

Semua batas dan uji tersebut adalah adaptasi aplikasi, bukan mekanisme yang terverifikasi dari binary Vector Magic. Belum merupakan pembuktian untuk semua bentuk: pola hias berulang sangat kecil juga bisa dianggap noise. Detail pengenalan tetap dibatasi resolusi proses.

Tes memakai sampel SVG UI yang sama di `tests/fixtures/barong-ui-lines.json`: kedua sisi dikenali pada tolerance 0,35 dan 0,8, sedangkan busur dangkal yang koheren ditolak. Tes geometri existing mencakup sudut, pembalikan arah, garis pendek dan kontinuitas kurva.

## Batas kesimpulan

Fixture adalah geometri hasil ekspor, **bukan kontur sebelum fitting atau piksel Canvas UI**. Tes ini membuktikan perbaikan detektor pada geometri masalah yang diberikan, belum membuktikan keluaran pipeline Tauri setelah tracing ulang. Tidak menyimpulkan versi aplikasi lama, tidak mengklaim resize sudah disamakan dengan sips, dan tidak memakai `after.png` offline sebagai bukti UI sudah selesai diperbaiki. Hasil SVG baru dari UI perlu dibandingkan dengan `ui.svg` ini.

Reproduksi pengukuran: `python3 RND/tracing-quality/barong-ui-v11/measure-lines.py`. Validasi kode: TypeScript compile, seluruh tes frontend dan build produksi.
