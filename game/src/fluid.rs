// What blood is, in numbers, for everything that moves it (src/sandbox/fluid.ts): drops in the air (blood.rs), streams
// on skin (runs.rs), blood in cloth (soak.rs), on skin (film.rs) and on the floor (floor.rs).
//
// Whole blood at body heat: 1060 kg/m3, about 3.5 mPa s where it is moving fast (it is thicker when slow: it thins as
// it is sheared), surface tension about 0.056 N/m. Those three set how big a drop is before it falls off a chin (Tate:
// about 0.05 ml), how deep it stands on a floor (twice its capillary length times the sine of half its contact angle:
// 2 to 3 mm), and how fast a film of it runs down a slope.
//
// The colour of blood is in fluid.wesl (`blood_over`), the TS's GLSL_BLOOD, shared by every shader that draws blood.

use bevy::prelude::*;

pub const RHO: f32 = 1060.0; // kg/m3
pub const MU: f32 = 0.0035; // Pa s
pub const GAMMA: f32 = 0.056; // N/m
pub const AIR: f32 = 1.2; // kg/m3, the air drops fly through
pub const MU_AIR: f32 = 1.8e-5; // Pa s
pub const DRIP: f32 = 0.05; // ml: the drop that falls from a chin, a nose, a fingertip

// A drop of `ml` millilitres: how wide it is (m), and the other way.
pub fn across(ml: f32) -> f32 {
    (ml * 1e-6 * 6.0 / std::f32::consts::PI).cbrt()
}

pub fn volume(d: f32) -> f32 {
    std::f32::consts::PI / 6.0 * d * d * d * 1e6
}

// How fast air slows a drop `d` wide going `speed`: a rate (1/s), from its drag (Schiller-Naumann) over its mass. A
// tenth of a millimetre stops in centimetres; a dripped drop falls nearly freely.
pub fn drag(d: f32, speed: f32) -> f32 {
    let re = (AIR * speed * d / MU_AIR).max(1e-3);
    let cd = 24.0 / re * (1.0 + 0.15 * re.powf(0.687));
    3.0 * AIR * cd * speed / (4.0 * RHO * d)
}

// How far a drop spreads where it lands, as times its own width: about half the fourth root of its Reynolds number (a
// 4 mm drip falling a metre leaves a mark about 17 mm across; a 0.3 mm mist drop barely more than itself).
pub fn spreads(d: f32, speed: f32) -> f32 {
    (0.5 * (RHO * speed * d / MU).powf(0.25)).max(1.2)
}

// Whether it throws spines and droplets off its rim as it lands: its Weber number past a few hundred.
pub fn splashes(d: f32, speed: f32) -> bool {
    RHO * speed * speed * d / GAMMA > 400.0
}

// Smooth noise in a plane, 0 to 1, for floors that are not quite flat. (In f64, as the TS's: its hash is a sine of
// numbers in the hundreds of thousands, which f32 cannot carry.)
pub fn noise2(x: f64, y: f64) -> f64 {
    let (ix, iy) = (x.floor(), y.floor());
    let (fx, fy) = (x - ix, y - iy);
    let h = |a: f64, b: f64| {
        let s = (a * 127.1 + b * 311.7).sin() * 43758.5453;
        s - s.floor()
    };
    let (u, v) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    (h(ix, iy) * (1.0 - u) + h(ix + 1.0, iy) * u) * (1.0 - v) + (h(ix, iy + 1.0) * (1.0 - u) + h(ix + 1.0, iy + 1.0) * u) * v
}

// A normally distributed number (Box-Muller), from two uniform ones.
pub fn gauss(a: f32, b: f32) -> f32 {
    (-2.0 * (1.0 - a).max(1e-7).ln()).sqrt() * (std::f32::consts::TAU * b).cos()
}

pub fn plugin(app: &mut App) {
    bevy::shader::load_shader_library!(app, "fluid.wesl");
}

#[cfg(test)]
mod tests {
    use super::*;

    // The TS's numbers: a 4 mm drip falling a metre (4.4 m/s) leaves a mark about 17 mm across; Tate's drop is ~4.6 mm.
    #[test]
    fn drops() {
        let d = 0.004;
        assert!((d * spreads(d, 4.4) - 0.017).abs() < 0.003, "{}", d * spreads(d, 4.4));
        assert!((across(DRIP) - 0.00457).abs() < 1e-4);
        assert!((volume(across(0.3)) - 0.3).abs() < 1e-4);
        // A tenth of a millimetre at 10 m/s stops within centimetres: its rate is in the hundreds a second.
        assert!(drag(0.0001, 10.0) > 100.0 && drag(0.004, 4.0) < 5.0);
        assert!(splashes(0.004, 4.4) && !splashes(0.0003, 1.0));
    }
}
