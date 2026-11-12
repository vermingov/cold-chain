// Flesh: the tissue, drawn.
//
// The tissue (tissue.js) is two flat sheets of points that know nothing of
// the world. Here they are laid on the body: the skin on its surface, in
// the skin's own picture; the deep sheet a layer of fat below it, white
// over red on top and wet underneath; and wherever either is cut, the cut
// face of it, hanging from the lip. All three are moved every frame the
// tissue has moved, and made again whenever it is in more pieces.
//
// Nothing here decides how a wound looks from above. The lips are where the
// tissue has them. What is decided here is only what a cut face shows on
// the way down (skin, fat, the white sheet, muscle, the lining) and how the
// two faces of a cut that is not through meet at its bottom.

import { noiseTexture } from '../noise.js';
import { EDGE, RIBS, WALL } from './field.js';
import { DEEP_SHEET, SKIN, SKIN_SHEET } from './tissue.js';

const FAT = SKIN * WALL;        // metres from the skin's surface to the deep sheet's
const SPARE = 4096;             // corners a sheet's mesh has room for beyond what it starts with, before it must be made again
const SEEN = 5e-5;              // metres a point must have moved to be worth drawing again
// The point of the blade bears on the skin before it parts it: this far round it, in metres, the skin dips.
const DIMPLE = 0.011;
// The edge of a cut is drawn smoothed (Sheet._drawnAt): each point `keeps`
// of where it is, `times` over. And skin that has been moved more than
// `over` metres from where it began is looked at to see if it is lying on
// other skin.
const LIP = { keeps: 0.4, times: 4, over: 0.008 };
// A cut face from lip to foot: how far down each row of its corners is, of the whole face.
const ROWS = [0, 0.14, 0.4, 0.75, 1];
const FAT_STANDS = 0.0012;      // metres the middle of a cut face stands out into a wound that has opened
// Fat lets light through: a cut face is lit as if it lay this much flatter
// than it does. And less of the lamp gets down a narrow wound the deeper it
// goes: at its foot a face is this dim, until the wound is `wide` metres open.
const LIT = { flat: 0.8, foot: 0.45, wide: 0.02 };
const mm = (metres) => (metres * 1000).toFixed(1);

// --- where on the body ---------------------------------------------------------

// The body's surface at a spot of the field (metres across and down it):
// its height, which way the skin faces and which way the body lies, written
// into `out` as seven numbers. Where the body ends, whatever of it there is.
function surface(field, x, y, out) {
    const { hw, hh, heights, faces, lean } = field;
    const gx = Math.max(0, Math.min(hw - 1.001, x / field.width * hw - 0.5)), gy = Math.max(0, Math.min(hh - 1.001, y / field.length * hh - 0.5));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    out[0] = out[1] = out[2] = out[3] = out[4] = out[5] = out[6] = 0;
    let whole = 0;
    for (let corner = 0; corner < 4; corner++) {
        const at = (j + (corner >> 1)) * hw + i + (corner & 1), share = (corner & 1 ? fx : 1 - fx) * (corner >> 1 ? fy : 1 - fy);
        if (heights[at] === -Infinity) continue;
        whole += share;
        out[0] += heights[at] * share;
        for (let k = 0; k < 3; k++) { out[1 + k] += faces[at * 3 + k] * share; out[4 + k] += lean[at * 3 + k] * share; }
    }
    out[0] /= whole || 1;
    for (const from of [1, 4]) {
        const size = Math.hypot(out[from], out[from + 1], out[from + 2]) || 1;
        for (let k = from; k < from + 3; k++) out[k] /= size;
    }
}

// --- one sheet -------------------------------------------------------------------

