// Renderer Canvas 2D: lapisan dasar (medan) statis + lapisan wilayah (di-update tiap tick) + overlay vektor.
import { hash2 } from '../core/rng.js';
import { F_CAPITAL, F_FORT, F_MINE, PALETTE, T_FOREST, T_MOUNTAIN, T_PLAIN, T_SHALLOW, T_WATER } from '../core/types.js';
const S = 4; // piksel per sel pada kanvas offscreen
function rgbStr(c, a = 1) {
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
export class Renderer {
    canvas;
    ctx;
    sim = null;
    me = 0;
    camera = { x: 0, y: 0, z: 6 };
    viewW = 0;
    viewH = 0;
    dpr = 1;
    hover = -1;
    fortGhost = false;
    shipPreview = null; // rute kapal yang akan diluncurkan (mode Kapal)
    dim = 0; // 0..1 redupkan (untuk menu)
    base = null;
    terr = null;
    terrCtx = null;
    terrImg = null;
    lastTick = -1;
    ripples = [];
    labelPos = [];
    shown = false;
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
    }
    setSim(sim, me) {
        this.sim = sim;
        this.me = me;
        this.lastTick = -1;
        this.labelPos = [];
        this.ripples = [];
        this.buildBase();
        const w = sim.w * S;
        const h = sim.h * S;
        this.terr = document.createElement('canvas');
        this.terr.width = w;
        this.terr.height = h;
        this.terrCtx = this.terr.getContext('2d');
        this.terrImg = this.terrCtx.createImageData(w, h);
        this.resize();
        this.fit();
    }
    resize() {
        const r = this.canvas.getBoundingClientRect();
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.viewW = Math.max(1, Math.floor(r.width));
        this.viewH = Math.max(1, Math.floor(r.height));
        this.canvas.width = Math.floor(this.viewW * this.dpr);
        this.canvas.height = Math.floor(this.viewH * this.dpr);
    }
    fit(focusOn, cover = false) {
        const sim = this.sim;
        if (!sim)
            return;
        if (cover) {
            this.camera.x = sim.w / 2;
            this.camera.y = sim.h / 2;
            this.camera.z = Math.max(this.viewW / sim.w, this.viewH / sim.h) * 1.3;
            return;
        }
        if (focusOn !== undefined && focusOn >= 0) {
            this.camera.x = (focusOn % sim.w) + 0.5;
            this.camera.y = Math.floor(focusOn / sim.w) + 0.5;
            this.camera.z = Math.max(this.camera.z, Math.min(this.viewW / 55, 14));
            this.clampCamera();
            return;
        }
        this.camera.x = sim.w / 2;
        this.camera.y = sim.h / 2;
        this.camera.z = Math.min(this.viewW / sim.w, this.viewH / sim.h) * 0.96;
    }
    clampCamera() {
        const sim = this.sim;
        if (!sim)
            return;
        const minZ = Math.min(this.viewW / sim.w, this.viewH / sim.h) * 0.5;
        this.camera.z = Math.min(40, Math.max(minZ, this.camera.z));
        // Tampilan boleh melewati tepi peta ±130px (agar wilayah di tepi tidak tertutup HUD/dock); bila tak muat, pusatkan.
        const M = (this.viewW <= 720 || this.viewH <= 520 ? 56 : 130) / this.camera.z;
        const hw = this.viewW / 2 / this.camera.z - M;
        const hh = this.viewH / 2 / this.camera.z - M;
        this.camera.x = hw >= sim.w / 2 ? sim.w / 2 : Math.min(sim.w - hw, Math.max(hw, this.camera.x));
        this.camera.y = hh >= sim.h / 2 ? sim.h / 2 : Math.min(sim.h - hh, Math.max(hh, this.camera.y));
    }
    screenToWorld(sx, sy) {
        const c = this.camera;
        return { x: (sx - this.viewW / 2) / c.z + c.x, y: (sy - this.viewH / 2) / c.z + c.y };
    }
    screenToCell(sx, sy) {
        const sim = this.sim;
        if (!sim)
            return -1;
        const p = this.screenToWorld(sx, sy);
        const cx = Math.floor(p.x);
        const cy = Math.floor(p.y);
        if (cx < 0 || cy < 0 || cx >= sim.w || cy >= sim.h)
            return -1;
        return cy * sim.w + cx;
    }
    zoomAt(sx, sy, factor) {
        const before = this.screenToWorld(sx, sy);
        this.camera.z *= factor;
        this.clampCamera();
        const after = this.screenToWorld(sx, sy);
        this.camera.x += before.x - after.x;
        this.camera.y += before.y - after.y;
        this.clampCamera();
    }
    pulse(cell, color) {
        const sim = this.sim;
        if (!sim)
            return;
        this.ripples.push({ x: (cell % sim.w) + 0.5, y: Math.floor(cell / sim.w) + 0.5, t: performance.now(), color });
    }
    // ------------------------------------------------------------------ lapisan dasar
    buildBase() {
        const sim = this.sim;
        const { w, h, terrain } = sim;
        const cv = document.createElement('canvas');
        cv.width = w * S;
        cv.height = h * S;
        const cx = cv.getContext('2d');
        const img = cx.createImageData(w * S, h * S);
        const d = img.data;
        const { region, shade } = sim.map;
        const land = (x, y) => x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] !== T_WATER && terrain[y * w + x] !== T_SHALLOW;
        const reg = (x, y) => (x >= 0 && y >= 0 && x < w && y < h && region ? region[y * w + x] : -1);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const t = terrain[y * w + x];
                let r;
                let g;
                let b;
                if (t === T_WATER) {
                    let shallow = 0;
                    for (let dy = -2; dy <= 2; dy++)
                        for (let dx = -2; dx <= 2; dx++)
                            if (land(x + dx, y + dy))
                                shallow = Math.max(shallow, 3 - Math.max(Math.abs(dx), Math.abs(dy)));
                    const k = shallow / 3;
                    r = 10 + 8 * k;
                    g = 34 + 36 * k;
                    b = 50 + 40 * k;
                }
                else if (t === T_SHALLOW)
                    [r, g, b] = [34, 86, 108];
                else if (t === T_PLAIN) {
                    const sh = shade ? shade[y * w + x] : 0;
                    if (sh === 1)
                        [r, g, b] = [128, 116, 78];
                    else if (sh === 2)
                        [r, g, b] = [120, 130, 128];
                    else
                        [r, g, b] = [78, 86, 64];
                }
                else if (t === T_FOREST)
                    [r, g, b] = [48, 68, 50];
                else
                    [r, g, b] = [84, 92, 104];
                // Batas negara nyata (hanya di peta dunia nyata): garis tipis antar wilayah daratan.
                const rc = region ? region[y * w + x] : 0;
                const bL = region !== undefined && rc > 0 && reg(x - 1, y) > 0 && reg(x - 1, y) !== rc;
                const bR = region !== undefined && rc > 0 && reg(x + 1, y) > 0 && reg(x + 1, y) !== rc;
                const bU = region !== undefined && rc > 0 && reg(x, y - 1) > 0 && reg(x, y - 1) !== rc;
                const bD = region !== undefined && rc > 0 && reg(x, y + 1) > 0 && reg(x, y + 1) !== rc;
                const jit = t === T_MOUNTAIN ? 0.97 + 0.06 * hash2(x, y, 99) : 0.93 + 0.14 * hash2(x, y, 99);
                for (let py = 0; py < S; py++) {
                    for (let px = 0; px < S; px++) {
                        let sh = jit;
                        if (t === T_MOUNTAIN)
                            sh *= 1.22 - (px + py) * 0.09 + 0.06 * hash2(x * S + px, y * S + py, 8);
                        else if (t === T_FOREST)
                            sh *= 0.9 + 0.2 * hash2(x * S + px, y * S + py, 5);
                        else if (t === T_PLAIN)
                            sh *= 0.97 + 0.06 * hash2(x * S + px, y * S + py, 6);
                        if (t === T_SHALLOW)
                            sh *= 0.92 + 0.12 * ((px + py + x + y) % 2);
                        if ((px === 0 && bL) || (px === S - 1 && bR) || (py === 0 && bU) || (py === S - 1 && bD))
                            sh *= 0.74;
                        const o = ((y * S + py) * w * S + x * S + px) * 4;
                        d[o] = Math.min(255, r * sh);
                        d[o + 1] = Math.min(255, g * sh);
                        d[o + 2] = Math.min(255, b * sh);
                        d[o + 3] = 255;
                    }
                }
            }
        }
        cx.putImageData(img, 0, 0);
        this.base = cv;
    }
    // ------------------------------------------------------------------ lapisan wilayah
    updateTerritory() {
        const sim = this.sim;
        const img = this.terrImg;
        const d = img.data;
        const { w, h, owner, terrain, linked, changedAt, tick } = sim;
        const W = w * S;
        const sx = new Float64Array(sim.players.length);
        const sy = new Float64Array(sim.players.length);
        const cnt = new Float64Array(sim.players.length);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const c = y * w + x;
                const o = owner[c];
                const base0 = (y * S * W + x * S) * 4;
                if (o === 0 || terrain[c] === T_WATER) {
                    for (let py = 0; py < S; py++) {
                        const row = base0 + py * W * 4;
                        for (let px = 0; px < S; px++)
                            d[row + px * 4 + 3] = 0;
                    }
                    continue;
                }
                sx[o] += x;
                sy[o] += y;
                cnt[o]++;
                const col = PALETTE[o].rgb;
                const age = tick - changedAt[c];
                const flash = age >= 0 && age < 6 ? (6 - age) / 6 : 0;
                const cut = linked[c] === 0;
                const eL = x > 0 && owner[c - 1] !== o;
                const eR = x < w - 1 && owner[c + 1] !== o;
                const eU = y > 0 && owner[c - w] !== o;
                const eD = y < h - 1 && owner[c + w] !== o;
                for (let py = 0; py < S; py++) {
                    for (let px = 0; px < S; px++) {
                        const edge = (px === 0 && eL) || (px === S - 1 && eR) || (py === 0 && eU) || (py === S - 1 && eD);
                        let r = col[0];
                        let g = col[1];
                        let b = col[2];
                        let a = 168;
                        if (edge) {
                            r *= 0.55;
                            g *= 0.55;
                            b *= 0.55;
                            a = 255;
                        }
                        else if (cut) {
                            const stripe = (x * S + px + y * S + py) % 8 < 4;
                            a = stripe ? 120 : 60;
                        }
                        if (flash > 0) {
                            r += (255 - r) * flash * 0.8;
                            g += (255 - g) * flash * 0.8;
                            b += (255 - b) * flash * 0.8;
                            a = Math.min(255, a + 70 * flash);
                        }
                        const i = base0 + (py * W + px) * 4;
                        d[i] = r;
                        d[i + 1] = g;
                        d[i + 2] = b;
                        d[i + 3] = a;
                    }
                }
            }
        }
        this.terrCtx.putImageData(img, 0, 0);
        // posisi label (dihaluskan)
        for (let id = 1; id < sim.players.length; id++) {
            const n = cnt[id];
            if (n < 1)
                continue;
            const tx = sx[id] / n + 0.5;
            const ty = sy[id] / n + 0.5;
            const lp = this.labelPos[id];
            if (!lp)
                this.labelPos[id] = { x: tx, y: ty, n };
            else {
                lp.x += (tx - lp.x) * 0.3;
                lp.y += (ty - lp.y) * 0.3;
                lp.n = n;
            }
        }
    }
    // ------------------------------------------------------------------ gambar
    render(now) {
        const sim = this.sim;
        const ctx = this.ctx;
        if (!sim || !this.base || !this.terr) {
            ctx.fillStyle = '#0a1c28';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }
        if (sim.tick !== this.lastTick || !this.shown) {
            this.updateTerritory();
            this.lastTick = sim.tick;
            this.shown = true;
        }
        const { dpr, camera: cam } = this;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#081821';
        ctx.fillRect(0, 0, this.viewW, this.viewH);
        ctx.save();
        ctx.translate(this.viewW / 2 - cam.x * cam.z, this.viewH / 2 - cam.y * cam.z);
        ctx.scale(cam.z, cam.z);
        ctx.imageSmoothingEnabled = cam.z < 5;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.base, 0, 0, sim.w, sim.h);
        ctx.drawImage(this.terr, 0, 0, sim.w, sim.h);
        this.drawFeatures(ctx, now);
        this.drawOffensives(ctx, now);
        this.drawShips(ctx, now);
        this.drawLabels(ctx);
        this.drawHover(ctx);
        this.drawRipples(ctx, now);
        ctx.restore();
        if (this.dim > 0) {
            ctx.fillStyle = `rgba(6,16,24,${this.dim})`;
            ctx.fillRect(0, 0, this.viewW, this.viewH);
        }
    }
    visible(x, y, pad) {
        const c = this.camera;
        const hw = this.viewW / 2 / c.z + pad;
        const hh = this.viewH / 2 / c.z + pad;
        return Math.abs(x - c.x) < hw && Math.abs(y - c.y) < hh;
    }
    drawFeatures(ctx, now) {
        const sim = this.sim;
        const { w, feat, owner } = sim;
        const unit = Math.max(1, 10 / this.camera.z); // ikon minimal ~10px di layar
        const tw = (now / 700) % (Math.PI * 2);
        for (let c = 0; c < sim.n; c++) {
            const f = feat[c];
            if (f === 0)
                continue;
            const x = (c % w) + 0.5;
            const y = Math.floor(c / w) + 0.5;
            if (!this.visible(x, y, 2))
                continue;
            const o = owner[c];
            const col = o ? PALETTE[o].rgb : [200, 200, 200];
            if (f === F_MINE) {
                const s = unit * 0.55;
                ctx.beginPath();
                ctx.moveTo(x, y - s);
                ctx.lineTo(x + s * 0.8, y);
                ctx.lineTo(x, y + s);
                ctx.lineTo(x - s * 0.8, y);
                ctx.closePath();
                ctx.fillStyle = '#ffd35c';
                ctx.fill();
                ctx.lineWidth = unit * 0.1;
                ctx.strokeStyle = o ? rgbStr(col, 1) : '#6a5320';
                ctx.stroke();
                ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.3 * Math.sin(tw + c)})`;
                ctx.fillRect(x - s * 0.1, y - s * 0.6, s * 0.2, s * 0.35);
            }
            else if (f === F_CAPITAL) {
                const s = unit * 0.75;
                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const ang = (Math.PI / 5) * i - Math.PI / 2;
                    const rad = i % 2 === 0 ? s : s * 0.45;
                    ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
                }
                ctx.closePath();
                ctx.fillStyle = '#fff6d6';
                ctx.fill();
                ctx.lineWidth = unit * 0.14;
                ctx.strokeStyle = rgbStr(col, 1);
                ctx.stroke();
            }
            else if (f === F_FORT) {
                const s = unit * 0.6;
                const ready = !sim.forts.some((fo) => fo.idx === c && fo.readyAt > sim.tick);
                ctx.globalAlpha = ready ? 1 : 0.55;
                ctx.fillStyle = '#e9eef2';
                ctx.fillRect(x - s, y - s * 0.7, s * 2, s * 1.5);
                ctx.fillRect(x - s, y - s * 1.05, s * 0.5, s * 0.4);
                ctx.fillRect(x - s * 0.25, y - s * 1.05, s * 0.5, s * 0.4);
                ctx.fillRect(x + s * 0.5, y - s * 1.05, s * 0.5, s * 0.4);
                ctx.lineWidth = unit * 0.14;
                ctx.strokeStyle = rgbStr(col, 1);
                ctx.strokeRect(x - s, y - s * 0.7, s * 2, s * 1.5);
                ctx.globalAlpha = 1;
            }
        }
    }
    drawOffensives(ctx, now) {
        const sim = this.sim;
        const unit = 1 / this.camera.z;
        for (const o of sim.offensives) {
            const p = sim.players[o.owner];
            const from = p.capital >= 0 ? p.capital : o.focus;
            const fx = (from % sim.w) + 0.5;
            const fy = Math.floor(from / sim.w) + 0.5;
            const tx = (o.focus % sim.w) + 0.5;
            const ty = Math.floor(o.focus / sim.w) + 0.5;
            const mine = o.owner === this.me || o.target === this.me;
            ctx.globalAlpha = mine ? 0.9 : 0.28;
            ctx.strokeStyle = rgbStr(PALETTE[o.owner].rgb, 1);
            ctx.lineWidth = Math.max(1.5, mine ? 2.5 : 1.5) * unit;
            ctx.setLineDash([6 * unit, 6 * unit]);
            ctx.lineDashOffset = -(now / 40) * unit;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.setLineDash([]);
            const rr = (7 + 2 * Math.sin(now / 200)) * unit;
            ctx.beginPath();
            ctx.arc(tx, ty, rr, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
    /** Nama negara modern (peta nyata) sebagai orientasi — tipis, di bawah label pemain. */
    drawCountryNames(ctx) {
        const sim = this.sim;
        const { labels, regionNames } = sim.map;
        if (!labels || !regionNames)
            return;
        const z = this.camera.z;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (const l of labels) {
            const px = Math.min(17, Math.sqrt(l.cells) * 0.2 * z);
            if (px < 8)
                continue;
            const x = l.x + 0.5;
            const y = l.y + 0.5;
            if (!this.visible(x, y, 6))
                continue;
            const size = px / z;
            ctx.font = `600 ${size}px Rubik, system-ui, sans-serif`;
            ctx.lineWidth = size * 0.2;
            ctx.strokeStyle = 'rgba(5,14,20,0.55)';
            ctx.fillStyle = 'rgba(236,242,246,0.62)';
            const name = regionNames[l.region];
            ctx.strokeText(name, x, y);
            ctx.fillText(name, x, y);
        }
    }
    /** Jalur pelayaran, pratinjau rute, dan kapal yang sedang berlayar. */
    drawShips(ctx, now) {
        const sim = this.sim;
        const w = sim.w;
        const u = 1 / this.camera.z;
        const xy = (c) => [(c % w) + 0.5, Math.floor(c / w) + 0.5];
        for (const l of sim.seaLinks) {
            const [ax, ay] = xy(l.a);
            const [bx, by] = xy(l.b);
            if (!this.visible((ax + bx) / 2, (ay + by) / 2, Math.hypot(ax - bx, ay - by) / 2 + 3))
                continue;
            ctx.globalAlpha = l.owner === this.me ? 0.6 : 0.22;
            ctx.strokeStyle = rgbStr(PALETTE[l.owner].rgb, 1);
            ctx.lineWidth = 1.6 * u;
            ctx.setLineDash([2 * u, 5 * u]);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const pv = this.shipPreview;
        if (pv) {
            const [dx, dy] = xy(pv.dst);
            const col = pv.ok ? '#8ee6a0' : '#ff8a7a';
            ctx.strokeStyle = col;
            ctx.fillStyle = col;
            ctx.lineWidth = 2.2 * u;
            if (pv.ok && pv.src >= 0) {
                const [sx, sy] = xy(pv.src);
                ctx.setLineDash([6 * u, 5 * u]);
                ctx.lineDashOffset = -(now / 50) * u;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(dx, dy);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(sx, sy, 4 * u, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(dx, dy, (8 + Math.sin(now / 150) * 1.5) * u, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (const sh of sim.ships) {
            const [fx, fy] = xy(sh.from);
            const [tx, ty] = xy(sh.to);
            const k = Math.min(1, Math.max(0, (sim.tick - sh.depart) / Math.max(1, sh.arrive - sh.depart)));
            const mine = sh.owner === this.me;
            // jejak pelayaran
            ctx.globalAlpha = mine ? 0.5 : 0.22;
            ctx.strokeStyle = rgbStr(PALETTE[sh.owner].rgb, 1);
            ctx.lineWidth = 1.4 * u;
            ctx.setLineDash([3 * u, 5 * u]);
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            const x = fx + (tx - fx) * k;
            const y = fy + (ty - fy) * k + Math.sin(now / 220 + sh.id) * 0.12 * Math.min(2, 8 * u);
            if (!this.visible(x, y, 3))
                continue;
            const sz = Math.max(0.9, (mine ? 15 : 12) * u);
            const dir = tx >= fx ? 1 : -1;
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(sz * dir, sz);
            ctx.lineJoin = 'round';
            ctx.lineWidth = 0.16;
            ctx.strokeStyle = 'rgba(5,14,20,0.9)';
            ctx.fillStyle = rgbStr(PALETTE[sh.owner].rgb, 1);
            ctx.beginPath();
            ctx.moveTo(-1, 0.15);
            ctx.lineTo(1, 0.15);
            ctx.lineTo(0.65, 0.7);
            ctx.lineTo(-0.65, 0.7);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#f4f7f8';
            ctx.beginPath();
            ctx.moveTo(0.05, -1);
            ctx.lineTo(0.85, 0.05);
            ctx.lineTo(0.05, 0.05);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }
    drawLabels(ctx) {
        const sim = this.sim;
        this.drawCountryNames(ctx);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let id = 1; id < sim.players.length; id++) {
            const p = sim.players[id];
            const lp = this.labelPos[id];
            if (!p.alive || !lp || lp.n < 10)
                continue;
            const px = Math.min(20, Math.sqrt(lp.n) * 0.26 * this.camera.z);
            if (px < 10)
                continue;
            const size = px / this.camera.z;
            ctx.font = `800 ${size}px Rubik, system-ui, sans-serif`;
            ctx.lineJoin = 'round';
            ctx.lineWidth = size * 0.22;
            ctx.strokeStyle = 'rgba(5,14,20,0.85)';
            ctx.strokeText(p.name, lp.x, lp.y);
            ctx.fillStyle = '#fff';
            ctx.fillText(p.name, lp.x, lp.y);
            const tag = this.relTag(id);
            if (tag && px >= 12) {
                const ts = size * 0.55;
                ctx.font = `800 ${ts}px Rubik, system-ui, sans-serif`;
                ctx.lineWidth = ts * 0.25;
                ctx.strokeText(tag.text, lp.x, lp.y + size * 0.85);
                ctx.fillStyle = tag.color;
                ctx.fillText(tag.text, lp.x, lp.y + size * 0.85);
            }
        }
    }
    /** Keterangan hubungan negara `id` terhadap pemain di bawah label wilayahnya. */
    relTag(id) {
        const sim = this.sim;
        const p = sim.players[id];
        if (!this.me || !sim.players[this.me])
            return null;
        if (id === this.me)
            return p.lord ? { text: 'BONEKA ' + (sim.players[p.lord]?.name ?? '').toUpperCase(), color: '#dcc0ff' } : null;
        switch (sim.relKind(this.me, id)) {
            case 'war':
                return { text: 'PERANG', color: '#ff8a7a' };
            case 'alliance':
                return { text: 'SEKUTU', color: '#8ee6a0' };
            case 'nap':
                return { text: 'PAKTA', color: '#9cc4ff' };
            case 'truce':
                return { text: 'GENCATAN', color: '#9cc4ff' };
            case 'vassal':
                return p.lord === this.me ? { text: 'BONEKAMU', color: '#dcc0ff' } : { text: 'TUANMU', color: '#dcc0ff' };
        }
        return p.lord ? { text: 'BONEKA', color: '#dcc0ff' } : null;
    }
    drawHover(ctx) {
        const sim = this.sim;
        if (this.hover < 0)
            return;
        const x = this.hover % sim.w;
        const y = Math.floor(this.hover / sim.w);
        ctx.lineWidth = 2 / this.camera.z;
        ctx.strokeStyle = this.fortGhost ? '#ffd35c' : 'rgba(255,255,255,0.9)';
        ctx.strokeRect(x, y, 1, 1);
        if (this.fortGhost) {
            const r = 4;
            ctx.setLineDash([3 / this.camera.z, 3 / this.camera.z]);
            ctx.strokeStyle = 'rgba(255,211,92,0.7)';
            ctx.strokeRect(x - r + 0.5, y - r + 0.5, r * 2, r * 2);
            ctx.setLineDash([]);
        }
    }
    drawRipples(ctx, now) {
        this.ripples = this.ripples.filter((r) => now - r.t < 650);
        for (const r of this.ripples) {
            const k = (now - r.t) / 650;
            ctx.strokeStyle = r.color;
            ctx.globalAlpha = 1 - k;
            ctx.lineWidth = 3 / this.camera.z;
            ctx.beginPath();
            ctx.arc(r.x, r.y, (0.5 + k * 9), 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
    // ------------------------------------------------------------------ minimap
    drawMinimap(cv) {
        const sim = this.sim;
        if (!sim || !this.base || !this.terr)
            return;
        // Kanvas minimap mengikuti rasio peta (peta dunia nyata tidak 3:2).
        const mw = 240;
        const mh = Math.max(60, Math.round((mw * sim.h) / sim.w));
        if (cv.width !== mw || cv.height !== mh) {
            cv.width = mw;
            cv.height = mh;
        }
        const cx = cv.getContext('2d');
        const W = cv.width;
        const H = cv.height;
        cx.clearRect(0, 0, W, H);
        cx.imageSmoothingEnabled = true;
        cx.drawImage(this.base, 0, 0, W, H);
        cx.drawImage(this.terr, 0, 0, W, H);
        const c = this.camera;
        const vw = this.viewW / c.z;
        const vh = this.viewH / c.z;
        cx.strokeStyle = '#ffd35c';
        cx.lineWidth = 1.5;
        cx.strokeRect(((c.x - vw / 2) / sim.w) * W, ((c.y - vh / 2) / sim.h) * H, (vw / sim.w) * W, (vh / sim.h) * H);
    }
}
