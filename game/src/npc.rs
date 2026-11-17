// One person in the sandbox, as the hurt see them (src/sandbox/npc.ts): what a line through them meets, the wounds
// made in them, the voice, and their insides' clock.
//
// The TS's Npc was one object that owned everything a person is. Here a person is the entity person.rs makes; what
// medicine keeps of them is `Hurt` (bones, teeth, throat, eyes, bruising, dressings, the voice) beside their `Vitals`,
// and every question and every injury goes through `Npc`, a borrow of the lot for the length of one shot, blow or
// frame. What the hurt does to things phase 2 and 3 own (the ragdoll's joints, the blood thrown, the marks on the skin,
// the sounds) is put in `Hurt::happened` for them to take (`Happened`); this module does not reach into them.

use std::collections::HashSet;
use std::sync::Arc;

use bevy::diagnostic::FrameCount;
use bevy::math::Affine3A;
use bevy::prelude::*;

use crate::anatomy::{triangle, Anatomy, Traced};
use crate::bones::Bones;
use crate::bruise::Bruise;
use crate::dressing::Dressing;
use crate::eyes::Eyes;
use crate::person::{Body, Person};
use crate::ragdoll::Shape;
use crate::teeth::Teeth;
use crate::throat::Throat;
use crate::vitals::{Dice, Vitals};

const BACK: f32 = 45.0; // mmHg: what the tissue round an open artery holds back of the pressure behind it
const RHO: f32 = 1060.0; // kg/m3, blood (fluid.ts)
// The voice (`speak`): seconds within which a new hurt is part of the cry the last one started, and seconds since the last
// new hurt at which the chance of a groan or a sob at each of the TS's moments has fallen to half.
const OUTBURST: f32 = 1.4;
const HABIT: f32 = 20.0;

// What a crossing of the body is of.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Skin,
    Cloth,
    Eye,
    Tongue,
}

// A place on the body where a line crosses its surface (surface()), or a place found on it at rest (crossing()): how
// far along the line, what it is, where it is now and which way it faces there, where it is in the skin's picture,
// where it is on the body at rest and which way the skin faces there, the bone that carries it, UV units to a metre of
// skin there, and the triangle's corners and how much of each. `cloth` is the clothes over it (a wound's blood soaks
// into them), `open` a hole a dressing can go on (dressing.rs), `under` skin under the clothes.
#[derive(Clone, Debug)]
pub struct Crossing {
    pub t: f32,
    pub kind: Kind,
    pub point: Vec3,
    pub normal: Vec3,
    pub uv: Vec2,
    pub rest: Vec3,
    pub rest_normal: Vec3,
    pub owner: usize,
    pub scale: f32,
    pub corners: [u32; 3],
    pub shares: [f32; 3],
    pub cloth: Option<Box<Crossing>>,
    pub open: bool,
    pub under: bool,
}

// What a wound is to the marks drawn on the skin (marks.rs, phase 3).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Way {
    In,
    Out,
}

// A change to a joint of the ragdoll (ragdoll.rs and behaviour.rs, phase 2): its range set (radians: hinge, twist,
// side), opened further on some axes, held where it is now give or take `by`, held out of its socket at `at` (radians,
// as the pose controls count them: the ragdoll turns them by its joint's signs) give or take `by`, the two halves of a
// broken shaft let slide, or the joint gone limp (nothing the muscles can hold it with: the TS's `seg.broken`).
#[derive(Clone, Debug)]
pub enum Joint {
    Range { lo: [f32; 3], hi: [f32; 3] },
    Widen { axes: Vec<usize>, by: f32 },
    Hold { by: f32 },
    Out { at: [f32; 3], by: f32 },
    Shorten(f32),
    Limp,
}

