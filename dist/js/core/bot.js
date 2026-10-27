// AI bot. Hanya dijalankan oleh host/single-player; perintahnya disiarkan seperti perintah pemain biasa.
import { Rng } from "./rng.js";
import { CFG } from "./sim.js";
import { F_NONE, T_WATER } from "./types.js";
const PROFILES = {
    easy: { interval: 55, pctMin: 0.2, pctMax: 0.9, maxFronts: 2, minAfford: 3, forts: 0, abilities: 0, hunt: false, reckless: true, reserve: 0.02 },
    normal: { interval: 26, pctMin: 0.4, pctMax: 0.7, maxFronts: 3, minAfford: 10, forts: 1, abilities: 0.5, hunt: false, reckless: false, reserve: 0.08 },
    hard: { interval: 12, pctMin: 0.45, pctMax: 0.8, maxFronts: 4, minAfford: 10, forts: 3, abilities: 1, hunt: true, reckless: false, reserve: 0.1 },
};
export class Bot {
    id;
    rng;
    next;
    prof;
    constructor(id, difficulty, seed) {
        this.id = id;
        this.rng = new Rng(seed ^ (id * 7919));
        this.prof = PROFILES[difficulty];
        this.next = 20 + this.rng.int(this.prof.interval);
    }
    think(sim) {
        const p = sim.players[this.id];
        if (!p || !p.alive || sim.winner)
            return [];
        if (sim.tick < this.next)
            return [];
        const pf = this.prof;
        this.next = sim.tick + pf.interval + this.rng.int(Math.max(1, pf.interval >> 1));
        const out = [];
        // Ancaman: ada yang menyerang kita?
        let incoming = 0;
        for (const o of sim.offensives)
            if (o.target === p.id)
                incoming += o.pool;
        if (sim.tick >= p.shieldReady && incoming > p.troops * 0.35 && this.rng.next() < pf.abilities) {
            out.push({ t: 'shield', p: p.id });
        }
        // Pindai perbatasan.
        const { w, h, owner, terrain } = sim;
        const borders = new Map();
        const ownBorderToEnemy = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const c = y * w + x;
                if (owner[c] !== p.id)
                    continue;
                let touchesEnemy = false;
                for (let k = 0; k < 4; k++) {
                    const nx = k === 0 ? x - 1 : k === 1 ? x + 1 : x;
                    const ny = k === 2 ? y - 1 : k === 3 ? y + 1 : y;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h)
                        continue;
                    const nc = ny * w + nx;
                    if (terrain[nc] === T_WATER)
                        continue;
                    const o = owner[nc];
                    if (o === p.id)
                        continue;
                    let arr = borders.get(o);
                    if (!arr) {
                        arr = [];
                        borders.set(o, arr);
                    }
                    if (arr.length < 80)
                        arr.push(nc);
                    else
                        arr[this.rng.int(80)] = nc;
                    if (o !== 0)
                        touchesEnemy = true;
                }
                if (touchesEnemy && sim.feat[c] === F_NONE && ownBorderToEnemy.length < 60)
                    ownBorderToEnemy.push(c);
            }
        }
        const fronts = sim.countOffensives(p.id);
        const reserve = Math.max(20, p.cap * pf.reserve);
        const avail = p.troops - reserve;
        // Benteng.
        if (pf.forts > 0 && ownBorderToEnemy.length > 0) {
            const myForts = sim.forts.filter((f) => f.owner === p.id).length;
            if (myForts < pf.forts && p.troops > sim.fortCost(p) * 2.5 && this.rng.next() < 0.5) {
                out.push({ t: 'fort', p: p.id, idx: this.rng.pick(ownBorderToEnemy) });
                return out;
            }
        }
        if (fronts >= pf.maxFronts || avail < CFG.minCommit * 2)
            return out;
        // Pilih target: netral (ekspansi) atau musuh terlemah.
        let bestTarget = -1;
        let bestScore = 0;
        let bestCell = -1;
        const pct = this.rng.range(pf.pctMin, pf.pctMax);
        const budget = avail * pct;
        for (const [o, cells] of borders) {
            if (sim.offensives.some((of) => of.owner === p.id && of.target === o && of.pool > budget * 0.5))
                continue;
            const sample = this.rng.pick(cells);
            const est = Math.max(0.5, sim.cellCost(p, sample));
            const afford = budget / est;
            let score;
            if (o === 0) {
                score = afford * 1.0 + (p.cells < 120 ? 30 : 0);
                if (afford < 5)
                    continue;
            }
            else {
                if (afford < pf.minAfford)
                    continue;
                const e = sim.players[o];
                score = afford * 1.3;
                if (e.cells < 60)
                    score *= 1.4; // habisi yang lemah
                if (pf.hunt) {
                    if (e.capital >= 0)
                        score *= 1.15;
                    const top = sim.ranking()[0];
                    if (top && top.id === o && o !== p.id)
                        score *= 1.25;
                    if (e.kind === 'human')
                        score *= 1.1;
                }
                // sedikit enggan bila musuh jauh lebih kuat
                if (e.troops > p.troops * 2)
                    score *= 0.5;
            }
            score *= pf.reckless ? this.rng.next() * 2 : 0.8 + this.rng.next() * 0.4;
            if (score > bestScore) {
                bestScore = score;
                bestTarget = o;
                bestCell = sample;
            }
        }
        if (bestTarget < 0)
            return out;
        let focus = bestCell;
        if (bestTarget !== 0 && pf.hunt) {
            const e = sim.players[bestTarget];
            if (e.capital >= 0)
                focus = e.capital;
        }
        out.push({ t: 'atk', p: p.id, idx: focus, pct: Math.round(pct * 100), wide: bestTarget === 0 });
        if (sim.tick >= p.blitzReady && budget > 60 && this.rng.next() < pf.abilities * 0.6) {
            out.push({ t: 'blitz', p: p.id });
        }
        return out;
    }
}
