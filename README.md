# Panz Dominion

Panz Dominion adalah game strategi wilayah berbasis browser. Kamu bisa memperluas wilayah, membangun pertahanan, mengatur hubungan diplomatik, dan berperang untuk menjadi kekuatan terbesar di peta.

Game ini bisa dimainkan sendiri melawan bot atau bersama pemain lain melalui multiplayer. Tidak perlu memasang aplikasi tambahan—cukup buka melalui browser.

**Dibuat oleh [panz-08](https://github.com/panz-08)**

## Tentang Game

Di Panz Dominion, setiap pemain mengendalikan sebuah negara dan berusaha memperluas wilayahnya. Mengirim pasukan bukan satu-satunya cara untuk menang: ekonomi, posisi ibu kota, kondisi moral, dan hubungan dengan negara lain juga punya pengaruh besar.

Kamu bisa memilih bermain agresif, membangun pertahanan, atau membuat aliansi dengan pemain lain. Keadaan permainan dapat berubah cukup cepat, terutama ketika wilayah yang jauh dari ibu kota mulai terputus.

## Fitur

- **Beberapa pilihan peta** — peta Dunia, Eropa, Timur Tengah, dan peta acak yang dibuat secara prosedural.
- **Pilihan negara** — gunakan berbagai negara dan kerajaan dengan posisi awal yang berbeda.
- **Single-player** — bermain melawan 1 sampai 15 bot dengan tingkat kesulitan Easy, Normal, atau Hard.
- **Multiplayer online** — bermain hingga 4 pemain manusia dengan dukungan bot melalui koneksi P2P (PeerJS/WebRTC).
- **Mode lokal** — menghubungkan dua tab browser dalam perangkat yang sama untuk mencoba multiplayer.
- **Diplomasi** — menyatakan perang, menawarkan damai, membuat pakta non-agresi, membentuk aliansi, atau menjadikan negara lain sebagai vassal.
- **Ekonomi dan moral** — wilayah yang terhubung ke ibu kota menghasilkan pendapatan. Kehilangan wilayah dan jatuhnya ibu kota dapat memengaruhi moral negara.
- **Revolusi** — wilayah yang terlalu lama terputus dapat memisahkan diri dan membentuk negara baru.
- **Benteng dan kemampuan khusus** — bangun benteng, kirim kapal, gunakan Blitz, dan aktifkan Shield.
- **Kontrol desktop dan mobile** — mendukung mouse, keyboard, layar sentuh, zoom, dan minimap.

## Cara Bermain

Tujuan utamanya adalah memperluas wilayah dan mengalahkan atau mengungguli negara lain. Namun, jangan asal menyerang. Perhatikan jumlah pasukan, kondisi wilayah, dan hubungan diplomatik sebelum mengambil keputusan.

Beberapa hal yang perlu diketahui:

- Untuk menyerang negara lain, kamu harus menyatakan perang terlebih dahulu. Wilayah netral bisa diserang tanpa deklarasi perang.
- Wilayah yang tidak terhubung dengan ibu kota tidak memberikan pendapatan normal dan lebih mudah direbut.
- Tambang membantu meningkatkan pendapatan, sedangkan hutan, gunung, dan benteng dapat membuat wilayah lebih sulit ditaklukkan.
- Negara yang mencapai 60% daratan akan memicu voting kemenangan. Jadi, menguasai sebagian besar peta belum tentu langsung mengakhiri permainan.
- Jika semua negara yang tersisa membentuk aliansi, permainan dapat berakhir dengan kemenangan bersama.

### Diplomasi

Tekan **T** untuk membuka menu diplomasi. Pilihan yang tersedia meliputi:

| Aksi | Keterangan |
| --- | --- |
| Declare War | Memulai perang dengan negara lain. |
| Offer Peace | Mengajukan gencatan senjata. |
| Non-Aggression Pact | Membuat pakta non-agresi untuk sementara waktu. |
| Alliance | Membentuk aliansi dan saling membantu ketika diserang. |
| Vassal | Menjadikan negara lain sebagai negara bawahan. |
| Surrender | Menyerah dan menjadi negara bawahan lawan saat perang. |

## Kontrol

| Tombol / Aksi | Fungsi |
| --- | --- |
| Klik wilayah | Menyerang atau memilih wilayah tujuan. |
| Shift / Serbu luas | Mengirim serangan dari seluruh perbatasan. |
| 1–9, 0 | Mengatur persentase pasukan yang dikirim. |
| X | Menarik mundur seluruh serangan. |
| B | Membangun benteng. |
| V | Mengirim kapal menuju pantai lain. |
| Q | Mengaktifkan Blitz. |
| E | Mengaktifkan Shield. |
| T | Membuka diplomasi. |
| F | Memusatkan tampilan ke ibu kota. |
| WASD / tombol panah | Menggeser peta. |
| Roda mouse / pinch | Mengatur zoom. |
| Spasi | Jeda permainan (single-player). |
| M | Mengaktifkan atau mematikan suara. |
| Esc | Membuka menu. |

Di perangkat mobile, gunakan satu jari untuk menggeser peta, dua jari untuk zoom, dan ketuk wilayah untuk berinteraksi.

## Menjalankan di Komputer

### Persyaratan

- Node.js **22.18 atau lebih baru**.
- npm (sudah termasuk dalam instalasi Node.js).
- Browser modern yang mendukung JavaScript ES Modules dan Canvas.

### Instalasi

Clone repository ini, lalu masuk ke folder proyek:

```bash
git clone https://github.com/USERNAME/REPOSITORY.git
cd REPOSITORY
```

Pasang dependensi:

```bash
npm install
```

Jalankan mode pengembangan:

```bash
npm run dev
```

Buka alamat berikut di browser:

```text
http://localhost:5173
```

Server pengembangan akan membangun ulang proyek ketika ada perubahan pada source code.

### Build untuk Produksi

Untuk membuat versi siap deploy:

```bash
npm run build
```

Hasil build akan disimpan di folder `docs/`. Untuk menjalankannya secara lokal:

```bash
npm start
```

Kemudian buka `http://localhost:5173`.

> Jangan membuka `index.html` langsung melalui `file://`. Game menggunakan JavaScript ES Modules, sehingga perlu dijalankan melalui web server.

## Multiplayer

### Mode Lokal

Mode ini cocok untuk mencoba multiplayer menggunakan dua tab browser pada perangkat yang sama.

1. Jalankan `npm run dev`.
2. Buka `http://localhost:5173` di dua tab browser.
3. Di tab pertama, pilih **Multiplayer → Lokal (tes) → Buat ruang**.
4. Catat kode ruang yang muncul.
5. Di tab kedua, pilih menu multiplayer lokal, masukkan kode tersebut, lalu gabung.
6. Atur permainan dari tab host dan mulai pertandingan.

Mode lokal menggunakan `BroadcastChannel`, jadi kedua tab harus berada di browser dan origin yang sama.

### Mode Online

1. Pilih menu **Multiplayer → Online**.
2. Buat ruang sebagai host.
3. Bagikan kode ruang kepada teman.
4. Pemain lain memasukkan kode tersebut untuk bergabung.
5. Host dapat mengatur permainan dan memulai pertandingan.

Multiplayer online menggunakan PeerJS/WebRTC. Koneksi internet diperlukan untuk proses signaling dan memuat library PeerJS. Setelah koneksi terbentuk, komunikasi permainan dilakukan langsung antarpemain.

Perlu diketahui bahwa koneksi P2P bisa gagal pada jaringan tertentu, misalnya jaringan kantor atau NAT yang ketat. Proyek ini tidak menyediakan server TURN sendiri.

## Menjalankan Tes

Beberapa perintah yang tersedia untuk pengembangan:

```bash
npm run typecheck
npm test
npm run balance
```

Kegunaannya:

- `npm run typecheck` — memeriksa tipe TypeScript.
- `npm test` — menjalankan pengujian simulasi, diplomasi, peta, dan jaringan.
- `npm run balance` — menjalankan simulasi bot vs bot untuk membantu memeriksa keseimbangan permainan.

## Deployment

### GitHub Pages

Repository ini sudah menyertakan hasil build di folder `docs/`, sehingga kamu bisa menggunakan folder tersebut sebagai sumber GitHub Pages.

1. Push repository ke GitHub.
2. Buka **Settings → Pages**.
3. Pada bagian Build and deployment, pilih **Deploy from a branch**.
4. Pilih branch `main` dan folder `/docs`.
5. Simpan pengaturan dan tunggu proses publikasi selesai.

Website nantinya tersedia di alamat:

```text
https://USERNAME.github.io/REPOSITORY/
```

Ganti `USERNAME` dan `REPOSITORY` dengan username serta nama repository GitHub milikmu.

Setiap kali mengubah kode di folder `src/` atau `public/`, jalankan `npm run build` dan commit hasil terbaru dari folder `docs/`.

**Alternatif:** workflow GitHub Actions tersedia di `.github/workflows/pages.yml`. Workflow ini menjalankan typecheck, test, build, lalu memublikasikan folder `docs/`. Jika menggunakan cara ini, ubah sumber GitHub Pages menjadi **GitHub Actions**, bukan Deploy from a branch.

### Vercel

File `vercel.json` sudah disediakan untuk build proyek dengan `npm run build` dan menggunakan `docs` sebagai output. Import repository ke Vercel untuk memulai deployment.

## Struktur Proyek

```text
.
├── .github/workflows/  # Workflow deployment GitHub Pages
├── docs/               # Hasil build untuk deployment
├── public/             # HTML, CSS, ikon, dan aset statis
├── scripts/            # Script build, dev server, dan utilitas
├── src/
│   ├── core/           # Simulasi, bot, peta, RNG, dan tipe data
│   ├── net/            # Transport dan pengelolaan multiplayer
│   ├── ui/             # Renderer Canvas dan audio
│   ├── game.ts         # Input dan pengelolaan permainan
│   └── main.ts         # Menu utama dan lobby
├── tests/              # Pengujian otomatis
├── package.json
└── tsconfig.json
```

## Teknologi

- **TypeScript** — logika dan simulasi permainan.
- **HTML, CSS, JavaScript ES Modules** — antarmuka browser.
- **Canvas 2D** — rendering peta dan elemen permainan.
- **PeerJS / WebRTC** — multiplayer online berbasis P2P.
- **BroadcastChannel** — komunikasi antartab untuk mode lokal.
- **Node.js** — development server, build, dan pengujian.

Tidak ada framework UI atau bundler besar. Build proyek ditangani oleh script yang tersedia di folder `scripts/`.

## Data Peta

Data peta bawaan berada di `src/core/maps/`. Jika ingin membuat ulang data peta dunia nyata, kamu bisa mengubah `scripts/genmaps_data.py` lalu menjalankan generator yang tersedia.

Contoh perintah preview:

```bash
python3 scripts/genmaps.py --preview /tmp/prev
```

Generator peta membutuhkan Python serta paket `numpy`, `matplotlib`, dan `pillow`. Data batas negara yang digunakan berasal dari [johan/world.geo.json](https://github.com/johan/world.geo.json) dan disertakan dalam repository beserta informasi lisensinya.

## Kontribusi

Ide, laporan bug, dan kontribusi kode sangat dipersilakan. Kalau menemukan masalah atau punya saran untuk fitur baru, silakan buka **Issue** atau ajukan **Pull Request**.

Sebelum mengirim perubahan, jalankan pemeriksaan berikut:

```bash
npm run typecheck
npm test
npm run build
```

## Lisensi

Proyek ini menggunakan lisensi [MIT](LICENSE). Kamu bebas menggunakan, mempelajari, dan memodifikasi kode sesuai ketentuan lisensi tersebut.

---

Dibuat dan dikembangkan oleh **panz-08**.
