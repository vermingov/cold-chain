// A body's bones as rigid bodies in Rapier, always (src/sandbox/ragdoll.ts): muscles (motor.rs) hold them in a pose,
// and what the muscles cannot hold, gravity and blows move.
//
// Each segment of the body (pelvis, belly, chest, head, and every limb in halves) is one body in the physics world,
// joined to the next at the joint between them with the range of movement a real joint has. A long bone is two bodies
// locked together at its middle: when it breaks, the lock is let go and the limb bends where it broke, under its own
// weight.
//
// The people's skeletons have no bone in the middle of a femur, so one is put there (with_mid_bones) before a person
// is made, and the flesh of the lower half of the limb is given to it.

use bevy::prelude::*;
use bevy_rapier3d::prelude::*;

use crate::person::{Body, Bone, Person, Posed};

// Long segments: their first bone, the twist bone that carries most of their flesh, and the bone at their far end.
const LONG: [[&str; 3]; 4] = [
    ["upperarm01", "upperarm02", "lowerarm01"],
    ["lowerarm01", "lowerarm02", "wrist"],
    ["upperleg01", "upperleg02", "lowerleg01"],
    ["lowerleg01", "lowerleg02", "foot"],
];
// Of a segment's length, either side of its middle, over which the flesh is shared between the halves.
const BLEND: f32 = 0.08;

pub fn mid_of(first: &str, side: &str) -> String {
    format!("mid-{first}.{side}")
}

// A body with a bone in the middle of each long segment.
pub fn with_mid_bones(mut body: Body) -> Body {
    struct Mid {
        name: String,
        twist: String,
        first: String,
        next: String,
        from: Vec3,
        to: Vec3,
    }
    // Parents by name while the order changes.
    let parent_of: Vec<Option<String>> = body.bones.iter().map(|b| b.parent.map(|p| body.bones[p].name.clone())).collect();
    let old: Vec<String> = body.bones.iter().map(|b| b.name.clone()).collect();
    let mut bones: Vec<(Bone, Option<String>)> = body.bones.drain(..).zip(parent_of).collect();
    let mut mids = Vec::new();
    for side in ["L", "R"] {
        for [first, twist, next] in LONG {
            let find = |bones: &[(Bone, Option<String>)], n: &str| bones.iter().position(|(b, _)| b.name == n).unwrap();
            let a = bones[find(&bones, &format!("{first}.{side}"))].0.head;
            let n = bones[find(&bones, &format!("{next}.{side}"))].0.head;
            let at = find(&bones, &format!("{twist}.{side}"));
            let mid = Mid {
                name: mid_of(first, side),
                twist: format!("{twist}.{side}"),
                first: format!("{first}.{side}"),
                next: format!("{next}.{side}"),
                from: a,
                to: n,
            };
            bones.insert(at + 1, (Bone { name: mid.name.clone(), parent: None, head: (a + n) / 2.0, tail: n }, Some(mid.twist.clone())));
            mids.push(mid);
        }
    }
    for m in &mids {
        bones.iter_mut().find(|(b, _)| b.name == m.next).unwrap().1 = Some(m.name.clone());
    }
    let names: Vec<String> = bones.iter().map(|(b, _)| b.name.clone()).collect();
    let index = |n: &str| names.iter().position(|x| x == n).unwrap();
    body.bones = bones.into_iter().map(|(mut b, p)| {
        b.parent = p.map(|p| index(&p));
        b
    }).collect();
    body.index_by_name();

    // Each corner's bones by their new numbers, and the flesh past the middle of a long segment given to its mid bone.
    let remap: Vec<u16> = old.iter().map(|n| index(n) as u16).collect();
    for j in &mut body.joints {
        *j = j.map(|i| remap[i as usize]);
    }
    let owners: Vec<(u16, &Mid, u16)> = mids
        .iter()
        .flat_map(|m| {
            let mid = index(&m.name) as u16;
            [(index(&m.first) as u16, m, mid), (index(&m.twist) as u16, m, mid)]
        })
        .collect();
    for v in 0..body.position.len() {
        for k in 0..4 {
            let Some(&(_, m, mid)) = owners.iter().find(|o| o.0 == body.joints[v][k]) else { continue };
            if body.weights[v][k] == 0 {
                continue;
            }
            let d = m.to - m.from;
            let t = (body.position[v] - m.from).dot(d) / d.length_squared();
            let share = ((t - 0.5 + BLEND) / (2.0 * BLEND)).clamp(0.0, 1.0);
            if share <= 0.0 {
                continue;
            }
            let free = (0..4).find(|&j| body.weights[v][j] == 0);
            if share >= 1.0 || free.is_none() {
                if share >= 0.5 || free.is_none() {
                    body.joints[v][k] = mid;
                }
                continue;
            }
            let free = free.unwrap();
            let moved = (body.weights[v][k] as f32 * share).round() as u8;
            body.weights[v][k] -= moved;
            body.joints[v][free] = mid;
            body.weights[v][free] = moved;
        }
    }
    body
}

// --- the segments --------------------------------------------------------------------------------------------------
//
// name, the bone that leads it, its share of the body's weight, its shape, and the joint to its parent. A joint is
// given the way a physiotherapist measures one, in degrees from the rest pose: `bend` is the pose control (person.rs)
// that bends it and how far either way, `side` the control that swings it out of that plane (None where none does,
// as in a knee) and how far, `twist` how far it turns about the limb's own length, `hinge` the line it bends about
// (across the body, X, or across the limb and the way the body faces, Elbow), and `muscle` the most the muscles across
// it turn it with, in N m. Which way each control turns the joint is read off the skeleton, not written down here: a
// sign typed by hand once let every knee bend forward. `neutral` is where a joint's range is measured from when that is
// not the rest pose: the shoulder's from the arm hanging, not held out as the model stands.
//
// The ranges are the active ranges of a young adult (AAOS 1965; Norkin and White, Measurement of Joint Motion): elbow
// 0-145 and a few degrees past straight, the forearm turning 80 either way, all of it at the wrist's joint, knee 0-140
// and 5 past straight with almost no give sideways, hip 120 forward and 20 back, 45 out and 30 in, ankle 20 up and 50
// down, the neck 50 forward and 60 back, the lower back 45 forward, 15 back, 15 to the side and 10 round, the upper
// back 35, 15, 20 and 30. (The TS's notes on why each is so are in ragdoll.ts beside the same table.)

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Hinge {
    X,
    Elbow,
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ShapeKind {
    Capsule,
    Box,
    Sphere,
}

// What collides with what (ragdoll.ts): the trunk, the halves of the arms and legs at the trunk, and the rest of them.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Group {
    Trunk,
    Root,
    Limb,
}

#[derive(Clone, Debug)]
pub struct Joint {
    pub parent: String,
    pub hinge: Hinge,
    // Two halves of one bone locked together: no range, no muscle.
    pub lock: bool,
    pub bend: (Option<String>, f32, f32),
    pub side: (Option<String>, f32, f32),
    pub twist: f32,
    pub muscle: f32,
    pub neutral: Vec<(String, f32)>,
}

pub struct SegmentDef {
    pub name: String,
    pub bone: String,
    pub share: f32,
    pub shape: ShapeKind,
    pub joint: Option<Joint>,
}

fn j(parent: &str, hinge: Hinge, bend: (Option<String>, f32, f32), side: (Option<String>, f32, f32), twist: f32, muscle: f32,
     neutral: Vec<(String, f32)>) -> Option<Joint> {
    Some(Joint { parent: parent.into(), hinge, lock: false, bend, side, twist, muscle, neutral })
}

fn lock(parent: &str, hinge: Hinge) -> Option<Joint> {
    Some(Joint { parent: parent.into(), hinge, lock: true, bend: (None, 0.0, 0.0), side: (None, 0.0, 0.0), twist: 0.0, muscle: 0.0, neutral: Vec::new() })
}

