// Blood on the floor worked out on the GPU (floor.rs): how deep it stands in each 12.5 mm cell of the floor, how it
// runs, and what the floor's material reads to draw it. The TS's floor.ts `add`, `pour`, `take`, `_flow` and `_settle`,
// number for number, over the floor's awake tiles only.
//
// The cells live in buffers by tile (32 by 32 cells), in the order the tiles were woken (their slot): a slot's 1024
// cells, row by row. `index` holds the awake tiles by slot, then each tile's slot (or NONE) from `slots_at`.

const CELL: f32 = 0.0125;
const STANDS: f32 = 0.0025;
const STAYS: f32 = 0.00006;
const MOST_MM: f32 = 4.0;
const CLOTS: f32 = 360.0;
const DRIES: f32 = 1400.0;
const NONE: u32 = 0xffffffffu;

struct Floor {
    // Cells a side, tiles a side, awake tiles, ops this frame, where the slot table starts in `index`.
    n: u32,
    tiles: u32,
    count: u32,
    ops: u32,
    slots_at: u32,
    clock: f32,
    // How much of a depth difference a film moves a step, per cubic metre of depth (floor.rs MOVES).
    moves: f32,
    pad: f32,
}

@group(0) @binding(0) var<uniform> f: Floor;
@group(0) @binding(1) var<storage, read> index: array<u32>;
@group(0) @binding(2) var<storage, read_write> h: array<f32>;
// When the blood in each cell came (it clots and dries by that), and the same as the step leaves it.
@group(0) @binding(3) var<storage, read_write> born: array<vec2<f32>>;
// The floor's own lie: how high each cell is, and how deep blood must stand to wet it.
@group(0) @binding(4) var<storage, read> ground: array<vec2<f32>>;
// What each cell gives each of its four neighbours this step: +x, -x, +z, -z.
@group(0) @binding(5) var<storage, read_write> give: array<vec4<f32>>;
// Tiles that blood would have run into, asleep: woken by floor.rs.
@group(0) @binding(6) var<storage, read_write> want: array<u32>;
// This frame's blood onto and off the floor: (x, z, ml, r), r 0 for one cell, more to pour into the liquid round it,
// less than nothing to take up within -r.
@group(0) @binding(7) var<storage, read> ops: array<vec4<f32>>;
// What the floor's material reads: the depth (as a square root, so a thin smear still has steps) and how wet it is.
@group(0) @binding(8) var display: texture_storage_2d<rgba8unorm, write>;

const WAYS = array<vec2<i32>, 4>(vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1));

// The cell at grid place g, or NONE: off the floor's edge (the outermost cells are never wet), or in a tile asleep.
fn cell(g: vec2<i32>) -> u32 {
    let n = i32(f.n);
    if g.x < 1 || g.y < 1 || g.x >= n - 1 || g.y >= n - 1 {
        return NONE;
    }
    let s = index[f.slots_at + tile_of(g)];
    if s == NONE {
        return NONE;
    }
    return s * 1024u + u32(g.y & 31) * 32u + u32(g.x & 31);
}

fn tile_of(g: vec2<i32>) -> u32 {
    return u32(g.y >> 5) * f.tiles + u32(g.x >> 5);
}

// The grid place of the floor point (x, z), floor.rs's own coordinates (metres from the floor's corner).
fn place(x: f32, z: f32) -> vec2<i32> {
    return vec2<i32>(floor(vec2(x, z) / CELL));
}

// How long blood that deep keeps wet (thin blood dries in minutes; a pool keeps wet under its skin far longer).
fn wetness(c: u32) -> f32 {
    let hc = h[c];
    if hc <= 0.0 {
        return 0.0;
    }
    return exp(-(f.clock - born[c].x) / (200.0 + DRIES * min(1.0, hc / STANDS)));
}

fn shown(g: vec2<i32>, c: u32) {
    textureStore(display, g, vec4(sqrt(min(1.0, h[c] / (MOST_MM / 1000.0))), wetness(c), 0.0, 1.0));
}

// Still a liquid a drop would fall into: standing at least `deep` and not yet dried to a skin.
fn liquid(c: u32, deep: f32) -> bool {
    return c != NONE && h[c] >= deep && wetness(c) > 0.33;
}

fn add(g: vec2<i32>, ml: f32) {
    let c = cell(g);
    if c == NONE || ml <= 0.0 {
        return;
    }
    let more = ml * 1e-6 / (CELL * CELL);
    if h[c] < more * 2.0 {
        born[c] = vec2(f.clock);
    }
    h[c] += more;
    shown(g, c);
}