// A sheet of the tissue as a mesh: a corner for every point of the sheet,
// put wherever the tissue has that point now. `sunk` is how far under the
// skin's surface the sheet lies, in metres.
class Sheet {
    constructor(scene, field, which, name, material, sunk) {
        this.field = field;
        this.which = which;
        this.sunk = sunk;
        this.mesh = new BABYLON.Mesh(name, scene);
        this.mesh.material = material;
        this.mesh.alwaysSelectAsActiveMesh = true;      // it is wherever the tissue is
        this.mesh.isPickable = false;
        this.mesh.receiveShadows = true;
        this.cornerOf = new Int32Array(field.tissue.x.length).fill(-1);     // which corner of the mesh each point of the tissue is
        this.points = [];                                                   // and the other way
        this.lips = new Map();          // each point on the edge of a cut that is through: the points on either side of it along that edge
        this.shape = -1;
        this.pressed = { x: 0, y: 0, sinks: 0 };                           // the blade on the skin, as it was last time
        this.at = new Float32Array(7);                                      // the body's surface at one spot, for `surface` to fill
        this._room(field.tissue.net.count + SPARE);
        // Its triangles never change in number, only in which corners they have.
        this.index = new Uint32Array(field.tissue.net.tris.length);
        this.mesh.setIndices(this.index, this.room, true);
        // Seen from above, the net's triangles may be wound either way: it depends which way the body lies on the table.
        this.turned = field.across[0] * field.along[1] - field.across[1] * field.along[0] < 0;
    }

    // Buffers for so many corners, keeping what is in them.
    _room(corners) {
        const kept = (old, each) => { const next = new Float32Array(corners * each); if (old) next.set(old); return next; };
        this.positions = kept(this.positions, 3);
        this.normals = kept(this.normals, 3);
        this.leans = kept(this.leans, 3);
        this.uvs = kept(this.uvs, 2);
        this.ats = kept(this.ats, 2);
        this.seen = kept(this.seen, 2).fill(Infinity);
        this.room = corners;
        this.mesh.setVerticesData('position', this.positions, true);
        this.mesh.setVerticesData('normal', this.normals, true);
        this.mesh.setVerticesData('uv', this.uvs, true);
        this.mesh.setVerticesData('fleshAt', this.ats, true, 2);
        // Not a cut face: nowhere under the skin, and as bright as it is.
        this.mesh.setVerticesData('fleshDown', Float32Array.from({ length: corners * 2 }, (_, i) => (i & 1 ? 1 : -1)), false, 2);
        this.shape = -1;
    }

    // Bring the mesh up to date with the tissue. `press` is the blade on
    // the skin: { x, y, sinks }, a spot of the field and how far it bears
    // down, in metres; `stirred` is whether the tissue has moved at all.
    // Returns whether anything was moved.
    update(press, stirred) {
        const { tissue } = this.field, { tri, gone } = tissue.sheets[this.which], reshaped = this.shape !== tissue.shape;
        if (reshaped) {
            if (!this._corners(tri)) return this.update(press, stirred);
            this.shape = tissue.shape;
            for (let t = 0; t < tri.length; t += 3) {
                // (A triangle taken away is drawn as nothing: all three corners the same.)
                const away = gone[t / 3] === 1;
                this.index[t] = this.cornerOf[tri[t]];
                this.index[t + 1] = away ? this.index[t] : this.cornerOf[tri[this.turned ? t + 2 : t + 1]];
                this.index[t + 2] = away ? this.index[t] : this.cornerOf[tri[this.turned ? t + 1 : t + 2]];
            }
            this.mesh.updateIndices(this.index, 0, true);
            this._lips();
        }
        const was = this.pressed;
        this.pressed = { ...press };
        if (!reshaped && !stirred && !press.sinks && !was.sinks) return false;
        if (!this._place(press, was)) return false;
        this.mesh.updateVerticesData('position', this.positions);
        this.mesh.updateVerticesData('normal', this.normals);
        return true;
    }

    // Find the edges of every cut that goes through the sheet: for each
    // point on one, the points next to it along that edge.
    _lips() {
        const { tissue } = this.field, { tri, cut, cuts, gone } = tissue.sheets[this.which], { edges } = tissue.net, lips = this.lips;
        lips.clear();
        const join = (a, b) => { if (!lips.has(a)) lips.set(a, []); lips.get(a).push(b); };
        for (const e of cuts) {
            if (cut[e] < 1) continue;
            for (const t of [edges.t1[e], edges.t2[e]]) {
                if (t < 0 || gone[t]) continue;
                const a = tri[tissue._corner(t, edges.a[e])], b = tri[tissue._corner(t, edges.b[e])];
                join(a, b); join(b, a);
            }
        }
    }

