// The body's wall where an opening goes through it: the cut face of every layer between the skin and the cavity
// (src/sandbox/wall.ts).
//
// An opening (viscera.rs) is a lens-shaped hole in the skin. Under it the real wall is centimetres thick, and what a
// wound through it shows is that thickness: the skin's edge, the fat, the white fascia, the muscles with their grain, in
// the chest the ribs and the intercostal muscles between them and the pleura under them, in the belly the rectus or the
// three flat muscles and the peritoneum (dev/research/body-wall.md, sections 1-2). This is that face: a ring of geometry
// from the skin's edge down to the cavity, in the person's rest space, carried by the opening's bone as the organs are.
//
// Each column of the ring is measured into the anatomy under that point of skin (how deep the rib, the sternum, the lung
// or the bowel is there), and the layers between are laid in at their thicknesses for that site; fat takes up what is
// left, as it does from man to man. What each layer is, how deep it ends, and which way its fibres run is given to the
// shader (wall.wesl) per column; it draws each as it looks cut, muscle from a grain that runs along its fibres in space,
// so a face across them is stippled with the ends of fascicles and one along them is striped.

use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::DynamicSkinnedMeshBounds;
use bevy::light::NotShadowReceiver;
use bevy::mesh::skinning::SkinnedMesh;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::pbr::{ExtendedMaterial, MaterialExtension};
use bevy::prelude::*;
use bevy::render::render_resource::AsBindGroup;
use bevy::shader::ShaderRef;

use crate::npc::{self, Crossing};
use crate::person::Person;
use crate::viscera::Opening;

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

const RINGS: usize = 14; // from the skin down to the cavity
const FAR: f32 = 0.09; // m looked into the anatomy under each column for the cavity
const COLUMNS: usize = 40; // round the opening (viscera.rs lips)
const CAVITY: f32 = 1000.0; // the picture's u from here on: the cavity's bottom under the wall (wall.wesl), 0 to 1 to its middle

// Millimetres of each layer, a lean-to-average man (body-wall.md 1.2-1.5): skin, fascia, the muscles, the lining.
const DERMIS: f32 = 2.0;
const CHEST_FASCIA: f32 = 0.7;
const PEC: [f32; 2] = [6.0, 16.0];
const SERRATUS: [f32; 2] = [3.0, 7.0];
const SPACE: f32 = 9.0;
const CHEST_LINING: f32 = 1.0;
const SHEATH: f32 = 1.0;
const LINEA_MM: f32 = 2.5;
const RECTUS_MM: f32 = 11.0;
const EO: f32 = 6.0;
const IO: f32 = 9.0;
const TA: f32 = 5.0;
const BELLY_LINING: f32 = 3.0;
const LINEA: f32 = 0.012; // m either side of the midline that is linea alba
const RECTUS: f32 = 0.075; // and that is rectus
const PECTORAL: f32 = 0.15; // m from the midline the pectorals cover the ribs; serratus anterior past it
const CARTILAGE: f32 = 0.06; // m from the midline a rib is costal cartilage (body-wall.md 1.3: its front 2-8 cm)

// The organs that are the cavity's contents: the wall ends where the first of them begins.
fn cavity(kind: &str) -> bool {
    ["lung", "heart", "liver", "stomach", "bowel", "colon", "spleen", "gallbladder", "pancreas", "bladder", "muscle", "kidney", "brain"].contains(&kind)
}

// The scalp and the skull's vault, mm: the scalp's skin, the dense fat under it, the galea (its tendon sheet), and under
// the bone the dura (the scalp 5 to 7 mm in all; the vault 6 to 7 mm of bone, thicker at the back, thinner at the
// temple: an adult's, Lynnerup 2001).
const SCALP_FAT: f32 = 3.0;
const GALEA: f32 = 1.0;
const VAULT: f32 = 6.5;
const DURA: f32 = 1.0;