// Every segment, the trunk first and each parent before its children.
pub fn table() -> Vec<SegmentDef> {
    use Hinge::{Elbow, X};
    use ShapeKind::*;
    let c = |s: &str| Some(s.to_string());
    let def = |name: &str, bone: &str, share, shape, joint| SegmentDef { name: name.into(), bone: bone.into(), share, shape, joint };
    let mut out = vec![
        def("pelvis", "root", 0.14, Box, None),
        def("belly", "spine03", 0.12, Box, j("pelvis", X, (c("spineFlex"), -15.0, 45.0), (c("spineSide"), -15.0, 15.0), 10.0, 300.0, vec![])),
        def("chest", "spine01", 0.22, Box, j("belly", X, (c("spineFlex"), -15.0, 35.0), (c("spineSide"), -20.0, 20.0), 30.0, 260.0, vec![])),
        def("head", "neck01", 0.08, Sphere, j("chest", X, (c("neckFlex"), -60.0, 50.0), (c("headTilt"), -40.0, 40.0), 75.0, 60.0, vec![])),
    ];
    for s in ["L", "R"] {
        let p = |n: &str| format!("{n}{s}");
        let k = |n: &str| Some(format!("{n}{s}"));
        let b = |n: &str| format!("{n}.{s}");
        out.extend([
            // (In across the body as far as the shoulder blade sliding forward takes it, which this has no bone for: a
            // hand reaching the other arm needs it.)
            def(&format!("upperarm{s}"), &b("upperarm01"), 0.014, Capsule,
                j("chest", X, (k("shoulderFlex"), -60.0, 175.0), (k("shoulderAbduct"), -50.0, 165.0), 85.0, 110.0,
                  vec![(format!("shoulderAbduct{s}"), -36.0), (format!("shoulderFlex{s}"), -26.0)])),
            def(&format!("upperarm2{s}"), &mid_of("upperarm01", s), 0.013, Capsule, lock(&p("upperarm"), X)),
            def(&format!("forearm{s}"), &b("lowerarm01"), 0.009, Capsule, j(&p("upperarm2"), Elbow, (k("elbow"), -5.0, 145.0), (None, -3.0, 3.0), 5.0, 80.0, vec![])),
            def(&format!("forearm2{s}"), &mid_of("lowerarm01", s), 0.008, Capsule, lock(&p("forearm"), Elbow)),
            def(&format!("hand{s}"), &b("wrist"), 0.006, Box, j(&p("forearm2"), Elbow, (k("wrist"), -75.0, 75.0), (None, -25.0, 25.0), 75.0, 25.0, vec![])),
            def(&format!("thigh{s}"), &b("upperleg01"), 0.06, Capsule, j("pelvis", X, (k("hipFlex"), -20.0, 120.0), (k("hipAbduct"), -30.0, 45.0), 40.0, 320.0, vec![])),
            def(&format!("thigh2{s}"), &mid_of("upperleg01", s), 0.05, Capsule, lock(&p("thigh"), X)),
            def(&format!("shin{s}"), &b("lowerleg01"), 0.023, Capsule, j(&p("thigh2"), X, (k("knee"), -5.0, 140.0), (None, -3.0, 3.0), 5.0, 280.0, vec![])),
            def(&format!("shin2{s}"), &mid_of("lowerleg01", s), 0.02, Capsule, lock(&p("shin"), X)),
            def(&format!("foot{s}"), &b("foot"), 0.014, Box, j(&p("shin2"), X, (k("ankle"), -50.0, 20.0), (None, -10.0, 10.0), 15.0, 200.0, vec![])),
        ]);
    }
    out
}

fn is_trunk(name: &str) -> bool {
    matches!(name, "pelvis" | "belly" | "chest" | "head")
}

// The halves of the arms and legs at the trunk: /^(upperarm|thigh)[LR]$/.
fn is_root(name: &str) -> bool {
    matches!(name, "upperarmL" | "upperarmR" | "thighL" | "thighR")
}

// A segment's shape is this much of the outside of what it carries, flesh and clothes: the rest is give. (Fitted to
// the middle of the skin at four fifths of it, a body lying down had its back, its trousers and its shoe soles 4 to 8
// cm into the floor, and a hand on the belly sank into the shirt.)
const THIN: f32 = 0.95;
const GARMENT: f32 = 0.015; // m: the most a segment's shape is grown for the clothes over it

// A segment's shape in its own frame, whose origin is its bone's head and whose axes are the body's at rest.
#[derive(Clone, Debug)]
pub enum Shape {
    Capsule { a: Vec3, b: Vec3, r: f32 },
    Cuboid { centre: Vec3, half: Vec3, rotation: Quat },
    Ball { centre: Vec3, r: f32 },
}

#[derive(Clone, Debug)]
pub struct Segment {
    pub name: String,
    // The bone that leads it, by index into the body's bones.
    pub bone: usize,
    pub mass: f32,
    pub group: Group,
    pub limb: bool,
    pub parent: Option<usize>,
    pub joint: Option<Joint>,
    // Its bone's head at rest, in the mesh's space; from there to its far end; the middle of its shape; how thick.
    pub head: Vec3,
    pub end: Vec3,
    pub centre: Vec3,
    pub radius: f32,
    pub shape: Shape,
    // Where its body is put: its bone in the world as the person stands at spawn (ragdoll.ts _place).
    pub rest: Transform,
}

// Every segment fitted to this person's flesh and clothes and placed where their bones are as they stand, `root` the
// person's root in the world.
pub fn segments(person: &Person, root: &Transform, mass: f32) -> Vec<Segment> {
    let body = &person.body;
    let defs = table();
    // Which segment each bone's flesh moves with: its own, or the nearest it hangs from.
    let segment_of: Vec<usize> = body
        .bones
        .iter()
        .map(|b| {
            let mut at = Some(b);
            while let Some(x) = at {
                if let Some(k) = defs.iter().position(|d| d.bone == x.name) {
                    return k;
                }
                at = x.parent.map(|p| &body.bones[p]);
            }
            0
        })
        .collect();
    let flesh = flesh_of(body, &segment_of, defs.len(), "skin");
    let clothes = flesh_of(body, &segment_of, defs.len(), "cloth");
    let abs = person.absolute(&person.posed.local);
    let pelvis = body.bone("root").head;
    let mut out: Vec<Segment> = Vec::new();
    for (k, d) in defs.iter().enumerate() {
        let bone = body.by_name[&d.bone];
        let head = body.bones[bone].head;
        let end = end_of(&defs, d, body, head);
        let pts: Vec<Vec3> = flesh[k].iter().map(|p| *p - head).collect();
        let cloth: Vec<Vec3> = clothes[k].iter().map(|p| *p - head).collect();
        let (shape, centre, radius) = shape(d, &pts, &cloth, end, head, body, &defs);
        let (r, p) = abs[bone];
        let in_root = Transform::from_translation(person.posed.frame.translation + person.posed.frame.rotation * (p - pelvis))
            .with_rotation(person.posed.frame.rotation * r);
        out.push(Segment {
            name: d.name.clone(),
            bone,
            mass: mass * d.share,
            group: if is_trunk(&d.name) { Group::Trunk } else if is_root(&d.name) { Group::Root } else { Group::Limb },
            limb: !is_trunk(&d.name) && !is_root(&d.name),
            parent: d.joint.as_ref().map(|j| defs.iter().position(|x| x.name == j.parent).unwrap()),
            joint: d.joint.clone(),
            head,
            end,
            centre,
            radius,
            shape,
            rest: root.mul_transform(in_root),
        });
    }
    out
}

// The rest-space corners of the skin (`kind` "cloth": the clothes) that move with each segment, for its shape: each
// corner goes with the bone that carries most of it.
fn flesh_of(body: &Body, segment_of: &[usize], n: usize, kind: &str) -> Vec<Vec<Vec3>> {
    let mut out = vec![Vec::new(); n];
    for part in body.parts.iter().filter(|p| p.kind == kind) {
        for v in part.vertex_start..part.vertex_start + part.vertex_count {
            let (mut best, mut bone) = (0, 0);
            for k in 0..4 {
                if body.weights[v][k] > best {
                    best = body.weights[v][k];
                    bone = body.joints[v][k];
                }
            }
            out[segment_of[bone as usize]].push(body.position[v]);
        }
    }
    out
}

// From a segment's bone head to its far end, in rest space: the next segment of its limb's head, or its bone's tail.
fn end_of(defs: &[SegmentDef], d: &SegmentDef, body: &Body, head: Vec3) -> Vec3 {
    let next = |s: &str| match s {
        "upperarm" => Some("upperarm2"),
        "upperarm2" => Some("forearm"),
        "forearm" => Some("forearm2"),
        "forearm2" => Some("hand"),
        "thigh" => Some("thigh2"),
        "thigh2" => Some("shin"),
        "shin" => Some("shin2"),
        "shin2" => Some("foot"),
        _ => None,
    };
    if let Some(side) = d.name.strip_suffix('L').or_else(|| d.name.strip_suffix('R')) {
        let s = &d.name[side.len()..];
        if let Some(n) = next(side) {
            let to = defs.iter().find(|x| x.name == format!("{n}{s}")).unwrap();
            return body.bone(&to.bone).head - head;
        }
    }
    body.bone(&d.bone).tail - head
}