// What hurt did that someone else draws, plays or moves. Each with what the TS called, for the job that ports it.
#[derive(Clone, Debug)]
pub enum Happened {
    // npc.hit: a push of `impulse` N s at `point`; `jolt` how much a standing person flinches (behaviour.hit).
    Hit { point: Vec3, impulse: Vec3, jolt: f32 },
    // world.sound.shot: a take of `name` at `at` (None: the person's head).
    Sound { name: String, at: Option<Vec3>, gain: f32 },
    // npc.say: one of their cries (`kind`-`voice`), from the mouth; Cut: the one playing cut off.
    Say { kind: &'static str, gain: f32 },
    Cut,
    // npc.wound: marks.entry / marks.exit on skin, a hole in the clothes (with the skin under shown through it).
    Wound { hit: Crossing, way: Way, size: f32 },
    // marks.hole: the way in opened in the flesh, `open` a hole to see into, `ring` the scraped ring round a slow bullet.
    Hole { hit: Crossing, size: f32, open: bool, ring: bool },
    // wounds.ts slit: a blade's slit in the skin between `ends`, gaping `gape` m at its middle; the clothes over it slit.
    Stab { ends: [Crossing; 2], gape: f32, double: bool, cloths: Vec<Crossing> },
    // wounds.ts tear: a bullet's way out torn in `arms` splits (each its line on the skin at rest and its half length and
    // width), the lips turned out `lip` m with `fat` m of fat showing.
    Tear { hit: Crossing, arms: Vec<(Vec3, [f32; 2])>, lip: f32, fat: f32 },
    // npc.welling: a little blood in and round a fresh wound at once.
    Welling { hit: Crossing, ml: f32 },
    // npc.spatter: blood thrown out of the way in and the way out (gunshot-blood.md sec. 1).
    Spatter { enter: Crossing, dir: Vec3, exit: Option<Vec3>, energy: f32, exited: bool, range: f32 },
    // runs.start: `ml` put on the skin at `hit`, which runs (or soaks into clothes); `from` the bleed feeding it.
    Runs { hit: Crossing, ml: f32, from: Option<usize> },
    // soak.add: into the clothes at their rest place.
    Soak { rest: Vec3, ml: f32 },
    // blood.spray and blood.stream (blood.rs, phase 3).
    Spray { at: Vec3, dir: Vec3, speed: f32, ml: f32, spread: f32, size: f32 },
    Stream { bleed: Option<usize>, at: Vec3, dir: Vec3, speed: f32, ml: f32, r: f32 },
    // film.blot: blood laid on the skin round `hit`.
    Blot { hit: Crossing, r: f32, wet: f32 },
    // A joint of the ragdoll changed (bones.rs), and npc.broke: a shaft let go at its mid joint (world.onBroke).
    Joint { segment: String, change: Joint },
    Broke { segment: String },
    // A break to draw (bones.rs `_draw`, shards.rs), and a broken end out through the skin (`_through`), by its index.
    Drawn { break_index: usize, calibre: f32 },
    // Through: the near half's end swung out by `turn` about `pivot`, then moved `shift` (rest space), its last `piece` m.
    Through { break_index: usize, pivot: Vec3, turn: Quat, shift: Vec3, piece: f32 },
    // A tooth given way (teeth.rs: its stump and the piece that falls, thrown with the TS's seven throws a piece).
    Tooth { tooth: usize, how: &'static str, dir: Vec3, pieces: u32, throws: Vec<f32> },
    // dismember.ts edge / charge, viscera.ts bled / blown: what mesh cutting does with a wound (phase 3).
    Edge { energy: f32, at: Vec3, dir: Vec3 },
    Charge { energy: f32, at: Vec3, dir: Vec3, hit: Crossing, calibre: f32 },
    Bled { part: String, at: Vec3, channel: f32 },
    // The tongue torn through (throat.rs's card on it).
    Tongue { hit: Crossing, size: f32 },
    // marks.ts cut: a blade drawn through the skin from `a` to `b`, `deep` m into it, opening `gapes` of its full gape
    // (npc.slash's stretches, and skin split by a blow: marks.rs).
    Slit { a: Crossing, b: Crossing, deep: f32, gapes: f32 },
}

// When a person last cried out and how much it hurt then (npc.ts `_said`); since when it has hurt as it does (the clock
// of the last new hurt), when the last cry at a new hurt began and how big that hurt was; and the voice's own dice.
pub struct Said {
    pub until: f32,
    pub pain: f32,
    pub next: f32,
    pub awake: bool,
    pub hurt_at: f32,
    pub cried: f32,
    pub peak: f32,
    pub dice: crate::rng::Rng,
}

// Per body: what the TS read off the body's file once (its age; the skin and clothes filed for finding the one nearest
// a point, runs.ts fileOf).
pub struct Facts {
    // MakeHuman's age slider, 0.5 at 25 years.
    pub age: f32,
    // Every skin and cloth triangle (offset into the index) and the ball round it, and which are skin under clothes.
    pub skin: Vec<u32>,
    pub cloth: Vec<u32>,
    pub ball: Vec<Vec4>,
    pub under: Vec<bool>,
}

impl Facts {
    fn new(body: &Body) -> Facts {
        let (_, header, _) = crate::person::read_file(&format!("people/{}.bin", body.name), b"CCPF");
        let age = header["spec"]["age"].as_f64().unwrap_or(0.5) as f32;
        let n = body.index.len() / 3;
        let mut f = Facts { age, skin: Vec::new(), cloth: Vec::new(), ball: vec![Vec4::ZERO; n], under: vec![false; n] };
        for part in &body.parts {
            let skin = part.kind == "skin";
            if !skin && part.kind != "cloth" {
                continue;
            }
            for t in (part.index_start..part.index_start + part.index_count).step_by(3) {
                let p = [0, 1, 2].map(|k| body.position[body.index[t + k] as usize]);
                let c = (p[0] + p[1] + p[2]) / 3.0;
                let r = p.iter().map(|q| q.distance(c)).fold(0.0, f32::max);
                f.ball[t / 3] = c.extend(r);
                f.under[t / 3] = part.under;
                if skin { f.skin.push(t as u32) } else { f.cloth.push(t as u32) }
            }
        }
        f
    }
}

// The body skinned as it stands this frame, in the world, and the boxes round runs of its triangles (npc.ts `_skin`,
// `_boxes`, `_partBox`).
pub struct Skinned {
    pub at: Vec<Vec3>,
    boxes: Vec<[f32; 6]>,
    groups: Vec<[f32; 6]>,
    parts: Vec<[f32; 6]>,
}

// A joint of the ragdoll as it is now: its hinge's axis in the world, its three angles from its neutral (hinge, twist,
// side) and its range, radians (ragdoll.rs `angles`, `lo`, `hi`).
#[derive(Clone, Copy, Default)]
pub struct Bend {
    pub hinge: Vec3,
    pub angles: [f32; 3],
    pub lo: [f32; 3],
    pub hi: [f32; 3],
}

// `f` of each of 0..n, on this thread and on whichever compute threads are free, each taking the next not yet taken, in
// no order (the index comes back with each). Bevy's own scope has the thread that waits on it run other systems' tasks
// meanwhile (its global executor): a grenade's frame was held up by a material's specialisation that way. Here the
// waiting thread does only this work, and the pool's threads join in as they come free.
pub fn spread<R: Send + 'static>(n: usize, f: impl Fn(usize) -> R + Sync) -> Vec<(usize, R)> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let pool = bevy::tasks::ComputeTaskPool::get_or_init(bevy::tasks::TaskPool::default);
    let next = AtomicUsize::new(0);
    let work = || {
        let mut out = Vec::new();
        loop {
            let k = next.fetch_add(1, Ordering::Relaxed);
            if k >= n {
                return out;
            }
            out.push((k, f(k)));
        }
    };
    let work = &work;
    pool.scope_with_executor(false, None, |s| {
        for _ in 0..pool.thread_num().min(n.saturating_sub(1)) {
            s.spawn(async move { work() });
        }
        s.spawn_on_scope(async move { work() });
    })
    .into_iter()
    .flatten()
    .collect()
}

const RUN: usize = 96; // indices: 32 triangles, which lie together in the mesh (MakeHuman's faces are in order over the body)
const GROUP: usize = 8; // runs: a short line (sixty round each exit, wounds.ts tear) crosses few of them

#[derive(Component)]
pub struct Hurt {
    pub traced: Arc<Traced>,
    pub facts: Arc<Facts>,
    pub bones: Bones,
    pub teeth: Teeth,
    pub throat: Throat,
    pub eyes: Eyes,
    pub bruise: Bruise,
    pub dressings: Vec<Dressing>,
    pub said: Said,
    pub crying: bool,
    // Off their feet for good: a leg that will not carry them (behaviour.rs reads it).
    pub leg_gone: bool,
    // Off their feet, the muscles the behaviour's (the ragdoll's `limp`, behaviour.rs writes it every frame).
    pub down: bool,
    // Each vessel's pieces already cut (anatomy.ts's tube.cut, this person's own), and the parts shown hurt in the x-ray.
    pub cut: HashSet<(usize, usize)>,
    pub hurt: Vec<String>,
    pub happened: Vec<Happened>,
    // This person's clock, for the voice (the TS used the page's clock).
    pub clock: f32,
    // Seconds since they were made (bones.ts counts the settling into their stance from it).
    pub age: f32,
    // Where each ragdoll segment is now, in the person.segments' order: behaviour.rs writes its rigid bodies' transforms
    // here after every physics step; while it is None (no ragdoll yet) each is worked out from the pose (segment_world).
    pub segments: Option<Vec<Transform>>,
    // Each segment's joint to its parent as it is now, written beside `segments` (bones.rs `at_joint` reads them).
    pub bends: Option<Vec<Bend>>,
    skinned: Option<(u32, Arc<Skinned>)>,
    // The body's corners' bones and weights as this person's own body has them, once a limb is cut off (dismember.rs:
    // what the body keeps is carried by the bone the limb hung from); None, the file's.
    pub weights: Option<Arc<(Vec<[u16; 4]>, Vec<[u8; 4]>)>>,
    // The body held still for a burst of questions (`Npc::hold`, a grenade's fragments): the bones in the world worked
    // out once, and what trace asks of them, until `let_go`.
    held: Option<Arc<Held>>,
}

// Each bone's matrix from rest to the world now and back, and each vessel's points in the world, as bone_worlds and
// trace would work them out: the same numbers, worked out once while nothing can move the body.
pub struct Held {
    pub worlds: Vec<Affine3A>,
    pub inverse: Vec<Affine3A>,
    pub tubes: Vec<Vec<Vec3>>,
}

// One person's body and medical state, borrowed for one shot, blow or frame.
pub struct Npc<'a> {
    pub person: &'a Person,
    pub root: Transform,
    pub vitals: &'a mut Vitals,
    pub hurt: &'a mut Hurt,
    pub traced: Arc<Traced>,
    pub dice: &'a mut Dice,
    pub frame: u32,
}

