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