// At fraction `f` of a sorted list.
fn at(list: &[f32], f: f32) -> f32 {
    list[((list.len() - 1) as f32 * f).floor() as usize]
}

fn sorted(mut v: Vec<f32>) -> Vec<f32> {
    v.sort_by(f32::total_cmp);
    v
}

fn shape(d: &SegmentDef, pts: &[Vec3], cloth: &[Vec3], end: Vec3, head: Vec3, body: &Body, defs: &[SegmentDef]) -> (Shape, Vec3, f32) {
    if d.shape == ShapeKind::Capsule {
        let axis = end.normalize();
        let length = end.length();
        let out = |list: &[Vec3], own: &dyn Fn(&Vec3) -> bool| {
            sorted(list.iter().filter(|p| own(p)).map(|p| {
                let t = p.dot(axis).clamp(0.0, length);
                (*p - axis * t).length()
            }).collect())
        };
        // (An upper arm's half at the shoulder carries the shoulder's cap and the armpit's skin, which are the trunk's
        // to stand off: fitted to them, it stood 3 to 4 cm into the side of the belly with the arm hanging. Its arm is
        // what lies past the first third.)
        let arm = d.name == "upperarmL" || d.name == "upperarmR";
        let own = |p: &Vec3| !arm || p.dot(axis) > length / 3.0;
        let skin = out(pts, &own);
        let worn = out(cloth, &own);
        // Most of the way out, not all of it (a fold or a cuff standing off is not what the limb rests on), and what
        // is worn over it as far as it fits close: a baggy sleeve or a hoodie's hem is not something to stand on.
        let over = if worn.is_empty() { 0.0 } else { (at(&worn, 0.5) - at(&skin, 0.5)).clamp(0.0, GARMENT) };
        // (A thigh's half at the hip carries the buttock, well off the bone: taken all the way out, the thighs stood
        // pressed into each other.)
        let f = if arm { 0.5 } else if is_root(&d.name) { 0.7 } else { 0.9 };
        let r = ((at(&skin, f) + over) * THIN).max(0.025);
        let shape = Shape::Capsule { a: axis * r.min(length / 2.0), b: axis * (length - r).max(length / 2.0), r };
        return (shape, end * 0.5, r);
    }
    // Its box, leaving out the outermost few corners each way (a collar, a hood's peak), but for a foot, whose shoe's
    // sole and toe are what it stands and lies on. Then out over what is worn on it, as far as a close fit goes (a
    // shoe's sole and toe all the way).
    let foot = d.name.starts_with("foot");
    let edge = if foot { 0.0 } else { 0.02 };
    let fit = if foot { 0.05 } else { GARMENT };
    let cut = |list: &[Vec3], k: usize, f: f32| at(&sorted(list.iter().map(|p| p[k]).collect()), f);
    let (mut lo, mut hi) = (Vec3::ZERO, Vec3::ZERO);
    for k in 0..3 {
        lo[k] = cut(pts, k, edge);
        hi[k] = cut(pts, k, 1.0 - edge);
        if cloth.is_empty() {
            continue;
        }
        lo[k] = (lo[k] - fit).max(lo[k].min(cut(cloth, k, edge)));
        hi[k] = (hi[k] + fit).min(hi[k].max(cut(cloth, k, 1.0 - edge)));
    }
    // A trunk box ends where the next one up begins: the belly's flesh reaches up the flanks past the chest's bone, and
    // its box, square, stood out there into the upper arms hanging beside the ribs.
    let next = match d.name.as_str() {
        "pelvis" => Some("belly"),
        "belly" => Some("chest"),
        _ => None,
    };
    if let Some(n) = next {
        let bone = &defs.iter().find(|x| x.name == n).unwrap().bone;
        hi.y = hi.y.min(body.bone(bone).head.y - head.y);
    }
    let centre = (lo + hi) * 0.5;
    let size = hi - lo;
    if d.shape == ShapeKind::Sphere {
        // The skull, from the corners above where the head sits on the neck, round the middle of them. (Fitted to the
        // whole of head and neck, it sat low and the back of a head lying on the floor went 11 cm into it.)
        let above = body.bone("head").head.y - head.y;
        let skull: Vec<Vec3> = pts.iter().copied().filter(|p| p.y > above).collect();
        let mid = skull.iter().sum::<Vec3>() / skull.len() as f32;
        let reach = sorted(skull.iter().map(|p| p.distance(mid)).collect());
        let r = reach[(reach.len() as f32 * 0.75).floor() as usize] * THIN;
        return (Shape::Ball { centre: mid, r }, mid, r);
    }
    if d.name.starts_with("hand") {
        return hand(pts);
    }
    let extent = Vec3::new(size.x * THIN, size.y * if foot { 1.0 } else { 0.92 }, size.z * if foot { 1.0 } else { THIN });
    (Shape::Cuboid { centre, half: extent * 0.5, rotation: Quat::IDENTITY }, centre, size.x.min(size.z) * 0.5 * THIN)
}

// A hand's box, laid along the hand: its length, its breadth across the palm and thumb, and its thickness, the three
// ways its flesh lies (the axes of its spread). Square to the body, a hand held out at rest slanting forward and in
// made a box 10 x 12 x 13 cm round a hand under 5 cm thick, and nothing it reached for came nearer its middle than 5
// to 7 cm: a hand on a belly or a wounded arm stopped short of it.
fn hand(pts: &[Vec3]) -> (Shape, Vec3, f32) {
    let mid = pts.iter().sum::<Vec3>() / pts.len() as f32;
    let mut c = Mat3::ZERO;
    for p in pts {
        let d = *p - mid;
        c += Mat3::from_cols(d * d.x, d * d.y, d * d.z) / pts.len() as f32;
    }
    // The two widest ways by power iteration, the third square to both. (Started from the TS's up and ahead.)
    let mut axes: Vec<Vec3> = Vec::new();
    for k in 0..2 {
        let mut v = if k == 1 { Vec3::NEG_Z } else { Vec3::Y };
        for _ in 0..60 {
            if k == 1 {
                v -= axes[0] * v.dot(axes[0]);
            }
            v = (c * v).normalize();
        }
        if k == 1 {
            v = (v - axes[0] * v.dot(axes[0])).normalize();
        }
        axes.push(v);
    }
    axes.push(axes[0].cross(axes[1]).normalize());
    // (Across the palm, not out to the thumb's tip held away from it as the model stands: a hand that closes or holds
    // something has its thumb in.)
    let (mut lo, mut hi) = (Vec3::ZERO, Vec3::ZERO);
    for i in 0..3 {
        let along = sorted(pts.iter().map(|p| (*p - mid).dot(axes[i])).collect());
        let edge = if i == 1 { 0.08 } else { 0.02 };
        lo[i] = at(&along, edge);
        hi[i] = at(&along, 1.0 - edge);
    }
    let q = Quat::from_mat3(&Mat3::from_cols(axes[0], axes[1], axes[2]));
    let centre = mid + q * ((lo + hi) * 0.5);
    let extent = (hi - lo) * THIN;
    (Shape::Cuboid { centre, half: extent * 0.5, rotation: q }, centre, extent.z / 2.0)
}

// --- the bodies ------------------------------------------------------------------------------------------------------
//
// Collision bits. A person's own segments meet each other as they would anyone else's (a hand on the belly, one knee on
// the other, an arm against the chest or across the other), all but neighbours at a joint, whose joint leaves them be
// (Rapier's per-joint switch, `contacts_enabled(false)`; for both halves of the long bones either side of an elbow or a
// knee, the free joints of `apart`). The shapes are fitted so that no other pair meets standing at rest (the upper arm
// off the shoulder's bulge, the belly's box below the chest's). (The TS gave each person a bit of their own as well, for
// pieces cut off: dismember.rs's, when it comes.)
use bevy_rapier3d::geometry::Group as Bits;
pub const TRUNK: Bits = Bits::GROUP_2; // pelvis, belly, chest, head
pub const ROOTS: Bits = Bits::GROUP_3; // upper arms and thighs, their halves at the trunk
pub const LIMBS: Bits = Bits::GROUP_4; // the rest of the arms and legs
pub const PIECE: Bits = Bits::GROUP_5; // a piece cut off, not yet clear of its stump

