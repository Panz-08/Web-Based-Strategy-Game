// Tipe & konstanta inti Panz Dominion. Dibuat oleh panz-08.
export const TPS = 10; // tick simulasi per detik
export const DT = 1 / TPS;
export const T_WATER = 0;
export const T_PLAIN = 1;
export const T_FOREST = 2;
export const T_MOUNTAIN = 3;
export const T_SHALLOW = 4; // selat dangkal: laut yang bisa dilalui pasukan (lebih mahal)
export const F_NONE = 0;
export const F_MINE = 1;
export const F_CAPITAL = 2;
export const F_FORT = 3;
// Bangunan ekonomi & militer (v2). Semua menempati satu sel seperti benteng.
export const F_CITY = 4;
export const F_FACTORY = 5;
export const F_PORT = 6;
export const F_SILO = 7;
export const F_SAM = 8;
export const BUILD_KINDS = ['city', 'factory', 'port', 'silo', 'sam'];
/** Biaya & efek bangunan. Biaya aktual = gold + per * jumlah bangunan sejenis. */
export const BUILD_DEFS = {
    city: {
        kind: 'city',
        label: 'Kota',
        short: 'Kota',
        desc: '+350 batas pasukan, +0,6 emas/dtk, dan pertahanan kota.',
        feat: F_CITY,
        gold: 55,
        per: 22,
        ticks: 40,
    },
    factory: {
        kind: 'factory',
        label: 'Pabrik',
        short: 'Pabrik',
        desc: '+1,1 emas/dtk. Tulang punggung ekonomi jangka panjang.',
        feat: F_FACTORY,
        gold: 75,
        per: 18,
        ticks: 45,
    },
    port: {
        kind: 'port',
        label: 'Pelabuhan',
        short: 'Pelabuhan',
        desc: '+1 kapal bersamaan, +8 jangkauan kapal, kerugian pelayaran lebih kecil.',
        feat: F_PORT,
        gold: 80,
        per: 20,
        ticks: 50,
    },
    silo: {
        kind: 'silo',
        label: 'Silo Rudal',
        short: 'Silo',
        desc: 'Membuka serangan nuklir. Setiap nuklir menghancurkan wilayah & meninggalkan radiasi.',
        feat: F_SILO,
        gold: 150,
        per: 45,
        ticks: 60,
    },
    sam: {
        kind: 'sam',
        label: 'SAM',
        short: 'SAM',
        desc: 'Menembak jatuh nuklir yang menuju radius 8 sel. Punya pendinginan 30 dtk.',
        feat: F_SAM,
        gold: 110,
        per: 25,
        ticks: 45,
    },
};
export const DOCTRINES = [
    { id: 'balanced', label: 'Seimbang', blurb: '+10% emas, +5% batas pasukan. Aman untuk semua situasi.' },
    { id: 'militarist', label: 'Militaris', blurb: 'Serangan 10% lebih murah, +5% batas pasukan, mulai dengan pasukan ekstra.' },
    { id: 'industrialist', label: 'Industrialis', blurb: '+25% emas, bangunan 15% lebih murah.' },
    { id: 'naval', label: 'Maritim', blurb: '+1 kapal, +8 jangkauan kapal, kerugian laut jauh lebih kecil.' },
    { id: 'diplomat', label: 'Diplomat', blurb: 'Moral pulih 50% lebih cepat, upeti negara boneka +15%.' },
    { id: 'populist', label: 'Populis', blurb: '+15% batas pasukan dan +5% pendapatan emas.' },
];
export const OFFER_KINDS = ['peace', 'nap', 'alliance', 'vassal'];
export const PALETTE = [
    { name: 'Netral', rgb: [0, 0, 0] },
    { name: 'Biru', rgb: [66, 135, 245] },
    { name: 'Merah', rgb: [232, 70, 70] },
    { name: 'Hijau', rgb: [74, 196, 98] },
    { name: 'Kuning', rgb: [240, 196, 48] },
    { name: 'Ungu', rgb: [168, 98, 232] },
    { name: 'Oranye', rgb: [244, 140, 44] },
    { name: 'Tosca', rgb: [36, 200, 200] },
    { name: 'Pink', rgb: [240, 100, 170] },
    // Warna tambahan untuk negara baru hasil revolusi
    { name: 'Limau', rgb: [170, 214, 60] },
    { name: 'Cokelat', rgb: [176, 118, 74] },
    { name: 'Nila', rgb: [96, 110, 230] },
    { name: 'Merah muda', rgb: [250, 150, 150] },
    { name: 'Zamrud', rgb: [40, 160, 120] },
    { name: 'Emas', rgb: [212, 170, 90] },
    { name: 'Lavender', rgb: [190, 160, 240] },
    { name: 'Langit', rgb: [110, 190, 250] },
    { name: 'Karang', rgb: [250, 110, 90] },
    { name: 'Zaitun', rgb: [140, 150, 60] },
    { name: 'Magenta', rgb: [210, 60, 150] },
    { name: 'Perak', rgb: [190, 196, 204] },
    { name: 'Marun', rgb: [160, 56, 70] },
    { name: 'Jingga tua', rgb: [210, 100, 30] },
    { name: 'Biru laut', rgb: [30, 120, 190] },
    { name: 'Hijau muda', rgb: [130, 230, 150] },
    { name: 'Teal gelap', rgb: [30, 140, 150] },
    { name: 'Ungu tua', rgb: [120, 70, 170] },
    { name: 'Kuning muda', rgb: [235, 225, 130] },
    { name: 'Biru muda', rgb: [150, 200, 235] },
    { name: 'Tembaga', rgb: [190, 100, 60] },
    { name: 'Hijau tua', rgb: [60, 130, 60] },
    { name: 'Fuchsia', rgb: [230, 90, 220] },
    { name: 'Abu hangat', rgb: [170, 160, 140] },
];
/** Batas total negara (pemain awal + negara hasil revolusi). */
export const MAX_NATIONS = PALETTE.length - 1;
export const REBEL_NAMES = [
    'Pajajaran',
    'Kediri',
    'Singasari',
    'Tidore',
    'Bone',
    'Pasai',
    'Banjar',
    'Kutai',
    'Galuh',
    'Medang',
    'Luwu',
    'Buton',
    'Minang',
    'Lombok',
    'Bima',
    'Sunda',
];
export const BOT_NAMES = [
    'Majapahit',
    'Ottoman',
    'Persia',
    'Prancis',
    'Mongol',
    'Romawi',
    'Sriwijaya',
    'Mughal',
    'Mataram',
    'Inggris',
    'Mali',
    'Inca',
    'Gowa',
    'Aztek',
    'Mesir',
    'Ming',
    'Habsburg',
    'Ternate',
    'Banten',
    'Demak',
];
export const MAP_SIZES = {
    small: { w: 80, h: 52, label: 'Kecil' },
    medium: { w: 120, h: 78, label: 'Sedang' },
    large: { w: 160, h: 104, label: 'Besar' },
};
