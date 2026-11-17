// The player (src/player.ts): feet, eyes, and the small dishonesties of a camera on a neck.
//
// Walking is slow on purpose: somebody careful, not a sprinter. They can run, for a while; they can get down on their
// heels to look at something low.
//
// The player knows nothing about the hall beyond what map.rs answers: the ground's height, what is solid, how far it
// may go. It says when a foot comes down (steps' sounds are phase 2's).
//
// Here in Bevy's space: `yaw` turns about +Y from looking along -Z (north), `pitch` is up positive. (The TS's yaw was
// the other way round and its pitch down positive; both are turned round at spawn, nowhere else.)

use bevy::input::mouse::AccumulatedMouseMotion;
use bevy::prelude::*;
use bevy::window::{CursorGrabMode, CursorOptions, PrimaryWindow};

use crate::map::{Map, HALL};

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
};

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
        let grip = (dt * if moving { BODY.accel } else { BODY.friction }).min(1.0);
        self.vel += (wish - self.vel) * grip;

        let before = self.pos;
        self.pos += self.vel * dt;
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

        let went = self.pos.distance(before);
        self.travelled += went;
        self.bob_phase += went * (std::f32::consts::PI / BODY.stride);
        let stride = BODY.stride * if self.running { 1.25 } else { 1.0 } * (1.0 - self.crouch * 0.4);
        if self.travelled > stride {
            self.travelled -= stride;
            self.steps += 1;
        }
        self.fall(map, dt);
    }

    // The ground under the feet, eased: a head does not follow every dip, or a stair. Off anything higher than a
    // stair, they fall, and land.
    fn fall(&mut self, map: &Map, dt: f32) {
        let ground = map.ground(self.pos.x, self.pos.y, self.height + BODY.climb);
        if self.falling > 0.0 || self.height - ground > BODY.climb {
            self.falling += 9.81 * dt;
            self.height = ground.max(self.height - self.falling * dt);
            if self.height == ground {
                self.falling = 0.0;
            }
        } else {
            self.height += (ground - self.height) * if dt > 0.0 { (dt * 12.0).min(1.0) } else { 1.0 };
        }
        self.breathing += dt * if self.running { 2.6 } else { 1.1 + (1.0 - self.breath_left) * 2.0 };
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
        Transform::from_xyz(self.pos.x + side.x, self.height + eye - bob + breath, self.pos.y + side.y)
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
    };
    // Where the TS put them: four metres south of the middle, looking at the line-up.
    player.spawn(&map, 0.0, 4.0, Some(crate::babylon(0.0, 1.4, 2.0)), BODY.eye);
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

pub fn walk(time: Res<Time>, keys: Res<ButtonInput<KeyCode>>, map: Res<Map>, settings: Res<crate::menu::Settings>,
            mut players: Query<(&mut Player, &mut Transform, &mut Projection, &Camera)>) {
    for (mut p, mut t, mut projection, camera) in &mut players {
        p.update(&map, &keys, time.delta_secs());
        *t = p.eye();
        if let (Projection::Perspective(pp), Some(size)) = (projection.as_mut(), camera.logical_viewport_size()) {
            pp.fov = 2.0 * ((settings.fov.to_radians() / 2.0).tan() * size.y / size.x).atan();
        }
    }
}

pub fn plugin(app: &mut App) {
    app.add_systems(Startup, spawn).add_systems(Update, (grab, look, walk).chain());
}
