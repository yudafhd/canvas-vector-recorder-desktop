# Changelog

## 1.1.9

- Tile Vectorizer yang memiliki stroke kini tergabung dengan urutan gambar yang konsisten.
- Batch event yang gagal dikirim dicoba ulang berurutan tanpa menggandakan gambar. Kegagalan permanen menampilkan pesan error.
- Perubahan dan salinan `Path2D` mempertahankan geometri yang sesuai pada setiap paint.
- `fillRect` dan `strokeRect` mempertahankan warna serta ketebalan stroke.
- Resize canvas menghapus path lama, termasuk ketika ukuran yang sama ditetapkan kembali.
- Penghapusan sebagian canvas melalui `clearRect` diterapkan pada ekspor SVG dan EPS, termasuk transformasi dan clip aktif.
- Identitas logo menggunakan recorder baru, dengan animasi loader saat aplikasi dibuka.
- Tampilan workspace dirapikan dan gap putih pada viewport target dihilangkan.

Validasi: 36 tes frontend, 38 tes Rust, build frontend dan backend, serta 30 pemeriksaan piksel SVG/EPS terhadap Canvas native di WebKit. Replay rekaman Vectorizer menghasilkan satu artwork dengan 59 bentuk dan 18 stroke tanpa error.
