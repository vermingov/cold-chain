// Tissue: the wall of the belly, as two sheets under tension.
//
// A wound is not drawn here, it happens. The wall is two sheets lying one on
// the other, each a net of places joined by threads (lattice.js):
//
//   the skin     with the fat under it. Stretched tight over the body, more
//                across the belly than down it, and held to what is under
//                it by loose tissue that lets it slide a little.
//   the deep     the white sheet, the muscle and the lining. Stiffer, drawn
//                tight by the flanks, and held by nothing but its own edges
//                and the bone it grows from over the ribs.
//
// Every thread is shorter than the gap it spans: that is the tension. A
// blade parts the thread between two triangles (blade.js), wholly or only
// part of the way through the sheet, and then nothing holds the two sides
// together there but what is left of it, so they draw apart until the pull
// of the sheet is met by what holds it down. Nobody says how wide a cut
// gapes or what shape a crossing of two cuts is. It comes out.
//
// The sheets are flat here: every place is a spot on the field, in metres
// across and down it. What that is in the world is flesh.js's to say.

import { STEP } from './lattice.js';

// How much of the wall's thickness is the skin and its fat. An old man of
// ordinary build: about 2 mm of skin and 10 of fat over 12 of sheath,
// muscle and lining (dev/research/tissue-mechanics.md, section 1).
export const SKIN = 0.5;
export const [SKIN_SHEET, DEEP_SHEET] = [0, 1];

// How stiff a thread of each sheet is, against the skin's.
const STIFF = [1, 3];
// A thread stretched past `at` times its length at rest is `stiffer` times
// as hard to stretch any further: skin can be drawn out a little way, and
// then the whole belly comes with it. (Skin's stress-strain curve turns up
// at 1.1-1.25 and it tears at 1.3-1.5: dev/research/tissue-mechanics.md.) It does not come on all at once but
// over `eases` either side, as a share of the length: what stiffens at a
// stroke is thrown back and forth across the stroke.
const TAUT = { at: 1.2, stiffer: 20, eases: 0.05 };
// Pushed together, flesh pushes back: by the room it takes, a triangle at a
// time, and not along its threads. (Threads that push back buckle, and a
// sheet that has buckled lies folded over itself and never comes to rest.)
// In less room than it takes at rest it pushes `back`, against a thread's
// pull. And it cannot be pushed up into less than `packed` of that room at
// all, since flesh has to go somewhere: short of that it is `harder` to
// squash, coming on over `eases` either side as stiffening does. A hand can
// stretch flesh, and cannot make it less.
const SQUASH = { back: 1, packed: 0.55, harder: 120, eases: 0.05 };
// What holds the sheets, against the same: the loose tissue between skin and
// deep, to each place; whatever the deep sheet is hung from besides its
// edges; and, for each sheet, what holds the two sides of a cut together
// when the blade has hardly marked it (it falls away as the cut deepens: the
// white sheet holds until it is nearly through).
// (And once what bears a sheet's tension is cut through, what is left under
// it holds the lips `fat` as hard as it held them before.)
const HOLDS = { tether: 0.03, anchor: 0.005, bridge: [0.9, 12], fat: 0.02 };
// What ties two points gives only so far, and then holds hard. Skin slides
// `slides` metres on what is under it and no further without being cut free
// of it. And the lips of a cut that is not through come no further apart
// than the cut is deep (`opens` times that): what is uncut under it is
// still one piece; unless what bears the sheet's tension is cut through,
// and then they come `parted` times the sheet's thickness apart before what
// is under them holds. Past its give a tie is `stiff`, against a thread of skin.
const GIVE = { slides: 0.015, opens: 1.0, stiff: 0.5, parted: 2 };
// And flesh tears, where it has somewhere to tear from: whole skin cannot
// be torn by a hand, and is not. At the end of a cut, where the two sides
// of the next stretch of the net are drawn `apart` times as far from each
// other as they lie at rest (the skin's, the deep sheet's), the sheet rips
// on through that stretch, and the pull then falls on the one after, so a
// rip runs. It runs a stretch at a time, with `waits` turns between for
// the flesh to take up what it was given, and only while a hand is pulling:
// a wound does not tear itself longer by gaping. The
// lips of a cut that is not through, dragged further apart than they give by
// `lips` times the thickness of what is left uncut, tear the rest of the way
// through. And skin dragged `skin` times as far as it slides comes away from
// what is under it, beginning at a lip and working in from there.
const TEAR = { apart: [1.4, 1.3], waits: 6, lips: 2, skin: 1.5, straightens: 0.45 };
// How the sheets come to rest. Each turn a place goes `step` of the way the
// pulls on it would take it, and carries on with `carry` of what it was
// already doing, which is what makes flesh spring and then creep. (Unless
// it is up against flesh that has stopped giving, and the pulls on it are
// now against the way it is going: then it stops and goes with them.
// Carried on regardless, it bounces off harder than it came, and never
// rests.) What
// moves stirs the tissue `spreads` metres round it. Once nothing has moved
// `still` metres in a turn, `turns` turns running, it is at rest.
const SETTLE = { step: 1.0, carry: 0.88, spreads: 3 * STEP, still: 5e-6, turns: 20 };
const FLAT = 0.08 * STEP * STEP;                // square metres (twice over): a triangle with less than this to it is as good as flat
const ROOM = 16384;             // places that can be made by cutting: each cut makes two lips where there was one skin
const BIN = 0.016;              // metres square: triangles are looked up by where they began
// A piece cut or torn free comes away from the body in the hand. One of more
// than `most` triangles (about 18 cm square) is taken to be still part of it.
const PIECE = { most: 3000 };
// A hand: how much skin it has hold of and how near it must be to take any,
// in metres; how hard it pulls on each point it has, against a thread of
// skin; and how far ahead of what it holds it can get before it is pulling
// as hard as a hand can.
const HAND = { takes: 0.03, finds: 0.015, pulls: 0.06, leads: 0.1 };

