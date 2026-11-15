// The people (src/person.ts).
//
// Each is one skinned body built offline by tools/people.py from MakeHuman's CC0 base mesh and base assets: a
// photographed skin, eyes, brows, lashes, teeth, hair, and the clothes they turned up in. They are posed
// procedurally. Nothing is keyframed: a pose is a handful of joint angles in anatomical terms, hip flexion, knee
// flexion, how far the jaw hangs, and every movement is a function from time to one of those.
//
// The bones' rest frames are world-aligned (tools/people.py writes only positions), so a rotation applied to a bone in
// its rest pose is a rotation about a fixed axis of the person's own body. Each hinge below names that axis and the
// direction positive should move the limb, and the direction is checked against the rest geometry at load rather than
// trusted to a sign convention nobody can remember. (That check is also what carries the hinges over the mirror from
// Babylon's left-handed space, main.rs `babylon`: the geometry is mirrored, the checks are made on it, and positive
// still flexes forward.)
//
// A person is one entity with a `Person`: its root is where they stand and which way they face; under it the `frame`,
// what a pose moves as a whole (tipped to crawl, laid on its back), turning about the pelvis; under that the mesh's own
// space, offset so its origin (the floor under the feet) lines up again, holding the bones as entities, the body's
// parts as skinned meshes on them, and the insides (anatomy.rs). Each module's per-person parts hang off `Person`.

use std::collections::HashMap;
use std::f32::consts::PI;
use std::sync::Arc;

use bevy::asset::RenderAssetUsages;
use bevy::mesh::skinning::{SkinnedMesh, SkinnedMeshInverseBindposes};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use serde::Deserialize;

use crate::poses::{self, Pose};
use crate::ragdoll::{self, Segment};
use crate::rng::Rng;
use crate::{asset_file, babylon, babylon_quat};

pub const RAD: f32 = PI / 180.0;

// --- the file ------------------------------------------------------------------------------------------------------
//
// "CCPF", a version, the length of a JSON header, the header, then the arrays it lists (positions, normals, uvs, four
// bones and four weights a corner, triangles).

#[derive(Deserialize)]
struct RawHeader {
    name: String,
    height: f32,
    #[serde(rename = "vertexCount")]
    vertex_count: usize,
    parts: Vec<RawPart>,
    bones: Vec<RawBone>,
    #[serde(default)]
    face: HashMap<String, HashMap<String, [f32; 4]>>,
    arrays: Vec<RawArray>,
}

#[derive(Deserialize)]
struct RawPart {
    name: String,
    kind: String,
    texture: Option<Texture>,
    #[serde(default)]
    under: bool,
    #[serde(default)]
    worn: bool,
    #[serde(rename = "indexStart")]
    index_start: usize,
    #[serde(rename = "indexCount")]
    index_count: usize,
    #[serde(rename = "vertexStart")]
    vertex_start: usize,
    #[serde(rename = "vertexCount")]
    vertex_count: usize,
}

#[derive(Deserialize)]
struct RawBone {
    name: String,
    parent: i32,
    head: [f32; 3],
    tail: [f32; 3],
}

#[derive(Deserialize)]
pub struct RawArray {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub offset: usize,
    pub length: usize,
}

#[derive(Deserialize, Clone)]
pub struct Texture {
    pub file: String,
    pub alpha: bool,
}

#[derive(Clone)]
pub struct Part {
    pub name: String,
    pub kind: String,
    pub texture: Option<Texture>,
    // Skin under the clothes: drawn only through holes in them (hider.rs, later), so not drawn yet.
    pub under: bool,
    // Clothes: on a mesh of their own in the TS (npc.ts), so holes in a shirt and in the skin are painted apart.
    pub worn: bool,
    pub index_start: usize,
    pub index_count: usize,
    pub vertex_start: usize,
    pub vertex_count: usize,
}

#[derive(Clone)]
pub struct Bone {
    pub name: String,
    pub parent: Option<usize>,
    pub head: Vec3,
    pub tail: Vec3,
}

// One body as read, in Bevy's space (main.rs `babylon`): every corner, bone and face pose mirrored, the textures' v
// turned over (Babylon flips an image as it loads it). The triangles keep their order: Babylon's front face is the
// clockwise one, and the mirror makes it counter-clockwise, Bevy's front.
pub struct Body {
    pub name: String,
    pub height: f32,
    pub parts: Vec<Part>,
    pub bones: Vec<Bone>,
    pub by_name: HashMap<String, usize>,
    // The face's pose units: name -> bone -> turn (face.rs).
    pub face: HashMap<String, HashMap<String, Quat>>,
    pub position: Vec<Vec3>,
    pub normal: Vec<Vec3>,
    pub uv: Vec<Vec2>,
    pub joints: Vec<[u16; 4]>,
    pub weights: Vec<[u8; 4]>,
    pub index: Vec<u32>,
}

impl Body {
    pub fn bone(&self, name: &str) -> &Bone {
        &self.bones[self.by_name[name]]
    }

    pub fn index_by_name(&mut self) {
        self.by_name = self.bones.iter().enumerate().map(|(i, b)| (b.name.clone(), i)).collect();
    }
}

