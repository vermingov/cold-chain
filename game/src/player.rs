// The player (src/player.ts): feet, eyes, and the small dishonesties of a camera on a neck.
//
// Walking is slow on purpose: somebody careful, not a sprinter. They can run, for a while; they can get down on their
// heels to look at something low.
//
// The player knows nothing about the hall beyond what map.rs answers: the ground's height, what is solid, how far it
// may go. It says when a foot comes down (steps' sounds are phase 2's).
//
// Among people and things that move they are a body of their own (`PlayerBody`): 80 kg in the physics, a capsule from the
// knees to the crown round the eye's line, as wide as the shoulders. The feet drive it at the pace the keys ask for
// with no more force than they can put into the floor, so walking into somebody standing pushes them as hard as a man
// leaning into them can, and they push back: the walk slows against them, and someone falling against the player
// moves them. What is lower than the knees (a body lying on the floor) is stepped over. The hall itself is still map.rs's
// (`push`, `ground`): the body does not touch it.
//
// Here in Bevy's space: `yaw` turns about +Y from looking along -Z (north), `pitch` is up positive. (The TS's yaw was
// the other way round and its pitch down positive; both are turned round at spawn, nowhere else.)

use bevy::input::mouse::AccumulatedMouseMotion;
use bevy::prelude::*;
use bevy::window::{CursorGrabMode, CursorOptions, PrimaryWindow};
use bevy_rapier3d::prelude::*;

use crate::map::{Map, HALL};
use crate::ragdoll::{LIMBS, PIECE, ROOTS, TRUNK};

const LOOK_RATE: f32 = 0.0021; // radians per pixel of mouse travel at a look speed of 1

struct Body {
    radius: f32,
    eye: f32,
    crouched: f32,
    walk: f32,
    run: f32,
    creep: f32,
    accel: f32,
    friction: f32,
    stride: f32,
    drain: f32,
    recover: f32,
    winded: f32,
    climb: f32,
    jump: f32,
    air: f32,
    mass: f32,
    grip: f32,
    knees: f32,
    shoulders: f32,
    crown: f32,
}

const BODY: Body = Body {
    radius: 0.3,
    eye: 1.65, crouched: 0.92,      // metres from the ground to the eye
    walk: 1.55, run: 3.4, creep: 0.85,
    accel: 9.0, friction: 11.0,
    stride: 0.74,                   // metres between footfalls
    drain: 0.065, recover: 0.11,    // of a full breath, a second: about fifteen seconds of running from full
    winded: 0.3,                    // once out of breath, how much has to come back before running again
    climb: 0.45,                    // metres: the highest step taken in a stride
    // A standing jump lifts the body some 40 to 50 cm (an untrained adult's countermovement jump: Markovic 2004 gives
    // 0.4 to 0.5 m for active young men), and once off the floor there is nothing to push on: what the arms and hips
    // can do about the way it is going is a small part of what the feet could (an estimate).
    jump: 0.45,
    air: 0.08,
    mass: 80.0,
    grip: 0.9,                      // of the weight: the most the feet push along the floor with (rubber on concrete)
    knees: 0.4,                     // metres: the body's bottom; under it is stepped over
    shoulders: 0.25,                // metres: its half width
    crown: 0.13,                    // metres from the eye up to the top of the head
};

// The player's body's collision group: it meets people (and what is cut off them) and what is thrown or dropped, not the
// hall (map.rs's) and not the held thing's tests (weapons.rs).
pub const BODY_GROUP: Group = Group::GROUP_6;
const MEETS: Group = TRUNK.union(ROOTS).union(LIMBS).union(PIECE);

// The player's body in the physics (see the top).
#[derive(Component)]
pub struct PlayerBody;

