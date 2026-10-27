// PRNG deterministik (mulberry32) + hash integer. Tanpa Math.random agar sinkron antar klien.
export class Rng {
    s;
    constructor(seed) {
        this.s = seed >>> 0;
    }
    next() {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(n) {
        return Math.floor(this.next() * n);
    }
    range(a, b) {
        return a + this.next() * (b - a);
    }
    pick(arr) {
        return arr[this.int(arr.length)];
    }
}
export function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