// A person's skin and clothes as a line through them meets them, borrowed only to read: their body and whose corners are
// carried by which bones now. Npc::surface asks it; so do many lines at once on the compute threads (a grenade's
// fragments), while nobody's medicine is borrowed.
pub struct Look<'a> {
    pub body: &'a Body,
    pub weights: Option<&'a (Vec<[u16; 4]>, Vec<[u8; 4]>)>,
}

impl Look<'_> {
    // The skin and clothes crossed by the line from `origin` along unit `dir`, nearer than `far`, in order. With `eyes`,
    // the eyeballs too (Kind::Eye): a line through the open lids meets the eye before the socket's skin behind it
    // (eyes.rs); and the tongue, as a wound in it is drawn on it (throat.rs).
    pub fn surface(&self, sk: &Skinned, origin: Vec3, dir: Vec3, far: f32, eyes: bool) -> Vec<Crossing> {
        let body = self.body;
        let index = &body.index;
        let mut hits: Vec<(f32, usize, Kind)> = Vec::new();
        for (pi, p) in body.parts.iter().enumerate() {
            // (The skin under the clothes is not drawn but is still where the body begins.)
            let kind = match p.kind.as_str() {
                "skin" => Kind::Skin,
                "cloth" => Kind::Cloth,
                "eyes" if eyes => Kind::Eye,
                "tongue" if eyes => Kind::Tongue,
                _ => continue,
            };
            if !slab_for(&sk.parts[pi], origin, dir, far) {
                continue;
            }
            let end = p.index_start + p.index_count;
            let mut start = p.index_start;
            while start < end {
                // Only the runs of triangles whose box the line crosses: the same crossings as trying every triangle. A
                // GROUP of runs at a time first, past the whole group if its box is not crossed.
                let run = start / RUN;
                let group = run / GROUP;
                if (run % GROUP == 0 || start == p.index_start) && !box_crossed(&sk.groups[group], origin, dir, far) {
                    start = end.min((group + 1) * GROUP * RUN);
                    continue;
                }
                let next = end.min((run + 1) * RUN);
                if box_crossed(&sk.boxes[run], origin, dir, far) {
                    for i in (start..next).step_by(3) {
                        let t = triangle(origin, dir, &sk.at, index, i);
                        // (The clear cornea over each eye is a shell painted see-through, its corners all on the sheet's
                        // empty corner: the eye is the white and the iris under it. The picture's v is turned over here.)
                        let uv = body.uv[index[i] as usize];
                        if kind == Kind::Eye && uv.x > 0.87 && 1.0 - uv.y < 0.13 {
                            continue;
                        }
                        if t > 0.0 && t < far {
                            hits.push((t, i, kind));
                        }
                    }
                }
                start = next;
            }
        }
        hits.sort_by(|a, b| a.0.total_cmp(&b.0));
        // Two crossings closer than a millimetre are the same seam met twice.
        let mut out: Vec<Crossing> = Vec::new();
        for (t, i, kind) in hits {
            if out.last().is_some_and(|l| l.kind == kind && t - l.t < 0.001) {
                continue;
            }
            out.push(self.describe(t, i, kind, origin, dir, &sk.at));
        }
        out
    }

    fn describe(&self, t: f32, i: usize, kind: Kind, origin: Vec3, dir: Vec3, skinned: &[Vec3]) -> Crossing {
        let body = self.body;
        let [a, b, c] = [0, 1, 2].map(|k| body.index[i + k]);
        let point = origin + dir * t;
        let (pa, pb, pc) = (skinned[a as usize], skinned[b as usize], skinned[c as usize]);
        let mut normal = (pb - pa).cross(pc - pa).normalize();
        if normal.dot(dir) > 0.0 {
            normal = -normal;
        }
        // Where on the triangle, by area: the same place on the triangle at rest, and in the skin's picture.
        let w = barycentric(point, pa, pb, pc);
        let r = [a, b, c].map(|v| body.position[v as usize]);
        let rest = r[0] * w[0] + r[1] * w[1] + r[2] * w[2];
        let u = [a, b, c].map(|v| body.uv[v as usize]);
        let uv = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
        // UV units to a metre of skin here, for painting things their real size.
        let area3 = (r[1] - r[0]).cross(r[2] - r[0]).length();
        let area_uv = ((u[1].x - u[0].x) * (u[2].y - u[0].y) - (u[2].x - u[0].x) * (u[1].y - u[0].y)).abs();
        // Which way the skin faces there at rest: the mesh's own normals, which point out (the triangle's winding need
        // not).
        let n = [a, b, c].map(|v| body.normal[v as usize]);
        let owner = self.owner_of(a);
        let rest_normal = self.outward((n[0] * w[0] + n[1] * w[1] + n[2] * w[2]).normalize(), rest, owner);
        Crossing {
            t, kind, point, normal, uv, rest, rest_normal, owner, scale: (area_uv / area3.max(1e-10)).sqrt(), corners: [a, b, c], shares: w,
            cloth: None, open: false, under: false,
        }
    }

    // A normal at a place on the body turned, if it has to be, to point out of the body: away from the bone it hangs on.
    // (The mesh's own normals are mostly right; the skin kept under the clothes has some that point in, and a wound dug
    // along one grows out through the shirt.)
    pub fn outward(&self, n: Vec3, rest: Vec3, owner: usize) -> Vec3 {
        let bone = &self.body.bones[owner];
        let ab = bone.tail - bone.head;
        let t = ((rest - bone.head).dot(ab) / ab.length_squared().max(1e-9)).clamp(0.0, 1.0);
        if n.dot(rest - (bone.head + ab * t)) < 0.0 { -n } else { n }
    }

    // The bone that carries most of corner `v`.
    // (A corner the body kept round a limb cut off goes with the bone the limb hung from: dismember.ts owners.)
    pub fn owner_of(&self, v: u32) -> usize {
        let body = self.body;
        let (joints, weights) = self.weights.map_or((&body.joints, &body.weights), |w| (&w.0, &w.1));
        let (mut best, mut bone) = (0u8, 0u16);
        for k in 0..4 {
            if weights[v as usize][k] > best {
                best = weights[v as usize][k];
                bone = joints[v as usize][k];
            }
        }
        bone as usize
    }
}