// The player, on the camera that is their eyes.
#[derive(Component)]
pub struct Player {
    pub pos: Vec2, // x, z
    pub vel: Vec2,
    pub yaw: f32,
    pub pitch: f32,
    pub look_speed: f32,
    pub stand: f32,  // how tall this player's eye is, standing
    pub crouch: f32, // 0 standing to 1 on their heels
    pub breath_left: f32,
    pub running: bool,
    pub height: f32, // of the ground under the feet, eased
    pub falling: f32, // m/s, off an edge
    pub travelled: f32, // since the last footfall
    pub steps: u32,
    pub bob_phase: f32,
    pub breathing: f32,
    pub winded: bool,
    pub held: bool,   // kept where they are, at work: they can look about but not walk
    pub slowed: f32,  // of the usual pace, for somebody pushing something heavy
    pub body: Option<Entity>, // in the physics (PlayerBody)
    placed: Vec2,     // where `walk` left them: anywhere else, they were put there (spawn) and the body goes after them
    jumped: bool,     // Space held: one jump a press
    dip: f32,         // m the eye has sunk with the knees, landing
}

impl Player {
    // Stand at (x, z) (Bevy's), looking at `toward` if given, with a standing eye height `eye`.
    pub fn spawn(&mut self, map: &Map, x: f32, z: f32, toward: Option<Vec3>, eye: f32) {
        self.pos = Vec2::new(x, z);
        self.vel = Vec2::ZERO;
        self.stand = eye;
        self.crouch = 0.0;
        self.height = map.ground(x, z, f32::INFINITY);
        self.falling = 0.0;
        self.dip = 0.0;
        if let Some(t) = toward {
            let d = t - Vec3::new(x, self.height + eye, z);
            self.yaw = (-d.x).atan2(-d.z);
            self.pitch = d.y.atan2(d.x.hypot(d.z));
        }
    }

    pub fn speed(&self) -> f32 {
        self.vel.length()
    }

    // Ahead and to the right, on the floor.
    fn ahead(&self) -> Vec2 {
        Vec2::new(-self.yaw.sin(), -self.yaw.cos())
    }

    fn right(&self) -> Vec2 {
        Vec2::new(self.yaw.cos(), -self.yaw.sin())
    }

    // A frame of walking, the body already where the physics has put it (`walk` sets `pos` and `vel` from it): the pace
    // the keys ask for (`vel`, which the body is driven toward), kept off the hall's walls, and the feet's height.
    pub fn update(&mut self, map: &Map, keys: &ButtonInput<KeyCode>, dt: f32) {
        let k = |c: KeyCode| !self.held && keys.pressed(c);
        let ahead = (k(KeyCode::KeyW) || k(KeyCode::ArrowUp)) as i32 as f32 - (k(KeyCode::KeyS) || k(KeyCode::ArrowDown)) as i32 as f32;
        let across = (k(KeyCode::KeyD) || k(KeyCode::ArrowRight)) as i32 as f32 - (k(KeyCode::KeyA) || k(KeyCode::ArrowLeft)) as i32 as f32;
        let moving = ahead != 0.0 || across != 0.0;

        let down = k(KeyCode::ControlLeft) || k(KeyCode::KeyC);
        self.crouch += (down as i32 as f32 - self.crouch) * (dt * 7.0).min(1.0);
        // Nobody runs on their heels, or with no breath left; and somebody who ran out has to get some back first.
        if self.breath_left <= 0.0 {
            self.winded = true;
        } else if self.breath_left >= BODY.winded {
            self.winded = false;
        }
        self.running = moving && self.crouch < 0.3 && (k(KeyCode::ShiftLeft) || k(KeyCode::ShiftRight)) && !self.winded;
        self.breath_left = (self.breath_left + if self.running { -BODY.drain } else { BODY.recover } * dt).clamp(0.0, 1.0);

        let upright = if self.running { BODY.run } else { BODY.walk };
        let pace = (upright + (BODY.creep - upright) * self.crouch) * self.slowed;
        let wish = (self.ahead() * ahead + self.right() * across).normalize_or_zero() * pace;
        // Off the floor, only the little the arms and hips can do, and nothing slows them.
        let grip = (dt * if self.airborne() { BODY.accel * BODY.air } else if moving { BODY.accel } else { BODY.friction }).min(1.0);
        if !self.airborne() || moving {
            self.vel += (wish - self.vel) * grip;
        }
        // Space: off the floor, if both feet are on it.
        let space = k(KeyCode::Space);
        if space && !self.jumped && !self.airborne() {
            self.falling = -(2.0 * 9.81 * BODY.jump).sqrt();
        }
        self.jumped = space;

        let before = self.placed;
        let mut at = self.pos.to_array();
        if let Some(pushed) = map.push(&mut at, BODY.radius, self.height) {
            // Lose the speed that was into the thing and keep what was along it.
            let pushed = Vec2::from(pushed);
            let into = self.vel.dot(pushed);
            if into < 0.0 {
                self.vel -= pushed * into;
            }
        }
        let lim = Vec2::new(HALL.x - 0.4, HALL.z - 0.4);
        self.pos = Vec2::from(at).clamp(-lim, lim);

        let went = if self.airborne() { 0.0 } else { self.pos.distance(before) };
        self.travelled += went;
        self.bob_phase += went * (std::f32::consts::PI / BODY.stride);
        let stride = BODY.stride * if self.running { 1.25 } else { 1.0 } * (1.0 - self.crouch * 0.4);
        if self.travelled > stride {
            self.travelled -= stride;
            self.steps += 1;
        }
        self.fall(map, dt);
    }

