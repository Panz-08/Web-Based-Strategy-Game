// Driver: menggerakkan Sim. Single-player & Host bersifat otoritatif; Guest mengikuti siaran tick (lockstep deterministik).
import { Bot } from '../core/bot.js';
import { Sim } from '../core/sim.js';
import { TPS } from '../core/types.js';
import { OFFER_KINDS } from '../core/types.js';
const STEP_MS = 1000 / TPS;
const MAX_STEPS_PER_UPDATE = 200;
function cleanCommand(c, pid) {
    if (!c || typeof c !== 'object')
        return null;
    const o = c;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    switch (o.t) {
        case 'atk': {
            const idx = num(o.idx);
            const pct = num(o.pct);
            if (Number.isNaN(idx) || Number.isNaN(pct))
                return null;
            return { t: 'atk', p: pid, idx: Math.floor(idx), pct, wide: !!o.wide };
        }
        case 'fort': {
            const idx = num(o.idx);
            if (Number.isNaN(idx))
                return null;
            return { t: 'fort', p: pid, idx: Math.floor(idx) };
        }
        case 'blitz':
        case 'shield':
        case 'retreat':
            return { t: o.t, p: pid };
        case 'war':
        case 'surrender':
        case 'break': {
            const target = num(o.target);
            if (Number.isNaN(target))
                return null;
            return { t: o.t, p: pid, target: Math.floor(target) };
        }
        case 'offer': {
            const target = num(o.target);
            if (Number.isNaN(target) || !OFFER_KINDS.includes(o.kind))
                return null;
            return { t: 'offer', p: pid, target: Math.floor(target), kind: o.kind };
        }
        case 'reply': {
            const id = num(o.id);
            if (Number.isNaN(id))
                return null;
            return { t: 'reply', p: pid, id: Math.floor(id), accept: o.accept === true };
        }
        case 'vote':
            return { t: 'vote', p: pid, end: o.end === true };
        default:
            return null;
    }
}
/** Single-player dan Host berbagi logika langkah; Host menambah siaran jaringan. */
export class AuthoritativeDriver {
    sim;
    me;
    kind;
    speed = 1;
    paused = false;
    stall = 0;
    bots = [];
    botIds = new Set();
    knownPlayers = 0;
    pending = [];
    acc = 0;
    transport;
    gidToPid = new Map();
    seed;
    onDisconnect;
    onPlayerLeft;
    constructor(setup, me, transport = null, gids = new Map()) {
        this.sim = new Sim(setup);
        this.me = me;
        this.seed = setup.seed;
        this.kind = transport ? 'host' : 'single';
        this.transport = transport;
        this.gidToPid = gids;
        for (const p of setup.players) {
            if (p.kind === 'bot') {
                this.bots.push(new Bot(p.id, p.difficulty ?? 'normal', setup.seed, p.trait));
                this.botIds.add(p.id);
            }
        }
        this.knownPlayers = this.sim.players.length;
        if (transport) {
            transport.onMessage = (gid, msg) => this.onNet(gid, msg);
            transport.onGuestLeave = (gid) => {
                const pid = this.gidToPid.get(gid);
                if (pid === undefined)
                    return;
                this.gidToPid.delete(gid);
                // Pemain yang keluar digantikan bot agar permainan tetap jalan.
                const pl = this.sim.players[pid];
                if (pl && pl.alive) {
                    pl.kind = 'bot';
                    pl.name = pl.name + ' (AI)';
                    this.bots.push(new Bot(pid, 'normal', this.seed));
                    this.botIds.add(pid);
                }
                this.onPlayerLeft?.(pid);
            };
            transport.onGuestJoin = () => { };
        }
    }
    submit(cmd) {
        this.pending.push({ ...cmd, p: this.me });
    }
    onNet(gid, msg) {
        const pid = this.gidToPid.get(gid);
        if (pid === undefined)
            return;
        if (msg.k === 'cmd') {
            const c = cleanCommand(msg.c, pid);
            if (c)
                this.pending.push(c);
        }
        else if (msg.k === 'sync-req') {
            this.transport?.send(gid, { k: 'sync', state: this.sim.serialize() });
        }
    }
    update(dtMs) {
        if (this.paused && this.kind === 'single')
            return;
        const speed = this.kind === 'single' ? this.speed : 1;
        this.acc += Math.min(dtMs, STEP_MS * MAX_STEPS_PER_UPDATE) * speed;
        let steps = 0;
        while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_UPDATE) {
            this.acc -= STEP_MS;
            steps++;
            this.stepOnce();
        }
    }
    stepOnce() {
        const sim = this.sim;
        const cmds = this.pending;
        this.pending = [];
        for (const b of this.bots)
            cmds.push(...b.think(sim));
        const t = sim.tick;
        sim.step(cmds);
        // Negara baru hasil revolusi dikendalikan AI.
        if (sim.players.length !== this.knownPlayers) {
            for (let id = this.knownPlayers; id < sim.players.length; id++) {
                const pl = sim.players[id];
                if (pl.kind === 'bot' && !this.botIds.has(id)) {
                    this.bots.push(new Bot(id, pl.difficulty, this.seed));
                    this.botIds.add(id);
                }
            }
            this.knownPlayers = sim.players.length;
        }
        if (this.transport) {
            const msg = { k: 'tick', t, cmds };
            if (t % 20 === 0)
                msg.h = sim.checksum();
            this.transport.broadcast(msg);
        }
    }
    dispose() {
        if (this.transport) {
            this.transport.broadcast({ k: 'end' });
            this.transport.close();
        }
    }
}
export class GuestDriver {
    sim;
    me;
    kind = 'guest';
    speed = 1;
    paused = false;
    stall = 0;
    queue = [];
    acc = 0;
    transport;
    syncing = false;
    onDisconnect;
    desyncs = 0;
    constructor(setup, me, transport) {
        this.sim = new Sim(setup);
        this.me = me;
        this.transport = transport;
        transport.onMessage = (m) => this.onNet(m);
        transport.onClose = () => this.onDisconnect?.();
    }
    submit(cmd) {
        this.transport.send({ k: 'cmd', c: cmd });
    }
    onNet(m) {
        if (m.k === 'tick') {
            this.queue.push({ t: m.t, cmds: m.cmds, h: m.h });
            this.stall = 0;
        }
        else if (m.k === 'sync') {
            const st = m.state;
            this.sim.restore(st);
            this.queue = this.queue.filter((q) => q.t >= st.tick);
            this.syncing = false;
        }
        else if (m.k === 'end') {
            this.onDisconnect?.();
        }
    }
    update(dtMs) {
        this.acc += Math.min(dtMs, 500);
        this.stall += dtMs;
        // Buang tick lama (setelah resync) dan jaga buffer.
        while (this.queue.length && this.queue[0].t < this.sim.tick)
            this.queue.shift();
        let due = Math.floor(this.acc / STEP_MS);
        if (this.queue.length > 4)
            due = Math.max(due, this.queue.length - 2); // kejar ketertinggalan
        let steps = 0;
        while (steps < due && this.queue.length && steps < MAX_STEPS_PER_UPDATE) {
            const q = this.queue[0];
            if (q.t !== this.sim.tick) {
                if (q.t > this.sim.tick && !this.syncing) {
                    // Ada tick yang hilang — minta snapshot.
                    this.syncing = true;
                    this.transport.send({ k: 'sync-req' });
                }
                break;
            }
            this.queue.shift();
            this.sim.step(q.cmds);
            steps++;
            if (q.h !== undefined && q.h !== this.sim.checksum() && !this.syncing) {
                this.desyncs++;
                this.syncing = true;
                this.transport.send({ k: 'sync-req' });
            }
        }
        this.acc -= steps * STEP_MS;
        if (!this.queue.length)
            this.acc = Math.min(this.acc, STEP_MS * 2);
        if (this.acc > STEP_MS * 10)
            this.acc = STEP_MS * 10;
    }
    dispose() {
        this.transport.close();
    }
}