// The arrays of a CCPF/CCAF/SIXP file: its JSON header and where the data begins.
pub fn read_file(path: &str, magic: &[u8; 4]) -> (Vec<u8>, serde_json::Value, usize) {
    let file = asset_file(path);
    let buf = std::fs::read(&file).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
    assert_eq!(&buf[0..4], magic, "{path}: not a {}", String::from_utf8_lossy(magic));
    let len = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let header: serde_json::Value = serde_json::from_slice(&buf[12..12 + len]).expect(path);
    (buf, header, 12 + len)
}

pub fn array<'a>(buf: &'a [u8], base: usize, arrays: &[RawArray], name: &str) -> &'a [u8] {
    let a = arrays.iter().find(|a| a.name == name).unwrap_or_else(|| panic!("no array {name}"));
    &buf[base + a.offset..base + a.offset + a.length]
}

pub fn f32s(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
}

pub fn vec3s(b: &[u8]) -> Vec<Vec3> {
    f32s(b).chunks_exact(3).map(|p| babylon(p[0], p[1], p[2])).collect()
}

pub fn read_body(path: &str) -> Body {
    let (buf, header, base) = read_file(path, b"CCPF");
    let h: RawHeader = serde_json::from_value(header).expect(path);
    let get = |name: &str| array(&buf, base, &h.arrays, name);
    let uv: Vec<Vec2> = f32s(get("uv")).chunks_exact(2).map(|t| Vec2::new(t[0], 1.0 - t[1])).collect();
    let index: Vec<u32> = get("index").chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]]) as u32).collect();
    let joints = get("joints").chunks_exact(4).map(|c| [c[0] as u16, c[1] as u16, c[2] as u16, c[3] as u16]).collect();
    let weights = get("weights").chunks_exact(4).map(|c| [c[0], c[1], c[2], c[3]]).collect();
    let mut body = Body {
        name: h.name,
        height: h.height,
        parts: h.parts.into_iter().map(|p| Part {
            name: p.name, kind: p.kind, texture: p.texture, under: p.under, worn: p.worn,
            index_start: p.index_start, index_count: p.index_count, vertex_start: p.vertex_start, vertex_count: p.vertex_count,
        }).collect(),
        bones: h.bones.into_iter().map(|b| Bone {
            name: b.name,
            parent: (b.parent >= 0).then_some(b.parent as usize),
            head: babylon(b.head[0], b.head[1], b.head[2]),
            tail: babylon(b.tail[0], b.tail[1], b.tail[2]),
        }).collect(),
        by_name: HashMap::new(),
        face: h.face.into_iter().map(|(k, v)| (k, v.into_iter().map(|(b, q)| (b, babylon_quat(q))).collect())).collect(),
        position: vec3s(get("position")),
        normal: vec3s(get("normal")),
        uv,
        joints,
        weights,
        index,
    };
    assert_eq!(body.position.len(), h.vertex_count, "{path}: corners");
    body.index_by_name();
    body
}

// --- anatomy -------------------------------------------------------------------------------------------------------
//
// Every control the poses use: which bone it turns, about which axis of the rest body, and which way positive should
// carry the far end of that bone. Axes are in the person's own frame: ahead (-Z here, +Z in the TS), +Y up, their left
// at -X. `toward` is checked at load; if a positive turn moves the bone's tail the other way the axis is flipped, so
// the poses can say "flex the knee 90" and mean it.

const FORWARD: Vec3 = Vec3::new(0.0, 0.0, -1.0);
const UP: Vec3 = Vec3::Y;
const FINGERS: [&str; 4] = ["index", "middle", "ring", "little"];

#[derive(Clone, Copy)]
enum Axis {
    X,
    Y,
    Z,
    Bone,
    // A hinge across the limb: perpendicular to where it points and to the way the body faces.
    Elbow,
}

struct HingeDef {
    name: String,
    bones: Vec<String>,
    axis: Axis,
    toward: Option<Vec3>,
    tip: Option<&'static str>,
    order: i32,
}

