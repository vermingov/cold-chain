// Blood on a body: what it does once it is on the skin (src/sandbox/runs.ts).
//
// Blood out of a wound, or a drop that lands on someone, sits where it is as a bead, held by the skin, until there is
// enough of it for its weight to tear it loose (on upright skin about a hundredth of a millilitre; on skin lying flat far
// more, and there it spreads into a puddle first). Then it runs downhill over the body as the body lies now, as fast as
// its weight and the slope drive it through its own stickiness, wandering a little as the skin's grain turns it, leaving
// a film behind that uses it up. Blood coming after it finds the wetted path and keeps to it, running faster and losing
// less, so a wound that keeps bleeding draws one rivulet that grows longer and longer; rivulets that meet join, and a
// heavy one splits. Where the skin turns to face the floor (a chin, a nose, an elbow, the fingertips) it gathers into a
// hanging drop that falls when it is heavy enough (about 0.05 ml). It soaks into clothes it reaches, and goes into the
// pool when it reaches the floor.
//
// All of it happens on the person at rest, where the skin never moves: a run is a point on the rest mesh, and "downhill"
// is the world's down turned into the rest frame of the bone it is on. So a man rolled over has his blood start running
// the other way. What it leaves is painted into the skin's film (film.rs); the bead running at its head is drawn here.
// What falls off, soaks in or reaches the floor is handed on as messages (`Drip`, `Soaked`, `Pooled`) for blood.rs and
// soak.rs (port/blood).

use std::collections::HashMap;
use std::sync::Arc;

use bevy::prelude::*;

use crate::npc::{closest_on_triangle, Crossing, Kind, Npc};
use crate::person::Body;
use crate::rng::Rng;
use crate::skin::Skin;

const CELL: f32 = 0.03; // metres: the grid the skin's triangles are filed in, for finding the one under a point
const WETS: f32 = 0.004; // metres: the cells the wetted paths are kept in
const STEP: f32 = 1.0 / 30.0; // seconds between moves of the runs
const MOST: usize = 60; // runs on one person at once
const HOLDS: f32 = 0.012; // ml: the bead upright skin holds before it runs (less is held where it is less steep)
const SPEED: f32 = 0.06; // metres a second a 0.05 ml bead runs straight down dry skin
const LEAVES: f32 = 0.0035; // ml a run leaves on each centimetre of dry skin
const LEAVES_WET: f32 = 0.0004; // and of skin already wet with blood
const POOLS: f32 = 0.0008; // metres: how deep blood lying on flat skin stands
pub const DRIP: f32 = 0.05; // ml: the drop that falls from a chin, a nose, a fingertip (fluid.ts)

// A drop let go from the skin at `at` (world), and blood that reached the floor at `at`, `ml` of it (blood.rs's to
// draw falling and pooled); blood into the clothes at their rest place (soak.rs's).
#[derive(Message, Clone, Copy, Debug)]
pub struct Drip {
    pub at: Vec3,
    pub ml: f32,
}

#[derive(Message, Clone, Copy, Debug)]
pub struct Pooled {
    pub at: Vec3,
    pub ml: f32,
}

#[derive(Message, Clone, Copy, Debug)]
pub struct Soaked {
    pub person: Entity,
    pub rest: Vec3,
    pub ml: f32,
}

#[derive(Clone)]
struct Run {
    rest: Vec3,
    ml: f32,
    hit: Crossing,
    age: f32,
    still: f32,
    moving: bool,
    hang: bool,
    turn: f32,
    spread: f32,
    way: Vec3,
    from: Option<usize>,
}

// The skin and clothes of a body filed by where their triangles are at rest (each in every cell its box touches), and
// which skin triangles meet at each corner. Made once per body.
pub struct Filed {
    skin: HashMap<(i32, i32, i32), Vec<u32>>,
    cloth: HashMap<(i32, i32, i32), Vec<u32>>,
    around: HashMap<u32, Vec<u32>>,
}