    // Off the floor: jumping, or falling off an edge.
    pub fn airborne(&self) -> bool {
        self.falling != 0.0
    }

    // The ground under the feet, eased: a head does not follow every dip, or a stair. Off anything higher than a
    // stair, they fall, and land.
    fn fall(&mut self, map: &Map, dt: f32) {
        let ground = map.ground(self.pos.x, self.pos.y, self.height + BODY.climb);
        if self.falling != 0.0 || self.height - ground > BODY.climb {
            // (By the speed halfway through the frame: a jump rises its full height at any frame rate.)
            let was = self.falling;
            self.falling += 9.81 * dt;
            self.height = ground.max(self.height - (was + self.falling) / 2.0 * dt);
            if self.height == ground && self.falling > 0.0 {
                // Landed: the knees take it (the eye sinks with them, more the harder it came down), and both feet are
                // heard on the floor.
                self.dip = (self.dip + self.falling * 0.025).min(0.12);
                self.falling = 0.0;
                self.steps += 1;
            }
        } else {
            self.height += (ground - self.height) * if dt > 0.0 { (dt * 12.0).min(1.0) } else { 1.0 };
        }
        self.dip *= (-dt * 9.0).exp();
        self.breathing += dt * if self.running { 2.6 } else { 1.1 + (1.0 - self.breath_left) * 2.0 };
    }

    // The body's capsule as the player stands now: its middle's height above the feet, and its half length between the
    // ends' centres.
    fn capsule(&self) -> (f32, f32) {
        let top = self.stand + (BODY.crouched - self.stand) * self.crouch + BODY.crown;
        let bottom = BODY.knees.min(top - 2.0 * BODY.shoulders).max(0.0);
        ((top + bottom) / 2.0, ((top - bottom) / 2.0 - BODY.shoulders).max(0.0))
    }

    // Where the eye is and which way it looks.
    pub fn eye(&self) -> Transform {
        let going = (self.speed() / BODY.walk).min(1.0);
        let bob = self.bob_phase.sin().abs() * 0.034 * if self.running { 1.6 } else { 1.0 } * going;
        let sway = self.bob_phase.sin() * 0.014 * going;
        let breath = self.breathing.sin() * (0.006 + (1.0 - self.breath_left) * 0.012);
        let eye = self.stand + (BODY.crouched - self.stand) * self.crouch;
        let side = self.right() * sway;
        let roll = self.bob_phase.sin() * 0.006 * going;
        Transform::from_xyz(self.pos.x + side.x, self.height + eye - bob + breath - self.dip, self.pos.y + side.y)
            .with_rotation(Quat::from_euler(EulerRot::YXZ, self.yaw, self.pitch, -roll))
    }
}