export class Tissue {
    // `net` is a lattice. `body` says what the sheets are of:
    //   held(x, y)             whether the skin there is fixed (the edge of what is cut)
    //   bone(x, y)             whether the deep sheet there is bone
    //   strain(sheet, x, y)    how tight the sheet is drawn there: [across, down], each a share of its length
    //   thick                  how thick each sheet is, in metres: [skin, deep]
    //   bears                  how much of each sheet, from the top, is what bears its tension: [the skin
    //                          proper over its fat, the whole deep sheet]
    constructor(net, body) {
        this.net = net;
        this.body = body;
        const places = net.count, room = places * 2 + ROOM, column = () => new Float32Array(room);
        // Where each place of the net is now. Both sheets have one, and a blade can move it (blade.js).
        this.homeX = net.x.slice();
        this.homeY = net.y.slice();
        // The points of the sheets: the skin's, then the deep sheet's, then
        // whatever cutting has made. Each is at a place of the net.
        this.count = places * 2;
        this.x = column(); this.y = column();
        this.goingX = column(); this.goingY = column();
        this.pullX = column(); this.pullY = column(); this.grip = column();
        this.wasX = column(); this.wasY = column();         // where each point was when the tissue was last let move
        this.place = new Uint32Array(room);
        this.sheet = new Uint8Array(room);
        this.fixed = new Uint8Array(room);          // whether the body holds it where it is
        this.firm = new Uint8Array(room);           // whether, this turn, something that has stopped giving has hold of it
        for (let p = 0; p < places; p++) {
            for (const sheet of [SKIN_SHEET, DEEP_SHEET]) {
                const point = sheet * places + p;
                this.x[point] = net.x[p]; this.y[point] = net.y[p];
                this.place[point] = p; this.sheet[point] = sheet;
                this.fixed[point] = body.held(net.x[p], net.y[p]) || (sheet === DEEP_SHEET && body.bone(net.x[p], net.y[p])) ? 1 : 0;
            }
        }
        // Each sheet: its triangles' corners as points, each side's length
        // at rest and each triangle's room at rest (twice its area), which
        // sides are threads of their own (a side two triangles share is
        // one thread until it is cut), and how far through each stretch of
        // the net it has been cut, 0 to 1.
        this.sheets = [SKIN_SHEET, DEEP_SHEET].map((sheet) => {
            const tri = net.tris.map((p) => sheet * places + p), owns = new Uint8Array(tri.length);
            for (let e = 0; e < net.edges.count; e++) owns[this._side(net.edges.t1[e], e)] = 1;
            return { tri, rest: new Float32Array(tri.length), room: new Float32Array(tri.length / 3), owns, cut: new Float32Array(net.edges.count), cuts: [], gone: new Uint8Array(tri.length / 3) };
        });
        for (let p = 0; p < places; p++) this._measure(p);
        // Skin is tied to deep place by place, until a place is in more
        // than one piece: then each piece of skin is tied to whichever
        // pieces of deep lie under the same triangles.
        this.whole = new Uint8Array(places).fill(1);
        this.tied = new Uint8Array(places).fill(1);         // whether the skin at each place is still tied to what is under it
        this.lip = new Uint8Array(places * 2);              // how many stretches cut through meet at each place of each sheet: none, one at the end of a cut, more along it
        this.ends = [new Set(), new Set()];                 // the places of each sheet where a cut ends
        this.loose = new Uint8Array(room);                  // whether each point of the deep sheet is of a piece cut right out of the body
        this.piece = new Int32Array(room);                  // (for finding those: a point of the same piece as each)
        this.parted = new Set();
        this.ties = { skin: [], deep: [], share: [], place: [] };
        this.bridges = { a: [], b: [], holds: [], gives: [], tears: [], sheet: [], edge: [] };
        this.undone = new Set();        // sheet and place, as one number, of what a cut has left to be parted
        this.loosened = false;          // whether any cut is deeper than when the bridges were last made
        this.shape = 0;                 // goes up whenever a sheet is in more pieces than it was
        this.went = 0;                  // metres the point that got furthest went, the last time the tissue was let move
        this.gave = 0;                  // goes up whenever a stretch of the deep sheet is cut right through: the wall has given there
        this.tore = 0;                  // goes up whenever anything tears
        this.rested = 0;                // turns since a sheet last ripped
        this.torn = { skin: [], lips: [] };     // what was dragged too far this turn: places of skin, and bridges
        this.reach = 0;                 // metres the furthest any point has been from where it began
        this.astir = null;              // where the tissue is moving: { x0, y0, x1, y1 } on the field, or null when all of it is at rest
        this.quiet = 0;                 // turns since anything last moved
        this.hand = null;               // what a hand has hold of: { points, fromX, fromY, dx, dy }, where they were taken and how far the hand has gone since
        this.pins = [];                 // what retractors hold where a hand left it, each as a hand's hold is kept
        // Where each triangle began: its middle. They are in rows down the field, like the places.
        const middle = (of) => Float32Array.from({ length: net.tris.length / 3 }, (_, t) => (of[net.tris[t * 3]] + of[net.tris[t * 3 + 1]] + of[net.tris[t * 3 + 2]]) / 3);
        this.triX = middle(net.x);
        this.triY = middle(net.y);
        this.bins = this._bins();
        // The stretch of the net along each side of each triangle (an index into a sheet's `tri`, at the side's first corner).
        this.sides = new Int32Array(net.tris.length).fill(-1);
        for (let e = 0; e < net.edges.count; e++) for (const t of [net.edges.t1[e], net.edges.t2[e]]) if (t >= 0) this.sides[this._side(t, e)] = e;
    }

    // Which side of triangle `t` stretch `e` is: an index into a sheet's `tri`, at the side's first corner.
    _side(t, e) {
        const { tris, edges } = this.net, a = edges.a[e], b = edges.b[e];
        for (let k = 0; k < 3; k++) {
            const from = tris[t * 3 + k], to = tris[t * 3 + (k + 1) % 3];
            if ((from === a && to === b) || (from === b && to === a)) return t * 3 + k;
        }
        throw new Error('stretch ' + e + ' is no side of triangle ' + t);
    }

    // Which corner of triangle `t` is at place `p`: an index into a sheet's `tri`.
    _corner(t, p) {
        const tris = this.net.tris;
        return tris[t * 3] === p ? t * 3 : tris[t * 3 + 1] === p ? t * 3 + 1 : t * 3 + 2;
    }

