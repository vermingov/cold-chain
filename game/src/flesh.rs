// A person's own skin and clothes, cut (what hider.ts did for dismember.ts and viscera.ts, done on the geometry).
//
// In the TS a limb cut off kept every triangle the cut ran through in both meshes, the body's and the piece's, and each
// drew only its own side of the plane (a shader test per pixel against every cut); an opening through the belly left the
// skin and the clothes over it undrawn in a lens (the same, against every opening); and the skin under the clothes, never
// drawn, was drawn in a window round each. Here the triangles are cut instead, once, when it happens: the skin and the
// clothes are this person's own meshes from then on, each triangle a cut runs through cut along it (its new corners
// with the colours, picture and weights of the edge they are on), the triangles in an opening taken out and those across
// its edge cut small along it, and the skin under the clothes put in as meshes of its own where a window shows it. The
// same planes and lenses as the TS's, in the person's rest space, so what is drawn is what it drew; nothing is asked per
// pixel.

use std::sync::Arc;

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::DynamicSkinnedMeshBounds;
use bevy::mesh::skinning::SkinnedMesh;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;

use crate::person::{Body, Person};

// A limb's cut: the plane through `c` square to unit `n` (away from the body), within `radius` of `c`. A torn one leaves
// cloth with a ragged edge (the skin's is closed by the cut face, which lies on the plane).
#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub c: Vec3,
    pub n: Vec3,
    pub radius: f32,
    pub tore: bool,
}

// An opening through the skin: at `at` running along `ex` on skin facing `ey`, `half` its half length and half width,
// `depth` how far either side of its plane (hider.ts's slot, a lens: viscera.rs `gape`).
#[derive(Clone, Copy, Debug)]
pub struct Lens {
    pub at: Vec3,
    pub ex: Vec3,
    pub ey: Vec3,
    pub half: [f32; 2],
    pub depth: f32,
}

// A window in the clothes through which the skin under them is seen: round, `radius` across at `at`, through clothes
// facing `n`, `depth` either side.
#[derive(Clone, Copy, Debug)]
pub struct Window {
    pub at: Vec3,
    pub n: Vec3,
    pub radius: f32,
    pub depth: f32,
}

// A corner of a triangle being cut: where it is at rest, which way it faces, where it is in the picture, its bones.
#[derive(Clone, Copy)]
pub struct Corner {
    pub p: Vec3,
    pub n: Vec3,
    pub uv: Vec2,
    pub j: [u16; 4],
    pub w: [f32; 4],
}

impl Corner {
    fn lerp(&self, o: &Corner, t: f32) -> Corner {
        // (The weights of the two, mixed, the four heaviest kept.)
        let mut bones: [(u16, f32); 8] = [(0, 0.0); 8];
        for k in 0..4 {
            bones[k] = (self.j[k], self.w[k] * (1.0 - t));
            bones[k + 4] = (o.j[k], o.w[k] * t);
        }
        for k in 4..8 {
            if let Some(same) = (0..4).find(|&q| bones[q].0 == bones[k].0 && bones[q].1 + bones[k].1 > 0.0) {
                bones[same].1 += bones[k].1;
                bones[k].1 = 0.0;
            }
        }
        bones.sort_by(|a, b| b.1.total_cmp(&a.1));
        let sum: f32 = bones[..4].iter().map(|b| b.1).sum::<f32>().max(1e-9);
        Corner {
            p: self.p.lerp(o.p, t),
            n: self.n.lerp(o.n, t).normalize_or_zero(),
            uv: self.uv.lerp(o.uv, t),
            j: [0, 1, 2, 3].map(|k| bones[k].0),
            w: [0, 1, 2, 3].map(|k| bones[k].1 / sum),
        }
    }
}

// Smooth noise over rest space, for a ragged edge (hider.ts's hiderNoise: the same at the same place every time).
pub fn noise(p: Vec3) -> f32 {
    let hash = |q: Vec3| ((q.dot(Vec3::new(12.9898, 78.233, 37.719))).sin() * 43758.547).fract().abs();
    let (i, f) = (p.floor(), p - p.floor());
    let f = f * f * (Vec3::splat(3.0) - 2.0 * f);
    let at = |x: f32, y: f32, z: f32| hash(i + Vec3::new(x, y, z));
    let lerp = |a: f32, b: f32, t: f32| a + (b - a) * t;
    lerp(
        lerp(lerp(at(0.0, 0.0, 0.0), at(1.0, 0.0, 0.0), f.x), lerp(at(0.0, 1.0, 0.0), at(1.0, 1.0, 0.0), f.x), f.y),
        lerp(lerp(at(0.0, 0.0, 1.0), at(1.0, 0.0, 1.0), f.x), lerp(at(0.0, 1.0, 1.0), at(1.0, 1.0, 1.0), f.x), f.y),
        f.z,
    )
}