fn hinge_defs() -> Vec<HingeDef> {
    let def = |name: String, bones: &[&str], axis, toward, tip, order| HingeDef {
        name, bones: bones.iter().map(|s| s.to_string()).collect(), axis, toward, tip, order,
    };
    let mut out = Vec::new();
    for side in ["L", "R"] {
        let s = if side == "L" { -1.0 } else { 1.0 }; // outward along X for this side
        let out_ = Vec3::new(s, 0.0, 0.0);
        let b = |n: &str| format!("{n}.{side}");
        let one = |name: &str, bone: String, axis, toward, order| HingeDef {
            name: format!("{name}{side}"), bones: vec![bone], axis, toward, tip: None, order,
        };
        out.push(one("hipFlex", b("upperleg01"), Axis::X, Some(FORWARD), 2));
        out.push(one("hipAbduct", b("upperleg01"), Axis::Z, Some(out_), 1));
        out.push(one("hipTwist", b("upperleg01"), Axis::Y, None, 0));
        out.push(one("knee", b("lowerleg01"), Axis::X, Some(-FORWARD), 1));
        out.push(one("ankle", b("foot"), Axis::X, Some(UP), 1));
        out.push(one("shoulderFlex", b("upperarm01"), Axis::X, Some(FORWARD), 2));
        out.push(one("shoulderAbduct", b("upperarm01"), Axis::Z, Some(UP), 1));
        out.push(one("shoulderTwist", b("upperarm01"), Axis::Bone, None, 0));
        out.push(one("elbow", b("lowerarm01"), Axis::Elbow, Some(FORWARD), 1));
        out.push(one("forearmTwist", b("lowerarm02"), Axis::Bone, None, 1));
        out.push(one("wrist", b("wrist"), Axis::Elbow, Some(FORWARD), 1));
        out.push(one("shrug", b("clavicle"), Axis::Z, Some(UP), 1));
    }
    // The spine bends in five places; `spine` controls are spread over all of them so a bow is a curve and not a
    // hinge at the waist.
    let spine = ["spine05", "spine04", "spine03", "spine02", "spine01"];
    out.push(def("spineFlex".into(), &spine, Axis::X, Some(FORWARD), Some("spine01"), 2));
    out.push(def("spineSide".into(), &spine, Axis::Z, Some(Vec3::X), Some("spine01"), 1));
    out.push(def("spineTwist".into(), &spine, Axis::Y, None, None, 0));
    // The head nods before it turns, which is what makes a turned head still look down at something rather than tip
    // over sideways.
    let neck = ["neck01", "neck02", "neck03"];
    out.push(def("neckFlex".into(), &neck, Axis::X, Some(FORWARD), Some("neck03"), 0));
    out.push(def("neckTwist".into(), &neck, Axis::Y, None, None, 2));
    out.push(def("headFlex".into(), &["head"], Axis::X, Some(FORWARD), None, 0));
    out.push(def("headTilt".into(), &["head"], Axis::Z, Some(Vec3::X), None, 1));
    out.push(def("headTwist".into(), &["head"], Axis::Y, None, None, 2));
    out.push(def("jaw".into(), &["jaw"], Axis::X, Some(-UP), None, 1));
    out.push(def("pelvisTilt".into(), &["root"], Axis::X, Some(FORWARD), Some("spine05"), 1));
    out
}

// What touches the floor, for each way of being on it: joint, which end (tail or not), and how far the surface of
// the body sits below that end. An ankle joint is seven centimetres above the sole it stands on.
pub type Contacts = &'static [(&'static str, bool, f32)];
pub const FEET: Contacts = &[("foot.L", false, 0.074), ("foot.R", false, 0.074), ("foot.L", true, 0.03), ("foot.R", true, 0.03)];
pub const KNEES: Contacts = &[("lowerleg01.L", false, 0.055), ("lowerleg01.R", false, 0.055), ("foot.L", false, 0.05),
    ("foot.R", false, 0.05), ("foot.L", true, 0.025), ("foot.R", true, 0.025)];
pub const ALL4: Contacts = &[("lowerleg01.L", false, 0.055), ("lowerleg01.R", false, 0.055), ("wrist.L", false, 0.03),
    ("wrist.R", false, 0.03), ("finger3-3.L", true, 0.008), ("finger3-3.R", true, 0.008)];
// Lying down: everything that could touch the floor might.
pub const PRONE: Contacts = &[("head", false, 0.1), ("head", true, 0.09), ("spine01", false, 0.12), ("spine04", false, 0.12),
    ("lowerleg01.L", false, 0.055), ("lowerleg01.R", false, 0.055), ("foot.L", true, 0.03), ("foot.R", true, 0.03),
    ("wrist.L", false, 0.03), ("wrist.R", false, 0.03)];

// How a hand closes (_hand): the share of `curl` each joint of a finger takes closing (MCP, PIP, DIP: the DIP two
// thirds of the PIP) and opening past rest, where each stops, index to little finger how far each goes, the ring and
// little metacarpals' bend at their base for each degree (they cup the palm 7 and 15 degrees in a fist), how much one
// person's fingers differ, how far a knuckle's axis turns toward the middle finger's, and how far the thumb's turns
// from the fingers'.
const GAIN: [f32; 3] = [0.86, 1.0, 0.67];
const OPEN: [f32; 3] = [1.0, 0.15, 0.3];
const RANGE: [[f32; 2]; 3] = [[-35.0, 92.0], [-5.0, 110.0], [-10.0, 85.0]];
const CASCADE: [f32; 4] = [0.9, 1.0, 1.06, 1.12];
const CUP: [f32; 2] = [0.07, 0.14];
const VARY: f32 = 0.12;
const CONVERGE: f32 = 0.6;
const THUMB_TURN: f32 = 100.0;

// How a hinge's degrees are shared among its bones, where they are not simply the same turn on each.
#[derive(Clone)]
enum Bend {
    Same,
    // The whole hand: four knuckles turned in toward the middle finger, twelve finger joints, the two cupping
    // metacarpals. `spread` is how far each finger lies turned out from the middle one (radians), `vary` this
    // person's own fingers.
    Curl { spread: [f32; 4], vary: [f32; 4] },
    Cup,
    Thumb,
}

#[derive(Clone)]
pub struct Hinge {
    pub bones: Vec<usize>,
    pub axis: Vec3,
    // An axis for each bone where they differ (the fingers), else empty.
    pub axes: Vec<Vec3>,
    pub order: i32,
    pub fingers: bool,
    bend: Bend,
}

