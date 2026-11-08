// Konfigurasi jaringan multiplayer. Dibuat oleh panz-08.
//
// Nilai default memakai server sinyal PeerJS publik dan STUN publik. Untuk
// jaringan dengan NAT simetris / firewall ketat, isi TURN di sini atau lewat
// `window.__PANZ_NET__` sebelum js/main.js dimuat:
//
//   <script>
//     window.__PANZ_NET__ = {
//       iceServers: [
//         { urls: 'stun:stun.l.google.com:19302' },
//         { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'rahasia' }
//       ]
//     };
//   </script>
//
// Untuk memakai server PeerJS sendiri, isi peerHost/peerPort/peerPath/peerKey.
// Lihat README bagian "Konfigurasi PeerJS & TURN".
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];
function runtimeOverride() {
    const w = window;
    const o = w.__PANZ_NET__;
    return o && typeof o === 'object' ? o : {};
}
/** Konfigurasi efektif (default + override runtime). */
export function netConfig() {
    const o = runtimeOverride();
    const iceServers = Array.isArray(o.iceServers) && o.iceServers.length ? o.iceServers : DEFAULT_ICE_SERVERS;
    return { ...o, iceServers };
}
/** Opsi yang diteruskan ke `new Peer(id, options)`. */
export function peerOptions() {
    const c = netConfig();
    const opts = {
        config: { iceServers: c.iceServers },
    };
    if (c.peerHost) {
        opts.host = c.peerHost;
        opts.port = c.peerPort ?? 443;
        opts.path = c.peerPath ?? '/';
        opts.secure = c.peerSecure ?? true;
        if (c.peerKey)
            opts.key = c.peerKey;
    }
    return opts;
}