    // Where each point is drawn, on the field: where the tissue has it,
    // except along the edge of a cut, which is drawn smoothed. The net is a
    // net of triangles a few millimetres across, and a cut or a tear through
    // it runs from corner to corner of them: drawn as it is, its edge is a
    // row of teeth, and where one triangle is left jutting into a wound it is
    // a spike. Flesh has no teeth. Each point along an edge (and only where
    // the edge runs on through it, one point either side) is drawn `LIP.
    // keeps` of the way where it is and the rest the middle of the two
    // either side, `LIP.times` over.
    _drawnAt() {
        const { tissue } = this.field, { x, y } = tissue, lips = this.lips;
        let at = new Map();
        for (const [point] of lips) at.set(point, [x[point], y[point]]);
        for (let time = 0; time < LIP.times; time++) {
            const next = new Map();
            for (const [point, [px, py]] of at) {
                const beside = lips.get(point);
                if (beside.length !== 2) { next.set(point, [px, py]); continue; }
                const [a, b] = beside.map((p) => at.get(p) || [x[p], y[p]]);
                next.set(point, [px * LIP.keeps + (a[0] + b[0]) / 2 * (1 - LIP.keeps), py * LIP.keeps + (a[1] + b[1]) / 2 * (1 - LIP.keeps)]);
            }
            at = next;
        }
        return at;
    }

    // A corner for every point of the sheet that has none yet. Returns
    // false if there was no room, and the buffers have been made again.
    _corners(tri) {
        const { tissue } = this.field, grown = [];
        for (const point of tri) {
            if (this.cornerOf[point] >= 0) continue;
            this.cornerOf[point] = this.points.length;
            this.points.push(point);
            grown.push(point);
        }
        if (this.points.length > this.room) {
            this._room(this.points.length + SPARE);
            return false;
        }
        // Where on the skin's picture a point is depends on where in the skin it is, not where the skin has got to.
        for (const point of grown) {
            const corner = this.cornerOf[point], p = tissue.place[point], x = tissue.homeX[p], y = tissue.homeY[p];
            const skin = this.field.skinAt(x / this.field.width, y / this.field.length);
            this.uvs.set(skin ? skin.picture : [0, 0], corner * 2);
            this.ats.set([x, y], corner * 2);
        }
        if (grown.length) {
            this.mesh.updateVerticesData('uv', this.uvs);
            this.mesh.updateVerticesData('fleshAt', this.ats);
        }
        return true;
    }

    // Put every corner whose point has moved, or that the blade is bearing
    // on (`press`) or was a moment ago (`was`), where it now is.
    _place(press, was) {
        const field = this.field, { tissue } = field, { positions, normals, leans, seen, points } = this, at = this.at;
        const [ox, oz] = field.origin, [ax, az] = field.across, [lx, lz] = field.along, near = (3 * DIMPLE) ** 2, facing = this.sunk ? 4 : 1;
        const drawn = this._drawnAt(), thick = tissue.body.thick[this.which];
        let moved = false;
        for (let corner = 0; corner < points.length; corner++) {
            const point = points[corner], smoothed = drawn.get(point), x = smoothed ? smoothed[0] : tissue.x[point], y = smoothed ? smoothed[1] : tissue.y[point];
            if (Math.abs(x - seen[corner * 2]) + Math.abs(y - seen[corner * 2 + 1]) < SEEN
                && !(press.sinks > 0 && (x - press.x) ** 2 + (y - press.y) ** 2 < near) && !(was.sinks > 0 && (x - was.x) ** 2 + (y - was.y) ** 2 < near)) continue;
            seen[corner * 2] = x; seen[corner * 2 + 1] = y;
            surface(field, x, y, at);
            // Where the body's own skin is still drawn over it, the sheet lies a hair under that.
            let down = this.sunk + press.sinks * Math.exp(-((x - press.x) ** 2 + (y - press.y) ** 2) / DIMPLE ** 2) + (field._inland(x, y) < EDGE.skin + 0.002 ? 0.0001 : 0);
            // Skin drawn over other skin (a flap laid back, a lip pulled across) lies on it, not in it.
            const p = tissue.place[point];
            if (this.which === SKIN_SHEET && (x - tissue.homeX[p]) ** 2 + (y - tissue.homeY[p]) ** 2 > LIP.over ** 2 && tissue.overlaps(SKIN_SHEET, x, y, point)) down -= thick;
            positions[corner * 3] = ox + ax * x + lx * y - at[4] * down;
            positions[corner * 3 + 1] = at[0] - at[5] * down;
            positions[corner * 3 + 2] = oz + az * x + lz * y - at[6] * down;
            // Skin faces the way the skin there faces. What is under it only knows the lie of the body.
            normals[corner * 3] = at[facing]; normals[corner * 3 + 1] = at[facing + 1]; normals[corner * 3 + 2] = at[facing + 2];
            leans[corner * 3] = at[4]; leans[corner * 3 + 1] = at[5]; leans[corner * 3 + 2] = at[6];
            moved = true;
        }
        return moved;
    }
}

