// The `head` scenario (scenario.rs): the mouth filling with blood, the face cut by a sword, the skull opened and the eyes
// hurt, close up (BACKLOG item 7). `head-mouth`, `head-face`, `head-skull`, `head-eyes` run a part each; `head` all of
// them, each on people made new by K first.
//
// What a player does is done the way they do it: the sword is swung by the player's own hands at a face (warm.rs `take`,
// `press`), shots go through wounds.rs `pierce` as weapons.rs sends them, blows through `blow`. Blood is put into the
// mouth, lungs and stomach by hand where the point is how it looks at a given amount.

use bevy::ecs::system::RunSystemOnce;
use bevy::prelude::*;
use serde_json::json;

use crate::face::{close, dark, face_at, who};
use crate::npc::{self, Kind};
use crate::player::Player;
use crate::scenario::{log, Step};
use crate::vitals::Vitals;

// The photographer's lamp, held by the eye: the hall's lamps are high and far, and a mouth or an eye socket close up is
// otherwise all shadow.
#[derive(Component)]
struct Lamp;

const LAMP: f32 = 0.25 * crate::map::CANDELA;

// The eye put at `from`, looking at `at`, and the lamp beside it (as bright on what it lights as from 40 cm).
fn look(w: &mut World, at: Vec3, from: Vec3) {
    w.resource_scope(|w, map: Mut<crate::map::Map>| {
        let ground = map.ground(from.x, from.z, f32::INFINITY);
        for mut p in w.query::<&mut Player>().iter_mut(w) {
            p.spawn(&map, from.x, from.z, Some(at), (from.y - ground).max(0.15));
        }
    });
    let far = at.distance(from);
    for (mut t, mut l) in w.query_filtered::<(&mut Transform, &mut PointLight), With<Lamp>>().iter_mut(w) {
        t.translation = from + (from - at).normalize_or_zero() * 0.05 + Vec3::Y * 0.1;
        l.intensity = LAMP * ((far + 0.05) / 0.4).min(1.0).powi(2);
    }
}

// The middle of the mouth (the dental arch), the head's ahead and up, now.
fn mouth_at(w: &mut World, e: Entity) -> (Vec3, Vec3, Vec3) {
    let (centre, head) = w.get::<crate::npc::Hurt>(e).and_then(|h| h.throat.centre).unwrap_or((Vec3::ZERO, 0));
    let mut q = w.query::<(&crate::person::Person, &Transform, Option<&crate::ragdoll::Ragdoll>)>();
    let (p, root, rd) = q.get(w, e).unwrap();
    let at = crate::face::bone_world(p, root, head).transform_point3(centre);
    let rot = rd.and_then(|rd| rd.segs.iter().find(|s| s.def.name == "head")).map_or(root.rotation, |s| s.now.rotation);
    (at, rot * Vec3::NEG_Z, rot * Vec3::Y)
}

// A picture of `body`'s mouth from `far` in front of it (and `up` above the line of the face, toward the top of the
// head: into an open mouth from a little above), then what is in the throat into the log.
fn mouth(name: &'static str, body: &'static str, far: f32, up: f32, turn: f32) -> Vec<Step> {
    vec![
        Step::Do(Box::new(move |w: &mut World| {
            hide_hud(w);
            let e = who(w, body);
            let (at, fwd, head_up) = mouth_at(w, e);
            let from = at + (Quat::from_axis_angle(head_up, turn.to_radians()) * fwd + head_up * up).normalize() * far;
            look(w, at, from);
        })),
        Step::Wait(3),
        Step::Shot(name.into()),
        Step::Do(Box::new(move |w: &mut World| {
            let e = who(w, body);
            let t = crate::npc::with(w, e, |n| {
                let t = &n.hurt.throat;
                json!({ "mouth": t.mouth, "lungs": [t.lungs.0, t.lungs.1], "stomach": t.stomach, "coat": t.coat, "to_lips": t.to_lips, "to_throat": t.to_throat })
            });
            log(w, json!({ "picture": name, "throat": t }));
        })),
    ]
}

// Nothing of the HUD over the pictures (the monitor makes its lines anew), and nothing in the hands.
fn hide_hud(w: &mut World) {
    for mut v in w.query_filtered::<&mut Visibility, (With<Node>, Without<ChildOf>, Without<ImageNode>)>().iter_mut(w) {
        *v = Visibility::Hidden;
    }
    let mut wp = w.resource_mut::<crate::weapons::Weapons>();
    if wp.slots[wp.slot] != Some("hands") {
        wp.slots[0] = Some("hands");
        wp.queue.push(crate::weapons::Act::Select(0));
    }
}