fn cell(p: Vec3) -> (i32, i32, i32) {
    ((p.x / CELL).floor() as i32, (p.y / CELL).floor() as i32, (p.z / CELL).floor() as i32)
}

impl Filed {
    fn new(body: &Body) -> Filed {
        let mut f = Filed { skin: HashMap::new(), cloth: HashMap::new(), around: HashMap::new() };
        for part in &body.parts {
            let skin = part.kind == "skin";
            if !skin && part.kind != "cloth" {
                continue;
            }
            for t in (part.index_start..part.index_start + part.index_count).step_by(3) {
                let p = [0, 1, 2].map(|k| body.position[body.index[t + k] as usize]);
                if skin {
                    for k in 0..3 {
                        f.around.entry(body.index[t + k]).or_default().push(t as u32);
                    }
                }
                let (lo, hi) = (cell(p[0].min(p[1]).min(p[2])), cell(p[0].max(p[1]).max(p[2])));
                let grid = if skin { &mut f.skin } else { &mut f.cloth };
                for i in lo.0..=hi.0 {
                    for j in lo.1..=hi.1 {
                        for k in lo.2..=hi.2 {
                            grid.entry((i, j, k)).or_default().push(t as u32);
                        }
                    }
                }
            }
        }
        f
    }
}

// A person's runs.
#[derive(Component, Default)]
pub struct Runs {
    runs: Vec<Run>,
    clock: f32,
    wet: HashMap<i64, f32>,
    filed: Option<Arc<Filed>>,
    // The beads drawn at the runs' heads (entities kept and reused).
    beads: Vec<Entity>,
}

// The nearest of triangles `list` to rest point `p` within `far`: (triangle, weights, distance).
fn best(body: &Body, ball: &[Vec4], list: impl Iterator<Item = u32>, p: Vec3, far: f32) -> Option<(usize, [f32; 3], f32)> {
    let mut near = far;
    let mut out = None;
    for t in list {
        let b = ball[t as usize / 3];
        let reach = near + b.w;
        if p.distance_squared(b.truncate()) > reach * reach {
            continue;
        }
        let t = t as usize;
        let (d, w) = closest_on_triangle(p, body.position[body.index[t] as usize], body.position[body.index[t + 1] as usize], body.position[body.index[t + 2] as usize]);
        if d < near {
            near = d;
            out = Some((t, w, d));
        }
    }
    out
}

impl Runs {
    fn filed(&mut self, body: &Body, cache: &mut HashMap<String, Arc<Filed>>) -> Arc<Filed> {
        self.filed.get_or_insert_with(|| cache.entry(body.name.clone()).or_insert_with(|| Arc::new(Filed::new(body))).clone()).clone()
    }

    // `ml` of blood put on the skin at `hit`. Onto a bead already there, if there is one. Blood from a wound that keeps
    // bleeding (`from`, the bleed) feeds the stream that wound already has running, wherever its head has got to: it
    // comes down the wet track behind it. (Into clothes it soaks: the caller's.)
    pub fn start(&mut self, hit: &Crossing, ml: f32, from: Option<usize>) {
        if ml <= 0.0 {
            return;
        }
        if from.is_some()
            && let Some(head) = self.runs.iter_mut().find(|r| r.from == from)
        {
            head.ml += ml;
            head.still = 0.0;
            return;
        }
        let mut near = None;
        let mut best = 0.004f32 * 0.004;
        for (k, r) in self.runs.iter().enumerate() {
            let d = r.rest.distance_squared(hit.rest);
            if d < best {
                best = d;
                near = Some(k);
            }
        }
        if near.is_none() && self.runs.len() >= MOST {
            near = (0..self.runs.len()).min_by(|&a, &b| self.runs[a].rest.distance_squared(hit.rest).total_cmp(&self.runs[b].rest.distance_squared(hit.rest)));
        }
        if let Some(k) = near {
            self.runs[k].ml += ml;
            self.runs[k].still = 0.0;
            return;
        }
        self.runs.push(Run { rest: hit.rest, ml, hit: hit.clone(), age: 0.0, still: 0.0, moving: false, hang: false, turn: 0.0, spread: 0.0, way: Vec3::ZERO, from });
    }

