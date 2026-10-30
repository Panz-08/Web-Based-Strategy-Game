Udah gitu aja

# Panz Dominion

Game strategi wilayah 2D real-time yang bisa dimainkan langsung lewat browser. Bangun kekuatan, perluas wilayah, atur diplomasi, dan hadapi negara lain dalam pertandingan melawan bot atau pemain lain.

**Repository:** https://github.com/Panz-08/Web-Based-Strategy-Game  
**Live demo:** https://panz-08.github.io/Web-Based-Strategy-Game/

## Tentang Game

Di Panz Dominion, kamu mengendalikan sebuah negara dan bersaing untuk menguasai wilayah sebanyak mungkin. Menyerang memang penting, tetapi bukan satu-satunya hal yang menentukan hasil permainan. Ekonomi, moral, posisi ibu kota, kondisi perbatasan, dan hubungan diplomatik juga perlu diperhatikan.

Kamu bisa bermain sendiri melawan bot dengan beberapa tingkat kesulitan atau membuat ruang multiplayer untuk bermain bersama teman. Tidak perlu menginstal aplikasi game tambahan karena Panz Dominion berjalan di browser.

## Fitur

- **Pilihan peta:** Dunia, Eropa, Timur Tengah, dan peta Acak yang dibuat secara prosedural.
- **Pilihan negara:** pilih berbagai negara dan kerajaan dengan posisi awal yang berbeda.
- **Single-player:** bermain melawan 1–15 bot dengan tingkat kesulitan Mudah, Normal, atau Sulit.
- **Multiplayer online:** bermain hingga 4 pemain manusia, dengan dukungan bot. Koneksi menggunakan PeerJS/WebRTC (P2P).
- **Multiplayer lokal:** menghubungkan dua tab browser pada perangkat yang sama melalui BroadcastChannel.
- **Diplomasi:** deklarasi perang, tawaran damai, pakta non-agresi, aliansi, negara boneka, dan menyerah.
- **Ekonomi dan moral:** wilayah yang terhubung ke ibu kota menghasilkan pendapatan. Kehilangan wilayah dan jatuhnya ibu kota dapat memengaruhi moral.
- **Revolusi:** wilayah yang terlalu lama terputus dari ibu kota dapat memberontak dan membentuk negara baru.
- **Pertahanan dan kemampuan khusus:** bangun benteng, kirim kapal, gunakan Blitz, dan aktifkan Perisai.
- **Kontrol desktop dan mobile:** mendukung mouse, keyboard, layar sentuh, zoom, dan minimap.

## Cara Bermain

Tujuan permainan adalah memperluas wilayah dan mengalahkan atau mengungguli negara lain. Sebelum menyerang, perhatikan jumlah pasukan, kondisi wilayah, dan hubungan diplomatik.

Beberapa mekanik yang perlu diketahui:

- Serangan terhadap negara lain membutuhkan deklarasi perang terlebih dahulu. Wilayah netral bisa diserang tanpa deklarasi perang.
- Wilayah yang terputus dari ibu kota tidak menghasilkan pendapatan normal dan lebih mudah direbut.
- Tambang meningkatkan pendapatan, sementara hutan, gunung, dan benteng dapat membuat wilayah lebih sulit ditaklukkan.
- Negara atau blok aliansi yang mencapai 60% daratan akan memicu voting kemenangan. Kemenangan tidak otomatis terjadi hanya karena batas tersebut tercapai.
- Jika semua negara yang tersisa membentuk aliansi, permainan dapat berakhir dengan kemenangan bersama.

### Diplomasi

Tekan **T** untuk membuka menu diplomasi.

| Aksi | Keterangan |
| --- | --- |
| Declare War | Menyatakan perang kepada negara lain. |
| Offer Peace | Mengajukan gencatan senjata. |
| Non-Aggression Pact | Membuat pakta non-agresi untuk sementara waktu. |
| Alliance | Membentuk aliansi dan saling membantu ketika diserang. |
| Vassal | Menjadikan negara lain sebagai negara bawahan. |
| Surrender | Menyerah dan menjadi negara bawahan lawan saat perang. |

## Kontrol

| Tombol / Aksi | Fungsi |
| --- | --- |
| Klik wilayah | Memilih atau menyerang wilayah tujuan. |
| Shift / Serbu luas | Mengirim serangan dari seluruh perbatasan. |
| 1–9, 0 | Mengatur persentase pasukan yang dikirim. |
| X | Menarik mundur seluruh serangan. |
| B | Membangun benteng. |
| V | Mengirim kapal menuju pantai lain. |
| Q | Mengaktifkan Blitz. |
| E | Mengaktifkan Perisai. |
| T | Membuka menu diplomasi. |
| F | Memusatkan tampilan ke ibu kota. |
| WASD / tombol panah | Menggeser peta. |
| Roda mouse / pinch | Mengatur zoom. |
| Spasi | Menjeda permainan (single-player). |
| M | Mengaktifkan atau mematikan suara. |
| Esc | Membuka menu. |

Di perangkat mobile, gunakan satu jari untuk menggeser peta, dua jari untuk zoom, dan ketuk wilayah untuk berinteraksi. Tampilan mendukung orientasi potret maupun lanskap.

## Menjalankan di Komputer

### Persyaratan

