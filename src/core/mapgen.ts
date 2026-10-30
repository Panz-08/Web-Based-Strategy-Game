// Generator peta prosedural deterministik (seed yang sama => peta identik di semua klien).
import { Rng, hash2 } from './rng.ts';
import { F_MINE, F_NONE, T_FOREST, T_MOUNTAIN, T_PLAIN, T_WATER } from './types.ts';
import type { MapStyle, MatchSetup } from './types.ts';
import { getPreset } from './maps/index.ts';

export interface GameMap {
  w: number;
  h: number;
  terrain: Uint8Array;
  feat: Uint8Array; // fitur awal (tambang)
  spawns: number[]; // indeks sel ibu kota per pemain (urut id-1)
  land: number;
  spawnR: number; // jari-jari wilayah awal
  shipRange: number; // jangkauan kapal (sel)
  // Hanya peta nyata (kosmetik/orientasi):
  region?: Uint8Array;
  shade?: Uint8Array;
  regionNames?: string[];
  labels?: { region: number; x: number; y: number; cells: number }[];
  presetId?: string;
}

/** Bangun peta sesuai setup: peta nyata bila setup.map dikenali, selain itu prosedural. */
export function buildMap(setup: MatchSetup): GameMap {
  const preset = setup.map ? getPreset(setup.map) : null;
  if (!preset) return generateMap(setup.seed, setup.width, setup.height, setup.style, setup.players.length);
  const n = preset.w * preset.h;
  const terrain = Uint8Array.from(preset.terrain);
  const feat = new Uint8Array(n);
  for (const m of preset.mines) feat[m] = F_MINE;
  // Urutan bangsa dipakai apa adanya; tiap pemain membawa indeks bangsanya, sisanya diisi berurutan.
  const used = new Set<number>();
  const slots: number[] = [];
  for (const p of setup.players) {
    if (p.nation !== undefined && p.nation >= 0 && p.nation < preset.nations.length && !used.has(p.nation)) {
      used.add(p.nation);
      slots.push(p.nation);
    } else slots.push(-1);
  }
  let nextFree = 0;
  const spawns = slots.map((s) => {
    if (s < 0) {
      while (used.has(nextFree) && nextFree < preset.nations.length) nextFree++;
      s = Math.min(nextFree, preset.nations.length - 1);
      used.add(s);
    }
    const nat = preset.nations[s];
    return nat.y * preset.w + nat.x;
  });
  let land = 0;
  for (let i = 0; i < n; i++) if (terrain[i] !== T_WATER) land++;
  return {
    w: preset.w,
    h: preset.h,
    terrain,
    feat,
    spawns,
    land,
    spawnR: preset.spawnR,
    shipRange: preset.shipRange,
    region: preset.region,
    shade: preset.shade,
    regionNames: preset.regions,
    labels: preset.labels,
    presetId: preset.id,
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * xf;
  const bot = c + (d - c) * xf;
  return top + (bot - top) * yf;
}

function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function quantile(values: Float32Array, q: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

const STYLE: Record<MapStyle, { land: number; mountain: number; forest: number; scale: number }> = {
  continent: { land: 0.7, mountain: 0.08, forest: 0.28, scale: 0.075 },
  highland: { land: 0.74, mountain: 0.18, forest: 0.2, scale: 0.095 },
  open: { land: 0.82, mountain: 0.03, forest: 0.14, scale: 0.06 },
};

export function generateMap(seed: number, w: number, h: number, style: MapStyle, playerCount: number): GameMap {
  const st = STYLE[style];
  const n = w * h;
  const elev = new Float32Array(n);
  const forestN = new Float32Array(n);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const d = Math.sqrt(dx * dx * 0.8 + dy * dy * 0.8);
      const e = fbm(x * st.scale, y * st.scale, seed) - d * d * 0.55;
      elev[y * w + x] = e;
      forestN[y * w + x] = fbm(x * 0.12 + 50, y * 0.12 + 50, seed + 7);
    }
  }
  const waterLevel = quantile(elev, 1 - st.land);
  const terrain = new Uint8Array(n);
  const landElev: number[] = [];
  for (let i = 0; i < n; i++) {
    if (elev[i] > waterLevel) {
      terrain[i] = T_PLAIN;
      landElev.push(elev[i]);
    }
  }
  landElev.sort((a, b) => a - b);
  const mtLevel = landElev[Math.min(landElev.length - 1, Math.floor((1 - st.mountain) * landElev.length))];
  const forestSorted = Float32Array.from(forestN).sort();
  const fLevel = forestSorted[Math.floor((1 - st.forest) * n)];
  for (let i = 0; i < n; i++) {
    if (terrain[i] === T_WATER) continue;
    if (elev[i] >= mtLevel) terrain[i] = T_MOUNTAIN;
    else if (forestN[i] >= fLevel) terrain[i] = T_FOREST;
  }

  keepLargestLand(terrain, w, h);

  // Titik awal: farthest point sampling di lahan terbuka.
  const rng = new Rng(seed ^ 0x51ed270b);
  const cands: number[] = [];
  const R = 2;
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      let ok = true;
      let mt = 0;
      for (let dy = -R; dy <= R && ok; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R + 1) continue;
          const t = terrain[(y + dy) * w + x + dx];
          if (t === T_WATER) {
            ok = false;
            break;
          }
          if (t === T_MOUNTAIN) mt++;
        }
      }
      if (ok && mt <= 3) cands.push(y * w + x);
    }
  }
  const spawns: number[] = [];
  const first = cands[rng.int(cands.length)];
  spawns.push(first);
  while (spawns.length < playerCount) {
    let best = -1;
    let bestD = -1;
    const tries = Math.min(500, cands.length);
    for (let k = 0; k < tries; k++) {
      const c = cands[rng.int(cands.length)];
      let md = Infinity;
      for (const s of spawns) {
        const dx = (c % w) - (s % w);
        const dy = Math.floor(c / w) - Math.floor(s / w);
        const d = dx * dx + dy * dy;
        if (d < md) md = d;
      }
      if (md > bestD) {
        bestD = md;
        best = c;
      }
    }
    spawns.push(best);
  }
  // Bagi rata: acak urutan agar slot pemain 1 tidak selalu di titik pertama.
  for (let i = spawns.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = spawns[i];
    spawns[i] = spawns[j];
    spawns[j] = t;
  }
  for (const s of spawns) {
    const sx = s % w;
    const sy = Math.floor(s / w);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R + 1) continue;
        terrain[(sy + dy) * w + sx + dx] = T_PLAIN;
      }
    }
  }

  let land = 0;
  for (let i = 0; i < n; i++) if (terrain[i] !== T_WATER) land++;

  // Tambang: tersebar, jauh dari titik awal.
  const feat = new Uint8Array(n);
  const mines: number[] = [];
  const mineCount = Math.max(4, Math.round(land / 600));
  let attempts = 0;
  while (mines.length < mineCount && attempts < 4000) {
    attempts++;
    const c = rng.int(n);
    if (terrain[c] !== T_PLAIN && terrain[c] !== T_FOREST) continue;
    const x = c % w;
    const y = Math.floor(c / w);
    let ok = true;
    for (const s of spawns) {
      const dx = x - (s % w);
      const dy = y - Math.floor(s / w);
      if (dx * dx + dy * dy < 49) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const m of mines) {
      const dx = x - (m % w);
      const dy = y - Math.floor(m / w);
      if (dx * dx + dy * dy < 100) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    mines.push(c);
    feat[c] = F_MINE;
  }
  for (let i = 0; i < n; i++) if (feat[i] === undefined) feat[i] = F_NONE;

  return { w, h, terrain, feat, spawns, land, spawnR: 2, shipRange: 14 };
}

function keepLargestLand(terrain: Uint8Array, w: number, h: number): void {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (terrain[s] === T_WATER || comp[s] >= 0) continue;
    const id = sizes.length;
    let qh = 0;
    let qt = 0;
    queue[qt++] = s;
    comp[s] = id;
    while (qh < qt) {
      const c = queue[qh++];
      const x = c % w;
      const y = (c - x) / w;
      if (x > 0 && terrain[c - 1] !== T_WATER && comp[c - 1] < 0) {
        comp[c - 1] = id;
        queue[qt++] = c - 1;
      }
      if (x < w - 1 && terrain[c + 1] !== T_WATER && comp[c + 1] < 0) {
        comp[c + 1] = id;
        queue[qt++] = c + 1;
      }
      if (y > 0 && terrain[c - w] !== T_WATER && comp[c - w] < 0) {
        comp[c - w] = id;
        queue[qt++] = c - w;
      }
      if (y < h - 1 && terrain[c + w] !== T_WATER && comp[c + w] < 0) {
        comp[c + w] = id;
        queue[qt++] = c + w;
      }
    }
    sizes.push(qt);
  }
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < n; i++) if (terrain[i] !== T_WATER && comp[i] !== best) terrain[i] = T_WATER;
}