    fn wet_key(p: Vec3) -> i64 {
        ((p.x / WETS).floor() as i64 + 512) + ((p.y / WETS).floor() as i64 + 512) * 1024 + ((p.z / WETS).floor() as i64 + 512) * 1048576
    }

    // The nearest skin or clothes to a rest-space point, within `far`, as a crossing (runs.ts nearest, by the grid).
    fn nearest(&self, npc: &Npc, rest: Vec3, far: f32) -> Option<Crossing> {
        let f = self.filed.as_ref()?;
        let facts = &npc.hurt.facts;
        let body = npc.body();
        let r = (far / CELL).ceil() as i32 + 1;
        let c = cell(rest);
        let mut found: Option<(usize, [f32; 3], f32, Kind)> = None;
        for (kind, grid) in [(Kind::Cloth, &f.cloth), (Kind::Skin, &f.skin)] {
            let mut list: Vec<u32> = Vec::new();
            for i in -r..=r {
                for j in -r..=r {
                    for k in -r..=r {
                        if let Some(l) = grid.get(&(c.0 + i, c.1 + j, c.2 + k)) {
                            list.extend_from_slice(l);
                        }
                    }
                }
            }
            if let Some((t, w, d)) = best(body, &facts.ball, list.into_iter(), rest, far)
                && found.as_ref().is_none_or(|b| d < b.2 - 0.004)
            {
                found = Some((t, w, d, kind));
            }
        }
        found.map(|(t, w, _, kind)| npc.crossing(t, w, kind))
    }

    // The skin near a place a run is at, found by looking only at the triangles round the one it is on (a run moves
    // millimetres a step); the whole grid only if that finds nothing (a seam in the skin's picture).
    fn step_to(&self, npc: &Npc, hit: &Crossing, p: Vec3) -> Option<Crossing> {
        let f = self.filed.as_ref()?;
        let mut list: Vec<u32> = Vec::with_capacity(24);
        for v in hit.corners {
            if let Some(ts) = f.around.get(&v) {
                for &t in ts {
                    if !list.contains(&t) {
                        list.push(t);
                    }
                }
            }
        }
        if let Some((t, w, _)) = best(npc.body(), &npc.hurt.facts.ball, list.into_iter(), p, 0.004) {
            return Some(npc.crossing(t, w, Kind::Skin));
        }
        self.nearest(npc, p, 0.02)
    }
}

// Some direction along a surface whose normal is `n`.
fn tangent_of(n: Vec3) -> Vec3 {
    let hint = if n.y.abs() < 0.9 { Vec3::Y } else { Vec3::NEG_Z };
    -(hint - n * hint.dot(n)).normalize()
}

pub struct Out<'a> {
    pub drips: &'a mut Vec<Drip>,
    pub pooled: &'a mut Vec<Pooled>,
    pub soaked: &'a mut Vec<(Vec3, f32)>,
}

impl Runs {
    // Every few hundredths of a second: each run is held, or runs on downhill and leaves its trail.
    pub fn update(&mut self, npc: &Npc, skin: &mut Skin, rng: &mut Rng, cache: &mut HashMap<String, Arc<Filed>>, dt: f32, out: &mut Out) {
        self.filed(npc.body(), cache);
        self.clock += dt;
        if self.clock >= STEP && !self.runs.is_empty() {
            let step = self.clock;
            self.clock = 0.0;
            self.step(npc, skin, rng, step, out);
        }
    }