impl<'a> Npc<'a> {
    pub fn body(&self) -> &Body {
        &self.person.body
    }

    pub fn bone_index(&self, name: &str) -> usize {
        self.person.body.by_name[name]
    }

    // Each bone's matrix from the body at rest to the world now: as posed (person.rs `posed`, which the ragdoll's drive()
    // writes from its bodies every frame). Everything medical asks it.
    pub fn bone_worlds(&self) -> Vec<Affine3A> {
        if let Some(h) = &self.hurt.held {
            return h.worlds.clone();
        }
        let p = self.person;
        let pelvis = p.body.bone("root").head;
        let base = self.root.compute_affine()
            * Affine3A::from_rotation_translation(p.posed.frame.rotation, p.posed.frame.translation)
            * Affine3A::from_translation(-pelvis);
        p.absolute(&p.posed.local)
            .iter()
            .zip(&p.body.bones)
            .map(|(&(r, at), b)| base * Affine3A::from_rotation_translation(r, at) * Affine3A::from_translation(-b.head))
            .collect()
    }

    pub fn rest_to_world(&self, bone: usize) -> Affine3A {
        match &self.hurt.held {
            Some(h) => h.worlds[bone],
            None => self.bone_worlds()[bone],
        }
    }

    // Hold the body where it is for a burst of questions about it (a grenade's fragments, some two hundred lines through
    // the same four people in one system's run): every bone's place, its inverse and the vessels' points are worked out
    // once instead of for each line. Only while nothing can move the body (its pose, root and placed bones are borrowed
    // unchanged for the length of the system): `let_go` before anything else asks.
    pub fn hold(&mut self) {
        self.hurt.held = None;
        let worlds = self.bone_worlds();
        let inverse = worlds.iter().map(|m| m.inverse()).collect();
        let tubes = self.traced.tubes.iter().map(|t| t.points.iter().map(|&(p, _, b)| worlds[b].transform_point3(p)).collect()).collect();
        self.hurt.held = Some(Arc::new(Held { worlds, inverse, tubes }));
    }

    pub fn let_go(&mut self) {
        self.hurt.held = None;
    }

    pub fn held(&self) -> Option<Arc<Held>> {
        self.hurt.held.clone()
    }

    // Where a point of the body at rest (on bone `owner`) is in the world now, and a direction there.
    pub fn world_of(&self, rest: Vec3, owner: usize, normal: Option<Vec3>) -> (Vec3, Option<Vec3>) {
        let m = self.rest_to_world(owner);
        (m.transform_point3(rest), normal.map(|n| m.transform_vector3(n).normalize()))
    }

    // A segment of the ragdoll in the world now: its bone's head and turn (its rigid body's, from `Hurt::segments`; before
    // there is a ragdoll, ragdoll.rs `segments`'s `rest` posed now).
    pub fn segment_world(&self, k: usize) -> Transform {
        if let Some(segments) = &self.hurt.segments {
            return segments[k];
        }
        let p = self.person;
        let s = &p.segments[k];
        let abs = p.absolute(&p.posed.local);
        let pelvis = p.body.bone("root").head;
        let (r, at) = abs[s.bone];
        let in_root = Transform::from_translation(p.posed.frame.translation + p.posed.frame.rotation * (at - pelvis))
            .with_rotation(p.posed.frame.rotation * r);
        self.root.mul_transform(in_root)
    }

    pub fn segment(&self, name: &str) -> Option<usize> {
        self.person.segments.iter().position(|s| s.name == name)
    }

    // The segment whose shape is nearest a world point, and how far it is. (By the shapes themselves: measured from each
    // segment's bone line, a shot to the face went to the chest, whose line runs up to the neck, and not to the head,
    // whose bone is the neck's.)
    pub fn nearest(&self, at: Vec3) -> (Option<usize>, f32) {
        let mut best = None;
        let mut d = f32::INFINITY;
        for k in 0..self.person.segments.len() {
            let dist = self.outside(k, at);
            if dist < d {
                d = dist;
                best = Some(k);
            }
        }
        (best, d)
    }

    pub fn nearest_name(&self, at: Vec3) -> Option<&str> {
        self.nearest(at).0.map(|k| self.person.segments[k].name.as_str())
    }

    // How far a world point lies outside a segment's shape (less than nothing inside it).
    pub fn outside(&self, k: usize, at: Vec3) -> f32 {
        let node = self.segment_world(k);
        let p = node.rotation.inverse() * (at - node.translation);
        match &self.person.segments[k].shape {
            Shape::Ball { centre, r } => p.distance(*centre) - r,
            Shape::Capsule { a, b, r } => {
                let ab = *b - *a;
                let t = ((p - *a).dot(ab) / ab.length_squared().max(1e-9)).clamp(0.0, 1.0);
                p.distance(*a + ab * t) - r
            }
            Shape::Cuboid { centre, half, rotation } => {
                let q = (rotation.inverse() * (p - *centre)).abs() - *half;
                q.max(Vec3::ZERO).length() + q.x.max(q.y).max(q.z).min(0.0)
            }
        }
    }

    // Whether a world point is on the person's left (their pelvis's -X: the person's left is -X in Bevy as in the TS).
    pub fn left_of(&self, point: Vec3) -> bool {
        let pelvis = self.segment_world(0);
        (point - pelvis.translation).dot(pelvis.rotation * Vec3::X) < 0.0
    }

    // --- what a line through them meets --------------------------------------------------------------------------

