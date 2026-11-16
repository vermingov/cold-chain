// A person's teeth, one by one: knocked loose, chipped, broken off or out by blows and bullets to the mouth
// (src/sandbox/teeth.ts; drawing what is left of a tooth and the piece that falls is phase 3's: `Happened::Tooth`).
//
// The teeth are one part of the person's mesh, but each tooth in it is a run of triangles of its own, not joined to the
// rest. A tooth gives at a few hundred newtons, the front ones first (estimates: laboratory crown fractures of
// extracted incisors run 0.4 to 1 kN, molars more). With the mouth shut the lips and the bite take the blow and send it
// through the jaw, and only the front teeth can be reached; open, the front teeth meet it bare and twice as easily, and
// are the ones knocked out.

use bevy::prelude::*;

use crate::npc::{Happened, Npc};
use crate::person::Body;
use crate::vitals::{Bleed, Into};
use crate::wounds::cap;

const KINDS: [&str; 8] = ["central incisor", "lateral incisor", "canine", "first premolar", "second premolar", "first molar", "second molar", "third molar"];
const STRENGTH: [f32; 8] = [450.0, 500.0, 700.0, 800.0, 800.0, 1000.0, 1000.0, 1000.0]; // N, by place in the row from the middle

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Debug)]
pub enum State {
    Whole,
    Loose,
    Chipped,
    Broken,
    Out,
}

#[derive(Clone, Debug)]
pub struct Tooth {
    pub name: String,
    pub upper: bool,
    // Its triangles (offset into the body's index and how many) and its corners.
    pub at: usize,
    pub count: usize,
    pub v0: u32,
    pub v1: u32,
    pub owner: usize,
    pub strength: f32,
    pub front: bool,
    pub state: State,
}

#[derive(Default)]
pub struct Teeth {
    pub teeth: Vec<Tooth>,
}

impl Teeth {
    pub fn new(body: &Body) -> Teeth {
        let Some(p) = body.parts.iter().find(|p| p.kind == "teeth") else { return Teeth::default() };
        let index = &body.index;
        // Each run of triangles that share no corner with another: the gums and palate (big runs) and the teeth (runs under
        // a centimetre and a half across).
        let runs = runs(index, p.index_start, p.index_count);
        let owner = |v: u32| {
            let (mut best, mut bone) = (0u8, 0u16);
            for k in 0..4 {
                if body.weights[v as usize][k] > best {
                    best = body.weights[v as usize][k];
                    bone = body.joints[v as usize][k];
                }
            }
            bone as usize
        };
        let found: Vec<(usize, usize, u32, u32, Vec3, usize, bool)> = runs
            .into_iter()
            .filter_map(|(at, count)| {
                let tris = &index[at..at + count];
                let (v0, v1) = (*tris.iter().min().unwrap(), *tris.iter().max().unwrap());
                let (mut lo, mut hi, mut c) = (Vec3::INFINITY, Vec3::NEG_INFINITY, Vec3::ZERO);
                for v in v0..=v1 {
                    let q = body.position[v as usize];
                    lo = lo.min(q);
                    hi = hi.max(q);
                    c += q;
                }
                let size = hi - lo;
                (size.max_element() < 0.015).then(|| {
                    let o = owner(v0);
                    (at, count, v0, v1, c / (v1 - v0 + 1) as f32, o, body.bones[o].name != "jaw")
                })
            })
            .collect();
        let mut teeth = Vec::new();
        // Named by their place in the row: in each quarter of the mouth, from the middle at the front backward (the front
        // is -Z here, the TS's +Z).
        for upper in [true, false] {
            for side in [-1.0f32, 1.0] {
                let mut row: Vec<_> = found.iter().filter(|t| t.6 == upper && (if t.4.x == 0.0 { 1e-9f32 } else { t.4.x }).signum() == side).collect();
                row.sort_by(|a, b| a.4.z.total_cmp(&b.4.z));
                for (k, t) in row.into_iter().enumerate() {
                    let name = format!("{} {} {}", if upper { "upper" } else { "lower" }, if side < 0.0 { "left" } else { "right" }, KINDS[k.min(KINDS.len() - 1)]);
                    teeth.push(Tooth {
                        name, upper, at: t.0, count: t.1, v0: t.2, v1: t.3, owner: t.5, strength: STRENGTH[k.min(STRENGTH.len() - 1)], front: k < 3,
                        state: State::Whole,
                    });
                }
            }
        }
        Teeth { teeth }
    }
}

