# Tahap 7 — Keputusan lokal tracing pada diagonal dan junction

Analisis statis fungsi `BoundaryTracer::traceBoundary(int,int,int)` (`0x1000c02b0–0x1000c0cd0`) berhasil memulihkan **urutan empat arah, syarat kandidat, dan keputusan saat ada dua kandidat** pada slice macOS x86_64 Vector Magic 1.21. Ini menjawab bagian pilihan lokal yang terbuka di [tahap 5](phase5-findings.md) dan membantu menempatkan cleanup [tahap 6](phase6-findings.md) sesudah urutan node dibentuk. **Siklus tracing penuh, khususnya cabang nol kandidat dan seluruh penanganan hole, belum terbukti setara dengan perilaku aplikasi berjalan.**

## 1. Empat arah dan dua sisi setiap langkah

Konstruktor `BoundaryTracer` menulis tabel arah pada offset `+0x68` sampai `+0xa4` (`0x1000bf261–0x1000bf2a8`). Pembacaan data konstanta dan immediate memberi tabel berikut. Koordinat `p=(x,y)` adalah node pada kisi sudut piksel; `first` dan `second` adalah dua sel piksel di sisi lintasan. Di tepi gambar, label sel di luar dianggap `-1`.

| Indeks | Arah node berikut | `first` relatif ke `p` | `second` relatif ke `p` |
|---:|---|---|---|
| 0 | barat `(-1,0)` | `(-1,-1)` | `(-1,0)` |
| 1 | selatan `(0,1)` | `(-1,0)` | `(0,0)` |
| 2 | timur `(1,0)` | `(0,0)` | `(0,-1)` |
| 3 | utara `(0,-1)` | `(0,-1)` | `(-1,-1)` |

`second` untuk arah `d` sama dengan `first` arah `(d+1)&3`. Jadi `first` adalah sel region yang ditelusuri di sisi kanan arah perjalanan bila `y` bertambah ke bawah. Tabel ini dan 243 kasus label lokal diekstraksi/diperiksa di [referensi tahap 7](scripts/phase7_trace_reference.py), dengan [hasilnya](phase7/trace-reference.json).

## 2. Syarat kandidat dan urutan prioritas

Loop `0x1000c03ba–0x1000c059e` mencoba indeks 0,1,2,3 dalam urutan tabel. Untuk arah `d`, kandidat disimpan hanya jika:

```text
next = p + delta[d]
next masih pada kisi node gambar
id_node[next] >= 0
label[first(d)] == region_saat_ini
label[second(d)] != region_saat_ini
owner_region[next] != region_saat_ini
```

Bukti cek batas `next`: `0x1000c03c0–0x1000c03e9`; cek id node dan dua label sel: `0x1000c0544–0x1000c055a`; cek owner node berikut: `0x1000c0573–0x1000c057e`. Label `first`/`second` di luar gambar memakai sentinel `-1` (`0x1000c046a–0x1000c052f`). Kandidat menyimpan arah, koordinat node berikut, dan **label region di sisi `second`**. Loop menyimpan label sisi kedua itu ke daftar sejajar, lalu memproses daftar label tersebut secara terpisah (`0x1000c06b4–0x1000c06de`, `0x1000c0945–0x1000c0a4f`). Aturan lengkap pembentukan daftar tetangga setelah pengurutan belum direkonstruksi.

Untuk node biasa dengan satu kandidat, fungsi menulis `owner_region[p]=region_saat_ini` sebelum melangkah (`0x1000c05b0–0x1000c05da`). Pada node dengan sedikitnya dua kandidat, penulisan itu dilewati. Ini memungkinkan node junction diperiksa lebih dari satu lintasan region; artinya flag owner node tidak bisa diganti begitu saja dengan satu boolean global “sudah dikunjungi”.

## 3. Aturan saat dua kandidat bertemu

Fungsi menyimpan koordinat sel `first` dari langkah awal/biasa sebagai konteks. Saat jumlah kandidat ≥2 dan konteks valid, ia memeriksa kandidat menurut urutan. Bila `first` kandidat pertama sama dengan sel konteks, kandidat pertama dipilih; jika tidak, kandidat berikutnya diperiksa. Bila tidak ada kecocokan sebelum kandidat terakhir, **kandidat terakhir menjadi fallback** (`0x1000c0600–0x1000c0800`). Bila konteks belum valid (`-1`), kandidat pertama dipilih dan sel `first`-nya menjadi konteks (`0x1000c0607–0x1000c0619`, `0x1000c0670–0x1000c069f`). Untuk dua kandidat, pseudocode lokalnya:

