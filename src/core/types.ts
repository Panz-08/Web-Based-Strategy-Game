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
  | { t: 'retreat'; p: number };

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
  | { k: 'win'; winner: number; reason: 'dominance' | 'last' | 'time' }
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