- [Node.js](https://nodejs.org/) versi **22.18 atau lebih baru**.
- npm (sudah termasuk dalam instalasi Node.js).
- Browser modern yang mendukung JavaScript ES Modules dan Canvas 2D.

### Instalasi

Clone repository ini, lalu masuk ke folder proyek:

```bash
git clone https://github.com/Panz-08/Web-Based-Strategy-Game.git
cd Web-Based-Strategy-Game
```

Pasang dependensi:

```bash
npm install
```

Jalankan server pengembangan:

```bash
npm run dev
```

Buka alamat berikut di browser:

```text
http://localhost:5173
```

Server pengembangan akan membangun ulang proyek saat ada perubahan pada source code.

### Build untuk Produksi

Untuk membuat versi siap deploy:

```bash
npm run build
```

Hasil build akan disimpan di folder `docs/`. Untuk menjalankan hasil build secara lokal:

```bash
npm start
```

Lalu buka `http://localhost:5173`.

> Jangan membuka `index.html` langsung melalui `file://`. Game menggunakan JavaScript ES Modules, jadi harus dijalankan melalui web server.

## Multiplayer

### Mode Lokal

Mode ini digunakan untuk mencoba multiplayer melalui dua tab browser pada perangkat yang sama.

1. Jalankan `npm run dev`.
2. Buka `http://localhost:5173` di dua tab browser.
3. Di tab pertama, pilih **Multiplayer → Lokal (tes) → Buat ruang**.
4. Catat kode ruang yang muncul.
5. Di tab kedua, buka menu multiplayer lokal, masukkan kode ruang, lalu gabung.
6. Host dapat mengatur permainan dan memulai pertandingan.

Mode lokal menggunakan `BroadcastChannel`, sehingga kedua tab harus memakai browser dan origin yang sama.

### Mode Online

1. Pilih **Multiplayer → Online**.
2. Buat ruang sebagai host.
3. Bagikan kode ruang kepada teman.
4. Pemain lain memasukkan kode tersebut untuk bergabung.
5. Host mengatur permainan dan memulai pertandingan.

Multiplayer online menggunakan PeerJS/WebRTC. Koneksi internet diperlukan untuk proses signaling dan memuat library PeerJS. Setelah koneksi terbentuk, komunikasi permainan berlangsung langsung antarpemain (P2P).

> Koneksi P2P mungkin gagal pada jaringan tertentu, misalnya jaringan kantor atau jaringan dengan pembatasan NAT yang ketat. Repository ini tidak menyediakan server TURN sendiri.

## Pengujian

Beberapa perintah yang tersedia:

```bash
npm run typecheck
npm test
npm run balance
```

- `npm run typecheck` memeriksa tipe TypeScript.
- `npm test` menjalankan pengujian simulasi, diplomasi, peta, dan jaringan.
- `npm run balance` menjalankan simulasi bot vs bot untuk membantu memeriksa keseimbangan permainan.

## Deployment

### GitHub Pages

Repository ini sudah menyertakan workflow GitHub Actions di `.github/workflows/pages.yml`. Workflow tersebut menjalankan instalasi dependensi, pemeriksaan TypeScript, pengujian, build, lalu menerbitkan folder `docs/` ke GitHub Pages.

Untuk mengaktifkannya:

1. Buka repository [Panz-08/Web-Based-Strategy-Game](https://github.com/Panz-08/Web-Based-Strategy-Game).
2. Masuk ke **Settings → Pages**.
3. Pada bagian **Build and deployment**, pilih **GitHub Actions** sebagai Source.
4. Pastikan perubahan sudah di-push ke branch `main`.
5. Buka tab **Actions** untuk melihat proses deployment.

Jika proses berhasil, game akan tersedia di:

**https://panz-08.github.io/Web-Based-Strategy-Game/**

Setiap push ke branch `main` akan menjalankan workflow deployment. Kamu juga bisa menjalankannya secara manual melalui **Actions → Deploy ke GitHub Pages → Run workflow**.

> Workflow yang disediakan menggunakan GitHub Actions. Jadi, pilih **GitHub Actions** pada pengaturan Pages, bukan **Deploy from a branch**.

### Vercel

Repository juga menyertakan `vercel.json`. Import repository ini ke Vercel; konfigurasi build sudah diarahkan ke `npm run build` dengan folder output `docs`.

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

- **TypeScript** untuk logika dan simulasi permainan.
- **HTML, CSS, dan JavaScript ES Modules** untuk antarmuka browser.
- **Canvas 2D** untuk rendering peta dan elemen permainan.
- **PeerJS / WebRTC** untuk multiplayer online berbasis P2P.
- **BroadcastChannel** untuk komunikasi antartab pada mode lokal.
- **Node.js** untuk development server, build, dan pengujian.

Proyek ini tidak menggunakan framework UI atau bundler besar. Proses build ditangani oleh script yang tersedia di folder `scripts/`.

## Data Peta

Data peta bawaan tersedia di `src/core/maps/`. Jika ingin membuat ulang data peta dunia nyata, ubah `scripts/genmaps_data.py`, lalu jalankan generator yang tersedia.

Contoh perintah preview:

```bash
python3 scripts/genmaps.py --preview /tmp/prev
```

Generator peta membutuhkan Python serta pustaka `numpy`, `matplotlib`, dan `pillow`.

## Kontribusi

Punya ide fitur, menemukan bug, atau ingin mengusulkan perubahan? Silakan buat [Issue](https://github.com/Panz-08/Web-Based-Strategy-Game/issues) atau ajukan Pull Request melalui repository ini.

Sebelum mengirim perubahan, jalankan pemeriksaan berikut:

```bash
npm run typecheck
npm test
```

## Lisensi

Proyek ini menggunakan lisensi MIT. Lihat file [LICENSE](LICENSE) untuk informasi selengkapnya.

---

Dibuat oleh [panz-08](https://github.com/Panz-08).