// Nm of resistance in every joint: muscle with a mind behind it, without, and none.
pub const ALIVE: f32 = 18.0;
pub const OUT: f32 = 5.0;
pub const DEAD: f32 = 1.2;
// A muscle as a spring (hold): N m per radian off its aim for each N m it has (all of it at a fifth of a radian off), and
// its damping, of critical for what the joint swings (`swing`, kg m2, everything past the joint about it).
const STIFF: f32 = 5.0;
const DAMP: f32 = 0.8;
const AXIS_SHARE: [f32; 3] = [1.0, 0.6, 0.8]; // hinge, twist, side: the muscle across each
// A broken shaft's two ends grating on each other in the flesh, N m per kg the far half weighs: it hangs and swings at
// the break, catching a little, whatever the muscles above are doing (the tone is the joints', not the break's).
const GRATE: f32 = 1.2;
// The shoulder's capsule (shoulders): N m per radian past its cone, and N m s per radian of damping, as stiff and damped as
// a push given for a whole 1/120 s step can be on the arm's 0.3 kg m2 swing about the shoulder (about 30 rad/s, half of
// critical). (At 300 N m per radian a shoulder's own muscle force took the arm 30 degrees past it.)
const CAPSULE: [f32; 2] = [900.0, 15.0];
// N m s per radian of a joint's friction (the tone) against moving at all, up to its N m: as near a hard stop of the
// joint's turning as Rapier's soft velocity row gives, the N m being what limits it (Havok's axis friction).
const STICK: f32 = 1000.0;
// Where a turn of the spine or neck is spread over every bone of it on screen, so a bow is a curve.
const SPREAD: [&str; 3] = ["belly", "chest", "head"];
const ANGULAR: [JointAxis; 3] = [JointAxis::AngX, JointAxis::AngY, JointAxis::AngZ];

// A turn `q` (in a joint's parent's frame) as the joint's three angles, `frame` the joint's axes (the hinge it bends
// about, the limb's own length, and across both) as a turn of the parent's. Rapier's generic joint reads a turn on each
// axis as twice the arcsine of the quaternion's part along it (joint_constraint_helper.rs motor_angular; its limits the
// same angle, measured from the middle of the range), not as Havok's three turns one after another that ragdoll.ts
// worked out: for a turn about one axis they are the angle itself, and a target is put in the measure the motor reads.
pub fn joint_angles(q: Quat, frame: Quat) -> [f32; 3] {
    let mut l = frame.inverse() * q * frame;
    if l.w < 0.0 {
        l = -l;
    }
    [l.x, l.y, l.z].map(|c| 2.0 * c.clamp(-1.0, 1.0).asin())
}

// What a muscle is sending its joint's motors now, so that nothing is sent that has not changed.
#[derive(Clone, Default)]
struct Motor {
    on: bool,
    made: bool,
    f: f32,
    t: [f32; 3],
    dirty: bool,
}

// A segment as a body in the physics world (the person's `Segment`, fitted, is `def`).
#[derive(Clone)]
pub struct Seg {
    pub def: Segment,
    pub entity: Entity,
    // The joint's friction, a joint of its own beside the segment's (its motors are the muscles').
    friction: Option<Entity>,
    // Where its body is (its bone's head, and its turn), and how it moves: read after every physics step. `was` is how
    // it was moving before the last one (thuds.rs: what it met something at).
    pub now: Transform,
    pub vel: Vec3,
    pub spin: Vec3,
    pub was: Vec3,
    // The joint to the parent: its axes as a turn of the parent's frame at rest, the turn back from the neutral, where
    // the bend's angle is measured from, its range (hinge, twist, side), which way each control turns it, what it
    // swings, and its muscle.
    pub frame: Quat,
    pub unneutral: Quat,
    pub zero: f32,
    pub lo: [f32; 3],
    pub hi: [f32; 3],
    pub sign: [f32; 3],
    pub swing: f32,
    pub muscle: f32,
    pub locked: bool,
    pub broken: bool,
    // The first segment of a piece cut off (dismember.rs).
    pub severed: bool,
    // The bones whose turns make up the joint, from the bone after the parent segment's down to the segment's own
    // (motor.rs turns a pose into the joint's target with them), and the ones drive() turns.
    pub chain: Vec<usize>,
    pub spread: Vec<usize>,
    motor: Motor,
    grip: f32,
    grip_dirty: bool,
    // Pushes given this step, to be handed to Rapier (N s at the middle, N m s).
    impulse: Vec3,
    torque: Vec3,
}

#[derive(Component)]
pub struct Ragdoll {
    pub segs: Vec<Seg>,
    // The segments still part of the body (not on a piece cut off), and their weight.
    pub attached: Vec<usize>,
    pub mass: f32,
    pub tone: f32,
    toned: bool,
    // Off their feet: every muscle the behaviour's, nothing standing.
    pub limp: bool,
    // The bones between one segment's bone and the next that drive() leaves straight.
    between: Vec<usize>,
    // The entities of the free joints that keep the halves of the long bones either side of an elbow or knee apart.
    apart: Vec<Entity>,
    // Seconds of physics since it was made.
    pub age: f32,
    // The first segment of each piece cut off (dismember.rs), and whether it is clear of the stump yet.
    pub pieces: Vec<(usize, bool)>,
}

// A segment's collider, in its own frame (origin at its bone's head, axes the body's at rest).
fn collider(shape: &Shape) -> Collider {
    match *shape {
        Shape::Capsule { a, b, r } => Collider::capsule(a, b, r),
        Shape::Ball { centre, r } => Collider::compound(vec![(centre, Quat::IDENTITY, Collider::ball(r))]),
        Shape::Cuboid { centre, half, rotation } => Collider::compound(vec![(centre, rotation, Collider::cuboid(half.x, half.y, half.z))]),
    }
}

