// Titik masuk: menu, setup, lobi multiplayer. Dibuat oleh panz-08.
window.__panzLoaded = true;
import { MAP_SIZES } from "./core/types.js";
import { bindPicker, pickerHtml } from "./ui/mappicker.js";
import { Game, esc, toast } from "./game.js";
import { AuthoritativeDriver } from "./net/drivers.js";
import { GuestLobby, HostLobby, MAX_HUMANS, buildSetup, cleanName, playerCap } from "./net/lobby.js";
import { createGuest, createHost, normalizeCode } from "./net/transport.js";
import { PALETTE } from "./core/types.js";
import { sfx } from "./ui/audio.js";
const $ = (id) => document.getElementById(id);
const defaults = { bots: 7, difficulty: 'normal', size: 'medium', style: 'continent', seed: '', map: 'world', nation: -1 };
const optsSingle = { ...defaults };
const optsMulti = { ...defaults, bots: 5 };
let playerName = '';
let netMode = 'online';
try {
    playerName = localStorage.getItem('panz-name') ?? '';
    const saved = JSON.parse(localStorage.getItem('panz-opts') ?? 'null');
    if (saved)
        Object.assign(optsSingle, saved);
}
catch {
    /* abaikan */
}
function save() {
    try {
        localStorage.setItem('panz-name', playerName);
        localStorage.setItem('panz-opts', JSON.stringify(optsSingle));
    }
    catch {
        /* abaikan */
    }
}
// ---------------------------------------------------------------------------------- layar
const screens = ['menu', 'setup', 'multi', 'lobby', 'howto'];
function show(id) {
    for (const s of screens)
        $(s).classList.toggle('hidden', s !== id);
    $('screens').classList.toggle('hidden', id === null);
}
// ---------------------------------------------------------------------------------- opsi
function segHtml(label, key, items, cur) {
    return `<div class="field"><span>${label}</span><div class="seg" data-key="${key}">${items
        .map(([v, t]) => `<button type="button" data-v="${v}" class="${v === cur ? 'on' : ''}">${t}</button>`)
        .join('')}</div></div>`;
}
function mountOpts(host, o, minBots, onChange) {
    const cap = () => Math.max(minBots, playerCap(o.map) - 1);
    const render = () => {
        o.bots = Math.min(Math.max(o.bots, minBots), cap());
        const random = o.map === 'random';
        const pk = pickerHtml(o);
        host.innerHTML =
            `<div class="optcols"><div class="optcol">${pk.left}</div><div class="optcol">${pk.right}` +
                `<div class="field"><span>Jumlah bot: <b data-botval>${o.bots}</b></span><input type="range" class="botrange" data-bots min="${minBots}" max="${cap()}" step="1" value="${o.bots}" /></div>` +
                segHtml('Kesulitan bot', 'difficulty', [['easy', 'Mudah'], ['normal', 'Normal'], ['hard', 'Sulit']], o.difficulty) +
                (random
                    ? segHtml('Ukuran peta', 'size', Object.entries(MAP_SIZES).map(([k, v]) => [k, v.label]), o.size) +
                        segHtml('Gaya peta', 'style', [['continent', 'Benua'], ['highland', 'Pegunungan'], ['open', 'Terbuka']], o.style) +
                        `<div class="field"><span>Seed peta</span><div class="seedrow"><input data-seed maxlength="9" inputmode="numeric" placeholder="acak tiap main" value="${esc(o.seed)}" autocomplete="off" /><button type="button" class="ghost" data-dice>Acak</button></div></div>`
                    : '') +
                `</div></div>`;
        bindPicker(host, o, (mapChanged) => {
            save();
            sfx.click();
            if (mapChanged)
                render();
            onChange?.();
        });
        const range = host.querySelector('[data-bots]');
        range.addEventListener('input', () => {
            o.bots = Number(range.value);
            host.querySelector('[data-botval]').textContent = String(o.bots);
            save();
        });
        host.querySelectorAll('.seg').forEach((seg) => {
            seg.addEventListener('click', (e) => {
                const b = e.target.closest('button');
                if (!b)
                    return;
                seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
                o[seg.dataset.key] = b.dataset.v;
                sfx.click();
                save();
                onChange?.();
            });
        });
        const seedIn = host.querySelector('[data-seed]');
        if (seedIn) {
            seedIn.addEventListener('input', () => {
                o.seed = seedIn.value.replace(/\D/g, '');
                seedIn.value = o.seed;
                save();
            });
            host.querySelector('[data-dice]').addEventListener('click', () => {
                o.seed = String(Math.floor(Math.random() * 900000) + 100000);
                seedIn.value = o.seed;
                save();
            });
        }
    };
    render();
}
function toMatch(o) {
    const size = MAP_SIZES[o.size];
    const seed = o.seed ? Number(o.seed) : Math.floor(Math.random() * 0x7fffffff);
    return { bots: o.bots, difficulty: o.difficulty, width: size.w, height: size.h, style: o.style, seed, map: o.map, nation: o.nation };
}
// ---------------------------------------------------------------------------------- game
const game = new Game($('stage'));
let current = 'menu';
let lastSingle = null;
let hostLobby = null;
let guestLobby = null;
function startDemo() {
    const setup = buildSetup([], {
        bots: 9,
        difficulty: 'hard',
        width: MAP_SIZES.medium.w,
        height: MAP_SIZES.medium.h,
        style: ['continent', 'highland', 'open'][Math.floor(Math.random() * 3)],
        seed: Math.floor(Math.random() * 0x7fffffff),
        map: ['world', 'mideast', 'europe'][Math.floor(Math.random() * 3)],
    });
    const d = new AuthoritativeDriver(setup, 0);
    d.speed = 3;
    game.start(d, true);
}
function goMenu() {
    hostLobby?.cancel();
    guestLobby?.leave();
    hostLobby = guestLobby = null;
    game.stop();
    current = 'menu';
    show('menu');
    startDemo();
}
game.setCallbacks({
    onExit: goMenu,
    onRematch: () => {
        if (game.demo)
            return startDemo();
        if (current === 'single' && lastSingle)
            startSingle({ ...lastSingle, seed: '' });
        else
            goMenu();
    },
});
function begin(driver, mode) {
    current = mode;
    show(null);
    driver.onDisconnect = () => {
        if (current === 'multi' && driver.kind === 'guest') {
            toast('Koneksi ke host terputus', 'warn');
            goMenu();
        }
    };
    if (driver instanceof AuthoritativeDriver && driver.kind === 'host') {
        driver.onPlayerLeft = (pid) => toast(`${driver.sim.players[pid].name} keluar — digantikan AI`, 'info');
    }
    game.start(driver);
}
function startSingle(o) {
    lastSingle = { ...o };
    const name = cleanName(playerName, 'Kamu');
    const setup = buildSetup([name], toMatch(o));
    game.stop();
    begin(new AuthoritativeDriver(setup, 1), 'single');
}
// ---------------------------------------------------------------------------------- multiplayer
function multiMsg(text, bad = true) {
    const el = $('multiMsg');
    el.textContent = text;
    el.classList.toggle('hidden', !text);
    el.classList.toggle('bad', bad);
}
function renderPlayers(names, mine = -1) {
    $('lobbyPlayers').innerHTML =
        names
            .map((n, i) => {
            const c = PALETTE[i + 1].rgb;
            return `<li><i class="dot" style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>${esc(n)}${i === 0 ? ' <em>host</em>' : ''}${i === mine ? ' <em>kamu</em>' : ''}</li>`;
        })
            .join('') + `<li class="free">${names.length < MAX_HUMANS ? 'Menunggu pemain lain…' : 'Ruang penuh'}</li>`;
}
async function hostRoom() {
    playerName = cleanName($('nameMulti').value, 'Host');
    save();
    multiMsg('Membuat ruang…', false);
    $('hostBtn').disabled = true;
    try {
        const t = createHost(netMode);
        await t.open();
        const lobby = new HostLobby(t, playerName);
        hostLobby = lobby;
        $('lobbyTitle').textContent = netMode === 'local' ? 'Ruang lokal' : 'Ruang online';
        $('lobbyCode').textContent = t.code;
        $('lobbyOpts').classList.remove('hidden');
        $('lobbyWait').classList.add('hidden');
        $('lobbyStart').classList.remove('hidden');
        mountOpts($('lobbyOpts'), optsMulti, 0);
        renderPlayers(lobby.names());
        lobby.onChange = () => renderPlayers(lobby.names());
        multiMsg('');
        show('lobby');
    }
    catch (e) {
        multiMsg(e.message);
    }
    finally {
        $('hostBtn').disabled = false;
    }
}
async function joinRoom() {
    const code = normalizeCode($('joinCode').value);
    if (code.length < 4)
        return multiMsg('Masukkan kode ruang dari host');
    playerName = cleanName($('nameMulti').value, 'Tamu');
    save();
    multiMsg('Menghubungkan…', false);
    $('joinBtn').disabled = true;
    try {
        const t = createGuest(netMode);
        await t.connect(code);
        const gl = new GuestLobby(t, playerName);
        guestLobby = gl;
        $('lobbyTitle').textContent = 'Ruang ' + (netMode === 'local' ? 'lokal' : 'online');
        $('lobbyCode').textContent = code;
        $('lobbyOpts').classList.add('hidden');
        $('lobbyWait').classList.remove('hidden');
        $('lobbyStart').classList.add('hidden');
        renderPlayers([]);
        gl.onChange = () => renderPlayers(gl.names, gl.names.indexOf(playerName));
        gl.onStart = (d) => {
            guestLobby = null;
            game.stop();
            begin(d, 'multi');
        };
        gl.onClosed = (why) => {
            guestLobby = null;
            toast(why, 'warn');
            goMenu();
        };
        multiMsg('');
        show('lobby');
    }
    catch (e) {
        multiMsg(e.message);
    }
    finally {
        $('joinBtn').disabled = false;
    }
}
function updateNetHint() {
    $('netHint').textContent =
        netMode === 'online'
            ? 'Main dengan teman lewat internet (peer-to-peer, tanpa server game). Bagikan kode ruang ke temanmu.'
            : 'Untuk tes tanpa internet: buka dua tab di browser yang sama — satu membuat ruang, satu bergabung dengan kode.';
}
// ---------------------------------------------------------------------------------- pengikat UI
function wire() {
    $('nameSingle').value = playerName;
    $('nameMulti').value = playerName;
    $('goSingle').addEventListener('click', () => {
        sfx.unlock();
        sfx.click();
        mountOpts($('setupOpts'), optsSingle, 1);
        show('setup');
    });
    $('goMulti').addEventListener('click', () => {
        sfx.unlock();
        sfx.click();
        updateNetHint();
        multiMsg('');
        show('multi');
    });
    $('goHow').addEventListener('click', () => {
        sfx.click();
        show('howto');
    });
    document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
        sfx.click();
        show('menu');
    }));
    $('startSingle').addEventListener('click', () => {
        playerName = cleanName($('nameSingle').value, 'Kamu');
        save();
        sfx.click();
        startSingle(optsSingle);
    });
    $('netMode').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b)
            return;
        netMode = b.dataset.v;
        $('netMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        updateNetHint();
    });
    $('hostBtn').addEventListener('click', () => void hostRoom());
    $('joinBtn').addEventListener('click', () => void joinRoom());
    $('joinCode').addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            void joinRoom();
    });
    $('copyCode').addEventListener('click', async () => {
        const code = $('lobbyCode').textContent ?? '';
        try {
            await navigator.clipboard.writeText(code);
            toast('Kode disalin: ' + code, 'good');
        }
        catch {
            toast('Kode ruang: ' + code, 'info');
        }
    });
    $('lobbyStart').addEventListener('click', () => {
        if (!hostLobby)
            return;
        const o = toMatch(optsMulti);
        if (hostLobby.names().length + o.bots < 2)
            return toast('Tambahkan bot atau tunggu pemain lain', 'warn');
        const lobby = hostLobby;
        hostLobby = null;
        game.stop();
        begin(lobby.start(o), 'multi');
    });
    $('lobbyLeave').addEventListener('click', () => {
        sfx.click();
        hostLobby?.cancel();
        guestLobby?.leave();
        hostLobby = guestLobby = null;
        show('multi');
    });
    // Tautan undangan: ?join=KODE&mode=local|online
    const q = new URLSearchParams(location.search);
    const jc = q.get('join');
    if (jc) {
        netMode = q.get('mode') === 'local' ? 'local' : 'online';
        $('netMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === netMode));
        $('joinCode').value = normalizeCode(jc);
        updateNetHint();
        show('multi');
    }
}
wire();
if (!new URLSearchParams(location.search).get('join'))
    show('menu');
startDemo();
// Untuk debugging & tes otomatis.
window.__panz = { game, get driver() { return game.driver; } };
