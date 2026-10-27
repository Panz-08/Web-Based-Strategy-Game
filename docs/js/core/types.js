// Tipe & konstanta inti Panz Dominion. Dibuat oleh panz-08.
export const TPS = 10; // tick simulasi per detik
export const DT = 1 / TPS;
export const T_WATER = 0;
export const T_PLAIN = 1;
export const T_FOREST = 2;
export const T_MOUNTAIN = 3;
export const F_NONE = 0;
export const F_MINE = 1;
export const F_CAPITAL = 2;
export const F_FORT = 3;
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
    'Sriwijaya',
    'Mataram',
    'Samudra',
    'Gowa',
    'Ternate',
    'Banten',
    'Demak',
];
export const MAP_SIZES = {
    small: { w: 80, h: 52, label: 'Kecil' },
    medium: { w: 120, h: 78, label: 'Sedang' },
    large: { w: 160, h: 104, label: 'Besar' },
};
