// What the people in the corridors do with their bodies.
//
// Every function here returns a pose: joint angles in degrees, keyed by the
// control names in figure.js, plus a few keys starting with an underscore that
// move the whole body — `_y` lifts it, `_pitch` tips it forward, `_roll` rolls
// it onto its side. They take time or a phase and nothing else, so the same
// walk can be played by six people in a queue at six different points in it.
//
// The rest pose MakeHuman ships is an A-pose: arms forty degrees out and
// thirty forward. RELAXED is what a person standing still actually looks like
// — arms straight down — and every pose is written as changes from it, so a
// shoulder flexed ninety from RELAXED points the arm straight ahead.

const RELAXED = {
    shoulderAbductL: -36, shoulderAbductR: -36,
    shoulderFlexL: -26, shoulderFlexR: -26,
    elbowL: 12, elbowR: 12,
    // (the hands loosely curled, the thumb in alongside the index: a hand hanging with nothing working it)
    curlL: 30, curlR: 28, thumbL: 14, thumbR: 12, thumbInL: 8, thumbInR: 8,
    hipAbductL: -2, hipAbductR: -2,
};

export function mix(a, b, t) {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        out[k] = (a[k] || 0) * (1 - t) + (b[k] || 0) * t;
    }
    return out;
}

function over(base, changes) {
    const out = { ...base };
    for (const [k, v] of Object.entries(changes)) out[k] = (out[k] || 0) + v;
    return out;
}

const pos = (x) => Math.max(0, x);

// --- standing ----------------------------------------------------------------

// Standing still is not a statue: the chest rises, the weight drifts from one
// foot to the other, and the head settles. Kept small enough that a person
// facing a wall reads as waiting rather than as fidgeting.
export function stand(t, { breathe = 1, still = 0 } = {}) {
    const b = Math.sin(t * 1.55) * breathe * (1 - still);
    const drift = Math.sin(t * 0.37) * (1 - still);
    return over(RELAXED, {
        spineFlex: -1 + b * 1.4,
        shrugL: b * 1.2, shrugR: b * 1.2,
        spineSide: drift * 1.5, hipAbductL: drift * 1.2, hipAbductR: -drift * 1.2,
        neckFlex: 4 + Math.sin(t * 0.23) * 2 * (1 - still),
    });
}

// Head down, nose to the concrete, not moving at all.
export function faceWall(t) {
    return over(stand(t, { breathe: 0.5 }), { neckFlex: 26, headFlex: 12, spineFlex: 4 });
}

// --- walking and running ------------------------------------------------------

// A walk cycle over one phase in radians: 2π is a full stride, left and right.
// `stride` scales how far the legs travel, `shuffle` drags the feet and drops
// the head, which is what the queue does.
export function walk(phase, { stride = 1, shuffle = 0 } = {}) {
    const s = Math.sin(phase);
    const legL = s, legR = -s;
    const swing = (p) => pos(Math.cos(p - 0.35));
    const A = 24 * stride * (1 - shuffle * 0.55);
    return {
        ...over(RELAXED, {
            hipFlexL: A * legL + 3, hipFlexR: A * legR + 3,
            kneeL: 6 + 52 * stride * (1 - shuffle * 0.6) * swing(phase) ** 1.6,
            kneeR: 6 + 52 * stride * (1 - shuffle * 0.6) * swing(phase + Math.PI) ** 1.6,
            ankleL: 8 * Math.sin(phase - 1.1) * stride, ankleR: 8 * Math.sin(phase + Math.PI - 1.1) * stride,
            shoulderFlexL: -15 * legL * (1 - shuffle * 0.8), shoulderFlexR: -15 * legR * (1 - shuffle * 0.8),
            elbowL: 6 + 8 * pos(-legL), elbowR: 6 + 8 * pos(-legR),
            spineTwist: 5 * s * (1 - shuffle), spineFlex: 3 + shuffle * 14,
            neckFlex: 2 + shuffle * 22, headFlex: shuffle * 8,
        }),
        _y: -0.018 * Math.abs(Math.cos(phase)) * stride - shuffle * 0.03,
    };
}

