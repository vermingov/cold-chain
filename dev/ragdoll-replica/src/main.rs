// The game's ragdoll rebuilt in plain Rapier (port/b-ragdoll, dev/PORT.md "The active ragdoll"): the groundskeeper as the
// `ragdoll` scenario logs him (each segment's shape, weight and place; each joint's frames and range, as ragdoll.rs `join`
// gives them to Rapier, and its friction and the joints that keep the long bones' halves apart), dead on the hall's
// floor, taken by the right hand and swept about as the `drag` scenario sweeps him. Prints how far each joint went past
// its range (degrees, the joints' own measure, ragdoll.rs `past`), with one thing changed at a time.
//
//     cargo run --release -- <log.json of `cold-chain --scenario ragdoll`> [case]
//
// Seconds a case, not the minutes a scenario takes on the software renderer. What it found: the wrist and elbow of the
// arm pulled drift past their ranges as the game's do (no floor, or no pull, and they do not), and only a faster
// correction (Rapier's max corrective velocity) brings them back.

use rapier3d::prelude::*;
use serde_json::Value;

fn v3(v: &Value) -> Vector {
    Vector::new(v[0].as_f64().unwrap() as f32, v[1].as_f64().unwrap() as f32, v[2].as_f64().unwrap() as f32)
}

fn q4(v: &Value) -> Rotation {
    let f = |i: usize| v[i].as_f64().unwrap() as f32;
    Rotation::from_xyzw(f(0), f(1), f(2), f(3)).normalize()
}

#[derive(Clone, Copy)]
struct Case {
    gyro: bool,
    friction: bool,
    apart: bool,
    own: bool,
    floor: bool,
    pull: f32,
    pgs: usize,
    correct: f32,
}

const GAME: Case = Case { gyro: false, friction: true, apart: true, own: true, floor: true, pull: 900.0, pgs: 1, correct: 3.0 };

// A joint's angles past its range (the joint's own measure: twice the arcsine of the turn's parts in its frames).
fn past(w: &PhysicsWorld, parent: RigidBodyHandle, child: RigidBodyHandle, j: &Value) -> [f32; 3] {
    let l = q4(&j["b1"]).inverse() * w.bodies[parent].rotation().inverse() * *w.bodies[child].rotation() * q4(&j["b2"]);
    let l = if l.w < 0.0 { -l } else { l };
    let a = [2.0 * l.x.asin(), 2.0 * l.y.asin(), 2.0 * l.z.asin()];
    std::array::from_fn(|i| (j["lo"][i].as_f64().unwrap() as f32 - a[i]).max(a[i] - j["hi"][i].as_f64().unwrap() as f32).max(0.0))
}