impl Ragdoll {
    // The bodies and joints for `person`, whose segments (person.segments) are fitted and placed as they stand.
    pub fn build(commands: &mut Commands, person: &Person) -> Ragdoll {
        let body = &person.body;
        let defs = &person.segments;
        let mut segs: Vec<Seg> = Vec::with_capacity(defs.len());
        for d in defs {
            let shape = collider(&d.shape);
            // Mass given alone keeps the turning inertia of the shape at its own density, which made a 1 kg hand as hard
            // to spin as a block of lead; the inertia is scaled with the mass. Hands and feet are given three times
            // their turning inertia: at their own, a 1 kg foot under a 70 kg body was spun by every correction the
            // solver made and dragged the joints above it loose.
            let mut mass = MassProperties::from_rapier(shape.raw.mass_properties(1.0));
            let spin = if d.name.starts_with("hand") || d.name.starts_with("foot") { 3.0 } else { 1.0 };
            mass.principal_inertia *= spin * d.mass / mass.mass;
            mass.mass = d.mass;
            let kind = match d.group {
                Group::Trunk => TRUNK,
                Group::Root => ROOTS,
                Group::Limb => LIMBS,
            };
            let entity = commands
                .spawn((
                    RigidBody::Dynamic,
                    d.rest,
                    shape,
                    ColliderMassProperties::MassProperties(mass),
                    CollisionGroups::new(kind, Bits::ALL),
                    Friction::coefficient(0.75),
                    Restitution::coefficient(0.02),
                    Damping { linear_damping: 0.05, angular_damping: 0.5 },
                    Velocity::default(),
                    ExternalImpulse::default(),
                    ActiveEvents::COLLISION_EVENTS,
                    Name::new(format!("{} {}", person.label, d.name)),
                ))
                .id();
            segs.push(Seg {
                def: d.clone(),
                entity,
                friction: None,
                now: d.rest,
                vel: Vec3::ZERO,
                spin: Vec3::ZERO,
                was: Vec3::ZERO,
                frame: Quat::IDENTITY,
                unneutral: Quat::IDENTITY,
                zero: 0.0,
                lo: [0.0; 3],
                hi: [0.0; 3],
                sign: [1.0; 3],
                swing: 0.002,
                muscle: d.joint.as_ref().map_or(0.0, |j| j.muscle),
                locked: false,
                broken: false,
                severed: false,
                chain: Vec::new(),
                spread: Vec::new(),
                motor: Motor::default(),
                grip: 0.0,
                grip_dirty: false,
                impulse: Vec3::ZERO,
                torque: Vec3::ZERO,
            });
        }
        // What each joint swings: everything past it, about it, as the body stands at rest.
        for k in 0..segs.len() {
            let mut swing = 0.002;
            for (n, d) in defs.iter().enumerate() {
                let mut at = Some(n);
                while let Some(i) = at {
                    if i == k {
                        break;
                    }
                    at = defs[i].parent;
                }
                if at.is_some() {
                    swing += d.mass * (d.head + d.centre).distance_squared(defs[k].head);
                }
            }
            segs[k].swing = swing;
        }
        // For every joint, the bones whose turns make it up (and on to the skull, for the neck).
        for (k, d) in defs.iter().enumerate() {
            let Some(p) = d.parent else { continue };
            let stop = defs[p].bone;
            let mut chain = Vec::new();
            let mut at = Some(d.bone);
            while let Some(i) = at {
                if i == stop {
                    break;
                }
                chain.insert(0, i);
                at = body.bones[i].parent;
            }
            if d.name == "head" {
                chain.extend(["neck02", "neck03", "head"].map(|n| body.by_name[n]));
            }
            segs[k].spread = if SPREAD.contains(&d.name.as_str()) { chain.clone() } else { vec![d.bone] };
            segs[k].chain = chain;
        }
        // The bones that lie between one segment's bone and the next (spine04 between pelvis and belly): drive() turns
        // the ones it spreads a bend over and leaves the rest straight.
        let lead: Vec<usize> = defs.iter().map(|d| d.bone).collect();
        const NOT: [&str; 20] = ["finger", "metacarpal", "toe", "eye", "jaw", "tongue", "orbic", "levator", "risor", "oris", "temporal",
            "special", "cheek", "nose", "brow", "lip", "mouth", "labi", "mental", "masseter"];
        let between = (0..body.bones.len())
            .filter(|i| !lead.contains(i) && !NOT.iter().any(|n| body.bones[*i].name.contains(n)))
            .collect();
        let mut rd = Ragdoll { segs, attached: (0..defs.len()).collect(), mass: defs.iter().map(|d| d.mass).sum(), tone: ALIVE, toned: false, limp: false, between, apart: Vec::new(), age: 0.0, pieces: Vec::new() };
        for k in 0..defs.len() {
            if defs[k].joint.is_some() {
                rd.join(commands, person, k);
            }
        }
        // A long bone is two bodies (with_mid_bones), so the two halves of an upper arm and of a forearm are not all
        // joined to each other at the elbow, though the bones are: an elbow or a knee bent far put the far half of one
        // into the near half of the other, and the joint's limit and the contact fought. These are kept apart the way
        // the joints keep theirs (a joint that holds nothing, its contacts off). The shoulder and hip are not: the
        // halves of an upper arm or thigh meet the trunk, which is what keeps an arm out of the chest.
        for s in ["L", "R"] {
            for (a, b) in [("upperarm", "forearm"), ("upperarm", "forearm2"), ("upperarm2", "forearm2"), ("forearm", "hand"),
                ("thigh", "shin"), ("thigh", "shin2"), ("thigh2", "shin2"), ("shin", "foot")] {
                let (a, b) = (rd.by_name(&format!("{a}{s}")), rd.by_name(&format!("{b}{s}")));
                let free = GenericJointBuilder::new(JointAxesMask::empty()).contacts_enabled(false).build();
                let e = commands.spawn((ImpulseJoint::new(rd.segs[a].entity, free), ChildOf(rd.segs[b].entity))).id();
                rd.apart.push(e);
            }
        }
        rd.set_tone(ALIVE);
        rd
    }

    pub fn by_name(&self, name: &str) -> usize {
        self.segs.iter().position(|s| s.def.name == name).unwrap_or_else(|| panic!("no segment {name}"))
    }