impl Hinge {
    fn degrees(&self, deg: f32, k: usize) -> f32 {
        match &self.bend {
            Bend::Same => deg,
            Bend::Curl { spread, vary } => {
                if k < 4 {
                    return spread[k] / RAD * CONVERGE * (deg / 30.0).clamp(0.0, 1.0);
                }
                if k >= 16 {
                    return deg.max(0.0) * CUP[k - 16];
                }
                let joint = (k - 4) % 3;
                let finger = (k - 4 - joint) / 3;
                let [lo, hi] = RANGE[joint];
                let gain = if deg >= 0.0 { GAIN[joint] } else { OPEN[joint] } * CASCADE[finger] * vary[finger];
                (deg * gain).clamp(lo, hi)
            }
            Bend::Cup => deg * CUP[k] / CUP[1],
            Bend::Thumb => deg * if k > 0 { 1.0 } else { 0.8 },
        }
    }
}

// A posed skeleton: each bone's turn in its parent's frame, and where the frame (pelvis) is in the root's space.
#[derive(Clone)]
pub struct Posed {
    pub local: Vec<Quat>,
    pub frame: Transform,
}

// --- one person ----------------------------------------------------------------------------------------------------

#[derive(Component)]
pub struct Person {
    pub body: Arc<Body>,
    // What the TS called them in the sandbox ("Old man (1)").
    pub label: String,
    pub height: f32,
    pub mass: f32,
    pub hinges: HashMap<String, Hinge>,
    // Each finger joint's half-turn bone (people.py: the skin over the joint is on it) and the phalanx it halves.
    pub halves: Vec<(usize, usize)>,
    pub pose: Pose,
    pub posed: Posed,
    // The entity a pose moves as a whole, under the root, and the bones as entities, in the file's order.
    pub frame: Entity,
    pub joints: Vec<Entity>,
    // Each drawn part's entity, by the part's index in the body (the skin under the clothes is not drawn).
    pub parts: Vec<(usize, Entity)>,
    // The x-ray of the insides (anatomy.rs).
    pub insides: Entity,
    // The ragdoll's segments as the body stands at its spawn (ragdoll.rs).
    pub segments: Vec<Segment>,
}

// The people's world positions of things are worked out from the pose, not read back from Bevy's transforms, which
// are a frame behind whatever has just been posed.
impl Person {
    // Every bone's turn and where its head is, in the mesh's own space.
    pub fn absolute(&self, local: &[Quat]) -> Vec<(Quat, Vec3)> {
        absolute(&self.body.bones, local)
    }

    // A rest-space point carried by bone `i`, posed, in the root's space.
    pub fn to_root(&self, posed: &Posed, abs: &[(Quat, Vec3)], i: usize, rest: Vec3) -> Vec3 {
        let pelvis = self.body.bone("root").head;
        let (r, p) = abs[i];
        let mesh = p + r * (rest - self.body.bones[i].head);
        posed.frame.translation + posed.frame.rotation * (mesh - pelvis)
    }

    // World position of a joint's head (or tail) as currently posed, the root at `root`.
    pub fn joint(&self, root: &Transform, name: &str, tail: bool) -> Vec3 {
        let i = self.body.by_name[name];
        let abs = self.absolute(&self.posed.local);
        let b = &self.body.bones[i];
        root.transform_point(self.to_root(&self.posed, &abs, i, if tail { b.tail } else { b.head }))
    }

    // `pose` is control name to degrees; anything not named stays at rest. `ground` names what should be touching the
    // floor afterwards (feet by default, knees for kneeling, hands and knees for crawling), and the body is lifted or
    // dropped until the lowest of them just does; None for a person who is not standing on anything. (A body laid
    // down on the lowest point of its own skin, the TS's 'skin', comes with the ragdoll.)
    pub fn apply(&self, pose: &Pose, ground: Option<Contacts>) -> Posed {
        let body = &self.body;
        let pelvis = body.bone("root").head;
        let pitch = poses::get(pose, "_pitch") * RAD;
        let roll = poses::get(pose, "_roll") * RAD;
        let tip = Quat::from_axis_angle(self.hinges["spineFlex"].axis, pitch)
            * Quat::from_axis_angle(self.hinges["spineSide"].axis, roll);
        let offset = babylon(poses::get(pose, "_x"), poses::get(pose, "_y"), poses::get(pose, "_z"));
        let mut frame = Transform::from_translation(pelvis + offset).with_rotation(tip);
        // Each bone collects its turns and applies them in a fixed order (twist, then out to the side, then forward)
        // whatever order the pose happened to list them in. The order matters: an arm lowered to the side and then
        // swung forward ends up in front of the chest, and the same two turns the other way round end up elsewhere.
        let mut turns: Vec<Vec<(i32, Quat)>> = vec![Vec::new(); body.bones.len()];
        for &(name, deg) in pose {
            let Some(h) = self.hinges.get(name) else { continue };
            if deg == 0.0 {
                continue;
            }
            let share = if h.bones.len() > 1 && !h.fingers { 1.0 / h.bones.len() as f32 } else { 1.0 };
            for (k, &b) in h.bones.iter().enumerate() {
                let q = if h.axes.is_empty() {
                    Quat::from_axis_angle(h.axis, deg * RAD * share)
                } else {
                    Quat::from_axis_angle(h.axes[k], h.degrees(deg, k) * RAD * share)
                };
                turns[b].push((h.order, q));
            }
        }
        let mut local: Vec<Quat> = turns
            .into_iter()
            .map(|mut list| {
                list.sort_by_key(|t| t.0); // stable: equal ranks keep the pose's order
                list.into_iter().fold(Quat::IDENTITY, |total, (_, q)| q * total)
            })
            .collect();
        // Every finger joint's half-turn bone turned half as far as the phalanx past it.
        for &(half, bone) in &self.halves {
            local[half] = Quat::IDENTITY.slerp(local[bone], 0.5);
        }
        if let Some(contacts) = ground {
            let posed = Posed { local: local.clone(), frame };
            let abs = self.absolute(&local);
            let mut low = f32::INFINITY;
            for &(name, tail, radius) in contacts {
                let i = body.by_name[name];
                let b = &body.bones[i];
                let p = self.to_root(&posed, &abs, i, if tail { b.tail } else { b.head });
                low = low.min(p.y - radius);
            }
            frame.translation.y -= low - poses::get(pose, "_y");
        }
        Posed { local, frame }
    }
}

