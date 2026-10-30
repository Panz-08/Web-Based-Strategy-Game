// Lobby multiplayer: Host mengumpulkan pemain lalu memulai; Guest menunggu sinyal start.
import { BOT_NAMES } from "../core/types.js";
import { getPreset, maxPlayers } from "../core/maps/index.js";
import { Rng } from "../core/rng.js";
import { AuthoritativeDriver, GuestDriver } from "./drivers.js";
export const MAX_HUMANS = 4;
export const MAX_PLAYERS = 16;
export function cleanName(s, fallback) {
    const t = String(s ?? '')
        .replace(/[^\p{L}\p{N} _\-.]/gu, '')
        .trim()
        .slice(0, 14);
    return t || fallback;
}
/** Jumlah pemain maksimum untuk pilihan peta (peta nyata dibatasi jumlah bangsanya). */
export function playerCap(map) {
    return Math.min(MAX_PLAYERS, maxPlayers(map ?? 'random'));
}
export function buildSetup(humans, opt) {
    const players = [];
    const map = opt.map ?? 'random';
    const preset = getPreset(map);
    const rng = new Rng(opt.seed ^ 0x2f6e2b1);
    const cap = playerCap(map);
    const bots = Math.max(0, Math.min(opt.bots, cap - humans.length));
    const traits = ['war', 'build', 'dip', 'bal'];
    // Bangsa: pilihan host dulu, lalu pemain lain & bot mengambil urutan (sudah tersebar) yang masih kosong.
    const used = new Set();
    const take = (want) => {
        if (!preset)
            return undefined;
        if (want !== undefined && want >= 0 && want < preset.nations.length && !used.has(want)) {
            used.add(want);
            return want;
        }
        const free = [];
        for (let i = 0; i < preset.nations.length; i++)
            if (!used.has(i))
                free.push(i);
        if (!free.length)
            return undefined;
        // Pemain tanpa pilihan: ambil acak dari bangsa yang tersisa; bot: urutan tersebar.
        const pick = want === -1 ? free[rng.int(free.length)] : free[0];
        used.add(pick);
        return pick;
    };
    const humanNations = humans.map((_, i) => take(i === 0 ? (opt.nation === undefined ? -1 : opt.nation) : -1));
    humans.forEach((name, i) => players.push({ id: i + 1, name, kind: 'human', nation: humanNations[i] }));
    for (let b = 0; b < bots; b++) {
        const nat = take();
        const n = preset && nat !== undefined ? preset.nations[nat] : undefined;
        players.push({
            id: players.length + 1,
            name: n ? n.name : BOT_NAMES[b % BOT_NAMES.length],
            kind: 'bot',
            difficulty: opt.difficulty,
            nation: nat,
            trait: n ? n.trait : traits[(b + (opt.seed & 3)) % traits.length],
        });
    }
    return { seed: opt.seed, width: preset ? preset.w : opt.width, height: preset ? preset.h : opt.height, style: opt.style, map, players };
}
export class HostLobby {
    guests = new Map(); // gid -> nama
    onChange = () => { };
    started = false;
    transport;
    hostName;
    constructor(transport, hostName) {
        this.transport = transport;
        this.hostName = hostName;
        transport.onGuestJoin = () => { };
        transport.onGuestLeave = (gid) => {
            if (this.started)
                return;
            this.guests.delete(gid);
            this.broadcast();
        };
        transport.onMessage = (gid, msg) => {
            if (msg.k !== 'join' || this.started)
                return;
            if (this.guests.size + 1 >= MAX_HUMANS) {
                transport.send(gid, { k: 'full' });
                return;
            }
            this.guests.set(gid, cleanName(msg.name, 'Tamu'));
            this.broadcast();
        };
    }
    get code() {
        return this.transport.code;
    }
    names() {
        return [this.hostName, ...this.guests.values()];
    }
    broadcast() {
        this.transport.broadcast({ k: 'lobby', names: this.names() });
        this.onChange();
    }
    start(opt) {
        this.started = true;
        const gids = [...this.guests.keys()];
        const setup = buildSetup(this.names(), opt);
        const map = new Map();
        gids.forEach((g, i) => map.set(g, i + 2));
        // Pesan start dikirim sebelum tick pertama; transport bersifat berurutan.
        gids.forEach((g, i) => this.transport.send(g, { k: 'start', setup: setup, you: i + 2 }));
        return new AuthoritativeDriver(setup, 1, this.transport, map);
    }
    cancel() {
        this.transport.broadcast({ k: 'end' });
        this.transport.close();
    }
}
export class GuestLobby {
    names = [];
    onChange = () => { };
    onStart = () => { };
    onClosed = () => { };
    started = false;
    transport;
    constructor(transport, name) {
        this.transport = transport;
        transport.onMessage = (m) => {
            if (m.k === 'lobby') {
                this.names = m.names;
                this.onChange();
            }
            else if (m.k === 'start') {
                this.started = true;
                const drv = new GuestDriver(m.setup, m.you, transport);
                this.onStart(drv);
            }
            else if (m.k === 'full') {
                this.onClosed('Ruang penuh');
            }
            else if (m.k === 'end' && !this.started) {
                this.onClosed('Host menutup ruang');
            }
        };
        transport.onClose = () => {
            if (!this.started)
                this.onClosed('Koneksi ke host terputus');
        };
        transport.send({ k: 'join', name });
    }
    leave() {
        this.transport.close();
    }
}