    // Every entity of the ragdoll's own (bodies, joints), for when the person goes.
    pub fn entities(&self) -> impl Iterator<Item = Entity> + '_ {
        self.segs.iter().flat_map(|s| [Some(s.entity), s.friction]).flatten().chain(self.apart.iter().copied())
    }

    // The joint between a segment and its parent, at the segment's bone head, with its range read off the skeleton.
    fn join(&mut self, commands: &mut Commands, person: &Person, k: usize) {
        let d = &person.segments[k];
        let j = d.joint.as_ref().unwrap();
        let p = d.parent.unwrap();
        let parent = &person.segments[p];
        // The neutral turn, composed as person.apply would (each later turn on the left); the parent's frame is laid out
        // round the limb as it lies there, and the limb's own frame is that frame turned back by it.
        let mut neutral = Quat::IDENTITY;
        if !j.lock {
            for (control, deg) in &j.neutral {
                neutral = Quat::from_axis_angle(person.hinges[control].axis, deg * crate::person::RAD) * neutral;
            }
        }
        let unneutral = neutral.inverse();
        let along = neutral * d.end.normalize();
        // (Across the limb and the way the body faces: Bevy's ahead, -Z.)
        let hinge = if j.hinge == Hinge::Elbow { along.cross(Vec3::NEG_Z).normalize() } else { Vec3::X };
        let hinge = (hinge - along * hinge.dot(along)).normalize();
        let frame = Quat::from_mat3(&Mat3::from_cols(hinge, along, hinge.cross(along)));
        let s = &mut self.segs[k];
        s.frame = frame;
        s.unneutral = unneutral;
        // Where it turns: for a spine or neck, whose turn drive() spreads over every bone of it, the middle of those
        // bones' joints, about which the curve they make swings what is past them as one turn would (about the first
        // joint, the skull drawn on a curved neck lay 7 cm from the head's body, and through the floor under it).
        let pivot = if s.spread.len() > 1 {
            s.spread.iter().map(|&b| person.body.bones[b].head).sum::<Vec3>() / s.spread.len() as f32
        } else {
            d.head
        };
        if !j.lock {
            Self::range(person, s, 0, &j.bend);
            Self::range(person, s, 2, &j.side);
            s.lo[1] = -j.twist * crate::person::RAD;
            s.hi[1] = j.twist * crate::person::RAD;
        }
        // Rapier's motors read the bend as an angle from -180 to 180 degrees about its own zero, which is turned off the
        // neutral where a range comes nearer than 35 degrees to where the angle goes over: only the shoulder's, 175 up in
        // front. (There, in Havok, 5 degrees short of it, an arm crawling or reaching overhead went past, was read as far
        // out past the range the other way, and the limit and the muscles threw it back round the long way, the arm
        // flailing at up to 100 rad/s. Rapier's limits are measured from the middle of their range and go over opposite
        // it, but its motors still go over at the zero's opposite. Not the middle of every range: the twist and side are
        // not measured independently of where the bend's zero is, and a shoulder zeroed at the middle of its range, 58
        // degrees up, held a hurt arm across the belly 40 degrees less turned than it was asked and shook it at 5 Hz.)
        // `zero` is in the joint's own angles (angles(), hold(), range()).
        s.zero = (s.hi[0] - 145.0 * crate::person::RAD).max((s.lo[0] + 145.0 * crate::person::RAD).min(0.0));
        let mut joint = GenericJointBuilder::new(if j.lock { JointAxesMask::all() } else { JointAxesMask::LIN_AXES })
            .local_anchor1(pivot - parent.head)
            .local_basis1(frame * Quat::from_rotation_x(s.zero))
            .local_anchor2(pivot - d.head)
            .local_basis2(unneutral * frame)
            .contacts_enabled(false);
        if !j.lock {
            for i in 0..3 {
                let z = if i == 0 { s.zero } else { 0.0 };
                joint = joint.limits(ANGULAR[i], [s.lo[i] - z, s.hi[i] - z]).motor_model(ANGULAR[i], MotorModel::ForceBased);
            }
        }
        commands.entity(s.entity).insert(ImpulseJoint::new(self.segs[p].entity, joint.build()));
        let s = &mut self.segs[k];
        s.locked = j.lock;
        // The joint's friction: the same axes, every one free, a motor on each that holds it still as hard as the tone.
        let mut friction = GenericJointBuilder::new(JointAxesMask::empty())
            .local_anchor1(pivot - parent.head)
            .local_basis1(frame)
            .local_anchor2(pivot - d.head)
            .local_basis2(unneutral * frame)
            .contacts_enabled(false);
        for axis in ANGULAR {
            friction = friction.motor_model(axis, MotorModel::ForceBased).motor_velocity(axis, 0.0, STICK).motor_max_force(axis, 0.0);
        }
        let (parent, child) = (self.segs[p].entity, self.segs[k].entity);
        self.segs[k].friction = Some(commands.spawn((ImpulseJoint::new(parent, friction.build()), ChildOf(child))).id());
    }

    // Axis `i` of a joint's range from (control, lo, hi): the control is turned a little on the skeleton to see which of
    // the joint's axes it moves, and which way.
    fn range(person: &Person, s: &mut Seg, i: usize, (control, lo, hi): &(Option<String>, f32, f32)) {
        let mut sign = 1.0;
        if let Some(c) = control {
            let a = joint_angles(Quat::from_axis_angle(person.hinges[c].axis, 0.3), s.frame);
            let most = (0..3).max_by(|&x, &y| a[x].abs().total_cmp(&a[y].abs())).unwrap();
            if most != i {
                warn!("ragdoll: {c} turns {}'s joint about axis {most}, not {i}", s.def.name);
            }
            sign = if a[i] < 0.0 { -1.0 } else { 1.0 };
        }
        let (lo, hi, rad) = (*lo, *hi, crate::person::RAD);
        s.lo[i] = if sign > 0.0 { lo } else { -hi } * rad;
        s.hi[i] = if sign > 0.0 { hi } else { -lo } * rad;
        s.sign[i] = sign;
    }

    // --- the joints' muscles --------------------------------------------------------------------------------------

    // How a joint is turned now: its child's turn in its parent's frame.
    pub fn relative(&self, k: usize) -> Quat {
        let p = self.segs[k].def.parent.unwrap();
        self.segs[p].now.rotation.inverse() * self.segs[k].now.rotation
    }

    // A joint's three angles now (hinge, twist, side), radians, from its neutral.
    pub fn angles(&self, k: usize) -> [f32; 3] {
        let s = &self.segs[k];
        self.measure(k, self.relative(k) * s.unneutral)
    }

    // A turn of a joint (from its neutral, in its parent's frame) as its angles, the bend's from the joint's zero.
    pub fn measure(&self, k: usize, q: Quat) -> [f32; 3] {
        let s = &self.segs[k];
        let mut a = joint_angles(Quat::from_axis_angle(s.frame * Vec3::X, -s.zero) * q, s.frame);
        a[0] += s.zero;
        a
    }

    // Muscle on a joint: its motors pull it toward `target` (hinge, twist, side, radians) with up to `strength` (0 to 1)
    // of what its muscles have. A muscle is a spring with give, not a servo: it pulls harder the further the joint is
    // from where it is aimed (STIFF of its most per radian, stiffness growing with how hard it works), damped like a limb
    // (DAMP of critical, for what the joint swings), and never past its most. (A position motor that reaches its target
    // within one step whatever is in the way, up to its force, drove a hand or a foot held to an angle against a contact
    // back and forth at the step rate in Havok, 1 to 9 rad/s with the body still.) Rapier's ForceBased motor is that
    // spring, solved implicitly. Nothing is sent that has not changed; a muscle lets go by its motors losing their force,
    // the motor itself never taken off or changed in kind.
    pub fn hold(&mut self, k: usize, target: [f32; 3], strength: f32) {
        let s = &mut self.segs[k];
        let m = &mut s.motor;
        let on = strength > 0.004 && !s.locked;
        if on != m.on {
            m.made |= on;
            m.on = on;
            m.f = -1.0;
            m.t = [f32::NAN; 3];
        }
        if !m.made {
            return;
        }
        let f = if on { strength * s.muscle } else { 0.0 };
        if (f - m.f).abs() > 0.03 * m.f + 0.2 || (f == 0.0 && m.f != 0.0) {
            m.f = f;
            m.dirty = true;
        }
        if !on {
            return;
        }
        for i in 0..3 {
            let t = target[i].clamp(s.lo[i] + 0.02, s.hi[i] - 0.02);
            if !((t - m.t[i]).abs() < 0.002) {
                m.t[i] = t;
                m.dirty = true;
            }
        }
    }

    // What a joint's muscle aims at now (hinge, twist, side) and how hard (N m), for the scenarios' log.
    pub fn aim(&self, k: usize) -> ([f32; 3], f32) {
        (self.segs[k].motor.t, self.segs[k].motor.f)
    }

    // The muscles' and the tone's changes, into the joints.
    fn send(&mut self, joints: &mut Query<&mut ImpulseJoint>) {
        for s in &mut self.segs {
            if s.motor.dirty {
                s.motor.dirty = false;
                if let Ok(mut j) = joints.get_mut(s.entity) {
                    let g: &mut GenericJoint = j.data.as_mut();
                    // (Twist and the side bend have less muscle across them than the main bend.)
                    let f = s.motor.f.max(0.0);
                    let k = f * STIFF;
                    let d = 2.0 * DAMP * (k * s.swing).sqrt();
                    for i in 0..3 {
                        let share = AXIS_SHARE[i];
                        let t = if s.motor.t[i].is_nan() { 0.0 } else { s.motor.t[i] - if i == 0 { s.zero } else { 0.0 } };
                        g.set_motor(ANGULAR[i], t, 0.0, k * share, d * share.sqrt());
                        g.set_motor_max_force(ANGULAR[i], f * share);
                    }
                }
            }
            if s.grip_dirty {
                s.grip_dirty = false;
                if let Some(Ok(mut j)) = s.friction.map(|e| joints.get_mut(e)) {
                    let g: &mut GenericJoint = j.data.as_mut();
                    for axis in ANGULAR {
                        g.set_motor_max_force(axis, s.grip);
                    }
                }
            }
        }
    }

    // A joint's range set to `lo` to `hi` (radians: hinge, twist, side), in Rapier, about its zero, and where the
    // muscles and bones.rs read it.
    pub fn set_range(&mut self, k: usize, lo: [f32; 3], hi: [f32; 3], joints: &mut Query<&mut ImpulseJoint>) {
        let s = &mut self.segs[k];
        s.lo = lo;
        s.hi = hi;
        if let Ok(mut j) = joints.get_mut(s.entity) {
            let g: &mut GenericJoint = j.data.as_mut();
            for i in 0..3 {
                let z = if i == 0 { s.zero } else { 0.0 };
                g.set_limits(ANGULAR[i], [lo[i] - z, hi[i] - z]);
            }
        }
    }

    // The shoulder's range as a cone, which three separate limits cannot make (each lets the arm go as far as it goes
    // alone, so out to the side and back at once went round behind the body): how far behind the plane of the body the
    // arm can be taken depends on how high it is, 60 degrees hanging (extension), 45 out level (horizontal extension),
    // 20 overhead (Norkin and White). Past it, the capsule pulls it back like a stiff damped spring, given every physics
    // step, pushing on the chest the other way. (A spring of no stiffness at the edge, so a resting arm is not caught and
    // let go.)
    pub fn shoulders(&mut self, dt: f32) {
        for side in ["L", "R"] {
            let arm = self.by_name(&format!("upperarm{side}"));
            let chest = self.segs[arm].def.parent.unwrap();
            if self.segs[arm].broken || self.cut_off(arm) {
                continue;
            }
            let v = self.segs[arm].now.rotation * self.segs[arm].def.end.normalize();
            let d = self.segs[chest].now.rotation.inverse() * v;
            let up = (-d.y).clamp(-1.0, 1.0).acos();
            let half = std::f32::consts::FRAC_PI_2;
            let most = if up < half { 60.0 - 15.0 * up / half } else { 45.0 - 25.0 * (up - half) / half } * crate::person::RAD;
            // (Behind the body is +Z here, -Z in the TS.)
            let past = d.z.clamp(-1.0, 1.0).asin() - most;
            if past <= 0.0 {
                continue;
            }
            // About the axis that brings the arm forward again, in the world.
            let ahead = self.segs[chest].now.rotation * Vec3::NEG_Z;
            let axis = v.cross(ahead);
            if axis.length_squared() < 1e-8 {
                continue;
            }
            let axis = axis.normalize();
            let closing = (self.segs[arm].spin - self.segs[chest].spin).dot(axis);
            let torque = (CAPSULE[0] * past - CAPSULE[1] * closing).max(0.0) * dt;
            self.segs[arm].torque += axis * torque;
            self.segs[chest].torque -= axis * torque;
        }
    }

    // Whether a segment is on a piece cut off the body (dismember.rs marks the piece's first segment `severed`).
    pub fn cut_off(&self, k: usize) -> bool {
        let mut at = Some(k);
        while let Some(i) = at {
            if self.segs[i].severed {
                return true;
            }
            at = self.segs[i].def.parent;
        }
        false
    }

    // A piece cut off at segment `k` (dismember.rs): its joint to the body, and the joint's friction, let go; it is not
    // the body's any more, its weight, balance and pushes go without it (`attached`, the mass), and its joints keep a
    // dead body's tone. Its first segment, still inside the stump where it was cut, meets nothing of the body until it is
    // clear of it (met at once, it was thrown out of it: ragdoll.ts _severed); until then it meets nobody else either
    // (the TS's bit of each person's own, which Rapier's thirty-two groups do not have room for, for a moment's
    // difference).
    pub fn sever(&mut self, k: usize, commands: &mut Commands, groups: &mut Query<&mut CollisionGroups>) {
        let s = &mut self.segs[k];
        s.severed = true;
        s.broken = true;
        commands.entity(s.entity).remove::<ImpulseJoint>();
        if let Some(f) = s.friction.take() {
            commands.entity(f).despawn();
        }
        if let Ok(mut g) = groups.get_mut(s.entity) {
            *g = CollisionGroups::new(PIECE, Bits::ALL - TRUNK - ROOTS - LIMBS);
        }
        self.pieces.push((k, false));
        self.attached = (0..self.segs.len()).filter(|&i| !self.cut_off(i)).collect();
        self.mass = self.attached.iter().map(|&i| self.segs[i].def.mass).sum();
        self.toned = false;
        self.set_tone(self.tone);
    }

    // Each piece's first segment, once it is clear of the stump, meets the body as anything else would.
    pub fn clear_pieces(&mut self, groups: &mut Query<&mut CollisionGroups>) {
        for i in 0..self.pieces.len() {
            let (k, clear) = self.pieces[i];
            let Some(p) = self.segs[k].def.parent else { continue };
            if clear {
                continue;
            }
            let at = self.world_point(p, self.segs[k].def.head - self.segs[p].def.head);
            if at.distance(self.segs[k].now.translation) < self.segs[k].def.radius + self.segs[p].def.radius {
                continue;
            }
            self.pieces[i].1 = true;
            if let Ok(mut g) = groups.get_mut(self.segs[k].entity) {
                *g = CollisionGroups::new(LIMBS, Bits::ALL);
            }
        }
    }

    // Whether a segment hangs past a broken bone, with nothing to move it but its own weight.
    pub fn loose(&self, k: usize) -> bool {
        let mut at = Some(k);
        while let Some(i) = at {
            if self.segs[i].broken {
                return true;
            }
            at = self.segs[i].def.parent;
        }
        false
    }

    // How much the joints resist being moved, muscles or no: ALIVE, OUT (unconscious) or DEAD, in N m. A piece cut off
    // has no tone to keep: its joints are a dead body's whatever the person's are (with the living tone a severed leg
    // landed with its ankle held as it was, 5 degrees of give against 20 dead).
    pub fn set_tone(&mut self, tone: f32) {
        if (tone - self.tone).abs() < 0.01 && self.toned {
            return;
        }
        self.tone = tone;
        self.toned = true;
        for k in 0..self.segs.len() {
            let Some(lock) = self.segs[k].def.joint.as_ref().map(|j| j.lock) else { continue };
            if self.segs[k].locked {
                continue;
            }
            // (A broken shaft's mid joint keeps its grating, break_at's: given the tone, a broken shin was held at the
            // break by 4.5 N m while awake and let go when they passed out.)
            let t = if self.cut_off(k) { DEAD } else { self.tone };
            let s = &mut self.segs[k];
            s.grip = if lock { GRATE * s.def.mass } else { t * s.def.mass / 6.0 };
            s.grip_dirty = true;
        }
    }

    // The long bone of a segment broken at its middle: the two halves are held only by flesh.
    pub fn break_at(&mut self, name: &str, joints: &mut Query<&mut ImpulseJoint>) -> bool {
        let Some(k) = self.segs.iter().position(|s| s.def.name == format!("{name}2")).or_else(|| self.segs.iter().position(|s| s.def.name == name)) else {
            return false;
        };
        let s = &mut self.segs[k];
        if !s.locked || s.broken {
            return false;
        }
        s.broken = true;
        s.locked = false;
        s.grip = GRATE * s.def.mass;
        s.grip_dirty = true;
        // Bent most about the joint's own hinge, less across it, and turned a little about its length.
        let most = [1.4, 0.6, 1.1];
        if let Ok(mut j) = joints.get_mut(s.entity) {
            let g: &mut GenericJoint = j.data.as_mut();
            g.raw.locked_axes = JointAxesMask::LIN_AXES;
            for i in 0..3 {
                g.set_limits(ANGULAR[i], [-most[i], most[i]]);
            }
        }
        s.lo = most.map(|m| -m);
        s.hi = most;
        true
    }

    // Whether a joint's muscle is working on it now (bones.rs: a landing the muscles take part of).
    pub fn held(&self, k: usize) -> bool {
        self.segs[k].motor.on
    }

    // What medicine asks of a joint (bones.rs: a break at a bone's end, a broken shaft's halves, a joint out), as
    // bones.ts did it to the ragdoll's constraint.
    pub fn change(&mut self, k: usize, change: &crate::npc::Joint, joints: &mut Query<&mut ImpulseJoint>) {
        use crate::npc::Joint as J;
        let (lo, hi) = (self.segs[k].lo, self.segs[k].hi);
        match change {
            J::Range { lo, hi } => self.set_range(k, *lo, *hi, joints),
            // Opened `by` radians either way on `axes`: what held it there is torn.
            J::Widen { axes, by } => {
                let (mut lo, mut hi) = (lo, hi);
                for &i in axes {
                    lo[i] -= by;
                    hi[i] += by;
                }
                self.set_range(k, lo, hi, joints);
            }
            // Held where it is now, a little either way.
            J::Hold { by } => {
                let a = self.angles(k);
                self.set_range(k, a.map(|x| x - by), a.map(|x| x + by), joints);
            }
            // Out of its socket: locked where it went (pose degrees, turned into the joint's own signs), a little
            // either way.
            J::Out { at, by } => {
                let s = self.segs[k].sign;
                let a = [at[0] * s[0], at[1] * s[1], at[2] * s[2]];
                self.set_range(k, a.map(|x| x - by), a.map(|x| x + by), joints);
            }
            // A broken shaft's halves sliding over each other, as far as `s` m. (The TS let the halves' distance run from
            // nothing to that, any way; Rapier's generic joint limits it along the limb, its frame's Y, either way.)
            J::Shorten(d) => {
                if let Ok(mut j) = joints.get_mut(self.segs[k].entity) {
                    let g: &mut GenericJoint = j.data.as_mut();
                    g.raw.locked_axes.remove(JointAxesMask::LIN_Y);
                    g.set_limits(JointAxis::LinY, [-d, *d]);
                }
            }
            // Gone limp: nothing past it is moved by the muscles any more (seg.broken in the TS).
            J::Limp => self.segs[k].broken = true,
        }
    }

    // --- where the body is -----------------------------------------------------------------------------------------

    // A point given in a segment's own frame, in the world.
    pub fn world_point(&self, k: usize, local: Vec3) -> Vec3 {
        let t = &self.segs[k].now;
        t.translation + t.rotation * local
    }

    // The middle of a segment's shape (and of its weight), in the world.
    pub fn middle(&self, k: usize) -> Vec3 {
        self.world_point(k, self.segs[k].def.centre)
    }

    // The middle of the body's weight.
    pub fn com(&self) -> Vec3 {
        self.attached.iter().map(|&k| self.middle(k) * self.segs[k].def.mass).sum::<Vec3>() / self.mass
    }

    // How fast the middle of the body's weight is moving.
    pub fn com_velocity(&self) -> Vec3 {
        self.attached.iter().map(|&k| self.segs[k].vel * self.segs[k].def.mass).sum::<Vec3>() / self.mass
    }

    // How fast the point of a segment at `at` (world) is moving: its middle's velocity and its spin about it.
    pub fn velocity_at(&self, k: usize, at: Vec3) -> Vec3 {
        self.segs[k].vel + self.segs[k].spin.cross(at - self.middle(k))
    }

    // The lowest point of a segment's shape, as a height in the world.
    pub fn lowest(&self, k: usize) -> f32 {
        let q = self.segs[k].now.rotation;
        match self.segs[k].def.shape {
            Shape::Capsule { a, b, r } => self.world_point(k, a).y.min(self.world_point(k, b).y) - r,
            Shape::Ball { centre, r } => self.world_point(k, centre).y - r,
            Shape::Cuboid { centre, half, rotation } => {
                // How far down its corners reach from its middle, by how its three axes now point.
                let m = Mat3::from_quat(q * rotation);
                let down = m.x_axis.y.abs() * half.x + m.y_axis.y.abs() * half.y + m.z_axis.y.abs() * half.z;
                self.world_point(k, centre).y - down
            }
        }
    }

    // A blow: `impulse` (N s, world) at `at` (world) on segment `k`.
    pub fn push(&mut self, k: usize, impulse: Vec3, at: Vec3) {
        let arm = at - self.middle(k);
        let s = &mut self.segs[k];
        s.impulse += impulse;
        s.torque += arm.cross(impulse);
    }

    // A turn given a segment: `torque` N m s about its middle.
    pub fn turn(&mut self, k: usize, torque: Vec3) {
        self.segs[k].torque += torque;
    }

    // The segment whose shape is nearest a world point, and how far it is. (By the shapes themselves: measured from each
    // segment's bone line, a shot to the face went to the chest, whose line runs up to the neck, and not to the head,
    // whose bone is the neck's.)
    pub fn nearest(&self, at: Vec3) -> (usize, f32) {
        (0..self.segs.len()).map(|k| (k, self.outside(k, at))).min_by(|a, b| a.1.total_cmp(&b.1)).unwrap()
    }

    // How far a world point lies outside a segment's shape (less than nothing inside it).
    pub fn outside(&self, k: usize, at: Vec3) -> f32 {
        let t = &self.segs[k].now;
        let p = t.rotation.inverse() * (at - t.translation);
        match self.segs[k].def.shape {
            Shape::Ball { centre, r } => p.distance(centre) - r,
            Shape::Capsule { a, b, r } => {
                let ab = b - a;
                let u = ((p - a).dot(ab) / ab.length_squared().max(1e-9)).clamp(0.0, 1.0);
                p.distance(a + ab * u) - r
            }
            Shape::Cuboid { centre, half, rotation } => {
                let q = (rotation.inverse() * (p - centre)).abs() - half;
                q.max(Vec3::ZERO).length() + q.max_element().min(0.0)
            }
        }
    }

    // A segment's two ends in the world, from its body.
    pub fn segment_ends(&self, k: usize) -> [Vec3; 2] {
        let t = &self.segs[k].now;
        [t.translation, t.transform_point(self.segs[k].def.end)]
    }

    // Where the body as a whole is: the middle of its pelvis (its bone's head).
    pub fn centre(&self) -> Vec3 {
        self.segs[0].now.translation
    }

    // --- the bones follow the bodies -------------------------------------------------------------------------------

    // The skeleton put where the bodies are, the person's root at `root`: each bone's turn in its parent's and the frame
    // (the pelvis), as person.rs poses it. `hands` are the finger bones' own turns (motor.rs: they have no bodies).
    pub fn drive(&self, person: &Person, root: &Transform, hands: &[(usize, Quat)]) -> Posed {
        let mut local = person.posed.local.clone();
        for &b in &self.between {
            local[b] = Quat::IDENTITY;
        }
        for &(b, q) in hands {
            local[b] = q;
        }
        let into = root.rotation.inverse();
        let abs: Vec<Quat> = self.segs.iter().map(|s| into * s.now.rotation).collect();
        let mut frame = person.posed.frame;
        for (k, s) in self.segs.iter().enumerate() {
            let Some(p) = s.def.parent else {
                frame = Transform::from_translation(root.compute_affine().inverse().transform_point3(s.now.translation)).with_rotation(abs[k]);
                local[s.def.bone] = Quat::IDENTITY;
                continue;
            };
            let mut q = abs[p].inverse() * abs[k];
            if s.spread.len() == 1 {
                local[s.spread[0]] = q;
                continue;
            }
            if q.w < 0.0 {
                q = -q;
            }
            let part = Quat::IDENTITY.slerp(q, 1.0 / s.spread.len() as f32);
            for &b in &s.spread {
                local[b] = part;
            }
        }
        Posed { local, frame }
    }

    // --- every physics step -----------------------------------------------------------------------------------------

    // Where the bodies are now and how they move, after a step.
    fn read(&mut self, bodies: &Query<(&Transform, &Velocity, &mut ExternalImpulse)>, dt: f32) {
        self.age += dt;
        for s in &mut self.segs {
            if let Ok((t, v, _)) = bodies.get(s.entity) {
                s.now = *t;
                s.was = s.vel;
                s.vel = v.linear;
                s.spin = v.angular;
            }
        }
    }

    // The pushes given this step, to Rapier.
    fn give(&mut self, bodies: &mut Query<(&Transform, &Velocity, &mut ExternalImpulse)>) {
        for s in &mut self.segs {
            if s.impulse == Vec3::ZERO && s.torque == Vec3::ZERO {
                continue;
            }
            if let Ok((_, _, mut e)) = bodies.get_mut(s.entity) {
                e.impulse += s.impulse;
                e.torque_impulse += s.torque;
            }
            s.impulse = Vec3::ZERO;
            s.torque = Vec3::ZERO;
        }
    }
}