pub fn absolute(bones: &[Bone], local: &[Quat]) -> Vec<(Quat, Vec3)> {
    let mut abs: Vec<(Quat, Vec3)> = Vec::with_capacity(bones.len());
    for (i, b) in bones.iter().enumerate() {
        abs.push(match b.parent {
            Some(p) => {
                let (pr, pp) = abs[p];
                (pr * local[i], pp + pr * (b.head - bones[p].head))
            }
            None => (local[i], b.head),
        });
    }
    abs
}

// --- calibration ---------------------------------------------------------------------------------------------------

// Work out, for each hinge, the axis that turns the way its name says, and the hand's.
pub fn calibrate(body: &Body, rng: &mut Rng) -> HashMap<String, Hinge> {
    let mut hinges = HashMap::new();
    for entry in hinge_defs() {
        let first = body.bone(&entry.bones[0]);
        let along = (first.tail - first.head).normalize();
        let axis = match entry.axis {
            Axis::X => Vec3::X,
            Axis::Y => Vec3::Y,
            Axis::Z => -Vec3::Z,
            Axis::Bone => along,
            Axis::Elbow => along.cross(FORWARD).normalize(),
        };
        let axis = match entry.toward {
            Some(toward) => {
                let tip = entry.tip.map_or(first.tail, |t| body.bone(t).tail);
                let arm = tip - first.head;
                let moved = Quat::from_axis_angle(axis, 0.2) * arm - arm;
                if moved.dot(toward) >= 0.0 { axis } else { -axis }
            }
            // A turn with nothing to check it against (the twists) is the TS's turn seen in the mirror: the other way
            // about the axis brought over.
            None => -axis,
        };
        hinges.insert(entry.name, Hinge {
            bones: entry.bones.iter().map(|b| body.by_name[b]).collect(),
            axis, axes: Vec::new(), order: entry.order, fingers: false, bend: Bend::Same,
        });
    }
    for side in ["L", "R"] {
        hand(body, side, rng, &mut hinges);
    }
    hinges
}

