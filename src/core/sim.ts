// Simulasi inti Panz Dominion — deterministik (hanya + - * / dan integer ops) supaya lockstep multiplayer sinkron.
// Mekanik khas: Garis Depan (multi-front), Ibu Kota & wilayah terputus, Benteng, tambang, Blitz & Perisai.
import { hash2 } from './rng.ts';
import { generateMap } from './mapgen.ts';
import type { GameMap } from './mapgen.ts';
import { F_CAPITAL, F_FORT, F_MINE, F_NONE, T_WATER, TPS } from './types.ts';
import type { Command, Fort, GameEvent, MatchSetup, Offensive, Player } from './types.ts';

export const CFG = {
  startTroops: 150,
  capBase: 150,
  capPerCell: 14,
  baseIncome: 0.1, // per sel terhubung / detik
  mineIncome: 6,
  interest: 0.015,
  neutralCost: 3,
  enemyCost: 4.5,
  densityWeight: 0.6,
  overstretchNeutral: 500,
  overstretchEnemy: 600,
  terrainMult: [0, 1, 1.5, 3],
  fortNear: 1.8,
  fortOn: 3,
  capitalMult: 2.5,
  disconnectedMult: 0.5,
  shieldMult: 1.8,
  casualty: 0.3,
  blitzDur: 60,
  blitzCd: 400,
  blitzCostMult: 0.7,
  shieldDur: 70,
  shieldCd: 500,
  fortBase: 100,
  fortPerCell: 0.3,
  fortBuild: 50,
  fortMax: 4,
  fortRadius: 4,
  shakenDur: 300,
  shakenIncome: 0.5,
  plunder: 0.25,
  maxOffensives: 4,
  minCommit: 8,
  domShare: 0.6,
  domHold: 200,
  maxTicks: 12000,
  speedFrac: 0.06,
  speedMax: 10,
};

const KMAX = 24;

export class Sim {
  readonly w: number;
  readonly h: number;
  readonly n: number;
  readonly map: GameMap;
  readonly setup: MatchSetup;
  terrain: Uint8Array;
  feat: Uint8Array;
  owner: Uint8Array;
  linked: Uint8Array;
  changedAt: Int32Array;
  players: Player[] = [];
  offensives: Offensive[] = [];
  forts: Fort[] = [];
  tick = 0;
  events: GameEvent[] = [];
  winner = 0;
  winReason: 'dominance' | 'last' | 'time' | '' = '';
  domPlayer = 0;
  domSince = 0;
  nextOid = 1;
  landTotal: number;

