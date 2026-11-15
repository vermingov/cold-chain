// A body's bones as rigid bodies (src/sandbox/ragdoll.ts): the segment table, and each person's segments fitted to
// their own flesh. The bodies, joints and muscles that make a ragdoll of them are phase 2's (dev/PORT.md).
//
// Each segment of the body (pelvis, belly, chest, head, and every limb in halves) is one body in the physics world,
// joined to the next at the joint between them with the range of movement a real joint has. A long bone is two bodies
// locked together at its middle: when it breaks, the lock is let go and the limb bends where it broke, under its own
// weight.
//
// The people's skeletons have no bone in the middle of a femur, so one is put there (with_mid_bones) before a person
// is made, and the flesh of the lower half of the limb is given to it.

use bevy::prelude::*;

use crate::person::{Body, Bone, Person};

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