fn run(label: &str, segs: &[Value], c: Case) {
    let mut w = PhysicsWorld::new();
    w.gravity = Vector::new(0.0, -9.81, 0.0);
    w.integration_parameters.dt = 1.0 / 120.0;
    w.integration_parameters.num_solver_iterations = 16;
    w.integration_parameters.num_internal_pgs_iterations = c.pgs;
    w.integration_parameters.warmstart_joints = true;
    w.integration_parameters.normalized_max_corrective_velocity = c.correct;
    if c.floor {
        let g = w.bodies.insert(RigidBodyBuilder::fixed());
        w.colliders.insert_with_parent(ColliderBuilder::cuboid(50.0, 0.1, 50.0).translation(Vector::new(0.0, -0.1, 0.0)).friction(0.75), g, &mut w.bodies);
    }
    // The segments as ragdoll.rs makes them: the shape's inertia scaled with the weight, hands and feet three times it.
    let mut bodies = Vec::new();
    for s in segs {
        let name = s["name"].as_str().unwrap();
        let b = w.bodies.insert(RigidBodyBuilder::dynamic().gyroscopic_forces_enabled(c.gyro).linear_damping(0.05).angular_damping(0.5)
            .pose(Pose::from_parts(v3(&s["at"]), q4(&s["turn"]))));
        let sh = &s["shape"];
        let col = match sh[0].as_str().unwrap() {
            "capsule" => ColliderBuilder::capsule_from_endpoints(v3(&sh[1]), v3(&sh[2]), sh[3].as_f64().unwrap() as f32),
            "box" => {
                let h = v3(&sh[2]);
                ColliderBuilder::cuboid(h.x, h.y, h.z).position(Pose::from_parts(v3(&sh[1]), q4(&sh[3])))
            }
            _ => ColliderBuilder::ball(sh[2].as_f64().unwrap() as f32).translation(v3(&sh[1])),
        };
        let mass = s["mass"].as_f64().unwrap() as f32;
        let unit = col.shape.mass_properties(1.0);
        let spin = if name.starts_with("hand") || name.starts_with("foot") { 3.0 } else { 1.0 };
        let mp = MassProperties::with_principal_inertia_frame(unit.local_com, mass, unit.principal_inertia() * (spin * mass / unit.mass()),
            unit.principal_inertia_local_frame);
        let groups = if c.own { InteractionGroups::all() } else { InteractionGroups::new(Group::GROUP_2, Group::GROUP_1, InteractionTestMode::And) };
        w.colliders.insert_with_parent(col.mass_properties(mp).friction(0.75).restitution(0.02).collision_groups(groups), b, &mut w.bodies);
        bodies.push(b);
    }
    let mut joints = Vec::new();
    for (k, s) in segs.iter().enumerate() {
        let Some(p) = s["parent"].as_u64().map(|p| p as usize) else { continue };
        let lock = s["lock"].as_bool().unwrap();
        let (f1, f2) = (Pose::from_parts(v3(&s["a1"]), q4(&s["b1"])), Pose::from_parts(v3(&s["a2"]), q4(&s["b2"])));
        let mut j = GenericJointBuilder::new(if lock { JointAxesMask::all() } else { JointAxesMask::LIN_AXES })
            .local_frame1(f1).local_frame2(f2).contacts_enabled(false);
        if !lock {
            for (i, axis) in [JointAxis::AngX, JointAxis::AngY, JointAxis::AngZ].into_iter().enumerate() {
                j = j.limits(axis, [s["lo"][i].as_f64().unwrap() as f32, s["hi"][i].as_f64().unwrap() as f32]);
            }
            joints.push((k, p));
        }
        w.impulse_joints.insert(bodies[p], bodies[k], j.build(), true);
        // A dead body's joint friction (ragdoll.rs DEAD, set_tone).
        if c.friction && !lock {
            let grip = 1.2 * s["mass"].as_f64().unwrap() as f32 / 6.0;
            let mut f = GenericJointBuilder::new(JointAxesMask::empty()).local_frame1(f1).local_frame2(f2).contacts_enabled(false);
            for axis in [JointAxis::AngX, JointAxis::AngY, JointAxis::AngZ] {
                f = f.motor_model(axis, MotorModel::ForceBased).motor_velocity(axis, 0.0, 1000.0).motor_max_force(axis, grip);
            }
            w.impulse_joints.insert(bodies[p], bodies[k], f.build(), true);
        }
    }
    let index = |n: &str| segs.iter().position(|s| s["name"] == n).unwrap();
    if c.apart {
        for side in ["L", "R"] {
            for (a, b) in [("upperarm", "forearm"), ("upperarm", "forearm2"), ("upperarm2", "forearm2"), ("forearm", "hand"), ("thigh", "shin"),
                ("thigh", "shin2"), ("thigh2", "shin2"), ("shin", "foot")] {
                let j = GenericJointBuilder::new(JointAxesMask::empty()).contacts_enabled(false).build();
                w.impulse_joints.insert(bodies[index(&format!("{a}{side}"))], bodies[index(&format!("{b}{side}"))], j, true);
            }
        }
    }
    // Lying a second, then the hand pulled as behaviour.rs `hold` pulls it (320 N/m and 28 N s/m a kilogram of a part
    // held as 2 kg, 900 N at most) toward a point swept about as the drag's eye sweeps it.
    let hand = bodies[index("handR")];
    let anchor = w.bodies.insert(RigidBodyBuilder::fixed());
    let (mut hold, mut start) = (None, Vector::ZERO);
    let mut worst = vec![0.0f32; joints.len()];
    for step in 0..120 * 9 {
        let t = step as f32 / 120.0;
        if c.pull > 0.0 && step == 120 {
            start = w.bodies[hand].translation();
            let mut j = GenericJointBuilder::new(JointAxesMask::empty()).local_anchor1(start).local_anchor2(Vector::ZERO);
            for axis in [JointAxis::LinX, JointAxis::LinY, JointAxis::LinZ] {
                j = j.motor_model(axis, MotorModel::ForceBased).motor_position(axis, 0.0, 640.0, 56.0).motor_max_force(axis, c.pull / 3f32.sqrt());
            }
            hold = Some(w.impulse_joints.insert(anchor, hand, j.build(), true));
        }
        if let Some(h) = hold {
            let s = t - 1.0;
            let yaw = 0.6 * (s * std::f32::consts::TAU * 0.4).sin();
            let to = start + Vector::new(1.4 * yaw.sin(), 0.3 + 0.15 * (s * std::f32::consts::TAU * 0.27).sin(), 1.4 - 1.4 * yaw.cos());
            w.impulse_joints.get_mut(h, true).unwrap().data.set_local_anchor1(to);
        }
        w.step();
        if t > 2.0 {
            for (n, &(k, p)) in joints.iter().enumerate() {
                worst[n] = worst[n].max(past(&w, bodies[p], bodies[k], &segs[k]).into_iter().fold(0.0, f32::max));
            }
        }
    }
    let mut top: Vec<(String, f32)> = joints.iter().zip(&worst).map(|(j, x)| (segs[j.0]["name"].as_str().unwrap().to_string(), x.to_degrees())).collect();
    top.sort_by(|a, b| b.1.total_cmp(&a.1));
    let top: Vec<String> = top.iter().take(4).map(|(n, x)| format!("{n} {x:.1}")).collect();
    println!("{label:<24} past range (deg): {}", top.join(", "));
}

fn main() {
    let path = std::env::args().nth(1).expect("the log.json of `cold-chain --scenario ragdoll`");
    let log: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let segs = log["log"].as_array().unwrap().iter().find(|x| x["what"]["event"] == "ragdoll").expect("no ragdoll in the log")["what"]["segments"]
        .as_array().unwrap().clone();
    let only = std::env::args().nth(2).unwrap_or_default();
    let cases = [
        ("as the game had it", GAME),
        ("gyroscopic term", Case { gyro: true, ..GAME }),
        ("no pull", Case { pull: 0.0, ..GAME }),
        ("no floor", Case { floor: false, ..GAME }),
        ("no own contacts", Case { own: false, ..GAME }),
        ("no joint friction", Case { friction: false, ..GAME }),
        ("no halves kept apart", Case { apart: false, ..GAME }),
        ("pull 200 N", Case { pull: 200.0, ..GAME }),
        ("4 PGS passes a substep", Case { pgs: 4, ..GAME }),
        ("correction 10", Case { correct: 10.0, ..GAME }),
        ("correction 30", Case { correct: 30.0, ..GAME }),
    ];
    for (label, c) in cases {
        if only.is_empty() || label.contains(&only) {
            run(label, &segs, c);
        }
    }
}