// The hand's controls. `curl` closes a hand the way a hand closes, every finger at once: the middle joint (PIP) leads,
// the knuckle (MCP) a little behind it and the last joint (DIP) two thirds of the middle one, as the tendons couple
// them; the index least and the little finger most (a hand at rest lies in that cascade); the ring and little
// metacarpals bending at their base so the palm cups round what it closes on; each joint stopping where it stops (MCP
// 90, PIP 110, DIP 85). Opening past rest (negative) is nearly all at the knuckles: a PIP barely straightens past flat.
// Every finger of every person is a little different (VARY). Then one finger at a time, joint by joint (index1R is the
// knuckle of the right index), for a hand holding something; `cup` the ring and little metacarpals alone; and the
// thumb, which bends its own way.
//
// (The hand's turns have no `order` in the TS, which put them after everything else, rank 5; the thumb's base 1 and 2.)
fn hand(body: &Body, side: &str, rng: &mut Rng, hinges: &mut HashMap<String, Hinge>) {
    let idx = |n: &str| body.by_name.get(&format!("{n}.{side}")).copied();
    let b = |n: &str| body.bone(&format!("{n}.{side}"));
    // Toward the palm: the way the fingers already curl at rest.
    let wrist = b("wrist").head;
    let mut palm = (b("finger2-1").head - wrist).cross(b("finger5-1").head - wrist).normalize();
    let curls = (b("finger3-3").head - b("finger3-2").head).normalize() - (b("finger3-2").head - b("finger3-1").head).normalize();
    if palm.dot(curls) < 0.0 {
        palm = -palm;
    }
    let flat = |v: Vec3| (v - palm * palm.dot(v)).normalize();
    let middle = flat(b("finger3-2").head - b("finger3-1").head);
    // An axis across a bone (which way it runs: `d`) turned so that positive carries the bone toward the palm.
    let toward = |d: Vec3, axis: Vec3| {
        let moved = Quat::from_axis_angle(axis, 0.3) * d - d;
        if moved.dot(palm) >= 0.0 { axis } else { -axis }
    };
    let along = |bone: &Bone, next: Option<&Bone>| (next.map_or(bone.tail, |n| n.head) - bone.head).normalize();
    // Each bone of each finger bends about its own line across it, in the palm's plane (one line across the knuckles
    // for the whole hand is 20 degrees off square to the index and the little finger, which fan out from the middle:
    // they closed sideways, a splayed claw). The knuckle's line is taken square to the finger pulled CONVERGE of the
    // way into line with the middle finger, so that closing, the fingers come together and point at the heel of the
    // thumb (the scaphoid) as a real fist's do, instead of each folding down its own spread.
    // How far each finger is turned out from the middle one (radians, about `palm`).
    let mut spread = [0.0; 4];
    for (i, f) in [2, 3, 4, 5].into_iter().enumerate() {
        let d = flat(along(b(&format!("finger{f}-1")), Some(b(&format!("finger{f}-2")))));
        spread[i] = d.cross(middle).dot(palm).atan2(d.dot(middle));
    }
    let mut bones = Vec::new();
    let mut axes = Vec::new();
    for f in [2, 3, 4, 5] {
        for k in 1..=3 {
            let bone = b(&format!("finger{f}-{k}"));
            let next = (k < 3).then(|| b(&format!("finger{f}-{}", k + 1)));
            let d = along(bone, next);
            let square = if k == 1 { Quat::from_axis_angle(palm, spread[f - 2] * CONVERGE) * d } else { d };
            bones.push(idx(&format!("finger{f}-{k}")).unwrap());
            axes.push(toward(d, square.cross(palm).normalize()));
        }
    }
    // (people.py gives the hands their metacarpals; a file from before it does not)
    let mut cups = Vec::new();
    let mut cup_axes = Vec::new();
    for (i, m) in ["metacarpal3", "metacarpal4"].into_iter().enumerate() {
        if let Some(at) = idx(m) {
            let d = along(&body.bones[at], Some(b(&format!("finger{}-1", i + 4))));
            cups.push(at);
            cup_axes.push(toward(d, d.cross(palm).normalize()));
        }
    }
    let vary = [0; 4].map(|_| 1.0 + (rng.next() - 0.5) * VARY);
    // (The MakeHuman hand lies with its fingers spread; closing, they come together, CONVERGE of the way to the middle
    // finger by curl 30, in line with their knuckles' axes. Listed first, so that each finger is turned in before it
    // bends: the other way round it was swung sideways once bent.)
    let knuckles = [0, 3, 6, 9].map(|k| bones[k]);
    let all: Vec<usize> = knuckles.iter().chain(&bones).chain(&cups).copied().collect();
    let all_axes: Vec<Vec3> = [palm; 4].iter().chain(&axes).chain(&cup_axes).copied().collect();
    hinges.insert(format!("curl{side}"), Hinge {
        bones: all, axis: axes[4], axes: all_axes, order: 5, fingers: true, bend: Bend::Curl { spread, vary },
    });
    for (i, finger) in FINGERS.iter().enumerate() {
        for k in 1..=3 {
            hinges.insert(format!("{finger}{k}{side}"), Hinge {
                bones: vec![bones[i * 3 + k - 1]], axis: axes[i * 3 + k - 1], axes: Vec::new(), order: 5, fingers: true, bend: Bend::Same,
            });
        }
    }
    if !cups.is_empty() {
        hinges.insert(format!("cup{side}"), Hinge {
            bones: cups, axis: *cup_axes.last().unwrap(), axes: cup_axes, order: 5, fingers: true, bend: Bend::Cup,
        });
    }

    // The thumb. Its first bone (the metacarpal, in the heel of the hand) swings away from the palm (`thumbBase`) and
    // round in front of it to meet the fingers (`thumbIn`, about the line the hand lies along). Its other two joints
    // bend across the palm toward the little finger (`thumb`, the MCP 0.8 of the IP), about a line turned THUMB_TURN
    // round from the fingers' (the thumb's nail faces the side, not the back of the hand); bent the fingers' way it
    // folded down onto the palm and its tip went through them in a fist.
    let (t1, t2, t3) = (b("finger1-1"), b("finger1-2"), b("finger1-3"));
    let thumb_dir = along(t1, Some(t2));
    let turn = THUMB_TURN * RAD;
    let little = (b("finger5-1").head - t2.head).normalize();
    // (The side's sign is the TS's turned round: `across` comes out of a cross product, which the mirror turns
    // round, and `out` does not.)
    let sign = if side == "R" { -1.0 } else { 1.0 };
    let thumb_flex = |bone: &Bone, next: Option<&Bone>| {
        let d = along(bone, next);
        let across = d.cross(palm).normalize();
        let out = (palm - d * palm.dot(d)).normalize();
        let axis = (across * turn.cos() + out * (turn.sin() * sign)).normalize();
        let moved = Quat::from_axis_angle(axis, 0.3) * d - d;
        if moved.dot(little) >= 0.0 { axis } else { -axis }
    };
    let thumb_axes = vec![thumb_flex(t2, Some(t3)), thumb_flex(t3, None)];
    hinges.insert(format!("thumb{side}"), Hinge {
        bones: vec![idx("finger1-2").unwrap(), idx("finger1-3").unwrap()], axis: thumb_axes[1], axes: thumb_axes, order: 5,
        fingers: true, bend: Bend::Thumb,
    });
    hinges.insert(format!("thumbBase{side}"), Hinge {
        bones: vec![idx("finger1-1").unwrap()], axis: toward(thumb_dir, thumb_dir.cross(palm).normalize()), axes: Vec::new(),
        order: 1, fingers: true, bend: Bend::Same,
    });
    let lies = (b("finger3-1").head - wrist).normalize();
    let swung = Quat::from_axis_angle(lies, 0.3) * thumb_dir - thumb_dir;
    // (away from the palm first, then round: the other way round the swing carried it under the fingers)
    hinges.insert(format!("thumbIn{side}"), Hinge {
        bones: vec![idx("finger1-1").unwrap()], axis: if swung.dot(curls) >= 0.0 { lies } else { -lies }, axes: Vec::new(),
        order: 2, fingers: true, bend: Bend::Same,
    });
}

