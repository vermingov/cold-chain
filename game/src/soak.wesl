// Blood in one person's clothes worked out on the GPU (soak.rs): the TS's soak.ts `add`, `take` and `_some`, number for
// number, over every cube of cloth at once (the TS worked out at most 1200 a step on the CPU, the rest waiting), and the
// 3D texture the clothes' material reads (cloth.wesl) written from it.
//
// A step is three passes, so that the order the cubes are worked out in does not show (the TS kept what each gave aside
// until its last cube): each cube works out what it gives each of its six neighbours (`flow`); each takes what its
// neighbours give it and loses what it gave (`gather`); the field is written (`encode`).

const WICK: f32 = 1.6;      // how fast cloth pulls blood from fuller to emptier (1/s, at full)
const DRAINS: f32 = 2.5;    // how fast free blood runs down through it (1/s)
const HOLDS: f32 = 0.7;     // of what it can hold, the part held by wicking; past it the blood runs
const OVER: f32 = 1.3;      // how much past full a cloth can be before it drips (blood standing on it)
const RUNS: f32 = 0.4;      // of the blood standing on soaked cloth, the share that runs on to the cube below a step
const DRIES: f32 = 1500.0;  // seconds for soaked cloth to lose two thirds of its wetness
const DRIP: f32 = 0.05;     // ml: a drop (fluid.rs DRIP)
const MOST_DRIPS: u32 = 256u;

// A cube of cloth (soak.rs Grid): which cube of the box it is, how much it holds (ml), the bone it moves with, how
// readily its weave wicks, and its six neighbours (+x, -x, +y, -y, +z, -z; -1 where there is no cloth).
struct Cube {
    cell: u32,
    cap: f32,
    owner: u32,
    weave: f32,
    nb: array<i32, 6>,
}

struct Soak {
    count: u32,
    pairs: u32,
    ops: u32,
    downs_at: u32,
    n: vec3<u32>,
    serial: u32,
    clock: f32,
    step: f32,
    pad: vec2<f32>,
}

// Drops gathered at hems and cuffs this step, for soak.rs to let fall: the step's number, how many, then (cube, ml).
struct Drips {
    serial: u32,
    count: atomic<u32>,
    pad: vec2<u32>,
    items: array<vec2<u32>>,
}

@group(0) @binding(0) var<uniform> u: Soak;
@group(0) @binding(1) var<storage, read> cubes: array<Cube>;
// Every texel of the field and the cube it shows: each cube's own, and the empty texels round the cloth, which show
// what the cloth next to them holds (the shader reads between texels: an empty one beside a soaked one would make the
// stain fade wherever the cloth runs close to a cube's edge).
@group(0) @binding(2) var<storage, read> pairs: array<vec2<u32>>;
// Per cube: the blood in it (ml), when it came (it dries by that), the same as the step leaves it, what has gathered
// to drip.
@group(0) @binding(3) var<storage, read_write> state: array<vec4<f32>>;
// What each cube gives its six neighbours this step, and what it let fall.
@group(0) @binding(4) var<storage, read_write> given: array<f32>;
@group(0) @binding(5) var<storage, read_write> drips: Drips;
// This frame's blood in and out (cube, ml, 0 in or 1 out, 0), then down as each bone lies, in its rest frame, as the
// share of it along each of the six ways (two to a bone).
@group(0) @binding(6) var<storage, read> input: array<vec4<f32>>;
@group(0) @binding(7) var field: texture_storage_3d<rgba8unorm, write>;

fn down(b: u32, k: i32) -> f32 {
    let v = input[u.downs_at + b * 2u + u32(k / 4)];
    return v[k % 4];
}

@compute @workgroup_size(1)
fn apply() {
    for (var i = 0u; i < u.ops; i++) {
        let op = input[i];
        let c = u32(op.x);
        var s = state[c];
        if op.z == 0.0 {
            // What was dry, or mostly fresh blood now, counts as freshly wet.
            if s.x < op.y * 3.0 {
                s.y = u.clock;
                s.z = u.clock;
            }
            s.x += op.y;
        } else {
            s.x -= min(op.y, s.x * 0.5);
        }
        state[c] = s;
    }
    if u.step > 0.0 {
        drips.serial = u.serial;
        atomicStore(&drips.count, 0u);
    }
}