// Arms driving, leaning into it, both feet off the floor for part of each
// stride.
export function run(phase) {
    const s = Math.sin(phase);
    const swing = (p) => pos(Math.cos(p - 0.2));
    return {
        ...over(RELAXED, {
            hipFlexL: 42 * s + 12, hipFlexR: -42 * s + 12,
            kneeL: 18 + 88 * swing(phase) ** 1.3, kneeR: 18 + 88 * swing(phase + Math.PI) ** 1.3,
            ankleL: 14 * Math.sin(phase - 1.3), ankleR: 14 * Math.sin(phase + Math.PI - 1.3),
            shoulderFlexL: -46 * s, shoulderFlexR: 46 * s,
            shoulderAbductL: 10, shoulderAbductR: 10,
            elbowL: 78, elbowR: 78, curlL: 45, curlR: 45,
            spineTwist: 9 * s, spineFlex: 10, neckFlex: -12,
        }),
        _y: 0.05 * Math.abs(Math.sin(phase)) - 0.02,
        _pitch: 14,
    };
}

// --- on the floor --------------------------------------------------------------

// Kneeling back on the heels, folded forward toward a wall. `rock` is 0..1
// through one stroke of rocking forward and back; the caller drives it and
// can stop it anywhere.
export function kneel(rock = 0, { bow = 1 } = {}) {
    const r = Math.sin(rock * Math.PI * 2);
    return {
        ...over(RELAXED, {
            hipFlexL: 108 + r * 8, hipFlexR: 108 + r * 8,
            hipAbductL: 6, hipAbductR: 6,
            kneeL: 152, kneeR: 152,
            ankleL: -48, ankleR: -48,
            spineFlex: (34 + r * 14) * bow,
            neckFlex: 18 + r * 6, headFlex: 12,
            // hands pressed together in the lap, as though holding something
            shoulderFlexL: 32 + r * 5, shoulderFlexR: 32 + r * 5,
            shoulderAbductL: 6, shoulderAbductR: 6,
            elbowL: 70, elbowR: 70, curlL: 55, curlR: 55,
        }),
        _pitch: r * 4,
    };
}

// On hands and knees. The body is tipped forward whole, so "forward" for the
// arms is now down: shoulders at ninety put the hands on the floor. The gait
// is the diagonal one — left hand with right knee.
// On all fours, splayed wide like something that has never walked upright:
// elbows and knees out to the sides, the body slung low between them, and a
// long reach with every step.
export function crawl(phase, { speed = 1 } = {}) {
    const s = Math.sin(phase) * speed, c = Math.cos(phase) * speed;
    return {
        ...over(RELAXED, {
            hipFlexL: 88 + 24 * s, hipFlexR: 88 - 24 * s,
            hipAbductL: 34, hipAbductR: 34,
            kneeL: 112 - 18 * pos(c), kneeR: 112 - 18 * pos(-c),
            ankleL: -40, ankleR: -40,
            shoulderFlexL: 80 - 26 * s, shoulderFlexR: 80 + 26 * s,
            shoulderAbductL: 58, shoulderAbductR: 58,
            elbowL: 48 + 20 * pos(s), elbowR: 48 + 20 * pos(-s),
            curlL: 24, curlR: 24,
            spineFlex: -14, spineTwist: 7 * s,
            neckFlex: -52, headFlex: -26,
        }),
        _pitch: 90,
    };
}

// --- hanging -----------------------------------------------------------------