    // The skinned corners in the world, once a frame however many shots ask.
    pub fn skinned(&mut self) -> Arc<Skinned> {
        if let Some((at, s)) = &self.hurt.skinned {
            if *at == self.frame {
                return s.clone();
            }
        }
        let body = &self.person.body;
        let mats = self.bone_worlds();
        let own = self.hurt.weights.clone();
        let (joints, weights) = own.as_ref().map_or((&body.joints, &body.weights), |w| (&w.0, &w.1));
        // (Some fifty thousand corners, each on its own: spread over the compute threads, a few milliseconds a person
        // when a blast first asks for everyone at once.)
        const CHUNK: usize = 4096;
        let mut chunks = spread(body.position.len().div_ceil(CHUNK), |c| {
            let start = c * CHUNK;
            let end = (start + CHUNK).min(body.position.len());
            (start..end)
                .map(|v| {
                    let (p, j, w) = (body.position[v], joints[v], weights[v]);
                    let mut out = Vec3::ZERO;
                    for k in 0..4 {
                        if w[k] > 0 {
                            out += mats[j[k] as usize].transform_point3(p) * (w[k] as f32 / 255.0);
                        }
                    }
                    out
                })
                .collect::<Vec<Vec3>>()
        });
        chunks.sort_by_key(|c| c.0);
        let mut at = Vec::with_capacity(body.position.len());
        for (_, c) in chunks {
            at.extend(c);
        }
        // The box round each run of RUN / 3 triangles, and round each GROUP of runs.
        let index = &body.index;
        let runs = index.len().div_ceil(RUN);
        let empty = [f32::INFINITY, f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY];
        let grow = |b: &mut [f32; 6], p: Vec3| {
            for k in 0..3 {
                b[k] = b[k].min(p[k]);
                b[k + 3] = b[k + 3].max(p[k]);
            }
        };
        let mut boxes = vec![empty; runs];
        for (r, b) in boxes.iter_mut().enumerate() {
            for &v in &index[r * RUN..((r + 1) * RUN).min(index.len())] {
                grow(b, at[v as usize]);
            }
        }
        let mut groups = vec![empty; runs.div_ceil(GROUP)];
        for (r, b) in boxes.iter().enumerate() {
            let g = &mut groups[r / GROUP];
            for k in 0..3 {
                g[k] = g[k].min(b[k]);
                g[k + 3] = g[k + 3].max(b[k + 3]);
            }
        }
        // The box round each part's skinned corners (every seventh: near enough, with slab_for's margin).
        let parts = body
            .parts
            .iter()
            .map(|p| {
                let mut b = empty;
                for v in (p.vertex_start..p.vertex_start + p.vertex_count).step_by(7) {
                    grow(&mut b, at[v]);
                }
                b
            })
            .collect();
        let s = Arc::new(Skinned { at, boxes, groups, parts });
        self.hurt.skinned = Some((self.frame, s.clone()));
        s
    }

    // The skin and clothes crossed by the line from `origin` along unit `dir`, nearer than `far`, in order (Look's).
    pub fn surface(&mut self, origin: Vec3, dir: Vec3, far: f32, eyes: bool) -> Vec<Crossing> {
        let sk = self.skinned();
        self.look().surface(&sk, origin, dir, far, eyes)
    }