// --- the cut faces -----------------------------------------------------------------

// The faces of every cut in both sheets, as one mesh. Each lip of each cut
// is a row of the sheet's own points, and from each of those a column of
// corners hangs down the face. Where the sheet is cut right through, the
// column goes straight down through it; where it is not, the two faces of
// the cut lean in to meet in the middle, as deep as the blade went.
class Faces {
    constructor(scene, field, sheets, material) {
        this.field = field;
        this.sheets = sheets;
        this.mesh = new BABYLON.Mesh('cut faces', scene);
        this.mesh.material = material;
        this.mesh.alwaysSelectAsActiveMesh = true;
        this.mesh.isPickable = false;
        // The lamp's shadows are too coarse for the inside of a cut a millimetre wide: they black it out.
        this.mesh.receiveShadows = false;
        this.shape = -1;
        this.count = 0;                 // columns
        this.strips = 0;
        this._room(1024);
    }

    update(moved) {
        const { tissue } = this.field;
        if (this.shape !== tissue.shape) {
            this.shape = tissue.shape;
            this._columns();
        } else if (!moved) return;
        if (this.count) this._place();
    }

    // Buffers for so many columns and as many strips between them. Each
    // column knows its sheet, its point of that sheet, and which wound it
    // is one side of: a wound is all of a sheet's columns at one place of
    // the net.
    _room(columns) {
        const corners = columns * ROWS.length;
        this.room = columns;
        this.sheetOf = new Uint8Array(columns);
        this.pointOf = new Uint32Array(columns);
        this.woundOf = new Uint32Array(columns);
        this.wounds = new Float32Array(columns * 6);            // each: its middle (three numbers), how many columns, how deep, whether through
        this.placeOf = new Uint32Array(columns);                // of each wound
        this.ends = new Uint32Array(columns * 4);               // each strip's two columns
        this.positions = new Float32Array(corners * 3);
        this.normals = new Float32Array(corners * 3);
        this.ats = new Float32Array(corners * 2);
        this.downs = new Float32Array(corners * 2);
        this.index = new Uint32Array(columns * 2 * (ROWS.length - 1) * 6);
        this.mesh.setVerticesData('position', this.positions, true);
        this.mesh.setVerticesData('normal', this.normals, true);
        this.mesh.setVerticesData('fleshAt', this.ats, true, 2);
        this.mesh.setVerticesData('fleshDown', this.downs, true, 2);
        this.mesh.setIndices(this.index, corners, true);
    }

    // Find the lips: a column for each point of a sheet that is on a cut,
    // and a strip of face between the columns at either end of each side
    // of each cut stretch. Each strip runs from one column to the next
    // with the sheet it is the edge of on its left, seen from above: so
    // every face is wound the same way, and looks away from its own sheet.
    _columns() {
        const { tissue } = this.field, { edges, count: places } = tissue.net, columnOf = new Map(), woundOf = new Map();
        const cuts = tissue.sheets[0].cuts.length + tissue.sheets[1].cuts.length;
        // (A stretch has two sides, and a side at most two columns to itself.)
        if (cuts * 4 > this.room) this._room(cuts * 8);
        this.count = this.strips = 0;
        let wounds = 0;
        for (let sheet = 0; sheet < 2; sheet++) {
            const { tri, cuts: cut, gone } = tissue.sheets[sheet];
            for (const e of cut) {
                for (let side = 0; side < 2; side++) {
                    const t = side ? edges.t2[e] : edges.t1[e];
                    // (What has been taken away has no face here: it is in the hand.)
                    if (gone[t]) continue;
                    const a = tissue._corner(t, edges.a[e]), b = tissue._corner(t, edges.b[e]), forward = (b - a + 3) % 3 === 1;
                    for (let end = 0; end < 2; end++) {
                        const point = tri[end === (forward ? 0 : 1) ? a : b], key = sheet * tissue.x.length + point;
                        let column = columnOf.get(key);
                        if (column === undefined) {
                            column = this.count++;
                            columnOf.set(key, column);
                            const place = tissue.place[point], at = sheet * places + place;
                            if (!woundOf.has(at)) { woundOf.set(at, wounds); this.placeOf[wounds++] = place; }
                            this.sheetOf[column] = sheet; this.pointOf[column] = point; this.woundOf[column] = woundOf.get(at);
                        }
                        this.ends[this.strips * 2 + end] = column;
                    }
                    this.strips++;
                }
            }
        }
        this.index.fill(0);
        const rows = ROWS.length, turned = this.sheets[0].turned;
        for (let strip = 0, i = 0; strip < this.strips; strip++) {
            const a = this.ends[strip * 2] * rows, b = this.ends[strip * 2 + 1] * rows;
            for (let row = 0; row + 1 < rows; row++, i += 6) {
                this.index[i] = a + row; this.index[i + 1] = turned ? b + row : a + row + 1; this.index[i + 2] = turned ? a + row + 1 : b + row;
                this.index[i + 3] = a + row + 1; this.index[i + 4] = turned ? b + row : b + row + 1; this.index[i + 5] = turned ? b + row + 1 : b + row;
            }
        }
        this.mesh.updateIndices(this.index, 0, true);
    }

