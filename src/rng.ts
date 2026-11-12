// Seeded RNG, so a layout is reproducible from its seed and never quite the
// same between runs.

export function makeRng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    const next = () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;  s >>>= 0;
        return s / 4294967296;
    };
    next.int = (n) => Math.floor(next() * n);
    next.range = (a, b) => a + next() * (b - a);
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    return next;
}
