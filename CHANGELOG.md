# Changelog

## 2.0.0 — Ekonomi, Bangunan & Nuklir

### Baru

- **Ekonomi emas:** emas mengalir dari wilayah terhubung, tambang, dan bangunan. Emas dipakai untuk membangun serta meluncurkan nuklir.
- **Lima bangunan baru:** Kota, Pabrik, Pelabuhan, Silo Rudal, dan SAM.
  - Kota menambah batas pasukan dan emas.
  - Pabrik menambah pemasukan emas.
  - Pelabuhan menambah kapal, jangkauan, dan mengurangi kerugian pelayaran.
  - Silo membuka serangan nuklir.
  - SAM mencegat nuklir dalam radius tertentu.
- **Nuklir:** biaya emas, pendinginan, waktu terbang, radius ledakan, dan **radiasi** selama 90 detik yang memblokir serangan serta pendaratan.
- **Doktrin bangsa:** Seimbang, Militaris, Industrialis, Maritim, Diplomat, dan Populis.
- **AI ekonomi & nuklir:** bot membangun kota/pabrik/pelabuhan, memakai doktrin dari wataknya, dan meluncurkan nuklir secara strategis.
- **UI baru:** bar emas di HUD, panel bangun (tombol **G**), mode nuklir (tombol **N**), tooltip sel, pratinjau bangunan/ledakan, ikon bangunan di peta dan minimap.
- **Efek visual:** overlay radiasi, lintasan rudal, ledakan nuklir, dan pratinjau jangkauan.
- **Event multiplayer & feed:** bangunan selesai/direbut/dihancurkan, peluncuran nuklir, intersepsi SAM, radiasi, dan hadiah emas.

### Perubahan

- Snapshot/restore dan checksum mencakup bangunan, nuklir, radiasi, emas, serta statistik baru.
- Perintah jaringan baru divalidasi: `build`, `nuke`, dan `gift`.
- Hasil akhir menampilkan emas dan jumlah bangunan.
- Dokumentasi README dan panduan dalam game diperbarui untuk semua sistem baru.

### Catatan kompatibilitas

- Ambang dominasi tetap 60% agar perilaku voting dan pengujian lama tidak berubah.
- Mekanik benteng lama tetap tersedia di samping bangunan baru.