impl Plane {
    // How far past the plane a point is (more than nothing: on the piece's side), its edge ragged if it was torn and
    // this is cloth (the same wandering edge on the body's side and the piece's, so they meet).
    fn past(&self, p: Vec3, cloth: bool) -> f32 {
        let frayed = if self.tore && cloth { (noise(p * 70.0) - 0.5) * 0.04 + (noise(p * 400.0) - 0.5) * 0.008 } else { 0.0 };
        (p - self.c).dot(self.n) + frayed
    }
}

impl Lens {
    // Whether a point is in the opening (hider.ts: a slit gaping most at its middle and closing to its ends, its edge
    // wandering by a tenth of its width or so, as torn skin's does).
    pub fn holds(&self, p: Vec3) -> bool {
        let d = p - self.at;
        if d.dot(self.ey).abs() >= self.depth {
            return false;
        }
        let across = self.ex.cross(self.ey);
        let (x, y) = (d.dot(self.ex), d.dot(across));
        let along = (x.abs() / self.half[0]).min(1.0);
        let lens = 0.5 + 0.5 * ((self.half[0] / self.half[1] - 1.0) * 0.5).clamp(0.0, 1.0);
        y.abs() < self.half[1] * (1.0 - along * along).max(0.0).powf(lens) * (0.92 + 0.16 * noise(p * 260.0))
    }

    fn near(&self, p: Vec3, by: f32) -> bool {
        p.distance(self.at) < self.half[0].max(self.half[1]) + by
    }
}

impl Window {
    pub fn shows(&self, p: Vec3) -> bool {
        let d = p - self.at;
        d.dot(self.n).abs() < self.depth && (d - self.n * d.dot(self.n)).length() < self.radius
    }
}

// The polygon `poly` cut by a plane, the part where `side(p)` is at most nothing kept (Sutherland and Hodgman).
fn keep(poly: Vec<Corner>, side: &dyn Fn(Vec3) -> f32) -> Vec<Corner> {
    let s: Vec<f32> = poly.iter().map(|c| side(c.p)).collect();
    if s.iter().all(|&x| x <= 0.0) {
        return poly;
    }
    if s.iter().all(|&x| x > 0.0) {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(poly.len() + 1);
    for i in 0..poly.len() {
        let j = (i + 1) % poly.len();
        if s[i] <= 0.0 {
            out.push(poly[i]);
        }
        if (s[i] <= 0.0) != (s[j] <= 0.0) {
            out.push(poly[i].lerp(&poly[j], s[i] / (s[i] - s[j])));
        }
    }
    out
}

// A triangle with the openings taken out of it: halved across its longest side while it is across an opening's edge
// and longer than 3 mm, the small ones whose middle is in it left out.
fn holed(t: [Corner; 3], holes: &[Lens], out: &mut Vec<[Corner; 3]>) {
    let mid = (t[0].p + t[1].p + t[2].p) / 3.0;
    let size = t[0].p.distance(t[1].p).max(t[1].p.distance(t[2].p)).max(t[2].p.distance(t[0].p));
    let near: Vec<&Lens> = holes.iter().filter(|h| h.near(mid, size)).collect();
    if near.is_empty() {
        out.push(t);
        return;
    }
    let inside = |p: Vec3| near.iter().any(|h| h.holds(p));
    let ins = [inside(t[0].p), inside(t[1].p), inside(t[2].p), inside(mid)];
    if size <= 0.003 || ins.iter().all(|&x| !x) && size < 0.01 {
        if !ins[3] {
            out.push(t);
        }
        return;
    }
    let sides = [t[0].p.distance_squared(t[1].p), t[1].p.distance_squared(t[2].p), t[2].p.distance_squared(t[0].p)];
    let a = if sides[0] >= sides[1] && sides[0] >= sides[2] { 0 } else if sides[1] >= sides[2] { 1 } else { 2 };
    let (b, c) = ((a + 1) % 3, (a + 2) % 3);
    let m = t[a].lerp(&t[b], 0.5);
    holed([t[a], m, t[c]], holes, out);
    holed([m, t[b], t[c]], holes, out);
}

// The cuts a triangle of the body meets: each plane it is near, kept to the side of it `sides` says (1 the body's, -1
// the piece's, 0 not at all), and the openings.
pub struct Cuts<'a> {
    pub planes: &'a [Plane],
    pub sides: &'a [f32],
    pub holes: &'a [Lens],
    pub cloth: bool,
}