    // The body as a line through it sees it, borrowed only to read.
    pub fn look(&self) -> Look<'_> {
        Look { body: &self.person.body, weights: self.hurt.weights.as_deref() }
    }

    pub fn outward(&self, n: Vec3, rest: Vec3, owner: usize) -> Vec3 {
        self.look().outward(n, rest, owner)
    }

    pub fn owner_of(&self, v: u32) -> usize {
        self.look().owner_of(v)
    }

    // A place on the body at rest as a crossing like surface()'s: triangle `t` (an offset into the index), `w` how much
    // of each corner, `kind` skin or cloth.
    pub fn crossing(&self, t: usize, w: [f32; 3], kind: Kind) -> Crossing {
        let body = &self.person.body;
        let [a, b, c] = [0, 1, 2].map(|k| body.index[t + k]);
        let r = [a, b, c].map(|v| body.position[v as usize]);
        let rest = r[0] * w[0] + r[1] * w[1] + r[2] * w[2];
        let most = if w[0] >= w[1] && w[0] >= w[2] { a } else if w[1] >= w[2] { b } else { c };
        let n = [a, b, c].map(|v| body.normal[v as usize]);
        let owner = self.owner_of(most);
        let rest_normal = self.outward((n[0] * w[0] + n[1] * w[1] + n[2] * w[2]).normalize(), rest, owner);
        let u = [a, b, c].map(|v| body.uv[v as usize]);
        let area3 = (r[1] - r[0]).cross(r[2] - r[0]).length();
        let area_uv = ((u[1].x - u[0].x) * (u[2].y - u[0].y) - (u[2].x - u[0].x) * (u[1].y - u[0].y)).abs();
        Crossing {
            t: 0.0, kind, point: Vec3::ZERO, normal: Vec3::ZERO, uv: u[0] * w[0] + u[1] * w[1] + u[2] * w[2], rest, rest_normal, owner,
            scale: (area_uv / area3.max(1e-10)).sqrt(), corners: [a, b, c], shares: w, cloth: None, open: false,
            under: kind == Kind::Skin && self.hurt.facts.under[t / 3],
        }
    }

    // The nearest skin or clothes to a rest-space point, within `far`, as a crossing (runs.ts nearest): the clothes
    // unless the skin is more than 4 mm nearer.
    // shortcut: every triangle is tried (each passed by at a glance by its ball), where runs.ts filed them in a grid of
    // cells; file them if this is ever asked many times a frame.
    pub fn nearest_rest(&self, rest: Vec3, far: f32) -> Option<Crossing> {
        let f = &self.hurt.facts;
        let body = &self.person.body;
        let closest = |list: &[u32]| {
            let mut best: Option<(usize, [f32; 3], f32)> = None;
            let mut near = far;
            for &t in list {
                let ball = f.ball[t as usize / 3];
                let reach = near + ball.w;
                if rest.distance_squared(ball.truncate()) > reach * reach {
                    continue;
                }
                let t = t as usize;
                let (d, w) = closest_on_triangle(rest, body.position[body.index[t] as usize], body.position[body.index[t + 1] as usize],
                                                 body.position[body.index[t + 2] as usize]);
                if d < near {
                    near = d;
                    best = Some((t, w, d));
                }
            }
            best
        };
        let mut best: Option<(usize, [f32; 3], f32, Kind)> = None;
        for (kind, list) in [(Kind::Cloth, &f.cloth), (Kind::Skin, &f.skin)] {
            if let Some((t, w, d)) = closest(list) {
                if best.is_none_or(|b| d < b.2 - 0.004) {
                    best = Some((t, w, d, kind));
                }
            }
        }
        best.map(|(t, w, _, kind)| self.crossing(t, w, kind))
    }

    // --- being hurt ----------------------------------------------------------------------------------------------

    // A push of `impulse` (N s) at `point`; `jolt` how much a standing person flinches from it (0 to 1). The body takes
    // the push where it landed; whether it stays on its feet is its balance's business (behaviour.rs).
    // (The flesh hit is heard only while the body is not limp, as the TS played it.)
    pub fn hit(&mut self, point: Vec3, impulse: Vec3, jolt: f32) {
        if !self.hurt.down {
            self.hurt.happened.push(Happened::Sound { name: "bullet-flesh".into(), at: Some(point), gain: 0.7 });
        }
        self.hurt.happened.push(Happened::Hit { point, impulse, jolt });
    }

    // A fresh wound in bare skin wells up: a little blood in and round it at once, more as it bleeds. (Under clothes
    // nothing shows yet: the cloth takes up the blood as it comes.)
    // skin.rs draws it as npc.ts welling did: a blot of film (0.25 mm, 3 mm and more across) and a run of a third of it.
    pub fn welling(&mut self, hit: Option<&Crossing>, ml: f32) {
        let Some(hit) = hit else { return };
        if hit.cloth.is_some() {
            return;
        }
        self.hurt.happened.push(Happened::Welling { hit: hit.clone(), ml });
    }

    // A wound made at `hit` (a crossing from surface()): a bullet's way in or out, `size` across in metres. On skin it
    // opens the flesh there (marks.rs, phase 3); on clothes it is a hole in them.
    pub fn wound(&mut self, hit: &Crossing, way: Way, size: f32) -> bool {
        self.hurt.happened.push(Happened::Wound { hit: hit.clone(), way, size });
        true
    }

    pub fn sound(&mut self, name: &str, at: Option<Vec3>, gain: f32) {
        self.hurt.happened.push(Happened::Sound { name: name.into(), at, gain });
    }

    // The bone's crack, heard from the body.
    pub fn crack(&mut self, at: Vec3, gain: f32) {
        self.sound("crack", Some(at), gain);
    }

    // A shaft let go at its mid joint (the ragdoll's breakAt, and the sandbox's onBroke).
    pub fn broke(&mut self, segment: &str) {
        self.hurt.happened.push(Happened::Broke { segment: segment.into() });
    }

    pub fn joint(&mut self, segment: &str, change: Joint) {
        self.hurt.happened.push(Happened::Joint { segment: segment.into(), change });
    }

    // Shown hurt in the x-ray.
    // port: the x-ray's looks are shared by everyone of a body (anatomy.rs): a person's own hurt look is to come.
    pub fn hurt_part(&mut self, name: &str) {
        if !self.hurt.hurt.iter().any(|n| n == name) {
            self.hurt.hurt.push(name.to_string());
        }
    }

    // --- the voice -----------------------------------------------------------------------------------------------

    // Awake enough to make a sound of their own (a cry, a cough, a retch): out cold or dead, nothing new is said.
    pub fn awake(&self) -> bool {
        let v = &*self.vitals;
        v.conscious() > 0.35 && v.beating() && !v.dead
    }

    // One of this person's cries (tools/cries.py), from their mouth, unless they are already making one. `over` cuts
    // in on whatever they were saying, as a new hurt does.
    pub fn say(&mut self, kind: &'static str, gain: f32, over: bool) {
        let now = self.hurt.clock;
        if !over && now < self.hurt.said.until {
            return;
        }
        self.hurt.said.until = now + match kind {
            "yell" => 0.8,
            "scream" | "cry" => 3.0,
            _ => 2.2,
        };
        self.hurt.happened.push(Happened::Say { kind, gain });
        self.hurt.crying = kind == "cry" || (self.hurt.crying && kind != "scream" && kind != "yell");
    }

    // What they say about what is happening to them: a cry the moment it hurts, as bad as it hurts; then groans, or
    // weeping once a lot of blood has gone; gasping when they cannot get air.
    //
    // The TS cried out at every new hurt, cutting in on the last cry, and groaned or wept every 3.5 to 8.5 s for as long
    // as it hurt: a magazine emptied into someone was a scream a shot, and four people hurt were never quiet (the user:
    // "a bit too excessive with the screaming"). People in severe pain cry out in bursts, then go quiet, moan or breathe
    // hard, and fall quieter as shock comes on. So, on top of the TS's choices:
    // - A new hurt within OUTBURST of the cry the last one started is part of that cry (nobody draws breath to scream
    //   again a fifth of a second later), unless it is much the worse.
    // - Between, a sound is made at each of the TS's moments only by chance, the chance falling the longer since the last
    //   new hurt (HABIT seconds to half) and as consciousness goes; quieter the same way. The first just after a cry is
    //   a gasp, a breath caught.
    // (Medicine's dice are thrown exactly as the TS threw them, so its numbers still follow the TS's draw for draw; what
    // the TS did not do throws the voice's own.)
    fn speak(&mut self, dt: f32) {
        let awake = self.awake();
        let was = self.hurt.said.awake;
        // Knocked out or killed mid-cry, the cry stops there (a recording plays two or three seconds: it went on
        // screaming after the shot that put them down); so does a retch or a cough. (Whoever plays the voice keeps it and
        // takes `Happened::Cut`: sound.rs, which has nothing to cut if nothing is playing.)
        // (The TS said a last breath, 'dying', as they died. The user: people "can still make noises when they
        // die". Nothing is said by someone going out or dying: the moment is the cry cut off, and silence.)
        if was && !awake {
            self.hurt.happened.push(Happened::Cut);
        }
        self.hurt.said.awake = awake;
        let v = &*self.vitals;
        let hurt = v.pain - self.hurt.said.pain;
        self.hurt.said.pain = v.pain;
        if !awake {
            return;
        }
        let now = self.hurt.clock;
        if hurt > 0.12 && v.breathing {
            self.hurt.said.next = 2.0 + self.dice.next() * 3.0;
            let said = &mut self.hurt.said;
            said.hurt_at = now;
            if now - said.cried < OUTBURST && hurt < said.peak * 2.0 {
                said.peak = said.peak.max(hurt);
                return;
            }
            (said.cried, said.peak) = (now, hurt);
            self.say(if hurt > 0.35 { "scream" } else { "yell" }, (0.6 + hurt).min(1.0), true);
            return;
        }
        self.hurt.said.next -= dt;
        if self.hurt.said.next > 0.0 {
            return;
        }
        self.hurt.said.next = 3.5 + self.dice.next() * 5.0;
        let v = &*self.vitals;
        let short = !v.breathing || v.spo2 < 88.0 || (v.lungs.l + v.lungs.r) / 2.0 < 0.6 || v.airway < 0.6 || v.flooded.0 + v.flooded.1 > 0.6 || v.choked > 0.3;
        let (lost, pain) = (v.lost(), v.pain);
        let (kind, gain) = if short {
            ("gasp", 0.8)
        } else if lost > 0.18 && self.dice.next() < 0.6 {
            ("cry", 0.75)
        } else if pain > 0.25 {
            ("groan", 0.6 + pain * 0.3)
        } else {
            return;
        };
        let since = now - self.hurt.said.hurt_at;
        // 1 awake and clear, 0 about to go out.
        let alert = ((v.conscious() - 0.35) / 0.65).clamp(0.0, 1.0);
        // (Short of air they gasp whatever: it is the breathing itself.)
        let chance = if short { 0.8 } else { HABIT / (HABIT + since) } * (0.3 + 0.7 * alert);
        if self.hurt.said.dice.next() >= chance {
            return;
        }
        let quiet = (0.55 + 0.45 * alert) * (1.0 - 0.4 * (since / 60.0).min(1.0));
        if !short && since < 6.0 && pain > 0.4 {
            self.say("gasp", 0.55 * quiet, false);
        } else {
            self.say(kind, gain * quiet, false);
        }
    }

    // --- every frame ---------------------------------------------------------------------------------------------

    // The insides' clock, in the order npc.ts updated them: the vitals, the throat, the bruising, the blood out of each
    // wound, the voice; the bones after the physics step. (The TS ran behaviour, ragdoll.drive, dismember and viscera
    // between the vitals and the throat: here they are systems of their own, behaviour.rs's `think` after this one, reading
    // the vitals as this frame left them and the throat's retch.)
    pub fn update(&mut self, dt: f32) {
        self.hurt.clock += dt;
        self.hurt.age += dt;
        self.vitals.update(dt);
        self.throat().update(dt);
        self.eyes().update(dt);
        self.bruise().update(dt);
        self.dressings_update(dt);
        self.bleed(dt);
        self.speak(dt);
        self.bones().update();
    }

    // Blood out of each wound, as much as is coming out of it this frame, to where it goes: an artery open to the air
    // throws it as a stream; anything else comes out into the clothes over the wound, or onto the skin, and runs.
    // What goes where is worked out here; blood.rs, soak.rs and runs.rs take it from `happened`.
    fn bleed(&mut self, dt: f32) {
        // Bleeding inside the body gets out through a wound in its wall only once enough has gathered in there to reach
        // the hole, and then the more the wound faces down: a small hole is held shut by the tissue round it, and blood
        // leaks from wounds on the lowest side (dev/research/gunshot-blood.md sec. 2, stab-wounds.md sec. 1, DiMaio 1999
        // ch. 9). At most the twelfth it always let out. How much has to gather first is an estimate: half a litre.
        let inside: f32 = self.vitals.bleeds.iter().filter(|b| b.internal && b.into.is_none()).map(|b| b.lost).sum();
        let filled = (inside / 0.5).min(1.0);
        for k in 0..self.vitals.bleeds.len() {
            let b = self.vitals.bleeds[k].clone();
            // Into the mouth, the airways or the stomach (throat.rs); only the front of a nosebleed comes out of the nose.
            let mut share = match b.into {
                Some(into) => self.throat().take(into, b.side, b.flow * dt * 1000.0),
                None => 1.0,
            };
            if share == 0.0 {
                continue;
            }
            let Some(mark) = b.source.mark.clone() else { continue };
            if b.internal {
                let facing = if filled > 0.0 { (-self.world_of(mark.rest, mark.owner, Some(mark.rest_normal)).1.unwrap().y).max(0.0) } else { 0.0 };
                share *= 0.08 * filled * (0.15 + 0.85 * facing);
            }
            let flow = b.flow * share;
            if flow < 1e-6 {
                continue;
            }
            let ml = flow * dt * 1000.0;
            // Under a dressing it goes into the gauze, and out from under it once that is full (dressing.rs).
            if let Some(d) = b.dressing {
                self.dressing_take(d, k, ml);
                continue;
            }
            let v = &*self.vitals;
            if b.spurts && !b.internal && v.beating() {
                // The pressure in the artery now: up fast as the heart squeezes, falling away till the next beat. What gets
                // past the tissue round the hole throws the blood out as fast as Bernoulli says, and it surges with it.
                let (sys, dia, ph) = (v.map * 1.32, v.map * 0.84, v.beat);
                let p = dia + (sys - dia) * if ph < 0.1 { ph / 0.1 } else { (-(ph - 0.1) / 0.17).exp() };
                let speed = 0.6 * ((2.0 * (p - BACK) * 133.3) / RHO).max(0.0).sqrt();
                if speed > 0.4 {
                    let (at, normal) = self.world_of(mark.rest, mark.owner, Some(mark.rest_normal));
                    let normal = normal.unwrap();
                    let out = ml * (p / v.map);
                    // Through clothes most of it soaks in, and the rest comes through the hole slower.
                    let into = if mark.cloth.is_some() { 0.6 } else { 0.0 };
                    if let Some(c) = &mark.cloth {
                        self.hurt.happened.push(Happened::Soak { rest: c.rest, ml: out * into });
                    }
                    let fast = speed * if mark.cloth.is_some() { 0.6 } else { 1.0 };
                    let q = (out * (1.0 - into) * 1e-6) / dt;
                    let r = (q / (std::f32::consts::PI * fast)).sqrt().clamp(0.0006, 0.004);
                    // (The stream's aim off the skin's normal is the TS's random half-box, drawn by blood.rs, which keeps it
                    // a bleed's own.)
                    self.hurt.happened.push(Happened::Stream { bleed: Some(k), at: at + normal * 0.004, dir: normal, speed: fast, ml: out * (1.0 - into), r });
                    continue;
                }
            }
            // Where it comes out decides where it goes: into the clothes over the wound (which drip once full), or onto
            // the skin, where it runs (runs.rs).
            match &mark.cloth {
                Some(c) => self.hurt.happened.push(Happened::Soak { rest: c.rest, ml }),
                None => self.hurt.happened.push(Happened::Runs { hit: mark.clone(), ml, from: Some(k) }),
            }
        }
    }
}

