// Lobby multiplayer: Host mengumpulkan pemain lalu memulai; Guest menunggu sinyal start.
import { BOT_NAMES } from '../core/types.js';
import { AuthoritativeDriver, GuestDriver } from './drivers.js';
export const MAX_HUMANS = 4;
export const MAX_PLAYERS = 8;
export function cleanName(s, fallback) {
    const t = String(s ?? '')
        .replace(/[^\p{L}\p{N} _\-.]/gu, '')
        .trim()
        .slice(0, 14);
    return t || fallback;
}
export function buildSetup(humans, opt) {
    const players = [];
    humans.forEach((name, i) => players.push({ id: i + 1, name, kind: 'human' }));
    const bots = Math.min(opt.bots, MAX_PLAYERS - humans.length);
    for (let b = 0; b < bots; b++) {
        players.push({ id: players.length + 1, name: BOT_NAMES[b % BOT_NAMES.length], kind: 'bot', difficulty: opt.difficulty });
    }
    return { seed: opt.seed, width: opt.width, height: opt.height, style: opt.style, players };
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