    // Put every column where its lip is and hang it. Where the sheet is
    // through, the face hangs straight down. Where it is not, it leans in
    // to the middle of the wound, and meets the other face there. Fat
    // stands out of an open face.
    _place() {
        const { tissue } = this.field, { net } = tissue, rows = ROWS.length, { wounds, positions, normals, downs, ats } = this;
        // First what each wound comes to: where its middle is, how deep the blade went there, whether it is through.
        wounds.fill(0);
        for (let column = 0; column < this.count; column++) {
            const drawn = this.sheets[this.sheetOf[column]], lip = drawn.cornerOf[this.pointOf[column]] * 3, wound = this.woundOf[column] * 6;
            wounds[wound] += drawn.positions[lip]; wounds[wound + 1] += drawn.positions[lip + 1]; wounds[wound + 2] += drawn.positions[lip + 2];
            wounds[wound + 3]++;
            if (wounds[wound + 3] > 1) continue;
            const cut = tissue.sheets[this.sheetOf[column]].cut, place = this.placeOf[this.woundOf[column]];
            let deepest = 0, least = 1;
            for (let n = net.near.from[place]; n < net.near.from[place + 1]; n++) {
                const through = cut[net.near.edge[n]];
                if (through > 0) { deepest = Math.max(deepest, through); least = Math.min(least, through); }
            }
            wounds[wound + 4] = deepest; wounds[wound + 5] = least >= 1 ? 1 : 0;
        }
        for (let column = 0; column < this.count; column++) {
            const sheet = this.sheetOf[column], drawn = this.sheets[sheet], lip = drawn.cornerOf[this.pointOf[column]] * 3, wound = this.woundOf[column] * 6;
            const sides = wounds[wound + 3], place = this.placeOf[this.woundOf[column]];
            // A place the cut ends at is still in one piece: the wound comes up to nothing there.
            const deep = (sides > 1 ? wounds[wound + 4] : 0) * (sheet ? WALL - FAT : FAT), parted = sides > 1 && wounds[wound + 5] > 0;
            const px = drawn.positions[lip], py = drawn.positions[lip + 1], pz = drawn.positions[lip + 2];
            const ix = wounds[wound] / sides - px, iy = wounds[wound + 1] / sides - py, iz = wounds[wound + 2] / sides - pz, gap = Math.sqrt(ix * ix + iy * iy + iz * iz);
            for (let row = 0; row < rows; row++) {
                const corner = column * rows + row, down = ROWS[row];
                const inward = parted ? Math.sin(Math.PI * down) * Math.min(FAT_STANDS, gap * 0.25) / (gap || 1) : down;
                positions[corner * 3] = px + ix * inward - drawn.leans[lip] * deep * down;
                positions[corner * 3 + 1] = py + iy * inward - drawn.leans[lip + 1] * deep * down;
                positions[corner * 3 + 2] = pz + iz * inward - drawn.leans[lip + 2] * deep * down;
                downs[corner * 2] = (sheet ? FAT : 0) + deep * down;
                downs[corner * 2 + 1] = 1 - (1 - LIT.foot) * down * Math.max(0, 1 - 2 * gap / LIT.wide);
                ats[corner * 2] = tissue.homeX[place];
                ats[corner * 2 + 1] = tissue.homeY[place];
            }
        }
        this._face();
        this.mesh.updateVerticesData('position', positions);
        this.mesh.updateVerticesData('normal', normals);
        this.mesh.updateVerticesData('fleshAt', ats);
        this.mesh.updateVerticesData('fleshDown', downs);
    }