// The physics steps' order for the body: after each step every ragdoll reads where it is (`Read`); before the next,
// the people push on what they push on and the player pulls on what they hold (`Push`, behaviour.rs), the shoulders'
// capsules pull, and all of it goes to Rapier (`Give`).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub enum Steps {
    Read,
    Push,
    Give,
}

fn read(time: Res<Time>, mut ragdolls: Query<&mut Ragdoll>, bodies: Query<(&Transform, &Velocity, &mut ExternalImpulse)>) {
    for mut rd in &mut ragdolls {
        rd.read(&bodies, time.delta_secs());
    }
}

fn give(mut ragdolls: Query<&mut Ragdoll>, mut bodies: Query<(&Transform, &Velocity, &mut ExternalImpulse)>) {
    for mut rd in &mut ragdolls {
        rd.give(&mut bodies);
    }
}

fn shoulders(time: Res<Time>, mut ragdolls: Query<&mut Ragdoll>) {
    for mut rd in &mut ragdolls {
        rd.shoulders(time.delta_secs());
    }
}

// The muscles' and the tone's changes into the joints, once a frame after the behaviour has set them.
pub fn send(mut ragdolls: Query<&mut Ragdoll>, mut joints: Query<&mut ImpulseJoint>) {
    for mut rd in &mut ragdolls {
        rd.send(&mut joints);
    }
}