// --- materials -----------------------------------------------------------------------------------------------------
//
// What each kind of part is made of. Skin is not matte and not wet: a soft sheen that the lamp runs along. Eyes are
// the wettest thing on a face. Hair, brows and lashes are cards with see-through painted into them: hair is cut out
// hard so it sorts with everything else, the finer ones are blended.
struct Kind {
    rough: f32,
    // Babylon's specularIntensity, which scales the specular lobe; Bevy's reflectance sets F0 as its square.
    specular: f32,
    blend: bool,
    cut: Option<f32>,
    two_sided: bool,
    tint: Option<[f32; 3]>,
}

fn kind(name: &str) -> Kind {
    let k = |rough, specular| Kind { rough, specular, blend: false, cut: None, two_sided: false, tint: None };
    match name {
        "skin" => k(0.52, 0.55),
        // The same skin with the blood gone out of it.
        "deadSkin" => Kind { tint: Some([0.74, 0.77, 0.7]), ..k(0.62, 0.35) },
        "eyes" => Kind { blend: true, ..k(0.08, 1.0) },
        // Teeth as they are in a lit room, ivory (npc.ts put this over person.ts's tint, which was for a mouth seen in
        // a dark cold room).
        "teeth" => Kind { blend: true, tint: Some([0.93, 0.9, 0.82]), ..k(0.3, 0.6) },
        // (Inside a mouth the lips, cheeks and teeth shade the tongue, and nothing here draws that shade: it is in its
        // colour.)
        "tongue" => Kind { tint: Some([0.55, 0.42, 0.42]), ..k(0.35, 0.5) },
        "brows" | "lashes" => Kind { blend: true, ..k(0.8, 0.1) },
        "hair" => Kind { cut: Some(0.35), two_sided: true, ..k(0.6, 0.25) },
        "cloth" => Kind { two_sided: true, ..k(0.85, 0.2) },
        _ => panic!("no kind {name}"),
    }
}

// Everyone the game can show, read once, and the materials and meshes they share.
#[derive(Resource, Default)]
pub struct People {
    pub bodies: HashMap<String, Arc<Body>>,
    materials: HashMap<String, Handle<StandardMaterial>>,
    meshes: HashMap<String, Vec<Option<Handle<Mesh>>>>,
    bindposes: HashMap<String, Handle<SkinnedMeshInverseBindposes>>,
}

impl People {
    // Each body's file, with a bone put in the middle of each long segment (ragdoll.rs), which is how every person
    // in the sandbox is made (npc.ts prepare).
    pub fn load(&mut self, names: &[&str]) {
        for &n in names {
            if !self.bodies.contains_key(n) {
                let body = ragdoll::with_mid_bones(read_body(&format!("people/{n}.bin")));
                self.bodies.insert(n.to_string(), Arc::new(body));
            }
        }
    }

    // One material for each kind of part with each texture: two people in the same suit share it.
    fn material(&mut self, part: &Part, dead: bool, assets: &AssetServer, materials: &mut Assets<StandardMaterial>) -> Handle<StandardMaterial> {
        let name = if dead && part.kind == "skin" { "deadSkin" } else { part.kind.as_str() };
        let key = format!("{name}:{}", part.texture.as_ref().map_or("-", |t| t.file.as_str()));
        if let Some(m) = self.materials.get(&key) {
            return m.clone();
        }
        let k = kind(name);
        let mut m = StandardMaterial {
            metallic: 0.0,
            perceptual_roughness: k.rough,
            reflectance: 0.5 * k.specular.sqrt(),
            double_sided: k.two_sided,
            cull_mode: if k.two_sided { None } else { Some(bevy::render::render_resource::Face::Back) },
            ..default()
        };
        match &part.texture {
            Some(t) => {
                m.base_color_texture = Some(assets.load(format!("people/{}", t.file)));
                if t.alpha {
                    if let Some(cut) = k.cut {
                        m.alpha_mode = AlphaMode::Mask(cut);
                    } else if k.blend {
                        m.alpha_mode = AlphaMode::Blend;
                    }
                }
            }
            None => m.base_color = Color::linear_rgb(0.5, 0.5, 0.5),
        }
        if let Some([r, g, b]) = k.tint {
            m.base_color = Color::linear_rgb(r, g, b);
        }
        let h = materials.add(m);
        self.materials.insert(key, h.clone());
        h
    }

    // Each part's mesh, skinned: its own corners and its triangles renumbered onto them (Bevy draws one material a
    // mesh, where Babylon drew submeshes of one). Made once a body.
    fn meshes(&mut self, body: &Body, meshes: &mut Assets<Mesh>) -> Vec<Option<Handle<Mesh>>> {
        if let Some(m) = self.meshes.get(&body.name) {
            return m.clone();
        }
        let made: Vec<_> = body.parts.iter().map(|p| (!p.under).then(|| meshes.add(part_mesh(body, p)))).collect();
        self.meshes.insert(body.name.clone(), made.clone());
        made
    }