    fn step(&mut self, npc: &Npc, skin: &mut Skin, rng: &mut Rng, step: f32, out: &mut Out) {
        let worlds = npc.bone_worlds();
        let down = |owner: usize| worlds[owner].inverse().transform_vector3(Vec3::NEG_Y).normalize();
        let runs = std::mem::take(&mut self.runs);
        let mut kept: Vec<Run> = Vec::with_capacity(runs.len());
        let pool_r = |ml: f32| ((ml * 1e-6) / (std::f32::consts::PI * POOLS)).sqrt();
        for mut run in runs {
            run.age += step;
            let hit = run.hit.clone();
            let n = hit.rest_normal;
            let m = worlds[hit.owner];
            let g = down(hit.owner);
            let along = g - n * g.dot(n);
            let steep = along.length();
            let at = m.transform_point3(run.rest);
            let facing = m.transform_vector3(n).normalize();
            // At the floor: into the pool there.
            if at.y < 0.02 {
                out.pooled.push(Pooled { at, ml: run.ml });
                continue;
            }
            // Skin facing the floor, or a low point it cannot run on from: it hangs, and falls a drop at a time. Only
            // while that skin still faces down: a body turned over takes the drop round with it, and it runs on from there.
            if run.hang && facing.y > -0.1 {
                run.hang = false;
            }
            if facing.y < -0.85 || run.hang {
                run.hang = true;
                run.moving = false;
                while run.ml >= DRIP {
                    out.drips.push(Drip { at: at + facing * 0.002 + Vec3::new(0.0, -0.003, 0.0), ml: DRIP });
                    run.ml -= DRIP;
                }
                run.still += step;
                if run.still < 90.0 && run.ml > 0.002 {
                    kept.push(run);
                }
                continue;
            }
            let holds = HOLDS / steep.max(0.06);
            if !run.moving {
                if run.ml < holds {
                    // Held: on flat skin it spreads into a puddle as wide as it is deep; then, unfed, it dries where it is.
                    let r = pool_r(run.ml);
                    if r > run.spread * 1.15 && r > 0.0015 {
                        skin.blot(&hit, r, POOLS * 1000.0 * 0.6, rng);
                        run.spread = r;
                    }
                    run.still += step;
                    if run.still < 25.0 {
                        kept.push(run);
                    } else {
                        skin.blot(&hit, r.max(0.0015), 0.25, rng);
                    }
                    continue;
                }
                run.moving = true;
            }
            // Running: downhill, turned a little by the skin's grain, and toward blood already run here.
            let base = if steep > 1e-4 { along / steep } else { tangent_of(n) };
            let side = n.cross(base);
            run.turn += (rng.next() - 0.5) * 0.35 - run.turn * 0.15;
            let probe = |a: f32| *self.wet.get(&Runs::wet_key(run.rest + base * (a.cos() * 0.006) + side * (a.sin() * 0.006))).unwrap_or(&0.0);
            let (left, right, ahead) = (probe(-0.5), probe(0.5), probe(0.0));
            if left.max(right) > (ahead * 1.5).max(0.002) {
                run.turn = run.turn * 0.5 + if left > right { -0.5 } else { 0.5 } * 0.5;
            }
            let way = base * run.turn.cos() + side * run.turn.sin();
            let wet = ahead > 0.002;
            let go = (SPEED * steep * (run.ml / 0.05).powf(2.0 / 3.0).clamp(0.35, 8.0) * if wet { 2.0 } else { 1.0 } * step).min(0.03);
            let next = self.step_to(npc, &hit, run.rest + way * go);
            // Nowhere on from here (a seam in the skin's picture): it gathers here as at a low point.
            let Some(next) = next else {
                if facing.y < -0.1 {
                    run.hang = true;
                    kept.push(run);
                    continue;
                }
                let r = pool_r(run.ml);
                if r > run.spread * 1.15 {
                    skin.blot(&hit, r, POOLS * 1000.0 * 0.6, rng);
                    run.spread = r;
                }
                run.moving = false;
                run.still += step;
                if run.still < 25.0 {
                    kept.push(run);
                }
                continue;
            };
            // Into the clothes; or under them, where the cloth lying on the skin drinks it.
            // shortcut: soak.rs (port/blood) decides whether the cloth is full and lets it run on; until it is ported all
            // of it soaks in, as the TS's did into cloth that was not yet full.
            if next.kind == Kind::Cloth || next.under {
                out.soaked.push((next.rest, run.ml));
                continue;
            }
            // Downhill along the skin leads up again: this is the lowest place. Facing down, it gathers into a drop here;
            // facing up (an eye socket, the hollow of a collarbone), it fills it, and spills over once full.
            if worlds[next.owner].transform_point3(next.rest).y > at.y + 0.0002 {
                if facing.y < -0.1 {
                    run.hang = true;
                    kept.push(run);
                    continue;
                }
                if run.ml < 1.5 {
                    let r = pool_r(run.ml);
                    if r > run.spread * 1.15 {
                        skin.blot(&hit, r, POOLS * 1000.0 * 0.6, rng);
                        run.spread = r;
                    }
                    run.turn = (rng.next() - 0.5) * 2.5;
                    kept.push(run);
                    continue;
                }
            }
            // Under an overhang (the brow, the jaw) a heavy stream lets drops go as it passes.
            if facing.y < -0.3 && run.ml > DRIP * 2.0 {
                out.drips.push(Drip { at: at + facing * 0.002, ml: DRIP });
                run.ml -= DRIP;
            }
            // What it leaves behind, and the streak that is.
            let left2 = run.ml.min(if wet { LEAVES_WET } else { LEAVES } * go * 100.0);
            *self.wet.entry(Runs::wet_key(next.rest)).or_insert(0.0) += left2;
            let bead = 1.6 * (run.ml * 1000.0).cbrt() / 1000.0;
            let wide = (bead * 0.55).clamp(0.0012, 0.008);
            skin.stroke(&hit, &next, wide, ((left2 * 1000.0) / (wide * 1000.0 * (go * 1000.0).max(0.5))).clamp(0.03, 0.4));
            run.ml -= left2;
            run.way = m.transform_vector3(way);
            run.rest = next.rest;
            run.hit = next;
            run.still = 0.0;
            if run.ml < holds * 0.6 {
                run.moving = false;
            }
            // A heavy run splits where the skin lets it go two ways.
            if run.ml > 0.12 && rng.next() < 0.015 * (run.ml / 0.12) && self.runs.len() + kept.len() < MOST {
                let share = run.ml * 0.35;
                run.ml -= share;
                let turn = run.turn + if rng.next() < 0.5 { -0.6 } else { 0.6 };
                kept.push(Run { ml: share, turn, spread: 0.0, ..run.clone() });
            }
            if run.age < 300.0 {
                kept.push(run);
            }
        }
        // Runs that meet join.
        let mut gone = vec![false; kept.len()];
        for i in 0..kept.len() {
            if gone[i] {
                continue;
            }
            for j in i + 1..kept.len() {
                if gone[j] || kept[i].rest.distance_squared(kept[j].rest) > 0.003 * 0.003 {
                    continue;
                }
                kept[i].ml += kept[j].ml;
                kept[i].moving = kept[i].moving || kept[j].moving;
                gone[j] = true;
            }
        }
        self.runs = kept.into_iter().zip(gone).filter(|(_, g)| !g).map(|(r, _)| r).collect();
    }