// Rapier's solver for bodies held together by twenty joints each, standing on two feet. Havok solved a ragdoll's chain
// of joints stiffly; Rapier's iterative solver, at its four passes and with joints started from nothing each step,
// did not: standing, the knee sagged 8 degrees past its muscle's aim and the ankle 4, a shin's twist went 6 degrees past
// its 5-degree limit in a second, and the legs, straightening against the sag, pushed the feet back along the floor at
// 2 to 10 cm/s until the person stepped and walked off. Its joints are warm-started from the last step's impulses like
// its contacts (off by default), and given sixteen passes: at eight the feet still crept 2.5 cm/s, at twelve the knee
// still sagged 3 degrees, at sixteen it is within 2 and four people stood ten seconds within 2.5 to 10 cm of where
// they were made (stand scenario).
fn solver(mut contexts: Query<&mut RapierContextSimulation, Added<RapierContextSimulation>>) {
    for mut c in &mut contexts {
        c.integration_parameters.warmstart_joints = true;
        c.integration_parameters.num_solver_iterations = SOLVER_PASSES;
    }
}
const SOLVER_PASSES: usize = 16;

pub fn plugin(app: &mut App) {
    app.add_systems(PreUpdate, solver).configure_sets(FixedUpdate, (Steps::Push, Steps::Give).chain().before(PhysicsSet::SyncBackend))
        .configure_sets(FixedUpdate, Steps::Read.after(PhysicsSet::Writeback))
        .add_systems(FixedUpdate, (read.in_set(Steps::Read), shoulders.in_set(Steps::Push), give.in_set(Steps::Give)));
}