// Whether the line o + t d, 0 < t < far, meets the box `b` (a hair larger, for rounding).
fn box_crossed(b: &[f32; 6], o: Vec3, d: Vec3, far: f32) -> bool {
    let (mut t0, mut t1) = (0.0f32, far);
    for a in 0..3 {
        let (lo, hi) = (b[a] - 1e-5, b[a + 3] + 1e-5);
        if d[a].abs() < 1e-12 {
            if o[a] < lo || o[a] > hi {
                return false;
            }
            continue;
        }
        let (mut p, mut q) = ((lo - o[a]) / d[a], (hi - o[a]) / d[a]);
        if p > q {
            std::mem::swap(&mut p, &mut q);
        }
        t0 = t0.max(p);
        t1 = t1.min(q);
        if t0 > t1 {
            return false;
        }
    }
    true
}

// Whether the line meets a part's box (its skinned corners this frame, 5 cm larger) at all: cheap next to the triangles
// it saves.
fn slab_for(b: &[f32; 6], o: Vec3, d: Vec3, far: f32) -> bool {
    let (mut t0, mut t1) = (0.0f32, far);
    for k in 0..3 {
        let inv = 1.0 / d[k];
        let (mut a, mut c) = ((b[k] - 0.05 - o[k]) * inv, (b[k + 3] + 0.05 - o[k]) * inv);
        if a > c {
            std::mem::swap(&mut a, &mut c);
        }
        t0 = t0.max(a);
        t1 = t1.min(c);
        if t0 > t1 {
            return false;
        }
    }
    true
}

pub fn barycentric(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> [f32; 3] {
    let (v0, v1, v2) = (b - a, c - a, p - a);
    let (d00, d01, d11, d20, d21) = (v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1));
    let den = d00 * d11 - d01 * d01;
    let den = if den == 0.0 { 1.0 } else { den };
    let v = (d11 * d20 - d01 * d21) / den;
    let w = (d00 * d21 - d01 * d20) / den;
    [1.0 - v - w, v, w]
}

