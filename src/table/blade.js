// The blade: what a stroke does to the tissue.
//
// A blade is drawn over the body, bearing so hard, and wherever it has been
// the sheets under it are parted to the depth it reached: the skin first,
// and once it is through the skin and its fat, the deep sheet below. The
// tissue is a net (lattice.js), and a blade does not go where a net's
// threads are, so the net is brought to the blade: as the stroke goes on,
// the nearest place ahead is moved onto the blade's own line and the thread
// back to the last one is cut. The line of a wound is the line that was
// drawn, to the millimetre.
//
// A stroke down a cut that is already there makes nothing new: it deepens
// what it runs along. One that comes off the end of a cut goes on with it.
// One on the white sheet at the bottom of a wound whose skin has drawn back
// cuts that sheet where it is put, which need not be under the skin's cut.
// And whatever of a sheet is under the blade is what it cuts: the lip of a
// wound, or a strand of skin left across one, is skin like any other, and
// not the wound beside it.

import { STEP } from './lattice.js';
import { DEEP_SHEET, SKIN, SKIN_SHEET } from './tissue.js';

// All in steps of the net. A blade within `rides` of the middle of a cut is
// in that cut (and so is one anywhere between its lips), if it is not cut
// through; one that is through it falls into only from `falls` beyond its
// lips, and anywhere further out it is on the lip, and cuts that. The line is carried
// on, to where the blade is, once the blade is `leads` past the last place
// on it: so a cut ends no more than that behind the blade. A place is moved
// at most `gives` to be put on the line, and a stroke that finds itself
// more than `lost` from where it last cut has been lifted and put down
// again.
const LINE = { rides: 0.6, falls: 0.25, leads: 0.55, gives: 0.45, lost: 2.5 };
const HIDE = 0.083;             // how much of the wall is the skin itself, before the fat under it
// What a blade goes through, down through the wall: to how deep (of 1, the
// whole wall) each layer goes, and how hard it is to cut against skin. Fat
// parts at a fifth of what skin takes; the sheath over the muscle is thin
// and tough; muscle is soft across; the lining at the bottom is a little
// tougher again (dev/research/tissue-mechanics.md, "Suggested targets").
const LAYERS = [[HIDE, 1], [0.5, 0.22], [0.525, 0.5], [0.94, 0.25], [1, 0.3]];
// How much a stroke cuts for each 1 of press: as much as goes through this
// much of the wall's thickness in skin. (A crawling stroke goes through
// skin and fat and most of the muscle; an ordinary one, ten centimetres a
// second, through the skin and into the fat, as a surgeon's first stroke
// does; a quick flick only scores it.)
const BITES = 0.375;

export class Blade {
    // `deepest(x, y)` is how deep the body lets a blade go at a spot, of 1 (the whole wall).
    constructor(tissue, deepest) {
        this.tissue = tissue;
        this.deepest = deepest;
        this.before = tissue.sheets.map((sheet) => sheet.cut.slice());      // how far each stretch was cut when the blade last went in
        this.last = [-1, -1];           // the place where the stroke in hand last cut each sheet
        this.across = [false, false];   // whether it got there by cutting whole sheet (and not by running along a cut)
        this.lined = new Set();         // places that are on the line of a cut, and stay where they are
        this.point = null;              // what its point is in: 'skin', 'fat', 'flesh' or 'bone'; null in the open belly
    }

    // The blade goes in: what is cut from now is added to what was there.
    begin() {
        this.tissue.sheets.forEach((sheet, which) => this.before[which].set(sheet.cut));
        this.last = [-1, -1];
        this.across = [false, false];
    }

    // Where the stroke in hand has got to, to be taken up again after cutting somewhere else in the same moment.
    mark() { return { last: this.last.slice(), across: this.across.slice() }; }
    resume(mark) {
        this.last = mark.last.slice();
        this.across = mark.across.slice();
    }

    // The blade goes on without cutting (it is drawn sideways): what it cuts
    // next starts afresh, but no deeper than this stroke has been going.
    lift() {
        this.last = [-1, -1];
        this.across = [false, false];
    }