    // Where each run's head bead is this frame: (at, normal, way, r, h, hang) in the world, for drawing.
    fn heads(&self, npc: &Npc, worlds: &[bevy::math::Affine3A], out: &mut Vec<(Vec3, Vec3, Vec3, f32, f32, f32)>) {
        let _ = npc;
        for run in &self.runs {
            let bead = 1.6 * (run.ml * 1000.0).cbrt() / 1000.0;
            if bead < 0.0012 {
                continue;
            }
            let m = worlds[run.hit.owner];
            let at = m.transform_point3(run.rest);
            let normal = m.transform_vector3(run.hit.rest_normal).normalize();
            let (r, h) = (bead / 2.0, (bead / 4.0).min(0.0014));
            let way = if run.way.length_squared() > 0.1 { run.way } else { normal.cross(Vec3::X) };
            out.push((at, normal, way.normalize_or(Vec3::NEG_Y), r, h, if run.hang { ((run.ml / DRIP) * r * 1.4).min(0.006) } else { 0.0 }));
        }
    }
}

// The beads of blood at the runs' heads, and the drops hanging where one is about to fall (blood.ts bead): a sphere
// squashed onto the skin, `r` across and `h` high, stretched a little along its way, pulled down when it hangs.
#[derive(Resource)]
pub struct Beads {
    mesh: Handle<Mesh>,
    material: Handle<StandardMaterial>,
}

