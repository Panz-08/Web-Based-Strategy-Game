// Peta dunia nyata bawaan (dihasilkan oleh scripts/genmaps.py dari batas negara Natural Earth/world.geo.json).
import type { MapId, Trait } from '../types.ts';
import { EUROPE_MAP } from './europe.ts';
import { MIDEAST_MAP } from './mideast.ts';
import { WORLD_MAP } from './world.ts';

export interface PresetNation {
  name: string;
  desc: string;
  trait: Trait;
  x: number;
  y: number;
}

/** Data mentah (RLE) seperti yang ditulis generator. */
export interface PresetData {
  id: string;
  label: string;
  w: number;
  h: number;
  spawnR: number;
  terrain: number[];
  region: number[];
  shade: number[];
  regions: string[];
  labels: number[][]; // [indeksNegara, x, y, jumlahSel]
  mines: number[];
  nations: PresetNation[];
}

export interface Preset {
  id: Exclude<MapId, 'random'>;
  label: string;
  blurb: string;
  w: number;
  h: number;
  spawnR: number;
  shipRange: number;
  terrain: Uint8Array;
  region: Uint8Array; // 0 = tak ada, n = regions[n-1]
  shade: Uint8Array; // 0 normal, 1 gurun, 2 tundra
  regions: string[];
  labels: { region: number; x: number; y: number; cells: number }[];
  mines: number[];
  nations: PresetNation[];
}

export const MAP_META: { id: MapId; label: string; blurb: string }[] = [
  { id: 'world', label: 'Dunia', blurb: 'Seluruh bumi. Benua terpisah laut sungguhan (berlayar dengan kapal); 28 bangsa & kerajaan.' },
  { id: 'mideast', label: 'Timur Tengah', blurb: 'Dari Anatolia sampai Persia, Jazirah Arab, dan Mesir.' },
  { id: 'europe', label: 'Eropa', blurb: 'Dari Iberia sampai Rusia, Skandinavia sampai Mediterania.' },
  { id: 'random', label: 'Acak', blurb: 'Pulau & benua prosedural, berbeda tiap permainan.' },
];

function unrle(runs: number[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let i = 0;
  for (let k = 0; k + 1 < runs.length; k += 2) {
    const v = runs[k];
    const len = runs[k + 1];
    if (v) out.fill(v, i, i + len);
    i += len;
  }
  return out;
}

const RAW: Record<Exclude<MapId, 'random'>, { data: PresetData; blurb: string }> = {
  world: { data: WORLD_MAP, blurb: MAP_META[0].blurb },
  mideast: { data: MIDEAST_MAP, blurb: MAP_META[1].blurb },
  europe: { data: EUROPE_MAP, blurb: MAP_META[2].blurb },
};

// Jangkauan kapal (sel) menyesuaikan skala peta: Dunia ~150 km/sel, Timur Tengah ~35 km, Eropa ~55 km.
const SHIP_RANGE: Record<Exclude<MapId, 'random'>, number> = { world: 14, mideast: 22, europe: 20 };

const cache = new Map<string, Preset>();

export function isPreset(id: string | undefined): id is Exclude<MapId, 'random'> {
  return id === 'world' || id === 'mideast' || id === 'europe';
}

export function getPreset(id: string): Preset | null {
  if (!isPreset(id)) return null;
  let p = cache.get(id);
  if (p) return p;
  const { data: d, blurb } = RAW[id];
  const n = d.w * d.h;
  p = {
    id,
    label: d.label,
    blurb,
    w: d.w,
    h: d.h,
    spawnR: d.spawnR,
    shipRange: SHIP_RANGE[id],
    terrain: unrle(d.terrain, n),
    region: unrle(d.region, n),
    shade: unrle(d.shade, n),
    regions: d.regions,
    labels: d.labels.map((l) => ({ region: l[0], x: l[1], y: l[2], cells: l[3] })),
    mines: d.mines,
    nations: d.nations,
  };
  cache.set(id, p);
  return p;
}

/** Jumlah bangsa maksimum yang bisa dimainkan (manusia + bot) pada peta. */
export function maxPlayers(id: MapId): number {
  const p = getPreset(id);
  return Math.min(16, p ? p.nations.length : 16);
}