impl Cuts<'_> {
    // Triangle `t` as what is left of it, in triangles.
    pub fn apply(&self, t: [Corner; 3], out: &mut Vec<[Corner; 3]>) {
        let mid = (t[0].p + t[1].p + t[2].p) / 3.0;
        let mut poly: Vec<Corner> = t.to_vec();
        for (k, pl) in self.planes.iter().enumerate() {
            let side = self.sides.get(k).copied().unwrap_or(1.0);
            if side == 0.0 || mid.distance(pl.c) > pl.radius {
                continue;
            }
            poly = keep(poly, &|p| pl.past(p, self.cloth) * side);
            if poly.len() < 3 {
                return;
            }
        }
        let mut tris = Vec::new();
        for k in 1..poly.len() - 1 {
            tris.push([poly[0], poly[k], poly[k + 1]]);
        }
        if self.holes.is_empty() {
            out.extend(tris);
        } else {
            for t in tris {
                holed(t, self.holes, out);
            }
        }
    }
}

// Each corner's normal the mean of its triangles' (Babylon's ComputeNormals). (Bevy's own smooth normals weigh each
// corner by its angle only where both its sides' squared lengths multiplied come to more than f32's epsilon: on
// anything a few centimetres across, a cut face or a loop of bowel, every weight was nothing and every normal zero, and
// the surface drew black.)
pub fn normals(mesh: &mut Mesh) {
    let Some(VertexAttributeValues::Float32x3(pos)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION) else { return };
    let mut nor = vec![Vec3::ZERO; pos.len()];
    if let Some(index) = mesh.indices() {
        let index: Vec<usize> = index.iter().collect();
        for t in index.chunks_exact(3) {
            let (a, b, c) = (Vec3::from(pos[t[0]]), Vec3::from(pos[t[1]]), Vec3::from(pos[t[2]]));
            let n = (b - a).cross(c - a).normalize_or_zero();
            for &v in t {
                nor[v] += n;
            }
        }
    }
    let nor: Vec<[f32; 3]> = nor.iter().map(|n| n.normalize_or_zero().to_array()).collect();
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, nor);
}

// Triangles as a skinned mesh of a part's own: corners in order, three a triangle.
pub fn mesh_of(tris: &[[Corner; 3]]) -> Mesh {
    let n = (tris.len() * 3).max(3);
    let all = || tris.iter().flat_map(|t| t.iter());
    let empty = tris.is_empty();
    let pick = |f: &dyn Fn(&Corner) -> [f32; 3], d: [f32; 3]| if empty { vec![d; 3] } else { all().map(f).collect::<Vec<_>>() };
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pick(&|c| c.p.to_array(), [0.0; 3]))
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, pick(&|c| c.n.to_array(), [0.0, 1.0, 0.0]))
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, if empty { vec![[0.0f32; 2]; 3] } else { all().map(|c| c.uv.to_array()).collect() })
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(if empty { vec![[0; 4]; 3] } else { all().map(|c| c.j).collect() }))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, if empty { vec![[1.0f32, 0.0, 0.0, 0.0]; 3] } else { all().map(|c| c.w).collect() })
        .with_inserted_indices(Indices::U32((0..n as u32).collect()));
    mesh.generate_skinned_mesh_bounds().ok();
    mesh
}

// The person's own skin and clothes: the body's corners' bones and weights as they are now (what the body keeps round a
// limb cut off is carried by the bone it hung from), its triangles (a triangle gone to a piece cut off has its corners
// made one), the cuts and openings in it, and the windows the skin under the clothes is seen through; each drawn part's
// own mesh once any of that has changed it, and the skin under the clothes' meshes.
#[derive(Component)]
pub struct Flesh {
    pub joints: Vec<[u16; 4]>,
    pub weights: Vec<[f32; 4]>,
    pub drawn: Vec<u32>,
    pub planes: Vec<Plane>,
    pub holes: Vec<Lens>,
    pub cloth_holes: Vec<Lens>,
    pub windows: Vec<Window>,
    // Each drawn part's entity and its own mesh; each under part's entity and mesh, once a window shows some of it.
    pub own: Vec<(usize, Entity, Option<Handle<Mesh>>)>,
    pub under: Vec<(usize, Entity, Handle<Mesh>)>,
    // Parts to make again.
    pub stale: Vec<bool>,
}