    // Which way each face looks: square to the strip and to the way down
    // it, on the side away from its sheet, and then tipped up toward the
    // lamp. The same all the way down a column.
    _face() {
        const rows = ROWS.length, last = rows - 1, away = this.sheets[0].turned ? 1 : -1, { positions, normals } = this;
        normals.fill(0, 0, this.count * rows * 3);
        for (let strip = 0; strip < this.strips; strip++) {
            const a = this.ends[strip * 2], b = this.ends[strip * 2 + 1], drawn = this.sheets[this.sheetOf[a]];
            const top = a * rows * 3, foot = (a * rows + last) * 3, next = b * rows * 3, lie = drawn.cornerOf[this.pointOf[a]] * 3;
            const ax = positions[next] - positions[top], ay = positions[next + 1] - positions[top + 1], az = positions[next + 2] - positions[top + 2];
            let dx = positions[foot] - positions[top], dy = positions[foot + 1] - positions[top + 1], dz = positions[foot + 2] - positions[top + 2];
            // A cut that has no depth yet still has a way down: against the lie of the body.
            if (dx * dx + dy * dy + dz * dz < 1e-12) { dx = -drawn.leans[lie]; dy = -drawn.leans[lie + 1]; dz = -drawn.leans[lie + 2]; }
            const nx = ay * dz - az * dy, ny = az * dx - ax * dz, nz = ax * dy - ay * dx, size = (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1) * away;
            for (let end = 0; end < 2; end++) {
                const column = end ? b : a, lean = this.sheets[this.sheetOf[column]].cornerOf[this.pointOf[column]] * 3;
                for (let row = 0; row < rows; row++) {
                    const corner = (column * rows + row) * 3;
                    normals[corner] += nx / size + drawn.leans[lean] * LIT.flat;
                    normals[corner + 1] += ny / size + drawn.leans[lean + 1] * LIT.flat;
                    normals[corner + 2] += nz / size + drawn.leans[lean + 2] * LIT.flat;
                }
            }
        }
    }
}

// --- what flesh looks like ------------------------------------------------------------

