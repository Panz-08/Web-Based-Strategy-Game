// Pemilih peta & negara untuk layar setup/lobi: kartu peta bergambar + peta pratinjau yang bisa diketuk.
import { MAP_META, getPreset } from "../core/maps/index.js";
import { generateMap } from "../core/mapgen.js";
import { T_FOREST, T_MOUNTAIN, T_PLAIN, T_SHALLOW, T_WATER } from "../core/types.js";
const TRAIT = { war: 'Agresif', build: 'Ekspansif', dip: 'Diplomat', bal: 'Seimbang' };
function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const COL = {
    [T_WATER]: '#0d2a3b',
    [T_SHALLOW]: '#1f5f78',
    [T_PLAIN]: '#5e6b46',
    [T_FOREST]: '#33503a',
    [T_MOUNTAIN]: '#85888f',
};
const thumbs = new Map();
/** Kanvas medan statis (cache). `px` = piksel per sel. */
function terrainCanvas(key, w, h, terrain, shade, px) {
    const k = `${key}:${px}`;
    let cv = thumbs.get(k);
    if (cv)
        return cv;
    cv = document.createElement('canvas');
    cv.width = w * px;
    cv.height = h * px;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = COL[T_WATER];
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const t = terrain[y * w + x];
            if (t === T_WATER)
                continue;
            let c = COL[t] ?? COL[T_PLAIN];
            const sh = shade ? shade[y * w + x] : 0;
            if (t === T_PLAIN && sh === 1)
                c = '#8a7c52';
            else if (t === T_PLAIN && sh === 2)
                c = '#7e8886';
            ctx.fillStyle = c;
            ctx.fillRect(x * px, y * px, px, px);
        }
    }
    thumbs.set(k, cv);
    return cv;
}
function mapThumb(id) {
    const p = getPreset(id);
    if (p)
        return terrainCanvas(p.id, p.w, p.h, p.terrain, p.shade, 2);
    const g = generateMap(20251028, 70, 46, 'continent', 2);
    return terrainCanvas('random', g.w, g.h, g.terrain, undefined, 3);
}
function blit(dst, src) {
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext('2d').drawImage(src, 0, 0);
}
export function pickerHtml(st) {
    const cards = MAP_META.map((m) => `<button type="button" class="mapcard${m.id === st.map ? ' on' : ''}" data-map="${m.id}"><canvas data-thumb="${m.id}"></canvas><b>${m.label}</b></button>`).join('');
    return {
        left: `<div class="field"><span>Peta</span><div class="mapgrid">${cards}</div><p class="hint" data-blurb></p></div>
<div class="field" data-natfield><span>Pilih negaramu <em>— ketuk titik di peta atau daftar</em></span>
<canvas class="natmap" data-natmap></canvas></div>`,
        right: `<div class="field" data-natfield><span>Negaramu</span><div class="natdesc" data-natdesc></div>
<div class="natlist" data-natlist></div></div>`,
    };
}
/** Pasang perilaku pemilih ke `host` (hasil pickerHtml). `onMap` dipanggil saat jenis peta berubah. */
export function bindPicker(host, st, onChange) {
    host.querySelectorAll('canvas[data-thumb]').forEach((cv) => blit(cv, mapThumb(cv.dataset.thumb)));
    const natFields = host.querySelectorAll('[data-natfield]');
    const natMap = host.querySelector('[data-natmap]');
    const natDesc = host.querySelector('[data-natdesc]');
    const natList = host.querySelector('[data-natlist]');
    const blurb = host.querySelector('[data-blurb]');
    const SC = 3;
    const drawNat = (p) => {
        const base = terrainCanvas(p.id, p.w, p.h, p.terrain, p.shade, SC);
        blit(natMap, base);
        const ctx = natMap.getContext('2d');
        p.nations.forEach((n, i) => {
            const x = (n.x + 0.5) * SC;
            const y = (n.y + 0.5) * SC;
            const sel = i === st.nation;
            ctx.beginPath();
            ctx.arc(x, y, sel ? 7 : 3.6, 0, Math.PI * 2);
            ctx.fillStyle = sel ? '#ffd35c' : 'rgba(255,255,255,0.85)';
            ctx.fill();
            ctx.lineWidth = sel ? 2.5 : 1.2;
            ctx.strokeStyle = sel ? '#2b2005' : 'rgba(8,24,33,0.8)';
            ctx.stroke();
        });
        const sel = p.nations[st.nation];
        if (sel) {
            ctx.font = '800 15px Rubik, system-ui, sans-serif';
            ctx.textAlign = x0(sel.x, p.w) ? 'left' : 'right';
            ctx.textBaseline = 'middle';
            const lx = (sel.x + 0.5) * SC + (x0(sel.x, p.w) ? 11 : -11);
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(5,14,20,0.9)';
            ctx.strokeText(sel.name, lx, (sel.y + 0.5) * SC);
            ctx.fillStyle = '#fff';
            ctx.fillText(sel.name, lx, (sel.y + 0.5) * SC);
        }
    };
    const refresh = () => {
        const meta = MAP_META.find((m) => m.id === st.map);
        blurb.textContent = meta.blurb;
        host.querySelectorAll('.mapcard').forEach((b) => b.classList.toggle('on', b.dataset.map === st.map));
        const p = getPreset(st.map);
        natFields.forEach((f) => f.classList.toggle('hidden', !p));
        if (!p)
            return;
        const nat = p.nations[st.nation];
        natDesc.innerHTML = nat
            ? `<b>${esc(nat.desc)}</b> · watak bot: ${TRAIT[nat.trait]}`
            : '<b>Negara acak</b> — kamu mendapat salah satu bangsa secara acak.';
        natList.innerHTML =
            `<button type="button" class="natchip${st.nation < 0 ? ' on' : ''}" data-n="-1">Acak</button>` +
                p.nations.map((n, i) => `<button type="button" class="natchip${i === st.nation ? ' on' : ''}" data-n="${i}">${esc(n.name)}</button>`).join('');
        drawNat(p);
    };
    host.querySelector('.mapgrid').addEventListener('click', (e) => {
        const b = e.target.closest('.mapcard');
        if (!b)
            return;
        const id = b.dataset.map;
        if (id === st.map)
            return;
        st.map = id;
        st.nation = -1;
        refresh();
        onChange(true);
    });
    natList.addEventListener('click', (e) => {
        const b = e.target.closest('.natchip');
        if (!b)
            return;
        st.nation = Number(b.dataset.n);
        refresh();
        onChange(false);
    });
    natMap.addEventListener('click', (e) => {
        const p = getPreset(st.map);
        if (!p)
            return;
        const r = natMap.getBoundingClientRect();
        const mx = ((e.clientX - r.left) / r.width) * p.w;
        const my = ((e.clientY - r.top) / r.height) * p.h;
        let best = -1;
        let bd = Infinity;
        p.nations.forEach((n, i) => {
            const d = (n.x + 0.5 - mx) ** 2 + (n.y + 0.5 - my) ** 2;
            if (d < bd) {
                bd = d;
                best = i;
            }
        });
        // toleransi ketukan ~ 8% lebar peta
        if (best >= 0 && bd < (p.w * 0.08) ** 2) {
            st.nation = best;
            refresh();
            onChange(false);
        }
    });
    refresh();
}
function x0(x, w) {
    return x < w * 0.7; // label di kanan titik bila titik di sisi kiri peta
}