    // Work out again how long every thread at a place is when nothing pulls
    // on it: the distance it spans, less however tight the sheet is drawn
    // the way it runs. And how much room every triangle there takes, the
    // same way.
    _measure(p) {
        const { net, homeX, homeY } = this;
        for (let r = net.round.from[p]; r < net.round.from[p + 1]; r++) {
            const t = net.round.tri[r], [a, b, c] = net.tris.subarray(t * 3, t * 3 + 3);
            const spans = (homeX[b] - homeX[a]) * (homeY[c] - homeY[a]) - (homeX[c] - homeX[a]) * (homeY[b] - homeY[a]);
            for (const sheet of [SKIN_SHEET, DEEP_SHEET]) {
                const [across, down] = this.body.strain(sheet, (homeX[a] + homeX[b] + homeX[c]) / 3, (homeY[a] + homeY[b] + homeY[c]) / 3);
                this.sheets[sheet].room[t] = spans * (1 - across) * (1 - down);
            }
        }
        for (let n = net.near.from[p]; n < net.near.from[p + 1]; n++) {
            const e = net.near.edge[n], a = net.edges.a[e], b = net.edges.b[e];
            const dx = homeX[b] - homeX[a], dy = homeY[b] - homeY[a], far = Math.hypot(dx, dy);
            for (const sheet of [SKIN_SHEET, DEEP_SHEET]) {
                const [across, down] = this.body.strain(sheet, (homeX[a] + homeX[b]) / 2, (homeY[a] + homeY[b]) / 2);
                const rest = far * (1 - (across * dx * dx + down * dy * dy) / (far * far));
                for (const t of [net.edges.t1[e], net.edges.t2[e]]) if (t >= 0) this.sheets[sheet].rest[this._side(t, e)] = rest;
            }
        }
    }

    // --- cutting ---------------------------------------------------------------

    // Move a place of the net (a blade puts places on its own line), and
    // every point of both sheets that is at it by as much.
    shift(p, x, y) {
        const dx = x - this.homeX[p], dy = y - this.homeY[p], net = this.net;
        this.homeX[p] = x;
        this.homeY[p] = y;
        for (const sheet of this.sheets) {
            const moved = new Set();
            for (let r = net.round.from[p]; r < net.round.from[p + 1]; r++) moved.add(sheet.tri[this._corner(net.round.tri[r], p)]);
            for (const point of moved) { this.x[point] += dx; this.y[point] += dy; }
        }
        this._measure(p);
        this._stir(x, y, 2 * STEP);
    }

    // Part stretch `e` of a sheet: `through` of the way (0 to 1), if that is further than it is cut already.
    part(sheet, e, through) {
        const cut = this.sheets[sheet].cut, { edges, count } = this.net;
        if (through <= cut[e] || edges.t2[e] < 0) return;
        if (cut[e] === 0) {
            this.sheets[sheet].cuts.push(e);
            // Each of its two triangles has a thread of its own there now.
            this.sheets[sheet].owns[this._side(edges.t2[e], e)] = 1;
            this.undone.add(sheet * count + edges.a[e]).add(sheet * count + edges.b[e]);
        }
        if (sheet === DEEP_SHEET && through >= 1) this.gave++;
        if (through >= 1) {
            for (const p of [edges.a[e], edges.b[e]]) {
                if (++this.lip[sheet * count + p] === 1) this.ends[sheet].add(p);
                else this.ends[sheet].delete(p);
            }
        }
        cut[e] = through;
        this.loosened = true;
        this._stir(this.homeX[edges.a[e]], this.homeY[edges.a[e]], 3 * STEP);
    }

    // A cut has reached a place: the triangles round it are in as many
    // pieces as the cuts there leave them in, and each piece wants a point
    // of its own. The first piece keeps the point there was.
    _part(sheet, p) {
        const net = this.net, { tri, cut } = this.sheets[sheet];
        const round = Array.from(net.round.tri.subarray(net.round.from[p], net.round.from[p + 1]));
        const piece = new Map(round.map((t) => [t, t]));
        const of = (t) => { while (piece.get(t) !== t) t = piece.get(t); return t; };
        for (let n = net.near.from[p]; n < net.near.from[p + 1]; n++) {
            const e = net.near.edge[n];
            if (cut[e] === 0 && net.edges.t2[e] >= 0) piece.set(of(net.edges.t1[e]), of(net.edges.t2[e]));
        }
        const taken = new Set(), pointOf = new Map();
        for (const t of round) {
            const corner = this._corner(t, p);
            if (!pointOf.has(of(t))) {
                // The point this piece has had so far, or a new one just like it if another piece has kept that.
                let point = tri[corner];
                if (taken.has(point)) point = this._twin(point);
                taken.add(point);
                pointOf.set(of(t), point);
            }
            tri[corner] = pointOf.get(of(t));
        }
        if (pointOf.size > 1) this.parted.add(p);
    }

    _twin(point) {
        const twin = this.count++;
        if (twin >= this.x.length) throw new Error('the tissue has been cut into more pieces than there is room for');
        for (const column of [this.x, this.y, this.goingX, this.goingY, this.place, this.sheet, this.fixed]) column[twin] = column[point];
        return twin;
    }

    // Bring the pieces up to date with the cuts: points for new lips, the
    // ties between the sheets where a place is in pieces, and what is left
    // holding the two sides of every cut that is not through.
    _tidy() {
        const places = this.net.count;
        if (this.undone.size) {
            for (const key of this.undone) this._part(Math.floor(key / places), key % places);
            this.undone.clear();
            this.shape++;
            this._tie();
            this._loosen();
        }
        if (this.loosened) this._bridge();
        this.loosened = false;
    }

    _tie() {
        const net = this.net, [skin, deep] = this.sheets, ties = this.ties = { skin: [], deep: [], share: [], place: [] };
        for (const p of this.parted) {
            this.whole[p] = 0;
            if (!this.tied[p]) continue;
            const pairs = new Map(), from = net.round.from[p], to = net.round.from[p + 1];
            for (let r = from; r < to; r++) {
                const corner = this._corner(net.round.tri[r], p), key = skin.tri[corner] * this.x.length + deep.tri[corner];
                pairs.set(key, (pairs.get(key) || 0) + 1 / (to - from));
            }
            for (const [key, share] of pairs) {
                ties.skin.push(Math.floor(key / this.x.length)); ties.deep.push(key % this.x.length); ties.share.push(share); ties.place.push(p);
            }
        }
    }

    // A piece of the deep sheet that no longer has any point the body holds
    // is cut right out: nothing draws it back to where it was.
    _loosen() {
        const { piece, fixed, loose, count } = this, tri = this.sheets[DEEP_SHEET].tri, held = new Uint8Array(count);
        const of = (point) => { while (piece[point] !== point) point = piece[point] = piece[piece[point]]; return point; };
        for (let point = 0; point < count; point++) piece[point] = point;
        for (let t = 0; t < tri.length; t += 3) {
            const a = of(tri[t]);
            piece[of(tri[t + 1])] = a;
            piece[of(tri[t + 2])] = a;
        }
        for (let point = 0; point < count; point++) if (fixed[point] === 1) held[of(point)] = 1;
        for (let point = 0; point < count; point++) loose[point] = held[of(point)] === 1 ? 0 : 1;
    }

