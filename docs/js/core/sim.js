// Simulasi inti Panz Dominion — deterministik (hanya + - * / dan integer ops) supaya lockstep multiplayer sinkron.
// Mekanik khas: Garis Depan (multi-front), Ibu Kota & wilayah terputus, Benteng, tambang, Blitz & Perisai.
import { hash2 } from "./rng.js";
import { buildMap } from "./mapgen.js";
import { F_CAPITAL, F_FORT, F_MINE, F_NONE, MAX_NATIONS, OFFER_KINDS, REBEL_NAMES, T_WATER, TPS } from "./types.js";
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
    // kapal & pendaratan
    maxShips: 3, // kapal berlayar bersamaan per negara
    shipMin: 40, // pasukan minimum yang diangkut
    shipLoss: 0.1, // porsi pasukan hilang saat berlayar
    shipTpc: 4, // tick per sel pelayaran
    landingMult: 1.4, // pendaratan lebih mahal daripada serangan darat
    landingCells: 5, // luas kepala pantai (sel)
    seaLinkMax: 12, // jalur pelayaran maks per negara
    minCommit: 8,
    domShare: 0.6,
    domHold: 200,
    maxTicks: 12000,
    speedFrac: 0.06,
    speedMax: 10,
};
const KMAX = 24;
export class Sim {
    w;
    h;
    n;
    map;
    setup;
    terrain;
    feat;
    owner;
    linked;
    changedAt;
    players = [];
    offensives = [];
    ships = [];
    seaLinks = [];
    nextShipId = 1;
    landComp;
    coastCache = new Map();
    coastTick = -1;
    forts = [];
    tick = 0;
    events = [];
    winner = 0;
    winReason = '';
    domPlayer = 0;
    domSince = 0;
    nextOid = 1;
    landTotal;
    rels = [];
    offers = [];
    blocks = [];
    nextOfferId = 1;
    rebels = 0;
    cutAge;
    vote = null;
    voteCool = 0;
    relMap = new Map();
    seen;
    queue;
    visited;
    candIdx = new Int32Array(KMAX);
    candScore = new Float64Array(KMAX);
    constructor(setup) {
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
        this.landComp = this.computeLandComp();
        this.players.push(null);
        setup.players.forEach((ps, i) => {
            const spawn = this.map.spawns[i];
            const p = {
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
                    if (dx * dx + dy * dy > R * R + 1)
                        continue;
                    if (sx + dx < 0 || sx + dx >= this.w || sy + dy < 0 || sy + dy >= this.h)
                        continue;
                    const c = (sy + dy) * this.w + sx + dx;
                    if (this.terrain[c] === T_WATER)
                        continue;
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
    get playerCount() {
        return this.players.length - 1;
    }
    drainEvents() {
        const e = this.events;
        this.events = [];
        return e;
    }
    // ---------------------------------------------------------------- langkah utama
    step(cmds) {
        if (this.winner) {
            this.tick++;
            return;
        }
        for (const c of cmds)
            this.apply(c);
        // Iterasi pada salinan: capture()/kill() boleh mengubah daftar offensif di tengah jalan.
        for (const o of this.offensives.slice()) {
            if (!this.offensives.includes(o))
                continue;
            if (this.updateOffensive(o)) {
                const k = this.offensives.indexOf(o);
                if (k >= 0)
                    this.offensives.splice(k, 1);
            }
        }
        this.updateShips();
        for (let id = 1; id < this.players.length; id++) {
            const p = this.players[id];
            if (!p.alive)
                continue;
            // Otoritas negara hanya sebesar wilayah yang tersambung ke ibu kota.
            p.cap = CFG.capBase + CFG.capPerCell * p.linkedCells;
            const shaken = (this.tick < p.shakenUntil ? CFG.shakenIncome : 1) * (CFG.moraleIncome + (1 - CFG.moraleIncome) * p.morale);
            const base = (CFG.baseIncome * p.linkedCells + CFG.mineIncome * p.linkedMines) * shaken;
            const room = p.troops < p.cap ? 1 - p.troops / p.cap : 0;
            p.income = base + p.troops * CFG.interest * room * shaken;
            p.troops += p.income / TPS;
            if (p.troops > p.cap)
                p.troops -= (p.troops - p.cap) * 0.02;
        }
        // Upeti negara boneka ke tuannya.
        for (let id = 1; id < this.players.length; id++) {
            const v = this.players[id];
            if (!v.alive || !v.lord)
                continue;
            const l = this.players[v.lord];
            if (!l || !l.alive)
                continue;
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
    toast(p, msg) {
        this.events.push({ k: 'toast', p, msg });
    }
    apply(c) {
        const p = this.players[c.p];
        if (!p || !p.alive)
            return;
        switch (c.t) {
            case 'atk': {
                const idx = c.idx | 0;
                if (idx < 0 || idx >= this.n || this.terrain[idx] === T_WATER)
                    return;
                let target = this.owner[idx];
                if (target === p.id)
                    return;
                const pct = Math.min(100, Math.max(1, c.pct));
                const amount = Math.floor(p.troops * pct) / 100;
                if (amount < CFG.minCommit)
                    return this.toast(p.id, 'Pasukan terlalu sedikit');
                // "Maju ke arah": musuh belum berbatasan -> pasukan merambah lahan netral menuju titik yang diklik.
                let wide = c.wide;
                if (target !== 0) {
                    const bordering = this.frontier(p.id, target, idx, wide, 1) > 0;
                    // Menyerang negara lain wajib memutuskan perang dulu.
                    if (bordering && !this.atWar(p.id, target))
                        return this.toast(p.id, `Nyatakan perang dulu pada ${this.players[target].name}`);
                    if (!bordering) {
                        if (this.frontier(p.id, 0, idx, false, 1) === 0)
                            return this.toast(p.id, 'Tidak ada jalur menuju target');
                        target = 0;
                        wide = false;
                    }
                }
                let off = this.offensives.find((o) => o.owner === p.id && o.target === target);
                if (!off) {
                    if (this.countOffensives(p.id) >= CFG.maxOffensives)
                        return this.toast(p.id, 'Maksimal 4 garis depan');
                    if (this.frontier(p.id, target, idx, wide, 1) === 0)
                        return this.toast(p.id, 'Tidak berbatasan dengan target');
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
                if (idx < 0 || idx >= this.n || this.owner[idx] !== p.id)
                    return;
                if (this.feat[idx] !== F_NONE)
                    return this.toast(p.id, 'Sel ini sudah terpakai');
                const mine = this.forts.filter((f) => f.owner === p.id).length;
                if (mine >= CFG.fortMax)
                    return this.toast(p.id, 'Maksimal 4 benteng');
                const cost = this.fortCost(p);
                if (p.troops < cost)
                    return this.toast(p.id, 'Pasukan kurang untuk benteng');
                p.troops -= cost;
                this.feat[idx] = F_FORT;
                this.forts.push({ idx, owner: p.id, readyAt: this.tick + CFG.fortBuild });
                this.events.push({ k: 'fort-built', owner: p.id, idx });
                return;
            }
            case 'blitz':
                if (this.tick < p.blitzReady)
                    return;
                p.blitzUntil = this.tick + CFG.blitzDur;
                p.blitzReady = this.tick + CFG.blitzCd;
                return;
            case 'shield':
                if (this.tick < p.shieldReady)
                    return;
                p.shieldUntil = this.tick + CFG.shieldDur;
                p.shieldReady = this.tick + CFG.shieldCd;
                return;
            case 'ship':
                return this.cmdShip(p, c.idx | 0, c.pct);
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
    countOffensives(p) {
        let k = 0;
        for (const o of this.offensives)
            if (o.owner === p)
                k++;
        return k;
    }
    fortCost(p) {
        return Math.floor(CFG.fortBase + CFG.fortPerCell * p.cells);
    }
    // ---------------------------------------------------------------- serangan
    /** Cari sel target yang bersinggungan dengan wilayah `att`; simpan k terbaik di candIdx. Mengembalikan jumlah kandidat. */
    frontier(att, target, focus, wide, k) {
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
                if (owner[c] !== target || terrain[c] === T_WATER)
                    continue;
                if (!((x > 0 && owner[c - 1] === att) || (x < w - 1 && owner[c + 1] === att) || (y > 0 && owner[c - w] === att) || (y < h - 1 && owner[c + w] === att)))
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
                }
                else if (score < cs[k - 1]) {
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
    cellCost(a, c) {
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
        if (f === F_CAPITAL)
            m *= CFG.capitalMult;
        let fm = 1;
        for (const fort of this.forts) {
            if (fort.owner !== ownerId || fort.readyAt > this.tick)
                continue;
            const fx = fort.idx % this.w;
            const fy = (fort.idx - fx) / this.w;
            const cx = c % this.w;
            const cy = (c - cx) / this.w;
            const dist = Math.abs(fx - cx) + Math.abs(fy - cy);
            if (dist === 0)
                fm = Math.max(fm, CFG.fortOn);
            else if (dist <= CFG.fortRadius)
                fm = Math.max(fm, CFG.fortNear);
        }
        m *= fm;
        if (!this.linked[c])
            m *= CFG.disconnectedMult;
        if (this.tick < d.shieldUntil)
            m *= CFG.shieldMult;
        m *= CFG.moraleDefense + (1 - CFG.moraleDefense) * d.morale; // negara goyah lebih mudah ditaklukkan
        return m;
    }
    /** Kembalikan true bila offensive selesai. */
    updateOffensive(o) {
        const att = this.players[o.owner];
        if (!att.alive)
            return true;
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
        const picks = [];
        for (let i = 0; i < Math.min(count, KMAX); i++)
            picks.push(this.candIdx[i]);
        let taken = 0;
        for (const c of picks) {
            if (taken >= speed)
                break;
            if (this.owner[c] !== o.target)
                continue;
            const cost = this.cellCost(att, c);
            if (o.pool < cost)
                continue;
            o.pool -= cost;
            o.gained++;
            taken++;
            this.capture(att, def, c, cost);
            if (def && !def.alive)
                break;
        }
        if (taken === 0) {
            att.troops += o.pool;
            return true;
        }
        return false;
    }
    capture(att, def, c, cost) {
        const wasLinked = this.linked[c] === 1;
        const f = this.feat[c];
        this.owner[c] = att.id;
        this.linked[c] = 1;
        this.changedAt[c] = this.tick;
        att.cells++;
        att.linkedCells++;
        if (att.cells > att.peakCells)
            att.peakCells = att.cells;
        if (f === F_MINE) {
            att.mines++;
            att.linkedMines++;
        }
        if (!def)
            return;
        def.cells--;
        if (wasLinked)
            def.linkedCells = Math.max(0, def.linkedCells - 1);
        def.troops = Math.max(0, def.troops - cost * CFG.casualty);
        def.lossAt = this.tick;
        let loss = CFG.moraleCell;
        if (f === F_MINE)
            loss += CFG.moraleMine;
        else if (f === F_FORT)
            loss += CFG.moraleFort;
        def.morale = Math.max(CFG.moraleMin, def.morale - loss);
        if (f === F_MINE) {
            def.mines--;
            if (wasLinked)
                def.linkedMines = Math.max(0, def.linkedMines - 1);
        }
        else if (f === F_FORT) {
            this.forts = this.forts.filter((x) => x.idx !== c);
            this.feat[c] = F_NONE;
            this.events.push({ k: 'fort-lost', victim: def.id, by: att.id, idx: c });
        }
        else if (f === F_CAPITAL) {
            this.feat[c] = F_NONE;
            def.capital = -1;
            const loot = def.troops * CFG.plunder;
            def.troops -= loot;
            att.troops += loot;
            def.shakenUntil = this.tick + CFG.shakenDur;
            // Ibu kota jatuh: moral hancur & pasukan yang sedang berperang kocar-kacir.
            def.morale = Math.min(def.morale, CFG.moraleCapital);
            for (const of of this.offensives)
                if (of.owner === def.id)
                    of.pool *= 1 - CFG.capitalStun;
            this.events.push({ k: 'capital', victim: def.id, by: att.id, idx: c });
        }
        if (def.cells <= 0)
            this.kill(def, att.id);
    }
    kill(def, by) {
        def.alive = false;
        def.cells = 0;
        def.troops = 0;
        def.diedAt = this.tick;
        this.offensives = this.offensives.filter((o) => {
            if (o.owner === def.id)
                return false;
            return true;
        });
        this.forts = this.forts.filter((f) => f.owner !== def.id);
        this.ships = this.ships.filter((sh) => sh.owner !== def.id);
        for (const r of this.rels.slice())
            if (r.a === def.id || r.b === def.id)
                this.setRel(r.a, r.b, 'peace');
        for (const q of this.players)
            if (q && q.lord === def.id)
                q.lord = 0;
        def.lord = 0;
        this.offers = this.offers.filter((o) => o.from !== def.id && o.to !== def.id);
        if (this.vote)
            delete this.vote.ballots[def.id];
        this.events.push({ k: 'dead', victim: def.id, by });
    }
    // ---------------------------------------------------------------- kapal & pendaratan
    computeLandComp() {
        const { w, h, terrain } = this;
        const comp = new Int32Array(this.n).fill(-1);
        const q = new Int32Array(this.n);
        let id = 0;
        for (let s = 0; s < this.n; s++) {
            if (terrain[s] === T_WATER || comp[s] >= 0)
                continue;
            let qh = 0;
            let qt = 0;
            q[qt++] = s;
            comp[s] = id;
            while (qh < qt) {
                const c = q[qh++];
                const x = c % w;
                const y = (c - x) / w;
                if (x > 0 && terrain[c - 1] !== T_WATER && comp[c - 1] < 0)
                    (comp[c - 1] = id), (q[qt++] = c - 1);
                if (x < w - 1 && terrain[c + 1] !== T_WATER && comp[c + 1] < 0)
                    (comp[c + 1] = id), (q[qt++] = c + 1);
                if (y > 0 && terrain[c - w] !== T_WATER && comp[c - w] < 0)
                    (comp[c - w] = id), (q[qt++] = c - w);
                if (y < h - 1 && terrain[c + w] !== T_WATER && comp[c + w] < 0)
                    (comp[c + w] = id), (q[qt++] = c + w);
            }
            id++;
        }
        return comp;
    }
    /** Apakah negara `pid` punya wilayah di daratan (pulau/benua) nomor `comp`? Menentukan perlu kapal atau tidak. */
    ownsLandmass(pid, comp) {
        for (let c = 0; c < this.n; c++)
            if (this.owner[c] === pid && this.landComp[c] === comp)
                return true;
        return false;
    }
    /** Sel darat yang berbatasan langsung dengan laut dalam (tempat kapal bersandar / mendarat). */
    isCoastal(c) {
        const { w, h, terrain } = this;
        if (terrain[c] === T_WATER)
            return false;
        const x = c % w;
        const y = (c - x) / w;
        return (x > 0 && terrain[c - 1] === T_WATER) || (x < w - 1 && terrain[c + 1] === T_WATER) || (y > 0 && terrain[c - w] === T_WATER) || (y < h - 1 && terrain[c + w] === T_WATER);
    }
    /** Sel pesisir milik `pid` (cache per tick; hanya untuk bot/UI — perintah memakai hitungan segar). */
    ownedCoast(pid, fresh = false) {
        if (!fresh) {
            if (this.coastTick !== this.tick) {
                this.coastCache.clear();
                this.coastTick = this.tick;
            }
            const hit = this.coastCache.get(pid);
            if (hit)
                return hit;
        }
        const out = [];
        for (let c = 0; c < this.n; c++)
            if (this.owner[c] === pid && this.isCoastal(c))
                out.push(c);
        if (!fresh)
            this.coastCache.set(pid, out);
        return out;
    }
    /** Garis pelayaran a->b harus melewati laut (maks 30% daratan) agar tidak "menembus" daratan. */
    seaLaneOk(a, b) {
        const { w } = this;
        const ax = a % w;
        const ay = (a - ax) / w;
        const bx = b % w;
        const by = (b - bx) / w;
        const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        if (steps < 2)
            return false;
        let water = 0;
        let land = 0;
        for (let i = 1; i < steps; i++) {
            const x = Math.round(ax + ((bx - ax) * i) / steps);
            const y = Math.round(ay + ((by - ay) * i) / steps);
            if (this.terrain[y * w + x] === T_WATER)
                water++;
            else
                land++;
        }
        return water >= 2 && land <= (steps - 1) * 0.3;
    }
    /** Pelabuhan asal terbaik untuk berlayar ke `idx`: sel pesisir terdekat dalam jangkauan dengan jalur laut valid. */
    shipPlan(pid, idx, fresh = false) {
        const { w } = this;
        const R = this.map.shipRange;
        const tx = idx % w;
        const ty = (idx - tx) / w;
        const cands = [];
        for (const c of this.ownedCoast(pid, fresh)) {
            const dx = (c % w) - tx;
            const dy = Math.floor(c / w) - ty;
            const d2 = dx * dx + dy * dy;
            if (d2 <= R * R)
                cands.push({ c, d2 });
        }
        cands.sort((a, b) => a.d2 - b.d2 || a.c - b.c);
        for (let i = 0; i < Math.min(10, cands.length); i++) {
            if (this.seaLaneOk(cands[i].c, idx))
                return { src: cands[i].c, dist: Math.sqrt(cands[i].d2) };
        }
        return null;
    }
    /** Alasan kapal tak bisa berlayar ke `idx` ('' = bisa). */
    shipError(p, idx, fresh = false) {
        if (idx < 0 || idx >= this.n || this.terrain[idx] === T_WATER)
            return 'Itu laut — pilih daratan tujuan';
        const ow = this.owner[idx];
        if (ow === p.id)
            return 'Itu sudah wilayahmu';
        if (!this.isCoastal(idx))
            return 'Kapal hanya bisa mendarat di pantai';
        if (ow !== 0 && !this.atWar(p.id, ow))
            return `Nyatakan perang dulu pada ${this.players[ow].name}`;
        if (this.ships.filter((s) => s.owner === p.id).length >= CFG.maxShips)
            return `Maksimal ${CFG.maxShips} kapal berlayar`;
        if (!this.shipPlan(p.id, idx, fresh))
            return `Di luar jangkauan kapal (maks ${this.map.shipRange} sel dari pesisirmu, tanpa melintasi daratan)`;
        return '';
    }
    cmdShip(p, idx, pct) {
        const err = this.shipError(p, idx, true);
        if (err)
            return this.toast(p.id, err);
        const amount = Math.floor(p.troops * Math.min(100, Math.max(1, pct))) / 100;
        if (amount < CFG.shipMin)
            return this.toast(p.id, `Pasukan kurang untuk berlayar (min ${CFG.shipMin})`);
        const plan = this.shipPlan(p.id, idx, true);
        p.troops -= amount;
        const pool = amount * (1 - CFG.shipLoss);
        const travel = Math.max(10, Math.ceil(plan.dist * CFG.shipTpc));
        this.ships.push({ id: this.nextShipId++, owner: p.id, from: plan.src, to: idx, depart: this.tick, arrive: this.tick + travel, pool });
    }
    updateShips() {
        if (!this.ships.length)
            return;
        const arrived = this.ships.filter((s) => this.tick >= s.arrive);
        if (!arrived.length)
            return;
        this.ships = this.ships.filter((s) => this.tick < s.arrive);
        for (const s of arrived)
            this.landShip(s);
    }
    /** Pendaratan: rebut kepala pantai, buka jalur pelayaran, lalu lanjutkan sebagai serangan biasa. */
    landShip(s) {
        const att = this.players[s.owner];
        if (!att || !att.alive)
            return;
        const to = s.to;
        let pool = s.pool;
        const ow = this.owner[to];
        if (ow === att.id) {
            att.troops += pool;
            return;
        }
        if (ow !== 0 && !this.atWar(att.id, ow)) {
            att.troops += pool;
            return this.toast(att.id, 'Pendaratan dibatalkan — tidak lagi berperang');
        }
        const def = ow ? this.players[ow] : null;
        const { w, h } = this;
        const x = to % w;
        const y = (to - x) / w;
        const cells = [to];
        const nb = [x > 0 ? to - 1 : -1, x < w - 1 ? to + 1 : -1, y > 0 ? to - w : -1, y < h - 1 ? to + w : -1];
        for (const c of nb)
            if (c >= 0 && this.terrain[c] !== T_WATER && this.owner[c] === ow && cells.length < CFG.landingCells)
                cells.push(c);
        let landed = 0;
        for (const c of cells) {
            if (this.owner[c] !== ow)
                continue;
            const cost = this.cellCost(att, c) * CFG.landingMult;
            if (pool < cost)
                break;
            pool -= cost;
            this.capture(att, def, c, cost);
            landed++;
            if (def && !def.alive)
                break;
        }
        if (landed === 0) {
            att.troops += pool * 0.5; // pendaratan gagal: separuh pasukan selamat kembali
            this.events.push({ k: 'landing', owner: att.id, target: ow, idx: to, ok: false });
            return this.toast(att.id, 'Pendaratan gagal — pertahanan terlalu kuat');
        }
        // jalur pelayaran agar wilayah seberang tetap terhubung ke ibu kota
        const mine = this.seaLinks.filter((l) => l.owner === att.id);
        if (mine.length >= CFG.seaLinkMax)
            this.seaLinks.splice(this.seaLinks.indexOf(mine[0]), 1);
        if (this.owner[s.from] === att.id)
            this.seaLinks.push({ owner: att.id, a: s.from, b: to });
        this.events.push({ k: 'landing', owner: att.id, target: ow, idx: to, ok: true });
        // sisa pasukan melanjutkan serangan dari kepala pantai
        if (pool >= CFG.minCommit && att.alive) {
            const off = this.offensives.find((o) => o.owner === att.id && o.target === ow);
            if (off) {
                off.pool += pool;
                off.startPool += pool;
                off.focus = to;
            }
            else if (this.countOffensives(att.id) < CFG.maxOffensives) {
                this.offensives.push({ id: this.nextOid++, owner: att.id, target: ow, focus: to, wide: false, pool, startPool: pool, gained: landed });
            }
            else
                att.troops += pool;
        }
        else
            att.troops += pool;
    }
    // ---------------------------------------------------------------- konektivitas ibu kota
    recompute() {
        const { w, h, owner, queue, visited, feat } = this;
        visited.fill(0);
        // Jalur pelayaran aktif hanya bila kedua ujungnya masih milik pemiliknya.
        this.seaLinks = this.seaLinks.filter((l) => owner[l.a] === l.owner && owner[l.b] === l.owner && this.players[l.owner]?.alive);
        const adj = new Map();
        for (const l of this.seaLinks) {
            (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)).push(l.b);
            (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)).push(l.a);
        }
        for (let id = 1; id < this.players.length; id++) {
            const p = this.players[id];
            if (!p.alive)
                continue;
            if (p.capital < 0 || owner[p.capital] !== id)
                this.relocateCapital(p);
            p.linkedCells = 0;
            p.linkedMines = 0;
            if (p.capital < 0)
                continue;
            let qh = 0;
            let qt = 0;
            queue[qt++] = p.capital;
            visited[p.capital] = 1;
            while (qh < qt) {
                const c = queue[qh++];
                p.linkedCells++;
                if (feat[c] === F_MINE)
                    p.linkedMines++;
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
                const ex = adj.get(c);
                if (ex) {
                    for (const d of ex) {
                        if (owner[d] === id && !visited[d]) {
                            visited[d] = 1;
                            queue[qt++] = d;
                        }
                    }
                }
            }
        }
        for (let c = 0; c < this.n; c++)
            this.linked[c] = owner[c] === 0 || visited[c] ? 1 : 0;
    }
    relocateCapital(p) {
        let sx = 0;
        let sy = 0;
        let cnt = 0;
        for (let c = 0; c < this.n; c++) {
            if (this.owner[c] !== p.id)
                continue;
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
            if (this.owner[c] !== p.id)
                continue;
            fallback = c;
            if (this.feat[c] !== F_NONE)
                continue;
            const dx = (c % this.w) - mx;
            const dy = Math.floor(c / this.w) - my;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = c;
            }
        }
        if (best < 0)
            best = fallback;
        p.capital = best;
        this.feat[best] = F_CAPITAL;
    }
    // ---------------------------------------------------------------- diplomasi
    rk(a, b) {
        return a < b ? a * 256 + b : b * 256 + a;
    }
    getRel(a, b) {
        return this.relMap.get(this.rk(a, b));
    }
    relKind(a, b) {
        return this.getRel(a, b)?.kind ?? 'peace';
    }
    atWar(a, b) {
        return a !== b && a > 0 && b > 0 && this.relKind(a, b) === 'war';
    }
    /** Daftar id negara yang sedang berperang dengan `id`. */
    enemiesOf(id) {
        const out = [];
        for (let z = 1; z < this.players.length; z++)
            if (this.players[z].alive && this.atWar(id, z))
                out.push(z);
        return out;
    }
    setRel(a, b, kind, until = 0, lord = 0) {
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
        const r = { a: Math.min(a, b), b: Math.max(a, b), kind, since: this.tick, until, lord };
        this.rels.push(r);
        this.relMap.set(key, r);
    }
    reindex() {
        this.relMap.clear();
        for (const r of this.rels)
            this.relMap.set(r.a * 256 + r.b, r);
    }
    /** Akar blok: tuan bila negara boneka, selain itu dirinya sendiri. */
    rootOf(id) {
        const p = this.players[id];
        return p && p.lord && this.players[p.lord]?.alive ? p.lord : id;
    }
    /** Total sel satu blok (tuan + semua negara bonekanya). */
    blocCells(root) {
        let n = 0;
        for (let z = 1; z < this.players.length; z++) {
            const p = this.players[z];
            if (p.alive && this.rootOf(z) === root)
                n += p.cells;
        }
        return n;
    }
    /** Satu pihak? (blok yang sama, atau bersekutu bila `allies`). */
    sameSide(a, b, allies = false) {
        if (a === b)
            return true;
        if (this.rootOf(a) === this.rootOf(b))
            return true;
        return allies && this.relKind(this.rootOf(a), this.rootOf(b)) === 'alliance';
    }
    /** Alasan perang tidak bisa dinyatakan; string kosong bila boleh. */
    canDeclareWar(a, b) {
        const A = this.players[a];
        const B = this.players[b];
        if (!A || !B || !A.alive || !B.alive || a === b)
            return 'Target tidak valid';
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
                if (r.lord === a)
                    return 'Lepaskan negara bonekamu dulu';
                return '';
        }
        if (A.lord && A.lord !== b)
            return 'Negara boneka tidak bisa menyatakan perang sendiri';
        return '';
    }
    cmdWar(p, tid) {
        const why = this.canDeclareWar(p.id, tid);
        if (why)
            return this.toast(p.id, why);
        this.declareWar(p.id, tid);
    }
    declareWar(a, b) {
        let why = 'declare';
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
    joinWars(att, def) {
        for (let z = 1; z < this.players.length; z++) {
            const zp = this.players[z];
            if (!zp.alive || z === att || z === def)
                continue;
            if (zp.lord === att) {
                if (this.relKind(z, def) === 'peace') {
                    this.setRel(z, def, 'war');
                    this.events.push({ k: 'war', by: z, target: def, why: 'join' });
                }
            }
            else if (this.relKind(z, def) === 'alliance' || zp.lord === def || this.players[def].lord === z) {
                if (this.players[att].lord !== z && this.relKind(z, att) === 'peace') {
                    this.setRel(z, att, 'war');
                    this.events.push({ k: 'war', by: z, target: att, why: 'join' });
                }
            }
        }
    }
    cancelBetween(a, b) {
        this.offensives = this.offensives.filter((o) => {
            if ((o.owner === a && o.target === b) || (o.owner === b && o.target === a)) {
                this.players[o.owner].troops += o.pool;
                return false;
            }
            return true;
        });
    }
    blockKey(from, to, kind) {
        return (from * 256 + to) * 8 + OFFER_KINDS.indexOf(kind);
    }
    /** Validitas hubungan untuk jenis tawaran (tanpa memeriksa duplikat/cooldown). */
    relError(a, b, kind) {
        const A = this.players[a];
        const B = this.players[b];
        if (!A || !B || !A.alive || !B.alive || a === b)
            return 'Target tidak valid';
        if (A.lord)
            return 'Negara boneka tidak bisa berdiplomasi sendiri';
        if (B.lord)
            return `${B.name} adalah negara boneka ${this.players[B.lord].name}`;
        const rk = this.relKind(a, b);
        switch (kind) {
            case 'peace':
                if (rk !== 'war')
                    return 'Tidak sedang berperang';
                break;
            case 'nap':
                if (rk === 'war')
                    return 'Akhiri perang dulu';
                if (rk !== 'peace' && rk !== 'truce')
                    return 'Sudah ada ikatan';
                break;
            case 'alliance':
                if (rk === 'war')
                    return 'Akhiri perang dulu';
                if (rk === 'alliance')
                    return 'Sudah bersekutu';
                break;
            case 'vassal':
                if (rk === 'alliance')
                    return 'Putuskan aliansi dulu';
                break;
        }
        return '';
    }
    /** Alasan tawaran tidak bisa dikirim; string kosong bila boleh. */
    offerError(a, b, kind) {
        const e = this.relError(a, b, kind);
        if (e)
            return e;
        if (this.offers.some((o) => o.from === a && o.to === b && o.kind === kind))
            return 'Tawaran masih menunggu jawaban';
        const key = this.blockKey(a, b, kind);
        if (this.blocks.some((x) => x.key === key && x.until > this.tick))
            return 'Baru saja ditolak — coba lagi nanti';
        return '';
    }
    cmdOffer(p, tid, kind) {
        if (!OFFER_KINDS.includes(kind))
            return;
        const err = this.offerError(p.id, tid, kind);
        if (err)
            return this.toast(p.id, err);
        const rev = this.offers.find((o) => o.from === tid && o.to === p.id && o.kind === kind);
        if (rev)
            return this.settle(rev, true);
        this.offers.push({ id: this.nextOfferId++, from: p.id, to: tid, kind, expires: this.tick + CFG.offerTtl });
        this.events.push({ k: 'offer', from: p.id, to: tid, kind });
    }
    cmdReply(p, id, accept) {
        const o = this.offers.find((x) => x.id === id && x.to === p.id);
        if (o)
            this.settle(o, accept);
    }
    settle(o, accept) {
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
    makePeace(a, b) {
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
    makeVassal(lordId, vId, surrender) {
        const t = this.tick;
        const v = this.players[vId];
        for (const q of this.players) {
            if (q && q.alive && q.lord === vId) {
                q.lord = 0;
                this.setRel(q.id, vId, 'truce', t + CFG.truceDur / 2);
            }
        }
        for (let z = 1; z < this.players.length; z++) {
            if (z === vId || z === lordId || !this.players[z].alive)
                continue;
            const k = this.relKind(vId, z);
            if (k === 'alliance' || k === 'nap')
                this.setRel(vId, z, 'peace');
        }
        this.cancelBetween(lordId, vId);
        this.setRel(lordId, vId, 'vassal', 0, lordId);
        v.lord = lordId;
        for (let z = 1; z < this.players.length; z++) {
            if (z === vId || z === lordId || !this.players[z].alive)
                continue;
            const lw = this.atWar(lordId, z);
            const vw = this.atWar(vId, z);
            if (vw && !lw) {
                this.cancelBetween(vId, z);
                this.setRel(vId, z, 'truce', t + CFG.truceDur);
            }
            else if (lw && !vw) {
                const k = this.relKind(vId, z);
                if (k === 'peace' || k === 'truce' || k === 'nap')
                    this.setRel(vId, z, 'war');
            }
        }
        this.offers = this.offers.filter((o) => o.from !== vId && o.to !== vId);
        this.events.push({ k: 'vassal', lord: lordId, vassal: vId, surrender });
    }
    cmdSurrender(p, tid) {
        const T = this.players[tid];
        if (!T || !T.alive || !this.atWar(p.id, tid))
            return this.toast(p.id, 'Kamu tidak sedang berperang dengannya');
        if (p.lord)
            return this.toast(p.id, 'Negara boneka tidak bisa menyerah sendiri');
        if (T.lord)
            return this.toast(p.id, `${T.name} hanyalah negara boneka`);
        this.makeVassal(tid, p.id, true);
    }
    cmdBreak(p, tid) {
        const r = this.getRel(p.id, tid);
        if (!r)
            return this.toast(p.id, 'Tidak ada ikatan untuk diakhiri');
        const t = this.tick;
        if (r.kind === 'nap') {
            if (r.until - t > CFG.napNotice)
                r.until = t + CFG.napNotice;
            return this.toast(p.id, `Pakta berakhir dalam ${Math.round(CFG.napNotice / TPS)} dtk`);
        }
        if (r.kind === 'alliance') {
            this.setRel(p.id, tid, 'truce', t + CFG.truceDur / 2);
            this.events.push({ k: 'pact-end', a: p.id, b: tid, kind: 'alliance' });
            return;
        }
        if (r.kind === 'vassal') {
            if (r.lord !== p.id)
                return this.toast(p.id, 'Untuk merdeka, nyatakan perang pada tuanmu');
            this.players[tid].lord = 0;
            this.setRel(p.id, tid, 'truce', t + CFG.truceDur / 2);
            this.events.push({ k: 'pact-end', a: p.id, b: tid, kind: 'vassal' });
            return;
        }
        this.toast(p.id, 'Tidak ada ikatan untuk diakhiri');
    }
    // ---------------------------------------------------------------- voting kemenangan
    /** Pemain manusia yang masih hidup — satu-satunya yang berhak memilih. */
    voters() {
        return this.players.filter((p) => p && p.alive && p.kind === 'human');
    }
    cmdVote(p, end) {
        const v = this.vote;
        if (!v || p.kind !== 'human')
            return;
        v.ballots[p.id] = end;
        if (p.id === v.leader && !end)
            return this.resolveVote(false); // pemimpin memilih lanjut: selesai
        this.tallyVote(false);
    }
    /**
     * Hasil: permainan berakhir bila pemimpin (jika manusia) memilih menang DAN mayoritas
     * manusia lain memilih menyerah. Yang tidak memilih sampai batas waktu dianggap "lanjut".
     */
    tallyVote(force) {
        const v = this.vote;
        if (!v)
            return;
        const voters = this.voters();
        if (!force && !voters.every((x) => x.id in v.ballots))
            return;
        const leaderHuman = voters.some((x) => x.id === v.leader);
        const others = voters.filter((x) => x.id !== v.leader);
        const yes = others.filter((x) => v.ballots[x.id] === true).length;
        const othersOk = others.length === 0 || yes * 2 > others.length;
        const leaderOk = !leaderHuman || v.ballots[v.leader] === true;
        this.resolveVote(leaderOk && othersOk);
    }
    resolveVote(end) {
        const v = this.vote;
        if (!v)
            return;
        this.vote = null;
        this.voteCool = this.tick + CFG.voteCooldown;
        this.events.push({ k: 'vote-end', leader: v.leader, result: end ? 'end' : 'continue' });
        if (end)
            this.finish(v.leader, 'dominance');
    }
    // ---------------------------------------------------------------- politik internal (tiap detik)
    politics() {
        const t = this.tick;
        let dirty = false;
        for (const r of this.rels.slice()) {
            if (r.until > 0 && t >= r.until && (r.kind === 'truce' || r.kind === 'nap')) {
                if (r.kind === 'nap')
                    this.events.push({ k: 'pact-end', a: r.a, b: r.b, kind: 'nap' });
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
            if (o === 0 || linked[c])
                cutAge[c] = 0;
            else {
                if (cutAge[c] < 255)
                    cutAge[c]++;
                cut[o]++;
            }
        }
        for (let id = 1; id < this.players.length; id++) {
            const p = this.players[id];
            if (!p.alive)
                continue;
            if (t - p.lossAt > CFG.moraleCalm && cut[id] * 4 <= p.cells)
                p.morale = Math.min(1, p.morale + CFG.moraleRegen);
        }
        // Blok terputus: terlalu kecil -> ditinggalkan; cukup besar -> memberontak jadi negara baru.
        seen.fill(0);
        for (let c = 0; c < this.n; c++) {
            const o = owner[c];
            if (o === 0 || linked[c] || seen[c])
                continue;
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
                if (x > 0 && owner[q - 1] === o && !linked[q - 1] && !seen[q - 1])
                    (seen[q - 1] = 1), (queue[qt++] = q - 1);
                if (x < w - 1 && owner[q + 1] === o && !linked[q + 1] && !seen[q + 1])
                    (seen[q + 1] = 1), (queue[qt++] = q + 1);
                if (y > 0 && owner[q - w] === o && !linked[q - w] && !seen[q - w])
                    (seen[q - w] = 1), (queue[qt++] = q - w);
                if (y < h - 1 && owner[q + w] === o && !linked[q + w] && !seen[q + w])
                    (seen[q + w] = 1), (queue[qt++] = q + w);
            }
            const pl = this.players[o];
            if (!pl || !pl.alive)
                continue;
            const comp = Array.from(queue.subarray(0, qt));
            const avg = ageSum / qt;
            if (qt >= CFG.revoltMin) {
                if (avg >= CFG.revoltAfter && hash2(t, comp[0], o) < CFG.revoltChance * (1.6 - pl.morale)) {
                    this.revolt(pl, comp);
                    dirty = true;
                }
            }
            else if (avg >= CFG.abandonAfter) {
                this.abandon(pl, comp);
                dirty = true;
            }
        }
        if (dirty)
            this.recompute();
    }
    /** Nama negara pemberontak: nama wilayah modern (peta nyata) bila ada, selain itu nama kerajaan lokal. */
    rebelName(comp) {
        const reg = this.map.region;
        const names = this.map.regionNames;
        if (reg && names) {
            const count = new Map();
            let best = 0;
            let bestN = 0;
            for (const c of comp) {
                const r = reg[c];
                if (!r)
                    continue;
                const n = (count.get(r) ?? 0) + 1;
                count.set(r, n);
                if (n > bestN || (n === bestN && r < best)) {
                    best = r;
                    bestN = n;
                }
            }
            if (best && names[best - 1])
                return names[best - 1];
        }
        const base = REBEL_NAMES[this.rebels % REBEL_NAMES.length];
        return this.rebels >= REBEL_NAMES.length ? `${base} ${Math.floor(this.rebels / REBEL_NAMES.length) + 1}` : base;
    }
    /** Sel-sel `comp` milik `parent` melepaskan diri menjadi negara baru (atau jadi netral bila penuh). */
    revolt(parent, comp) {
        if (this.players.length - 1 >= MAX_NATIONS)
            return this.abandon(parent, comp);
        const t = this.tick;
        const id = this.players.length;
        let name = this.rebelName(comp);
        this.rebels++;
        // Hindari nama kembar.
        if (this.players.some((q) => q && q.name === name)) {
            let k = 2;
            while (this.players.some((q) => q && q.name === `${name} ${k}`))
                k++;
            name = `${name} ${k}`;
        }
        const share = comp.length / Math.max(1, parent.cells);
        const take = Math.min(parent.troops * 0.5, parent.troops * share * CFG.rebelShare);
        parent.troops -= take;
        const reb = {
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
            if (this.feat[c] === F_MINE)
                mines++;
        }
        reb.mines = mines;
        parent.mines -= mines;
        parent.cells -= comp.length;
        for (const f of this.forts)
            if (this.owner[f.idx] === id)
                f.owner = id;
        this.relocateCapital(reb);
        parent.morale = Math.max(CFG.moraleMin, parent.morale - CFG.revoltMorale);
        parent.lossAt = t;
        this.setRel(parent.id, id, 'war');
        this.events.push({ k: 'revolt', parent: parent.id, rebel: id, idx: reb.capital, cells: comp.length });
    }
    /** Wilayah terputus kecil tanpa otoritas: dilepas jadi netral. */
    abandon(pl, comp) {
        for (const c of comp) {
            const f = this.feat[c];
            if (f === F_MINE)
                pl.mines--;
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
        if (pl.cells <= 0)
            this.kill(pl, 0);
    }
    // ---------------------------------------------------------------- kondisi menang
    checkWin() {
        const alive = this.players.filter((p) => p && p.alive);
        if (alive.length === 1 && this.playerCount > 1) {
            return this.finish(alive[0].id, 'last');
        }
        if (alive.length === 0)
            return this.finish(0, 'last');
        // Sel per blok (tuan + negara boneka dihitung bersama).
        const bloc = new Map();
        for (const p of alive) {
            const r = this.rootOf(p.id);
            bloc.set(r, (bloc.get(r) ?? 0) + p.cells);
        }
        const roots = [...bloc.keys()];
        let leadId = roots[0];
        for (const r of roots)
            if (bloc.get(r) > bloc.get(leadId))
                leadId = r;
        const leadCells = bloc.get(leadId);
        // Semua pihak tersisa bersekutu / satu blok -> kemenangan bersama.
        if (alive.length > 1 && this.tick >= 600) {
            let all = true;
            for (let i = 0; i < roots.length && all; i++)
                for (let j = i + 1; j < roots.length; j++)
                    if (this.relKind(roots[i], roots[j]) !== 'alliance') {
                        all = false;
                        break;
                    }
            if (all)
                return this.finish(leadId, 'bloc');
        }
        if (leadCells >= this.landTotal * CFG.domShare) {
            if (this.voters().length === 0) {
                // Tanpa pemain manusia (bot vs bot): kemenangan otomatis setelah bertahan.
                if (this.domPlayer !== leadId) {
                    this.domPlayer = leadId;
                    this.domSince = this.tick;
                }
                else if (this.tick - this.domSince >= CFG.domHold) {
                    return this.finish(leadId, 'dominance');
                }
            }
            else {
                // Ada manusia: buka voting (lanjut atau akhiri) alih-alih menang otomatis.
                this.domPlayer = 0;
                if (this.vote && this.vote.leader !== leadId) {
                    this.events.push({ k: 'vote-end', leader: this.vote.leader, result: 'cancel' });
                    this.vote = null;
                }
                if (!this.vote && this.tick >= this.voteCool) {
                    this.vote = { leader: leadId, endsAt: this.tick + CFG.voteTime, ballots: {} };
                    this.events.push({ k: 'vote-start', leader: leadId });
                }
                else if (this.vote && this.tick >= this.vote.endsAt) {
                    this.tallyVote(true);
                    if (this.winner)
                        return;
                }
            }
        }
        else {
            this.domPlayer = 0;
            if (this.vote) {
                this.events.push({ k: 'vote-end', leader: this.vote.leader, result: 'cancel' });
                this.vote = null;
            }
        }
        if (this.tick >= CFG.maxTicks)
            this.finish(leadId, 'time');
    }
    finish(winner, reason) {
        this.winner = winner || -1;
        this.winReason = reason;
        this.vote = null;
        this.events.push({ k: 'win', winner, reason });
    }
    // ---------------------------------------------------------------- utilitas
    checksum() {
        let h = 2166136261 | 0;
        const o = this.owner;
        for (let i = 0; i < o.length; i++)
            h = Math.imul(h ^ o[i], 16777619);
        h = Math.imul(h ^ this.tick, 16777619);
        for (let id = 1; id < this.players.length; id++) {
            const p = this.players[id];
            h = Math.imul(h ^ Math.floor(p.troops * 10), 16777619);
            h = Math.imul(h ^ p.cells, 16777619);
        }
        for (const of of this.offensives)
            h = Math.imul(h ^ Math.floor(of.pool * 10), 16777619);
        for (const sh of this.ships)
            h = Math.imul(h ^ (sh.arrive * 31 + Math.floor(sh.pool * 10)), 16777619);
        h = Math.imul(h ^ this.seaLinks.length, 16777619);
        const rels = [...this.rels].sort((x, y) => x.a * 256 + x.b - (y.a * 256 + y.b));
        const kinds = ['peace', 'war', 'truce', 'nap', 'alliance', 'vassal'];
        for (const r of rels)
            h = Math.imul(h ^ ((r.a * 256 + r.b) * 8 + kinds.indexOf(r.kind)), 16777619);
        for (let id = 1; id < this.players.length; id++)
            h = Math.imul(h ^ Math.floor(this.players[id].morale * 1000), 16777619);
        h = Math.imul(h ^ this.players.length, 16777619);
        return h >>> 0;
    }
    /** Persentase wilayah dari seluruh daratan. */
    share(p) {
        return p.cells / this.landTotal;
    }
    ranking() {
        return this.players
            .filter((p) => p)
            .sort((a, b) => (a.alive === b.alive ? b.cells - a.cells : a.alive ? -1 : 1));
    }
    serialize() {
        return {
            tick: this.tick,
            owner: b64(this.owner),
            feat: b64(this.feat),
            players: this.players.slice(1).map((p) => ({ ...p })),
            offensives: this.offensives.map((o) => ({ ...o })),
            forts: this.forts.map((f) => ({ ...f })),
            ships: this.ships.map((x) => ({ ...x })),
            seaLinks: this.seaLinks.map((x) => ({ ...x })),
            nextShipId: this.nextShipId,
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
    restore(s) {
        this.tick = s.tick;
        this.owner.set(unb64(s.owner));
        this.feat.set(unb64(s.feat));
        this.players = [null, ...s.players.map((p) => ({ ...p }))];
        this.offensives = s.offensives.map((o) => ({ ...o }));
        this.forts = s.forts.map((f) => ({ ...f }));
        this.ships = (s.ships ?? []).map((x) => ({ ...x }));
        this.seaLinks = (s.seaLinks ?? []).map((x) => ({ ...x }));
        this.nextShipId = s.nextShipId ?? 1;
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
function b64(u) {
    let s = '';
    for (let i = 0; i < u.length; i += 8192)
        s += String.fromCharCode(...u.subarray(i, i + 8192));
    return btoa(s);
}
function unb64(s) {
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        u[i] = bin.charCodeAt(i);
    return u;
}