impl Flesh {
    pub fn new(body: &Body, person: &Person) -> Flesh {
        Flesh {
            joints: body.joints.clone(),
            weights: body.weights.iter().map(|w| w.map(|x| x as f32 / 255.0)).collect(),
            drawn: body.index.clone(),
            planes: Vec::new(),
            holes: Vec::new(),
            cloth_holes: Vec::new(),
            windows: Vec::new(),
            own: person.parts.iter().map(|&(i, e)| (i, e, None)).collect(),
            under: Vec::new(),
            stale: vec![false; body.parts.len()],
        }
    }

    pub fn corner(&self, body: &Body, v: u32, joints: &[[u16; 4]], weights: &[[f32; 4]]) -> Corner {
        let v = v as usize;
        Corner { p: body.position[v], n: body.normal[v], uv: body.uv[v], j: joints[v], w: weights[v] }
    }

    // Every part with a triangle within `r` of `at` to be made again.
    pub fn touch(&mut self, body: &Body, at: Vec3, r: f32) {
        for (i, p) in body.parts.iter().enumerate() {
            if self.stale[i] || !(p.kind == "skin" || p.kind == "cloth") {
                continue;
            }
            self.stale[i] = body.position[p.vertex_start..p.vertex_start + p.vertex_count].iter().any(|q| q.distance(at) < r);
        }
    }

    // The person's weights as medicine reads them (npc.rs `skinned`, `owner_of`).
    pub fn weights_for_medicine(&self) -> Arc<(Vec<[u16; 4]>, Vec<[u8; 4]>)> {
        Arc::new((self.joints.clone(), self.weights.iter().map(|w| w.map(|x| (x * 255.0).round() as u8)).collect()))
    }

    // What part `i` of the body draws now: its triangles still the body's, each cut by every plane it is near to the
    // body's side, the openings taken out (skin and clothes; anything else is not cut, as the TS's hider was only on
    // those), and for the skin under the clothes only what a window shows.
    pub fn part(&self, body: &Body, i: usize) -> Vec<[Corner; 3]> {
        let p = &body.parts[i];
        let cut = p.kind == "skin" || p.kind == "cloth";
        let sides = vec![1.0; self.planes.len()];
        let holes: &[Lens] = if !cut { &[] } else if p.kind == "cloth" { &self.cloth_holes } else { &self.holes };
        let cuts = Cuts { planes: if cut { &self.planes } else { &[] }, sides: &sides, holes, cloth: p.kind == "cloth" };
        let mut out = Vec::new();
        for t in self.drawn[p.index_start..p.index_start + p.index_count].chunks_exact(3) {
            if t[0] == t[1] && t[0] == t[2] {
                continue;
            }
            let c = [0, 1, 2].map(|k| self.corner(body, t[k], &self.joints, &self.weights));
            if p.under {
                let mid = (c[0].p + c[1].p + c[2].p) / 3.0;
                if !self.windows.iter().any(|w| w.shows(mid)) {
                    continue;
                }
            }
            cuts.apply(c, &mut out);
        }
        out
    }

