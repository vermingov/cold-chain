// What cannot be walked through (src/solids.ts): pushing a walker clear of a solid seen from above.

// A rectangle on the floor plan (x and z, metres).
pub struct Rect {
    pub x0: f32,
    pub z0: f32,
    pub x1: f32,
    pub z1: f32,
}

// Push `at` ([x, z], changed in place) clear of a rectangle, for a body of `radius`. The way it went, as a unit
// [x, z], or None if it touched nothing: whoever is moving takes that out of their speed, and slides.
pub fn clear(at: &mut [f32; 2], radius: f32, s: &Rect) -> Option<[f32; 2]> {
    // The nearest point of the rectangle's edge-or-inside to the body's middle.
    let nx = at[0].clamp(s.x0, s.x1);
    let nz = at[1].clamp(s.z0, s.z1);
    let (dx, dz) = (at[0] - nx, at[1] - nz);
    let apart = dx.hypot(dz);
    if apart >= radius {
        return None;
    }
    if apart > 1e-6 {
        at[0] = nx + dx / apart * (radius + 0.001);
        at[1] = nz + dz / apart * (radius + 0.001);
        return Some([dx / apart, dz / apart]);
    }
    // Right inside: out by whichever side is nearest.
    let out = [(at[0] - s.x0, -1.0, 0.0), (s.x1 - at[0], 1.0, 0.0), (at[1] - s.z0, 0.0, -1.0), (s.z1 - at[1], 0.0, 1.0)]
        .into_iter()
        .fold((f32::INFINITY, 0.0, 0.0), |a, b| if b.0 < a.0 { b } else { a });
    at[0] += out.1 * (out.0 + radius + 0.001);
    at[1] += out.2 * (out.0 + radius + 0.001);
    Some([out.1, out.2])
}

#[test]
fn pushed_out() {
    let r = Rect { x0: 0.0, z0: 0.0, x1: 1.0, z1: 1.0 };
    let mut at = [1.2, 0.5];
    assert_eq!(clear(&mut at, 0.3, &r), Some([1.0, 0.0]));
    assert!((at[0] - 1.301).abs() < 1e-5);
    let mut inside = [0.1, 0.5];
    assert_eq!(clear(&mut inside, 0.3, &r), Some([-1.0, 0.0]));
}