// The runs of triangles (offsets into `index`) in [start, start + count) that share no corner with each other, in the
// order their first triangles come.
fn runs(index: &[u32], start: usize, count: usize) -> Vec<(usize, usize)> {
    use std::collections::HashMap;
    let mut parent: HashMap<u32, u32> = HashMap::new();
    fn find(parent: &mut HashMap<u32, u32>, mut a: u32) -> u32 {
        while parent[&a] != a {
            let up = parent[&parent[&a]];
            parent.insert(a, up);
            a = up;
        }
        a
    }
    for &v in &index[start..start + count] {
        parent.entry(v).or_insert(v);
    }
    for i in (start..start + count).step_by(3) {
        let a = find(&mut parent, index[i]);
        let b = find(&mut parent, index[i + 1]);
        parent.insert(b, a);
        let c = find(&mut parent, index[i + 2]);
        parent.insert(c, a);
    }
    let mut order: Vec<(u32, usize, usize)> = Vec::new();
    for i in (start..start + count).step_by(3) {
        let root = find(&mut parent, index[i]);
        match order.iter_mut().find(|r| r.0 == root) {
            Some(r) => r.2 += 3,
            None => order.push((root, i, 3)),
        }
    }
    order.into_iter().map(|(_, at, n)| (at, n)).collect()
}

pub struct TeethOf<'n, 'a>(pub &'n mut Npc<'a>);

impl<'a> Npc<'a> {
    pub fn teeth<'n>(&'n mut self) -> TeethOf<'n, 'a> {
        TeethOf(self)
    }
}