// The view is fixed across rather than top to bottom, so a wider screen sees more above and below, not a wider and
// wider fisheye: 1.5 radians across (the menu's settings change it), Bevy's (top to bottom) worked out from the window's
// shape.
pub const FOV_ACROSS: f32 = 1.5;

fn spawn(mut commands: Commands, map: Res<Map>) {
    let mut player = Player {
        pos: Vec2::ZERO, vel: Vec2::ZERO, yaw: 0.0, pitch: 0.0, look_speed: 1.0, stand: BODY.eye, crouch: 0.0, breath_left: 1.0,
        running: false, height: 0.0, falling: 0.0, travelled: 0.0, steps: 0, bob_phase: 0.0, breathing: 0.0, winded: false, held: false, slowed: 1.0,
        body: None, placed: Vec2::ZERO, jumped: false, dip: 0.0,
    };
    // Where the TS put them: four metres south of the middle, looking at the line-up.
    player.spawn(&map, 0.0, 4.0, Some(crate::babylon(0.0, 1.4, 2.0)), BODY.eye);
    player.placed = player.pos;
    let (middle, half) = player.capsule();
    player.body = Some(
        commands
            .spawn((
                PlayerBody,
                RigidBody::Dynamic,
                Transform::from_xyz(player.pos.x, player.height + middle, player.pos.y),
                Collider::capsule_y(half, BODY.shoulders),
                ColliderMassProperties::Mass(BODY.mass),
                LockedAxes::ROTATION_LOCKED,
                GravityScale(0.0),
                Damping { linear_damping: 0.0, angular_damping: 0.0 },
                Friction::coefficient(0.3),
                Restitution::coefficient(0.0),
                CollisionGroups::new(BODY_GROUP, MEETS),
                Velocity::default(),
                Name::new("the player's body"),
            ))
            .id(),
    );
    let eye = player.eye();
    commands.spawn((
        Camera3d::default(),
        Projection::Perspective(PerspectiveProjection { near: 0.02, far: 400.0, ..default() }),
        eye,
        player,
        Name::new("eye"),
    ));
}

// A click takes the pointer, as the browser's pointer lock did; Escape gives it back with the menu (menu.rs), and a
// click on the room takes it again.
fn grab(mouse: Res<ButtonInput<MouseButton>>, menu: Res<crate::menu::Menu>, mut cursor: Query<&mut CursorOptions, With<PrimaryWindow>>) {
    let Ok(mut c) = cursor.single_mut() else { return };
    if mouse.just_pressed(MouseButton::Left) && !menu.open {
        c.grab_mode = CursorGrabMode::Locked;
        c.visible = false;
    }
}

fn look(motion: Res<AccumulatedMouseMotion>, cursor: Query<&CursorOptions, With<PrimaryWindow>>, mut players: Query<&mut Player>) {
    if cursor.single().map_or(true, |c| c.grab_mode == CursorGrabMode::None) {
        return;
    }
    for mut p in &mut players {
        let d = motion.delta * LOOK_RATE * p.look_speed;
        p.yaw -= d.x;
        let limit = std::f32::consts::PI * 0.46;
        p.pitch = (p.pitch - d.y).clamp(-limit, limit);
    }
}