fn make_beads(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut materials: ResMut<Assets<StandardMaterial>>) {
    commands.insert_resource(Beads {
        mesh: meshes.add(Sphere::new(0.5).mesh().uv(8, 6)),
        // Blood in the air and on skin: a deep red that shines (blood.ts).
        material: materials.add(StandardMaterial {
            base_color: Color::linear_rgb(0.075, 0.004, 0.0035),
            perceptual_roughness: 0.08,
            reflectance: 0.35,
            ..default()
        }),
    });
}

pub fn draw_beads(
    mut commands: Commands,
    beads: Res<Beads>,
    mut people: Query<(&crate::person::Person, &Transform, &mut crate::vitals::Vitals, &mut crate::npc::Hurt, &mut Runs)>,
    mut dice: ResMut<crate::vitals::Dice>,
    mut placed: Query<(&mut Transform, &mut Visibility), (With<Bead>, Without<crate::person::Person>)>,
    mut heads: Local<Vec<(Vec3, Vec3, Vec3, f32, f32, f32)>>,
) {
    for (person, root, mut vitals, mut hurt, mut runs) in &mut people {
        heads.clear();
        if !runs.runs.is_empty() {
            let traced = hurt.traced.clone();
            let npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut dice, frame: 0 };
            let worlds = npc.bone_worlds();
            runs.heads(&npc, &worlds, &mut heads);
        }
        while runs.beads.len() < heads.len() {
            let e = commands.spawn((Mesh3d(beads.mesh.clone()), MeshMaterial3d(beads.material.clone()), Transform::default(), Visibility::Hidden, Bead,
                                    bevy::light::NotShadowCaster)).id();
            runs.beads.push(e);
        }
        for (k, &e) in runs.beads.iter().enumerate() {
            let Ok((mut t, mut v)) = placed.get_mut(e) else { continue };
            let Some(&(at, normal, way, r, h, hang)) = heads.get(k) else {
                *v = Visibility::Hidden;
                continue;
            };
            let across = normal.cross(way).normalize();
            let mut centre = at + normal * (h * 0.25);
            let mut out = normal;
            if hang > 0.0 {
                centre.y -= hang * 0.5;
                out = (normal + Vec3::new(0.0, -hang / h.max(1e-4), 0.0)).normalize();
            }
            // (Its own axes: across it, out of the skin, along its way.)
            let y = (out - across * out.dot(across)).normalize_or(normal);
            let z = across.cross(y);
            *t = Transform { translation: centre, rotation: Quat::from_mat3(&Mat3::from_cols(across, y, z)), scale: Vec3::new(r, h + hang, r * 1.3) };
            *v = Visibility::Visible;
        }
    }
}

#[derive(Component)]
pub struct Bead;

pub fn plugin(app: &mut App) {
    app.add_message::<Drip>().add_message::<Pooled>().add_message::<Soaked>().add_systems(Startup, make_beads);
}