impl TeethOf<'_, '_> {
    // Where a tooth is now, in the world: the middle of its corners as the skin is posed this frame.
    fn r#where(&mut self, t: usize) -> Vec3 {
        let sk = self.0.skinned();
        let (v0, v1) = (self.0.hurt.teeth.teeth[t].v0, self.0.hurt.teeth.teeth[t].v1);
        let mut c = Vec3::ZERO;
        for v in (v0..=v1).step_by(4) {
            c += sk.at[v as usize];
        }
        c / (v1 - v0 + 1).div_ceil(4) as f32
    }

    // Which way the mouth faces, in the world (the head's ahead).
    fn outward(&self) -> Vec3 {
        let head = self.0.segment("head").unwrap();
        self.0.segment_world(head).rotation * Vec3::NEG_Z
    }

    // A blow of `force` N along `dir` over `radius` m round the line through `point`: the teeth in its way share it. `open`
    // whether the mouth was open. Returns whether it reached any.
    pub fn blow(&mut self, point: Vec3, dir: Vec3, force: f32, radius: f32, open: bool) -> bool {
        let mut hit = Vec::new();
        for t in 0..self.0.hurt.teeth.teeth.len() {
            let tooth = &self.0.hurt.teeth.teeth[t];
            if tooth.state == State::Out || (!open && !tooth.front) {
                continue;
            }
            let q = self.r#where(t) - point;
            let along = q.dot(dir);
            if along > -0.04 && along < 0.05 && (q - dir * along).length() < radius {
                hit.push(t);
            }
        }
        // The teeth nearest the line through the blow take most of it.
        let near: Vec<f32> = hit.iter().map(|&t| {
            let q = self.r#where(t) - point;
            (1.0 - (q - dir * q.dot(dir)).length() / radius).max(0.05)
        }).collect();
        let total: f32 = near.iter().sum();
        for (k, &t) in hit.iter().enumerate() {
            let tooth = &self.0.hurt.teeth.teeth[t];
            let (strength, front) = (tooth.strength, tooth.front);
            let ratio = (force * near[k]) / total / (strength * if open { 1.0 } else { 1.5 } * (0.85 + self.0.dice.next() * 0.3));
            if ratio < 0.5 {
                continue;
            }
            let how = if ratio > 1.6 || (open && ratio > 1.2 && front) {
                State::Out
            } else if ratio > 1.25 {
                State::Broken
            } else if ratio > 1.0 {
                State::Chipped
            } else {
                State::Loose
            };
            self.give(t, how, dir, 1);
        }
        !hit.is_empty()
    }

    // A bullet along the line from `origin` along `dir`, as far as `far`: the teeth within its width of the line burst.
    pub fn shot(&mut self, origin: Vec3, dir: Vec3, far: f32) {
        for t in 0..self.0.hurt.teeth.teeth.len() {
            if self.0.hurt.teeth.teeth[t].state == State::Out {
                continue;
            }
            let q = self.r#where(t) - origin;
            let along = q.dot(dir);
            if along > 0.0 && along < far && (q - dir * along).length() < 0.005 {
                self.give(t, State::Out, dir, 3);
            }
        }
    }

    // Every tooth of the upper (or lower) row loosened in its socket: the jaw they stand in is broken.
    pub fn loosen(&mut self, upper: bool) {
        let mut any = false;
        for t in &mut self.0.hurt.teeth.teeth {
            if t.upper == upper && t.state == State::Whole {
                t.state = State::Loose;
                any = true;
            }
        }
        if any {
            self.0.vitals.injure(format!("{} teeth loose in the broken jaw", if upper { "Upper" } else { "Lower" }), 3.0);
        }
    }

    // Tooth `t` given way as `how`: loosened, chipped (the edge off), broken (the crown off at the gum) or out (all of it,
    // root and all); `pieces` how many bits it goes in when a bullet bursts it.
    fn give(&mut self, t: usize, how: State, dir: Vec3, pieces: u32) {
        if how <= self.0.hurt.teeth.teeth[t].state {
            return;
        }
        let at = self.r#where(t);
        self.0.hurt.teeth.teeth[t].state = how;
        let name = self.0.hurt.teeth.teeth[t].name.clone();
        if how == State::Loose {
            self.0.vitals.injure(format!("{} knocked loose", cap(&name)), 1.0);
            return;
        }
        // What is lost (the crown's edge, the crown down to the gum, or the whole tooth) falls out of the mouth: drawn and
        // thrown by teeth.rs's look (phase 3), with the throws the TS made for it, each piece's seven.
        let words = match how {
            State::Chipped => "chipped",
            State::Broken => "broken",
            _ => "out",
        };
        let throws: Vec<f32> = (0..pieces * 7).map(|_| self.0.dice.next()).collect();
        self.0.hurt.happened.push(Happened::Tooth { tooth: t, how: words, dir, pieces, throws });
        let v = &mut *self.0.vitals;
        v.pain = (v.pain + if how == State::Chipped { 0.08 } else { 0.18 }).min(1.0);
        v.injure(
            format!("{} {}", cap(&name), match how {
                State::Chipped => "chipped",
                State::Broken => "broken off at the gum",
                _ => "knocked out",
            }),
            if how == State::Chipped { 1.0 } else { 2.0 },
        );
        // The pulp or the socket bleeds into the mouth (throat.rs), which lets it out over the lips as the head lies.
        let out = self.outward();
        self.0.hurt.happened.push(Happened::Spray { at: at + out * 0.02, dir: (out + dir * 0.5).normalize(), speed: 1.2, ml: if how == State::Out { 1.5 } else { 0.6 }, spread: 0.5, size: 1.0 });
        self.0.vitals.bleed(Bleed::new(format!("{name} socket"), if how == State::Out { 0.0002 } else { 0.00006 }).clots(0.01).internal(true).into(Into::Mouth));
    }
}

// --- the look (teeth.ts `_draw`, `_stump`, `_fall`) -------------------------------------------------------------------
//
// A tooth that gives way is taken out of the person's teeth (their own copy of the body's teeth mesh, made the first
// time one goes, with that tooth's triangles left out of its index); a tooth broken or chipped leaves a stump in its
// place (its own corners, the crown cut off flat at the break), and the lost piece falls from the mouth as a small
// physical thing; one knocked out falls whole. The stump is a plain mesh carried by the bone the tooth stands in (its
// corners in that bone's frame), so it needs no skinning; the pieces are Rapier balls that only the room stops.

const MOST_DEBRIS: usize = 24;
// What a tooth's piece is to the physics: its own group, meeting only what the hall is built of (a tooth thrown out of
// the mouth is past the person's own body).
const DEBRIS: bevy_rapier3d::prelude::Group = bevy_rapier3d::prelude::Group::GROUP_31;

// A person's mouth as drawn: their own teeth mesh once one has gone, the stumps, and the pieces fallen.
#[derive(Component, Default)]
pub struct TeethDrawn {
    mesh: Option<Handle<Mesh>>,
    stumps: Vec<(usize, Entity)>,
}

#[derive(Resource, Default)]
pub struct Debris(std::collections::VecDeque<Entity>);