// Nothing holding any of it up but the rope. Every limb hangs where gravity
// leaves it, the head lolls off to one side, the toes point at the floor.
export function hang(t, { side = 1 } = {}) {
    const sway = Math.sin(t * 0.8) * 1.5;
    return over(RELAXED, {
        shoulderAbductL: -4, shoulderAbductR: -2, shoulderFlexL: 4 + sway, shoulderFlexR: 1 - sway,
        shrugL: 14, shrugR: 14,                 // the shoulders dragged up by the weight below them
        elbowL: 18, elbowR: 11, curlL: 10, curlR: 6, thumbL: 6, thumbR: 4,
        hipFlexL: 9, hipFlexR: 14, kneeL: 22, kneeR: 31, hipTwistL: 8, hipTwistR: -5,
        ankleL: -58, ankleR: -52,
        spineFlex: 7, spineSide: -4 * side,
        // The neck is where it all hangs from: stretched, and the head fallen
        // right over onto the shoulder away from the knot.
        neckFlex: 30, headFlex: 22, headTilt: 52 * side, headTwist: 10 * side,
        jaw: 12,
    });
}

// --- at a corner -------------------------------------------------------------

// Leaning out sideways past something, as far as the hips will let the upper
// body go without taking a step. `side` is +1 to lean to the figure's right.
export function lean(amount, side, t = 0) {
    const a = amount;
    return over(stand(t, { breathe: 0.6 }), {
        spineSide: 26 * a * side,
        hipAbductL: side > 0 ? -6 * a : 10 * a, hipAbductR: side > 0 ? 10 * a : -6 * a,
        neckFlex: -4 * a, headTilt: -18 * a * side,
        // the near hand on the edge of the wall
        shoulderAbductL: side < 0 ? 40 * a : 0, shoulderAbductR: side > 0 ? 40 * a : 0,
        elbowL: side < 0 ? 40 * a : 0, elbowR: side > 0 ? 40 * a : 0,
        curlL: side < 0 ? 20 * a : 0, curlR: side > 0 ? 20 * a : 0,
    });
}

// --- going wrong ---------------------------------------------------------------

// Knees giving way and the body folding down on top of them, 0 upright to 1
// in a heap. Used for anything that stops being a person on the spot.
export function collapse(t) {
    const k = Math.min(1, t);
    const e = k * k * (3 - 2 * k);
    return {
        ...over(RELAXED, {
            hipFlexL: 70 * e, hipFlexR: 64 * e, kneeL: 130 * e, kneeR: 122 * e,
            ankleL: -30 * e, ankleR: -30 * e,
            spineFlex: 50 * e, neckFlex: 30 * e, headTilt: 20 * e,
            shoulderAbductL: 18 * e, shoulderAbductR: 12 * e, elbowL: 20 * e, elbowR: 30 * e,
        }),
        _pitch: 20 * e,
    };
}

// Going down at a run: pitching forward over the feet, arms going out too
// late to do anything. 0 is still running, 1 is flat on the floor.
export function fall(t, phase = 0) {
    const k = Math.min(1, t);
    const e = k * k;
    const r = run(phase);
    const down = over(RELAXED, {
        hipFlexL: 18, hipFlexR: 6, kneeL: 28, kneeR: 12, ankleL: -40, ankleR: -34,
        shoulderFlexL: 150, shoulderFlexR: 138, shoulderAbductL: 30, shoulderAbductR: 36,
        elbowL: 20, elbowR: 34, curlL: 30, curlR: 40,
        spineFlex: -8, neckFlex: -30, headTilt: 25,
    });
    return { ...mix(r, down, e), _pitch: 88 * e, _y: 0 };
}

// One arm out at shoulder height, fingers open.
export function reach(side, amount, base) {
    const a = amount;
    const k = side < 0 ? 'L' : 'R';
    return over(base, {
        ['shoulderFlex' + k]: 78 * a, ['shoulderAbduct' + k]: 26 * a,
        ['elbow' + k]: -8 * a, ['curl' + k]: -40 * a, ['thumb' + k]: -18 * a,
    });
}

export { RELAXED };
