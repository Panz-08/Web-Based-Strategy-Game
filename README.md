# Web-Based-Strategy-Game
IDK.

# Panz Dominion

Game strategi teritori 2D real-time di browser — terinspirasi game web bergenre "territorial", tetapi dengan mekanik sendiri: **ibu kota & wilayah terputus, garis depan ganda, benteng, tambang, Blitz, dan Perisai**.

Main **melawan bot** (3 tingkat kesulitan) atau **multiplayer PvP** (hingga 4 manusia + bot) tanpa server game sendiri.

> Dibuat oleh **panz-08**.

## Fitur

- **Single player** vs 1–7 bot (Mudah / Normal / Sulit), 3 ukuran peta, 3 gaya peta, seed bisa diatur.
- **Multiplayer P2P** (WebRTC lewat PeerJS): host membuat ruang → bagikan kode 5 huruf → teman bergabung. Pemain yang keluar otomatis digantikan AI.
- **Mode Lokal (tes)**: dua tab di browser yang sama bisa saling main tanpa internet (BroadcastChannel).
- Peta prosedural deterministik, minimap, papan peringkat, efek suara sintetis, kontrol mouse/keyboard/sentuh.
- Tanpa dependensi runtime. Ditulis dengan **TypeScript** (ES modules native, tanpa bundler).

## Mekanik

| Mekanik | Cara kerja |
| --- | --- |
| Serangan | Klik wilayah netral/musuh. Persentase pasukan (slider / tombol 1–9, 0) dikirim dari perbatasan ke arah titik yang diklik. Klik musuh yang masih jauh → pasukan merambah lahan netral menuju ke sana. **Shift** / *Serbu luas* = serang seluruh perbatasan. |
| Garis depan | Maksimal 4 serangan sekaligus (satu per target). Sisa pasukan yang tak terpakai kembali ke kas. **X** menarik mundur semuanya. |
| Ekonomi | Pendapatan = sel terhubung × 0,1/dtk + tambang × 6/dtk + bunga kas. Kas dibatasi kapasitas yang tumbuh bersama wilayah. |
| Ibu kota | Wilayah yang terputus dari ibu kota **tidak menghasilkan** dan lebih mudah direbut. Ibu kota jatuh → 25% pasukan dijarah, pendapatan separuh selama 30 detik, ibu kota baru dipilih otomatis. |
| Biaya rebut | Naik bila musuh padat pasukan (kepadatan = pasukan/sel), di hutan (×1,5), gunung (×3), dekat benteng, atau saat Perisai aktif. Makin luas wilayahmu, makin mahal ekspansi. |
| Benteng **(B)** | Pertahanan ×1,8 dalam radius 4 sel (×3 pada selnya). Maks. 4. |
| Blitz **(Q)** | 6 dtk: serangan 2× cepat & 30% lebih hemat. Cooldown 40 dtk. |
| Perisai **(E)** | 7 dtk: seluruh wilayahmu 1,8× lebih sulit direbut. Cooldown 50 dtk. |
| Menang | >60% daratan selama 20 dtk, atau penguasa terakhir. Batas waktu 20 menit → wilayah terluas menang. |

Kontrol lain: geser peta (seret / WASD / panah), zoom (roda / cubit), **F** ke ibu kota, **Spasi** jeda (single player), **M** bisukan, **Esc** menu.
