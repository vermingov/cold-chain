// Shapes cut out of a slab.
//
// The heads of the gravestones, and of the chapel's doors and windows, which
// were drawn by the same hands with the same compasses. Each is a list of
// [x, y] points in metres, counter-clockwise as drawn on paper, from the
// bottom right corner over the head to the bottom left. `w` and `h` are the
// whole width and the height above `foot`, which is where the bottom edge is.

// An arc of `steps` points from angle a to b round (cx, cy), radius r.
function arc(cx, cy, r, a, b, steps) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const t = a + (b - a) * (i / steps);
        out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
    return out;
}

export const OUTLINES = {
    // A plain upright with a round head.
    round: (w, h, foot = 0) => [[w / 2, foot], ...arc(0, foot + h - w / 2, w / 2, 0, Math.PI, 12), [-w / 2, foot]],
    // A pointed head: two arcs struck from the opposite shoulders.
    gothic: (w, h, foot = 0) => [[w / 2, foot], ...arc(-w / 2, foot + h - w * 0.87, w, 0, Math.PI / 3, 7),
        ...arc(w / 2, foot + h - w * 0.87, w, Math.PI * 2 / 3, Math.PI, 7), [-w / 2, foot]],
    // Square shoulders and a low arch between them.
    shoulder: (w, h, foot = 0) => [[w / 2, foot], [w / 2, foot + h - 0.16], ...arc(0, foot + h - 0.16 - w * 0.6, w * 0.72, 0.985, Math.PI - 0.985, 8),
        [-w / 2, foot + h - 0.16], [-w / 2, foot]],
    square: (w, h, foot = 0) => [[w / 2, foot], [w / 2, foot + h - 0.03], [w / 2 - 0.03, foot + h], [-w / 2 + 0.03, foot + h],
        [-w / 2, foot + h - 0.03], [-w / 2, foot]],
    // A round window: a whole circle, which starts and ends at its lowest point.
    oculus: (w, h, foot = 0) => arc(0, foot + w / 2, w / 2, -Math.PI / 2, Math.PI * 1.5, 24),
};
