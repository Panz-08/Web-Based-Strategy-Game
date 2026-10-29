// AI bot. Hanya dijalankan oleh host/single-player; perintahnya disiarkan seperti perintah pemain biasa.
import { Rng } from './rng.js';
import { CFG } from './sim.js';
import { F_NONE, T_WATER } from './types.js';
const PROFILES = {
    easy: { interval: 55, pctMin: 0.2, pctMax: 0.9, maxFronts: 2, minAfford: 3, forts: 0, abilities: 0, hunt: false, reckless: true, reserve: 0.02, maxWars: 1, diplo: 420, accept: { peace: 0.8, nap: 0.7, alliance: 0.5 } },
    normal: { interval: 26, pctMin: 0.4, pctMax: 0.7, maxFronts: 3, minAfford: 10, forts: 1, abilities: 0.5, hunt: false, reckless: false, reserve: 0.08, maxWars: 2, diplo: 320, accept: { peace: 0.6, nap: 0.5, alliance: 0.35 } },
    hard: { interval: 12, pctMin: 0.45, pctMax: 0.8, maxFronts: 4, minAfford: 10, forts: 3, abilities: 1, hunt: true, reckless: false, reserve: 0.1, maxWars: 2, diplo: 220, accept: { peace: 0.4, nap: 0.35, alliance: 0.2 } },
};
export class Bot {
    id;
    rng;
    next;
    prof;
    nextDiplo;
    warMul = 1; // pengali skor menyerang negara lain
    expMul = 1; // pengali skor ekspansi ke lahan netral
    constructor(id, difficulty, seed, trait = 'bal') {
        this.id = id;
        this.rng = new Rng(seed ^ (id * 7919));
        // Watak bangsa: sedikit membedakan perilaku bot agar permainan terasa beragam.
        const prof = { ...PROFILES[difficulty], accept: { ...PROFILES[difficulty].accept } };
        if (trait === 'war') {
            prof.maxWars += 1;
            prof.accept.peace *= 0.6;
            prof.accept.alliance *= 0.7;
            this.warMul = 1.2;
        }
        else if (trait === 'build') {
            prof.maxWars = Math.max(1, prof.maxWars - 1);
            this.expMul = 1.3;
            this.warMul = 0.85;
        }
        else if (trait === 'dip') {
            prof.diplo = Math.round(prof.diplo * 0.7);
            prof.accept.nap = Math.min(0.95, prof.accept.nap * 1.4);
            prof.accept.alliance = Math.min(0.95, prof.accept.alliance * 1.5);
            this.warMul = 0.9;
        }
        this.prof = prof;
        this.next = 20 + this.rng.int(this.prof.interval);
        this.nextDiplo = 300 + this.rng.int(this.prof.diplo);
    }
    think(sim) {
        const p = sim.players[this.id];
        if (!p || !p.alive || sim.winner)
            return [];
        const replies = [];
        for (const of of sim.offers)
            if (of.to === p.id)
                replies.push({ t: 'reply', p: p.id, id: of.id, accept: this.decide(sim, p, of) });
        if (sim.tick < this.next)
            return replies;
        const pf = this.prof;
        this.next = sim.tick + pf.interval + this.rng.int(Math.max(1, pf.interval >> 1));
        const out = replies;
        this.diplomacy(sim, p, out);
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
        const wars = sim.enemiesOf(p.id).length;
        for (const [o, cells] of borders) {
            let newWar = false;
            if (o !== 0) {
                const rk = sim.relKind(p.id, o);
                if (rk !== 'war') {
                    // Hanya negara netral (damai) yang bisa diserbu; gencatan, pakta, sekutu, dan boneka dihormati.
                    if (rk !== 'peace' || wars >= pf.maxWars || sim.canDeclareWar(p.id, o) !== '')
                        continue;
                    newWar = true;
                }
            }
            if (sim.offensives.some((of) => of.owner === p.id && of.target === o && of.pool > budget * 0.5))
                continue;
            const sample = this.rng.pick(cells);
            const est = Math.max(0.5, sim.cellCost(p, sample));
            const afford = budget / est;
            let score;
            if (o === 0) {
                score = (afford * 1.0 + (p.cells < 120 ? 30 : 0)) * this.expMul;
                if (afford < 5)
                    continue;
            }
            else {
                if (afford < pf.minAfford)
                    continue;
                const e = sim.players[o];
                score = afford * 1.3 * this.warMul;
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
            if (newWar)
                score *= 0.75; // lebih suka melanjutkan perang yang sudah ada
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
        if (bestTarget !== 0 && sim.relKind(p.id, bestTarget) !== 'war')
            out.push({ t: 'war', p: p.id, target: bestTarget });
        out.push({ t: 'atk', p: p.id, idx: focus, pct: Math.round(pct * 100), wide: bestTarget === 0 });
        if (sim.tick >= p.blitzReady && budget > 60 && this.rng.next() < pf.abilities * 0.6) {
            out.push({ t: 'blitz', p: p.id });
        }
        return out;
    }
    // ------------------------------------------------------------------ diplomasi
    /** Putuskan menerima/menolak tawaran. */
    decide(sim, p, of) {
        const from = sim.players[of.from];
        if (!from || !from.alive)
            return false;
        const pf = this.prof;
        const r = this.rng.next();
        switch (of.kind) {
            case 'peace': {
                if (p.capital < 0 || sim.tick < p.shakenUntil)
                    return true; // sedang terpuruk
                const since = sim.getRel(p.id, from.id)?.since ?? 0;
                const losing = from.troops > p.troops * 1.2 || from.cells > p.cells * 1.3;
                if (sim.tick - since < 200 && !losing)
                    return false; // perang baru mulai
                return r < (losing ? 0.9 : pf.accept.peace * 0.6);
            }
            case 'nap': {
                if (sim.offensives.some((o) => o.owner === p.id && o.target === from.id))
                    return false;
                return r < pf.accept.nap;
            }
            case 'alliance': {
                let shared = 0;
                for (const z of sim.enemiesOf(p.id))
                    if (sim.atWar(from.id, z))
                        shared++;
                return r < (shared > 0 ? 0.85 : pf.accept.alliance * 0.5);
            }
            case 'vassal': {
                if (p.capital < 0)
                    return r < 0.8;
                const ratio = pf.hunt ? 0.3 : 0.45;
                return p.cells < from.cells * ratio && p.troops < from.troops * 0.7 && r < 0.7;
            }
        }
    }
    offer(sim, p, target, kind, out) {
        if (sim.offerError(p.id, target, kind) !== '')
            return false;
        out.push({ t: 'offer', p: p.id, target, kind });
        return true;
    }
    /** Usulan damai/menyerah/pakta/aliansi; dibatasi waktu agar tidak membanjiri pemain. */
    diplomacy(sim, p, out) {
        const pf = this.prof;
        // Negara boneka yang sudah kuat memproklamasikan kemerdekaan.
        if (p.lord) {
            const lord = sim.players[p.lord];
            if (lord && lord.alive && p.cells > lord.cells * 0.8 && p.morale > 0.6 && this.rng.next() < 0.03) {
                out.push({ t: 'war', p: p.id, target: p.lord });
            }
            return;
        }
        if (sim.tick < this.nextDiplo)
            return;
        this.nextDiplo = sim.tick + pf.diplo + this.rng.int(pf.diplo);
        const enemies = sim.enemiesOf(p.id);
        for (const eid of enemies) {
            const e = sim.players[eid];
            const since = sim.getRel(p.id, eid)?.since ?? 0;
            const dur = sim.tick - since;
            const desperate = (p.capital < 0 && p.troops < e.troops * 0.4) || p.cells < Math.min(e.cells * 0.2, pf.hunt ? 12 : 25);
            if (desperate && !e.lord && this.rng.next() < 0.5) {
                out.push({ t: 'surrender', p: p.id, target: eid });
                return;
            }
            const losing = e.troops > p.troops * 1.3 && e.cells > p.cells;
            if ((losing || (dur > 1200 && this.rng.next() < 0.3)) && this.offer(sim, p, eid, 'peace', out))
                return;
            // Menang telak: tawarkan jadi negara boneka.
            if (!e.lord && p.cells > e.cells * 2.2 && p.troops > e.troops * 1.5 && this.offer(sim, p, eid, 'vassal', out))
                return;
        }
        if (enemies.length >= pf.maxWars)
            return;
        // Cari mitra: sekutu bagi yang punya musuh sama, pakta non agresi bagi tetangga yang kuat.
        const cands = [];
        for (let z = 1; z < sim.players.length; z++) {
            const q = sim.players[z];
            if (z !== p.id && q.alive && !q.lord)
                cands.push(q);
        }
        if (!cands.length)
            return;
        const q = this.rng.pick(cands);
        let shared = 0;
        for (const z of enemies)
            if (sim.atWar(q.id, z))
                shared++;
        if (shared > 0 && this.offer(sim, p, q.id, 'alliance', out))
            return;
        if (q.cells >= p.cells * 0.8 && this.rng.next() < 0.5)
            this.offer(sim, p, q.id, 'nap', out);
    }
}