    _bridge() {
        const { edges } = this.net, bridges = this.bridges = { a: [], b: [], holds: [], gives: [], tears: [], sheet: [], edge: [] };
        this.sheets.forEach((sheet, which) => {
            for (const e of sheet.cuts) {
                const left = 1 - sheet.cut[e];
                if (left <= 0) continue;
                for (const p of [edges.a[e], edges.b[e]]) {
                    const a = sheet.tri[this._corner(edges.t1[e], p)], b = sheet.tri[this._corner(edges.t2[e], p)];
                    if (a === b) continue;
                    // What is left of what bears the sheet's tension holds the two sides. Skin is all in
                    // its dermis: cut through that, its lips spring apart over fat that holds them no more
                    // than its own softness does, and the fat shows at the bottom.
                    const bears = this.body.bears[which], whole = Math.max(0, 1 - sheet.cut[e] / bears);
                    const holds = STIFF[which] * HOLDS.bridge[which] * (whole * whole + HOLDS.fat * left * left);
                    const gives = whole > 0 ? sheet.cut[e] * this.body.thick[which] * GIVE.opens : this.body.thick[which] * GIVE.parted;
                    bridges.a.push(a); bridges.b.push(b); bridges.holds.push(holds); bridges.gives.push(gives);
                    bridges.tears.push((gives + left * TEAR.lips * this.body.thick[which]) ** 2);
                    bridges.sheet.push(which); bridges.edge.push(e);
                }
            }
        });
    }

    // --- coming to rest ----------------------------------------------------------

    // Let the sheets move: for at least one turn, and for more as long as
    // they have not taken `spare` milliseconds. Returns whether anything
    // moved. How far is kept in `went`: how far the point that got furthest
    // is from where it was, and not how far it travelled to get there (a
    // point that shivers on the spot has gone nowhere, and whoever makes
    // the sound of flesh moving must not hear it).
    settle(spare) {
        this._tidy();
        this.went = 0;
        if (!this.astir) return false;
        const { x, y, wasX, wasY } = this, points = this.count, until = performance.now() + spare;
        wasX.set(x.subarray(0, points));
        wasY.set(y.subarray(0, points));
        do this._turn(); while (this.astir && performance.now() < until);
        let furthest = 0;
        for (let point = 0; point < points; point++) {
            const dx = x[point] - wasX[point], dy = y[point] - wasY[point];
            if (dx * dx + dy * dy > furthest) furthest = dx * dx + dy * dy;
        }
        this.went = Math.sqrt(furthest);
        return true;
    }

    // Stir all of it. (Done once when it is made, it means the first cut is
    // not also the first time the engine has had to do these sums.)
    rouse() {
        this._stir(0, 0, 1e3);
    }

    // Something has happened at a spot, as far round it as `far` metres: the tissue there is astir.
    _stir(x, y, far) {
        const now = this.astir || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        this.astir = { x0: Math.min(now.x0, x - far), y0: Math.min(now.y0, y - far), x1: Math.max(now.x1, x + far), y1: Math.max(now.y1, y + far) };
        this.quiet = 0;
    }