// Ericson's closest point on a triangle to `p`: how far, and how much of each corner it is (runs.ts closestOnTriangle).
pub fn closest_on_triangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3) -> (f32, [f32; 3]) {
    let (ab, ac, ap) = (b - a, c - a, p - a);
    let (d1, d2) = (ab.dot(ap), ac.dot(ap));
    let bp = ap - ab;
    let (d3, d4) = (ab.dot(bp), ac.dot(bp));
    let cp = ap - ac;
    let (d5, d6) = (ab.dot(cp), ac.dot(cp));
    let (vc, vb, va) = (d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4);
    let (u, v) = if d1 <= 0.0 && d2 <= 0.0 {
        (0.0, 0.0)
    } else if d3 >= 0.0 && d4 <= d3 {
        (1.0, 0.0)
    } else if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        (d1 / (d1 - d3), 0.0)
    } else if d6 >= 0.0 && d5 <= d6 {
        (0.0, 1.0)
    } else if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        (0.0, d2 / (d2 - d6))
    } else if va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0 {
        let v = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        (1.0 - v, v)
    } else {
        let den = 1.0 / (va + vb + vc);
        (vb * den, vc * den)
    };
    ((ap - ab * u - ac * v).length(), [1.0 - u - v, u, v])
}

// --- the per-frame clock, and borrowing a person -------------------------------------------------------------------

// Everyone's insides, a frame at a time.
pub fn update(time: Res<Time>, frames: Res<FrameCount>, mut dice: ResMut<Dice>, mut people: Query<(&Person, &Transform, &mut Vitals, &mut Hurt)>) {
    let dt = time.delta_secs();
    if dt <= 0.0 {
        return;
    }
    for (person, root, mut vitals, mut hurt) in &mut people {
        let traced = hurt.traced.clone();
        let mut npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut dice, frame: frames.0 };
        npc.update(dt);
    }
}

// Each person made (person.rs, sandbox.rs) given what medicine keeps of them, the frame after.
pub fn fit(mut commands: Commands, anatomy: Res<Anatomy>, mut dice: ResMut<Dice>, mut facts: Local<std::collections::HashMap<String, Arc<Facts>>>,
       people: Query<(Entity, &Person, &Transform, &Vitals), Without<Hurt>>) {
    for (e, person, root, vitals) in &people {
        let body = &person.body;
        let Some(traced) = anatomy.traced.get(&body.name) else { continue };
        let f = facts.entry(body.name.clone()).or_insert_with(|| Arc::new(Facts::new(body))).clone();
        let mut hurt = Hurt::new(traced.clone(), f, person, &mut dice);
        let mut vitals = vitals.clone();
        let mut npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced: traced.clone(), dice: &mut dice, frame: 0 };
        npc.made();
        commands.entity(e).insert(hurt);
    }
}

impl Hurt {
    fn new(traced: Arc<Traced>, facts: Arc<Facts>, person: &Person, dice: &mut Dice) -> Hurt {
        let next = 3.0 + dice.next() * 4.0;
        Hurt {
            bones: Bones::new(facts.age, person.mass),
            teeth: Teeth::new(&person.body),
            throat: Throat::default(),
            eyes: Eyes::default(),
            bruise: Bruise::default(),
            dressings: Vec::new(),
            traced,
            facts,
            // (The voice's dice seeded off the draw already made for it: it throws none of medicine's own beyond the TS's.)
            said: Said { until: 0.0, pain: 0.0, next, awake: true, hurt_at: -1e9, cried: -1e9, peak: 0.0, dice: crate::rng::Rng::new(next.to_bits()) },
            crying: false,
            leg_gone: false,
            down: false,
            cut: HashSet::new(),
            hurt: Vec::new(),
            happened: Vec::new(),
            clock: 0.0,
            age: 0.0,
            segments: None,
            bends: None,
            skinned: None,
            weights: None,
            held: None,
        }
    }
}

impl Npc<'_> {
    // What is found on the body once, as the TS's constructors did after the teeth: where the mouth is (throat.rs).
    fn made(&mut self) {
        self.find_mouth();
        self.bruise_made();
    }
}

// A person's medicine borrowed from the world, for a caller with the world in hand (a scenario step, a weapon's
// exclusive system): `f` gets the Npc. None if they have no Hurt yet (made this frame).
pub fn with<R>(world: &mut World, who: Entity, f: impl FnOnce(&mut Npc) -> R) -> Option<R> {
    let frame = world.resource::<FrameCount>().0;
    world.resource_scope(|world, mut dice: Mut<Dice>| {
        let mut q = world.query::<(&Person, &Transform, &mut Vitals, &mut Hurt)>();
        let (person, root, mut vitals, mut hurt) = q.get_mut(world, who).ok()?;
        let traced = hurt.traced.clone();
        let mut npc = Npc { person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut dice, frame };
        Some(f(&mut npc))
    })
}

// A person made whole again: fresh vitals and a fresh Hurt, as the TS's room reset (K) gave a fresh person, posed
// standing on breathing clock `clock` (the TS's npc.clock, P.stand). For checks.
pub fn renew(world: &mut World, who: Entity, clock: f32) {
    let frame = world.resource::<FrameCount>().0;
    world.resource_scope(|world, mut dice: Mut<Dice>| {
        let mut q = world.query::<(&mut Person, &Transform, &mut Vitals, &mut Hurt)>();
        let Ok((mut person, root, mut vitals, mut hurt)) = q.get_mut(world, who) else { return };
        let pose = crate::poses::stand(clock, 1.0, 0.0);
        person.posed = person.apply(&pose, Some(crate::person::FEET));
        person.pose = pose;
        *vitals = Vitals::new(person.mass);
        *hurt = Hurt::new(hurt.traced.clone(), hurt.facts.clone(), &person, &mut dice);
        let traced = hurt.traced.clone();
        let mut npc = Npc { person: &person, root: *root, vitals: &mut vitals, hurt: &mut hurt, traced, dice: &mut dice, frame };
        npc.made();
    });
}

// What hurt did is there for the frame it happened in, for whatever draws, plays or moves it to take; then it goes.
pub fn forget(mut people: Query<&mut Hurt>) {
    for mut h in &mut people {
        h.happened.clear();
    }
}

pub fn plugin(app: &mut App) {
    app.insert_resource(Dice(12345)).add_systems(First, forget).add_systems(Update, (fit, update, crate::dressing::severed).chain());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closest_point() {
        let (a, b, c) = (Vec3::ZERO, Vec3::X, Vec3::Y);
        let (d, w) = closest_on_triangle(Vec3::new(0.25, 0.25, 1.0), a, b, c);
        assert!((d - 1.0).abs() < 1e-6 && (w[1] - 0.25).abs() < 1e-6 && (w[2] - 0.25).abs() < 1e-6);
        let (d, w) = closest_on_triangle(Vec3::new(2.0, 0.0, 0.0), a, b, c);
        assert!((d - 1.0).abs() < 1e-6 && (w[1] - 1.0).abs() < 1e-6);
        let w = barycentric(Vec3::new(0.2, 0.3, 0.0), a, b, c);
        assert!((w[0] - 0.5).abs() < 1e-6);
    }
}