// face.rs's close-up, with the HUD and the hands out of it.
fn face(name: &'static str, body: &'static str, turn: f32, far: f32) -> Vec<Step> {
    // (The lamp by the eye, as close puts it: from above the brow it would leave the eyes in its shadow.)
    let mut s = vec![act(hide_hud), act(move |w| {
        let e = who(w, body);
        let (at, fwd) = face_at(w, e);
        let cam = at + Quat::from_rotation_y(turn.to_radians()) * fwd * far;
        // (As bright on the face from close as from 40 cm.)
        for (mut t, mut l) in w.query_filtered::<(&mut Transform, &mut PointLight), With<Lamp>>().iter_mut(w) {
            t.translation = cam + Vec3::Y * 0.02;
            l.intensity = LAMP * (far / 0.4).min(1.0).powi(2);
        }
    })];
    s.extend(close(name, body, turn, far));
    s
}

fn act(f: impl Fn(&mut World) + Send + Sync + 'static) -> Step {
    Step::Do(Box::new(f))
}

fn with(body: &'static str, f: impl Fn(&mut npc::Npc) + Send + Sync + 'static) -> Step {
    act(move |w| {
        let e = who(w, body);
        npc::with(w, e, |n| f(n));
    })
}

// The people as K leaves them, and a second and a half to settle.
fn fresh() -> Vec<Step> {
    vec![act(|w| {
        let _ = w.run_system_once(crate::sandbox::reset);
    }), Step::Wait(90)]
}

// What bleeds on `body` and where it goes, into the log.
fn bleeds(label: &'static str, body: &'static str) -> Step {
    act(move |w| {
        let e = who(w, body);
        let b = w.get::<Vitals>(e).map(|v| v.bleeds.iter().map(|b| json!([b.name, b.rate * 1000.0, b.internal, b.into.map(|i| format!("{i:?}"))])).collect::<Vec<_>>());
        let i = w.get::<Vitals>(e).map(|v| v.injuries.iter().map(|i| i.text.clone()).collect::<Vec<_>>());
        log(w, json!({ "event": "bleeds", "what": label, "bleeds": b, "injuries": i }));
    })
}

// A bullet of `weapon`'s through the point `off` (the head's right, up, ahead) from bone `bone`'s head on `body`, going
// along `dir` in the head's frame (right, up, and back into the head from its face).
fn shoot(body: &'static str, bone: &'static str, off: Vec3, dir: Vec3, weapon: &'static str) -> Step {
    with(body, move |n| {
        let b = n.bone_index(bone);
        let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
        let at = n.world_of(n.body().bones[b].head, b, None).0 + rot * Vec3::new(off.x, off.y, -off.z);
        let d = (rot * dir).normalize();
        let m = crate::weapons::arm(weapon).gun.as_ref().unwrap().m.wounds();
        crate::wounds::pierce(n, at - d * 1.0, d, &m, 2.0);
    })
}

// A picture of the first opening through `body`'s wall (viscera.rs: the belly, the chest or the skull) from `far` off it
// along the way its skin faces, a little from above.
fn opening(name: &'static str, body: &'static str, far: f32) -> Vec<Step> {
    vec![
        act(move |w| {
            hide_hud(w);
            let e = who(w, body);
            let Some((at, n)) = crate::viscera::opening_world(w, e, 0) else {
                log(w, json!({ "picture": name, "opening": null }));
                return;
            };
            look(w, at, at + (n + Vec3::Y * 0.3).normalize() * far);
        }),
        Step::Wait(3),
        Step::Shot(name.into()),
    ]
}

