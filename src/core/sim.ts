// Simulasi inti Panz Dominion — deterministik (hanya + - * / dan integer ops) supaya lockstep multiplayer sinkron.
// Mekanik khas: Garis Depan (multi-front), Ibu Kota & wilayah terputus, Benteng, tambang, Blitz & Perisai.
import { hash2 } from './rng.ts';
import { buildMap } from './mapgen.ts';
import type { GameMap } from './mapgen.ts';
import { F_CAPITAL, F_FORT, F_MINE, F_NONE, MAX_NATIONS, OFFER_KINDS, REBEL_NAMES, T_WATER, TPS } from './types.ts';
import type { Command, Fort, GameEvent, MatchSetup, Offensive, Offer, OfferKind, Player, RelKind, Relation, Vote } from './types.ts';

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
  terrainMult: [0, 1, 1.5, 3, 1.8], // air, dataran, hutan, gunung, selat dangkal
  fortNear: 1.8,
  fortOn: 3,
  capitalMult: 2.5,
  disconnectedMult: 0.35, // wilayah terputus sangat mudah dianeksasi
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
  shakenDur: 600,
  shakenIncome: 0.35,
  plunder: 0.3,
  // moral: turun saat wilayah direbut, pulih bila tenang
  moraleCell: 0.003,
  moraleMine: 0.01,
  moraleFort: 0.03,
  moraleCapital: 0.2, // moral jatuh ke sini saat ibu kota direbut
  moraleMin: 0.15,
  moraleRegen: 0.02, // per detik
  moraleCalm: 100, // tick tanpa kehilangan wilayah sebelum moral pulih
  moraleIncome: 0.4, // pengali pendapatan pada moral 0
  moraleDefense: 0.5, // pengali biaya rebut pada moral 0
  capitalStun: 0.5, // porsi pasukan serangan yang hilang saat ibu kota jatuh
  // diplomasi
  truceDur: 600,
  napDur: 1800,
  napNotice: 300,
  offerTtl: 600,
  offerBlock: 300,
  tribute: 0.25,
  // revolusi wilayah terputus
  revoltMin: 10,
  revoltAfter: 30, // rata-rata detik terputus
  revoltChance: 0.1,
  revoltMorale: 0.12,
  rebelShare: 0.8,
  rebelMinTroops: 30,
  abandonAfter: 40,
  voteTime: 300,
  voteCooldown: 900,
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
  winReason: 'dominance' | 'last' | 'time' | 'bloc' | '' = '';
  domPlayer = 0;
  domSince = 0;
  nextOid = 1;
  landTotal: number;
  rels: Relation[] = [];
  offers: Offer[] = [];
  blocks: { key: number; until: number }[] = [];
  nextOfferId = 1;
  rebels = 0;
  cutAge: Uint8Array;
  vote: Vote | null = null;
  voteCool = 0;
  private relMap = new Map<number, Relation>();
  private seen: Uint8Array;

  private queue: Int32Array;
  private visited: Uint8Array;
  private candIdx = new Int32Array(KMAX);
  private candScore = new Float64Array(KMAX);

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.map = buildMap(setup);
    this.w = this.map.w;
    this.h = this.map.h;
    this.n = this.w * this.h;
    this.terrain = this.map.terrain;
    this.feat = Uint8Array.from(this.map.feat);
    this.owner = new Uint8Array(this.n);
    this.linked = new Uint8Array(this.n).fill(1);
    this.changedAt = new Int32Array(this.n).fill(-1000);
    this.queue = new Int32Array(this.n);
    this.visited = new Uint8Array(this.n);
    this.seen = new Uint8Array(this.n);
    this.cutAge = new Uint8Array(this.n);
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
        morale: 1,
        lossAt: 0,
        lord: 0,
      };
      this.players[ps.id] = p;
      const sx = spawn % this.w;
      const sy = Math.floor(spawn / this.w);
      const R = this.map.spawnR;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R + 1) continue;
          if (sx + dx < 0 || sx + dx >= this.w || sy + dy < 0 || sy + dy >= this.h) continue;
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
    // Iterasi pada salinan: capture()/kill() boleh mengubah daftar offensif di tengah jalan.
    for (const o of this.offensives.slice()) {
      if (!this.offensives.includes(o)) continue;
      if (this.updateOffensive(o)) {
        const k = this.offensives.indexOf(o);
        if (k >= 0) this.offensives.splice(k, 1);
      }
    }
    for (let id = 1; id < this.players.length; id++) {
      const p = this.players[id];
      if (!p.alive) continue;
      // Otoritas negara hanya sebesar wilayah yang tersambung ke ibu kota.
      p.cap = CFG.capBase + CFG.capPerCell * p.linkedCells;
      const shaken = (this.tick < p.shakenUntil ? CFG.shakenIncome : 1) * (CFG.moraleIncome + (1 - CFG.moraleIncome) * p.morale);
      const base = (CFG.baseIncome * p.linkedCells + CFG.mineIncome * p.linkedMines) * shaken;
      const room = p.troops < p.cap ? 1 - p.troops / p.cap : 0;
      p.income = base + p.troops * CFG.interest * room * shaken;
      p.troops += p.income / TPS;
      if (p.troops > p.cap) p.troops -= (p.troops - p.cap) * 0.02;
    }
    // Upeti negara boneka ke tuannya.
    for (let id = 1; id < this.players.length; id++) {
      const v = this.players[id];
      if (!v.alive || !v.lord) continue;
      const l = this.players[v.lord];
      if (!l || !l.alive) continue;
      const t = (v.income * CFG.tribute) / TPS;
      v.troops -= t;
      l.troops += t;
    }
    this.tick++;
    if (this.tick % TPS === 0) {
      this.recompute();
      this.politics();
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
        if (target !== 0) {
          const bordering = this.frontier(p.id, target, idx, wide, 1) > 0;
          // Menyerang negara lain wajib memutuskan perang dulu.
          if (bordering && !this.atWar(p.id, target)) return this.toast(p.id, `Nyatakan perang dulu pada ${this.players[target].name}`);
          if (!bordering) {
            if (this.frontier(p.id, 0, idx, false, 1) === 0) return this.toast(p.id, 'Tidak ada jalur menuju target');
            target = 0;
            wide = false;
          }
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
      case 'war':
        return this.cmdWar(p, c.target | 0);
      case 'offer':
        return this.cmdOffer(p, c.target | 0, c.kind);
      case 'reply':
        return this.cmdReply(p, c.id | 0, !!c.accept);
      case 'surrender':
        return this.cmdSurrender(p, c.target | 0);
      case 'break':
        return this.cmdBreak(p, c.target | 0);
      case 'vote':
        return this.cmdVote(p, !!c.end);
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
    m *= CFG.moraleDefense + (1 - CFG.moraleDefense) * d.morale; // negara goyah lebih mudah ditaklukkan
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
    if (def && !this.atWar(o.owner, o.target)) {
      att.troops += o.pool; // damai/pakta: serangan dihentikan
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
    def.lossAt = this.tick;
    let loss = CFG.moraleCell;
    if (f === F_MINE) loss += CFG.moraleMine;
    else if (f === F_FORT) loss += CFG.moraleFort;
    def.morale = Math.max(CFG.moraleMin, def.morale - loss);
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
      // Ibu kota jatuh: moral hancur & pasukan yang sedang berperang kocar-kacir.
      def.morale = Math.min(def.morale, CFG.moraleCapital);
      for (const of of this.offensives) if (of.owner === def.id) of.pool *= 1 - CFG.capitalStun;
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
    for (const r of this.rels.slice()) if (r.a === def.id || r.b === def.id) this.setRel(r.a, r.b, 'peace');
    for (const q of this.players) if (q && q.lord === def.id) q.lord = 0;
    def.lord = 0;
    this.offers = this.offers.filter((o) => o.from !== def.id && o.to !== def.id);
    if (this.vote) delete this.vote.ballots[def.id];
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

  // ---------------------------------------------------------------- diplomasi
  private rk(a: number, b: number): number {
    return a < b ? a * 256 + b : b * 256 + a;
  }

  getRel(a: number, b: number): Relation | undefined {
    return this.relMap.get(this.rk(a, b));
  }

  relKind(a: number, b: number): RelKind {
    return this.getRel(a, b)?.kind ?? 'peace';
  }

  atWar(a: number, b: number): boolean {
    return a !== b && a > 0 && b > 0 && this.relKind(a, b) === 'war';
  }

  /** Daftar id negara yang sedang berperang dengan `id`. */
  enemiesOf(id: number): number[] {
    const out: number[] = [];
    for (let z = 1; z < this.players.length; z++) if (this.players[z].alive && this.atWar(id, z)) out.push(z);
    return out;
  }

  private setRel(a: number, b: number, kind: RelKind, until = 0, lord = 0): void {
    const key = this.rk(a, b);
    const cur = this.relMap.get(key);
    if (kind === 'peace') {
      if (cur) {
        this.relMap.delete(key);
        this.rels = this.rels.filter((r) => r !== cur);
      }
      return;
    }
    if (cur) {
      cur.kind = kind;
      cur.since = this.tick;
      cur.until = until;
      cur.lord = lord;
      return;
    }
    const r: Relation = { a: Math.min(a, b), b: Math.max(a, b), kind, since: this.tick, until, lord };
    this.rels.push(r);
    this.relMap.set(key, r);
  }

  private reindex(): void {
    this.relMap.clear();
    for (const r of this.rels) this.relMap.set(r.a * 256 + r.b, r);
  }

  /** Akar blok: tuan bila negara boneka, selain itu dirinya sendiri. */
  rootOf(id: number): number {
    const p = this.players[id];
    return p && p.lord && this.players[p.lord]?.alive ? p.lord : id;
  }

  /** Total sel satu blok (tuan + semua negara bonekanya). */
  blocCells(root: number): number {
    let n = 0;
    for (let z = 1; z < this.players.length; z++) {
      const p = this.players[z];
      if (p.alive && this.rootOf(z) === root) n += p.cells;
    }
    return n;
  }

  /** Satu pihak? (blok yang sama, atau bersekutu bila `allies`). */
  sameSide(a: number, b: number, allies = false): boolean {
    if (a === b) return true;
    if (this.rootOf(a) === this.rootOf(b)) return true;
    return allies && this.relKind(this.rootOf(a), this.rootOf(b)) === 'alliance';
  }

  /** Alasan perang tidak bisa dinyatakan; string kosong bila boleh. */
  canDeclareWar(a: number, b: number): string {
    const A = this.players[a];
    const B = this.players[b];
    if (!A || !B || !A.alive || !B.alive || a === b) return 'Target tidak valid';
    const r = this.getRel(a, b);
    const left = r && r.until ? Math.ceil((r.until - this.tick) / TPS) : 0;
    switch (r?.kind) {
      case 'war':
        return 'Sudah berperang';
      case 'truce':
        return `Gencatan senjata masih ${left} dtk`;
      case 'nap':
        return `Pakta non agresi masih ${left} dtk — akhiri dulu`;
      case 'alliance':
        return 'Putuskan aliansi dulu';
      case 'vassal':
        if (r.lord === a) return 'Lepaskan negara bonekamu dulu';
        return '';
    }
    if (A.lord && A.lord !== b) return 'Negara boneka tidak bisa menyatakan perang sendiri';
    return '';
  }

  private cmdWar(p: Player, tid: number): void {
    const why = this.canDeclareWar(p.id, tid);
    if (why) return this.toast(p.id, why);
    this.declareWar(p.id, tid);
  }

  private declareWar(a: number, b: number): void {
    let why: 'declare' | 'independence' = 'declare';
    if (this.relKind(a, b) === 'vassal') {
      this.players[a].lord = 0;
      why = 'independence';
      this.events.push({ k: 'pact-end', a: b, b: a, kind: 'vassal' });
    }
    this.offers = this.offers.filter((o) => !((o.from === a && o.to === b) || (o.from === b && o.to === a)));
    this.setRel(a, b, 'war');
    this.events.push({ k: 'war', by: a, target: b, why });
    this.joinWars(a, b);
  }

  /** Sekutu & negara boneka ikut berperang. Gencatan/pakta yang berlaku tetap dihormati. */
  private joinWars(att: number, def: number): void {
    for (let z = 1; z < this.players.length; z++) {
      const zp = this.players[z];
      if (!zp.alive || z === att || z === def) continue;
      if (zp.lord === att) {
        if (this.relKind(z, def) === 'peace') {
          this.setRel(z, def, 'war');
          this.events.push({ k: 'war', by: z, target: def, why: 'join' });
        }
      } else if (this.relKind(z, def) === 'alliance' || zp.lord === def || this.players[def].lord === z) {
        if (this.players[att].lord !== z && this.relKind(z, att) === 'peace') {
          this.setRel(z, att, 'war');
          this.events.push({ k: 'war', by: z, target: att, why: 'join' });
        }
      }
    }
  }

  private cancelBetween(a: number, b: number): void {
    this.offensives = this.offensives.filter((o) => {
      if ((o.owner === a && o.target === b) || (o.owner === b && o.target === a)) {
        this.players[o.owner].troops += o.pool;
        return false;
      }
      return true;
    });
  }

  private blockKey(from: number, to: number, kind: OfferKind): number {
    return (from * 256 + to) * 8 + OFFER_KINDS.indexOf(kind);
  }

  /** Validitas hubungan untuk jenis tawaran (tanpa memeriksa duplikat/cooldown). */
  private relError(a: number, b: number, kind: OfferKind): string {
    const A = this.players[a];
    const B = this.players[b];
    if (!A || !B || !A.alive || !B.alive || a === b) return 'Target tidak valid';
    if (A.lord) return 'Negara boneka tidak bisa berdiplomasi sendiri';
    if (B.lord) return `${B.name} adalah negara boneka ${this.players[B.lord].name}`;
    const rk = this.relKind(a, b);
    switch (kind) {
      case 'peace':
        if (rk !== 'war') return 'Tidak sedang berperang';
        break;
      case 'nap':
        if (rk === 'war') return 'Akhiri perang dulu';
        if (rk !== 'peace' && rk !== 'truce') return 'Sudah ada ikatan';
        break;
      case 'alliance':
        if (rk === 'war') return 'Akhiri perang dulu';
        if (rk === 'alliance') return 'Sudah bersekutu';
        break;
      case 'vassal':
        if (rk === 'alliance') return 'Putuskan aliansi dulu';
        break;
    }
    return '';
  }

  /** Alasan tawaran tidak bisa dikirim; string kosong bila boleh. */
  offerError(a: number, b: number, kind: OfferKind): string {
    const e = this.relError(a, b, kind);
    if (e) return e;
    if (this.offers.some((o) => o.from === a && o.to === b && o.kind === kind)) return 'Tawaran masih menunggu jawaban';
    const key = this.blockKey(a, b, kind);
    if (this.blocks.some((x) => x.key === key && x.until > this.tick)) return 'Baru saja ditolak — coba lagi nanti';
    return '';
  }

  private cmdOffer(p: Player, tid: number, kind: OfferKind): void {
    if (!OFFER_KINDS.includes(kind)) return;
    const err = this.offerError(p.id, tid, kind);
    if (err) return this.toast(p.id, err);
    const rev = this.offers.find((o) => o.from === tid && o.to === p.id && o.kind === kind);
    if (rev) return this.settle(rev, true);
    this.offers.push({ id: this.nextOfferId++, from: p.id, to: tid, kind, expires: this.tick + CFG.offerTtl });
    this.events.push({ k: 'offer', from: p.id, to: tid, kind });
  }

  private cmdReply(p: Player, id: number, accept: boolean): void {
    const o = this.offers.find((x) => x.id === id && x.to === p.id);
    if (o) this.settle(o, accept);
  }

  private settle(o: Offer, accept: boolean): void {
    this.offers = this.offers.filter((x) => x !== o);
    if (!accept) {
      this.blocks.push({ key: this.blockKey(o.from, o.to, o.kind), until: this.tick + CFG.offerBlock });
      this.events.push({ k: 'declined', from: o.from, to: o.to, kind: o.kind });
      return;
    }
    const err = this.relError(o.from, o.to, o.kind);
    if (err) {
      this.toast(o.to, err);
      return;
    }
    const t = this.tick;
    switch (o.kind) {
      case 'peace':
        this.makePeace(o.from, o.to);
        break;
      case 'nap':
        this.setRel(o.from, o.to, 'nap', t + CFG.napDur);
        this.events.push({ k: 'pact', a: o.from, b: o.to, kind: 'nap' });
        break;
      case 'alliance':
        this.setRel(o.from, o.to, 'alliance');
        this.events.push({ k: 'pact', a: o.from, b: o.to, kind: 'alliance' });
        break;
      case 'vassal':
        this.makeVassal(o.from, o.to, false);
        break;
    }
    this.offers = this.offers.filter((x) => !((x.from === o.from && x.to === o.to) || (x.from === o.to && x.to === o.from)));
  }

  private makePeace(a: number, b: number): void {
    this.cancelBetween(a, b);
    this.setRel(a, b, 'truce', this.tick + CFG.truceDur);
    // Negara boneka mengikuti perdamaian tuannya.
    for (const [lord, other] of [[a, b], [b, a]]) {
      for (let v = 1; v < this.players.length; v++) {
        if (this.players[v].alive && this.players[v].lord === lord && this.atWar(v, other)) {
          this.cancelBetween(v, other);
          this.setRel(v, other, 'truce', this.tick + CFG.truceDur);
        }
      }
    }
    this.events.push({ k: 'peace', a, b });
  }

  /** `v` menjadi negara boneka `lord`. Perang & pakta lama disesuaikan dengan sang tuan. */
  private makeVassal(lordId: number, vId: number, surrender: boolean): void {
    const t = this.tick;
    const v = this.players[vId];
    for (const q of this.players) {
      if (q && q.alive && q.lord === vId) {
        q.lord = 0;
        this.setRel(q.id, vId, 'truce', t + CFG.truceDur / 2);
      }
    }
    for (let z = 1; z < this.players.length; z++) {
      if (z === vId || z === lordId || !this.players[z].alive) continue;
      const k = this.relKind(vId, z);
      if (k === 'alliance' || k === 'nap') this.setRel(vId, z, 'peace');
    }
    this.cancelBetween(lordId, vId);
    this.setRel(lordId, vId, 'vassal', 0, lordId);
    v.lord = lordId;
    for (let z = 1; z < this.players.length; z++) {
      if (z === vId || z === lordId || !this.players[z].alive) continue;
      const lw = this.atWar(lordId, z);
      const vw = this.atWar(vId, z);
      if (vw && !lw) {
        this.cancelBetween(vId, z);
        this.setRel(vId, z, 'truce', t + CFG.truceDur);
      } else if (lw && !vw) {
        const k = this.relKind(vId, z);
        if (k === 'peace' || k === 'truce' || k === 'nap') this.setRel(vId, z, 'war');
      }
    }
    this.offers = this.offers.filter((o) => o.from !== vId && o.to !== vId);
    this.events.push({ k: 'vassal', lord: lordId, vassal: vId, surrender });
  }

  private cmdSurrender(p: Player, tid: number): void {
    const T = this.players[tid];
    if (!T || !T.alive || !this.atWar(p.id, tid)) return this.toast(p.id, 'Kamu tidak sedang berperang dengannya');
    if (p.lord) return this.toast(p.id, 'Negara boneka tidak bisa menyerah sendiri');
    if (T.lord) return this.toast(p.id, `${T.name} hanyalah negara boneka`);
    this.makeVassal(tid, p.id, true);
  }

  private cmdBreak(p: Player, tid: number): void {
    const r = this.getRel(p.id, tid);
    if (!r) return this.toast(p.id, 'Tidak ada ikatan untuk diakhiri');
    const t = this.tick;
    if (r.kind === 'nap') {
      if (r.until - t > CFG.napNotice) r.until = t + CFG.napNotice;
      return this.toast(p.id, `Pakta berakhir dalam ${Math.round(CFG.napNotice / TPS)} dtk`);
    }
    if (r.kind === 'alliance') {
      this.setRel(p.id, tid, 'truce', t + CFG.truceDur / 2);
      this.events.push({ k: 'pact-end', a: p.id, b: tid, kind: 'alliance' });
      return;
    }
    if (r.kind === 'vassal') {
      if (r.lord !== p.id) return this.toast(p.id, 'Untuk merdeka, nyatakan perang pada tuanmu');
      this.players[tid].lord = 0;
      this.setRel(p.id, tid, 'truce', t + CFG.truceDur / 2);
      this.events.push({ k: 'pact-end', a: p.id, b: tid, kind: 'vassal' });
      return;
    }
    this.toast(p.id, 'Tidak ada ikatan untuk diakhiri');
  }

  // ---------------------------------------------------------------- voting kemenangan
  /** Pemain manusia yang masih hidup — satu-satunya yang berhak memilih. */
  voters(): Player[] {
    return this.players.filter((p) => p && p.alive && p.kind === 'human');
  }

  private cmdVote(p: Player, end: boolean): void {
    const v = this.vote;
    if (!v || p.kind !== 'human') return;
    v.ballots[p.id] = end;
    if (p.id === v.leader && !end) return this.resolveVote(false); // pemimpin memilih lanjut: selesai
    this.tallyVote(false);
  }

  /**
   * Hasil: permainan berakhir bila pemimpin (jika manusia) memilih menang DAN mayoritas
   * manusia lain memilih menyerah. Yang tidak memilih sampai batas waktu dianggap "lanjut".
   */
  private tallyVote(force: boolean): void {
    const v = this.vote;
    if (!v) return;
    const voters = this.voters();
    if (!force && !voters.every((x) => x.id in v.ballots)) return;
    const leaderHuman = voters.some((x) => x.id === v.leader);
    const others = voters.filter((x) => x.id !== v.leader);
    const yes = others.filter((x) => v.ballots[x.id] === true).length;
    const othersOk = others.length === 0 || yes * 2 > others.length;
    const leaderOk = !leaderHuman || v.ballots[v.leader] === true;
    this.resolveVote(leaderOk && othersOk);
  }

  private resolveVote(end: boolean): void {
    const v = this.vote;
    if (!v) return;
    this.vote = null;
    this.voteCool = this.tick + CFG.voteCooldown;
    this.events.push({ k: 'vote-end', leader: v.leader, result: end ? 'end' : 'continue' });
    if (end) this.finish(v.leader, 'dominance');
  }

  // ---------------------------------------------------------------- politik internal (tiap detik)
  private politics(): void {
    const t = this.tick;
    let dirty = false;

    for (const r of this.rels.slice()) {
      if (r.until > 0 && t >= r.until && (r.kind === 'truce' || r.kind === 'nap')) {
        if (r.kind === 'nap') this.events.push({ k: 'pact-end', a: r.a, b: r.b, kind: 'nap' });
        this.setRel(r.a, r.b, 'peace');
      }
    }
    for (const o of this.offers.slice()) {
      if (t >= o.expires) {
        this.offers = this.offers.filter((x) => x !== o);
        this.blocks.push({ key: this.blockKey(o.from, o.to, o.kind), until: t + CFG.offerBlock });
      }
    }
    this.blocks = this.blocks.filter((b) => b.until > t);

    // Umur keterputusan tiap sel + hitung sel terputus per negara.
    const { w, h, owner, linked, cutAge, seen, queue } = this;
    const cut = new Int32Array(this.players.length);
    for (let c = 0; c < this.n; c++) {
      const o = owner[c];
      if (o === 0 || linked[c]) cutAge[c] = 0;
      else {
        if (cutAge[c] < 255) cutAge[c]++;
        cut[o]++;
      }
    }
    for (let id = 1; id < this.players.length; id++) {
      const p = this.players[id];
      if (!p.alive) continue;
      if (t - p.lossAt > CFG.moraleCalm && cut[id] * 4 <= p.cells) p.morale = Math.min(1, p.morale + CFG.moraleRegen);
    }

    // Blok terputus: terlalu kecil -> ditinggalkan; cukup besar -> memberontak jadi negara baru.
    seen.fill(0);
    for (let c = 0; c < this.n; c++) {
      const o = owner[c];
      if (o === 0 || linked[c] || seen[c]) continue;
      let qh = 0;
      let qt = 0;
      let ageSum = 0;
      queue[qt++] = c;
      seen[c] = 1;
      while (qh < qt) {
        const q = queue[qh++];
        ageSum += cutAge[q];
        const x = q % w;
        const y = (q - x) / w;
        if (x > 0 && owner[q - 1] === o && !linked[q - 1] && !seen[q - 1]) (seen[q - 1] = 1), (queue[qt++] = q - 1);
        if (x < w - 1 && owner[q + 1] === o && !linked[q + 1] && !seen[q + 1]) (seen[q + 1] = 1), (queue[qt++] = q + 1);
        if (y > 0 && owner[q - w] === o && !linked[q - w] && !seen[q - w]) (seen[q - w] = 1), (queue[qt++] = q - w);
        if (y < h - 1 && owner[q + w] === o && !linked[q + w] && !seen[q + w]) (seen[q + w] = 1), (queue[qt++] = q + w);
      }
      const pl = this.players[o];
      if (!pl || !pl.alive) continue;
      const comp = Array.from(queue.subarray(0, qt));
      const avg = ageSum / qt;
      if (qt >= CFG.revoltMin) {
        if (avg >= CFG.revoltAfter && hash2(t, comp[0], o) < CFG.revoltChance * (1.6 - pl.morale)) {
          this.revolt(pl, comp);
          dirty = true;
        }
      } else if (avg >= CFG.abandonAfter) {
        this.abandon(pl, comp);
        dirty = true;
      }
    }
    if (dirty) this.recompute();
  }

  /** Nama negara pemberontak: nama wilayah modern (peta nyata) bila ada, selain itu nama kerajaan lokal. */
  private rebelName(comp: number[]): string {
    const reg = this.map.region;
    const names = this.map.regionNames;
    if (reg && names) {
      const count = new Map<number, number>();
      let best = 0;
      let bestN = 0;
      for (const c of comp) {
        const r = reg[c];
        if (!r) continue;
        const n = (count.get(r) ?? 0) + 1;
        count.set(r, n);
        if (n > bestN || (n === bestN && r < best)) {
          best = r;
          bestN = n;
        }
      }
      if (best && names[best - 1]) return names[best - 1];
    }
    const base = REBEL_NAMES[this.rebels % REBEL_NAMES.length];
    return this.rebels >= REBEL_NAMES.length ? `${base} ${Math.floor(this.rebels / REBEL_NAMES.length) + 1}` : base;
  }

  /** Sel-sel `comp` milik `parent` melepaskan diri menjadi negara baru (atau jadi netral bila penuh). */
  private revolt(parent: Player, comp: number[]): void {
    if (this.players.length - 1 >= MAX_NATIONS) return this.abandon(parent, comp);
    const t = this.tick;
    const id = this.players.length;
    let name = this.rebelName(comp);
    this.rebels++;
    // Hindari nama kembar.
    if (this.players.some((q) => q && q.name === name)) {
      let k = 2;
      while (this.players.some((q) => q && q.name === `${name} ${k}`)) k++;
      name = `${name} ${k}`;
    }
    const share = comp.length / Math.max(1, parent.cells);
    const take = Math.min(parent.troops * 0.5, parent.troops * share * CFG.rebelShare);
    parent.troops -= take;
    const reb: Player = {
      id,
      name,
      kind: 'bot',
      difficulty: 'normal',
      alive: true,
      troops: Math.max(CFG.rebelMinTroops, take),
      cells: comp.length,
      linkedCells: comp.length,
      linkedMines: 0,
      mines: 0,
      capital: -1,
      shakenUntil: 0,
      blitzUntil: 0,
      shieldUntil: t + 200,
      blitzReady: 0,
      shieldReady: 0,
      income: 0,
      cap: CFG.capBase,
      peakCells: comp.length,
      diedAt: 0,
      morale: 0.7,
      lossAt: t,
      lord: 0,
    };
    this.players.push(reb);
    let mines = 0;
    for (const c of comp) {
      this.owner[c] = id;
      this.cutAge[c] = 0;
      this.changedAt[c] = t;
      if (this.feat[c] === F_MINE) mines++;
    }
    reb.mines = mines;
    parent.mines -= mines;
    parent.cells -= comp.length;
    for (const f of this.forts) if (this.owner[f.idx] === id) f.owner = id;
    this.relocateCapital(reb);
    parent.morale = Math.max(CFG.moraleMin, parent.morale - CFG.revoltMorale);
    parent.lossAt = t;
    this.setRel(parent.id, id, 'war');
    this.events.push({ k: 'revolt', parent: parent.id, rebel: id, idx: reb.capital, cells: comp.length });
  }

  /** Wilayah terputus kecil tanpa otoritas: dilepas jadi netral. */
  private abandon(pl: Player, comp: number[]): void {
    for (const c of comp) {
      const f = this.feat[c];
      if (f === F_MINE) pl.mines--;
      else if (f === F_FORT) {
        this.forts = this.forts.filter((x) => x.idx !== c);
        this.feat[c] = F_NONE;
      }
      this.owner[c] = 0;
      this.cutAge[c] = 0;
      this.changedAt[c] = this.tick;
    }
    pl.cells -= comp.length;
    pl.morale = Math.max(CFG.moraleMin, pl.morale - 0.03);
    this.events.push({ k: 'abandon', owner: pl.id, cells: comp.length });
    if (pl.cells <= 0) this.kill(pl, 0);
  }

  // ---------------------------------------------------------------- kondisi menang
  private checkWin(): void {
    const alive = this.players.filter((p) => p && p.alive);
    if (alive.length === 1 && this.playerCount > 1) {
      return this.finish(alive[0].id, 'last');
    }
    if (alive.length === 0) return this.finish(0, 'last');

    // Sel per blok (tuan + negara boneka dihitung bersama).
    const bloc = new Map<number, number>();
    for (const p of alive) {
      const r = this.rootOf(p.id);
      bloc.set(r, (bloc.get(r) ?? 0) + p.cells);
    }
    const roots = [...bloc.keys()];
    let leadId = roots[0];
    for (const r of roots) if (bloc.get(r)! > bloc.get(leadId)!) leadId = r;
    const leadCells = bloc.get(leadId)!;

    // Semua pihak tersisa bersekutu / satu blok -> kemenangan bersama.
    if (alive.length > 1 && this.tick >= 600) {
      let all = true;
      for (let i = 0; i < roots.length && all; i++)
        for (let j = i + 1; j < roots.length; j++)
          if (this.relKind(roots[i], roots[j]) !== 'alliance') {
            all = false;
            break;
          }
      if (all) return this.finish(leadId, 'bloc');
    }

    if (leadCells >= this.landTotal * CFG.domShare) {
      if (this.voters().length === 0) {
        // Tanpa pemain manusia (bot vs bot): kemenangan otomatis setelah bertahan.
        if (this.domPlayer !== leadId) {
          this.domPlayer = leadId;
          this.domSince = this.tick;
        } else if (this.tick - this.domSince >= CFG.domHold) {
          return this.finish(leadId, 'dominance');
        }
      } else {
        // Ada manusia: buka voting (lanjut atau akhiri) alih-alih menang otomatis.
        this.domPlayer = 0;
        if (this.vote && this.vote.leader !== leadId) {
          this.events.push({ k: 'vote-end', leader: this.vote.leader, result: 'cancel' });
          this.vote = null;
        }
        if (!this.vote && this.tick >= this.voteCool) {
          this.vote = { leader: leadId, endsAt: this.tick + CFG.voteTime, ballots: {} };
          this.events.push({ k: 'vote-start', leader: leadId });
        } else if (this.vote && this.tick >= this.vote.endsAt) {
          this.tallyVote(true);
          if (this.winner) return;
        }
      }
    } else {
      this.domPlayer = 0;
      if (this.vote) {
        this.events.push({ k: 'vote-end', leader: this.vote.leader, result: 'cancel' });
        this.vote = null;
      }
    }
    if (this.tick >= CFG.maxTicks) this.finish(leadId, 'time');
  }

  private finish(winner: number, reason: 'dominance' | 'last' | 'time' | 'bloc'): void {
    this.winner = winner || -1;
    this.winReason = reason;
    this.vote = null;
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
    const rels = [...this.rels].sort((x, y) => x.a * 256 + x.b - (y.a * 256 + y.b));
    const kinds = ['peace', 'war', 'truce', 'nap', 'alliance', 'vassal'];
    for (const r of rels) h = Math.imul(h ^ ((r.a * 256 + r.b) * 8 + kinds.indexOf(r.kind)), 16777619);
    for (let id = 1; id < this.players.length; id++) h = Math.imul(h ^ Math.floor(this.players[id].morale * 1000), 16777619);
    h = Math.imul(h ^ this.players.length, 16777619);
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
      rels: this.rels.map((r) => ({ ...r })),
      offers: this.offers.map((o) => ({ ...o })),
      blocks: this.blocks.map((b) => ({ ...b })),
      nextOfferId: this.nextOfferId,
      rebels: this.rebels,
      linked: b64(this.linked),
      cutAge: b64(this.cutAge),
      vote: this.vote ? { ...this.vote, ballots: { ...this.vote.ballots } } : null,
      voteCool: this.voteCool,
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
    this.rels = s.rels.map((r) => ({ ...r }));
    this.reindex();
    this.offers = s.offers.map((o) => ({ ...o }));
    this.blocks = s.blocks.map((b) => ({ ...b }));
    this.nextOfferId = s.nextOfferId;
    this.rebels = s.rebels;
    // `linked` ikut disalin (bukan dihitung ulang) agar identik dengan host walau snapshot di tengah detik.
    this.linked.set(unb64(s.linked));
    this.cutAge.set(unb64(s.cutAge));
    this.vote = s.vote ? { ...s.vote, ballots: { ...s.vote.ballots } } : null;
    this.voteCool = s.voteCool;
    this.changedAt.fill(s.tick);
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
  winReason: 'dominance' | 'last' | 'time' | 'bloc' | '';
  domPlayer: number;
  domSince: number;
  nextOid: number;
  rels: Relation[];
  offers: Offer[];
  blocks: { key: number; until: number }[];
  nextOfferId: number;
  rebels: number;
  linked: string;
  cutAge: string;
  vote: Vote | null;
  voteCool: number;
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