    // Each part changed made again: into its own mesh (made the first time, filled in place after), the skin under
    // the clothes into a mesh of its own beside the parts, with the skin's material.
    #[allow(clippy::too_many_arguments)]
    pub fn rebuild(&mut self, body: &Body, commands: &mut Commands, meshes: &mut Assets<Mesh>, handles: &mut Query<&mut Mesh3d>,
                   materials: &Query<&MeshMaterial3d<StandardMaterial>>, skin: &SkinnedMesh, space: Entity) {
        for i in 0..self.stale.len() {
            if !std::mem::take(&mut self.stale[i]) {
                continue;
            }
            let mesh = mesh_of(&self.part(body, i));
            if body.parts[i].under {
                match self.under.iter().find(|u| u.0 == i) {
                    Some((_, _, h)) => {
                        if let Some(mut m) = meshes.get_mut(h.id()) {
                            *m = mesh;
                        }
                    }
                    None => {
                        // (The skin's own material: the first drawn skin part's.)
                        let Some(material) = self.own.iter().find(|o| body.parts[o.0].kind == "skin").and_then(|o| materials.get(o.1).ok()) else { continue };
                        let h = meshes.add(mesh);
                        let e = commands.spawn((Mesh3d(h.clone()), material.clone(), skin.clone(), DynamicSkinnedMeshBounds, ChildOf(space))).id();
                        self.under.push((i, e, h));
                    }
                }
                continue;
            }
            let Some(o) = self.own.iter_mut().find(|o| o.0 == i) else { continue };
            match &o.2 {
                Some(h) => {
                    if let Some(mut m) = meshes.get_mut(h.id()) {
                        *m = mesh;
                    }
                }
                None => {
                    let h = meshes.add(mesh);
                    if let Ok(mut m) = handles.get_mut(o.1) {
                        m.0 = h.clone();
                    }
                    o.2 = Some(h);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(p: Vec3) -> Corner {
        Corner { p, n: Vec3::Z, uv: p.truncate(), j: [1, 0, 0, 0], w: [1.0, 0.0, 0.0, 0.0] }
    }

    // A triangle across a plane: the body keeps the part on its side, the piece the rest, and together they are the
    // whole of it.
    #[test]
    fn halves_meet() {
        let t = [c(Vec3::new(-1.0, 0.0, 0.0)), c(Vec3::new(1.0, 0.0, 0.0)), c(Vec3::new(0.0, 1.0, 0.0))];
        let pl = [Plane { c: Vec3::ZERO, n: Vec3::X, radius: 5.0, tore: false }];
        let area = |list: &[[Corner; 3]]| list.iter().map(|t| (t[1].p - t[0].p).cross(t[2].p - t[0].p).length() / 2.0).sum::<f32>();
        let (mut body, mut piece) = (Vec::new(), Vec::new());
        Cuts { planes: &pl, sides: &[1.0], holes: &[], cloth: false }.apply(t, &mut body);
        Cuts { planes: &pl, sides: &[-1.0], holes: &[], cloth: false }.apply(t, &mut piece);
        assert!((area(&body) - 0.5).abs() < 1e-5 && (area(&piece) - 0.5).abs() < 1e-5);
        assert!(body.iter().flatten().all(|c| c.p.x <= 1e-6) && piece.iter().flatten().all(|c| c.p.x >= -1e-6));
    }

    // A lens 10 cm by 4 takes its middle out of a sheet and leaves its far corners.
    #[test]
    fn lens_hole() {
        let l = Lens { at: Vec3::ZERO, ex: Vec3::X, ey: Vec3::Z, half: [0.05, 0.02], depth: 0.02 };
        assert!(l.holds(Vec3::ZERO) && !l.holds(Vec3::new(0.0, 0.03, 0.0)) && !l.holds(Vec3::new(0.06, 0.0, 0.0)));
        let mut out = Vec::new();
        holed([c(Vec3::new(-0.1, -0.1, 0.0)), c(Vec3::new(0.1, -0.1, 0.0)), c(Vec3::new(0.0, 0.1, 0.0))], &[l], &mut out);
        assert!(out.iter().all(|t| !l.holds((t[0].p + t[1].p + t[2].p) / 3.0)) && out.len() > 10);
    }
}

// Each person's flesh changed since (an opening cut in it: viscera.rs) made again, once a frame.
#[allow(clippy::type_complexity)]
fn rebuild(mut commands: Commands, mut people: Query<(&Person, &mut Flesh)>, mut meshes: ResMut<Assets<Mesh>>, mut handles: Query<&mut Mesh3d>,
           materials: Query<&MeshMaterial3d<StandardMaterial>>, skins: Query<&SkinnedMesh>, parents: Query<&ChildOf>) {
    for (person, mut flesh) in &mut people {
        if !flesh.stale.iter().any(|&s| s) {
            continue;
        }
        let first = person.parts[0].1;
        let (Ok(skin), Ok(space)) = (skins.get(first), parents.get(first).map(|c| c.parent())) else { continue };
        let body = person.body.clone();
        flesh.rebuild(&body, &mut commands, &mut meshes, &mut handles, &materials, skin, space);
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(PostUpdate, rebuild.after(crate::viscera::update_system));
}