// Something done to the front or side of `body`'s neck, halfway up it: `f` is given where the skin is there, met from
// `from` (the head's frame: Vec3::NEG_Z its front, Vec3::X its right side), and the way in.
fn neck(body: &'static str, from: Vec3, f: impl Fn(&mut npc::Npc, Vec3, Vec3) + Send + Sync + 'static) -> Step {
    with(body, move |n| {
        // (In front under the chin, where the larynx is, three and a half centimetres below the mandible's tip; from the
        // side a little higher, clear of the shoulder.)
        let (a, j) = (n.bone_index("neck01"), n.bone_index("jaw"));
        let rest = Vec3::new(0.0, n.body().bones[j].tail.y - if from.x != 0.0 { 0.0 } else { 0.035 }, n.body().bones[a].head.z);
        let mid = n.rest_to_world(a).transform_point3(rest);
        let rot = n.segment("chest").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
        let d = -(rot * from).reject_from(Vec3::Y).normalize();
        let Some(skin) = n.surface(mid - d * 0.3, d, 0.6, false).into_iter().find(|h| h.kind == Kind::Skin) else { return };
        let owner = n.body().bones[skin.owner].name.clone();
        let neck = n.in_neck(skin.point);
        f(n, skin.point, d);
        info!("neck of {body}: skin met at {:?}, carried by {owner}, in the neck: {neck}", skin.point);
    })
}

// A sword's cut drawn across `body`'s face from its right to its left, `height` metres above (below, negative) the middle
// of the eyes and tilted `tilt` degrees (its left end higher), as deep as the sword cuts: what the edge meets along the
// line is pierced and handed on as an edge (npc.slash), the swing put through (dismember::swung: a chop, if the line is
// on the neck), the wall opened if it went through one (viscera::slashed), and the cut drawn along the skin.
fn sword(body: &'static str, height: f32, tilt: f32) -> Step {
    act(move |w| {
        let e = who(w, body);
        let (eyes, fwd) = face_at(w, e);
        let fwd = fwd.reject_from(Vec3::Y).normalize();
        let left = Vec3::Y.cross(fwd).normalize();
        let across = (left + Vec3::Y * tilt.to_radians().tan()).normalize();
        let cut = crate::weapons::arm("sword").cut;
        let m = crate::wounds::Missile { energy: 90.0, mass: 0.3, calibre: 0.004, channel: cut * 0.5, soft: 0.8, hard: 60.0, reach: Some(cut), blade: true, slash: true, ..default() };
        let points = npc::with(w, e, |n| {
            let mut points = Vec::new();
            for k in 0..9 {
                let from = eyes + Vec3::Y * height + across * (k as f32 * 0.0125 - 0.05) + fwd * 0.2;
                if let Some(c) = crate::wounds::pierce(n, from, -fwd, &m, 0.2 + cut).enter {
                    points.push(c.point);
                }
            }
            points
        }).unwrap_or_default();
        crate::dismember::swung(w, e);
        let skin: Vec<crate::npc::Crossing> = points.iter()
            .filter_map(|&p| npc::with(w, e, |n| n.surface(p + fwd * 0.1, -fwd, 0.2, false).into_iter().find(|h| h.kind == Kind::Skin)).flatten())
            .collect();
        crate::viscera::slashed(w, e, &skin, cut);
        npc::with(w, e, |n| n.slash_through(&points, cut, across));
    })
}

// What medicine handed over in the steps before, taken at once (a step runs at the end of a frame, after the systems
// that take it, and what happened is forgotten when the next begins): a charge's limb torn off or wall blown open.
fn taken() -> Step {
    act(|w| {
        let _ = w.run_system_once(crate::dismember::taken_system);
    })
}

