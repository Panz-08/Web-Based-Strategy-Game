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

export type MapStyle = 'continent' | 'highland' | 'open';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface MatchSetup {
  seed: number;
  width: number;
  height: number;
  style: MapStyle;
  players: PlayerSetup[];
}

export interface PlayerSetup {
  id: number; // 1..N
  name: string;
  kind: 'human' | 'bot';
  difficulty?: Difficulty;
}

export type Command =
  | { t: 'atk'; p: number; idx: number; pct: number; wide: boolean }
  | { t: 'fort'; p: number; idx: number }
  | { t: 'blitz'; p: number }
  | { t: 'shield'; p: number }
  | { t: 'retreat'; p: number }
  | { t: 'war'; p: number; target: number }
  | { t: 'offer'; p: number; target: number; kind: OfferKind }
  | { t: 'reply'; p: number; id: number; accept: boolean }
  | { t: 'surrender'; p: number; target: number }
  | { t: 'break'; p: number; target: number }
  | { t: 'vote'; p: number; end: boolean };

/** Voting saat ada pihak mencapai 60% daratan. Hanya pemain manusia yang memilih. */
export interface Vote {
  leader: number; // id pemimpin (tuan blok) yang mencapai ambang
  endsAt: number; // tick batas waktu; yang belum memilih dianggap 'lanjut'
  ballots: Record<number, boolean>; // id manusia -> true = akhiri (menang/menyerah), false = lanjut
}

// ---- Diplomasi
export type RelKind = 'peace' | 'war' | 'truce' | 'nap' | 'alliance' | 'vassal';
export type OfferKind = 'peace' | 'nap' | 'alliance' | 'vassal';
export const OFFER_KINDS: OfferKind[] = ['peace', 'nap', 'alliance', 'vassal'];

/** Hubungan dua negara (a < b). Pasangan tanpa entri = netral/damai (peace). */
export interface Relation {
  a: number;
  b: number;
  kind: RelKind;
  since: number;
  until: number; // 0 = tanpa batas
  lord: number; // hanya untuk 'vassal': id sang tuan
}

export interface Offer {
  id: number;
  from: number;
  to: number;
  kind: OfferKind; // 'vassal' = from menjadikan to sebagai negara boneka
  expires: number;
}

export interface Player {
  id: number;
  name: string;
  kind: 'human' | 'bot';
  difficulty: Difficulty;
  alive: boolean;
  troops: number;
  cells: number;
  linkedCells: number; // sel yang terhubung ke ibu kota
  linkedMines: number;
  mines: number;
  capital: number; // indeks sel, -1 jika runtuh
  shakenUntil: number;
  blitzUntil: number;
  shieldUntil: number;
  blitzReady: number;
  shieldReady: number;
  income: number; // per detik (cache untuk HUD)
  cap: number;
  peakCells: number;
  diedAt: number;
  morale: number; // 0.15..1 — turun saat wilayah direbut, memengaruhi pendapatan & pertahanan
  lossAt: number; // tick terakhir kehilangan wilayah
  lord: number; // id tuan bila negara boneka, 0 = merdeka
}

export interface Offensive {
  id: number;
  owner: number;
  target: number; // 0 = netral
  focus: number; // indeks sel fokus
  wide: boolean;
  pool: number;
  startPool: number;
  gained: number;
}

export interface Fort {
  idx: number;
  owner: number;
  readyAt: number;
}

export type GameEvent =
  | { k: 'capital'; victim: number; by: number; idx: number }
  | { k: 'fort-lost'; victim: number; by: number; idx: number }
  | { k: 'dead'; victim: number; by: number }
  | { k: 'win'; winner: number; reason: 'dominance' | 'last' | 'time' | 'bloc' }
  | { k: 'war'; by: number; target: number; why: 'declare' | 'join' | 'independence' }
  | { k: 'peace'; a: number; b: number }
  | { k: 'pact'; a: number; b: number; kind: 'nap' | 'alliance' }
  | { k: 'pact-end'; a: number; b: number; kind: 'nap' | 'alliance' | 'vassal' }
  | { k: 'vassal'; lord: number; vassal: number; surrender: boolean }
  | { k: 'offer'; from: number; to: number; kind: OfferKind }
  | { k: 'declined'; from: number; to: number; kind: OfferKind }
  | { k: 'revolt'; parent: number; rebel: number; idx: number; cells: number }
  | { k: 'abandon'; owner: number; cells: number }
  | { k: 'vote-start'; leader: number }
  | { k: 'vote-end'; leader: number; result: 'end' | 'continue' | 'cancel' }
  | { k: 'fort-built'; owner: number; idx: number }
  | { k: 'toast'; p: number; msg: string };

export const PALETTE: { name: string; rgb: [number, number, number] }[] = [
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
} as const;
