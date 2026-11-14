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

export type MapStyle = 'continent' | 'highland' | 'open';
/** 'random' = peta prosedural; lainnya = peta dunia nyata bawaan. */
export type MapId = 'random' | 'world' | 'mideast' | 'europe';
export type Trait = 'war' | 'build' | 'dip' | 'bal';
export type Difficulty = 'easy' | 'normal' | 'hard';
/** Doktrin bangsa: pilih satu arah kekuatan di awal pertandingan. */
export type Doctrine = 'balanced' | 'militarist' | 'industrialist' | 'naval' | 'diplomat' | 'populist';

export type BuildKind = 'city' | 'factory' | 'port' | 'silo' | 'sam';
export const BUILD_KINDS: BuildKind[] = ['city', 'factory', 'port', 'silo', 'sam'];

export interface BuildDef {
  kind: BuildKind;
  label: string;
  short: string;
  desc: string;
  feat: number;
  gold: number; // biaya dasar
  per: number; // kenaikan biaya per bangunan sejenis
  ticks: number; // waktu pembangunan
}

/** Biaya & efek bangunan. Biaya aktual = gold + per * jumlah bangunan sejenis. */
export const BUILD_DEFS: Record<BuildKind, BuildDef> = {
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

export const DOCTRINES: { id: Doctrine; label: string; blurb: string }[] = [
  { id: 'balanced', label: 'Seimbang', blurb: '+10% emas, +5% batas pasukan. Aman untuk semua situasi.' },
  { id: 'militarist', label: 'Militaris', blurb: 'Serangan 10% lebih murah, +5% batas pasukan, mulai dengan pasukan ekstra.' },
  { id: 'industrialist', label: 'Industrialis', blurb: '+25% emas, bangunan 15% lebih murah.' },
  { id: 'naval', label: 'Maritim', blurb: '+1 kapal, +8 jangkauan kapal, kerugian laut jauh lebih kecil.' },
  { id: 'diplomat', label: 'Diplomat', blurb: 'Moral pulih 50% lebih cepat, upeti negara boneka +15%.' },
  { id: 'populist', label: 'Populis', blurb: '+15% batas pasukan dan +5% pendapatan emas.' },
];

export interface MatchSetup {
  seed: number;
  width: number;
  height: number;
  style: MapStyle;
  map?: MapId; // default 'random'
  players: PlayerSetup[];
}

export interface PlayerSetup {
  id: number; // 1..N
  name: string;
  kind: 'human' | 'bot';
  difficulty?: Difficulty;
  nation?: number; // indeks bangsa pada peta nyata (menentukan lokasi awal)
  trait?: Trait; // watak bot
  doctrine?: Doctrine; // default 'balanced'
}

export type Command =
  | { t: 'atk'; p: number; idx: number; pct: number; wide: boolean }
  | { t: 'fort'; p: number; idx: number }
  | { t: 'build'; p: number; idx: number; kind: BuildKind }
  | { t: 'nuke'; p: number; idx: number }
  | { t: 'gift'; p: number; target: number; amount: number }
  | { t: 'blitz'; p: number }
  | { t: 'shield'; p: number }
  | { t: 'ship'; p: number; idx: number; pct: number }
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
  doctrine: Doctrine;
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
  morale: number; // 0.15..1 - turun saat wilayah direbut, memengaruhi pendapatan & pertahanan
  lossAt: number; // tick terakhir kehilangan wilayah
  lord: number; // id tuan bila negara boneka, 0 = merdeka
  // Ekonomi & bangunan (v2)
  gold: number;
  goldIncome: number; // per detik
  cities: number;
  factories: number;
  ports: number;
  silos: number;
  sams: number;
  nukeReady: number;
  nukesFired: number;
  builtTotal: number;
  nukesLost: number; // nuklir yang dicegat SAM
  traitorUntil: number;
}

/** Bangunan yang sudah/sedang didirikan pada satu sel. */
export interface Building {
  idx: number;
  owner: number;
  kind: BuildKind;
  readyAt: number;
}

/** Rudal nuklir yang sedang melayang menuju target. */
export interface Nuke {
  id: number;
  owner: number;
  from: number; // sel silo peluncur
  target: number;
  launch: number;
  arrive: number;
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

/** Armada pengangkut pasukan yang sedang berlayar menuju pantai tujuan. */
export interface Ship {
  id: number;
  owner: number;
  from: number; // sel pesisir asal
  to: number; // sel pantai tujuan
  depart: number;
  arrive: number;
  pool: number;
}

/** Jalur pelayaran: menyambung wilayah seberang laut ke wilayah induk (dianggap "terhubung" ke ibu kota). */
export interface SeaLink {
  owner: number;
  a: number;
  b: number;
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
  | { k: 'built'; owner: number; idx: number; kind: BuildKind }
  | { k: 'build-lost'; victim: number; by: number; idx: number; kind: BuildKind; destroyed: boolean }
  | { k: 'nuke-launch'; by: number; target: number; idx: number }
  | { k: 'nuke'; by: number; target: number; idx: number; cells: number; victim: number }
  | { k: 'intercept'; by: number; nukeBy: number; target: number; idx: number }
  | { k: 'fallout'; idx: number; cells: number }
  | { k: 'gift'; from: number; to: number; amount: number }
  | { k: 'landing'; owner: number; target: number; idx: number; ok: boolean }
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
} as const;