    fn bindposes(&mut self, body: &Body, poses: &mut Assets<SkinnedMeshInverseBindposes>) -> Handle<SkinnedMeshInverseBindposes> {
        self.bindposes
            .entry(body.name.clone())
            .or_insert_with(|| poses.add(SkinnedMeshInverseBindposes::from(body.bones.iter().map(|b| Mat4::from_translation(-b.head)).collect::<Vec<_>>())))
            .clone()
    }
}

fn part_mesh(body: &Body, p: &Part) -> Mesh {
    let range = p.vertex_start..p.vertex_start + p.vertex_count;
    let start = p.vertex_start as u32;
    let index: Vec<u32> = body.index[p.index_start..p.index_start + p.index_count].iter().map(|&i| i - start).collect();
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, body.position[range.clone()].to_vec())
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, body.normal[range.clone()].to_vec())
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, body.uv[range.clone()].to_vec())
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, bevy::mesh::VertexAttributeValues::Uint16x4(body.joints[range.clone()].to_vec()))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, body.weights[range].iter().map(|w| w.map(|x| x as f32 / 255.0)).collect::<Vec<[f32; 4]>>())
        .with_inserted_indices(Indices::U32(index))
}

// A person of body `name` standing at `at` (the floor under them), facing `yaw` as the TS measured it (radians from
// its +Z, ahead in the TS), posed in `pose`. The ragdoll's segments are fitted and placed on them as they stand
// (ragdoll.rs), and their insides hung on their bones, hidden (anatomy.rs).
#[allow(clippy::too_many_arguments)]
pub fn spawn(
    commands: &mut Commands,
    people: &mut People,
    assets: &AssetServer,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    bindposes: &mut Assets<SkinnedMeshInverseBindposes>,
    insides: &mut crate::anatomy::Anatomy,
    rng: &mut Rng,
    name: &str,
    label: String,
    mass: f32,
    at: Vec3,
    yaw: f32,
    pose: Pose,
) -> Entity {
    let body = people.bodies[name].clone();
    let hinges = calibrate(&body, rng);
    let halves = body
        .bones
        .iter()
        .enumerate()
        .filter(|(_, b)| is_half(&b.name))
        .map(|(i, b)| (i, body.by_name[&b.name.replacen("h.", ".", 1)]))
        .collect();
    let root_at = Transform::from_translation(at).with_rotation(Quat::from_rotation_y(-yaw));
    let root = commands.spawn((root_at, Visibility::default(), Name::new(label.clone()))).id();
    let pelvis = body.bone("root").head;
    let frame = commands.spawn((Transform::from_translation(pelvis), Visibility::default(), ChildOf(root))).id();
    let space = commands.spawn((Transform::from_translation(-pelvis), Visibility::default(), ChildOf(frame))).id();
    let mut joints: Vec<Entity> = Vec::with_capacity(body.bones.len());
    for b in &body.bones {
        let (parent, from) = match b.parent {
            Some(p) => (joints[p], body.bones[p].head),
            None => (space, Vec3::ZERO),
        };
        joints.push(commands.spawn((Transform::from_translation(b.head - from), Visibility::default(), ChildOf(parent))).id());
    }
    let skin = SkinnedMesh { inverse_bindposes: people.bindposes(&body, bindposes), joints: joints.clone() };
    let part_meshes = people.meshes(&body, meshes);
    let mut parts = Vec::new();
    for (i, p) in body.parts.iter().enumerate() {
        let Some(mesh) = &part_meshes[i] else { continue };
        let material = people.material(p, false, assets, materials);
        parts.push((i, commands.spawn((Mesh3d(mesh.clone()), MeshMaterial3d(material), skin.clone(), ChildOf(space))).id()));
    }
    let mut person = Person {
        body: body.clone(),
        label,
        height: body.height,
        mass,
        hinges,
        halves,
        pose: Vec::new(),
        posed: Posed { local: vec![Quat::IDENTITY; body.bones.len()], frame: Transform::from_translation(pelvis) },
        frame,
        joints: joints.clone(),
        parts,
        insides: Entity::PLACEHOLDER,
        segments: Vec::new(),
    };
    person.posed = person.apply(&pose, Some(FEET));
    person.pose = pose;
    person.segments = ragdoll::segments(&person, &root_at, mass);
    person.insides = insides.build(commands, meshes, materials, &body, skin, space);
    commands.entity(root).insert(person);
    root
}

fn is_half(name: &str) -> bool {
    // /^finger\d-\dh\./
    let b = name.as_bytes();
    name.starts_with("finger") && b.len() > 10 && b[6].is_ascii_digit() && b[7] == b'-' && b[8].is_ascii_digit() && &name[9..11] == "h."
}

// The skeleton put where the pose says: each bone's turn, and the frame. Every frame, for whoever was posed since.
fn pose_people(people: Query<&Person, Changed<Person>>, mut transforms: Query<&mut Transform>) {
    for p in &people {
        for (i, &e) in p.joints.iter().enumerate() {
            if let Ok(mut t) = transforms.get_mut(e) {
                t.rotation = p.posed.local[i];
            }
        }
        if let Ok(mut t) = transforms.get_mut(p.frame) {
            *t = p.posed.frame;
        }
    }
}

pub fn plugin(app: &mut App) {
    app.init_resource::<People>().add_systems(PostUpdate, pose_people.before(TransformSystems::Propagate));
}

#[test]
fn halves_named() {
    assert!(is_half("finger2-1h.L"));
    assert!(!is_half("finger2-1.L"));
}
