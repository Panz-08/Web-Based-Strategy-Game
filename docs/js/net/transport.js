// Lapisan transport multiplayer: dua implementasi (Lokal antar-tab & Online PeerJS) di balik antarmuka yang sama.
// Dibuat oleh panz-08.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len = 5) {
    let s = '';
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    for (let i = 0; i < len; i++)
        s += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return s;
}
export function randomId() {
    return randomCode(8);
}
export function normalizeCode(code) {
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}
export class LocalHost {
    code = randomCode();
    ch = null;
    guests = new Set();
    onGuestJoin = () => { };
    onGuestLeave = () => { };
    onMessage = () => { };
    open() {
        if (typeof BroadcastChannel === 'undefined')
            return Promise.reject(new Error('Browser tidak mendukung BroadcastChannel'));
        this.ch = new BroadcastChannel('panz-dominion:' + this.code);
        this.ch.onmessage = (ev) => {
            const e = ev.data;
            if (e.to !== 'host')
                return;
            if (e.type === 'hello') {
                if (!this.guests.has(e.from)) {
                    this.guests.add(e.from);
                    this.onGuestJoin(e.from);
                }
                this.post({ to: e.from, from: 'host', type: 'welcome' });
            }
            else if (e.type === 'bye') {
                if (this.guests.delete(e.from))
                    this.onGuestLeave(e.from);
            }
            else if (e.type === 'data' && e.data && this.guests.has(e.from)) {
                this.onMessage(e.from, e.data);
            }
        };
        window.addEventListener('beforeunload', this.unload);
        return Promise.resolve(this.code);
    }
    unload = () => this.close();
    post(e) {
        this.ch?.postMessage(e);
    }
    send(gid, msg) {
        this.post({ to: gid, from: 'host', type: 'data', data: msg });
    }
    broadcast(msg) {
        this.post({ to: '*', from: 'host', type: 'data', data: msg });
    }
    close() {
        if (!this.ch)
            return;
        this.post({ to: '*', from: 'host', type: 'close' });
        window.removeEventListener('beforeunload', this.unload);
        this.ch.close();
        this.ch = null;
    }
}
export class LocalGuest {
    ch = null;
    id = randomId();
    connected = false;
    onMessage = () => { };
    onClose = () => { };
    connect(code) {
        if (typeof BroadcastChannel === 'undefined')
            return Promise.reject(new Error('Browser tidak mendukung BroadcastChannel'));
        return new Promise((resolve, reject) => {
            this.ch = new BroadcastChannel('panz-dominion:' + code);
            const timer = setTimeout(() => {
                this.ch?.close();
                this.ch = null;
                reject(new Error('Ruang tidak ditemukan. Pastikan host sudah membuat ruang di tab lain (browser yang sama).'));
            }, 2500);
            this.ch.onmessage = (ev) => {
                const e = ev.data;
                if (e.to !== this.id && e.to !== '*')
                    return;
                if (e.type === 'welcome' && !this.connected) {
                    this.connected = true;
                    clearTimeout(timer);
                    resolve();
                }
                else if (e.type === 'data' && e.data) {
                    this.onMessage(e.data);
                }
                else if (e.type === 'close') {
                    this.connected = false;
                    this.onClose();
                }
            };
            this.ch.postMessage({ to: 'host', from: this.id, type: 'hello' });
            window.addEventListener('beforeunload', this.unload);
        });
    }
    unload = () => this.close();
    send(msg) {
        this.ch?.postMessage({ to: 'host', from: this.id, type: 'data', data: msg });
    }
    close() {
        if (!this.ch)
            return;
        this.ch.postMessage({ to: 'host', from: this.id, type: 'bye' });
        window.removeEventListener('beforeunload', this.unload);
        this.ch.close();
        this.ch = null;
        this.connected = false;
    }
}
// ---------------------------------------------------------------------------------------------
// Online: PeerJS (WebRTC P2P). Library dimuat dari CDN saat dibutuhkan — tanpa server milik sendiri.
// ---------------------------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any */
const PEERJS_URLS = [
    'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
];
const ID_PREFIX = 'panzdominion-';
let peerLoading = null;
function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
            s.remove();
            reject(new Error('gagal memuat ' + url));
        };
        document.head.appendChild(s);
    });
}
export function loadPeerJs() {
    const w = window;
    if (w.Peer)
        return Promise.resolve(w.Peer);
    if (!peerLoading) {
        peerLoading = (async () => {
            for (const u of PEERJS_URLS) {
                try {
                    await loadScript(u);
                    if (w.Peer)
                        return w.Peer;
                }
                catch {
                    /* coba CDN berikutnya */
                }
            }
            peerLoading = null;
            throw new Error('Tidak bisa memuat PeerJS (butuh internet). Gunakan mode Lokal untuk tes tanpa internet.');
        })();
    }
    return peerLoading;
}
export class PeerHost {
    code = randomCode();
    peer = null;
    conns = new Map();
    onGuestJoin = () => { };
    onGuestLeave = () => { };
    onMessage = () => { };
    async open() {
        const Peer = await loadPeerJs();
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                await new Promise((resolve, reject) => {
                    const peer = new Peer(ID_PREFIX + this.code);
                    const timer = setTimeout(() => {
                        peer.destroy();
                        reject(new Error('Server sinyal PeerJS tidak merespons'));
                    }, 12000);
                    peer.on('open', () => {
                        clearTimeout(timer);
                        this.peer = peer;
                        resolve();
                    });
                    peer.on('error', (err) => {
                        clearTimeout(timer);
                        peer.destroy();
                        reject(err);
                    });
                });
                break;
            }
            catch (err) {
                if (err?.type === 'unavailable-id') {
                    this.code = randomCode();
                    continue;
                }
                throw new Error('Gagal membuat ruang online: ' + (err?.message ?? err));
            }
        }
        if (!this.peer)
            throw new Error('Gagal membuat ruang online');
        this.peer.on('connection', (conn) => {
            conn.on('open', () => {
                this.conns.set(conn.peer, conn);
                this.onGuestJoin(conn.peer);
            });
            conn.on('data', (d) => {
                if (d && typeof d === 'object' && typeof d.k === 'string')
                    this.onMessage(conn.peer, d);
            });
            const gone = () => {
                if (this.conns.delete(conn.peer))
                    this.onGuestLeave(conn.peer);
            };
            conn.on('close', gone);
            conn.on('error', gone);
        });
        return this.code;
    }
    send(gid, msg) {
        const c = this.conns.get(gid);
        if (c?.open)
            c.send(msg);
    }
    broadcast(msg) {
        for (const c of this.conns.values())
            if (c.open)
                c.send(msg);
    }
    close() {
        for (const c of this.conns.values())
            c.close();
        this.conns.clear();
        this.peer?.destroy();
        this.peer = null;
    }
}
export class PeerGuest {
    peer = null;
    conn = null;
    onMessage = () => { };
    onClose = () => { };
    async connect(code) {
        const Peer = await loadPeerJs();
        await new Promise((resolve, reject) => {
            const peer = new Peer();
            this.peer = peer;
            const fail = (m) => {
                clearTimeout(timer);
                peer.destroy();
                reject(new Error(m));
            };
            const timer = setTimeout(() => fail('Waktu habis. Periksa kode ruang & koneksi internet.'), 15000);
            peer.on('error', (err) => fail(err?.type === 'peer-unavailable' ? 'Ruang tidak ditemukan' : 'Gagal terhubung: ' + (err?.message ?? err)));
            peer.on('open', () => {
                const conn = peer.connect(ID_PREFIX + code, { reliable: true });
                this.conn = conn;
                conn.on('open', () => {
                    clearTimeout(timer);
                    resolve();
                });
                conn.on('data', (d) => {
                    if (d && typeof d === 'object' && typeof d.k === 'string')
                        this.onMessage(d);
                });
                conn.on('close', () => this.onClose());
                conn.on('error', () => this.onClose());
            });
        });
    }
    send(msg) {
        if (this.conn?.open)
            this.conn.send(msg);
    }
    close() {
        this.conn?.close();
        this.peer?.destroy();
        this.conn = null;
        this.peer = null;
    }
}
export function createHost(mode) {
    return mode === 'local' ? new LocalHost() : new PeerHost();
}
export function createGuest(mode) {
    return mode === 'local' ? new LocalGuest() : new PeerGuest();
}