// One column's layers: where each ends, in mm below the skin (dermis, fat, fascia or sheath, three muscles, the zone of
// the ribs, the lining: its end is the wall's whole depth); which way each muscle's fibres run (rest space); what is in
// the ribs' zone there (0 intercostal muscle, 1 bone, 2 costal cartilage), and whether it is the belly.
struct Column {
    ends: [f32; 8],
    fibres: [Vec3; 3],
    zone: f32,
    belly: bool,
}

// The cut wall's look: each column's layers and fibres (five to a column: the ends, the ends, the three fibres with the
// zone in the first's fourth).
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub struct Layers {
    #[uniform(100)]
    pub columns: [Vec4; COLUMNS * 5],
}

impl MaterialExtension for Layers {
    fn fragment_shader() -> ShaderRef {
        "embedded://cold_chain/wall.wesl".into()
    }
}

pub type WallMaterial = ExtendedMaterial<StandardMaterial, Layers>;

// The layers under `top` (rest space) along `into` (world): measured to the ribs and the cavity, the soft layers laid in
// at their thicknesses for the site, fat taking up the rest (it is what differs most between men).
fn column(npc: &mut npc::Npc, owner: usize, top: Vec3, into: Vec3, place: &str, shoulder: &dyn Fn(f32) -> Vec3) -> Column {
    let chest = place == "chest";
    let from = npc.world_of(top, owner, None).0;
    let traced = npc.traced.clone();
    let only = |p: &crate::anatomy::TracedPart| cavity(&p.kind) || p.name.contains("rib") || p.name.contains("sternum");
    let (spans, _) = npc.trace(from, into, FAR, 0.0, Some(&only));
    let organ = spans.iter().find(|s| cavity(&traced.parts[s.part].kind));
    if place == "head" {
        // The scalp, the vault of bone (drawn as the ribs' bone is), the dura; the brain where the anatomy has it.
        let deep = organ.map_or(DERMIS + SCALP_FAT + GALEA + VAULT + DURA, |o| o.enter * 1000.0).clamp(10.0, 30.0);
        let (e1, e2) = (DERMIS + SCALP_FAT, DERMIS + SCALP_FAT + GALEA);
        let zone_end = (deep - DURA).max(e2 + 2.0);
        return Column { ends: [DERMIS, e1, e2, e2, e2, e2, zone_end, deep], fibres: [Vec3::ZERO; 3], zone: 1.0, belly: false };
    }
    let rib = spans.iter().find(|s| {
        let n = &traced.parts[s.part].name;
        (n.contains("rib") || n.contains("sternum")) && organ.is_none_or(|o| s.enter < o.enter + 0.005)
    });
    let x = top.x;
    let medial = Vec3::new(if x > 0.0 { -1.0 } else { 1.0 }, 0.0, 0.0);
    if chest {
        let mut deep = organ.map_or(42.0, |o| o.enter * 1000.0);
        if let Some(r) = rib {
            deep = deep.max(r.leave * 1000.0 + CHEST_LINING);
        }
        let deep = deep.clamp(18.0, 70.0);
        let zone_end = deep - CHEST_LINING;
        let zone_start = match rib {
            Some(r) => (DERMIS + 3.0).max((r.enter * 1000.0).min(zone_end - 4.0)),
            None => (DERMIS + 3.0).max(zone_end - SPACE),
        };
        let zone = match rib {
            Some(r) if traced.parts[r.part].name.contains("sternum") || x.abs() > CARTILAGE => 1.0,
            Some(_) => 2.0,
            None => 0.0,
        };
        let soft = zone_start - DERMIS - CHEST_FASCIA;
        // Over the breastbone the pectorals thin to nothing at the midline.
        let pec = x.abs() < PECTORAL;
        let [lo, hi] = if pec { PEC } else { SERRATUS };
        let muscle = hi.min((soft - 2.0).max(0.0)).min(lo.max(soft * 0.55)) * if pec { (x.abs() / 0.04).min(1.0) } else { 1.0 };
        let fat = soft - muscle;
        let e1 = DERMIS + fat;
        let e2 = e1 + CHEST_FASCIA;
        let e3 = e2 + muscle;
        // Pectoralis major's fibres converge on the arm; serratus anterior's run back round the chest to the scapula.
        let fibre = if pec { (shoulder(x) - top).normalize() } else { Vec3::new(0.0, 0.2, 1.0).normalize() };
        return Column { ends: [DERMIS, e1, e2, e3, e3, e3, zone_end, deep], fibres: [fibre, Vec3::ZERO, Vec3::ZERO], zone, belly: false };
    }
    let deep = organ.map_or(34.0, |o| o.enter * 1000.0).clamp(22.0, 60.0);
    let (linea, rectus) = (x.abs() < LINEA, x.abs() < RECTUS);
    let sheath = if linea { LINEA_MM } else if rectus { SHEATH } else { 0.5 };
    let mut m = if linea { [0.0; 3] } else if rectus { [RECTUS_MM, 0.0, 0.0] } else { [EO, IO, TA] };
    // Fat at least 4 mm; a wall thinner than the muscles' sum has thinner muscles (a smaller man), not none.
    let room = deep - DERMIS - sheath - BELLY_LINING - 4.0;
    let sum = m[0] + m[1] + m[2];
    if sum > room {
        m = m.map(|t| t * room.max(0.0) / sum);
    }
    let fat = deep - DERMIS - sheath - BELLY_LINING - m[0] - m[1] - m[2];
    let e1 = DERMIS + fat;
    let e2 = e1 + sheath;
    let e3 = e2 + m[0];
    let e4 = e3 + m[1];
    let e5 = e4 + m[2];
    // Rectus vertical; external oblique down and in, internal oblique up and in, transversus across (1.5).
    let fibres = if rectus { [Vec3::Y, Vec3::ZERO, Vec3::ZERO] } else { [medial * 0.6 + Vec3::NEG_Y * 0.8, medial * 0.6 + Vec3::Y * 0.8, medial] };
    Column { ends: [DERMIS, e1, e2, e3, e4, e5, e5, deep], fibres, zone: 0.0, belly: true }
}

