# Web-Based-Strategy-Game
IDK.

# Panz Dominion

Game strategi teritori 2D real-time di browser — terinspirasi game web bergenre "territorial", tetapi dengan mekanik sendiri: **diplomasi (perang, damai, pakta, aliansi, negara boneka, menyerah), moral, wilayah terputus & revolusi, garis depan ganda, benteng, tambang, Blitz, Perisai, dan voting kemenangan**.

Main **melawan bot** (3 tingkat kesulitan) atau **multiplayer PvP** (hingga 4 manusia + bot) tanpa server game sendiri.

> Dibuat oleh **panz-08**.

## Fitur

- **Peta dunia nyata**: *Dunia*, *Timur Tengah*, dan *Eropa* (batas negara, gunung, hutan, gurun, tambang/minyak, selat dangkal penghubung benua) + peta *Acak* prosedural. Nama negara modern tampil di peta.
- **Pilih negaramu**: ketuk titik di peta pratinjau atau daftar — Ottoman, Persia, Prancis, Mongol, Romawi, Majapahit, Mughal, Ming, Inca, Aztek, Mesir, dll. Bot memakai bangsa/kerajaan lain dengan watak berbeda (agresif, ekspansif, diplomat, seimbang).
- **Single player** vs 1–15 bot (Mudah / Normal / Sulit); ukuran/gaya/seed hanya untuk peta Acak.
- **Nyaman di HP**: panel ringkas (kartu pasukan, tombol Skor & ⋯, dock bawah yang bisa diciutkan, peta mini opsional), geser 1 jari, cubit 2 jari, ketuk untuk menyerang; mendukung potret & lanskap.
- **Multiplayer P2P** (WebRTC lewat PeerJS): host membuat ruang → bagikan kode 5 huruf → teman bergabung. Pemain yang keluar otomatis digantikan AI.
- **Mode Lokal (tes)**: dua tab di browser yang sama bisa saling main tanpa internet (BroadcastChannel).
- **Diplomasi lengkap** (tekan **T**): nyatakan perang, tawarkan damai, pakta non agresi, aliansi, negara boneka, atau menyerah — bot ikut berdiplomasi.
- **Revolusi**: wilayah yang terputus dari ibu kota memberontak menjadi negara baru.
- **Voting kemenangan** saat satu pihak menguasai 60% daratan.
- Peta prosedural deterministik, minimap, papan peringkat, efek suara sintetis, kontrol mouse/keyboard/sentuh.
- Tanpa dependensi runtime. Ditulis dengan **TypeScript** (ES modules native, tanpa bundler).

## Mekanik

| Mekanik | Cara kerja |
| --- | --- |
| Serangan | Klik wilayah netral/musuh. Persentase pasukan (slider / tombol 1–9, 0) dikirim dari perbatasan ke arah titik yang diklik. Klik musuh yang masih jauh → pasukan merambah lahan netral menuju ke sana. **Shift** / *Serbu luas* = serang seluruh perbatasan. |
| Garis depan | Maksimal 4 serangan sekaligus (satu per target). Sisa pasukan yang tak terpakai kembali ke kas. **X** menarik mundur semuanya. |
| Ekonomi | Pendapatan = sel terhubung × 0,1/dtk + tambang × 6/dtk + bunga kas. Kas dibatasi kapasitas yang tumbuh bersama wilayah. |
| Ibu kota | Wilayah yang terputus dari ibu kota **tidak menghasilkan**, tidak menambah kapasitas pasukan, dan jauh lebih mudah direbut (biaya ×0,35). Ibu kota jatuh → 30% pasukan dijarah, moral jatuh ke 20%, serangan yang berjalan kocar-kacir (−50% pasukan), pendapatan 35% selama 60 detik, ibu kota baru dipilih otomatis. |
| Perang | Menyerang negara lain **wajib menyatakan perang dulu**. Menyerang lahan netral tidak perlu. Sekutu & negara boneka pihak yang diserang otomatis ikut membela (gencatan/pakta yang berlaku tetap dihormati). |
| Damai | Tawarkan damai ke lawan → bila diterima, **gencatan senjata 60 dtk** (tak bisa menyatakan perang), serangan berhenti. |
| Pakta non agresi | 3 menit; tidak bisa menyatakan perang selama berlaku. Diakhiri sepihak dengan masa pemberitahuan 30 dtk. |
| Aliansi | Tidak bisa saling serang; ikut membela bila sekutu diserang. Diputus kapan saja (lalu gencatan 30 dtk). Bila **semua pihak tersisa bersekutu**, permainan berakhir dengan kemenangan bersama. |
| Negara boneka (vassal) | Ditawarkan (atau dipaksa saat perang). Boneka membayar **upeti 25% pendapatan**, ikut perang tuannya, tak bisa berdiplomasi/menyatakan perang sendiri, dan wilayahnya dihitung ke blok tuannya. Tuan bisa melepasnya; boneka bisa **merdeka** dengan menyatakan perang pada tuannya. |
| Menyerah | Saat berperang, kamu bisa menyerah: kamu menjadi boneka sang penakluk dan perang berakhir. |
| Moral | Turun tiap sel direbut (tambang & benteng lebih besar), pulih bila 10 dtk tenang. Moral rendah → pendapatan turun hingga 60% dan wilayah makin murah direbut. |
| Revolusi | Blok wilayah terputus ≥10 sel dan ≥30 dtk terputus bisa **memberontak jadi negara baru** (kendali AI, perang dengan induk, mengambil sebagian pasukan; induk kehilangan moral). Blok kecil yang terputus >40 dtk ditinggalkan jadi netral. Maks. 24 negara. |
| Biaya rebut | Naik bila musuh padat pasukan (kepadatan = pasukan/sel), di hutan (×1,5), gunung (×3), dekat benteng, atau saat Perisai aktif. Makin luas wilayahmu, makin mahal ekspansi. |
| Benteng **(B)** | Pertahanan ×1,8 dalam radius 4 sel (×3 pada selnya). Maks. 4. |
| Blitz **(Q)** | 6 dtk: serangan 2× cepat & 30% lebih hemat. Cooldown 40 dtk. |
| Perisai **(E)** | 7 dtk: seluruh wilayahmu 1,8× lebih sulit direbut. Cooldown 50 dtk. |
| Menang | Pihak (beserta bonekanya) yang mencapai **60% daratan** memicu **voting**, bukan menang otomatis. Hanya **pemain manusia** yang memilih: pemimpin memilih *Menang sekarang* / *Lanjut*; pemain lain memilih *Menyerah (biarkan menang)* / *Lanjut*. Permainan berakhir bila pemimpin (jika manusia) memilih menang **dan** mayoritas manusia lain memilih menyerah; yang tak memilih dalam 30 dtk dianggap lanjut. Bila hanya ada satu manusia, dialah yang memutuskan (bot tidak memilih). Setelah *Lanjut*, voting dibuka lagi 90 dtk kemudian bila masih ≥60%. Tanpa manusia (bot vs bot): menang otomatis setelah bertahan 20 dtk. Penguasa terakhir juga menang; batas 20 menit → wilayah terluas menang. |

Kontrol lain: geser peta (seret / WASD / panah), zoom (roda / cubit), **T** diplomasi, **F** ke ibu kota, **Spasi** jeda (single player), **M** bisukan, **Esc** menu.

Nah gitu aja