// Each corner of tooth `t` where the skin is posed now, in the world (bones' places worked out once a call).
fn posed(person: &crate::person::Person, root: &Transform, t: &Tooth) -> Vec<Vec3> {
    let body = &person.body;
    let mut bones: std::collections::HashMap<usize, bevy::math::Affine3A> = std::collections::HashMap::new();
    (t.v0..=t.v1)
        .map(|v| {
            let (j, w) = (body.joints[v as usize], body.weights[v as usize]);
            let mut out = Vec3::ZERO;
            for k in 0..4 {
                if w[k] > 0 {
                    let m = *bones.entry(j[k] as usize).or_insert_with(|| crate::face::bone_world(person, root, j[k] as usize));
                    out += m.transform_point3(body.position[v as usize]) * (w[k] as f32 / 255.0);
                }
            }
            out
        })
        .collect()
}

// Along a tooth from its root (0) to its biting edge (1), at rest: upper teeth point down, lower ones up.
fn along<'a>(body: &'a Body, t: &Tooth) -> impl Fn(u32) -> f32 + 'a {
    let ys = (t.v0..=t.v1).map(|v| body.position[v as usize].y);
    let (lo, hi) = ys.fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), y| (lo.min(y), hi.max(y)));
    let upper = t.upper;
    move |v: u32| {
        let y = body.position[v as usize].y;
        if upper { (hi - y) / (hi - lo) } else { (y - lo) / (hi - lo) }
    }
}

fn mesh_of(corners: Vec<Vec3>, uvs: Vec<Vec2>, tris: Vec<u32>) -> Mesh {
    Mesh::new(bevy::mesh::PrimitiveTopology::TriangleList, bevy::asset::RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, corners)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uvs)
        .with_inserted_indices(bevy::mesh::Indices::U32(tris))
        .with_computed_smooth_normals()
}