@compute @workgroup_size(256)
fn flow(@builtin(global_invocation_id) id: vec3<u32>) {
    let c = id.x;
    if c >= u.count {
        return;
    }
    let cube = cubes[c];
    var have = state[c].x;
    var spill = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    var out = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    var fell = 0.0;
    if have >= 1e-7 {
        let hold = cube.cap;
        let b = cube.owner;
        // Blood standing on cloth that cannot take any more runs over it: downhill over the cloth below however full that
        // is (it runs on from there, as fast as a film of it runs: RUNS), and to the side or up only into cloth less full
        // than this, no more than a twelfth of the difference (else two soaked cubes spill into each other back and
        // forth); with nowhere left to go (a hem, a cuff), it gathers into drops.
        var spilt = 0.0;
        if have > OVER * hold {
            let spare = have - OVER * hold;
            let fc = have / hold;
            var sum = 0.0;
            for (var k = 0; k < 6; k++) {
                let j = cube.nb[k];
                let dk = down(b, k);
                var s = 0.0;
                if j >= 0 {
                    if dk > 0.2 {
                        s = dk + 0.35;
                    } else if state[j].x < fc * cubes[j].cap {
                        s = max(0.03, dk + 0.35);
                    }
                }
                spill[k] = s;
                sum += s;
            }
            if sum > 0.0 {
                for (var k = 0; k < 6; k++) {
                    if spill[k] == 0.0 {
                        continue;
                    }
                    let j = cube.nb[k];
                    let cj = cubes[j].cap;
                    let share = spare * spill[k] / sum;
                    if down(b, k) > 0.2 {
                        spill[k] = share * RUNS;
                    } else {
                        spill[k] = min(share, (fc * cj - state[j].x) * min(hold, cj) / (12.0 * cj));
                    }
                    spilt += spill[k];
                }
            } else {
                var gathered = state[c].w + spare;
                if gathered >= DRIP {
                    let at = atomicAdd(&drips.count, 1u);
                    if at < MOST_DRIPS {
                        drips.items[at] = vec2(c, bitcast<u32>(gathered));
                    }
                    gathered = 0.0;
                }
                state[c].w = gathered;
                spilt = spare;
                fell = spare;
            }
            have -= spilt;
        }
        let full = have / hold;
        var total = 0.0;
        // Cloth barely damp hardly wicks at all (the square of its fullness): not worth working out.
        if full >= 0.02 {
            for (var k = 0; k < 6; k++) {
                let j = cube.nb[k];
                if j < 0 {
                    continue;
                }
                let cj = cubes[j].cap;
                let fj = state[j].x / cj;
                var q = 0.0;
                // Wicking: from fuller to emptier, readily where both are wet, hardly at all into dry fibre from a damp
                // one (so the edge of a stain is sharp). At most a twelfth of the difference a step to each of the six
                // neighbours: more, and soaked cubes passed blood back and forth for ever and never settled.
                if full > fj {
                    let m = (full + fj) * 0.5;
                    q = min(1.0 / 12.0, WICK * m * m * cubes[j].weave * u.step) * (full - fj) * min(hold, cj);
                }
                // Free blood past what wicking holds runs down.
                let dk = down(b, k);
                if dk > 0.2 && full > HOLDS && fj < OVER {
                    q += min(DRAINS * (full - HOLDS) * dk * hold * u.step, (OVER - fj) * cj * 0.5);
                }
                out[k] = q;
                total += q;
            }
        }
        let scale = select(1.0, have * 0.45 / total, total > have * 0.45);
        for (var k = 0; k < 6; k++) {
            out[k] = out[k] * scale + spill[k];
        }
    }
    for (var k = 0; k < 6; k++) {
        given[c * 8u + u32(k)] = out[k];
    }
    given[c * 8u + 6u] = fell;
}

@compute @workgroup_size(256)
fn gather(@builtin(global_invocation_id) id: vec3<u32>) {
    let c = id.x;
    if c >= u.count {
        return;
    }
    let cube = cubes[c];
    let was = state[c].x;
    var change = 0.0;
    for (var k = 0u; k < 7u; k++) {
        change -= given[c * 8u + k];
    }
    var b = state[c].y;
    for (var k = 0; k < 6; k++) {
        let j = cube.nb[k];
        if j < 0 {
            continue;
        }
        // (What the neighbour gives this way is its give the other way round.)
        let m = given[u32(j) * 8u + u32(k ^ 1)];
        if m > 0.0 {
            change += m;
            if was < m * 3.0 {
                b = state[j].y;
            }
        }
    }
    state[c].z = b;
    state[c].x = max(0.0, was + change);
}

// The field as the clothes' material reads it: red how full the cloth is (as a square root, so a faint stain still has
// steps), green how wet it still is.
@compute @workgroup_size(256)
fn encode(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= u.pairs {
        return;
    }
    let p = pairs[id.x];
    let i = p.y;
    // (Each its own component: a cube's own texel takes the step's age while the texels round it read it.)
    let ml = state[i].x;
    let born = state[i].z;
    let cap = cubes[i].cap;
    if p.x == cubes[i].cell {
        state[i].y = born;
    }
    // (Cloth no blood has ever reached is as the field began: nothing to write.)
    if ml <= 0.0 && born == 0.0 {
        return;
    }
    let full = min(OVER, ml / cap);
    let wet = select(0.0, exp(-(u.clock - born) / DRIES), ml > 0.0);
    let at = vec3(p.x % u.n.x, (p.x / u.n.x) % u.n.y, p.x / (u.n.x * u.n.y));
    textureStore(field, at, vec4(sqrt(full / OVER), wet, 0.0, 1.0));
}