// What is seen in a cut face, by how many millimetres under the skin: the
// cut edge of the skin itself; fat in lobes; the white sheet over the
// muscle; muscle, and the white sheet behind it; and last the wet skin that
// lines the belly. In the midline there is no muscle: there the two sides of
// the belly are joined by a seam, a finger wide, a few millimetres of white
// with fat behind it. Over the ribs, bone.
const GLSL_LOOKS = `
float fleshSeam(vec2 at) {
    return 1.0 - smoothstep(0.006, 0.011, abs(at.x - fleshBody.x));
}

bool fleshOverRibs(vec2 at) {
    return at.y < (${RIBS.end.toFixed(3)} + ${RIBS.falls.toFixed(3)} * abs(at.x / (2.0 * fleshBody.x) - 0.5)) * fleshBody.y;
}

vec3 fleshFace(float deep, vec2 at, float lobes, float fibre) {
    vec3 fat = mix(vec3(0.76, 0.58, 0.21), vec3(0.93, 0.8, 0.42), lobes), sheet = vec3(0.8, 0.77, 0.7);
    vec3 flesh = mix(vec3(0.83, 0.67, 0.6), fat, smoothstep(1.2, 2.2, deep));
    flesh = mix(flesh, sheet, smoothstep(${mm(FAT - 0.0006)}, ${mm(FAT)}, deep));
    float seam = fleshSeam(at);
    vec3 muscle = mix(vec3(0.3, 0.08, 0.07), vec3(0.47, 0.14, 0.1), fibre);
    vec3 behind = mix(muscle, mix(sheet, fat * 0.92, smoothstep(${mm(FAT + 0.0026)}, ${mm(FAT + 0.0034)}, deep)), seam);
    flesh = mix(flesh, behind, smoothstep(${mm(FAT + 0.0008)}, ${mm(FAT + 0.0016)}, deep));
    flesh = mix(flesh, sheet, smoothstep(${mm(WALL - 0.0028)}, ${mm(WALL - 0.0022)}, deep) * (1.0 - seam));
    flesh = mix(flesh, vec3(0.62, 0.36, 0.31), smoothstep(${mm(WALL - 0.0011)}, ${mm(WALL - 0.0006)}, deep));
    if (fleshOverRibs(at)) flesh = mix(flesh, vec3(0.8, 0.76, 0.64), smoothstep(${mm(FAT + 0.001)}, ${mm(FAT + 0.002)}, deep));
    return flesh;
}

// The deep sheet from above: white and glistening, the red of the muscle
// showing through it either side of the seam.
vec3 fleshSheet(vec2 at) {
    float strands = texture2D(fleshNoise, vec2(at.x / 0.004, at.y / 0.05)).g, drifts = texture2D(fleshNoise, at / 0.06).r;
    vec3 over = mix(vec3(0.6, 0.55, 0.5), vec3(0.72, 0.67, 0.6), drifts);
    vec3 muscle = mix(vec3(0.42, 0.13, 0.11), vec3(0.58, 0.24, 0.19), strands);
    vec3 sheet = mix(over, muscle, 0.45 * (1.0 - fleshSeam(at)));
    // Over the ribs it is muscle laid on them, and the ribs show through it as paler bands.
    float ribs = smoothstep(0.45, 0.65, texture2D(fleshNoise, vec2(at.x / 0.3, at.y / 0.028)).b);
    return fleshOverRibs(at) ? mix(muscle, over, 0.2 + 0.3 * ribs) : sheet;
}

// The inside of the wall of the belly: a smooth wet skin of its own, pale,
// with fat lying behind it in drifts and the muscle showing through.
vec3 fleshInside(vec2 at) {
    vec3 inside = mix(vec3(0.57, 0.31, 0.27), vec3(0.71, 0.57, 0.37), smoothstep(0.35, 0.8, texture2D(fleshNoise, at / 0.13).g) * 0.7);
    float strands = texture2D(fleshNoise, vec2(at.x / 0.006, at.y / 0.09)).g;
    return mix(inside, vec3(0.43, 0.17, 0.15), smoothstep(0.5, 0.8, strands) * 0.3);
}
`;

const GLSL_FLESH_COLOUR = `
#ifdef FLESH
if (vFleshDown.x < 0.0) {
    surfaceAlbedo = toLinearSpace(gl_FrontFacing ? fleshSheet(vFleshAt) : fleshInside(vFleshAt));
} else {
    // A cut face: so far along the cut, so far down it. Fat is in lobes,
    // and muscle in strands that run the length of the belly. Nothing in a
    // body is ruled: every layer is a little thicker here and thinner there.
    vec2 face = vec2(vFleshAt.x + vFleshAt.y, vFleshDown.x);
    float lobes = texture2D(fleshNoise, face / 0.011).r, fibre = texture2D(fleshNoise, face / vec2(0.07, 0.003)).g;
    float uneven = (texture2D(fleshNoise, vec2(face.x / 0.05, 0.37)).r - 0.5) * 2.6 * smoothstep(0.0015, 0.005, vFleshDown.x);
    vec3 flesh = fleshFace(vFleshDown.x * 1000.0 + uneven, vFleshAt, lobes, fibre);
    // Two days dead: what blood there is has settled, and shows as dark points in the fat.
    flesh = mix(flesh, vec3(0.2, 0.03, 0.03), smoothstep(0.9, 0.95, texture2D(fleshNoise, face / 0.004).b) * 0.5);
    surfaceAlbedo = toLinearSpace(flesh) * vFleshDown.y;
}
#endif
`;

// Flesh is not smooth: fat is in lobes and muscle in strands. The sheets very nearly are.
const GLSL_FLESH_WET = `
#ifdef FLESH
// A cut face is wet. The sheets are only moist.
metallicRoughness.g = vFleshDown.x < 0.0 ? 0.42 : 0.26;
#endif
`;