// The teeth that gave way this frame drawn so: taken out of the mouth, their stumps put in, their pieces thrown.
#[allow(clippy::type_complexity)]
fn draw_teeth(
    mut commands: Commands,
    mut people: Query<(Entity, &crate::person::Person, &Transform, &crate::npc::Hurt, Option<&mut TeethDrawn>)>,
    parts: Query<(&Mesh3d, &MeshMaterial3d<StandardMaterial>, &ChildOf)>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut debris: ResMut<Debris>,
) {
    use bevy_rapier3d::prelude::*;
    for (e, person, root, hurt, drawn) in &mut people {
        let teeth = &hurt.teeth.teeth;
        let gone: Vec<_> = hurt.happened.iter().filter_map(|h| match h {
            crate::npc::Happened::Tooth { tooth, how, dir, pieces, throws } => Some((*tooth, *how, *dir, *pieces, throws)),
            _ => None,
        }).collect();
        if gone.is_empty() {
            continue;
        }
        let body = &person.body;
        let Some(pi) = body.parts.iter().position(|p| p.kind == "teeth") else { continue };
        let Some(&(_, part)) = person.parts.iter().find(|(i, _)| *i == pi) else { continue };
        let Ok((mesh, material, _)) = parts.get(part) else { continue };
        let material = material.0.clone();
        let mut fresh = None;
        let drawn = match drawn {
            Some(d) => d.into_inner(),
            None => fresh.insert(TeethDrawn::default()),
        };
        // The teeth still standing whole or loose, and the gums, drawn again: the part's index without the teeth gone.
        let p = &body.parts[pi];
        let own = drawn.mesh.get_or_insert_with(|| {
            let m = meshes.get(&mesh.0).cloned().expect("the teeth's mesh");
            let h = meshes.add(m);
            commands.entity(part).insert(Mesh3d(h.clone()));
            h
        }).clone();
        let mut index = Vec::with_capacity(p.index_count);
        let mut i = p.index_start;
        let mut out: Vec<&Tooth> = teeth.iter().filter(|t| t.state > State::Loose).collect();
        out.sort_by_key(|t| t.at);
        for t in out {
            index.extend(body.index[i..t.at].iter().map(|&v| v - p.vertex_start as u32));
            i = t.at + t.count;
        }
        index.extend(body.index[i..p.index_start + p.index_count].iter().map(|&v| v - p.vertex_start as u32));
        if let Some(mut m) = meshes.get_mut(&own) {
            m.insert_indices(bevy::mesh::Indices::U32(index));
        }
        for (k, how, dir, pieces, throws) in gone {
            let t = &teeth[k];
            // What is lost: the crown's edge, the crown down to the gum, or the whole tooth.
            let keep = match how {
                "chipped" => 0.8,
                "broken" => 0.45,
                _ => 0.0,
            };
            let along = along(body, t);
            let tris: Vec<u32> = body.index[t.at..t.at + t.count].to_vec();
            if let Some(i) = drawn.stumps.iter().position(|s| s.0 == k) {
                commands.entity(drawn.stumps.swap_remove(i).1).despawn();
            }
            if keep > 0.0 {
                // What is left: its corners past `keep` of its height pressed flat onto the break, in the frame of the bone
                // it stands in.
                let (lo, hi) = (t.v0..=t.v1).map(|v| body.position[v as usize].y).fold((f32::INFINITY, f32::NEG_INFINITY), |(a, b), y| (a.min(y), b.max(y)));
                let cut = if t.upper { hi - keep * (hi - lo) } else { lo + keep * (hi - lo) };
                let head = body.bones[t.owner].head;
                let corners = (t.v0..=t.v1).map(|v| {
                    let mut q = body.position[v as usize];
                    if along(v) > keep {
                        q.y = cut;
                    }
                    q - head
                }).collect();
                let uvs = body.uv[t.v0 as usize..=t.v1 as usize].to_vec();
                let stump = mesh_of(corners, uvs, tris.iter().map(|&v| v - t.v0).collect());
                let s = commands.spawn((Mesh3d(meshes.add(stump)), MeshMaterial3d(material.clone()), Transform::default(), ChildOf(person.joints[t.owner]))).id();
                drawn.stumps.push((k, s));
            }
            // The lost piece (past `keep` of its height, or all of it), or bits of it, thrown out of the mouth from where
            // it was along `dir` and left to fall where it falls.
            let at = posed(person, root, t);
            let r#where = at.iter().step_by(4).sum::<Vec3>() / at.iter().step_by(4).count() as f32;
            let head = crate::face::bone_world(person, root, body.by_name["head"]);
            let outward = head.transform_vector3(Vec3::NEG_Z).normalize();
            let scale = if pieces > 1 { 0.45 } else { 1.0 };
            for n in 0..pieces as usize {
                let r = &throws[n * 7..n * 7 + 7];
                let (mut corners, mut uvs, mut idx) = (Vec::new(), Vec::new(), Vec::new());
                let mut map = std::collections::HashMap::new();
                for tri in tris.chunks_exact(3) {
                    if tri.iter().all(|&v| along(v) < keep) {
                        continue;
                    }
                    for &v in tri {
                        let i = *map.entry(v).or_insert_with(|| {
                            corners.push((at[(v - t.v0) as usize] - r#where) * scale);
                            uvs.push(body.uv[v as usize]);
                            corners.len() as u32 - 1
                        });
                        idx.push(i);
                    }
                }
                if idx.is_empty() {
                    continue;
                }
                let linear = outward * (0.3 + 0.5 * r[0]) + dir * (0.5 * r[1]) + Vec3::new((r[2] - 0.5) * 0.4, 0.4, (r[3] - 0.5) * 0.4);
                let angular = Vec3::new(r[4] * 20.0 - 10.0, r[5] * 20.0 - 10.0, r[6] * 20.0 - 10.0);
                let piece = commands.spawn((
                    Mesh3d(meshes.add(mesh_of(corners, uvs, idx))),
                    MeshMaterial3d(material.clone()),
                    Transform::from_translation(r#where + outward * 0.03),
                    RigidBody::Dynamic,
                    Collider::ball(0.004 * scale),
                    ColliderMassProperties::Mass(0.002 * scale),
                    Friction::coefficient(0.6),
                    Restitution::coefficient(0.35),
                    CollisionGroups::new(DEBRIS, crate::map::WORLD),
                    Velocity { linear, angular },
                    // (Its collider is a ball; a tooth is anything but, and tumbles to a stop instead of rolling away.)
                    Damping { linear_damping: 1.5, angular_damping: 6.0 },
                    Name::new(format!("{} piece", t.name)),
                )).id();
                debris.0.push_back(piece);
                if debris.0.len() > MOST_DEBRIS {
                    let old = debris.0.pop_front().unwrap();
                    commands.entity(old).try_despawn();
                }
            }
        }
        if let Some(fresh) = fresh {
            commands.entity(e).insert(fresh);
        }
    }
}

pub fn plugin(app: &mut App) {
    // (Before what happened is forgotten, so that a tooth knocked out anywhere in the last frame, a scenario's step
    // included, is drawn.)
    app.init_resource::<Debris>().add_systems(First, draw_teeth.before(crate::npc::forget));
}
