// Seeded randomness (src/rng.ts's xorshift), so a scenario does the same thing every run. The TS game drew on
// Math.random for everything that should vary (a person's breathing clock, how their fingers differ); here all of it
// comes from this one generator: seeded from the clock for play, from the scenario's seed for a scenario.

use bevy::prelude::*;

#[derive(Resource)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(if seed == 0 { 0x9e37_79b9 } else { seed })
    }

    // In [0, 1).
    pub fn next(&mut self) -> f32 {
        let mut s = self.0;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.0 = s;
        (s as f64 / 4_294_967_296.0) as f32
    }
}

pub fn plugin(app: &mut App) {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.subsec_nanos());
    app.insert_resource(Rng::new(seed));
}

#[test]
fn xorshift_as_the_ts() {
    // makeRng(1)() in src/rng.ts: s = 1 -> 270369 -> 67634689 -> 2647435461, over 2^32.
    let mut r = Rng::new(1);
    assert!((r.next() - 270369.0 / 4294967296.0).abs() < 1e-9);
}