// One invocation, the ops in order: two in the same cell must not race.
@compute @workgroup_size(1)
fn apply() {
    for (var i = 0u; i < f.ops; i++) {
        let op = ops[i];
        let g = place(op.x, op.y);
        if op.w == 0.0 {
            add(g, op.z);
        } else if op.w > 0.0 {
            // A drop falling into a pool merges with it and its surface levels out again within a moment, so it raises
            // the liquid within r evenly instead of piling up in one cell (which the slow flow then drew as a crater for
            // minutes). Where none of it there is liquid, the one cell.
            let k = i32(ceil(op.w / CELL));
            var found = 0u;
            for (var j = -k; j <= k; j++) {
                for (var e = -k; e <= k; e++) {
                    if e * e + j * j <= k * k && liquid(cell(g + vec2(e, j)), STAYS) {
                        found++;
                    }
                }
            }
            if found == 0u {
                add(g, op.z);
                continue;
            }
            let each = op.z / f32(found);
            for (var j = -k; j <= k; j++) {
                for (var e = -k; e <= k; e++) {
                    if e * e + j * j <= k * k && liquid(cell(g + vec2(e, j)), STAYS) {
                        add(g + vec2(e, j), each);
                    }
                }
            }
        } else {
            // Taken up (something lying in it, a shoe): from every cell within -r with more than its film, evenly.
            if cell(g) == NONE {
                continue;
            }
            let k = i32(ceil(-op.w / CELL));
            var found = 0u;
            for (var j = -k; j <= k; j++) {
                for (var e = -k; e <= k; e++) {
                    let c = cell(g + vec2(e, j));
                    if e * e + j * j <= k * k && c != NONE && h[c] > STAYS {
                        found++;
                    }
                }
            }
            let each = op.z * 1e-6 / (CELL * CELL) / f32(max(1u, found));
            for (var j = -k; j <= k; j++) {
                for (var e = -k; e <= k; e++) {
                    let c = cell(g + vec2(e, j));
                    if e * e + j * j <= k * k && c != NONE && h[c] > STAYS {
                        h[c] -= min(each, h[c] - STAYS * 0.5);
                        shown(g + vec2(e, j), c);
                    }
                }
            }
        }
    }
}

// The invocation's cell: its slot's tile, and where in it.
fn mine(id: u32) -> vec3<u32> {
    let s = id / 1024u;
    let t = index[s];
    let l = id % 1024u;
    let g = vec2((t % f.tiles) * 32u + l % 32u, (t / f.tiles) * 32u + l / 32u);
    return vec3(g, id);
}

// One step of every awake tile: each wet cell gives to each lower neighbour as much as a film its depth would carry.
@compute @workgroup_size(256)
fn flow(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= f.count * 1024u {
        return;
    }
    let m = mine(id.x);
    let g = vec2<i32>(m.xy);
    let c = m.z;
    let hc = h[c];
    var out = vec4(0.0);
    if hc > STAYS {
        let top = hc + ground[c].x;
        let free = hc - STAYS;
        var ease = -1.0;
        for (var k = 0; k < 4; k++) {
            let at = g + WAYS[k];
            let n = i32(f.n);
            if at.x < 1 || at.y < 1 || at.x >= n - 1 || at.y >= n - 1 {
                continue;
            }
            let d = cell(at);
            if d == NONE {
                want[tile_of(at)] = 1u;
                continue;
            }
            let drop = top - h[d] - ground[d].x;
            if drop <= 0.0 {
                continue;
            }
            // Dry floor is wetted only by blood standing deep enough to push its edge over it.
            if h[d] < STAYS * 0.5 && hc < ground[d].y {
                continue;
            }
            // Runnier while fresh, thicker as it clots; and a film moves as the cube of its depth.
            if ease < 0.0 {
                ease = min(0.11, f.moves * hc * hc * hc * exp(-(f.clock - born[c].x) / CLOTS));
            }
            let q = min(ease * drop, free * 0.24);
            if q > 1e-9 {
                out[k] = q;
            }
        }
    }
    give[c] = out;
}

// What the step gives, applied after all of it is worked out, so the order of the cells does not show. A cell that was
// next to dry takes the age of the blood that came into it.
@compute @workgroup_size(256)
fn gather(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= f.count * 1024u {
        return;
    }
    let m = mine(id.x);
    let g = vec2<i32>(m.xy);
    let c = m.z;
    let was = h[c];
    let gone = give[c];
    var change = -(gone.x + gone.y + gone.z + gone.w);
    var b = born[c].x;
    for (var k = 0; k < 4; k++) {
        let d = cell(g + WAYS[k]);
        if d == NONE {
            continue;
        }
        // (What the neighbour gives this way is its give the other way round: +x and -x, +z and -z.)
        let q = give[d][k ^ 1];
        if q > 0.0 {
            change += q;
            if was < q * 2.0 {
                b = born[d].x;
            }
        }
    }
    born[c].y = b;
    if change != 0.0 {
        h[c] = max(0.0, was + change);
    }
}

// The step's ages taken, and every awake cell drawn again: it dries as the clock goes on.
@compute @workgroup_size(256)
fn settle(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= f.count * 1024u {
        return;
    }
    let m = mine(id.x);
    let c = m.z;
    born[c].x = born[c].y;
    shown(vec2<i32>(m.xy), c);
}