    // The blade drawn from one spot on the field to another, bearing hard
    // enough to go `press` (of 1, the whole wall) deeper than the wound was
    // when it went in. Returns how far past the whole wall that would have
    // gone, at the most.
    draw(ax, ay, bx, by, press) {
        const far = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(far * 4 / STEP));
        const heading = far > 0 ? [(bx - ax) / far, (by - ay) / far] : null;
        let past = 0;
        for (let s = 1; s <= steps; s++) past = Math.max(past, this._bear(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps, press, this.before, heading));
        return past;
    }

    // The blade held where it is for a moment: it sinks, by `sink` (of 1).
    dwell(x, y, sink) {
        this._bear(x, y, sink, this.tissue.sheets.map((sheet) => sheet.cut), null);
    }

    // The blade at a spot, going `press` deeper than `was` says the wound
    // was there (for each sheet, how far each stretch was cut).
    _bear(x, y, press, was, heading) {
        const [skin, deep] = [SKIN_SHEET, DEEP_SHEET].map((sheet) => this._meets(sheet, x, y));
        // How deep the wound is here already, of the whole wall. A stroke
        // adds to a cut as far as it runs the way the cut does.
        const already = (sheet, met) => (met.edge === undefined ? 0 : was[sheet][met.edge] * (heading ? this._along(met.edge, heading) : 1));
        let depth;
        // (Skin this same stroke has gone through is still skin the blade began above.)
        if (skin && (skin.edge === undefined || was[SKIN_SHEET][skin.edge] < 1)) depth = already(SKIN_SHEET, skin) * SKIN;
        else if (deep) depth = SKIN + already(DEEP_SHEET, deep) * (1 - SKIN);
        else { this.point = null; return 0; }
        const limit = this.deepest(x, y), [reached, left] = this._through(depth, press * BITES), to = Math.min(limit, reached);
        this.point = limit < 1 && reached >= limit ? 'bone' : to < HIDE ? 'skin' : to < SKIN ? 'fat' : 'flesh';
        if (skin) this._cut(SKIN_SHEET, skin, x, y, Math.min(1, to / SKIN));
        if (deep && to > SKIN) this._cut(DEEP_SHEET, deep, x, y, Math.min(1, (to - SKIN) / (1 - SKIN)));
        return limit >= 1 ? left / BITES : 0;
    }

    // How deep (of 1) a blade gets from `depth` with `work` to spend, layer
    // by layer, and how much work it has left over if it goes right through.
    _through(depth, work) {
        for (const [until, resists] of LAYERS) {
            if (depth >= until) continue;
            const takes = (until - depth) * resists;
            if (work < takes) return [depth + work / resists, 0];
            work -= takes;
            depth = until;
        }
        return [1, work];
    }

    // How far down the point of a blade rests at a spot, of 1 (the whole
    // wall): on the skin, at the bottom of whatever cut it is in, on the
    // deep sheet where the skin has drawn away, or through.
    rests(x, y) {
        const [skin, deep] = [SKIN_SHEET, DEEP_SHEET].map((sheet) => this._meets(sheet, x, y)), cut = (sheet, met) => (met.edge === undefined ? 0 : this.tissue.sheets[sheet].cut[met.edge]);
        if (skin && cut(SKIN_SHEET, skin) < 1) return cut(SKIN_SHEET, skin) * SKIN;
        return deep ? SKIN + cut(DEEP_SHEET, deep) * (1 - SKIN) : 1;
    }

    // What of a sheet the blade is on at a spot: { edge }, a stretch that is
    // cut and whose wound the blade is in; { tri }, a triangle of whole
    // sheet; or null where the sheet has drawn away. A blade near a cut that
    // is not through is in it (it drops into the groove); one near a cut
    // that is through is in it only if it is hardly any way onto its lip.
    _meets(sheet, x, y) {
        const tissue = this.tissue, { tri, cuts, cut } = tissue.sheets[sheet], { edges } = tissue.net, { x: px, y: py, homeX, homeY } = tissue;
        // No cut further off than this can have the blade in it: its lips are no further than this from where they began.
        const within = (tissue.reach + 2 * STEP) ** 2;
        let edge, nearest = Infinity;
        for (const e of cuts) {
            const a = edges.a[e], b = edges.b[e];
            if ((homeX[a] - x) ** 2 + (homeY[a] - y) ** 2 > within) continue;
            // The middle of the wound at each end of the stretch, and how far apart its lips are there.
            const a1 = tri[tissue._corner(edges.t1[e], a)], a2 = tri[tissue._corner(edges.t2[e], a)], b1 = tri[tissue._corner(edges.t1[e], b)], b2 = tri[tissue._corner(edges.t2[e], b)];
            const ax = (px[a1] + px[a2]) / 2, ay = (py[a1] + py[a2]) / 2, abx = (px[b1] + px[b2]) / 2 - ax, aby = (py[b1] + py[b2]) / 2 - ay;
            const gaps = Math.sqrt((px[a1] - px[a2]) ** 2 + (py[a1] - py[a2]) ** 2) + Math.sqrt((px[b1] - px[b2]) ** 2 + (py[b1] - py[b2]) ** 2);
            const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby || 1)));
            const far = Math.sqrt((x - ax - abx * t) ** 2 + (y - ay - aby * t) ** 2);
            if (far < (cut[e] >= 1 ? LINE.falls : LINE.rides) * STEP + gaps / 4 && far < nearest) { nearest = far; edge = e; }
        }
        if (edge !== undefined) return { edge };
        const under = tissue.under(sheet, x, y);
        return under < 0 ? null : { tri: under };
    }

    // How much a heading runs the way a stretch of the net does, 0 to 1.
    _along(e, heading) {
        const { homeX, homeY, net } = this.tissue, a = net.edges.a[e], b = net.edges.b[e];
        const dx = homeX[b] - homeX[a], dy = homeY[b] - homeY[a];
        return Math.abs(dx * heading[0] + dy * heading[1]) / Math.hypot(dx, dy);
    }

    // Part a sheet at a spot, `through` of the way: the cut the blade is in, or the line of the stroke carried on to here.
    _cut(sheet, met, x, y, through) {
        const tissue = this.tissue, { homeX, homeY, net } = tissue;
        if (met.edge !== undefined) {
            tissue.part(sheet, met.edge, through);
            // Off the end of this cut, the stroke goes on from whichever end of the stretch it was nearer.
            const ends = [net.edges.a[met.edge], net.edges.b[met.edge]], off = ends.map((p) => Math.min(...tissue.at(sheet, p).map((point) => Math.hypot(x - tissue.x[point], y - tissue.y[point]))));
            const end = off[0] < off[1] ? ends[0] : ends[1], from = this.last[sheet];
            // A stroke that has come across whole sheet into this cut joins it: what was between is parted too.
            if (this.across[sheet] && from >= 0 && from !== end) {
                const between = this._between(from, end);
                if (between >= 0) tissue.part(sheet, between, through);
            }
            this.last[sheet] = end;
            this.across[sheet] = false;
            return;
        }
        const [sx, sy] = tissue.stuff(sheet, met.tri, x, y);
        let from = this.last[sheet];
        if (from < 0 || Math.hypot(sx - homeX[from], sy - homeY[from]) > LINE.lost * STEP) {
            // A new stroke: it starts at whichever corner of the triangle under it is nearest, or, if any of them is
            // on a cut, at the nearest of those: a blade put in at the lip of a wound cuts on from the wound.
            const corners = [0, 1, 2].map((k) => net.tris[met.tri * 3 + k]), cut = corners.filter((p) => this._onCut(sheet, p));
            from = (cut.length ? cut : corners).reduce((best, p) => (Math.hypot(sx - homeX[p], sy - homeY[p]) < Math.hypot(sx - homeX[best], sy - homeY[best]) ? p : best));
            this._put(from, sx, sy);
        }
        this.across[sheet] = true;
        while (Math.hypot(sx - homeX[from], sy - homeY[from]) > LINE.leads * STEP) {
            // The neighbour nearest to one step on toward the blade.
            const far = Math.hypot(sx - homeX[from], sy - homeY[from]);
            const aimX = homeX[from] + (sx - homeX[from]) / far * STEP, aimY = homeY[from] + (sy - homeY[from]) / far * STEP, reach = Math.min(far, STEP);
            let next = -1, stretch = -1, nearest = Infinity;
            for (let n = net.near.from[from]; n < net.near.from[from + 1]; n++) {
                const e = net.near.edge[n], other = net.edges.a[e] === from ? net.edges.b[e] : net.edges.a[e];
                const off = Math.hypot(homeX[other] - aimX, homeY[other] - aimY);
                if (off < nearest) { nearest = off; next = other; stretch = e; }
            }
            // (At the edge of the net there may be nothing ahead: the stroke stops there.)
            if (Math.hypot(sx - homeX[next], sy - homeY[next]) >= far) break;
            // Onto the line from the last place to the blade, then cut back to the last place.
            this._put(next, homeX[from] + (sx - homeX[from]) / far * reach, homeY[from] + (sy - homeY[from]) / far * reach);
            tissue.part(sheet, stretch, through);
            this.lined.add(from).add(next);
            from = next;
        }
        this.last[sheet] = from;
    }

    // Whether any cut of a sheet runs through a place.
    _onCut(sheet, p) {
        const { net } = this.tissue, cut = this.tissue.sheets[sheet].cut;
        for (let n = net.near.from[p]; n < net.near.from[p + 1]; n++) if (cut[net.near.edge[n]] > 0) return true;
        return false;
    }

    // The stretch of the net between two places, or -1 if they are not next to each other.
    _between(a, b) {
        const { net } = this.tissue;
        for (let n = net.near.from[a]; n < net.near.from[a + 1]; n++) {
            const e = net.near.edge[n];
            if (net.edges.a[e] === b || net.edges.b[e] === b) return e;
        }
        return -1;
    }

    // Move a place of the net toward a spot, if it is free to be moved: one
    // at the edge of the body or that a cut already runs through stays where it is.
    _put(p, x, y) {
        const tissue = this.tissue;
        if (this.lined.has(p) || tissue.body.held(tissue.homeX[p], tissue.homeY[p])) return;
        const dx = x - tissue.homeX[p], dy = y - tissue.homeY[p], far = Math.hypot(dx, dy), gives = Math.min(1, LINE.gives * STEP / (far || 1));
        tissue.shift(p, tissue.homeX[p] + dx * gives, tissue.homeY[p] + dy * gives);
    }
}