  private queue: Int32Array;
  private visited: Uint8Array;
  private candIdx = new Int32Array(KMAX);
  private candScore = new Float64Array(KMAX);

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.w = setup.width;
    this.h = setup.height;
    this.n = this.w * this.h;
    this.map = generateMap(setup.seed, this.w, this.h, setup.style, setup.players.length);
    this.terrain = this.map.terrain;
    this.feat = Uint8Array.from(this.map.feat);
    this.owner = new Uint8Array(this.n);
    this.linked = new Uint8Array(this.n).fill(1);
    this.changedAt = new Int32Array(this.n).fill(-1000);
    this.queue = new Int32Array(this.n);
    this.visited = new Uint8Array(this.n);
    this.landTotal = this.map.land;
    this.players.push(null as unknown as Player);
    setup.players.forEach((ps, i) => {
      const spawn = this.map.spawns[i];
      const p: Player = {
        id: ps.id,
        name: ps.name,
        kind: ps.kind,
        difficulty: ps.difficulty ?? 'normal',
        alive: true,
        troops: CFG.startTroops,
        cells: 0,
        linkedCells: 0,
        linkedMines: 0,
        mines: 0,
        capital: spawn,
        shakenUntil: 0,
        blitzUntil: 0,
        shieldUntil: 0,
        blitzReady: 0,
        shieldReady: 0,
        income: 0,
        cap: CFG.capBase,
        peakCells: 0,
        diedAt: 0,
      };
      this.players[ps.id] = p;
      const sx = spawn % this.w;
      const sy = Math.floor(spawn / this.w);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const c = (sy + dy) * this.w + sx + dx;
          if (this.terrain[c] === T_WATER) continue;
          this.owner[c] = p.id;
          p.cells++;
          if (this.feat[c] === F_MINE) {
            p.mines++;
          }
        }
      }
      this.feat[spawn] = F_CAPITAL;
      p.linkedCells = p.cells;
      p.linkedMines = p.mines;
      p.peakCells = p.cells;
    });
    this.recompute();
  }

  get playerCount(): number {
    return this.players.length - 1;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- langkah utama
  step(cmds: Command[]): void {
    if (this.winner) {
      this.tick++;
      return;
    }
    for (const c of cmds) this.apply(c);
    for (let i = 0; i < this.offensives.length; i++) {
      const o = this.offensives[i];
      if (this.updateOffensive(o)) {
        this.offensives.splice(i, 1);
        i--;
      }
    }
    for (let id = 1; id < this.players.length; id++) {
      const p = this.players[id];
      if (!p.alive) continue;
      p.cap = CFG.capBase + CFG.capPerCell * p.cells;
      const shaken = this.tick < p.shakenUntil ? CFG.shakenIncome : 1;
      const base = (CFG.baseIncome * p.linkedCells + CFG.mineIncome * p.linkedMines) * shaken;
      const room = p.troops < p.cap ? 1 - p.troops / p.cap : 0;
      p.income = base + p.troops * CFG.interest * room * shaken;
      p.troops += p.income / TPS;
      if (p.troops > p.cap) p.troops -= (p.troops - p.cap) * 0.02;
    }
    this.tick++;
    if (this.tick % TPS === 0) {
      this.recompute();
      this.checkWin();
    }
  }

  // ---------------------------------------------------------------- perintah
  private toast(p: number, msg: string): void {
    this.events.push({ k: 'toast', p, msg });
  }

  private apply(c: Command): void {
    const p = this.players[c.p];
    if (!p || !p.alive) return;
    switch (c.t) {
      case 'atk': {
        const idx = c.idx | 0;
        if (idx < 0 || idx >= this.n || this.terrain[idx] === T_WATER) return;
        let target = this.owner[idx];
        if (target === p.id) return;
        const pct = Math.min(100, Math.max(1, c.pct));
        const amount = Math.floor(p.troops * pct) / 100;
        if (amount < CFG.minCommit) return this.toast(p.id, 'Pasukan terlalu sedikit');
        // "Maju ke arah": musuh belum berbatasan -> pasukan merambah lahan netral menuju titik yang diklik.
        let wide = c.wide;
        if (target !== 0 && this.frontier(p.id, target, idx, wide, 1) === 0) {
          if (this.frontier(p.id, 0, idx, false, 1) === 0) return this.toast(p.id, 'Tidak ada jalur menuju target');
          target = 0;
          wide = false;
        }
        let off = this.offensives.find((o) => o.owner === p.id && o.target === target);
        if (!off) {
          if (this.countOffensives(p.id) >= CFG.maxOffensives) return this.toast(p.id, 'Maksimal 4 garis depan');
          if (this.frontier(p.id, target, idx, wide, 1) === 0) return this.toast(p.id, 'Tidak berbatasan dengan target');
          off = { id: this.nextOid++, owner: p.id, target, focus: idx, wide, pool: 0, startPool: 0, gained: 0 };
          this.offensives.push(off);
        }
        p.troops -= amount;
        off.pool += amount;
        off.startPool += amount;
        off.focus = idx;
        off.wide = wide;
        return;
      }
      case 'fort': {
        const idx = c.idx | 0;
        if (idx < 0 || idx >= this.n || this.owner[idx] !== p.id) return;
        if (this.feat[idx] !== F_NONE) return this.toast(p.id, 'Sel ini sudah terpakai');
        const mine = this.forts.filter((f) => f.owner === p.id).length;
        if (mine >= CFG.fortMax) return this.toast(p.id, 'Maksimal 4 benteng');
        const cost = this.fortCost(p);
        if (p.troops < cost) return this.toast(p.id, 'Pasukan kurang untuk benteng');
        p.troops -= cost;
        this.feat[idx] = F_FORT;
        this.forts.push({ idx, owner: p.id, readyAt: this.tick + CFG.fortBuild });
        this.events.push({ k: 'fort-built', owner: p.id, idx });
        return;
      }
      case 'blitz':
        if (this.tick < p.blitzReady) return;
        p.blitzUntil = this.tick + CFG.blitzDur;
        p.blitzReady = this.tick + CFG.blitzCd;
        return;
      case 'shield':
        if (this.tick < p.shieldReady) return;
        p.shieldUntil = this.tick + CFG.shieldDur;
        p.shieldReady = this.tick + CFG.shieldCd;
        return;
      case 'retreat':
        for (let i = 0; i < this.offensives.length; i++) {
          const o = this.offensives[i];
          if (o.owner === p.id) {
            p.troops += o.pool;
            this.offensives.splice(i, 1);
            i--;
          }
        }
        return;
    }
  }

  countOffensives(p: number): number {
    let k = 0;
    for (const o of this.offensives) if (o.owner === p) k++;
    return k;
  }

  fortCost(p: Player): number {
    return Math.floor(CFG.fortBase + CFG.fortPerCell * p.cells);
  }

  // ---------------------------------------------------------------- serangan
  /** Cari sel target yang bersinggungan dengan wilayah `att`; simpan k terbaik di candIdx. Mengembalikan jumlah kandidat. */
  frontier(att: number, target: number, focus: number, wide: boolean, k: number): number {
    const { w, h, owner, terrain } = this;
    const fx = focus % w;
    const fy = (focus - fx) / w;
    const ci = this.candIdx;
    const cs = this.candScore;
    let have = 0;
    let count = 0;
    const tick = this.tick;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const c = row + x;
        if (owner[c] !== target || terrain[c] === T_WATER) continue;
        if (
          !((x > 0 && owner[c - 1] === att) || (x < w - 1 && owner[c + 1] === att) || (y > 0 && owner[c - w] === att) || (y < h - 1 && owner[c + w] === att))
        )
          continue;
        count++;
        const score = wide ? hash2(c, tick, att) * 1e6 : (x - fx) * (x - fx) + (y - fy) * (y - fy) + c * 1e-6;
        if (have < k) {
          let j = have++;
          while (j > 0 && cs[j - 1] > score) {
            cs[j] = cs[j - 1];
            ci[j] = ci[j - 1];
            j--;
          }
          cs[j] = score;
          ci[j] = c;
        } else if (score < cs[k - 1]) {
          let j = k - 1;
          while (j > 0 && cs[j - 1] > score) {
            cs[j] = cs[j - 1];
            ci[j] = ci[j - 1];
            j--;
          }
          cs[j] = score;
          ci[j] = c;
        }
      }
    }
    return count;
  }

  /** Biaya merebut sel c oleh penyerang a dari pemilik saat ini. */
  cellCost(a: Player, c: number): number {
    const t = CFG.terrainMult[this.terrain[c]];
    const blitz = this.tick < a.blitzUntil ? CFG.blitzCostMult : 1;
    const ownerId = this.owner[c];
    if (ownerId === 0) {
      return CFG.neutralCost * t * (1 + a.cells / CFG.overstretchNeutral) * blitz;
    }
    const d = this.players[ownerId];
    const dens = d.troops / Math.max(1, d.cells);
    let m = CFG.enemyCost + CFG.densityWeight * dens;
    m *= t * (1 + a.cells / CFG.overstretchEnemy) * blitz;
    const f = this.feat[c];
    if (f === F_CAPITAL) m *= CFG.capitalMult;
    let fm = 1;
    for (const fort of this.forts) {
      if (fort.owner !== ownerId || fort.readyAt > this.tick) continue;
      const fx = fort.idx % this.w;
      const fy = (fort.idx - fx) / this.w;
      const cx = c % this.w;
      const cy = (c - cx) / this.w;
      const dist = Math.abs(fx - cx) + Math.abs(fy - cy);
      if (dist === 0) fm = Math.max(fm, CFG.fortOn);
      else if (dist <= CFG.fortRadius) fm = Math.max(fm, CFG.fortNear);
    }
    m *= fm;
    if (!this.linked[c]) m *= CFG.disconnectedMult;
    if (this.tick < d.shieldUntil) m *= CFG.shieldMult;
    return m;
  }

  /** Kembalikan true bila offensive selesai. */
  private updateOffensive(o: Offensive): boolean {
    const att = this.players[o.owner];
    if (!att.alive) return true;
    const def = o.target ? this.players[o.target] : null;
    if (def && !def.alive) {
      att.troops += o.pool;
      return true;
    }
    const mult = this.tick < att.blitzUntil ? 2 : 1;
    const count = this.frontier(o.owner, o.target, o.focus, o.wide, KMAX);
    if (count === 0) {
      att.troops += o.pool;
      return true;
    }
    const speed = Math.min(KMAX, Math.min(CFG.speedMax, 1 + Math.floor(count * CFG.speedFrac)) * mult);
    const picks: number[] = [];
    for (let i = 0; i < Math.min(count, KMAX); i++) picks.push(this.candIdx[i]);
    let taken = 0;
    for (const c of picks) {
      if (taken >= speed) break;
      if (this.owner[c] !== o.target) continue;
      const cost = this.cellCost(att, c);
      if (o.pool < cost) continue;
      o.pool -= cost;
      o.gained++;
      taken++;
      this.capture(att, def, c, cost);
      if (def && !def.alive) break;
    }
    if (taken === 0) {
      att.troops += o.pool;
      return true;
    }
    return false;
  }

  private capture(att: Player, def: Player | null, c: number, cost: number): void {
    const wasLinked = this.linked[c] === 1;
    const f = this.feat[c];
    this.owner[c] = att.id;
    this.linked[c] = 1;
    this.changedAt[c] = this.tick;
    att.cells++;
    att.linkedCells++;
    if (att.cells > att.peakCells) att.peakCells = att.cells;
    if (f === F_MINE) {
      att.mines++;
      att.linkedMines++;
    }
    if (!def) return;
    def.cells--;
    if (wasLinked) def.linkedCells = Math.max(0, def.linkedCells - 1);
    def.troops = Math.max(0, def.troops - cost * CFG.casualty);
    if (f === F_MINE) {
      def.mines--;
      if (wasLinked) def.linkedMines = Math.max(0, def.linkedMines - 1);
    } else if (f === F_FORT) {
      this.forts = this.forts.filter((x) => x.idx !== c);
      this.feat[c] = F_NONE;
      this.events.push({ k: 'fort-lost', victim: def.id, by: att.id, idx: c });
    } else if (f === F_CAPITAL) {
      this.feat[c] = F_NONE;
      def.capital = -1;
      const loot = def.troops * CFG.plunder;
      def.troops -= loot;
      att.troops += loot;
      def.shakenUntil = this.tick + CFG.shakenDur;
      this.events.push({ k: 'capital', victim: def.id, by: att.id, idx: c });
    }
    if (def.cells <= 0) this.kill(def, att.id);
  }

  private kill(def: Player, by: number): void {
    def.alive = false;
    def.cells = 0;
    def.troops = 0;
    def.diedAt = this.tick;
    this.offensives = this.offensives.filter((o) => {
      if (o.owner === def.id) return false;
      return true;
    });
    this.forts = this.forts.filter((f) => f.owner !== def.id);
    this.events.push({ k: 'dead', victim: def.id, by });
  }

  // ---------------------------------------------------------------- konektivitas ibu kota
  recompute(): void {
    const { w, h, owner, queue, visited, feat } = this;
    visited.fill(0);
    for (let id = 1; id < this.players.length; id++) {
      const p = this.players[id];
      if (!p.alive) continue;
      if (p.capital < 0 || owner[p.capital] !== id) this.relocateCapital(p);
      p.linkedCells = 0;
      p.linkedMines = 0;
      if (p.capital < 0) continue;
      let qh = 0;
      let qt = 0;
      queue[qt++] = p.capital;
      visited[p.capital] = 1;
      while (qh < qt) {
        const c = queue[qh++];
        p.linkedCells++;
        if (feat[c] === F_MINE) p.linkedMines++;
        const x = c % w;
        const y = (c - x) / w;
        if (x > 0 && owner[c - 1] === id && !visited[c - 1]) {
          visited[c - 1] = 1;
          queue[qt++] = c - 1;
        }
        if (x < w - 1 && owner[c + 1] === id && !visited[c + 1]) {
          visited[c + 1] = 1;
          queue[qt++] = c + 1;
        }
        if (y > 0 && owner[c - w] === id && !visited[c - w]) {
          visited[c - w] = 1;
          queue[qt++] = c - w;
        }
        if (y < h - 1 && owner[c + w] === id && !visited[c + w]) {
          visited[c + w] = 1;
          queue[qt++] = c + w;
        }
      }
    }
    for (let c = 0; c < this.n; c++) this.linked[c] = owner[c] === 0 || visited[c] ? 1 : 0;
  }

  private relocateCapital(p: Player): void {
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    for (let c = 0; c < this.n; c++) {
      if (this.owner[c] !== p.id) continue;
      sx += c % this.w;
      sy += Math.floor(c / this.w);
      cnt++;
    }
    if (cnt === 0) {
      p.capital = -1;
      return;
    }
    const mx = sx / cnt;
    const my = sy / cnt;
    let best = -1;
    let bestD = Infinity;
    let fallback = -1;
    for (let c = 0; c < this.n; c++) {
      if (this.owner[c] !== p.id) continue;
      fallback = c;
      if (this.feat[c] !== F_NONE) continue;
      const dx = (c % this.w) - mx;
      const dy = Math.floor(c / this.w) - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best < 0) best = fallback;
    p.capital = best;
    this.feat[best] = F_CAPITAL;
  }

  private checkWin(): void {
    const alive = this.players.filter((p) => p && p.alive);
    if (alive.length === 1 && this.playerCount > 1) {
      return this.finish(alive[0].id, 'last');
    }
    if (alive.length === 0) return this.finish(0, 'last');
    let lead = alive[0];
    for (const p of alive) if (p.cells > lead.cells) lead = p;
    if (lead.cells >= this.landTotal * CFG.domShare) {
      if (this.domPlayer !== lead.id) {
        this.domPlayer = lead.id;
        this.domSince = this.tick;
      } else if (this.tick - this.domSince >= CFG.domHold) {
        return this.finish(lead.id, 'dominance');
      }
    } else {
      this.domPlayer = 0;
    }
    if (this.tick >= CFG.maxTicks) this.finish(lead.id, 'time');
  }

  private finish(winner: number, reason: 'dominance' | 'last' | 'time'): void {
    this.winner = winner || -1;
    this.winReason = reason;
    this.events.push({ k: 'win', winner, reason });
  }

  // ---------------------------------------------------------------- utilitas
  checksum(): number {
    let h = 2166136261 | 0;
    const o = this.owner;
    for (let i = 0; i < o.length; i++) h = Math.imul(h ^ o[i], 16777619);
    h = Math.imul(h ^ this.tick, 16777619);
    for (let id = 1; id < this.players.length; id++) {
      const p = this.players[id];
      h = Math.imul(h ^ Math.floor(p.troops * 10), 16777619);
      h = Math.imul(h ^ p.cells, 16777619);
    }
    for (const of of this.offensives) h = Math.imul(h ^ Math.floor(of.pool * 10), 16777619);
    return h >>> 0;
  }

  /** Persentase wilayah dari seluruh daratan. */
  share(p: Player): number {
    return p.cells / this.landTotal;
  }

  ranking(): Player[] {
    return this.players
      .filter((p) => p)
      .sort((a, b) => (a.alive === b.alive ? b.cells - a.cells : a.alive ? -1 : 1));
  }

  serialize(): SimState {
    return {
      tick: this.tick,
      owner: b64(this.owner),
      feat: b64(this.feat),
      players: this.players.slice(1).map((p) => ({ ...p })),
      offensives: this.offensives.map((o) => ({ ...o })),
      forts: this.forts.map((f) => ({ ...f })),
      winner: this.winner,
      winReason: this.winReason,
      domPlayer: this.domPlayer,
      domSince: this.domSince,
      nextOid: this.nextOid,
    };
  }

  restore(s: SimState): void {
    this.tick = s.tick;
    this.owner.set(unb64(s.owner));
    this.feat.set(unb64(s.feat));
    this.players = [null as unknown as Player, ...s.players.map((p) => ({ ...p }))];
    this.offensives = s.offensives.map((o) => ({ ...o }));
    this.forts = s.forts.map((f) => ({ ...f }));
    this.winner = s.winner;
    this.winReason = s.winReason;
    this.domPlayer = s.domPlayer;
    this.domSince = s.domSince;
    this.nextOid = s.nextOid;
    this.changedAt.fill(s.tick);
    this.recompute();
  }
}

export interface SimState {
  tick: number;
  owner: string;
  feat: string;
  players: Player[];
  offensives: Offensive[];
  forts: Fort[];
  winner: number;
  winReason: 'dominance' | 'last' | 'time' | '';
  domPlayer: number;
  domSince: number;
  nextOid: number;
}

function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