pub fn steps(part: &str) -> Vec<Step> {
    let all = part.is_empty();
    let mut s = vec![act(|w| {
        w.spawn((Lamp, PointLight { intensity: LAMP, range: 2.0, radius: 0.03, shadow_maps_enabled: false, ..default() }, Transform::from_xyz(0.0, -50.0, 0.0)));
    })];
    s.push(Step::Wait(90));
    // Where the neck and jaw bones and the mouth are on each body at rest (what throat.rs's `in_neck` and the lining are
    // fitted to).
    s.push(act(|w| {
        for body in crate::sandbox::BODIES {
            let e = who(w, body);
            let v = npc::with(w, e, |n| {
                let b = n.body();
                let bones: serde_json::Map<String, serde_json::Value> = ["neck01", "neck02", "neck03", "head", "jaw"]
                    .iter().map(|&k| (k.to_string(), json!([b.bone(k).head.to_array(), b.bone(k).tail.to_array()]))).collect();
                json!({ "bones": bones, "mouth": n.hurt.throat.centre.map(|c| c.0.to_array()), "incisors": n.hurt.throat.incisors })
            });
            log(w, json!({ "event": "rest", "body": body, "at": v }));
        }
    }));

    if all || part == "mouth" {
        // 1. The groundskeeper upright, his jaw hanging open (as a broken one hangs): the empty mouth, then 20 ml in it,
        //    then more than it holds.
        let g = "sexton";
        s.push(with(g, |n| n.hurt.bones.jaw_hangs = 22.0));
        s.push(Step::Wait(20));
        s.extend(mouth("mouth_empty", g, 0.2, 0.3, 0.0));
        s.push(with(g, |n| n.hurt.bones.jaw_hangs = 32.0));
        s.push(Step::Wait(20));
        s.extend(mouth("mouth_wide", g, 0.18, 0.25, 0.0));
        s.extend(mouth("mouth_wide_side", g, 0.2, 0.2, 35.0));
        s.push(with(g, |n| n.hurt.bones.jaw_hangs = 22.0));
        s.push(Step::Wait(20));
        s.push(with(g, |n| n.hurt.throat.mouth = 20.0));
        s.push(Step::Wait(2));
        s.extend(mouth("mouth_20ml", g, 0.2, 0.3, 0.0));
        s.push(with(g, |n| n.hurt.throat.mouth = 75.0));
        s.push(Step::Wait(2));
        s.extend(mouth("mouth_full", g, 0.2, 0.3, 0.0));
        s.push(Step::Wait(30));
        s.extend(mouth("mouth_spilling", g, 0.35, 0.1, 25.0));
        // 2. A pistol bullet in through the young man's mouth from the front (the tongue torn, the palate), a second on;
        //    then knocked out, on his back, the blood pooling in his throat, and twenty seconds on.
        let b = "buyer";
        s.push(with(b, |n| {
            let Some((rest, owner)) = n.hurt.throat.centre else { return };
            let at = n.rest_to_world(owner).transform_point3(rest);
            let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
            let d = (rot * Vec3::new(0.15, 0.1, 1.0)).normalize();
            let m = crate::weapons::arm("pistol").gun.as_ref().unwrap().m.wounds();
            crate::wounds::pierce(n, at - d, d, &m, 2.0);
        }));
        s.push(bleeds("pistol in the mouth", b));
        s.push(Step::Wait(60));
        s.extend(mouth("mouth_shot", b, 0.22, 0.3, 0.0));
        s.push(act(move |w| {
            let e = who(w, b);
            w.get_mut::<Vitals>(e).unwrap().out = 1e9;
        }));
        s.extend(dark(240));
        s.push(with(b, |n| {
            n.hurt.bones.jaw_hangs = 14.0;
            n.hurt.throat.mouth = n.hurt.throat.mouth.max(35.0);
        }));
        s.push(Step::Wait(2));
        s.extend(mouth("mouth_supine", b, 0.22, 0.0, 0.0));
        s.extend(dark(600));
        s.extend(mouth("mouth_supine_later", b, 0.22, 0.0, 0.0));
        // 3. The old man with blood in his airways, coughing it up: caught as the cough throws it.
        let o = "oldman";
        s.push(with(o, |n| {
            n.hurt.throat.lungs = (30.0, 30.0);
            n.hurt.throat.cough_in = 0.02;
        }));
        s.push(Step::Until(Box::new(move |w: &mut World| {
            let e = who(w, o);
            w.get::<crate::npc::Hurt>(e).is_some_and(|h| h.throat.cough_in > 0.5)
        }), 60));
        s.push(Step::Wait(3));
        s.extend(mouth("cough", o, 0.7, 0.1, 70.0));
        // 4. The man in the hood with a stomach full of blood: the retches, then the vomit, from the side.
        let h = "hood";
        s.push(with(h, |n| {
            n.hurt.throat.stomach = 600.0;
            n.hurt.throat.nausea = 0.999;
        }));
        s.push(Step::Until(Box::new(move |w: &mut World| {
            let e = who(w, h);
            w.get::<crate::npc::Hurt>(e).is_some_and(|h| h.throat.vomiting > 0.0)
        }), 400));
        s.push(Step::Wait(8));
        s.extend(mouth("vomit", h, 0.8, 0.0, 80.0));
        s.push(Step::Wait(12));
        s.extend(mouth("vomit_later", h, 0.8, 0.0, 80.0));
        // 5. Neck wounds (fresh people): a pistol bullet across the side of the neck, one through the windpipe, a knife
        //    across the throat, a bat into it: what bleeds and where it goes.
        s.extend(fresh());
        s.push(neck("oldman", Vec3::X, |n, at, d| {
            let m = crate::weapons::arm("pistol").gun.as_ref().unwrap().m.wounds();
            crate::wounds::pierce(n, at - d * 0.5, d, &m, 1.0);
        }));
        s.push(bleeds("pistol through the side of the neck", "oldman"));
        s.push(neck("sexton", Vec3::NEG_Z, |n, at, d| {
            let m = crate::weapons::arm("pistol").gun.as_ref().unwrap().m.wounds();
            crate::wounds::pierce(n, at - d * 0.5, d, &m, 1.0);
        }));
        s.push(bleeds("pistol through the windpipe", "sexton"));
        s.push(neck("buyer", Vec3::NEG_Z, |n, at, d| {
            // (A knife's edge drawn across the front of the throat, two centimetres in, right to left.)
            let across = d.cross(Vec3::Y).normalize();
            let m = crate::wounds::Missile { energy: 35.0, mass: 0.3, calibre: 0.004, channel: 0.01, soft: 0.8, hard: 60.0, reach: Some(0.02), blade: true, slash: true, ..default() };
            let mut points = Vec::new();
            for k in 0..8 {
                let p = at + across * (k as f32 * 0.012 - 0.042) - d * 0.15;
                if let Some(c) = crate::wounds::pierce(n, p, d, &m, 0.2).enter {
                    points.push(c.point);
                }
            }
            n.slash_through(&points, 0.02, across);
        }));
        s.push(bleeds("knife across the throat", "buyer"));
        s.push(neck("hood", Vec3::NEG_Z, |n, at, d| { crate::wounds::blow(n, at, d, 0.79, 15.0, None); }));
        s.push(bleeds("bat into the throat", "hood"));
        s.push(Step::Wait(90));
        s.extend(face("neck_knife", "buyer", 0.0, 0.45));
    }

    if all || part == "face" {
        // A sword's cut across each face: through the eyes, through the mouth, along the jaw, and slanting up across the
        // cheek and nose; then a heavy chop into the groundskeeper's neck as steep as a blade can take a head off
        // (dismember.rs: its cut tilts with the blade's way, up to 53 degrees off square), from under his right ear.
        if all {
            s.extend(fresh());
        }
        for (body, height, tilt, name, name_side) in [
            ("oldman", 0.0, 0.0, "sword_eyes", "sword_eyes_side"),
            ("sexton", -0.065, 0.0, "sword_mouth", "sword_mouth_side"),
            ("buyer", -0.1, 0.0, "sword_chin", "sword_chin_side"),
            ("hood", -0.04, 30.0, "sword_slant", "sword_slant_side"),
        ] {
            s.push(sword(body, height, tilt));
            s.push(taken());
            s.push(bleeds(name, body));
            s.push(Step::Wait(30));
            s.extend(face(name, body, 0.0, 0.45));
            s.extend(face(name_side, body, 50.0, 0.45));
        }
        s.push(act(|w| {
            let e = who(w, "sexton");
            let (at, dir) = npc::with(w, e, |n| {
                let (j, h) = (n.bone_index("jaw"), n.bone_index("head"));
                let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
                (n.rest_to_world(h).transform_point3(n.body().bones[j].head - Vec3::Y * 0.03 + Vec3::X * 0.05), (rot * Vec3::new(-1.0, 1.2, 0.0)).normalize())
            }).unwrap();
            let off = crate::dismember::chop(w, e, at, dir, 2500.0);
            log(w, json!({ "event": "chop", "off": off }));
        }));
        s.push(Step::Wait(40));
        s.extend(face("sword_neck_head", "sexton", 30.0, 0.5));
        // The groundskeeper's head off: the stump and the piece, each cut face close.
        for (name, piece) in [("sword_mouth_stump", false), ("sword_mouth_piece", true)] {
            s.push(act(move |w| {
                hide_hud(w);
                let e = who(w, "sexton");
                let Some((at, n)) = crate::dismember::end_world(w, e, 0, piece) else { return };
                look(w, at, at + (n + Vec3::Y * 0.4).normalize() * 0.3);
            }));
            s.push(Step::Wait(3));
            s.push(Step::Shot(name.into()));
        }
        s.extend(dark(120));
        for (body, name) in [("oldman", "sword_eyes_later"), ("sexton", "sword_mouth_later"), ("buyer", "sword_chin_later"), ("hood", "sword_slant_later")] {
            s.extend(face(name, body, 20.0, 0.5));
        }
    }

    if all || part == "skull" {
        if all {
            s.extend(fresh());
        }
        // A rifle bullet through the old man's head from the front (the exit behind), a shotgun's charge at contact
        // range into the groundskeeper's temple (as weapons.rs fires it within a metre: one heavy missile), a bat on the
        // young man's crown, a sword's cut across the hooded man's forehead; each opening close up.
        s.push(shoot("oldman", "head", Vec3::new(0.0, 0.07, 0.0), Vec3::new(0.0, 0.0, 1.0), "rifle"));
        s.push(bleeds("rifle through the head", "oldman"));
        s.push(with("sexton", |n| {
            let b = n.bone_index("head");
            let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
            let at = n.world_of(n.body().bones[b].head, b, None).0 + rot * Vec3::new(0.0, 0.08, 0.0);
            let d = rot * Vec3::NEG_X;
            let g = crate::weapons::arm("shotgun").gun.as_ref().unwrap();
            let charge = crate::wounds::Missile { energy: g.m.energy * 9.0 * 0.95, mass: g.m.mass * 9.0, calibre: 0.022, channel: 0.024, soft: 42.0, hard: 120.0,
                                                  name: Some("charge".into()), ..g.m.wounds() };
            crate::wounds::pierce(n, at - d * 0.3, d, &charge, 0.8);
        }));
        s.push(bleeds("shotgun at the temple", "sexton"));
        s.push(with("buyer", |n| {
            let b = n.bone_index("head");
            let at = n.world_of(n.body().bones[b].head, b, None).0 + Vec3::Y * 0.2;
            if let Some(skin) = n.surface(at, Vec3::NEG_Y, 0.3, false).into_iter().find(|h| h.kind == Kind::Skin) {
                for _ in 0..3 {
                    crate::wounds::blow(n, skin.point, Vec3::NEG_Y, 0.79, 30.0, Some(crate::wounds::Tool::Named("bat")));
                }
            }
        }));
        s.push(bleeds("bat on the crown", "buyer"));
        s.push(sword("hood", 0.07, 0.0));
        s.push(bleeds("sword across the forehead", "hood"));
        s.push(taken());
        s.push(Step::Wait(30));
        for (name, body) in [("skull_rifle", "oldman"), ("skull_shotgun", "sexton"), ("skull_sword", "hood")] {
            s.extend(opening(name, body, 0.25));
            s.extend(opening(Box::leak(format!("{name}_close").into_boxed_str()), body, 0.14));
        }
        for (name, body, turn) in [("skull_rifle_front", "oldman", 0.0), ("skull_bat", "buyer", 0.0)] {
            s.extend(face(name, body, turn, 0.4));
        }
        s.push(act(|w| w.resource_mut::<crate::anatomy::Seeing>().0 = true));
        s.extend(face("skull_xray", "sexton", 60.0, 0.5));
        s.push(act(|w| w.resource_mut::<crate::anatomy::Seeing>().0 = false));
    }

    if all || part == "eyes" {
        if all {
            s.extend(fresh());
        }
        // A punch onto the old man's left eye (not hard enough to knock him out), a knife's edge drawn across the
        // groundskeeper's right eye, a pistol bullet across the young man's face under his eyes (through both cheekbones,
        // past the eyes, not through them), a bat's end into the hooded man's left eye; then the old man dead, and ten
        // minutes on.
        s.push(with("oldman", |n| {
            let b = n.bone_index("eye.L");
            let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
            let ahead = rot * Vec3::NEG_Z;
            let at = n.world_of(n.body().bones[b].head, b, None).0;
            if let Some(skin) = n.surface(at + ahead * 0.3, -ahead, 0.6, false).into_iter().find(|h| h.kind == Kind::Skin || h.kind == Kind::Eye) {
                crate::wounds::blow(n, skin.point, -ahead, 0.6, 5.5, Some(crate::wounds::Tool::Stiff(crate::fist::FIST_GIVES)));
            }
        }));
        s.push(with("sexton", |n| {
            let b = n.bone_index("eye.R");
            let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
            let at = n.world_of(n.body().bones[b].head, b, None).0;
            let across = rot * Vec3::X;
            let m = crate::wounds::Missile { energy: 35.0, mass: 0.3, calibre: 0.004, channel: 0.01, soft: 0.8, hard: 60.0, reach: Some(0.012), blade: true, slash: true, ..default() };
            let mut points = Vec::new();
            for k in 0..6 {
                let p = at + across * (k as f32 * 0.008 - 0.02) + rot * Vec3::NEG_Z * 0.1;
                if let Some(c) = crate::wounds::pierce(n, p, rot * Vec3::Z, &m, 0.13).enter {
                    points.push(c.point);
                }
            }
            n.slash_through(&points, 0.012, across);
        }));
        s.push(shoot("buyer", "eye.L", Vec3::new(-0.06, -0.022, 0.0), Vec3::new(1.0, 0.0, 0.0), "pistol"));
        s.push(with("hood", |n| {
            let b = n.bone_index("eye.L");
            let rot = n.segment("head").map_or(Quat::IDENTITY, |k| n.segment_world(k).rotation);
            let ahead = rot * Vec3::NEG_Z;
            let at = n.world_of(n.body().bones[b].head, b, None).0;
            if let Some(skin) = n.surface(at + ahead * 0.3, -ahead, 0.6, false).into_iter().find(|h| h.kind == Kind::Skin || h.kind == Kind::Eye) {
                crate::wounds::blow(n, skin.point, -ahead, 0.79, 10.0, Some(crate::wounds::Tool::Named("bat")));
            }
        }));
        for (who_, n) in [("oldman", "punch"), ("sexton", "knife"), ("buyer", "under the eyes"), ("hood", "bat")] {
            s.push(bleeds(n, who_));
        }
        // (The lids held open for the pictures, as whoever looks at a hurt eye holds them: a hurt eye clamps shut.)
        let open = || act(|w| {
            for body in crate::sandbox::BODIES {
                let e = who(w, body);
                if let Some(mut h) = w.get_mut::<crate::npc::Hurt>(e) {
                    h.eyes.l.clamp = 0.0;
                    h.eyes.r.clamp = 0.0;
                }
            }
        });
        let eyes = |w: &mut World, name: &str, body: &str| {
            let e = who(w, body);
            let h = w.get::<crate::npc::Hurt>(e).unwrap();
            let one = |x: &crate::eyes::Eye| json!({ "red": x.red, "dry": x.dry, "blood": x.blood, "lost": x.lost, "patches": x.patches.len(), "marks": x.marks.len() });
            let v = json!({ "picture": name, "left": one(&h.eyes.l), "right": one(&h.eyes.r) });
            log(w, v);
        };
        s.push(Step::Wait(120));
        for (name, body) in [("eye_punch", "oldman"), ("eye_knife", "sexton"), ("eye_under", "buyer"), ("eye_bat", "hood")] {
            s.push(open());
            s.push(Step::Wait(2));
            s.push(act(move |w| eyes(w, name, body)));
            s.extend(face(name, body, 0.0, 0.1));
        }
        s.extend(dark(60 * 60));
        for (name, body) in [("eye_punch_later", "oldman"), ("eye_knife_later", "sexton"), ("eye_under_later", "buyer"), ("eye_bat_later", "hood")] {
            s.push(open());
            s.push(Step::Wait(2));
            s.push(act(move |w| eyes(w, name, body)));
            s.extend(face(name, body, 0.0, 0.1));
        }
        s.push(act(|w| {
            let e = who(w, "oldman");
            let mut v = w.get_mut::<Vitals>(e).unwrap();
            v.dead = true;
            v.brain_damage = 1.0;
        }));
        s.extend(dark(60 * 30));
        s.push(act(move |w| eyes(w, "eye_dead", "oldman")));
        s.extend(face("eye_dead", "oldman", 0.0, 0.1));
        // (Ten minutes of his insides' clock, nothing drawn: the eyes dry on it.)
        s.push(with("oldman", |n| {
            for _ in 0..60 * 600 {
                n.update(1.0 / 60.0);
            }
        }));
        s.push(Step::Wait(2));
        s.push(act(move |w| eyes(w, "eye_dead_later", "oldman")));
        s.extend(face("eye_dead_later", "oldman", 0.0, 0.1));
    }
    s
}