const GLSL_FLESH_LUMPS = `
#ifdef FLESH
{
    vec2 face = vFleshDown.x < 0.0 ? vFleshAt : vec2(vFleshAt.x + vFleshAt.y, vFleshDown.x);
    vec3 lumps = texture2D(fleshNoise, face / 0.009).rgb - 0.5;
    normalW = normalize(normalW + lumps * (vFleshDown.x < 0.0 ? 0.03 : 0.3));
}
#endif
`;

// Colours a material as flesh. Each corner says where in the body it is
// (`fleshAt`, metres across the field and down it), and then how far under
// the skin (`fleshDown`, metres; less than nothing for the sheets
// themselves) and how much of the light gets to it there.
class Looks extends BABYLON.MaterialPluginBase {
    constructor(material, field) {
        super(material, 'Flesh', 240, { FLESH: false });
        this.field = field;
        this.noise = noiseTexture(material.getScene());
        this._enable(true);
    }

    getClassName() { return 'Flesh'; }

    prepareDefines(defines) { defines.FLESH = true; }

    isReadyForSubMesh() { return this.noise.isReady(); }

    getAttributes(attributes) { attributes.push('fleshAt', 'fleshDown'); }

    getSamplers(samplers) { samplers.push('fleshNoise'); }

    getUniforms() {
        return { ubo: [{ name: 'fleshBody', size: 2, type: 'vec2' }], fragment: '#ifdef FLESH\nuniform vec2 fleshBody;\n#endif' };
    }

    bindForSubMesh(ubo) {
        // Where the midline is and how long the field: both metres.
        ubo.updateFloat2('fleshBody', this.field.width / 2, this.field.length);
        ubo.setTexture('fleshNoise', this.noise);
    }

    getActiveTextures(textures) { textures.push(this.noise); }

    hasTexture(texture) { return texture === this.noise; }

    getCustomCode(shaderType) {
        const handed = 'varying vec2 vFleshAt;\nvarying vec2 vFleshDown;\n';
        if (shaderType === 'vertex') {
            return {
                CUSTOM_VERTEX_DEFINITIONS: `#ifdef FLESH\nattribute vec2 fleshAt;\nattribute vec2 fleshDown;\n${handed}#endif\n`,
                CUSTOM_VERTEX_MAIN_END: '#ifdef FLESH\nvFleshAt = fleshAt;\nvFleshDown = fleshDown;\n#endif\n',
            };
        }
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef FLESH\nuniform sampler2D fleshNoise;\n${handed}${GLSL_LOOKS}#endif\n`,
            CUSTOM_FRAGMENT_UPDATE_ALBEDO: GLSL_FLESH_COLOUR,
            CUSTOM_FRAGMENT_BEFORE_LIGHTS: GLSL_FLESH_LUMPS,
            CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS: GLSL_FLESH_WET,
        };
    }
}

function fleshMaterial(scene, field) {
    const material = new BABYLON.PBRMaterial('flesh', scene);
    material.albedoColor = BABYLON.Color3.White();      // its shader colours it
    material.metallic = 0;
    material.roughness = 0.27;
    material.specularIntensity = 0.5;
    material.environmentIntensity = 0;
    material.maxSimultaneousLights = 8;
    // A sheet is seen from under as well as over, and a face from wherever the wound lets it be.
    material.backFaceCulling = false;
    material.twoSidedLighting = true;
    new Looks(material, field);
    return material;
}

// --- all of it -------------------------------------------------------------------------

export class Flesh {
    // `skin` is the body's skin material, which the skin sheet is drawn in a copy of.
    constructor(scene, field, skin) {
        this.field = field;
        const flesh = fleshMaterial(scene, field);
        this.sheets = [new Sheet(scene, field, SKIN_SHEET, 'skin sheet', skin.clone('cut skin'), 0), new Sheet(scene, field, DEEP_SHEET, 'deep sheet', flesh, FAT)];
        this.faces = new Faces(scene, field, this.sheets, flesh);
        this.meshes = [...this.sheets.map((sheet) => sheet.mesh), this.faces.mesh];
        scene.onBeforeRenderObservable.add(() => this._update());
    }

    _update() {
        const field = this.field, press = { x: field.blade.u * field.width, y: field.blade.v * field.length, sinks: field.blade.sinks };
        const skin = this.sheets[0].update(press, field.stirred), deep = this.sheets[1].update(press, field.stirred);
        this.faces.update(skin || deep);
    }
}