```text
jika sel_konteks belum ada: pilih kandidat[0], simpan first[0]
lain jika first[0] == sel_konteks: pilih kandidat[0]
lain: pilih kandidat[1]
```

Pada kisi 2×2 dengan label `[[1,2],[2,1]]`, node pusat `(1,1)` memberi dua kandidat untuk label 1: **barat** (sel `first=(0,0)`) dan **timur** (sel `first=(1,1)`). Konteks sel kiri-atas memilih barat; konteks kanan-bawah memilih timur; konteks yang tidak cocok memilih timur. Ini adalah keputusan arah lokal yang diturunkan dari instruksi, bukan klaim bahwa dua piksel diagonal pasti disatukan atau dipisahkan pada output final. Kebijakan konektivitas region berasal dari tahap segmentasi yang belum selesai dianalisis.

Referensi Python memeriksa seluruh `3^4 = 81` kombinasi label untuk masing-masing tiga region pada node pusat (243 kasus), plus contoh diagonal, tepi gambar, owner node yang sudah terisi, dan region lain di junction (total 247 pemeriksaan). Dalam enumerasi itu kandidat per region paling banyak dua. Cabang binary tetap menyediakan slot sampai empat kandidat; untuk input label biasa, cabang tiga/empat tidak muncul pada enumerasi ini. Pengujian referensi menguji konsistensi aturan lokal, **bukan** membandingkan buffer dengan aplikasi Vector Magic.

## 4. Batas rekonstruksi siklus

Sesudah memilih arah, fungsi menambah node id ke daftar kontur dan label region sisi kedua ke daftar sejajar (`0x1000c033a–0x1000c0382`, `0x1000c06b4–0x1000c06de`). Ia memeriksa owner node berikut untuk memutus loop (`0x1000c06e2–0x1000c071a`), kemudian menulis daftar node serta elemen kontur ke record region (`0x1000c084a–0x1000c0978`). Daftar region tetangga diproses terpisah setelah itu (`0x1000c097a–0x1000c0a4f`).

Satu kasus tidak boleh disederhanakan: bila scan menemukan **nol kandidat**, alur `count<2` masih membaca slot kandidat indeks 0 yang tersisa pada stack (`0x1000c05b0–0x1000c05ef`). Simulasi awal yang menganggapnya selalu “tutup kontur” gagal pada kisi diagonal: slot tersebut bisa menunjuk cabang lain. Karena itu skrip tahap 7 sengaja berhenti pada *pemilihan lokal*, tidak menghasilkan klaim urutan siklus penuh. Penafsiran cabang nol kandidat, pemilihan seed, hubungan beberapa batas dalam satu region/hole, dan hasil final perlu penelusuran state lebih lanjut serta pembandingan runtime.

## 5. Implikasi untuk Tauri/Rust dan validasi berikutnya

Implementasi tracer perlu membawa `(node, region, sel_konteks)` dan `owner_region[node]` yang berisi ID region; pilihan arah tidak cukup ditentukan dari label empat piksel saja. Kasus uji berikutnya sebaiknya membandingkan trace node id dan label tetangga per langkah pada gambar sintetis kecil sebelum menjalankan pola cleanup tahap 6. Tanpa data tersebut, penerapan lokal tabel di atas sebagai tracer lengkap dapat mengubah topologi kontur.

Artefak bukti utama: [disassembly traceBoundary](phase5/BoundaryTracer-traceBoundary-1000c02b0.annotated.txt), [disassembly constructor](phase5/BoundaryTracer-BoundaryTracer-1000bf200.annotated.txt), [referensi lokal](scripts/phase7_trace_reference.py), dan [data hasil](phase7/trace-reference.json). Reproduksi: `python3 RND/vector-magic-analysis/scripts/phase7_trace_reference.py`. Skrip membaca binary hasil ekstraksi di `/private/tmp` secara default dan tidak menjalankan aplikasi target.

**Uji lanjutan:** [fixture diagonal kuning–putih](phase8-diagonal-findings.md) memeriksa keputusan lokal pada batas panjang dan tepi gambar. Perbandingan SVG dari aplikasi target belum tersedia.