// The wall of opening `o` of person `who` through the chest, the belly or the skull (`place`), its columns' tops at `edge` (the skin's
// crossings all round its lips, viscera.rs lips; None where none was found).
pub fn build(world: &mut World, who: Entity, o: &Opening, edge: &[Option<Crossing>], place: &str) -> Option<Entity> {
    let ey = o.normal.cross(o.ex);
    let n = edge.len();
    if n != COLUMNS {
        return None;
    }
    // Each column's top: where the skin's edge is, or (none found there) the lens on the opening's plane.
    let tops: Vec<Vec3> = edge
        .iter()
        .enumerate()
        .map(|(k, h)| match h {
            Some(h) => h.rest,
            None => o.edge(k as f32 / n as f32 * std::f32::consts::TAU),
        })
        .collect();
    let body = world.get::<Person>(who)?.body.clone();
    let shoulder = |x: f32| body.bone(&format!("upperarm01.{}", if x > 0.0 { "R" } else { "L" })).head;
    let mut columns: Vec<Column> = npc::with(world, who, |npc| {
        let into = -npc.world_of(o.at, o.owner, Some(o.normal)).1.unwrap();
        tops.iter().map(|&top| column(npc, o.owner, top, into, place, &shoulder)).collect()
    })?;
    // Torn, not cut: each layer gave where it was weakest, so no layer ends at one depth all round; a band of each a
    // third thicker here and thinner there, round the hole.
    let seed = (o.at.x * 91.3 + o.at.y * 47.9 + o.at.z * 213.1).rem_euclid(1.0) * std::f32::consts::TAU;
    let wave = |k: usize, j: f32| {
        let a = k as f32 / COLUMNS as f32 * std::f32::consts::TAU;
        0.6 * (2.0 * a + seed * j).sin() + 0.4 * (5.0 * a + seed * (j + 1.7)).sin()
    };
    if o.torn {
        for (k, c) in columns.iter_mut().enumerate() {
            let deep = c.ends[7];
            let mut at = 0.0;
            let mut ends = c.ends;
            for j in 0..7 {
                let was = c.ends[j] - if j == 0 { 0.0 } else { c.ends[j - 1] };
                at += was * (1.0 + 0.33 * wave(k, 1.0 + j as f32));
                ends[j] = at;
            }
            let scale = (deep - 0.5) / at.max(1.0);
            for j in 0..7 {
                ends[j] = (ends[j] * scale).min(deep - 0.5);
            }
            c.ends = ends;
        }
    }

    // The ring's corners: down each column into the body along the opening's facing, the cut muscle drawn back across the
    // cut as far as its fibres cross it (cut across them it retracts; along them it hardly gapes: 2.1), the fat bulging a
    // little into the hole.
    let (mut pos, mut uv, mut colour) = (Vec::new(), Vec::new(), Vec::new());
    let down = -o.normal;
    for (k, c) in columns.iter().enumerate() {
        let top = tops[k];
        let deep = c.ends[7];
        let across = (top - o.at).dot(ey);
        for r in 0..RINGS {
            let mm = -0.5 + (deep + 0.5) * (r as f32 / (RINGS - 1) as f32);
            let layer = c.ends.iter().position(|&e| mm <= e).unwrap_or(7);
            let widen = if (3..=5).contains(&layer) {
                0.6 * c.fibres[layer - 3].dot(ey).abs()
            } else if layer == 1 {
                -0.08 * (std::f32::consts::PI * ((mm - c.ends[0]) / (c.ends[1] - c.ends[0]).max(1.0)).min(1.0)).sin()
            } else {
                0.0
            };
            let mut p = top + down * (mm / 1000.0) + ey * (across * widen);
            if o.torn {
                // Burst from inside, the gas or the blast spreads under the skin before it tears through: the fat under
                // the edge is torn back from it (the edge undermined, hanging over a wider cavity), the muscle under that
                // ragged, standing in and out by a few millimetres from fibre bundle to bundle (DiMaio: contact wounds'
                // undermined margins; tissue torn, not cut).
                let out = (top - o.at - o.normal * (top - o.at).dot(o.normal)).normalize_or_zero();
                let t = (mm / deep.max(1.0)).clamp(0.0, 1.0);
                let under = (std::f32::consts::PI * t).sin().powf(0.7) * 0.3 * (top - o.at).length() * (0.8 + 0.3 * wave(k, 7.3));
                let shred = 0.0035 * wave(k * 3 + r, 11.1) * smoothstep(0.08, 0.3, t);
                p += out * (under + shred);
            }
            pos.push(p);
            uv.push([mm, k as f32]);
            colour.push([p.x, p.y, p.z, 0.0]);
        }
    }
    let mut index = Vec::new();
    for k in 0..n {
        let (a, b) = ((k * RINGS) as u32, (((k + 1) % n) * RINGS) as u32);
        for r in 0..RINGS as u32 - 1 {
            index.extend([a + r, b + r, a + r + 1, b + r, b + r + 1, a + r + 1]);
        }
    }
    // The cavity closed under the wall, as far in as what fills it: no seeing through the body to the floor where the
    // organs drawn near the opening leave a gap. In the head the brain, pulped where the shot went (its look: past the
    // wall's depth, wall.wesl); in the trunk the dark of the cavity, blood standing in it. A ring drawn in to a point
    // under the middle, some way behind the wall.
    let behind = if place == "head" { 0.012 } else { 0.06 };
    let first = pos.len() as u32;
    let mut sum = Vec3::ZERO;
    for (k, c) in columns.iter().enumerate() {
        let last = pos[k * RINGS + RINGS - 1];
        let p = o.at + (last - o.at) * 0.55 + down * (c.ends[7] / 1000.0 + behind * 0.6);
        sum += p;
        pos.push(p);
        uv.push([CAVITY, k as f32]);
        colour.push([p.x, p.y, p.z, 0.0]);
    }
    let bottom = sum / n as f32 + down * behind * 0.4;
    pos.push(bottom);
    uv.push([CAVITY + 1.0, 0.0]);
    colour.push([bottom.x, bottom.y, bottom.z, 0.0]);
    let centre = pos.len() as u32 - 1;
    for k in 0..n as u32 {
        let next = (k + 1) % n as u32;
        let (a, b) = (k * RINGS as u32 + RINGS as u32 - 1, next * RINGS as u32 + RINGS as u32 - 1);
        index.extend([a, b, first + k, b, first + next, first + k]);
        index.extend([first + k, first + next, centre]);
    }
    let vertices = pos.len();
    let mid = pos.iter().sum::<Vec3>() / vertices as f32;
    let p0 = pos[RINGS];
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uv)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colour)
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_INDEX, VertexAttributeValues::Uint16x4(vec![[o.owner as u16, 0, 0, 0]; vertices]))
        .with_inserted_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, vec![[1.0f32, 0.0, 0.0, 0.0]; vertices])
        .with_inserted_indices(Indices::U32(index));
    crate::flesh::normals(&mut mesh);
    // Facing into the hole, where it is seen from.
    if let Some(VertexAttributeValues::Float32x3(nor)) = mesh.attribute_mut(Mesh::ATTRIBUTE_NORMAL) {
        if Vec3::from(nor[RINGS]).dot(mid - p0) < 0.0 {
            for v in nor.iter_mut() {
                *v = [-v[0], -v[1], -v[2]];
            }
        }
    }
    mesh.generate_skinned_mesh_bounds().ok();
    let mut data = [Vec4::ZERO; COLUMNS * 5];
    for (k, c) in columns.iter().enumerate() {
        data[k * 5] = Vec4::from_slice(&c.ends[0..4]);
        data[k * 5 + 1] = Vec4::from_slice(&c.ends[4..8]);
        data[k * 5 + 2] = c.fibres[0].extend(c.zone + if c.belly { 4.0 } else { 0.0 });
        data[k * 5 + 3] = c.fibres[1].extend(if o.torn { 1.0 } else { 0.0 });
        data[k * 5 + 4] = c.fibres[2].extend(if place == "head" { 1.0 } else { 0.0 });
    }
    let mut state: bevy::ecs::system::SystemState<(Commands, ResMut<Assets<Mesh>>, ResMut<Assets<WallMaterial>>, Query<&Person>, Query<&SkinnedMesh>, Query<&ChildOf>)> =
        bevy::ecs::system::SystemState::new(world);
    let e = {
        let (mut commands, mut meshes, mut materials, people, skins, parents) = state.get_mut(world).unwrap();
        let first = people.get(who).ok()?.parts[0].1;
        let skin = skins.get(first).ok()?.clone();
        let space = parents.get(first).ok()?.parent();
        let material = materials.add(ExtendedMaterial {
            base: StandardMaterial { base_color: Color::WHITE, metallic: 0.0, perceptual_roughness: 0.5, double_sided: true, cull_mode: None, ..default() },
            extension: Layers { columns: data },
        });
        // (As the organs: the shadow maps are drawn from the whole skin and know nothing of the hole.)
        commands.spawn((Mesh3d(meshes.add(mesh)), MeshMaterial3d(material), skin, DynamicSkinnedMeshBounds, NotShadowReceiver, ChildOf(space))).id()
    };
    state.apply(world);
    Some(e)
}

pub fn plugin(app: &mut App) {
    bevy::asset::embedded_asset!(app, "wall.wesl");
    app.add_plugins(MaterialPlugin::<WallMaterial>::default());
}