pub fn walk(time: Res<Time>, fixed: Res<Time<Fixed>>, keys: Res<ButtonInput<KeyCode>>, map: Res<Map>, settings: Res<crate::menu::Settings>,
            mut players: Query<(&mut Player, &mut Transform, &mut Projection, &Camera)>,
            mut bodies: Query<(&mut Transform, &mut Velocity, &mut CollisionGroups), (With<PlayerBody>, Without<Player>)>) {
    for (mut p, mut t, mut projection, camera) in &mut players {
        let body = p.body.and_then(|b| bodies.get_mut(b).ok());
        if let Some((mut bt, mut bv, mut groups)) = body {
            if p.pos != p.placed {
                // Put somewhere (spawn): the body goes there, still, and passes through whoever it lands in until it is
                // clear of them (`drive`), rather than throwing them off.
                let (middle, _) = p.capsule();
                bt.translation = Vec3::new(p.pos.x, p.height + middle, p.pos.y);
                bv.linear = Vec3::ZERO;
                groups.filters = Group::NONE;
                p.vel = Vec2::ZERO;
                p.placed = p.pos;
            } else {
                // Where the body is now: as the last physics step left it, carried on by the time since (the frame's
                // clock is ahead of the physics' by less than a step), so the eye moves as smoothly as the frames come.
                let ahead = fixed.overstep().as_secs_f32();
                p.pos = Vec2::new(bt.translation.x + bv.linear.x * ahead, bt.translation.z + bv.linear.z * ahead);
                p.vel = Vec2::new(bv.linear.x, bv.linear.z);
            }
            let was = p.pos;
            p.update(&map, &keys, time.delta_secs());
            // Kept off the hall's walls: the body with them.
            let off = p.pos - was;
            if off != Vec2::ZERO {
                bt.translation += Vec3::new(off.x, 0.0, off.y);
                bv.linear = Vec3::new(p.vel.x, bv.linear.y, p.vel.y);
            }
            p.placed = p.pos;
        } else {
            p.update(&map, &keys, time.delta_secs());
            let step = p.vel * time.delta_secs();
            p.pos += step;
            p.placed = p.pos;
        }
        *t = p.eye();
        if let (Projection::Perspective(pp), Some(size)) = (projection.as_mut(), camera.logical_viewport_size()) {
            pp.fov = 2.0 * ((settings.fov.to_radians() / 2.0).tan() * size.y / size.x).atan();
        }
    }
}

// Every physics step: the body driven toward the pace the player walks at, with no more than the feet can give (in the
// air, the little `air` of it); its height kept at the feet's (the player's own, map.rs's ground and the jump), its
// capsule as tall as they stand. Put somewhere in someone, it passes through people until it is clear of them all.
fn drive(players: Query<&Player>, mut bodies: Query<(&Transform, &mut Velocity, &mut Collider, &mut CollisionGroups), With<PlayerBody>>, rapier: ReadRapierContext,
         time: Res<Time>) {
    let dt = time.delta_secs();
    let Ok(p) = players.single() else { return };
    let Some(Ok((t, mut v, mut collider, mut groups))) = p.body.map(|b| bodies.get_mut(b)) else { return };
    if dt <= 0.0 {
        return;
    }
    let (middle, half) = p.capsule();
    if collider.as_capsule().is_none_or(|c| (c.half_height() - half).abs() > 0.02) {
        *collider = Collider::capsule_y(half, BODY.shoulders);
    }
    let most = 9.81 * BODY.grip * if p.airborne() { BODY.air } else { 1.0 } * dt;
    let change = (Vec3::new(p.vel.x, 0.0, p.vel.y) - Vec3::new(v.linear.x, 0.0, v.linear.z)).clamp_length_max(most);
    v.linear += change;
    v.linear.y = (p.height + middle - t.translation.y) / dt;
    if groups.filters == Group::NONE {
        let Ok(ctx) = rapier.single() else { return };
        let mut clear = true;
        let only = QueryFilter::only_dynamic().groups(CollisionGroups::new(Group::ALL, MEETS));
        ctx.intersect_shape(t.translation, Quat::IDENTITY, &*collider, only, |_, _| {
            clear = false;
            false
        });
        if clear {
            groups.filters = MEETS;
        }
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Startup, spawn)
        .add_systems(Update, (grab, look, walk).chain())
        .add_systems(FixedUpdate, drive.before(PhysicsSet::SyncBackend));
}