    // One turn: every pull on every point is added up, and then each point
    // goes some of the way that would take it. Only where the tissue is
    // astir: the rest of it is at rest, and holds the edge of what is not.
    _turn() {
        // (Written out long, with everything it reads in hand: this is where the time goes.)
        const { x, y, pullX, pullY, grip, firm, goingX, goingY, fixed, homeX, homeY, net, triX, whole, place, sheet, loose, torn } = this, places = net.count;
        const { x0, y0, x1, y1 } = this.astir, carry = SETTLE.carry, step = SETTLE.step, still = SETTLE.still, tether = HOLDS.tether, anchor = HOLDS.anchor;
        // The net is laid in rows down the field, so what is astir is a run of places and a run of triangles.
        const first = (down, row) => { let lo = 0, hi = down.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (down[mid] < row) lo = mid + 1; else hi = mid; } return lo; };
        const fromPlace = first(net.y, y0), toPlace = first(net.y, y1), fromTri = first(this.triY, y0 - STEP), toTri = first(this.triY, y1 + STEP);
        for (const pulls of [pullX, pullY, grip, firm]) {
            pulls.fill(0, fromPlace, toPlace); pulls.fill(0, places + fromPlace, places + toPlace); pulls.fill(0, places * 2, this.count);
        }
        // The threads of each sheet, and the room its triangles take.
        for (let which = 0; which < 2; which++) {
            const { tri, rest, room, owns } = this.sheets[which], stiff = STIFF[which], taut = TAUT.at - TAUT.eases, stiffer = stiff * TAUT.stiffer, eases = 2 * TAUT.eases, left = x0 - STEP, right = x1 + STEP;
            const back = stiff * SQUASH.back, packed = SQUASH.packed + SQUASH.eases, harder = stiff * SQUASH.harder, comes = 2 * SQUASH.eases;
            for (let t = fromTri; t < toTri; t++) {
                if (triX[t] < left || triX[t] > right) continue;
                for (let side = t * 3, last = side + 2; side <= last; side++) {
                    if (owns[side] === 0) continue;
                    const a = tri[side], b = tri[side === last ? side - 2 : side + 1];
                    const dx = x[b] - x[a], dy = y[b] - y[a], far = Math.sqrt(dx * dx + dy * dy) + 1e-12, over = far - rest[side] * taut;
                    // Flesh gives so far, and then all but stops giving. Pushed together it does not push
                    // back along itself at all: it wrinkles, and what stops it is the room it takes, below.
                    let pull = far > rest[side] ? stiff * (far - rest[side]) : 0, holds = stiff;
                    if (over > 0) {
                        const band = eases * rest[side];
                        if (over < band) { pull += stiffer * over * over / (2 * band); holds += stiffer * over / band; } else { pull += stiffer * (over - band / 2); holds += stiffer; }
                        firm[a] = firm[b] = 1;
                    }
                    pull /= far;
                    pullX[a] += dx * pull; pullY[a] += dy * pull; grip[a] += holds;
                    pullX[b] -= dx * pull; pullY[b] -= dy * pull; grip[b] += holds;
                }
                // A triangle squashed into less room than it takes pushes its corners out, each straight away from
                // the side across from it: that is the way that makes room, and the way that keeps it from turning over.
                const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
                const has = ((x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a])) / room[t];
                if (has >= 1) continue;
                let push = back * (1 - has), holds = back;
                const short = packed - has;
                if (short > 0) {
                    if (short < comes) { push += harder * short * short / (2 * comes); holds += harder * short / comes; } else { push += harder * (short - comes / 2); holds += harder; }
                    firm[a] = firm[b] = firm[c] = 1;
                }
                holds *= 2 / room[t];
                const ax = y[b] - y[c], ay = x[c] - x[b], bx = y[c] - y[a], by = x[a] - x[c], cx = y[a] - y[b], cy = x[b] - x[a];
                // (How hard each corner is held by it takes in that the way it pushes one turns as the other two move.)
                pullX[a] += ax * push; pullY[a] += ay * push; grip[a] += holds * (ax * ax + ay * ay) + 2 * push;
                pullX[b] += bx * push; pullY[b] += by * push; grip[b] += holds * (bx * bx + by * by) + 2 * push;
                pullX[c] += cx * push; pullY[c] += cy * push; grip[c] += holds * (cx * cx + cy * cy) + 2 * push;
            }
        }
        // What ties skin to deep, and what is left across a cut: these pull straight together, softly as
        // far as they give and hard past that.
        // (Each says how far apart its two ends are, squared: past some distance a tie tears.)
        const tie = (a, b, holds, gives) => {
            const dx = x[b] - x[a], dy = y[b] - y[a], far2 = dx * dx + dy * dy;
            let pull = holds, grips = holds;
            if (far2 > gives * gives) { pull += GIVE.stiff * (1 - gives / Math.sqrt(far2)); grips += GIVE.stiff; firm[a] = firm[b] = 1; }
            pullX[a] += dx * pull; pullY[a] += dy * pull; grip[a] += grips;
            pullX[b] -= dx * pull; pullY[b] -= dy * pull; grip[b] += grips;
            return far2;
        };
        const { ties, bridges, tied } = this, comesAway = (GIVE.slides * TEAR.skin) ** 2;
        torn.skin.length = torn.lips.length = 0;
        for (let a = fromPlace; a < toPlace; a++) {
            if (whole[a] === 1 && tied[a] === 1 && tie(a, places + a, tether, GIVE.slides) > comesAway) torn.skin.push(a);
        }
        for (let i = 0; i < ties.skin.length; i++) {
            if (tie(ties.skin[i], ties.deep[i], tether * ties.share[i], GIVE.slides) > comesAway) torn.skin.push(ties.place[i]);
        }
        for (let i = 0; i < bridges.a.length; i++) {
            if (tie(bridges.a[i], bridges.b[i], bridges.holds[i], bridges.gives[i]) > bridges.tears[i]) torn.lips.push(i);
        }
        // A hand draws each point it has to where the hand has carried it, and no harder than a hand can: what
        // has come all the way is pulled no further (a piece torn off stays in the hand). A retractor holds what
        // it was given the same way.
        for (const has of this.hand ? [this.hand, ...this.pins] : this.pins) {
            const leads2 = HAND.leads * HAND.leads;
            for (let i = 0; i < has.points.length; i++) {
                const point = has.points[i], behindX = has.fromX[i] + has.dx - x[point], behindY = has.fromY[i] + has.dy - y[point], behind2 = behindX * behindX + behindY * behindY;
                const hard = behind2 > leads2 ? HAND.pulls * HAND.leads / Math.sqrt(behind2) : HAND.pulls;
                pullX[point] += behindX * hard; pullY[point] += behindY * hard; grip[point] += HAND.pulls;
            }
        }

        // Each point that is astir goes.
        const astir = [[fromPlace, toPlace], [places + fromPlace, places + toPlace], [places * 2, this.count]];
        for (const [from, to] of astir) {
            for (let point = from; point < to; point++) {
                const p = place[point], hx = homeX[p], hy = homeY[p];
                if (fixed[point] === 1 || hx < x0 || hx > x1 || hy < y0 || hy > y1) continue;
                let px = pullX[point], py = pullY[point], holds = grip[point];
                if (sheet[point] === DEEP_SHEET && loose[point] === 0) { px -= (x[point] - hx) * anchor; py -= (y[point] - hy) * anchor; holds += anchor; }
                const keeps = firm[point] === 1 && goingX[point] * px + goingY[point] * py < 0 ? 0 : carry;
                let gx = goingX[point] * keeps + step * px / holds, gy = goingY[point] * keeps + step * py / holds;
                // (A point all but at rest is at rest: numbers this small are slow to reckon with.)
                if (gx < 1e-9 && gx > -1e-9) gx = 0;
                if (gy < 1e-9 && gy > -1e-9) gy = 0;
                goingX[point] = gx; goingY[point] = gy;
                x[point] += gx; y[point] += gy;
            }
        }
        // Flesh does not pass through itself: a triangle that this turn would have squashed flat or turned over
        // has its corners put back where they were, and stopped. (One that was no better before the turn is let
        // go: putting it back mends nothing, and would hold fast whatever piece it is part of.)
        for (let which = 0; which < 2; which++) {
            const tri = this.sheets[which].tri;
            for (let t = fromTri; t < toTri; t++) {
                if (triX[t] < x0 - STEP || triX[t] > x1 + STEP) continue;
                const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
                const now = (x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a]);
                if (now > FLAT) continue;
                const ax = x[a] - goingX[a], ay = y[a] - goingY[a];
                if ((x[b] - goingX[b] - ax) * (y[c] - goingY[c] - ay) - (x[c] - goingX[c] - ax) * (y[b] - goingY[b] - ay) <= now) continue;
                for (let k = t * 3; k < t * 3 + 3; k++) {
                    const point = tri[k];
                    x[point] -= goingX[point]; y[point] -= goingY[point];
                    goingX[point] = goingY[point] = 0;
                }
            }
        }
        // What went is noted: where, and how far any has been from home. (Only now, of what was let go:
        // flesh pressed against itself tries to move every turn, and is at rest all the same.)
        let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity, reach = this.reach * this.reach;
        for (const [from, to] of astir) {
            for (let point = from; point < to; point++) {
                const gx = goingX[point], gy = goingY[point];
                if (gx === 0 && gy === 0) continue;
                const p = place[point], hx = homeX[p], hy = homeY[p];
                if (fixed[point] === 1 || hx < x0 || hx > x1 || hy < y0 || hy > y1) continue;
                const awayX = x[point] - hx, awayY = y[point] - hy;
                if (awayX * awayX + awayY * awayY > reach) reach = awayX * awayX + awayY * awayY;
                if (gx > still || gx < -still || gy > still || gy < -still) {
                    if (hx < mx0) mx0 = hx;
                    if (hx > mx1) mx1 = hx;
                    if (hy < my0) my0 = hy;
                    if (hy > my1) my1 = hy;
                }
            }
        }
        this.reach = Math.sqrt(reach);
        this._tear();
        // What moved is astir next turn, and so is the tissue round it, which it is about to move.
        if (mx1 >= mx0) {
            this.astir = { x0: mx0 - SETTLE.spreads, y0: my0 - SETTLE.spreads, x1: mx1 + SETTLE.spreads, y1: my1 + SETTLE.spreads };
            this.quiet = 0;
        } else if (++this.quiet >= SETTLE.turns) this.astir = null;
    }

    // What gave way this turn. Skin that was dragged too far comes away
    // from what is under it, where it is on a lip or beside skin that has
    // come away already; cuts whose lips were dragged too far apart go the
    // rest of the way through; and a sheet drawn apart hard enough at the
    // end of a cut rips on from there.
    _tear() {
        const ripped = ++this.rested > TEAR.waits && this.hand !== null && this._rip(), torn = this.torn;
        if (!torn.skin.length && !torn.lips.length && !ripped) return;
        const { near, edges } = this.net, { tied, lip } = this;
        const away = torn.skin.filter((p) => {
            if (lip[p] > 0) return true;
            for (let n = near.from[p]; n < near.from[p + 1]; n++) if (tied[edges.a[near.edge[n]]] === 0 || tied[edges.b[near.edge[n]]] === 0) return true;
            return false;
        });
        for (const p of away) tied[p] = 0;
        if (away.some((p) => !this.whole[p])) this._tie();
        const through = torn.lips.map((i) => [this.bridges.sheet[i], this.bridges.edge[i]]);
        for (const [which, e] of through) this.part(which, e, 1);
        if (ripped) this.rested = 0;
        // (What has parted is in pieces at once: the next turn pulls on the pieces, not on what was whole.)
        this._tidy();
        this.tore += away.length + through.length + (ripped ? 1 : 0);
    }

    // Rip a sheet one stretch further from the end of a cut: from whichever
    // end, of those where the tissue is astir, has a whole stretch leading
    // on from it whose two sides are drawn furthest apart, if that is
    // further than the sheet can bear. Returns whether anything ripped.
    _rip() {
        const { net, homeX, homeY, fixed } = this, { edges, near } = net, { x0, y0, x1, y1 } = this.astir;
        let most = 1, sheet = -1, stretch = -1, from = -1;
        for (let which = 0; which < 2; which++) {
            const cut = this.sheets[which].cut, bears = TEAR.apart[which], points = which * net.count;
            for (const p of this.ends[which]) {
                if (homeX[p] < x0 || homeX[p] > x1 || homeY[p] < y0 || homeY[p] > y1) continue;
                for (let n = near.from[p]; n < near.from[p + 1]; n++) {
                    const e = near.edge[n];
                    // (Not one the blade has marked, which has its own way of giving, nor one the body holds at both ends.)
                    if (cut[e] > 0 || edges.t2[e] < 0 || (fixed[points + edges.a[e]] === 1 && fixed[points + edges.b[e]] === 1)) continue;
                    const apart = this.apart(which, e) / bears;
                    if (apart > most) { most = apart; sheet = which; stretch = e; from = p; }
                }
            }
        }
        if (stretch < 0) return false;
        this._straighten(sheet, stretch, from);
        this.part(sheet, stretch, 1);
        return true;
    }

    // A tear runs square to what is pulling it open, and not along the net's
    // own lines: before stretch `e` of a sheet tears on from place `from`,
    // the place at its other end is moved toward where a tear going square
    // to the pull would come to, as far as the net lets it go (a place a cut
    // already runs through stays where it is). Without this a tear is a
    // row of the net's triangles, a saw's teeth.
    _straighten(which, e, from) {
        const { net, homeX, homeY, x, y } = this, { edges, near, tris } = net, tri = this.sheets[which].tri;
        const to = edges.a[e] === from ? edges.b[e] : edges.a[e];
        if (this.body.held(homeX[to], homeY[to])) return;
        for (const sheet of this.sheets) for (let n = near.from[to]; n < near.from[to + 1]; n++) if (sheet.cut[near.edge[n]] > 0) return;
        // The pull: between the corners of the two triangles that face each other across the stretch.
        const facing = (t) => { for (let corner = t * 3; ; corner++) if (tris[corner] !== edges.a[e] && tris[corner] !== edges.b[e]) return tri[corner]; };
        const one = facing(edges.t1[e]), other = facing(edges.t2[e]), px = x[other] - x[one], py = y[other] - y[one], pull = Math.hypot(px, py);
        if (pull < 1e-9) return;
        // Square to it, the way the stretch goes.
        let dx = -py / pull, dy = px / pull;
        if (dx * (homeX[to] - homeX[from]) + dy * (homeY[to] - homeY[from]) < 0) { dx = -dx; dy = -dy; }
        const wantX = homeX[from] + dx * STEP - homeX[to], wantY = homeY[from] + dy * STEP - homeY[to], far = Math.hypot(wantX, wantY);
        const gives = Math.min(1, TEAR.straightens * STEP / (far || 1));
        this.shift(to, homeX[to] + wantX * gives, homeY[to] + wantY * gives);
    }

    // How far the two sides of a whole stretch of a sheet are being drawn
    // apart: the distance between the corners of its two triangles that
    // face each other across it, against what that is at rest.
    apart(which, e) {
        const { x, y, homeX, homeY, net } = this, { tris, edges } = net, tri = this.sheets[which].tri, a = edges.a[e], b = edges.b[e];
        const facing = (t) => { for (let corner = t * 3; ; corner++) if (tris[corner] !== a && tris[corner] !== b) return corner; };
        const one = facing(edges.t1[e]), other = facing(edges.t2[e]), from = tris[one], to = tris[other];
        const dx = homeX[to] - homeX[from], dy = homeY[to] - homeY[from], far2 = dx * dx + dy * dy;
        const [across, down] = this.body.strain(which, (homeX[from] + homeX[to]) / 2, (homeY[from] + homeY[to]) / 2);
        const rest = Math.sqrt(far2) * (1 - (across * dx * dx + down * dy * dy) / far2);
        return Math.hypot(x[tri[other]] - x[tri[one]], y[tri[other]] - y[tri[one]]) / rest;
    }

    // --- taking a piece away ---------------------------------------------------------

    // The triangles of a sheet that are one piece with triangle `t`: joined
    // to it across stretches not cut right through. Null if the body holds
    // any of it, or if it is more than `most` triangles: too big a piece to
    // be anything but part of the body still.
    pieceOf(which, t, most = PIECE.most) {
        const { tri, cut, gone } = this.sheets[which], { fixed, sides } = this, { edges } = this.net;
        if (gone[t]) return null;
        const seen = new Set([t]), todo = [t];
        while (todo.length) {
            const at = todo.pop();
            for (let k = at * 3; k < at * 3 + 3; k++) {
                if (fixed[tri[k]]) return null;
                const e = sides[k];
                if (e < 0 || cut[e] >= 1) continue;
                const other = edges.t1[e] === at ? edges.t2[e] : edges.t1[e];
                if (other < 0 || seen.has(other)) continue;
                if (seen.size >= most) return null;
                seen.add(other);
                todo.push(other);
            }
        }
        return [...seen];
    }

    // What would come away if the piece of a sheet round triangle `t` were
    // lifted: [skin triangles, deep triangles], or null if anything still
    // holds it. Skin is held by the deep sheet wherever it is still tied to
    // it, so a piece of skin comes away on its own only once it is peeled
    // free; or with the deep sheet under it, if that is cut free too.
    freed(which, t) {
        const { net, tied, whole, ties } = this, places = net.count, out = [new Set(), new Set()], todo = [[which, t]];
        // Which points of each sheet each point is tied to.
        const to = new Map(), tie = (a, b) => { if (!to.has(a)) to.set(a, []); to.get(a).push(b); };
        for (let i = 0; i < ties.skin.length; i++) { tie(ties.skin[i], ties.deep[i]); tie(ties.deep[i], ties.skin[i]); }
        const tiedTo = (point) => {
            const p = this.place[point];
            if (!tied[p]) return [];
            if (whole[p]) return [this.sheet[point] === SKIN_SHEET ? places + p : p];
            return to.get(point) || [];
        };
        while (todo.length) {
            const [sheet, start] = todo.pop();
            if (out[sheet].has(start)) continue;
            const piece = this.pieceOf(sheet, start);
            if (!piece) return null;
            for (const tri of piece) out[sheet].add(tri);
            // Whatever of the other sheet it is tied to has to come too.
            const other = 1 - sheet, mine = this.sheets[sheet].tri, theirs = this.sheets[other], wanted = new Set();
            for (const tri of piece) for (let k = tri * 3; k < tri * 3 + 3; k++) for (const point of tiedTo(mine[k])) wanted.add(point);
            for (const point of wanted) {
                const p = this.place[point];
                for (let r = net.round.from[p]; r < net.round.from[p + 1]; r++) {
                    const there = net.round.tri[r];
                    if (theirs.tri[this._corner(there, p)] === point && !theirs.gone[there] && !out[other].has(there)) todo.push([other, there]);
                }
            }
            if (out[0].size + out[1].size > PIECE.most * 2) return null;
        }
        return out.map((set) => [...set]);
    }

    // Take triangles out of the sheets, as the hand lifts them away: they
    // are no longer drawn, cut or moved. `taken` is [skin, deep] triangles.
    take(taken) {
        taken.forEach((tris, sheet) => {
            const { tri, gone } = this.sheets[sheet];
            for (const t of tris) {
                gone[t] = 1;
                for (let k = t * 3; k < t * 3 + 3; k++) {
                    this.fixed[tri[k]] = 1;
                    // (Nothing is tied any more to skin that is not there.)
                    if (sheet === SKIN_SHEET) this.tied[this.net.tris[k]] = 0;
                    this._stir(this.x[tri[k]], this.y[tri[k]], 3 * STEP);
                }
            }
        });
        this._tie();
        this.hand = null;
        // (A retractor on what is gone has nothing in it.)
        const went = new Set(taken.flatMap((tris, sheet) => [...tris].flatMap((t) => [0, 1, 2].map((k) => this.sheets[sheet].tri[t * 3 + k]))));
        this.pins = this.pins.filter((pin) => !pin.points.some((point) => went.has(point)));
        this.shape++;
    }

    // --- finding things -------------------------------------------------------------

    // Triangles by where they began, in squares: `from[square]` to `from[square + 1]` in `tri`.
    _bins() {
        const { net } = this, wide = Math.ceil((Math.max(...net.x) + STEP) / BIN), high = Math.ceil((Math.max(...net.y) + STEP) / BIN);
        const square = (t) => {
            const [a, b, c] = net.tris.subarray(t * 3, t * 3 + 3);
            return Math.floor((net.y[a] + net.y[b] + net.y[c]) / 3 / BIN) * wide + Math.floor((net.x[a] + net.x[b] + net.x[c]) / 3 / BIN);
        };
        const from = new Uint32Array(wide * high + 1), triangles = net.tris.length / 3;
        for (let t = 0; t < triangles; t++) from[square(t) + 1]++;
        for (let s = 0; s < wide * high; s++) from[s + 1] += from[s];
        const tri = new Uint32Array(triangles), next = from.slice(0, wide * high);
        for (let t = 0; t < triangles; t++) tri[next[square(t)]++] = t;
        return { wide, high, from, tri };
    }

    // The triangle of a sheet that is over a spot on the field now, or -1 where the sheet has drawn away.
    under(sheet, px, py) {
        const { x, y, bins } = this, { tri, gone } = this.sheets[sheet], far = this.reach + STEP * 1.5;
        const x0 = Math.max(0, Math.floor((px - far) / BIN)), x1 = Math.min(bins.wide - 1, Math.floor((px + far) / BIN));
        const y0 = Math.max(0, Math.floor((py - far) / BIN)), y1 = Math.min(bins.high - 1, Math.floor((py + far) / BIN));
        for (let by = y0; by <= y1; by++) {
            for (let i = bins.from[by * bins.wide + x0]; i < bins.from[by * bins.wide + x1 + 1]; i++) {
                if (gone[bins.tri[i]]) continue;
                const t = bins.tri[i] * 3, a = tri[t], b = tri[t + 1], c = tri[t + 2];
                const ab = (x[b] - x[a]) * (py - y[a]) - (y[b] - y[a]) * (px - x[a]);
                const bc = (x[c] - x[b]) * (py - y[b]) - (y[c] - y[b]) * (px - x[b]);
                const ca = (x[a] - x[c]) * (py - y[c]) - (y[a] - y[c]) * (px - x[c]);
                if (ab >= 0 && bc >= 0 && ca >= 0) return bins.tri[i];
            }
        }
        return -1;
    }

    // Whether a spot on the field has a sheet's triangle over it that is not
    // one of `point`'s own: something else lying over or under where that
    // point has got to.
    overlaps(sheet, px, py, point) {
        const { x, y, bins } = this, { tri, gone } = this.sheets[sheet], far = this.reach + STEP * 1.5;
        const x0 = Math.max(0, Math.floor((px - far) / BIN)), x1 = Math.min(bins.wide - 1, Math.floor((px + far) / BIN));
        const y0 = Math.max(0, Math.floor((py - far) / BIN)), y1 = Math.min(bins.high - 1, Math.floor((py + far) / BIN));
        for (let by = y0; by <= y1; by++) {
            for (let i = bins.from[by * bins.wide + x0]; i < bins.from[by * bins.wide + x1 + 1]; i++) {
                const t = bins.tri[i] * 3, a = tri[t], b = tri[t + 1], c = tri[t + 2];
                if (gone[bins.tri[i]] || a === point || b === point || c === point) continue;
                const ab = (x[b] - x[a]) * (py - y[a]) - (y[b] - y[a]) * (px - x[a]);
                const bc = (x[c] - x[b]) * (py - y[b]) - (y[c] - y[b]) * (px - x[b]);
                const ca = (x[a] - x[c]) * (py - y[c]) - (y[a] - y[c]) * (px - x[c]);
                if (ab > 0 && bc > 0 && ca > 0) return true;
            }
        }
        return false;
    }

    // Where in the stuff of a sheet a spot on the field is: the place of the
    // net it would be if the sheet had never moved, as [x, y], given the
    // triangle it is under.
    stuff(sheet, t, px, py) {
        const { x, y, homeX, homeY } = this, tri = this.sheets[sheet].tri, [a, b, c] = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
        const whole = (x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a]);
        const wb = ((px - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (py - y[a])) / whole;
        const wc = ((x[b] - x[a]) * (py - y[a]) - (px - x[a]) * (y[b] - y[a])) / whole;
        const [pa, pb, pc] = [this.place[a], this.place[b], this.place[c]];
        return [homeX[pa] * (1 - wb - wc) + homeX[pb] * wb + homeX[pc] * wc, homeY[pa] * (1 - wb - wc) + homeY[pb] * wb + homeY[pc] * wc];
    }

    // The points of a sheet that are at a place: one, or one for each piece the place is in.
    at(sheet, p) {
        const net = this.net, tri = this.sheets[sheet].tri, points = [];
        for (let r = net.round.from[p]; r < net.round.from[p + 1]; r++) {
            const point = tri[this._corner(net.round.tri[r], p)];
            if (!points.includes(point)) points.push(point);
        }
        return points;
    }

    // --- a hand ------------------------------------------------------------------------

    // Take hold of the skin at a spot: of what is within a finger's width of
    // the nearest of it and joined to it, and of the deep sheet under that
    // wherever the wall is cut right through there (a hand on the lip of an
    // open belly has the whole wall, one pinching skin has skin). Where the
    // skin is gone it takes the deep sheet. It keeps hold until it lets go,
    // and then what it had goes back, if anything still holds it. Returns
    // whether there was anything to take.
    grab(px, py) {
        const { x, y, net } = this, deep = this.sheets[DEEP_SHEET];
        let which = SKIN_SHEET, first = this._nearest(SKIN_SHEET, px, py);
        if (first < 0) { which = DEEP_SHEET; first = this._nearest(DEEP_SHEET, px, py); }
        if (first < 0) {
            this.letGo();
            return false;
        }
        // Out from there through the sheet, triangle by triangle, never across a cut.
        const tri = this.sheets[which].tri, taken = new Set([tri[first]]), under = new Set(), todo = [first];       // what it takes, and the deep sheet under that
        while (todo.length) {
            const corner = todo.pop(), p = net.tris[corner], point = tri[corner];
            for (let r = net.round.from[p]; r < net.round.from[p + 1]; r++) {
                const t = net.round.tri[r] * 3;
                if (tri[this._corner(net.round.tri[r], p)] !== point) continue;
                for (let k = t; k < t + 3; k++) {
                    const other = tri[k];
                    if (taken.has(other) || (x[other] - x[tri[first]]) ** 2 + (y[other] - y[tri[first]]) ** 2 > HAND.takes ** 2) continue;
                    taken.add(other);
                    todo.push(k);
                }
                // (Skin that has come away from what is under it brings none of that with it.)
                for (let k = t; k < t + 3; k++) if (which === SKIN_SHEET && taken.has(tri[k]) && this.tied[net.tris[k]]) under.add(deep.tri[k]);
            }
        }
        const lip = [...under].some((point) => this.lip[net.count + this.place[point]]);
        const points = lip ? [...taken, ...under] : [...taken];
        this.hand = { points, fromX: points.map((point) => x[point]), fromY: points.map((point) => y[point]), dx: 0, dy: 0, sheet: which, tri: Math.floor(first / 3) };
        return true;
    }

    // The corner of a sheet's triangle nearest a spot and within a hand's finding of it (an index into its `tri`), or -1.
    _nearest(sheet, px, py) {
        const { x, y } = this, { tri, gone } = this.sheets[sheet];
        let first = -1, nearest = HAND.finds ** 2;
        for (let t = 0; t < tri.length; t++) {
            if (gone[Math.floor(t / 3)]) continue;
            const far2 = (x[tri[t]] - px) ** 2 + (y[tri[t]] - py) ** 2;
            if (far2 < nearest) { nearest = far2; first = t; }
        }
        return first;
    }

    // The hand lets go of what it has, which is then free to go back.
    letGo() {
        if (!this.hand) return;
        for (const point of this.hand.points) this._stir(this.x[point], this.y[point], 3 * STEP);
        this.hand = null;
    }

    // What the hand has is left held where it is, by a retractor, and the hand is free. Returns the pin, or null.
    pin() {
        const pin = this.hand;
        if (!pin) return null;
        this.pins.push(pin);
        this.hand = null;
        return pin;
    }

    // The retractor nearest (px, py), within a hand's finding of where it holds, is taken out, and what it held
    // goes back. Returns whether there was one.
    unpin(px, py) {
        const { x, y } = this, far2 = (pin) => (x[pin.points[0]] - px) ** 2 + (y[pin.points[0]] - py) ** 2;
        const pin = this.pins.reduce((best, p) => (!best || far2(p) < far2(best) ? p : best), null);
        if (!pin || far2(pin) > (2 * HAND.finds) ** 2) return false;
        this.pins = this.pins.filter((p) => p !== pin);
        for (const point of pin.points) this._stir(x[point], y[point], 3 * STEP);
        return true;
    }

    // The hand goes (dx, dy) from where it took hold, and pulls what it has after it.
    drag(dx, dy) {
        this.hand.dx = dx;
        this.hand.dy = dy;
        for (const point of this.hand.points) this._stir(this.x[point], this.y[point], 3 * STEP);
    }
}
