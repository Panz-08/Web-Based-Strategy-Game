import { EUROPE_MAP } from './europe.js';
import { MIDEAST_MAP } from './mideast.js';
import { WORLD_MAP } from './world.js';
export const MAP_META = [
    { id: 'world', label: 'Dunia', blurb: 'Seluruh bumi. Benua dihubungkan selat dangkal; 28 bangsa & kerajaan.' },
    { id: 'mideast', label: 'Timur Tengah', blurb: 'Dari Anatolia sampai Persia, Jazirah Arab, dan Mesir.' },
    { id: 'europe', label: 'Eropa', blurb: 'Dari Iberia sampai Rusia, Skandinavia sampai Mediterania.' },
    { id: 'random', label: 'Acak', blurb: 'Pulau & benua prosedural, berbeda tiap permainan.' },
];
function unrle(runs, n) {
    const out = new Uint8Array(n);
    let i = 0;
    for (let k = 0; k + 1 < runs.length; k += 2) {
        const v = runs[k];
        const len = runs[k + 1];
        if (v)
            out.fill(v, i, i + len);
        i += len;
    }
    return out;
}
const RAW = {
    world: { data: WORLD_MAP, blurb: MAP_META[0].blurb },
    mideast: { data: MIDEAST_MAP, blurb: MAP_META[1].blurb },
    europe: { data: EUROPE_MAP, blurb: MAP_META[2].blurb },
};
const cache = new Map();
export function isPreset(id) {
    return id === 'world' || id === 'mideast' || id === 'europe';
}
export function getPreset(id) {
    if (!isPreset(id))
        return null;
    let p = cache.get(id);
    if (p)
        return p;
    const { data: d, blurb } = RAW[id];
    const n = d.w * d.h;
    p = {
        id,
        label: d.label,
        blurb,
        w: d.w,
        h: d.h,
        spawnR: d.spawnR,
        terrain: unrle(d.terrain, n),
        region: unrle(d.region, n),
        shade: unrle(d.shade, n),
        regions: d.regions,
        labels: d.labels.map((l) => ({ region: l[0], x: l[1], y: l[2], cells: l[3] })),
        mines: d.mines,
        nations: d.nations,
    };
    cache.set(id, p);
    return p;
}
/** Jumlah bangsa maksimum yang bisa dimainkan (manusia + bot) pada peta. */
export function maxPlayers(id) {
    const p = getPreset(id);
    return Math.min(16, p ? p.nations.length : 16);
}
